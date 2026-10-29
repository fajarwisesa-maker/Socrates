"use client";

// Approvals (mockup "Pusat Persetujuan"): the decisions SIAGA may not take alone, why the
// plan is the right one, and the policy that decides who acts. The tiers are SIAGA's real
// policy (Cedar + the same check in code), not an org chart.
import { Check, FileText, MessageCircle, Scale, ShieldCheck, X } from "lucide-react";
import { ApprovalSign } from "@/components/ApprovalSign";
import { LaneDivider, TierPlate, TIER_MEANING, AgentWritten } from "@/components/signs";
import { Button } from "@/components/ui/button";
import { caseStatusView } from "@/lib/caseView";
import { actionTitle } from "@/lib/present";
import { juta } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Chip, PageHeader, Panel } from "../ui";
import type { CasePageProps } from "./types";

export function Approvals({ record, approvals, onDecided, onPage }: CasePageProps) {
  const labels = record.affected?.labels;
  const dest = record.affected?.plant ?? "";
  const pendingFirst = [...approvals].sort(
    (a, b) => Number(b.status === "PENDING") - Number(a.status === "PENDING") || b.approval_id.localeCompare(a.approval_id),
  );
  const view = caseStatusView(record, approvals);
  const pending = view.decidable.length;
  const auto = record.actions.filter((a) => a.status === "EXECUTED" && a.tier <= 2);
  const chosen = record.critic_findings.find((f) => f.option_id === record.chosen_option);

  return (
    <div className="flex flex-col gap-8" data-testid="page-approvals">
      <PageHeader
        chips={<Chip tone={view.pageChip.tone} testId="approvals-chip">{view.pageChip.text}</Chip>}
        title="Approvals"
        description="SIAGA does internal, reversible actions under Rp 50 jt itself. Supplier orders, spot air, customer date changes and anything from Rp 50 jt wait here for you."
      />

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          {auto.length > 0 && (
            <Panel title="Done by SIAGA alone" icon={<Check aria-hidden />} description="Tier 2: internal and reversible">
              {auto.map((a) => (
                <article key={a.action_id} className="flex items-center gap-4 border-b border-divider pb-2 last:border-0" data-testid="executed-action">
                  <TierPlate tier={a.tier} />
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">{actionTitle(a, labels, dest)}</div>
                    <div className="font-mono text-xs text-ink-2">{a.sap_ref ? `SAP ${a.sap_ref}` : ""}</div>
                  </div>
                  <span className="text-lg font-black">{juta(a.cost)}</span>
                </article>
              ))}
            </Panel>
          )}
          {pending > 0 && <LaneDivider label="Needs you" />}
          {pendingFirst.length === 0 && (
            <p className="rounded-[12px] bg-surface-2 p-6 text-base text-ink-2" data-testid="sheet-waiting">
              No decision yet. SIAGA raises one when the chosen plan needs a Tier 3 action.
            </p>
          )}
          {pendingFirst.map((a) => (
            <ApprovalSign key={a.approval_id} approval={a} record={record} onDecided={onDecided} onNext={() => onPage("verification")} onSeeWhy={() => onPage("audit")} />
          ))}
          {record.notes.map((n) => (
            <p key={n.ref} className="flex items-start gap-4 text-sm" data-testid="tier0-note">
              <TierPlate tier={n.tier} /> <span>{n.text}</span>
            </p>
          ))}
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          <Panel title="Who may act" icon={<Scale aria-hidden />} description="SIAGA's policy, checked by Cedar and again in code" testId="authority">
            <ol className="flex flex-col gap-2">
              {[0, 1, 2, 3].map((t) => (
                <li key={t} className={cn("flex items-start gap-2 rounded-[8px] p-2", t === 3 && pending > 0 && "bg-chip-needs-bg")}>
                  <TierPlate tier={t} />
                  <span className="text-sm">
                    <b>{TIER_MEANING[t].short}.</b> {TIER_MEANING[t].long}
                  </span>
                </li>
              ))}
            </ol>
          </Panel>

          {chosen && (
            <Panel title="Why this plan" icon={<ShieldCheck aria-hidden />} description={`The Critic's checks on option ${chosen.option_id}`}>
              <ul className="flex flex-col gap-1 text-sm">
                {chosen.checks.map((c, i) => (
                  <li key={i} className={cn("flex gap-2", !c.passed && "font-bold text-chip-risk-fg")}>
                    {c.passed ? <Check className="mt-0.5 size-4 shrink-0 text-sign-green" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0" aria-hidden />}
                    {c.plain || c.detail}
                  </li>
                ))}
              </ul>
              {record.explanation && (
                <div className="flex flex-col gap-1 border-t border-divider pt-2">
                  <AgentWritten />
                  <p className="text-sm">{record.explanation.recommendation_rationale}</p>
                </div>
              )}
            </Panel>
          )}

          <Panel title="Evidence" icon={<FileText aria-hidden />} description="The signals the case rests on">
            <ul className="flex flex-col gap-2 text-sm">
              {record.signals.map((s, i) => (
                <li key={i} className="flex items-center gap-2">
                  {s.type === "pdf" ? <FileText className="size-4 text-ink-2" aria-hidden /> : <MessageCircle className="size-4 text-ink-2" aria-hidden />}
                  {s.type === "pdf" ? `Forwarder notice · ${s.filename ?? "PDF"}` : `Driver · WhatsApp${s.sender ? ` · ${s.sender}` : ""}`}
                </li>
              ))}
            </ul>
            <Button variant="link" className="self-start text-sm" onClick={() => onPage("signals")}>
              Open the signals
            </Button>
          </Panel>
        </div>
      </div>
    </div>
  );
}
