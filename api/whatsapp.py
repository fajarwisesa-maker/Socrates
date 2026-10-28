"""WhatsApp inbound (WHATSAPP_INBOUND=1): a message to the team's WhatsApp test number opens a
case, exactly like the "Load demo WhatsApp" + "Start case" buttons.

This is a separate small app on its own port (WHATSAPP_PORT, default 8010), so the public
tunnel that Meta calls exposes only this webhook, never the Case API (approvals, reset). It
forwards each accepted message to POST {CASE_API_URL}/cases.

    uvicorn --factory api.whatsapp:create_app --port 8010     (make whatsapp)

The webhook contract was read from SDK source, not from memory (developers.facebook.com is
blocked here): Meta's `whatsapp` npm SDK 0.0.5-Alpha (src/api/webhooks.ts, src/utils.ts,
src/types/webhooks.ts), cross-checked with the `pywa` Python library.

- GET  /webhooks/whatsapp: verification. `hub.mode=subscribe` and `hub.verify_token` equal to
  WHATSAPP_VERIFY_TOKEN -> answer `hub.challenge` as plain text, else 401.
- POST /webhooks/whatsapp: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256(app secret, raw
  body)>` -> anything else is 401. Body: {object: "whatsapp_business_account", entry: [{changes:
  [{field: "messages", value: {contacts: [{wa_id, user_id, profile}], messages: [{from, id,
  timestamp, type, text: {body}}], statuses: [...]}}]}]}. Newer payloads carry a
  business-scoped `user_id`, and `wa_id` / `from` may be missing when the sender uses a
  username, so the allowlist matches either.

Accepted = text message, sender on WHATSAPP_ALLOWED_SENDERS, not older than
WHATSAPP_MAX_AGE_SECONDS, not seen before (message IDs in var/whatsapp_seen.txt; Meta
redelivers). Everything else is answered 200 and ignored, so Meta stops retrying. If the Case
API is down the answer is 503 and the message is not marked seen, so Meta delivers it again.
Logs never contain the message text or a full phone number.

WHATSAPP_PROVIDER=twilio (no Meta app; Twilio's WhatsApp sandbox) serves POST /webhooks/twilio
instead. Contract read from Twilio's SDK source (twilio 9.12.0 `request_validator.py`, twilio
5.13.1 npm `lib/webhooks/webhooks.js`; twilio.com is blocked here):

- `X-Twilio-Signature` = base64(HMAC-SHA1(auth token, full URL + every POST parameter name and
  value, sorted by name)); the URL is tried with and without its port, as the SDK does.
  Behind the tunnel the URL is rebuilt from the forwarded scheme and host, or taken from
  TWILIO_WEBHOOK_URL when that is set.
- Form fields: `MessageSid`, `From` ("whatsapp:+62..."), `WaId` (digits), `Body`, `NumMedia`.
  Twilio sends no timestamp and does not redeliver by default, so there is no age check; the
  answer is an empty TwiML `<Response/>` (no automatic reply).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from agent.pii import mask_sender_id
from siaga_common.settings import REPO_ROOT, Settings, get_settings

log = logging.getLogger("siaga.whatsapp")
PATH = "/webhooks/whatsapp"
TWILIO_PATH = "/webhooks/twilio"
EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
CHANNEL = "whatsapp_api"


@dataclass(frozen=True)
class Inbound:
    message_id: str
    sender_ids: frozenset[str]  # every ID the payload gives for the sender (wa_id, user_id)
    sender: str  # the one stored in the audit trail (phone number if known)
    type: str
    text: str | None
    timestamp: int


def signature_ok(app_secret: str, body: bytes, header: str | None) -> bool:
    if not header:
        return False
    expected = hmac.new(app_secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header.removeprefix("sha256="))


def twilio_signature(auth_token: str, url: str, params: dict[str, list[str]]) -> str:
    """Twilio's request signature (RequestValidator.compute_signature in the Python SDK)."""
    s = url
    for name in sorted(params):
        for value in sorted(set(params[name])):
            s += name + value
    mac = hmac.new(auth_token.encode("utf-8"), s.encode("utf-8"), hashlib.sha1)
    return base64.b64encode(mac.digest()).decode("ascii")


def _with_and_without_port(url: str) -> list[str]:
    """Both forms Twilio may have signed (RequestValidator.validate: remove_port / add_port)."""
    u = urlparse(url)
    host = u.netloc.split(":")[0]
    port = u.port or (443 if u.scheme == "https" else 80)
    return [u._replace(netloc=host).geturl(), u._replace(netloc=f"{host}:{port}").geturl()]


