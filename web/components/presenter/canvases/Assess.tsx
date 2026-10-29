"use client";

import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { dayShort, juta, pct, thousands } from "@/lib/format";
import { delayChip } from "@/lib/present";
import { cn } from "@/lib/utils";
import type { CaseRecord } from "@/lib/types";
import { CountUp } from "../CountUp";

/** Assess's headline: what is at risk (or that SAP is being read). */
export function assessHead(record: CaseRecord): { headline: React.ReactNode } {
  const risk = record.risk;
  if (!risk || !record.affected) return { headline: "Reading SAP: stock, orders, inbound POs…" };
  const atRisk = risk.orders.filter((o) => o.stockout_probability > 0);
  return {
    headline: (
      <>
        <span className="text-risk-ink">{juta(risk.max_exposure)}</span> at risk on {atRisk.length} customer order
        {atRisk.length === 1 ? "" : "s"}
      </>
    ),
  };
}

/**
 * Under the map (it fades in and its blocked road draws first): the orders at risk, which
 * turn red as the risk function's 100 % counts up, then the one-line shortfall.
 */
export function AssessBody({ record }: { record: CaseRecord }) {
  const reduce = useReducedMotion();
  const risk = record.risk;
  const a = record.affected;
  if (!risk || !a) return null;
  const atRisk = risk.orders.filter((o) => o.stockout_probability > 0);
  const customer = (so: string) => a.sales_orders.find((s) => s.SalesOrder === so)?.YY1_SoldToPartyName ?? so;
  const chip = delayChip(record.delay_prediction);

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="grid grid-cols-2 gap-4" data-testid="orders-at-risk">
        {atRisk.slice(0, 2).map((o) => (
          <motion.div
            key={o.order}
            className="rounded-[12px] px-6 py-2"
            initial={reduce ? false : { backgroundColor: "#ffffff", boxShadow: "inset 0 0 0 1px #d8d9d3" }}
            animate={{ backgroundColor: "#f8e1e4", boxShadow: "inset 0 0 0 2px #b00d28" }}
            transition={{ delay: reduce ? 0 : 0.3, duration: reduce ? 0 : 0.6 }}
          >
            <div className="flex items-center justify-between gap-4">
              <span className="min-w-0">
                <span className="block truncate text-xl font-black">{customer(o.order)}</span>
                <span className="block text-base">
                  {thousands(o.quantity)} ctn · {juta(o.penalty)} if missed
                </span>
              </span>
              <span className="text-right text-stop-red">
                <span className="block text-3xl leading-none font-black">
                  <CountUp value={o.stockout_probability} format={pct} duration={0.9} />
                </span>
                <span className="sign-label text-xs text-risk-ink">stockout</span>
              </span>
            </div>
          </motion.div>
        ))}
      </div>
      <motion.div
        className="flex flex-wrap items-center gap-x-4 gap-y-2"
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduce ? 0 : 1.1, duration: reduce ? 0 : 0.32 }}
      >
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
              "rounded-full px-4 py-1 text-base font-semibold whitespace-nowrap",
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
      </motion.div>
    </div>
  );
}
