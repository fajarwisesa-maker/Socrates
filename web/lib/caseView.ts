// Words and states for the case file (Planner) and the Presenter canvases. Names come from
// SAP labels, numbers from the backend; this file chooses words, formats and picks states.
// Times: the approval countdown compares a backend timestamp with the browser clock.
import { dayShort, juta, thousands } from "./format";
import { placeInText } from "./laneLayout";
import { CAUSE, plantName, supplierName } from "./present";
import { stageInfo, STAGE_LABEL, STAGES, type StageState } from "./stages";
import type { Approval, CaseAction, CaseEvent, CaseRecord, Stage } from "./types";
import type { PostState } from "@/components/signs";

/** Disruption cause as a road-sign word (Bahasa); English when there is no sure word. */
export const SIGN_CAUSE: Record<string, string> = {
  flood: "Banjir",
  landslide: "Longsor",
  road_closure: "Jalan ditutup",
  accident: "Kecelakaan",
  port_strike: "Mogok pelabuhan",
  labor_strike: "Mogok kerja",
  weather: "Cuaca buruk",
};

/** The place named in the disruption ("Brebes"), from the layout's known places or the text. */
export function disruptionPlace(record: CaseRecord): string {
  const hit = placeInText(record.disruption?.location);
  if (hit?.place.name) return hit.place.name;
  return record.disruption?.location?.split(",").at(-1)?.trim().split(/[-–]/)[0] ?? "";
}

/** "Banjir · Brebes" for the cause plate. */
export function causeSign(record: CaseRecord): string | null {
  const d = record.disruption;
  if (!d?.is_disruption) return null;
  const word = SIGN_CAUSE[d.cause] ?? CAUSE[d.cause] ?? "Disruption";
  return [word, disruptionPlace(record)].filter(Boolean).join(" · ");
}

export function laneCode(record: CaseRecord): string | null {
  return record.affected?.purchase_orders[0]?.YY1_TransportLane ?? record.disruption?.lane ?? null;
}

export function corridor(record: CaseRecord): string | null {
  const code = laneCode(record);
  return (code && record.affected?.labels?.lanes?.[code]?.corridor) || null;
}

/** "Flood near Brebes blocks the Pantura corridor" */
export function caseTitle(record: CaseRecord): string {
  const d = record.disruption;
  if (!d) return "Reading the signals";
  if (!d.is_disruption) return "No disruption in these signals";
  const cause = CAUSE[d.cause] ?? "Disruption";
  const place = disruptionPlace(record);
  const lane = corridor(record);
  return `${cause}${place ? ` near ${place}` : ""} ${lane ? `blocks the ${lane} corridor` : "delays an inbound shipment"}`;
}

export function shortId(caseId: string): string {
  return "#" + caseId.replace(/^case-/, "").slice(0, 6);
}

/** "7 h 42 m" until a deadline; expired after it. */
export function countdown(iso: string | null | undefined, now: number | null): { text: string; expired: boolean } | null {
  if (!iso || now === null) return null;
  const ms = Date.parse(iso) - now;
  if (ms <= 0) return { text: "Expired", expired: true };
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  return { text: h > 0 ? `${h} h ${m % 60} m` : `${m} m`, expired: false };
}

/** The stage the case is at now: what Planner shows unless the planner picked one. */
export function liveStage(record: CaseRecord, events: CaseEvent[]): Stage {
  if (record.status === "AWAITING_APPROVAL") return "ACT";
  if (["VERIFYING", "RESOLVED", "REOPENED"].includes(record.status)) return "VERIFY";
  for (let i = events.length - 1; i >= 0; i--) {
    const s = events[i].stage;
    if (s !== "CASE") return s as Stage;
  }
  return "PERCEIVE";
}

/** Colour of a KM post: green done, yellow current or needs you, red flagged, white not reached. */
export function postState(stage: Stage, state: StageState, events: CaseEvent[], record: CaseRecord): PostState {
  if (afterEscalation(stage, events, record)) return "pending";
  if (state === "escalated" || state === "failed") return "flagged";
  if (stage === "REFLECT" && events.some((e) => e.stage === "REFLECT" && e.status === "completed" && e.data.rejected))
    return "flagged";
  if (state === "running" || state === "waiting") return "current";
  if (state === "done") return stage === "VERIFY" && record.status === "RESOLVED" ? "verified" : "done";
  return "pending";
}

