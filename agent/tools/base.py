"""Tool layer: tool base class, tier assessment, in-code guard and the registry.

Every call goes through `ToolRegistry.invoke`:

    budget check -> argument validation -> tier assessment (code) -> approval lookup
    -> policy engine (Cedar) -> tool.run (which re-checks its tier in code) -> audit

Denials and errors come back as structured `ToolCallResult`s the agent can reason
about; they never raise into the agent loop.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any, ClassVar, Literal

from pydantic import BaseModel, ValidationError

from agent.audit import AuditWriter
from agent.case_store import ApprovalRequest, CaseStore
from agent.clients import SapClient, SapError, SolverClient
from agent.kb import PrecedentKB
from agent.policy import PolicyContext, PolicyEngine
from siaga_common.money import format_idr

TIER2_MAX_IDR = 50_000_000  # mirrors policy/siaga.cedar; a test keeps them in sync

ToolKind = Literal["read", "draft", "action"]


class PolicyViolation(Exception):
    """Raised by the in-code tier check inside a tool (defence in depth)."""


class TierAssessment(BaseModel):
    tier: Literal[0, 1, 2, 3]
    reasons: list[str]
    context: PolicyContext


def classify(ctx: PolicyContext) -> TierAssessment:
    """Brief §2.3 in code. Independent of the Cedar policy, used for the in-code check."""
    reasons = []
    if ctx.amount_idr >= TIER2_MAX_IDR:
        reasons.append(f"amount {format_idr(ctx.amount_idr)} >= {format_idr(TIER2_MAX_IDR)}")
    if ctx.spot_air:
        reasons.append("spot air freight")
    if ctx.sla_change:
        reasons.append("customer SLA change")
    if ctx.external_commitment:
        reasons.append("new commitment to an external party")
    if reasons:
        return TierAssessment(tier=3, reasons=reasons, context=ctx)
    if ctx.observe_only:
        return TierAssessment(tier=0, reasons=["observe / alert only"], context=ctx)
    if ctx.draft_only:
        return TierAssessment(tier=1, reasons=["draft for human review"], context=ctx)
    if ctx.internal and ctx.reversible:
        return TierAssessment(
            tier=2, reasons=["reversible internal action under Rp 50M"], context=ctx
        )
    return TierAssessment(tier=3, reasons=["not a reversible internal action"], context=ctx)


@dataclass
class ToolContext:
    case_id: str
    sap: SapClient
    solver: SolverClient
    store: CaseStore
    audit: AuditWriter
    policy: PolicyEngine
    kb: PrecedentKB
    clock: Callable[[], datetime]
    max_tool_calls: int = 20


class Tool(ABC):
    name: ClassVar[str]
    description: ClassVar[str]
    kind: ClassVar[ToolKind]
    Input: ClassVar[type[BaseModel]]
    Output: ClassVar[type[BaseModel]]
    llm_visible: ClassVar[bool] = True

    @abstractmethod
    def policy_context(self, args: BaseModel, ctx: ToolContext) -> PolicyContext:
        """The tool's tier mapping: facts about this call, computed from args + SAP data."""

    def tier(self, args: BaseModel, ctx: ToolContext) -> TierAssessment:
        return classify(self.policy_context(args, ctx))

    @abstractmethod
    def run(self, args: BaseModel, ctx: ToolContext) -> BaseModel: ...

    def spec(self) -> dict[str, Any]:
        """Bedrock Converse `toolSpec` (and later the AgentCore Gateway tool definition)."""
        return {
            "toolSpec": {
                "name": self.name,
                "description": self.description,
                "inputSchema": {"json": self.Input.model_json_schema()},
            }
        }

    # ---- in-code guard, called at the top of every action tool's run() ----

    def guard(self, args: BaseModel, ctx: ToolContext) -> ApprovalRequest | None:
        """Recompute the tier from the arguments and refuse unless allowed.

        Independent of the registry and the Cedar policy: a tool invoked directly, or
        through a misconfigured policy, still cannot act beyond its tier.
        """
        assessment = self.tier(args, ctx)
        approval = ctx.store.find_valid_approval(
            ctx.case_id, self.name, args.model_dump(mode="json")
        )
        if assessment.tier >= 3 and approval is None:
            raise PolicyViolation(
                f"{self.name}: Tier 3 ({'; '.join(assessment.reasons)}) "
                "requires a matching human approval"
            )
        return approval


class Denial(BaseModel):
    tier: int
    needs_approval: bool
    policies: list[str]
    reasons: list[str]
    message: str


