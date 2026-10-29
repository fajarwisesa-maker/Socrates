"use client";

import { notices } from "@/lib/notices";
import { stageRounds } from "@/lib/present";
import type { Approval, CaseEvent, CaseRecord, Stage } from "@/lib/types";
import { laneModel } from "@/lib/laneModel";
import { useNow } from "@/lib/useNow";
import { ActBody, actHead } from "./canvases/Act";
import { AssessBody, assessHead } from "./canvases/Assess";
import { Frame } from "./canvases/Frame";
import { PerceiveCanvas } from "./canvases/Perceive";
import { PlanCanvas } from "./canvases/Plan";
import { ReflectCanvas } from "./canvases/Reflect";
import { SimulateCanvas } from "./canvases/Simulate";
import { StateNotices } from "../StateNotices";
import { VerifyBody, verifyHead } from "./canvases/Verify";

const MAP_VIEW: Partial<Record<Stage, "assess" | "act" | "verify">> = { ASSESS: "assess", ACT: "act", VERIFY: "verify" };

/**
 * One stage (and round) on the canvas, plus the intentional states around it. Mounted once
 * per case: each step's content is keyed by the step, the lane map is not.
 */
export function StageCanvas({
  stage,
  round,
  events,
  record,
  approvals,
  onDecided,
  live = true,
}: {
  stage: Stage;
  round: number;
  events: CaseEvent[];
  record: CaseRecord;
  approvals: Approval[];
  onDecided: () => void;
  /** the shown step is the agent's current one (a retry note only makes sense live) */
  live?: boolean;
}) {
  const now = useNow(500);
  const evs = stageRounds(events, stage)[round - 1] ?? [];
  // Presenter shows a retry only while it happens, and never the "retried" footnote
  const items = notices(evs, record, live).filter((n) => n.kind !== "retried");
  const stepKey = `${stage}-${round}`;
  const view = MAP_VIEW[stage];

  let body: React.ReactNode;
  if (view) {
    // one Frame for the three map stages: the map stays mounted and morphs between them
    const head =
      stage === "ASSESS" ? { tone: "ink" as const, ...assessHead(record) } : stage === "ACT" ? actHead(record) : verifyHead(record, now);
    body = (
      <Frame
        stage={stage}
        round={round}
        stepKey={stepKey}
        headline={head.headline}
        tone={head.tone}
        map={laneModel(record, { kind: view })}
        // Assess: the map fades in and its blocked road draws before the orders appear;
        // Act: the routes draw (transfer green, bridge PO yellow), then the sign
        bodyDelay={stage === "ASSESS" ? 500 : stage === "ACT" ? 600 : 80}
      >
        {stage === "ASSESS" ? (
          <AssessBody key={stepKey} record={record} />
        ) : stage === "ACT" ? (
          <ActBody key={stepKey} record={record} approvals={approvals} onDecided={onDecided} />
        ) : (
          <VerifyBody key={stepKey} record={record} events={events} />
        )}
      </Frame>
    );
  } else {
    switch (stage) {
      case "PERCEIVE":
        body = <PerceiveCanvas key={stepKey} record={record} round={round} />;
        break;
      case "PLAN":
        body = <PlanCanvas key={stepKey} record={record} events={events} round={round} />;
        break;
      case "SIMULATE":
        body = <SimulateCanvas key={stepKey} record={record} round={round} events={evs} />;
        break;
      case "REFLECT":
        body = <ReflectCanvas key={stepKey} record={record} events={events} round={round} />;
        break;
    }
  }

  return (
    // keyed per step by the caller: the old step leaves at once, the new one rises in
    // (Frame staggers its heading and content)
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">{body}</div>
      {items.length > 0 && (
        <div className="mt-3">
          <StateNotices items={items} />
        </div>
      )}
    </div>
  );
}
