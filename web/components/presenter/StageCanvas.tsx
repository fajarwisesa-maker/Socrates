"use client";

import { STAGE_LABEL, STAGES } from "@/lib/stages";
import type { CaseEvent, CaseRecord, Stage } from "@/lib/types";

/** The current stage only. Step 2: the frame; the per-stage visuals arrive in step 3. */
export function StageCanvas({
  stage,
  events,
  record,
}: {
  stage: Stage;
  events: CaseEvent[];
  record: CaseRecord;
}) {
  const evs = events.filter((e) => e.stage === stage);
  const headline =
    [...evs].reverse().find((e) => ["completed", "waiting", "rejected", "scheduled"].includes(e.status))?.title ??
    `${STAGE_LABEL[stage]}…`;
  return (
    <div className="flex h-full flex-col" data-testid="stage-canvas" data-stage={stage}>
      <p className="text-xl font-medium text-brand-ink">
        Stage {STAGES.indexOf(stage) + 1} of 7 · {STAGE_LABEL[stage]}
      </p>
      <h1 className="mt-1 text-[2.5rem] leading-tight font-bold tracking-tight">{headline}</h1>
      <div className="mt-6 flex flex-1 items-center justify-center rounded-[var(--radius-card)] bg-surface-2 text-xl text-ink-2">
        Stage visual ({STAGE_LABEL[stage]}) · step 3
      </div>
      {record.status === "ESCALATED" && (
        <p className="mt-4 text-xl text-risk-ink">Escalated to a human planner: {record.escalation_reason}</p>
      )}
    </div>
  );
}
