"""Record the golden demo run for replay mode (data/golden/).

Runs the demo case in-process (embedded mock SAP, throwaway case store) with the configured
LLM wrapped in a RecordingProvider, approves the bridge PO, verifies, and only then
accepts the recording - if the run does not reach the brief's outcome (one replan, option
B at Rp 11.400.000, transfer executed, bridge PO approved, case RESOLVED) nothing is
written.

    data/golden/llm.jsonl   every LLM response in call order, per purpose
    data/golden/meta.json   provider, model, prompt versions, per-call latency and usage,
                            per-stage timings, outcome

Usage: uv run python scripts/record_golden.py [--provider bedrock|fake]
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

from agent.audit import LocalAuditWriter
from agent.case_store import SqliteCaseStore
from agent.machine import Agent
from agent.providers import make_provider
from agent.providers.replay import RecordingProvider
from agent.runtime import build_runtime
from agent.signals import build_signals
from services.sap_mock.embedded import embedded_sap
from siaga_common.settings import REPO_ROOT, get_settings

GOLDEN = REPO_ROOT / "data" / "golden"
DEMO = REPO_ROOT / "data" / "demo"


def check(cond: bool, what: str, failures: list[str]) -> None:
    if not cond:
        failures.append(what)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--provider", choices=["bedrock", "fake"])
    ap.add_argument("--out", type=Path, default=GOLDEN)
    args = ap.parse_args()

    overrides = {"replay": False, "llm_record_path": None, "verify_delay_seconds": 0}
    if args.provider:
        overrides["llm_provider"] = args.provider
    settings = get_settings().model_copy(update=overrides)
    if settings.llm_provider == "replay":
        print("refusing to record a replay of a replay; set LLM_PROVIDER=bedrock (or fake)")
        return 2

    tmp = Path(tempfile.mkdtemp())
    sap, _ = embedded_sap()
    runtime = build_runtime(
        settings,
        sap=sap,
        store=SqliteCaseStore(":memory:"),
        audit=LocalAuditWriter(tmp / "audit"),
    )
    inner = make_provider(settings)
    recorder = RecordingProvider(inner, tmp / "llm.jsonl")
    agent = Agent(runtime, recorder)

    t0 = time.perf_counter()
    signals = build_signals(
        (DEMO / "whatsapp_driver.txt").read_text(), DEMO / "forwarder_notice.pdf"
    )
    case = agent.start_case(signals)
    c = agent.run(case.case_id)
    t_card = time.perf_counter() - t0
    failures: list[str] = []
    check(c.status == "AWAITING_APPROVAL", f"status {c.status} ({c.escalation_reason})", failures)
    if not failures:
        chosen = next(o for o in c.solver_results if o["option_id"] == c.chosen_option)
        check(c.replan_count == 1, f"replans {c.replan_count} != 1", failures)
        check(
            chosen["result"]["total_cost"] == 11_400_000,
            "chosen plan is not Rp 11.400.000",
            failures,
        )
        pending = [a for a in c.actions if a["status"] == "PENDING_APPROVAL"]
        check(
            len(pending) == 1 and pending[0]["kind"] == "alternate_supplier",
            "no bridge PO card",
            failures,
        )
        if not failures:
            c = agent.decide(c.case_id, pending[0]["approval_id"], True, by="record-golden")
            c = agent.verify(c.case_id) if c.status == "VERIFYING" else c
            check(c.status == "RESOLVED", f"final status {c.status}", failures)
    if failures:
        print("NOT recording - the run left the golden path:")
        for f in failures:
            print("  -", f)
        return 1

    entries = [json.loads(line) for line in (tmp / "llm.jsonl").read_text().splitlines()]
    audit = runtime.audit.read(c.case_id)
    prompts = sorted({e.payload["prompt"] for e in audit if e.kind == "llm_call"})
    meta = {
        "recorded_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "provider": inner.name,
        "model": entries[0]["response"]["model"] if entries else None,
        "prompts": prompts,
        "llm_calls": [
            {
                "purpose": e["purpose"],
                "index": e["index"],
                "latency_ms": e["response"]["latency_ms"],
                "usage": e["response"]["usage"],
            }
            for e in entries
        ],
        "stage_timings_s": {k: v.get("elapsed_s") for k, v in c.stage_timestamps.items()},
        "seconds_to_approval_card": round(t_card, 2),
        "outcome": {
            "chosen_option": c.chosen_option,
            "summary": c.summary,
            "tool_calls": c.tool_call_count,
            "llm_calls": c.llm_call_count,
            "replans": c.replan_count,
            "actions": [(a["kind"], a["status"], a.get("sap_ref")) for a in c.actions],
        },
    }
    args.out.mkdir(parents=True, exist_ok=True)
    shutil.copy(tmp / "llm.jsonl", args.out / "llm.jsonl")
    (args.out / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False) + "\n")
    print(f"recorded {len(entries)} LLM responses from {inner.name} -> {args.out}/llm.jsonl")
    print(f"prompts {prompts}; {c.tool_call_count} tool calls; card after {t_card:.1f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
