"use client";

import { useEffect, useState } from "react";
import { dayLabel, pct, rupiah, thousands } from "@/lib/format";
import { STAGES, type CaseEvent, type CaseRecord, type Stage } from "@/lib/types";
import { Badge, Empty, Panel, TierBadge, type Tone } from "./ui";

type StageState = "pending" | "running" | "done" | "waiting" | "escalated";

interface StageInfo {
  state: StageState;
  rounds: number;
  replans: number;
  elapsed: number;
  events: CaseEvent[];
}

const STATE_TONE: Record<StageState, Tone> = {
  pending: "slate",
  running: "sky",
  done: "emerald",
  waiting: "amber",
  escalated: "red",
};

function stageInfo(
  stage: Stage,
  events: CaseEvent[],
  record: CaseRecord,
  now: number | null,
): StageInfo {
  const evs = events.filter((e) => e.stage === stage);
  const rounds = evs.filter((e) => e.status === "started").length;
  const replans = evs.filter((e) => e.status === "completed" && e.title.includes("replanning")).length;
  let elapsed = evs
    .filter((e) => e.status === "completed")
    .reduce((s, e) => s + (Number(e.data?.elapsed_s) || 0), 0);
  const last = evs[evs.length - 1];
  let state: StageState;
  if (!last) state = "pending";
  else if (evs.some((e) => e.status === "escalated")) state = "escalated";
  else if (last.status === "scheduled") state = "waiting";
  else if (last.status === "completed" || last.status === "info" || last.status === "executed")
    state = stage === "ACT" && record.status === "AWAITING_APPROVAL" ? "waiting" : "done";
  else {
    state = "running";
    const started = [...evs].reverse().find((e) => e.status === "started");
    if (started && now) elapsed += Math.max(0, (now - Date.parse(started.ts)) / 1000);
  }
  if (state === "running" && record.status !== "RUNNING") state = "done";
  return { state, rounds, replans, elapsed, events: evs };
}

