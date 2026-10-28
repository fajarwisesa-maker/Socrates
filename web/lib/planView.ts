// What the Plan stage shows, from the case record and its events (both modes).
import { supplierName } from "./present";
import type { CaseEvent, CaseRecord, Precedent } from "./types";

export interface PrecedentHit extends Precedent {
  /** strategy keys among the precedent's tags */
  tags: string[];
  /** the "Lesson." paragraph of the knowledge-base excerpt (KB text, not model-written) */
  lesson: string | null;
}

function lessonOf(excerpt: unknown): string | null {
  if (typeof excerpt !== "string") return null;
  const m = excerpt.match(/\*\*Lesson\.\*\*\s*([\s\S]*?)(?:\n\n|$)/);
  return m ? m[1].trim() : null;
}

/** First sentence of a lesson, for the projector. */
export function firstSentence(text: string): string {
  const m = text.match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : text).trim();
}

/**
 * Precedents cited by the PLAN stage: the hits of each `search_precedents` call (with
 * their lessons), else the ids the PLAN `completed` event lists. In order, no duplicates.
 */
export function precedentHits(events: CaseEvent[]): PrecedentHit[] {
  const out = new Map<string, PrecedentHit>();
  for (const e of events) {
    if (e.stage !== "PLAN") continue;
    const output = e.data.output as { hits?: Record<string, unknown>[] } | undefined;
    if (e.data.tool === "search_precedents" && output && Array.isArray(output.hits)) {
      for (const h of output.hits) {
        const id = String(h.id ?? "");
        if (!id || out.has(id)) continue;
        out.set(id, {
          id,
          title: String(h.title ?? id),
          period: (h.period as string | null) ?? null,
          synthetic: !!h.synthetic,
          tags: Array.isArray(h.tags) ? (h.tags as string[]) : [],
          lesson: lessonOf(h.excerpt),
        });
      }
    }
    if (e.status === "completed") {
      for (const p of (e.data.precedents as Precedent[] | undefined) ?? []) {
        if (!out.has(p.id)) out.set(p.id, { ...p, tags: [], lesson: null });
      }
    }
  }
  // the PLAN completed event says which hits the planner kept; show those first
  const cited = new Set(
    events
      .filter((e) => e.stage === "PLAN" && e.status === "completed")
      .flatMap((e) => (e.data.precedent_ids as string[] | undefined) ?? []),
  );
  const all = [...out.values()];
  return cited.size ? all.filter((p) => cited.has(p.id)) : all;
}

/** The query the model wrote for the precedent search (first round). */
export function precedentQuery(events: CaseEvent[]): string | null {
  const e = events.find((x) => x.stage === "PLAN" && x.data.tool === "search_precedents");
  const q = (e?.data.args as { query?: string } | undefined)?.query;
  return q ?? null;
}

const KIND: Record<string, string> = {
  stock_transfer: "transfer",
  alternate_supplier: "bridge PO",
  spot_air: "air charter",
  reschedule_customer: "reschedule",
};

export interface ReplanReason {
  /** what changed, as a plate: "New rule", "Excluded", "Rejected by you", "Too late" */
  label: string;
  text: string;
}

/** Why round `round` of PLAN happened, from the event just before it started. */
export function replanReason(record: CaseRecord, events: CaseEvent[], round: number): ReplanReason | null {
  const starts = events.filter((e) => e.stage === "PLAN" && e.status === "started");
  const start = starts[round - 1];
  if (!start) return null;
  const before = events.filter((e) => e.seq < start.seq);
  const labels = record.affected?.labels;
  for (let i = before.length - 1; i >= 0; i--) {
    const e = before[i];
    if (e.stage === "ACT" && e.status === "rejected") {
      if (e.title.startsWith("Approval came too late")) return { label: "Too late", text: "approval came too late" };
      const rejected = record.actions.filter((a) => a.status === "REJECTED");
      const action = rejected.find((a) => e.title.includes(a.description));
      return {
        label: "Rejected by you",
        text: `planner rejected the ${KIND[action?.kind ?? ""] ?? "action"}`,
      };
    }
    if (e.stage === "REFLECT" && e.status === "completed") {
      const cs = (e.data.new_constraints as { type: string; supplier?: string }[] | undefined) ?? [];
      const c = cs[0];
      if (!c) return null;
      if (c.type === "safety_stock") return { label: "New rule", text: "safety stock is now a hard rule" };
      if (c.type === "exclude_supplier" && c.supplier)
        return { label: "Excluded", text: `${supplierName(labels, c.supplier)} excluded` };
      return { label: "New rule", text: c.type.replaceAll("_", " ") };
    }
  }
  return null;
}
