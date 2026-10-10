"use client";

import { AlertTriangle, Check, RotateCcw, X } from "lucide-react";
import { STAGE_LABEL, STAGES, stageInfo, type StageState } from "@/lib/stages";
import type { CaseEvent, CaseRecord, Stage } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

const ROW = 4.25; // rem: row height; the replan loop is drawn in the same units

/**
 * Vertical stepper of the seven stages. Done = check, current = pulsing dot, not yet = hollow.
 * A rejected plan shows as a loop from Reflect back to Plan with "1 replan".
 */
export function StageRail({
  events,
  record,
  focus,
  onSelect,
}: {
  events: CaseEvent[];
  record: CaseRecord | null;
  focus: Stage | null;
  onSelect?: (stage: Stage) => void;
}) {
  const now = useNow(500);
  const infos = STAGES.map((s) => (record ? stageInfo(s, events, record, now) : null));
  const replans = record?.replan_count ?? 0;
  const plan = STAGES.indexOf("PLAN");
  const reflect = STAGES.indexOf("REFLECT");

  return (
    <nav aria-label="Agent stages" data-testid="stage-rail" className="relative">
      {replans > 0 && (
        <svg
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
          <path
            d={`M1.7 ${(reflect + 0.5) * ROW} C 0.15 ${(reflect + 0.5) * ROW}, 0.15 ${(plan + 0.5) * ROW}, 1.6 ${(plan + 0.5) * ROW}`}
            fill="none"
            stroke="var(--risk-ink)"
            strokeWidth="0.13"
            strokeLinecap="round"
            markerEnd="url(#replan-arrow)"
          />
        </svg>
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
                  className={cn("absolute top-[2.5rem] left-[2.825rem] w-[2px]", lineDone ? "bg-brand" : "bg-line")}
                  style={{ height: `${ROW - 2.5}rem` }}
                />
              )}
              <Indicator state={state} human={human} resolved={resolved} />
              <button
                type="button"
                onClick={() => onSelect?.(stage)}
                disabled={state === "pending"}
                className="pt-[0.2rem] text-left disabled:cursor-default"
                aria-current={isFocus ? "step" : undefined}
              >
                <div
                  className={cn(
                    "text-xl leading-tight",
                    isFocus ? "font-bold text-ink" : state === "pending" ? "font-medium text-ink-2" : "font-semibold text-ink",
                  )}
                >
                  {STAGE_LABEL[stage]}
                </div>
                {stage === "REFLECT" && replans > 0 ? (
                  <div className="flex items-center gap-1.5 text-xl leading-tight font-semibold text-risk-ink" data-testid="rail-replans">
                    <RotateCcw className="size-5" aria-hidden />
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

function Indicator({ state, human, resolved }: { state: StageState; human: boolean; resolved: boolean }) {
  const base = "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full";
  if (state === "done")
    return (
      <span className={cn(base, resolved ? "bg-ok" : "bg-brand")}>
        <Check className="size-5 text-white" strokeWidth={3} aria-hidden />
      </span>
    );
  if (state === "escalated" || state === "failed")
    return (
      <span className={cn(base, "bg-risk")}>
        {state === "failed" ? (
          <X className="size-5 text-white" strokeWidth={3} aria-hidden />
        ) : (
          <AlertTriangle className="size-5 text-white" strokeWidth={2.5} aria-hidden />
        )}
      </span>
    );
  if (state === "running" || state === "waiting")
    return (
      <span className={cn(base, "siaga-pulse", human ? "bg-human text-human" : "bg-brand text-brand")}>
        <span className="size-3 rounded-full bg-white" />
      </span>
    );
  return <span className={cn(base, "border-2 border-line bg-surface")} />;
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
    tone = "text-human-ink";
  } else if (stage === "VERIFY" && state === "waiting" && record?.verify_due_at && now) {
    const s = Math.max(0, Math.ceil((Date.parse(record.verify_due_at) - now) / 1000));
    text = `SAP check in ${s} s`;
  } else if (state === "running") text = "Working…";
  else if (state === "escalated") {
    text = "Escalated";
    tone = "text-risk-ink";
  } else if (state === "failed") {
    text = "Re-opened";
    tone = "text-risk-ink";
  }
  if (!text) return null;
  return <div className={cn("text-xl leading-tight font-medium whitespace-nowrap", tone)}>{text}</div>;
}
