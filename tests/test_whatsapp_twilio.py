"""WhatsApp through Twilio (WHATSAPP_PROVIDER=twilio): the sandbox webhook (signature,
allowlist, dedupe) and the outcome reply through Twilio's Messages API. No network."""

from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
from base64 import b64encode
from datetime import timedelta
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from agent.providers.fake import FakeProvider
from agent.providers.scripts import golden_scripts
from api.app import create_app as create_case_api
from api.whatsapp import SeenIds, create_app, twilio_signature, twilio_signature_ok
from api.whatsapp_notify import NotifyError, OutcomeNotifier, TwilioSender, make_sender
from scripts import env_mode
from siaga_common.settings import REPO_ROOT, Settings
from tests.conftest import NOW
from tests.test_api import wait_status

DEMO_TEXT = (REPO_ROOT / "data" / "demo" / "whatsapp_driver.txt").read_text(encoding="utf-8")
TOKEN = "twilio-auth-token-for-tests"
SID = "AC" + "0" * 32
PHONE = "6281234567890"
PUBLIC = "https://example.trycloudflare.com/webhooks/twilio"


def settings(**kw) -> Settings:
    base = {
        "WHATSAPP_INBOUND": "1",
        "WHATSAPP_PROVIDER": "twilio",
        "TWILIO_ACCOUNT_SID": SID,
        "TWILIO_AUTH_TOKEN": TOKEN,
        "WHATSAPP_ALLOWED_SENDERS": PHONE,
    }
    return Settings(_env_file=None, **(base | kw))


def form(sid="SM0001", sender=PHONE, body=DEMO_TEXT, media=0, channel="whatsapp:") -> dict:
    return {
        "MessageSid": sid, "SmsMessageSid": sid, "AccountSid": SID,
        "From": f"{channel}+{sender}", "To": "whatsapp:+14155238886", "WaId": sender,
        "ProfileName": "Pak Budi", "Body": body, "NumMedia": str(media),
    }  # fmt: skip


def post(client, data: dict, url: str = PUBLIC, signed_url: str | None = None, sig=None):
    """A call as it arrives through the tunnel: http to 127.0.0.1, public host forwarded."""
    params = {k: [v] for k, v in data.items()}
    signature = sig if sig is not None else twilio_signature(TOKEN, signed_url or url, params)
    host = httpx.URL(url).host
    return client.post(
        "/webhooks/twilio",
        data=data,
        headers={"X-Twilio-Signature": signature, "Host": host, "X-Forwarded-Proto": "https"},
    )


@pytest.fixture
def hook(tmp_path):
    calls = []

    def forward(m):
        calls.append(m)
        return f"case-{len(calls)}"

    client = TestClient(
        create_app(settings(), forward=forward, seen=SeenIds(tmp_path / "s.txt")),
        base_url="http://127.0.0.1:8010",
    )
    client.calls = calls
    return client


def test_signature_matches_twilios_sdk():
    """Vector computed with twilio 9.12.0 RequestValidator.compute_signature."""
    params = {"MessageSid": "SM0123", "From": "whatsapp:+6281234567890", "WaId": "6281234567890",
              "Body": "Bos, lalin Pantura macet total", "NumMedia": "0",
              "ProfileName": "Pak Budi"}  # fmt: skip
    url = "https://example.trycloudflare.com/webhooks/twilio"
    p = {k: [v] for k, v in params.items()}
    assert twilio_signature("12345-test-auth-token", url, p) == "dJ+5IenIYboThOYAeeMBlEAvk4M="
    # signed with an explicit :443 (the SDK checks both forms), or the other way round
    with_port = url.replace(".com/", ".com:443/")
    assert twilio_signature_ok(TOKEN, [url], p, twilio_signature(TOKEN, with_port, p))
    assert twilio_signature_ok(TOKEN, [with_port], p, twilio_signature(TOKEN, url, p))
    assert not twilio_signature_ok(TOKEN, [url], p, "AAAA")
    assert not twilio_signature_ok(TOKEN, [url], p, None)


def test_allowed_message_opens_one_case(hook):
    r = post(hook, form())
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/xml")
    assert "<Response></Response>" in r.text  # no automatic reply from Twilio
    (m,) = hook.calls
    assert m.text == DEMO_TEXT and m.sender == PHONE and m.message_id == "SM0001"
    post(hook, form())  # the same MessageSid again
    assert len(hook.calls) == 1


def test_signature_is_required(hook):
    assert post(hook, form(), sig="").status_code == 401
    assert post(hook, form(), sig=b64encode(b"x" * 20).decode()).status_code == 401
    # signed for another URL
    assert post(hook, form(), signed_url="https://evil.example/webhooks/twilio").status_code == 401
    assert hook.calls == []
    # the Meta routes are not served in Twilio mode
    assert hook.get("/webhooks/whatsapp").status_code in (404, 405)


