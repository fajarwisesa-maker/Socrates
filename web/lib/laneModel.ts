// What the lane map draws for a case, per view. Names come from SAP labels, quantities and
// states from the case record (risk, actions, verification); positions from laneLayout.ts.
// No number is computed here: only copied and formatted.
import { thousands } from "./format";
import { MAP_H, MAP_W, place, placeInText, type Anchor } from "./laneLayout";
import { CAUSE, plantName, supplierName } from "./present";
import type { CaseAction, CaseRecord, PlannedAction, SolverResult } from "./types";

export type RoadState = "blocked" | "faded" | "candidate" | "chosen" | "pending" | "verified" | "rejected" | "failed";
export type PlateTone = "green" | "white" | "yellow" | "red" | "asphalt";

export interface Plate {
  text: string;
  tone: PlateTone;
  icon?: "truck" | "check";
  testId?: string;
}

export interface MapNode {
  key: string;
  kind: "dest" | "source" | "origin" | "disruption" | "air";
  x: number;
  y: number;
  anchor: Anchor;
  plates: Plate[];
}

export interface MapRoad {
  id: string;
  points: [number, number][];
  state: RoadState;
  /** one sentence for the text alternative */
  text: string;
}

/** Plates on the map that belong to no marker (the stuck shipment on the blocked road). */
export interface MapBadge {
  x: number;
  y: number;
  anchor: Anchor;
  plates: Plate[];
}

export interface LaneModel {
  nodes: MapNode[];
  roads: MapRoad[];
  badges: MapBadge[];
  legend: RoadState[];
  /** one-line description for screen readers */
  title: string;
}

export type LaneView =
  | { kind: "assess" }
  | { kind: "act" }
  | { kind: "verify" }
  | { kind: "option"; option: SolverResult; rejected?: boolean };

/** Disruption cause as the sign word (Bahasa, as on a road sign); English when unsure. */
const SIGN_CAUSE: Record<string, string> = {
  flood: "Banjir",
  landslide: "Longsor",
  road_closure: "Jalan ditutup",
  accident: "Kecelakaan",
  port_strike: "Mogok pelabuhan",
  labor_strike: "Mogok kerja",
  weather: "Cuaca buruk",
};

export const LEGEND_TEXT: Record<RoadState, string> = {
  blocked: "Blocked lane",
  faded: "Blocked lane (bypassed)",
  candidate: "Possible source (not yet chosen)",
  chosen: "Route in use (done by SIAGA)",
  pending: "Route waiting for your approval",
  verified: "Route verified in SAP",
  rejected: "Rejected route",
  failed: "Late or missing in SAP",
};

interface Base {
  dest: string;
  destName: string;
  originKey: string;
  originName: string;
  hit: { key: string; x: number; y: number; anchor: Anchor; name: string };
  laneCode: string | null;
}

function base(record: CaseRecord): Base | null {
  const a = record.affected;
  if (!a) return null;
  const labels = a.labels;
  const po = a.purchase_orders[0];
  const originKey = po?.Supplier ?? "ORIGIN";
  const laneCode = po?.YY1_TransportLane ?? record.disruption?.lane ?? null;
  const lane = laneCode ? labels?.lanes?.[laneCode] : undefined;
  const originName = labels?.suppliers?.[originKey]?.city ?? lane?.from ?? supplierName(labels, originKey);
  const o = place(originKey, 0);
  const d = place(a.plant, 1);
  const found = placeInText(record.disruption?.location);
  const where = record.disruption?.location?.split(",").at(-1)?.trim().split(/[-–]/)[0] ?? "";
  const hit = found
    ? { key: found.key, x: found.place.x, y: found.place.y, anchor: found.place.label, name: found.place.name ?? where }
    : { key: "DISRUPTION", x: (o.x + d.x) / 2, y: (o.y + d.y) / 2 - 10, anchor: "bottom" as Anchor, name: where };
  return { dest: a.plant, destName: plantName(labels, a.plant), originKey, originName, hit, laneCode };
}

function sourceKey(kind: string, reference: string): string {
  return kind === "spot_air" ? "AIR" : reference;
}

/** Short source name for a route plate (the supplier code is on the approval sign). */
function sourceName(record: CaseRecord, kind: string, reference: string): string {
  const labels = record.affected?.labels;
  if (kind === "spot_air") return "Air charter";
  if (kind === "stock_transfer") return plantName(labels, reference);
  return labels?.suppliers?.[reference]?.city ?? supplierName(labels, reference);
}

