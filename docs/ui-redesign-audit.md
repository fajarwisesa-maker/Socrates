# Dashboard redesign — step 1 audit

Status: **checkpoint, nothing in `web/` or the backend changed yet.**
Screenshots: 27 states of the current dashboard at 1280×720 (empty, signals loaded, running,
awaiting approval, each stage expanded, options, approval card, VERIFY countdown, resolved,
audit open, reject → replan to air, escalated, re-opened by fault injection, replay badge).

## 1. What the current screen gets wrong at 1280×720

- Everything is on screen at once: 8 panels, 4 header badges and a 7-row timeline. Nothing
  is the focus, and the money at risk sits in the lower-left panel.
- The options table overflows its column. The outcome column and badges spill outside the
  card, and plan text wraps one word per line.
- Timeline row summaries are cut to "Disruptio…" and "2 …". The REFLECT elapsed time wraps
  under its arrow, and the "LIVE STAGE TIMELINE" header wraps.
- Raw identifiers carry the story: `safety_stock`, `spot_air`, `DC-BDG`, `V-2002`,
  `Q-AIR-0001`, and "+ safety_stock" under plans.
- Text is 12–14px and the borders are hairlines, so neither survives a projector.
- **Bug:** the VERIFY row shows **done** (green) on a re-opened case. Only the banner says
  it failed.
- **Bug:** "Start case" stays enabled after a case has finished.
- A rejected card does not show the rejection reason. An air card shows
  "Approve by: no deadline" and "Alternatives: none".
- The clock reads "SIGNAL → …" until the end, and the "3 days → minutes" line never uses
  the real elapsed time.

## 2. Keep / cut / move to the drawer

| Current element | Presenter mode | Planner mode |
| --- | --- | --- |
| Header: SIAGA title + subtitle | **Keep** the wordmark only; drop the subtitle | keep |
| Day 0 line | **Cut** (the case line shows "Day 0 14:02 WIB") | keep |
| Badges: LLM, status, replay | **Cut** the LLM badge; status becomes the rail; **keep** a small Replay badge | keep all |
| Demo clock | **Keep** → top-right clock, freezes at the end with "3 days → 4m 12s" | keep |
| Reset demo button | **Move** to the drawer, plus the `R` key (view restart only) | keep |
| Signal inbox (textarea, preload, PDF picker, Start case) | **Replace** with a "start" canvas: two load buttons + one big Start; after start, the WhatsApp bubble + PDF move into the Perceive canvas | keep as is |
| Timeline (7 rows, expandable) | **Becomes the stage rail** (7 steps, check / pulse / hollow, "1 replan" loop) | keep, all expanded |
| Timeline counters (tool calls 9/20, LLM calls, replans) | **Drawer** | keep |
| Stage details: PERCEIVE fields + evidence | **Canvas** (bubble, PDF, disruption card, slang highlights) | keep |
| Stage details: ASSESS bullets | **Canvas** (lane schematic, stuck PO, 2 order cards, "100%") | keep |
| Stage details: PLAN candidates + rationale | **Canvas** (strategy chips + precedents); rationale text → drawer | keep |
| Stage details: SIMULATE per-option solver lines | **Canvas** shows big option cards; per-line solver table → **drawer** | keep |
| Stage details: REFLECT 6 checks × 4 options | **Canvas** shows only the rejected card + its one failed rule in plain words, then the replanned card; full check list → **drawer** | keep |
| Stage details: ACT action list + Tier 0 note | **Canvas** (green executed card + amber approval card); Tier 0 note → Verify canvas | keep |
| Stage details: VERIFY | **Canvas** (lane after: Bandung → Cikarang, bridge supplier, cutoff; final line) | keep |
| Event log per stage | **Drawer** | keep (collapsed) |
| Impact panel (max/expected exposure, shortfall, order table, delayed PO) | **Impact meter**: At risk / Plan cost / Protected only; the order table moves into the Assess canvas; expected exposure → drawer | keep |
| Options comparison table | Simulate/Reflect **canvas** as cards; table → **drawer** | keep, fixed widths |
| Approval cards | Act **canvas**: big Approve; Why / Alternatives / If rejected collapse behind "Details"; Reject + reason stays one click away | keep |
| Agent explanation | Summary sentence → Verify canvas; full text → **drawer** | keep |
| Audit trail | **Drawer** (hash-chain status + entries) | keep |
| Escalated / re-opened banners | **Canvas** takes over with a deliberate red state | keep |

Test IDs in `web/e2e/demo.spec.ts` (`case-status`, `stage-*` + `data-state`, `options`,
`option-*`, `approval-card` + `data-status`, `approve`, `reject`, `po-number`, `audit-status`,
`exposure`, `demo-clock`, `reset`, `start-case`, …) stay in Planner mode. The e2e test will
switch to Planner mode (or get an Auto/Presenter variant) so nothing loses coverage.

## 3. Does the event stream have what the canvases need?

