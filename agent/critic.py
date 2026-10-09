"""REFLECT's deterministic business-rule checks (the Critic). The LLM only explains.

Rules: feasible, safety_stock, incoterm, supplier_capacity, cutoff_met, tier_mapping.
A failed rule that a solver constraint can fix carries that constraint, which the state
machine adds before replanning.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from agent.actions import tool_call_for
from agent.tools.base import ToolContext, ToolRegistry
from services.solver.models import RiskResult, SolveResult
from siaga_common.money import format_idr

ACCEPTED_INCOTERMS = {"DDP"}  # supplier delivers to our DC, duties and risk included


class RuleCheck(BaseModel):
    rule: str
    passed: bool
    detail: str
    constraint: dict[str, Any] | None = None


class ActionTier(BaseModel):
    kind: str
    reference: str
    tool: str
    tier: int
    reasons: list[str]


class OptionReview(BaseModel):
    option_id: str
    checks: list[RuleCheck]
    tiers: list[ActionTier]

    @property
    def violations(self) -> list[RuleCheck]:
        return [c for c in self.checks if not c.passed]

    @property
    def clean(self) -> bool:
        return not self.violations


def review(
    option_id: str,
    result: SolveResult,
    risk: RiskResult,
    *,
    material: str,
    plant: str,
    suppliers: dict[str, dict[str, Any]],
    registry: ToolRegistry,
    ctx: ToolContext,
) -> OptionReview:
    checks: list[RuleCheck] = []
    feasible = result.status == "optimal" and result.covered_quantity >= result.required_quantity
    checks.append(
        RuleCheck(
            rule="feasible",
            passed=feasible,
            detail=(
                f"covers {result.covered_quantity} of {result.required_quantity} cartons"
                if result.status == "optimal"
                else result.infeasible_reason or "infeasible"
            ),
        )
    )
    if not feasible:
        return OptionReview(option_id=option_id, checks=checks, tiers=[])

    for s in result.stock_after:
        if s.on_hand_after < s.safety_stock:
            checks.append(
                RuleCheck(
                    rule="safety_stock",
                    passed=False,
                    detail=f"{s.plant} left at {s.on_hand_after}, "
                    f"below safety stock {s.safety_stock}",
                    constraint={"type": "safety_stock"},
                )
            )
    if not any(c.rule == "safety_stock" for c in checks):
        checks.append(
            RuleCheck(rule="safety_stock", passed=True, detail="all donor DCs keep safety stock")
        )

    for a in result.actions:
        if a.kind != "alternate_supplier":
            continue
        v = suppliers.get(a.reference, {})
        inc = v.get("YY1_DefaultIncoterm")
        checks.append(
            RuleCheck(
                rule="incoterm",
                passed=inc in ACCEPTED_INCOTERMS,
                detail=f"{a.reference} Incoterm {inc}",
                constraint=None
                if inc in ACCEPTED_INCOTERMS
                else {"type": "exclude_supplier", "supplier": a.reference},
            )
        )
        cap = v.get("YY1_CapacityCartons")
        checks.append(
            RuleCheck(
                rule="supplier_capacity",
                passed=cap is not None and a.quantity <= cap,
                detail=f"{a.reference} {a.quantity} of capacity {cap}",
            )
        )

    late = [
        a for a in result.actions if a.eta is not None and risk.deadline and a.eta > risk.deadline
    ]
    checks.append(
        RuleCheck(
            rule="cutoff_met",
            passed=not late,
            detail="all supply arrives before the loading cutoff"
            if not late
            else f"{len(late)} action(s) arrive after the cutoff",
        )
    )

    tiers = []
    for a in result.actions:
        tool, args = tool_call_for(a, material, plant)
        t = registry.get(tool)
        assessment = t.tier(t.Input.model_validate(args), ctx)
        tiers.append(
            ActionTier(
                kind=a.kind,
                reference=a.reference,
                tool=tool,
                tier=assessment.tier,
                reasons=assessment.reasons,
            )
        )
    checks.append(
        RuleCheck(
            rule="tier_mapping",
            passed=True,
            detail=", ".join(f"{t.kind} {t.reference}: Tier {t.tier}" for t in tiers)
            + f" (total {format_idr(result.total_cost)})",
        )
    )
    return OptionReview(option_id=option_id, checks=checks, tiers=tiers)
