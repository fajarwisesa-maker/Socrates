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
      <div className="mb-3 grid grid-cols-1 gap-3">
        <Stat
          label="Exposure at risk"
          value={<span data-testid="exposure" className="text-red-700">{rupiah(risk.max_exposure)}</span>}
          sub={`expected ${rupiah(risk.expected_exposure)}`}
        />
        <Stat
          label="Shortfall"
          value={`${thousands(risk.shortfall)} ctn`}
          sub={`by ${dayLabel(record.day0, risk.deadline)}`}
        />
      </div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
        Customer orders · P(stockout)
      </div>
      <table className="mt-1 w-full text-sm">
        <tbody>
          {risk.orders.map((o) => (
            <tr key={o.order} className="border-t border-slate-100">
              <td className="py-1 pr-2">
                <div className="font-medium">{o.order}</div>
                <div className="text-xs text-slate-500">{name(o.order)}</div>
              </td>
              <td className="whitespace-nowrap pr-2 text-right tabular-nums">{thousands(o.quantity)} ctn</td>
              <td className="whitespace-nowrap pr-2 text-right tabular-nums">{rupiah(o.penalty)}</td>
              <td className="text-right">
                <span
                  title="stockout probability"
                  className="whitespace-nowrap rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-700"
                >
                  {pct(o.stockout_probability)}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 text-xs font-medium uppercase tracking-wide text-slate-500">Delayed inbound</div>
      {risk.inbound.map((i) => (
        <div key={i.ref} className="mt-1 text-sm">
          PO <b>{i.ref}</b> · {thousands(i.quantity)} ctn · now arrives{" "}
          {dayLabel(record.day0, i.arrival_earliest)} – {dayLabel(record.day0, i.arrival_latest)}
        </div>
      ))}
    </Panel>
  );
}
