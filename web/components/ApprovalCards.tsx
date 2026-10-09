"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { Approval, CaseRecord } from "@/lib/types";
import { Badge, Empty, Panel, TierBadge } from "./ui";

export default function ApprovalCards({
  record,
  approvals,
}: {
  record: CaseRecord | null;
  approvals: Approval[];
}) {
  if (!record || !approvals.length) {
    return (
      <Panel title="Approvals" testId="approvals">
        <Empty>Tier 3 actions wait here for one-click approval.</Empty>
      </Panel>
    );
  }
  return (
    <Panel title="Approvals" testId="approvals">
      <div className="space-y-3">
        {[...approvals].reverse().map((a) => (
          <ApprovalCard key={a.approval_id} approval={a} record={record} />
        ))}
      </div>
    </Panel>
  );
}

function ApprovalCard({ approval, record }: { approval: Approval; record: CaseRecord }) {
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const action = record.actions.find((x) => x.approval_id === approval.approval_id);
  const c = approval.card;
  const pending = approval.status === "PENDING" && action?.status === "PENDING_APPROVAL";

  async function decide(decision: "approve" | "reject") {
    setBusy(true);
    setError(null);
    try {
      await api.decide(record.case_id, approval.approval_id, decision, reason);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <div
      data-testid="approval-card"
      data-status={approval.status}
      className={`rounded-lg border p-3 ${pending ? "border-amber-300 bg-amber-50/60" : "border-slate-200 bg-white"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-slate-900">{c.what}</div>
        <TierBadge tier={3} />
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{c.cost_display}</div>
      <div className="text-xs text-slate-600">
        part of a plan totalling {c.plan_total_display} · {c.tier_reasons.join("; ")}
      </div>
      <dl className="mt-2 space-y-1 text-xs">
        <div>
          <dt className="inline font-semibold">Why: </dt>
          <dd className="inline text-slate-700">{c.why}</dd>
        </div>
        <div>
          <dt className="inline font-semibold">Approve by: </dt>
          <dd className="inline font-semibold text-amber-800">{c.approve_by_display}</dd>
          {c.eta_display && <dd className="inline text-slate-600"> · arrives {c.eta_display}</dd>}
        </div>
        <div>
          <dt className="inline font-semibold">Alternatives: </dt>
          <dd className="inline text-slate-700">
            {c.alternatives.map((x) => `${x.option_id} ${x.label} ${x.total_cost_display}`).join("; ") || "none"}
          </dd>
        </div>
        <div>
          <dt className="inline font-semibold">If rejected: </dt>
          <dd className="inline text-slate-700">{c.if_rejected}</dd>
        </div>
      </dl>
      {pending ? (
        <div className="mt-3 space-y-2">
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional, read by the agent if you reject)"
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs"
          />
          <div className="flex gap-2">
            <button
              data-testid="approve"
              disabled={busy}
              onClick={() => decide("approve")}
              className="flex-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Sending…" : "Approve"}
            </button>
            <button
              data-testid="reject"
              disabled={busy}
              onClick={() => decide("reject")}
              className="rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={approval.status === "APPROVED" ? "emerald" : "red"}>
            {approval.status.toLowerCase()}
          </Badge>
          {action?.status === "EXPIRED" && <Badge tone="red">approved too late → replanned</Badge>}
          {action?.sap_ref && (
            <span data-testid="po-number">
              SAP document <b className="font-mono">{action.sap_ref}</b>
            </span>
          )}
          {approval.reason && <span className="text-xs text-slate-600">“{approval.reason}”</span>}
        </div>
      )}
    </div>
  );
}
