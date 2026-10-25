import { dayLabel, pct, rupiah, thousands } from "@/lib/format";
import type { CaseRecord } from "@/lib/types";
import { Empty, Panel, Stat } from "./ui";

export default function ImpactPanel({ record }: { record: CaseRecord | null }) {
  const risk = record?.risk;
  if (!record || !risk) {
    return (
      <Panel title="Impact" testId="impact">
        <Empty>Exposure appears once ASSESS has run.</Empty>
      </Panel>
    );
  }
  const sos = record.affected?.sales_orders ?? [];
  const name = (id: string) => sos.find((s) => s.SalesOrder === id)?.YY1_SoldToPartyName ?? "";
  return (
    <Panel title="Impact" testId="impact">
      <div className="mb-3 grid grid-cols-2 gap-3">
        <Stat
          label="Exposure at risk"
          value={<span data-testid="exposure" className="text-risk-ink">{rupiah(risk.max_exposure)}</span>}
          sub={`expected ${rupiah(risk.expected_exposure)}`}
        />
        {record.summary && (
          <>
            <Stat
              label="Plan cost"
              value={rupiah(record.summary.case_cost ?? record.summary.chosen_cost)}
              sub={
                record.summary.already_spent > 0
                  ? `option ${record.summary.chosen} + ${rupiah(record.summary.already_spent)} already executed`
                  : `option ${record.summary.chosen}`
              }
            />
            <Stat
              label="Protected (net)"
              value={<span className={record.status === "RESOLVED" ? "text-ok-ink" : ""}>{rupiah(record.summary.net_protected)}</span>}
              sub={record.status === "RESOLVED" ? "verified in SAP" : "once the plan is verified"}
            />
          </>
        )}
        <Stat
          label="Shortfall"
          value={`${thousands(risk.shortfall)} ctn`}
          sub={`by ${dayLabel(record.day0, risk.deadline)}`}
        />
      </div>
      <div className="text-xs font-medium uppercase tracking-wide text-ink-2">
        Customer orders · P(stockout)
      </div>
      <table className="mt-1 w-full text-sm">
        <tbody>
          {risk.orders.map((o) => (
            <tr key={o.order} className="border-t border-line">
              <td className="py-1 pr-2">
                <div className="font-medium">{o.order}</div>
                <div className="text-xs text-ink-2">{name(o.order)}</div>
              </td>
              <td className="whitespace-nowrap pr-2 text-right tabular-nums">{thousands(o.quantity)} ctn</td>
              <td className="whitespace-nowrap pr-2 text-right tabular-nums">{rupiah(o.penalty)}</td>
              <td className="text-right">
                <span
                  title="stockout probability"
                  className="whitespace-nowrap rounded bg-risk-soft px-1.5 py-0.5 text-xs font-semibold text-risk-ink"
                >
                  {pct(o.stockout_probability)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-2">Delayed inbound</div>
      {risk.inbound.map((i) => (
        <div key={i.ref} className="mt-1 text-sm">
          PO <b>{i.ref}</b> · {thousands(i.quantity)} ctn · now arrives{" "}
          {i.arrival_earliest === i.arrival_latest
            ? dayLabel(record.day0, i.arrival_latest)
            : `${dayLabel(record.day0, i.arrival_earliest)} – ${dayLabel(record.day0, i.arrival_latest)}`}
        </div>
      ))}
    </Panel>
  );
}
