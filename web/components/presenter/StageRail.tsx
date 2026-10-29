"use client";

import { RotateCcw } from "lucide-react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { STAGE_LABEL, STAGES, stageInfo, type StageState } from "@/lib/stages";
import type { CaseEvent, CaseRecord, Stage } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { KmPost } from "../signs";

/**
 * Vertical stepper of the seven stages: names only, plus one note on the current stage
 * ("Needs you") or a flagged one ("1 replan"). The agent working a stage is named in the
 * stage heading; here only screen readers hear it.
 */
export function StageRail({
  events,
  record,
  focus,
  onSelect,
  agents = {},
}: {
  events: CaseEvent[];
  record: CaseRecord | null;
  focus: Stage | null;
  onSelect?: (stage: Stage) => void;
  agents?: Partial<Record<Stage, string>>;
}) {
  // rem: row height; the replan loop is drawn in the same units
  const ROW = 4.25;
  const now = useNow(500);
  const reduce = useReducedMotion();
  const infos = STAGES.map((s) => (record ? stageInfo(s, events, record, now) : null));
  // replans known as of the events on screen (the rail follows the narration)
  const replans = events.filter(
    (e) => (e.stage === "REFLECT" && e.status === "completed" && !!e.data.rejected) ||
      (e.stage === "ACT" && e.status === "info" && e.title.startsWith("Replanning")),
  ).length;
  const plan = STAGES.indexOf("PLAN");
  const reflect = STAGES.indexOf("REFLECT");

  return (
    <nav aria-label="Agent stages" data-testid="stage-rail" className="relative">
      {replans > 0 && (
        <motion.svg
          initial={reduce ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: reduce ? 0 : 1.6, duration: 0.2 }}
          className="absolute top-0 left-0"
          style={{ width: "1.75rem", height: `${ROW * STAGES.length}rem` }}
          viewBox={`0 0 1.75 ${ROW * STAGES.length}`}
          aria-hidden
        >
          <defs>
            <marker id="replan-arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto">
              <path d="M0,0 L10,5 L0,10 z" fill="var(--risk-ink)" />
            </marker>
          </defs>
          <motion.path
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: reduce ? 0 : 0.9, ease: "easeInOut", delay: reduce ? 0 : 1.6 }}
            d={`M1.7 ${(reflect + 0.5) * ROW} C 0.15 ${(reflect + 0.5) * ROW}, 0.15 ${(plan + 0.5) * ROW}, 1.6 ${(plan + 0.5) * ROW}`}
            fill="none"
            stroke="var(--risk-ink)"
            strokeWidth="0.13"
            strokeLinecap="round"
            markerEnd="url(#replan-arrow)"
          />
        </motion.svg>
      )}
      <ol>
        {STAGES.map((stage, i) => {
          const info = infos[i];
          const state: StageState = info?.state ?? "pending";
          const human = stage === "ACT" && state === "waiting";
          const resolved = stage === "VERIFY" && state === "done" && record?.status === "RESOLVED";
          const isFocus = focus === stage;
          const next = infos[i + 1];
          const lineDone = state === "done" && next && next.state !== "pending";
          return (
            <li
              key={stage}
              data-testid={`rail-${stage}`}
              data-state={state}
              className="relative flex items-start gap-4 pl-7"
              style={{ height: `${ROW}rem` }}
            >
              {i < STAGES.length - 1 && (
                <span
                  aria-hidden
                  className={cn("absolute top-[2.75rem] left-[2.8125rem] w-1.5", lineDone ? "road-v" : "bg-curb")}
                  style={{ height: `${ROW - 2.75}rem` }}
                />
              )}
              <KmPost
                n={i + 1}
                state={
                  state === "done"
                    ? resolved
                      ? "verified"
                      : "done"
                    : state === "escalated" || state === "failed"
                      ? "flagged"
                      : state === "running" || state === "waiting"
                        ? "current"
                        : "pending"
                }
                className={cn((state === "running" || state === "waiting") && "siaga-pulse", human && "text-asphalt")}
              />
              <button
                type="button"
                onClick={() => onSelect?.(stage)}
                disabled={state === "pending"}
                className="min-w-0 pt-2 text-left disabled:cursor-default"
                aria-current={isFocus ? "step" : undefined}
              >
                <div
                  className={cn(
                    "text-xl leading-tight transition-colors duration-[var(--dur-base)]",
                    isFocus ? "font-black text-ink" : state === "pending" ? "font-medium text-ink-2" : "font-semibold text-ink",
                  )}
                >
                  {STAGE_LABEL[stage]}
                </div>
                {agents[stage] && (
                  <span className="sr-only" data-testid={`rail-agent-${stage}`}>
                    {agents[stage]}
                  </span>
                )}
                {stage === "REFLECT" && replans > 0 ? (
                  <div className="flex items-center gap-1.5 text-xl leading-tight font-semibold whitespace-nowrap text-chip-risk-fg" data-testid="rail-replans">
                    <RotateCcw className="size-5 shrink-0" aria-hidden />
                    {replans} replan{replans > 1 ? "s" : ""}
                  </div>
                ) : (
                  <SubLabel stage={stage} state={state} record={record} now={now} />
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function SubLabel({
  stage,
  state,
  record,
  now,
}: {
  stage: Stage;
  state: StageState;
  record: CaseRecord | null;
  now: number | null;
}) {
  let text: string | null = null;
  let tone = "text-ink-2";
  if (stage === "ACT" && state === "waiting") {
    text = "Needs you";
    tone = "font-bold text-chip-needs-fg";
  } else if (stage === "VERIFY" && state === "waiting" && record?.verify_due_at && now) {
    const s = Math.max(0, Math.ceil((Date.parse(record.verify_due_at) - now) / 1000));
    text = `Check in ${s} s`;
    tone = "text-chip-info-fg";
  } else if (state === "running") {
    text = "Working…";
    tone = "text-chip-info-fg";
  }
  else if (state === "escalated") {
    text = "Escalated";
    tone = "font-bold text-chip-risk-fg";
  } else if (state === "failed") {
    text = "Re-opened";
    tone = "font-bold text-chip-risk-fg";
  }
  if (!text) return null;
  return <div className={cn("text-xl leading-tight font-medium whitespace-nowrap", tone)}>{text}</div>;
}
