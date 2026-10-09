from datetime import date

from siaga_common.timeline import at, day0_for, day_offset, display, from_iso, to_iso

DAY0 = day0_for(date(2026, 10, 29))


def test_day0_is_midnight_wib_in_utc():
    assert to_iso(DAY0) == "2026-10-28T17:00:00Z"


def test_relative_to_absolute_and_back():
    cutoff = at(DAY0, 2, "18:00")
    assert to_iso(cutoff) == "2026-10-31T11:00:00Z"
    assert day_offset(DAY0, from_iso("2026-10-31T11:00:00Z")) == (2, "18:00")


def test_display_shows_both_forms():
    assert display(DAY0, "2026-10-31T11:00:00Z") == "Day 2 18:00 · Sat 31 Oct WIB"
    assert display(DAY0, at(DAY0, 1, "10:00")) == "Day 1 10:00 · Fri 30 Oct WIB"
