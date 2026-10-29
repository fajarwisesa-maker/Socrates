import { dayLabel } from "@/lib/format";
import { actionLine, supplierName } from "@/lib/present";
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
    const failed = finding.checks.filter((c) => !c.passed);
    return (
      <span className="flex flex-col items-start gap-1">
        <span className="whitespace-normal">
          <Badge tone="red">rejected: {failed.map((c) => c.rule.replaceAll("_", " ")).join(", ")}</Badge>
        </span>
        <span className="text-xs text-risk-ink">{failed.map((c) => c.plain || c.detail).join("; ")}</span>
      </span>
    );
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
          <span className="text-xs text-ink-2">
            saving vs {record.summary.baseline}: <b className="text-ok-ink">{record.summary.saving_display}</b>
          </span>
        )
      }
    >
      <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] table-fixed text-sm break-words">
        <colgroup>
          <col className="w-[9%]" />
          <col className="w-[27%]" />
          <col className="w-[16%]" />
          <col className="w-[14%]" />
          <col className="w-[14%]" />
          <col className="w-[20%]" />
        </colgroup>
        <thead>
          <tr className="text-left text-xs tracking-wide whitespace-nowrap text-ink-2 uppercase">
            <th className="pr-3 pb-1">Option</th>
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
                className={`border-t border-line align-top ${chosen ? "bg-ok-soft" : ""}`}
              >
                <td className="py-1.5 pr-3 font-semibold">
                  {o.option_id}
                  {o.round > 1 && <div className="text-xs font-normal text-ink-2">replan</div>}
                </td>
                <td className="pr-3">
                  <div>{o.label}</div>
                  <div className="text-xs text-ink-2">
                    {o.result.actions.map((a) => actionLine(a, record.affected?.labels)).join(" · ")}
                  </div>
                  {o.constraints.length > 0 && (
                    <div className="text-xs text-ink-2">
                      {o.constraints
                        .map((c) =>
                          c.type === "safety_stock"
                            ? "safety stock as a rule"
                            : c.type === "exclude_supplier" && c.supplier
                              ? `without ${supplierName(record.affected?.labels, c.supplier)}`
                              : c.type,
                        )
                        .join(", ")}
                    </div>
                  )}
                </td>
                <td
                  className="whitespace-nowrap pr-3 text-right font-semibold tabular-nums"
                  title={o.result.infeasible_reason ?? undefined}
                >
                  {o.result.status === "optimal" ? o.total_cost_display : "infeasible"}
                </td>
                <td className="pr-3 text-xs text-ink-2">{dayLabel(record.day0, latest)}</td>
                <td className="pr-3">{maxTier !== null && <TierBadge tier={maxTier} />}</td>
                <td>{outcome(o, record)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
      <p className="mt-2 text-xs text-ink-2">Prices, quantities and ETAs from the solver (PuLP/CBC), not the model.</p>
    </Panel>
  );
}
