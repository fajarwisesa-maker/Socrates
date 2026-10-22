"""v2 step 2: specialist Strands agents under the deterministic orchestrator (fake LLM)."""

import pytest

from agent.factory import make_agent
from agent.multi.orchestrator import MultiAgentOrchestrator
from agent.multi.specialists import ORCHESTRATOR, SPECIALISTS
from agent.providers.fake import FakeProvider, say, tool_call
from agent.providers.scripts import golden_scripts
from agent.signals import build_signals
from siaga_common.settings import REPO_ROOT, Settings
from tests.conftest import NOW

DEMO = REPO_ROOT / "data" / "demo"


@pytest.fixture
def signals():
    return build_signals(
        (DEMO / "whatsapp_driver.txt").read_text(encoding="utf-8"), DEMO / "forwarder_notice.pdf"
    )


@pytest.fixture
def multi_runtime(sap, tmp_path):
    from agent.audit import LocalAuditWriter
    from agent.case_store import SqliteCaseStore
    from agent.clients import HttpSapClient, InProcessSolver
    from agent.runtime import build_runtime

    clock = lambda: NOW  # noqa: E731
    return build_runtime(
        Settings(_env_file=None, orchestration="multi"),
        sap=HttpSapClient(client=sap),
        solver=InProcessSolver(),
        store=SqliteCaseStore(":memory:", clock),
        audit=LocalAuditWriter(tmp_path / "audit", clock),
        clock=clock,
    )


@pytest.fixture
def llm():
    return FakeProvider(golden_scripts())


@pytest.fixture
def agent(multi_runtime, llm):
    return make_agent(multi_runtime, llm)


def run_golden(agent, signals):
    case = agent.start_case(signals, day0="2026-10-28T17:00:00Z")
    return agent.run(case.case_id)


def pending(case):
    return next(a for a in case.actions if a["status"] == "PENDING_APPROVAL")


def agent_sequence(store, case_id):
    """(stage, agent) of each stage start, in order."""
    return [(e.stage, e.agent) for e in store.list_events(case_id) if e.status == "started"]


def test_factory_picks_the_orchestrator(agent):
    assert isinstance(agent, MultiAgentOrchestrator)


def test_golden_path_with_specialists(agent, multi_runtime, signals, sap):
    c = run_golden(agent, signals)
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    store = multi_runtime.store
    assert agent_sequence(store, c.case_id) == [
        ("PERCEIVE", "Signal Agent"),
        ("ASSESS", "Impact Agent"),
        ("PLAN", "Planner Agent"),
        ("SIMULATE", "Planner Agent"),
        ("REFLECT", "Critic Agent"),
        ("PLAN", "Planner Agent"),
        ("SIMULATE", "Planner Agent"),
        ("REFLECT", "Critic Agent"),
        ("ACT", "Executor Agent"),
    ]
    events = store.list_events(c.case_id)
    assert all(e.agent for e in events)  # every event names its agent
    assert {e.agent for e in events if e.stage == "CASE"} == {ORCHESTRATOR}

    # golden numbers unchanged (brief §2.2)
    assert c.risk["max_exposure"] == c.risk["expected_exposure"] == 340_000_000
    assert c.risk["shortfall"] == 900
    assert c.replan_count == 1
    assert c.summary["chosen_cost"] == 11_400_000
    assert c.summary["saving_vs_baseline"] == 19_600_000
    rejected = next(f for f in c.critic_findings if not f["clean"])
    assert rejected["option_id"] == "B1"
    assert "safety stock" in rejected["explanation"]  # the Critic Agent's own words
    transfer = next(a for a in c.actions if a["kind"] == "stock_transfer")
    assert (transfer["status"], transfer["tool"], transfer["cost"]) == (
        "EXECUTED",
        "create_stock_transfer",
        3_900_000,
    )
    bridge = pending(c)
    assert (bridge["tool"], bridge["cost"], bridge["tier"]) == (
        "create_purchase_order",
        7_500_000,
        3,
    )
    assert "approve by" in bridge["card"]["summary"] and bridge["card"]["summary_by"] == (
        "Executor Agent"
    )

    # each specialist chose its own tools, within its allowlist and the budget
    tools = [(e.agent, e.data["tool"]) for e in events if e.status == "tool"]
    assert tools == [
        ("Signal Agent", "extract_pdf_text"),
        ("Impact Agent", "find_open_pos"),
        ("Impact Agent", "get_sales_orders"),
        ("Impact Agent", "compute_risk"),
        ("Planner Agent", "search_precedents"),
        ("Planner Agent", "run_solver"),
        ("Planner Agent", "run_solver"),
        ("Critic Agent", "check_business_rules"),
        ("Planner Agent", "run_solver"),
        ("Planner Agent", "run_solver"),
        ("Critic Agent", "check_business_rules"),
        ("Executor Agent", "create_stock_transfer"),
        ("Executor Agent", "request_approval"),
    ]
    allow = {s.name: s.allowlist for s in SPECIALISTS}
    assert all(tool in allow[who] for who, tool in tools)
    assert c.tool_call_count == len(tools) <= 20

    # the audit trail records which agent made each tool call
    audit = multi_runtime.audit.read(c.case_id)
    assert [e.payload.get("agent") for e in audit if e.kind == "tool_call"] == [
        who for who, _ in tools
    ]
    assert multi_runtime.audit.verify(c.case_id).ok


