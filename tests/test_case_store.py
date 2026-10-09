import pytest

from agent.case_store import NotFound, SqliteCaseStore
from tests.conftest import NOW


@pytest.fixture
def store():
    return SqliteCaseStore(":memory:", clock=lambda: NOW)


def test_case_lifecycle(store):
    c = store.create_case(signals=[{"type": "whatsapp", "text": "banjir"}])
    assert c.status == "OPEN" and c.tool_call_count == 0
    store.update_case(c.case_id, status="RUNNING", replan_count=1)
    got = store.get_case(c.case_id)
    assert (got.status, got.replan_count) == ("RUNNING", 1)
    assert store.increment_tool_calls(c.case_id) == 1
    assert store.increment_tool_calls(c.case_id) == 2
    with pytest.raises(NotFound):
        store.get_case("nope")
    with pytest.raises(ValueError):
        store.update_case(c.case_id, status="NOT_A_STATUS")


def test_events_poll_after_seq(store):
    c = store.create_case()
    for stage in ("PERCEIVE", "ASSESS", "PLAN"):
        store.append_event(c.case_id, stage, "done", f"{stage} done", data={"n": 1})
    assert [e.seq for e in store.list_events(c.case_id)] == [0, 1, 2]
    assert [e.stage for e in store.list_events(c.case_id, after=0)] == ["ASSESS", "PLAN"]
    assert store.list_events(c.case_id, after=2) == []


def test_approvals(store):
    c = store.create_case()
    args = {"supplier": "V-2002", "quantity": 500}
    a = store.create_approval(c.case_id, "create_purchase_order", args, {"what": "PO"})
    assert store.get_case(c.case_id).approvals == [a.approval_id]
    assert store.find_valid_approval(c.case_id, "create_purchase_order", args) is None
    decided = store.decide_approval(a.approval_id, True, by="planner")
    assert decided.status == "APPROVED" and decided.decided_by == "planner"
    # key order of args does not matter, values do
    assert store.find_valid_approval(
        c.case_id, "create_purchase_order", {"quantity": 500, "supplier": "V-2002"}
    )
    assert (
        store.find_valid_approval(c.case_id, "create_purchase_order", {**args, "quantity": 1})
        is None
    )
    with pytest.raises(ValueError, match="already APPROVED"):
        store.decide_approval(a.approval_id, False, by="planner")
