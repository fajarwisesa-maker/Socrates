"""Claude on Amazon Bedrock via the boto3 bedrock-runtime Converse API."""

from __future__ import annotations

import logging
import time
from collections.abc import Callable

import boto3
from botocore.config import Config
from botocore.exceptions import (
    BotoCoreError,
    ClientError,
    ConnectionError,
    NoCredentialsError,
    ReadTimeoutError,
)

from agent.providers.base import LLMError, LLMRequest, LLMResponse, RetryHook

log = logging.getLogger(__name__)

# Retried here rather than inside botocore, so every wait is visible to the agent (and on the
# dashboard as a neutral "Retrying..." note). Anything else fails at once.
RETRYABLE_CODES = {
    "ThrottlingException",
    "TooManyRequestsException",
    "ServiceUnavailableException",
    "ModelNotReadyException",
    "InternalServerException",
}
MAX_ATTEMPTS = 6
BACKOFF_S = (2.0, 4.0, 8.0, 16.0, 30.0)
# Errors that say this account cannot use Bedrock right now (not this request): with
# LLM_FALLBACK=sap_genai the case moves to SAP AI Core on them.
ACCOUNT_CODES = {
    "AccessDeniedException",
    "UnrecognizedClientException",
    "ExpiredTokenException",
    "InvalidSignatureException",
    "ResourceNotFoundException",  # model / profile not enabled in this account or region
}
ACCOUNT_MESSAGES = ("operation not allowed", "model access", "not authorized", "use case")


def error_kind(code: str, message: str) -> str:
    if code in ACCOUNT_CODES or (
        code == "ValidationException" and any(m in message.lower() for m in ACCOUNT_MESSAGES)
    ):
        return "account"
    if code in RETRYABLE_CODES and ("Throttl" in code or "TooMany" in code):
        return "throttle"
    return "other"


class BedrockProvider:
    name = "bedrock"

    def __init__(
        self,
        model_id: str,
        region: str,
        temperature: float | None = 0.0,
        client=None,
        sleep: Callable[[float], None] = time.sleep,
        max_attempts: int = MAX_ATTEMPTS,
    ):
        self.model_id = model_id
        self.temperature = temperature
        self._sleep = sleep
        self.max_attempts = max_attempts  # lower with a fallback: fail over instead of waiting
        self.client = client or boto3.client(
            "bedrock-runtime",
            region_name=region,
            config=Config(
                retries={"mode": "standard", "total_max_attempts": 1},  # retries are ours
                read_timeout=120,
                connect_timeout=10,
            ),
        )

    def _kwargs(self, req: LLMRequest) -> dict:
        inference = {"maxTokens": req.max_tokens}
        if self.temperature is not None:
            inference["temperature"] = self.temperature
        kwargs = {
            "modelId": self.model_id,
            "system": [{"text": req.system}],
            "messages": req.messages,
            "inferenceConfig": inference,
        }
        if req.tools:
            kwargs["toolConfig"] = {"tools": req.tools, "toolChoice": {"auto": {}}}
        return kwargs

    def converse(self, req: LLMRequest, on_retry: RetryHook | None = None) -> LLMResponse:
        t0 = time.perf_counter()
        attempt = 1
        while True:
            try:
                resp = self.client.converse(**self._kwargs(req))
                break
            except ClientError as e:
                err = e.response.get("Error", {})
                code = err.get("Code", "")
                # Current Claude models reject non-default sampling parameters. The brief asks
                # for temperature 0; if the model refuses it, drop it once and remember.
                if (
                    code == "ValidationException"
                    and "temperature" in err.get("Message", "").lower()
                    and self.temperature is not None
                ):
                    log.warning(
                        "model %s rejects temperature; continuing without it", self.model_id
                    )
                    self.temperature = None
                    continue
                if code in RETRYABLE_CODES and attempt < self.max_attempts:
                    reason = "throttled" if "Throttl" in code or "TooMany" in code else code
                    attempt = self._wait(attempt, reason, on_retry)
                    continue
                suffix = f" after {attempt} attempts" if code in RETRYABLE_CODES else ""
                raise LLMError(
                    f"Bedrock {code}: {err.get('Message')}{suffix}",
                    kind=error_kind(code, err.get("Message", "")),
                ) from e
            except (ConnectionError, ReadTimeoutError) as e:
                if attempt < self.max_attempts:
                    attempt = self._wait(attempt, "connection problem", on_retry)
                    continue
                raise LLMError(f"Bedrock call failed after {attempt} attempts: {e}") from e
            except NoCredentialsError as e:
                raise LLMError(f"Bedrock call failed: {e}", kind="account") from e
            except BotoCoreError as e:
                raise LLMError(f"Bedrock call failed: {e}") from e
        return LLMResponse(
            message=resp["output"]["message"],
            stop_reason=resp["stopReason"],
            usage=resp.get("usage", {}),
            latency_ms=resp.get("metrics", {}).get("latencyMs", (time.perf_counter() - t0) * 1000),
            model=self.model_id,
        )

    def _wait(self, attempt: int, reason: str, on_retry: RetryHook | None) -> int:
        wait = BACKOFF_S[min(attempt - 1, len(BACKOFF_S) - 1)]
        log.warning(
            "Bedrock %s; retry %d/%d in %.0f s", reason, attempt + 1, self.max_attempts, wait
        )
        if on_retry is not None:
            on_retry(attempt + 1, self.max_attempts, wait, reason)
        self._sleep(wait)
        return attempt + 1
