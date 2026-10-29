"use client";

import { Check, X } from "lucide-react";
import { ApprovalSign } from "@/components/ApprovalSign";
import { CARD, StatusPlate } from "@/components/signs";
import { cn } from "@/lib/utils";
import { juta, thousands } from "@/lib/format";
import { actionTitle, eta, plantName } from "@/lib/present";
import type { Approval, CaseAction, CaseRecord } from "@/lib/types";
import { Frame } from "./Frame";

const VERB: Record<string, string> = {
  stock_transfer: "Transfer",
  alternate_supplier: "Bridge PO",
  spot_air: "Air charter",
  reschedule_customer: "Reschedule",
};

export function ActCanvas({
  record,
  approvals,
  round,
  onDecided,
}: {
  record: CaseRecord;
  approvals: Approval[];
  round: number;
  onDecided: () => void;
}) {
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
  else {
    const approved = executed.filter((a) => a.tier >= 3).at(-1);
    headline = approved
      ? `Approved · ${VERB[approved.kind] ?? "action"} ${approved.sap_ref ?? ""} in SAP`
      : executed.length === shown.length
        ? "Every action executed in SAP"
        : "Executing the plan…";
  }

  return (
    <Frame
      stage="ACT"
      round={round}
      headline={headline}
      tone={record.status === "ESCALATED" ? "risk" : "ink"}
    >
      <div className="flex h-full flex-col gap-4">
        {shown.slice(0, 3).map((a) => {
          const approval = a.approval_id ? approvals.find((x) => x.approval_id === a.approval_id) : undefined;
          return approval ? (
            <ApprovalSign key={a.action_id} approval={approval} record={record} variant="presenter" onDecided={onDecided} />
          ) : (
            <ExecutedCard key={a.action_id} action={a} record={record} />
          );
        })}
        {dropped.length > 0 && (
          <p className="flex items-start gap-2 text-xl text-ink-2" data-testid="dropped-action">
            <X className="mt-1 size-5 shrink-0 text-risk-ink" aria-hidden />
            <span>
              <b className="text-stop-red">Not executed:</b>{" "}
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

/** An action SIAGA executed without asking (Tier 2 or lower): two short lines. */
function ExecutedCard({ action: a, record }: { action: CaseAction; record: CaseRecord }) {
  const labels = record.affected?.labels;
  return (
    <div data-testid="executed-card" className={cn(CARD, "px-6 py-4")}>
      <div className="flex items-center gap-4">
        <StatusPlate tone="done" className="shrink-0" icon={<Check className="size-4" strokeWidth={3} aria-hidden />}>
          Done · Tier {a.tier}
        </StatusPlate>
        <span className="min-w-0 truncate text-xl font-black" title={actionTitle(a, labels, record.affected?.plant ?? "")}>
          {VERB[a.kind] ?? a.kind} · {thousands(a.quantity)} ctn{a.planned?.reference ? ` from ${plantName(labels, a.planned.reference)}` : ""}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 text-lg">
        <b className="text-2xl leading-none font-black">{juta(a.cost)}</b>
        <span>
          SAP{" "}
          <span className="font-mono font-bold" data-testid="presenter-sap-ref">
            {a.sap_ref}
          </span>
          {a.eta && <> · arrives {eta(record, a.eta)}</>}
        </span>
        <span className="text-ink-2">no approval needed</span>
      </div>
    </div>
  );
}
