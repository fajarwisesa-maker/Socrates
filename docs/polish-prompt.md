# Prompt: SIAGA dashboard polish pass (neater layout, smooth transitions)

You are a senior product designer and front-end engineer working in the SIAGA repository. The dashboard in `web/` already follows the "Jalan Tol" redesign in `docs/redesign-prompt.md`. This pass makes it neater and adds smooth transitions. It does not change the direction: same colours, same Overpass type, same sign components, same lane map.

Read `CLAUDE.md`, `docs/siaga-overview.md` and `docs/redesign-prompt.md` first. Everything in the redesign prompt's "Hard constraints" still applies.

Demo Day is 31 October 2026. The golden run must keep working after every phase.

---

## 1. Goal in one line

Fewer borders, fewer words, one spacing scale, and motion that explains what changed (a stage moved on, an approval went through, a route opened), never motion for decoration.

## 2. Extra constraints for this pass

- **Motion never blocks work.** Buttons are clickable the moment they appear. No action waits for an animation to finish. Presenter pacing (at least 5 s per stage) and keys stay the same.
- **Count-up is display only.** Animating a number from 0 to its value is allowed as a visual effect. The last frame must show exactly the string the existing formatter produces from the backend value (e.g. "Rp 11,4 jt"). The interpolated value is never used for anything else. Use tabular figures so the width does not jump.
- **Reduced motion.** When `prefers-reduced-motion: reduce` is set, every animation and transition ends at once and numbers show their final value. Also add a way to force this for tests (see 7).
- **No layout shift.** Animate `transform`, `opacity`, colours and SVG `stroke-dashoffset` only. Never animate `width`, `height`, `top` or `left`. Draw borders as inset `box-shadow` so a state change cannot change an element's size.
- **No new animation library** unless one is already in `web/package.json`. CSS transitions, keyframes and a few small hooks are enough.
- **Polling stays calm.** When the dashboard refetches, keep showing the previous data, do not re-run entrance animations or count-ups, and do not flash a loading state for refetches under 300 ms.

## 3. Neater layout

### 3.1 Spacing scale

Add spacing tokens and use only these: `--space-1: 4px`, `--space-2: 8px`, `--space-3: 16px`, `--space-4: 24px`, `--space-5: 32px`, `--space-6: 48px`, `--space-7: 64px`.

| Where | Value |
| --- | --- |
| Page side padding | 32 |
| Gap between major sections | 32 |
| Card padding | 24 (approval sign 24 × 32) |
| Gap inside a card | 16 |
| Gap between a label and its value | 4 |
| Gap between columns (rail, sheet, margin) | 32 |
| KM rail width | about 184 |
| Margin column width | about 248 to 280 |

Every card in a row has the same padding and top edge. Headings in the same position on different screens have the same size and spacing.

### 3.2 Border budget

- **One heavy sign per screen.** Only the case header (or, on the inbox, the "Needs you" case sign) keeps the green gantry style with the white inner line. The impact panel, status plates and buttons lose their double or thick borders.
- **Cards:** white, 12 px radius, one 1 px hairline `#D8D9D3` drawn as an inset shadow. No other border, no drop shadow.
- **Approval sign:** yellow with a 2 px asphalt hairline. Approved: green, no outline. Rejected: white with a 2 px red hairline.
- **Plates and chips** are filled shapes with no border, except a 1 px grey hairline on white plates.
- **Tables:** row dividers only (`#E4E4DC`), no outer frame inside a card, no vertical rules.
- **Buttons:** primary is filled (green, or yellow on dark); secondary is a 2 px asphalt hairline; tertiary is an underlined text button.

### 3.3 Copy budget

