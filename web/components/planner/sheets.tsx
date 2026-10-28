"use client";

// Stage sheets of the case file (docs/redesign-prompt.md 6.4). One sheet per stage, built
// only from the case record and its events. Numbers are backend values, formatted here;
// model-written text carries a "Written by the agent" label.
import { Check, FileText, Info, MessageCircle, Truck, X } from "lucide-react";
import { ApprovalSign } from "@/components/ApprovalSign";
import { LaneMap } from "@/components/LaneMap";
import { StateNotices } from "@/components/StateNotices";
import {
  AgentWritten,
  GantrySign,
  LaneDivider,
  SignHeading,
  SolverLabel,
  StatusPlate,
  TierPlate,
} from "@/components/signs";
import { caseClock } from "@/lib/caseClock";
import { SHEET_TITLE, sheetKicker } from "@/lib/caseView";
import { dayShort, juta, minutesSeconds, pct, thousands } from "@/lib/format";
import { laneModel } from "@/lib/laneModel";
import { notices } from "@/lib/notices";
import {
  actionLine,
  actionTitle,
  CAUSE,
  delay,
  FIELD,
  glossFor,
  period,
  plantName,
  solverLabel,
  STRATEGY,
  supplierName,
  whatsappReply,
} from "@/lib/present";
import type { Approval, CaseEvent, CaseRecord, DelayPrediction, Evidence, Precedent, Stage } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

interface SheetProps {
  record: CaseRecord;
  /** this stage's events (every round) */
  events: CaseEvent[];
  approvals: Approval[];
  live: boolean;
  onDecided: () => void;
}

export function StageSheet({ stage, agent, ...p }: SheetProps & { stage: Stage; agent?: string }) {
  const items = notices(p.events, p.record, p.live);
  const Body = SHEETS[stage];
  return (
    <section className="min-w-0 space-y-5" data-testid="stage-sheet" data-stage={stage}>
      <div>
        <p className="font-mono text-xs font-bold tracking-[0.12em] text-ink-2 uppercase">{sheetKicker(stage, agent)}</p>
        <h2 className="mt-1 text-2xl font-black text-asphalt" data-testid="sheet-title">
          {SHEET_TITLE[stage]}
        </h2>
      </div>
      <StateNotices size="planner" items={items} />
      <Body {...p} />
    </section>
  );
}

// ------------------------------------------------------------------ Perceive

function numbered(ev: Evidence[]): Map<string, number> {
  const sorted = [...ev].sort((a, b) => a.signal - b.signal || a.start - b.start);
  return new Map(sorted.map((e, i) => [`${e.signal}:${e.start}`, i + 1]));
}

function Marked({ text, spans, nums }: { text: string; spans: Evidence[]; nums: Map<string, number> }) {
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < pos) continue;
    out.push(<span key={`t${s.start}`}>{text.slice(pos, s.start)}</span>);
    out.push(
      <mark
        key={`m${s.start}`}
        data-field={s.field}
        className="rounded-[3px] bg-signal-yellow px-0.5 font-bold text-asphalt not-italic [box-decoration-break:clone]"
      >
        {text.slice(s.start, s.end)}
        <sup className="ml-0.5 font-mono text-[0.7em]">{nums.get(`${s.signal}:${s.start}`)}</sup>
      </mark>,
    );
    pos = s.end;
  }
  out.push(<span key="end">{text.slice(pos)}</span>);
  return <>{out}</>;
}

