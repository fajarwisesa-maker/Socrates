#!/usr/bin/env bash
# Add the Twilio WhatsApp sandbox values to .env.local (the other values stay as they are).
# Run it yourself, in your own terminal, from the repo root:   scripts/fill-twilio.sh
#
# - TWILIO_ACCOUNT_SID: shown on the Twilio console home page (starts with AC); not a secret.
# - TWILIO_AUTH_TOKEN: asked hidden (console home page > Auth Token > Show). It signs every
#   webhook call and authenticates the replies.
# - TWILIO_WHATSAPP_FROM: the sandbox number (Messaging > Try it out > Send a WhatsApp message);
#   Enter keeps whatsapp:+14155238886.
# - WHATSAPP_ALLOWED_SENDERS: the phones that may open a case, international format without
#   "+" (e.g. 6281234567890), comma-separated. Each one joins the sandbox first.
# - Replies (option B): answer "y" to send the outcome back to the sender.
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077
[ -f .env.local ] || { echo ".env.local not found: run scripts/fill-env.sh first"; exit 1; }

set_value() {  # set_value KEY: write FILL_VALUE into .env.local (replace the line or append)
  local key="$1"
  cp .env.local .env.local.bak
  KEY="$key" awk '
    BEGIN { done = 0 }
    index($0, ENVIRON["KEY"] "=") == 1 { print ENVIRON["KEY"] "=" ENVIRON["FILL_VALUE"]; done = 1; next }
    { print }
    END { if (!done) print ENVIRON["KEY"] "=" ENVIRON["FILL_VALUE"] }
  ' .env.local.bak > .env.local
  chmod 600 .env.local
}

FILL_VALUE=""
while [[ ! "$FILL_VALUE" =~ ^AC[0-9a-fA-F]{32}$ ]]; do
  read -r -p "TWILIO_ACCOUNT_SID (console home page, AC + 32 characters): " FILL_VALUE
  FILL_VALUE="${FILL_VALUE// /}"
done
export FILL_VALUE
set_value TWILIO_ACCOUNT_SID

FILL_VALUE=""
while [ -z "$FILL_VALUE" ]; do
  read -r -s -p "TWILIO_AUTH_TOKEN (console home page > Auth Token, hidden): " FILL_VALUE; echo
done
export FILL_VALUE
set_value TWILIO_AUTH_TOKEN

read -r -p "Sandbox number [whatsapp:+14155238886]: " FILL_VALUE || FILL_VALUE=""
FILL_VALUE="${FILL_VALUE// /}"
FILL_VALUE="${FILL_VALUE:-whatsapp:+14155238886}"
FILL_VALUE="whatsapp:+${FILL_VALUE#whatsapp:}"
FILL_VALUE="${FILL_VALUE/+\+/+}"
export FILL_VALUE
set_value TWILIO_WHATSAPP_FROM

read -r -p "WHATSAPP_ALLOWED_SENDERS (e.g. 6281234567890,6289876543210): " FILL_VALUE
export FILL_VALUE="${FILL_VALUE// /}"
set_value WHATSAPP_ALLOWED_SENDERS

read -r -p "Also reply to the sender with the outcome? [y/N]: " REPLY_ON || REPLY_ON=n
if [[ "${REPLY_ON:-n}" =~ ^[Yy] ]]; then NOTIFY=1; else NOTIFY=0; fi
for kv in WHATSAPP_PROVIDER=twilio WHATSAPP_INBOUND=1 "WHATSAPP_NOTIFY=$NOTIFY"; do
  export FILL_VALUE="${kv#*=}"
  set_value "${kv%%=*}"
done
unset FILL_VALUE
rm -f .env.local.bak
echo "wrote .env.local (WHATSAPP_PROVIDER=twilio, WHATSAPP_INBOUND=1, WHATSAPP_NOTIFY=$NOTIFY)."
echo "Next: make use-local, then make dev, make whatsapp and make tunnel (docs/whatsapp-inbound.md)"
