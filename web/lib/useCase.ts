"use client";

// One case followed by polling: shared by Presenter and Planner mode.
import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { Approval, CaseEvent, CaseRecord, Config } from "./types";

const POLL_MS = 1000;
const TERMINAL = new Set(["RESOLVED", "REOPENED", "ESCALATED", "FAILED"]);
export const finished = (c: CaseRecord) => TERMINAL.has(c.status);

export interface CaseState {
  config: Config | null;
  caseId: string | null;
  record: CaseRecord | null;
  approvals: Approval[];
  events: CaseEvent[];
  apiDown: boolean;
  /** true while the agent works (not waiting for a human, not finished) */
  running: boolean;
  follow: (id: string) => void;
  reset: () => Promise<void>;
  refresh: () => void;
}

export function useCase(): CaseState {
  const [config, setConfig] = useState<Config | null>(null);
  const [caseId, setCaseId] = useState<string | null>(null);
  const [record, setRecord] = useState<CaseRecord | null>(null);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [events, setEvents] = useState<CaseEvent[]>([]);
  const [apiDown, setApiDown] = useState(false);
  const [tick, setTick] = useState(0);
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
        done.current = finished(c.case) && ev.events.length === 0;
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
  }, [caseId, tick]);

  async function reset() {
    await api.reset();
    done.current = true;
    setCaseId(null);
    setRecord(null);
    setEvents([]);
    setApprovals([]);
    lastSeq.current = -1;
  }

  /** Resume polling (e.g. after an approval decision on a case that looked finished). */
  function refresh() {
    done.current = false;
    setTick((t) => t + 1);
  }

  const running = !!record && !finished(record) && record.status !== "AWAITING_APPROVAL";
  return { config, caseId, record, approvals, events, apiDown, running, follow, reset, refresh };
}
