"""Indonesian rupiah formatting: Rp 11.400.000 (dot as thousands separator)."""


def format_idr(amount: int | float) -> str:
    sign = "-" if amount < 0 else ""
    return f"{sign}Rp {abs(round(amount)):,}".replace(",", ".")
