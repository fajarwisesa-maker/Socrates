// Error and guard-rail states in plain words. They are part of the story (the guard rails
// working), so they get deliberate styling: neutral for a retry, red for a block or a
// hand-over to a human.
import { TOOL } from "./present";
import type { CaseEvent, CaseRecord } from "./types";

export interface Notice {
  kind: "retrying" | "retried" | "denied" | "budget" | "escalated" | "reopened";
  tone: "neutral" | "risk";
  title: string;
  detail: string;
  seq: number;
}

interface ToolData {
  tool?: string;
  status?: string;
  tier?: number;
  denial?: { message?: string; tier?: number; policies?: string[] } | null;
  error?: string | null;
}

/** Notices for a list of events (one step, or a whole stage). `live`: the step is current. */
export function notices(events: CaseEvent[], record: CaseRecord, live: boolean): Notice[] {
  const out: Notice[] = [];
  const retries = events.filter((e) => e.status === "retry");
  const last = events.at(-1);
  if (retries.length && last?.status === "retry" && live) {
    const d = last.data as { attempt?: number; max_attempts?: number; wait_s?: number; reason?: string };
    out.push({
      kind: "retrying",
      tone: "neutral",
      title: "Retrying the model call…",
      detail: `The model service is busy (${d.reason ?? "throttled"}). Attempt ${d.attempt} of ${d.max_attempts}, next try in ${Math.round(d.wait_s ?? 0)} s.`,
      seq: last.seq,
    });
  } else if (retries.length && !events.some((e) => e.status === "escalated")) {
    out.push({
      kind: "retried",
      tone: "neutral",
      title: `Model call retried ${retries.length === 1 ? "once" : `${retries.length} times`}`,
      detail: "The model service was busy for a moment; the call then went through.",
      seq: retries[0].seq,
    });
  }
  for (const e of events) {
    const d = e.data as ToolData;
    if (e.status !== "tool" || !d.tool) continue;
    const name = TOOL[d.tool] ?? d.tool;
    if (d.status === "denied") {
      out.push({
        kind: "denied",
        tone: "risk",
        title: `Blocked by policy: ${name}`,
        detail: d.denial?.message ?? `Tier ${d.denial?.tier ?? d.tier} action without the required approval.`,
        seq: e.seq,
      });
    } else if (d.status === "budget_exceeded") {
      out.push({
        kind: "budget",
        tone: "risk",
        title: "Tool-call budget used up",
        detail: `The agent used all its tool calls for this case (${d.error ?? "limit reached"}); it stops and hands over.`,
        seq: e.seq,
      });
    }
  }
  const esc = events.find((e) => e.status === "escalated");
  if (esc && record.escalation_reason) {
    const { title, detail } = escalation(record.escalation_reason);
    out.push({ kind: "escalated", tone: "risk", title, detail, seq: esc.seq });
    // one red notice per hand-over: the escalation already says the budget ran out
    if (/budget/i.test(record.escalation_reason)) return out.filter((n) => n.kind !== "budget");
  }
  return out;
}

/** A plain title for an escalation reason; the reason itself stays as the detail. */
export function escalation(reason: string): { title: string; detail: string } {
  const r = reason.toLowerCase();
  const title = r.startsWith("llm unavailable")
    ? r.includes("throttl")
      ? "The model stayed busy: handed to a human planner"
      : "The model could not be reached: handed to a human planner"
    : r.includes("budget")
      ? "Tool-call budget used up: handed to a human planner"
      : r.includes("replan limit")
        ? "Replan limit reached: handed to a human planner"
        : r.includes("no feasible")
          ? "No feasible plan: handed to a human planner"
          : r.includes("golden path")
            ? "Replay covers only the recorded run"
            : "Handed to a human planner";
  const sentence = reason.charAt(0).toUpperCase() + reason.slice(1);
  return { title, detail: `${sentence}. Everything done so far is kept and in the audit trail.` };
}
