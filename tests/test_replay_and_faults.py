"""Phase 6: golden recording + replay (no network), fault injection, rehearse."""

import time
from datetime import timedelta

import pytest

from agent.machine import Agent
from agent.providers.fake import FakeProvider
from agent.providers.replay import RecordingProvider, ReplayProvider
from agent.providers.scripts import golden_scripts
from agent.signals import build_signals
from services.sap_mock.seed import reset_store
from siaga_common.settings import REPO_ROOT
from tests.conftest import DAY0_DATE, NOW

DEMO = REPO_ROOT / "data" / "demo"
GOLDEN = REPO_ROOT / "data" / "golden" / "llm.jsonl"


@pytest.fixture
def signals():
    return build_signals((DEMO / "whatsapp_driver.txt").read_text(), DEMO / "forwarder_notice.pdf")


@pytest.fixture
def no_network(monkeypatch):
    """Any attempt to build an AWS client fails the test."""
    import boto3

    def boom(*a, **k):
        raise AssertionError("replay must not touch AWS")

    monkeypatch.setattr(boto3, "client", boom)


def run_and_approve(agent, signals):
    c = agent.run(agent.start_case(signals).case_id)
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    pending = next(a for a in c.actions if a["status"] == "PENDING_APPROVAL")
    c = agent.decide(c.case_id, pending["approval_id"], True, by="test")
    return agent.verify(c.case_id)


def test_record_then_replay_twice_without_network(
    runtime, signals, tmp_path, no_network, sap_store
):
    path = tmp_path / "llm.jsonl"
    recorded = run_and_approve(
        Agent(runtime, RecordingProvider(FakeProvider(golden_scripts()), path)), signals
    )
    assert recorded.status == "RESOLVED"
    replay = Agent(runtime, ReplayProvider(path))
    for _ in range(2):  # positions are per case: the same recording serves every case
        reset_store(sap_store, DAY0_DATE)  # every demo run starts from the seed state
        c = run_and_approve(replay, signals)
        assert c.status == "RESOLVED"
        assert c.chosen_option == "B2" and c.summary["chosen_cost"] == 11_400_000
        llm_events = [e for e in runtime.store.list_events(c.case_id) if e.status == "llm"]
        assert llm_events and all(e.data["model"].startswith("replay:") for e in llm_events)


def test_committed_golden_recording_still_replays(runtime, signals, no_network):
    """If prompts or stage flow change, re-record with `make record-golden`."""
    c = run_and_approve(Agent(runtime, ReplayProvider(GOLDEN)), signals)
    assert c.status == "RESOLVED"
    assert c.summary["chosen_cost"] == 11_400_000 and c.replan_count == 1


def test_leaving_the_golden_path_escalates_clearly(runtime, signals, no_network):
    agent = Agent(runtime, ReplayProvider(GOLDEN))
    c = agent.run(agent.start_case(signals).case_id)
    pending = next(a for a in c.actions if a["status"] == "PENDING_APPROVAL")
    c = agent.decide(
        c.case_id, pending["approval_id"], False, by="test", reason="not in the recording"
    )
    assert c.status == "ESCALATED"
    assert "golden path" in c.escalation_reason


# ------------------------------------------------------------ fault injection (decision 4)


@pytest.mark.parametrize("event", ["transfer_delayed", "po_cancelled"])
def test_injected_fault_fails_verify_and_reopens(runtime, signals, sap, event):
    agent = Agent(runtime, FakeProvider(golden_scripts()))
    c = agent.run(agent.start_case(signals).case_id)
    pending = next(a for a in c.actions if a["status"] == "PENDING_APPROVAL")
    c = agent.decide(c.case_id, pending["approval_id"], True, by="test")
    r = sap.post("/admin/inject", json={"event": event})
    assert r.status_code == 200, r.text
    c = agent.verify(c.case_id)
    assert c.status == "REOPENED"
    assert not c.verification["covered"]
    failed = [x for x in c.verification["checks"] if not x["ok"]]
    assert len(failed) == 1
    events = runtime.store.list_events(c.case_id)
    assert any(e.status == "reopened" for e in events)


def test_inject_needs_something_to_hit(sap):
    r = sap.post("/admin/inject", json={"event": "transfer_delayed"})
    assert r.status_code == 404


# ------------------------------------------------------------ rehearse


def test_rehearse_one_run_in_process(monkeypatch, tmp_path):
    from scripts import rehearse

    monkeypatch.setenv("LLM_PROVIDER", "fake")
    from siaga_common.settings import get_settings

    get_settings.cache_clear()
    try:
        # VERIFY must not fire before the fault is injected, so keep a short delay.
        with rehearse.api_client(None, local=True, verify_delay=2) as (client, target):
            assert "in-process" in target
            ok = rehearse.one_run(client, 1, None, timeout=30, verify_wait=5)
            assert ok["ok"], ok.get("error")
            assert ok["po"] == "4500018232"
            fault = rehearse.one_run(client, 2, "transfer_delayed", timeout=30, verify_wait=5)
            assert fault["ok"], fault.get("error")
    finally:
        get_settings.cache_clear()


def test_api_inject_passthrough(runtime, sap):
    from fastapi.testclient import TestClient

    from api.app import create_app

    app = create_app(
        runtime=runtime,
        llm=FakeProvider(golden_scripts()),
        reset_sap=lambda: sap.post("/admin/reset", json={"day0": "2026-10-29"}).json(),
        background=False,
    )
    with TestClient(app) as api:
        assert api.post("/demo/inject", json={"event": "transfer_delayed"}).status_code == 404
        assert "/demo/inject" not in api.get("/openapi.json").json()["paths"]  # hidden
        r = api.post(
            "/cases",
            data={"whatsapp": (DEMO / "whatsapp_driver.txt").read_text()},
        )
        case_id = r.json()["case_id"]
        deadline = time.monotonic() + 10
        while api.get(f"/cases/{case_id}").json()["case"]["status"] != "AWAITING_APPROVAL":
            assert time.monotonic() < deadline
            time.sleep(0.05)
        assert api.post("/demo/inject", json={"event": "transfer_delayed"}).status_code == 200
        runtime.clock = lambda: NOW + timedelta(hours=1)
