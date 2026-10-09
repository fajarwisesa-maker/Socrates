"""Case timeline: day offsets <-> real timestamps.

Day 0 00:00 is midnight Asia/Jakarta (WIB) on the case start date. Timestamps are stored
as UTC ISO-8601 strings ("2026-10-31T11:00:00Z"); the UI shows both forms, e.g.
"Day 2 18:00 · Sat 31 Oct WIB".
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

WIB = ZoneInfo("Asia/Jakarta")


def day0_for(d: date) -> datetime:
    """Midnight WIB at the start of `d`, as an aware datetime."""
    return datetime.combine(d, time(0, 0), tzinfo=WIB)


def today_wib(now: datetime | None = None) -> date:
    return (now or datetime.now(UTC)).astimezone(WIB).date()


def at(day0: datetime, day: int, hhmm: str) -> datetime:
    """Absolute time for "day N HH:MM" relative to day 0."""
    hours, minutes = (int(p) for p in hhmm.split(":"))
    return day0 + timedelta(days=day, hours=hours, minutes=minutes)


def to_iso(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def from_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def day_offset(day0: datetime, dt: datetime) -> tuple[int, str]:
    """(day number, "HH:MM" WIB) of `dt` relative to day 0."""
    local = dt.astimezone(WIB)
    return (local.date() - day0.astimezone(WIB).date()).days, local.strftime("%H:%M")


def display(day0: datetime, dt: datetime | str) -> str:
    """'Day 2 18:00 · Sat 31 Oct WIB'."""
    if isinstance(dt, str):
        dt = from_iso(dt)
    day, hhmm = day_offset(day0, dt)
    local = dt.astimezone(WIB)
    return f"Day {day} {hhmm} · {local:%a} {local.day} {local:%b} WIB"
