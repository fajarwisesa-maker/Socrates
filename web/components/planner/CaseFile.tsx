"use client";

// The case file (docs/redesign-prompt.md 6.3): case sign across the top, the KM rail on the
// left, one stage sheet in the centre, the margin on the right (impact, Critic, confidence,
// audit). The sheet follows the case unless the planner picks a stage on the rail.
import { Check } from "lucide-react";
import { useState } from "react";
import ArchitectureView from "@/components/ArchitectureView";
import AuditView from "@/components/AuditView";
import {
  caseTitle,
  causeSign,
  countdown,
  laneCode,
  liveStage,
  postState,
  shortId,
  stageNote,
} from "@/lib/caseView";
import { juta, pct, rupiah, thousands } from "@/lib/format";
import { agentsByStage } from "@/lib/present";
import { stageInfo, STAGE_LABEL, STAGES } from "@/lib/stages";
import type { Approval, CaseEvent, CaseRecord, Config, Stage } from "@/lib/types";
import type { AuditData } from "@/lib/useInbox";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { GantrySign, KmPost, RoadLine, RouteShield, SignHeading, StatusPlate, WarningPlate } from "../signs";
import { StageSheet } from "./sheets";

export type CaseTab = "stages" | "audit" | "architecture";

export function CaseFile({
  record,
  events,
  approvals,
  config,
  audit,
  tab,
  onTab,
  onDecided,
}: {
  record: CaseRecord;
  events: CaseEvent[];
  approvals: Approval[];
  config: Config | null;
  audit: AuditData | null;
  tab: CaseTab;
  onTab: (t: CaseTab) => void;
  onDecided: () => void;
}) {
  const now = useNow(1000);
  // null = follow the case; a stage = the planner picked it on the rail
  const [picked, setPicked] = useState<{ caseId: string; stage: Stage } | null>(null);
  const live = liveStage(record, events);
  const shown = picked && picked.caseId === record.case_id ? picked.stage : live;
  const agents = agentsByStage(events, config);
  const stageEvents = events.filter((e) => e.stage === shown);

  return (
    <main className="mx-auto max-w-[1440px] space-y-5 px-6 py-6" data-testid="case-file">
      <CaseSign record={record} approvals={approvals} now={now} />
      <div role="tablist" aria-label="Case file" className="flex gap-6 border-b-2 border-curb">
        {(
          [
            ["stages", "Stages"],
            ["audit", "Audit trail"],
            ["architecture", "Architecture"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            data-testid={`planner-tab-${id === "stages" ? "case" : id}`}
            onClick={() => onTab(id)}
            className={cn(
              "-mb-[2px] min-h-11 border-b-4 text-sm font-black tracking-[0.1em] uppercase",
              tab === id ? "border-asphalt text-asphalt" : "border-transparent text-ink-2 hover:text-asphalt",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "audit" ? (
        <AuditView caseId={record.case_id} version={events.length} defaultOpen />
      ) : tab === "architecture" ? (
        <section className="rounded-[12px] border-2 border-asphalt bg-road-white p-4" data-testid="architecture-panel">
          <ArchitectureView config={config} record={record} />
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_300px]">
          <KmRail
            record={record}
            events={events}
            shown={shown}
            onPick={(stage) => setPicked({ caseId: record.case_id, stage })}
            agents={agents}
            now={now}
            limits={config ? { tools: config.max_tool_calls, replans: config.max_replans } : undefined}
          />
          <StageSheet
            stage={shown}
            agent={agents[shown]}
            record={record}
            events={stageEvents}
            allEvents={events}
            approvals={approvals}
            live={shown === live}
            onDecided={() => {
              // keep the decision on screen while the case moves on
              setPicked({ caseId: record.case_id, stage: "ACT" });
              onDecided();
            }}
          />
          <Margin record={record} events={events} audit={audit} onAudit={() => onTab("audit")} />
        </div>
      )}
    </main>
  );
}

// ------------------------------------------------------------------ case sign

function CaseSign({ record, approvals, now }: { record: CaseRecord; approvals: Approval[]; now: number | null }) {
  const lane = laneCode(record);
  const cause = causeSign(record);
  const d = record.disruption;
  const po = d?.references[0];
  const next = approvals
    .filter((a) => a.status === "PENDING" && a.card.approve_by)
    .map((a) => a.card.approve_by!)
    .sort()[0];
  const left = countdown(next, now);
  const replanning = record.status === "RUNNING" && approvals.some((a) => a.status === "REJECTED");
  return (
    <GantrySign as="header" className="px-6 py-5" testId="case-sign">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {lane && <RouteShield code={lane} className="text-base" />}
        <h1 className="text-3xl font-black" data-testid="case-title">
          {caseTitle(record)}
        </h1>
        <span className="font-mono text-xs tracking-[0.08em] uppercase">
          Case {shortId(record.case_id)}
          {po && ` · PO ${po}`}
          {d?.delay_hours_min != null && ` · delay ${d.delay_hours_min} to ${d.delay_hours_max} h`}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {cause && (
          <WarningPlate size="sm">
            <span className="sign-label text-xs">{cause}</span>
          </WarningPlate>
        )}
        {record.pii && (
          <span
            data-testid="pii-chip"
            className="rounded-[4px] border-2 border-white px-2 py-0.5 text-xs font-bold"
            title="Masked before any model call; the original text is in the audit trail only."
          >
            {record.pii.masked ? `PII masked · ${record.pii.masked}` : "PII check · nothing to mask"}
          </span>
        )}
        <span className="ml-auto" data-testid="case-status" data-status={record.status}>
          {record.status === "AWAITING_APPROVAL" ? (
            <WarningPlate size="md" className="font-black">
              <span className="sign-label text-sm">Needs you{left ? ` · ${left.expired ? "expired" : left.text}` : ""}</span>
            </WarningPlate>
          ) : record.status === "RESOLVED" ? (
            <StatusPlate tone="verified" className="px-3 py-1 text-sm" icon={<Check className="size-4" strokeWidth={3} aria-hidden />}>
              Resolved
            </StatusPlate>
          ) : record.status === "REOPENED" ? (
            <StatusPlate tone="rejected" className="border-white px-3 py-1 text-sm">
              Reopened
            </StatusPlate>
          ) : record.status === "ESCALATED" ? (
            <StatusPlate tone="escalated" className="border-white px-3 py-1 text-sm">
              Escalated
            </StatusPlate>
          ) : record.status === "VERIFYING" ? (
            <StatusPlate tone="running" className="px-3 py-1 text-sm">
              Verifying
            </StatusPlate>
          ) : (
            <StatusPlate tone="running" className="px-3 py-1 text-sm">
              {replanning ? "Replanning" : "Running"}
            </StatusPlate>
          )}
        </span>
      </div>
    </GantrySign>
  );
}

// ------------------------------------------------------------------ KM rail

function KmRail({
  record,
  events,
  shown,
  onPick,
  agents,
  now,
  limits,
}: {
  record: CaseRecord;
  events: CaseEvent[];
  shown: Stage;
  onPick: (s: Stage) => void;
  agents: Partial<Record<Stage, string>>;
  now: number | null;
  limits?: { tools: number; replans: number };
}) {
  return (
    <nav aria-label="Route of the case" data-testid="timeline" className="min-w-0">
      <SignHeading className="mb-3">Route</SignHeading>
      <ol className="flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap lg:gap-0">
        {STAGES.map((stage, i) => {
          const info = stageInfo(stage, events, record, now);
          const post = postState(stage, info.state, events, record);
          const note = stageNote(stage, record, events, now);
          const isShown = stage === shown;
          return (
            <li key={stage} data-testid={`stage-${stage}`} data-state={info.state} className="relative shrink-0">
              <button
                type="button"
                onClick={() => onPick(stage)}
                disabled={info.state === "pending"}
                aria-current={isShown ? "step" : undefined}
                className={cn(
                  "flex w-full min-w-40 items-start gap-3 rounded-[10px] border-2 p-1.5 text-left disabled:cursor-default",
                  isShown ? "border-asphalt bg-road-white shadow-[var(--shadow-sign)]" : "border-transparent hover:bg-surface-2",
                )}
              >
                <KmPost n={i + 1} state={post} />
                <span className="min-w-0 pt-0.5">
                  <span className={cn("block text-base font-black", info.state === "pending" && "text-ink-2")}>{STAGE_LABEL[stage]}</span>
                  {agents[stage] && (
                    <span className="block text-xs text-ink-2" data-testid={`agent-${stage}`}>
                      {agents[stage]}
                    </span>
                  )}
                  {note && (
                    <span
                      className={cn(
                        "block font-mono text-xs",
                        note.tone === "risk" ? "font-bold text-risk-ink" : note.tone === "needs" ? "font-bold text-asphalt" : note.tone === "ok" ? "font-bold text-brand-ink" : "text-ink-2",
                      )}
                    >
                      {note.text}
                    </span>
                  )}
                </span>
              </button>
              {i < STAGES.length - 1 && <RoadLine vertical className="ml-[1.4rem] hidden h-3 lg:block" />}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 font-mono text-xs text-ink-2" data-testid="budget">
        Tool calls {record.tool_call_count}/{limits?.tools ?? 20} · model calls {record.llm_call_count} · replans{" "}
        {record.replan_count}/{limits?.replans ?? 2}
      </p>
    </nav>
  );
}

// ------------------------------------------------------------------ margin

function Margin({
  record,
  events,
  audit,
  onAudit,
}: {
  record: CaseRecord;
  events: CaseEvent[];
  audit: AuditData | null;
  onAudit: () => void;
}) {
  const risk = record.risk;
  const s = record.summary;
  const escalated = record.status === "ESCALATED";
  const rejection = events.filter((e) => e.stage === "REFLECT" && e.status === "completed" && e.data.rejected).at(-1);
  const rejectedId = rejection?.data.rejected as string | undefined;
  const finding = record.critic_findings.find((f) => f.option_id === rejectedId);
  const failed = finding?.checks.filter((c) => !c.passed) ?? [];
  const d = record.disruption;
  const v = audit?.verification;
  const maxP = risk ? Math.max(...risk.orders.map((o) => o.stockout_probability)) : 0;
  return (
    <aside className="space-y-5 lg:col-span-2 xl:col-span-1" data-testid="margin">
      <GantrySign label="Impact" testId="impact">
        <div className="sign-label mb-2 text-xs">Impact</div>
        <Row k="At risk" v={risk ? juta(risk.max_exposure) : "—"} exact={risk ? rupiah(risk.max_exposure) : null} testId="exposure" />
        {s && !escalated ? (
          <>
            <Row k="Plan cost" v={juta(s.case_cost ?? s.chosen_cost)} exact={rupiah(s.case_cost ?? s.chosen_cost)} />
            <Row
              k="Net protected"
              v={juta(s.net_protected)}
              exact={
                record.status === "RESOLVED"
                  ? "verified in SAP"
                  : record.status === "REOPENED"
                    ? "not confirmed: verification failed"
                    : "once the plan is verified"
              }
              highlight={record.status !== "REOPENED"}
              struck={record.status === "REOPENED"}
            />
          </>
        ) : (
          risk && (
            <>
              <Row k="Shortfall" v={`${thousands(risk.shortfall)} ctn`} />
              <Row k="Stockout chance" v={pct(maxP)} />
            </>
          )
        )}
        <p className="mt-2 text-xs font-bold">Calculated by the solver, not AI.</p>
      </GantrySign>

      {finding && failed.length > 0 && (
        <div className="rounded-[12px] border-4 border-stop-red bg-road-white px-4 py-3" data-testid="critic-plate">
          <StatusPlate tone="rejected">Critic rejected {rejectedId}</StatusPlate>
          <p className="mt-2 text-sm">{failed.map((c) => c.plain || c.detail).join("; ")}.</p>
          {record.replan_count > 0 && (
            <p className="mt-1 text-sm text-ink-2">
              SIAGA added a rule and replanned ({record.replan_count} of the limit).
            </p>
          )}
        </div>
      )}

      {d && (
        <div data-testid="margin-confidence">
          <SignHeading>Confidence</SignHeading>
          <p className="text-2xl font-black uppercase">{d.confidence}</p>
          <p className="text-sm text-ink-2">
            {(d.confidence_basis?.progression?.length ?? 0) > 1
              ? "The WhatsApp alone gave Medium. The forwarder notice agrees."
              : "From one signal."}
          </p>
        </div>
      )}

      {v && (
        <div className="space-y-1">
          <span
            data-testid="audit-status"
            className={cn("flex items-center gap-1.5 text-sm font-black tracking-[0.06em] uppercase", v.ok ? "text-brand-ink" : "text-risk-ink")}
          >
            {v.ok && <Check className="size-4" strokeWidth={3} aria-hidden />}
            {v.ok ? `hash chain verified · ${v.entries} entries` : `chain broken at #${v.broken_at} (${v.reason})`}
          </span>
          <button onClick={onAudit} className="min-h-11 text-sm font-bold text-brand-ink underline">
            Show {audit?.entries.length ?? v.entries} entries
          </button>
        </div>
      )}
    </aside>
  );
}

function Row({
  k,
  v,
  exact,
  highlight,
  struck,
  testId,
}: {
  k: string;
  v: string;
  exact?: string | null;
  highlight?: boolean;
  struck?: boolean;
  testId?: string;
}) {
  return (
    <div className="border-b-2 border-white/60 py-2 last-of-type:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-base font-bold">{k}</span>
        <span className={cn("text-2xl font-black whitespace-nowrap", highlight && "text-signal-yellow", struck && "line-through decoration-2")}>
          {v}
        </span>
      </div>
      {exact && (
        <div className="text-right font-mono text-xs">
          <span data-testid={testId}>{exact}</span>
        </div>
      )}
    </div>
  );
}
