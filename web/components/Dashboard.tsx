"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { dayLabel } from "@/lib/format";
import type { Approval, CaseEvent, CaseRecord, Config } from "@/lib/types";
import ApprovalCards from "./ApprovalCards";
import AuditView from "./AuditView";
import DemoClock from "./DemoClock";
import ImpactPanel from "./ImpactPanel";
import OptionsTable from "./OptionsTable";
import SignalInbox from "./SignalInbox";
import StageTimeline from "./StageTimeline";
import { Badge } from "./ui";

const POLL_MS = 1000;
const TERMINAL = new Set(["RESOLVED", "ESCALATED", "FAILED"]);

export default function Dashboard() {
  const [config, setConfig] = useState<Config | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [apiDown, setApiDown] = useState(false);
  const lastSeq = useRef(-1);
  const done = useRef(false);

  function follow(id: string) {
    lastSeq.current = -1;
    done.current = false;
    setEvents([]);
    setRecord(null);
    setApprovals([]);
    setCaseId(id);
  }

  useEffect(() => {
    api.config().then(setConfig).catch(() => setApiDown(true));
    // Resume the latest case after a page reload.
    api
      .listCases()
      .then(({ cases }) => cases[0] && follow(cases[0].case_id))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    async function poll(id: string) {
      if (done.current) return;
      try {
        const [ev, c] = await Promise.all([api.events(id, lastSeq.current), api.getCase(id)]);
        if (!alive) return;
        if (ev.events.length) {
          lastSeq.current = ev.last_seq;
          setEvents((prev) => [...prev, ...ev.events.filter((e) => e.seq > (prev.at(-1)?.seq ?? -1))]);
        }
        setRecord(c.case);
        setApprovals(c.approvals);
        setApiDown(false);
        // Stop polling once the case is finished and its final event has arrived.
        done.current = TERMINAL.has(c.case.status) && ev.events.length === 0;
      } catch {
        if (alive) setApiDown(true);
      }
    }
    poll(caseId);
    const t = setInterval(() => poll(caseId), POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [caseId]);

  async function reset() {
    await api.reset();
    done.current = true;
    setCaseId(null);
    setRecord(null);
    setEvents([]);
    setApprovals([]);
    lastSeq.current = -1;
  }

  const running = !!record && !TERMINAL.has(record.status) && record.status !== "AWAITING_APPROVAL";

  return (
    <main className="mx-auto max-w-[1600px] p-5">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">SIAGA</h1>
            {config?.replay && (
              <span data-testid="replay-badge">
                <Badge tone="violet">REPLAY · recorded run</Badge>
              </span>
            )}
            {config && <Badge tone="slate">LLM: {config.llm_provider}</Badge>}
            {record && <StatusBadge status={record.status} />}
          </div>
          <p className="text-sm text-slate-500">
            Supply Intelligence Agent for Guarding Availability · supervised agent, deterministic numbers
          </p>
          {record?.day0 && (
            <p className="text-xs text-slate-400">Day 0 = {dayLabel(null, record.day0).replace(" 00:00", "")} (midnight WIB)</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <DemoClock events={events} />
          <button
            data-testid="reset"
            onClick={reset}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Reset demo
          </button>
        </div>
      </header>

      {apiDown && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm text-amber-900">
          Cannot reach the Case API. Is <code>make api</code> running? Retrying every second…
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[360px_minmax(0,1fr)_440px]">
        <div className="space-y-4">
          <SignalInbox onStarted={follow} disabled={running} />
          <ImpactPanel record={record} />
        </div>
        <div className="space-y-4">
          <StageTimeline events={events} record={record} />
          <OptionsTable record={record} />
        </div>
        <div className="space-y-4">
          <ApprovalCards record={record} approvals={approvals} />
          {record?.explanation && (
            <section className="rounded-xl border border-slate-200 bg-white p-4 text-sm shadow-sm">
              <h2 className="mb-1 text-[13px] font-semibold uppercase tracking-wide text-slate-500">
                Agent explanation
              </h2>
              <p className="text-slate-800">{record.explanation.summary}</p>
              <p className="mt-2 text-slate-600">{record.explanation.recommendation_rationale}</p>
            </section>
          )}
        </div>
      </div>
      <div className="mt-4">
        <AuditView caseId={caseId} version={events.length} />
      </div>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone =
    status === "RESOLVED"
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
