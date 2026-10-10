import { dayShort, juta, pct, thousands } from "@/lib/format";
import { plantName } from "@/lib/present";
import type { CaseRecord } from "@/lib/types";
import { LaneMap } from "../LaneMap";
import { Frame } from "./Frame";

export function AssessCanvas({ record, round }: { record: CaseRecord; round: number }) {
  const risk = record.risk;
  const a = record.affected;
  if (!risk || !a) return <Frame stage="ASSESS" round={round} headline="Reading SAP: stock, orders, inbound POs…">{null}</Frame>;
  const labels = a.labels;
  const atRisk = risk.orders.filter((o) => o.stockout_probability > 0);
  const po = a.purchase_orders[0];
  const lane = labels?.lanes?.[po?.YY1_TransportLane ?? record.disruption?.lane ?? ""];
  const blockedAt = record.disruption?.location?.split(",").at(-1)?.trim().replace("-", "–") ?? null;
  const customer = (so: string) => a.sales_orders.find((s) => s.SalesOrder === so)?.YY1_SoldToPartyName ?? so;

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
      <div className="flex h-full flex-col gap-5">
        <LaneMap
          origin={lane?.from ?? "Supplier"}
          blockedAt={blockedAt}
          dest={plantName(labels, a.plant)}
          stuck={po ? `PO ${po.PurchaseOrder} stuck · ${thousands(po.items[0]?.OrderQuantity)} ctn` : undefined}
        />
        <div className="grid grid-cols-2 gap-4" data-testid="orders-at-risk">
          {atRisk.slice(0, 2).map((o) => (
            <div key={o.order} className="rounded-[var(--radius-card)] border-2 border-risk bg-risk-soft px-4 py-3">
              <div className="text-xl font-semibold text-ink">{customer(o.order)}</div>
              <div className="mt-1 flex items-end justify-between gap-2">
                <span className="text-xl text-ink-2">
                  {thousands(o.quantity)} ctn
                  <br />
                  {juta(o.penalty)} penalty
                </span>
                <span className="text-right">
                  <span className="block text-[2.5rem] leading-none font-bold text-risk-ink">{pct(o.stockout_probability)}</span>
                  <span className="text-lg text-risk-ink">stockout risk</span>
                </span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xl text-ink-2">
          Short <b className="text-ink">{thousands(risk.shortfall)} cartons</b>
          {risk.deadline && (
            <>
              {" "}by the loading cutoff <b className="text-ink">{dayShort(record.day0, risk.deadline)}</b>
            </>
          )}
        </p>
      </div>
    </Frame>
  );
}
