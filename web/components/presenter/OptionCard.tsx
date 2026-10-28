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
        "relative flex flex-col overflow-hidden rounded-[12px] border-[3px] p-5",
        state === "rejected" && "border-stop-red bg-road-white transition-colors",
        state === "chosen" && "border-sign-green bg-road-white shadow-[var(--shadow-card)]",
        state === "plain" && "border-asphalt bg-road-white",
      )}
    >
      <div className="text-xl font-semibold text-ink">
        {/* de-emphasised with a solid secondary colour, not opacity: it must survive a
            washed-out projector (e2e/projector.spec.ts) */}
        <span className={cn("transition-colors duration-300", state === "rejected" && "text-ink-2")}>
          {option.label}
        </span>{" "}
        <span className="font-normal text-ink-2">· {option.option_id}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <span className="relative text-[2.75rem] leading-none font-black whitespace-nowrap text-ink">
          <motion.span
            initial={play === "reject" && !reduce ? { color: "#1e2124" } : false}
            animate={{ color: state === "rejected" ? "#36393e" : "#1e2124" }}
            transition={t(stampAt)}
          >
            {feasible ? juta(r.total_cost) : "Not feasible"}
          </motion.span>
          {state === "rejected" && (
            <motion.span
              aria-hidden
              className="absolute top-1/2 left-0 h-[4px] w-full origin-left rounded bg-stop-red"
              initial={play === "reject" && !reduce ? { scaleX: 0 } : false}
              animate={{ scaleX: 1 }}
              transition={t(stampAt)}
            />
          )}
        </span>
        {state === "rejected" && (
          <motion.span
            data-testid="rejected-stamp"
            className="rounded-[6px] bg-stop-red px-3 py-1 text-xl font-black tracking-[0.12em] text-white uppercase shadow-[inset_0_0_0_2px_var(--stop-red),inset_0_0_0_4px_#fff]"
            initial={play === "reject" && !reduce ? { opacity: 0, scale: 2.2, rotate: -20 } : false}
            animate={{ opacity: 1, scale: 1, rotate: -8 }}
            transition={{ delay: stampAt, type: reduce ? false : "spring", stiffness: 500, damping: 22 }}
          >
            Rejected
          </motion.span>
        )}
        {state === "chosen" && (
          <span className="inline-flex items-center gap-1 rounded-[6px] bg-sign-green px-3 py-1 text-lg font-black tracking-[0.08em] text-white uppercase">
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
