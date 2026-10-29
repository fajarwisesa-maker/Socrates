# UI v3: the owner's mockup on SIAGA's real data (plan and outcome)

## Context

The owner shared a mockup (`ui.pdf`, 14 pages). It is not final, but it sets the big picture:
a calm sidebar app with eight pages. In order, the pages are Overview, WhatsApp disruption
inbox, Impact analysis, Response optimizer, Approval center, Verification, Audit trail and
Evaluation lab. It uses white cards, a dark-teal sidebar and buttons, and soft status chips.

Today's Planner mode is one case file with a KM rail. The mockup's flow (signal → impact →
options → approval → verification → audit) is the same journey as SIAGA's seven stages, so
users find their way more easily. The mockup is in Bahasa, and many of its numbers come from
nowhere (11 SKUs, 24.000 units, 3-level sign-off, GPS photos, carbon, Merkle tree, 25-scenario
lab).

Decisions (owner, this session):
- **Language:** English.
- **Modes:** the sidebar app **replaces Planner mode**. **Presenter stays** for the projector
  (story, pacing, keys unchanged), restyled to the new palette.
- **Data:** **show only real data.** Anything with no source in SIAGA is left out or shown as
  a labelled "Coming later" slot. The UI still never computes or invents a number.
- **Look:** mockup style, keeping the lane map and the honesty labels ("Calculated by the
  solver, not AI", "Written by the agent", REPLAY, "(fake)", synthetic precedent,
  confidence Medium → High).
- No backend change is planned. The one exception is optional and listed in step 8.

The good news: the mockup's headline numbers already match the golden run. These are
Rp 340 jt at risk, option Rp 11,4 jt vs air Rp 31 jt, Rp 19,6 jt saving, and a Tier 3
approval.

## Page map: mockup → SIAGA (what each page shows, all from existing fields)

| Page (sidebar, English) | Mockup | Built from (existing) |
| --- | --- | --- |
| **Overview** | Ringkasan | Incident banner: `caseTitle`, lane `RouteShield`, cause, delay range, status plate. 4 KPI cards: inbound POs hit (`affected.purchase_orders`), orders at risk (`risk.orders` with p>0), shortfall ctn, max exposure. Lane map (`laneModel` assess/act/verify by status). "Chosen vs baseline" pair (`summary`, `solver_results`, saving). Approvals list with tier and status. Recent activity = last events (`events`, titles/stages). Next-action button to the current page. |
| **Signals** (inbox) | Inbox Gangguan WA | Left: case list (`useInbox`, groups as today). Middle: the WhatsApp message as a chat bubble (sender masked, "received live" when `via=whatsapp_api`) and the forwarder PDF, with code-located highlights (`Highlighted` / Planner `Marked`), plus glosses. Right "Extracted and verified": fields with source icons, located quotes count, dropped quotes, confidence Medium → High, delay chip (`delayChip`), PII chip. Demo inputs card (load / start / reset). Button "Open impact analysis". **Left out:** reply box, photos, GPS, EXIF, voice note. |
| **Impact** | Analisis Dampak | KPI cards (exposure max + expected, orders at risk, shortfall, stockout chance, cutoff). **Cascade flow** in 4 columns: Disruption (lane, place, delay) → Inbound PO (number, qty, new arrival window) → DC stock (on hand, safety, usable vs demand) → Customer orders (name, qty, penalty type, amount). Lane map ("where it is blocked"). Orders table (replaces the SKU matrix). `DelayDetails`, impact note (agent-written label). **Left out:** SKU matrix, depletion curve, multi-hub buffers, satellite map. |
| **Response options** | Pengoptimal Respon | Saving banner (`summary.saving_vs_baseline`, baseline label, solver label). Option cards: chosen (B2) vs baseline (A1/A2), plus rejected B1 with the Critic sentence. Per option: total, latest ETA, max tier, coverage, cost lines per action (`result.actions` cost/qty/source). Plan rounds: candidates + rationale (agent-written), replan reason (`replanReason`), precedents (`precedentHits`, "Synthetic precedent"). "Solver setup" card = active constraints (safety stock rule, excluded supplier) and the solver name (PuLP/CBC). Critic checks per option. **Left out:** carbon, 1.420 iterations, reliability %. |
| **Approvals** | Pusat Persetujuan | The `ApprovalSign` (planner variant) for each approval, pending first. **Authority** card = the real policy: Tier 0 reads, Tier 1 drafts, Tier 2 done automatically (< Rp 50 jt, internal, reversible), Tier 3 needs you; which actions landed in which tier (`critic_findings[].tiers`, executed Tier 2 actions). "Why this plan" = Critic checks of the chosen option + agent explanation (labelled). Evidence attached = the two signals with links to Signals. Binding note and reject-with-reason as today. **Left out:** named manager / director levels, 2FA, ISO badges. |
| **Verification** | Verifikasi | Countdown "SIAGA re-reads SAP in N s" / "Checking both documents in SAP…". Coverage card (`verification.projected_supply` / `demand`, cutoff). One card per executed action: SAP document, qty, status, ETA, on-time check (`verification.checks`). Lane map (verify view). Outcome line + signal-to-verified time. Reopened state. Tier 0 note. WhatsApp reply line. **Left out:** telemetry, barcode, photos, uploads. |
| **Audit trail** | Jejak Audit | `AuditView` restyled as a checkpoint timeline grouped by stage (stage from `withStages`), each entry with actor, time, summary, policy ALLOW/DENY + tier, short hash. Filters stay. Side card: chain status (verified, N entries, first broken entry), S3 storage line when `AUDIT_BACKEND=s3`. **Left out:** Merkle root, BFT, legal / force-majeure clauses. |
| **Evaluation** | Lab Evaluasi | **Coming later** slot only (see step 8): explains what it will show (PERCEIVE eval score, rehearse pass rate and timings) without numbers. |