def test_signal_agent_glosses_each_quote(agent, signals):
    c = run_golden(agent, signals)
    ev = {e["quote"]: e for e in c.disruption["evidence"]}
    assert ev["macet total"]["gloss_en"] == "total gridlock"
    assert ev["macet total"]["source"] == "whatsapp"
    assert ev["48–72 hours"]["source"] == "pdf"  # read through extract_pdf_text
    assert c.disruption["confidence"] == "High"


def test_approve_then_verify(agent, multi_runtime, signals, sap):
    c = run_golden(agent, signals)
    c = agent.decide(c.case_id, pending(c)["approval_id"], True, by="planner")
    assert c.status == "VERIFYING", c.escalation_reason
    c = agent.verify(c.case_id)
    assert c.status == "RESOLVED" and c.verification["covered"]
    events = multi_runtime.store.list_events(c.case_id)
    tools = [(e.agent, e.data["tool"]) for e in events if e.status == "tool"]
    assert tools[-2:] == [
        ("Executor Agent", "create_purchase_order"),
        ("Executor Agent", "check_status"),
    ]
    assert c.tool_call_count == 15


def test_reject_bridge_replans_to_air_within_budget(agent, signals, sap):
    c = run_golden(agent, signals)
    c = agent.decide(c.case_id, pending(c)["approval_id"], False, by="planner", reason="quality")
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    air = pending(c)
    assert (air["kind"], air["tool"], air["cost"]) == ("spot_air", "book_spot_air", 31_000_000)
    c = agent.decide(c.case_id, air["approval_id"], True, by="planner")
    c = agent.verify(c.case_id)
    assert c.status == "RESOLVED"
    assert c.tool_call_count <= 20


# ------------------------------------------------------------ the orchestrator's limits


def test_tool_outside_the_allowlist_is_a_hard_error(multi_runtime, signals):
    # the Impact Agent's model asks for an action tool it may not call
    scripts = golden_scripts() | {
        "impact": lambda req, n: tool_call(
            "create_purchase_order",
            {"supplier": "V-2002", "material": "MG-2L", "plant": "DC-CKR", "quantity": 1},
        )
    }
    agent = make_agent(multi_runtime, FakeProvider(scripts))
    c = run_golden(agent, signals)
    assert c.status == "ESCALATED"
    assert "Impact Agent tried to call create_purchase_order" in c.escalation_reason
    audit = multi_runtime.audit.read(c.case_id)
    violation = next(e for e in audit if e.kind == "allowlist_violation")
    assert violation.payload["agent"] == "Impact Agent"
    assert not any(
        e.kind == "tool_call" and e.payload["tool"] == "create_purchase_order" for e in audit
    )


