"use client";

import { Info, MessageCircle, Timer } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { caseClock } from "@/lib/caseClock";
import { dayShort, juta, minutesSeconds, thousands } from "@/lib/format";
import { plantName, whatsappReply } from "@/lib/present";
import type { CaseEvent, CaseRecord } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { LaneMap } from "@/components/LaneMap";
import { laneModel } from "@/lib/laneModel";
import { GantrySign, StatusPlate } from "@/components/signs";
import { Frame } from "./Frame";

export function VerifyCanvas({ record, events, round }: { record: CaseRecord; events: CaseEvent[]; round: number }) {
  const now = useNow(500);
  const reduce = useReducedMotion();
  const clock = caseClock(events, now);
  const labels = record.affected?.labels;
  const a = record.affected;
  const v = record.verification;
  const risk = record.risk;
  const summary = record.summary;
  const failed = record.status === "REOPENED";
  const verified = record.status === "RESOLVED" && v?.covered;
  const dest = plantName(labels, a?.plant ?? "");
  const due = record.verify_due_at && now ? Math.max(0, Math.ceil((Date.parse(record.verify_due_at) - now) / 1000)) : null;

  const inbound = risk?.inbound[0];

  const headline = failed
    ? "Verification failed: case re-opened"
    : verified
      ? "Mitigation confirmed in SAP"
      : due !== null
        ? `Re-reading SAP in ${due} s`
        : "Verifying in SAP…";

  return (
    <Frame stage="VERIFY" round={round} headline={headline} tone={failed ? "risk" : verified ? "ok" : "ink"}>
      <div className="flex h-full flex-col gap-3">
        {laneModel(record, { kind: "verify" }) && (
          <LaneMap model={laneModel(record, { kind: "verify" })!} size="sm" className="mx-auto w-[88%]" />
        )}
        {failed && (
          <div className="flex items-start gap-3 rounded-[12px] border-4 border-stop-red bg-road-white px-4 py-2.5" data-testid="reopened-plate">
            <StatusPlate tone="rejected">Reopened</StatusPlate>
            <p className="text-lg font-bold">SIAGA handed the case back: a planner needs to look at it. Everything done so far stays in SAP and in the audit trail.</p>
          </div>
        )}
        {v && !verified && (
          <p className={failed ? "text-xl font-semibold text-risk-ink" : "text-xl text-ink"} data-testid="coverage">
            {thousands(v.projected_supply)} of {thousands(v.demand)} cartons {v.covered ? "covered" : "projected"} by the
            cutoff
            {failed && ": SAP no longer shows the planned supply arriving in time"}
          </p>
        )}
        {verified && summary && (
          // wow moment 4: the clock has stopped; the result lands in two beats
          <GantrySign className="flex flex-col gap-1 px-5 py-2.5">
            <motion.p
              className="text-[1.75rem] leading-tight font-black"
              data-testid="final-line"
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.4, duration: 0.5 }}
            >
              <span className="text-signal-yellow">{juta(summary.exposure_avoided)} protected</span> for{" "}
              {juta(summary.case_cost ?? summary.chosen_cost)}
            </motion.p>
            {clock.stoppedBy === "resolved" && (
              <motion.p
                className="flex items-center gap-2 text-[1.75rem] leading-tight font-black"
                data-testid="time-line"
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : 1.2, duration: 0.5 }}
              >
                <Timer className="size-7" aria-hidden />
                <span>3 days</span> → <span className="text-signal-yellow">{minutesSeconds(clock.seconds)}</span>
              </motion.p>
            )}
            {whatsappReply(events) && (
              <p className="flex items-center gap-2 text-base font-bold" data-testid="whatsapp-reply">
                <MessageCircle className="size-4" aria-hidden /> {whatsappReply(events)}
              </p>
            )}
          </GantrySign>
        )}
        {whatsappReply(events) && !(verified && summary) && (
          // WhatsApp option B: the outcome went back to the person who sent the message
          <p className="flex items-center gap-2 text-lg font-bold" data-testid="whatsapp-reply">
            <MessageCircle className="size-5" aria-hidden /> {whatsappReply(events)}
          </p>
        )}
        {inbound && !failed && (
          <p className="mt-auto flex gap-2 text-base" data-testid="tier0-note">
            <Info className="mt-1 size-5 shrink-0" aria-hidden />
            <span>
              PO {inbound.ref} still arrives{" "}
              {inbound.arrival_earliest === inbound.arrival_latest
                ? dayShort(record.day0, inbound.arrival_latest)
                : `${dayShort(record.day0, inbound.arrival_earliest).replace(" WIB", "")}–${dayShort(record.day0, inbound.arrival_latest)}`}
              : extra stock at {dest} later. No action taken.
            </span>
          </p>
        )}
      </div>
    </Frame>
  );
}
