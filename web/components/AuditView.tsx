"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AuditEntry, AuditRemoteCheck } from "@/lib/types";
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
    case "llm_retry":
      return `${p.purpose} retry ${p.attempt}/${p.max_attempts} (${p.reason})`;
    case "pii_masked": // counts only: the original text is never rendered here
      return `${p.masked} item(s) masked before any model call (${p.mode})`;
    case "delay_prediction":
      return p.status === "ok"
        ? `${p.model}: ${p.predicted_hours} h → risk uses ${p.delay_for_risk_hours?.[0]} h (${p.used})`
        : `prediction unavailable: ${p.reason ?? "no answer"}`;
    case "allowlist_violation":
      return `${p.agent} may not call ${p.tool}`;
    case "evidence_dropped":
      return `${(p.dropped ?? []).length} quote(s) not found in the signals`;
    case "approval":
      return `${p.event} ${p.approval_id}${p.status ? ` ${p.status}` : ""}${p.by ? ` by ${p.by}` : ""}`;
    default:
      return p.event ?? "";
  }
}

export default function AuditView({
  caseId,
  version,
  defaultOpen = false,
}: {
  caseId: string | null;
  version: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [data, setData] = useState<Awaited<ReturnType<typeof api.audit>> | null>(null);
  const [remote, setRemote] = useState<AuditRemoteCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [remoteError, setRemoteError] = useState<string | null>(null);

  async function verifyInS3() {
    if (!caseId) return;
    setChecking(true);
    setRemoteError(null);
    try {
      setRemote(await api.auditS3(caseId));
    } catch (e) {
      setRemote(null);
      setRemoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  }

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
          {data.storage && (
            // AUDIT_BACKEND=s3: each entry is also an object in an Object Lock bucket
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs" data-testid="audit-s3">
              <Badge tone={data.storage.failed ? "red" : data.storage.pending ? "amber" : "emerald"}>
                S3 Object Lock · {data.storage.stored}/{data.entries.length} stored
                {data.storage.pending ? ` · ${data.storage.pending} uploading` : ""}
                {data.storage.failed ? ` · ${data.storage.failed} failed (make audit-sync)` : ""}
              </Badge>
              <span className="font-mono text-ink-2">
                s3://{data.storage.bucket}/{data.storage.prefix}
              </span>
              <button
                onClick={verifyInS3}
                disabled={checking}
                className="font-medium text-brand-ink hover:underline disabled:opacity-60"
                data-testid="audit-s3-verify"
              >
                {checking ? "Reading back from S3…" : "Verify in S3"}
              </button>
              {remote && (
                <span data-testid="audit-s3-result">
                  {remote.chain.ok && remote.matches_local ? (
                    <Badge tone="emerald">
                      read back from S3: {remote.entries} entries, chain intact, same as local
                      {remote.object_lock?.mode
                        ? ` · ${remote.object_lock.mode.toLowerCase()} lock until ${remote.object_lock.retain_until?.slice(0, 16).replace("T", " ")} UTC`
                        : ""}
                    </Badge>
                  ) : (
                    <Badge tone="red">
                      S3 copy differs: {remote.chain.ok ? "not the same as local" : `chain broken at #${remote.chain.broken_at}`}
                    </Badge>
                  )}
                </span>
              )}
              {remoteError && <span className="text-risk-ink">S3 check failed: {remoteError}</span>}
            </div>
          )}
          <button onClick={() => setOpen(!open)} className="text-xs font-medium text-brand-ink hover:underline">
            {open ? "Hide entries" : `Show ${data.entries.length} entries`}
          </button>
          {open && (
            <div className="mt-2 max-h-80 overflow-auto">
              <table className="w-full font-mono text-xs">
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.seq} className="border-t border-line">
                      <td className="py-0.5 pr-2 text-ink-2">{e.seq}</td>
                      <td className="pr-2 text-ink-2">{e.ts.slice(11, 19)}</td>
                      <td className="pr-2 font-semibold">{e.kind}</td>
                      <td className="pr-2">{summary(e)}</td>
                      <td className="text-ink-2" title={`prev ${e.prev_hash}`}>
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
