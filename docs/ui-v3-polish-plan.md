# UI v3 polish: audit and plan

Brief: the owner's `siaga-v3-polish-prompt.md` (29 Oct): neater boxes, a bit more colour,
smoother. No backend or API change; every number is a backend value formatted by
`lib/format.ts`. The reference screenshots named in the brief were not attached, so the
brief's text is the reference.

## Phase 0 audit: what breaks sections 3 to 5 today

### Primitives (`components/planner/ui.tsx`, `signs.tsx`, `Shell.tsx`)

- `Kpi`: white card, coloured value only; the icon tile is grey (`bg-surface-2`). No tinted
  surface (3.2).
- `Panel`: icon is a bare teal glyph, no tone tile; no `h-full` / footer slot, so panels in a
  row end at different heights (4.3).
- `ComingLater`: grey filled box (`bg-surface-2`) (4.1).
- Sidebar engine card: grey filled box (4.1). Sidebar badges: Signals "needs" for open cases
  (should be info); Approvals count reads `PENDING` approvals, not the case status (4b).
- No `Rows` / `RowItem` / `Note` primitive: every page builds its own dividers and grey
  boxes.

### Status (4b)

- Status words are computed in four places: `STATUS_CHIP` (Shell), `CaseStatus`,
  `Approvals` page chip (`pending` count), `PlannerView` sidebar count, `ApprovalSign`
  (`pendingNow`, `withdrawn`). On an ESCALATED case with a PENDING approval (older backend)
  the badge and the page chip said "1 waiting".
- `ApprovalSign` shows the raw API error ("409 case is ESCALATED, not awaiting approval").
- `Journey` / `postState`: stages after the escalated one keep their own state, so Act can
  show green after an escalation in Simulate.

### Money (4c)

- Approval sign: "Rp 9.000.000 · part of a plan totalling Rp 99.000.000" in a sentence.
- Options card: full figure under the big one (allowed, small and muted), but the saving
  banner sentence "cheaper than ... (Rp 31 jt)" is fine. Impact KPI note: full figure under
  the exposure (allowed).

### Pages

| Page | Problems |
| --- | --- |
| Overview | KPI 4-up only at `xl` (2 + 2 below); "Chosen plan" panel shorter than the map; Decisions and Latest activity of different heights; decision titles `truncate` ("PT Agro Pa…"); activity tags all muted. |
| Signals | Messages: grey well with white cards inside a panel; `gap-8` columns. |
| Impact | 5 KPIs as 3 + 2 below `2xl`; cascade = four cards in a card; map beside a short "Coming later" grey card; separate orders table below. |
| Options | Solid teal saving banner; "How the agent planned" uses dark candidate signs inside a panel; "The Critic's checks" four cards in a panel; mixed `gap-4` / `gap-8` and `fr` splits. |
| Approvals | Right column (authority, why, evidence) much longer than the left; Tier 0 note floats loose; empty state is a grey box; title `truncate` ("(V-2…"). |
| Verification | Grey waiting banner; Tier 0 note floats next to the map; "Documents in SAP" = cards in a card; solid teal outcome banner. |
| Audit, Architecture | Fine structurally; header row only. |
| Evaluation | Two grey `ComingLater` boxes. |

### Lane map (5)

- Labels are placed by one anchor per node; Tangerang's name and status sit top-right and
  cover its own road; the stuck-PO badge sits next to the Brebes sign; place names and
  status plates share one solid style (green, yellow, red, asphalt). Legend is already a row
  under the map.

### Presenter (7)

- Impact meter is one solid teal block; Act shows the map, the Tier 2 line and the yellow
  approval strip (keeps), KM rail notes are partly tinted.

## Plan (one commit per phase)

1. Tokens and primitives: tint tokens (`--tint-*`), `Kpi tone`, `Panel tone` + `h-full` +
   `footer`, `Rows` / `RowItem`, `Note` (replaces `ComingLater`), white engine card.
2. Status and money: `caseStatusView()` in `lib/caseView.ts` drives the header chip,
   sidebar badge, Approvals chip, approval sign and stepper; actions the status forbids are
   not rendered; API errors become one sentence (`plainError`); short money in sentences.
   e2e: an ESCALATED case shows no Approve button and no "waiting" badge.
3. Page layouts on a 12-column grid (24 px between panels, 16 px between KPIs), equal
   heights, no nested boxes, no truncation, balanced columns.
4. Map labels: per-node name and status anchors with offsets, tone plates, overlap check.
5. Presenter: three tinted impact tiles, Act layout, tinted rail notes.
6. Verification: tests, screenshots per state, CLAUDE.md.

## Results (phase 5)

| Check | Result |
| --- | --- |
| `make test` | 293 passed, 2 skipped |
| `make web-smoke` (fake) | 14 passed, 4 skipped (new: `status.spec.ts`, `map.spec.ts`) |
| replay smoke | 11 passed, 4 skipped |
| multi + fake delay + PII smoke | 15 passed, 3 skipped |
| `make rehearse N=3` / `rehearse-fault N=1` / replay, network cut | 3/3, 1/1, 1/1 |
| projector washout | passes (after darkening `--chip-ok-fg` and `--chip-needs-fg`) |
| page audit (9 pages x awaiting, resolved, rejected, reopened, escalated x 1280/1440/1600) | no sideways scroll, no cut-off text, no unequal panel rows |
| Presenter steps at 1280x720 | every step fits (no overflow in the centre card) |

## Deviations from the brief

- The reference screenshots were not attached; the brief's text was the reference.
- Cikarang's map labels sit below-right, not below-left: below-left runs into Tangerang's
  status plate and off the map's left edge at the Presenter width.
- On Assess the DC plate reads "900 ctn short" (not "2 orders at risk · 900 ctn short"), and
  the bridge PO route reads "PO 500 ctn": the longer plates collided with the stuck PO.
- The Presenter approval strip keeps two short rows: one row with the title, cost,
  approve-by, Reject and Approve does not fit the centre card at 1280 px.
- The ESCALATED e2e test replays the state through route interception: the backend now
  withdraws pending approvals on escalation, so a live API never returns that mix again.
