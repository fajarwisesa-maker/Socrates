"use client";

import { Info, MessageCircle, Timer } from "lucide-react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { caseClock } from "@/lib/caseClock";
import { dayShort, juta, minutesSeconds, thousands } from "@/lib/format";
import { plantName, whatsappReply } from "@/lib/present";
import type { CaseEvent, CaseRecord } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { GantrySign, StatusPlate } from "@/components/signs";

/** Verify's headline: re-reading SAP, then the outcome. */
export function verifyHead(record: CaseRecord, now: number | null): { headline: string; tone: "ink" | "risk" | "ok" } {
  const failed = record.status === "REOPENED";
  const verified = record.status === "RESOLVED" && record.verification?.covered;
  const due = record.verify_due_at && now ? Math.max(0, Math.ceil((Date.parse(record.verify_due_at) - now) / 1000)) : null;
  const docs = record.actions.filter((a) => a.status === "EXECUTED" && a.sap_ref).length;
  return {
    headline: failed
      ? "Verification failed: case re-opened"
      : verified
        ? "Mitigation confirmed in SAP"
        : due
          ? `Re-reading SAP in ${due} s`
          : `Re-reading ${docs === 2 ? "both documents" : docs === 1 ? "the document" : `${docs} documents`} in SAP…`,
    tone: failed ? "risk" : verified ? "ok" : "ink",
  };
}

/**
 * Under the map: the outcome. The routes and the DC's coverage plate turn first (map, about
 * 0.8 s), then the outcome line rises in, then the time: two beats.
 */
export function VerifyBody({ record, events }: { record: CaseRecord; events: CaseEvent[] }) {
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
  const inbound = risk?.inbound[0];
  const reply = whatsappReply(events);
  const rise = (delay: number) => ({
    initial: reduce ? false : { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: reduce ? 0 : delay, duration: reduce ? 0 : 0.32, ease: [0.2, 0.7, 0.2, 1] as const },
  });

  return (
    <div className="flex h-full flex-col gap-4">
      {failed && (
        <div className="flex items-start gap-4 rounded-[12px] bg-road-white px-6 py-2 inset-ring-2 inset-ring-stop-red" data-testid="reopened-plate">
          <StatusPlate tone="rejected">Reopened</StatusPlate>
          <p className="text-lg font-bold">SIAGA handed the case back: a planner needs to look at it. Everything done so far stays in SAP and in the audit trail.</p>
        </div>
      )}
      {v && !verified && (
        <p className={failed ? "text-xl font-semibold text-risk-ink" : "text-xl text-ink"} data-testid="coverage">
          {thousands(v.projected_supply)} of {thousands(v.demand)} cartons {v.covered ? "covered" : "projected"} by the cutoff
          {failed && ": SAP no longer shows the planned supply arriving in time"}
        </p>
      )}
      {verified && summary && (
        // wow moment 4: the clock has stopped; the result lands in two beats
        <motion.div {...rise(1.0)}>
          <GantrySign flat className="flex flex-col gap-1 px-6 py-2">
            <p className="text-[1.75rem] leading-tight font-black" data-testid="final-line">
              <span className="text-signal-yellow">{juta(summary.exposure_avoided)} protected</span> for{" "}
              {juta(summary.case_cost ?? summary.chosen_cost)}
            </p>
            {clock.stoppedBy === "resolved" && (
              <motion.p className="flex items-center gap-2 text-[1.75rem] leading-tight font-black" data-testid="time-line" {...rise(1.6)}>
                <Timer className="size-7" aria-hidden />
                <span>3 days</span> → <span className="text-signal-yellow">{minutesSeconds(clock.seconds)}</span>
              </motion.p>
            )}
            {reply && (
              <p className="flex items-center gap-2 text-base font-bold" data-testid="whatsapp-reply">
                <MessageCircle className="size-4" aria-hidden /> {reply}
              </p>
            )}
          </GantrySign>
        </motion.div>
      )}
      {reply && !(verified && summary) && (
        // WhatsApp option B: the outcome went back to the person who sent the message
        <p className="flex items-center gap-2 text-lg font-bold" data-testid="whatsapp-reply">
          <MessageCircle className="size-5" aria-hidden /> {reply}
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
  );
}
