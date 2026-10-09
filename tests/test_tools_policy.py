"""Phase 3: tool layer + Cedar policy + in-code tier checks + audit.

Checkpoint cases: Tier 2 transfer allowed, Tier 3 PO blocked without approval,
Rp 60M transfer escalated.
"""

import itertools
import re

import pytest

from agent.policy import PolicyContext, PolicyDecision
from agent.tools.base import TIER2_MAX_IDR, PolicyViolation, ToolContext, classify
from siaga_common.settings import REPO_ROOT

TRANSFER = {
    "material": "MG-2L",
    "from_plant": "DC-BDG",
    "to_plant": "DC-CKR",
    "quantity": 400,
    "trucks": 2,
}
BRIDGE_PO = {"supplier": "V-2002", "material": "MG-2L", "plant": "DC-CKR", "quantity": 500}
CARD = {"what": "Bridge PO", "cost": 7_500_000, "approve_by": "2026-10-30T11:00:00Z"}


def invoke(runtime, ctx, tool, args):
    return runtime.registry.invoke(ctx, tool, args)


def sap_count(sap, entity_set):
    return len(sap.get(f"/{entity_set}").json()["value"])


def bdg_on_hand(sap):
    return sap.get("/A_MaterialStock(Material='MG-2L',Plant='DC-BDG')").json()["OnHandQuantity"]


def approve(runtime, ctx, tool, args, approve=True):
    r = invoke(runtime, ctx, "request_human_approval", {"tool": tool, "args": args, "card": CARD})
    assert r.status == "ok", r
    return runtime.store.decide_approval(r.output["approval_id"], approve, by="planner")


# ------------------------------------------------------------ checkpoint cases


def test_tier2_transfer_is_allowed_and_executes(runtime, ctx, sap):
    r = invoke(runtime, ctx, "execute_stock_transfer", TRANSFER)
    assert r.status == "ok", r
    assert r.tier == 2
    assert r.output["StockTransfer"] == "STO-000001"
    assert r.output["FreightCostIDR"] == 3_900_000
    assert bdg_on_hand(sap) == 400
    decision = next(e for e in runtime.audit.read(ctx.case_id) if e.kind == "policy_decision")
    assert decision.payload["policies"] == ["tier2-execute"]
    assert decision.payload["context"]["amount_idr"] == 3_900_000


def test_tier3_po_blocked_without_approval(runtime, ctx, sap):
    r = invoke(runtime, ctx, "create_purchase_order", BRIDGE_PO)
    assert r.status == "denied"
    assert r.tier == 3
    assert r.denial.needs_approval
    assert r.denial.policies == ["tier3-external-commitment"]
    assert "new commitment to an external party" in r.denial.reasons
    assert sap_count(sap, "A_PurchaseOrder") == 1  # only the seeded PO


def test_tier3_po_runs_after_matching_approval(runtime, ctx, sap):
    a = approve(runtime, ctx, "create_purchase_order", BRIDGE_PO)
    r = invoke(runtime, ctx, "create_purchase_order", BRIDGE_PO)
    assert r.status == "ok", r
    assert r.output["PurchaseOrder"] == "4500018232"
    assert r.approval_id == a.approval_id
    po = sap.get("/A_PurchaseOrder('4500018232')").json()
    assert po["YY1_ApprovalId"] == a.approval_id
    decision = [e for e in runtime.audit.read(ctx.case_id) if e.kind == "policy_decision"][-1]
    assert decision.payload["policies"] == ["tier3-approved"]


def test_approval_is_bound_to_exact_arguments(runtime, ctx, sap):
    approve(runtime, ctx, "create_purchase_order", BRIDGE_PO)
    r = invoke(runtime, ctx, "create_purchase_order", {**BRIDGE_PO, "quantity": 600})
    assert r.status == "denied" and r.denial.needs_approval
    assert sap_count(sap, "A_PurchaseOrder") == 1


def test_rejected_approval_does_not_authorise(runtime, ctx, sap):
    approve(runtime, ctx, "create_purchase_order", BRIDGE_PO, approve=False)
    assert invoke(runtime, ctx, "create_purchase_order", BRIDGE_PO).status == "denied"


def test_60m_transfer_is_escalated(runtime, ctx, sap_store, sap):
    lane = sap_store.get("A_TransportLane", "BDG-CKR")
    sap_store.put("A_TransportLane", {**lane, "CostPerTruckIDR": 20_000_000})
    r = invoke(runtime, ctx, "execute_stock_transfer", {**TRANSFER, "trucks": 3})
    assert r.status == "denied"
    assert r.tier == 3
    assert r.denial.needs_approval
    assert r.denial.policies == ["tier3-amount"]
    assert r.denial.reasons == ["amount Rp 60.000.000 >= Rp 50.000.000"]
    assert bdg_on_hand(sap) == 800  # nothing moved