- A title fits on one line. A card has at most two supporting lines.
- **KM rail:** stage names only. Add a short note only on the current stage ("Waiting for you") and on a flagged stage ("B1 rejected"). The agent name moves into the stage heading ("KM 2 · Impact agent").
- **Approval sign, up front:** what (one line), cost and deadline, what happens if you reject, and the buttons. "Why", "Other options" and the binding note go under a "Show details" text button (`aria-expanded`). If a Playwright test checks those texts, keep them in the DOM and collapse them visually instead of not rendering them.
- **Inbox:** "Needs you" cases stay as full signs. Empty groups (Reopened, Escalated, Running, Resolved) become one row of four count tiles instead of four headings with sentences.
- **Impact panel:** three numbers and the solver label, nothing else.
- **Tier legend:** plate plus two to four words each.
- Keep every honesty label (solver, REPLAY, "(fake)", "Written by the agent", confidence Medium or High).

## 4. Motion system

### 4.1 Tokens

```
--dur-press: 120ms   (button press)
--dur-fast: 200ms    (hover, toggles, small fades)
--dur-base: 320ms    (content entering, colour changes)
--dur-slow: 800ms    (map routes drawing)
--dur-count: 900ms   (number count-up)
--ease-out: cubic-bezier(.2,.7,.2,1)
--ease-standard: cubic-bezier(.4,0,.2,1)
--rise: 8px          (entrance distance; 10px in Presenter)
```

Stagger related items by 60 to 80 ms, at most 5 items. In Planner mode, a full entrance finishes within 600 ms. Presenter mode can be slower, as long as each stage's story finishes well inside its 5 s.

### 4.2 What moves, and how

| Moment | Planner | Presenter |
| --- | --- | --- |
| Moving between stages | KM post colour and the rail's selected background transition over 320 ms. The new heading and content rise in (opacity 0 to 1, 8 px up) with a short stagger. The old content leaves instantly. | Same, with a 10 px rise and its own story timing (below). |
| Lane map | Stays mounted across Assess, Act and Verify, so it **morphs** instead of reloading. When it first appears, the blocked road draws in. A route draws from its source to the DC when its action is executed. A pending route shows yellow. Label plates change colour over 400 ms. The text alternative updates with each state. | Same. Act to Verify is the key moment: both routes are green, then the DC label changes to "1,000 CTN COVERED". |
| Approval sign | Background, text colour and outline transition over 320 ms (yellow to green on approve, to white with red on reject). New content (PO number, replanning line) rises in after 120 ms. "Show details" expands with a 240 ms rise. The result is announced with `aria-live="polite"`, and focus moves to the next action ("Go to Verify"). | One-line sign under the map with Approve. It turns green in place and shows the PO number. |
| Verify | "Checking both documents in SAP…" shows while VERIFY runs, then the outcome card rises in and the case chip changes to RESOLVED. | Same, with the outcome line under the map. |
| Numbers | Count up on first display: the inbox case sign and the case Impact panel. 900 ms ease-out, starting 150 to 250 ms after mount. Only once per page load. | Each impact number counts up the first time it is revealed: At risk at Assess, Plan cost at Reflect, Net protected after Verify. Before that it shows "Not yet". |
| Lists | Inbox cards and tiles rise in with a stagger on first load. On a poll update, a new case rises in and a removed one fades out over 200 ms. Unchanged rows never re-animate. | Option cards rise in 140 ms apart. |
| Status chips and plates | Colour transitions over 320 ms when the status changes. | Same. |
| Hover and press | Background or shadow over 200 ms, press 120 ms. No scaling of whole cards. | No hover effects needed. |

### 4.3 Presenter story timing

- **Perceive:** the three phrases highlight one by one (around 700, 1100 and 1500 ms), the extracted fields rise in after that, then the confidence line.
- **Assess:** the map fades in and the blocked road draws, then the one-line summary appears.
- **Simulate:** option cards rise in one after another.
- **Reflect:** B1 appears, its REJECTED plate pops in (a 280 ms scale from 1.3 to 1), then B2 rises in with its CHOSEN plate.
- **Act:** the transfer route draws in green, the bridge PO route shows yellow, and the sign waits for Approve. "Next" is disabled until the PO is approved.
- **Verify:** "Re-reading … in SAP", then the routes and labels turn verified and the outcome line rises in.

