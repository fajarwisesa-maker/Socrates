import { dayLabel } from "@/lib/format";
import type { CaseRecord, SolverResult } from "@/lib/types";
import { Badge, Empty, Panel, TierBadge } from "./ui";

function outcome(o: SolverResult, record: CaseRecord) {
  const finding = record.critic_findings.find((f) => f.option_id === o.option_id);
  const acts = record.actions.filter((a) => a.option_id === o.option_id);
  if (acts.some((a) => a.status === "REJECTED")) return <Badge tone="red">chosen · planner rejected</Badge>;
  if (acts.some((a) => a.status === "EXPIRED")) return <Badge tone="red">chosen · approved too late</Badge>;
  if (o.option_id === record.chosen_option) return <Badge tone="emerald">chosen</Badge>;
  if (o.result.status !== "optimal")
    return (
      <span title={o.result.infeasible_reason ?? ""}>
        <Badge tone="slate">infeasible</Badge>
      </span>
    );
  if (finding && !finding.clean) {
    const rules = finding.checks.filter((c) => !c.passed).map((c) => c.rule);
    return <Badge tone="red">rejected: {rules.join(", ")}</Badge>;
  }
  return <Badge tone="slate">not chosen</Badge>;
}

export default function OptionsTable({ record }: { record: CaseRecord | null }) {
  if (!record || !record.solver_results.length) {
    return (
      <Panel title="Options comparison" testId="options">
        <Empty>Options appear after SIMULATE. Every price comes from the solver.</Empty>
      </Panel>
    );
  }
  const rows = record.solver_results;
  return (
    <Panel
      title="Options comparison"
      testId="options"
      right={
        record.summary?.saving_display &&
        (record.summary.saving_vs_baseline ?? 0) > 0 && (
          <span className="text-xs text-slate-600">
            saving vs {record.summary.baseline}: <b className="text-emerald-700">{record.summary.saving_display}</b>
          </span>
        )
      }
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
            <th className="pb-1 pr-3">Option</th>
            <th className="pb-1 pr-3">Plan</th>
            <th className="pb-1 pr-3 text-right">Cost</th>
            <th className="pb-1 pr-3">Latest ETA</th>
            <th className="pb-1 pr-3">Max tier</th>
            <th className="pb-1">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const etas = o.result.actions.map((a) => a.eta).filter(Boolean) as string[];
            const latest = etas.sort().at(-1) ?? null;
            const tiers = record.critic_findings.find((f) => f.option_id === o.option_id)?.tiers ?? [];
            const maxTier = tiers.length ? Math.max(...tiers.map((t) => t.tier)) : null;
            const chosen = o.option_id === record.chosen_option;
            return (
              <tr
                key={o.option_id}
                data-testid={`option-${o.option_id}`}
                className={`border-t border-slate-100 align-top ${chosen ? "bg-emerald-50/60" : ""}`}
              >
                <td className="py-1.5 pr-3 font-semibold">
                  {o.option_id}
                  {o.round > 1 && <div className="text-[10px] font-normal text-slate-500">replan</div>}
                </td>
                <td className="pr-3">
                  <div>{o.label}</div>
                  <div className="text-xs text-slate-500">
                    {o.result.actions
                      .map((a) => `${a.kind.replace("_", " ")} ${a.reference} ${a.quantity}`)
                      .join(" · ")}
                  </div>
                  {o.constraints.length > 0 && (
                    <div className="text-[11px] text-violet-700">
                      + {o.constraints.map((c) => c.type + (c.supplier ? ` ${c.supplier}` : "")).join(", ")}
                    </div>
                  )}
                </td>
                <td
                  className="whitespace-nowrap pr-3 text-right font-semibold tabular-nums"
                  title={o.result.infeasible_reason ?? undefined}
                >
                  {o.result.status === "optimal" ? o.total_cost_display : "—"}
                </td>
                <td className="pr-3 text-xs text-slate-600">{dayLabel(record.day0, latest)}</td>
                <td className="pr-3">{maxTier !== null && <TierBadge tier={maxTier} />}</td>
                <td>{outcome(o, record)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Panel>
  );
}
