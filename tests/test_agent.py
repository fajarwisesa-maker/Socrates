"""Phase 4: the agent state machine with the scripted (fake) LLM provider."""

import pytest

from agent.machine import STAGES, Agent, CaseStateError
from agent.providers.fake import FakeProvider, say, tool_call
from agent.providers.scripts import golden_scripts
from agent.signals import build_signals
from siaga_common.settings import REPO_ROOT, Settings
from siaga_common.timeline import at, day_offset, from_iso
from tests.conftest import DAY0

DEMO = REPO_ROOT / "data" / "demo"


@pytest.fixture
def signals():
    return build_signals((DEMO / "whatsapp_driver.txt").read_text(), DEMO / "forwarder_notice.pdf")


@pytest.fixture
def llm():
    return FakeProvider(golden_scripts())


@pytest.fixture
def agent(runtime, llm):
    return Agent(runtime, llm)


def run_golden(agent, signals):
    case = agent.start_case(signals, day0="2026-10-28T17:00:00Z")
    return agent.run(case.case_id)


def pending(case):
    return next(a for a in case.actions if a["status"] == "PENDING_APPROVAL")


def stages_in_order(store, case_id):
    seen = []
    for e in store.list_events(case_id):
        if e.status == "started":
            seen.append(e.stage)
    return seen


# ------------------------------------------------------------ golden path


def test_golden_path(agent, runtime, signals, sap):
    c = run_golden(agent, signals)
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    # one replan: Critic rejected B1 (safety stock), B2 chosen
    assert c.replan_count == 1
    assert stages_in_order(runtime.store, c.case_id) == [
        "PERCEIVE", "ASSESS", "PLAN", "SIMULATE", "REFLECT", "PLAN", "SIMULATE", "REFLECT", "ACT",
    ]  # fmt: skip
    b1 = next(o for o in c.solver_results if o["option_id"] == "B1")
    assert b1["result"]["total_cost"] == 8_100_000
    assert any(f["option_id"] == "B1" and not f["clean"] for f in c.critic_findings)
    assert c.constraints == [{"type": "safety_stock"}]
    assert c.chosen_option == "B2"
    chosen = next(o for o in c.solver_results if o["option_id"] == "B2")
    assert chosen["result"]["total_cost"] == 11_400_000
    a1 = next(o for o in c.solver_results if o["option_id"] == "A1")
    assert a1["result"]["total_cost"] == 31_000_000
    assert c.summary["saving_vs_baseline"] == 19_600_000
    assert c.summary["exposure_avoided"] == 340_000_000
    assert c.summary["net_protected"] == 328_600_000
    assert c.summary["net_protected_display"] == "Rp 328.600.000"
    # the Critic's sentence comes from a template filled with the solver's numbers
    b1_finding = next(f for f in c.critic_findings if f["option_id"] == "B1")
    ss = next(x for x in b1_finding["checks"] if x["rule"] == "safety_stock")
    assert ss["plain"] == "Bandung DC would drop to 50 cartons, below its safety stock of 400"
    assert ss["facts"] == {"plant": "DC-BDG", "plant_name": "Bandung DC", "left": 50,
                           "safety_stock": 400}  # fmt: skip
    b2_finding = next(f for f in c.critic_findings if f["option_id"] == "B2")
    ok = next(x for x in b2_finding["checks"] if x["rule"] == "safety_stock")
    assert ok["plain"].startswith("Safety stock respected: Bandung DC keeps 400 cartons")
    # display labels from SAP (C) and cited precedents with their period (D)
    labels = c.affected["labels"]
    assert labels["plants"]["DC-CKR"] == "Cikarang DC"
    assert labels["suppliers"]["V-2002"]["name"] == "PT Agro Pangan Tangerang"
    assert labels["lanes"]["SMG-JKT"]["corridor"] == "Pantura"
    plan1 = next(
        e for e in runtime.store.list_events(c.case_id)
        if e.stage == "PLAN" and e.status == "completed"
    )  # fmt: skip
    p001 = plan1.data["precedents"][0]
    assert p001["id"] == "P-001" and p001["period"] == "2025-02" and p001["synthetic"] is True
    assert c.risk["max_exposure"] == c.risk["expected_exposure"] == 340_000_000
    # transfer auto-executed (Tier 2), bridge PO pending approval (Tier 3)
    transfer = next(a for a in c.actions if a["kind"] == "stock_transfer")
    assert (transfer["status"], transfer["tier"], transfer["cost"]) == ("EXECUTED", 2, 3_900_000)
    assert transfer["sap_ref"] == "STO-000001"
    bridge = pending(c)
    assert (bridge["kind"], bridge["tier"], bridge["cost"]) == ("alternate_supplier", 3, 7_500_000)
    assert day_offset(DAY0, from_iso(bridge["card"]["approve_by"])) == (1, "18:00")
    assert bridge["card"]["approve_by_display"] == "Day 1 18:00 · Fri 30 Oct WIB"
    assert len(sap.get("/A_PurchaseOrder").json()["value"]) == 1  # PO not created yet
    # budget, notes, audit
    assert c.tool_call_count <= 20
    assert any(n["ref"] == "4500018231" and n["tier"] == 0 for n in c.notes)
    assert runtime.audit.verify(c.case_id).ok
    kinds = {e.kind for e in runtime.audit.read(c.case_id)}
    assert {"stage_transition", "tool_call", "policy_decision", "llm_call", "approval"} <= kinds


