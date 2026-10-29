"use client";

// Impact (mockup "Analisis Dampak"): what the disruption puts at risk, as a cascade from the
// blocked lane to the inbound PO, the DC's stock and the customer orders with their
// penalties. Every number comes from SAP (via assess_impact) and the risk function.
import { AlertTriangle, Boxes, CalendarClock, Map as MapIcon, Percent, Truck, Warehouse, Waypoints, Users } from "lucide-react";
import { Figure } from "@/components/Figure";
import { LaneMap } from "@/components/LaneMap";
import { Reveal } from "@/components/Reveal";
import { AgentWritten, SolverLabel } from "@/components/signs";
import { laneCode } from "@/lib/caseView";
import { dayShort, juta, pct, rupiah, thousands } from "@/lib/format";
import { laneModel } from "@/lib/laneModel";
import { useCountUp } from "@/lib/motion";
import { CAUSE, delay, plantName, supplierName } from "@/lib/present";
import type { CaseRecord, DelayPrediction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CARD } from "../../signs";
import { Chip, ComingLater, Kpi, PageHeader, Panel } from "../ui";
import type { CasePageProps } from "./types";

const PENALTY: Record<string, string> = { OTIF_PENALTY: "OTIF penalty", LOST_MARGIN: "Lost margin" };

