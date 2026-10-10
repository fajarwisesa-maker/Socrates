"use client";

import { Info, Timer } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { caseClock } from "@/lib/caseClock";
import { dayShort, juta, minutesSeconds, thousands } from "@/lib/format";
import { plantName, supplierName } from "@/lib/present";
import type { CaseAction, CaseEvent, CaseRecord, Labels } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { LaneMap, type Flow } from "../LaneMap";
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
  const lane = labels?.lanes?.[a?.purchase_orders[0]?.YY1_TransportLane ?? record.disruption?.lane ?? ""];
  const dest = plantName(labels, a?.plant ?? "");
  const due = record.verify_due_at && now ? Math.max(0, Math.ceil((Date.parse(record.verify_due_at) - now) / 1000)) : null;

  const live = record.actions.filter((x) => x.status === "EXECUTED" || x.status === "PENDING_APPROVAL");
  const flows: Flow[] = live.map((x) => ({
    from: source(x, labels),
    label: `${thousands(x.quantity)} ctn · ${x.eta ? dayShort(record.day0, x.eta) : "—"}`,
    tone: x.status === "PENDING_APPROVAL" ? "human" : verified ? "ok" : failed ? "plain" : "ok",
  }));
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
      <div className="flex h-full flex-col gap-4">
        <LaneMap
          origin={lane?.from ?? "Supplier"}
          blockedAt={record.disruption?.location?.split(",").at(-1)?.trim().replace("-", "–") ?? null}
          dest={dest}
          flows={flows}
          cutoff={risk?.deadline ? `Cutoff ${dayShort(record.day0, risk.deadline)}` : undefined}
          dimBlocked
        />
        {v && !verified && (
          <p className={failed ? "text-xl font-semibold text-risk-ink" : "text-xl text-ink"} data-testid="coverage">
            {thousands(v.projected_supply)} of {thousands(v.demand)} cartons {v.covered ? "covered" : "projected"} by the
            cutoff
            {failed && ": SAP no longer shows the planned supply arriving in time"}
          </p>
        )}
        {verified && summary && (
          // wow moment 4: the clock has stopped; the result lands in two beats
          <div className="flex flex-col gap-1">
            <motion.p
              className="text-[1.75rem] leading-tight font-bold text-ink"
              data-testid="final-line"
              initial={reduce ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduce ? 0 : 0.4, duration: 0.5 }}
            >
              <span className="text-ok-ink">{juta(summary.exposure_avoided)} protected</span> for{" "}
              {juta(summary.case_cost ?? summary.chosen_cost)}
            </motion.p>
            {clock.stoppedBy === "resolved" && (
              <motion.p
                className="flex items-center gap-2 text-[1.75rem] leading-tight font-bold text-ink"
                data-testid="time-line"
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : 1.2, duration: 0.5 }}
              >
                <Timer className="size-7 text-ok-ink" aria-hidden />
                <span className="text-ink-2">3 days</span> → <span className="text-ok-ink">{minutesSeconds(clock.seconds)}</span>
              </motion.p>
            )}
          </div>
        )}
        {inbound && !failed && (
          <p className="mt-auto flex gap-2 text-xl text-ink-2" data-testid="tier0-note">
            <Info className="mt-1 size-5 shrink-0" aria-hidden />
            <span>
              PO {inbound.ref} still arrives {dayShort(record.day0, inbound.arrival_earliest).replace(" WIB", "")}–
              {dayShort(record.day0, inbound.arrival_latest)}: extra stock at {dest} later. No action taken.
            </span>
          </p>
        )}
      </div>
    </Frame>
  );
}

function source(x: CaseAction, labels: Labels | undefined) {
  const ref = x.planned?.reference ?? "";
  if (x.kind === "stock_transfer") return plantName(labels, ref);
  if (x.kind === "alternate_supplier") return supplierName(labels, ref);
  if (x.kind === "spot_air") return "Air charter";
  return ref;
}
