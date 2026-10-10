"""Evidence quotes are located by code; confidence is graded from what was located."""

from agent.evidence import grade_confidence, locate, locate_evidence
from agent.schemas import EvidenceItem

WA = "Bos, lalin Pantura macet total dr subuh, banjir di Brebes. Kata polisi bs 2-3 hari."
PDF = "severe flooding on Jalur Pantura between Brebes and\nTegal ... delay of 48–72 hours"
SIGNALS = [{"type": "whatsapp", "text": WA}, {"type": "pdf", "text": PDF}]


def ev(quote, signal, field):
    return EvidenceItem(quote=quote, signal=signal, field=field)


def test_locate_exact_case_and_whitespace_insensitive():
    s, e = locate("macet total", WA)
    assert WA[s:e] == "macet total"
    s, e = locate("MACET   Total", WA)
    assert WA[s:e] == "macet total"
    s, e = locate("between Brebes and Tegal", PDF)  # line break in the source
    assert PDF[s:e] == "between Brebes and\nTegal"


def test_locate_refuses_anything_not_verbatim():
    assert locate("macet parah", WA) is None  # paraphrase
    assert locate("2-3 days", WA) is None  # translation
    assert locate("48-72 hours", PDF) is None  # hyphen instead of the en dash in the PDF
    assert locate("   ", WA) is None


def test_unfound_or_misattributed_quotes_are_dropped():
    located, dropped = locate_evidence(
        [
            ev("bs 2-3 hari", 1, "delay"),
            ev("bs 2-3 hari", 2, "delay"),  # right quote, wrong signal
            ev("macet parah", 1, "cause"),  # not in the text
            ev("banjir", 3, "cause"),  # no such signal
        ],
        SIGNALS,
    )
    assert [(e.quote, e.signal, e.source) for e in located] == [("bs 2-3 hari", 1, "whatsapp")]
    assert [d["reason"] for d in dropped] == [
        "not found in signal 2",
        "not found in signal 1",
        "no signal 3",
    ]


def test_confidence_medium_for_one_source_high_when_pdf_agrees_on_lane_and_delay():
    wa = [ev("lalin Pantura", 1, "lane"), ev("bs 2-3 hari", 1, "delay")]
    label, _ = grade_confidence(locate_evidence(wa, SIGNALS)[0])
    assert label == "Medium"

    # PDF agrees on the lane only -> still Medium
    partial = [*wa, ev("Jalur Pantura", 2, "lane")]
    assert grade_confidence(locate_evidence(partial, SIGNALS)[0])[0] == "Medium"

    fused = [*partial, ev("48–72 hours", 2, "delay")]
    label, basis = grade_confidence(locate_evidence(fused, SIGNALS)[0])
    assert label == "High"
    assert basis["corroborated_fields"] == ["lane", "delay"]
    assert basis["signals_by_field"] == {"delay": [1, 2], "lane": [1, 2]}
    assert basis["progression"] == [
        {"up_to_signal": 1, "label": "Medium"},
        {"up_to_signal": 2, "label": "High"},
    ]


def test_confidence_low_when_nothing_located_and_ignores_dropped_quotes():
    assert grade_confidence([])[0] == "Low"
    invented = [ev("Jalur Pantura", 1, "lane"), ev("48-72 hours", 2, "delay")]
    located, _ = locate_evidence([*invented, ev("lalin Pantura", 1, "lane")], SIGNALS)
    assert grade_confidence(located)[0] == "Medium"
