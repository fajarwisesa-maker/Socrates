"""WhatsApp inbound (WHATSAPP_INBOUND=1): webhook verification, signature, allowlist, dedupe,
and a demo case opened end to end from a webhook call. Payloads follow the shape in Meta's
`whatsapp` SDK types (src/types/webhooks.ts); no network."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time

import pytest
from fastapi.testclient import TestClient

from agent.pii import mask_sender_id
from agent.providers.fake import FakeProvider
from agent.providers.scripts import golden_scripts
from api.app import create_app as create_case_api
from api.whatsapp import SeenIds, allowed_set, create_app, parse
from siaga_common.settings import REPO_ROOT, Settings

DEMO_TEXT = (REPO_ROOT / "data" / "demo" / "whatsapp_driver.txt").read_text(encoding="utf-8")
SECRET = "app-secret-for-tests"
TOKEN = "verify-token-for-tests"
PHONE = "6281234567890"
NOW = 1_800_000_000


def settings(**kw) -> Settings:
    base = {
        "WHATSAPP_INBOUND": "1",
        "WHATSAPP_VERIFY_TOKEN": TOKEN,
        "WHATSAPP_APP_SECRET": SECRET,
        "WHATSAPP_ALLOWED_SENDERS": "+62 812-3456-7890, IN.1234567890abcdef",
    }
    return Settings(_env_file=None, **(base | kw))


def payload(text=DEMO_TEXT, msg_id="wamid.A1", sender=PHONE, ts=NOW, type_="text", user_id=None):
    msg = {"from": sender, "id": msg_id, "timestamp": str(ts), "type": type_}
    if type_ == "text":
        msg["text"] = {"body": text}
    else:
        msg[type_] = {"id": "media-1", "mime_type": "application/pdf"}
    contact = {"profile": {"name": "Pak Budi"}, "wa_id": sender}
    if user_id:
        contact["user_id"] = user_id
    return {
        "object": "whatsapp_business_account",
        "entry": [{"id": "WABA-1", "changes": [{"field": "messages", "value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "15550000000", "phone_number_id": "PNID"},
            "contacts": [contact],
            "messages": [msg],
        }}]}],
    }  # fmt: skip


def signed(body: dict) -> tuple[bytes, dict[str, str]]:
    raw = json.dumps(body).encode()
    sig = hmac.new(SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return raw, {"X-Hub-Signature-256": f"sha256={sig}", "content-type": "application/json"}


@pytest.fixture
def hook(tmp_path):
    calls = []

    def forward(m):
        calls.append(m)
        return f"case-{len(calls)}"

    app = create_app(
        settings(), forward=forward, seen=SeenIds(tmp_path / "seen.txt"), clock=lambda: NOW + 5
    )
    client = TestClient(app)
    client.calls = calls
    client.seen_path = tmp_path / "seen.txt"
    return client


def post(client, body, headers=None):
    raw, h = signed(body)
    return client.post("/webhooks/whatsapp", content=raw, headers=headers or h)


def test_verification_handshake(hook):
    ok = hook.get("/webhooks/whatsapp", params={"hub.mode": "subscribe",
                  "hub.verify_token": TOKEN, "hub.challenge": "1158201444"})  # fmt: skip
    assert ok.status_code == 200 and ok.text == "1158201444"
    bad = hook.get("/webhooks/whatsapp", params={"hub.mode": "subscribe",
                   "hub.verify_token": "nope", "hub.challenge": "x"})  # fmt: skip
    assert bad.status_code == 401


def test_signature_is_required(hook):
    raw, _ = signed(payload())
    assert hook.post("/webhooks/whatsapp", content=raw).status_code == 401
    wrong = {"X-Hub-Signature-256": "sha256=" + "0" * 64}
    assert hook.post("/webhooks/whatsapp", content=raw, headers=wrong).status_code == 401
    assert hook.calls == []
    assert hook.get("/docs").status_code == 404  # nothing else is served on this port


def test_allowed_text_message_opens_one_case_even_if_redelivered(hook):
    r = post(hook, payload())
    assert r.status_code == 200 and r.json()["received"][0]["case_id"] == "case-1"
    m = hook.calls[0]
    assert m.text == DEMO_TEXT and m.sender == PHONE and m.message_id == "wamid.A1"
    assert post(hook, payload()).json()["received"][0]["result"] == "duplicate"
    assert len(hook.calls) == 1
    # only the message ID is kept, never the text or the number
    assert hook.seen_path.read_text() == "wamid.A1\n"


def test_seen_ids_survive_a_restart(tmp_path):
    seen = SeenIds(tmp_path / "seen.txt")
    seen.add("wamid.X")
    assert "wamid.X" in SeenIds(tmp_path / "seen.txt")


@pytest.mark.parametrize(
    "body,result",
    [
        (payload(sender="6289999999999"), "sender not allowed"),
        (payload(type_="document"), "ignored document"),
        (payload(text="   "), "ignored text"),
        (payload(ts=NOW - 3600), "too old"),
    ],
)
def test_ignored_messages_are_acknowledged(hook, body, result):
    r = post(hook, body)
    assert r.status_code == 200 and r.json()["received"][0]["result"] == result
    assert hook.calls == []


def test_status_updates_are_not_messages(hook):
    body = payload()
    value = body["entry"][0]["changes"][0]["value"]
    value.pop("messages")
    value["statuses"] = [{"id": "wamid.A1", "status": "delivered", "timestamp": str(NOW)}]
    assert post(hook, body).json() == {"received": []}


def test_sender_known_only_by_user_id():
    """Newer payloads: a username sender has a business-scoped user_id and no wa_id."""
    body = payload(sender=None, user_id="IN.1234567890abcdef")
    body["entry"][0]["changes"][0]["value"]["messages"][0]["from_user_id"] = "IN.1234567890abcdef"
    (m,) = parse(body)
    assert m.sender_ids & allowed_set(settings().whatsapp_allowed_senders)
    assert m.sender == "IN.1234567890abcdef"


def test_case_api_down_answers_503_and_meta_retries(tmp_path):
    attempts = []

    def flaky(m):
        attempts.append(m.message_id)
        if len(attempts) == 1:
            raise ConnectionError("Case API down")
        return "case-9"

    seen = SeenIds(tmp_path / "s.txt")
    client = TestClient(create_app(settings(), forward=flaky, seen=seen, clock=lambda: NOW))
    assert post(client, payload()).status_code == 503
    assert post(client, payload()).json()["received"][0]["case_id"] == "case-9"


def test_logs_never_carry_the_text_or_the_number(hook, caplog):
    caplog.set_level(logging.INFO, logger="siaga.whatsapp")
    post(hook, payload())
    post(hook, payload(msg_id="wamid.B", sender="6289999999999"))
    logged = " ".join(r.getMessage() for r in caplog.records)
    assert "opened case" in logged and "+62 ••• 7890" in logged
    assert PHONE not in logged and "6289999999999" not in logged and "Pantura" not in logged


def test_off_by_default_and_needs_its_secrets():
    with pytest.raises(RuntimeError, match="WHATSAPP_INBOUND is off"):
        create_app(Settings(_env_file=None))
    with pytest.raises(RuntimeError, match="WHATSAPP_APP_SECRET"):
        create_app(settings(WHATSAPP_APP_SECRET=""))


def test_mask_sender_id():
    assert mask_sender_id(PHONE) == "+62 ••• 7890"
    assert mask_sender_id("IN.1234567890abcdef") == "IN•••cdef"
    assert mask_sender_id(None) is None


def test_a_webhook_message_opens_the_demo_case(runtime, sap, tmp_path):
    """Webhook -> POST /cases -> the agent: the case knows it came from WhatsApp (masked),
    the audit trail holds the full sender, and the demo still reaches the 11.4M plan."""
    s = Settings(_env_file=None, LLM_PROVIDER="fake", WHATSAPP_INBOUND="1")
    api = TestClient(create_case_api(s, runtime=runtime, llm=FakeProvider(golden_scripts()),
                                     background=False))  # fmt: skip

    def forward(m):
        r = api.post("/cases", data={
            "whatsapp": m.text, "source_channel": "whatsapp_api", "source_ref": m.message_id,
            "source_sender": m.sender, "source_received_at": "2026-10-28T02:00:00+00:00",
        })  # fmt: skip
        r.raise_for_status()
        return r.json()["case_id"]

    hook = TestClient(create_app(settings(), forward=forward,
                                 seen=SeenIds(tmp_path / "s.txt"), clock=lambda: NOW))  # fmt: skip
    with api:
        case_id = post(hook, payload()).json()["received"][0]["case_id"]
        assert api.get("/config").json()["whatsapp_inbound"] is True
        deadline = time.monotonic() + 20
        while (c := api.get(f"/cases/{case_id}").json()["case"])["status"] not in (
            "AWAITING_APPROVAL", "ESCALATED", "RESOLVED"
        ) and time.monotonic() < deadline:  # fmt: skip
            time.sleep(0.05)
        assert c["status"] == "AWAITING_APPROVAL", c["escalation_reason"]
        assert c["summary"]["chosen_cost"] == 11_400_000
        sig = c["signals"][0]
        assert sig["via"] == "whatsapp_api" and sig["sender"] == "+62 ••• 7890"
        assert PHONE not in json.dumps(c)
        audit = api.get(f"/cases/{case_id}/audit").json()["entries"]
        received = next(e for e in audit if e["kind"] == "signal_received")
        assert received["payload"]["sender"] == PHONE
        assert received["payload"]["message_id"] == "wamid.A1"


def test_fill_whatsapp_writes_env_local_without_echoing_the_secret(tmp_path):
    import os
    import shutil
    import stat
    import subprocess

    root = tmp_path / "repo"
    (root / "scripts").mkdir(parents=True)
    shutil.copy(REPO_ROOT / "scripts" / "fill-whatsapp.sh", root / "scripts")
    shutil.copy(REPO_ROOT / ".env.local.example", root / ".env.local")
    r = subprocess.run(
        ["bash", "scripts/fill-whatsapp.sh"], cwd=root, input="s3cr3t-app-secret\n6281234567890\n",
        capture_output=True, text=True, timeout=30, env=os.environ,
    )  # fmt: skip
    assert r.returncode == 0, r.stdout + r.stderr
    assert "s3cr3t-app-secret" not in r.stdout + r.stderr
    env = (root / ".env.local").read_text()
    assert "WHATSAPP_INBOUND=1\n" in env and "WHATSAPP_APP_SECRET=s3cr3t-app-secret\n" in env
    assert "WHATSAPP_ALLOWED_SENDERS=6281234567890\n" in env
    token = next(x for x in env.splitlines() if x.startswith("WHATSAPP_VERIFY_TOKEN="))
    assert len(token.split("=", 1)[1]) == 32 and token.split("=", 1)[1] in r.stdout
    assert env.count("WHATSAPP_INBOUND=") == 1  # replaced in place, not appended twice
    assert stat.S_IMODE((root / ".env.local").stat().st_mode) == 0o600
    assert not (root / ".env.local.bak").exists()
    assert "WHATSAPP_NOTIFY=0\n" in env  # no answer = replies stay off

    # option B: token hidden, phone number ID shown
    r = subprocess.run(
        ["bash", "scripts/fill-whatsapp.sh"], cwd=root,
        input="s3cr3t-app-secret\n6281234567890\ny\nEAAG-s3cr3t-token\n106540352242922\n",
        capture_output=True, text=True, timeout=30, env=os.environ,
    )  # fmt: skip
    assert r.returncode == 0, r.stdout + r.stderr
    assert "EAAG-s3cr3t-token" not in r.stdout + r.stderr
    env = (root / ".env.local").read_text()
    assert "WHATSAPP_NOTIFY=1\n" in env and "WHATSAPP_ACCESS_TOKEN=EAAG-s3cr3t-token\n" in env
    assert "WHATSAPP_PHONE_NUMBER_ID=106540352242922\n" in env
    assert env.count("WHATSAPP_NOTIFY=") == 1
