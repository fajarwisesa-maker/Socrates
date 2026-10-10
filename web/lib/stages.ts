// Stage state derived from the event stream; shared by Presenter and Planner mode.
import { STAGES, type CaseEvent, type CaseRecord, type Stage } from "./types";

export type StageState = "pending" | "running" | "done" | "waiting" | "escalated" | "failed";

export interface StageInfo {
  state: StageState;
  rounds: number;
  replans: number;
  elapsed: number;
  events: CaseEvent[];
}

export const STAGE_LABEL: Record<Stage, string> = {
  PERCEIVE: "Perceive",
  ASSESS: "Assess",
  PLAN: "Plan",
  SIMULATE: "Simulate",
  REFLECT: "Reflect",
  ACT: "Act",
  VERIFY: "Verify",
};

export function stageInfo(
  stage: Stage,
  events: CaseEvent[],
  record: CaseRecord,
  now: number | null,
): StageInfo {
  const evs = events.filter((e) => e.stage === stage);
  const rounds = evs.filter((e) => e.status === "started").length;
  const replans = evs.filter((e) => e.status === "completed" && e.title.includes("replanning")).length;
  let elapsed = evs
    .filter((e) => e.status === "completed")
    .reduce((s, e) => s + (Number(e.data?.elapsed_s) || 0), 0);
  const last = evs[evs.length - 1];
  let state: StageState;
  if (!last) state = "pending";
  else if (evs.some((e) => e.status === "escalated")) state = "escalated";
  else if (stage === "VERIFY" && record.status === "REOPENED") state = "failed";
  else if (last.status === "scheduled") state = "waiting";
  else if (last.status === "completed" || last.status === "info" || last.status === "executed")
    state = stage === "ACT" && record.status === "AWAITING_APPROVAL" ? "waiting" : "done";
  else {
    state = "running";
    const started = [...evs].reverse().find((e) => e.status === "started");
    if (started && now) elapsed += Math.max(0, (now - Date.parse(started.ts)) / 1000);
  }
  if (state === "running" && record.status !== "RUNNING") state = "done";
  return { state, rounds, replans, elapsed, events: evs };
}

/** The stage the agent is in now (the last stage with an event), or null before PERCEIVE. */
export function currentStage(events: CaseEvent[]): Stage | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const s = events[i].stage;
    if (s !== "CASE") return s as Stage;
  }
  return null;
}

export { STAGES };