@pytest.mark.parametrize(
    "data",
    [
        form(sender="6289999999999"),  # not allowed
        form(media=1, body=""),  # an image
        form(channel=""),  # an SMS to the Twilio number, not WhatsApp
        form(body="  "),
    ],
)
def test_ignored_messages(hook, data):
    r = post(hook, data)
    assert r.status_code == 200 and hook.calls == []


def test_configured_webhook_url_wins(tmp_path):
    calls = []
    url = "https://fixed.ngrok.app/webhooks/twilio"
    app = create_app(
        settings(TWILIO_WEBHOOK_URL=url),
        forward=lambda m: calls.append(m) or "case-1",
        seen=SeenIds(tmp_path / "s.txt"),
    )
    client = TestClient(app, base_url="http://127.0.0.1:8010")
    # the tunnel passed another host, but the signature is for the configured URL
    assert post(client, form(), url=PUBLIC, signed_url=url).status_code == 200
    assert len(calls) == 1


def test_case_api_down_answers_503_and_the_message_can_come_again(tmp_path):
    attempts = []

    def flaky(m):
        attempts.append(m)
        if len(attempts) == 1:
            raise ConnectionError("down")
        return "case-2"

    app = create_app(settings(), forward=flaky, seen=SeenIds(tmp_path / "s.txt"))
    client = TestClient(app, base_url="http://127.0.0.1:8010")
    assert post(client, form()).status_code == 503
    assert post(client, form()).status_code == 200 and len(attempts) == 2


def test_needs_the_auth_token_not_the_meta_values():
    with pytest.raises(RuntimeError, match="TWILIO_AUTH_TOKEN"):
        create_app(settings(TWILIO_AUTH_TOKEN=""))
    create_app(settings())  # no WHATSAPP_VERIFY_TOKEN / APP_SECRET needed


class Twilio:
    """A stand-in for Twilio's REST API."""

    def __init__(self, status: int = 201):
        self.requests: list[httpx.Request] = []
        self.status = status

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.status >= 400:
            return httpx.Response(self.status, json={
                "code": 20003, "message": "Authenticate", "status": self.status,
                "more_info": "https://www.twilio.com/docs/errors/20003",
            })  # fmt: skip
        if request.method == "GET":
            return httpx.Response(200, json={"sid": SID, "status": "active"})
        return httpx.Response(201, json={"sid": f"SMout{len(self.requests)}", "status": "queued"})

    def forms(self) -> list[dict]:
        return [
            {k: v[0] for k, v in parse_qs(r.content.decode()).items()}
            for r in self.requests
            if r.method == "POST"
        ]


def twilio_sender(api: Twilio, **kw) -> TwilioSender:
    return TwilioSender(settings(**kw), transport=httpx.MockTransport(api))


def test_twilio_send_request_shape():
    api = Twilio()
    assert twilio_sender(api).send(PHONE, "hello", "SM0001") == "SMout1"
    (req,) = api.requests
    assert str(req.url) == f"https://api.twilio.com/2010-04-01/Accounts/{SID}/Messages.json"
    assert req.headers["authorization"] == "Basic " + b64encode(f"{SID}:{TOKEN}".encode()).decode()
    assert api.forms() == [
        {"To": f"whatsapp:+{PHONE}", "From": "whatsapp:+14155238886", "Body": "hello"}
    ]
    assert twilio_sender(api).check() == "+14155238886 (account active)"
    assert isinstance(make_sender(settings(WHATSAPP_NOTIFY="1")), TwilioSender)


def test_twilio_errors():
    with pytest.raises(NotifyError, match=r"HTTP 401 Authenticate \(Twilio error 20003\)") as e:
        twilio_sender(Twilio(401)).send(PHONE, "x", None)
    assert TOKEN not in str(e.value)
    with pytest.raises(NotifyError, match="no phone number"):
        twilio_sender(Twilio()).send("IN.abcdef", "x", None)
    with pytest.raises(RuntimeError, match="TWILIO_ACCOUNT_SID"):
        TwilioSender(settings(TWILIO_ACCOUNT_SID=""))


