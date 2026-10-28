"""WhatsApp option B (WHATSAPP_NOTIFY=1): one reply with the outcome when a WhatsApp case ends.
The Cloud API is replaced by httpx.MockTransport; no network."""

from __future__ import annotations

import json
import logging
from datetime import timedelta

import httpx
import pytest
from fastapi.testclient import TestClient

from agent.case_store import CaseRecord
from agent.providers.fake import FakeProvider
from agent.providers.scripts import golden_scripts
from api.app import create_app
from api.whatsapp_notify import CloudApiSender, NotifyError, OutcomeNotifier, outcome_text
from siaga_common.money import format_juta
from siaga_common.settings import REPO_ROOT, Settings
from tests.conftest import NOW
from tests.test_api import start_demo_case, wait_status

DEMO_TEXT = (REPO_ROOT / "data" / "demo" / "whatsapp_driver.txt").read_text(encoding="utf-8")
PHONE = "6281234567890"
TOKEN = "EAAG-test-access-token"


def settings(**kw) -> Settings:
    base = {
        "WHATSAPP_NOTIFY": "1",
        "WHATSAPP_ACCESS_TOKEN": TOKEN,
        "WHATSAPP_PHONE_NUMBER_ID": "106540352242922",
    }
    return Settings(_env_file=None, **(base | kw))


class Graph:
    """A stand-in for the Cloud API messages endpoint."""

    def __init__(self, status: int = 200, error: str = ""):
        self.requests: list[httpx.Request] = []
        self.status, self.error = status, error

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status >= 400:
            return httpx.Response(self.status, json={"error": {"message": self.error, "code": 190}})
        n = len(self.requests)
        return httpx.Response(200, json={"messaging_product": "whatsapp",
                                         "messages": [{"id": f"wamid.OUT{n}"}]})  # fmt: skip

    def bodies(self) -> list[dict]:
        return [json.loads(r.content) for r in self.requests]


def sender(graph: Graph, **kw) -> CloudApiSender:
    return CloudApiSender(settings(**kw), transport=httpx.MockTransport(graph))


def test_format_juta_matches_the_dashboard():
    assert format_juta(340_000_000) == "Rp 340 jt"
    assert format_juta(11_400_000) == "Rp 11,4 jt"
    assert format_juta(34_900_000) == "Rp 34,9 jt"
    assert format_juta(11_450_000) == "Rp 11,5 jt"  # half up, as web/lib/format.ts


def case(status: str, **kw) -> CaseRecord:
    base = {
        "case_id": "case-1a2b3c4d5e",
        "status": status,
        "created_at": "2026-10-28T02:00:00Z",
        "updated_at": "2026-10-28T02:00:00Z",
    }
    return CaseRecord.model_validate(base | kw)


def test_outcome_text_per_status():
    resolved = case(
        "RESOLVED",
        summary={
            "exposure_avoided": 340_000_000,
            "case_cost": 11_400_000,
            "chosen_cost": 11_400_000,
        },
        verification={"verified_at": "2026-10-28T02:00:52Z"},
    )
    assert outcome_text(resolved) == (
        "SIAGA #1a2b3c: resolved. Rp 340 jt protected for Rp 11,4 jt. Signal to verified in "
        "0m 52s. The plan is executed in SAP and verified."
    )
    esc = outcome_text(case("ESCALATED", escalation_reason="replan limit reached"))
    assert esc.startswith("SIAGA #1a2b3c: handed to a planner. replan limit reached.")
    assert "audit trail" in esc
    assert "re-opened" in outcome_text(case("REOPENED"))


def test_cloud_api_request_shape():
    graph = Graph()
    msg_id = sender(graph).send(PHONE, "hello", "wamid.IN1")
    assert msg_id == "wamid.OUT1"
    (req,) = graph.requests
    assert str(req.url) == "https://graph.facebook.com/v26.0/106540352242922/messages"
    assert req.headers["authorization"] == f"Bearer {TOKEN}"
    assert graph.bodies()[0] == {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "type": "text",
        "text": {"body": "hello", "preview_url": False},
        "to": PHONE,
        "context": {"message_id": "wamid.IN1"},
    }
    # a sender known only by a business-scoped user ID goes in `recipient`
    sender(graph).send("IN.1234567890abcdef", "hello", None)
    body = graph.bodies()[1]
    assert body["recipient"] == "IN.1234567890abcdef" and "to" not in body
    assert "context" not in body


def test_check_reads_the_phone_number_without_sending():
    seen = []

    def graph(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"display_phone_number": "+1 555-096-7852",
                                         "verified_name": "Test Number", "id": "1"})  # fmt: skip

    s = CloudApiSender(settings(), transport=httpx.MockTransport(graph))
    assert s.check() == "+1 555-096-7852 (Test Number)"
    (req,) = seen
    assert req.method == "GET" and req.url.path == "/v26.0/106540352242922"
    with pytest.raises(NotifyError, match="HTTP 401"):
        sender(Graph(401, "Session has expired")).check()