/** One line under each KM post. */
export function stageNote(stage: Stage, record: CaseRecord, events: CaseEvent[], now: number | null): { text: string; tone: "muted" | "risk" | "needs" | "ok" } | null {
  const info = stageInfo(stage, events, record, now);
  if (info.state === "pending" || afterEscalation(stage, events, record)) return null;
  if (info.state === "running") return { text: "Working", tone: "muted" };
  if (info.state === "escalated") return { text: "Handed to a planner", tone: "risk" };
  switch (stage) {
    case "PERCEIVE":
      return record.disruption ? { text: `Confidence ${record.disruption.confidence}`, tone: "muted" } : null;
    case "ASSESS":
      return record.risk ? { text: `Shortfall ${thousands(record.risk.shortfall)} ctn`, tone: "muted" } : null;
    case "PLAN":
      return { text: info.rounds > 1 ? `${info.rounds} rounds` : "1 round", tone: "muted" };
    case "SIMULATE":
      return { text: `${record.solver_results.length} options priced`, tone: "muted" };
    case "REFLECT": {
      const rejected = events.filter((e) => e.stage === "REFLECT" && e.status === "completed" && e.data.rejected).map((e) => e.data.rejected as string);
      return rejected.length ? { text: `${rejected.join(", ")} rejected`, tone: "risk" } : { text: "All rules pass", tone: "muted" };
    }
    case "ACT":
      return info.state === "waiting" ? { text: "Waiting for you", tone: "needs" } : { text: "Done", tone: "muted" };
    case "VERIFY": {
      if (record.status === "REOPENED") return { text: "Re-opened", tone: "risk" };
      if (record.status === "RESOLVED") return { text: "Verified in SAP", tone: "ok" };
      const due = record.verify_due_at && now ? Math.max(0, Math.ceil((Date.parse(record.verify_due_at) - now) / 1000)) : null;
      return { text: due !== null ? `SAP check in ${due} s` : "Checking SAP", tone: "muted" };
    }
  }
  return null;
}

/** "KM 2 · Impact Agent" (the agent is named here, not on the rail); "KM 2 of 7" in v1 */
export function sheetKicker(stage: Stage, agent: string | undefined): string {
  const km = `KM ${["PERCEIVE", "ASSESS", "PLAN", "SIMULATE", "REFLECT", "ACT", "VERIFY"].indexOf(stage) + 1}`;
  return agent ? `${km} · ${agent}` : `${km} of 7`;
}

export const SHEET_TITLE: Record<Stage, string> = {
  PERCEIVE: "Perceive: what the signals say",
  ASSESS: "Assess: what the disruption puts at risk",
  PLAN: "Plan: strategies worth pricing",
  SIMULATE: "Simulate: every option priced",
  REFLECT: "Reflect: the Critic checks the plans",
  ACT: "Act: the plan in SAP",
  VERIFY: "Verify: did the fix hold",
};

export { STAGE_LABEL };

/** Approve-button object per action kind: "Approve purchase order". */
export const DECISION_OBJECT: Record<string, string> = {
  alternate_supplier: "purchase order",
  spot_air: "air charter",
  reschedule_customer: "reschedule",
  stock_transfer: "transfer",
};

/** "Bridge PO: 500 cartons from PT Agro Pangan Tangerang (V-2002)" */
export function approvalTitle(a: CaseAction | undefined, record: CaseRecord, fallback: string): string {
  if (!a) return fallback;
  const labels = record.affected?.labels;
  const ref = a.planned?.reference ?? "";
  const q = thousands(a.quantity);
  const dest = plantName(labels, record.affected?.plant ?? "");
  switch (a.kind) {
    case "alternate_supplier":
      return `Bridge PO: ${q} cartons from ${supplierName(labels, ref)} (${ref})`;
    case "spot_air":
      return `Air charter: ${q} cartons to ${dest}`;
    case "stock_transfer":
      return `Transfer: ${q} cartons from ${plantName(labels, ref)} to ${dest}`;
    case "reschedule_customer":
      return `Reschedule customer order ${ref}`;
    default:
      return fallback;
  }
}

