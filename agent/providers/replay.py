"""Record / replay LLM calls (the Phase 6 golden run).

The recording is a JSONL of {purpose, index, request_digest, response} for ONE case run.
Replay serves those responses in recorded order per purpose, separately for every case it
sees (so a long-running API can replay the golden case again and again), with no network
access at all. `speed` scales the recorded model latency: 1.0 = as recorded, 0 = instant.
Replay is labelled as such in the model name, the events and the UI badge.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
from collections import defaultdict
from pathlib import Path

from agent.providers.base import LLMError, LLMProvider, LLMRequest, LLMResponse, RetryHook

log = logging.getLogger(__name__)


def request_digest(req: LLMRequest) -> str:
    """Digest of what the model sees (case_id excluded); for diagnostics only."""
    body = req.model_dump(exclude={"case_id"})
    return hashlib.sha256(json.dumps(body, sort_keys=True).encode()).hexdigest()[:16]


class RecordingProvider:
    def __init__(self, inner: LLMProvider, path: Path):
        self.inner, self.path = inner, Path(path)
        self.name = f"recording({inner.name})"
        self.counts: dict[str, int] = defaultdict(int)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("")

    def converse(self, req: LLMRequest, on_retry: RetryHook | None = None) -> LLMResponse:
        resp = self.inner.converse(req, on_retry)
        entry = {
            "purpose": req.purpose,
            "index": self.counts[req.purpose],
            "request_digest": request_digest(req),
            "response": resp.model_dump(),
        }
        self.counts[req.purpose] += 1
        with self.path.open("a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return resp


class ReplayProvider:
    name = "replay"

    def __init__(self, path: Path, speed: float = 0.0):
        self.path, self.speed = Path(path), speed
        if not self.path.exists():
            raise LLMError(f"no golden recording at {self.path}; run `make record-golden`")
        self.queue: dict[str, list[dict]] = defaultdict(list)
        for line in self.path.read_text().splitlines():
            if line.strip():
                e = json.loads(line)
                self.queue[e["purpose"]].append(e)
        self.pos: dict[tuple[str | None, str], int] = defaultdict(int)
        self.mismatches = 0

    def converse(self, req: LLMRequest, on_retry: RetryHook | None = None) -> LLMResponse:
        key = (req.case_id, req.purpose)
        entries = self.queue[req.purpose]
        i = self.pos[key]
        if i >= len(entries):
            raise LLMError(
                f"replay has no recorded {req.purpose!r} response #{i + 1}; the case left the "
                "golden path (replay only covers the recorded run)"
            )
        self.pos[key] += 1
        entry = entries[i]
        if entry.get("request_digest") and entry["request_digest"] != request_digest(req):
            # Expected when only display dates differ (day 0 moves with the demo date).
            self.mismatches += 1
            log.debug("replay request differs from the recording (%s #%d)", req.purpose, i)
        resp = LLMResponse.model_validate(entry["response"])
        if self.speed > 0:
            time.sleep(resp.latency_ms / 1000 * self.speed)
        return resp.model_copy(update={"model": f"replay:{resp.model}"})
