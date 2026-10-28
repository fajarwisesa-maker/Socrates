// Plain words for Presenter mode. Names come from SAP labels (assess_impact), numbers from
// the backend; this file only chooses words and formats.
import { dayShort, thousands } from "./format";
import type {
  CaseAction,
  CaseEvent,
  CaseRecord,
  Config,
  DelayPrediction,
  Labels,
  PlannedAction,
  Stage,
} from "./types";

export const CAUSE: Record<string, string> = {
  flood: "Flood",
  landslide: "Landslide",
  road_closure: "Road closure",
  accident: "Accident",
  vehicle_breakdown: "Truck breakdown",
  port_strike: "Port strike",
  labor_strike: "Strike",
  weather: "Bad weather",
  carrier_capacity: "No truck capacity",
  quality_hold: "Quality hold",
  other: "Disruption",
  none: "No disruption",
};

export const STRATEGY: Record<string, string> = {
  spot_air: "Air charter",
  stock_transfer: "Transfer from another DC",
  alternate_supplier: "Alternate supplier",
  reschedule_customer: "Reschedule a customer order",
};

export const FIELD: Record<string, string> = {
  is_disruption: "Shipment stuck",
  cause: "Cause",
  location: "Where",
  lane: "Lane",
  delay: "Delay",
  references: "Our PO",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2025-02" -> "Feb 2025" */
export function period(p: string | null | undefined): string | null {
  const m = p?.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONTHS[Number(m[2]) - 1]} ${m[1]}` : (p ?? null);
}

export function delay(min: number | null, max: number | null): string {
  if (min === null || max === null) return "unknown";
  return min === max ? `${min} h` : `${min}–${max} h`;
}

export function plantName(labels: Labels | undefined, code: string): string {
  return labels?.plants?.[code] ?? code;
}

export function supplierName(labels: Labels | undefined, code: string): string {
  return labels?.suppliers?.[code]?.name ?? code;
}

/** One line per planned action, in plain words: "750 cartons from Bandung DC". */
export function actionLine(a: PlannedAction | CaseAction, labels: Labels | undefined): string {
  const q = thousands(a.quantity);
  const ref = "reference" in a ? a.reference : ((a.planned?.reference as string | undefined) ?? "");
  switch (a.kind) {
    case "stock_transfer":
      return `${q} cartons from ${plantName(labels, ref)}`;
    case "alternate_supplier":
      return `${q} cartons from ${supplierName(labels, ref)}`;
    case "spot_air":
      return `${q} cartons by air charter`;
    case "reschedule_customer":
      return `Reschedule order ${ref}`;
    default:
      return `${a.kind} ${ref}`;
  }
}

/** Title of an executed / pending action: "Transfer 400 cartons · Bandung DC → Cikarang DC". */
export function actionTitle(a: CaseAction, labels: Labels | undefined, dest: string): string {
  const q = thousands(a.quantity);
  const ref = a.planned?.reference ?? "";
  switch (a.kind) {
    case "stock_transfer":
      return `Transfer ${q} cartons · ${plantName(labels, ref)} → ${plantName(labels, dest)}`;
    case "alternate_supplier":
      return `Bridge PO · ${q} cartons from ${supplierName(labels, ref)}`;
    case "spot_air":
      return `Air charter · ${q} cartons to ${plantName(labels, dest)}`;
    case "reschedule_customer":
      return `Reschedule customer order ${ref}`;
    default:
      return a.description;
  }
}

export function eta(record: CaseRecord, iso: string | null | undefined): string {
  return iso ? dayShort(record.day0, iso) : "—";
}

/** Events of one stage, split into rounds (one list per "started" event). */
export function stageRounds(events: CaseEvent[], stage: Stage): CaseEvent[][] {
  const rounds: CaseEvent[][] = [];
  for (const e of events) {
    if (e.stage !== stage) continue;
    if (e.status === "started" || rounds.length === 0) rounds.push([]);
    rounds[rounds.length - 1].push(e);
  }
  return rounds;
}

export function completed(evs: CaseEvent[]): CaseEvent | undefined {
  return evs.find((e) => e.status === "completed");
}

export const TOOL: Record<string, string> = {
  find_inbound_purchase_orders: "Find inbound POs",
  assess_impact: "Assess impact",
  search_precedents: "Search precedents",
  simulate_option: "Simulate option",
  get_action_status: "Read SAP status",
  request_human_approval: "Request approval",
  draft_rfq: "Draft RFQ",
  execute_stock_transfer: "Stock transfer",
  create_purchase_order: "Purchase order",
  book_spot_air: "Air charter booking",
  reschedule_customer_order: "Customer reschedule",
  // v2 specialists' tools (ORCHESTRATION=multi)
  extract_pdf_text: "Read PDF",
  find_open_pos: "Find open POs",
  get_stock: "Read stock",
  get_sales_orders: "Read customer orders",
  compute_risk: "Compute risk",
  run_solver: "Run solver",
  check_business_rules: "Check business rules",
  create_stock_transfer: "Stock transfer",
  request_approval: "Request approval",
  check_status: "Read SAP status",
  predict_delay: "Predict delay (SAP RPT-1.6)",
};

/** Assess chip for the learned delay (v2 step 3). Wording per the v2 brief for RPT; the
 * offline stand-in and an unavailable model say so plainly. */
export function delayChip(
  p: DelayPrediction | null | undefined,
): { hours: string | null; text: string; tone: "brand" | "human" | "muted" } | null {
  if (!p) return null;
  if (p.status !== "ok") return { hours: null, text: "Prediction unavailable: using signal range", tone: "muted" };
  const rows = p.history_rows ?? 0;
  const source =
    p.provider === "fake"
      ? `Delay estimated offline (not RPT) · from ${rows} past disruptions`
      : `Delay predicted by SAP RPT-1.6 · from ${rows} past disruptions`;
  const hours = `${p.delay_for_risk_hours[0]} h`;
  return p.disagree
    ? { hours, text: `${source} · model and signal disagree`, tone: "human" }
    : { hours, text: source, tone: "brand" };
}

/** The agent working each stage: from the events (what happened), else the configured team. */
export function agentsByStage(events: CaseEvent[], config: Config | null): Partial<Record<Stage, string>> {
  const out: Partial<Record<Stage, string>> = {};
  for (const sp of config?.specialists ?? []) for (const st of sp.stages) out[st] = sp.name;
  for (const e of events) if (e.agent && e.stage !== "CASE" && e.status === "started") out[e.stage] = e.agent;
  return out;
}

/** Show a gloss only when it adds something (an English quote's gloss repeats it). */
export function glossFor(e: { quote: string; gloss_en?: string | null }): string | null {
  const g = e.gloss_en?.trim();
  if (!g) return null;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return norm(g) === norm(e.quote) ? null : g;
}

export const SAP_MODEL_NOTE = "Model: Claude via SAP AI Core";

/** The note shown when this case's model calls ran on SAP AI Core. Read from the case's
 *  own events. */
export function sapModelNote(events: CaseEvent[]): string | null {
  const onSap = events.some((e) => e.status === "llm" && String(e.data?.model ?? "").includes("sap:"));
  return onSap ? SAP_MODEL_NOTE : null;
}

/** Where the model runs, from /config (Architecture view, details drawer). */
export function modelLabel(config: Config | null): string {
  if (!config) return "";
  if (config.replay) {
    const src = config.replay_source;
    return `replay of a recorded run (${src?.provider ?? "recording"}${src?.model ? `, ${src.model}` : ""})`;
  }
  if (config.llm_provider === "sap_genai") return `Claude via SAP AI Core · ${config.model ?? ""}`;
  return "scripted fake LLM (offline)";
}

/** WhatsApp option B: "Reply sent on WhatsApp to +62 ••• 7890" once the outcome went out. */
export function whatsappReply(events: CaseEvent[]): string | null {
  const sent = events.find((e) => e.stage === "CASE" && e.title.startsWith("Outcome sent on WhatsApp"));
  return sent ? sent.title.replace("Outcome sent on WhatsApp", "Reply sent on WhatsApp") : null;
}

/** SOLVER_BACKEND=lambda: where the solver work of these tool events ran. Each tool call
 *  carries `computed_on` from the backend, so the label is only "AWS Lambda" when it was. */
export function solverLabel(events: CaseEvent[]): string {
  const where = events
    .filter((e) => e.status === "tool")
    .map((e) => e.data.computed_on as string | undefined)
    .filter(Boolean);
  if (where.includes("in_process_fallback")) return "Calculated by the solver on this laptop (AWS Lambda unavailable), not AI";
  if (where.includes("aws_lambda")) return "Calculated by the solver on AWS Lambda, not AI";
  return "Calculated by the solver, not AI";
}

/** Short form for event lists. */
export const COMPUTED_ON: Record<string, string> = {
  aws_lambda: "AWS Lambda",
  in_process_fallback: "local (Lambda unavailable)",
};
