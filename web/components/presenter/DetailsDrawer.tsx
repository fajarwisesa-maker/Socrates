"use client";

import { Tabs } from "radix-ui";
import ArchitectureView from "@/components/ArchitectureView";
import AuditView from "@/components/AuditView";
import OptionsTable from "@/components/OptionsTable";
import { StateNotices } from "@/components/StateNotices";
import { Badge, TierBadge } from "@/components/ui";
import { Kbd } from "@/components/ui/kbd";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { notices } from "@/lib/notices";
import type { Step } from "@/lib/pacing";
import { modelLabel, period, TOOL } from "@/lib/present";
import { STAGE_LABEL } from "@/lib/stages";
import type { CaseEvent, CaseRecord, Config, Precedent } from "@/lib/types";

/**
 * Details for Q&A (D): tool calls, solver tables, Critic checks, audit trail and raw events.
 * Never on the main canvas.
 */
export function DetailsDrawer({
  open,
  onOpenChange,
  record,
  events,
  step,
  config,
  onReset,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  record: CaseRecord | null;
  events: CaseEvent[];
  step: Step | null;
  config: Config | null;
  onReset: () => void;
}) {
  const stepEvents = step ? events.filter((e) => e.seq >= step.firstSeq && e.seq <= step.lastSeq) : [];
  const title = step ? `${STAGE_LABEL[step.stage]}${step.round > 1 ? ` · round ${step.round}` : ""}` : "No case yet";
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent data-testid="details-drawer" className="text-base">
        <div className="border-b-2 border-surface-2 px-6 pt-5 pb-3">
          <SheetTitle className="text-xl font-bold text-ink">Details · {title}</SheetTitle>
          <SheetDescription className="text-sm text-ink-2">
            Everything behind the canvas, for questions. <Kbd>D</Kbd> or <Kbd>Esc</Kbd> closes.
          </SheetDescription>
        </div>
        <Tabs.Root defaultValue="step" className="flex min-h-0 flex-1 flex-col">
          <Tabs.List className="flex gap-1 border-b-2 border-surface-2 px-6" aria-label="Details">
            {[
              ["step", "This step"],
              ["options", "Options & Critic"],
              ["audit", "Audit trail"],
              ["case", "Case"],
              ["architecture", "Architecture"],
            ].map(([v, label]) => (
              <Tabs.Trigger
                key={v}
                value={v}
                data-testid={`drawer-tab-${v}`}
                className="-mb-[2px] border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-ink-2 data-[state=active]:border-brand data-[state=active]:text-ink"
              >
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            <Tabs.Content value="step" className="space-y-3">
              {record && <StateNotices size="planner" items={notices(stepEvents, record, false)} />}
              <StepEvents events={stepEvents} />
            </Tabs.Content>
            <Tabs.Content value="options" className="space-y-4">
              <OptionsTable record={record} />
              <CriticChecks record={record} />
            </Tabs.Content>
            <Tabs.Content value="audit">
              <AuditView caseId={record?.case_id ?? null} version={events.length} defaultOpen />
            </Tabs.Content>
            <Tabs.Content value="architecture">
              <ArchitectureView config={config} record={record} />
            </Tabs.Content>
            <Tabs.Content value="case">
              <CaseFacts record={record} events={events} config={config} onReset={onReset} />
            </Tabs.Content>
          </div>
        </Tabs.Root>
      </SheetContent>
    </Sheet>
  );
}

function time(ts: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ts));
}

interface ToolData {
  tool?: string;
  args?: Record<string, unknown>;
  status?: string;
  tier?: number;
  denial?: { message?: string; policies?: string[] } | null;
  error?: string | null;
}