const VERB: Record<string, string> = {
  stock_transfer: "transfer",
  alternate_supplier: "bridge PO",
  spot_air: "air",
};

/** The blocked lane, the stuck PO, origin and destination: the same in every view. */
function corridor(record: CaseRecord, b: Base, state: RoadState): { nodes: MapNode[]; roads: MapRoad[]; badges: MapBadge[] } {
  const o = place(b.originKey, 0);
  const d = place(b.dest, 1);
  const po = record.affected?.purchase_orders[0];
  const qty = po?.items[0]?.OrderQuantity;
  const cause = record.disruption?.cause ?? "other";
  const causeWord = SIGN_CAUSE[cause] ?? CAUSE[cause] ?? "Disruption";
  const nodes: MapNode[] = [
    { key: b.originKey, kind: "origin", x: o.x, y: o.y, anchor: o.label, plates: [{ text: b.originName, tone: "green" }] },
    {
      key: b.hit.key,
      kind: "disruption",
      x: b.hit.x,
      y: b.hit.y,
      anchor: b.hit.anchor,
      plates: [{ text: [causeWord, b.hit.name].filter(Boolean).join(" · "), tone: "yellow", testId: "map-disruption" }],
    },
  ];
  const roads: MapRoad[] = [
    {
      id: "blocked",
      points: [
        [o.x, o.y],
        [b.hit.x, b.hit.y],
        [d.x, d.y],
      ],
      state,
      text: `${b.laneCode ?? "Lane"} from ${b.originName} to ${b.destName}: blocked by ${causeWord.toLowerCase()} near ${b.hit.name}${
        state === "faded" ? ", bypassed" : ""
      }.`,
    },
  ];
  const badges: MapBadge[] = [];
  if (po && state === "blocked") {
    badges.push({
      x: b.hit.x + (o.x - b.hit.x) * 0.62,
      y: b.hit.y + (o.y - b.hit.y) * 0.62 + 6,
      anchor: "bottom",
      plates: [
        { text: `PO ${po.PurchaseOrder}`, tone: "asphalt", icon: "truck", testId: "map-stuck" },
        ...(qty ? [{ text: `${thousands(qty)} ctn stuck`, tone: "asphalt" as PlateTone }] : []),
      ],
    });
  }
  return { nodes, roads, badges };
}

function destNode(b: Base, plates: Plate[]): MapNode {
  const d = place(b.dest, 1);
  return { key: b.dest, kind: "dest", x: d.x, y: d.y, anchor: d.label, plates: [{ text: b.destName, tone: "green" }, ...plates] };
}

function route(record: CaseRecord, b: Base, key: string, i: number, state: RoadState, name: string, label: string): {
  node: MapNode;
  road: MapRoad;
} {
  const p = place(key, i + 2);
  const d = place(b.dest, 1);
  const tone: PlateTone =
    state === "failed" ? "red" : state === "candidate" || state === "rejected" ? "white" : state === "pending" ? "yellow" : "green";
  // one plate per source keeps each in its own row at the Presenter canvas width
  const plates: Plate[] = [{ text: label ? `${name} · ${label}` : name, tone, icon: state === "verified" ? "check" : undefined }];
  return {
    node: { key, kind: key === "AIR" ? "air" : "source", x: p.x, y: p.y, anchor: p.label, plates },
    road: {
      id: `${key}-${state}`,
      points: [
        [p.x, p.y],
        [d.x, d.y],
      ],
      state,
      text: `${name} to ${b.destName}${label ? ` (${label})` : ""}: ${LEGEND_TEXT[state].toLowerCase()}.`,
    },
  };
}

function dedupe(nodes: MapNode[]): MapNode[] {
  const seen = new Map<string, MapNode>();
  for (const n of nodes) if (!seen.has(n.key)) seen.set(n.key, n);
  return [...seen.values()];
}

function finish(title: string, nodes: MapNode[], roads: MapRoad[], badges: MapBadge[]): LaneModel {
  const order: RoadState[] = ["blocked", "faded", "candidate", "chosen", "pending", "verified", "failed", "rejected"];
  const legend = order.filter((s) => roads.some((r) => r.state === s));
  return { nodes: dedupe(nodes), roads, badges, legend, title };
}

