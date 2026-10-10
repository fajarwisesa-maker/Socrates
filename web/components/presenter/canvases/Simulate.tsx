import { Calculator } from "lucide-react";
import type { CaseRecord } from "@/lib/types";
import { OptionCard } from "../OptionCard";
import { Frame } from "./Frame";

export function SimulateCanvas({ record, round }: { record: CaseRecord; round: number }) {
  const options = record.solver_results.filter((o) => o.round === round);
  const constrained = options.some((o) => o.constraints.some((c) => c.type === "safety_stock"));
  return (
    <Frame
      stage="SIMULATE"
      round={round}
      kicker={round > 1 ? `replan ${round - 1}` : undefined}
      headline={
        !options.length
          ? "Pricing the options…"
          : round > 1
            ? constrained
              ? "Solver re-priced with safety stock as a rule"
              : "Solver re-priced the options"
            : "Solver priced every option"
      }
    >
      <div className="flex h-full flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          {options.slice(0, 3).map((o) => (
            <OptionCard key={o.option_id} option={o} record={record} />
          ))}
        </div>
        <p className="mt-auto flex items-center gap-2 text-xl font-medium text-ink-2" data-testid="solver-label">
          <Calculator className="size-6 text-brand" aria-hidden />
          Calculated by the solver, not AI
        </p>
      </div>
    </Frame>
  );
}
