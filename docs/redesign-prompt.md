# Prompt: SIAGA dashboard redesign ("Jalan Tol" with lane map)

You are a senior product designer and front-end engineer working in the SIAGA repository. Your job is a full UI/UX redesign of the dashboard in `web/` (Next.js). Read `CLAUDE.md` and `docs/siaga-overview.md` before you touch anything.

Demo Day is 31 October 2026. The demo path must keep working after every phase of this work. If a change puts the demo at risk, stop and ask.

---

## 1. What SIAGA is, in one paragraph

SIAGA is a supervised AI agent for Indonesian FMCG supply chains. A disruption signal comes in (a driver's WhatsApp message in Bahasa slang, a forwarder's PDF). The agent runs seven fixed stages: PERCEIVE, ASSESS, PLAN, SIMULATE, REFLECT, ACT, VERIFY. It finds the POs, stock and sales orders at risk in SAP, prices options with a MIP solver, lets a deterministic Critic reject plans that break business rules, executes low-risk actions by itself (Tier 2), and asks a planner to approve high-risk ones (Tier 3). Every number comes from SAP or the solver, never from the language model.

## 2. Who the redesign is for

1. **Primary: the supply planner.** An employee who opens SIAGA during a working day, sees which cases need them, understands a case in under a minute, and approves or rejects before the deadline. Planner mode becomes the main product.
2. **Secondary: the Demo Day audience.** Presenter mode stays as a projector layer built from the same components, at 1280×720, with the current pacing rules.

The planner's jobs, in order of frequency:

- See which cases need a decision from me, and how much time is left.
- Understand what happened (the signal and the evidence the agent used).
- See what is at risk: where the lane is blocked, which orders, how many cartons, how many rupiah, by when.
- See the chosen plan, and why cheaper options were rejected.
- See what SIAGA already did by itself.
- Approve, or reject with a reason.
- Check later that the fix held, and act on REOPENED or ESCALATED cases.
- Check the audit trail when someone asks "why did the agent do that?".

## 3. Hard constraints (do not break these)

- **No backend contract changes.** Keep using the existing Case API endpoints (`POST /cases`, case and event reads, the audit trail, `POST /cases/{id}/approvals/{id}`). If the new design needs data the API does not return (for example a case list, or locations for the map), list the gap in your plan and ask before changing any backend code.
- **No arithmetic on money or quantities in the UI.** Every number is formatted from backend values, as today. Keep the existing money format ("Rp 340 jt", "Rp 11,4 jt").
- **Keep honesty labels.** Solver numbers stay labelled "Calculated by the solver, not AI". REPLAY and "(fake)" labels stay visible. Confidence stays Medium or High, never a percentage. The audit chain verification indicator stays.
- **Keep the hidden fault injection hidden.** `POST /demo/inject` must not appear in the UI.
- **Keep keyboard controls:** `Space`/`→` next, `←` back, `H` hold, `R` restart view, `L` live, `D` details drawer, `P` planner mode. Each Presenter stage still stays at least 5 seconds.
- **Offline-safe.** Replay mode runs with no network, so fonts, icons and the logo must be bundled (use `next/font/google`, which self-hosts at build time; no runtime CDN).
- **Tests stay green.** `make test`, `make web-smoke` and `make rehearse N=3` pass at the end of each phase. When a Playwright selector has to change, prefer adding stable `data-testid` attributes over rewriting test logic.
- **Projector check.** Colours still pass the existing washout check (contrast reduced by 30%).

## 4. Design direction: "Jalan Tol"

The idea: SIAGA speaks the visual language of Indonesian toll-road signs. Planners and drivers already read these signs at speed, and they map cleanly onto SIAGA's states: green for the route and anything done, yellow for anything that needs a person, red for blocked or rejected, asphalt for structure. A schematic lane map borrowed from route charts shows where the disruption is and how SIAGA routes around it.

The signage is the interface, not decoration. Every sign shape stands for a real state. If something is not a state change, it stays plain.

### 4.1 Logo

- The wordmark is `siaga` in teal `#0F766E` with a green dot `#1FAF6E`. I will put two files in `web/public/brand/`:
  - `siaga-wordmark.svg` (teal, for light backgrounds)
  - `siaga-wordmark-white.svg` (white letters, same green dot, for the asphalt header)
- Use the white version in the asphalt header at 28 px height. Use the teal version on light surfaces (login, empty states, exports). Never recolour, stretch or redraw it, and never set "SIAGA" as text in place of the logo.
- If the files are missing when you start, stop and ask for them.

### 4.2 Colour tokens

Define these as CSS variables on `:root` and use nothing else. Adjust exact values only to pass WCAG AA and the washout check.

