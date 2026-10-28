"""Indonesian rupiah formatting: Rp 11.400.000 (dot as thousands separator)."""

import math


def format_idr(amount: int | float) -> str:
    sign = "-" if amount < 0 else ""
    return f"{sign}Rp {abs(round(amount)):,}".replace(",", ".")


def format_juta(amount: int | float) -> str:
    """Short form in juta, as the dashboard's final line: 340000000 -> "Rp 340 jt",
    11400000 -> "Rp 11,4 jt" (mirrors `juta` in web/lib/format.ts)."""
    sign = "−" if amount < 0 else ""
    a = abs(amount)
    for div, unit in ((1e9, "M"), (1e6, "jt")):
        if a >= div:
            r = math.floor(a / div * 10 + 0.5) / 10  # half up, like Math.round in the UI
            num = f"{r:.0f}" if r == int(r) else f"{r:.1f}".replace(".", ",")
            return f"{sign}Rp {num} {unit}"
    return f"{sign}{format_idr(a)}"
