"use client";

import { dayShort, juta } from "@/lib/format";
import type { CaseEvent, CaseRecord, Risk, Summary } from "@/lib/types";
import { cn } from "@/lib/utils";
import { GantrySign, SolverLabel } from "../signs";
import { CountUp } from "./CountUp";

/**
 * Always visible: money at risk, what the plan costs, and what it protects (net).
 * Every figure comes from the backend (risk function, solver); the UI only formats.
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
  const chosen = summary ? record?.candidates.find((c) => c.option_id === summary.chosen) : null;
  const orders = risk?.orders.filter((o) => o.stockout_probability > 0).length ?? 0;

  return (
    <GantrySign
      as="section"
      label="Impact"
      testId="impact-meter"
      className="flex h-full flex-col gap-5 px-5 py-5"
    >
      <div className="sign-label text-sm">Impact</div>
      <Metric
        label="At risk"
        value={risk ? risk.max_exposure : null}
        pending="after Assess"
        hero
        tone="risk"
        note={
          risk
            ? `${orders} customer order${orders === 1 ? "" : "s"}${risk.deadline ? ` · by ${dayShort(record?.day0, risk.deadline)}` : ""}`
            : null
        }
        testId="meter-at-risk"
      />
      <Metric
        label="Plan cost"
        value={summary && !escalated ? (summary.case_cost ?? summary.chosen_cost) : null}
        pending={escalated ? "Handed to a human planner" : "after Reflect"}
        tone="ink"
        note={
          chosen
            ? summary && summary.already_spent > 0
              ? `${chosen.label} + ${juta(summary.already_spent)} already executed`
              : `${chosen.label} · option ${chosen.option_id}`
            : null
        }
        testId="meter-plan-cost"
      />
      <Metric
        label="Protected (net)"
        value={summary && !escalated ? summary.net_protected : null}
        pending={escalated ? "No verified plan" : "after Reflect"}
        tone={resolved ? "ok" : reopened ? "muted" : "ink"}
        note={
          summary
            ? resolved
              ? "Verified in SAP"
              : reopened
                ? "Not confirmed: verification failed"
                : "Once the plan is verified"
            : null
        }
        testId="meter-protected"
      />
      <SolverLabel className="mt-auto text-white" />
    </GantrySign>
  );
}

function Metric({
  label,
  value,
  pending,
  note,
  hero,
  tone,
  testId,
}: {
  label: string;
  value: number | null;
  pending: string;
  note?: string | null;
  hero?: boolean;
  tone: "risk" | "ink" | "ok" | "muted";
  testId: string;
}) {
  return (
    <div data-testid={testId} className={hero ? undefined : "border-t-2 border-white/60 pt-3"}>
      <div className="text-lg font-bold">{label}</div>
      <div
        className={cn(
          "leading-[1.05] font-black tabular-nums",
          hero && value !== null ? "text-5xl" : "text-[2.25rem]",
          tone === "ok" && value !== null ? "text-signal-yellow" : "text-white",
          tone === "muted" && "line-through decoration-2",
        )}
      >
        {value === null ? "—" : <CountUp value={value} format={juta} />}
      </div>
      <div className="mt-1 text-base leading-snug">{value === null ? pending : note}</div>
    </div>
  );
}