def test_perceive_fuses_pdf_into_higher_confidence(agent, runtime, signals):
    wa_only = agent.run(agent.start_case(signals[:1]).case_id)
    both = run_golden(agent, signals)
    assert wa_only.disruption["references"] == []
    assert both.disruption["references"] == ["4500018231"]
    assert wa_only.disruption["confidence"] == "Medium"
    assert both.disruption["confidence"] == "High"
    assert both.disruption["confidence_basis"]["corroborated_fields"] == ["lane", "delay"]
    # every highlighted span is the exact text of the signal it points at
    for e in both.disruption["evidence"]:
        text = both.signals[e["signal"] - 1]["text"]
        assert text[e["start"] : e["end"]] == e["text"]
    quoted = {e["quote"] for e in wa_only.disruption["evidence"]}
    assert {"macet total", "ga gerak sm sekali", "bs 2-3 hari"} <= quoted


def test_approve_then_verify_resolves(agent, runtime, signals, sap):
    c = run_golden(agent, signals)
    c = agent.decide(c.case_id, pending(c)["approval_id"], True, by="planner")
    assert c.status == "VERIFYING"
    po = next(a for a in c.actions if a["kind"] == "alternate_supplier")
    assert (po["status"], po["sap_ref"]) == ("EXECUTED", "4500018232")
    header = sap.get("/A_PurchaseOrder('4500018232')").json()
    assert header["YY1_ApprovalId"] == po["approval_id"]
    c = agent.verify(c.case_id)
    assert c.status == "RESOLVED"
    v = c.verification
    assert v["covered"] and v["secured"] == 900 and v["projected_supply"] == 1000
    assert stages_in_order(runtime.store, c.case_id)[-1] == "VERIFY"
    assert c.tool_call_count <= 20
    assert runtime.audit.verify(c.case_id).ok


def test_reject_bridge_replans_remaining_shortfall_to_air(agent, runtime, signals, llm, sap):
    c = run_golden(agent, signals)
    reason = "V-2002 had quality issues last month"
    c = agent.decide(c.case_id, pending(c)["approval_id"], False, by="planner", reason=reason)
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    assert c.replan_count == 2
    assert {"type": "exclude_supplier", "supplier": "V-2002"} in c.constraints
    # transfer kept, exactly one STO in SAP
    assert len(sap.get("/StockTransfer").json()["value"]) == 1
    air = pending(c)
    assert (air["kind"], air["tier"], air["cost"]) == ("spot_air", 3, 31_000_000)
    assert air["quantity"] == 500  # remaining shortfall after the executed transfer
    # the planner's reason reached the PLAN prompt
    plan_reqs = [r for r in llm.requests if r.purpose == "plan"]
    assert reason in plan_reqs[-1].messages[0]["content"][0]["text"]


def test_late_approval_is_infeasible_and_replans(agent, runtime, signals, sap):
    c = run_golden(agent, signals)
    runtime.clock = lambda: at(DAY0, 1, "18:01")  # one minute after approve-by
    c = agent.decide(c.case_id, pending(c)["approval_id"], True, by="planner")
    bridge = next(a for a in c.actions if a["kind"] == "alternate_supplier")
    assert bridge["status"] == "EXPIRED"
    assert not bridge["timing"]["feasible"]
    assert len(sap.get("/A_PurchaseOrder").json()["value"]) == 1  # no PO created
    assert c.status == "AWAITING_APPROVAL"  # replanned: air for the remaining 500
    assert pending(c)["kind"] == "spot_air"


def test_approval_preconditions(agent, signals):
    c = run_golden(agent, signals)
    with pytest.raises(CaseStateError):
        agent.decide(c.case_id, "apr-unknown", True, by="planner")
    with pytest.raises(CaseStateError):
        agent.verify(c.case_id)


# ------------------------------------------------------------ limits and escalation


