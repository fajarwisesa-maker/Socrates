"use client";

import { dayShort, juta } from "@/lib/format";
import type { CaseRecord } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * Always visible: money at risk, what the plan costs, and what it protects (net).
 * Every figure comes from the backend (risk function, solver); the UI only formats.
 */
export function ImpactMeter({ record }: { record: CaseRecord | null }) {
  const risk = record?.risk ?? null;
  const summary = record?.summary ?? null;
  const resolved = record?.status === "RESOLVED";
  const escalated = record?.status === "ESCALATED";
  const reopened = record?.status === "REOPENED";
  const chosen = summary ? record?.candidates.find((c) => c.option_id === summary.chosen) : null;
  const orders = risk?.orders.filter((o) => o.stockout_probability > 0).length ?? 0;

  return (
    <section
      aria-label="Impact"
      data-testid="impact-meter"
      className="flex h-full flex-col gap-6 rounded-[var(--radius-card)] bg-surface p-5 shadow-[var(--shadow-card)]"
    >
      <Metric
        label="At risk"
        value={risk ? juta(risk.max_exposure) : null}
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
        value={summary && !escalated ? juta(summary.case_cost ?? summary.chosen_cost) : null}
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
        value={summary && !escalated ? juta(summary.net_protected) : null}
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
    </section>
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
  value: string | null;
  pending: string;
  note?: string | null;
  hero?: boolean;
  tone: "risk" | "ink" | "ok" | "muted";
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="text-xl font-medium text-ink-2">{label}</div>
      <div
        className={cn(
          "leading-[1.05] font-semibold tracking-tight tabular-nums",
          hero && value !== null ? "text-[4rem]" : "text-[2.75rem]",
          value === null || tone === "muted" ? "text-ink-2" : tone === "risk" ? "text-risk-ink" : tone === "ok" ? "text-ok-ink" : "text-ink",
        )}
      >
        {value ?? "—"}
      </div>
      <div className="mt-1 text-xl leading-snug text-ink-2">{value === null ? pending : note}</div>
    </div>
  );
}
