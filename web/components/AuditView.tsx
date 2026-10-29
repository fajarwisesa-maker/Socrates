"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { STAGE_LABEL } from "@/lib/stages";
import type { AuditEntry, AuditRemoteCheck } from "@/lib/types";
import { cn } from "@/lib/utils";
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

/**
 * The stage each entry belongs to. Tool calls, policy decisions and approvals carry no stage
 * of their own, but the chain is in order: an entry belongs to the stage of the last
 * transition before it. Entries before the first transition (case opened, PII check) are
 * "CASE".
 */
function withStages(entries: AuditEntry[]): { entry: AuditEntry; stage: string }[] {
  let current = "CASE";
  return entries.map((e) => {
    const p = e.payload as Record<string, unknown>;
    if (e.kind === "stage_transition" && p.to) current = String(p.to);
    return { entry: e, stage: typeof p.stage === "string" && p.stage ? p.stage : current };
  });
}

/** Event types a planner asks about; every kind falls into exactly one. */
const TYPES = [
  { id: "stage", label: "Stage changes", kinds: ["stage_transition"] },
  { id: "tool", label: "Tool calls", kinds: ["tool_call"] },
  { id: "policy", label: "Policy decisions", kinds: ["policy_decision", "allowlist_violation"] },
  { id: "model", label: "Model calls", kinds: ["llm_call", "llm_retry"] },
  { id: "approval", label: "Approvals", kinds: ["approval"] },
] as const;
type TypeId = (typeof TYPES)[number]["id"] | "other";

function typeOf(kind: string): TypeId {
  return TYPES.find((t) => (t.kinds as readonly string[]).includes(kind))?.id ?? "other";
}

const STAGE_NAME: Record<string, string> = { CASE: "Case", ...STAGE_LABEL };

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
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<TypeId | "all">("all");

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
  const rows = data ? withStages(data.entries) : [];
  // only offer the stages and types this case has
  const stages = [...new Set(rows.map((r) => r.stage))];
  const types: { id: TypeId; label: string }[] = [
    ...TYPES.filter((t) => rows.some((r) => typeOf(r.entry.kind) === t.id)),
    ...(rows.some((r) => typeOf(r.entry.kind) === "other") ? [{ id: "other" as const, label: "Other" }] : []),
  ];
  const shown = rows.filter(
    (r) => (stageFilter === "all" || r.stage === stageFilter) && (typeFilter === "all" || typeOf(r.entry.kind) === typeFilter),
  );
  const filtered = stageFilter !== "all" || typeFilter !== "all";
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
            <>
              <div className="mt-4 flex flex-col gap-2" data-testid="audit-filters">
                <FilterRow
                  label="Stage"
                  value={stageFilter}
                  onChange={setStageFilter}
                  options={[{ id: "all", label: "All" }, ...stages.map((st) => ({ id: st, label: STAGE_NAME[st] ?? st }))]}
                  testId="audit-filter-stage"
                />
                <FilterRow
                  label="Event"
                  value={typeFilter}
                  onChange={(id) => setTypeFilter(id as TypeId | "all")}
                  options={[{ id: "all", label: "All" }, ...types]}
                  testId="audit-filter-type"
                />
                <p className="text-xs" data-testid="audit-shown" aria-live="polite">
                  {filtered ? `Showing ${shown.length} of ${rows.length} entries. ` : `${rows.length} entries. `}
                  The hash chain is checked over every entry, whatever the filter.
                  {filtered && (
                    <>
                      {" "}
                      <button
                        className="font-bold underline"
                        onClick={() => {
                          setStageFilter("all");
                          setTypeFilter("all");
                        }}
                      >
                        Clear filters
                      </button>
                    </>
                  )}
                </p>
              </div>
              <div className={defaultOpen ? "mt-2 max-h-[70vh] overflow-auto" : "mt-2 max-h-80 overflow-auto"}>
                {shown.length === 0 ? (
                  <p className="py-3 text-sm">No entries match these filters.</p>
                ) : (
                  <table className="w-full text-sm" data-testid="audit-table">
                    <thead className="sticky top-0 bg-road-white">
                      <tr className="border-b border-divider text-left text-xs font-black tracking-[0.06em] text-ink-2 uppercase">
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
                      {shown.map(({ entry: e, stage }) => (
                        <tr key={e.seq} className="border-b border-divider align-top last:border-0" data-stage={stage} data-type={typeOf(e.kind)}>
                          <td className="py-1 pr-2 font-mono text-xs text-ink-2">{e.seq}</td>
                          <td className="pr-2 font-mono text-xs whitespace-nowrap">{e.ts.slice(11, 19)}</td>
                          <td className="pr-2 text-xs">{STAGE_NAME[stage] ?? stage}</td>
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
                )}
              </div>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

/** One row of filter chips (a radio group: one choice, "All" by default). */
function FilterRow({
  label,
  value,
  onChange,
  options,
  testId,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
  options: { id: string; label: string }[];
  testId: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={`Filter by ${label.toLowerCase()}`} data-testid={testId}>
      <span className="sign-label mr-1 w-14 text-xs">{label}</span>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          data-testid={`${testId}-${o.id}`}
          className={cn(
            "min-h-11 rounded-[6px] px-4 text-xs font-bold transition-[background-color,color,box-shadow] duration-[var(--dur-fast)]",
            value === o.id ? "bg-asphalt text-white" : "bg-road-white text-asphalt inset-ring inset-ring-hairline hover:bg-surface-2",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
