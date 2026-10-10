"use client";

// Narration pacing for Presenter mode. The agent can finish stages faster than a presenter
// can talk, so the view walks through the case one *step* at a time (a step = one run of
// consecutive events of one stage, e.g. PLAN round 2) and stays on each for a minimum dwell.
// Space advances now, H holds, R restarts the view (the agent is not re-run).
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { CaseEvent, Stage } from "./types";

export interface Step {
  stage: Stage;
  round: number;
  firstSeq: number;
  lastSeq: number;
}

/** Consecutive runs of events of one stage (CASE events are ignored). */
export function toSteps(events: CaseEvent[]): Step[] {
  const steps: Step[] = [];
  const started: Partial<Record<Stage, number>> = {};
  for (const e of events) {
    if (e.stage === "CASE") continue;
    const stage = e.stage;
    if (e.status === "started") started[stage] = (started[stage] ?? 0) + 1;
    const last = steps.at(-1);
    if (last && last.stage === stage) {
      last.lastSeq = e.seq;
      last.round = Math.max(last.round, started[stage] ?? 1);
    } else {
      steps.push({ stage, round: Math.max(1, started[stage] ?? 1), firstSeq: e.seq, lastSeq: e.seq });
    }
  }
  return steps;
}

/** The longest wow moments need a little more than the default dwell. */
const MIN_DWELL_MS: Partial<Record<Stage, number>> = { PERCEIVE: 3000, REFLECT: 3500 };

export interface Pacing {
  steps: Step[];
  index: number;
  step: Step | null;
  /** events as of the shown step (what the rail and the meter may know) */
  viewEvents: CaseEvent[];
  held: boolean;
  isLatest: boolean;
  /** 0..1 progress of the dwell before the next queued step, null when nothing is queued */
  progress: number | null;
  advance: () => void;
  back: () => void;
  restart: () => void;
  toggleHold: () => void;
  show: (stage: Stage) => void;
  toLatest: () => void;
  /** restart the dwell of the shown step (e.g. after an approval, so it can be seen) */
  touch: () => void;
  /** a new case starts here: play it from its first step */
  fromStart: (caseId: string) => void;
}

export function usePacing(caseId: string | null, events: CaseEvent[], dwellMs: number): Pacing {
  const steps = useMemo(() => toSteps(events), [events]);
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const [shownAt, setShownAt] = useState(0);
  const [now, setNow] = useState(0);
  // A case loaded on page load / reload opens on its latest step; a case started here
  // (fromStart) plays from its first step.
  const [beginFor, setBeginFor] = useState<string | null>(null);
  const [placedFor, setPlacedFor] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  const last = steps.length - 1;
  const placing = !!caseId && steps.length > 0 && placedFor !== caseId;
  if (placing) {
    // place the cursor once per case (state adjusted during render, no effect needed)
    setPlacedFor(caseId);
    setIndex(beginFor === caseId && dwellMs > 0 ? 0 : last);
    setShownAt(now);
  }

  const go = useCallback(
    (i: number) => {
      setIndex(i);
      setShownAt(now);
    },
    [now],
  );

  const clamped = Math.min(index, Math.max(0, last));
  const step = steps[clamped] ?? null;
  const dwellFor = step ? (dwellMs === 0 ? 0 : Math.max(dwellMs, MIN_DWELL_MS[step.stage] ?? 0)) : 0;
  const queued = clamped < last;
  // (not in the render that placed the cursor: shownAt is only updated on the next render)
  const due = !placing && !held && queued && now > 0 && now - shownAt >= dwellFor;
  if (due) {
    // the dwell timer advances the view (adjusted during render on the next tick)
    setIndex(clamped + 1);
    setShownAt(now);
  }

  const viewEvents = useMemo(
    () => (step && clamped < last ? events.filter((e) => e.seq <= step.lastSeq) : events),
    [events, step, clamped, last],
  );

  return {
    steps,
    index: clamped,
    step,
    viewEvents,
    held,
    isLatest: clamped === last,
    progress: queued && !held && dwellFor > 0 && now ? Math.min(1, (now - shownAt) / dwellFor) : null,
    advance: () => {
      if (clamped < last) go(clamped + 1);
    },
    back: () => {
      if (clamped > 0) go(clamped - 1);
    },
    restart: () => {
      go(0);
      setHeld(false);
    },
    toggleHold: () => setHeld((h) => !h),
    show: (stage: Stage) => {
      // that stage's step before the shown one (repeat clicks step back through rounds),
      // else its latest step
      const hits = steps.map((s, i) => [s, i] as const).filter(([s]) => s.stage === stage);
      if (!hits.length) return;
      const target =
        step?.stage === stage ? (hits.filter(([, i]) => i < clamped).at(-1) ?? hits.at(-1)!) : hits.at(-1)!;
      go(target[1]);
      setHeld(true);
    },
    toLatest: () => {
      go(last);
      setHeld(false);
    },
    touch: () => setShownAt(now),
    fromStart: (id: string) => {
      setBeginFor(id);
      setHeld(false);
    },
  };
}

/** ?auto=1 -> no dwell (rehearse, tests); ?dwell=N seconds; default 5 s. */
export function useDwell(): number {
  return useSyncExternalStore(
    () => () => {},
    dwellFromUrl,
    () => DEFAULT_DWELL_MS,
  );
}

const DEFAULT_DWELL_MS = 5000;

function dwellFromUrl(): number {
  const q = new URLSearchParams(window.location.search);
  if (q.get("auto") === "1") return 0;
  const d = Number(q.get("dwell"));
  return Number.isFinite(d) && q.has("dwell") ? Math.max(0, d * 1000) : DEFAULT_DWELL_MS;
}
