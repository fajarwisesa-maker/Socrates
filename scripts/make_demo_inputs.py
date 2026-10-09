"""Generate data/demo/forwarder_notice.pdf (force-majeure notice from the forwarder).

The notice carries no calendar date on purpose: the demo runs on any date, and a stale
date on the PDF would contradict the case timeline. Usage:
    uv run python scripts/make_demo_inputs.py
"""

from __future__ import annotations

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from siaga_common.settings import REPO_ROOT

OUT = REPO_ROOT / "data" / "demo" / "forwarder_notice.pdf"


def build(out: Path = OUT) -> Path:
    styles = getSampleStyleSheet()
    h = ParagraphStyle("h", parent=styles["Title"], fontSize=15, spaceAfter=2)
    sub = ParagraphStyle("sub", parent=styles["Normal"], fontSize=8.5, textColor=colors.grey)
    body = ParagraphStyle("body", parent=styles["Normal"], fontSize=10, leading=14)
    small = ParagraphStyle("small", parent=body, fontSize=8, textColor=colors.grey)

    doc = SimpleDocTemplate(
        str(out),
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=18 * mm,
        bottomMargin=18 * mm,
        title="Force Majeure Notice - PT Lintas Cargo Nusantara",
        author="PT Lintas Cargo Nusantara (fictional)",
    )
    shipment = Table(
        [
            ["Shipment ref.", "LCN-SMG-0457"],
            ["Customer PO", "4500018231"],
            ["Shipper", "PT Sumber Pangan Semarang"],
            ["Consignee", "Cikarang DC (DC-CKR)"],
            ["Cargo", "MG-2L Minyak Goreng 2L, 1,200 cartons, 1 x FTL"],
            ["Lane", "Semarang -> Jakarta / Jabodetabek (FTL)"],
            ["Current status", "Truck held on Jalur Pantura, Brebes area"],
        ],
        colWidths=[38 * mm, 120 * mm],
    )
    shipment.setStyle(
        TableStyle(
            [
                ("FONTSIZE", (0, 0), (-1, -1), 9.5),
                ("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                ("GRID", (0, 0), (-1, -1), 0.4, colors.lightgrey),
                ("BACKGROUND", (0, 0), (0, -1), colors.whitesmoke),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story = [
        Paragraph("PT LINTAS CARGO NUSANTARA", h),
        Paragraph("Freight Forwarding &amp; FTL Trucking · Semarang · Jakarta", sub),
        Spacer(1, 8 * mm),
        Paragraph("<b>FORCE MAJEURE NOTICE / PEMBERITAHUAN KEADAAN KAHAR</b>", body),
        Paragraph("Ref: LCN/OPS/FM/0457 · Effective immediately upon issue", small),
        Spacer(1, 5 * mm),
        Paragraph("To: All customers with shipments on Semarang &rarr; Jakarta lanes", body),
        Spacer(1, 4 * mm),
        Paragraph(
            "We regret to inform you that severe flooding on <b>Jalur Pantura between Brebes "
            "and Tegal</b> has closed the national road to heavy vehicles. Police and the "
            "road authority have suspended truck movements on the affected section, and no "
            "safe alternative route is currently available for our FTL fleet.",
            body,
        ),
        Spacer(1, 3 * mm),
        Paragraph(
            "Under the force majeure clause of our service agreement, we declare an "
            "<b>estimated delay of 48&ndash;72 hours on all Semarang &rarr; Jakarta FTL "
            "shipments</b>, counted from each shipment's original scheduled delivery time. "
            "Revised delivery times will be confirmed once the road is reopened.",
            body,
        ),
        Spacer(1, 5 * mm),
        Paragraph("<b>Affected shipment for your company:</b>", body),
        Spacer(1, 2 * mm),
        shipment,
        Spacer(1, 5 * mm),
        Paragraph(
            "Cargo remains secured on the vehicle and is not damaged. Please contact our "
            "operations desk if you need to arrange alternative supply.",
            body,
        ),
        Spacer(1, 10 * mm),
        Paragraph("Operations Manager<br/>PT Lintas Cargo Nusantara", body),
        Spacer(1, 12 * mm),
        Paragraph(
            "Fictional document generated for the SIAGA hackathon demo. "
            "All company names are fictional.",
            small,
        ),
    ]
    out.parent.mkdir(parents=True, exist_ok=True)
    doc.build(story)
    return out


if __name__ == "__main__":
    print(f"wrote {build()}")