/** The approval for an action, and the action for an approval. */
export function actionFor(approval: Approval, record: CaseRecord): CaseAction | undefined {
  return record.actions.find((x) => x.approval_id === approval.approval_id);
}

// ------------------------------------------------------------------ one status for every screen

/** The stage where the case was handed to a planner, or null. */
export function escalatedStage(events: CaseEvent[], record: CaseRecord): Stage | null {
  if (record.status !== "ESCALATED") return null;
  const e = events.find((x) => x.status === "escalated" && x.stage !== "CASE");
  return (e?.stage as Stage | undefined) ?? null;
}

/** Stages after the one where the case escalated were never reached: grey, never green. */
export function afterEscalation(stage: Stage, events: CaseEvent[], record: CaseRecord): boolean {
  const at = escalatedStage(events, record);
  return at !== null && STAGES.indexOf(stage) > STAGES.indexOf(at);
}

export type StatusTone = "risk" | "needs" | "ok" | "info" | "muted";

export interface CaseStatusView {
  kind: "awaiting" | "expired" | "escalated" | "running" | "replanning" | "verifying" | "resolved" | "reopened" | "failed" | "open";
  /** the header chip */
  header: { tone: StatusTone; text: string };
  /** the Approvals badge in the sidebar (null = none) */
  badge: { tone: StatusTone; text: string } | null;
  /** the chip on the Approvals page */
  pageChip: { tone: StatusTone; text: string };
  /** approvals a person can decide now (empty unless the case awaits approval) */
  decidable: Approval[];
}

/**
 * Every status word, badge and chip comes from here (docs/ui-v3-polish-plan.md, 4b), from
 * the case status and its approvals, so the screens never disagree. An approval is only
 * decidable while the case is AWAITING_APPROVAL: anything else the API refuses.
 */
export function caseStatusView(record: CaseRecord, approvals: Approval[]): CaseStatusView {
  const pending = approvals.filter((a) => a.status === "PENDING");
  const decidable = record.status === "AWAITING_APPROVAL" ? pending : [];
  const any = approvals.length > 0;
  const lastExpired = approvals.some((a) => a.status === "EXPIRED") && pending.length === 0;
  const done = { tone: "ok" as const, text: "done" };
  switch (record.status) {
    case "AWAITING_APPROVAL": {
      const by = decidable.map((a) => a.card.approve_by).filter((d): d is string => !!d).sort()[0];
      const n = decidable.length;
      return {
        kind: "awaiting",
        header: { tone: "needs", text: by ? `Needs you · by ${dayShort(record.day0, by)}` : "Needs you" },
        badge: { tone: "needs", text: `${n} waiting` },
        pageChip: { tone: "needs", text: `${n} waiting for you` },
        decidable,
      };
    }
    case "ESCALATED":
      return {
        kind: "escalated",
        header: { tone: "risk", text: "Escalated" },
        badge: { tone: "risk", text: "escalated" },
        pageChip: { tone: "risk", text: "Escalated: a planner takes over" },
        decidable,
      };
    case "RESOLVED":
      return {
        kind: "resolved",
        header: { tone: "ok", text: "Resolved" },
        badge: any ? done : null,
        pageChip: { tone: "ok", text: "Nothing waits for you" },
        decidable,
      };
    case "REOPENED":
      return {
        kind: "reopened",
        header: { tone: "risk", text: "Reopened" },
        badge: { tone: "risk", text: "reopened" },
        pageChip: { tone: "risk", text: "Reopened after the SAP check" },
        decidable,
      };
    case "VERIFYING":
      return {
        kind: "verifying",
        header: { tone: "info", text: "Verifying" },
        badge: any ? done : null,
        pageChip: { tone: "ok", text: "Nothing waits for you" },
        decidable,
      };
    case "FAILED":
      return {
        kind: "failed",
        header: { tone: "risk", text: "Failed" },
        badge: { tone: "risk", text: "failed" },
        pageChip: { tone: "risk", text: "The case failed" },
        decidable,
      };
    case "RUNNING":
      if (lastExpired)
        return {
          kind: "expired",
          header: { tone: "risk", text: "Approval expired" },
          badge: { tone: "risk", text: "expired" },
          pageChip: { tone: "risk", text: "Approved too late: SIAGA is replanning" },
          decidable,
        };
      if (approvals.some((a) => a.status === "REJECTED") && pending.length === 0)
        return {
          kind: "replanning",
          header: { tone: "info", text: "Replanning" },
          badge: null,
          pageChip: { tone: "info", text: "SIAGA is replanning" },
          decidable,
        };
      return {
        kind: "running",
        header: { tone: "muted", text: "Running" },
        badge: null,
        pageChip: { tone: "muted", text: "SIAGA is working" },
        decidable,
      };
    default:
      return {
        kind: "open",
        header: { tone: "muted", text: "Open" },
        badge: null,
        pageChip: { tone: "muted", text: "No decision yet" },
        decidable,
      };
  }
}

