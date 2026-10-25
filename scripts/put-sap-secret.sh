#!/usr/bin/env bash
# Store the SAP values the deployed agent needs in the Secrets Manager secret siaga/sap.
# Run it yourself, in your own terminal, from the repo root:
#     AWS_PROFILE=siaga scripts/put-sap-secret.sh
#
# Every value is asked with hidden input and goes straight to Secrets Manager (through a
# mode-600 temp file that is deleted afterwards); nothing is echoed or written to the repo.
# Press Enter to keep a key's current value. The AI Core values can be read from the AI Core
# service key JSON file instead of typed (see docs/connections.md for the field mapping).
set -euo pipefail
cd "$(dirname "$0")/.."
umask 077

SECRET_ID="${SAP_SECRET_ID:-siaga/sap}"
REGION="${AWS_REGION:-ap-southeast-1}"
export AWS_PROFILE="${AWS_PROFILE:-siaga}"
PY="${PYTHON:-python3}"
command -v aws >/dev/null || { echo "aws CLI not found"; exit 1; }
command -v "$PY" >/dev/null || PY="uv run python"

who=$(aws sts get-caller-identity --query '[Account, Arn]' --output text) || {
  echo "AWS_PROFILE=$AWS_PROFILE does not work (aws sso login --profile $AWS_PROFILE ?)"; exit 1; }
echo "AWS account $(echo "$who" | cut -f1), user $(echo "$who" | cut -f2 | sed 's#.*/##'), region $REGION"

if aws secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET_ID" >/dev/null 2>&1; then
  CURRENT=$(aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ID" \
    --query SecretString --output text 2>/dev/null || true)
  [ "$CURRENT" = "None" ] && CURRENT=""
  echo "secret $SECRET_ID exists$([ -n "$CURRENT" ] && echo ' (Enter keeps a current value)')"
else
  echo "secret $SECRET_ID does not exist yet: creating it with no value"
  aws secretsmanager create-secret --region "$REGION" --name "$SECRET_ID" \
    --description "SIAGA: SAP AI Core, BTP mock and Case API keys (values set by put-sap-secret.sh)" \
    --query ARN --output text
  CURRENT=""
fi
export CURRENT

has_current() {  # has_current KEY -> 0 if the current secret has a non-empty value for KEY
  KEY="$1" $PY -c 'import json,os,sys; c=os.environ.get("CURRENT") or "{}"; sys.exit(0 if json.loads(c).get(os.environ["KEY"]) else 1)' 2>/dev/null
}

ask() {  # ask KEY "explanation": hidden; Enter keeps the current value (or the default)
  local key="$1" hint="$2" v="" keep=""
  has_current "$key" && keep=" [Enter = keep current]"
  read -r -s -p "$key — $hint$keep: " v; echo
  [ -n "$v" ] && export "NEW_$key=$v"
  return 0
}

# --- AI Core: from the service key file, or typed --------------------------------------
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
        print(f"export NEW_{name}={shlex.quote(value)}")
print("echo 'read from the service key: " + ", ".join(n for n, v in m.items() if v) + "'")
missing = [n for n, v in m.items() if not v]
if missing:
    print("echo 'not in the file (asked next): " + ", ".join(missing) + "'")
PYEOF
)"
fi
[ -n "${NEW_AICORE_AUTH_URL:-}" ]   || ask AICORE_AUTH_URL "service key field 'url' (the UAA URL, no /oauth/token)"
[ -n "${NEW_AICORE_CLIENT_ID:-}" ]  || ask AICORE_CLIENT_ID "service key field 'clientid'"
[ -n "${NEW_AICORE_CLIENT_SECRET:-}" ] || ask AICORE_CLIENT_SECRET "service key field 'clientsecret'"
[ -n "${NEW_AICORE_API_URL:-}" ]    || ask AICORE_API_URL "service key field 'serviceurls.AI_API_URL'"
ask AICORE_RESOURCE_GROUP "AI Core resource group (empty = default)"
ask AICORE_RPT_DEPLOYMENT_ID "deployment ID of sap-rpt-1.6 (AI Launchpad > ML Operations > Deployments)"

# --- BTP mock ----------------------------------------------------------------------------
echo
ask SAP_MOCK_BTP_URL "https URL of siaga-sap-mock (cf app siaga-sap-mock, 'routes')"
ask SAP_MOCK_API_KEY "the key set with cf set-env siaga-sap-mock SAP_MOCK_API_KEY"

# --- Case API key ------------------------------------------------------------------------
echo
if [ -f .env.aws ] && grep -qE '^CASE_API_KEY=.+' .env.aws && ! grep -q '^CASE_API_KEY=<set-me>' .env.aws; then
  read -r -p "Use CASE_API_KEY from .env.aws (made by fill-env.sh)? [Y/n] " reuse
  if [ -z "$reuse" ] || [ "$reuse" = "y" ] || [ "$reuse" = "Y" ]; then
    export NEW_CASE_API_KEY="$(grep -E '^CASE_API_KEY=' .env.aws | tail -1 | cut -d= -f2-)"
  fi
fi
[ -n "${NEW_CASE_API_KEY:-}" ] || ask CASE_API_KEY "the key the Case API checks (same as in .env.aws)"

# --- merge and store ---------------------------------------------------------------------
TMP=$(mktemp)
trap 'rm -f "$TMP"' EXIT
OUT="$TMP" $PY - <<'PYEOF'
import json, os
keys = ["AICORE_AUTH_URL", "AICORE_CLIENT_ID", "AICORE_CLIENT_SECRET", "AICORE_API_URL",
        "AICORE_RESOURCE_GROUP", "AICORE_RPT_DEPLOYMENT_ID", "SAP_MOCK_BTP_URL",
        "SAP_MOCK_API_KEY", "CASE_API_KEY"]
cur = json.loads(os.environ.get("CURRENT") or "{}")
new = {k: os.environ[f"NEW_{k}"].strip() for k in keys if os.environ.get(f"NEW_{k}", "").strip()}
merged = {k: new.get(k) or cur.get(k) for k in keys}
merged["AICORE_RESOURCE_GROUP"] = merged["AICORE_RESOURCE_GROUP"] or "default"
for k in ("AICORE_AUTH_URL", "AICORE_API_URL", "SAP_MOCK_BTP_URL"):
    if merged.get(k):
        merged[k] = merged[k].rstrip("/")
        if not merged[k].startswith("https://"):
            raise SystemExit(f"{k} must start with https://")
merged = {k: v for k, v in merged.items() if v}
with open(os.environ["OUT"], "w", encoding="utf-8") as f:
    json.dump(merged, f)
missing = [k for k in keys if k not in merged]
print("keys to store: " + ", ".join(merged))
if missing:
    print("STILL MISSING (preflight will fail): " + ", ".join(missing))
PYEOF
aws secretsmanager put-secret-value --region "$REGION" --secret-id "$SECRET_ID" \
  --secret-string "file://$TMP" --query VersionId --output text >/dev/null
echo "stored in $SECRET_ID (new version). The deployed agent reads it at its next start;"
echo "check with: make preflight"
