"""SIAGA agent state machine.

    PERCEIVE (LLM) -> ASSESS (LLM picks read tools) -> PLAN (LLM) -> SIMULATE (solver)
    -> REFLECT (Critic rules + LLM explanation) -> [replan: PLAN ...] -> ACT -> VERIFY

Code enforces the loop: stage order (TRANSITIONS), the tool-call budget (ToolRegistry),
the replan cap, and every escalation. The LLM interprets text, chooses strategies and
explains; every number comes from SAP, the risk function or the solver.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from pydantic import BaseModel, ValidationError

from agent import critic
from agent.actions import describe, tool_call_for
from agent.case_store import CaseEvent, CaseRecord
from agent.evidence import grade_confidence, locate_evidence
from agent.prompts import load_prompt
from agent.providers.base import (
    LLMError,
    LLMProvider,
    LLMRequest,
    LLMResponse,
    tool_result,
    user_text,
)
from agent.runtime import Runtime
from agent.schemas import (
    PROPOSE_CANDIDATES,
    REPORT_DISRUPTION,
    WRITE_EXPLANATION,
    CandidatePlan,
    Disruption,
    Explanation,
    PerceivedDisruption,
)
from agent.tools.base import ToolCallResult, ToolContext
from services.solver.models import (
    CompareRequest,
    PlannedAction,
    RiskResult,
    SolveResult,
    TimingCheckRequest,
)
from siaga_common.money import format_idr
from siaga_common.timeline import display, from_iso, to_iso

log = logging.getLogger(__name__)

STAGES = ["PERCEIVE", "ASSESS", "PLAN", "SIMULATE", "REFLECT", "ACT", "VERIFY"]
TRANSITIONS: dict[str | None, set[str]] = {
    None: {"PERCEIVE"},
    "PERCEIVE": {"ASSESS"},
    "ASSESS": {"PLAN"},
    "PLAN": {"SIMULATE"},
    "SIMULATE": {"REFLECT"},
    "REFLECT": {"PLAN", "ACT"},  # PLAN = replan after a Critic rejection
    "ACT": {"PLAN", "VERIFY"},  # PLAN = replan after a rejected / late approval
    "VERIFY": {"PLAN"},  # re-open (Phase 6)
}
MAX_LLM_TURNS = 5


class Escalate(Exception):
    """Hand the whole case to a human, with a clear reason."""


class CaseStateError(ValueError):
    """The request does not fit the case's current state (e.g. approve when not waiting)."""


