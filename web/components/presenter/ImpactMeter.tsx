"use client";

import { juta } from "@/lib/format";
import { useCountUp } from "@/lib/motion";
import type { CaseEvent, CaseRecord, Risk, Summary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Figure } from "../Figure";
import { SolverLabel } from "../signs";
import { TINT, type Tone } from "../planner/ui";

/**
 * Always visible: money at risk, what the plan costs, and what it protects (net), as three
 * tinted tiles (risk, neutral, ok) and the solver label, nothing else. Each counts up the first time the narration
 * reveals it (At risk at Assess, Plan cost and Protected at Reflect) and shows "Not yet"
 * before. Every figure comes from the backend (risk function, solver); the UI only formats.
 */
export function ImpactMeter({
  record,
  viewEvents,
  isLatest,
}: {
  record: CaseRecord | null;
  /** events as of the step on screen: the meter never runs ahead of the narration */
  viewEvents: CaseEvent[];
  isLatest: boolean;
}) {
  const risk = (viewEvents.findLast((e) => e.stage === "ASSESS" && e.status === "completed")?.data.risk ??
    null) as Risk | null;
  const summary = (viewEvents.findLast((e) => e.stage === "REFLECT" && e.status === "completed" && e.data.summary)
    ?.data.summary ?? null) as Summary | null;
  const status = isLatest ? record?.status : undefined;
  const resolved = status === "RESOLVED";
  const escalated = status === "ESCALATED";
  const reopened = status === "REOPENED";
  const id = (k: string) => `presenter-${record?.case_id}-${k}`;

  return (
    <section aria-label="Impact" data-testid="impact-meter" className="flex h-full min-h-0 flex-col gap-3">
      <div className="sign-label text-sm text-asphalt-muted">Impact</div>
      <Metric label="At risk" value={risk ? risk.max_exposure : null} tone="risk" id={id("at-risk")} testId="meter-at-risk" />
      <Metric
        label="Plan cost"
        value={summary && !escalated ? (summary.case_cost ?? summary.chosen_cost) : null}
        empty={escalated ? "No plan" : undefined}
        tone="neutral"
        id={id("plan-cost")}
        testId="meter-plan-cost"
      />
      <Metric
        label="Protected (net)"
        value={summary && !escalated ? summary.net_protected : null}
        empty={escalated ? "No plan" : undefined}
        tone={reopened ? "neutral" : "ok"}
        struck={reopened}
        status={resolved ? "verified in SAP" : reopened ? "not confirmed: verification failed" : "once the plan is verified"}
        note={resolved ? "Verified in SAP" : reopened ? "Not confirmed" : undefined}
        id={id("protected")}
        testId="meter-protected"
      />
      <SolverLabel className="mt-auto" />
    </section>
  );
}

/** One tinted tile (UI v3 polish 7): label, the figure counting up once, a short note. */
function Metric({
  label,
  value,
  empty = "Not yet",
  tone,
  struck,
  status,
  note,
  id,
  testId,
}: {
  label: string;
  value: number | null;
  empty?: string;
  tone: Tone;
  struck?: boolean;
  /** said to screen readers only */
  status?: string;
  note?: string;
  id: string;
  testId: string;
}) {
  const shown = useCountUp(value, juta, { id, delay: 150 });
  const t = TINT[value === null ? "neutral" : tone];
  return (
    <div
      data-testid={testId}
      data-tone={value === null ? "neutral" : tone}
      className={cn(
        "flex flex-col gap-1 rounded-[12px] px-4 py-3 transition-[background-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-standard)]",
        t.surface,
      )}
    >
      <div className={cn("text-lg font-bold", t.label)}>{label}</div>
      {value === null ? (
        <div className="text-[1.875rem] leading-[1.05] font-black text-ink-2">{empty}</div>
      ) : (
        <div
          className={cn(
            "text-[1.875rem] leading-[1.05] font-black whitespace-nowrap transition-colors duration-[var(--dur-base)]",
            t.strong,
            struck && "text-ink-2 line-through decoration-2",
          )}
        >
          <Figure shown={shown ?? juta(value)} final={juta(value)} />
          {status && <span className="sr-only">, {status}</span>}
        </div>
      )}
      {note && <div className={cn("text-sm font-bold", t.label)}>{note}</div>}
    </div>
  );
}
