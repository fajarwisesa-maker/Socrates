"""LLM_FALLBACK: a case whose first primary call fails with an account or throttling error
runs on the fallback provider from then on. Once a case has had a primary answer it stays
on the primary (errors then escalate as usual), so a case never mixes models mid-way by
accident. Responses served by the fallback carry `fallback_reason`; the agent turns the
first one into an event and the UI shows "Model: Claude via SAP AI Core".
"""

from __future__ import annotations

import logging
import threading

from agent.providers.base import LLMError, LLMProvider, LLMRequest, LLMResponse, RetryHook

log = logging.getLogger(__name__)


class FallbackProvider:
    def __init__(self, primary: LLMProvider, fallback: LLMProvider):
        self.primary, self.fallback = primary, fallback
        self.name = f"{primary.name}+fallback:{fallback.name}"
        self._on_primary: set[str | None] = set()  # cases with a primary answer
        self._moved: dict[str | None, str] = {}  # case -> why it runs on the fallback
        self._lock = threading.Lock()

    def converse(self, req: LLMRequest, on_retry: RetryHook | None = None) -> LLMResponse:
        case = req.case_id
        with self._lock:
            reason = self._moved.get(case)
            started = case in self._on_primary
        if reason is None:
            try:
                resp = self.primary.converse(req, on_retry)
            except LLMError as e:
                if started or e.kind not in ("account", "throttle"):
                    raise
                reason = f"{self.primary.name} {e.kind} error: {str(e)[:160]}"
                log.warning("case %s moves to %s: %s", case, self.fallback.name, reason)
                with self._lock:
                    self._moved[case] = reason
            else:
                with self._lock:
                    self._on_primary.add(case)
                return resp
        resp = self.fallback.converse(req, on_retry)
        return resp.model_copy(update={"fallback_reason": reason})
