"""SIAGA Orchestrator (ORCHESTRATION=multi): the v1 state machine as a deterministic
supervisor that delegates each stage to a specialist Strands agent.

What stays in code, exactly as in v1: stage order, the tool-call budget, the replan cap,
evidence location, confidence, option selection, every escalation, approvals and VERIFY.
What each specialist does through its own agent loop:

    Signal Agent    PERCEIVE  reads the signals (opens the PDF itself), quotes evidence
                              with an English gloss, reports the disruption
    Impact Agent    ASSESS    chooses its SAP lookups, runs the risk function, explains
    Planner Agent   PLAN      searches precedents, proposes strategy combinations
                    SIMULATE  runs the solver on each candidate it proposed
    Critic Agent    REFLECT   runs the rule check, explains failures; explains the choice
    Executor Agent  ACT       executes the chosen plan (code) and writes approval summaries
                    VERIFY    reads SAP status (code)

Every event carries the agent working its stage; every tool call is checked against that
agent's allowlist (a call outside it is audited and escalates the case).
"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Callable
from typing import Any

from pydantic import BaseModel, ValidationError
from strands import Agent as StrandsAgent
from strands.tools.executors import SequentialToolExecutor
from strands.tools.tools import PythonAgentTool

from agent import critic
from agent.case_store import CaseRecord
from agent.machine import MAX_LLM_TURNS, Agent, Escalate
from agent.multi.model import OrchestratedModel, ToolNotAllowed
from agent.multi.specialists import (
    BY_STAGE,
    CRITIC,
    EXECUTOR,
    IMPACT,
    ORCHESTRATOR,
    PLANNER,
    SIGNAL,
    SPECIALISTS,
    Specialist,
)
from agent.prompts import load_prompt
from agent.schemas import (
    PROPOSE_CANDIDATES,
    REPORT_DISRUPTION_GLOSSED,
    REPORT_REVIEW,
    WRITE_APPROVAL_SUMMARY,
    WRITE_EXPLANATION,
    ApprovalSummary,
    CandidatePlan,
    CriticNotes,
    Disruption,
    Explanation,
    GlossedDisruption,
    PerceivedDisruption,
)
from services.solver.models import SolveResult

# (tool name, Pydantic model, Converse tool spec) of a specialist's answer
Output = tuple[str, type[BaseModel], dict[str, Any]]
# a stage-specific tool runner: (tool name, raw args) -> JSON payload for the model
Handler = Callable[[str, dict[str, Any]], dict[str, Any]]


# tools that exist only behind a flag (DELAY_MODEL for predict_delay)
OPTIONAL_TOOLS = {"predict_delay"}


class AllowlistViolation(Escalate):
    """A specialist (its model or its code path) called a tool outside its allowlist."""


class MultiAgentOrchestrator(Agent):
    TOOLS = {
        **Agent.TOOLS,
        "find_pos": "find_open_pos",
        "impact": "compute_risk",
        "simulate": "run_solver",
        "approval": "request_approval",
        "status": "check_status",
        "execute_stock_transfer": "create_stock_transfer",  # the chosen plan's transfer
    }
    AGENT_PREDICTS = True  # the Impact Agent calls predict_delay itself

    def __init__(self, runtime, llm, on_event=None):
        super().__init__(runtime, llm, on_event)
        needed = set().union(*(s.allowlist for s in SPECIALISTS)) - OPTIONAL_TOOLS
        if missing := needed - set(self.registry.names()):
            raise RuntimeError(
                f"ORCHESTRATION=multi needs a runtime built with the v2 tools; missing {missing}"
            )
        self._pending: dict[str, Escalate] = {}
        self._notes: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
        self._planner_messages: dict[str, list[dict[str, Any]]] = {}

    # ================================================================ attribution

    def _agent_for(self, stage: str) -> str | None:
        spec = BY_STAGE.get(stage)
        return spec.name if spec else ORCHESTRATOR

    def _escalate(self, case_id: str, reason: str) -> None:
        case = self.store.get_case(case_id)
        self.store.update_case(case_id, status="ESCALATED", escalation_reason=reason)
        self.rt.audit.append(case_id, "case", {"event": "escalated", "reason": reason})
        self._event(
            case_id,
            case.stage or "CASE",
            "escalated",
            "Escalated to a human planner",
            reason,
            agent=ORCHESTRATOR,
        )

    def _tool(self, case_id: str, stage: str, name: str, args: dict[str, Any]):
        spec = BY_STAGE.get(stage)
        if spec is None or name not in spec.allowlist:
            self._violation(case_id, stage, spec, name, args)
        return super()._tool(case_id, stage, name, args)

    def _violation(
        self,
        case_id: str,
        stage: str,
        spec: Specialist | None,
        tool: str,
        args: dict[str, Any] | None = None,
    ) -> None:
        who = spec.name if spec else ORCHESTRATOR
        allowlist = sorted(spec.allowlist) if spec else []
        self.rt.audit.append(
            case_id,
            "allowlist_violation",
            {"agent": who, "stage": stage, "tool": tool, "args": args, "allowlist": allowlist},
        )
        self._event(
            case_id,
            stage,
            "denied",
            f"{who} may not call {tool}",
            f"not on its allowlist ({', '.join(allowlist) or 'none'})",
            {"tool": tool, "allowlist": allowlist, "status": "allowlist_violation"},
        )
        raise AllowlistViolation(f"{who} tried to call {tool}, which is not on its allowlist")

    def _stage_notes(self, case_id: str, stage: str) -> dict[str, Any]:
        return self._notes[case_id].pop(stage, {})

    # ================================================================ specialist runner

    def _run_specialist(
        self,
        case_id: str,
        stage: str,
        spec: Specialist,
        purpose: str,
        user: str,
        tools: list[str],
        *,
        handler: Handler | None = None,
        output: Output | None = None,
        output_guard: Callable[[], str | None] | None = None,
        messages: list[dict[str, Any]] | None = None,
        max_tokens: int = 4096,
    ) -> tuple[BaseModel | None, list[dict[str, Any]], str]:
        """Run one specialist's Strands agent loop for a stage.

        Returns (validated output or None, the conversation, the agent's last text).
        """
        prompt, version = load_prompt(f"{spec.key}_agent")
        answer: dict[str, BaseModel] = {}
        run_tool = handler or (lambda name, args: self._payload(case_id, stage, name, args))

        def tool_fn(name: str):
            def fn(tool_use, **state):
                try:
                    payload = run_tool(name, tool_use["input"])
                except Escalate as e:  # budget / allowlist: stop the loop, raise afterwards
                    self._pending[case_id] = e
                    state["request_state"]["stop_event_loop"] = True
                    payload = {"error": str(e)}
                return _result(tool_use, payload)

            return PythonAgentTool(name, self.registry.get(name).spec()["toolSpec"], fn)

        strands_tools = [tool_fn(n) for n in tools]
        if output:
            out_name, out_model, out_spec = output

            def answer_fn(tool_use, **state):
                if output_guard and (problem := output_guard()):
                    return _result(tool_use, {"error": problem}, ok=False)
                try:
                    answer["value"] = out_model.model_validate(tool_use["input"])
                except ValidationError as e:
                    return _result(tool_use, {"error": e.errors(include_url=False)}, ok=False)
                state["request_state"]["stop_event_loop"] = True
                return _result(tool_use, {"accepted": True})

            strands_tools.append(PythonAgentTool(out_name, out_spec["toolSpec"], answer_fn))

        model = OrchestratedModel(
            lambda req: self._llm(case_id, stage, req, version),
            purpose,
            permitted=set(spec.allowlist) | ({output[0]} if output else set()),
            max_tokens=max_tokens,
        )
        agent = StrandsAgent(
            model=model,
            tools=strands_tools,
            system_prompt=prompt,
            messages=list(messages or []),
            name=spec.name,
            callback_handler=None,
            tool_executor=SequentialToolExecutor(),  # tool calls in order, like v1
            retry_strategy=None,  # the provider retries (and reports it); Strands must not
        )

        def invoke(prompt_text: str, turns: int) -> None:
            try:
                agent(prompt_text, limits={"turns": turns})
            except ToolNotAllowed as e:
                self._violation(case_id, stage, spec, e.tool)
            if pending := self._pending.pop(case_id, None):
                raise pending

        invoke(user, MAX_LLM_TURNS)
        if output and "value" not in answer:
            invoke(f"Respond by calling the `{output[0]}` tool.", 2)
            if "value" not in answer:
                raise Escalate(f"{stage}: {spec.name} did not produce a valid `{output[0]}` call")
        return answer.get("value"), agent.messages, _last_text(agent.messages)

    def _call(
        self, case_id: str, stage: str, name: str, args: dict[str, Any]
    ) -> tuple[bool, dict[str, Any]]:
        """(ok, the JSON the model sees) for one tool call through the registry."""
        r = self._tool(case_id, stage, name, args)
        if r.status == "ok":
            return True, r.output or {}
        return False, {
            "status": r.status,
            "error": r.error,
            "denial": r.denial and r.denial.model_dump(),
        }

    def _payload(self, case_id: str, stage: str, name: str, args: dict[str, Any]) -> dict:
        return self._call(case_id, stage, name, args)[1]

    # ================================================================ PERCEIVE

    def _perceive_model(self, case_id: str, case: CaseRecord) -> Disruption:
        blocks = []
        for i, s in enumerate(case.signals, start=1):
            if s["type"] == "pdf":
                blocks.append(
                    f"### Signal {i} (pdf: {s.get('filename') or 'attachment'})\n"
                    f"PDF attachment, not read yet. Read it with extract_pdf_text (signal {i})."
                )
            else:
                label = s["type"] + (f": {s['filename']}" if s.get("filename") else "")
                blocks.append(f"### Signal {i} ({label})\n{s['text']}")
        raw, _, _ = self._run_specialist(
            case_id,
            "PERCEIVE",
            SIGNAL,
            "signal",
            "\n\n".join(blocks),
            ["extract_pdf_text"],
            output=("report_disruption", GlossedDisruption, REPORT_DISRUPTION_GLOSSED),
            max_tokens=2048,
        )
        assert isinstance(raw, Disruption)
        return raw

    # ================================================================ ASSESS

    def _assess_model(
        self, case_id: str, d: PerceivedDisruption, found: dict[str, Any]
    ) -> dict[str, Any]:
        impact: dict[str, Any] = {}
        _, _, note = self._run_specialist(
            case_id,
            "ASSESS",
            IMPACT,
            "impact",
            f"Disruption:\n{json.dumps(d.for_llm(), indent=2)}",
            sorted(t for t in IMPACT.allowlist if t in self.registry.tools),
            handler=lambda name, args: self._assess_tool(case_id, d, found, impact, name, args),
        )
        if note:
            self._notes[case_id]["ASSESS"] = {"impact_note": note}
        return impact

    # ================================================================ PLAN + SIMULATE

    def _plan_model(self, case_id: str, context: dict[str, Any]) -> CandidatePlan:
        plan, messages, _ = self._run_specialist(
            case_id,
            "PLAN",
            PLANNER,
            "planner.plan",
            json.dumps(context, indent=2, default=str),
            ["search_precedents"],
            output=("propose_candidates", CandidatePlan, PROPOSE_CANDIDATES),
        )
        self._planner_messages[case_id] = messages
        assert isinstance(plan, CandidatePlan)
        return plan

    def _solve(self, case_id: str, candidates: list[dict[str, Any]]) -> list[SolveResult]:
        """The Planner Agent runs the solver on its own candidates; code fills any gap."""
        solved: dict[frozenset[str], dict[str, Any]] = {}

        def run(name: str, args: dict[str, Any]) -> dict[str, Any]:
            ok, payload = self._call(case_id, "SIMULATE", name, args)
            if ok:
                solved.setdefault(frozenset(args["strategies"]), payload)
            return payload

        listing = "\n".join(f"- {c['option_id']}: {', '.join(c['strategies'])}" for c in candidates)
        self._run_specialist(
            case_id,
            "SIMULATE",
            PLANNER,
            "planner.simulate",
            "Simulate each candidate you proposed: call run_solver once per candidate, with "
            f"exactly its strategies.\n{listing}",
            ["run_solver"],
            handler=run,
            messages=self._planner_messages.pop(case_id, None),
        )
        out = []
        for c in candidates:
            key = frozenset(c["strategies"])
            if key not in solved:
                self._event(
                    case_id,
                    "SIMULATE",
                    "info",
                    f"{PLANNER.name} did not simulate {c['option_id']}; the orchestrator runs it",
                    agent=ORCHESTRATOR,
                )
                r = self._tool(case_id, "SIMULATE", "run_solver", {"strategies": c["strategies"]})
                if r.status != "ok":
                    raise Escalate(f"solver failed for option {c['option_id']}: {r.error}")
                solved[key] = r.output or {}
            out.append(SolveResult.model_validate(solved[key]))
        return out

    # ================================================================ REFLECT

    def _review_options(
        self, case_id: str, rnd: int, options: list[dict[str, Any]]
    ) -> tuple[dict[str, critic.OptionReview], dict[str, str]]:
        checked: dict[str, Any] = {}

        def run(name: str, args: dict[str, Any]) -> dict[str, Any]:
            ok, payload = self._call(case_id, "REFLECT", name, args)
            if ok and payload["round"] == rnd:
                checked["reviews"] = payload["reviews"]
            return payload

        listing = [
            {
                "option_id": o["option_id"],
                "label": o["label"],
                "strategies": o["strategies"],
                "status": o["result"]["status"],
                "total_cost_display": o["total_cost_display"],
            }
            for o in options
        ]
        notes, _, _ = self._run_specialist(
            case_id,
            "REFLECT",
            CRITIC,
            "critic.review",
            json.dumps({"round": rnd, "options": listing}, indent=2),
            ["check_business_rules"],
            handler=run,
            output=("report_review", CriticNotes, REPORT_REVIEW),
            output_guard=lambda: (
                None if "reviews" in checked else f"call check_business_rules for round {rnd} first"
            ),
        )
        assert isinstance(notes, CriticNotes)
        if "reviews" not in checked:  # unreachable through the guard; kept for safety
            r = self._tool(case_id, "REFLECT", "check_business_rules", {"round": rnd})
            if r.status != "ok":
                raise Escalate(f"business-rule check failed: {r.error}")
            checked["reviews"] = (r.output or {})["reviews"]
        reviews = {
            rv["option_id"]: critic.OptionReview.model_validate(rv) for rv in checked["reviews"]
        }
        return reviews, {
            n.option_id: n.explanation for n in notes.explanations if n.option_id in reviews
        }

    def _explain_model(self, case_id: str, data: dict[str, Any]) -> Explanation:
        explanation, _, _ = self._run_specialist(
            case_id,
            "REFLECT",
            CRITIC,
            "critic.explain",
            json.dumps(data, indent=2, default=str),
            [],
            output=("write_explanation", Explanation, WRITE_EXPLANATION),
        )
        assert isinstance(explanation, Explanation)
        return explanation

    # ================================================================ ACT

    def _card(self, case, chosen, a, record, risk, day0) -> dict[str, Any]:
        card = super()._card(case, chosen, a, record, risk, day0)
        facts = {
            k: card.get(k)
            for k in (
                "what",
                "why",
                "cost_display",
                "plan_total_display",
                "tier_reasons",
                "approve_by_display",
                "eta_display",
                "alternatives",
                "if_rejected",
            )
        }
        summary, _, _ = self._run_specialist(
            case.case_id,
            "ACT",
            EXECUTOR,
            "executor.summary",
            json.dumps(facts, indent=2, default=str),
            [],
            output=("write_approval_summary", ApprovalSummary, WRITE_APPROVAL_SUMMARY),
            max_tokens=1024,
        )
        assert isinstance(summary, ApprovalSummary)
        return {**card, "summary": summary.summary, "summary_by": EXECUTOR.name}


def _result(tool_use: dict[str, Any], payload: dict[str, Any], ok: bool = True) -> dict[str, Any]:
    return {
        "toolUseId": tool_use["toolUseId"],
        "status": "success" if ok else "error",
        "content": [{"json": json.loads(json.dumps(payload, default=str))}],
    }


def _last_text(messages: list[dict[str, Any]]) -> str:
    for m in reversed(messages):
        if m["role"] == "assistant":
            text = "".join(b.get("text", "") for b in m["content"]).strip()
            if text:
                return text
    return ""
