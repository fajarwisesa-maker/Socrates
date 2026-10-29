"use client";

import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { dayShort, juta, pct, thousands } from "@/lib/format";
import { delayChip } from "@/lib/present";
import { cn } from "@/lib/utils";
import type { CaseRecord } from "@/lib/types";
import { CountUp } from "../CountUp";
import { LaneMap } from "@/components/LaneMap";
import { laneModel } from "@/lib/laneModel";
import { Frame } from "./Frame";

export function AssessCanvas({ record, round }: { record: CaseRecord; round: number }) {
  const reduce = useReducedMotion();
  const risk = record.risk;
  const a = record.affected;
  if (!risk || !a) return <Frame stage="ASSESS" round={round} headline="Reading SAP: stock, orders, inbound POs…">{null}</Frame>;
  const atRisk = risk.orders.filter((o) => o.stockout_probability > 0);
  const customer = (so: string) => a.sales_orders.find((s) => s.SalesOrder === so)?.YY1_SoldToPartyName ?? so;
  const chip = delayChip(record.delay_prediction);

  return (
    <Frame
      stage="ASSESS"
      round={round}
      headline={
        <>
          <span className="text-risk-ink">{juta(risk.max_exposure)}</span> at risk on {atRisk.length} customer order
          {atRisk.length === 1 ? "" : "s"}
        </>
      }
    >
      <div className="flex h-full flex-col gap-3">
        {laneModel(record, { kind: "assess" }) && <LaneMap model={laneModel(record, { kind: "assess" })!} size="sm" />}
        <div className="grid grid-cols-2 gap-4" data-testid="orders-at-risk">
          {atRisk.slice(0, 2).map((o) => (
            // the order cards turn red as the risk function reports 100 %
            <motion.div
              key={o.order}
              className="rounded-[12px] px-6 py-2"
              initial={reduce ? false : { backgroundColor: "#ffffff", boxShadow: "inset 0 0 0 1px #d8d9d3" }}
              animate={{ backgroundColor: "#f8e1e4", boxShadow: "inset 0 0 0 2px #b00d28" }}
              transition={{ delay: reduce ? 0 : 0.6, duration: 0.6 }}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block truncate text-xl font-black">{customer(o.order)}</span>
                  <span className="block text-base">
                    {thousands(o.quantity)} ctn · {juta(o.penalty)} if missed
                  </span>
                </span>
                <span className="text-right text-stop-red">
                  <span className="block text-[2.25rem] leading-none font-black">
                    <CountUp value={o.stockout_probability} format={pct} duration={1.2} />
                  </span>
                  <span className="sign-label text-xs text-risk-ink">stockout</span>
                </span>
              </div>
            </motion.div>
          ))}
        </div>
        <p className="text-lg">
          Short <b>{thousands(risk.shortfall)} cartons</b>
          {risk.deadline && (
            <>
              {" "}by the loading cutoff <b>{dayShort(record.day0, risk.deadline)}</b>
            </>
          )}
        </p>
        {chip && (
          <span
            data-testid="delay-chip"
            className={cn(
              "self-start rounded-full px-3 py-1 text-base font-semibold whitespace-nowrap",
              chip.tone === "brand" && "bg-brand-soft text-brand-ink",
              chip.tone === "human" && "bg-human-soft text-human-ink",
              chip.tone === "muted" && "bg-surface-2 text-ink-2",
            )}
          >
            {chip.hours && <b className="text-lg">{chip.hours}</b>}
            {chip.hours && " · "}
            {chip.text}
          </span>
        )}
      </div>
    </Frame>
  );
}