def test_cloud_api_errors_and_missing_values():
    with pytest.raises(NotifyError, match="HTTP 401 Error validating access token") as e:
        sender(Graph(401, "Error validating access token")).send(PHONE, "x", None)
    assert e.value.status == 401 and TOKEN not in str(e.value)
    with pytest.raises(RuntimeError, match="WHATSAPP_ACCESS_TOKEN"):
        CloudApiSender(settings(WHATSAPP_ACCESS_TOKEN=""))


def webhook_case(api) -> str:
    r = api.post("/cases", data={
        "whatsapp": DEMO_TEXT, "source_channel": "whatsapp_api", "source_ref": "wamid.IN1",
        "source_sender": PHONE, "source_received_at": "2026-10-28T02:00:00+00:00",
    })  # fmt: skip
    assert r.status_code == 202, r.text
    return r.json()["case_id"]


@pytest.fixture
def wa_api(runtime, sap, request):
    graph = Graph(*getattr(request, "param", ()))
    app = create_app(
        Settings(_env_file=None, LLM_PROVIDER="fake"),
        runtime=runtime,
        llm=FakeProvider(golden_scripts()),
        reset_sap=lambda: sap.post("/admin/reset", json={"day0": "2026-10-29"}).json(),
        background=False,
        notifier=OutcomeNotifier(sender(graph)),
    )
    with TestClient(app) as client:
        client.graph = graph
        yield client


def approve_and_verify(api, runtime, case_id):
    wait_status(api, case_id, "AWAITING_APPROVAL")
    approval = next(a for a in api.get(f"/cases/{case_id}").json()["approvals"]
                    if a["status"] == "PENDING")  # fmt: skip
    api.post(f"/cases/{case_id}/approvals/{approval['approval_id']}", json={"decision": "approve"})
    wait_status(api, case_id, "VERIFYING")
    runtime.clock = lambda: NOW + timedelta(seconds=61)
    assert api.app.state.service.tick() == [case_id]
    return wait_status(api, case_id, "RESOLVED")


def test_whatsapp_case_gets_one_reply_with_the_outcome(wa_api, runtime, caplog):
    caplog.set_level(logging.INFO, logger="siaga.whatsapp")
    case_id = webhook_case(wa_api)
    wait_status(wa_api, case_id, "AWAITING_APPROVAL")
    assert wa_api.graph.requests == []  # nothing while it waits for approval
    approve_and_verify(wa_api, runtime, case_id)

    (body,) = wa_api.graph.bodies()
    assert body["to"] == PHONE and body["context"] == {"message_id": "wamid.IN1"}
    assert "Rp 340 jt protected for Rp 11,4 jt" in body["text"]["body"]
    assert wa_api.get("/config").json()["whatsapp_notify"] is True

    events = wa_api.get(f"/cases/{case_id}/events").json()["events"]
    sent = [e for e in events if e["title"].startswith("Outcome sent on WhatsApp")]
    assert len(sent) == 1 and sent[0]["title"].endswith("+62 ••• 7890")
    audit = wa_api.get(f"/cases/{case_id}/audit").json()
    assert audit["verification"]["ok"]
    entry = next(e for e in audit["entries"] if e["kind"] == "notification_sent")
    assert entry["payload"]["status"] == "RESOLVED" and entry["payload"]["to"] == PHONE
    assert entry["payload"]["message_id"] == "wamid.OUT1"
    # the token is nowhere; the full number is only in the audit trail
    everything = json.dumps(audit) + json.dumps(events) + caplog.text
    assert TOKEN not in everything
    assert PHONE not in json.dumps(events) + caplog.text

    # another job on the same finished case sends nothing new
    wa_api.app.state.service.notifier.after_job(runtime, case_id)
    assert len(wa_api.graph.requests) == 1


def test_cases_from_the_dashboard_get_no_reply(wa_api, runtime):
    case_id = start_demo_case(wa_api)
    approve_and_verify(wa_api, runtime, case_id)
    assert wa_api.graph.requests == []


@pytest.mark.parametrize("wa_api", [(401, "Error validating access token")], indirect=True)
def test_a_failed_reply_is_audited_and_the_case_is_unchanged(wa_api, runtime):
    case_id = webhook_case(wa_api)
    approve_and_verify(wa_api, runtime, case_id)
    assert len(wa_api.graph.requests) == 1
    events = wa_api.get(f"/cases/{case_id}/events").json()["events"]
    warn = next(e for e in events if e["title"] == "WhatsApp reply not sent")
    assert "HTTP 401" in json.dumps(warn)
    audit = wa_api.get(f"/cases/{case_id}/audit").json()
    failed = next(e for e in audit["entries"] if e["kind"] == "notification_failed")
    assert failed["payload"]["status"] == "RESOLVED" and audit["verification"]["ok"]
    assert wa_api.get(f"/cases/{case_id}").json()["case"]["status"] == "RESOLVED"
    # not retried on every later job (a failure counts as handled for that status)
    wa_api.app.state.service.notifier.after_job(runtime, case_id)
    assert len(wa_api.graph.requests) == 1


def test_off_by_default():
    s = Settings(_env_file=None)
    assert s.whatsapp_notify is False
    assert s.whatsapp_graph_version == "26.0"
