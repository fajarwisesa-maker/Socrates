"""Demo inputs of brief §2.4 exist and have the expected shape."""

import json
import re

from pypdf import PdfReader

from siaga_common.settings import REPO_ROOT

DEMO = REPO_ROOT / "data" / "demo"

CAUSES = {
    "flood", "landslide", "road_closure", "accident", "vehicle_breakdown", "port_strike",
    "labor_strike", "weather", "carrier_capacity", "quality_hold", "other", "none",
}  # fmt: skip
LANES = {"SMG-JKT", "BDG-CKR", "SBY-JKT", "TPR-CKR", "MRK-BKS", None}


def test_whatsapp_message():
    text = (DEMO / "whatsapp_driver.txt").read_text()
    for word in ("Pantura", "Brebes", "Cikarang", "2-3 hari"):
        assert word in text


def test_forwarder_pdf_text():
    text = " ".join(p.extract_text() for p in PdfReader(DEMO / "forwarder_notice.pdf").pages)
    assert "PT Lintas Cargo Nusantara".upper() in text.upper()
    assert "4500018231" in text
    assert "48–72 hours" in text
    assert "Brebes" in text and "Tegal" in text
    assert "Semarang → Jakarta" in text


def test_precedents():
    files = sorted((DEMO / "precedents").glob("*.md"))
    assert 18 <= len(files) <= 22
    for f in files:
        text = f.read_text()
        assert "synthetic: true" in text and "**SYNTHETIC**" in text, f.name
        body = text.split("---", 2)[2]
        words = len(re.sub(r"^>.*$", "", body, flags=re.M).split())
        assert 100 <= words <= 200, (f.name, words)
    similar = {"P-001", "P-002", "P-003"}
    tags = {f.name[:5]: f.read_text() for f in files}
    assert "pantura" in tags["P-001"] and "flood" in tags["P-001"]
    assert "toll" in tags["P-002"]
    assert "port_strike" in tags["P-003"]
    assert similar <= set(tags)


def test_perceive_testset():
    lines = (DEMO / "perceive_testset.jsonl").read_text().splitlines()
    items = [json.loads(line) for line in lines]
    assert len(items) == 20
    assert len({i["id"] for i in items}) == 20
    demo_text = (DEMO / "whatsapp_driver.txt").read_text().strip()
    assert any(s.get("text") == demo_text for i in items for s in i["signals"])
    non_disruptions = [i for i in items if not i["expected"]["is_disruption"]]
    assert 3 <= len(non_disruptions) <= 8
    for i in items:
        e = i["expected"]
        assert e["cause"] in CAUSES and e["lane"] in LANES, i["id"]
        assert (e["cause"] == "none") == (not e["is_disruption"]), i["id"]
        if e["delay_hours_min"] is not None:
            assert e["delay_hours_min"] <= e["delay_hours_max"], i["id"]
        for s in i["signals"]:
            if s["type"] == "pdf":
                assert (REPO_ROOT / s["path"]).exists()
