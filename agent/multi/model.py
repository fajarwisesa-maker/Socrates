"""A Strands model provider that sends every model call through the orchestrator.

Strands runs each specialist's agent loop (which tool to call next, tool execution, the
conversation). The model call itself goes through the orchestrator's LLM path, so the
`fake`, `replay`, recording and SAP AI Core providers, the retry events, the audit trail
and the LLM call counter work exactly as in v1. Messages are already in the Converse shape
on both sides.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncGenerator, Callable
from typing import Any

from strands.models.model import Model

from agent.providers.base import LLMRequest, LLMResponse


class ToolNotAllowed(Exception):
    """The model asked for a tool outside its specialist's allowlist (a hard error)."""

    def __init__(self, tool: str):
        super().__init__(tool)
        self.tool = tool


class OrchestratedModel(Model):
    def __init__(
        self,
        call: Callable[[LLMRequest], LLMResponse],
        purpose: str,
        permitted: set[str],
        max_tokens: int = 4096,
    ):
        self.call = call
        self.purpose = purpose
        self.permitted = permitted  # allowlist + the specialist's output tool
        self.max_tokens = max_tokens

    def update_config(self, **model_config: Any) -> None:
        if "purpose" in model_config:
            self.purpose = model_config["purpose"]

    def get_config(self) -> dict[str, Any]:
        return {"purpose": self.purpose, "max_tokens": self.max_tokens}

    async def structured_output(self, output_model, prompt, system_prompt=None, **kwargs):  # type: ignore[override]
        raise NotImplementedError("SIAGA specialists answer through their output tools")
        yield {}  # pragma: no cover

    async def stream(  # type: ignore[override]
        self,
        messages,
        tool_specs=None,
        system_prompt=None,
        **kwargs: Any,
    ) -> AsyncGenerator[dict[str, Any], None]:
        req = LLMRequest(
            purpose=self.purpose,
            system=system_prompt or "",
            messages=json.loads(json.dumps(messages, default=str)),
            tools=[{"toolSpec": t} for t in tool_specs or []],
            max_tokens=self.max_tokens,
        )
        resp = await asyncio.to_thread(self.call, req)
        for u in resp.tool_uses():
            if u["name"] not in self.permitted:
                raise ToolNotAllowed(u["name"])
        for event in stream_events(resp):
            yield event


def stream_events(resp: LLMResponse) -> list[dict[str, Any]]:
    """A complete (non-streaming) Converse response as Strands stream events."""
    events: list[dict[str, Any]] = [{"messageStart": {"role": "assistant"}}]
    for block in resp.message["content"]:
        if "toolUse" in block:
            tu = block["toolUse"]
            events.append(
                {
                    "contentBlockStart": {
                        "start": {"toolUse": {"toolUseId": tu["toolUseId"], "name": tu["name"]}}
                    }
                }
            )
            events.append(
                {"contentBlockDelta": {"delta": {"toolUse": {"input": json.dumps(tu["input"])}}}}
            )
        elif "text" in block:
            events.append({"contentBlockDelta": {"delta": {"text": block["text"]}}})
        else:
            continue
        events.append({"contentBlockStop": {}})
    events.append({"messageStop": {"stopReason": resp.stop_reason}})
    usage = resp.usage or {}
    events.append(
        {
            "metadata": {
                "usage": {
                    "inputTokens": usage.get("inputTokens", 0),
                    "outputTokens": usage.get("outputTokens", 0),
                    "totalTokens": usage.get("totalTokens", 0),
                },
                "metrics": {"latencyMs": int(resp.latency_ms)},
            }
        }
    )
    return events
