# Redesign plan: "Jalan Tol" (Phase 0)

Brief: `docs/redesign-prompt.md`. Decisions given by the owner at the start (28 Oct): no backend
changes; the inbox is built from the cases the dashboard already loads; lane-map positions
come from a layout config in `web/`; changed Playwright selectors get `data-testid`s and the
test logic stays; all phases run in one go.

## 1. What exists today (`web/`)

| Area | Files | Fate |
| --- | --- | --- |
| Routes | `app/page.tsx` (dashboard), `app/design` (style tile), `app/design/states` (state gallery) | keep; restyle the style tile into a sign tile |
| Data | `lib/useCase.ts` (polls one case: `/cases`, `/cases/{id}`, `/events`), `lib/api.ts`, `lib/types.ts` | keep; add a small `useInbox` that reads `GET /cases` + `GET /cases/{id}` per case (existing endpoints) |
| Derived state | `lib/stages.ts`, `lib/pacing.ts`, `lib/present.ts`, `lib/notices.ts`, `lib/format.ts` | keep unchanged (pacing and keys stay as they are) |
| Tokens | `app/globals.css` (teal / amber / red / green, Geist) | **replace** with the Jalan Tol tokens; old token names are remapped onto the new palette so every existing component changes colour at once |
| Fonts | `geist` via `next/font/local` | **replace** with Overpass + Overpass Mono, bundled as woff2 files in `app/fonts/` |
| Logo | `presenter/Wordmark.tsx` (drawn beacon + "SIAGA" text) | **replace** with `public/brand/siaga-wordmark-white.svg` |
| Planner | `PlannerView`, `StageTimeline`, `OptionsTable`, `ImpactPanel`, `ApprovalCards`, `SignalInbox`, `AuditView`, `DemoClock` | **replace** the layout (header, inbox, case file); keep the data views as stage sheets or reuse their logic |
| Presenter | `PresenterView`, `StageRail`, `ImpactMeter`, `PresenterClock`, `StartCanvas`, `canvases/*`, `LaneMap`, `OptionCard`, `DetailsDrawer` | **restyle** on the new components; keep every animation, test id and key |

## 2. Components to add

- `components/signs.tsx`: `GantrySign`, `RouteShield`, `WarningPlate`, `StatusPlate`, `KmPost`,
  `RoadLine`, `LaneDivider`, `TierPlate` (one place, brief 4.4); `Logo`.
- `components/LaneMap.tsx` + `lib/laneLayout.ts` (positions keyed by location code) +
  `lib/laneModel.ts` (nodes and roads built from the case record for each stage).
- Planner: `planner/PlannerHeader`, `planner/Inbox`, `planner/CaseFile` (case sign, KM rail,
  stage sheets, margin), `ApprovalSign` (shared with Presenter), audit table.
- Presenter: asphalt header, KM rail variant, impact `GantrySign`, asphalt key footer.

## 3. Data check (no backend change needed)

| Need | Where it comes from |
| --- | --- |
| Case list for the inbox | `GET /cases` (id, status, created) + `GET /cases/{id}` per case for its figures |
| Lane, blocked place, stuck PO | `disruption.lane/location`, `affected.purchase_orders`, `affected.labels.lanes` |
| Node names | `affected.labels.plants` / `.suppliers` (SAP names) |
| Node positions | **not in the data**: `web/lib/laneLayout.ts`, keyed by `DC-CKR`, `DC-BDG`, `V-2002`, `V-1001`, `SMG` and the disruption place (`BREBES`, matched in the location text). Unknown codes get an automatic left-to-right slot |
| Routes per stage | solver options (`solver_results[].result.actions`), `actions[]` with status (EXECUTED / PENDING_APPROVAL / REJECTED), `verification` |
| Countdown | `card.approve_by` (UTC timestamp) against the browser clock; time only, no money arithmetic |
| Product name in the approval title ("Minyak Goreng 2L") | **not in the case record** (only the material code). The title names the quantity and supplier from SAP labels; the raw SAP request text (`card.what`) is shown too |

## 4. Playwright selectors

Every existing `data-testid` is kept where its element still exists. Navigation the new layout
needs is added to the tests; the assertions stay the same.

