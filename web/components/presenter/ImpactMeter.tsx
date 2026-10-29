"use client";

import { juta } from "@/lib/format";
import { useCountUp } from "@/lib/motion";
import type { CaseEvent, CaseRecord, Risk, Summary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Figure } from "../Figure";
import { GantrySign, SolverLabel } from "../signs";

/**
 * Always visible: money at risk, what the plan costs, and what it protects (net). Three
 * numbers and the solver label, nothing else. Each counts up the first time the narration
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
    <GantrySign flat as="section" label="Impact" testId="impact-meter" className="flex h-full flex-col gap-6">
      <div className="sign-label text-sm">Impact</div>
      <Metric label="At risk" value={risk ? risk.max_exposure : null} hero id={id("at-risk")} testId="meter-at-risk" />
      <Metric
        label="Plan cost"
        value={summary && !escalated ? (summary.case_cost ?? summary.chosen_cost) : null}
        empty={escalated ? "No plan" : undefined}
        id={id("plan-cost")}
        testId="meter-plan-cost"
      />
      <Metric
        label="Protected (net)"
        value={summary && !escalated ? summary.net_protected : null}
        empty={escalated ? "No plan" : undefined}
        tone={resolved ? "ok" : reopened ? "muted" : "ink"}
        status={resolved ? "verified in SAP" : reopened ? "not confirmed: verification failed" : "once the plan is verified"}
        id={id("protected")}
        testId="meter-protected"
      />
      <SolverLabel className="mt-auto text-white" />
    </GantrySign>
  );
}

function Metric({
  label,
  value,
  empty = "Not yet",
  hero,
  tone = "ink",
  status,
  id,
  testId,
}: {
  label: string;
  value: number | null;
  empty?: string;
  hero?: boolean;
  tone?: "ink" | "ok" | "muted";
  /** said to screen readers only */
  status?: string;
  id: string;
  testId: string;
}) {
  const shown = useCountUp(value, juta, { id, delay: 150 });
  return (
    <div data-testid={testId} className={hero ? undefined : "border-t border-white/30 pt-4"}>
      <div className="text-lg font-bold">{label}</div>
      {value === null ? (
        <div className="text-[2.25rem] leading-[1.05] font-black text-sign-green-tint">{empty}</div>
      ) : (
        <div
          className={cn(
            "leading-[1.05] font-black transition-colors duration-[var(--dur-base)]",
            hero ? "text-5xl" : "text-[2.25rem]",
            tone === "ok" ? "text-signal-yellow" : "text-white",
            tone === "muted" && "line-through decoration-2",
          )}
        >
          <Figure shown={shown ?? juta(value)} final={juta(value)} />
          {status && <span className="sr-only">, {status}</span>}
        </div>
      )}
    </div>
  );
}
