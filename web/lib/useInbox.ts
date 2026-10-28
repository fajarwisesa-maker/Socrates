"use client";

// The inbox: every case the Case API knows (GET /cases), each read with GET /cases/{id}
// for its figures and approvals. Existing endpoints only; polled every 2 s.
import { useEffect, useState } from "react";
import { api } from "./api";
import type { Approval, AuditEntry, CaseRecord } from "./types";

export interface InboxCase {
  record: CaseRecord;
  approvals: Approval[];
}

const MAX = 25;

export function useInbox(version: number): { cases: InboxCase[]; loaded: boolean } {
  const [cases, setCases] = useState<InboxCase[]>([]);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const { cases: list } = await api.listCases();
        const full = await Promise.all(
          list.slice(0, MAX).map((c) =>
            api
              .getCase(c.case_id)
              .then((r) => ({ record: r.case, approvals: r.approvals }))
              .catch(() => null),
          ),
        );
        if (alive) {
          setCases(full.filter((x): x is InboxCase => !!x));
          setLoaded(true);
        }
      } catch {
        if (alive) setLoaded(true);
      }
    }
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [version]);
  return { cases, loaded };
}

export type AuditData = Awaited<ReturnType<typeof api.audit>>;

/** The audit trail of one case, re-read whenever its events change. */
export function useAudit(caseId: string | null, version: number): AuditData | null {
  const [data, setData] = useState<AuditData | null>(null);
  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    api
      .audit(caseId)
      .then((d) => alive && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [caseId, version]);
  return caseId ? data : null;
}

export type { AuditEntry };
