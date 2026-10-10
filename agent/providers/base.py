"""LLM provider interface. Messages use the Bedrock Converse shape for every provider.

    message  = {"role": "user"|"assistant", "content": [block, ...]}
    block    = {"text": str} | {"toolUse": {"toolUseId", "name", "input"}}
             | {"toolResult": {"toolUseId", "content": [{"json": {...}}], "status"}}

Current Claude models reject forced tool choice, so providers always send
toolChoice=auto; stages say in the prompt which tool to call and validate the result.
"""

from __future__ import annotations

from typing import Any, Protocol

from pydantic import BaseModel

Message = dict[str, Any]


class LLMRequest(BaseModel):
    purpose: str  # e.g. "perceive", "assess", "plan", "reflect" - keys replay/fake scripts
    system: str
    messages: list[Message]
    tools: list[dict[str, Any]] = []  # Converse toolSpec entries
    max_tokens: int = 4096
    case_id: str | None = None  # set by the agent; never sent to the model (keys replay)


class LLMResponse(BaseModel):
    message: Message  # assistant message
    stop_reason: str
    usage: dict[str, Any] = {}
    latency_ms: float = 0.0
    model: str = ""

    def tool_uses(self) -> list[dict[str, Any]]:
        return [b["toolUse"] for b in self.message["content"] if "toolUse" in b]

    def text(self) -> str:
        return "".join(b.get("text", "") for b in self.message["content"])


class LLMError(Exception):
    """Provider failure the state machine turns into an escalation."""


class LLMProvider(Protocol):
    name: str

    def converse(self, req: LLMRequest) -> LLMResponse: ...


def user_text(text: str) -> Message:
    return {"role": "user", "content": [{"text": text}]}


def tool_result(tool_use_id: str, payload: dict[str, Any], ok: bool = True) -> dict[str, Any]:
    return {
        "toolResult": {
            "toolUseId": tool_use_id,
            "content": [{"json": payload}],
            "status": "success" if ok else "error",
        }
    }
