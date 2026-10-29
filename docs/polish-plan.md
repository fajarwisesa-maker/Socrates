# Polish pass: plan (Phase 0 audit)

Brief: `docs/polish-prompt.md`. Front end only; no backend change. Selectors the e2e tests
use stay (moved text stays in the DOM where a test reads it).

## What the audit found

| Brief | Today | Change |
| --- | --- | --- |
| 3.1 spacing | Tailwind steps mixed freely (`space-y-5`, `gap-6`, `px-6 py-6`, `p-4`, `p-5`) | `--space-1..7` tokens; page padding 32, section gap 32, card padding 24, in-card gap 16, label gap 4; rail 184, margin 264 |
| 3.2 one heavy sign | 8 gantry signs: case header, Planner impact, Verify outcome (both modes), approved approval sign, inbox Needs you, Presenter impact meter, `/design` | Gantry stays on the case header (and the inbox Needs you sign). Impact, outcome and approved sign become flat fills with no inner line |
| 3.2 cards | `border-2/3/4 border-asphalt` on ~30 cards, plus `shadow-card` offsets | `Card` = white, 12 px radius, 1 px `#D8D9D3` inset hairline, no drop shadow |
| 3.2 plates, chips | `border-2` on StatusPlate, TierPlate, KmPost, StrategyPlate, map plates | filled, no border; 1 px grey hairline only on white plates |
| 3.2 tables | outer `border-2` frame, 2 px asphalt header rule | row dividers `#E4E4DC` only |
| 3.2 buttons | outline = 2 px border (layout), primary has an offset shadow | primary filled flat; secondary 2 px inset hairline; tertiary underlined text |
| 3.2 approval sign | three different elements (WarningPlate / GantrySign / red box) | one element; yellow + 2 px asphalt hairline, green no outline, white + 2 px red hairline |
| 3.3 KM rail | agent name and a note under every stage, budget line | names only; note on the current stage ("Waiting for you") and a flagged one ("B1 rejected"); agent name in the stage heading ("KM 2 · Impact Agent"), kept for screen readers (`agent-X`, `rail-agent-X`) |
| 3.3 approval sign | why, other options and the binding note always open | what, cost + deadline, if rejected, buttons; the rest under "Show details" (`aria-expanded`), collapsed but in the DOM (`approval-summary` is read by a test) |
| 3.3 inbox | five headed groups with a sentence each when empty | Needs you stays as full signs; empty groups become one row of count tiles |
| 3.3 impact panel | rows with exact rupiah, notes, shortfall + stockout fallback | three numbers + solver label; exact rupiah stays as a tooltip and for screen readers (`exposure`) |
| 3.3 tier legend | plate + a sentence | plate + two to four words |
| 4.1 tokens | none; motion uses ad-hoc `motion` durations | `--dur-*`, `--ease-*`, `--rise` in `globals.css`; keyframes `rise`, `fade`, `highlight`, `stamp` |
| 4 reduced motion | `MotionConfig reducedMotion="user"` + per-animation `useReducedMotion()` | also a global CSS rule (transitions and animations end at once) and a forced switch: `?motion=off` sets `html[data-motion="off"]`, which the hook and the CSS honour |
| 4.2 stage change | Planner sheet swaps with no motion; Presenter canvas slides 24 px sideways | sheet and canvas content keyed by stage, rise 8 / 10 px with a short stagger; old content leaves at once |
| 4.2 lane map | each sheet / canvas mounts its own map; roads have ids that include their state, so they remount | map rendered outside the keyed stage content (Planner Assess / Act / Verify, Presenter Assess / Act / Verify); road ids per source, so a road morphs; `pathLength=1` dash draw from source to DC; plate colours transition over 400 ms; the text alternative follows |
| 4.2 approval sign | approved sign springs in as a new element | one element, colour transition 320 ms, new content rises after 120 ms, `aria-live="polite"`, focus moves to "Go to Verify" (Planner) |
| 4.2 numbers | `CountUp` re-animates from the previous value on every change | `useCountUp` runs once per page load per number, ends on the formatter's exact string; Presenter shows "Not yet" before a number is revealed |
| 4.2 lists | none | inbox cards and tiles rise with a stagger on first load only; a new case rises in, unchanged rows never re-animate |
| 4.3 Presenter Act | executed card and approval card side by side, no map | map with the transfer route drawn green and the bridge PO route yellow, a one-line approval sign under it; Next shows as waiting while the approval is pending |
| 4.3 Reflect | REJECTED stamp lands from a large scale | 280 ms pop 1.3 → 1, then the chosen card rises |

## Tests that change

- `meter-at-risk` before Assess: "—" becomes "Not yet" (demo.spec pacing test).
- Playwright `contextOptions.reducedMotion: "reduce"` in the config; a new test with motion
  on checks that Approve is clickable as soon as it is visible.

## Risks

- The washout check (`projector.spec.ts`) measures painted colours; transitions must end at
  once under reduced motion (it runs with `reducedMotion: "reduce"`).
- Every Presenter step must still fit 1280×720, Act with the map most of all.
- Lighter hairlines must keep 3:1 for UI boundaries where they carry meaning (approval sign,
  rejected sign); the 2 px asphalt and red hairlines do.
