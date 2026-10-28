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

function stageOf(e: AuditEntry): string {
  const p = e.payload as Record<string, unknown>;
  return String(p.stage ?? (e.kind === "stage_transition" ? p.to : "") ?? "");
}

function actorOf(e: AuditEntry): string {
  const p = e.payload as Record<string, unknown>;
  if (p.agent) return String(p.agent);
  if (e.kind === "approval") return String(p.by ?? "planner");
  if (e.kind === "llm_call" || e.kind === "llm_retry") return "model";
  if (e.kind === "tool_call" || e.kind === "policy_decision") return `tool ${p.tool ?? ""}`.trim();
  return "SIAGA";
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
            <div className={defaultOpen ? "mt-2 max-h-[70vh] overflow-auto" : "mt-2 max-h-80 overflow-auto"}>
              <table className="w-full text-sm" data-testid="audit-table">
                <thead className="sticky top-0 bg-road-white">
                  <tr className="border-b-2 border-asphalt text-left text-xs font-black tracking-[0.06em] uppercase">
                    <th className="py-1 pr-2">#</th>
                    <th className="pr-2">Time</th>
                    <th className="pr-2">Stage</th>
                    <th className="pr-2">Actor</th>
                    <th className="pr-2">Event</th>
                    <th className="pr-2">Policy</th>
                    <th>Hash</th>
                  </tr>
                </thead>
                <tbody>
                  {data.entries.map((e) => (
                    <tr key={e.seq} className="border-b border-curb align-top">
                      <td className="py-1 pr-2 font-mono text-xs text-ink-2">{e.seq}</td>
                      <td className="pr-2 font-mono text-xs whitespace-nowrap">{e.ts.slice(11, 19)}</td>
                      <td className="pr-2 text-xs">{stageOf(e)}</td>
                      <td className="pr-2 text-xs">{actorOf(e)}</td>
                      <td className="pr-2">
                        <span className="font-mono text-xs font-bold">{e.kind}</span> <span className="text-xs">{summary(e)}</span>
                      </td>
                      <td className="pr-2 font-mono text-xs font-bold whitespace-nowrap">
                        {e.kind === "policy_decision" ? `${e.payload.allowed ? "ALLOW" : "DENY"} · T${e.payload.tier}` : ""}
                      </td>
                      <td className="font-mono text-xs text-ink-2" title={`prev ${e.prev_hash}`}>
                        {e.hash.slice(0, 8)}
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
