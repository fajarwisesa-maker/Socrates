import { Calculator } from "lucide-react";
import { solverLabel } from "@/lib/present";
import type { CaseEvent, CaseRecord } from "@/lib/types";
import { Reveal } from "@/components/Reveal";
import { OptionCard } from "../OptionCard";
import { Frame } from "./Frame";

export function SimulateCanvas({
  record,
  round,
  events = [],
}: {
  record: CaseRecord;
  round: number;
  /** this step's events: say where the solver ran (computed_on) */
  events?: CaseEvent[];
}) {
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
          {/* the solver's options rise in one after another, 140 ms apart */}
          {options.slice(0, 3).map((o, i) => (
            <Reveal key={o.option_id} delay={i * 140}>
              <OptionCard option={o} record={record} />
            </Reveal>
          ))}
        </div>
        {options.length > 0 && (
          <p className="mt-auto flex items-center gap-2 text-xl font-medium text-ink-2" data-testid="solver-label">
            <Calculator className="size-6 text-brand" aria-hidden />
            {solverLabel(events)}
          </p>
        )}
      </div>
    </Frame>
  );
}
