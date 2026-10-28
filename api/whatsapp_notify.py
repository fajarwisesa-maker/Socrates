"""WhatsApp option B (WHATSAPP_NOTIFY=1, with WHATSAPP_INBOUND=1): when a case that came in on
WhatsApp ends, the sender gets one message with the outcome, as a reply to their message.

- Which outcomes: RESOLVED, ESCALATED, REOPENED; each one at most once per case (the audit
  trail is the record). Nothing is sent while a case waits for approval.
- What it says is built here from the case's own figures (the solver's summary, the
  verification time); no model writes it. It shows no personal data.
- Who it goes to: the full sender and the message ID from the case's `signal_received`
  audit entry (the case itself only holds the masked sender).
- How: Cloud API `POST {graph}/v{version}/{phone_number_id}/messages`, `Authorization: Bearer
  <token>`, body `{messaging_product: "whatsapp", recipient_type: "individual", to | recipient,
  type: "text", text: {body, preview_url: false}, context: {message_id}}`. Read from SDK source
  (pywa `api.py` `send_message`, Meta's `whatsapp` npm SDK `messages.ts`); latest Graph API
  version there: 26.0 (WHATSAPP_GRAPH_VERSION). A free-form text is allowed because the
  sender wrote to the number minutes earlier (inside the 24-hour customer service window).
- WHATSAPP_PROVIDER=twilio: `TwilioSender`, `POST {api}/2010-04-01/Accounts/{sid}/Messages.json`
  (form `To=whatsapp:+<digits>`, `From=TWILIO_WHATSAPP_FROM`, `Body`; HTTP basic auth with the
  account SID and auth token), from Twilio's SDK source (twilio 9.12.0
  `rest/api/v2010/account/message`). Twilio has no reply threading, so the message ID is
  not used. Sandbox replies reach only phones that joined the sandbox.
- A failed send never changes the case: it is audited (`notification_failed`, HTTP status
  only) and shown as an event.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from agent.case_store import CaseRecord
from agent.pii import mask_sender_id
from siaga_common.money import format_juta
from siaga_common.settings import Settings
from siaga_common.timeline import from_iso

log = logging.getLogger("siaga.whatsapp")
OUTCOMES = {"RESOLVED", "ESCALATED", "REOPENED"}


class NotifyError(Exception):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


def short_id(case_id: str) -> str:
    return "#" + case_id.removeprefix("case-")[:6]


def _elapsed(case: CaseRecord) -> str | None:
    verified = (case.verification or {}).get("verified_at")
    if not verified:
        return None
    s = max(0, round((from_iso(verified) - from_iso(case.created_at)).total_seconds()))
    return f"{s // 60}m {s % 60:02d}s"


def outcome_text(case: CaseRecord) -> str:
    """The message for a finished case, from code and the case's own figures."""
    head = f"SIAGA {short_id(case.case_id)}"
    if case.status == "RESOLVED":
        s = case.summary or {}
        line = ""
        if s.get("exposure_avoided") is not None:
            cost = s.get("case_cost", s.get("chosen_cost")) or 0
            line = f" {format_juta(s['exposure_avoided'])} protected for {format_juta(cost)}."
        took = _elapsed(case)
        timing = f" Signal to verified in {took}." if took else ""
        return f"{head}: resolved.{line}{timing} The plan is executed in SAP and verified."
    if case.status == "ESCALATED":
        reason = (case.escalation_reason or "see the dashboard")[:300]
        return (
            f"{head}: handed to a planner. {reason}. "
            "Everything done so far is kept and in the audit trail."
        )
    return (
        f"{head}: re-opened. The check in SAP found the plan no longer covers the orders; "
        "a planner needs to look at it."
    )


class CloudApiSender:
    def __init__(self, s: Settings, transport: httpx.BaseTransport | None = None):
        if not s.whatsapp_access_token or not s.whatsapp_phone_number_id:
            raise RuntimeError(
                "WHATSAPP_NOTIFY=1 needs WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID"
            )
        self.phone_url = (
            f"{s.whatsapp_graph_url.rstrip('/')}/v{s.whatsapp_graph_version}"
            f"/{s.whatsapp_phone_number_id}"
        )
        self.url = f"{self.phone_url}/messages"
        self.http = httpx.Client(
            timeout=10,
            transport=transport,
            headers={"Authorization": f"Bearer {s.whatsapp_access_token.get_secret_value()}"},
        )

    @staticmethod
    def _raise_for(r: httpx.Response, what: str) -> None:
        if r.status_code >= 400:
            # Meta's error body names the problem (e.g. an expired token); no secret in it
            err = (
                (r.json().get("error") or {}) if "json" in r.headers.get("content-type", "") else {}
            )
            raise NotifyError(
                f"{what}: HTTP {r.status_code} {err.get('message', '')}".strip(), r.status_code
            )

    def check(self) -> str:
        """Token and phone number ID, without sending anything: the number's display form
        (pywa `get_business_phone_number`: GET /{phone_id}?fields=...)."""
        try:
            r = self.http.get(
                self.phone_url, params={"fields": "display_phone_number,verified_name"}
            )
        except httpx.HTTPError as e:
            raise NotifyError(f"WhatsApp check failed: {type(e).__name__}") from e
        self._raise_for(r, "WhatsApp check")
        d = r.json()
        return f"{d.get('display_phone_number', '?')} ({d.get('verified_name', '?')})"

    def send(self, sender: str, text: str, reply_to: str | None) -> str:
        digits = sender.lstrip("+")
        body: dict[str, Any] = {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "type": "text",
            "text": {"body": text, "preview_url": False},
        }
        # a phone number goes in `to`; a business-scoped user ID (username senders) in `recipient`
        body |= {"to": digits} if digits.isdigit() else {"recipient": sender}
        if reply_to:
            body["context"] = {"message_id": reply_to}
        try:
            r = self.http.post(self.url, json=body)
        except httpx.HTTPError as e:
            raise NotifyError(f"WhatsApp send failed: {type(e).__name__}") from e
        self._raise_for(r, "WhatsApp send")
        return ((r.json().get("messages") or [{}])[0]).get("id", "")