def test_budget_is_enforced_across_agents(sap, tmp_path, signals):
    from agent.audit import LocalAuditWriter
    from agent.case_store import SqliteCaseStore
    from agent.clients import HttpSapClient, InProcessSolver
    from agent.runtime import build_runtime

    clock = lambda: NOW  # noqa: E731
    rt = build_runtime(
        Settings(_env_file=None, orchestration="multi", max_tool_calls=5),
        sap=HttpSapClient(client=sap),
        solver=InProcessSolver(),
        store=SqliteCaseStore(":memory:", clock),
        audit=LocalAuditWriter(tmp_path / "audit", clock),
        clock=clock,
    )
    c = run_golden(make_agent(rt, FakeProvider(golden_scripts())), signals)
    assert c.status == "ESCALATED" and "budget" in c.escalation_reason
    assert c.tool_call_count == 5


def test_replan_cap_is_enforced(sap, tmp_path, signals):
    from agent.audit import LocalAuditWriter
    from agent.case_store import SqliteCaseStore
    from agent.clients import HttpSapClient, InProcessSolver
    from agent.runtime import build_runtime

    clock = lambda: NOW  # noqa: E731
    rt = build_runtime(
        Settings(_env_file=None, orchestration="multi", max_replans=0),
        sap=HttpSapClient(client=sap),
        solver=InProcessSolver(),
        store=SqliteCaseStore(":memory:", clock),
        audit=LocalAuditWriter(tmp_path / "audit", clock),
        clock=clock,
    )
    c = run_golden(make_agent(rt, FakeProvider(golden_scripts())), signals)
    assert c.status == "ESCALATED" and "after 0 replans" in c.escalation_reason


def test_planner_skipping_a_candidate_is_filled_in_by_code(multi_runtime, signals):
    def lazy(req, n):  # simulates only the first candidate, then stops
        if any("toolResult" in b for m in req.messages for b in m["content"][-1:]):
            return say("done")
        return tool_call("run_solver", {"strategies": ["spot_air"]})

    agent = make_agent(multi_runtime, FakeProvider(golden_scripts() | {"planner.simulate": lazy}))
    c = run_golden(agent, signals)
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    assert c.summary["chosen_cost"] == 11_400_000
    fills = [
        e
        for e in multi_runtime.store.list_events(c.case_id)
        if e.agent == ORCHESTRATOR and "did not simulate" in e.title
    ]
    assert fills  # visible, attributed to the orchestrator


def test_invalid_output_escalates_bounded(multi_runtime, signals):
    llm = FakeProvider(
        golden_scripts()
        | {
            "signal": lambda req, n: (
                tool_call("extract_pdf_text", {"signal": 2})
                if n == 0
                else tool_call("report_disruption", {"x": 1})
            )
        }
    )
    c = run_golden(make_agent(multi_runtime, llm), signals)
    assert c.status == "ESCALATED" and "report_disruption" in c.escalation_reason
    assert llm.calls["signal"] <= 7  # 5 turns + one nudge (2 turns)


def test_v1_runtime_is_refused(runtime, llm):
    with pytest.raises(RuntimeError, match="ORCHESTRATION=multi"):
        MultiAgentOrchestrator(runtime, llm)


def test_committed_multi_recording_replays_end_to_end(multi_runtime, signals):
    from agent.providers.replay import ReplayProvider

    path = multi_runtime.settings.replay_path
    assert path.parts[-2:] == ("multi", "llm.jsonl")
    agent = make_agent(multi_runtime, ReplayProvider(path))
    c = run_golden(agent, signals)
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    c = agent.decide(c.case_id, pending(c)["approval_id"], True, by="planner")
    assert agent.verify(c.case_id).status == "RESOLVED"
