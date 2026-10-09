"""PERCEIVE accuracy on the 20-item test set. Target >= 18/20 with T01 and T02 passing.

Usage: uv run python scripts/eval_perceive.py   (uses LLM_PROVIDER / BEDROCK_MODEL_ID)
"""

from __future__ import annotations

import json
import sys

from agent.perceive_eval import run_eval
from agent.providers import make_provider
from siaga_common.settings import get_settings


def main() -> int:
    settings = get_settings()
    if settings.llm_provider == "fake" and not settings.replay:
        print("WARNING: the fake provider is scripted for the demo; this score is meaningless.")
    report = run_eval(make_provider(settings))
    for r in report["rows"]:
        mark = "PASS" if not r["fails"] else "FAIL"
        print(f"{r['id']}  {mark}  {', '.join(r['fails'])}")
        if r["fails"]:
            fields = (
                "is_disruption",
                "cause",
                "lane",
                "delay_hours_min",
                "delay_hours_max",
                "references",
            )
            got = {k: (r["got"] or {}).get(k) for k in (*fields, "confidence")}
            print(f"      expected {json.dumps({k: r['expected'][k] for k in fields})}")
            print(f"      got      {json.dumps(got)}")
    print(
        f"\nPERCEIVE accuracy: {report['passed']}/{report['total']}  "
        f"demo items ok: {report['demo_ok']}"
    )
    return 0 if report["passed"] >= 18 and report["demo_ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
