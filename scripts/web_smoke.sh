#!/usr/bin/env bash
# Web smoke test: start a throwaway Case API (fake LLM, embedded mock SAP, temp state) and
# a production build of the dashboard on spare ports, run the Playwright demo test, then stop both.
# Screenshots: web/e2e/screenshots/. Set PW_CHROMIUM to use a preinstalled Chromium.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_PORT="${API_PORT:-8010}"
WEB_PORT="${WEB_PORT:-3010}"
TMP="$(mktemp -d)"
PIDS=()
# Each server runs in its own process group (setsid) so cleanup also stops the node /
# python children that npx and uv spawn.
cleanup() {
  for p in "${PIDS[@]}"; do kill -TERM -- "-$p" 2>/dev/null || true; done
  for _ in $(seq 1 20); do  # wait until both ports are free so back-to-back runs work
    curl -s -o /dev/null "http://127.0.0.1:$API_PORT/" || curl -s -o /dev/null "http://127.0.0.1:$WEB_PORT/" || break
    sleep 0.5
  done
  rm -rf "$TMP"
}
trap cleanup EXIT

wait_for() {  # url
  for _ in $(seq 1 90); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done
  echo "timed out waiting for $1" >&2; return 1
}

cd "$ROOT"
for port in "$API_PORT" "$WEB_PORT"; do
  if curl -s -o /dev/null "http://127.0.0.1:$port/"; then
    echo "port $port is already in use; set API_PORT / WEB_PORT" >&2; exit 1
  fi
done
# SMOKE_LLM=replay runs the same test on the golden recording (and checks the badge).
SMOKE_LLM="${SMOKE_LLM:-fake}"
if [ "$SMOKE_LLM" = replay ]; then export REPLAY=1 REPLAY_SPEED=0 SIAGA_EXPECT_REPLAY=1; fi
EMBEDDED_SAP=1 LLM_PROVIDER="$SMOKE_LLM" VERIFY_DELAY_SECONDS=3 \
  SQLITE_PATH="$TMP/siaga.db" AUDIT_DIR="$TMP/audit" \
  setsid uv run uvicorn --factory api.app:create_app --host 127.0.0.1 --port "$API_PORT" \
  >"$TMP/api.log" 2>&1 &
PIDS+=($!)
# Production build in its own distDir (rewrites are baked in at build time), so this
# neither depends on nor collides with a running `next dev`.
export SIAGA_API_URL="http://127.0.0.1:$API_PORT" SIAGA_DIST_DIR=".next-smoke"
(cd web && npx next build >"$TMP/build.log" 2>&1) || { tail -40 "$TMP/build.log"; exit 1; }
(cd web && exec setsid npx next start -p "$WEB_PORT" >"$TMP/web.log" 2>&1) &
PIDS+=($!)
wait_for "http://127.0.0.1:$API_PORT/health"
wait_for "http://127.0.0.1:$WEB_PORT/"

cd web
# The reject path leaves the recorded run, so replay mode runs the golden-path test only.
GREP=(); [ "$SMOKE_LLM" = replay ] && GREP=(--grep "verified|presenter")  # golden path only: replay cannot reject
SIAGA_WEB_URL="http://127.0.0.1:$WEB_PORT" npx playwright test "${GREP[@]}" || {
  echo "--- api log"; tail -40 "$TMP/api.log"; echo "--- web log"; tail -40 "$TMP/web.log"; exit 1
}
