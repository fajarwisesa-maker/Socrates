"use client";

// The approval sign (docs/redesign-prompt.md 6.5, docs/polish-prompt.md 3.3 and 4.2): ONE
// element whose colours change with the state, so approve and reject read as a change in
// place. Pending: yellow with a 2px asphalt hairline. Approved: green, no outline, with the
// SAP document. Rejected or too late: white with a 2px red hairline while SIAGA replans.
// Up front: what, cost and deadline, what happens if you reject, the buttons. Why, the
// other options and the binding note sit under "Show details". Every amount and date comes
// from the approval card the backend built.
import { ArrowRight, Check, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/lib/api";
import { actionFor, approvalState, approvalTitle, countdown, DECISION_OBJECT, plainError, planTotal, type ApprovalState } from "@/lib/caseView";
import { dayShort, juta, thousands } from "@/lib/format";
import type { Approval, CaseAction, CaseRecord } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { Reveal } from "./Reveal";
import { AgentWritten, NoBreakCodes, SolverLabel } from "./signs";
import { Button } from "./ui/button";

type Variant = "planner" | "presenter";
type Tone = ApprovalState;

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

/** Presenter: the object on the button and the title, short enough for one line. */
const SHORT_OBJECT: Record<string, string> = { alternate_supplier: "PO", spot_air: "air charter", stock_transfer: "transfer" };

function shortTitle(a: CaseAction | undefined): string | null {
  if (!a) return null;
  const q = thousands(a.quantity);
  // the source is on the map right above the sign
  if (a.kind === "alternate_supplier") return `Bridge PO · ${q} ctn`;
  if (a.kind === "spot_air") return `Air charter · ${q} ctn`;
  if (a.kind === "stock_transfer") return `Transfer · ${q} ctn`;
  return null;
}

/** Planner (UI v3): the mockup's calm cards; the colours still change in place. */
const PLANNER_TONE: Record<Tone, string> = {
  pending: "bg-tint-needs-bg text-asphalt inset-ring-2 inset-ring-signal-yellow",
  busy: "bg-tint-needs-bg text-asphalt inset-ring-2 inset-ring-tint-needs-line",
  approved: "bg-tint-ok-bg text-asphalt inset-ring-2 inset-ring-sign-green",
  rejected: "bg-road-white text-asphalt inset-ring-2 inset-ring-stop-red",
  expired: "bg-tint-risk-bg text-asphalt inset-ring-2 inset-ring-stop-red",
  escalated: "bg-tint-risk-bg text-asphalt inset-ring-2 inset-ring-stop-red",
};

/** The label plate in the sign's top line. */
const LABEL_PLATE: Record<Tone, string> = {
  pending: "bg-signal-yellow text-asphalt",
  busy: "bg-chip-needs-bg text-chip-needs-fg",
  approved: "bg-chip-ok-bg text-chip-ok-fg",
  rejected: "bg-chip-risk-bg text-chip-risk-fg",
  expired: "bg-chip-risk-bg text-chip-risk-fg",
  escalated: "bg-chip-risk-bg text-chip-risk-fg",
};

const TONE: Record<Tone, string> = {
  pending: "bg-signal-yellow text-asphalt inset-ring-2 inset-ring-asphalt",
  busy: "bg-signal-yellow text-asphalt inset-ring-2 inset-ring-asphalt",
  approved: "bg-sign-green text-white inset-ring-2 inset-ring-transparent",
  rejected: "bg-road-white text-asphalt inset-ring-2 inset-ring-stop-red",
  expired: "bg-road-white text-asphalt inset-ring-2 inset-ring-stop-red",
  escalated: "bg-road-white text-asphalt inset-ring-2 inset-ring-stop-red",
};

export function ApprovalSign({
  approval,
  record,
  variant = "planner",
  onDecided,
  onNext,
  onSeeWhy,
}: {
  approval: Approval;
  record: CaseRecord;
  variant?: Variant;
  onDecided?: () => void;
  /** Planner: the next step after an approval ("Go to Verify"); focus moves to it */
  onNext?: () => void;
  /** escalated: "See what happened" (Planner opens the audit trail) */
  onSeeWhy?: () => void;
}) {
  const now = useNow(1000);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [decidedHere, setDecidedHere] = useState(false);
  const nextRef = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  const titleId = useId();
  const action = actionFor(approval, record);
  const c = approval.card;
  const ids = IDS[variant];
  const presenter = variant === "presenter";
  const object = DECISION_OBJECT[action?.kind ?? ""] ?? "action";
  const title = approvalTitle(action, record, c.what);
  // one source for the state: lib/caseView.ts approvalState (the case status decides)
  const tone: Tone = approvalState(approval, record);
  const left = countdown(c.approve_by, now);
  const approveBy = c.approve_by ? dayShort(record.day0, c.approve_by) : null;
  const rejectedOptions = record.critic_findings.filter((f) => !f.clean);
  const sapRef = action?.sap_ref ?? null;

  // after an approval made here, focus moves to the next action
  useEffect(() => {
    if (decidedHere && tone === "approved" && sapRef) nextRef.current?.focus();
  }, [decidedHere, tone, sapRef]);

  async function decide(decision: "approve" | "reject") {
    setBusy(decision);
    setError(null);
    try {
      await api.decide(record.case_id, approval.approval_id, decision, decision === "reject" ? reason : undefined);
      setDecidedHere(true);
      onDecided?.();
    } catch (e) {
      setError(plainError(e, decision === "approve" ? "approving" : "rejecting"));
      setBusy(null);
      onDecided?.(); // reload: the case may have moved on
    }
  }

  const announcement: Record<Tone, string> = {
    approved: sapRef ? `Approved. ${title}: SAP document ${sapRef}.` : `Approved. Creating the ${object} in SAP.`,
    rejected: "Rejected. SIAGA keeps what was done and replans.",
    expired: "Approved too late. SIAGA replans.",
    escalated: "Escalated. The case was handed to a human planner; this can no longer be decided here.",
    busy: "",
    pending: "",
  };

  const tier = `Tier ${action?.tier ?? 3}`;
  const label: Record<Tone, string> = {
    approved: `Approved · ${tier}`,
    rejected: "Rejected",
    expired: "Approved too late",
    escalated: "Escalated · not actionable",
    busy: `${tier} · waiting for SIAGA`,
    pending: presenter ? `${tier} · needs you` : `Your approval needed · ${tier}`,
  };

  const deadline = tone === "pending" && approveBy && (
    <span
      data-testid="approve-by"
      className={cn(
        "rounded-[6px] px-2 py-1 font-mono text-sm font-bold whitespace-nowrap transition-colors duration-[var(--dur-base)]",
        left?.expired ? "bg-chip-risk-bg text-chip-risk-fg" : "bg-asphalt text-signal-yellow",
      )}
    >
      {left ? `${left.expired ? "Approve-by passed" : left.text} · ` : ""}Approve by {approveBy}
    </span>
  );

  const sapLine = tone === "approved" && (
    <Reveal delay={120} className="flex flex-wrap items-center gap-x-4 gap-y-1" key={sapRef ?? "creating"}>
      {sapRef ? (
        <span data-testid={ids.sapRef} className="inline-flex items-center gap-2">
          <Check className="size-5" strokeWidth={3} aria-hidden />
          {presenter ? "SAP" : "SAP document"} <b className="font-mono text-xl">{sapRef}</b>
          {!presenter && action && <span className="font-mono text-sm">· {action.status.replace("_", " ").toLowerCase()}</span>}
        </span>
      ) : (
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden /> Creating the {object} in SAP
        </span>
      )}
      {action?.eta && <span>Arrives {dayShort(record.day0, action.eta)}</span>}
    </Reveal>
  );

  const closedLine = (tone === "rejected" || tone === "expired" || tone === "escalated" || tone === "busy") && (
    <Reveal delay={120} as="div" className="flex flex-col gap-2 text-base" testId="approval-closed">
      <p>
        {tone === "escalated"
          ? "SIAGA handed the case to a human planner before this was decided, so it cannot be approved or rejected here. Everything done so far is kept in SAP and in the audit trail."
          : tone === "expired"
            ? record.status === "RUNNING"
              ? "The approve-by time had passed, so SIAGA is replanning."
              : "The approve-by time had passed, so SIAGA replanned."
            : tone === "busy"
              ? "SIAGA is still working on the case. You can decide as soon as it waits for you."
              : `${approval.decided_by === "planner" || !approval.decided_by ? "You" : approval.decided_by} rejected this. SIAGA keeps what was done and replans.`}
        {tone === "rejected" && approval.reason && (
          <>
            {" "}Reason: <span lang="id">“{approval.reason}”</span>
          </>
        )}
      </p>
      {tone === "escalated" && record.escalation_reason && (
        <p className="text-sm" data-testid="escalation-reason">
          <b>Why:</b> {record.escalation_reason}
        </p>
      )}
      {tone === "escalated" && onSeeWhy && (
        <Button variant="link" className="self-start text-sm text-current" onClick={onSeeWhy} data-testid="see-what-happened">
          See what happened <ArrowRight aria-hidden />
        </Button>
      )}
    </Reveal>
  );

  const rejectForm = rejecting && tone === "pending" && (
    <div className="flex flex-col gap-2 rounded-[8px] bg-road-white p-4 text-asphalt">
      <label className="text-sm font-bold" htmlFor={`reason-${approval.approval_id}`}>
        Reason (optional; SIAGA reads it when it replans)
      </label>
      <input
        id={`reason-${approval.approval_id}`}
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (optional, the agent reads it)"
        className="h-11 rounded-[8px] bg-road-white px-4 text-base text-asphalt inset-ring-2 inset-ring-asphalt"
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
  );

  const approveButton = (
    <Button
      size="lg"
      variant="approve"
      disabled={!!busy}
      onClick={() => decide("approve")}
      data-testid={ids.approve}
    >
      {busy === "approve" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check aria-hidden />}
      {busy === "approve" ? `Creating the ${object} in SAP` : `Approve ${object}`}
    </Button>
  );

  const common = {
    "data-testid": "approval-card",
    "data-status": approval.status,
    "data-variant": variant,
    "data-tone": tone,
    "aria-labelledby": titleId,
  };
  const live = (
    <p className="sr-only" aria-live="polite">
      {announcement[tone]}
    </p>
  );

  // ---- Presenter: a compact two-row sign under the map; it turns green in place
  if (presenter) {
    return (
      <section
        {...common}
        className={cn("rounded-[12px] px-6 py-4 transition-[background-color,color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-standard)]", TONE[tone])}
      >
        <div className="flex items-center gap-4">
          <span className="sign-label shrink-0 text-sm">{label[tone]}</span>
          <h3 id={titleId} className="min-w-0 flex-1 truncate text-xl leading-tight font-black" title={title}>
            {shortTitle(action) ?? title}
          </h3>
          {tone === "pending" && !rejecting && !busy && (
            <Button variant="link" className="shrink-0 text-base" onClick={() => setRejecting(true)} data-testid={ids.rejectOpen}>
              Reject…
            </Button>
          )}
        </div>
        <div className="mt-2 flex min-h-12 items-center gap-4 text-lg">
          <b className="shrink-0 text-2xl leading-none font-black">{juta(c.cost)}</b>
          {tone === "pending" && approveBy && (
            <span
              data-testid="approve-by"
              className={cn(
                "rounded-[6px] px-2 py-1 font-mono text-sm font-bold whitespace-nowrap",
                left?.expired ? "bg-stop-red text-white" : "bg-asphalt text-signal-yellow",
              )}
            >
              Approve by {approveBy}
            </span>
          )}
          {sapLine}
          {closedLine}
          {tone === "pending" && !rejecting && (
            <Button
              size="lg"
              variant="approve"
              disabled={!!busy}
              onClick={() => decide("approve")}
              data-testid={ids.approve}
              className="ml-auto px-4 text-lg"
            >
              {busy === "approve" ? <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check aria-hidden />}
              {busy === "approve" ? "Creating in SAP" : `Approve ${SHORT_OBJECT[action?.kind ?? ""] ?? object}`}
            </Button>
          )}
        </div>
        <p className="sr-only">{c.what}</p>
        {rejectForm && <div className="mt-4">{rejectForm}</div>}
        {error && <p className="mt-2 text-base font-bold">{error}</p>}
        {live}
      </section>
    );
  }

  // ---- Planner
  return (
    <section
      {...common}
      className={cn(
        "flex flex-col gap-4 rounded-[12px] px-8 py-6 transition-[background-color,color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-standard)]",
        PLANNER_TONE[tone],
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span
          className={cn(
            "sign-label flex items-center gap-2 rounded-[6px] px-2 py-1 text-sm transition-colors duration-[var(--dur-base)]",
            LABEL_PLATE[tone],
          )}
          data-testid="approval-label"
        >
          {tone === "approved" && <Check className="size-4" strokeWidth={3} aria-hidden />}
          {label[tone]}
        </span>
        {deadline}
        {tone === "approved" && approval.decided_by && (
          <span className="text-sm">You approved this{approval.decided_at ? ` at ${dayShort(record.day0, approval.decided_at)}` : ""}.</span>
        )}
      </div>
      <div className="flex flex-col gap-1">
        <h3 id={titleId} className="text-xl leading-tight font-black">
          <NoBreakCodes text={title} />
        </h3>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
          <span className="flex flex-col">
            <span className="text-4xl leading-none font-black">{juta(c.cost)}</span>
            <span className="mt-1 font-mono text-xs text-ink-2">{c.cost_display}</span>
          </span>
          {planTotal(action, record) && <span className="pb-5 text-sm">part of the {planTotal(action, record)} plan</span>}
        </div>
      </div>
      {tone === "pending" && (
        <p className="text-base">
          <b>If you reject:</b> {c.if_rejected}
        </p>
      )}
      {sapLine}
      {closedLine}

      {tone === "pending" && !rejecting && (
        <div className="flex flex-wrap items-center gap-4">
          {approveButton}
          {!busy && (
            <Button variant="outline" size="lg" onClick={() => setRejecting(true)} data-testid={ids.rejectOpen}>
              Reject…
            </Button>
          )}
        </div>
      )}
      {rejectForm}
      {tone === "approved" && sapRef && onNext && (
        <Reveal delay={120}>
          <Button ref={nextRef} variant="link" className="text-base text-current" onClick={onNext} data-testid="go-verify">
            Go to Verify <ArrowRight aria-hidden />
          </Button>
        </Reveal>
      )}
      {error && <p className="text-sm font-bold text-risk-ink">{error}</p>}

      <div>
        <Button
          variant="link"
          className="text-sm text-current"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((o) => !o)}
          data-testid="approval-details-toggle"
        >
          {open ? "Hide details" : "Show details"}
          <ChevronDown className={cn("transition-transform duration-[var(--dur-fast)]", open && "rotate-180")} aria-hidden />
        </Button>
        {/* collapsed with `hidden`, still in the DOM (tests and find-in-page read it) */}
        <div id={detailsId} hidden={!open} className={cn("mt-4 flex flex-col gap-4", open && "rise")} style={{ animationDuration: "240ms" }}>
          {c.summary ? (
            <div>
              <AgentWritten by={c.summary_by} />
              <p className="text-base" data-testid="approval-summary">
                {c.summary}
              </p>
            </div>
          ) : (
            <div>
              <div className="sign-label text-xs">Why</div>
              <p className="text-base">{c.why}</p>
            </div>
          )}
          {(c.alternatives.length > 0 || rejectedOptions.length > 0) && (
            <div>
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="sign-label text-xs">Other options</span>
                <SolverLabel className="text-current" />
              </div>
              <ul className="mt-1 flex flex-col gap-1 text-sm">
                {c.alternatives.map((x) => (
                  <li key={x.option_id}>
                    <b>
                      {x.option_id}, {x.label.toLowerCase()}:
                    </b>{" "}
                    {juta(record.solver_results.find((s) => s.option_id === x.option_id)?.result.total_cost) ?? x.total_cost_display}, clean.
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
                      {o ? juta(o.result.total_cost) : ""}, rejected by the Critic. {why}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <p className="font-mono text-xs">
            Covers these exact arguments only: {action?.tool ?? approval.tool}
            {action?.planned?.reference ? ` · ${action.planned.reference}` : ""}
            {action ? ` · ${action.quantity} ctn` : ""}. SAP request: {c.what}
          </p>
        </div>
      </div>
      {live}
    </section>
  );
}
