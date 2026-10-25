"""v2 step 5: PII masking of incoming signals before any model call (PII_MASKING=local)."""

import pytest

from agent.factory import make_agent
from agent.pii import mask_signals, mask_text
from agent.providers.fake import FakeProvider
from agent.providers.scripts import golden_scripts
from agent.signals import build_signals
from siaga_common.settings import REPO_ROOT, Settings

DEMO = REPO_ROOT / "data" / "demo"

EXAMPLE = (
    "Bos, sy Pak Budi Santoso sopir truk B 9123 KXT. Lalin Pantura macet total, banjir di "
    "Brebes. Hub sy di 0812-3456-7890 atau +62 813 9876 5432. Sopir: Agus. "
    "Email budi.santoso@example.co.id. PO 4500018231, bs 2-3 hari."
)


def test_masked_example():
    masked, counts = mask_text(EXAMPLE)
    assert masked == (
        "Bos, sy Pak [NAME] sopir truk B 9123 KXT. Lalin Pantura macet total, banjir di "
        "Brebes. Hub sy di [PHONE] atau [PHONE]. Sopir: [NAME]. "
        "Email [EMAIL]. PO 4500018231, bs 2-3 hari."
    )
    assert counts == {"name": 2, "phone": 2, "email": 1}


@pytest.mark.parametrize(
    "keep",
    [
        "PO 4500018231",  # document numbers stay
        "Ref: LCN/OPS/FM/0457",
        "delay of 48–72 hours",
        "1,200 cartons",
        "bs 2-3 hari",
        "Kata polisi bs 2-3 hari baru lancar",  # lowercase: not a name
        "Bos, lalin Pantura macet total",
    ],
)
def test_no_false_positives(keep):
    assert mask_text(keep) == (keep, {})


@pytest.mark.parametrize("phone", ["081234567890", "(021) 8990 1234", "+62-21-8990-1234"])
def test_phone_formats(phone):
    assert mask_text(f"call {phone} now")[0] == "call [PHONE] now"


def test_demo_signals_have_nothing_to_mask():
    signals = build_signals(
        (DEMO / "whatsapp_driver.txt").read_text(encoding="utf-8"), DEMO / "forwarder_notice.pdf"
    )
    masked, report, _ = mask_signals(signals)
    assert masked == signals and report["masked"] == 0


def test_original_reaches_the_audit_trail_only(sap, tmp_path):
    from agent.audit import LocalAuditWriter
    from agent.case_store import SqliteCaseStore
    from agent.clients import HttpSapClient, InProcessSolver
    from agent.runtime import build_runtime
    from tests.conftest import NOW

    clock = lambda: NOW  # noqa: E731
    rt = build_runtime(
        Settings(_env_file=None, pii_masking="local", orchestration="multi"),
        sap=HttpSapClient(client=sap),
        solver=InProcessSolver(),
        store=SqliteCaseStore(":memory:", clock),
        audit=LocalAuditWriter(tmp_path / "audit", clock),
        clock=clock,
    )
    llm = FakeProvider(golden_scripts())
    agent = make_agent(rt, llm)
    signals = build_signals(EXAMPLE, DEMO / "forwarder_notice.pdf")
    c = agent.start_case(signals, day0="2026-10-28T17:00:00Z")
    c = agent.run(c.case_id)
    assert c.status == "AWAITING_APPROVAL", c.escalation_reason
    assert c.pii == {"mode": "local", "masked": 5, "kinds": {"email": 1, "name": 2, "phone": 2}}
    assert "[PHONE]" in c.signals[0]["text"] and "0812" not in c.signals[0]["text"]
    # no model call ever saw the original
    sent = " ".join(str(r.messages) for r in llm.requests)
    assert "0812-3456-7890" not in sent and "Budi" not in sent
    # the original is kept in the audit trail, nowhere else
    audit = rt.audit.read(c.case_id)
    pii = next(e for e in audit if e.kind == "pii_masked")
    assert pii.payload["original_signals"][0]["text"] == EXAMPLE
    created = next(e for e in audit if e.kind == "case")
    assert "0812" not in str(created.payload)
    events = rt.store.list_events(c.case_id)
    assert any(e.title.startswith("PII masked before any model call: 5") for e in events)
    assert not any("0812" in (e.detail + str(e.data)) for e in events)
    assert rt.audit.verify(c.case_id).ok
