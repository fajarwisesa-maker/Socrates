"use client";

// Response options (mockup "Pengoptimal Respon"): what the agent proposed, what the solver
// priced, what the Critic rejected and why, and the saving of the chosen plan. Prices,
// quantities and arrivals come from the solver (PuLP / CBC); the model writes strategies and
// rationale only, labelled.
import { BookOpen, Check, Cpu, Lightbulb, Route, ShieldCheck, Sparkles, X } from "lucide-react";
import { CandidateSign, PrecedentPlate, ReplanPlate, SearchQuery } from "@/components/plan";
import { Reveal } from "@/components/Reveal";
import { AgentWritten, SolverLabel, TierPlate } from "@/components/signs";
import { dayShort, juta, thousands } from "@/lib/format";
import { precedentHits, precedentQuery, replanReason } from "@/lib/planView";
import { actionLine, solverLabel, supplierName } from "@/lib/present";
import type { CaseRecord, SolverResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CARD } from "../../signs";
import { Chip, type ChipTone, PageHeader, Panel } from "../ui";
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

  if (!record.candidates.length) {
    return (
      <div className="flex flex-col gap-8" data-testid="page-options">
        <PageHeader title="Response options" description="The agent is choosing strategies." />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8" data-testid="page-options">
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

      {s && (
        <Reveal>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[12px] bg-sign-green p-6 text-white" data-testid="saving-banner">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold tracking-[0.08em] text-sign-green-tint uppercase">Chosen plan</span>
              <span className="text-3xl font-black">{juta(s.case_cost ?? s.chosen_cost)}</span>
            </div>
            {s.saving_vs_baseline && s.saving_vs_baseline > 0 && baseline ? (
              <div className="flex flex-col gap-1">
                <span className="text-xs font-bold tracking-[0.08em] text-sign-green-tint uppercase">Saving</span>
                <span className="text-3xl font-black text-signal-yellow">{juta(s.saving_vs_baseline)}</span>
                <span className="text-sm">cheaper than {baseline.label.toLowerCase()} ({juta(baseline.result.total_cost)})</span>
              </div>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold tracking-[0.08em] text-sign-green-tint uppercase">Protects</span>
              <span className="text-3xl font-black">{juta(s.exposure_avoided)}</span>
              <span className="text-sm">of penalties · net {juta(s.net_protected)}</span>
            </div>
            <SolverLabel className="ml-auto self-end text-sign-green-tint">{solverLabel(events)}</SolverLabel>
          </div>
        </Reveal>
      )}

      {rounds.map((r) => (
        <section key={r} className="flex flex-col gap-4" data-testid={`options-round-${r}`}>
          <h2 className="text-lg font-black">{r === 1 ? "Priced options" : `Priced options after replan ${r - 1}`}</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {record.solver_results
              .filter((o) => o.round === r)
              .map((o, i) => (
                <Reveal key={o.option_id} delay={i * 70}>
                  <OptionCard option={o} record={record} />
                </Reveal>
              ))}
          </div>
        </section>
      ))}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Panel title="How the agent planned" icon={<Lightbulb aria-hidden />} description="Strategies only: the agent sets no quantities or prices" testId="plan-rounds">
          {candidateRounds.map((r) => {
            const reason = r > 1 ? replanReason(record, events, r) : null;
            return (
              <div key={r} className="flex flex-col gap-4" data-testid={`plan-round-${r}`}>
                <h3 className="text-sm font-bold tracking-[0.06em] text-ink-2 uppercase">{r === 1 ? "First round" : `Replan ${r - 1}`}</h3>
                {reason && <ReplanPlate reason={reason} />}
                <ul className="grid gap-4 md:grid-cols-2">
                  {record.candidates
                    .filter((c) => c.round === r)
                    .map((c) => (
                      <li key={c.option_id} className="flex flex-col gap-2">
                        <CandidateSign candidate={c} />
                        <p className="text-sm">{c.rationale}</p>
                        <AgentWritten />
                      </li>
                    ))}
                </ul>
              </div>
            );
          })}
        </Panel>

        <div className="flex flex-col gap-8">
          <Panel title="Solver setup" icon={<Cpu aria-hidden />} testId="solver-setup">
            <ul className="flex flex-col gap-2 text-sm">
              <li>
                <b>Goal:</b> cover the shortfall before the loading cutoff at the lowest cost.
              </li>
              <li>
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
              </li>
              <li>
                <b>Where it ran:</b> {solverLabel(events)}
              </li>
            </ul>
          </Panel>
          {hits.length > 0 && (
            <Panel title="Precedents cited" icon={<BookOpen aria-hidden />} testId="planner-precedents">
              {query && <SearchQuery query={query} />}
              {hits.map((h) => (
                <PrecedentPlate key={h.id} hit={h} strategies={strategies} />
              ))}
            </Panel>
          )}
        </div>
      </div>

      <Panel title="The Critic's checks" icon={<ShieldCheck aria-hidden />} description="Business rules, run in code on every option" testId="critic-checks">
        <div className="grid gap-4 lg:grid-cols-2">
          {record.critic_findings.map((f) => (
            <div key={f.option_id} className="flex flex-col gap-2 rounded-[12px] bg-surface p-4 inset-ring inset-ring-hairline">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold">{f.option_id}</span>
                <Chip tone={f.clean ? "ok" : "risk"}>{f.clean ? "Passes" : "Rejected"}</Chip>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
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
            </div>
          ))}
        </div>
      </Panel>

      {record.explanation && (
        <Panel title="Why this plan" icon={<Sparkles aria-hidden />} testId="explanation">
          <AgentWritten />
          <p className="text-base">{record.explanation.summary}</p>
          <p className="text-sm text-ink-2">{record.explanation.recommendation_rationale}</p>
        </Panel>
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
      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">Cost</span>
          <span className={cn("text-2xl font-black", out.tone === "risk" && !chosen && "text-ink-2 line-through decoration-2")}>
            {r.status === "optimal" ? juta(r.total_cost) : "Infeasible"}
          </span>
          <span className="font-mono text-xs text-ink-2">{r.status === "optimal" ? o.total_cost_display : ""}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">Covers</span>
          <span className="text-2xl font-black">{thousands(r.covered_quantity)}</span>
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
        <p className="rounded-[8px] bg-chip-risk-bg p-2 text-sm font-bold text-chip-risk-fg" data-testid="critic-reason">
          {f.checks
            .filter((c) => !c.passed)
            .map((c) => c.plain || c.detail)
            .join("; ")}
        </p>
      )}
    </article>
  );
}
