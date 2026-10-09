"""Record / replay LLM calls (Phase 6 golden run).

The recording is a JSONL of {purpose, index, request_digest, response}. Replay returns
responses in recorded order per purpose; no network. Replay output is labelled as such
by the UI (Phase 6).
"""

from __future__ import annotations

import hashlib
import json
import time
from collections import defaultdict
from pathlib import Path

from agent.providers.base import LLMError, LLMProvider, LLMRequest, LLMResponse


def _digest(req: LLMRequest) -> str:
    return hashlib.sha256(req.model_dump_json().encode()).hexdigest()[:16]


class RecordingProvider:
    def __init__(self, inner: LLMProvider, path: Path):
        self.inner, self.path = inner, Path(path)
        self.name = f"recording({inner.name})"
        self.counts: dict[str, int] = defaultdict(int)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text("")

    def converse(self, req: LLMRequest) -> LLMResponse:
        resp = self.inner.converse(req)
        entry = {
            "purpose": req.purpose,
            "index": self.counts[req.purpose],
            "request_digest": _digest(req),
            "response": resp.model_dump(),
        }
        self.counts[req.purpose] += 1
        with self.path.open("a") as f:
            f.write(json.dumps(entry) + "\n")
        return resp


class ReplayProvider:
    name = "replay"

    def __init__(self, path: Path, realtime: bool = False):
        self.realtime = realtime
        self.queue: dict[str, list[dict]] = defaultdict(list)
        for line in Path(path).read_text().splitlines():
            if line.strip():
                e = json.loads(line)
                self.queue[e["purpose"]].append(e)
        self.pos: dict[str, int] = defaultdict(int)

    def converse(self, req: LLMRequest) -> LLMResponse:
        entries = self.queue[req.purpose]
        i = self.pos[req.purpose]
        if i >= len(entries):
            raise LLMError(f"replay exhausted for purpose {req.purpose!r} (call {i})")
        self.pos[req.purpose] += 1
        resp = LLMResponse.model_validate(entries[i]["response"])
        if self.realtime:
            time.sleep(resp.latency_ms / 1000)
        return resp.model_copy(update={"model": f"replay:{resp.model}"})
