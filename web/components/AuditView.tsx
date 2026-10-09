"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AuditEntry } from "@/lib/types";
import { Badge, Empty, Panel } from "./ui";

function summary(e: AuditEntry): string {
  const p = e.payload;
  switch (e.kind) {
    case "policy_decision":
      return `${p.tool}: ${p.allowed ? "ALLOW" : "DENY"} (Tier ${p.tier}) ${(p.policies ?? []).join(", ")}`;
    case "tool_call":
      return `${p.tool} → ${p.status}${p.approval_id ? ` [${p.approval_id}]` : ""}`;
    case "stage_transition":
      return `${p.from ?? "start"} → ${p.to}`;
    case "llm_call":
      return `${p.purpose} · ${p.prompt} · ${p.model} · ${p.latency_s}s`;
    case "approval":
      return `${p.event} ${p.approval_id}${p.status ? ` ${p.status}` : ""}${p.by ? ` by ${p.by}` : ""}`;
    default:
      return p.event ?? "";
  }
}

export default function AuditView({ caseId, version }: { caseId: string | null; version: number }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.audit>> | null>(null);

  useEffect(() => {
    if (!caseId) return;
    let alive = true;
    api.audit(caseId).then((d) => alive && setData(d)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [caseId, version]);

  const v = data?.verification;
  return (
    <Panel
      title="Audit trail"
      testId="audit"
      right={
        v && (
          <span data-testid="audit-status">
            {v.ok ? (
              <Badge tone="emerald">hash chain verified · {v.entries} entries</Badge>
            ) : (
              <Badge tone="red">
                chain broken at #{v.broken_at} ({v.reason})
              </Badge>
            )}
          </span>
        )
      }
    >
      {!data ? (
        <Empty>Every stage transition, tool call, policy decision and approval is recorded here.</Empty>
      ) : (
        <>
          <button onClick={() => setOpen(!open)} className="text-xs font-medium text-sky-700 hover:underline">
            {open ? "Hide entries" : `Show ${data.entries.length} entries`}
          </button>
          {open && (
            <div className="mt-2 max-h-80 overflow-auto">
              <table className="w-full font-mono text-[11px]">
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.seq} className="border-t border-slate-100">
                      <td className="py-0.5 pr-2 text-slate-400">{e.seq}</td>
                      <td className="pr-2 text-slate-500">{e.ts.slice(11, 19)}</td>
                      <td className="pr-2 font-semibold">{e.kind}</td>
                      <td className="pr-2">{summary(e)}</td>
                      <td className="text-slate-400" title={`prev ${e.prev_hash}`}>
                        {e.hash.slice(0, 10)}…
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