Sidebar extras (real): count chips ("Needs you N" on Approvals from inbox), engine card at the
bottom = `modelLabel(config)` + REPLAY / "(fake)" + orchestration (multi-agent names when on).
Header: case selector/title, the synthetic-data badge only when replay or fake, mode switch,
help (keys). No user profile (there is no login); show "Planner" instead of a name.

## Approach

### Step 1 — Visual system and shell
- `web/app/globals.css`: add mockup tokens. These are teal-900 sidebar/primary
  (~#1F4E46, contrast-checked), soft tints for risk/needs/ok/info chips, white cards with
  the existing hairline (`CARD`), and 12 px radius. Keep the spacing and motion tokens and
  `lib/motion.ts`. Map the old names (`brand`, `risk`, `human`, `ok`, `ink`…) to the new
  palette so the lane map and older components follow, as the Jalan Tol pass did.
- New `web/components/planner/Shell.tsx`: sidebar nav (8 items, icons from `lucide-react`,
  count chips, engine card), header bar and incident banner. It replaces `PlannerHeader` and
  the tab row.
- Page state: `nav` in `PlannerView.tsx` becomes a page id, synced to `?page=`
  (`overview|signals|impact|options|approvals|verification|audit|evaluation`), so a link or
  reload opens the same page. Default: Approvals when a decision is pending, else Overview.
- Reuse `Reveal`, `Figure`/`useCountUp`, `StatusPlate` (restyled as soft chips), `LaneMap`,
  `ApprovalSign`, `AuditView`, `StateNotices`.

### Step 2 — Overview + Signals
- `web/components/planner/pages/Overview.tsx` and `Signals.tsx`, built from the existing
  helpers in `lib/caseView.ts`, `lib/present.ts`, `lib/laneModel.ts`, `lib/planView.ts`.
- The inbox list moves into Signals' left column (from `planner/Inbox.tsx`), and so do the
  demo inputs.

### Step 3 — Impact + Response options
- `pages/Impact.tsx`: KPI cards, the cascade flow component (`planner/Cascade.tsx`), lane
  map, orders table, and the delay details moved from `sheets.tsx`.
- `pages/Options.tsx`: saving banner, option cards (reuse the logic of `OptionsTable` /
  `outcome()` in `sheets.tsx`), plan rounds (`plan.tsx`), Critic checks.

### Step 4 — Approvals + Verification
- `pages/Approvals.tsx`: `ApprovalSign` restyled to the palette, keeping its one-element
  transitions, Show details, focus and `aria-live`. Add the authority card from
  `TIER_MEANING`.
- `pages/Verification.tsx`: from `VerifySheet` plus per-action cards. The lane map stays
  mounted across Approvals → Verification only if both show it; otherwise it remounts and
  draws (acceptable).

### Step 5 — Audit trail
- Restyle `components/AuditView.tsx` into the timeline layout, behind a `variant="timeline"`
  prop so the drawer keeps its compact table.

### Step 6 — Presenter restyle (story unchanged)
- Presenter components (`components/presenter/*`) take the new tokens: teal header,
  softer cards. Pacing, keys, choreography and testids stay. Re-run the washout check
  (`e2e/projector.spec.ts`) and darken tokens if anything drops below 4.5:1 / 3:1.

### Step 7 — Tests, docs
- Update the Planner e2e tests in `web/e2e/demo.spec.ts`, `multi.spec.ts`, `v2.spec.ts`,
  `aws.spec.ts`, `whatsapp.spec.ts` and `motion.spec.ts`. They navigate by sidebar
  (`nav-<page>`) instead of KM posts; keep the testids they assert on (`approve`,
  `po-number`, `exposure`, `option-B1`…, `case-status` + `data-status`, `audit-*`,
  `approval-summary`, `agent-ASSESS`, `impact-note`, `critic-note-B1`).
- New e2e: every sidebar page renders for the golden case at 1280×720 and 1600×1000 with
  no horizontal scroll, and `?page=` reloads to the same page.
- `CLAUDE.md` section "UI v3 (mockup)" plus the status row; `docs/ui-v3-plan.md` with the
  page map above and the left-out list.

### Step 8 — Optional, only if wanted later: Evaluation page with real numbers
Needs one read-only API endpoint (backend). It would serve the latest `var/rehearse/report-*.json`
and a PERCEIVE eval result file written by `make eval-perceive`. Not part of this pass;
the page shows "Coming later" until then.

## Left out (no source in SIAGA), listed in the doc
GPS / EXIF photos, voice notes, the chat reply box, named 3-level sign-off (replaced by the
real Tier 0–3 policy), SKU-level matrix and 24.000 units, the depletion curve, multi-hub
buffer days, carbon, satellite map, solver iteration counts, supplier reliability %,
Merkle root / BFT / ISO badges, PDF export, the 25-scenario lab, and the "Neuro-Solver v2.4"
name (shown as the real PuLP/CBC solver and Claude on SAP AI Core).

## Verification
- `make web-check`, `make test`.
- `make web-smoke`, `SMOKE_LLM=replay ./scripts/web_smoke.sh`, and
  `ORCHESTRATION=multi DELAY_MODEL=fake PII_MASKING=local ./scripts/web_smoke.sh`.
- `make rehearse N=3`, `make rehearse-fault N=1`.
- The washout check passes on Presenter.
- Screenshots of every sidebar page (golden case, and the reject → air path) checked
  against the mockup at 1600×1000 and 1280×720.
- Commit and push per step to `claude/siaga-phase-0-setup-4dov2h`.

## Outcome (29 Oct)

Built as planned, with these additions and choices:

- **Stage stepper** under the top bar (`components/planner/Journey.tsx`): the agent's seven
  stages stay visible on every case page and each links to its page (Perceive -> Signals,
  Assess -> Impact, Plan / Simulate / Reflect -> Response options, Act -> Approvals,
  Verify -> Verification). It carries the `stage-X` / `agent-X` test ids of the old KM rail.
- **Architecture** became a page under a "System" group with Evaluation (it was a tab).
- Default page: Approvals when a decision waits, else Overview, Signals with no case.
- At 1280 px the Signals page puts the extracted fields under the messages; the Impact
  KPIs wrap to three per row.
- The Presenter keeps its story and pacing; its header and footer take the teal.

Files: `components/PlannerView.tsx`, `components/planner/{Shell,Journey,ui}.tsx`,
`components/planner/pages/*.tsx`, `lib/page.ts`; tokens in `app/globals.css`.
