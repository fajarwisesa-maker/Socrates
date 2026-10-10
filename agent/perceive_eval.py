"""Score PERCEIVE against data/demo/perceive_testset.jsonl (rules in PERCEIVE_TESTSET.md).

Uses the production PERCEIVE path (Agent._perceive) with a throwaway in-memory store.
"""

from __future__ import annotations

import json
import tempfile
from pathlib import Path
from typing import Any

from agent.audit import LocalAuditWriter
from agent.case_store import SqliteCaseStore
from agent.clients import HttpSapClient, InProcessSolver
from agent.machine import Agent, Escalate
from agent.providers.base import LLMProvider
from agent.runtime import build_runtime
from agent.signals import pdf_text
from siaga_common.settings import REPO_ROOT, Settings

TESTSET = REPO_ROOT / "data" / "demo" / "perceive_testset.jsonl"
DELAY_TOLERANCE_H = 12


def load_testset(path: Path = TESTSET) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def _signals(item: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for s in item["signals"]:
        if s["type"] == "pdf":
            out.append(
                {
                    "type": "pdf",
                    "filename": Path(s["path"]).name,
                    "text": pdf_text(REPO_ROOT / s["path"]),
                }
            )
        else:
            out.append(s)
    return out


def score(expected: dict[str, Any], got: dict[str, Any] | None) -> list[str]:
    """Return the list of failed fields (empty = pass)."""
    if got is None:
        return ["no output"]
    if got["is_disruption"] != expected["is_disruption"]:
        return ["is_disruption"]
    if not expected["is_disruption"]:
        return []
    fails = [f for f in ("cause", "lane") if got.get(f) != expected[f]]
    for f in ("delay_hours_min", "delay_hours_max"):
        e, g = expected[f], got.get(f)
        if (e is None) != (g is None) or (e is not None and abs(e - g) > DELAY_TOLERANCE_H):
            fails.append(f)
    if set(got.get("references") or []) != set(expected["references"]):
        fails.append("references")
    return fails


def run_eval(llm: LLMProvider) -> dict[str, Any]:
    tmp = Path(tempfile.mkdtemp())
    runtime = build_runtime(
        Settings(_env_file=None),
        sap=HttpSapClient("http://unused.invalid"),
        solver=InProcessSolver(),
        store=SqliteCaseStore(":memory:"),
        audit=LocalAuditWriter(tmp / "audit"),
    )
    agent = Agent(runtime, llm)
    rows = []
    for item in load_testset():
        case = agent.start_case(_signals(item))
        try:
            agent._perceive(case.case_id)
        except Escalate:
            pass  # escalations after PERCEIVE (e.g. no delay) do not affect scoring
        except Exception as e:  # noqa: BLE001
            rows.append(
                {
                    "id": item["id"],
                    "fails": [f"error: {e}"],
                    "got": None,
                    "expected": item["expected"],
                }
            )
            continue
        got = runtime.store.get_case(case.case_id).disruption
        rows.append(
            {
                "id": item["id"],
                "fails": score(item["expected"], got),
                "got": got,
                "expected": item["expected"],
            }
        )
    by_id = {r["id"]: r for r in rows}
    t01, t02 = by_id["T01"]["got"], by_id["T02"]["got"]
    # Confidence is graded in code from the located evidence (agent/evidence.py).
    fusion_ok = bool(t01 and t02 and t01["confidence"] == "Medium" and t02["confidence"] == "High")
    if not fusion_ok:
        by_id["T02"]["fails"].append("confidence (T01 must be Medium, T02 High)")
    passed = sum(1 for r in rows if not r["fails"])
    return {
        "passed": passed,
        "total": len(rows),
        "demo_ok": not by_id["T01"]["fails"] and not by_id["T02"]["fails"],
        "rows": rows,
    }
