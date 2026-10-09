"""Load the locked demo seed (data/seed/*.json) into the mock SAP store.

Relative times in the seed are resolved against day 0:
    {"day": 1, "time": "10:00"} -> "2026-10-11T03:00:00Z"   (UTC ISO timestamp)
    {"day": 2}                  -> "2026-10-12"             (ISO date, WIB calendar)

Usage: python -m services.sap_mock.seed [--day0 YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from services.sap_mock.store import KEYS, SapStore, SqliteSapStore
from siaga_common.settings import REPO_ROOT, get_settings
from siaga_common.timeline import at, day0_for, to_iso, today_wib

SEED_DIR = REPO_ROOT / "data" / "seed"


def _resolve(value: Any, day0: datetime) -> Any:
    if isinstance(value, dict):
        if set(value) == {"day", "time"}:
            return to_iso(at(day0, value["day"], value["time"]))
        if set(value) == {"day"}:
            return (day0 + timedelta(days=value["day"])).date().isoformat()
        return {k: _resolve(v, day0) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve(v, day0) for v in value]
    return value


def load_seed(day0: datetime, seed_dir: Path = SEED_DIR) -> dict[str, list[dict[str, Any]]]:
    data: dict[str, list[dict[str, Any]]] = {}
    for entity_set in KEYS:
        path = seed_dir / f"{entity_set}.json"
        rows = json.loads(path.read_text()) if path.exists() else []
        data[entity_set] = [_resolve(r, day0) for r in rows]
    return data


def reset_store(store: SapStore, day0_date: date | None = None) -> datetime:
    """Restore seed state. Day 0 defaults to today (WIB)."""
    day0 = day0_for(day0_date or today_wib())
    store.replace_all(load_seed(day0), {"day0": to_iso(day0)})
    return day0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--day0", type=date.fromisoformat, help="case start date (default: today WIB)")
    args = ap.parse_args()
    settings = get_settings()
    store = SqliteSapStore(settings.sap_db_path)
    day0 = reset_store(store, args.day0)
    counts = {k: len(store.list(k)) for k in KEYS}
    print(f"Seeded {settings.sap_db_path} with day 0 = {day0.isoformat()}")
    for k, n in counts.items():
        print(f"  {k:<22} {n}")


if __name__ == "__main__":
    main()
