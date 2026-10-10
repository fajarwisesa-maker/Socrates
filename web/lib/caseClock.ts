import type { CaseEvent } from "./types";

export interface CaseClock {
  seconds: number;
  /** terminal CASE event status once the clock has stopped */
  stoppedBy: "resolved" | "escalated" | "reopened" | null;
}

/** Elapsed time from "Start case" (first event) to the terminal CASE event, else to now. */
export function caseClock(events: CaseEvent[], now: number | null): CaseClock {
  const start = events[0] ? Date.parse(events[0].ts) : null;
  const end = events.find(
    (e) => e.stage === "CASE" && ["resolved", "escalated", "reopened"].includes(e.status),
  );
  const stop = end ? Date.parse(end.ts) : (now ?? start ?? 0);
  return {
    seconds: start ? Math.max(0, (stop - start) / 1000) : 0,
    stoppedBy: (end?.status as CaseClock["stoppedBy"]) ?? null,
  };
}
