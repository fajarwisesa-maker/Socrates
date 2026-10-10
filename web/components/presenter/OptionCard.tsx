import { Check } from "lucide-react";
import { dayShort, juta } from "@/lib/format";
import { actionLine } from "@/lib/present";
import type { CaseRecord, SolverResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/** One priced option as a large card. Prices and quantities come from the solver. */
export function OptionCard({
  option,
  record,
  state = "plain",
  note,
  compact = false,
}: {
  option: SolverResult;
  record: CaseRecord;
  state?: "plain" | "rejected" | "chosen";
  note?: React.ReactNode;
  /** price and verdict only (the action lines were shown in Simulate) */
  compact?: boolean;
}) {
  const r = option.result;
  const feasible = r.status === "optimal" && r.covered_quantity >= r.required_quantity;
  const etas = r.actions.map((a) => a.eta).filter((e): e is string => !!e).sort();
  const latest = etas.at(-1);
  const labels = record.affected?.labels;
  return (
    <div
      data-testid={`option-card-${option.option_id}`}
      data-state={state}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border-2 p-5",
        state === "rejected" && "border-risk bg-surface",
        state === "chosen" && "border-brand bg-surface shadow-[var(--shadow-card)]",
        state === "plain" && "border-transparent bg-surface-2",
      )}
    >
      <div className="text-xl font-semibold text-ink">
        <span className={cn(state === "rejected" && "opacity-55")}>{option.label}</span>{" "}
        <span className="font-normal text-ink-2">· {option.option_id}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span
          className={cn(
            "text-[2.75rem] leading-none font-semibold tracking-tight whitespace-nowrap text-ink",
            state === "rejected" && "text-ink-2 line-through decoration-risk decoration-[3px]",
          )}
        >
          {feasible ? juta(r.total_cost) : "Not feasible"}
        </span>
        {state === "rejected" && (
          <span
            data-testid="rejected-stamp"
            className="rotate-[-8deg] rounded-lg border-[3px] border-risk-ink px-2 py-0.5 text-xl font-black tracking-widest text-risk-ink uppercase"
          >
            Rejected
          </span>
        )}
        {state === "chosen" && (
          <span className="inline-flex items-center gap-1 rounded-full bg-brand px-3 py-1 text-lg font-semibold text-white">
            <Check className="size-5" aria-hidden /> Chosen
          </span>
        )}
      </div>
      {!compact &&
        (feasible ? (
          <ul className="mt-3 space-y-1 text-xl text-ink-2">
            {r.actions.map((a, i) => (
              <li key={i}>{actionLine(a, labels)}</li>
            ))}
            {latest && <li>arrives by {dayShort(record.day0, latest)}</li>}
          </ul>
        ) : (
          <p className="mt-3 text-xl text-ink-2">{r.infeasible_reason ?? "cannot cover the shortfall in time"}</p>
        ))}
      {note && <div className="mt-3 text-xl leading-snug">{note}</div>}
    </div>
  );
}
