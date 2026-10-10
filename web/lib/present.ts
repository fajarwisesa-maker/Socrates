// Plain words for Presenter mode. Names come from SAP labels (assess_impact), numbers from
// the backend; this file only chooses words and formats.
import { dayShort, thousands } from "./format";
import type { CaseAction, CaseEvent, CaseRecord, Labels, PlannedAction, Stage } from "./types";

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
