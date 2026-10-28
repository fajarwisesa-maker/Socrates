"use client";

// The approval sign (docs/redesign-prompt.md 6.5): a yellow warning plate a planner can
// decide from in one read. After approval it turns into a green gantry sign with the SAP
// document; after rejection it turns white with a red border while SIAGA replans.
// Every amount and date comes from the approval card the backend built.
import { Check, Loader2 } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";
import { api } from "@/lib/api";
import { actionFor, approvalTitle, countdown, DECISION_OBJECT } from "@/lib/caseView";
import { dayShort, juta } from "@/lib/format";
import type { Approval, CaseRecord } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { AgentWritten, GantrySign, SolverLabel, StatusPlate, WarningPlate } from "./signs";
import { Button } from "./ui/button";

type Variant = "planner" | "presenter";

/** Test ids differ per mode (the Planner and Presenter e2e tests predate the redesign). */
const IDS = {
  planner: { approve: "approve", rejectOpen: "reject-open", reason: "reject-reason", reject: "reject", sapRef: "po-number" },
  presenter: {
    approve: "presenter-approve",
    rejectOpen: "presenter-reject",
    reason: "presenter-reject-reason",
    reject: "presenter-reject-confirm",
    sapRef: "presenter-sap-ref",
  },
};

export function ApprovalSign({
  approval,
  record,
  variant = "planner",
  onDecided,
}: {
  approval: Approval;
  record: CaseRecord;
  variant?: Variant;
  onDecided?: () => void;
}) {
  const reduce = useReducedMotion();
  const now = useNow(1000);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // the sign was pending when first shown: its approval is a moment worth animating
  const [wasPending] = useState(approval.status === "PENDING");
  const action = actionFor(approval, record);
  const c = approval.card;
  const ids = IDS[variant];
  const presenter = variant === "presenter";
  const object = DECISION_OBJECT[action?.kind ?? ""] ?? "action";
  const title = approvalTitle(action, record, c.what);
  const pending = approval.status === "PENDING" && action?.status === "PENDING_APPROVAL";
  const left = countdown(c.approve_by, now);
  const approveBy = c.approve_by ? dayShort(record.day0, c.approve_by) : null;

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      await api.decide(record.case_id, approval.approval_id, decision, decision === "reject" ? reason : undefined);
      onDecided?.();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  const common = {
    "data-testid": "approval-card",
    "data-status": approval.status,
    "data-variant": variant,
  };

  // ---- approved: a green gantry sign with the SAP document
  if (approval.status === "APPROVED" && action?.status !== "EXPIRED") {
    return (
      <motion.div
        {...common}
        initial={wasPending && !reduce ? { scale: 0.98 } : false}
        animate={{ scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <GantrySign className={presenter ? "px-5 py-4" : "px-6 py-5"}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="sign-label flex items-center gap-2 text-sm">
              <Check className="size-5" strokeWidth={3} aria-hidden /> Approved · Tier {action?.tier ?? 3}
            </span>
            {!presenter && approval.decided_by && (
              <span className="text-sm">You approved this{approval.decided_at ? ` at ${dayShort(record.day0, approval.decided_at)}` : ""}.</span>
            )}
          </div>
          <div className={cn("mt-1 font-black", presenter ? "text-xl" : "text-2xl")}>{title}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-base">
            <span className="font-black">{juta(c.cost)}</span>
            {action?.sap_ref ? (
              <span data-testid={ids.sapRef} className="inline-flex items-center gap-1.5">
                SAP document{" "}
                <motion.b
                  className="font-mono text-xl"
                  initial={wasPending && !reduce ? { opacity: 0, scale: 0.6 } : false}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "spring", stiffness: 420, damping: 18 }}
                >
                  {action.sap_ref}
                </motion.b>
                <span className="font-mono text-sm">· {action.status.replace("_", " ").toLowerCase()}</span>
              </span>
            ) : (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Creating the {object} in SAP
              </span>
            )}
            {action?.eta && <span>Arrives {dayShort(record.day0, action.eta)}</span>}
          </div>
        </GantrySign>
      </motion.div>
    );
  }

  // ---- rejected / expired: white with a red border, SIAGA replans
  if (!pending && approval.status !== "PENDING") {
    const expired = approval.status === "EXPIRED" || action?.status === "EXPIRED";
    return (
      <div {...common} className="rounded-[12px] border-4 border-stop-red bg-road-white px-5 py-4 text-asphalt">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPlate tone="rejected">{expired ? "Approved too late" : "Rejected"}</StatusPlate>
          <span className="text-sm font-bold">
            {expired
              ? `The approve-by time had passed, so SIAGA replanned.`
              : `${approval.decided_by === "planner" || !approval.decided_by ? "You" : approval.decided_by} rejected this. SIAGA keeps what was done and replans.`}
          </span>
        </div>
        <div className={cn("mt-1 font-black", presenter ? "text-xl" : "text-xl")}>{title}</div>
        <div className="mt-1 text-sm">
          {c.cost_display}
          {approval.reason && (
            <>
              {" "}· Reason: <span lang="id">“{approval.reason}”</span>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---- pending: the yellow warning plate
  const rejectedOptions = record.critic_findings.filter((f) => !f.clean);
  return (
    <WarningPlate size="lg" className={cn(presenter ? "p-4" : "p-6")}>
      <div {...common} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="sign-label text-sm">Your approval needed · Tier {action?.tier ?? 3}</span>
          {approveBy && (
            <span
              data-testid="approve-by"
              className={cn(
                "rounded-[6px] px-2.5 py-1 font-mono text-sm font-bold whitespace-nowrap",
                left?.expired ? "bg-stop-red text-white" : "bg-asphalt text-signal-yellow",
              )}
            >
              {left ? `${left.text} · ` : ""}Approve by {approveBy}
            </span>
          )}
        </div>
        <h3 className={cn("leading-tight font-black", presenter ? "text-xl" : "text-2xl")}>{title}</h3>

        <div className={cn("grid gap-4", presenter ? "grid-cols-1" : "sm:grid-cols-2")}>
          <div>
            <div className="sign-label text-xs">Cost</div>
            <div className={cn("font-black", presenter ? "text-2xl" : "text-4xl")}>{juta(c.cost)}</div>
            <div className="text-sm">
              {c.cost_display} · part of a plan totalling {c.plan_total_display}
            </div>
          </div>
          {!presenter && (
            <div>
              <div className="sign-label text-xs">If you reject</div>
              <p className="text-sm">{c.if_rejected}</p>
            </div>
          )}
        </div>

        {!presenter && (
          <div className="rounded-[8px] bg-[#ffe6a3] px-4 py-3">
            {c.summary ? (
              <>
                <AgentWritten by={c.summary_by} />
                <p className="text-base" data-testid="approval-summary">
                  {c.summary}
                </p>
              </>
            ) : (
              <>
                <div className="sign-label text-xs">Why</div>
                <p className="text-base">{c.why}</p>
              </>
            )}
          </div>
        )}

        {!presenter && (c.alternatives.length > 0 || rejectedOptions.length > 0) && (
          <div>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="sign-label text-xs">Other options</span>
              <SolverLabel className="text-asphalt" />
            </div>
            <ul className="mt-1 space-y-0.5 text-sm">
              {c.alternatives.map((x) => (
                <li key={x.option_id}>
                  <b>
                    {x.option_id}, {x.label.toLowerCase()}:
                  </b>{" "}
                  {x.total_cost_display}, clean.
                </li>
              ))}
              {rejectedOptions.map((f) => {
                const o = record.solver_results.find((s) => s.option_id === f.option_id);
                const why = f.checks.filter((k) => !k.passed).map((k) => k.plain || k.detail).join("; ");
                return (
                  <li key={f.option_id}>
                    <b>
                      {f.option_id}, {o?.label.toLowerCase() ?? "option"}:
                    </b>{" "}
                    {o?.total_cost_display}, rejected by the Critic. {why}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {!presenter && (
          <p className="font-mono text-xs">
            Covers these exact arguments only: {action?.tool ?? approval.tool}
            {action?.planned?.reference ? ` · ${action.planned.reference}` : ""}
            {action ? ` · ${action.quantity} ctn` : ""}. SAP request: {c.what}
          </p>
        )}
        {presenter && <p className="sr-only">{c.what}</p>}

        {!rejecting ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size={presenter ? "lg" : "lg"}
              variant="approve"
              disabled={!!busy}
              onClick={() => decide("approve")}
              data-testid={ids.approve}
              className={presenter ? "flex-1" : undefined}
            >
              {busy === "approve" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check aria-hidden />}
              {busy === "approve" ? `Creating the ${object} in SAP` : `Approve ${object}`}
            </Button>
            {!busy && (
              <Button
                size="lg"
                variant="outline"
                className="border-asphalt bg-transparent hover:bg-[#ffe6a3]"
                onClick={() => setRejecting(true)}
                data-testid={ids.rejectOpen}
              >
                Reject…
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2 rounded-[8px] bg-road-white p-3">
            <label className="text-sm font-bold" htmlFor={`reason-${approval.approval_id}`}>
              Reason (optional; SIAGA reads it when it replans)
            </label>
            <input
              id={`reason-${approval.approval_id}`}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Reason (optional, the agent reads it)"
              className="h-11 rounded-[8px] border-2 border-asphalt bg-road-white px-3 text-base text-asphalt"
              data-testid={ids.reason}
            />
            <div className="flex flex-wrap gap-2">
              <Button variant="stop" disabled={!!busy} onClick={() => decide("reject")} data-testid={ids.reject}>
                {busy === "reject" ? "Rejecting" : `Reject ${object}`}
              </Button>
              <Button variant="outline" disabled={!!busy} onClick={() => setRejecting(false)}>
                Keep it pending
              </Button>
            </div>
          </div>
        )}
        {error && <p className="text-sm font-bold text-risk-ink">{error}</p>}
      </div>
    </WarningPlate>
  );
}