# ------------------------------------------------------------ defence in depth


class AllowAll:
    def authorize(self, *, action, case_id, context):
        return PolicyDecision(allowed=True, policies=["misconfigured-allow-all"])


def test_in_code_check_blocks_even_if_policy_allows(runtime, ctx, sap):
    permissive = ToolContext(**{**ctx.__dict__, "policy": AllowAll()})
    r = invoke(runtime, permissive, "create_purchase_order", BRIDGE_PO)
    assert r.status == "denied"
    assert r.denial.policies == ["in-code-tier-check"]
    assert sap_count(sap, "A_PurchaseOrder") == 1


@pytest.mark.parametrize(
    "tool,args",
    [
        ("create_purchase_order", BRIDGE_PO),
        ("book_spot_air", {"quote": "Q-AIR-0001", "quantity": 900}),
        ("reschedule_customer_order", {"sales_order": "SO-7002"}),
    ],
)
def test_action_tools_refuse_direct_calls_without_approval(runtime, ctx, tool, args):
    t = runtime.registry.get(tool)
    with pytest.raises(PolicyViolation):
        t.run(t.Input.model_validate(args), ctx)


def test_direct_60m_transfer_refused_in_code(runtime, ctx, sap_store, sap):
    lane = sap_store.get("A_TransportLane", "BDG-CKR")
    sap_store.put("A_TransportLane", {**lane, "CostPerTruckIDR": 20_000_000})
    t = runtime.registry.get("execute_stock_transfer")
    with pytest.raises(PolicyViolation):
        t.run(t.Input.model_validate({**TRANSFER, "trucks": 3}), ctx)
    assert bdg_on_hand(sap) == 800


# ------------------------------------------------------------ other tiers


def test_spot_air_and_reschedule_need_approval(runtime, ctx):
    air = invoke(runtime, ctx, "book_spot_air", {"quote": "Q-AIR-0001", "quantity": 900})
    assert air.status == "denied"
    assert set(air.denial.policies) == {"tier3-spot-air", "tier3-external-commitment"}
    sla = invoke(runtime, ctx, "reschedule_customer_order", {"sales_order": "SO-7002"})
    assert sla.status == "denied"
    assert "tier3-sla-change" in sla.denial.policies and "tier3-amount" in sla.denial.policies


def test_spot_air_after_approval_books_and_moves_stock(runtime, ctx, sap):
    args = {"quote": "Q-AIR-0001", "quantity": 500}
    approve(runtime, ctx, "book_spot_air", args)
    r = invoke(runtime, ctx, "book_spot_air", args)
    assert r.status == "ok", r
    assert r.output["FreightOrder"] == "FO-000001"
    assert sap.get("/A_FreightQuote('Q-AIR-0001')").json()["YY1_Status"] == "BOOKED"


def test_draft_rfq_is_tier1(runtime, ctx):
    r = invoke(
        runtime,
        ctx,
        "draft_rfq",
        {
            "supplier": "V-2002",
            "material": "MG-2L",
            "quantity": 500,
            "needed_by": "2026-10-31T11:00:00Z",
        },
    )
    assert (r.status, r.tier) == ("ok", 1)
    assert r.output["draft"]["status"] == "DRAFT"


def test_approval_request_refused_for_tier2_action(runtime, ctx):
    r = invoke(
        runtime,
        ctx,
        "request_human_approval",
        {"tool": "execute_stock_transfer", "args": TRANSFER, "card": {}},
    )
    assert r.status == "error" and "does not need approval" in r.error


# ------------------------------------------------------------ reads


def test_read_tools(runtime, ctx):
    po = invoke(
        runtime, ctx, "find_inbound_purchase_orders", {"lane": "SMG-JKT", "plant": "DC-CKR"}
    )
    assert po.status == "ok" and po.tier == 0
    assert [p["PurchaseOrder"] for p in po.output["purchase_orders"]] == ["4500018231"]
    impact = invoke(
        runtime,
        ctx,
        "assess_impact",
        {
            "material": "MG-2L",
            "plant": "DC-CKR",
            "affected_references": ["4500018231"],
            "delay_hours_min": 48,
            "delay_hours_max": 72,
        },
    )
    assert impact.status == "ok"
    assert impact.output["risk"]["shortfall"] == 900
    assert impact.output["risk"]["max_exposure"] == 340_000_000
    kb = invoke(runtime, ctx, "search_precedents", {"query": "flood Pantura Brebes trucks delayed"})
    assert kb.output["hits"][0]["id"] == "P-001"


