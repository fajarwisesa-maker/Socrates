"use client";

// Approvals (mockup "Pusat Persetujuan"): the decisions SIAGA may not take alone, why the
// plan is the right one, and the policy that decides who acts. The tiers are SIAGA's real
// policy (Cedar + the same check in code), not an org chart.
import { ArrowRight, Check, FileText, Info, MessageCircle, Scale, ShieldCheck, X } from "lucide-react";
import { ApprovalSign } from "@/components/ApprovalSign";
import { Reveal } from "@/components/Reveal";
import { LaneDivider, TierPlate, TIER_MEANING, AgentWritten } from "@/components/signs";
import { Button } from "@/components/ui/button";
import { caseStatusView } from "@/lib/caseView";
import { actionTitle } from "@/lib/present";
import { juta } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Chip, Note, PageHeader, Panel, RowItem, Rows } from "../ui";
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
    <div className="flex flex-col gap-6" data-testid="page-approvals">
      <Reveal>
        <PageHeader
          chips={<Chip tone={view.pageChip.tone} testId="approvals-chip">{view.pageChip.text}</Chip>}
          title="Approvals"
          description="SIAGA does internal, reversible actions under Rp 50 jt itself. Supplier orders, spot air, customer date changes and anything from Rp 50 jt wait here for you."
        />
      </Reveal>

      <Reveal delay={50} className="grid gap-6 xl:grid-cols-12">
        {/* main column: what was done, what waits, and why this plan */}
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-8">
          {auto.length > 0 && (
            <Panel title="Done by SIAGA alone" icon={<Check aria-hidden />} tone="ok" description="Tier 2: internal and reversible" className="h-auto">
              <Rows>
                {auto.map((a) => (
                  <RowItem key={a.action_id} className="items-center" testId="executed-action">
                    <TierPlate tier={a.tier} />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">{actionTitle(a, labels, dest)}</div>
                      <div className="font-mono text-xs text-ink-2">{a.sap_ref ? `SAP ${a.sap_ref}` : ""}</div>
                    </div>
                    <span className="text-lg font-black whitespace-nowrap">{juta(a.cost)}</span>
                  </RowItem>
                ))}
              </Rows>
            </Panel>
          )}
          {pending > 0 && <LaneDivider label="Needs you" />}
          {pendingFirst.length === 0 && (
            <Panel title="No decision yet" icon={<ShieldCheck aria-hidden />} className="h-auto" testId="sheet-waiting">
              <Note>SIAGA raises one when the chosen plan needs a Tier 3 action.</Note>
            </Panel>
          )}
          {pendingFirst.map((a) => (
            <ApprovalSign
              key={a.approval_id}
              approval={a}
              record={record}
              onDecided={onDecided}
              onNext={() => onPage("verification")}
              onSeeWhy={() => onPage("audit")}
            />
          ))}
          {chosen && (
            <Panel
              title="Why this plan"
              icon={<ShieldCheck aria-hidden />}
              tone="ok"
              description={`The Critic's checks on option ${chosen.option_id}`}
              className="h-auto"
              footer={
                record.explanation ? (
                  <>
                    <AgentWritten />
                    <p className="text-sm">{record.explanation.recommendation_rationale}</p>
                  </>
                ) : undefined
              }
            >
              <ul className="grid gap-x-6 gap-y-1 text-sm lg:grid-cols-2">
                {chosen.checks.map((c, i) => (
                  <li key={i} className={cn("flex gap-2", !c.passed && "font-bold text-chip-risk-fg")}>
                    {c.passed ? <Check className="mt-0.5 size-4 shrink-0 text-sign-green" aria-hidden /> : <X className="mt-0.5 size-4 shrink-0" aria-hidden />}
                    {c.plain || c.detail}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>

        {/* side column: who may act, the evidence, notes */}
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-4">
          <Panel title="Who may act" icon={<Scale aria-hidden />} tone="info" description="SIAGA's policy, checked by Cedar and again in code" testId="authority" className="h-auto">
            <Rows>
              {[0, 1, 2, 3].map((t) => (
                <RowItem key={t} tone={t === 3 && pending > 0 ? "needs" : undefined}>
                  <TierPlate tier={t} />
                  <span className="text-sm">
                    <b>{TIER_MEANING[t].short}.</b> {TIER_MEANING[t].long}
                  </span>
                </RowItem>
              ))}
            </Rows>
          </Panel>

          <Panel
            title="Evidence"
            icon={<FileText aria-hidden />}
            tone="info"
            description="The signals the case rests on"
            className="h-auto"
            footer={
              <Button variant="link" className="self-start text-sm" onClick={() => onPage("signals")}>
                Open the signals <ArrowRight aria-hidden />
              </Button>
            }
          >
            <Rows className="text-sm">
              {record.signals.map((s, i) => (
                <RowItem key={i} className="items-center">
                  {s.type === "pdf" ? <FileText className="size-4 shrink-0 text-ink-2" aria-hidden /> : <MessageCircle className="size-4 shrink-0 text-ink-2" aria-hidden />}
                  {s.type === "pdf" ? `Forwarder notice · ${s.filename ?? "PDF"}` : `Driver · WhatsApp${s.sender ? ` · ${s.sender}` : ""}`}
                </RowItem>
              ))}
            </Rows>
          </Panel>

          {record.notes.length > 0 && (
            <Panel title="Left as it is" icon={<Info aria-hidden />} tone="info" description="Tier 0: noted, no action taken" className="h-auto">
              <Rows className="text-sm">
                {record.notes.map((n) => (
                  <RowItem key={n.ref} testId="tier0-note">
                    <TierPlate tier={n.tier} />
                    <span>{n.text}</span>
                  </RowItem>
                ))}
              </Rows>
            </Panel>
          )}
        </div>
      </Reveal>
    </div>
  );
}
