"use client";

// Impact (mockup "Analisis Dampak"): what the disruption puts at risk, as a cascade from the
// blocked lane to the inbound PO, the DC's stock and the customer orders with their
// penalties. Every number comes from SAP (via assess_impact) and the risk function.
import { AlertTriangle, Boxes, CalendarClock, FileText, Map as MapIcon, Percent, Timer, Truck, Warehouse, Waypoints, Users } from "lucide-react";
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
import { Chip, Kpi, Note, PageHeader, Panel, RowItem, Rows } from "../ui";
import type { CasePageProps } from "./types";

const PENALTY: Record<string, string> = { OTIF_PENALTY: "OTIF penalty", LOST_MARGIN: "Lost margin" };

export function Impact({ record, events }: CasePageProps) {
  const a = record.affected;
  const risk = record.risk;
  const exposure = useCountUp(risk?.max_exposure ?? null, juta, { id: `impact-${record.case_id}-exposure` });
  if (!a || !risk) {
    return (
      <div className="flex flex-col gap-6" data-testid="page-impact">
        <PageHeader title="Impact" description="Reading SAP: stock, orders, inbound POs." />
      </div>
    );
  }
  const atRisk = risk.orders.filter((o) => o.stockout_probability > 0);
  const maxP = Math.max(0, ...risk.orders.map((o) => o.stockout_probability));
  const note = events.find((e) => e.stage === "ASSESS" && e.status === "completed")?.data.impact_note as string | undefined;
  const agent = events.find((e) => e.stage === "ASSESS" && e.status === "started")?.agent ?? undefined;
  const model = laneModel(record, { kind: "assess" });
  const extras = [record.delay_prediction ? "delay" : null, note ? "note" : null].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-6" data-testid="page-impact">
      <Reveal>
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
      </Reveal>

      {/* five in one row from xl; 2 + 2 + 1 (the last spans two) below */}
      <Reveal delay={50} className="flex flex-col gap-2">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi
            compact
            label="Penalty exposure"
            tone="risk"
            icon={<AlertTriangle aria-hidden />}
            value={<Figure shown={exposure ?? juta(risk.max_exposure)} final={juta(risk.max_exposure)} />}
            note={
              <>
                <span data-testid="exposure" className="font-mono text-xs">
                  {rupiah(risk.max_exposure)}
                </span>
                {risk.expected_exposure !== risk.max_exposure && ` · expected ${juta(risk.expected_exposure)}`}
              </>
            }
            testId="kpi-exposure"
          />
          <Kpi compact label="Orders at risk" tone={atRisk.length ? "risk" : "neutral"} icon={<Users aria-hidden />} value={`${atRisk.length} of ${risk.orders.length}`} note="Loading at the DC" />
          <Kpi compact label="Shortfall" tone={risk.shortfall ? "needs" : "ok"} icon={<Boxes aria-hidden />} value={`${thousands(risk.shortfall)} ctn`} note={`${thousands(risk.usable_stock)} usable of ${thousands(risk.demand)}`} />
          <Kpi compact label="Stockout chance" tone={maxP > 0 ? "risk" : "ok"} icon={<Percent aria-hidden />} value={pct(maxP)} note="Highest of the orders" />
          <Kpi
            compact
            className="sm:col-span-2 xl:col-span-1"
            label="Loading cutoff"
            tone="info"
            icon={<CalendarClock aria-hidden />}
            value={risk.deadline ? dayShort(record.day0, risk.deadline).replace(" WIB", "").split(" · ")[0] : "None"}
            note={risk.deadline ? "WIB, every order at the DC" : undefined}
          />
        </div>
        <SolverLabel>Calculated by SIAGA&apos;s risk function from SAP data, not AI</SolverLabel>
      </Reveal>

      <Reveal delay={100}>
        <Panel title="How the disruption reaches the customer" icon={<Waypoints aria-hidden />} tone="risk" description="Each step is read from SAP or computed by the risk function" testId="cascade">
          <Cascade record={record} />
        </Panel>
      </Reveal>

      <Reveal delay={150} className="grid gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <Panel title="Where the lane is blocked" icon={<MapIcon aria-hidden />} tone="risk" description={model?.title}>
            {model && <LaneMap model={model} />}
          </Panel>
        </div>
        <div className="min-w-0 xl:col-span-4">
          <Panel
            title="Orders loading at the DC"
            icon={<Users aria-hidden />}
            tone="needs"
            testId="orders-table"
            footer={
              <Note chip="Coming later">
                Stock depletion over time needs a consumption forecast per DC, which the seed data does not hold yet.
              </Note>
            }
          >
            <OrderRows record={record} />
          </Panel>
        </div>
      </Reveal>

      {extras > 0 && (
        <Reveal delay={200} className="grid gap-6 lg:grid-cols-12">
          {record.delay_prediction && (
            <div className={cn("min-w-0", extras > 1 ? "lg:col-span-6" : "lg:col-span-12")}>
              <DelayDetails p={record.delay_prediction} />
            </div>
          )}
          {note && (
            <div className={cn("min-w-0", extras > 1 ? "lg:col-span-6" : "lg:col-span-12")}>
              <Panel title="Impact note" icon={<FileText aria-hidden />} tone="info" testId="impact-note" footer={<AgentWritten by={agent} />}>
                <p className="text-base">{note}</p>
              </Panel>
            </div>
          )}
        </Reveal>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ cascade

/** One column of the cascade: a numbered tone chip, facts, a footer pinned to the bottom. */
function Step({
  n,
  title,
  tone,
  icon,
  children,
  total,
  className,
}: {
  n: number;
  title: string;
  tone: "risk" | "needs";
  icon: React.ReactNode;
  children: React.ReactNode;
  total?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2">
        <Chip tone={tone}>
          {n} · {title}
        </Chip>
        <span className="text-ink-2 [&_svg]:size-4">{icon}</span>
      </div>
      <div className="flex flex-col gap-2 text-sm">{children}</div>
      {total && <div className="mt-auto border-t border-divider pt-2 text-sm font-bold">{total}</div>}
    </div>
  );
}

/** Columns divided by hairlines: four in a row from xl, two by two below. */
const COL = [
  "",
  "max-md:border-t max-md:border-divider max-md:pt-6 md:border-l md:border-divider md:pl-6",
  "max-md:border-t max-md:border-divider max-md:pt-6 md:border-t md:border-divider md:pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6",
  "max-md:border-t max-md:border-divider max-md:pt-6 md:border-t md:border-l md:border-divider md:pt-6 md:pl-6 xl:border-t-0 xl:pt-0",
];

function Cascade({ record }: { record: CaseRecord }) {
  const d = record.disruption;
  const a = record.affected!;
  const risk = record.risk!;
  const labels = a.labels;
  const so = (id: string) => a.sales_orders.find((s) => s.SalesOrder === id);
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-4">
      <Step className={COL[0]} n={1} title="Blocked lane" tone="risk" icon={<AlertTriangle aria-hidden />} total={d ? `Delay ${delay(d.delay_hours_min, d.delay_hours_max)}` : undefined}>
        <p className="text-base font-black">{d ? (CAUSE[d.cause] ?? d.cause) : "Disruption"}</p>
        <p>{d?.location ?? "Location unknown"}</p>
        {laneCode(record) && <p className="font-mono text-xs text-ink-2">Lane {laneCode(record)}</p>}
      </Step>
      <Step className={COL[1]} n={2} title="Inbound PO late" tone="risk" icon={<Truck aria-hidden />} total={`${thousands(risk.inbound.reduce((s, i) => s + i.quantity, 0))} ctn late`}>
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
      <Step className={COL[2]} n={3} title="DC stock short" tone="needs" icon={<Warehouse aria-hidden />} total={`Short ${thousands(risk.shortfall)} ctn`}>
        <p className="text-base font-black">{plantName(labels, a.plant)}</p>
        <p data-testid="stock-line">
          {thousands(a.stock.OnHandQuantity)} on hand, {thousands(a.stock.SafetyStockQuantity)} of them safety stock: {thousands(risk.usable_stock)} usable
          against {thousands(risk.demand)} needed.
        </p>
      </Step>
      <Step className={COL[3]} n={4} title="Orders and penalties" tone="risk" icon={<Users aria-hidden />} total={`At risk ${juta(risk.max_exposure)}`}>
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
    </div>
  );
}

// ------------------------------------------------------------------ orders, delay

/** The orders loading at the DC, one row each (the table they replace was 6 columns wide). */
function OrderRows({ record }: { record: CaseRecord }) {
  const a = record.affected!;
  const risk = record.risk!;
  const so = (id: string) => a.sales_orders.find((s) => s.SalesOrder === id);
  return (
    <Rows label="Orders">
      {risk.orders.map((o) => {
        const s = so(o.order);
        return (
          <RowItem key={o.order} className="flex-col gap-1 text-sm">
            <span className="flex w-full items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block font-bold">{s?.YY1_SoldToPartyName ?? o.order}</span>
                <span className="block font-mono text-xs text-ink-2">
                  {o.order}
                  {s?.YY1_Channel ? ` · ${s.YY1_Channel.toLowerCase()}` : ""}
                </span>
              </span>
              <Chip tone={o.stockout_probability > 0 ? "risk" : "ok"}>{pct(o.stockout_probability)} stockout</Chip>
            </span>
            <span className="flex w-full items-baseline justify-between gap-2">
              <span className="text-ink-2">
                {thousands(o.quantity)} ctn · cutoff {dayShort(record.day0, o.cutoff)}
              </span>
              <b className="whitespace-nowrap text-chip-risk-fg">
                {PENALTY[s?.YY1_PenaltyType ?? ""] ?? "Penalty"} {juta(o.penalty)}
              </b>
            </span>
          </RowItem>
        );
      })}
    </Rows>
  );
}

function DelayDetails({ p }: { p: DelayPrediction }) {
  const [lo, hi] = p.signal_range_hours;
  const used = p.delay_for_risk_hours;
  return (
    <Panel
      title="Delay used for the risk"
      icon={<Timer aria-hidden />}
      tone="info"
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
