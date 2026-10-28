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
    url: str,
    timeout: float = 3,
    headers: dict[str, str] | None = None,
    params: dict[str, str] | None = None,
) -> httpx.Response | None:
    try:
        r = httpx.get(url, timeout=timeout, headers=headers, params=params)
        return r if r.status_code < 500 else None
    except httpx.HTTPError:
        return None


def env_line() -> str | None:
    from scripts.env_mode import check

    mode, problems = check(out=lambda *_: None)
    if mode is None:
        line(
            AMBER, ".env mode", "no SIAGA_MODE (hand-made .env?): make use-local|use-replay|use-v1"
        )
    elif problems:
        line(RED, f".env mode {mode}", "; ".join(problems) + " (make env-check)")
    else:
        line(GREEN, f".env mode {mode}", "env-check ok")
    return mode


def aws_identity(s: Settings, fail: str = RED) -> None:
    try:
        import boto3

        who = boto3.client("sts", region_name=s.aws_region).get_caller_identity()
        line(GREEN, "laptop AWS identity",
             f"account {who['Account']}, user {who['Arn'].rsplit('/', 1)[-1]}")  # fmt: skip
    except Exception as e:  # noqa: BLE001 - botocore errors carry no secret values
        hint = "aws configure --profile siaga, or aws sso login --profile siaga"
        line(fail, "laptop AWS identity", f"{type(e).__name__} ({hint})")