export function laneModel(record: CaseRecord, view: LaneView): LaneModel | null {
  const b = base(record);
  if (!b) return null;
  const labels = record.affected?.labels;
  const risk = record.risk;

  if (view.kind === "assess") {
    const c = corridor(record, b, "blocked");
    const atRisk = risk?.orders.filter((o) => o.stockout_probability > 0).length ?? 0;
    const dest = destNode(b, risk ? [{ text: `${atRisk} order${atRisk === 1 ? "" : "s"} at risk · ${thousands(risk.shortfall)} ctn short`, tone: "red", testId: "map-at-risk" }] : []);
    // possible sources, from SAP: other lanes into the destination, alternate suppliers
    const sources: { key: string; name: string }[] = [];
    for (const [code, lane] of Object.entries(labels?.lanes ?? {})) {
      if (code !== b.laneCode && lane.to === b.dest && lane.from) sources.push({ key: lane.from, name: plantName(labels, lane.from) });
    }
    for (const [code, s] of Object.entries(labels?.suppliers ?? {})) {
      if (s.role === "ALTERNATE") sources.push({ key: code, name: s.city ? `${s.city} (${code})` : supplierName(labels, code) });
    }
    const r = sources.map((s, i) => route(record, b, s.key, i, "candidate", s.name, ""));
    return finish(
      `${b.laneCode ?? "Lane"} blocked near ${b.hit.name}; ${b.destName} has orders at risk`,
      [...c.nodes, dest, ...r.map((x) => x.node)],
      [...c.roads, ...r.map((x) => x.road)],
      c.badges,
    );
  }

  if (view.kind === "option") {
    const c = corridor(record, b, "faded");
    const state: RoadState = view.rejected ? "rejected" : "chosen";
    const r = view.option.result.actions
      .filter((a: PlannedAction) => a.kind !== "reschedule_customer")
      .map((a, i) =>
        route(record, b, sourceKey(a.kind, a.reference), i, state, sourceName(record, a.kind, a.reference), `${thousands(a.quantity)} ctn`),
      );
    return finish(
      `Option ${view.option.option_id}: ${view.option.label}`,
      [...c.nodes, destNode(b, []), ...r.map((x) => x.node)],
      [...c.roads, ...r.map((x) => x.road)],
      [],
    );
  }

  // act and verify: the case's own actions
  const verify = view.kind === "verify";
  const resolved = verify && record.status === "RESOLVED" && !!record.verification?.covered;
  const reopened = record.status === "REOPENED";
  const c = corridor(record, b, verify ? "faded" : "blocked");
  const shown = record.actions.filter(
    (x: CaseAction) => x.kind !== "reschedule_customer" && (x.status === "EXECUTED" || x.status === "PENDING_APPROVAL"),
  );
  // a re-opened case: each route is judged by its own SAP check
  const held = (x: CaseAction) => record.verification?.checks.find((k) => k.ref === x.sap_ref)?.ok;
  const r = shown.map((x, i) => {
    const ref = x.planned?.reference ?? "";
    const state: RoadState =
      x.status === "PENDING_APPROVAL"
        ? "pending"
        : resolved
          ? "verified"
          : reopened
            ? held(x) === false
              ? "failed"
              : held(x)
                ? "verified"
                : "chosen"
            : "chosen";
    const label = `${x.kind === "spot_air" ? "" : `${VERB[x.kind] ?? x.kind} `}${thousands(x.quantity)} ctn`;
    return route(record, b, sourceKey(x.kind, ref), i, state, sourceName(record, x.kind, ref), label);
  });
  const v = record.verification;
  const destPlates: Plate[] = [];
  if (verify && v) {
    destPlates.push(
      v.covered && !reopened
        ? { text: `Covered · ${thousands(v.projected_supply)} of ${thousands(v.demand)} ctn`, tone: "green", icon: "check", testId: "map-coverage" }
        : { text: `Not covered · ${thousands(v.projected_supply)} of ${thousands(v.demand)} ctn`, tone: "red", testId: "map-coverage" },
    );
  } else if (!verify && risk) {
    destPlates.push({ text: `${thousands(risk.shortfall)} ctn short`, tone: "red" });
  }
  return finish(
    verify
      ? `${b.destName}: ${resolved ? "routes verified in SAP" : reopened ? "verification failed" : "verifying"}`
      : `${b.destName}: routes in use and waiting for approval`,
    [...c.nodes, destNode(b, destPlates), ...r.map((x) => x.node)],
    [...c.roads, ...r.map((x) => x.road)],
    c.badges,
  );
}

export { MAP_H, MAP_W };
