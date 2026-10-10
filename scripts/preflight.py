"""Demo-day pre-flight: is everything the live demo needs up and configured?

    uv run python scripts/preflight.py      (make preflight)

Exit code 1 if anything is red. Amber items are worth reading but do not block.
"""

from __future__ import annotations

import json
import sys
import time

import httpx

from siaga_common.settings import get_settings
from siaga_common.timeline import day0_for, to_iso, today_wib

GREEN, AMBER, RED = "\033[32m✓\033[0m", "\033[33m!\033[0m", "\033[31m✗\033[0m"
results: list[str] = []


def line(mark: str, what: str, detail: str = "") -> None:
    results.append(mark)
    print(f" {mark} {what}" + (f"  — {detail}" if detail else ""))


def get(url: str, timeout: float = 3) -> httpx.Response | None:
    try:
        r = httpx.get(url, timeout=timeout)
        return r if r.status_code < 500 else None
    except httpx.HTTPError:
        return None


def main() -> int:
    s = get_settings()
    replay = s.replay or s.llm_provider == "replay"
    print(
        f"SIAGA pre-flight  (LLM {'replay' if replay else s.llm_provider}, region {s.aws_region})\n"
    )

    # --- LLM ---------------------------------------------------------------------------
    meta_path = s.replay_path.parent / "meta.json"
    meta = json.loads(meta_path.read_text()) if meta_path.exists() else None
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
    api = get(f"{s.case_api_url}/config")
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
            st = get(f"{s.sap_mock_url}/admin/state")
            if st is None:
                line(RED, "mock SAP", f"not reachable at {s.sap_mock_url}")
            else:
                sap_day0 = st.json().get("day0")
                today = to_iso(day0_for(today_wib()))
                if sap_day0 != today:
                    line(AMBER, "mock SAP day 0", f"{sap_day0} != today {today}: press Reset demo")
                else:
                    line(GREEN, "mock SAP", f"{s.sap_mock_url}, day 0 = today")
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

    reds = results.count(RED)
    print(f"\n{'READY' if not reds else f'{reds} BLOCKER(S)'}")
    return 1 if reds else 0


if __name__ == "__main__":
    sys.exit(main())
