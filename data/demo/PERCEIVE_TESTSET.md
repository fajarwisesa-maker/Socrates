# PERCEIVE test set (`perceive_testset.jsonl`)

20 informal Bahasa / Javanese / English messages with the expected structured disruption.
Synthetic, written for the SIAGA demo.

Each line: `{id, signals[], expected, tags[], notes}`.
A signal is `{"type": "whatsapp"|"email", "text": ...}` or `{"type": "pdf", "path": ...}`
(text extracted with `pypdf`). Several signals in one item must be fused into one disruption.

## Vocabularies (also given to the PERCEIVE prompt)

- `cause`: `flood`, `landslide`, `road_closure`, `accident`, `vehicle_breakdown`,
  `port_strike`, `labor_strike`, `weather`, `carrier_capacity`, `quality_hold`, `other`,
  `none`.
- `lane`: `SMG-JKT` (Semarang → Jakarta/Jabodetabek, Pantura corridor), `BDG-CKR`
  (Bandung → Cikarang via Cipularang/Cikampek), `SBY-JKT` (Surabaya → Jakarta),
  `TPR-CKR` (Tanjung Priok port → Cikarang), `MRK-BKS` (Merak–Bakauheni ferry), or `null`.
- `references`: document numbers only (PO, SO, shipment); not SKUs.
- `confidence_band`: `high` / `medium` / `low`. Since the UI redesign, confidence is graded
  in code from the evidence quotes that code located in the signals (`agent/evidence.py`):
  nothing located = low, one source = medium, a second signal agreeing on lane and delay =
  high. The model's own number is kept in the audit trail only.

## Scoring (applied in Phase 4)

An item passes when all of these hold:
- `is_disruption` matches; for non-disruptions nothing else is scored.
- `cause` and `lane` match exactly.
- `delay_hours_min` and `delay_hours_max` are each within ±12 h of expected, or both
  are null when expected is null.
- `references` match as a set.

`location` and `confidence_band` are reported but not pass/fail, with two exceptions:
T01 (WhatsApp alone) must be Medium and T02 (demo fusion) High.
Target: ≥ 18/20 with T01 and T02 passing.
