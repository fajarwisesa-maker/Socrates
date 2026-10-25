"""Demo-day pre-flight: one line per connection, ✅ or ❌ with the reason. No secrets.

    uv run python scripts/preflight.py      (make preflight)

What it checks depends on the laptop mode in `.env` (SIAGA_MODE, `make use-*`):
- aws: the laptop's AWS identity, the env file, the deployed Case API with its key, then,
  through the API's /health/connections (so from AWS, with its IAM role): the siaga/sap
  secret, Bedrock, the BTP mock, AI Core + one RPT-1.6 call, the AWS backends; and the
  SSM flags against `make flags-v2`.
- replay / v1 (or no mode): the local stack (golden recording or Bedrock, Case API, mock
  SAP day 0, dashboard, CBC, Cedar).

Exit code 1 if anything is red. Amber items are worth reading but do not block.
"""

from __future__ import annotations

import json
import sys
import time

import httpx

from siaga_common.settings import Settings, export_aws_env, get_settings
from siaga_common.sources import AWS_BACKENDS, ConfigSourceError, SsmFlags, diff, preset
from siaga_common.timeline import day0_for, to_iso, today_wib

GREEN, AMBER, RED = "✅", "⚠️ ", "❌"
results: list[str] = []


def line(mark: str, what: str, detail: str = "") -> None:
    results.append(mark)
    print(f" {mark} {what}" + (f"  — {detail}" if detail else ""))


def get(
    url: str, timeout: float = 3, headers: dict[str, str] | None = None
) -> httpx.Response | None:
    try:
        r = httpx.get(url, timeout=timeout, headers=headers)
        return r if r.status_code < 500 else None
    except httpx.HTTPError:
        return None


def env_line() -> str | None:
    from scripts.env_mode import check

    mode, problems = check(out=lambda *_: None)
    if mode is None:
        line(AMBER, ".env mode", "no SIAGA_MODE (hand-made .env?): make use-aws|use-replay|use-v1")
    elif problems:
        line(RED, f".env mode {mode}", "; ".join(problems) + " (make env-check)")
    else:
        line(GREEN, f".env mode {mode}", "env-check ok")
    return mode


def aws_identity(s: Settings) -> None:
    try:
        import boto3

        who = boto3.client("sts", region_name=s.aws_region).get_caller_identity()
        line(GREEN, "laptop AWS identity",
             f"account {who['Account']}, user {who['Arn'].rsplit('/', 1)[-1]}")  # fmt: skip
    except Exception as e:  # noqa: BLE001 - botocore errors carry no secret values
        line(RED, "laptop AWS identity", f"{type(e).__name__} (aws sso login --profile siaga?)")


CONNECTIONS = [
    ("secret", "deployed agent reads siaga/sap"),
    ("bedrock", "Bedrock from the deployed agent"),
    ("sap_mock", "BTP mock from the deployed agent"),
    ("aicore", "AI Core token + RPT-1.6 from the deployed agent"),
]


def aws_preflight(s: Settings) -> None:
    aws_identity(s)
    env_line()
    url, headers = s.case_api_url.rstrip("/"), s.case_api_headers()
    if not headers:
        line(RED, "Case API", "CASE_API_KEY not set in .env")
    no_key = get(f"{url}/config", timeout=10)
    with_key = get(f"{url}/config", timeout=10, headers=headers)
    if with_key is None:
        line(RED, "Case API", f"not reachable at {url}")
    elif with_key.status_code != 200:
        line(RED, "Case API", f"HTTP {with_key.status_code} with the key (wrong CASE_API_KEY?)")
    elif no_key is not None and no_key.status_code == 200:
        line(RED, "Case API", f"{url} answers WITHOUT a key: CASE_API_KEY is not enforced")
    else:
        line(GREEN, "Case API", f"{url}, key required and accepted")

    conn = get(f"{url}/health/connections?deep=1", timeout=90, headers=headers)
    checks = conn.json().get("checks", {}) if conn is not None and conn.status_code == 200 else None
    for key, what in CONNECTIONS:
        if checks is None:
            line(RED, what, "no answer from /health/connections")
            continue
        c = checks.get(key) or {"ok": False, "detail": "not reported"}
        if key == "sap_mock" and c.get("mode") != "BTP":
            c = {"ok": False, "detail": f"the agent uses the {c.get('mode')} mock, not BTP"}
        line(GREEN if c["ok"] else RED, what, c["detail"])
    if checks is None:
        line(RED, "DynamoDB, S3 audit, solver Lambda", "no answer from /health/connections")
    else:
        have = checks["backends"]["values"]
        want = {"case_store": "dynamodb", "audit": "s3", "kb": "bedrock",
                "policy": "agentcore", "solver": "lambda"}  # fmt: skip
        assert set(want.values()) == set(AWS_BACKENDS.values())
        off = [f"{k}={have.get(k)}" for k, v in want.items() if have.get(k) != v]
        line(RED if off else GREEN, "DynamoDB, S3 audit, solver Lambda",
             f"local backends: {', '.join(off)} (Phase 7 not deployed)" if off
             else "all AWS backends")  # fmt: skip
    try:
        bad = diff(SsmFlags(s.aws_region).read(), preset("v2", s.bedrock_model_id))
        line(RED if bad else GREEN, "SSM /siaga/flags/* = make flags-v2",
             ", ".join(f"{k}={a} (want {w})" for k, (a, w) in bad.items()) or "match")  # fmt: skip
    except ConfigSourceError as e:
        line(RED, "SSM /siaga/flags/*", str(e)[:160])