class TwilioSender:
    def __init__(self, s: Settings, transport: httpx.BaseTransport | None = None):
        if not s.twilio_account_sid or not s.twilio_auth_token:
            raise RuntimeError(
                "WHATSAPP_NOTIFY=1 with Twilio needs TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN"
            )
        self.account_url = (
            f"{s.twilio_api_url.rstrip('/')}/2010-04-01/Accounts/{s.twilio_account_sid}"
        )
        self.from_ = s.twilio_whatsapp_from
        self.http = httpx.Client(
            timeout=10,
            transport=transport,
            auth=(s.twilio_account_sid, s.twilio_auth_token.get_secret_value()),
            headers={"Accept": "application/json"},
        )

    @staticmethod
    def _raise_for(r: httpx.Response, what: str) -> None:
        if r.status_code >= 400:
            # Twilio's error body: {code, message, more_info, status}; no secret in it
            err = r.json() if "json" in r.headers.get("content-type", "") else {}
            detail = ""
            if "code" in err:
                detail = f"{err.get('message', '')} (Twilio error {err['code']})"
            raise NotifyError(f"{what}: HTTP {r.status_code} {detail}".strip(), r.status_code)

    def check(self) -> str:
        """Account SID and auth token, without sending anything."""
        try:
            r = self.http.get(f"{self.account_url}.json")
        except httpx.HTTPError as e:
            raise NotifyError(f"Twilio check failed: {type(e).__name__}") from e
        self._raise_for(r, "Twilio check")
        d = r.json()
        return f"{self.from_.removeprefix('whatsapp:')} (account {d.get('status', '?')})"

    def send(self, sender: str, text: str, reply_to: str | None) -> str:
        digits = sender.lstrip("+")
        if not digits.isdigit():
            raise NotifyError("Twilio send: the sender has no phone number")
        try:
            r = self.http.post(
                f"{self.account_url}/Messages.json",
                data={"To": f"whatsapp:+{digits}", "From": self.from_, "Body": text},
            )
        except httpx.HTTPError as e:
            raise NotifyError(f"Twilio send failed: {type(e).__name__}") from e
        self._raise_for(r, "Twilio send")
        return r.json().get("sid", "")


Sender = CloudApiSender | TwilioSender


def make_sender(s: Settings) -> Sender:
    return TwilioSender(s) if s.whatsapp_provider == "twilio" else CloudApiSender(s)


class OutcomeNotifier:
    """Called by the Case API after every agent job (under the case's lock)."""

    def __init__(self, sender: Sender):
        self.sender = sender

    def after_job(self, rt: Any, case_id: str) -> None:
        case = rt.store.get_case(case_id)
        if case.status not in OUTCOMES:
            return
        audit = rt.audit.read(case_id)
        received = next((e for e in audit if e.kind == "signal_received"), None)
        if received is None or received.payload.get("channel") != "whatsapp_api":
            return  # not a WhatsApp case
        done = {
            e.payload.get("status")
            for e in audit
            if e.kind in ("notification_sent", "notification_failed")
        }
        if case.status in done:
            return
        to = received.payload.get("sender") or ""
        who = mask_sender_id(to)
        text = outcome_text(case)
        try:
            message_id = self.sender.send(to, text, received.payload.get("message_id"))
        except NotifyError as e:
            log.warning("outcome of %s not sent to %s: %s", case_id, who, e)
            failed = {"channel": "whatsapp_api", "status": case.status, "error": str(e)}
            rt.audit.append(case_id, "notification_failed", failed)
            rt.store.append_event(case_id, "CASE", "warning", "WhatsApp reply not sent", str(e))
            return
        rt.audit.append(case_id, "notification_sent", {
            "channel": "whatsapp_api", "status": case.status, "to": to,
            "message_id": message_id, "text": text,
        })  # fmt: skip
        rt.store.append_event(case_id, "CASE", "info", f"Outcome sent on WhatsApp to {who}", text)
        log.info("outcome of %s sent to %s", case_id, who)
