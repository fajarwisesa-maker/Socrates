// Words and states for the case file (Planner) and the Presenter canvases. Names come from
// SAP labels, numbers from the backend; this file chooses words, formats and picks states.
// Times: the approval countdown compares a backend timestamp with the browser clock.
import { thousands } from "./format";
import { placeInText } from "./laneLayout";
import { CAUSE, plantName, supplierName } from "./present";
import { stageInfo, STAGE_LABEL, type StageState } from "./stages";
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
  if (info.state === "pending") return null;
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

/** "KM 2 OF 7 · IMPACT AGENT" */
export function sheetKicker(stage: Stage, agent: string | undefined): string {
  return [`KM ${["PERCEIVE", "ASSESS", "PLAN", "SIMULATE", "REFLECT", "ACT", "VERIFY"].indexOf(stage) + 1} of 7`, agent]
    .filter(Boolean)
    .join(" · ");
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
