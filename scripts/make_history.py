"""Generate data/history/disruptions.csv: a SYNTHETIC history of 80 Indonesian logistics
disruptions, the context rows SAP RPT-1.6 learns from (v2 step 3, DELAY_MODEL=rpt).

Deterministic (fixed seed). The patterns are plausible, not measured:
- floods on the Pantura corridor in the wet season (Oct-Mar) last 2-3 days, longer when an
  official notice was issued and the rain was heavy; dry-season floods are short;
- landslides on the Trans-Java toll (Cipularang / Puncak) take 1-3 days to clear;
- road closures and accidents cost hours, not days;
- port strikes at Tanjung Priok last 2-5 days;
- festive congestion (Lebaran, year end) adds 12-48 h, most on Merak-Bakauheni.
Cause names match the precedents (flood, landslide, road_closure, port_strike, accident).

    uv run python scripts/make_history.py
"""

from __future__ import annotations

import csv
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "history" / "disruptions.csv"
HEADER = (
    "# SYNTHETIC DATA for the SIAGA hackathon prototype: invented, plausible history of "
    "Indonesian logistics disruptions (scripts/make_history.py). Not real events.\n"
)
WET = {10, 11, 12, 1, 2, 3}  # Java rainy season (onset Oct-Nov)

# (cause, corridor, count, months, base delay range in hours)
PROFILES = [
    ("flood", "Pantura", 18, [10, 11, 12, 1, 2, 3, 4], (40, 66)),
    ("flood", "Trans-Java toll", 6, [11, 12, 1, 2, 3], (12, 34)),
    ("flood", "Tanjung Priok", 4, [12, 1, 2], (10, 28)),
    ("landslide", "Trans-Java toll", 8, [11, 12, 1, 2, 3, 4], (24, 60)),
    ("road_closure", "Trans-Java toll", 8, list(range(1, 13)), (6, 22)),
    ("road_closure", "Pantura", 5, list(range(1, 13)), (5, 16)),
    ("accident", "Trans-Java toll", 7, list(range(1, 13)), (3, 9)),
    ("accident", "Pantura", 5, list(range(1, 13)), (2, 7)),
    ("port_strike", "Tanjung Priok", 7, [3, 5, 6, 8, 9], (48, 110)),
    ("festive_congestion", "Pantura", 6, [3, 4, 12], (12, 30)),
    ("festive_congestion", "Merak-Bakauheni", 6, [3, 4, 12], (20, 48)),
]


def rain_for(cause: str, month: int, rng: random.Random) -> str:
    if cause in ("flood", "landslide"):
        return rng.choice(["heavy", "heavy", "moderate"] if month in WET else ["moderate", "light"])
    if month in WET:
        return rng.choice(["light", "moderate", "heavy", "none"])
    return rng.choice(["none", "none", "light"])


def main() -> None:
    rng = random.Random(20261025)
    rows = []
    for cause, corridor, count, months, (lo, hi) in PROFILES:
        for _ in range(count):
            month = rng.choice(months)
            rain = rain_for(cause, month, rng)
            notice = (
                "y" if rng.random() < (0.7 if cause in ("flood", "port_strike") else 0.4) else "n"
            )
            sources = rng.choice([1, 1, 2, 2, 3])
            delay = rng.uniform(lo, hi)
            # heavier rain and an official notice go with longer weather disruptions
            if cause in ("flood", "landslide"):
                delay += {"none": -8, "light": -6, "moderate": 0, "heavy": 8}[rain]
                if month not in WET:
                    delay *= 0.75
            if notice == "y":
                delay += 6
            rows.append(
                {
                    "cause": cause,
                    "corridor": corridor,
                    "month": month,
                    "rain_level": rain,
                    "signal_sources": sources,
                    "official_notice": notice,
                    "delay_hours": max(1, round(delay)),
                }
            )
    rng.shuffle(rows)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="") as f:
        f.write(HEADER)
        w = csv.DictWriter(f, fieldnames=["id", *rows[0]])
        w.writeheader()
        for i, r in enumerate(rows, start=1):
            w.writerow({"id": f"H-{i:03d}", **r})
    print(f"{len(rows)} synthetic rows -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