CONNECTIONS = [
    ("secret", "deployed agent reads siaga/sap"),
    ("llm", "LLM call from the deployed agent"),
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


def llm_line(what: str, provider, fail: str = RED) -> None:
    from agent.providers import ping

    try:
        r = ping(provider)
        ok = r["tool_use"]
        call = "tool call ok" if ok else "tool call MISSING"
        line(GREEN if ok else fail, what, f"{r['model']}: {call} in {r['latency_s']} s")
    except Exception as e:  # noqa: BLE001 - provider errors carry no secret values
        line(fail, what, f"{type(e).__name__}: {str(e)[:160]}")


def local_preflight(s: Settings) -> None:
    """Mode local (laptop live): live LLM, BTP mock and RPT-1.6; everything else local."""
    env_line()
    bedrock = s.llm_provider == "bedrock"
    # with the SAP fallback, a Bedrock problem is worth reading but does not stop the demo
    soft = AMBER if s.llm_fallback else RED
    if bedrock:
        aws_identity(s, soft)
    else:
        line(AMBER, "laptop AWS identity", f"not used while LLM_PROVIDER={s.llm_provider}")
    # --- LLM: the primary, and the fallback on its own
    if s.llm_provider in ("bedrock", "sap_genai"):
        from agent.providers import make_provider

        try:
            p = make_provider(s.model_copy(update={"llm_record_path": None}))
        except Exception as e:  # noqa: BLE001 - missing settings / profile; no secret values
            line(RED, f"LLM {s.llm_provider}", f"{type(e).__name__}: {str(e)[:160]}")
        else:
            if hasattr(p, "fallback"):
                llm_line(f"LLM Bedrock {s.bedrock_model_id}", p.primary, soft)
                llm_line(f"LLM fallback: Claude via SAP AI Core ({s.sap_genai_model})", p.fallback)
            else:
                llm_line(f"LLM {s.llm_provider}", p)
    else:
        line(RED, "LLM", f"LLM_PROVIDER={s.llm_provider}: mode local needs a live model")
    # --- BTP mock: the key is enforced and ours is accepted
    try:
        url, headers = s.sap_endpoint()
    except RuntimeError as e:
        line(RED, "BTP mock", str(e))
    else:
        open_ = get(f"{url}/admin/state", timeout=10)
        keyed = get(f"{url}/admin/state", timeout=10, headers=headers)
        if keyed is None or keyed.status_code != 200:
            why = "not reachable" if keyed is None else f"HTTP {keyed.status_code} with the key"
            line(RED, "BTP mock", f"{why} at {url}")
        elif open_ is not None and open_.status_code == 200:
            line(RED, "BTP mock", f"{url} answers without a key: SAP_MOCK_API_KEY not set there")
        else:
            day0, today = keyed.json().get("day0"), to_iso(day0_for(today_wib()))
            stale = "" if day0 == today else f"; day 0 {day0} != today: make demo-reset"
            line(GREEN if not stale else AMBER, "BTP mock",
                 f"{url}, key required and accepted{stale}")  # fmt: skip
    # --- AI Core token + one RPT-1.6 call
    from datetime import UTC, datetime

    from agent.delay_model import PredictionUnavailable, demo_query, make_delay_model

    try:
        model = make_delay_model(s.model_copy(update={"delay_model": "rpt", "replay": False,
                                                      "llm_provider": "bedrock"}))  # fmt: skip
        assert model is not None
        p = model.predict("preflight", demo_query(to_iso(datetime.now(UTC))))
        line(GREEN, "AI Core token + RPT-1.6",
             f"{p.prediction:.1f} h for the demo case in {p.latency_ms:.0f} ms")  # fmt: skip
    except (RuntimeError, PredictionUnavailable) as e:
        line(RED, "AI Core token + RPT-1.6", str(e)[:200])
    if s.delay_model != "rpt":
        line(AMBER, "DELAY_MODEL", f"{s.delay_model}: the demo would not use RPT-1.6")
    # --- local stores
    local_stores(s)
    if s.whatsapp_inbound:
        whatsapp_line(s)
    if s.whatsapp_notify:
        if not s.whatsapp_inbound:
            line(AMBER, "WhatsApp replies", "WHATSAPP_NOTIFY=1 without WHATSAPP_INBOUND=1: no case "
                 "comes from WhatsApp, so nothing is ever sent")  # fmt: skip
        whatsapp_notify_line(s)


def whatsapp_line(s: Settings) -> None:
    """The webhook answers Meta's verification locally (the tunnel and Meta are not checked)."""
    from api.whatsapp import allowed_set

    what = f"WhatsApp webhook :{s.whatsapp_port}"
    if s.whatsapp_provider == "twilio":
        twilio_line(s, what)
        return
    if not s.whatsapp_verify_token or not s.whatsapp_app_secret:
        line(RED, what, "WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET missing (fill-whatsapp.sh)")
        return
    if not allowed_set(s.whatsapp_allowed_senders):
        line(RED, what, "WHATSAPP_ALLOWED_SENDERS is empty: every message would be ignored")
        return
    r = get(
        f"http://127.0.0.1:{s.whatsapp_port}/webhooks/whatsapp",
        params={
            "hub.mode": "subscribe",
            "hub.verify_token": s.whatsapp_verify_token.get_secret_value(),
            "hub.challenge": "preflight",
        },
    )
    if r is None:
        line(RED, what, "not running (make whatsapp), and expose it with make tunnel")
    elif r.status_code != 200 or r.text != "preflight":
        line(RED, what, f"verification answered HTTP {r.status_code}")
    else:
        n = len(allowed_set(s.whatsapp_allowed_senders))
        line(
            GREEN, what, f"verification ok, {n} allowed sender(s); Meta must call it via the tunnel"
        )


def twilio_line(s: Settings, what: str) -> None:
    """Twilio has no verification handshake: an unsigned POST must be refused (401), which
    shows the webhook runs and checks signatures. Twilio and the tunnel are not checked."""
    from api.whatsapp import TWILIO_PATH, allowed_set

    what += " (Twilio)"
    if not s.twilio_auth_token:
        line(RED, what, "TWILIO_AUTH_TOKEN missing (fill-twilio.sh)")
        return
    if not allowed_set(s.whatsapp_allowed_senders):
        line(RED, what, "WHATSAPP_ALLOWED_SENDERS is empty: every message would be ignored")
        return
    try:
        r = httpx.post(f"http://127.0.0.1:{s.whatsapp_port}{TWILIO_PATH}", data={}, timeout=3)
    except httpx.HTTPError:
        line(RED, what, "not running (make whatsapp), and expose it with make tunnel")
        return
    if r.status_code != 401:
        line(RED, what, f"an unsigned call answered HTTP {r.status_code}, expected 401")
    else:
        n = len(allowed_set(s.whatsapp_allowed_senders))
        line(GREEN, what, f"running, signatures checked, {n} allowed sender(s); set "
             f"https://<tunnel>{TWILIO_PATH} in the Twilio sandbox settings")  # fmt: skip


def whatsapp_notify_line(s: Settings) -> None:
    """Option B: the access token and phone number ID are valid (a read; nothing is sent)."""
    from api.whatsapp_notify import NotifyError, make_sender

    what = "WhatsApp replies" + (" (Twilio)" if s.whatsapp_provider == "twilio" else "")
    try:
        number = make_sender(s).check()
    except RuntimeError as e:
        script = "fill-twilio.sh" if s.whatsapp_provider == "twilio" else "fill-whatsapp.sh"
        line(RED, what, f"{e} ({script})")
    except NotifyError as e:
        hint = (
            "check the account SID and auth token"
            if s.whatsapp_provider == "twilio"
            else "a temporary access token expires after about a day"
        )
        line(RED, what, f"{e} ({hint})")
    else:
        line(GREEN, what, f"token ok, replies come from {number}")


def local_stores(s: Settings) -> None:
    import tempfile

    problems = []
    try:
        from agent.case_store import SqliteCaseStore

        s.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        SqliteCaseStore(s.sqlite_path).list_cases()
    except Exception as e:  # noqa: BLE001
        problems.append(f"case store {s.sqlite_path}: {e}")
    try:
        s.audit_dir.mkdir(parents=True, exist_ok=True)
        tempfile.NamedTemporaryFile(dir=s.audit_dir).close()
    except OSError as e:
        problems.append(f"audit dir {s.audit_dir}: {e}")
    try:
        from agent.kb import LocalBM25KB

        LocalBM25KB().search("Pantura flood", 1)
    except Exception as e:  # noqa: BLE001
        problems.append(f"KB: {e}")
    # S3 audit and the Lambda solver are allowed here (aws_lines checks them)
    backends = (s.case_store, s.kb_backend, s.policy_backend)
    if backends != ("sqlite", "local", "local") or s.solver_backend == "http":
        problems.append(f"backends {backends + (s.solver_backend,)} are not supported here")
    line(RED if problems else GREEN, "local stores (SQLite cases, audit files, KB)",
         "; ".join(problems) or f"{s.sqlite_path.name}, {s.audit_dir.name}/, BM25 KB")  # fmt: skip
    aws_lines(s)


def aws_lines(s: Settings, clients: dict | None = None) -> None:
    """AUDIT_BACKEND=s3 / SOLVER_BACKEND=lambda: the bucket's Object Lock and one CBC solve on
    Lambda (which also warms it up before the demo). Nothing is written to the bucket."""
    clients = clients or {}

    def client(name: str):
        if name not in clients:
            import boto3

            clients[name] = boto3.client(name, region_name=s.aws_region)
        return clients[name]

    if s.audit_backend == "s3":
        what = "S3 audit trail"
        if not s.audit_s3_bucket:
            line(RED, what, "AUDIT_S3_BUCKET missing (make aws-setup)")
        else:
            try:
                cfg = client("s3").get_object_lock_configuration(Bucket=s.audit_s3_bucket)
                rule = cfg["ObjectLockConfiguration"].get("Rule", {}).get("DefaultRetention", {})
                if rule.get("Mode"):
                    line(GREEN, what, f"{s.audit_s3_bucket}: Object Lock {rule['Mode']} "
                         f"{rule.get('Days') or rule.get('Years')} day(s)")  # fmt: skip
                else:
                    line(RED, what, f"{s.audit_s3_bucket}: no default retention (make aws-setup)")
            except Exception as e:  # noqa: BLE001
                line(RED, what, f"{s.audit_s3_bucket}: {type(e).__name__}: {str(e)[:160]}")
    if s.solver_backend == "lambda":
        from agent.clients import LambdaSolver

        what = f"Lambda solver {s.solver_lambda_name}"
        fallback = " (cases would solve in process)" if s.solver_lambda_fallback else ""
        try:
            t0 = time.perf_counter()
            r = LambdaSolver(s.solver_lambda_name, client=client("lambda")).ping()
            ms = round((time.perf_counter() - t0) * 1000)
            if r.get("ok"):
                line(GREEN, what, f"CBC solve ok on Lambda ({r.get('solve_ms')} ms; round "
                     f"trip {ms} ms, now warm)")  # fmt: skip
            else:
                line(RED, what, f"ping answered {r}{fallback}")
        except Exception as e:  # noqa: BLE001
            line(RED, what, f"{str(e)[:200]}{fallback}")


def main() -> int:
    export_aws_env()
    s = get_settings()
    if s.siaga_mode == "local":
        print(f"SIAGA pre-flight  (mode local: laptop live, LLM {s.llm_provider}"
              + (f" + fallback {s.llm_fallback}" if s.llm_fallback else "") + ")\n")  # fmt: skip
        local_preflight(s)
        local_stack(s)
        return summary()
    if s.siaga_mode == "aws":
        print(f"SIAGA pre-flight  (mode aws, Case API {s.case_api_url}, region {s.aws_region})\n")
        aws_preflight(s)
        return summary()
    replay = s.replay or s.llm_provider == "replay"
    print(
        f"SIAGA pre-flight  (LLM {'replay' if replay else s.llm_provider}, region {s.aws_region})\n"
    )
    env_line()
    llm_checks(s, replay)
    local_stack(s)
    return summary()


def llm_checks(s: Settings, replay: bool) -> None:

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
                "placeholder from the scripted fake LLM; re-record live (make record-golden)",
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
    elif s.llm_provider == "sap_genai":
        from agent.providers import make_sap_genai

        try:
            llm_line(f"LLM Claude via SAP AI Core ({s.sap_genai_model})", make_sap_genai(s))
        except Exception as e:  # noqa: BLE001
            line(RED, "LLM sap_genai", str(e))
    else:
        line(AMBER, "LLM provider", "fake (scripted) - fine for rehearsal, not for the live demo")


def local_stack(s: Settings) -> None:
    """The processes of `make dev` (Case API, mock SAP, dashboard) and the deterministic core."""
    replay = s.replay or s.llm_provider == "replay"
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


def summary() -> int:
    reds = results.count(RED)
    print(f"\n{'READY' if not reds else f'{reds} BLOCKER(S)'}")
    return 1 if reds else 0


if __name__ == "__main__":
    sys.exit(main())
