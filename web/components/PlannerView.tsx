"use client";

// Planner mode (docs/redesign-prompt.md section 6): asphalt header, then the inbox, the
// case file of the followed case, or its audit trail.
import { useState } from "react";
import type { CaseState } from "@/lib/useCase";
import { useAudit, useInbox } from "@/lib/useInbox";
import AuditView from "./AuditView";
import { CaseFile, type CaseTab } from "./planner/CaseFile";
import { Inbox } from "./planner/Inbox";
import { PlannerHeader, type Nav } from "./planner/PlannerHeader";
import { WarningPlate } from "./signs";

export default function PlannerView({
  state,
  modeSwitch,
}: {
  state: CaseState;
  modeSwitch: React.ReactNode;
}) {
  const { config, caseId, record, approvals, events, apiDown, running, follow, reset, refresh } = state;
  // null = not chosen yet: the case file when a case exists, else the inbox
  const [navPick, setNav] = useState<Nav | null>(null);
  const nav: Nav = navPick ?? (caseId ? "cases" : "inbox");
  const [tab, setTab] = useState<CaseTab>("stages");
  const audit = useAudit(caseId, events.length);
  const inbox = useInbox(events.length);

  function open(id: string) {
    if (id !== caseId) follow(id);
    setTab("stages");
    setNav("cases");
  }

  async function doReset() {
    await reset();
    setNav("inbox");
  }

  return (
    <div className="min-h-screen bg-concrete" data-testid="planner">
      <PlannerHeader
        nav={nav}
        onNav={setNav}
        config={config}
        events={events}
        audit={audit}
        modeSwitch={modeSwitch}
      />
      {apiDown && (
        <div className="mx-auto max-w-[1440px] px-6 pt-4">
          <WarningPlate size="sm" className="flex items-center gap-2 text-base font-bold">
            Cannot reach the Case API. Is <code className="font-mono">make api</code> running? Retrying every second.
          </WarningPlate>
        </div>
      )}
      {nav === "inbox" ? (
        <Inbox
          cases={inbox.cases}
          loaded={inbox.loaded}
          onOpen={open}
          onStarted={open}
          busy={running}
          onReset={doReset}
        />
      ) : !caseId ? (
        <Empty onInbox={() => setNav("inbox")} />
      ) : !record ? (
        <p className="mx-auto max-w-[1440px] px-6 py-10 text-lg font-bold" role="status">
          Loading case…
        </p>
      ) : nav === "audit" ? (
        <main className="mx-auto max-w-[1440px] px-6 py-6" data-testid="audit-page">
          <h1 className="mb-4 text-3xl font-black">Audit trail</h1>
          <AuditView caseId={caseId} version={events.length} defaultOpen />
        </main>
      ) : (
        <CaseFile
          record={record}
          events={events}
          approvals={approvals}
          config={config}
          audit={audit}
          tab={tab}
          onTab={setTab}
          onDecided={refresh}
        />
      )}
    </div>
  );
}

function Empty({ onInbox }: { onInbox: () => void }) {
  return (
    <main className="mx-auto max-w-[1440px] px-6 py-10" data-testid="no-case">
      <h1 className="text-3xl font-black">No case open</h1>
      <p className="mt-2 text-lg">
        Start one from the{" "}
        <button className="font-bold underline" onClick={onInbox}>
          inbox
        </button>
        .
      </p>
    </main>
  );
}