def test_a_twilio_message_runs_the_demo_and_gets_one_reply(runtime, sap, tmp_path):
    """Sandbox webhook -> POST /cases -> approve -> VERIFY -> one reply through Twilio."""
    twilio = Twilio()
    s = Settings(_env_file=None, LLM_PROVIDER="fake", WHATSAPP_INBOUND="1")
    api = TestClient(create_case_api(
        s, runtime=runtime, llm=FakeProvider(golden_scripts()), background=False,
        reset_sap=lambda: sap.post("/admin/reset", json={"day0": "2026-10-29"}).json(),
        notifier=OutcomeNotifier(twilio_sender(twilio)),
    ))  # fmt: skip

    def forward(m):
        r = api.post("/cases", data={
            "whatsapp": m.text, "source_channel": "whatsapp_api", "source_ref": m.message_id,
            "source_sender": m.sender, "source_received_at": "2026-10-28T02:00:00+00:00",
        })  # fmt: skip
        r.raise_for_status()
        return r.json()["case_id"]

    hook = TestClient(create_app(settings(), forward=forward, seen=SeenIds(tmp_path / "s.txt")),
                      base_url="http://127.0.0.1:8010")  # fmt: skip
    with api:
        assert post(hook, form()).status_code == 200
        case_id = api.get("/cases").json()["cases"][0]["case_id"]
        c = wait_status(api, case_id, "AWAITING_APPROVAL")
        assert c["summary"]["chosen_cost"] == 11_400_000
        assert c["signals"][0]["sender"] == "+62 ••• 7890"
        assert twilio.requests == []
        approval = next(a for a in api.get(f"/cases/{case_id}").json()["approvals"]
                        if a["status"] == "PENDING")  # fmt: skip
        api.post(f"/cases/{case_id}/approvals/{approval['approval_id']}",
                 json={"decision": "approve"})  # fmt: skip
        wait_status(api, case_id, "VERIFYING")
        runtime.clock = lambda: NOW + timedelta(seconds=61)
        api.app.state.service.tick()
        wait_status(api, case_id, "RESOLVED")
        (sent,) = twilio.forms()
        assert sent["To"] == f"whatsapp:+{PHONE}"
        assert "Rp 340 jt protected for Rp 11,4 jt" in sent["Body"]
        audit = api.get(f"/cases/{case_id}/audit").json()
        entry = next(e for e in audit["entries"] if e["kind"] == "notification_sent")
        assert entry["payload"]["message_id"] == "SMout1"
        assert TOKEN not in json.dumps(audit)
        assert api.get("/config").json()["whatsapp_provider"] == "meta"  # this API's settings


def test_env_check_asks_for_the_twilio_values_not_the_meta_ones(tmp_path, monkeypatch):
    for k in list(os.environ):
        if k.startswith(("WHATSAPP_", "TWILIO_")):
            monkeypatch.delenv(k)
    env = tmp_path / ".env"
    base = (REPO_ROOT / ".env.local.example").read_text(encoding="utf-8")
    env.write_text(
        base.replace("<set-me>", "x")
        + f"WHATSAPP_INBOUND=1\nWHATSAPP_PROVIDER=twilio\nWHATSAPP_NOTIFY=1\n"
        f"WHATSAPP_ALLOWED_SENDERS={PHONE}\nTWILIO_ACCOUNT_SID={SID}\n",
        encoding="utf-8",
    )
    _, problems = env_mode.check(env, lambda *_: None)
    assert problems == ["TWILIO_AUTH_TOKEN missing"]


def test_fill_twilio_writes_env_local_without_echoing_the_token(tmp_path):
    root = tmp_path / "repo"
    (root / "scripts").mkdir(parents=True)
    shutil.copy(REPO_ROOT / "scripts" / "fill-twilio.sh", root / "scripts")
    shutil.copy(REPO_ROOT / ".env.local.example", root / ".env.local")
    answers = f"{SID}\ns3cr3t-twilio-token\n+1 415 523 8886\n{PHONE}\ny\n"
    r = subprocess.run(
        ["bash", "scripts/fill-twilio.sh"], cwd=root, input=answers,
        capture_output=True, text=True, timeout=30, env=os.environ,
    )  # fmt: skip
    assert r.returncode == 0, r.stdout + r.stderr
    assert "s3cr3t-twilio-token" not in r.stdout + r.stderr
    env = (root / ".env.local").read_text()
    for line in (f"TWILIO_ACCOUNT_SID={SID}", "TWILIO_AUTH_TOKEN=s3cr3t-twilio-token",
                 "TWILIO_WHATSAPP_FROM=whatsapp:+14155238886", f"WHATSAPP_ALLOWED_SENDERS={PHONE}",
                 "WHATSAPP_PROVIDER=twilio", "WHATSAPP_INBOUND=1",
                 "WHATSAPP_NOTIFY=1"):  # fmt: skip
        assert f"\n{line}\n" in env, line
        assert env.count(line.split("=")[0] + "=") == 1, line
    assert stat.S_IMODE((root / ".env.local").stat().st_mode) == 0o600
    assert not (root / ".env.local.bak").exists()