| Token | Role | Value |
| --- | --- | --- |
| `--concrete` | page background | `#EDEDE8` |
| `--road-white` | plates, tables, cards | `#FFFFFF` |
| `--asphalt` | header, text, sign borders | `#1E2124` |
| `--asphalt-muted` | secondary text | `#50545A` |
| `--curb` | dividers, table rules | `#C9CAC4` |
| `--sign-green` | route, done, verified, primary action | `#00653A` |
| `--sign-green-tint` | secondary text on green signs | `#CFE6D9` |
| `--signal-yellow` | needs you, approval, deadline | `#FFC20E` (always with asphalt text and an asphalt border) |
| `--stop-red` | blocked, rejected, reopened, at risk | `#C8102E` |
| `--brand-teal` | logo, focus ring, "written by the agent" labels | `#0F766E` |
| `--sea` / `--land` | lane map only | `#CFDDE2` / `#E4E4DC` |

Colour never carries meaning alone: every status also has a word and, where useful, an icon.

### 4.3 Typography

- **Overpass** (based on the US highway sign typeface) for everything: 900 for sign headings and big numbers, 700/800 for labels and buttons, 400/600 for body.
- **Overpass Mono** for PO numbers, SO numbers, timestamps, hashes, countdowns and tool names.
- Sign labels are uppercase with 0.08 to 0.12 em letter-spacing. Body copy stays sentence case.
- Type scale: 12 / 14 / 16 / 20 / 30 / 44 px. Use only these sizes.

### 4.4 Sign components (build these first, in one place)

| Component | Look | Used for |
| --- | --- | --- |
| `GantrySign` | green panel, 12 px radius, white inner border (`inset 0 0 0 4px green, inset 0 0 0 7px white`), white text | case header, impact panel, final outcome line, approved approval |
| `RouteShield` | white shield (rounded top, deep rounded bottom), asphalt 3 px border, asphalt text | lane code, e.g. `SMG-JKT` |
| `WarningPlate` | signal yellow, 4 px asphalt border, 10 to 12 px radius, asphalt text | approval sign, "Needs you" chips, disruption cause (e.g. `BANJIR · BREBES`) |
| `StatusPlate` | small rectangular plate, uppercase 900 weight | NEEDS YOU (yellow), DONE AUTOMATICALLY (green), REJECTED / REOPENED (red), VERIFIED (white with green border), RUNNING / ESCALATED (white or asphalt) |
| `KmPost` | 42 px wide post with "KM" over the stage number | the stage rail; green done, yellow current, red flagged (Critic rejection), white not reached |
| `RoadLine` | 8 px asphalt strip with a dashed white centre line | connector between KM posts, divider lines |
| `LaneDivider` | yellow dashed line with a centred label | separates "Done by SIAGA" from "Needs you" in the Act stage |
| `TierPlate` | `TIER 0` to `TIER 3` plate with the plain-word meaning beside it | tier legend and action rows |

Avoid: gradients, glass, glows, drop shadows beyond a 2 px flat offset, emoji, decorative illustrations, and any sign that does not map to a real state.

## 5. The lane map

The map is the one borrowed idea from route charts, drawn in the Jalan Tol style. It is a **schematic**, not a geographic map: positions only need to keep the rough west-to-east order of Java's north coast.

### 5.1 What it shows

- Sea (`--sea`) on top with a light "LAUT JAWA" label, land (`--land`) below with a simple coastline.
- **Nodes:** the destination DC as an interchange marker (white diamond, 5 px asphalt border); other DCs and suppliers as round markers; the disruption location as a yellow diamond warning sign with "!".
- **Labels** as green sign plates (white text), e.g. `CIKARANG DC`, `BANDUNG DC · TRANSFER 400 CTN`.
- **Roads:**
  - Blocked lane: red and white diagonal hatching with a red border.
  - Candidate source not yet chosen: grey road.
  - Chosen mitigation route: sign-green road with a dashed white centre line.
- The stuck shipment as an asphalt plate with a truck icon on the blocked road (e.g. `PO 4500018231 · 1,200 CTN STUCK`).
- A small legend plate in a corner.

### 5.2 Where it appears

| Stage | Map state |
| --- | --- |
| Assess | Blocked lane, stuck PO, destination DC with a red `ORDERS AT RISK` plate, candidate sources in grey |
| Simulate / Reflect | Each option card can highlight its route on a small version of the map; the rejected option's route is drawn in red outline |
| Act | Executed routes green, routes waiting for approval drawn yellow-dashed |
| Verify (and Presenter) | All chosen routes green with "verified" labels, coverage plate on the destination DC, blocked lane faded but still visible |

### 5.3 How to build it