export type ApprovalState = "pending" | "busy" | "approved" | "rejected" | "expired" | "escalated";

/** What one approval sign shows, from the approval and the case status (4b). */
export function approvalState(approval: Approval, record: CaseRecord): ApprovalState {
  const action = actionFor(approval, record);
  if (approval.status === "EXPIRED" || action?.status === "EXPIRED") return "expired";
  if (approval.status === "APPROVED") return "approved";
  if (approval.status === "REJECTED") return "rejected";
  if (approval.status === "WITHDRAWN" || action?.status === "WITHDRAWN") return "escalated";
  // PENDING: decidable only while the case waits for it
  if (record.status === "AWAITING_APPROVAL") return "pending";
  if (record.status === "RUNNING" || record.status === "OPEN") return "busy";
  return "escalated";
}

/** An API error as one plain sentence; the raw text goes to the console only. */
export function plainError(e: unknown, doing: string): string {
  const raw = e instanceof Error ? e.message : String(e);
  console.error(`SIAGA: ${doing} failed:`, raw);
  const code = Number(raw.split(" ")[0]);
  if (code === 409)
    return `This can no longer be done: the case has moved on since this page loaded. The page now shows its current state.`;
  if (code === 401 || code === 403) return `The Case API refused the request. Check the API key on the dashboard server, then try again.`;
  if (code === 404) return `SIAGA no longer knows this case. It may have been reset; pick a case from Signals.`;
  if (code >= 500) return `SIAGA hit an error while ${doing}. Try again; if it repeats, check the Case API log.`;
  return `Could not reach the Case API while ${doing}. Check that make dev is running, then try again.`;
}

/** The total of the option an action belongs to, in the short form ("Rp 99 jt"). */
export function planTotal(action: CaseAction | undefined, record: CaseRecord): string | null {
  const o = action && record.solver_results.find((x) => x.option_id === action.option_id);
  return o ? juta(o.result.total_cost) : null;
}

/** One action's status chip (Overview decisions, Act lists), consistent with its approval. */
export function actionChip(action: CaseAction, record: CaseRecord, approvals: Approval[]): { tone: StatusTone; text: string } {
  const ap = approvals.find((p) => p.approval_id === action.approval_id);
  if (action.status === "EXECUTED") return { tone: "ok", text: action.tier >= 3 ? "Approved · done" : "Done by SIAGA" };
  if (ap) {
    const s = approvalState(ap, record);
    if (s === "pending") return { tone: "needs", text: "Needs you" };
    if (s === "busy") return { tone: "muted", text: "Waiting for SIAGA" };
    if (s === "escalated") return { tone: "risk", text: "Escalated" };
    if (s === "expired") return { tone: "risk", text: "Too late" };
    if (s === "rejected") return { tone: "risk", text: "Rejected" };
    if (s === "approved") return { tone: "info", text: "Approved · creating" };
  }
  if (action.status === "REJECTED") return { tone: "risk", text: "Rejected" };
  if (action.status === "EXPIRED") return { tone: "risk", text: "Too late" };
  if (action.status === "WITHDRAWN") return { tone: "risk", text: "Escalated" };
  return { tone: "muted", text: action.status.replace("_", " ").toLowerCase() };
}
