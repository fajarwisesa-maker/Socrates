"use client";

import { useState } from "react";
import { dayLabel } from "@/lib/format";
import type { CaseState } from "@/lib/useCase";
import ApprovalCards from "./ApprovalCards";
import ArchitectureView from "./ArchitectureView";
import AuditView from "./AuditView";
import DemoClock from "./DemoClock";
import ImpactPanel from "./ImpactPanel";
import OptionsTable from "./OptionsTable";
import SignalInbox from "./SignalInbox";
import StageTimeline from "./StageTimeline";
import { Wordmark } from "./presenter/Wordmark";
import { Badge, Panel } from "./ui";

/** Planner mode: the dense view for Q&A on a laptop (cleaned up in redesign step 5). */
export default function PlannerView({
  state,
  modeSwitch,
}: {
  state: CaseState;
  modeSwitch: React.ReactNode;
}) {
  const { config, caseId, record, approvals, events, apiDown, running, follow, reset } = state;
  const [tab, setTab] = useState<"case" | "architecture">("case");
  return (
    <main className="mx-auto max-w-[1600px] p-5" data-testid="planner">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Wordmark />
            {config?.replay && (
              <span
                data-testid="replay-badge"
                title={
                  config.replay_source
                    ? `Recorded ${config.replay_source.recorded_at} from ${config.replay_source.provider}` +
                      (config.replay_source.model ? ` (${config.replay_source.model})` : "")
                    : "Recorded run"
                }
              >
                <Badge tone="violet">
                  REPLAY · recorded run{config.replay_source ? ` (${config.replay_source.provider})` : ""}
                </Badge>
              </span>
            )}
            {config && <Badge tone="slate">LLM: {config.llm_provider}</Badge>}
            {record && <StatusBadge status={record.status} />}
            {record?.pii && (
              <span
                data-testid="pii-chip"
                title={`Masked before any model call (${record.pii.mode}): ${
                  Object.entries(record.pii.kinds)
                    .map(([k, n]) => `${n} ${k}`)
                    .join(", ") || "nothing found"
                }. The original text is in the audit trail only.`}
              >
                <Badge tone={record.pii.masked ? "emerald" : "slate"}>
                  {record.pii.masked ? `PII masked · ${record.pii.masked}` : "PII check · nothing to mask"}
                </Badge>
              </span>
            )}
          </div>
          <p className="text-sm text-ink-2">
            Supply Intelligence Agent for Guarding Availability · supervised agent, deterministic numbers
          </p>
          {record?.day0 && (
            <p className="text-xs text-ink-2">Day 0 = {dayLabel(null, record.day0).replace(" 00:00", "")} (midnight WIB)</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {modeSwitch}
          <DemoClock events={events} compact />
          <button
            data-testid="reset"
            onClick={reset}
            className="rounded-[var(--radius-control)] border-2 border-line bg-surface px-3 py-2 text-sm font-medium text-ink-2 hover:bg-surface-2"
          >
            Reset demo
          </button>
        </div>
      </header>

      {apiDown && (
        <div className="mb-4 rounded-md border border-human bg-human-soft p-2.5 text-sm text-human-ink">
          Cannot reach the Case API. Is <code>make api</code> running? Retrying every second…
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="min-w-0 space-y-4">
          <div className="flex gap-1 border-b-2 border-surface-2" role="tablist" aria-label="Planner view">
            {(
              [
                ["case", "Case"],
                ["architecture", "Architecture"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={tab === id}
                data-testid={`planner-tab-${id}`}
                onClick={() => setTab(id)}
                className={`-mb-[2px] border-b-2 px-3 py-1.5 text-sm font-semibold ${
                  tab === id ? "border-brand text-ink" : "border-transparent text-ink-2"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "architecture" ? (
            <Panel title="Architecture · live path of this run" testId="architecture-panel">
              <ArchitectureView config={config} record={record} />
            </Panel>
          ) : (
            <>
              <StageTimeline
                events={events}
                record={record}
                limits={config ? { tools: config.max_tool_calls, replans: config.max_replans } : undefined}
              />
              <OptionsTable record={record} />
              <AuditView caseId={caseId} version={events.length} />
            </>
          )}
        </div>
        <div className="space-y-4">
          {record?.status === "AWAITING_APPROVAL" && <ApprovalCards record={record} approvals={approvals} />}
          {!record && <SignalInbox onStarted={follow} disabled={running} />}
          <ImpactPanel record={record} />
          {record?.status !== "AWAITING_APPROVAL" && <ApprovalCards record={record} approvals={approvals} />}
          {record?.explanation && (
            <section className="rounded-[var(--radius-card)] bg-surface p-4 text-sm shadow-[var(--shadow-card)]">
              <h2 className="mb-1 text-sm font-semibold tracking-wide text-ink-2 uppercase">Agent explanation</h2>
              <p className="mb-1 text-xs text-ink-2">Written by the model; every number comes from the solver.</p>
              <p className="text-ink">{record.explanation.summary}</p>
              <p className="mt-2 text-ink-2">{record.explanation.recommendation_rationale}</p>
            </section>
          )}
          {record && <SignalInbox onStarted={follow} disabled={running} />}
        </div>
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "REOPENED"
      ? "red"
      : status === "RESOLVED"
      ? "emerald"
      : status === "ESCALATED"
        ? "red"
        : status === "AWAITING_APPROVAL" || status === "VERIFYING"
          ? "amber"
          : "sky";
  return (
    <span data-testid="case-status">
      <Badge tone={tone}>{status.replace("_", " ")}</Badge>
    </span>
  );
}