class ToolCallResult(BaseModel):
    tool: str
    call_index: int | None
    status: Literal["ok", "denied", "error", "invalid_args", "budget_exceeded"]
    tier: int | None = None
    output: dict[str, Any] | None = None
    denial: Denial | None = None
    error: str | None = None
    approval_id: str | None = None
    duration_ms: float = 0.0


class BudgetExceeded(Exception):
    pass


class ToolRegistry:
    def __init__(self, tools: list[Tool]):
        self.tools = {t.name: t for t in tools}

    def names(self) -> list[str]:
        return sorted(self.tools)

    def get(self, name: str) -> Tool:
        return self.tools[name]

    def specs(self, llm_only: bool = True) -> list[dict[str, Any]]:
        return [t.spec() for t in self.tools.values() if t.llm_visible or not llm_only]

    def invoke(self, ctx: ToolContext, name: str, raw_args: dict[str, Any]) -> ToolCallResult:
        t0 = time.perf_counter()

        def done(result: ToolCallResult) -> ToolCallResult:
            result.duration_ms = round((time.perf_counter() - t0) * 1000, 1)
            ctx.audit.append(
                ctx.case_id,
                "tool_call",
                {"tool": name, "args": raw_args, **result.model_dump(exclude={"tool"})},
            )
            return result

        # 1. budget (enforced in code; the call that would exceed it is not run)
        case = ctx.store.get_case(ctx.case_id)
        if case.tool_call_count >= ctx.max_tool_calls:
            return done(
                ToolCallResult(
                    tool=name,
                    call_index=None,
                    status="budget_exceeded",
                    error=f"tool-call budget of {ctx.max_tool_calls} per case exhausted",
                )
            )
        index = ctx.store.increment_tool_calls(ctx.case_id)

        # 2. tool + arguments
        tool = self.tools.get(name)
        if tool is None:
            return done(
                ToolCallResult(
                    tool=name, call_index=index, status="invalid_args", error="unknown tool"
                )
            )
        try:
            args = tool.Input.model_validate(raw_args)
        except ValidationError as e:
            return done(
                ToolCallResult(
                    tool=name,
                    call_index=index,
                    status="invalid_args",
                    error=str(e.errors(include_url=False)),
                )
            )

        # 3. tier assessment (code) + approval lookup + policy decision (Cedar)
        try:
            assessment = tool.tier(args, ctx)
        except SapError as e:
            return done(ToolCallResult(tool=name, call_index=index, status="error", error=str(e)))
        approval = ctx.store.find_valid_approval(ctx.case_id, name, args.model_dump(mode="json"))
        pctx = assessment.context.model_copy(update={"has_approval": approval is not None})
        decision = ctx.policy.authorize(action=name, case_id=ctx.case_id, context=pctx)
        ctx.audit.append(
            ctx.case_id,
            "policy_decision",
            {
                "tool": name,
                "call_index": index,
                "tier": assessment.tier,
                "context": pctx.model_dump(),
                "allowed": decision.allowed,
                "policies": decision.policies,
                "errors": decision.errors,
                "approval_id": approval.approval_id if approval else None,
            },
        )
        if not decision.allowed:
            needs_approval = assessment.tier == 3 and approval is None
            return done(
                ToolCallResult(
                    tool=name,
                    call_index=index,
                    status="denied",
                    tier=assessment.tier,
                    denial=Denial(
                        tier=assessment.tier,
                        needs_approval=needs_approval,
                        policies=decision.policies,
                        reasons=assessment.reasons,
                        message=(
                            f"Tier {assessment.tier}: {'; '.join(assessment.reasons)}. "
                            + (
                                "Escalate: request human approval for this exact action."
                                if needs_approval
                                else "Not permitted by policy."
                            )
                        ),
                    ),
                )
            )

        # 4. run (the tool re-checks its own tier in code)
        try:
            output = tool.run(args, ctx)
        except PolicyViolation as e:
            return done(
                ToolCallResult(
                    tool=name,
                    call_index=index,
                    status="denied",
                    tier=assessment.tier,
                    denial=Denial(
                        tier=assessment.tier,
                        needs_approval=True,
                        policies=["in-code-tier-check"],
                        reasons=assessment.reasons,
                        message=str(e),
                    ),
                )
            )
        except (SapError, ValueError) as e:
            return done(
                ToolCallResult(
                    tool=name, call_index=index, status="error", tier=assessment.tier, error=str(e)
                )
            )
        return done(
            ToolCallResult(
                tool=name,
                call_index=index,
                status="ok",
                tier=assessment.tier,
                output=output.model_dump(mode="json"),
                approval_id=approval.approval_id if approval else None,
            )
        )
