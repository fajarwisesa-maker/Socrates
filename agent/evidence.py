"""PERCEIVE evidence: locate the model's quotes in the signals and grade confidence.

The model only *names* evidence (quote, signal number, field). Code finds each quote in
that signal's text and computes the character offsets; a quote that is not there after
normalising whitespace and case is dropped, never guessed. Confidence is then a label
computed from the located evidence alone, so it is the same on every run.
"""

from __future__ import annotations

from typing import Any, Literal

from agent.schemas import EvidenceItem, LocatedEvidence

ConfidenceLabel = Literal["Low", "Medium", "High"]
# A second source must agree on these fields to raise confidence to High.
CORROBORATING_FIELDS = ("lane", "delay")


def _normalise(text: str) -> tuple[str, list[int]]:
    """Lower-case, collapse whitespace runs to one space; map each output char to its
    index in `text`."""
    out: list[str] = []
    index: list[int] = []
    in_space = False
    for i, ch in enumerate(text):
        if ch.isspace():
            if not in_space and out:
                out.append(" ")
                index.append(i)
            in_space = True
            continue
        in_space = False
        for c in ch.lower():  # lower() can expand a char (e.g. "İ"); keep the mapping
            out.append(c)
            index.append(i)
    return "".join(out), index


def locate(quote: str, text: str) -> tuple[int, int] | None:
    """Offsets [start, end) of `quote` in `text`, ignoring case and whitespace runs."""
    q, _ = _normalise(quote)
    q = q.strip()
    if not q:
        return None
    norm, index = _normalise(text)
    pos = norm.find(q)
    if pos < 0:
        return None
    return index[pos], index[pos + len(q) - 1] + 1


def locate_evidence(
    evidence: list[EvidenceItem], signals: list[dict[str, Any]]
) -> tuple[list[LocatedEvidence], list[dict[str, Any]]]:
    """Split the model's evidence into located items and dropped ones (with a reason)."""
    located: list[LocatedEvidence] = []
    dropped: list[dict[str, Any]] = []
    for e in evidence:
        if not 1 <= e.signal <= len(signals):
            dropped.append({**e.model_dump(), "reason": f"no signal {e.signal}"})
            continue
        sig = signals[e.signal - 1]
        span = locate(e.quote, sig["text"])
        if span is None:
            dropped.append({**e.model_dump(), "reason": f"not found in signal {e.signal}"})
            continue
        start, end = span
        located.append(
            LocatedEvidence(
                quote=e.quote,
                signal=e.signal,
                source=sig["type"],
                field=e.field,
                start=start,
                end=end,
                text=sig["text"][start:end],
            )
        )
    return located, dropped


def grade_confidence(located: list[LocatedEvidence]) -> tuple[ConfidenceLabel, dict[str, Any]]:
    """Low: nothing located. Medium: one source. High: a second, independent signal
    agrees on lane and delay (each of those fields is quoted from >= 2 signals)."""
    by_field: dict[str, list[int]] = {}
    for e in located:
        sigs = by_field.setdefault(e.field, [])
        if e.signal not in sigs:
            sigs.append(e.signal)
    sources = sorted({e.signal for e in located})
    if not located:
        label: ConfidenceLabel = "Low"
    elif all(len(by_field.get(f, [])) >= 2 for f in CORROBORATING_FIELDS):
        label = "High"
    else:
        label = "Medium"
    basis = {
        "rule": "one source = Medium; a second signal agreeing on lane and delay = High",
        "signals_with_evidence": sources,
        "signals_by_field": {f: sorted(s) for f, s in sorted(by_field.items())},
        "corroborated_fields": [f for f in CORROBORATING_FIELDS if len(by_field.get(f, [])) >= 2],
    }
    return label, basis
