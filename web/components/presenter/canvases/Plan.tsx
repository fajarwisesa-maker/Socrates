import { BookOpen } from "lucide-react";
import { period, STRATEGY, stageRounds, supplierName } from "@/lib/present";
import type { CaseEvent, CaseRecord, Precedent } from "@/lib/types";
import { Card, Frame } from "./Frame";

export function PlanCanvas({ record, events, round }: { record: CaseRecord; events: CaseEvent[]; round: number }) {
  const rounds = stageRounds(events, "PLAN");
  const first = rounds[0]?.find((e) => e.status === "completed");
  const precedents = ((first?.data.precedents as Precedent[] | undefined) ?? []).slice(0, 2);
  const candidates = record.candidates.filter((c) => c.round === round);
  const strategies = [...new Set(candidates.flatMap((c) => c.strategies))];
  const why = round > 1 ? replanReason(record, events, round) : null;

  return (
    <Frame
      stage="PLAN"
      round={round}
      kicker={round > 1 ? `replan ${round - 1}` : undefined}
      headline={
        round > 1
          ? `Replanning: ${why ?? "new constraints"}`
          : candidates.length
            ? `${strategies.length} strategies considered`
            : "Looking for strategies…"
      }
    >
      <div className="flex h-full flex-col gap-5">
        <div className="grid grid-cols-2 gap-4" data-testid="candidates">
          {candidates.map((c) => (
            <Card key={c.option_id} className="bg-surface-2">
              <div className="text-xl font-semibold text-ink">{c.label}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {c.strategies.map((s) => (
                  <span key={s} className="rounded-full border-2 border-brand bg-surface px-3 py-0.5 text-lg font-medium text-brand-ink">
                    {STRATEGY[s] ?? s}
                  </span>
                ))}
              </div>
            </Card>
          ))}
        </div>
        {precedents.length > 0 && (
          <div data-testid="precedents">
            <div className="mb-2 flex items-center gap-2 text-xl font-medium text-ink-2">
              <BookOpen className="size-5" aria-hidden /> Similar cases from the knowledge base
            </div>
            <ul className="space-y-2">
              {precedents.map((p) => (
                <li key={p.id} className="text-xl text-ink">
                  <span className="font-semibold">Similar:</span> {p.title}
                  {p.period && <span className="text-ink-2"> · {period(p.period)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Frame>
  );
}

const KIND: Record<string, string> = {
  stock_transfer: "transfer",
  alternate_supplier: "bridge PO",
  spot_air: "air charter",
  reschedule_customer: "reschedule",
};

/** Why round `round` of PLAN happened, from the event just before it started. */
export function replanReason(record: CaseRecord, events: CaseEvent[], round: number): string | null {
  const starts = events.filter((e) => e.stage === "PLAN" && e.status === "started");
  const start = starts[round - 1];
  if (!start) return null;
  const before = events.filter((e) => e.seq < start.seq);
  const labels = record.affected?.labels;
  for (let i = before.length - 1; i >= 0; i--) {
    const e = before[i];
    if (e.stage === "ACT" && e.status === "rejected") {
      if (e.title.startsWith("Approval came too late")) return "approval came too late";
      const rejected = record.actions.filter((a) => a.status === "REJECTED");
      const kind = rejected.find((a) => e.title.includes(a.description))?.kind;
      return `planner rejected the ${KIND[kind ?? ""] ?? "action"}`;
    }
    if (e.stage === "REFLECT" && e.status === "completed") {
      const cs = (e.data.new_constraints as { type: string; supplier?: string }[] | undefined) ?? [];
      const c = cs[0];
      if (!c) return null;
      if (c.type === "safety_stock") return "safety stock is now a hard rule";
      if (c.type === "exclude_supplier" && c.supplier) return `${supplierName(labels, c.supplier)} excluded`;
      return c.type;
    }
  }
  return null;
}
