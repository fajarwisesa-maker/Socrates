"use client";

import { motion, useReducedMotion } from "motion/react";
import { notices } from "@/lib/notices";
import { stageRounds } from "@/lib/present";
import type { CaseEvent, CaseRecord, Stage } from "@/lib/types";
import { ActCanvas } from "./canvases/Act";
import { AssessCanvas } from "./canvases/Assess";
import { PerceiveCanvas } from "./canvases/Perceive";
import { PlanCanvas } from "./canvases/Plan";
import { ReflectCanvas } from "./canvases/Reflect";
import { SimulateCanvas } from "./canvases/Simulate";
import { StateNotices } from "../StateNotices";
import { VerifyCanvas } from "./canvases/Verify";

/** One stage (and round) on the canvas, plus the intentional states around it. */
export function StageCanvas({
  stage,
  round,
  events,
  record,
  onDecided,
  live = true,
}: {
  stage: Stage;
  round: number;
  events: CaseEvent[];
  record: CaseRecord;
  onDecided: () => void;
  /** the shown step is the agent's current one (a retry note only makes sense live) */
  live?: boolean;
}) {
  const reduce = useReducedMotion();
  const evs = stageRounds(events, stage)[round - 1] ?? [];
  // Presenter shows a retry only while it happens, and never the "retried" footnote
  const items = notices(evs, record, live).filter((n) => n.kind !== "retried");

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
        return <VerifyCanvas record={record} events={events} round={round} />;
    }
  })();

  return (
    // each step slides in as the previous one collapses into the rail
    <motion.div
      className="relative flex h-full min-h-0 flex-col"
      initial={reduce ? false : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
    >
      <div className="min-h-0 flex-1">{body}</div>
      {items.length > 0 && (
        <div className="mt-3">
          <StateNotices items={items} />
        </div>
      )}
    </motion.div>
  );
}