class Agent:
    def __init__(
        self,
        runtime: Runtime,
        llm: LLMProvider,
        on_event: Callable[[CaseEvent], None] | None = None,
    ):
        self.rt = runtime
        self.llm = llm
        self.on_event = on_event or (lambda e: None)
        self.store = runtime.store
        self.registry = runtime.registry
        self._stage_clock: dict[str, tuple[str, float]] = {}

    # ================================================================ public API

    def start_case(self, signals: list[dict[str, Any]], day0: str | None = None) -> CaseRecord:
        case = self.store.create_case(signals=signals, day0=day0 or self._sap_day0())
        self.rt.audit.append(case.case_id, "case", {"event": "created", "signals": signals})
        self._event(case.case_id, "CASE", "info", "Case opened", f"{len(signals)} signal(s)")
        return case

    def run(self, case_id: str) -> CaseRecord:
        """PERCEIVE -> ... -> ACT. Stops when waiting for approval or terminal."""
        return self._guarded(case_id, self._run_from_perceive)

    def decide(
        self, case_id: str, approval_id: str, approve: bool, by: str, reason: str | None = None
    ) -> CaseRecord:
        case = self.store.get_case(case_id)
        if case.status != "AWAITING_APPROVAL":
            raise CaseStateError(f"case {case_id} is {case.status}, not awaiting approval")
        if not any(a.get("approval_id") == approval_id for a in case.actions):
            raise CaseStateError(f"approval {approval_id} does not belong to case {case_id}")
        return self._guarded(case_id, lambda c: self._decide(c, approval_id, approve, by, reason))

    def verify(self, case_id: str) -> CaseRecord:
        case = self.store.get_case(case_id)
        if case.status != "VERIFYING":
            raise CaseStateError(f"case {case_id} is {case.status}, not verifying")
        return self._guarded(case_id, self._verify)

    def due_verifications(self, case_ids: list[str]) -> list[str]:
        now = self.rt.clock()
        due = []
        for cid in case_ids:
            c = self.store.get_case(cid)
            if c.status == "VERIFYING" and c.verify_due_at and from_iso(c.verify_due_at) <= now:
                due.append(cid)
        return due

    # ================================================================ plumbing

    def _guarded(self, case_id: str, fn: Callable[[str], None]) -> CaseRecord:
        try:
            fn(case_id)
        except Escalate as e:
            self._escalate(case_id, str(e))
        except LLMError as e:
            self._escalate(case_id, f"LLM unavailable: {e}")
        except Exception as e:  # noqa: BLE001 - never leave a case stuck in RUNNING
            log.exception("case %s failed", case_id)
            self._escalate(case_id, f"internal error: {type(e).__name__}: {e}")
        return self.store.get_case(case_id)

    def _escalate(self, case_id: str, reason: str) -> None:
        case = self.store.get_case(case_id)
        self.store.update_case(case_id, status="ESCALATED", escalation_reason=reason)
        self.rt.audit.append(case_id, "case", {"event": "escalated", "reason": reason})
        self._event(
            case_id, case.stage or "CASE", "escalated", "Escalated to a human planner", reason
        )

    def _sap_day0(self) -> str | None:
        day0 = getattr(self.rt.sap, "day0", None)  # mock SAP only; display anchor
        try:
            return day0() if day0 else None
        except Exception:  # noqa: BLE001 - day0 is display-only
            return None

    def _ctx(self, case_id: str) -> ToolContext:
        return self.rt.context(case_id)

    def _event(
        self,
        case_id: str,
        stage: str,
        status: str,
        title: str,
        detail: str = "",
        data: dict[str, Any] | None = None,
    ) -> CaseEvent:
        e = self.store.append_event(case_id, stage, status, title, detail, data)  # type: ignore[arg-type]
        self.on_event(e)
        return e

    def _enter(self, case_id: str, stage: str) -> None:
        case = self.store.get_case(case_id)
        if stage not in TRANSITIONS[case.stage]:
            raise RuntimeError(f"illegal transition {case.stage} -> {stage}")
        key = stage if stage not in case.stage_timestamps else f"{stage}#{case.plan_round}"
        stamps = {**case.stage_timestamps, key: {"started": to_iso(self.rt.clock())}}
        self.store.update_case(case_id, stage=stage, status="RUNNING", stage_timestamps=stamps)
        self.rt.audit.append(case_id, "stage_transition", {"from": case.stage, "to": stage})
        self._event(case_id, stage, "started", f"{stage.title()} started")
        self._stage_clock[case_id] = (key, time.perf_counter())

    def _leave(self, case_id: str, stage: str, title: str, detail: str = "", data=None) -> None:
        case = self.store.get_case(case_id)
        key, t0 = self._stage_clock[case_id]
        stamp = {**case.stage_timestamps.get(key, {}), "ended": to_iso(self.rt.clock())}
        elapsed = round(time.perf_counter() - t0, 3)
        stamp["elapsed_s"] = str(elapsed)
        self.store.update_case(case_id, stage_timestamps={**case.stage_timestamps, key: stamp})
        self._event(
            case_id, stage, "completed", title, detail, {**(data or {}), "elapsed_s": elapsed}
        )

    def _tool(self, case_id: str, stage: str, name: str, args: dict[str, Any]) -> ToolCallResult:
        r = self.registry.invoke(self._ctx(case_id), name, args)
        title = f"{name} -> {r.status}" + (f" (Tier {r.tier})" if r.tier is not None else "")
        detail = r.denial.message if r.denial else (r.error or "")
        self._event(
            case_id,
            stage,
            "tool",
            title,
            detail,
            {"tool": name, "args": args, **r.model_dump(exclude={"tool"})},
        )
        if r.status == "budget_exceeded":
            raise Escalate(r.error or "tool-call budget exhausted")
        return r

    def _llm(self, case_id: str, stage: str, req: LLMRequest, prompt_version: str) -> LLMResponse:
        t0 = time.perf_counter()

        def on_retry(attempt: int, max_attempts: int, wait_s: float, reason: str) -> None:
            info = {"attempt": attempt, "max_attempts": max_attempts, "wait_s": wait_s}
            self.rt.audit.append(
                case_id,
                "llm_retry",
                {"stage": stage, "purpose": req.purpose, "reason": reason} | info,
            )
            self._event(
                case_id,
                stage,
                "retry",
                f"Retrying the model call ({reason})",
                f"attempt {attempt} of {max_attempts} in {wait_s:.0f} s",
                {"reason": reason, **info},
            )

        resp = self.llm.converse(req.model_copy(update={"case_id": case_id}), on_retry)
        case = self.store.get_case(case_id)
        self.store.update_case(case_id, llm_call_count=case.llm_call_count + 1)
        wall = round(time.perf_counter() - t0, 3)
        self.rt.audit.append(
            case_id,
            "llm_call",
            {
                "stage": stage,
                "purpose": req.purpose,
                "prompt": prompt_version,
                "provider": self.llm.name,
                "model": resp.model,
                "stop_reason": resp.stop_reason,
                "usage": resp.usage,
                "latency_s": wall,
                "output": resp.message,
            },
        )
        self._event(
            case_id,
            stage,
            "llm",
            f"LLM {req.purpose} ({wall:.1f} s)",
            data={"prompt": prompt_version, "model": resp.model, "usage": resp.usage},
        )
        return resp

    def _structured(
        self,
        case_id: str,
        stage: str,
        req: LLMRequest,
        prompt_version: str,
        tool_name: str,
        model: type[BaseModel],
        on_other_tool: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> BaseModel:
        """Loop until the model calls `tool_name` with valid input (bounded)."""
        messages = list(req.messages)
        nudged = False
        for _ in range(MAX_LLM_TURNS):
            resp = self._llm(
                case_id, stage, req.model_copy(update={"messages": messages}), prompt_version
            )
            messages.append(resp.message)
            uses = resp.tool_uses()
            results = []
            for u in uses:
                if u["name"] == tool_name:
                    try:
                        return model.model_validate(u["input"])
                    except ValidationError as e:
                        results.append(
                            tool_result(
                                u["toolUseId"], {"error": e.errors(include_url=False)}, ok=False
                            )
                        )
                elif on_other_tool is not None:
                    results.append(tool_result(u["toolUseId"], on_other_tool(u)))
                else:
                    results.append(
                        tool_result(
                            u["toolUseId"], {"error": f"tool {u['name']} not available"}, ok=False
                        )
                    )
            if results:
                messages.append(
                    {"role": "user", "content": json.loads(json.dumps(results, default=str))}
                )
            elif not nudged:
                nudged = True
                messages.append(user_text(f"Respond by calling the `{tool_name}` tool."))
            else:
                break
        raise Escalate(f"{stage}: the model did not produce a valid `{tool_name}` call")

    # ================================================================ stages

    def _run_from_perceive(self, case_id: str) -> None:
        if not self._perceive(case_id):
            return
        if not self._assess(case_id):
            return
        self._plan_to_act(case_id)

    def _plan_to_act(self, case_id: str) -> None:
        while True:
            self._plan(case_id)
            self._simulate(case_id)
            if self._reflect(case_id) == "act":
                break
        self._act(case_id)

    # ---------------------------------------------------------------- PERCEIVE

    def _perceive(self, case_id: str) -> bool:
        self._enter(case_id, "PERCEIVE")
        case = self.store.get_case(case_id)
        blocks = []
        for i, s in enumerate(case.signals, start=1):
            label = s["type"] + (f": {s['filename']}" if s.get("filename") else "")
            blocks.append(f"### Signal {i} ({label})\n{s['text']}")
        prompt, version = load_prompt("perceive")
        req = LLMRequest(
            purpose="perceive",
            system=prompt,
            messages=[user_text("\n\n".join(blocks))],
            tools=[REPORT_DISRUPTION],
            max_tokens=2048,
        )
        raw: Disruption = self._structured(
            case_id, "PERCEIVE", req, version, "report_disruption", Disruption
        )
        d = self._ground_evidence(case_id, raw, case.signals)
        self.store.update_case(case_id, disruption=d.model_dump(mode="json"))
        if not d.is_disruption:
            self._leave(
                case_id,
                "PERCEIVE",
                "No disruption in the signals",
                data={"disruption": d.model_dump(mode="json")},
            )
            self.store.update_case(case_id, status="RESOLVED")
            self._event(case_id, "CASE", "resolved", "Closed: no disruption")
            return False
        detail = (
            f"{d.cause} on {d.lane or 'unknown lane'} at {d.location}; delay "
            f"{d.delay_hours_min}-{d.delay_hours_max} h; refs {d.references or '-'}; "
            f"confidence {d.confidence}"
        )
        self._leave(
            case_id,
            "PERCEIVE",
            "Disruption identified",
            detail,
            {"disruption": d.model_dump(mode="json")},
        )
        if d.delay_hours_min is None or d.delay_hours_max is None:
            raise Escalate("disruption has no delay estimate; a human must assess it")
        if d.lane is None and not d.references:
            raise Escalate("disruption cannot be mapped to a lane or a document")
        return True

    def _ground_evidence(
        self, case_id: str, raw: Disruption, signals: list[dict[str, Any]]
    ) -> PerceivedDisruption:
        """Locate every quote in its signal (code, not the model); grade confidence."""
        located, dropped = locate_evidence(raw.evidence, signals)
        label, basis = grade_confidence(located)
        if dropped:
            log.warning("case %s: dropped evidence not found in signals: %s", case_id, dropped)
            self.rt.audit.append(case_id, "evidence_dropped", {"dropped": dropped})
            self._event(
                case_id,
                "PERCEIVE",
                "info",
                f"Dropped {len(dropped)} evidence quote(s) not found in the signals",
                "; ".join(f"\u201c{x['quote']}\u201d ({x['reason']})" for x in dropped),
                {"dropped": dropped},
            )
        return PerceivedDisruption(
            **raw.model_dump(exclude={"evidence", "model_confidence"}),
            evidence=located,
            evidence_quotes=[e.quote for e in located],
            confidence=label,
            confidence_basis=basis,
        )

    # ---------------------------------------------------------------- ASSESS

    def _assess(self, case_id: str) -> bool:
        self._enter(case_id, "ASSESS")
        d = PerceivedDisruption.model_validate(self.store.get_case(case_id).disruption)
        prompt, version = load_prompt("assess")
        allowed = {"find_inbound_purchase_orders", "assess_impact"}
        tools = [s for s in self.registry.specs() if s["toolSpec"]["name"] in allowed]
        found: dict[str, Any] = {"purchase_orders": []}
        impact: dict[str, Any] = {}

        def run_tool(u: dict[str, Any]) -> dict[str, Any]:
            name, args = u["name"], u["input"]
            if name == "assess_impact" and (
                args.get("delay_hours_min") != d.delay_hours_min
                or args.get("delay_hours_max") != d.delay_hours_max
            ):
                return {
                    "error": "delay must equal the reported disruption delay "
                    f"({d.delay_hours_min}-{d.delay_hours_max} h)"
                }
            r = self._tool(case_id, "ASSESS", name, args)
            if r.status != "ok":
                return {
                    "status": r.status,
                    "error": r.error,
                    "denial": r.denial and r.denial.model_dump(),
                }
            if name == "find_inbound_purchase_orders":
                found["purchase_orders"] = r.output["purchase_orders"]
            else:
                impact.update(args=args, output=r.output)
            return r.output

        messages = [user_text(f"Disruption:\n{json.dumps(d.for_llm(), indent=2)}")]
        for _ in range(MAX_LLM_TURNS):
            resp = self._llm(
                case_id,
                "ASSESS",
                LLMRequest(purpose="assess", system=prompt, messages=messages, tools=tools),
                version,
            )
            messages.append(resp.message)
            uses = resp.tool_uses()
            if not uses:
                break
            results = [
                tool_result(u["toolUseId"], run_tool(u))
                if u["name"] in allowed
                else tool_result(u["toolUseId"], {"error": "tool not available"}, ok=False)
                for u in uses
            ]
            messages.append(
                {"role": "user", "content": json.loads(json.dumps(results, default=str))}
            )

        if not impact:
            self._event(
                case_id,
                "ASSESS",
                "info",
                "Model did not finish the assessment; deterministic fallback",
            )
            impact = self._assess_fallback(case_id, d, found)

        out, args = impact["output"], impact["args"]
        risk = RiskResult.model_validate(out["risk"])
        affected = {
            "material": args["material"],
            "plant": args["plant"],
            "affected_references": args["affected_references"],
            "purchase_orders": found["purchase_orders"],
            "sales_orders": out["sales_orders"],
            "stock": out["stock"],
            "labels": out.get("labels", {}),
        }
        self.store.update_case(case_id, affected=affected, risk=risk.model_dump(mode="json"))
        day0 = self._day0(case_id)
        detail = (
            f"shortfall {risk.shortfall} cartons of {args['material']} at {args['plant']} by "
            f"{display(day0, risk.deadline) if risk.deadline else '-'}; exposure "
            f"{format_idr(risk.max_exposure)} (expected {format_idr(risk.expected_exposure)})"
        )
        self._leave(
            case_id,
            "ASSESS",
            "Impact assessed",
            detail,
            {"risk": risk.model_dump(mode="json"), "affected": affected},
        )
        if risk.shortfall == 0:
            self.store.update_case(case_id, status="RESOLVED")
            self._event(case_id, "CASE", "resolved", "No shortfall: monitoring only")
            return False
        return True

    def _assess_fallback(
        self, case_id: str, d: PerceivedDisruption, found: dict[str, Any]
    ) -> dict[str, Any]:
        if not found["purchase_orders"]:
            r = self._tool(
                case_id,
                "ASSESS",
                "find_inbound_purchase_orders",
                {"lane": d.lane, "references": d.references},
            )
            if r.status != "ok":
                raise Escalate(f"could not find affected purchase orders: {r.error}")
            found["purchase_orders"] = r.output["purchase_orders"]
        pos = found["purchase_orders"]
        if not pos:
            raise Escalate("no open purchase orders on the affected lane")
        item = pos[0]["items"][0]
        refs = [
            p["PurchaseOrder"]
            for p in pos
            if any(i["Material"] == item["Material"] for i in p["items"])
        ]
        args = {
            "material": item["Material"],
            "plant": item["Plant"],
            "affected_references": refs,
            "delay_hours_min": d.delay_hours_min,
            "delay_hours_max": d.delay_hours_max,
        }
        r = self._tool(case_id, "ASSESS", "assess_impact", args)
        if r.status != "ok":
            raise Escalate(f"impact assessment failed: {r.error}")
        return {"args": args, "output": r.output}

    # ---------------------------------------------------------------- PLAN

    def _plan(self, case_id: str) -> None:
        case = self.store.get_case(case_id)
        rnd = case.plan_round + 1
        self.store.update_case(case_id, plan_round=rnd)
        self._enter(case_id, "PLAN")
        case = self.store.get_case(case_id)
        risk = RiskResult.model_validate(case.risk)
        day0 = self._day0(case_id)
        context: dict[str, Any] = {
            "round": rnd,
            "disruption": PerceivedDisruption.model_validate(case.disruption).for_llm(),
            "material": case.affected["material"],
            "plant": case.affected["plant"],
            "shortfall_cartons": risk.shortfall,
            "deadline": display(day0, risk.deadline) if risk.deadline else None,
            "max_exposure_display": format_idr(risk.max_exposure),
        }
        if rnd > 1:
            context["replan"] = {
                "active_solver_constraints": case.constraints,
                "ruled_out_strategies": case.ruled_out_strategies,
                "critic_findings_last_round": [
                    f for f in case.critic_findings if f["round"] == rnd - 1
                ],
                "planner_rejections": case.rejection_reasons,
                "already_executed": [a for a in case.actions if a["status"] == "EXECUTED"],
            }
        prompt, version = load_prompt("plan")
        tools = [s for s in self.registry.specs() if s["toolSpec"]["name"] == "search_precedents"]
        req = LLMRequest(
            purpose="plan",
            system=prompt,
            messages=[user_text(json.dumps(context, indent=2, default=str))],
            tools=[*tools, PROPOSE_CANDIDATES],
        )

        def search(u: dict[str, Any]) -> dict[str, Any]:
            if u["name"] != "search_precedents":
                return {"error": "tool not available"}
            r = self._tool(case_id, "PLAN", "search_precedents", u["input"])
            return r.output if r.status == "ok" else {"error": r.error}

        plan: CandidatePlan = self._structured(
            case_id, "PLAN", req, version, "propose_candidates", CandidatePlan, search
        )
        candidates = []
        for c in plan.candidates:
            strategies = [s for s in c.strategies if s not in case.ruled_out_strategies]
            if strategies and strategies not in [x["strategies"] for x in candidates]:
                candidates.append({**c.model_dump(), "strategies": strategies, "round": rnd})
        if not candidates:
            raise Escalate("no candidate strategy remains after the planner's rejections")
        for i, c in enumerate(candidates):
            c["option_id"] = f"{chr(ord('A') + i)}{rnd}"
        self.store.update_case(case_id, candidates=[*case.candidates, *candidates])
        self._leave(
            case_id,
            "PLAN",
            f"{len(candidates)} candidate(s) proposed",
            "; ".join(
                f"{c['option_id']} {c['label']}: {'+'.join(c['strategies'])}" for c in candidates
            ),
            {
                "candidates": candidates,
                "precedent_ids": plan.precedent_ids,
                "precedents": self._cited_precedents(case_id, plan.precedent_ids),
            },
        )

    def _cited_precedents(self, case_id: str, ids: list[str]) -> list[dict[str, Any]]:
        """Precedents the model cited that a search in this case actually returned."""
        hits: dict[str, dict[str, Any]] = {}
        for e in self.store.list_events(case_id):
            if e.data.get("tool") == "search_precedents" and e.data.get("status") == "ok":
                for h in e.data["output"]["hits"]:
                    hits.setdefault(h["id"], h)
        keys = ("id", "title", "period", "synthetic")
        return [{k: hits[i].get(k) for k in keys} for i in ids if i in hits]

    # ---------------------------------------------------------------- SIMULATE

    def _simulate(self, case_id: str) -> None:
        self._enter(case_id, "SIMULATE")
        case = self.store.get_case(case_id)
        rnd = case.plan_round
        results = []
        for c in [c for c in case.candidates if c["round"] == rnd]:
            r = self._tool(
                case_id,
                "SIMULATE",
                "simulate_option",
                {"strategies": c["strategies"], "constraints": case.constraints},
            )
            if r.status != "ok":
                raise Escalate(f"solver failed for option {c['option_id']}: {r.error}")
            res = SolveResult.model_validate(r.output)
            results.append(
                {
                    "option_id": c["option_id"],
                    "round": rnd,
                    "label": c["label"],
                    "strategies": c["strategies"],
                    "constraints": case.constraints,
                    "result": res.model_dump(mode="json"),
                    "total_cost_display": format_idr(res.total_cost),
                }
            )
        self.store.update_case(case_id, solver_results=[*case.solver_results, *results])
        self._leave(
            case_id,
            "SIMULATE",
            f"{len(results)} option(s) solved",
            "; ".join(
                f"{r['option_id']} {r['result']['status']} {r['total_cost_display']}"
                for r in results
            ),
            {"options": results},
        )

    # ---------------------------------------------------------------- REFLECT

    def _reflect(self, case_id: str) -> str:
        self._enter(case_id, "REFLECT")
        case = self.store.get_case(case_id)
        rnd = case.plan_round
        risk = RiskResult.model_validate(case.risk)
        material, plant = case.affected["material"], case.affected["plant"]
        suppliers = {s["Supplier"]: s for s in self.rt.sap.query("A_Supplier")}
        ctx = self._ctx(case_id)

        options = [o for o in case.solver_results if o["round"] == rnd]
        reviews: dict[str, critic.OptionReview] = {}
        findings = []
        for o in options:
            rv = critic.review(
                o["option_id"],
                SolveResult.model_validate(o["result"]),
                risk,
                material=material,
                plant=plant,
                suppliers=suppliers,
                registry=self.registry,
                ctx=ctx,
                plant_names=(case.affected.get("labels") or {}).get("plants"),
            )
            reviews[o["option_id"]] = rv
            findings.append(
                {
                    "option_id": o["option_id"],
                    "round": rnd,
                    "clean": rv.clean,
                    "checks": [c.model_dump() for c in rv.checks],
                    "tiers": [t.model_dump() for t in rv.tiers],
                }
            )
            self._event(
                case_id,
                "REFLECT",
                "check" if rv.clean else "rejected",
                f"Critic: option {o['option_id']} "
                + (
                    "passes all rules"
                    if rv.clean
                    else "violates " + ", ".join(v.rule for v in rv.violations)
                ),
                "; ".join(c.plain or c.detail for c in rv.violations) or "",
                findings[-1],
            )
        self.store.update_case(case_id, critic_findings=[*case.critic_findings, *findings])

        feasible = [o for o in options if reviews[o["option_id"]].checks[0].passed]
        if not feasible:
            raise Escalate(
                "no feasible option: "
                + "; ".join(
                    f"{o['option_id']}: {reviews[o['option_id']].checks[0].detail}" for o in options
                )
            )
        cheapest = min(feasible, key=lambda o: (o["result"]["total_cost"], o["option_id"]))
        rv = reviews[cheapest["option_id"]]
        if not rv.clean:
            new = [
                v.constraint
                for v in rv.violations
                if v.constraint and v.constraint not in case.constraints
            ]
            if not new:
                raise Escalate(
                    f"cheapest option {cheapest['option_id']} violates rules that no solver "
                    "constraint can fix"
                )
            if case.replan_count >= self.rt.settings.max_replans:
                raise Escalate(f"still violating business rules after {case.replan_count} replans")
            self.store.update_case(
                case_id, replan_count=case.replan_count + 1, constraints=[*case.constraints, *new]
            )
            self._leave(
                case_id,
                "REFLECT",
                f"Critic rejected option {cheapest['option_id']}; replanning",
                "; ".join(v.detail for v in rv.violations)
                + " -> add solver constraint(s): "
                + ", ".join(c["type"] for c in new),
                {"rejected": cheapest["option_id"], "new_constraints": new},
            )
            return "replan"

        chosen = cheapest
        compare = self._compare(case, chosen, options, risk)
        self.store.update_case(case_id, chosen_option=chosen["option_id"], summary=compare)
        explanation = self._explain(case_id, chosen, options, findings, risk, compare)
        self.store.update_case(case_id, explanation=explanation.model_dump())
        self._leave(
            case_id,
            "REFLECT",
            f"Selected option {chosen['option_id']} ({chosen['total_cost_display']})",
            explanation.summary,
            {
                "chosen": chosen["option_id"],
                "summary": compare,
                "explanation": explanation.model_dump(),
            },
        )
        return "act"

    def _compare(self, case: CaseRecord, chosen, options, risk: RiskResult) -> dict[str, Any]:
        clean = {
            f["option_id"] for f in self.store.get_case(case.case_id).critic_findings if f["clean"]
        }
        # Compare against a different plan (comparing air with an earlier air option says
        # nothing, e.g. after a rejected bridge PO).
        others = [
            o
            for o in case.solver_results
            if o["option_id"] != chosen["option_id"]
            and o["option_id"] in clean
            and o["strategies"] != chosen["strategies"]
        ]
        baseline = next(
            (o for o in reversed(others) if o["strategies"] == ["spot_air"]),
            max(others, key=lambda o: o["result"]["total_cost"], default=None),
        )
        out = {
            "chosen": chosen["option_id"],
            "chosen_cost": chosen["result"]["total_cost"],
            "chosen_cost_display": chosen["total_cost_display"],
            "max_exposure": risk.max_exposure,
            "max_exposure_display": format_idr(risk.max_exposure),
            "expected_exposure": risk.expected_exposure,
        }
        c = self.rt.solver.compare(
            CompareRequest(
                baseline=SolveResult.model_validate(baseline["result"]) if baseline else None,
                chosen=SolveResult.model_validate(chosen["result"]),
                max_exposure=risk.max_exposure,
            )
        )
        out |= {
            "exposure_avoided": c.exposure_avoided,
            "exposure_avoided_display": format_idr(c.exposure_avoided),
            "net_protected": c.net_protected,
            "net_protected_display": format_idr(c.net_protected),
        }
        if baseline:
            out |= {
                "baseline": baseline["option_id"],
                "baseline_cost_display": baseline["total_cost_display"],
                "saving_vs_baseline": c.saving_vs_baseline,
                "saving_display": format_idr(c.saving_vs_baseline or 0),
            }
        return out

    def _explain(self, case_id, chosen, options, findings, risk, compare) -> Explanation:
        prompt, version = load_prompt("reflect")
        data = {
            "selected_option": chosen["option_id"],
            "comparison": compare,
            "options": [
                {
                    "option_id": o["option_id"],
                    "label": o["label"],
                    "strategies": o["strategies"],
                    "status": o["result"]["status"],
                    "total_cost_display": o["total_cost_display"],
                    "actions": [
                        {**a, "cost_display": format_idr(a["cost"])} for a in o["result"]["actions"]
                    ],
                    "stock_after": o["result"]["stock_after"],
                }
                for o in options
            ],
            "critic": findings,
            "earlier_rounds_rejected": [
                f for f in self.store.get_case(case_id).critic_findings if not f["clean"]
            ],
        }
        req = LLMRequest(
            purpose="reflect",
            system=prompt,
            messages=[user_text(json.dumps(data, indent=2, default=str))],
            tools=[WRITE_EXPLANATION],
        )
        return self._structured(case_id, "REFLECT", req, version, "write_explanation", Explanation)

    # ---------------------------------------------------------------- ACT

    def _act(self, case_id: str) -> None:
        self._enter(case_id, "ACT")
        case = self.store.get_case(case_id)
        chosen = next(o for o in case.solver_results if o["option_id"] == case.chosen_option)
        result = SolveResult.model_validate(chosen["result"])
        material, plant = case.affected["material"], case.affected["plant"]
        risk = RiskResult.model_validate(case.risk)
        day0 = self._day0(case_id)
        actions = list(case.actions)
        for i, a in enumerate(result.actions):
            tool, args = tool_call_for(a, material, plant)
            t = self.registry.get(tool)
            tier = t.tier(t.Input.model_validate(args), self._ctx(case_id))
            record = {
                "action_id": f"{chosen['option_id']}-{i + 1}",
                "option_id": chosen["option_id"],
                "kind": a.kind,
                "description": describe(a, plant),
                "tool": tool,
                "args": args,
                "tier": tier.tier,
                "tier_reasons": tier.reasons,
                "quantity": a.quantity,
                "cost": a.cost,
                "cost_display": format_idr(a.cost),
                "eta": to_iso(a.eta) if a.eta else None,
                "planned": a.model_dump(mode="json"),
                "covers_shortfall": True,
                "status": "PLANNED",
            }
            if tier.tier <= 2:
                r = self._tool(case_id, "ACT", tool, args)
                if r.status != "ok":
                    raise Escalate(f"{tool} failed: {r.error or (r.denial and r.denial.message)}")
                record |= {"status": "EXECUTED", "sap_ref": _sap_ref(r.output), "sap": r.output}
                title = f"Auto-executed (Tier {tier.tier}): {record['description']}"
                detail = f"{record['cost_display']}; SAP {record['sap_ref']}"
                self._event(case_id, "ACT", "executed", title, detail, record)
            else:
                card = self._card(case, chosen, a, record, risk, day0)
                r = self._tool(
                    case_id,
                    "ACT",
                    "request_human_approval",
                    {"tool": tool, "args": args, "card": card},
                )
                if r.status != "ok":
                    raise Escalate(f"could not raise approval for {tool}: {r.error}")
                record |= {
                    "status": "PENDING_APPROVAL",
                    "approval_id": r.output["approval_id"],
                    "card": card,
                }
                title = f"Approval requested (Tier 3): {record['description']}"
                detail = f"{record['cost_display']}; approve by {card['approve_by_display']}"
                self._event(case_id, "ACT", "waiting", title, detail, record)
            actions.append(record)
            self.store.update_case(case_id, actions=actions)

        notes = list(case.notes)
        for po in case.affected["affected_references"]:
            inbound = next((i for i in risk.inbound if i.ref == po), None)
            if inbound and not any(n.get("ref") == po for n in notes):
                transfers = [
                    x["sap_ref"]
                    for x in actions
                    if x["kind"] == "stock_transfer" and x.get("sap_ref")
                ]
                notes.append(
                    {
                        "tier": 0,
                        "ref": po,
                        "text": f"PO {po}: no action taken. It will still arrive late "
                        f"({display(day0, inbound.arrival_earliest)} to "
                        f"{display(day0, inbound.arrival_latest)}) and leave extra stock at "
                        f"{plant}; "
                        "a planner may want to reverse part of the transfer"
                        + (f" {', '.join(transfers)}" if transfers else "")
                        + " later.",
                    }
                )
                self._event(
                    case_id, "ACT", "info", f"Tier 0 note on PO {po}", notes[-1]["text"], notes[-1]
                )
        self.store.update_case(case_id, notes=notes)
        self._after_actions(case_id, "ACT")

    def _card(
        self, case, chosen, a: PlannedAction, record, risk: RiskResult, day0
    ) -> dict[str, Any]:
        alternatives = [
            {
                "option_id": o["option_id"],
                "label": o["label"],
                "total_cost_display": o["total_cost_display"],
            }
            for o in case.solver_results
            if o["option_id"] != chosen["option_id"]
            and o["round"] == chosen["round"]
            and o["result"]["status"] == "optimal"
        ]
        executed = sum(x["quantity"] for x in case.actions if x["status"] == "EXECUTED") + sum(
            x.quantity
            for x in SolveResult.model_validate(chosen["result"]).actions
            if x.kind == "stock_transfer"
        )
        remaining = max(risk.shortfall - executed, 0)
        explanation = case.explanation or {}
        return {
            "what": record["description"],
            "why": explanation.get("summary", ""),
            "cost": a.cost,
            "cost_display": format_idr(a.cost),
            "plan_total_display": chosen["total_cost_display"],
            "tier_reasons": record["tier_reasons"],
            "alternatives": alternatives,
            "if_rejected": (
                "Executed actions are kept. SIAGA replans the remaining shortfall "
                f"(about {remaining} cartons) without this action; the next known option is "
                + (
                    f"{alternatives[0]['option_id']} {alternatives[0]['label']} "
                    f"({alternatives[0]['total_cost_display']})"
                    if alternatives
                    else "escalation to a human planner"
                )
                + "."
            ),
            "approve_by": to_iso(a.dispatch_by) if a.dispatch_by else None,
            "approve_by_display": display(day0, a.dispatch_by) if a.dispatch_by else "no deadline",
            "eta_display": display(day0, a.eta) if a.eta else None,
        }

    def _after_actions(self, case_id: str, stage: str) -> None:
        case = self.store.get_case(case_id)
        pending = [a for a in case.actions if a["status"] == "PENDING_APPROVAL"]
        executed = [a for a in case.actions if a["status"] == "EXECUTED"]
        if pending:
            self._leave(
                case_id, stage, f"{len(executed)} executed, {len(pending)} awaiting approval"
            )
            self.store.update_case(case_id, status="AWAITING_APPROVAL")
            return
        due = self.rt.clock() + timedelta(seconds=self.rt.settings.verify_delay_seconds)
        self._leave(case_id, stage, f"All {len(executed)} action(s) executed; verify scheduled")
        self.store.update_case(case_id, status="VERIFYING", verify_due_at=to_iso(due))
        self._event(
            case_id,
            "VERIFY",
            "scheduled",
            "Verification scheduled",
            f"in {self.rt.settings.verify_delay_seconds} s",
            {"due_at": to_iso(due)},
        )

    # ---------------------------------------------------------------- approvals

    def _decide(
        self, case_id: str, approval_id: str, approve: bool, by: str, reason: str | None
    ) -> None:
        case = self.store.get_case(case_id)
        idx = next(i for i, a in enumerate(case.actions) if a.get("approval_id") == approval_id)
        action = case.actions[idx]
        decided = self.store.decide_approval(approval_id, approve, by, reason)
        self.rt.audit.append(
            case_id,
            "approval",
            {
                "event": "decided",
                "approval_id": approval_id,
                "status": decided.status,
                "by": by,
                "reason": reason,
            },
        )
        actions = list(case.actions)
        if not approve:
            actions[idx] = {**action, "status": "REJECTED", "rejection_reason": reason}
            self._event(
                case_id,
                "ACT",
                "rejected",
                f"Planner rejected: {action['description']}",
                reason or "",
            )
            constraints, ruled_out = list(case.constraints), list(case.ruled_out_strategies)
            if action["kind"] == "alternate_supplier":
                constraints.append(
                    {"type": "exclude_supplier", "supplier": action["args"]["supplier"]}
                )
            else:
                ruled_out.append(action["kind"])
            rejection = f"{action['description']} rejected by {by}" + (
                f": {reason}" if reason else ""
            )
            self.store.update_case(
                case_id,
                actions=actions,
                constraints=constraints,
                ruled_out_strategies=ruled_out,
                rejection_reasons=[*case.rejection_reasons, rejection],
            )
            self._replan_after(case_id, "planner rejected an action")
            return

        # Approved: re-check timing against the actual approval time.
        risk = RiskResult.model_validate(case.risk)
        planned = PlannedAction.model_validate(action["planned"])
        timing = self.rt.solver.timing(
            TimingCheckRequest(action=planned, deadline=risk.deadline, at=self.rt.clock())
        )
        if not timing.feasible:
            actions[idx] = {**action, "status": "EXPIRED", "timing": timing.model_dump(mode="json")}
            self.store.update_case(case_id, actions=actions)
            self._event(
                case_id,
                "ACT",
                "rejected",
                f"Approval came too late: {action['description']}",
                timing.reason,
                timing.model_dump(mode="json"),
            )
            self._replan_after(case_id, "approval came after the approve-by time")
            return

        r = self._tool(case_id, "ACT", action["tool"], action["args"])
        if r.status != "ok":
            raise Escalate(
                f"{action['tool']} failed after approval: "
                f"{r.error or (r.denial and r.denial.message)}"
            )
        actions[idx] = {
            **action,
            "status": "EXECUTED",
            "sap_ref": _sap_ref(r.output),
            "sap": r.output,
        }
        self.store.update_case(case_id, actions=actions)
        self._event(
            case_id,
            "ACT",
            "executed",
            f"Executed after approval: {action['description']}",
            f"SAP {actions[idx]['sap_ref']}",
            actions[idx],
        )
        self._after_actions_post_approval(case_id)

    def _after_actions_post_approval(self, case_id: str) -> None:
        case = self.store.get_case(case_id)
        if any(a["status"] == "PENDING_APPROVAL" for a in case.actions):
            return
        due = self.rt.clock() + timedelta(seconds=self.rt.settings.verify_delay_seconds)
        self.store.update_case(case_id, status="VERIFYING", verify_due_at=to_iso(due))
        self._event(
            case_id,
            "VERIFY",
            "scheduled",
            "Verification scheduled",
            f"in {self.rt.settings.verify_delay_seconds} s",
            {"due_at": to_iso(due)},
        )

    def _replan_after(self, case_id: str, why: str) -> None:
        case = self.store.get_case(case_id)
        if case.replan_count >= self.rt.settings.max_replans:
            raise Escalate(
                f"{why}, and the replan limit ({self.rt.settings.max_replans}) is reached"
            )
        self.store.update_case(case_id, replan_count=case.replan_count + 1, status="RUNNING")
        self._event(case_id, "ACT", "info", "Replanning the remaining shortfall", why)
        self._plan_to_act(case_id)

    # ---------------------------------------------------------------- VERIFY

    def _verify(self, case_id: str) -> None:
        case = self.store.get_case(case_id)
        self._enter(case_id, "VERIFY")
        executed = [a for a in case.actions if a["status"] == "EXECUTED"]
        refs = {"stock_transfers": [], "purchase_orders": [], "freight_orders": []}
        key = {
            "stock_transfer": "stock_transfers",
            "alternate_supplier": "purchase_orders",
            "spot_air": "freight_orders",
        }
        for a in executed:
            if a["kind"] in key:
                refs[key[a["kind"]]].append(a["sap_ref"])
        r = self._tool(case_id, "VERIFY", "get_action_status", refs)
        if r.status != "ok":
            raise Escalate(f"verification read failed: {r.error}")
        risk = RiskResult.model_validate(case.risk)
        checks, secured = [], 0
        by_ref = {
            **{t["StockTransfer"]: t for t in r.output["stock_transfers"]},
            **{p["PurchaseOrder"]: p for p in r.output["purchase_orders"]},
            **{f["FreightOrder"]: f for f in r.output["freight_orders"]},
        }
        for a in executed:
            if a["kind"] == "reschedule_customer":
                secured += a["quantity"]
                checks.append(
                    {"ref": a["args"]["sales_order"], "ok": True, "detail": "rescheduled"}
                )
                continue
            row = by_ref.get(a["sap_ref"], {})
            qty, eta, status_ok = _sap_status(a["kind"], row)
            on_time = (
                eta is not None and risk.deadline is not None and from_iso(eta) <= risk.deadline
            )
            ok = bool(row) and status_ok and qty == a["quantity"] and on_time
            if ok:
                secured += qty
            checks.append(
                {
                    "ref": a["sap_ref"],
                    "ok": ok,
                    "quantity": qty,
                    "expected": a["quantity"],
                    "eta": eta,
                    "on_time": on_time,
                }
            )
        projected = risk.usable_stock + secured
        covered = projected >= risk.demand and all(c["ok"] for c in checks)
        verification = {
            "checks": checks,
            "usable_stock": risk.usable_stock,
            "secured": secured,
            "projected_supply": projected,
            "demand": risk.demand,
            "covered": covered,
            "verified_at": to_iso(self.rt.clock()),
        }
        self.store.update_case(case_id, verification=verification)
        detail = f"projected usable supply {projected} vs demand {risk.demand} by the cutoff"
        if covered:
            self._leave(case_id, "VERIFY", "Verified: demand covered", detail, verification)
            self.store.update_case(case_id, status="RESOLVED")
            self._event(case_id, "CASE", "resolved", "Case resolved", detail)
        else:
            self._leave(
                case_id, "VERIFY", "Verification failed: case re-opened", detail, verification
            )
            self.store.update_case(case_id, status="REOPENED")
            self._event(case_id, "CASE", "reopened", "Case re-opened for a human / replan", detail)

    # ================================================================ helpers

    def _day0(self, case_id: str):
        case = self.store.get_case(case_id)
        if case.day0:
            return from_iso(case.day0)
        from siaga_common.timeline import day0_for, today_wib

        return day0_for(today_wib(self.rt.clock()))


def _sap_status(kind: str, row: dict[str, Any]) -> tuple[Any, Any, bool]:
    """(quantity, ETA, status ok) of an executed action as SAP reports it."""
    if kind == "stock_transfer":
        ok = row.get("Status") in {"IN_TRANSIT", "DELIVERED"}
        return row.get("Quantity"), row.get("PlannedArrivalDateTime"), ok
    if kind == "alternate_supplier":
        item = (row.get("items") or [{}])[0]
        ok = row.get("YY1_Status") == "CONFIRMED"
        return item.get("YY1_ConfirmedQuantity"), item.get("YY1_ScheduledDeliveryDateTime"), ok
    return row.get("Quantity"), row.get("PlannedArrivalDateTime"), row.get("Status") == "BOOKED"


def _sap_ref(output: dict[str, Any]) -> str | None:
    for k in ("StockTransfer", "PurchaseOrder", "FreightOrder", "SalesOrder"):
        if k in output:
            return output[k]
    return None
