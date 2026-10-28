"""Claude on SAP AI Core (Generative AI Hub), the one live LLM provider.

The deployment takes a Converse request body (system, messages, inferenceConfig,
toolConfig) and answers with a Converse response, so every provider shares the message
shape in agent/providers/base.py and recording, replay and the agent's tool loop work the
same way. How the endpoint works: agent/aicore.py.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

import httpx

from agent.aicore import AiCore, AiCoreError
from agent.providers.base import LLMError, LLMRequest, LLMResponse, RetryHook

log = logging.getLogger(__name__)

# Retried here, so every wait is visible to the agent (and on the dashboard as a neutral
# "Retrying..." note). Anything else fails at once.
RETRY_STATUS = {429, 500, 502, 503, 504}
MAX_ATTEMPTS = 6
BACKOFF_S = (2.0, 4.0, 8.0, 16.0, 30.0)
LABEL = "Claude via SAP AI Core"


class SapGenAIProvider:
    name = "sap_genai"

    def __init__(
        self,
        aicore: AiCore,
        model_name: str = "anthropic--claude-4.6-sonnet",
        deployment_id: str | None = None,
        temperature: float | None = 0.0,
        sleep: Callable[[float], None] = time.sleep,
        max_attempts: int = MAX_ATTEMPTS,
    ):
        self.aicore, self.model_name, self.deployment_id = aicore, model_name, deployment_id
        self.temperature = temperature
        self._sleep, self.max_attempts = sleep, max_attempts
        self._url: str | None = None

    def _body(self, req: LLMRequest) -> dict:
        """The Converse body. No model id: the deployment is the model."""
        inference = {"maxTokens": req.max_tokens}
        if self.temperature is not None:
            inference["temperature"] = self.temperature
        body = {
            "system": [{"text": req.system}],
            "messages": req.messages,
            "inferenceConfig": inference,
        }
        if req.tools:
            # current Claude models reject forced tool choice; prompts name the tool instead
            body["toolConfig"] = {"tools": req.tools, "toolChoice": {"auto": {}}}
        return body

    def converse(self, req: LLMRequest, on_retry: RetryHook | None = None) -> LLMResponse:
        t0 = time.perf_counter()
        attempt, refreshed = 1, False
        while True:
            try:
                if self._url is None:
                    self._url = self.aicore.deployment_url(self.model_name, self.deployment_id)
                r = self.aicore.http.post(
                    f"{self._url.rstrip('/')}/converse",
                    json=self._body(req),
                    headers=self.aicore.headers(),
                )
            except AiCoreError as e:
                kind = "account" if e.status in (None, 400, 401, 403, 404) else "other"
                raise LLMError(f"SAP AI Core: {e}", kind=kind) from e
            except httpx.HTTPError as e:
                if attempt < self.max_attempts:
                    attempt = self._wait(attempt, "connection problem", on_retry)
                    continue
                raise LLMError(f"SAP AI Core call failed after {attempt} attempts: {e}") from e
            if r.status_code == 200:
                break
            text = r.text[:300]
            if r.status_code == 401 and not refreshed:  # token revoked or expired early
                refreshed = True
                self.aicore.token(refresh=True)
                continue
            if (
                r.status_code == 400
                and "temperature" in text.lower()
                and self.temperature is not None
            ):
                log.warning("%s rejects temperature; continuing without it", self.model_name)
                self.temperature = None
                continue
            if r.status_code in RETRY_STATUS and attempt < self.max_attempts:
                reason = "throttled" if r.status_code == 429 else f"HTTP {r.status_code}"
                attempt = self._wait(attempt, reason, on_retry)
                continue
            kind = (
                "throttle"
                if r.status_code == 429
                else "account"
                if r.status_code in (401, 403, 404)
                else "other"
            )
            status = f"{r.status_code} (throttled)" if r.status_code == 429 else r.status_code
            raise LLMError(f"SAP AI Core HTTP {status}: {text}", kind=kind)
        resp = r.json()
        return LLMResponse(
            message=resp["output"]["message"],
            stop_reason=resp["stopReason"],
            usage=resp.get("usage", {}),
            latency_ms=resp.get("metrics", {}).get("latencyMs", (time.perf_counter() - t0) * 1000),
            model=f"sap:{self.model_name}",
        )

    def _wait(self, attempt: int, reason: str, on_retry: RetryHook | None) -> int:
        wait = BACKOFF_S[min(attempt - 1, len(BACKOFF_S) - 1)]
        log.warning(
            "SAP AI Core %s; retry %d/%d in %.0f s", reason, attempt + 1, self.max_attempts, wait
        )
        if on_retry is not None:
            on_retry(attempt + 1, self.max_attempts, wait, reason)
        self._sleep(wait)
        return attempt + 1