- Build `LaneMap` as one React component that renders inline SVG (or positioned HTML) from props: nodes, roads with a state, labels. No map tiles, no map library, no network.
- Business values on the map (cartons, PO numbers, coverage) come from the case data the dashboard already loads.
- Node positions are layout, not business data. If the seed data has no coordinates, add a small layout config in `web/` keyed by location code (`DC-CKR`, `DC-BDG`, `V-2002`, the Semarang supplier, the Brebes disruption point) and say so in your plan. Unknown locations fall back to an automatic left-to-right layout instead of failing.
- The map has a text alternative: a short list of the same roads and their states for screen readers.
- At 1280×720 the map must fit the Presenter centre column without scrolling. Below 768 px wide, the map scrolls horizontally inside its frame.

## 6. Information architecture

### 6.1 Header (every Planner screen)

Asphalt bar: white logo, nav (`INBOX`, `CASES`, `AUDIT TRAIL`, active item underlined in yellow), model label (e.g. "Model: Claude via SAP AI Core", plus "Multi-agent" when on), audit chain status, and a `PLANNER | PRESENTER` switch.

### 6.2 Inbox (new landing view in Planner mode)

- Groups in this order, each headed by a `StatusPlate` with its count: **Needs you**, **Reopened**, **Escalated**, **Running**, **Resolved**. Sorted by approve-by time.
- A case in "Needs you" is a `GantrySign`: route shield, lane name, case ID, cause plate, then three columns (At risk, Plan cost, Cutoff). Under it, a yellow strip with the pending approval, the countdown and "OPEN CASE".
- Empty groups show one plain sentence saying what would land there.
- Side panel: "Demo inputs" (Load demo WhatsApp, Load forwarder PDF, Start case) in a dashed box so they read as demo-only, and the tier legend.

### 6.3 Case file

- **Case sign** across the top: route shield, case title, case ID, PO, delay range, and a status plate on the right (NEEDS YOU with countdown, VERIFYING, REPLANNING, RESOLVED, REOPENED).
- **KM rail** on the left: seven `KmPost`s joined by `RoadLine`s, with stage name, agent name (multi-agent mode) and a one-line note (e.g. "Shortfall 900 ctn", "B1 rejected", "Waiting for you"). The stage being viewed has a white highlight; the case's progress is shown by post colour.
- **Stage sheet** in the centre (see 6.4).
- **Margin** on the right: Impact `GantrySign` (At risk, Plan cost, Net protected, plus "Calculated by the solver, not AI"), confidence, Critic notes on a red-bordered plate, audit link.

### 6.4 Stage sheets

| Stage | What the sheet shows |
| --- | --- |
| Perceive | WhatsApp message and PDF text with located evidence quotes highlighted in yellow and numbered. A field table (cause, lane, location, delay, PO) cites those numbers. English gloss under Bahasa phrases, labelled "Written by the agent". Confidence Medium → High with the reason. |
| Assess | The lane map (5.2), the orders-at-risk table (order, customer, cartons, penalty if missed), the stock line (on hand, safety stock, usable), the agent's impact note labelled "Written by the agent". |
| Plan | Strategy plates and cited precedents, labelled synthetic where they are. |
| Simulate | Priced option cards side by side, each with its mini map, cost, cartons, arrival and tier. Labelled "Calculated by the solver, not AI". |
| Reflect | The rejected option with a red REJECTED plate and the Critic's template sentence; the replanned option next to it; saving against air. |
| Act | "Done by SIAGA" (Tier 2 actions on white plates with a green border, with SAP status), the yellow `LaneDivider`, then the approval sign (6.5). Tier 0 notes below. |
| Verify | The lane map in its verified state, coverage against the cutoff, and the outcome line from the backend on a `GantrySign` (e.g. "Rp 340 jt protected for Rp 11,4 jt"). REOPENED shows a red plate with the reason. |

### 6.5 The approval sign

The most important component. A yellow `WarningPlate` that lets a planner decide in one read:

- Title plate: `YOUR APPROVAL NEEDED · TIER 3`, and the countdown in an asphalt box (`7 h 42 m · by Day 1 18:00 WIB`) that shows EXPIRED after the deadline.
- What: the action in one line, e.g. "Bridge PO: 500 cartons of Minyak Goreng 2L from PT Agro Pangan Tangerang (V-2002)".
- Cost, and what happens if you reject.
- Why, in a lighter box labelled "Written by the agent".
- Other options with their cost, labelled "Calculated by the solver, not AI".
- The binding note: the approval covers these exact arguments only.
- Buttons: green "Approve purchase order", outlined "Reject…" (opens an optional reason field, then "Reject purchase order" in red or "Keep it pending").
- After approval the whole sign turns into a green `GantrySign` titled APPROVED with the new PO number and status. After rejection it turns white with a red border and says SIAGA is replanning.