def test_budget_exceeded_escalates(runtime, llm, signals):
    runtime.settings = Settings(_env_file=None, max_tool_calls=4)
    c = run_golden(Agent(runtime, llm), signals)
    assert c.status == "ESCALATED"
    assert "budget" in c.escalation_reason
    assert c.tool_call_count == 4


def test_replan_cap_escalates(runtime, llm, signals):
    runtime.settings = Settings(_env_file=None, max_replans=0)
    c = run_golden(Agent(runtime, llm), signals)
    assert c.status == "ESCALATED"
    assert "after 0 replans" in c.escalation_reason


def test_no_disruption_closes_case(runtime, signals):
    scripts = golden_scripts() | {
        "perceive": lambda req, n: tool_call(
            "report_disruption",
            {
                "is_disruption": False,
                "cause": "none",
                "lane": None,
                "location": None,
                "references": [],
                "model_confidence": 0.95,
                "evidence": [{"quote": "izin", "signal": 1, "field": "is_disruption"}],
            },
        )
    }
    agent = Agent(runtime, FakeProvider(scripts))
    c = agent.run(agent.start_case([{"type": "whatsapp", "text": "Bos, besok izin"}]).case_id)
    assert c.status == "RESOLVED" and c.tool_call_count == 0


def test_invalid_llm_output_escalates_after_retry(runtime, signals):
    bad = golden_scripts() | {"perceive": lambda req, n: tool_call("report_disruption", {"x": 1})}
    llm = FakeProvider(bad)
    agent = Agent(runtime, llm)
    c = agent.run(agent.start_case(signals).case_id)
    assert c.status == "ESCALATED" and "report_disruption" in c.escalation_reason
    assert llm.calls["perceive"] == 5  # bounded


def test_assess_rejects_a_delay_that_differs_from_perceive(runtime, signals):
    calls = []

    def assess(req, n):
        calls.append(n)
        if n == 1:  # second turn: wrong delay first
            return tool_call(
                "assess_impact",
                {
                    "material": "MG-2L",
                    "plant": "DC-CKR",
                    "affected_references": ["4500018231"],
                    "delay_hours_min": 24,
                    "delay_hours_max": 36,
                },
            )
        return golden_scripts()["assess"](req, n)

    llm = FakeProvider(golden_scripts() | {"assess": assess})
    agent = Agent(runtime, llm)
    c = agent.run(agent.start_case(signals).case_id)
    assert c.status == "AWAITING_APPROVAL"
    assert c.risk["shortfall"] == 900  # assessed with 48-72 h, not the wrong 24-36 h
    assess_reqs = [r for r in llm.requests if r.purpose == "assess"]
    results = [b for m in assess_reqs[2].messages for b in m["content"] if "toolResult" in b]
    assert "must equal the reported disruption delay" in str(results[-1])


def test_assess_falls_back_to_deterministic_calls(runtime, signals):
    llm = FakeProvider(golden_scripts() | {"assess": lambda req, n: say("Done.")})
    agent = Agent(runtime, llm)
    c = agent.run(agent.start_case(signals).case_id)
    assert c.status == "AWAITING_APPROVAL"
    assert c.risk["shortfall"] == 900
    assert any("deterministic fallback" in e.title for e in runtime.store.list_events(c.case_id))


def test_illegal_stage_transition_is_refused(agent, signals):
    c = agent.start_case(signals)
    with pytest.raises(RuntimeError, match="illegal transition"):
        agent._enter(c.case_id, "ACT")


def test_stage_list():
    assert STAGES == ["PERCEIVE", "ASSESS", "PLAN", "SIMULATE", "REFLECT", "ACT", "VERIFY"]


class ThrottledOnce(FakeProvider):
    """Fake that reports one throttling retry on the first PERCEIVE call."""

    def converse(self, req, on_retry=None):
        if req.purpose == "perceive" and self.calls["perceive"] == 0 and on_retry:
            on_retry(2, 6, 2.0, "throttled")
        return super().converse(req, on_retry)


def test_llm_retry_is_an_event_not_an_error(runtime, signals):
    agent = Agent(runtime, ThrottledOnce(golden_scripts()))
    c = agent.run(agent.start_case(signals).case_id)
    assert c.status == "AWAITING_APPROVAL"
    retry = [e for e in runtime.store.list_events(c.case_id) if e.status == "retry"]
    assert len(retry) == 1 and retry[0].stage == "PERCEIVE"
    assert retry[0].data == {"reason": "throttled", "attempt": 2, "max_attempts": 6, "wait_s": 2.0}
    assert "llm_retry" in {e.kind for e in runtime.audit.read(c.case_id)}