export function Impact({ record, events }: CasePageProps) {
  const a = record.affected;
  const risk = record.risk;
  const exposure = useCountUp(risk?.max_exposure ?? null, juta, { id: `impact-${record.case_id}-exposure` });
  if (!a || !risk) {
    return (
      <div className="flex flex-col gap-8" data-testid="page-impact">
        <PageHeader title="Impact" description="Reading SAP: stock, orders, inbound POs." />
      </div>
    );
  }
  const atRisk = risk.orders.filter((o) => o.stockout_probability > 0);
  const maxP = Math.max(0, ...risk.orders.map((o) => o.stockout_probability));
  const note = events.find((e) => e.stage === "ASSESS" && e.status === "completed")?.data.impact_note as string | undefined;
  const agent = events.find((e) => e.stage === "ASSESS" && e.status === "started")?.agent ?? undefined;
  const model = laneModel(record, { kind: "assess" });

  return (
    <div className="flex flex-col gap-8" data-testid="page-impact">
      <PageHeader
        chips={
          <>
            <Chip tone="risk" icon={<AlertTriangle aria-hidden />}>
              {atRisk.length} order{atRisk.length === 1 ? "" : "s"} at risk
            </Chip>
            {laneCode(record) && <Chip tone="muted">Lane {laneCode(record)}</Chip>}
          </>
        }
        title="Impact"
        description="From the blocked lane to the customer orders: what misses the loading cutoff if nothing is done."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
        <Reveal className="sm:col-span-2 lg:col-span-1">
          <Kpi
            label="Penalty exposure"
            tone="risk"
            icon={<AlertTriangle aria-hidden />}
            value={<Figure shown={exposure ?? juta(risk.max_exposure)} final={juta(risk.max_exposure)} />}
            note={
              <>
                <span data-testid="exposure">{rupiah(risk.max_exposure)}</span>
                {risk.expected_exposure !== risk.max_exposure && ` · expected ${juta(risk.expected_exposure)}`}
              </>
            }
            testId="kpi-exposure"
          />
        </Reveal>
        <Reveal delay={70}>
          <Kpi label="Orders at risk" icon={<Users aria-hidden />} value={`${atRisk.length} of ${risk.orders.length}`} note="Customer orders loading at the DC" />
        </Reveal>
        <Reveal delay={140}>
          <Kpi label="Shortfall" icon={<Boxes aria-hidden />} value={`${thousands(risk.shortfall)} ctn`} note={`${thousands(risk.usable_stock)} usable of ${thousands(risk.demand)}`} />
        </Reveal>
        <Reveal delay={210}>
          <Kpi label="Stockout chance" tone={maxP > 0 ? "risk" : "ink"} icon={<Percent aria-hidden />} value={pct(maxP)} note="Highest of the orders" />
        </Reveal>
        <Reveal delay={280}>
          <Kpi
            label="Loading cutoff"
            icon={<CalendarClock aria-hidden />}
            value={risk.deadline ? dayShort(record.day0, risk.deadline).replace(" WIB", "").split(" · ")[0] : "None"}
            note={risk.deadline ? dayShort(record.day0, risk.deadline).split(" · ")[1] : undefined}
          />
        </Reveal>
      </div>
      <SolverLabel className="-mt-4">Calculated by SIAGA&apos;s risk function from SAP data, not AI</SolverLabel>

      <Panel title="How the disruption reaches the customer" icon={<Waypoints aria-hidden />} description="Each step is read from SAP or computed by the risk function" testId="cascade">
        <Cascade record={record} />
      </Panel>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Where the lane is blocked" icon={<MapIcon aria-hidden />} description={model?.title}>
          {model && <LaneMap model={model} />}
        </Panel>
        <div className="flex flex-col gap-8">
          {record.delay_prediction && <DelayDetails p={record.delay_prediction} />}
          {note && (
            <Panel title="Impact note" testId="impact-note">
              <p className="text-base">{note}</p>
              <AgentWritten by={agent} />
            </Panel>
          )}
          <ComingLater title="Stock depletion over time">
            A day-by-day stock curve needs a consumption forecast per DC, which the seed data does not hold yet.
          </ComingLater>
        </div>
      </div>

      <Panel title="Orders loading at the DC" icon={<Users aria-hidden />} testId="orders-table">
        <OrdersTable record={record} />
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ cascade

function Step({ n, title, tone, icon, children, total }: { n: number; title: string; tone: "risk" | "needs"; icon: React.ReactNode; children: React.ReactNode; total?: React.ReactNode }) {
  return (
    <div className={cn(CARD, "flex min-w-0 flex-col gap-2 bg-surface p-4")}>
      <div className="flex items-center justify-between gap-2">
        <Chip tone={tone}>
          {n} · {title}
        </Chip>
        <span className="text-ink-2 [&_svg]:size-4">{icon}</span>
      </div>
      <div className="flex flex-1 flex-col gap-2 text-sm">{children}</div>
      {total && <div className="border-t border-divider pt-2 text-sm font-bold">{total}</div>}
    </div>
  );
}

function Cascade({ record }: { record: CaseRecord }) {
  const d = record.disruption;
  const a = record.affected!;
  const risk = record.risk!;
  const labels = a.labels;
  const so = (id: string) => a.sales_orders.find((s) => s.SalesOrder === id);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Reveal>
        <Step n={1} title="Blocked lane" tone="risk" icon={<AlertTriangle aria-hidden />} total={d ? `Delay ${delay(d.delay_hours_min, d.delay_hours_max)}` : undefined}>
          <p className="text-base font-black">{d ? (CAUSE[d.cause] ?? d.cause) : "Disruption"}</p>
          <p>{d?.location ?? "Location unknown"}</p>
          {laneCode(record) && <p className="font-mono text-xs text-ink-2">Lane {laneCode(record)}</p>}
        </Step>
      </Reveal>
      <Reveal delay={70}>
        <Step n={2} title="Inbound PO late" tone="risk" icon={<Truck aria-hidden />} total={`${thousands(risk.inbound.reduce((s, i) => s + i.quantity, 0))} ctn late`}>
          {risk.inbound.map((i) => (
            <div key={i.ref} className="flex flex-col gap-1">
              <p className="font-mono font-black">PO {i.ref}</p>
              <p>
                {thousands(i.quantity)} ctn from {supplierName(labels, a.purchase_orders.find((p) => p.PurchaseOrder === i.ref)?.Supplier ?? "")}
              </p>
              <p className="text-ink-2">
                Now arrives{" "}
                {i.arrival_earliest === i.arrival_latest
                  ? dayShort(record.day0, i.arrival_latest)
                  : `${dayShort(record.day0, i.arrival_earliest).replace(" WIB", "")} to ${dayShort(record.day0, i.arrival_latest)}`}
              </p>
            </div>
          ))}
        </Step>
      </Reveal>
      <Reveal delay={140}>
        <Step n={3} title="DC stock short" tone="needs" icon={<Warehouse aria-hidden />} total={`Short ${thousands(risk.shortfall)} ctn`}>
          <p className="text-base font-black">{plantName(labels, a.plant)}</p>
          <p data-testid="stock-line">
            {thousands(a.stock.OnHandQuantity)} on hand, {thousands(a.stock.SafetyStockQuantity)} of them safety stock: {thousands(risk.usable_stock)} usable
            against {thousands(risk.demand)} needed.
          </p>
        </Step>
      </Reveal>
      <Reveal delay={210}>
        <Step n={4} title="Orders and penalties" tone="risk" icon={<Users aria-hidden />} total={`At risk ${juta(risk.max_exposure)}`}>
          {risk.orders.map((o) => (
            <div key={o.order} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-bold">{so(o.order)?.YY1_SoldToPartyName ?? o.order}</span>
                <span className="block text-xs text-ink-2">
                  {thousands(o.quantity)} ctn · {pct(o.stockout_probability)} stockout
                </span>
              </span>
              <span className="font-bold whitespace-nowrap text-chip-risk-fg">{juta(o.penalty)}</span>
            </div>
          ))}
        </Step>
      </Reveal>
    </div>
  );
}

// ------------------------------------------------------------------ orders, delay

function OrdersTable({ record }: { record: CaseRecord }) {
  const a = record.affected!;
  const risk = record.risk!;
  const so = (id: string) => a.sales_orders.find((s) => s.SalesOrder === id);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-divider text-left text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">
            <th className="py-2 pr-4">Order</th>
            <th className="py-2 pr-4">Customer</th>
            <th className="py-2 pr-4 text-right">Cartons</th>
            <th className="py-2 pr-4">Loading cutoff</th>
            <th className="py-2 pr-4 text-right">Stockout chance</th>
            <th className="py-2 text-right">If missed</th>
          </tr>
        </thead>
        <tbody>
          {risk.orders.map((o) => (
            <tr key={o.order} className="border-b border-divider last:border-0">
              <td className="py-2 pr-4 font-mono font-bold">{o.order}</td>
              <td className="py-2 pr-4">
                {so(o.order)?.YY1_SoldToPartyName ?? o.order}
                {so(o.order)?.YY1_Channel && <span className="text-ink-2"> ({so(o.order)!.YY1_Channel!.toLowerCase()})</span>}
              </td>
              <td className="py-2 pr-4 text-right font-mono">{thousands(o.quantity)}</td>
              <td className="py-2 pr-4">{dayShort(record.day0, o.cutoff)}</td>
              <td className="py-2 pr-4 text-right">
                <Chip tone={o.stockout_probability > 0 ? "risk" : "ok"}>{pct(o.stockout_probability)}</Chip>
              </td>
              <td className="py-2 text-right font-bold whitespace-nowrap text-chip-risk-fg">
                {PENALTY[so(o.order)?.YY1_PenaltyType ?? ""] ?? "Penalty"} {juta(o.penalty)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DelayDetails({ p }: { p: DelayPrediction }) {
  const [lo, hi] = p.signal_range_hours;
  const used = p.delay_for_risk_hours;
  return (
    <Panel
      title="Delay used for the risk"
      testId="delay-details"
      description={`${p.provider === "fake" ? "Offline stand-in, not SAP RPT-1.6" : "SAP RPT-1.6 on SAP AI Core"} · ${p.history_rows ?? 0} past disruptions (synthetic history)`}
    >
      {p.status === "ok" ? (
        <p className="text-base">
          Predicted <b>{p.predicted_hours} h</b>
          {p.interval_hours && ` (interval ${p.interval_hours[0]} to ${p.interval_hours[1]} h)`}; signal {lo} to {hi} h, so{" "}
          <b>
            risk uses {used[0]} h{p.disagree ? ` (clamped: ${p.flag})` : ""}
          </b>
          .
        </p>
      ) : (
        <p className="text-base text-ink-2">
          Prediction unavailable ({p.reason ?? "no answer"}). Risk uses the signal range {lo} to {hi} h.
        </p>
      )}
    </Panel>
  );
}