### 6.6 Audit trail

A table on white with asphalt header rules: time, stage, actor (agent, specialist agent, tool, planner), event, policy decision, short hash. A plate at the top says whether the hash chain verifies. Filter by stage and event type. Lives in the details drawer (`D`) and as a tab in the case file.

### 6.7 States you must design

Loading, empty inbox, "Retrying…" during model throttling, deterministic fallback used, ESCALATED (reason and what was kept), REOPENED, approval EXPIRED, rejection replan in progress, API unreachable. Each state gets a plate in the matching colour and one sentence that tells the planner what happens next or what to do.

### 6.8 Presenter mode (1280×720)

- Asphalt header with the white logo, the case title, the model label and a yellow "SIGNAL TO VERIFIED" clock.
- KM rail on the left, impact `GantrySign` on the right, the stage canvas in the centre.
- Each stage canvas keeps its story, restyled: phrases lighting up and linking to fields; the lane map turning red at the blocked corridor and the orders at risk; option cards; the REJECTED plate; the approval sign turning green; the verified map with the outcome line.
- An asphalt footer lists the keys. Pacing and keys are unchanged.

## 7. UI copy rules

- English, plain, specific. Short sentences. Name who acted: "SIAGA created transfer…", "You approved…", "The Critic rejected…".
- Sign labels in uppercase; sentences in sentence case.
- Buttons describe the action ("Approve purchase order", "Start case", "Show audit trail").
- Every number and name in copy comes from backend data. Do not hard-code example numbers in components.
- No em dashes. No words like seamless, powerful, unlock, elevate, revolutionary, cutting-edge. No exclamation marks in status messages (the "!" inside the warning diamond is a sign, not copy).
- Mark model-written text (explanations, glosses, impact notes, approval summaries) with a small teal "Written by the agent" label.

## 8. Accessibility and quality

- WCAG AA contrast. Yellow always carries asphalt text. Focus ring: 3 px `--brand-teal` with a 3 px offset.
- Touch targets at least 44 px; full keyboard use of the inbox, KM rail and approval sign.
- Status always as word + colour (+ icon where useful).
- Respect `prefers-reduced-motion`: no sign flips or route-drawing animation when it is set; otherwise keep any animation under 400 ms.
- Layout works from 1280×720 up to 1920 wide, and stacks cleanly down to 768 wide (KM rail becomes a horizontal row of posts).

## 9. How to work

**Phase 0: audit and plan (no code changes).** Map the current `web/` routes, components, design system, data fetching, and which Playwright tests depend on which selectors. Check whether the case data has what `LaneMap` needs. Write a short plan: components to keep, restyle, replace or add; API or data gaps; risks to the demo path. Show me the plan and wait for my go-ahead.

**Phase 1: foundations.** Tokens, Overpass via `next/font/google`, type scale, logo files wired in, and the sign components from 4.4. Commit.

**Phase 2: lane map.** `LaneMap` with all road states, the layout config, the text alternative, and a mini variant for option cards. Commit.

**Phase 3: Planner mode.** Header, inbox, case file, every stage sheet, the approval sign with all its states, audit trail, and the states from 6.7. Commit.

**Phase 4: Presenter mode.** Rebuild on the same components. Commit.

**Phase 5: verification.** Run `make test`, `make web-smoke`, `make rehearse N=3`, `make rehearse-fault N=1`, and a full run in replay mode with the network off. Run the washout check. Take screenshots of every stage in both modes at 1280×720 and 1440×900 and review them yourself for overlap, clipping, label collisions on the map, and contrast. Fix what you find, then commit.

At the end of each phase, give me: what changed, which tests ran and their results, and anything you were unsure about.

## 10. Acceptance checklist

- [ ] The white logo shows in every header; no screen sets "SIAGA" as plain text instead.
- [ ] A planner can open the inbox and see which cases need them, sorted by deadline.
- [ ] The approval sign shows what, why, cost, alternatives, consequence of rejection, the binding note and a live countdown, and turns green or red after a decision.
- [ ] The lane map shows the blocked lane in Assess and the verified routes in Verify, in both modes, with no network.
- [ ] The golden run (Load WhatsApp, Load PDF, Start case, Approve) works end to end in both modes.
- [ ] The REOPENED path shows a red plate with its reason.
- [ ] No number in the UI is computed in the front end.
- [ ] Solver, REPLAY, "(fake)" and "Written by the agent" labels are all visible where they apply.
- [ ] All keyboard shortcuts work; Presenter pacing is unchanged.
- [ ] Washout check, `make test`, `make web-smoke` and `make rehearse` pass.
- [ ] No em dashes or buzzwords in UI copy.