| Test | Change |
| --- | --- |
| `demo.spec` golden path (Planner) | the case file shows one stage sheet at a time: the test clicks the Reflect KM post before checking `option-*`, and Act before approving; `exposure` keeps the exact rupiah in the impact sign |
| `demo.spec` reject path | the reason field opens with "Reject…" (`reject-open`); the bridge sign is matched by `/Bridge PO/` |
| `demo.spec` presenter `P` toggle | Planner opens on the followed case, so `timeline` (the KM rail) is visible |
| `v2.spec`, `multi.spec` (Planner part) | click `nav-cases`, then the KM post of the stage under test (`delay-details`, `impact-note` on Assess; `critic-note-B1` on Reflect; `approval-summary` on Act) |
| Presenter, drawer, projector, whatsapp, aws specs | unchanged selectors |

## 5. Risks to the demo path and how they are handled

- **Projector washout**: yellow, red and the muted grey are the risky pairs. Token values are
  tuned until `projector.spec` passes (brief allows it); yellow always carries asphalt text.
- **1280×720 fit**: the new header, footer and fonts take height. Every Presenter step is
  screenshotted and checked in Phase 5.
- **Approval flow**: the approval sign is new code on the critical path; it keeps the same API
  call and the test ids `approve`, `reject`, `po-number`, `presenter-approve`.
- **Offline**: fonts and the logo are files in the repo; no runtime or build-time download.

## 6. Deviations from the brief (with reasons)

- **Fonts are bundled files, not `next/font/google`.** `next/font/google` downloads at build
  time, and the demo laptop and this build environment may be offline. The same Overpass
  variable fonts (OFL, `@fontsource-variable` 5.3.0) are loaded with `next/font/local`.
- **Only the white logo was supplied.** Every header (Planner and Presenter) is asphalt, so
  the white wordmark covers every screen built here; the teal file is not needed yet.
- **Type scale** 12/14/16/20/30/44 px is enforced through the Tailwind size tokens; Presenter
  scales it with the viewport as before (1rem = 16 px at 1280×720).

## 7. Priority if time runs short (owner)

Tokens, sign components, lane map, Assess, Act with the approval sign, Verify, Presenter.
May be skipped: Simulate mini maps, audit filters, the Plan stage restyle.

## 8. Results (Phase 5, 28 Oct)

**Built**

- Tokens, Overpass + Overpass Mono (bundled), type scale, white logo in every header, and
  the sign components (`components/signs.tsx`).
- `LaneMap` with every road state (plus `failed`: a route that did not hold in SAP), the
  layout config (`lib/laneLayout.ts`), a text alternative, a legend strip and the mini
  variant. Gallery: `/design/map`.
- Planner: asphalt header with nav, inbox grouped by what each case needs, case file
  (case sign, KM rail, one stage sheet per stage, margin), the approval sign in all its
  states (shared with Presenter), audit table.
- Presenter rebuilt on the same pieces: asphalt header with the yellow clock, KM-post rail,
  impact gantry sign, key footer. Pacing, keys and every Presenter test id are unchanged.
- Reopened path: red plate with its reason in both modes, the late route in red on the
  map, net protected struck through as "not confirmed".

**Skipped (allowed by the owner's priority list)**

- ~~Audit trail filters~~: added afterwards (28 Oct): stage and event type, in the case file,
  the Audit trail page and the drawer; e2e-checked in the golden-path test.
- ~~Plan stage~~: restyled afterwards (28 Oct): candidates as direction signs with strategy
  plates, a plate for why a replan happened, precedents as synthetic-labelled information
  plates with their lessons.
- (Simulate mini maps were built.)

**Checks**

- `make test`: 305 passed, 2 skipped.
- `make web-smoke`: 9 passed (+4 skipped); `SMOKE_LLM=replay`: 8 passed (+4);
  multi + fake delay model + PII: 10 passed (+3); `WHATSAPP_INBOUND=1 WHATSAPP_NOTIFY=1`
  against a Graph stand-in: 11 passed (+2); `SMOKE_AWS=1`: 10 passed (+3).
  The projector washout check runs in every one of them and passes.
- `make rehearse N=3`: 3/3 (fake LLM). `make rehearse-fault N=1`: 1/1.
- Replay with the network cut (proxy pointed at a dead port, AWS variables unset):
  `rehearse -n 1 --local` 1/1 and the replay smoke 8 passed (+4).
- Screenshots of every stage in both modes at 1280×720 and 1440×900 reviewed. Fixed from
  the review: Assess and Verify overflow at 1280×720, the approval sign overflowing its
  column, the header title truncation, a zero-width middle dot in the bundled Overpass
  subset (now drawn from Overpass Mono), table wrapping, the KM rail hiding stages below
  `lg` (it wraps now), the reopened map painting the confirmed PO red.
