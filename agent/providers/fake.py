"""Scripted provider for tests and offline runs. A script maps a purpose to a function
that builds the assistant message from the request (so it can read tool results)."""

from __future__ import annotations

import uuid
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from agent.providers.base import LLMRequest, LLMResponse

Script = Callable[[LLMRequest, int], dict[str, Any]]  # (request, call_no) -> message


def tool_call(name: str, input: dict[str, Any], text: str | None = None) -> dict[str, Any]:
    content: list[dict[str, Any]] = [{"text": text}] if text else []
    content.append(
        {"toolUse": {"toolUseId": f"tu-{uuid.uuid4().hex[:8]}", "name": name, "input": input}}
    )
    return {"role": "assistant", "content": content}


def say(text: str) -> dict[str, Any]:
    return {"role": "assistant", "content": [{"text": text}]}


class FakeProvider:
    name = "fake"

    def __init__(self, scripts: dict[str, Script]):
        self.scripts = scripts
        self.calls: dict[str, int] = defaultdict(int)
        self.requests: list[LLMRequest] = []

    def converse(self, req: LLMRequest) -> LLMResponse:
        self.requests.append(req)
        n = self.calls[req.purpose]
        self.calls[req.purpose] += 1
        message = self.scripts[req.purpose](req, n)
        stop = "tool_use" if any("toolUse" in b for b in message["content"]) else "end_turn"
        return LLMResponse(message=message, stop_reason=stop, model="fake", latency_ms=1.0)
