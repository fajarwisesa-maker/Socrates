"""Preview the delay prediction for the demo case, without running a case or touching risk.

    DELAY_MODEL=rpt uv run python scripts/predict_demo.py     # or: make predict-demo
    DELAY_MODEL=fake ...                                       # the offline stand-in

Prints the case row sent with the 80 history rows, the model's answer, and what the agreed
rule would do with it (inside 48-72 h -> used; outside -> clamped, "model and signal
disagree"). Nothing is stored and no case is opened.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime

from agent.delay_model import PredictionUnavailable, combine, make_delay_model, query_row
from agent.signals import build_signals
from siaga_common.settings import REPO_ROOT, get_settings
from siaga_common.timeline import to_iso

DEMO = REPO_ROOT / "data" / "demo"
SIGNAL_RANGE = (48.0, 72.0)  # what Perceive reads from the demo signals ("2-3 hari", "48-72 hours")
SLACK_HOURS = 32  # PO 4500018231 due Day 1 10:00, loading cutoff Day 2 18:00


def main() -> int:
    s = get_settings()
    if s.delay_model == "signal":
        print("set DELAY_MODEL=rpt (SAP RPT-1.6 on AI Core) or DELAY_MODEL=fake (offline stand-in)")
        return 2
    signals = build_signals(
        (DEMO / "whatsapp_driver.txt").read_text(encoding="utf-8"), DEMO / "forwarder_notice.pdf"
    )
    disruption = {"cause": "flood", "lane": "SMG-JKT"}  # Perceive's reading of the demo signals
    query = query_row(disruption, signals, to_iso(datetime.now(UTC)))
    model = make_delay_model(s)
    assert model is not None
    print(f"delay model: {s.delay_model}  (history: {s.history_path.relative_to(REPO_ROOT)})")
    print(f"case row:    {query}  delay_hours=[PREDICT]")
    try:
        p = model.predict("predict-demo", query)
    except PredictionUnavailable as e:
        print(f"prediction:  UNAVAILABLE ({e}) -> the risk function would use the signal range")
        return 1
    ci = f", interval {p.interval[0]:g}-{p.interval[1]:g} h" if p.interval else ""
    print(f"prediction:  {p.prediction:.1f} h{ci}  by {p.model}  ({p.latency_ms:.0f} ms)")
    out = combine(p, *SIGNAL_RANGE, query)
    used = out["delay_for_risk_hours"][0]
    rng = f"{SIGNAL_RANGE[0]:g}-{SIGNAL_RANGE[1]:g} h"
    verdict = (
        f"outside {rng} -> clamped to {used:g} h ({out['flag']})"
        if out["disagree"]
        else f"inside {rng} -> risk would use {used:g} h"
    )
    print(f"rule:        {verdict}")
    late = used > SLACK_HOURS
    print(
        f"demo check:  {used:g} h {'>' if late else '<='} {SLACK_HOURS} h of slack -> PO "
        + (
            "still misses the Day 2 18:00 cutoff; every golden number holds"
            if late
            else "would make the cutoff: the demo numbers would change"
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
