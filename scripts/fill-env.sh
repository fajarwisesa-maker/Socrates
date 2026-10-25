#!/usr/bin/env bash
# Make the real laptop env files from their templates: .env.aws, .env.replay, .env.v1.
# Run it yourself, in your own terminal, from the repo root:   scripts/fill-env.sh
#
# - Secrets (CASE_API_KEY) are asked with hidden input and never echoed.
# - CASE_API_URL is read from the deployed stack's outputs (AWS_PROFILE=siaga) and shown.
# - BEDROCK_MODEL_ID: the value already in .env / .env.example if any, else asked (shown;
#   it is not a secret).
# - Files are written with mode 600. Existing files are kept as <name>.bak first.
# Then: make use-aws (or use-replay / use-v1).
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

STACK="${SIAGA_STACK:-Siaga}"            # the Phase 7 stack name
PROFILE="${AWS_PROFILE:-siaga}"
REGION="${AWS_REGION:-ap-southeast-1}"

from_env_file() {  # value of $1 in .env / .env.example (not a secret: model ID only)
  local f v
  for f in .env .env.example; do
    [ -f "$f" ] || continue
    v=$(grep -E "^$1=" "$f" | tail -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//')
    if [ -n "$v" ] && [ "$v" != "<set-me>" ]; then printf '%s' "$v"; return; fi
  done
}

ask_hidden() {  # ask_hidden VAR "prompt": no echo, empty answers refused
  local __v=""
  while [ -z "$__v" ]; do
    read -r -s -p "$2: " __v; echo
    [ -z "$__v" ] && echo "  (empty; try again)"
  done
  printf -v "$1" '%s' "$__v"
}

# --- values ------------------------------------------------------------------------------
MODEL_ID=$(from_env_file BEDROCK_MODEL_ID || true)
if [ -n "$MODEL_ID" ]; then
  echo "BEDROCK_MODEL_ID = $MODEL_ID (from .env)"
else
  read -r -p "BEDROCK_MODEL_ID (e.g. an apac.* inference profile; see make aws-check): " MODEL_ID
fi

CASE_API_URL=""
if command -v aws >/dev/null 2>&1; then
  CASE_API_URL=$(AWS_PROFILE="$PROFILE" aws cloudformation describe-stacks --region "$REGION" \
      --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='CaseApiUrl'].OutputValue" \
      --output text 2>/dev/null || true)
  [ "$CASE_API_URL" = "None" ] && CASE_API_URL=""
fi
if [ -n "$CASE_API_URL" ]; then
  echo "CASE_API_URL     = $CASE_API_URL (stack $STACK output CaseApiUrl)"
else
  echo "CASE_API_URL: stack $STACK not found in $REGION (profile $PROFILE) - left as <set-me>."
  echo "              Run this script again after the Phase 7 deploy."
  CASE_API_URL="<set-me>"
fi

echo
echo "CASE_API_KEY: the key the deployed Case API checks. The same value goes into the"
echo "Secrets Manager secret siaga/sap (scripts/put-sap-secret.sh offers to reuse it)."
read -r -p "Generate a new random key? [Y/n] " gen
if [ -z "$gen" ] || [ "$gen" = "y" ] || [ "$gen" = "Y" ]; then
  CASE_API_KEY=$(openssl rand -base64 32 | tr -d '\n/+=' | cut -c1-40)
  echo "  generated (not shown)"
else
  ask_hidden CASE_API_KEY "CASE_API_KEY (hidden)"
fi

# --- write -------------------------------------------------------------------------------
write() {  # write <template> <target>: replace the <set-me> values, keep everything else
  local src="$1" dst="$2"
  [ -f "$dst" ] && cp "$dst" "$dst.bak"
  MODEL_ID="$MODEL_ID" CASE_API_URL="$CASE_API_URL" CASE_API_KEY="$CASE_API_KEY" awk '
    BEGIN { FS = OFS = "=" }
    /^BEDROCK_MODEL_ID=/ { print "BEDROCK_MODEL_ID", ENVIRON["MODEL_ID"]; next }
    /^CASE_API_URL=<set-me>/ { print "CASE_API_URL", ENVIRON["CASE_API_URL"]; next }
    /^CASE_API_KEY=/ { print "CASE_API_KEY", ENVIRON["CASE_API_KEY"]; next }
    { print }
  ' "$src" > "$dst"
  chmod 600 "$dst"
  echo "wrote $dst"
}
echo
write .env.aws.example .env.aws
write .env.replay.example .env.replay
write .env.v1.example .env.v1

left=$(grep -l '<set-me>' .env.aws .env.replay .env.v1 2>/dev/null || true)
echo
if [ -n "$left" ]; then
  echo "still <set-me> in: $left (see above)"
fi
echo "next: make use-aws   (or make use-replay / make use-v1), then make env-check"
