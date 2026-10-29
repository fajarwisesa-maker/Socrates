"use client";

// Response options (mockup "Pengoptimal Respon"): what the agent proposed, what the solver
// priced, what the Critic rejected and why, and the saving of the chosen plan. Prices,
// quantities and arrivals come from the solver (PuLP / CBC); the model writes strategies and
// rationale only, labelled.
import { BookOpen, Check, Cpu, Lightbulb, Route, ShieldCheck, Sparkles, X } from "lucide-react";
import { SearchQuery, StrategyPlate } from "@/components/plan";
import { Reveal } from "@/components/Reveal";
import { AgentWritten, SolverLabel, TierPlate } from "@/components/signs";
import { dayShort, juta, thousands } from "@/lib/format";
import { precedentHits, precedentQuery, replanReason } from "@/lib/planView";
import { actionLine, period, solverLabel, supplierName } from "@/lib/present";
import type { CaseRecord, SolverResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CARD } from "../../signs";
import { Chip, type ChipTone, Kpi, PageHeader, Panel, RowItem, Rows } from "../ui";
import type { CasePageProps } from "./types";

/** What happened to an option, in words (the e2e tests read these). */
export function outcome(id: string, record: CaseRecord): { text: string; tone: ChipTone } {
  const o = record.solver_results.find((x) => x.option_id === id)!;
  const f = record.critic_findings.find((x) => x.option_id === id);
  const acts = record.actions.filter((a) => a.option_id === id);
  if (acts.some((a) => a.status === "REJECTED")) return { text: "chosen · planner rejected", tone: "risk" };
  if (acts.some((a) => a.status === "EXPIRED")) return { text: "chosen · approved too late", tone: "risk" };
  if (id === record.chosen_option) return { text: "chosen", tone: "ok" };
  if (o.result.status !== "optimal") return { text: "infeasible", tone: "muted" };
  if (f && !f.clean) return { text: `rejected: ${f.checks.filter((c) => !c.passed).map((c) => c.rule.replaceAll("_", " ")).join(", ")}`, tone: "risk" };
  return { text: "not chosen", tone: "muted" };
}

