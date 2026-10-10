"use client";

import { Check, Clock, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { dayShort, juta } from "@/lib/format";
import { actionTitle, eta } from "@/lib/present";
import type { CaseAction, CaseRecord } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Frame } from "./Frame";

const VERB: Record<string, string> = {
  stock_transfer: "Transfer",
  alternate_supplier: "Bridge PO",
  spot_air: "Air charter",
  reschedule_customer: "Reschedule",
};

export function ActCanvas({ record, round, onDecided }: { record: CaseRecord; round: number; onDecided: () => void }) {
  const shown = record.actions.filter((a) => a.status !== "REJECTED" && a.status !== "EXPIRED");
  const dropped = record.actions.filter((a) => a.status === "REJECTED" || a.status === "EXPIRED");
  const executed = shown.filter((a) => a.status === "EXECUTED");
  const pending = shown.filter((a) => a.status === "PENDING_APPROVAL");
  const autoDone = executed.filter((a) => a.tier <= 2);

  let headline: string;
  if (record.status === "ESCALATED") headline = "Handed to a human planner";
  else if (!shown.length) headline = "Executing the plan…";
  else if (pending.length)
    headline =
      (autoDone.length ? `${VERB[autoDone[0].kind] ?? "Action"} executed · ` : "") +
      `${pending.length} decision${pending.length > 1 ? "s" : ""} need${pending.length > 1 ? "" : "s"} you`;
  else headline = executed.length === shown.length ? "Every action executed in SAP" : "Executing the plan…";

  return (
    <Frame
      stage="ACT"
      round={round}
      headline={headline}
      tone={record.status === "ESCALATED" ? "risk" : pending.length ? "human" : "ink"}
    >
      <div className="flex h-full flex-col gap-4">
        <div className="grid grid-cols-2 items-stretch gap-4">
          {shown.slice(0, 3).map((a) =>
            a.status === "PENDING_APPROVAL" ? (
              <ApprovalCard key={a.action_id} action={a} record={record} onDecided={onDecided} />
            ) : (
              <ExecutedCard key={a.action_id} action={a} record={record} />
            ),
          )}
        </div>
        {dropped.length > 0 && (
          <p className="flex items-start gap-2 text-xl text-ink-2" data-testid="dropped-action">
            <X className="mt-1 size-5 shrink-0 text-risk-ink" aria-hidden />
            <span>
              <b className="text-risk-ink">Not executed:</b>{" "}
              {dropped.map((a, i) => (
                <span key={a.action_id}>
                  {i > 0 && ", "}
                  {VERB[a.kind] ?? a.kind} · {juta(a.cost)} ({a.status === "EXPIRED" ? "approved too late" : "rejected"}
                  {a.rejection_reason ? <span lang="id">: “{a.rejection_reason}”</span> : null})
                </span>
              ))}
            </span>
          </p>
        )}
      </div>
    </Frame>
  );
}

function ExecutedCard({ action: a, record }: { action: CaseAction; record: CaseRecord }) {
  const labels = record.affected?.labels;
  return (
    <div
      data-testid="executed-card"
      className="flex flex-col rounded-[var(--radius-card)] border-2 border-ok bg-ok-soft p-5"
    >
      <div className="flex items-center gap-2 text-lg font-semibold text-ok-ink">
        <Check className="size-5" strokeWidth={3} aria-hidden />
        {a.tier <= 2 ? `Executed automatically · Tier ${a.tier}` : `Approved · executed · Tier ${a.tier}`}
      </div>
      <div className="mt-2 text-xl font-semibold text-ink">{actionTitle(a, labels, record.affected?.plant ?? "")}</div>
      <div className="mt-auto pt-3 text-[2.25rem] leading-none font-semibold text-ink">{juta(a.cost)}</div>
      <div className="mt-2 text-xl text-ink-2">
        SAP <span className="font-mono font-semibold text-ink" data-testid="presenter-sap-ref">{a.sap_ref}</span>
        {a.eta && <> · arrives {eta(record, a.eta)}</>}
      </div>
    </div>
  );
}

function ApprovalCard({ action: a, record, onDecided }: { action: CaseAction; record: CaseRecord; onDecided: () => void }) {
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const labels = record.affected?.labels;

  async function decide(decision: "approve" | "reject") {
    if (!a.approval_id) return;
    setBusy(decision);
    setError(null);
    try {
      await api.decide(record.case_id, a.approval_id, decision, decision === "reject" ? reason : undefined);
      onDecided();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div
      data-testid="presenter-approval"
      className="flex flex-col rounded-[var(--radius-card)] border-2 border-human bg-human-soft p-5"
    >
      <div className="flex items-center gap-2 text-lg font-semibold text-human-ink">
        <Clock className="size-5" aria-hidden /> Needs your approval · Tier {a.tier}
      </div>
      <div className="mt-2 text-xl font-semibold text-ink">{actionTitle(a, labels, record.affected?.plant ?? "")}</div>
      <div className="mt-3 text-[2.25rem] leading-none font-semibold text-ink">{juta(a.cost)}</div>
      {a.card?.approve_by && (
        <div className="mt-2 text-xl font-semibold text-human-ink" data-testid="approve-by">
          Approve by {dayShort(record.day0, a.card.approve_by)}
        </div>
      )}
      {!rejecting ? (
        <div className="mt-auto flex items-center gap-3 pt-4">
          <Button
            size="lg"
            variant="approve"
            className="flex-1 text-xl"
            disabled={!!busy}
            onClick={() => decide("approve")}
            data-testid="presenter-approve"
          >
            {busy === "approve" ? <Loader2 className="animate-spin" aria-hidden /> : <Check aria-hidden />}
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button size="lg" variant="danger" disabled={!!busy} onClick={() => setRejecting(true)} data-testid="presenter-reject">
            Reject
          </Button>
        </div>
      ) : (
        <div className="mt-auto flex flex-col gap-2 pt-4">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional, the agent reads it)"
            className="h-12 rounded-[var(--radius-control)] border-2 border-line bg-surface px-3 text-lg text-ink outline-none focus:border-brand"
            data-testid="presenter-reject-reason"
          />
          <div className="flex gap-2">
            <Button size="md" variant="danger" disabled={!!busy} onClick={() => decide("reject")} data-testid="presenter-reject-confirm">
              {busy === "reject" ? "Rejecting…" : "Reject and replan"}
            </Button>
            <Button size="md" variant="ghost" disabled={!!busy} onClick={() => setRejecting(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error && <p className={cn("mt-2 text-lg text-risk-ink")}>{error}</p>}
    </div>
  );
}
