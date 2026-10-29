"use client";

// Planner mode, UI v3 (the owner's mockup, docs/ui-v3-plan.md): a sidebar with the eight
// pages of a case's journey, a top bar with the case and its status, the agent's seven
// stages as a stepper, and one page at a time. The page is kept in ?page=.
import { useDelayed } from "@/lib/motion";
import { setPage, usePickedPage, type Page } from "@/lib/page";
import { caseStatusView } from "@/lib/caseView";
import { juta } from "@/lib/format";
import { agentsByStage } from "@/lib/present";
import type { CaseState } from "@/lib/useCase";
import { useAudit, useInbox } from "@/lib/useInbox";
import ArchitectureView from "./ArchitectureView";
import AuditView from "./AuditView";
import { CARD } from "./signs";
import { cn } from "@/lib/utils";
import { Journey } from "./planner/Journey";
import { Approvals } from "./planner/pages/Approvals";
import { Evaluation } from "./planner/pages/Evaluation";
import { Impact } from "./planner/pages/Impact";
import { Options } from "./planner/pages/Options";
import { Overview } from "./planner/pages/Overview";
import { Signals } from "./planner/pages/Signals";
import type { CasePageProps } from "./planner/pages/types";
import { Verification } from "./planner/pages/Verification";
import { Sidebar, TopBar } from "./planner/Shell";
import { Chip, PageHeader } from "./planner/ui";

export default function PlannerView({ state, modeSwitch }: { state: CaseState; modeSwitch: React.ReactNode }) {
  const { config, caseId, record, approvals, events, apiDown, running, follow, reset, refresh } = state;
  const picked = usePickedPage();
  const audit = useAudit(caseId, events.length);
  const inbox = useInbox(events.length);
  const status = record ? caseStatusView(record, approvals) : null;
  const pending = status?.decidable.length ?? 0;
  // no page picked yet: the decision when one waits, the overview of a case, else the signals
  const page: Page = picked ?? (!caseId ? "signals" : pending ? "approvals" : "overview");

  function open(id: string) {
    if (id !== caseId) follow(id);
    setPage("overview");
  }

  async function doReset() {
    await reset();
    setPage("signals");
  }

  const open_ = inbox.cases.filter((c) => c.record.status !== "RESOLVED").length;
  const caseProps: CasePageProps | null = record
    ? {
        record,
        events,
        approvals,
        config,
        audit,
        agents: agentsByStage(events, config),
        onPage: setPage,
        onDecided: refresh,
      }
    : null;

  let body: React.ReactNode;
  if (page === "signals") {
    body = (
      <Signals
        inbox={{ cases: inbox.cases, loaded: inbox.loaded, onOpen: open, onStarted: open, busy: running, onReset: doReset }}
        caseProps={caseProps}
        openId={caseId}
      />
    );
  } else if (page === "evaluation") {
    body = <Evaluation />;
  } else if (page === "architecture") {
    body = (
      <div className="flex flex-col gap-8" data-testid="architecture-page">
        <PageHeader title="Architecture" description="What runs where in this session: the agent, the model, the solver, the policy engine and SAP." />
        <section className={cn(CARD, "p-6")} data-testid="architecture-panel">
          <ArchitectureView config={config} record={record} />
        </section>
      </div>
    );
  } else if (!caseId) {
    body = <NoCase onSignals={() => setPage("signals")} />;
  } else if (!caseProps) {
    body = <LoadingCase />;
  } else if (page === "audit") {
    body = (
      <div className="flex flex-col gap-8" data-testid="audit-page">
        <PageHeader
          chips={audit?.verification ? <Chip tone={audit.verification.ok ? "ok" : "risk"}>{audit.verification.ok ? "Chain intact" : "Chain broken"}</Chip> : undefined}
          title="Audit trail"
          description="Every stage change, tool call, policy decision, model call and approval, hash-chained so an edit shows."
        />
        <AuditView caseId={caseId} version={events.length} defaultOpen checkpoints />
      </div>
    );
  } else {
    const P = { overview: Overview, impact: Impact, options: Options, approvals: Approvals, verification: Verification }[page];
    body = <P {...caseProps} />;
  }

  return (
    <div className="flex min-h-screen bg-concrete" data-testid="planner">
      <Sidebar
        page={page}
        onPage={setPage}
        config={config}
        events={events}
        counts={{
          signals: open_ ? { tone: "info", text: `${open_} open` } : undefined,
          impact: record?.risk ? { tone: "risk", text: juta(record.risk.max_exposure) } : undefined,
          approvals: status?.badge ?? undefined,
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar record={record} approvals={approvals} audit={audit} modeSwitch={modeSwitch} />
        {record && <Journey record={record} events={events} agents={caseProps?.agents ?? {}} page={page} onPage={setPage} />}
        {apiDown && (
          <div className="mx-8 mt-4 rounded-[8px] bg-chip-needs-bg px-4 py-2 text-sm font-bold text-chip-needs-fg" role="status">
            Cannot reach the Case API. Is <code className="font-mono">make api</code> running? Retrying every second.
          </div>
        )}
        <main className="w-full max-w-[1440px] px-8 py-8" data-testid="case-file">
          {body}
        </main>
      </div>
    </div>
  );
}

function NoCase({ onSignals }: { onSignals: () => void }) {
  return (
    <div className="flex flex-col gap-2" data-testid="no-case">
      <h1 className="text-3xl font-black">No case open</h1>
      <p className="text-base">
        Start one from{" "}
        <button className="font-bold underline" onClick={onSignals}>
          Signals
        </button>
        .
      </p>
    </div>
  );
}

/** Shown only when loading a case takes longer than 300 ms, so a quick switch never flashes. */
function LoadingCase() {
  const slow = useDelayed(300);
  return (
    <p className="text-lg font-bold" role="status">
      {slow ? "Loading case…" : ""}
    </p>
  );
}
