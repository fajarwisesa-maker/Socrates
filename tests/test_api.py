"""Case API end to end with the fake LLM: start -> poll -> approve -> VERIFY -> audit."""

import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from agent.providers.fake import FakeProvider
from agent.providers.scripts import golden_scripts
from api.app import create_app
from siaga_common.settings import REPO_ROOT
from tests.conftest import NOW

DEMO = REPO_ROOT / "data" / "demo"


@pytest.fixture
def api(runtime, sap):
    resets = []

    def reset_sap():
        resets.append(1)
        return sap.post("/admin/reset", json={"day0": "2026-10-29"}).json()

    app = create_app(
        runtime=runtime,
        llm=FakeProvider(golden_scripts()),
        reset_sap=reset_sap,
        background=False,  # the test drives the VERIFY scheduler with tick()
    )
    with TestClient(app) as client:
        client.resets = resets
        yield client


def wait_status(api, case_id, *statuses, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        case = api.get(f"/cases/{case_id}").json()["case"]
        if case["status"] in statuses:
            return case
        time.sleep(0.05)
    raise AssertionError(f"case stuck in {case['status']}, wanted {statuses}")


def start_demo_case(api):
    r = api.post(
        "/cases",
        data={"whatsapp": (DEMO / "whatsapp_driver.txt").read_text()},
        files={
            "pdf": (
                "forwarder_notice.pdf",
                (DEMO / "forwarder_notice.pdf").read_bytes(),
                "application/pdf",
            )
        },
    )
    assert r.status_code == 202, r.text
    return r.json()["case_id"]


def test_full_case_over_http(api, runtime):
    case_id = start_demo_case(api)
    case = wait_status(api, case_id, "AWAITING_APPROVAL")
    assert case["chosen_option"] == "B2"
    assert case["signals"][1]["filename"] == "forwarder_notice.pdf"
    assert "4500018231" in case["signals"][1]["text"]

    # event polling with ?after=
    first = api.get(f"/cases/{case_id}/events").json()
    assert first["events"][0]["seq"] == 0
    tail = api.get(f"/cases/{case_id}/events", params={"after": first["last_seq"] - 3}).json()
    assert [e["seq"] for e in tail["events"]] == list(
        range(first["last_seq"] - 2, first["last_seq"] + 1)
    )

    # approve the bridge PO
    body = api.get(f"/cases/{case_id}").json()
    approval = next(a for a in body["approvals"] if a["status"] == "PENDING")
    assert approval["card"]["approve_by_display"] == "Day 1 18:00 · Fri 30 Oct WIB"
    r = api.post(
        f"/cases/{case_id}/approvals/{approval['approval_id']}", json={"decision": "approve"}
    )
    assert r.status_code == 202
    case = wait_status(api, case_id, "VERIFYING")
    po = next(a for a in case["actions"] if a["kind"] == "alternate_supplier")
    assert po["sap_ref"] == "4500018232"

    # VERIFY fires once verify_due_at has passed
    service = api.app.state.service
    assert service.tick() == []  # not due yet
    runtime.clock = lambda: NOW + timedelta(seconds=61)
    assert service.tick() == [case_id]
    case = wait_status(api, case_id, "RESOLVED")
    assert case["verification"]["covered"]

    audit = api.get(f"/cases/{case_id}/audit").json()
    assert audit["verification"]["ok"]
    assert {"policy_decision", "tool_call", "approval", "llm_call"} <= {
        e["kind"] for e in audit["entries"]
    }


def test_reject_with_reason(api):
    case_id = start_demo_case(api)
    wait_status(api, case_id, "AWAITING_APPROVAL")
    approval = next(
        a for a in api.get(f"/cases/{case_id}").json()["approvals"] if a["status"] == "PENDING"
    )
    r = api.post(
        f"/cases/{case_id}/approvals/{approval['approval_id']}",
        json={"decision": "reject", "reason": "supplier on hold"},
    )
    assert r.status_code == 202
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        case = api.get(f"/cases/{case_id}").json()["case"]
        if case["replan_count"] == 2 and case["status"] == "AWAITING_APPROVAL":
            break
        time.sleep(0.05)
    assert case["rejection_reasons"][0].endswith("supplier on hold")
    assert (
        next(a for a in case["actions"] if a["status"] == "PENDING_APPROVAL")["kind"] == "spot_air"
    )


def test_errors(api):
    assert api.post("/cases", data={}).status_code == 422
    assert api.get("/cases/nope").status_code == 404
    case_id = start_demo_case(api)
    wait_status(api, case_id, "AWAITING_APPROVAL")
    r = api.post(f"/cases/{case_id}/approvals/apr-unknown", json={"decision": "approve"})
    assert r.status_code == 409
    bad = api.post("/cases", files={"pdf": ("x.pdf", b"not a pdf", "application/pdf")})
    assert bad.status_code == 422


def test_demo_inputs_config_and_reset(api):
    assert "Brebes" in api.get("/demo/inputs/whatsapp").text
    pdf = api.get("/demo/inputs/pdf")
    assert pdf.headers["content-type"] == "application/pdf" and pdf.content[:4] == b"%PDF"
    cfg = api.get("/config").json()
    assert cfg["llm_provider"] == "fake" and cfg["max_tool_calls"] == 20
    case_id = start_demo_case(api)
    wait_status(api, case_id, "AWAITING_APPROVAL")
    r = api.post("/demo/reset")
    assert r.status_code == 200 and api.resets == [1]
    assert api.get("/cases").json()["cases"] == []
