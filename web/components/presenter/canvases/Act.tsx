"use client";

import { Check, X } from "lucide-react";
import { ApprovalSign } from "@/components/ApprovalSign";
import { StatusPlate } from "@/components/signs";
import { juta, thousands } from "@/lib/format";
import { actionTitle } from "@/lib/present";
import type { Approval, CaseAction, CaseRecord } from "@/lib/types";

/** Actions that will not run: rejected, approved too late, or withdrawn on escalation. */
const CLOSED: CaseAction["status"][] = ["REJECTED", "EXPIRED", "WITHDRAWN"];

const VERB: Record<string, string> = {
  stock_transfer: "Transfer",
  alternate_supplier: "Bridge PO",
  spot_air: "Air charter",
  reschedule_customer: "Reschedule",
};

/** Act's headline: what SIAGA did, and what waits for a person. */
export function actHead(record: CaseRecord): { headline: string; tone: "ink" | "risk" } {
  const shown = record.actions.filter((a) => !CLOSED.includes(a.status));
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
  return { headline, tone: record.status === "ESCALATED" ? "risk" : "ink" };
}

/**
 * Under the map (the transfer route draws green, the bridge PO route shows yellow): one line
 * per action SIAGA did alone, then the approval sign, which turns green in place.
 */
export function ActBody({ record, approvals, onDecided }: { record: CaseRecord; approvals: Approval[]; onDecided: () => void }) {
  const shown = record.actions.filter((a) => !CLOSED.includes(a.status));
  const dropped = record.actions.filter((a) => CLOSED.includes(a.status));
  return (
    <div className="flex h-full flex-col gap-3">
      {shown.slice(0, 3).map((a) => {
        const approval = a.approval_id ? approvals.find((x) => x.approval_id === a.approval_id) : undefined;
        return approval ? (
          <ApprovalSign key={a.action_id} approval={approval} record={record} variant="presenter" onDecided={onDecided} />
        ) : (
          <ExecutedLine key={a.action_id} action={a} record={record} />
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
                {VERB[a.kind] ?? a.kind} · {juta(a.cost)} ({a.status === "EXPIRED" ? "approved too late" : a.status === "WITHDRAWN" ? "withdrawn" : "rejected"}
                {a.rejection_reason ? <span lang="id">: “{a.rejection_reason}”</span> : null})
              </span>
            ))}
          </span>
        </p>
      )}
    </div>
  );
}

/** An action SIAGA executed without asking (Tier 2 or lower), in one line. */
function ExecutedLine({ action: a, record }: { action: CaseAction; record: CaseRecord }) {
  return (
    <p
      data-testid="executed-card"
      className="flex items-center gap-4 text-xl whitespace-nowrap"
      title={actionTitle(a, record.affected?.labels, record.affected?.plant ?? "")}
    >
      <StatusPlate tone="done" className="shrink-0" icon={<Check className="size-4" strokeWidth={3} aria-hidden />}>
        Done · Tier {a.tier}
      </StatusPlate>
      <span className="min-w-0 truncate">
        <b>
          {VERB[a.kind] ?? a.kind} · {thousands(a.quantity)} ctn · {juta(a.cost)}
        </b>{" "}
        · SAP{" "}
        <span className="font-mono font-bold" data-testid="presenter-sap-ref">
          {a.sap_ref}
        </span>
      </span>
    </p>
  );
}
