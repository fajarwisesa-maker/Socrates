"use client";

// Verification (mockup "Verifikasi"): SIAGA re-reads SAP after the plan is executed and
// checks that every document exists with the right quantity, on time, and that the DC is
// covered by the cutoff. A failed check reopens the case.
import { Check, ClipboardCheck, Info, Map as MapIcon, MessageCircle, Timer, X } from "lucide-react";
import { LaneMap } from "@/components/LaneMap";
import { Reveal } from "@/components/Reveal";
import { caseClock } from "@/lib/caseClock";
import { dayShort, juta, minutesSeconds, thousands } from "@/lib/format";
import { laneModel } from "@/lib/laneModel";
import { actionTitle, whatsappReply } from "@/lib/present";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { CARD } from "../../signs";
import { Chip, PageHeader, Panel } from "../ui";
import type { CasePageProps } from "./types";

export function Verification({ record, events }: CasePageProps) {
  const now = useNow(500);
  const v = record.verification;
  const s = record.summary;
  const risk = record.risk;
  const resolved = record.status === "RESOLVED" && v?.covered;
  const reopened = record.status === "REOPENED";
  const clock = caseClock(events, now);
  const due = record.verify_due_at && now ? Math.max(0, Math.ceil((Date.parse(record.verify_due_at) - now) / 1000)) : null;
  const model = laneModel(record, { kind: "verify" });
  const reply = whatsappReply(events);
  const executed = record.actions.filter((a) => a.status === "EXECUTED" && a.sap_ref);
  const docs = executed.length;
  const labels = record.affected?.labels;
  const dest = record.affected?.plant ?? "";

  return (
    <div className="flex flex-col gap-8" data-testid="page-verification">
      <PageHeader
        chips={
          resolved ? (
            <Chip tone="ok" icon={<Check aria-hidden />}>
              Verified in SAP
            </Chip>
          ) : reopened ? (
            <Chip tone="risk">Reopened</Chip>
          ) : record.verify_due_at ? (
            <Chip tone="info">Checking</Chip>
          ) : undefined
        }
        title="Verification"
        description="After the plan runs, SIAGA re-reads SAP: every document, its quantity and arrival, and whether the DC is covered by the loading cutoff."
      />

      {reopened && (
        <div className={cn(CARD, "flex flex-col gap-2 p-6 inset-ring-2 inset-ring-stop-red")} data-testid="reopened-plate">
          <Chip tone="risk" className="self-start">
            Reopened
          </Chip>
          <p className="text-base font-bold">SAP no longer shows the planned supply arriving in time. Everything executed so far stays in SAP and in the audit trail.</p>
        </div>
      )}

      {!v && (
        <p className="rounded-[12px] bg-surface-2 p-6 text-base text-ink-2" data-testid="sheet-waiting">
          {due !== null && due > 0
            ? `SIAGA re-reads SAP in ${due} s.`
            : record.verify_due_at
              ? `Checking ${docs === 2 ? "both documents" : docs === 1 ? "the document" : `${docs} documents`} in SAP…`
              : "Verification runs after every action is executed."}
        </p>
      )}

      {resolved && s && (
        <Reveal>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-[12px] bg-sign-green p-6 text-white">
            <p className="text-3xl font-black" data-testid="outcome-line">
              {juta(s.exposure_avoided)} protected for {juta(s.case_cost ?? s.chosen_cost)}
            </p>
            {clock.stoppedBy === "resolved" && (
              <p className="flex items-center gap-2 text-base">
                <Timer className="size-5" aria-hidden /> Signal to verified in {minutesSeconds(clock.seconds)}
              </p>
            )}
          </div>
        </Reveal>
      )}

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <Panel title="Routes in SAP" icon={<MapIcon aria-hidden />} description={model?.title}>
          {model && <LaneMap model={model} />}
        </Panel>
        <div className="flex flex-col gap-8">
          {v && (
            <Panel title="Coverage at the DC" icon={<ClipboardCheck aria-hidden />}>
              <Reveal as="p" className={cn("text-xl", reopened && "font-bold text-chip-risk-fg")} testId="coverage">
                {thousands(v.projected_supply)} of {thousands(v.demand)} cartons {v.covered ? "covered" : "projected"}
                {risk?.deadline ? ` by the cutoff ${dayShort(record.day0, risk.deadline)}` : ""}.
              </Reveal>
            </Panel>
          )}
          {reply && (
            <p className="flex items-center gap-2 font-bold text-brand-ink" data-testid="planner-whatsapp-reply">
              <MessageCircle className="size-4" aria-hidden /> {reply}
            </p>
          )}
          {record.notes.map((n) => (
            <p key={n.ref} className="flex items-start gap-2 text-sm text-ink-2">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {n.text}
            </p>
          ))}
        </div>
      </div>

      <Panel title="Documents in SAP" icon={<ClipboardCheck aria-hidden />} description="One card per executed action" testId="verify-checks">
        <div className="grid gap-4 lg:grid-cols-2">
          {executed.length === 0 && <p className="text-sm text-ink-2">Nothing executed yet.</p>}
          {executed.map((a, i) => {
            const c = v?.checks.find((k) => k.ref === a.sap_ref);
            return (
              <Reveal key={a.action_id} delay={i * 70}>
                <article className="flex flex-col gap-2 rounded-[12px] bg-surface p-4 inset-ring inset-ring-hairline">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-base font-black">{a.sap_ref}</span>
                    {c ? (
                      <Chip tone={c.ok ? "ok" : "risk"} icon={c.ok ? <Check aria-hidden /> : <X aria-hidden />}>
                        {c.ok ? "Matches SAP" : c.on_time === false ? "Late" : "Does not match"}
                      </Chip>
                    ) : (
                      <Chip tone="muted">Not checked yet</Chip>
                    )}
                  </div>
                  <p className="text-sm font-bold">{actionTitle(a, labels, dest)}</p>
                  <p className="text-sm text-ink-2">
                    {thousands(a.quantity)} ctn · Tier {a.tier} · {juta(a.cost)}
                    {a.eta ? ` · arrives ${dayShort(record.day0, a.eta)}` : ""}
                  </p>
                </article>
              </Reveal>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}
