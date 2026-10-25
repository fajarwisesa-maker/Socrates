#!/usr/bin/env bash
# Make the real laptop env files from their templates: .env.local, .env.aws, .env.replay and
# .env.v1. Run it yourself, in your own terminal, from the repo root:   scripts/fill-env.sh
#
# - Secrets (AICORE_CLIENT_SECRET, SAP_MOCK_API_KEY, CASE_API_KEY) are asked with hidden
#   input or read from the AI Core service key file, and never echoed.
# - Values that are not secrets are shown: the model ID (from .env / .env.example if set),
#   CASE_API_URL (from the deployed stack's outputs, when there is one), URLs, IDs.
# - Files are written with mode 600. An existing file is kept as <name>.bak first.
# Then: make use-local (or use-replay / use-v1 / use-aws).
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

STACK="${SIAGA_STACK:-Siaga}"            # the Phase 7 stack name (production design)
PROFILE="${AWS_PROFILE:-siaga}"
REGION="${AWS_REGION:-ap-southeast-1}"
PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null || PY="uv run python"

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

ask_shown() {  # ask_shown VAR "prompt": for values that are not secrets
  local __v=""
  while [ -z "$__v" ]; do read -r -p "$2: " __v; done
  printf -v "$1" '%s' "$__v"
}

# --- LLM ---------------------------------------------------------------------------------
FILL_BEDROCK_MODEL_ID=$(from_env_file BEDROCK_MODEL_ID || true)
if [ -n "$FILL_BEDROCK_MODEL_ID" ]; then
  echo "BEDROCK_MODEL_ID = $FILL_BEDROCK_MODEL_ID (from .env)"
else
  ask_shown FILL_BEDROCK_MODEL_ID "BEDROCK_MODEL_ID (e.g. an apac.* inference profile; make aws-check)"
fi
read -r -p "Does Bedrock answer model calls on the account yet? [y/N] " bedrock_ok
if [ "$bedrock_ok" = "y" ] || [ "$bedrock_ok" = "Y" ]; then
  FILL_LLM_PROVIDER=bedrock   # SAP AI Core stays the per-case fallback (LLM_FALLBACK)
else
  FILL_LLM_PROVIDER=sap_genai # Claude via SAP AI Core until Bedrock is unblocked
fi
echo "LLM_PROVIDER     = $FILL_LLM_PROVIDER (mode local)"

# --- SAP AI Core (mode local) ------------------------------------------------------------
echo
read -r -p "Path to the AI Core service key JSON (Enter to type the values instead): " SK
if [ -n "$SK" ]; then
  [ -f "$SK" ] || { echo "no such file: $SK"; exit 1; }
  eval "$(SK="$SK" $PY - <<'PYEOF'
import json, os, shlex
k = json.load(open(os.environ["SK"], encoding="utf-8"))
k = k.get("credentials", k)  # cf service-key output nests the key under "credentials"
m = {
    "AICORE_AUTH_URL": k.get("url"),
    "AICORE_CLIENT_ID": k.get("clientid"),
    "AICORE_CLIENT_SECRET": k.get("clientsecret"),
    "AICORE_API_URL": (k.get("serviceurls") or {}).get("AI_API_URL"),
}
for name, value in m.items():
    if value:
        print(f"FILL_{name}={shlex.quote(value.rstrip('/'))}")
print("echo 'read from the service key: " + ", ".join(n for n, v in m.items() if v) + "'")
PYEOF
)"
fi
[ -n "${FILL_AICORE_AUTH_URL:-}" ] || ask_shown FILL_AICORE_AUTH_URL "AICORE_AUTH_URL (service key 'url')"
[ -n "${FILL_AICORE_CLIENT_ID:-}" ] || ask_hidden FILL_AICORE_CLIENT_ID "AICORE_CLIENT_ID (service key 'clientid', hidden)"
[ -n "${FILL_AICORE_CLIENT_SECRET:-}" ] || ask_hidden FILL_AICORE_CLIENT_SECRET "AICORE_CLIENT_SECRET (service key 'clientsecret', hidden)"
[ -n "${FILL_AICORE_API_URL:-}" ] || ask_shown FILL_AICORE_API_URL "AICORE_API_URL (service key 'serviceurls.AI_API_URL')"
ask_shown FILL_AICORE_RPT_DEPLOYMENT_ID "AICORE_RPT_DEPLOYMENT_ID (AI Launchpad > ML Operations > Deployments, sap-rpt-1.6)"

# --- BTP mock (mode local) ---------------------------------------------------------------
echo
ask_shown FILL_SAP_MOCK_BTP_URL "SAP_MOCK_BTP_URL (https route of siaga-sap-mock, from cf app)"
FILL_SAP_MOCK_BTP_URL="${FILL_SAP_MOCK_BTP_URL%/}"
ask_hidden FILL_SAP_MOCK_API_KEY "SAP_MOCK_API_KEY (the key set with cf set-env, hidden)"

# --- mode aws (production design; the stack is not deployed) ----------------------------
FILL_CASE_API_URL=""
if command -v aws >/dev/null 2>&1; then
  FILL_CASE_API_URL=$(AWS_PROFILE="$PROFILE" aws cloudformation describe-stacks --region "$REGION" \
      --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='CaseApiUrl'].OutputValue" \
      --output text 2>/dev/null || true)
  [ "$FILL_CASE_API_URL" = "None" ] && FILL_CASE_API_URL=""
fi
if [ -n "$FILL_CASE_API_URL" ]; then
  echo "CASE_API_URL (aws) = $FILL_CASE_API_URL (stack $STACK output CaseApiUrl)"
  FILL_CASE_API_KEY=$(openssl rand -base64 32 | tr -d '\n/+=' | cut -c1-40)
  echo "CASE_API_KEY (aws) = generated (not shown); store it with scripts/put-sap-secret.sh"
else
  echo "mode aws: stack $STACK not deployed - .env.aws keeps <set-me> for CASE_API_URL / KEY"
fi

# --- write -------------------------------------------------------------------------------
export "${!FILL_@}"
write() {  # write <template> <target> KEY...: set each KEY whose FILL_KEY is non-empty
  local src="$1" dst="$2"; shift 2
  [ -f "$dst" ] && cp "$dst" "$dst.bak"
  KEYS="$*" awk '
    BEGIN { n = split(ENVIRON["KEYS"], k, " "); for (i = 1; i <= n; i++) want[k[i]] = 1 }
    {
      eq = index($0, "=")
      key = eq ? substr($0, 1, eq - 1) : ""
      if (key in want && ENVIRON["FILL_" key] != "") { print key "=" ENVIRON["FILL_" key]; next }
      print
    }
  ' "$src" > "$dst"
  chmod 600 "$dst"
  echo "wrote $dst"
}
echo
write .env.local.example .env.local LLM_PROVIDER BEDROCK_MODEL_ID AICORE_AUTH_URL \
  AICORE_CLIENT_ID AICORE_CLIENT_SECRET AICORE_API_URL AICORE_RPT_DEPLOYMENT_ID \
  SAP_MOCK_BTP_URL SAP_MOCK_API_KEY
write .env.replay.example .env.replay
write .env.v1.example .env.v1 BEDROCK_MODEL_ID
write .env.aws.example .env.aws BEDROCK_MODEL_ID CASE_API_URL CASE_API_KEY

left=$(grep -l '<set-me>' .env.local .env.replay .env.v1 2>/dev/null || true)
echo
[ -n "$left" ] && echo "still <set-me> in: $left"
echo "next: make use-local, then make env-check and make preflight"
