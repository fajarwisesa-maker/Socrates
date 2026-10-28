"""v2 step 5 (PII_MASKING=local): mask personal data in incoming signals before any model call.

Deterministic and conservative: it masks phone numbers (Indonesian mobile and landline
formats, 9-14 digits), e-mail addresses, and personal names where Indonesian or English
usage marks them (an honorific such as "Pak Budi" / "Bu Sri" / "Mr Tan", or a label such as
"Sopir: Agus" / "a.n. Rina" / "PIC: Dewi"). Document numbers (POs are 10 digits starting
45), dates, quantities and place names are not touched, so evidence quotes still match.

The masked text is what the case, the dashboard and every model call see. The original
signals go to the audit trail only (`pii_masked`).
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Any

PHONE = re.compile(
    r"(?<![\w/])(?:"
    r"\(0\d{2,3}\)[\s.-]?\d{3,4}[\s.-]?\d{3,5}"  # (021) 8990 1234
    r"|(?:\+62|62|0)[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{2,5}"  # 0812-3456-7890, +62 812 ...
    r")(?![\w/])"
)
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_NAME = r"[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?"
HONORIFIC = re.compile(
    r"\b(?P<lead>(?:Pak|Bapak|Pk|Bu|Ibu|Mas|Mbak|Bang|Kak|Mr\.?|Mrs\.?|Ms\.?)\s+)(?P<name>"
    + _NAME
    + ")"
)
LABELLED = re.compile(
    r"(?P<lead>\b(?:[Ss]opir|[Ss]upir|[Dd]river|[Nn]ama|a\.n\.|[Aa]tas nama|PIC|CP|[Cc]ontact)"
    r"\s*[:.]?\s*)(?P<name>" + _NAME + ")"
)


def _digits(s: str) -> int:
    return sum(ch.isdigit() for ch in s)


def mask_text(text: str) -> tuple[str, Counter[str]]:
    """(masked text, count per kind)."""
    counts: Counter[str] = Counter()

    def phone(m: re.Match[str]) -> str:
        if not 9 <= _digits(m.group(0)) <= 14:
            return m.group(0)
        counts["phone"] += 1
        return "[PHONE]"

    def email(m: re.Match[str]) -> str:
        counts["email"] += 1
        return "[EMAIL]"

    def name(m: re.Match[str]) -> str:
        counts["name"] += 1
        return m.group("lead") + "[NAME]"

    text = EMAIL.sub(email, text)
    text = PHONE.sub(phone, text)
    text = HONORIFIC.sub(name, text)
    text = LABELLED.sub(name, text)
    return text, counts


def mask_signals(
    signals: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any], list[dict[str, Any]]]:
    """(masked signals, report for the case record, the originals for the audit trail)."""
    masked, total = [], Counter()
    for s in signals:
        text, counts = mask_text(s["text"])
        masked.append({**s, "text": text})
        total += counts
    report = {"mode": "local", "masked": sum(total.values()), "kinds": dict(sorted(total.items()))}
    return masked, report, [dict(s) for s in signals]


def mask_sender_id(sender: str | None) -> str | None:
    """A WhatsApp sender for display: "+62 ••• 7890" for a phone number, the first and last
    characters of a business-scoped user ID otherwise. The full value is audited only."""
    if not sender:
        return None
    digits = "".join(ch for ch in sender if ch.isdigit())
    if digits == sender.lstrip("+") and len(digits) >= 8:
        return f"+{digits[:2]} ••• {digits[-4:]}"
    return f"{sender[:2]}•••{sender[-4:]}" if len(sender) > 6 else "•••"
