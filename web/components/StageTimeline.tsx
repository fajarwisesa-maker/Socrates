"use client";

import { useEffect, useState } from "react";
import { dayLabel, rupiah, thousands } from "@/lib/format";
import { escalation, notices } from "@/lib/notices";
import { FIELD, glossFor, period, STRATEGY } from "@/lib/present";
import { stageInfo, type StageState } from "@/lib/stages";
import { STAGES, type CaseEvent, type CaseRecord, type Precedent, type Stage } from "@/lib/types";
import { StateNotices } from "./StateNotices";
import { Badge, Empty, Panel, TierBadge, type Tone } from "./ui";

const STATE_TONE: Record<StageState, Tone> = {
  pending: "slate",
  running: "sky",
  done: "emerald",
  waiting: "amber",
  escalated: "red",
  failed: "red",
};

export default function StageTimeline({
  events,
  record,
  limits,
}: {
  events: CaseEvent[];
  record: CaseRecord | null;
  /** the configured budget and replan cap (from /config) */
  limits?: { tools: number; replans: number };
}) {
  // Planner mode: every stage is expanded; a click collapses one
  const [closed, setClosed] = useState<Set<Stage>>(new Set());
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, []);

  if (!record) {
    return (
      <Panel title="Live stage timeline" testId="timeline">
        <Empty>Start a case to see the agent work through its seven stages.</Empty>
      </Panel>
    );
  }

  return (
    <Panel
      title="Live stage timeline"
      testId="timeline"
      right={
        <span className="text-xs text-ink-2">
          tool calls {record.tool_call_count}/{limits?.tools ?? 20} · LLM calls {record.llm_call_count} · replans{" "}
          {record.replan_count}/{limits?.replans ?? 2}
        </span>
      }
    >
      {record.status === "REOPENED" && (
        <div className="mb-3 rounded-md border border-risk bg-risk-soft p-2.5 text-sm text-risk-ink">
          <b>Verification failed — case re-opened.</b> SAP no longer shows the planned supply
          arriving in time; a planner needs to look at it.
        </div>
      )}
      {record.status === "ESCALATED" && record.escalation_reason && (
        <div className="mb-3 rounded-md border border-risk bg-risk-soft p-2.5 text-sm text-risk-ink" data-testid="escalated-banner">
          <b>{escalation(record.escalation_reason).title}.</b> {record.escalation_reason}
        </div>
      )}
      <ol className="space-y-1.5">
        {STAGES.map((stage, i) => {
          const info = stageInfo(stage, events, record, now);
          const last = [...info.events]
            .reverse()
            .find((e) => ["completed", "executed", "rejected", "scheduled"].includes(e.status));
          const isOpen = !closed.has(stage) && info.state !== "pending";
          const toggle = () =>
            setClosed((c) => {
              const n = new Set(c);
              if (n.has(stage)) n.delete(stage);
              else n.add(stage);
              return n;
            });
          return (
            <li key={stage} data-testid={`stage-${stage}`} data-state={info.state}>
              <button
                onClick={toggle}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  info.state === "running"
                    ? "border-brand bg-brand-soft"
                    : info.state === "pending"
                      ? "border-line bg-surface-2"
                      : "border-line bg-surface hover:bg-surface-2"
                }`}
              >
                <span className="w-5 text-center text-xs font-bold text-ink-2">{i + 1}</span>
                <span className="w-24 text-sm font-semibold text-ink">{stage}</span>
                {info.events.find((e) => e.agent && e.status === "started")?.agent && (
                  <span className="w-28 truncate text-xs font-medium text-ink-2" data-testid={`agent-${stage}`}>
                    {info.events.find((e) => e.agent && e.status === "started")?.agent}
                  </span>
                )}
                <Badge tone={STATE_TONE[info.state]}>
                  {info.state === "running" && <Spinner />}
                  {info.state}
                </Badge>
                {info.rounds > 1 && <Badge tone="violet">×{info.rounds}</Badge>}
                {info.replans > 0 && <Badge tone="red">critic rejected → replan</Badge>}
                <span className="flex-1 truncate text-xs text-ink-2">
                  {stage === "VERIFY" && record.status === "VERIFYING" && record.verify_due_at && now
                    ? `Verification in ${Math.max(0, Math.ceil((Date.parse(record.verify_due_at) - now) / 1000))} s — re-reading SAP`
                    : (last?.title ?? "")}
                </span>
                <span className="w-16 text-right font-mono text-xs whitespace-nowrap text-ink-2 tabular-nums">
                  {info.state === "pending" ? "" : `${info.elapsed.toFixed(1)} s`}
                </span>
                <span className="text-ink-2">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && (
                <div className="mx-2 mt-1 space-y-3 rounded-b-lg bg-surface-2 p-3">
                  <StateNotices
                    size="planner"
                    items={notices(info.events, record, info.state === "running")}
                  />
                  <StageDetails stage={stage} record={record} events={info.events} />
                  <EventLog events={info.events} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

function Spinner() {
  return <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-brand" />;
}

function EventLog({ events }: { events: CaseEvent[] }) {
  const shown = events.filter((e) => e.status !== "started");
  if (!shown.length) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-ink-2">
        Event log ({shown.length})
      </summary>
      <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-ink-2">
        {shown.map((e) => (
          <li key={e.seq}>
            <span className="text-ink-2">#{e.seq}</span> [{e.status}] {e.title}
            {e.detail && e.status !== "completed" ? ` — ${e.detail}` : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-36 shrink-0 text-ink-2">{k}</span>
      <span className="text-ink">{v}</span>
    </div>
  );
}

function StageDetails({ stage, record, events }: { stage: Stage; record: CaseRecord; events: CaseEvent[] }) {
  const d0 = record.day0;
  switch (stage) {
    case "PERCEIVE": {
      const d = record.disruption;
      const dropped = events.flatMap(
        (e) => ((e.data as { dropped?: { quote: string }[] }).dropped ?? []) as { quote: string }[],
      );
      if (!d) return <Empty>Reading the signals…</Empty>;
      return (
        <div className="space-y-1">
          <KV k="Disruption" v={d.is_disruption ? "yes" : "no"} />
          <KV k="Cause" v={d.cause} />
          <KV k="Lane" v={d.lane ?? "-"} />
          <KV k="Location" v={d.location ?? "-"} />
          <KV k="Delay" v={d.delay_hours_min != null ? `${d.delay_hours_min}–${d.delay_hours_max} h` : "unknown"} />
          <KV k="References" v={(d.references ?? []).join(", ") || "-"} />
          <KV
            k="Confidence"
            v={
              d.confidence_basis?.progression && d.confidence_basis.progression.length > 1
                ? d.confidence_basis.progression.map((p) => p.label).join(" → ")
                : d.confidence
            }
          />
          <div className="pt-1 text-xs text-ink-2">
            Evidence located in the signals by code (quotes the model named; offsets checked)
          </div>
          <ul className="space-y-0.5">
            {(d.evidence ?? []).map((e) => (
              <li key={`${e.signal}:${e.start}`} className="text-sm text-ink">
                <span lang="id" className="italic">“{e.text}”</span>{" "}
                {glossFor(e) && <span lang="en">({glossFor(e)})</span>}{" "}
                <span className="text-ink-2">
                  · {e.source === "pdf" ? "PDF" : "WhatsApp"} → {FIELD[e.field] ?? e.field}
                </span>
              </li>
            ))}
          </ul>
          {dropped.length > 0 && (
            <p className="text-xs text-risk-ink">
              Dropped (not found in the signal): {dropped.map((x) => `“${x.quote}”`).join(", ")}
            </p>
          )}
        </div>
      );
    }
    case "ASSESS": {
      const a = record.affected;
      if (!a) return <Empty>Finding affected orders…</Empty>;
      const note = events.find((e) => e.status === "completed")?.data.impact_note as string | undefined;
      return (
        <div className="space-y-2 text-sm">
          {note && (
            <div className="rounded-md bg-surface p-2 text-ink ring-1 ring-line" data-testid="impact-note">
              <div className="text-xs text-ink-2">Impact Agent (written by the model; numbers from the risk function)</div>
              {note}
            </div>
          )}
          <div>
            <b>Inbound POs on the lane:</b>{" "}
            {(a.purchase_orders ?? [])
              .map(
                (p) =>
                  `${p.PurchaseOrder} (${p.Supplier}, ${p.items
                    .map((i) => `${thousands(i.OrderQuantity)} ${i.Material} → ${i.Plant}`)
                    .join(", ")})`,
              )
              .join("; ")}
          </div>
          <div>
            <b>Stock at {a.plant}:</b> on hand {a.stock?.OnHandQuantity}, safety stock{" "}
            {a.stock?.SafetyStockQuantity}
          </div>
          <div>
            <b>Customer orders:</b>{" "}
            {(a.sales_orders ?? [])
              .map((s) => `${s.SalesOrder} ${s.YY1_SoldToPartyName} ${s.RequestedQuantity}`)
              .join("; ")}
          </div>
          {record.risk && (
            <div>
              <b>Deadline:</b> {dayLabel(d0, record.risk.deadline)}
            </div>
          )}
        </div>
      );
    }
    case "PLAN": {
      const precedents = events
        .filter((e) => e.status === "completed")
        .flatMap((e) => (e.data.precedents as Precedent[] | undefined) ?? []);
      return record.candidates.length ? (
        <div className="space-y-2 text-sm">
          <ul className="space-y-1">
            {record.candidates.map((c) => (
              <li key={c.option_id}>
                <b>{c.option_id}</b> {c.label}{" "}
                <span className="text-ink-2">[{c.strategies.map((x) => STRATEGY[x] ?? x).join(" + ")}]</span> —{" "}
                {c.rationale}
              </li>
            ))}
          </ul>
          {precedents.length > 0 && (
            <div data-testid="planner-precedents">
              <div className="text-xs text-ink-2">Precedents cited (from the knowledge base search)</div>
              <ul className="space-y-0.5">
                {precedents.map((p) => (
                  <li key={p.id}>
                    {p.synthetic && <Badge>synthetic precedent</Badge>} <b>{p.id}</b> {p.title}
                    {p.period && <span className="text-ink-2"> · {period(p.period)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <Empty>Choosing strategies…</Empty>
      );
    }
    case "SIMULATE":
      return record.solver_results.length ? (
        <div className="space-y-2">
          {record.solver_results.map((o) => (
            <div key={o.option_id} className="text-sm">
              <div>
                <b>{o.option_id}</b> {o.label} — {o.result.status} {o.total_cost_display}
                {o.constraints.length > 0 && (
                  <span className="text-ink-2">
                    {" "}
                    (constraints: {o.constraints.map((c) => c.type + (c.supplier ? ` ${c.supplier}` : "")).join(", ")})
                  </span>
                )}
              </div>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {o.result.actions.map((a, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="py-0.5 pr-2">{a.kind}</td>
                      <td className="pr-2">{a.reference}</td>
                      <td className="pr-2 text-right tabular-nums">{thousands(a.quantity)} ctn</td>
                      <td className="pr-2">{a.trucks ? `${a.trucks} trucks` : ""}</td>
                      <td className="whitespace-nowrap pr-2 text-right tabular-nums">{rupiah(a.cost)}</td>
                      <td className="text-ink-2">ETA {dayLabel(d0, a.eta)}</td>
                    </tr>
                  ))}
                  {o.result.stock_after.map((s) => (
                    <tr key={s.plant} className="border-t border-line text-ink-2">
                      <td colSpan={6}>
                        {s.plant} after: {s.on_hand_after} (safety {s.safety_stock})
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      ) : (
        <Empty>Running the solver…</Empty>
      );
    case "REFLECT":
      return record.critic_findings.length ? (
        <div className="space-y-2 text-sm">
          {record.critic_findings.map((f) => (
            <div key={f.option_id}>
              <b>{f.option_id}</b>{" "}
              {f.clean ? <Badge tone="emerald">passes</Badge> : <Badge tone="red">rejected</Badge>}
              <ul className="mt-0.5 text-xs">
                {f.checks.map((c, i) => (
                  <li key={i} className={c.passed ? "text-ink-2" : "font-semibold text-risk-ink"}>
                    {c.passed ? "✓" : "✗"} {c.plain || c.detail}{" "}
                    <span className="font-mono font-normal text-ink-2">[{c.rule}]</span>
                  </li>
                ))}
              </ul>
              {f.explanation && (
                <p className="mt-0.5 text-xs text-ink" data-testid={`critic-note-${f.option_id}`}>
                  <span className="text-ink-2">Critic Agent (model-written): </span>
                  {f.explanation}
                </p>
              )}
            </div>
          ))}
          {record.explanation && (
            <div className="rounded-md bg-surface p-2 text-ink ring-1 ring-line">
              <div className="text-xs text-ink-2">Explanation written by the model (numbers from the solver)</div>
              {record.explanation.summary}
            </div>
          )}
        </div>
      ) : (
        <Empty>Checking business rules…</Empty>
      );
    case "ACT":
      return record.actions.length ? (
        <div className="space-y-1.5 text-sm">
          {record.actions.map((a) => (
            <div key={a.action_id} className="flex flex-wrap items-center gap-2">
              <TierBadge tier={a.tier} />
              <span>{a.description}</span>
              <span className="tabular-nums text-ink-2">{a.cost_display}</span>
              <Badge tone={a.status === "EXECUTED" ? "emerald" : a.status === "PENDING_APPROVAL" ? "amber" : "red"}>
                {a.status.replace("_", " ").toLowerCase()}
              </Badge>
              {a.sap_ref && <span className="font-mono text-xs">SAP {a.sap_ref}</span>}
              {a.rejection_reason && (
                <span className="text-xs text-risk-ink" lang="id">
                  “{a.rejection_reason}”
                </span>
              )}
            </div>
          ))}
          {record.notes.map((n) => (
            <p key={n.ref} className="text-xs text-ink-2">
              <Badge>Tier 0 note</Badge> {n.text}
            </p>
          ))}
        </div>
      ) : (
        <Empty>No actions yet.</Empty>
      );
    case "VERIFY": {
      const v = record.verification;
      if (!v) return <Empty>Verification runs after all actions are executed.</Empty>;
      return (
        <div className="space-y-1 text-sm">
          {v.checks.map((c) => (
            <div key={c.ref}>
              {c.ok ? "✓" : "✗"} {c.ref}: {c.quantity ?? ""} {c.on_time === false ? "(late)" : ""}
            </div>
          ))}
          <div>
            Projected usable supply <b>{v.projected_supply}</b> vs demand <b>{v.demand}</b> →{" "}
            {v.covered ? <Badge tone="emerald">covered</Badge> : <Badge tone="red">not covered</Badge>}
          </div>
        </div>
      );
    }
  }
}
