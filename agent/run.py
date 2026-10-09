"""Run one SIAGA case from the command line and print the stage events.

    python -m agent.run --whatsapp data/demo/whatsapp_driver.txt \
                        --pdf data/demo/forwarder_notice.pdf [--auto-approve]

The LLM provider comes from LLM_PROVIDER / REPLAY (or --provider). With --embedded-sap
(or when SAP_MOCK_URL is not reachable) an in-memory mock S/4HANA seeded for today is
used, so the CLI needs no other process.
"""

from __future__ import annotations

import argparse
import sys
import time
import warnings
from pathlib import Path

import httpx

from agent.case_store import CaseEvent, CaseRecord
from agent.clients import HttpSapClient
from agent.machine import Agent
from agent.providers import make_provider
from agent.runtime import build_runtime
from agent.signals import build_signals
from siaga_common.money import format_idr
from siaga_common.settings import get_settings

DIM, BOLD, RED, GREEN, YELLOW, RESET = (
    "\033[2m",
    "\033[1m",
    "\033[31m",
    "\033[32m",
    "\033[33m",
    "\033[0m",
)
COLOUR = {
    "completed": GREEN,
    "executed": GREEN,
    "resolved": GREEN,
    "rejected": RED,
    "escalated": RED,
    "waiting": YELLOW,
}


def embedded_sap() -> HttpSapClient:
    warnings.filterwarnings("ignore", message="Using `httpx` with `starlette.testclient`")
    from fastapi.testclient import TestClient

    from services.sap_mock.app import create_app
    from services.sap_mock.seed import reset_store
    from services.sap_mock.store import SqliteSapStore

    store = SqliteSapStore(":memory:")
    reset_store(store)
    return HttpSapClient(client=TestClient(create_app(store)))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Run one SIAGA case")
    ap.add_argument("--whatsapp", type=Path, help="WhatsApp message text file")
    ap.add_argument("--pdf", type=Path, help="forwarder PDF")
    ap.add_argument("--provider", choices=["bedrock", "fake", "replay"])
    ap.add_argument("--embedded-sap", action="store_true", help="in-memory mock SAP")
    ap.add_argument("--auto-approve", action="store_true", help="approve Tier 3 requests")
    ap.add_argument("--verify-delay", type=int, help="override VERIFY_DELAY_SECONDS")
    ap.add_argument("--plain", action="store_true", help="no colours")
    args = ap.parse_args(argv)
    if not (args.whatsapp or args.pdf):
        ap.error("give --whatsapp and/or --pdf")

    overrides = {}
    if args.provider:
        overrides["llm_provider"] = args.provider
    if args.verify_delay is not None:
        overrides["verify_delay_seconds"] = args.verify_delay
    settings = get_settings().model_copy(update=overrides)
    colour = not args.plain and sys.stdout.isatty()

    sap = None
    if args.embedded_sap:
        sap = embedded_sap()
    else:
        try:
            httpx.get(f"{settings.sap_mock_url}/admin/state", timeout=2).raise_for_status()
        except httpx.HTTPError:
            print(f"(mock SAP not reachable at {settings.sap_mock_url}; using embedded mock SAP)")
            sap = embedded_sap()
    runtime = build_runtime(settings, sap=sap)
    llm = make_provider(settings)
    t0 = time.perf_counter()

    def show(e: CaseEvent) -> None:
        c = COLOUR.get(e.status, DIM if e.status in ("llm", "tool", "started") else "")
        c, reset = (c, RESET) if colour else ("", "")
        line = f"{time.perf_counter() - t0:6.1f}s  {e.stage:<9} {e.status:<10} {e.title}"
        print(f"{c}{line}{reset}")
        if e.detail and e.status not in ("llm", "started"):
            print(f"{'':28}{e.detail}")

    agent = Agent(runtime, llm, on_event=show)
    text = args.whatsapp.read_text() if args.whatsapp else None
    case = agent.start_case(build_signals(text, args.pdf))
    bold, reset = (BOLD, RESET) if colour else ("", "")
    print(f"{bold}SIAGA case {case.case_id}  (LLM: {llm.name}){reset}")
    c = agent.run(case.case_id)

    while c.status == "AWAITING_APPROVAL":
        for a in [a for a in c.actions if a["status"] == "PENDING_APPROVAL"]:
            card = a["card"]
            print(f"\n  APPROVAL {a['approval_id']}: {card['what']}  {card['cost_display']}")
            print(
                f"    approve by {card['approve_by_display']}; if rejected: {card['if_rejected']}"
            )
        if not args.auto_approve:
            print("\nWaiting for approval (re-run with --auto-approve, or use the Case API).")
            break
        a = next(a for a in c.actions if a["status"] == "PENDING_APPROVAL")
        c = agent.decide(c.case_id, a["approval_id"], True, by="cli-auto-approve")

    if c.status == "VERIFYING":
        delay = settings.verify_delay_seconds
        print(f"\n(waiting {delay} s for VERIFY)")
        time.sleep(delay)
        c = agent.verify(c.case_id)

    print_summary(c, time.perf_counter() - t0)
    return 0 if c.status in ("RESOLVED", "AWAITING_APPROVAL") else 1


def print_summary(c: CaseRecord, total_s: float) -> None:
    print("\n=== summary")
    print(f"status {c.status}  tool calls {c.tool_call_count}  LLM calls {c.llm_call_count}  "
          f"replans {c.replan_count}  wall {total_s:.1f} s")  # fmt: skip
    if c.escalation_reason:
        print(f"escalation: {c.escalation_reason}")
    if c.summary:
        s = c.summary
        line = (
            f"chosen {s['chosen']} {s['chosen_cost_display']}; exposure {s['max_exposure_display']}"
        )
        if "baseline" in s:
            line += f"; saving vs {s['baseline']} {s['saving_display']}"
        print(line)
    for a in c.actions:
        ref = a.get("sap_ref") or a.get("approval_id") or ""
        cost = format_idr(a["cost"])
        print(f"  {a['status']:<17} Tier {a['tier']}  {a['description']}  {cost}  {ref}")
    print("stage times (s):")
    for key, st in c.stage_timestamps.items():
        print(f"  {key:<12} {st.get('elapsed_s', '-')}")


if __name__ == "__main__":
    sys.exit(main())