def test_simulate_option_uses_case_risk(runtime, ctx):
    early = invoke(runtime, ctx, "simulate_option", {"strategies": ["spot_air"]})
    assert early.status == "error" and "assess_impact" in early.error
    impact = invoke(
        runtime,
        ctx,
        "assess_impact",
        {
            "material": "MG-2L",
            "plant": "DC-CKR",
            "affected_references": ["4500018231"],
            "delay_hours_min": 48,
            "delay_hours_max": 72,
        },
    )
    runtime.store.update_case(
        ctx.case_id, risk=impact.output["risk"], affected={"material": "MG-2L", "plant": "DC-CKR"}
    )
    b2 = invoke(
        runtime,
        ctx,
        "simulate_option",
        {
            "strategies": ["stock_transfer", "alternate_supplier"],
            "constraints": [{"type": "safety_stock"}],
        },
    )
    assert b2.status == "ok" and b2.output["total_cost"] == 11_400_000


# ------------------------------------------------------------ budget and bad input


def test_budget_is_enforced_in_code(runtime, ctx):
    small = ToolContext(**{**ctx.__dict__, "max_tool_calls": 2})
    q = {"query": "flood"}
    assert invoke(runtime, small, "search_precedents", q).status == "ok"
    assert invoke(runtime, small, "search_precedents", q).status == "ok"
    over = invoke(runtime, small, "search_precedents", q)
    assert over.status == "budget_exceeded" and over.call_index is None
    assert runtime.store.get_case(ctx.case_id).tool_call_count == 2


def test_invalid_args_are_structured(runtime, ctx):
    r = invoke(runtime, ctx, "execute_stock_transfer", {**TRANSFER, "quantity": -5})
    assert r.status == "invalid_args" and "quantity" in r.error
    assert invoke(runtime, ctx, "no_such_tool", {}).status == "invalid_args"


# ------------------------------------------------------------ audit trail


def test_every_call_is_audited_and_chain_verifies(runtime, ctx):
    invoke(runtime, ctx, "execute_stock_transfer", TRANSFER)
    invoke(runtime, ctx, "create_purchase_order", BRIDGE_PO)
    kinds = [e.kind for e in runtime.audit.read(ctx.case_id)]
    assert kinds == ["policy_decision", "tool_call", "policy_decision", "tool_call"]
    assert runtime.audit.verify(ctx.case_id).ok


def test_tampering_breaks_the_chain(runtime, ctx):
    invoke(runtime, ctx, "execute_stock_transfer", TRANSFER)
    invoke(runtime, ctx, "search_precedents", {"query": "flood"})
    path = runtime.audit.dir / f"{ctx.case_id}.jsonl"
    lines = path.read_text().splitlines()
    lines[1] = lines[1].replace("3900000", "390000")  # edit the transfer's tool_call entry
    path.write_text("\n".join(lines) + "\n")
    v = runtime.audit.verify(ctx.case_id)
    assert not v.ok and v.broken_at == 1 and v.reason == "hash mismatch"


# ------------------------------------------------------------ policy files


def test_cedar_threshold_matches_code():
    cedar = (REPO_ROOT / "policy" / "siaga.cedar").read_text()
    amounts = {int(a) for a in re.findall(r"amount_idr\s*[<>]=?\s*(\d+)", cedar)}
    assert amounts == {TIER2_MAX_IDR}


BOOLS = [
    "observe_only",
    "draft_only",
    "internal",
    "reversible",
    "external_commitment",
    "spot_air",
    "sla_change",
]


@pytest.mark.parametrize("amount", [0, TIER2_MAX_IDR - 1, TIER2_MAX_IDR])
def test_cedar_agrees_with_in_code_tiers(runtime, amount):
    """Exhaustive: Cedar allows iff the code tier is 0-2, or 3 with an approval."""
    for values in itertools.product([False, True], repeat=len(BOOLS)):
        for approved in (False, True):
            pctx = PolicyContext(
                **dict(zip(BOOLS, values, strict=True)), amount_idr=amount, has_approval=approved
            )
            tier = classify(pctx).tier
            decision = runtime.policy.authorize(
                action="execute_stock_transfer", case_id="c", context=pctx
            )
            expected = approved or tier < 3
            assert decision.allowed == expected, (pctx, tier, decision)


def test_tool_specs_have_schemas(runtime):
    specs = runtime.registry.specs(llm_only=False)
    assert len({s["toolSpec"]["name"] for s in specs}) == len(specs) == 11
    for s in specs:
        schema = s["toolSpec"]["inputSchema"]["json"]
        assert schema["type"] == "object" and s["toolSpec"]["description"]
    visible = {s["toolSpec"]["name"] for s in runtime.registry.specs()}
    assert "create_purchase_order" not in visible and "assess_impact" in visible