function PerceiveSheet({ record, events }: SheetProps) {
  const d = record.disruption;
  if (!d) return <Waiting>Reading the signals.</Waiting>;
  const ev = d.evidence ?? [];
  const nums = numbered(ev);
  const cite = (fields: string[]) =>
    ev.filter((e) => fields.includes(e.field)).map((e) => nums.get(`${e.signal}:${e.start}`)).sort((a, b) => a! - b!);
  const glosses = ev.filter((e) => glossFor(e));
  const dropped = events.flatMap((e) => ((e.data as { dropped?: { quote: string }[] }).dropped ?? []) as { quote: string }[]);
  const progression = d.confidence_basis?.progression ?? [];
  const rows: [string, string, string[]][] = [
    [FIELD.cause, CAUSE[d.cause] ?? d.cause, ["cause", "is_disruption"]],
    [FIELD.lane, d.lane ?? "unknown", ["lane"]],
    [FIELD.location, d.location ?? "unknown", ["location"]],
    [FIELD.delay, delay(d.delay_hours_min, d.delay_hours_max), ["delay"]],
    [FIELD.references, d.references.map((r) => `PO ${r}`).join(", ") || "none", ["references"]],
  ];
  const agreeing = d.confidence_basis?.corroborated_fields ?? [];
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="space-y-4">
        {record.signals.map((s, i) => {
          const spans = ev.filter((e) => e.signal === i + 1);
          const pdf = s.type === "pdf";
          return (
            <article key={i} className="rounded-[12px] border-2 border-asphalt bg-road-white" data-testid={pdf ? "sheet-pdf" : "sheet-whatsapp"}>
              <header className="flex items-center gap-2 border-b-2 border-curb px-4 py-2 text-sm font-black tracking-[0.08em] uppercase">
                {pdf ? <FileText className="size-4" aria-hidden /> : <MessageCircle className="size-4" aria-hidden />}
                {pdf ? `Forwarder notice · ${s.filename ?? "PDF"}` : "Driver · WhatsApp"}
                {s.via === "whatsapp_api" && (
                  <span className="font-mono text-xs font-normal tracking-normal normal-case">
                    received live{s.sender ? ` from ${s.sender}` : ""}
                  </span>
                )}
              </header>
              {pdf ? (
                <ul className="space-y-1 px-4 py-3 text-base">
                  {spans.length === 0 && <li className="text-ink-2">No quote from this notice was used.</li>}
                  {[...spans]
                    .sort((a, b) => a.start - b.start)
                    .map((e) => (
                      <li key={e.start}>
                        <mark className="rounded-[3px] bg-signal-yellow px-0.5 font-bold text-asphalt">
                          {e.text.replace(/\s+/g, " ")}
                          <sup className="ml-0.5 font-mono text-[0.7em]">{nums.get(`${e.signal}:${e.start}`)}</sup>
                        </mark>
                      </li>
                    ))}
                </ul>
              ) : (
                <p lang="id" className="px-4 py-3 text-base leading-relaxed italic">
                  <Marked text={s.text} spans={spans} nums={nums} />
                </p>
              )}
            </article>
          );
        })}
        {glosses.length > 0 && (
          <div className="rounded-[12px] bg-surface-2 px-4 py-3">
            <AgentWritten />
            <ul className="mt-1 space-y-0.5 text-sm">
              {glosses.map((e) => (
                <li key={`${e.signal}:${e.start}`}>
                  <span className="font-mono">{nums.get(`${e.signal}:${e.start}`)}</span>{" "}
                  <span lang="id" className="italic">“{e.text}”</span> means <span lang="en">{glossFor(e)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {dropped.length > 0 && (
          <p className="text-sm font-bold text-risk-ink">
            Dropped because code could not find them in the signal: {dropped.map((x) => `“${x.quote}”`).join(", ")}
          </p>
        )}
      </div>
      <div className="space-y-4">
        <table className="w-full overflow-hidden rounded-[12px] bg-road-white text-base" data-testid="disruption-fields">
          <thead>
            <tr className="border-b-2 border-asphalt text-left text-xs font-black tracking-[0.08em] uppercase">
              <th className="px-3 py-2">Field</th>
              <th className="px-3 py-2">Value</th>
              <th className="px-3 py-2 text-right">Quotes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, v, f]) => (
              <tr key={k} className="border-b border-curb">
                <td className="px-3 py-2 whitespace-nowrap text-ink-2">{k}</td>
                <td className="px-3 py-2 font-bold">{v}</td>
                <td className="px-3 py-2 text-right font-mono text-sm whitespace-nowrap">{cite(f).join(", ") || "none"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div data-testid="sheet-confidence">
          <SignHeading>Confidence</SignHeading>
          <p className="text-2xl font-black">
            {progression.length > 1 ? progression.map((x) => x.label).join(" → ") : d.confidence}
          </p>
          <p className="text-sm text-ink-2">
            {d.confidence === "High" && agreeing.length
              ? `The WhatsApp alone gave Medium. The forwarder notice agrees on ${agreeing.join(" and ")}.`
              : "One informal source. A second source that agrees on lane and delay would raise it to High."}{" "}
            Computed in code from the located quotes, never by the model.
          </p>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Assess

const PENALTY: Record<string, string> = { OTIF_PENALTY: "OTIF penalty", LOST_MARGIN: "Lost margin" };

function AssessSheet({ record, events }: SheetProps) {
  const a = record.affected;
  const risk = record.risk;
  if (!a || !risk) return <Waiting>Reading SAP: stock, orders, inbound POs.</Waiting>;
  const model = laneModel(record, { kind: "assess" });
  const dest = plantName(a.labels, a.plant);
  const note = events.find((e) => e.status === "completed")?.data.impact_note as string | undefined;
  const agent = events.find((e) => e.status === "started")?.agent ?? undefined;
  const so = (id: string) => a.sales_orders.find((s) => s.SalesOrder === id);
  const inbound = risk.inbound[0];
  return (
    <div className="space-y-5">
      {model && <LaneMap model={model} />}
      <div className="overflow-x-auto rounded-[12px] border-2 border-asphalt bg-road-white" data-testid="orders-table">
        <div className="sign-label border-b-2 border-asphalt px-4 py-2 text-sm">
          Orders loading at {dest}
          {risk.deadline ? ` by ${dayShort(record.day0, risk.deadline)}` : ""}
        </div>
        <table className="w-full min-w-[560px] text-base">
          <thead>
            <tr className="border-b-2 border-asphalt text-left text-xs font-black tracking-[0.06em] uppercase">
              <th className="px-4 py-2">Order</th>
              <th className="px-4 py-2">Customer</th>
              <th className="px-4 py-2 text-right">Cartons</th>
              <th className="px-4 py-2 text-right whitespace-nowrap">Stockout chance</th>
              <th className="px-4 py-2 text-right">If missed</th>
            </tr>
          </thead>
          <tbody>
            {risk.orders.map((o) => (
              <tr key={o.order} className="border-b border-curb">
                <td className="px-4 py-2 font-mono font-bold whitespace-nowrap">{o.order}</td>
                <td className="px-4 py-2">
                  {so(o.order)?.YY1_SoldToPartyName ?? o.order}
                  {so(o.order)?.YY1_Channel && <span className="text-ink-2"> ({so(o.order)!.YY1_Channel!.toLowerCase()})</span>}
                </td>
                <td className="px-4 py-2 text-right font-mono">{thousands(o.quantity)}</td>
                <td className={cn("px-4 py-2 text-right font-mono font-bold", o.stockout_probability > 0 && "text-risk-ink")}>
                  {pct(o.stockout_probability)}
                </td>
                <td className="px-4 py-2 text-right font-mono font-bold whitespace-nowrap text-risk-ink">
                  {PENALTY[so(o.order)?.YY1_PenaltyType ?? ""] ?? "Penalty"} {juta(o.penalty)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-base text-ink-2" data-testid="stock-line">
        {dest} holds {thousands(a.stock.OnHandQuantity)} cartons, {thousands(a.stock.SafetyStockQuantity)} of them safety stock.
        That leaves {thousands(risk.usable_stock)} usable against {thousands(risk.demand)} needed.
        {inbound && (
          <>
            {" "}PO {inbound.ref} ({thousands(inbound.quantity)} ctn) now arrives{" "}
            {inbound.arrival_earliest === inbound.arrival_latest
              ? dayShort(record.day0, inbound.arrival_latest)
              : `${dayShort(record.day0, inbound.arrival_earliest).replace(" WIB", "")} to ${dayShort(record.day0, inbound.arrival_latest)}`}
            .
          </>
        )}
      </p>
      {record.delay_prediction && <DelayDetails p={record.delay_prediction} />}
      {note && (
        <div className="rounded-[12px] border-2 border-asphalt bg-road-white px-4 py-3" data-testid="impact-note">
          <SignHeading className="mb-1">Impact note</SignHeading>
          <p className="text-base">{note}</p>
          <AgentWritten by={agent} />
        </div>
      )}
    </div>
  );
}

/** The learned delay, its interval, the signal range and what the risk function used. */
function DelayDetails({ p }: { p: DelayPrediction }) {
  const [lo, hi] = p.signal_range_hours;
  const used = p.delay_for_risk_hours;
  return (
    <div className="rounded-[12px] bg-surface-2 px-4 py-3 text-base" data-testid="delay-details">
      <div className="text-xs font-bold text-ink-2">
        {p.provider === "fake" ? "Offline stand-in, not SAP RPT-1.6 (median of similar rows)" : "SAP RPT-1.6 on SAP AI Core"} ·{" "}
        {p.history_rows ?? 0} past disruptions (synthetic history) · combined with the signal in code
      </div>
      {p.status === "ok" ? (
        <div>
          Predicted <b>{p.predicted_hours} h</b>
          {p.interval_hours && ` (interval ${p.interval_hours[0]} to ${p.interval_hours[1]} h)`}; signal {lo} to {hi} h, so{" "}
          <b>
            risk uses {used[0]} h{p.disagree ? ` (clamped: ${p.flag})` : ""}
          </b>
        </div>
      ) : (
        <div className="text-ink-2">
          Prediction unavailable ({p.reason ?? "no answer"}). Risk uses the signal range {lo} to {hi} h.
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Plan

function PlanSheet({ record, events }: SheetProps) {
  const precedents = events
    .filter((e) => e.status === "completed")
    .flatMap((e) => (e.data.precedents as Precedent[] | undefined) ?? []);
  const unique = [...new Map(precedents.map((p) => [p.id, p])).values()];
  if (!record.candidates.length) return <Waiting>Choosing strategies.</Waiting>;
  return (
    <div className="space-y-5">
      <ul className="space-y-3">
        {record.candidates.map((c) => (
          <li key={c.option_id} className="rounded-[12px] border-2 border-asphalt bg-road-white px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono font-bold">{c.option_id}</span>
              <span className="font-black">{c.label}</span>
              {c.strategies.map((s) => (
                <StatusPlate key={s} tone="running">
                  {STRATEGY[s] ?? s}
                </StatusPlate>
              ))}
              {c.round > 1 && <StatusPlate tone="muted">Replan {c.round - 1}</StatusPlate>}
            </div>
            <p className="mt-1 text-base">{c.rationale}</p>
            <AgentWritten />
          </li>
        ))}
      </ul>
      {unique.length > 0 && (
        <div data-testid="planner-precedents">
          <SignHeading className="mb-2">Precedents cited</SignHeading>
          <ul className="space-y-1 text-base">
            {unique.map((p) => (
              <li key={p.id}>
                {p.synthetic && <StatusPlate tone="muted">Synthetic precedent</StatusPlate>} <b>{p.id}</b> {p.title}
                {p.period && <span className="text-ink-2"> · {period(p.period)}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Simulate

function SimulateSheet({ record, events }: SheetProps) {
  if (!record.solver_results.length) return <Waiting>Running the solver.</Waiting>;
  const rounds = [...new Set(record.solver_results.map((o) => o.round))];
  return (
    <div className="space-y-5">
      <SolverLabel className="text-sm">{solverLabel(events)}</SolverLabel>
      {rounds.map((r) => (
        <div key={r} className="space-y-2">
          <SignHeading>{r === 1 ? "First round" : `Replan ${r - 1}`}</SignHeading>
          <div className="grid gap-4 md:grid-cols-2">
            {record.solver_results
              .filter((o) => o.round === r)
              .map((o) => {
                const tiers = record.critic_findings.find((f) => f.option_id === o.option_id)?.tiers ?? [];
                const maxTier = tiers.length ? Math.max(...tiers.map((t) => t.tier)) : null;
                const model = laneModel(record, { kind: "option", option: o });
                return (
                  <article key={o.option_id} className="space-y-2 rounded-[12px] border-2 border-asphalt bg-road-white p-4" data-testid={`sim-${o.option_id}`}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-black">
                        <span className="font-mono">{o.option_id}</span> · {o.label}
                      </span>
                      {maxTier !== null && <TierPlate tier={maxTier} />}
                    </div>
                    <div className="text-3xl font-black">{o.result.status === "optimal" ? juta(o.result.total_cost) : "Infeasible"}</div>
                    {o.result.status !== "optimal" && <p className="text-sm text-risk-ink">{o.result.infeasible_reason}</p>}
                    <ul className="text-sm">
                      {o.result.actions.map((a, i) => (
                        <li key={i}>
                          {actionLine(a, record.affected?.labels)}
                          {a.eta && <span className="text-ink-2">, arrives {dayShort(record.day0, a.eta)}</span>}
                        </li>
                      ))}
                    </ul>
                    {model && <LaneMap model={model} variant="mini" testId={`mini-map-${o.option_id}`} />}
                  </article>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Reflect

function outcome(id: string, record: CaseRecord): { text: string; tone: "done" | "rejected" | "muted" } {
  const o = record.solver_results.find((x) => x.option_id === id)!;
  const f = record.critic_findings.find((x) => x.option_id === id);
  const acts = record.actions.filter((a) => a.option_id === id);
  if (acts.some((a) => a.status === "REJECTED")) return { text: "chosen · planner rejected", tone: "rejected" };
  if (acts.some((a) => a.status === "EXPIRED")) return { text: "chosen · approved too late", tone: "rejected" };
  if (id === record.chosen_option) return { text: "chosen", tone: "done" };
  if (o.result.status !== "optimal") return { text: "infeasible", tone: "muted" };
  if (f && !f.clean) return { text: `rejected: ${f.checks.filter((c) => !c.passed).map((c) => c.rule.replaceAll("_", " ")).join(", ")}`, tone: "rejected" };
  return { text: "not chosen", tone: "muted" };
}

function ReflectSheet({ record }: SheetProps) {
  if (!record.critic_findings.length) return <Waiting>The Critic is checking the plans.</Waiting>;
  const s = record.summary;
  const baseline = s?.baseline ? record.solver_results.find((o) => o.option_id === s.baseline) : null;
  return (
    <div className="space-y-5">
      <div className="overflow-x-auto rounded-[12px] border-2 border-asphalt bg-road-white" data-testid="options">
        <table className="w-full min-w-[640px] text-base">
          <thead>
            <tr className="border-b-2 border-asphalt text-left text-xs font-black tracking-[0.06em] uppercase">
              <th className="px-3 py-2">Option</th>
              <th className="px-3 py-2">Plan</th>
              <th className="px-3 py-2 text-right">Cost</th>
              <th className="px-3 py-2">Max tier</th>
              <th className="px-3 py-2">Outcome</th>
            </tr>
          </thead>
          <tbody>
            {record.solver_results.map((o) => {
              const out = outcome(o.option_id, record);
              const f = record.critic_findings.find((x) => x.option_id === o.option_id);
              const maxTier = f?.tiers.length ? Math.max(...f.tiers.map((t) => t.tier)) : null;
              return (
                <tr key={o.option_id} data-testid={`option-${o.option_id}`} className="border-b border-curb align-top">
                  <td className="px-3 py-2 font-mono font-bold">
                    {o.option_id}
                    {o.round > 1 && <div className="text-xs font-normal">replan</div>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-bold">{o.label}</div>
                    <div className="text-sm text-ink-2">{o.result.actions.map((a) => actionLine(a, record.affected?.labels)).join(" · ")}</div>
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
                  <td className="px-3 py-2 text-right font-mono font-bold whitespace-nowrap">
                    {o.result.status === "optimal" ? o.total_cost_display : "infeasible"}
                  </td>
                  <td className="px-3 py-2">{maxTier !== null && <TierPlate tier={maxTier} />}</td>
                  <td className="px-3 py-2">
                    <StatusPlate tone={out.tone}>{out.text}</StatusPlate>
                    {f && !f.clean && (
                      <p className="mt-1 text-sm font-bold text-risk-ink">
                        {f.checks.filter((c) => !c.passed).map((c) => c.plain || c.detail).join("; ")}
                      </p>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="flex flex-wrap justify-between gap-2 border-t-2 border-asphalt px-3 py-2">
          <SolverLabel>Prices, quantities and arrivals from the solver (PuLP / CBC), not the model</SolverLabel>
          {s?.saving_display && (s.saving_vs_baseline ?? 0) > 0 && baseline && (
            <span className="text-sm font-bold text-brand-ink">
              {juta(s.saving_vs_baseline)} cheaper than {baseline.label.toLowerCase()}
            </span>
          )}
        </div>
      </div>
      <div className="space-y-3" data-testid="critic-checks">
        <SignHeading>The Critic&apos;s checks</SignHeading>
        {record.critic_findings.map((f) => (
          <div key={f.option_id} className={cn("rounded-[12px] border-2 bg-road-white px-4 py-3", f.clean ? "border-sign-green" : "border-stop-red")}>
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold">{f.option_id}</span>
              <StatusPlate tone={f.clean ? "done" : "rejected"}>{f.clean ? "Passes" : "Rejected"}</StatusPlate>
            </div>
            <ul className="mt-1 space-y-0.5 text-sm">
              {f.checks.map((c, i) => (
                <li key={i} className={cn("flex gap-2", !c.passed && "font-bold text-risk-ink")}>
                  {c.passed ? <Check className="mt-0.5 size-4 shrink-0" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0" aria-hidden />}
                  <span>
                    {c.plain || c.detail} <span className="font-mono text-xs font-normal">[{c.rule}]</span>
                  </span>
                </li>
              ))}
            </ul>
            {f.explanation && (
              <p className="mt-1 text-sm" data-testid={`critic-note-${f.option_id}`}>
                {f.explanation} <AgentWritten by="Critic Agent" />
              </p>
            )}
          </div>
        ))}
      </div>
      {record.explanation && (
        <div className="rounded-[12px] bg-surface-2 px-4 py-3" data-testid="explanation">
          <AgentWritten />
          <p className="text-base">{record.explanation.summary}</p>
          <p className="mt-1 text-sm text-ink-2">{record.explanation.recommendation_rationale}</p>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Act

function ActSheet({ record, approvals, onDecided }: SheetProps) {
  const labels = record.affected?.labels;
  const dest = record.affected?.plant ?? "";
  const done = record.actions.filter((a) => a.status === "EXECUTED" && a.tier <= 2);
  const pendingFirst = [...approvals].sort((a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING") || b.approval_id.localeCompare(a.approval_id));
  const anyPending = approvals.some((a) => a.status === "PENDING");
  const chosen = record.solver_results.find((o) => o.option_id === record.chosen_option);
  const s = record.summary;
  const baseline = s?.baseline ? record.solver_results.find((o) => o.option_id === s.baseline) : null;
  const model = laneModel(record, { kind: "act" });
  if (!record.actions.length && record.status !== "ESCALATED") return <Waiting>Executing the plan.</Waiting>;
  return (
    <div className="space-y-5">
      {chosen && (
        <p className="text-base" data-testid="act-summary">
          Plan {chosen.option_id}: {chosen.result.actions.map((a) => actionLine(a, labels)).join(", ")}.
          {s && <> {juta(s.case_cost ?? s.chosen_cost)} in total</>}
          {s?.saving_vs_baseline && s.saving_vs_baseline > 0 && baseline ? (
            <>, {juta(s.saving_vs_baseline)} cheaper than {baseline.label.toLowerCase()}.</>
          ) : (
            "."
          )}
        </p>
      )}
      {done.length > 0 && (
        <div className="space-y-2">
          <StatusPlate tone="done">Done by SIAGA</StatusPlate>
          {done.map((a) => (
            <article key={a.action_id} className="flex items-center gap-4 rounded-[12px] border-2 border-sign-green bg-road-white px-4 py-3" data-testid="executed-action">
              <Truck className="size-7 shrink-0 text-sign-green" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="font-black">{actionTitle(a, labels, dest)}</div>
                <div className="font-mono text-sm">
                  {thousands(a.quantity)} ctn
                  {a.planned?.trucks ? ` · ${a.planned.trucks} trucks` : ""}
                  {a.sap_ref ? ` · SAP ${a.sap_ref}` : ""}
                  {a.eta ? ` · arrives ${dayShort(record.day0, a.eta)}` : ""}
                </div>
                <div className="text-sm font-bold text-brand-ink">
                  SIAGA did this alone · Tier {a.tier} · internal and reversible
                </div>
              </div>
              <span className="text-2xl font-black">{juta(a.cost)}</span>
            </article>
          ))}
        </div>
      )}
      {anyPending && <LaneDivider label="Needs you" />}
      <div className="space-y-4">
        {pendingFirst.map((a) => (
          <ApprovalSign key={a.approval_id} approval={a} record={record} onDecided={onDecided} />
        ))}
      </div>
      {record.notes.map((n) => (
        <p key={n.ref} className="flex items-start gap-3 text-base" data-testid="tier0-note">
          <TierPlate tier={n.tier} /> <span>{n.text}</span>
        </p>
      ))}
      {model && <LaneMap model={model} />}
    </div>
  );
}

// ------------------------------------------------------------------ Verify

function VerifySheet({ record, events }: SheetProps) {
  const now = useNow(500);
  const v = record.verification;
  const s = record.summary;
  const risk = record.risk;
  const resolved = record.status === "RESOLVED" && v?.covered;
  const reopened = record.status === "REOPENED";
  const clock = caseClock(events.length ? events : [], now);
  const due = record.verify_due_at && now ? Math.max(0, Math.ceil((Date.parse(record.verify_due_at) - now) / 1000)) : null;
  const model = laneModel(record, { kind: "verify" });
  const reply = whatsappReply(events);
  return (
    <div className="space-y-5">
      {reopened && (
        <div className="rounded-[12px] border-4 border-stop-red bg-road-white px-4 py-3" data-testid="reopened-plate">
          <StatusPlate tone="rejected">Reopened</StatusPlate>
          <p className="mt-1 text-base font-bold">
            SAP no longer shows the planned supply arriving in time. A planner needs to look at it; everything executed so
            far stays in SAP and in the audit trail.
          </p>
        </div>
      )}
      {!v && <Waiting>{due !== null ? `SIAGA re-reads SAP in ${due} s.` : "Verification runs after every action is executed."}</Waiting>}
      {model && <LaneMap model={model} />}
      {v && (
        <p className={cn("text-xl", reopened ? "font-bold text-risk-ink" : "")} data-testid="coverage">
          {thousands(v.projected_supply)} of {thousands(v.demand)} cartons {v.covered ? "covered" : "projected"}
          {risk?.deadline ? ` by the cutoff ${dayShort(record.day0, risk.deadline)}` : ""}.
        </p>
      )}
      {resolved && s && (
        <GantrySign>
          <p className="text-3xl font-black" data-testid="outcome-line">
            {juta(s.exposure_avoided)} protected for {juta(s.case_cost ?? s.chosen_cost)}
          </p>
          {clock.stoppedBy === "resolved" && <p className="mt-1 text-base">Signal to verified in {minutesSeconds(clock.seconds)}.</p>}
        </GantrySign>
      )}
      {v && (
        <ul className="space-y-1 text-base" data-testid="verify-checks">
          {v.checks.map((c) => (
            <li key={c.ref} className={cn("flex items-center gap-2", !c.ok && "font-bold text-risk-ink")}>
              {c.ok ? <Check className="size-4 text-sign-green" strokeWidth={3} aria-hidden /> : <X className="size-4" aria-hidden />}
              <span className="font-mono">{c.ref}</span>
              {c.quantity !== undefined && <span>{thousands(c.quantity)} ctn</span>}
              {c.on_time === false && <span>late</span>}
            </li>
          ))}
        </ul>
      )}
      {reply && (
        <p className="flex items-center gap-2 font-bold text-brand-ink" data-testid="planner-whatsapp-reply">
          <MessageCircle className="size-4" aria-hidden /> {reply}
        </p>
      )}
      {record.notes.map((n) => (
        <p key={n.ref} className="flex items-start gap-2 text-sm text-ink-2">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {n.text}
        </p>
      ))}
    </div>
  );
}

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-[12px] border-2 border-dashed border-curb px-4 py-6 text-base text-ink-2" data-testid="sheet-waiting">
      {children}
    </p>
  );
}

const SHEETS: Record<Stage, (p: SheetProps) => React.ReactNode> = {
  PERCEIVE: PerceiveSheet,
  ASSESS: AssessSheet,
  PLAN: PlanSheet,
  SIMULATE: SimulateSheet,
  REFLECT: ReflectSheet,
  ACT: ActSheet,
  VERIFY: VerifySheet,
};

