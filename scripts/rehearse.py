"""Rehearse the demo N times through the Case API and report pass rate and timings.

Each run: reset -> start the demo case -> wait for the approval card -> check every
golden number -> approve the bridge PO -> wait for VERIFY -> check the resolved case and
the audit chain. With --inject transfer_delayed|po_cancelled a fault is injected after
approval and the run passes only if VERIFY fails and re-opens the case.

Target: the Case API at --url (default CASE_API_URL) if it answers, otherwise an
in-process Case API with an embedded mock SAP (LLM from LLM_PROVIDER / REPLAY).

Usage: uv run python scripts/rehearse.py -n 10 [--url URL | --local] [--inject EVENT]
"""

from __future__ import annotations

import argparse
import contextlib
import json
import statistics
import sys
import tempfile
import time
from collections import defaultdict
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from siaga_common.settings import REPO_ROOT, get_settings
from siaga_common.timeline import day_offset, from_iso

DEMO = REPO_ROOT / "data" / "demo"
REPORTS = REPO_ROOT / "var" / "rehearse"


class RunFailed(Exception):
    pass


@contextlib.contextmanager
def api_client(url: str | None, local: bool, verify_delay: int) -> Iterator[tuple[Any, str]]:
    if not local:
        try:
            httpx.get(f"{url}/health", timeout=3).raise_for_status()
            with httpx.Client(base_url=url, timeout=30) as client:
                yield client, f"Case API at {url}"
            return
        except httpx.HTTPError:
            print(f"(no Case API at {url}; using an in-process API with an embedded mock SAP)")
    import warnings

    warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient`")
    from fastapi.testclient import TestClient

    from api.app import create_app

    tmp = Path(tempfile.mkdtemp())
    settings = get_settings().model_copy(
        update={
            "embedded_sap": True,
            "verify_delay_seconds": verify_delay,
            "sqlite_path": tmp / "siaga.db",
            "audit_dir": tmp / "audit",
        }
    )
    with TestClient(create_app(settings)) as client:
        yield client, f"in-process Case API (LLM {settings.llm_provider}, replay={settings.replay})"


def wait_for(client, case_id: str, statuses: set[str], timeout: float) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while True:
        body = client.get(f"/cases/{case_id}").json()
        if body["case"]["status"] in statuses:
            return body
        if time.monotonic() > deadline:
            raise RunFailed(f"timed out in status {body['case']['status']} waiting for {statuses}")
        time.sleep(0.25)


def expect(cond: bool, what: str) -> None:
    if not cond:
        raise RunFailed(what)


def check_card_stage(case: dict[str, Any]) -> None:
    risk = case["risk"]
    expect(risk["max_exposure"] == 340_000_000, f"exposure {risk['max_exposure']}")
    expect(risk["expected_exposure"] == 340_000_000, "expected exposure")
    expect(risk["shortfall"] == 900, f"shortfall {risk['shortfall']}")
    expect(all(o["stockout_probability"] == 1.0 for o in risk["orders"]), "P(stockout) != 100%")
    expect(case["replan_count"] == 1, f"replans {case['replan_count']} != 1")
    options = {o["option_id"]: o for o in case["solver_results"]}
    rejected = [f for f in case["critic_findings"] if not f["clean"]]
    expect(
        any(
            options[f["option_id"]]["result"]["total_cost"] == 8_100_000
            and any(c["rule"] == "safety_stock" and not c["passed"] for c in f["checks"])
            for f in rejected
        ),
        "no Rp 8.100.000 option rejected for safety stock",
    )
    air = [o for o in options.values() if o["strategies"] == ["spot_air"]]
    expect(any(o["result"]["total_cost"] == 31_000_000 for o in air), "no Rp 31.000.000 air option")
    chosen = options[case["chosen_option"]]
    expect(chosen["result"]["total_cost"] == 11_400_000, "chosen plan != Rp 11.400.000")
    expect(case["summary"].get("saving_vs_baseline") == 19_600_000, "saving != Rp 19.600.000")
    expect(case["summary"].get("net_protected") == 328_600_000, "net protected != Rp 328.600.000")
    transfer = [a for a in case["actions"] if a["kind"] == "stock_transfer"]
    expect(
        len(transfer) == 1 and transfer[0]["status"] == "EXECUTED" and transfer[0]["tier"] == 2,
        "transfer not auto-executed at Tier 2",
    )
    expect(transfer[0]["cost"] == 3_900_000, "transfer != Rp 3.900.000")
    pending = [a for a in case["actions"] if a["status"] == "PENDING_APPROVAL"]
    expect(len(pending) == 1 and pending[0]["kind"] == "alternate_supplier", "no bridge PO card")
    expect(pending[0]["cost"] == 7_500_000 and pending[0]["tier"] == 3, "bridge != Rp 7.500.000 T3")
    approve_by = from_iso(pending[0]["card"]["approve_by"])
    expect(
        day_offset(from_iso(case["day0"]), approve_by) == (1, "18:00"), "approve-by != day 1 18:00"
    )
    expect(case["tool_call_count"] <= 20, f"tool calls {case['tool_call_count']} > 20")


def one_run(
    client, i: int, inject: str | None, timeout: float, verify_wait: float
) -> dict[str, Any]:
    r: dict[str, Any] = {"run": i, "ok": False}
    t0 = time.perf_counter()
    try:
        client.post("/demo/reset").raise_for_status()
        resp = client.post(
            "/cases",
            data={"whatsapp": (DEMO / "whatsapp_driver.txt").read_text()},
            files={
                "pdf": (
                    "forwarder_notice.pdf",
                    (DEMO / "forwarder_notice.pdf").read_bytes(),
                    "application/pdf",
                )
            },
        )
        resp.raise_for_status()
        case_id = r["case_id"] = resp.json()["case_id"]
        body = wait_for(
            client, case_id, {"AWAITING_APPROVAL", "ESCALATED", "RESOLVED", "REOPENED"}, timeout
        )
        r["t_card_s"] = round(time.perf_counter() - t0, 2)
        case = body["case"]
        expect(
            case["status"] == "AWAITING_APPROVAL",
            f"{case['status']}: {case.get('escalation_reason')}",
        )
        check_card_stage(case)
        approval = next(a for a in body["approvals"] if a["status"] == "PENDING")
        t1 = time.perf_counter()
        client.post(
            f"/cases/{case_id}/approvals/{approval['approval_id']}",
            json={"decision": "approve", "by": "rehearse"},
        ).raise_for_status()
        body = wait_for(
            client, case_id, {"VERIFYING", "RESOLVED", "ESCALATED", "REOPENED"}, timeout
        )
        r["t_approve_to_po_s"] = round(time.perf_counter() - t1, 2)
        po = next(a for a in body["case"]["actions"] if a["kind"] == "alternate_supplier")
        expect(
            po["status"] == "EXECUTED" and str(po.get("sap_ref", "")).startswith("45"),
            "PO not created",
        )
        r["po"] = po["sap_ref"]
        if inject:
            client.post("/demo/inject", json={"event": inject}).raise_for_status()
        body = wait_for(
            client, case_id, {"RESOLVED", "ESCALATED", "REOPENED"}, verify_wait + timeout
        )
        case = body["case"]
        if inject:
            expect(case["status"] == "REOPENED", f"expected re-opened case, got {case['status']}")
            expect(not case["verification"]["covered"], "verification should fail after the fault")
        else:
            expect(case["status"] == "RESOLVED", f"final status {case['status']}")
            expect(case["verification"]["covered"], "verification not covered")
        audit = client.get(f"/cases/{case_id}/audit").json()
        expect(
            audit["verification"]["ok"],
            f"audit chain broken at {audit['verification']['broken_at']}",
        )
        r.update(
            ok=True,
            t_total_s=round(time.perf_counter() - t0, 2),
            tool_calls=case["tool_call_count"],
            llm_calls=case["llm_call_count"],
            stages={k: float(v.get("elapsed_s", 0)) for k, v in case["stage_timestamps"].items()},
        )
    except (RunFailed, httpx.HTTPError, KeyError, StopIteration) as e:
        r["error"] = f"{type(e).__name__}: {e}"
        r["t_total_s"] = round(time.perf_counter() - t0, 2)
    return r


def summarise(runs: list[dict[str, Any]], target: str, inject: str | None) -> dict[str, Any]:
    ok = [r for r in runs if r["ok"]]
    stage_totals: dict[str, list[float]] = defaultdict(list)
    for r in ok:
        per: dict[str, float] = defaultdict(float)
        for key, s in r["stages"].items():
            per[key.split("#")[0]] += s
        for k, v in per.items():
            stage_totals[k].append(v)

    def stat(xs: list[float]) -> dict[str, float] | None:
        return {"mean": round(statistics.mean(xs), 2), "max": round(max(xs), 2)} if xs else None

    return {
        "at": datetime.now(UTC).isoformat(timespec="seconds"),
        "target": target,
        "inject": inject,
        "passed": len(ok),
        "total": len(runs),
        "t_card_s": stat([r["t_card_s"] for r in ok]),
        "t_approve_to_po_s": stat([r["t_approve_to_po_s"] for r in ok]),
        "t_total_s": stat([r["t_total_s"] for r in ok]),
        "stage_s": {k: stat(v) for k, v in stage_totals.items()},
        "runs": runs,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("-n", type=int, default=10)
    ap.add_argument("--url", default=None, help="Case API URL (default CASE_API_URL)")
    ap.add_argument("--local", action="store_true", help="always use an in-process Case API")
    ap.add_argument("--inject", choices=["transfer_delayed", "po_cancelled"])
    ap.add_argument("--timeout", type=float, default=300, help="seconds per waiting step")
    ap.add_argument("--verify-delay", type=int, default=3, help="in-process API only")
    args = ap.parse_args()
    url = args.url or get_settings().case_api_url
    if args.inject and args.verify_delay < 3:
        args.verify_delay = 3  # the fault must land before VERIFY fires

    with api_client(url, args.local, args.verify_delay) as (client, target):
        cfg = client.get("/config").json()
        verify_wait = cfg["verify_delay_seconds"] + 5
        if args.inject and cfg["verify_delay_seconds"] < 3:
            print("WARNING: VERIFY_DELAY_SECONDS < 3 on the API; VERIFY may run before the fault")
        extra = f", inject {args.inject}" if args.inject else ""
        print(
            f"Rehearsing {args.n}x against {target}; LLM {cfg['llm_provider']}, "
            f"VERIFY delay {cfg['verify_delay_seconds']} s{extra}"
        )
        runs = []
        for i in range(1, args.n + 1):
            r = one_run(client, i, args.inject, args.timeout, verify_wait)
            runs.append(r)
            mark = "PASS" if r["ok"] else "FAIL"
            times = (
                f"card {r['t_card_s']:6.1f}s  approve->PO {r['t_approve_to_po_s']:5.1f}s  "
                f"total {r['t_total_s']:6.1f}s  tools {r['tool_calls']:>2}  llm {r['llm_calls']:>2}"
                if r["ok"]
                else r.get("error", "")
            )
            print(f"  run {i:>2}  {mark}  {times}")

    report = summarise(runs, target, args.inject)
    REPORTS.mkdir(parents=True, exist_ok=True)
    path = REPORTS / f"report-{datetime.now(UTC):%Y%m%dT%H%M%SZ}.json"
    path.write_text(json.dumps(report, indent=2))
    print(f"\nPASS RATE {report['passed']}/{report['total']}")
    if report["t_total_s"]:
        card, total = report["t_card_s"], report["t_total_s"]
        print(f"time to approval card  mean {card['mean']} s, max {card['max']} s")
        print(f"signal -> end          mean {total['mean']} s, max {total['max']} s")
        stages = ", ".join(f"{k} {v['mean']}/{v['max']}" for k, v in report["stage_s"].items() if v)
        print(f"per stage (mean / max s): {stages}")
    print(f"report: {path.relative_to(REPO_ROOT)}")
    return 0 if report["passed"] == report["total"] else 1


if __name__ == "__main__":
    sys.exit(main())
