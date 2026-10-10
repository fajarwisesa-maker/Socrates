"use client";

import { RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { juta } from "@/lib/format";
import { stageRounds } from "@/lib/present";
import type { CaseEvent, CaseRecord, CriticFinding } from "@/lib/types";
import { OptionCard } from "../OptionCard";
import { Frame } from "./Frame";

/** The Critic's verdict on the cheapest plan of a round (all rules run in code). */
export function ReflectCanvas({ record, events, round }: { record: CaseRecord; events: CaseEvent[]; round: number }) {
  const reduce = useReducedMotion();
  const rounds = stageRounds(events, "REFLECT");
  const done = (r: number) => rounds[r - 1]?.find((e) => e.status === "completed");
  // the last rejection up to this round, and this round's choice
  let rejectedId: string | null = null;
  let rejectedRound = 0;
  for (let r = 1; r <= round; r++) {
    const id = done(r)?.data.rejected as string | undefined;
    if (id) [rejectedId, rejectedRound] = [id, r];
  }
  const chosenId = (done(round)?.data.chosen as string | undefined) ?? null;
  const option = (id: string | null) => record.solver_results.find((o) => o.option_id === id);
  const finding = (id: string | null): CriticFinding | undefined => record.critic_findings.find((f) => f.option_id === id);
  const rejected = option(rejectedId);
  const chosen = option(chosenId);
  const failed = finding(rejectedId)?.checks.filter((c) => !c.passed) ?? [];
  const keptRule = failed[0]?.rule;
  const kept = finding(chosenId)?.checks.find((c) => c.rule === keptRule);
  const thisRoundRejected = rejectedRound === round;
  const summary = record.summary;
  const baseline = summary?.baseline ? option(summary.baseline) : null;

  const headline = thisRoundRejected
    ? "Critic rejected the cheapest plan"
    : chosen
      ? rejected
        ? `Replanned: ${juta(chosen.result.total_cost)}, ${keptRule === "safety_stock" ? "safety stock respected" : "all rules pass"}`
        : `Critic approved the cheapest plan: ${juta(chosen.result.total_cost)}`
      : "Critic checking the plans…";

  return (
    <Frame stage="REFLECT" round={round} kicker={round > 1 ? `replan ${round - 1}` : undefined} headline={headline}>
      <div className="grid h-full grid-cols-2 items-start gap-4">
        {rejected ? (
          <OptionCard
            option={rejected}
            record={record}
            state="rejected"
            compact
            play={thisRoundRejected ? "reject" : undefined}
            note={
              <span className="flex gap-2 font-semibold text-risk-ink" data-testid="critic-reason">
                <XCircle className="mt-0.5 size-6 shrink-0" aria-hidden />
                {failed.map((c) => c.plain || c.detail).join("; ")}
              </span>
            }
          />
        ) : (
          <div />
        )}
        {chosen ? (
          <OptionCard
            option={chosen}
            record={record}
            state="chosen"
            compact
            play={rejected ? "enter" : undefined}
            note={
              <span className="flex flex-col gap-1">
                <span className="flex gap-2 font-semibold text-brand-ink" data-testid="critic-kept">
                  <ShieldCheck className="mt-0.5 size-6 shrink-0" aria-hidden />
                  {kept?.plain ?? (keptRule === "safety_stock" ? "Safety stock respected" : "All business rules pass")}
                </span>
                {summary && (summary.saving_vs_baseline ?? 0) > 0 && baseline && (
                  <span className="font-semibold text-ink">
                    Saves {juta(summary.saving_vs_baseline)} vs {baseline.label.toLowerCase()}
                  </span>
                )}
              </span>
            }
          />
        ) : thisRoundRejected ? (
          <motion.div
            className="flex h-full flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-line p-5 text-center text-xl text-ink-2"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduce ? 0 : 2, duration: 0.4 }}
          >
            <motion.span
              initial={reduce ? false : { rotate: 0 }}
              animate={{ rotate: -360 }}
              transition={{ delay: reduce ? 0 : 2, duration: 0.8, ease: "easeInOut" }}
            >
              <RotateCcw className="size-10 text-risk-ink" aria-hidden />
            </motion.span>
            Back to Plan with {keptRule === "safety_stock" ? "safety stock as a hard rule" : "a new constraint"}
          </motion.div>
        ) : null}
      </div>
    </Frame>
  );
}
