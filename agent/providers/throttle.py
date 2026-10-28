"""Simulated throttling for demos and tests (LLM_SIMULATE_THROTTLE).

The first PERCEIVE call of each case goes through visible retries, exactly as the SAP AI
Core provider reports real ones (on_retry), so the dashboard's "Retrying…" note and the
"model unavailable" escalation can be shown and tested without a real throttle.
`N` = N retries, then the call succeeds; `exhaust` = retries run out (LLMError).
"""

from __future__ import annotations

import time
from collections.abc import Callable

from agent.providers.base import LLMError, LLMProvider, LLMRequest, LLMResponse, RetryHook
from agent.providers.sap_genai import MAX_ATTEMPTS


class SimulatedThrottleProvider:
    def __init__(
        self,
        inner: LLMProvider,
        spec: str,
        wait_s: float = 1.5,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.inner = inner
        self.name = inner.name
        self.exhaust = spec.strip().lower() == "exhaust"
        self.retries = MAX_ATTEMPTS - 1 if self.exhaust else max(0, int(spec))
        self.wait_s = wait_s
        self._sleep = sleep
        self._done: set[str | None] = set()

    def converse(self, req: LLMRequest, on_retry: RetryHook | None = None) -> LLMResponse:
        if req.purpose == "perceive" and req.case_id not in self._done:
            self._done.add(req.case_id)
            for attempt in range(2, 2 + self.retries):
                if on_retry is not None:
                    on_retry(attempt, MAX_ATTEMPTS, self.wait_s, "throttled")
                self._sleep(self.wait_s)
            if self.exhaust:
                raise LLMError(
                    "SAP AI Core HTTP 429 (throttled): rate exceeded (simulated) "
                    f"after {MAX_ATTEMPTS} attempts",
                    kind="throttle",
                )
        return self.inner.converse(req, on_retry)
