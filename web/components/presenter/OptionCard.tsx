"use client";

import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
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
  play,
}: {
  option: SolverResult;
  record: CaseRecord;
  state?: "plain" | "rejected" | "chosen";
  note?: React.ReactNode;
  /** price and verdict only (the action lines were shown in Simulate) */
  compact?: boolean;
  /** wow moment 2: "reject" stamps the card, "enter" slides the replanned card in */
  play?: "reject" | "enter";
}) {
  const reduce = useReducedMotion();
  const stampAt = reduce ? 0 : 0.8;
  const t = (delay: number) => ({ delay: reduce ? 0 : delay, duration: reduce ? 0 : 0.35 });
  const r = option.result;
  const feasible = r.status === "optimal" && r.covered_quantity >= r.required_quantity;
  const etas = r.actions.map((a) => a.eta).filter((e): e is string => !!e).sort();
  const latest = etas.at(-1);
  const labels = record.affected?.labels;
  return (
    <motion.div
      data-testid={`option-card-${option.option_id}`}
      data-state={state}
      initial={play === "enter" && !reduce ? { opacity: 0, x: 60 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: reduce ? 0 : 0.3, duration: 0.5, ease: "easeOut" }}
      className={cn(
        "relative flex flex-col overflow-hidden rounded-[var(--radius-card)] border-2 p-5",
        state === "rejected" && "border-risk bg-surface transition-colors",
        state === "chosen" && "border-brand bg-surface shadow-[var(--shadow-card)]",
        state === "plain" && "border-transparent bg-surface-2",
      )}
    >
      <div className="text-xl font-semibold text-ink">
        <motion.span
          initial={play === "reject" && !reduce ? { opacity: 1 } : false}
          animate={{ opacity: state === "rejected" ? 0.55 : 1 }}
          transition={t(stampAt)}
        >
          {option.label}
        </motion.span>{" "}
        <span className="font-normal text-ink-2">· {option.option_id}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="relative text-[2.75rem] leading-none font-semibold tracking-tight whitespace-nowrap text-ink">
          <motion.span
            initial={play === "reject" && !reduce ? { opacity: 1 } : false}
            animate={{ opacity: state === "rejected" ? 0.5 : 1 }}
            transition={t(stampAt)}
          >
            {feasible ? juta(r.total_cost) : "Not feasible"}
          </motion.span>
          {state === "rejected" && (
            <motion.span
              aria-hidden
              className="absolute top-1/2 left-0 h-[4px] w-full origin-left rounded bg-risk"
              initial={play === "reject" && !reduce ? { scaleX: 0 } : false}
              animate={{ scaleX: 1 }}
              transition={t(stampAt)}
            />
          )}
        </span>
        {state === "rejected" && (
          <motion.span
            data-testid="rejected-stamp"
            className="rounded-lg border-[3px] border-risk-ink px-2 py-0.5 text-xl font-black tracking-widest text-risk-ink uppercase"
            initial={play === "reject" && !reduce ? { opacity: 0, scale: 2.2, rotate: -20 } : false}
            animate={{ opacity: 1, scale: 1, rotate: -8 }}
            transition={{ delay: stampAt, type: reduce ? false : "spring", stiffness: 500, damping: 22 }}
          >
            Rejected
          </motion.span>
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
      {note && (
        <motion.div
          className="mt-3 text-xl leading-snug"
          initial={play && !reduce ? { opacity: 0, y: 6 } : false}
          animate={{ opacity: 1, y: 0 }}
          transition={t(play === "reject" ? 1.3 : 0.9)}
        >
          {note}
        </motion.div>
      )}
    </motion.div>
  );
}