export function Options({ record, events }: CasePageProps) {
  const s = record.summary;
  const baseline = s?.baseline ? record.solver_results.find((o) => o.option_id === s.baseline) : null;
  const rounds = [...new Set(record.solver_results.map((o) => o.round))];
  const candidateRounds = [...new Set(record.candidates.map((c) => c.round))];
  const hits = precedentHits(events);
  const query = precedentQuery(events);
  const strategies = [...new Set(record.candidates.flatMap((c) => c.strategies))];
  const latest = record.solver_results.filter((o) => o.round === Math.max(0, ...rounds));
  const constraints = latest[0]?.constraints ?? [];
  const chosenLabel = record.solver_results.find((o) => o.option_id === record.chosen_option)?.label;

  if (!record.candidates.length) {
    return (
      <div className="flex flex-col gap-6" data-testid="page-options">
        <PageHeader title="Response options" description="The agent is choosing strategies." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="page-options">
      <Reveal>
        <PageHeader
          chips={
            <>
              {record.replan_count > 0 && <Chip tone="needs">{record.replan_count} replan{record.replan_count > 1 ? "s" : ""}</Chip>}
              <Chip tone="muted" icon={<Cpu aria-hidden />}>
                Solver: PuLP / CBC
              </Chip>
            </>
          }
          title="Response options"
          description="The agent picks strategies; the solver prices each one; the Critic checks the business rules; SIAGA takes the cheapest clean plan."
        />
      </Reveal>

      {s && (
        <Reveal delay={50} className="flex flex-col gap-2" testId="saving-banner">
          <div className="grid gap-4 sm:grid-cols-3">
            <Kpi label="Chosen plan" tone="ok" icon={<Sparkles aria-hidden />} value={juta(s.case_cost ?? s.chosen_cost)} note={chosenLabel} />
            {s.saving_vs_baseline && s.saving_vs_baseline > 0 && baseline ? (
              <Kpi
                label="Saving"
                tone="ok"
                icon={<Route aria-hidden />}
                value={juta(s.saving_vs_baseline)}
                note={`Cheaper than ${baseline.label.toLowerCase()} (${juta(baseline.result.total_cost)})`}
              />
            ) : (
              <Kpi label="Saving" tone="neutral" icon={<Route aria-hidden />} value="None" note="No cheaper clean baseline to compare with" />
            )}
            <Kpi label="Protects" tone="ok" icon={<ShieldCheck aria-hidden />} value={juta(s.exposure_avoided)} note={`Of penalties · net ${juta(s.net_protected)}`} />
          </div>
          <SolverLabel>{solverLabel(events)}</SolverLabel>
        </Reveal>
      )}

      {rounds.map((r, k) => (
        <Reveal key={r} delay={Math.min(2 + k, 4) * 50} as="section" className="flex flex-col gap-4" testId={`options-round-${r}`}>
          <h2 className="text-lg font-black">{r === 1 ? "Priced options" : `Priced options after replan ${r - 1}`}</h2>
          <div className="grid gap-6 lg:grid-cols-2">
            {record.solver_results
              .filter((o) => o.round === r)
              .map((o) => (
                <OptionCard key={o.option_id} option={o} record={record} />
              ))}
          </div>
        </Reveal>
      ))}

      <Reveal delay={200} className="grid gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <Panel title="How the agent planned" icon={<Lightbulb aria-hidden />} tone="info" description="Strategies only: the agent sets no quantities or prices" testId="plan-rounds">
            {candidateRounds.map((r) => {
              const reason = r > 1 ? replanReason(record, events, r) : null;
              return (
                <div key={r} className="flex flex-col gap-2" data-testid={`plan-round-${r}`}>
                  <h3 className="text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">{r === 1 ? "First round" : `Replan ${r - 1}`}</h3>
                  <Rows>
                    {reason && (
                      <RowItem tone="risk" className="items-center" testId="replan-reason">
                        <Chip tone="risk">{reason.label}</Chip>
                        <span className="text-sm font-bold first-letter:uppercase">{reason.text}</span>
                      </RowItem>
                    )}
                    {record.candidates
                      .filter((c) => c.round === r)
                      .map((c) => (
                        <RowItem key={c.option_id} testId={`candidate-${c.option_id}`}>
                          <span className="w-8 shrink-0 pt-0.5 font-mono text-base font-black text-sign-green">{c.option_id}</span>
                          <span className="flex min-w-0 flex-1 flex-col gap-1">
                            <span className="font-black">{c.label}</span>
                            <span className="flex flex-wrap gap-2">
                              {c.strategies.map((st) => (
                                <StrategyPlate key={st} strategy={st} />
                              ))}
                            </span>
                            <span className="text-sm">{c.rationale}</span>
                            <AgentWritten />
                          </span>
                        </RowItem>
                      ))}
                  </Rows>
                </div>
              );
            })}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6 xl:col-span-4">
          <Panel title="Solver setup" icon={<Cpu aria-hidden />} tone="neutral" testId="solver-setup" className="h-auto">
            <Rows className="text-sm">
              <RowItem>
                <span>
                  <b>Goal:</b> cover the shortfall before the loading cutoff at the lowest cost.
                </span>
              </RowItem>
              <RowItem>
                <span>
                  <b>Rules added by the Critic:</b>{" "}
                  {constraints.length
                    ? constraints
                        .map((c) =>
                          c.type === "safety_stock"
                            ? "keep every DC at its safety stock"
                            : c.type === "exclude_supplier" && c.supplier
                              ? `without ${supplierName(record.affected?.labels, c.supplier)}`
                              : c.type.replaceAll("_", " "),
                        )
                        .join("; ")
                    : "none"}
                </span>
              </RowItem>
              <RowItem>
                <span>
                  <b>Where it ran:</b> {solverLabel(events)}
                </span>
              </RowItem>
            </Rows>
          </Panel>
          {hits.length > 0 && (
            <Panel title="Precedents cited" icon={<BookOpen aria-hidden />} tone="info" testId="planner-precedents" className="h-auto flex-1">
              {query && <SearchQuery query={query} />}
              <Rows>
                {hits.map((h) => {
                  const used = h.tags.filter((t) => strategies.includes(t));
                  return (
                    <RowItem key={h.id} className="flex-col gap-1 text-sm" testId={`precedent-${h.id}`}>
                      <span className="flex w-full flex-wrap items-center gap-2">
                        <span className="font-mono font-bold">{h.id}</span>
                        {h.period && <span className="font-mono text-ink-2">{period(h.period)}</span>}
                        {h.synthetic && (
                          <Chip tone="muted" className="ml-auto">
                            Synthetic precedent
                          </Chip>
                        )}
                      </span>
                      <span className="font-black">{h.title}</span>
                      {h.lesson && (
                        <span data-testid="precedent-lesson">
                          <b>Lesson:</b> {h.lesson}
                        </span>
                      )}
                      {used.length > 0 && (
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">Used here</span>
                          {used.map((st) => (
                            <StrategyPlate key={st} strategy={st} />
                          ))}
                        </span>
                      )}
                    </RowItem>
                  );
                })}
              </Rows>
            </Panel>
          )}
        </div>
      </Reveal>

      <Reveal delay={200}>
        <Panel title="The Critic's checks" icon={<ShieldCheck aria-hidden />} tone="risk" description="Business rules, run in code on every option" testId="critic-checks">
          <Rows>
            {record.critic_findings.map((f) => (
              <RowItem key={f.option_id} className="grid grid-cols-1 gap-2 md:grid-cols-[8rem_minmax(0,1fr)] md:gap-6">
                <span className="flex items-center gap-2 md:flex-col md:items-start">
                  <span className="font-mono text-base font-black">{f.option_id}</span>
                  <Chip tone={f.clean ? "ok" : "risk"}>{f.clean ? "Passes" : "Rejected"}</Chip>
                </span>
                <span className="flex min-w-0 flex-col gap-2">
                  <ul className="grid gap-x-6 gap-y-1 text-sm lg:grid-cols-2">
                    {f.checks.map((c, i) => (
                      <li key={i} className={cn("flex gap-2", !c.passed && "font-bold text-chip-risk-fg")}>
                        {c.passed ? <Check className="mt-0.5 size-4 shrink-0 text-sign-green" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0" aria-hidden />}
                        <span>
                          {c.plain || c.detail} <span className="font-mono text-xs font-normal text-ink-2">[{c.rule}]</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {f.explanation && (
                    <p className="text-sm" data-testid={`critic-note-${f.option_id}`}>
                      {f.explanation} <AgentWritten by="Critic Agent" />
                    </p>
                  )}
                </span>
              </RowItem>
            ))}
          </Rows>
        </Panel>
      </Reveal>

      {record.explanation && (
        <Reveal delay={200}>
          <Panel title="Why this plan" icon={<Sparkles aria-hidden />} tone="ok" testId="explanation" footer={<AgentWritten />}>
            <p className="text-base">{record.explanation.summary}</p>
            <p className="text-sm text-ink-2">{record.explanation.recommendation_rationale}</p>
          </Panel>
        </Reveal>
      )}
    </div>
  );
}

function OptionCard({ option: o, record }: { option: SolverResult; record: CaseRecord }) {
  const out = outcome(o.option_id, record);
  const f = record.critic_findings.find((x) => x.option_id === o.option_id);
  const maxTier = f?.tiers.length ? Math.max(...f.tiers.map((t) => t.tier)) : null;
  const labels = record.affected?.labels;
  const r = o.result;
  const etas = r.actions.map((a) => a.eta).filter((e): e is string => !!e).sort();
  const chosen = out.tone === "ok";
  return (
    <article
      data-testid={`option-${o.option_id}`}
      className={cn(
        CARD,
        "flex h-full flex-col gap-4 p-6",
        chosen && "inset-ring-2 inset-ring-sign-green",
        out.tone === "risk" && "inset-ring-2 inset-ring-stop-red",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm font-bold text-ink-2">{o.option_id}</span>
            <Chip tone={out.tone}>{out.text}</Chip>
          </span>
          <h3 className="text-lg font-black">{o.label}</h3>
        </div>
        {maxTier !== null && <TierPlate tier={maxTier} />}
      </div>
      <div className="grid grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1.25fr)] gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">Cost</span>
          <span className={cn("text-[1.5rem] leading-tight font-black whitespace-nowrap", out.tone === "risk" && !chosen && "text-ink-2 line-through decoration-2")}>
            {r.status === "optimal" ? juta(r.total_cost) : "Infeasible"}
          </span>
          <span className="font-mono text-xs text-ink-2">{r.status === "optimal" ? o.total_cost_display : ""}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">Covers</span>
          <span className="text-[1.5rem] leading-tight font-black">{thousands(r.covered_quantity)}</span>
          <span className="text-xs text-ink-2">of {thousands(r.required_quantity)} ctn</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">Last arrival</span>
          <span className="text-base font-black">{etas.length ? dayShort(record.day0, etas.at(-1)).split(" · ")[0] : "None"}</span>
        </div>
      </div>
      {r.status === "optimal" ? (
        <ul className="flex flex-col gap-1 text-sm" aria-label="Cost lines">
          {r.actions.map((a, i) => (
            <li key={i} className="flex items-start justify-between gap-4 border-b border-divider py-1 last:border-0">
              <span className="flex min-w-0 items-start gap-2">
                <Route className="mt-0.5 size-4 shrink-0 text-ink-2" aria-hidden />
                <span>{actionLine(a, labels)}</span>
              </span>
              <span className="font-bold whitespace-nowrap">{juta(a.cost)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-chip-risk-fg">{r.infeasible_reason}</p>
      )}
      {f && !f.clean && (
        <p className="rounded-[8px] bg-tint-risk-bg p-2 text-sm font-bold text-chip-risk-fg inset-ring inset-ring-tint-risk-line" data-testid="critic-reason">
          {f.checks
            .filter((c) => !c.passed)
            .map((c) => c.plain || c.detail)
            .join("; ")}
        </p>
      )}
    </article>
  );
}
