#!/usr/bin/env bash
# Add the WhatsApp inbound values to .env.local (the other values stay as they are).
# Run it yourself, in your own terminal, from the repo root:   scripts/fill-whatsapp.sh
#
# - WHATSAPP_VERIFY_TOKEN: generated here and shown once, because you paste it into the Meta
#   app (WhatsApp > Configuration > Webhook > Verify token). It only guards the handshake.
# - WHATSAPP_APP_SECRET: asked hidden (Meta app > App settings > Basic > App secret).
# - WHATSAPP_ALLOWED_SENDERS: the phone numbers that may open a case, international format
#   without "+" (e.g. 6281234567890), comma-separated.
# - Optional, option B (reply with the outcome): WHATSAPP_ACCESS_TOKEN asked hidden (Meta app >
#   WhatsApp > API Setup, or a system-user token), WHATSAPP_PHONE_NUMBER_ID shown (same page).
#   Answer "n" to keep replies off.
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

FILL_VALUE=$(openssl rand -hex 16)
export FILL_VALUE
set_value WHATSAPP_VERIFY_TOKEN
echo "WHATSAPP_VERIFY_TOKEN = $FILL_VALUE"
echo "  -> paste this into the Meta app: WhatsApp > Configuration > Webhook > Verify token"

FILL_VALUE=""
while [ -z "$FILL_VALUE" ]; do
  read -r -s -p "WHATSAPP_APP_SECRET (Meta app > App settings > Basic > App secret, hidden): " FILL_VALUE; echo
done
export FILL_VALUE
set_value WHATSAPP_APP_SECRET

read -r -p "WHATSAPP_ALLOWED_SENDERS (e.g. 6281234567890,6289876543210): " FILL_VALUE
export FILL_VALUE="${FILL_VALUE// /}"
set_value WHATSAPP_ALLOWED_SENDERS

FILL_VALUE=1
export FILL_VALUE
set_value WHATSAPP_INBOUND

read -r -p "Also reply to the sender with the outcome (option B)? [y/N]: " REPLY_ON || REPLY_ON=n
if [[ "${REPLY_ON:-n}" =~ ^[Yy] ]]; then
  FILL_VALUE=""
  while [ -z "$FILL_VALUE" ]; do
    read -r -s -p "WHATSAPP_ACCESS_TOKEN (Meta app > WhatsApp > API Setup, hidden): " FILL_VALUE; echo
  done
  export FILL_VALUE
  set_value WHATSAPP_ACCESS_TOKEN
  FILL_VALUE=""
  while [ -z "$FILL_VALUE" ]; do
    read -r -p "WHATSAPP_PHONE_NUMBER_ID (same page, under the test number): " FILL_VALUE
  done
  export FILL_VALUE="${FILL_VALUE// /}"
  set_value WHATSAPP_PHONE_NUMBER_ID
  FILL_VALUE=1
else
  FILL_VALUE=0
fi
export FILL_VALUE
set_value WHATSAPP_NOTIFY
NOTIFY="$FILL_VALUE"
unset FILL_VALUE
rm -f .env.local.bak
echo "wrote .env.local (WHATSAPP_INBOUND=1, WHATSAPP_NOTIFY=$NOTIFY). Next: make use-local, then make whatsapp and make tunnel"