function StepEvents({ events }: { events: CaseEvent[] }) {
  if (!events.length) return <p className="text-sm text-ink-2">No events for this step yet.</p>;
  const shown = events.filter((e) => e.status !== "started");
  return (
    <div className="space-y-2" data-testid="drawer-step-events">
      <ul className="space-y-2">
        {shown.map((e) => {
          const d = e.data as ToolData & { prompt?: string; model?: string; usage?: Record<string, number> };
          return (
            <li key={e.seq} className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-ink-2">{time(e.ts)}</span>
                <Badge
                  tone={
                    e.status === "rejected" || e.status === "escalated" || d.status === "denied"
                      ? "red"
                      : e.status === "waiting" || e.status === "retry"
                        ? "amber"
                        : e.status === "executed" || e.status === "completed"
                          ? "emerald"
                          : "slate"
                  }
                >
                  {e.status === "tool" ? `tool · ${d.status}` : e.status}
                </Badge>
                {typeof d.tier === "number" && e.status === "tool" && <TierBadge tier={d.tier} />}
                {e.agent && <span className="text-xs font-medium text-ink-2">{e.agent}</span>}
                <span className="font-semibold text-ink">
                  {e.status === "tool" && d.tool ? (TOOL[d.tool] ?? d.tool) : e.title}
                </span>
              </div>
              {e.status === "llm" && (
                <div className="mt-1 text-xs text-ink-2">
                  prompt {d.prompt} · {d.model}
                  {d.usage && ` · ${d.usage.inputTokens ?? "?"} in / ${d.usage.outputTokens ?? "?"} out tokens`}
                </div>
              )}
              {e.detail && e.status !== "llm" && <div className="mt-1 text-xs text-ink-2">{e.detail}</div>}
              {d.denial?.message && <div className="mt-1 text-xs text-risk-ink">{d.denial.message}</div>}
              {e.status === "tool" && d.args && (
                <details className="mt-1">
                  <summary className="cursor-pointer text-xs font-medium text-brand-ink">arguments</summary>
                  <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 font-mono text-xs text-ink">
                    {JSON.stringify(d.args, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          );
        })}
      </ul>
      <details data-testid="raw-events">
        <summary className="cursor-pointer text-sm font-medium text-brand-ink">Raw events (JSON)</summary>
        <pre className="mt-2 max-h-96 overflow-auto rounded bg-surface-2 p-3 font-mono text-xs text-ink">
          {JSON.stringify(events, null, 2)}
        </pre>
      </details>
    </div>
  );
}

function CriticChecks({ record }: { record: CaseRecord | null }) {
  if (!record?.critic_findings.length) return null;
  return (
    <section className="space-y-3" data-testid="drawer-critic">
      <h3 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">Critic checks (rules in code)</h3>
      {record.critic_findings.map((f) => (
        <div key={f.option_id} className="text-sm">
          <b>{f.option_id}</b> {f.clean ? <Badge tone="emerald">passes</Badge> : <Badge tone="red">rejected</Badge>}
          <ul className="mt-1 space-y-0.5">
            {f.checks.map((c, i) => (
              <li key={i} className={c.passed ? "text-ink-2" : "font-semibold text-risk-ink"}>
                {c.passed ? "✓" : "✗"} {c.plain || c.detail}{" "}
                <span className="font-mono text-xs font-normal text-ink-2">[{c.rule}]</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Space / →", "next step"],
  ["←", "previous step"],
  ["H", "hold / resume the dwell"],
  ["R", "restart the view (the agent is not re-run)"],
  ["L", "jump to live"],
  ["D", "this drawer"],
  ["P", "Planner mode"],
];

function CaseFacts({
  record,
  events,
  config,
  onReset,
}: {
  record: CaseRecord | null;
  events: CaseEvent[];
  config: Config | null;
  onReset: () => void;
}) {
  const precedents = events
    .filter((e) => e.stage === "PLAN" && e.status === "completed")
    .flatMap((e) => (e.data.precedents as Precedent[] | undefined) ?? [])
    .filter((p, i, all) => all.findIndex((q) => q.id === p.id) === i);
  return (
    <div className="space-y-5 text-sm" data-testid="drawer-case">
      {record && (
        <dl className="grid grid-cols-3 gap-3">
          {[
            ["Tool calls", `${record.tool_call_count} / ${config?.max_tool_calls ?? 20}`],
            ["Model calls", String(record.llm_call_count)],
            ["Replans", `${record.replan_count} / ${config?.max_replans ?? 2}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded-[var(--radius-control)] bg-surface-2 px-3 py-2">
              <dt className="text-xs text-ink-2 uppercase">{k}</dt>
              <dd className="text-lg font-semibold text-ink tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {config && (
        <p className="text-ink-2">
          Model:{" "}
          <b className="text-ink">
            {modelLabel(config)}
          </b>
        </p>
      )}
      {config?.orchestration === "multi" && (config.specialists ?? []).length > 0 && (
        <section data-testid="drawer-specialists">
          <h3 className="mb-1 text-sm font-semibold tracking-wide text-ink-2 uppercase">
            SIAGA Orchestrator · specialist agents
          </h3>
          <ul className="space-y-1">
            {config.specialists!.map((sp) => (
              <li key={sp.name}>
                <b>{sp.name}</b> <span className="text-ink-2">({sp.stages.map((s) => STAGE_LABEL[s]).join(" + ")})</span>
                <div className="text-xs text-ink-2">
                  may call: {sp.allowlist.map((t) => TOOL[t] ?? t).join(", ")} · model used for {sp.uses_llm_for}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {precedents.length > 0 && (
        <section>
          <h3 className="mb-1 text-sm font-semibold tracking-wide text-ink-2 uppercase">Precedents cited</h3>
          <ul className="space-y-1">
            {precedents.map((p) => (
              <li key={p.id}>
                {p.synthetic && <Badge>synthetic precedent</Badge>} <b>{p.id}</b> {p.title}
                {p.period && <span className="text-ink-2"> · {period(p.period)}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {record?.explanation && (
        <section>
          <h3 className="mb-1 text-sm font-semibold tracking-wide text-ink-2 uppercase">
            Agent explanation <span className="font-normal normal-case">(written by the model)</span>
          </h3>
          <p className="text-ink">{record.explanation.summary}</p>
          <p className="mt-1 text-ink-2">{record.explanation.recommendation_rationale}</p>
        </section>
      )}
      {record?.notes.map((n) => (
        <p key={n.ref} className="text-ink-2">
          <Badge>Tier 0 note</Badge> {n.text}
        </p>
      ))}
      <section>
        <h3 className="mb-1 text-sm font-semibold tracking-wide text-ink-2 uppercase">Keys</h3>
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
          {SHORTCUTS.map(([k, v]) => (
            <li key={k}>
              <Kbd>{k}</Kbd> <span className="text-ink-2">{v}</span>
            </li>
          ))}
        </ul>
      </section>
      <button
        onClick={onReset}
        data-testid="drawer-reset"
        className="rounded-[var(--radius-control)] border-2 border-line px-3 py-2 font-semibold text-ink-2 hover:bg-surface-2"
      >
        Reset demo (SAP and cases)
      </button>
    </div>
  );
}