| Canvas need | In the stream today? | Where | Gap |
| --- | --- | --- | --- |
| Slang highlight spans + which field each phrase produced | **Partly.** `disruption.evidence_quotes` is a flat list of strings; no source, no field, no offsets. In the demo run "macet total" and "ga gerak" are not quoted. | PERCEIVE `completed` | **Backend change A** |
| Confidence rising when the PDF is fused | **No.** One PERCEIVE call, one `confidence` (0.92) | — | **Backend change B (your call)** |
| Disruption fields (cause, location, delay 48–72h, PO) | Yes | PERCEIVE `completed` | — |
| Lane schematic names (Semarang, Brebes, Cikarang DC, Bandung DC, supplier names) | **Partly.** Lane id, location text, plant/supplier **codes** only; names live in SAP (`A_Plant`, `A_Supplier`, `A_TransportLane`) but not in events | ASSESS `completed` (`affected`) | **Backend change C** |
| Money at risk, orders, P(stockout), shortfall, deadline | Yes (`risk.max_exposure`, `risk.orders[*].stockout_probability`, customer names in `affected.sales_orders`) | ASSESS `completed` | — |
| Strategy chips | Yes (`candidates[*].strategies`, `label`) | PLAN `completed` | — |
| Precedent titles | Yes, but only in the `search_precedents` tool output (title, tags, excerpt). **No date** ("Feb 2025" is `period: 2025-02` in the markdown front matter, not in the hit) | PLAN `tool` | **Backend change D** |
| Option prices "calculated by solver" | Yes (`options[*].total_cost`, per-line costs) | SIMULATE `completed` | — |
| Critic rejection in plain words | **Partly.** `checks[*]` = rule + "DC-BDG left at 50, below safety stock 400" (codes, rule ID) | REFLECT `rejected` | **Backend change E** |
| Replanned card + "Safety stock respected" | Yes (round-2 option, its `safety_stock` check passed, `new_constraints`) | REFLECT | — |
| Executed Tier 2 card | Yes (description, cost, `sap_ref` STO-000001) | ACT `executed` | — |
| Approval card: cost, approve-by | Yes (`card.approve_by`, `card.approve_by_display` "Day 1 18:00 · Sun 11 Oct WIB") | ACT `waiting` + approvals | — |
| PO number after Approve | Yes (`sap_ref` 4500018232) | ACT `executed` after approval | — |
| Rejection reason typed by the planner | Yes (event detail + `actions[*].rejection_reason`) | ACT `rejected` | UI only |
| Protected amount for the impact meter | **Partly.** `summary.exposure_avoided` (Rp 340 jt) and `chosen_cost`; no net figure (Rp 328,6 jt) | REFLECT `completed` | **Backend change F** |
| Clock start / stop | Yes (first event `ts`, CASE `resolved` / `reopened` / `escalated` `ts`) | CASE | — |
| Verify result + Tier 0 note | Yes (`verification.covered`, per-action checks; ACT `info` note) | VERIFY / ACT | — |
| Error states (step 5): tool denied, budget exceeded | Yes (tool event `status` `denied` / `budget_exceeded`, `denial.message`) | tool events | — |
| Error states: LLM throttled | **No.** Retries happen inside botocore and are invisible; only a final "LLM unavailable" escalation | — | **Backend change G (step 5)** |

## 4. Proposed backend changes (small, need your OK)

All of these are additive: existing fields stay, so rehearse, the replay test and the e2e
test keep working. Numbers still come from code, never from the LLM.

- **A. Evidence with source and field.**
  - Change `report_disruption` to return `evidence: [{quote, source: "whatsapp"|"pdf", field: "cause"|"location"|"delay"|"lane"|"references"}]` (prompt `perceive.v2`).
  - Code checks that each quote is a verbatim substring of the named signal (case-insensitive) and adds `start`/`end` offsets.
  - A quote that cannot be found is dropped and logged. This doubles as a hallucination guard.
  - `evidence_quotes` stays, derived from `evidence`.
  - The fake script is updated to quote "macet total", "ga gerak", "banjir di Brebes" and "2-3 hari".
  - The golden recording (currently the fake placeholder) is re-recorded.
  - PERCEIVE eval scoring is unchanged.
- **B. Confidence before and after fusion.** Choose one:
  - **B1 (recommended):** the same PERCEIVE call also returns `confidence_signal_only`, the model's confidence from the WhatsApp alone. No extra call. It is a model judgement, labelled as such.
  - **B2:** two PERCEIVE calls (WhatsApp only, then fused). One more LLM call (≈ +2–4 s on Bedrock).
  - **B3:** no rise. The canvas shows one confidence with a "2 sources fused" label.
- **C. Display names in `affected`.**
  - `assess_impact` already reads SAP. It also returns `labels`: plant names, supplier name and city, and the lane from/to/corridor.
  - This costs no extra tool call and avoids hard-coding names in the UI.
- **D. Precedent period.**
  - Add `period` to `Precedent`/`PrecedentHit`.
  - PLAN `completed` also carries `precedents: [{id, title, period}]` for the hits it used, so the UI doesn't join tool events.
  - Also fixes a fake-script slip: it cites P-020, which the search did not return.
- **E. Plain-language Critic finding.**
  - A failed check gets `facts` (`{plant, plant_name, left, safety_stock}`) and `plain`, e.g. "Bandung DC would drop to 50 cartons, below its safety stock of 400".
  - Both are built in code from the same numbers. Same for incoterm and capacity.
- **F. Net protected.**
  - The solver's `compare` adds `net_protected = exposure_avoided − chosen_cost` (Rp 328.600.000), with a display form in `summary`.
  - The UI never does money arithmetic.
  - **Question:** the brief's meter says "Protected Rp 328,6 jt" (net), but the final line says "Rp 340 jt protected for Rp 11,4 jt" (gross). I suggest the meter shows the net figure labelled **"Protected (net)"** and the final line keeps the gross wording. OK?
- **G. (Step 5)** The Bedrock provider retries `ThrottlingException` itself (same backoff) and writes an `llm` event with status `retry` ("Bedrock throttled, retrying in 2 s"), so throttling can look intentional on screen.

UI-only, no backend change: "jt" formatting, VERIFY shown as failed on a re-opened case,
hiding "no deadline" / "none", the rejection reason on a rejected card, disabling Start on a
finished case, the dwell/hold/advance queue, and the Auto mode for tests and rehearse.
