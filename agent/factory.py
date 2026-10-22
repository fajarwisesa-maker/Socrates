"""Build the agent the settings ask for: the v1 state machine, or (ORCHESTRATION=multi) the
SIAGA Orchestrator with its specialist agents."""

from __future__ import annotations

from collections.abc import Callable

from agent.case_store import CaseEvent
from agent.machine import Agent
from agent.providers.base import LLMProvider
from agent.runtime import Runtime


def make_agent(
    runtime: Runtime, llm: LLMProvider, on_event: Callable[[CaseEvent], None] | None = None
) -> Agent:
    if runtime.settings.orchestration == "multi":
        from agent.multi.orchestrator import MultiAgentOrchestrator

        return MultiAgentOrchestrator(runtime, llm, on_event)
    return Agent(runtime, llm, on_event)
