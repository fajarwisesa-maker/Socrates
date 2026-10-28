# WhatsApp inbound (option A): a message on stage opens the case

With `WHATSAPP_INBOUND=1`, a WhatsApp message from an allowed phone to the team's WhatsApp
test number opens a case. It works the same way as "Load demo WhatsApp" followed by "Start
case":

- the dashboard switches to the new case by itself and plays it from Perceive;
- the WhatsApp bubble reads "received live from +62 ••• 7890".

The flag is off by default. With it off, nothing changes, and the buttons always work as
the fallback.

```
phone ──WhatsApp──▶ Meta ──HTTPS webhook──▶ tunnel ──▶ make whatsapp (:8010) ──▶ Case API (:8000)
                                                        signature, allowlist,     POST /cases
                                                        dedupe, max age
```

**Only the webhook app (port 8010) is exposed through the tunnel**, never the Case API, so
approvals and reset are not reachable from the internet. Receiving needs no Meta access token,
only the app secret, which is used to check each request's signature. With option A alone,
SIAGA sends nothing back; option B (`WHATSAPP_NOTIFY=1`, section B below) adds one reply with
the outcome.

## 1. Once: the Meta app (in your browser)

These steps follow the Meta App Dashboard as it is usually laid out. Meta's developer docs are
blocked in the build session, so check the names on screen.

1. On developers.facebook.com → **My Apps** → **Create app**, choose type **Business**, then
   add the **WhatsApp** product. Meta gives you a **test phone number**: that's the number to
   message on stage.
2. Under **API Setup**, add the phone(s) that will send the demo message to the allowed "To"
   numbers. Test numbers are limited to registered recipients.
3. Under **App settings → Basic**, find the **App secret** (Show). `fill-whatsapp.sh` asks
   for it.

## 2. Once: the laptop

```bash
scripts/fill-whatsapp.sh     # shows a generated verify token, asks the app secret (hidden)
                             # and the allowed sender numbers (e.g. 6281234567890)
make use-local               # env-check: the three WhatsApp values must be "set"
```

Install **cloudflared** for the tunnel (on WSL: Cloudflare's `cloudflared` .deb package).
`ngrok http 8010` works too; its free plan includes one fixed domain.

## 3. Each time: run it

Use three terminals in the `Socrates` folder:

```bash
make dev                     # 1: mock SAP, Case API, dashboard
make whatsapp                # 2: the webhook on 127.0.0.1:8010
make tunnel                  # 3: prints https://<random>.trycloudflare.com
```

In the Meta app → **WhatsApp → Configuration → Webhook**:

- **Callback URL** = `https://<random>.trycloudflare.com/webhooks/whatsapp`
- **Verify token** = the one `fill-whatsapp.sh` printed (it is in `.env.local` too)
- **Verify and save**, then subscribe the **`messages`** webhook field.

A quick tunnel gets a new URL every time it starts. Update the Callback URL after each
`make tunnel`, or use an ngrok fixed domain.

Then check:

```bash
make preflight      # "WhatsApp webhook :8010 — verification ok, N allowed sender(s)"
```

Send the demo message from an allowed phone (the text of `data/demo/whatsapp_driver.txt`).
Within about 2 seconds the dashboard switches to the case.

## What is accepted

| Message | Result |
| --- | --- |
| wrong or missing `X-Hub-Signature-256` | 401, nothing happens |
| sender not in `WHATSAPP_ALLOWED_SENDERS` (phone number or business-scoped user ID) | acknowledged, ignored |
| not text (image, document, voice …) | acknowledged, ignored |
| older than `WHATSAPP_MAX_AGE_SECONDS` (600 s) | acknowledged, ignored (Meta redelivers old messages for a long time) |
| a message ID already seen (`var/whatsapp_seen.txt`, IDs only) | acknowledged, ignored |
| Case API not running | 503, so Meta delivers it again later |
| allowed text | `POST /cases`, and the case starts |

- **Privacy:** the case, the events and the dashboard only show the masked sender
  ("+62 ••• 7890"). The full number is stored only in the case's audit trail (a
  `signal_received` entry), as with PII masking. With `PII_MASKING=local`, numbers and names
  inside the message text are masked before any model call. The logs never contain the text
  or a full number.
- **Content:** a WhatsApp-only case has one signal, so Perceive's confidence is **Medium**
  (the forwarder PDF is what raises it to High). The demo numbers are unchanged: the delay
  of "2-3 hari" is still past the cutoff.

## If something goes wrong on stage

Click **Load demo WhatsApp → Load forwarder PDF → Start case** as before. To turn the flag
off, set `WHATSAPP_INBOUND=0` in `.env.local` (or don't start `make whatsapp`).

## B. Reply with the outcome (`WHATSAPP_NOTIFY=1`)

When a case that came in on WhatsApp ends, the sender gets **one** reply, threaded under their
message. The Case API sends it straight to Meta's Cloud API (outbound HTTPS; the tunnel is not
involved). Nothing is sent while the case waits for approval.

| Case ends | Reply (written by code from the case's figures, never by a model) |
| --- | --- |
| RESOLVED | `SIAGA #1a2b3c: resolved. Rp 340 jt protected for Rp 11,4 jt. Signal to verified in 0m 52s. The plan is executed in SAP and verified.` |
| ESCALATED | `SIAGA #1a2b3c: handed to a planner. <reason>. Everything done so far is kept and in the audit trail.` |
| REOPENED | `SIAGA #1a2b3c: re-opened. The check in SAP found the plan no longer covers the orders; a planner needs to look at it.` |

- Each outcome is sent at most once per case. A case that is re-opened and later resolved can
  get a second, different reply.
- The audit trail records `notification_sent` (to, Meta's message ID, the text) or
  `notification_failed` (HTTP status and Meta's error message). The case shows an event:
  "Outcome sent on WhatsApp to +62 ••• 7890" or "WhatsApp reply not sent". On the Verify
  canvas, a line under the final result says the reply went out.
- A failed reply never changes the case and is not retried.
- Cases started from the dashboard buttons never get a reply.

### Setup

1. In the Meta app → **WhatsApp → API Setup**:
   - copy the **Phone number ID** of the test number (not the phone number itself);
   - get an **access token**. The temporary token on that page **expires after about 24
     hours**. For Demo Day, create a **system user** token (Business settings → Users →
     System users → Generate token, with the `whatsapp_business_messaging` permission), or
     generate a fresh temporary one that morning.
2. Run `scripts/fill-whatsapp.sh` again and answer **y** to the reply question. It asks for the
   token hidden and the phone number ID shown, and sets `WHATSAPP_NOTIFY=1`.
3. `make use-local`, then `make preflight`. Expect the line "WhatsApp replies — token ok,
   replies come from +1 555-…". This check only reads the phone number; it sends nothing.

The reply is a free-form text, so it must be sent within 24 hours of the sender's last message
(the customer service window). On stage the reply comes a few minutes after the message, so
this always holds. The Graph API version is `WHATSAPP_GRAPH_VERSION` (default `26.0`).

To turn replies off, set `WHATSAPP_NOTIFY=0` in `.env.local`. Receiving keeps working.
