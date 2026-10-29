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
import { juta, rupiah } from "@/lib/format";
import { useCountUp } from "@/lib/motion";
import { agentsByStage } from "@/lib/present";
import { stageInfo, STAGE_LABEL, STAGES } from "@/lib/stages";
import type { Approval, CaseEvent, CaseRecord, Config, Stage } from "@/lib/types";
import type { AuditData } from "@/lib/useInbox";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { CARD, GantrySign, KmPost, RoadLine, RouteShield, SignHeading, StatusPlate, WarningPlate } from "../signs";
import { Figure } from "../Figure";
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
    <main className="mx-auto flex max-w-[1440px] flex-col gap-8 px-8 py-8" data-testid="case-file">
      <CaseSign record={record} approvals={approvals} now={now} />
      <div role="tablist" aria-label="Case file" className="-mt-4 flex gap-6 shadow-[inset_0_-1px_0_var(--hairline)]">
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
              "min-h-11 text-sm font-black tracking-[0.1em] uppercase transition-[color,box-shadow] duration-[var(--dur-fast)]",
              tab === id ? "text-asphalt shadow-[inset_0_-4px_0_var(--asphalt)]" : "text-ink-2 hover:text-asphalt",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "audit" ? (
        <AuditView caseId={record.case_id} version={events.length} defaultOpen />
      ) : tab === "architecture" ? (
        <section className={cn(CARD, "p-6")} data-testid="architecture-panel">
          <ArchitectureView config={config} record={record} />
        </section>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[184px_minmax(0,1fr)] xl:grid-cols-[184px_minmax(0,1fr)_264px]">
          <KmRail
            record={record}
            events={events}
            shown={shown}
            onPick={(stage) => setPicked({ caseId: record.case_id, stage })}
            agents={agents}
            now={now}
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
            onNext={() => setPicked({ caseId: record.case_id, stage: "VERIFY" })}
          />
          <Margin
            record={record}
            events={events}
            audit={audit}
            onAudit={() => onTab("audit")}
            limits={config ? { tools: config.max_tool_calls, replans: config.max_replans } : undefined}
          />
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
    <GantrySign as="header" testId="case-sign">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
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
      <div className="mt-4 flex flex-wrap items-center gap-4">
        {cause && (
          <WarningPlate size="sm">
            <span className="sign-label text-xs">{cause}</span>
          </WarningPlate>
        )}
        {record.pii && (
          <span
            data-testid="pii-chip"
            className="rounded-[6px] bg-road-white px-2 py-1 text-xs font-bold text-sign-green"
            title="Masked before any model call; the original text is in the audit trail only."
          >
            {record.pii.masked ? `PII masked · ${record.pii.masked}` : "PII check · nothing to mask"}
          </span>
        )}
        <span className="ml-auto" data-testid="case-status" data-status={record.status}>
          {record.status === "AWAITING_APPROVAL" ? (
            <WarningPlate size="md" className="px-4 font-black">
              <span className="sign-label text-sm">Needs you{left ? ` · ${left.expired ? "expired" : left.text}` : ""}</span>
            </WarningPlate>
          ) : record.status === "RESOLVED" ? (
            <StatusPlate tone="verified" className="px-4 text-sm" icon={<Check className="size-4" strokeWidth={3} aria-hidden />}>
              Resolved
            </StatusPlate>
          ) : record.status === "REOPENED" ? (
            <StatusPlate tone="rejected" className="px-4 text-sm">
              Reopened
            </StatusPlate>
          ) : record.status === "ESCALATED" ? (
            <StatusPlate tone="escalated" className="px-4 text-sm">
              Escalated
            </StatusPlate>
          ) : record.status === "VERIFYING" ? (
            <StatusPlate tone="running" className="px-4 text-sm">
              Verifying
            </StatusPlate>
          ) : (
            <StatusPlate tone="running" className="px-4 text-sm">
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
}: {
  record: CaseRecord;
  events: CaseEvent[];
  shown: Stage;
  onPick: (s: Stage) => void;
  agents: Partial<Record<Stage, string>>;
  now: number | null;
}) {
  return (
    <nav aria-label="Route of the case" data-testid="timeline" className="min-w-0">
      <SignHeading className="mb-4">Route</SignHeading>
      <ol className="flex flex-wrap gap-2 lg:flex-col lg:flex-nowrap lg:gap-0">
        {STAGES.map((stage, i) => {
          const info = stageInfo(stage, events, record, now);
          const post = postState(stage, info.state, events, record);
          const note = stageNote(stage, record, events, now);
          // a note only where the planner should look: the current stage and a flagged one
          const current = info.state === "running" || info.state === "waiting";
          const showNote = note && (current || note.tone === "risk");
          const isShown = stage === shown;
          return (
            <li key={stage} data-testid={`stage-${stage}`} data-state={info.state} className="relative shrink-0">
              <button
                type="button"
                onClick={() => onPick(stage)}
                disabled={info.state === "pending"}
                aria-current={isShown ? "step" : undefined}
                className={cn(
                  "flex w-full min-w-40 items-center gap-4 rounded-[10px] p-1 text-left disabled:cursor-default",
                  "transition-[background-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-standard)]",
                  isShown ? "bg-road-white inset-ring inset-ring-hairline" : "hover:bg-surface-2",
                )}
              >
                <KmPost n={i + 1} state={post} />
                <span className="min-w-0">
                  <span className={cn("block text-base font-black", info.state === "pending" && "text-ink-2")}>
                    {STAGE_LABEL[stage]}
                  </span>
                  {/* the agent is named in the stage heading; screen readers hear it here */}
                  {agents[stage] && (
                    <span className="sr-only" data-testid={`agent-${stage}`}>
                      {agents[stage]}
                    </span>
                  )}
                  {showNote && (
                    <span
                      className={cn(
                        "block font-mono text-xs",
                        note.tone === "risk" ? "font-bold text-risk-ink" : note.tone === "needs" ? "font-bold text-asphalt" : "text-ink-2",
                      )}
                    >
                      {note.text}
                    </span>
                  )}
                </span>
              </button>
              {i < STAGES.length - 1 && <RoadLine vertical className="ml-[1.3rem] hidden h-2 lg:block" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ------------------------------------------------------------------ margin

function Margin({
  record,
  events,
  audit,
  onAudit,
  limits,
}: {
  record: CaseRecord;
  events: CaseEvent[];
  audit: AuditData | null;
  onAudit: () => void;
  limits?: { tools: number; replans: number };
}) {
  const risk = record.risk;
  const s = record.summary;
  const escalated = record.status === "ESCALATED";
  const reopened = record.status === "REOPENED";
  const rejection = events.filter((e) => e.stage === "REFLECT" && e.status === "completed" && e.data.rejected).at(-1);
  const rejectedId = rejection?.data.rejected as string | undefined;
  const finding = record.critic_findings.find((f) => f.option_id === rejectedId);
  const failed = finding?.checks.filter((c) => !c.passed) ?? [];
  const d = record.disruption;
  const v = audit?.verification;
  const cost = s && !escalated ? (s.case_cost ?? s.chosen_cost) : null;
  const net = s && !escalated ? s.net_protected : null;
  const id = (k: string) => `planner-${record.case_id}-${k}`;
  return (
    <aside className="flex flex-col gap-6 lg:col-span-2 xl:col-span-1" data-testid="margin">
      {/* three numbers and the solver label, nothing else */}
      <GantrySign flat label="Impact" testId="impact" className="flex flex-col gap-2">
        <Row k="At risk" value={risk?.max_exposure ?? null} id={id("at-risk")} testId="exposure" />
        <Row k="Plan cost" value={cost} id={id("plan-cost")} />
        <Row
          k="Net protected"
          value={net}
          id={id("net")}
          highlight={!reopened}
          struck={reopened}
          status={
            net === null
              ? null
              : record.status === "RESOLVED"
                ? "verified in SAP"
                : reopened
                  ? "not confirmed: verification failed"
                  : "once the plan is verified"
          }
        />
        <p className="text-xs font-bold">Calculated by the solver, not AI.</p>
      </GantrySign>

      {finding && failed.length > 0 && (
        <div className={cn(CARD, "flex flex-col gap-2 p-6")} data-testid="critic-plate">
          <StatusPlate tone="rejected" className="self-start">
            Critic rejected {rejectedId}
          </StatusPlate>
          <p className="text-sm">{failed.map((c) => c.plain || c.detail).join("; ")}.</p>
          {record.replan_count > 0 && <p className="text-sm text-ink-2">SIAGA added a rule and replanned.</p>}
        </div>
      )}

      {d && (
        <div data-testid="margin-confidence" className="flex flex-col gap-1">
          <SignHeading>Confidence</SignHeading>
          <p className="text-2xl font-black uppercase">{d.confidence}</p>
          <p className="text-sm text-ink-2">
            {(d.confidence_basis?.progression?.length ?? 0) > 1 ? "Medium from the WhatsApp; the forwarder notice agrees." : "From one signal."}
          </p>
        </div>
      )}

      {v && (
        <div className="flex flex-col gap-1">
          <span
            data-testid="audit-status"
            className={cn("flex items-center gap-2 text-sm font-black tracking-[0.06em] uppercase", v.ok ? "text-brand-ink" : "text-risk-ink")}
          >
            {v.ok && <Check className="size-4" strokeWidth={3} aria-hidden />}
            {v.ok ? `hash chain verified · ${v.entries} entries` : `chain broken at #${v.broken_at} (${v.reason})`}
          </span>
          <Button variant="link" className="self-start text-sm" onClick={onAudit}>
            Show {audit?.entries.length ?? v.entries} entries
          </Button>
        </div>
      )}
      <p className="font-mono text-xs text-ink-2" data-testid="budget">
        Tool calls {record.tool_call_count}/{limits?.tools ?? 20} · model calls {record.llm_call_count} · replans{" "}
        {record.replan_count}/{limits?.replans ?? 2}
      </p>
    </aside>
  );
}

/** One impact number: counts up once on first display, ends on the exact formatted value. */
function Row({
  k,
  value,
  id,
  highlight,
  struck,
  status,
  testId,
}: {
  k: string;
  value: number | null;
  id: string;
  highlight?: boolean;
  struck?: boolean;
  /** said to screen readers only (the panel shows numbers) */
  status?: string | null;
  testId?: string;
}) {
  const shown = useCountUp(value, juta, { id });
  return (
    <div className="flex flex-col gap-1 border-b border-white/30 pb-2">
      <span className="text-sm font-bold">{k}</span>
      <span
        className={cn(
          "self-start text-3xl font-black whitespace-nowrap",
          value !== null && highlight && "text-signal-yellow",
          value === null && "text-base font-bold text-sign-green-tint",
          struck && "line-through decoration-2",
        )}
        title={value !== null ? rupiah(value) : undefined}
      >
        {value === null ? "Not yet" : <Figure shown={shown ?? juta(value)} final={juta(value)} />}
        {value !== null && (
          <span className="sr-only">
            {" "}
            (<span data-testid={testId}>{rupiah(value)}</span>
            {status ? `, ${status}` : ""})
          </span>
        )}
      </span>
    </div>
  );
}