## 5. Implementation notes

- Put the motion tokens and keyframes (`rise`, `fade`, `highlight`, `stamp`) in the global stylesheet. Apply them with classes or a small `<Reveal delay>` wrapper, not inline everywhere.
- Hooks: `usePrefersReducedMotion()` and `useCountUp(target, format, { delay, enabled })`. `useCountUp` runs once, uses `requestAnimationFrame`, and returns `format(target)` on its final frame.
- Stage content: give each stage's content block a `key` of the stage id so it remounts and its entrance runs. Keep `LaneMap` outside those blocks so it stays mounted while the stage changes between Assess, Act and Verify.
- `LaneMap`: draw roads as SVG paths with `pathLength="1"`, `stroke-dasharray: 1` and a transition on `stroke-dashoffset` (1 to 0). Change the props to animate. Do not remount the map. The first draw runs one frame after mount.
- The approval sign is one element whose style changes with the state, so the colour transition can run. Do not swap it for a different component.
- Respect the existing data flow and endpoints. No backend changes.

## 6. How to work

Run all phases in one go. Stop and ask only if a change needs backend code or would break the golden run.

1. **Phase 0: audit.** Compare the current `web/` with sections 3 and 4. Write what you will change to `docs/polish-plan.md` (keep it short), then continue.
2. **Phase 1: neater layout.** Spacing tokens, border budget, copy budget, inbox tiles, rail notes, the approval sign's "Show details". Commit.
3. **Phase 2: motion system.** Tokens, keyframes, reduced motion, the hooks, stage-to-stage transitions, the approval sign transitions, count-ups, list entrances, chip colour transitions. Commit.
4. **Phase 3: lane map motion.** Persistent map, route drawing, label colour transitions, text alternative updates. Commit.
5. **Phase 4: Presenter choreography.** The story timing in 4.3, "Not yet" impact values, Next disabled until approval. Commit.
6. **Phase 5: verification.** See 7. Commit any fixes.

Run `make test` and `make web-smoke` at the end of every phase. If either fails and you cannot fix it within that phase, stop and tell me.

## 7. Verification

- Set Playwright's `reducedMotion: 'reduce'` in the config so tests never wait on animations. Add one test that runs with motion on and checks that the Approve button is clickable as soon as it is visible.
- Run `make test`, `make web-smoke`, `make rehearse N=3`, `make rehearse-fault N=1`, and a full replay-mode run with the network off.
- Record a short screen capture or a set of timed screenshots of the golden run in both modes at 1280×720. Check for: jumps in layout, numbers changing width, content flashing on poll refresh, routes drawing in the wrong direction, map labels overlapping.
- Check once with reduced motion turned on in the OS: everything appears at once, with final numbers.
- Run the washout check again.

At the end, give me: what changed, anything from sections 3 and 4 you skipped and why, test and rehearse results, and the commit list.

## 8. Acceptance checklist

- [ ] Only one heavy sign per screen. Cards use a single hairline.
- [ ] All spacing comes from the scale. Cards in a row line up.
- [ ] The KM rail shows names only, plus one note on the current or flagged stage.
- [ ] The approval sign shows what, cost and deadline, consequence and buttons up front. Details expand on request.
- [ ] Moving between stages is smooth and never blocks a click.
- [ ] The lane map morphs between Assess, Act and Verify without reloading.
- [ ] Approve and Reject change the sign's colour smoothly, and the result is announced.
- [ ] Count-ups end on the exact backend-formatted value and run only once.
- [ ] Polling does not re-run animations or flash loading states.
- [ ] Reduced motion turns every animation off.
- [ ] `make test`, `make web-smoke`, `make rehearse` and the washout check pass.
- [ ] No em dashes or buzzwords in UI copy.