def twilio_signature_ok(
    auth_token: str, urls: list[str], params: dict[str, list[str]], header: str | None
) -> bool:
    if not header:
        return False
    return any(
        hmac.compare_digest(twilio_signature(auth_token, u, params), header)
        for url in urls
        for u in _with_and_without_port(url)
    )


def twilio_urls(request: Request, configured: str | None) -> list[str]:
    """The URL Twilio signed: the configured one, else the public one rebuilt from the
    forwarded headers (cloudflared / ngrok), else the one this app saw."""
    if configured:
        return [configured]
    h = request.headers
    host = h.get("x-forwarded-host") or h.get("host") or request.url.netloc
    path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
    schemes = [h.get("x-forwarded-proto", "").split(",")[0].strip(), request.url.scheme, "https"]
    return list(dict.fromkeys(f"{sc}://{host}{path}" for sc in schemes if sc))


def parse_twilio(form: dict[str, list[str]], now: float) -> Inbound | None:
    def one(name: str) -> str:
        return (form.get(name) or [""])[0]

    sender = one("From")
    if not sender.startswith("whatsapp:"):
        return None  # an SMS to a Twilio number, not WhatsApp
    ids = {_norm(x) for x in (sender.removeprefix("whatsapp:"), one("WaId")) if x}
    phone = next((i for i in ids if i.isdigit()), None)
    media = int(one("NumMedia") or 0)
    return Inbound(
        message_id=one("MessageSid"),
        sender_ids=frozenset(ids),
        sender=phone or next(iter(sorted(ids)), ""),
        type="media" if media else "text",
        text=one("Body"),
        timestamp=int(now),
    )


def _norm(sender_id: str) -> str:
    s = sender_id.strip()
    digits = s.lstrip("+").replace(" ", "").replace("-", "")
    return digits if digits.isdigit() else s


def allowed_set(raw: str) -> frozenset[str]:
    return frozenset(_norm(x) for x in raw.split(",") if x.strip())


def parse(payload: dict[str, Any]) -> list[Inbound]:
    """Messages in a webhook payload (status updates and other fields are skipped)."""
    out: list[Inbound] = []
    if payload.get("object") != "whatsapp_business_account":
        return out
    for entry in payload.get("entry") or []:
        for change in entry.get("changes") or []:
            if change.get("field") != "messages":
                continue
            value = change.get("value") or {}
            contacts = value.get("contacts") or []
            for msg in value.get("messages") or []:
                ids = {msg.get("from"), msg.get("from_user_id")}
                for c in contacts:
                    if c.get("wa_id") in ids or c.get("user_id") in ids or len(contacts) == 1:
                        ids |= {c.get("wa_id"), c.get("user_id")}
                ids = {_norm(i) for i in ids if i}
                phone = next((i for i in ids if i.isdigit()), None)
                out.append(
                    Inbound(
                        message_id=str(msg.get("id", "")),
                        sender_ids=frozenset(ids),
                        sender=phone or next(iter(sorted(ids)), ""),
                        type=str(msg.get("type", "")),
                        text=(msg.get("text") or {}).get("body"),
                        timestamp=int(msg.get("timestamp") or 0),
                    )
                )
    return out


