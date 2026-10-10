"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { stageRounds } from "@/lib/present";
import type { CaseEvent, CaseRecord, Stage } from "@/lib/types";
import { ActCanvas } from "./canvases/Act";
import { AssessCanvas } from "./canvases/Assess";
import { PerceiveCanvas } from "./canvases/Perceive";
import { PlanCanvas } from "./canvases/Plan";
import { ReflectCanvas } from "./canvases/Reflect";
import { SimulateCanvas } from "./canvases/Simulate";
import { VerifyCanvas } from "./canvases/Verify";

/** One stage (and round) on the canvas, plus the intentional states around it. */
export function StageCanvas({
  stage,
  round,
  events,
  record,
  onDecided,
}: {
  stage: Stage;
  round: number;
  events: CaseEvent[];
  record: CaseRecord;
  onDecided: () => void;
}) {
  const evs = stageRounds(events, stage)[round - 1] ?? [];
  const last = evs.at(-1);
  const retrying = last?.status === "retry";
  const escalated = record.status === "ESCALATED" && events.some((e) => e.stage === stage && e.status === "escalated");

  const body = (() => {
    switch (stage) {
      case "PERCEIVE":
        return <PerceiveCanvas record={record} round={round} />;
      case "ASSESS":
        return <AssessCanvas record={record} round={round} />;
      case "PLAN":
        return <PlanCanvas record={record} events={events} round={round} />;
      case "SIMULATE":
        return <SimulateCanvas record={record} round={round} />;
      case "REFLECT":
        return <ReflectCanvas record={record} events={events} round={round} />;
      case "ACT":
        return <ActCanvas record={record} round={round} onDecided={onDecided} />;
      case "VERIFY":
        return <VerifyCanvas record={record} round={round} />;
    }
  })();

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">{body}</div>
      {retrying && (
        <p className="mt-3 flex items-center gap-2 text-xl text-ink-2" data-testid="retry-note">
          <RefreshCw className="size-5 animate-spin motion-reduce:animate-none" aria-hidden />
          Retrying the model call… ({String(last?.data.reason ?? "busy")}, attempt {String(last?.data.attempt ?? "")})
        </p>
      )}
      {escalated && (
        <div
          className="mt-3 flex items-start gap-3 rounded-[var(--radius-card)] bg-risk-soft p-4 text-xl text-risk-ink"
          data-testid="escalated-panel"
        >
          <AlertTriangle className="mt-0.5 size-6 shrink-0" aria-hidden />
          <span>
            <b>Handed to a human planner.</b> {record.escalation_reason}
          </span>
        </div>
      )}
    </div>
  );
}
