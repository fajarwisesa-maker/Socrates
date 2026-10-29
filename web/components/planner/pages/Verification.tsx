"use client";

// Verification (mockup "Verifikasi"): SIAGA re-reads SAP after the plan is executed and
// checks that every document exists with the right quantity, on time, and that the DC is
// covered by the cutoff. A failed check reopens the case.
import { Check, ClipboardCheck, Info, Map as MapIcon, MessageCircle, Timer, TriangleAlert, X } from "lucide-react";
import { LaneMap } from "@/components/LaneMap";
import { Reveal } from "@/components/Reveal";
import { caseClock } from "@/lib/caseClock";
import { dayShort, juta, minutesSeconds, thousands } from "@/lib/format";
import { laneModel } from "@/lib/laneModel";
import { actionTitle, whatsappReply } from "@/lib/present";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { Chip, Kpi, Note, PageHeader, Panel, RowItem, Rows } from "../ui";
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
    <div className="flex flex-col gap-6" data-testid="page-verification">
      <Reveal>
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
      </Reveal>

      {reopened && (
        <Reveal delay={50}>
          <Panel title="Reopened" icon={<TriangleAlert aria-hidden />} tone="risk" testId="reopened-plate">
            <p className="text-base font-bold text-chip-risk-fg">
              SAP no longer shows the planned supply arriving in time. Everything executed so far stays in SAP and in the audit trail.
            </p>
          </Panel>
        </Reveal>
      )}

      {!v && (
        <Reveal delay={50}>
          <Panel title="Verification" icon={<Timer aria-hidden />} tone="info" testId="sheet-waiting">
            <Note chip={record.verify_due_at ? "Checking" : "Not yet"} tone="info">
              {due !== null && due > 0
                ? `SIAGA re-reads SAP in ${due} s.`
                : record.verify_due_at
                  ? `Checking ${docs === 2 ? "both documents" : docs === 1 ? "the document" : `${docs} documents`} in SAP…`
                  : "Verification runs after every action is executed."}
            </Note>
          </Panel>
        </Reveal>
      )}

      {resolved && s && (
        <Reveal delay={50} className="grid gap-4 sm:grid-cols-2">
          <Kpi
            label="Outcome"
            tone="ok"
            icon={<Check aria-hidden />}
            value={
              <span className="text-[1.5rem] whitespace-normal" data-testid="outcome-line">
                {juta(s.exposure_avoided)} protected for {juta(s.case_cost ?? s.chosen_cost)}
              </span>
            }
            note="Verified in SAP by SIAGA"
          />
          <Kpi
            label="Signal to verified"
            tone="info"
            icon={<Timer aria-hidden />}
            value={clock.stoppedBy === "resolved" ? minutesSeconds(clock.seconds) : "Running"}
            note="Real time, from Start case to the SAP check"
          />
        </Reveal>
      )}

      <Reveal delay={100} className="grid gap-6 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-8">
          <Panel title="Routes in SAP" icon={<MapIcon aria-hidden />} tone={reopened ? "risk" : resolved ? "ok" : "info"} description={model?.title}>
            {model && <LaneMap model={model} />}
          </Panel>
        </div>
        <div className="min-w-0 xl:col-span-4">
          <Panel
            title="Coverage at the DC"
            icon={<ClipboardCheck aria-hidden />}
            tone={reopened ? "risk" : v?.covered ? "ok" : "info"}
            footer={
              record.notes.length > 0 || reply ? (
                <Rows className="text-sm">
                  {reply && (
                    <RowItem className="items-center font-bold text-brand-ink" testId="planner-whatsapp-reply">
                      <MessageCircle className="size-4 shrink-0" aria-hidden /> {reply}
                    </RowItem>
                  )}
                  {record.notes.map((n) => (
                    <RowItem key={n.ref} className="text-ink-2" testId="verify-note">
                      <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> <span>{n.text}</span>
                    </RowItem>
                  ))}
                </Rows>
              ) : undefined
            }
          >
            {v ? (
              <Reveal as="p" className={cn("text-xl", reopened && "font-bold text-chip-risk-fg")} testId="coverage">
                {thousands(v.projected_supply)} of {thousands(v.demand)} cartons {v.covered ? "covered" : "projected"}
                {risk?.deadline ? ` by the cutoff ${dayShort(record.day0, risk.deadline)}` : ""}.
              </Reveal>
            ) : (
              <Note chip="Not yet">Coverage is read from SAP when the check runs.</Note>
            )}
          </Panel>
        </div>
      </Reveal>

      <Reveal delay={150}>
        <Panel title="Documents in SAP" icon={<ClipboardCheck aria-hidden />} tone="info" description="One row per executed action" testId="verify-checks">
          <Rows>
            {executed.length === 0 && <RowItem className="text-sm text-ink-2">Nothing executed yet.</RowItem>}
            {executed.map((a) => {
              const c = v?.checks.find((k) => k.ref === a.sap_ref);
              return (
                <RowItem key={a.action_id} className="flex-wrap items-center">
                  <span className="w-32 shrink-0 font-mono text-base font-black">{a.sap_ref}</span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-bold">{actionTitle(a, labels, dest)}</span>
                    <span className="text-sm text-ink-2">
                      {thousands(a.quantity)} ctn · Tier {a.tier} · {juta(a.cost)}
                      {a.eta ? ` · arrives ${dayShort(record.day0, a.eta)}` : ""}
                    </span>
                  </span>
                  {c ? (
                    <Chip tone={c.ok ? "ok" : "risk"} icon={c.ok ? <Check aria-hidden /> : <X aria-hidden />}>
                      {c.ok ? "Matches SAP" : c.on_time === false ? "Late" : "Does not match"}
                    </Chip>
                  ) : (
                    <Chip tone="muted">Not checked yet</Chip>
                  )}
                </RowItem>
              );
            })}
          </Rows>
        </Panel>
      </Reveal>
    </div>
  );
}