class SeenIds:
    """Message IDs already turned into cases (IDs only, no content), kept across restarts."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self.ids = set(path.read_text(encoding="utf-8").split()) if path.exists() else set()

    def __contains__(self, message_id: str) -> bool:
        return message_id in self.ids

    def add(self, message_id: str) -> None:
        with self._lock:
            self.ids.add(message_id)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            with self.path.open("a", encoding="utf-8") as f:
                f.write(message_id + "\n")


Forward = Callable[[Inbound], str]  # -> case_id; raises on failure


def case_api_forward(s: Settings) -> Forward:
    def forward(m: Inbound) -> str:
        r = httpx.post(
            f"{s.case_api_url.rstrip('/')}/cases",
            data={
                "whatsapp": m.text or "",
                "source_channel": CHANNEL,
                "source_ref": m.message_id,
                "source_sender": m.sender,
                "source_received_at": datetime.fromtimestamp(m.timestamp, UTC).isoformat(),
            },
            headers=s.case_api_headers(),
            timeout=30,
        )
        r.raise_for_status()
        return r.json()["case_id"]

    return forward


def create_app(
    settings: Settings | None = None,
    *,
    forward: Forward | None = None,
    seen: SeenIds | None = None,
    clock: Callable[[], float] = time.time,
) -> FastAPI:
    s = settings or get_settings()
    if not s.whatsapp_inbound:
        raise RuntimeError("WHATSAPP_INBOUND is off; set WHATSAPP_INBOUND=1 to run the webhook")
    twilio = s.whatsapp_provider == "twilio"
    if twilio and not s.twilio_auth_token:
        raise RuntimeError("WHATSAPP_PROVIDER=twilio needs TWILIO_AUTH_TOKEN")
    if not twilio and (not s.whatsapp_verify_token or not s.whatsapp_app_secret):
        raise RuntimeError("WHATSAPP_INBOUND=1 needs WHATSAPP_VERIFY_TOKEN and WHATSAPP_APP_SECRET")
    allowed = allowed_set(s.whatsapp_allowed_senders)
    if not allowed:
        log.warning("WHATSAPP_ALLOWED_SENDERS is empty: every message will be ignored")
    forward = forward or case_api_forward(s)
    seen = seen if seen is not None else SeenIds(REPO_ROOT / "var" / "whatsapp_seen.txt")
    lock = threading.Lock()  # one message at a time: dedupe stays exact under retries

    def accept(m: Inbound, check_age: bool = True) -> dict[str, Any] | None:
        """The same rules for both providers. None = the Case API is down (answer 503)."""
        who = mask_sender_id(m.sender)
        with lock:
            if m.message_id in seen:
                return {"id": m.message_id, "result": "duplicate"}
            if not (m.sender_ids & allowed):
                log.info("ignored a message from %s: not on WHATSAPP_ALLOWED_SENDERS", who)
                return {"id": m.message_id, "result": "sender not allowed"}
            if m.type != "text" or not (m.text or "").strip():
                log.info("ignored a %s message from %s: only text opens a case", m.type, who)
                return {"id": m.message_id, "result": f"ignored {m.type}"}
            if check_age and clock() - m.timestamp > s.whatsapp_max_age_seconds:
                log.info("ignored a stale message from %s", who)
                return {"id": m.message_id, "result": "too old"}
            try:
                case_id = forward(m)
            except Exception as e:  # noqa: BLE001 - Meta redelivers on non-200
                log.error("Case API did not take a message from %s: %s", who, type(e).__name__)
                return None
            seen.add(m.message_id)
            log.info("message from %s opened case %s", who, case_id)
            return {"id": m.message_id, "result": "case", "case_id": case_id}

    app = FastAPI(title="SIAGA WhatsApp webhook", docs_url=None, redoc_url=None, openapi_url=None)

    if twilio:
        auth_token = s.twilio_auth_token.get_secret_value()  # type: ignore[union-attr]

        @app.post(TWILIO_PATH)
        async def receive_twilio(request: Request):
            form = await request.form()
            params: dict[str, list[str]] = {}
            for k, v in form.multi_items():
                params.setdefault(k, []).append(str(v))
            urls = twilio_urls(request, s.twilio_webhook_url)
            if not twilio_signature_ok(
                auth_token, urls, params, request.headers.get("x-twilio-signature")
            ):
                log.warning(
                    "refused a Twilio call with a missing or wrong signature (checked %s; if the "
                    "URL differs from the Twilio console, set TWILIO_WEBHOOK_URL)",
                    ", ".join(urls),
                )
                return PlainTextResponse("bad signature", status_code=401)
            m = parse_twilio(params, clock())
            if m is None:
                return PlainTextResponse(EMPTY_TWIML, media_type="text/xml")
            if accept(m, check_age=False) is None:
                return PlainTextResponse(EMPTY_TWIML, media_type="text/xml", status_code=503)
            return PlainTextResponse(EMPTY_TWIML, media_type="text/xml")

        return app

    verify_token = s.whatsapp_verify_token.get_secret_value()  # type: ignore[union-attr]
    app_secret = s.whatsapp_app_secret.get_secret_value()  # type: ignore[union-attr]

    @app.get(PATH)
    def verify(request: Request):
        q = request.query_params
        token = q.get("hub.verify_token") or ""
        if q.get("hub.mode") == "subscribe" and hmac.compare_digest(token, verify_token):
            return PlainTextResponse(q.get("hub.challenge") or "")
        return PlainTextResponse("verification failed", status_code=401)

    @app.post(PATH)
    async def receive(request: Request):
        body = await request.body()
        if not signature_ok(app_secret, body, request.headers.get("x-hub-signature-256")):
            log.warning("refused a webhook call with a missing or wrong signature")
            return PlainTextResponse("bad signature", status_code=401)
        try:
            payload = json.loads(body)
        except ValueError:
            return PlainTextResponse("not JSON", status_code=400)
        results = []
        for m in parse(payload):
            r = accept(m)
            if r is None:
                return JSONResponse({"error": "case API unavailable"}, status_code=503)
            results.append(r)
        return {"received": results}

    return app
