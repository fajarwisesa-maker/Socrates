"use client";

import { Check, X } from "lucide-react";
import { ApprovalSign } from "@/components/ApprovalSign";
import { StatusPlate, TierPlate, TIER_MEANING } from "@/components/signs";
import { juta } from "@/lib/format";
import { actionTitle, eta } from "@/lib/present";
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
        <div className="grid grid-cols-2 items-stretch gap-4">
          {shown.slice(0, 3).map((a) => {
            const approval = a.approval_id ? approvals.find((x) => x.approval_id === a.approval_id) : undefined;
            return approval ? (
              <ApprovalSign key={a.action_id} approval={approval} record={record} variant="presenter" onDecided={onDecided} />
            ) : (
              <ExecutedCard key={a.action_id} action={a} record={record} />
            );
          })}
        </div>
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

/** An action SIAGA executed without asking (Tier 2 or lower). */
function ExecutedCard({ action: a, record }: { action: CaseAction; record: CaseRecord }) {
  const labels = record.affected?.labels;
  return (
    <div
      data-testid="executed-card"
      className="flex flex-col rounded-[12px] border-[3px] border-sign-green bg-road-white p-4 shadow-[var(--shadow-card)]"
    >
      <div className="flex items-center gap-2">
        <StatusPlate tone="done" icon={<Check className="size-4" strokeWidth={3} aria-hidden />}>
          Done by SIAGA
        </StatusPlate>
        <TierPlate tier={a.tier} />
      </div>
      <div className="mt-2 text-xl font-black">{actionTitle(a, labels, record.affected?.plant ?? "")}</div>
      <div className="mt-2 text-[2.25rem] leading-none font-black">{juta(a.cost)}</div>
      <div className="mt-2 text-lg">
        SAP{" "}
        <span className="font-mono font-bold" data-testid="presenter-sap-ref">
          {a.sap_ref}
        </span>
        {a.eta && <> · arrives {eta(record, a.eta)}</>}
      </div>
      <p className="mt-auto pt-2 text-base">{TIER_MEANING[a.tier]?.short ?? ""}: internal and reversible, so no approval needed.</p>
    </div>
  );
}