export default function StageTimeline({
  events,
  record,
}: {
  events: CaseEvent[];
  record: CaseRecord | null;
}) {
  const [open, setOpen] = useState<Stage | null>(null);
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
        <span className="text-xs text-slate-500">
          tool calls {record.tool_call_count}/20 · LLM calls {record.llm_call_count} · replans{" "}
          {record.replan_count}/2
        </span>
      }
    >
      {record.status === "ESCALATED" && (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
          <b>Escalated to a human planner:</b> {record.escalation_reason}
        </div>
      )}
      <ol className="space-y-1.5">
        {STAGES.map((stage, i) => {
          const info = stageInfo(stage, events, record, now);
          const last = [...info.events]
            .reverse()
            .find((e) => ["completed", "executed", "rejected", "scheduled"].includes(e.status));
          const isOpen = open === stage;
          return (
            <li key={stage} data-testid={`stage-${stage}`} data-state={info.state}>
              <button
                onClick={() => setOpen(isOpen ? null : stage)}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
                  info.state === "running"
                    ? "border-sky-300 bg-sky-50"
                    : info.state === "pending"
                      ? "border-slate-100 bg-slate-50/50"
                      : "border-slate-200 bg-white hover:bg-slate-50"
                }`}
              >
                <span className="w-5 text-center text-xs font-bold text-slate-400">{i + 1}</span>
                <span className="w-24 text-sm font-semibold text-slate-800">{stage}</span>
                <Badge tone={STATE_TONE[info.state]}>
                  {info.state === "running" && <Spinner />}
                  {info.state}
                </Badge>
                {info.rounds > 1 && <Badge tone="violet">×{info.rounds}</Badge>}
                {info.replans > 0 && <Badge tone="red">critic rejected → replan</Badge>}
                <span className="flex-1 truncate text-xs text-slate-600">{last?.title ?? ""}</span>
                <span className="w-14 text-right font-mono text-xs tabular-nums text-slate-500">
                  {info.state === "pending" ? "" : `${info.elapsed.toFixed(1)} s`}
                </span>
                <span className="text-slate-400">{isOpen ? "▾" : "▸"}</span>
              </button>
              {isOpen && (
                <div className="mx-2 mt-1 rounded-b-lg border border-t-0 border-slate-200 bg-slate-50/60 p-3">
                  <StageDetails stage={stage} record={record} />
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
  return <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-500" />;
}

function EventLog({ events }: { events: CaseEvent[] }) {
  const shown = events.filter((e) => e.status !== "started");
  if (!shown.length) return null;
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium text-slate-500">
        Event log ({shown.length})
      </summary>
      <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-slate-600">
        {shown.map((e) => (
          <li key={e.seq}>
            <span className="text-slate-400">#{e.seq}</span> [{e.status}] {e.title}
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
      <span className="w-36 shrink-0 text-slate-500">{k}</span>
      <span className="text-slate-900">{v}</span>
    </div>
  );
}

function StageDetails({ stage, record }: { stage: Stage; record: CaseRecord }) {
  const d0 = record.day0;
  switch (stage) {
    case "PERCEIVE": {
      const d = record.disruption;
      if (!d) return <Empty>Reading the signals…</Empty>;
      return (
        <div className="space-y-1">
          <KV k="Disruption" v={d.is_disruption ? "yes" : "no"} />
          <KV k="Cause" v={d.cause} />
          <KV k="Lane" v={d.lane ?? "-"} />
          <KV k="Location" v={d.location ?? "-"} />
          <KV k="Delay" v={d.delay_hours_min != null ? `${d.delay_hours_min}–${d.delay_hours_max} h` : "unknown"} />
          <KV k="References" v={(d.references ?? []).join(", ") || "-"} />
          <KV k="Confidence" v={pct(d.confidence)} />
          <div className="pt-1 text-xs text-slate-500">Evidence (quoted from the signals)</div>
          <ul className="space-y-0.5">
            {(d.evidence_quotes ?? []).map((q: string) => (
              <li key={q} lang="id" className="text-sm italic text-slate-700">
                “{q}”
              </li>
            ))}
          </ul>
        </div>
      );
    }
    case "ASSESS": {
      const a = record.affected;
      if (!a) return <Empty>Finding affected orders…</Empty>;
      return (
        <div className="space-y-2 text-sm">
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
    case "PLAN":
      return record.candidates.length ? (
        <ul className="space-y-1 text-sm">
          {record.candidates.map((c) => (
            <li key={c.option_id}>
              <b>{c.option_id}</b> {c.label}{" "}
              <span className="text-slate-500">[{c.strategies.join(" + ")}]</span> — {c.rationale}
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Choosing strategies…</Empty>
      );
    case "SIMULATE":
      return record.solver_results.length ? (
        <div className="space-y-2">
          {record.solver_results.map((o) => (
            <div key={o.option_id} className="text-sm">
              <div>
                <b>{o.option_id}</b> {o.label} — {o.result.status} {o.total_cost_display}
                {o.constraints.length > 0 && (
                  <span className="text-slate-500">
                    {" "}
                    (constraints: {o.constraints.map((c) => c.type + (c.supplier ? ` ${c.supplier}` : "")).join(", ")})
                  </span>
                )}
              </div>
              <table className="mt-1 w-full text-xs">
                <tbody>
                  {o.result.actions.map((a, i) => (
                    <tr key={i} className="border-t border-slate-200">
                      <td className="py-0.5 pr-2">{a.kind}</td>
                      <td className="pr-2">{a.reference}</td>
                      <td className="pr-2 text-right tabular-nums">{thousands(a.quantity)} ctn</td>
                      <td className="pr-2">{a.trucks ? `${a.trucks} trucks` : ""}</td>
                      <td className="whitespace-nowrap pr-2 text-right tabular-nums">{rupiah(a.cost)}</td>
                      <td className="text-slate-500">ETA {dayLabel(d0, a.eta)}</td>
                    </tr>
                  ))}
                  {o.result.stock_after.map((s) => (
                    <tr key={s.plant} className="border-t border-slate-200 text-slate-500">
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
                  <li key={i} className={c.passed ? "text-slate-600" : "font-semibold text-red-700"}>
                    {c.passed ? "✓" : "✗"} {c.rule}: {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {record.explanation && (
            <div className="rounded-md bg-white p-2 text-slate-700 ring-1 ring-slate-200">
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
              <span className="tabular-nums text-slate-600">{a.cost_display}</span>
              <Badge tone={a.status === "EXECUTED" ? "emerald" : a.status === "PENDING_APPROVAL" ? "amber" : "red"}>
                {a.status.replace("_", " ").toLowerCase()}
              </Badge>
              {a.sap_ref && <span className="font-mono text-xs">SAP {a.sap_ref}</span>}
            </div>
          ))}
          {record.notes.map((n) => (
            <p key={n.ref} className="text-xs text-slate-600">
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
