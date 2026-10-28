import { CandidateSign, PrecedentPlate, ReplanPlate } from "@/components/plan";
import { precedentHits, replanReason } from "@/lib/planView";
import type { CaseEvent, CaseRecord } from "@/lib/types";
import { Frame } from "./Frame";

/** Strategies as direction signs, why a replan happened, and the precedent that informs it. */
export function PlanCanvas({ record, events, round }: { record: CaseRecord; events: CaseEvent[]; round: number }) {
  const hits = precedentHits(events);
  const top = hits[0];
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
          ? `Replanning with ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`
          : candidates.length
            ? `${strategies.length} strategies, ${candidates.length} candidate plans`
            : "Looking for strategies…"
      }
    >
      <div className="flex h-full flex-col gap-4">
        {why && <ReplanPlate reason={why} large />}
        <div className="flex flex-col gap-3" data-testid="candidates">
          {candidates.map((c) => (
            <CandidateSign key={c.option_id} candidate={c} large />
          ))}
        </div>
        {top && (
          <div data-testid="precedents" className="mt-auto">
            <PrecedentPlate hit={top} large more={hits.length - 1} />
          </div>
        )}
      </div>
    </Frame>
  );
}