def main() -> int:
    export_aws_env()
    s = get_settings()
    if s.siaga_mode == "aws":
        print(f"SIAGA pre-flight  (mode aws, Case API {s.case_api_url}, region {s.aws_region})\n")
        aws_preflight(s)
        return summary()
    replay = s.replay or s.llm_provider == "replay"
    print(
        f"SIAGA pre-flight  (LLM {'replay' if replay else s.llm_provider}, region {s.aws_region})\n"
    )
    env_line()

    # --- LLM ---------------------------------------------------------------------------
    meta_path = s.replay_path.parent / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else None
    if replay:
        if not s.replay_path.exists():
            line(RED, "golden recording", f"missing {s.replay_path}; run `make record-golden`")
        elif meta and meta.get("provider") == "fake":
            line(
                AMBER,
                "golden recording",
                "recorded from the scripted fake LLM; re-record with Bedrock",
            )
        else:
            line(
                GREEN,
                "golden recording",
                f"{meta and meta.get('model')} at {meta and meta.get('recorded_at')}",
            )
    elif s.llm_provider == "bedrock":
        if not s.bedrock_model_id:
            line(RED, "BEDROCK_MODEL_ID", "not set")
        else:
            try:
                from scripts.aws_check import converse_ping

                r = converse_ping(s.aws_region, s.bedrock_model_id)
                ok = bool(r["tool_use"])
                line(GREEN if ok else RED, f"Bedrock {s.bedrock_model_id}",
                     f"tool call {'ok' if ok else 'MISSING'} in {r['latency_s']} s")  # fmt: skip
            except Exception as e:  # noqa: BLE001
                line(RED, f"Bedrock {s.bedrock_model_id}", f"{type(e).__name__}: {str(e)[:120]}")
        if not s.replay_path.exists():
            line(AMBER, "golden recording", "none - no replay fallback if Bedrock fails on stage")
        else:
            line(GREEN, "replay fallback ready", "restart with REPLAY=1 if Bedrock misbehaves")
    else:
        line(AMBER, "LLM provider", "fake (scripted) - fine for rehearsal, not for the live demo")

    # --- services ----------------------------------------------------------------------
    api = get(f"{s.case_api_url}/config", headers=s.case_api_headers())
    if api is None:
        line(RED, "Case API", f"not reachable at {s.case_api_url} (make dev / make replay)")
    else:
        cfg = api.json()
        same = (
            cfg["llm_provider"].startswith("replay") == replay
            or cfg["llm_provider"] == s.llm_provider
        )
        line(GREEN if same else AMBER, "Case API", f"{s.case_api_url}, LLM {cfg['llm_provider']}, "
             f"VERIFY delay {cfg['verify_delay_seconds']} s")  # fmt: skip
        sap_day0 = None
        if cfg.get("embedded_sap"):
            line(GREEN, "mock SAP", "embedded in the Case API")
        else:
            sap_url, sap_headers = s.sap_endpoint()
            st = get(f"{sap_url}/admin/state", timeout=8, headers=sap_headers)
            if st is None or st.status_code == 401:
                why = "API key refused" if st is not None else "not reachable"
                line(RED, "mock SAP", f"{why} at {sap_url}")
            else:
                sap_day0 = st.json().get("day0")
                today = to_iso(day0_for(today_wib()))
                if sap_day0 != today:
                    line(AMBER, "mock SAP day 0", f"{sap_day0} != today {today}: press Reset demo")
                else:
                    line(GREEN, "mock SAP", f"{sap_url}, day 0 = today")
    web = get("http://127.0.0.1:3000/")
    line(GREEN if web is not None else RED, "dashboard", "http://localhost:3000"
         if web is not None else "not reachable on :3000")  # fmt: skip

    # --- deterministic core ------------------------------------------------------------
    try:
        import pulp

        t0 = time.perf_counter()
        x = pulp.LpVariable("x", lowBound=0, cat="Integer")
        p = pulp.LpProblem("pf", pulp.LpMinimize)
        p += x
        p += 250 * x >= 900
        p.solve(pulp.PULP_CBC_CMD(msg=False, timeLimit=5))
        ms = (time.perf_counter() - t0) * 1000
        line(GREEN if x.value() == 4 else RED, "CBC solver", f"{ms:.0f} ms")
    except Exception as e:  # noqa: BLE001
        line(RED, "CBC solver", str(e))
    try:
        from agent.policy import LocalCedarPolicyEngine
        from agent.tools.catalog import build_registry

        LocalCedarPolicyEngine(build_registry().names())
        line(GREEN, "Cedar policies", "validate against the schema")
    except Exception as e:  # noqa: BLE001
        line(RED, "Cedar policies", str(e)[:120])

    return summary()


def summary() -> int:
    reds = results.count(RED)
    print(f"\n{'READY' if not reds else f'{reds} BLOCKER(S)'}")
    return 1 if reds else 0


if __name__ == "__main__":
    sys.exit(main())
