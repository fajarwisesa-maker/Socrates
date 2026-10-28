"use client";

// Inbox (Planner landing, docs/redesign-prompt.md 6.2): every case grouped by what it needs
// from the planner, "Needs you" first, sorted by approve-by time.
import { ArrowRight, FileText, MessageCircle } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { actionFor, caseTitle, causeSign, corridor, countdown, laneCode, shortId } from "@/lib/caseView";
import { dayShort, juta } from "@/lib/format";
import { escalation } from "@/lib/notices";
import { plantName } from "@/lib/present";
import { STAGE_LABEL } from "@/lib/stages";
import type { InboxCase } from "@/lib/useInbox";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { GantrySign, RouteShield, SignHeading, StatusPlate, TierPlate, WarningPlate, type PlateTone } from "../signs";
import { Button } from "../ui/button";

const SHORT: Record<string, string> = {
  alternate_supplier: "bridge PO",
  spot_air: "air charter",
  stock_transfer: "transfer",
  reschedule_customer: "customer reschedule",
};

type Group = "needs" | "reopened" | "escalated" | "running" | "resolved";

const GROUPS: { id: Group; label: string; tone: PlateTone; empty: string }[] = [
  { id: "needs", label: "Needs you", tone: "needs", empty: "Nothing waits for your decision." },
  { id: "reopened", label: "Reopened", tone: "rejected", empty: "No reopened cases. A case reopens when SAP shows that an executed fix did not hold." },
  { id: "escalated", label: "Escalated", tone: "escalated", empty: "No escalated cases. SIAGA hands a case to you when evidence is missing, no plan is feasible, or its budget runs out." },
  { id: "running", label: "Running", tone: "running", empty: "Nothing running. A new WhatsApp signal or forwarder PDF opens a case here." },
  { id: "resolved", label: "Resolved", tone: "verified", empty: "Resolved cases appear here after SIAGA confirms coverage in SAP." },
];

function groupOf(status: string): Group {
  if (status === "AWAITING_APPROVAL") return "needs";
  if (status === "REOPENED") return "reopened";
  if (status === "ESCALATED") return "escalated";
  if (status === "RESOLVED") return "resolved";
  return "running";
}

function firstApproveBy(c: InboxCase): string {
  return (
    c.approvals
      .filter((a) => a.status === "PENDING" && a.card.approve_by)
      .map((a) => a.card.approve_by!)
      .sort()[0] ?? "9999"
  );
}

export function Inbox({
  cases,
  loaded,
  onOpen,
  onStarted,
  busy,
  onReset,
}: {
  cases: InboxCase[];
  loaded: boolean;
  onOpen: (id: string) => void;
  onStarted: (id: string) => void;
  busy: boolean;
  onReset: () => void;
}) {
  const now = useNow(1000);
  const groups = Object.fromEntries(GROUPS.map((g) => [g.id, [] as InboxCase[]])) as Record<Group, InboxCase[]>;
  for (const c of cases) groups[groupOf(c.record.status)].push(c);
  groups.needs.sort((a, b) => firstApproveBy(a).localeCompare(firstApproveBy(b)));
  const needs = groups.needs.length;

  return (
    <main className="mx-auto grid max-w-[1440px] gap-10 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_300px]" data-testid="inbox">
      <div className="min-w-0 space-y-8">
        <div>
          <h1 className="text-4xl font-black">Inbox</h1>
          <p className="mt-1 text-base text-ink-2" data-testid="inbox-summary">
            {!loaded
              ? "Loading cases."
              : needs
                ? `${needs} case${needs === 1 ? "" : "s"} need${needs === 1 ? "s" : ""} your decision. Sorted by approve-by time.`
                : cases.length
                  ? "Nothing needs your decision right now."
                  : "No cases yet. Start one from the demo inputs, or send the WhatsApp signal."}
          </p>
        </div>
        {GROUPS.map((g) => (
          <section key={g.id} className="space-y-3" data-testid={`inbox-${g.id}`}>
            <StatusPlate tone={g.tone} count={groups[g.id].length} className="px-3 py-1 text-sm">
              {g.label}
            </StatusPlate>
            {groups[g.id].length === 0 ? (
              <p className="text-base text-ink-2">{g.empty}</p>
            ) : g.id === "needs" ? (
              groups.needs.map((c) => <NeedsYouCard key={c.record.case_id} c={c} now={now} onOpen={onOpen} />)
            ) : (
              groups[g.id].map((c) => <CaseRow key={c.record.case_id} c={c} onOpen={onOpen} />)
            )}
          </section>
        ))}
      </div>
      <aside className="space-y-8">
        <DemoInputs onStarted={onStarted} disabled={busy} onReset={onReset} />
        <div>
          <SignHeading className="mb-3">What SIAGA may do alone</SignHeading>
          <div className="space-y-3">
            {[0, 1, 2, 3].map((t) => (
              <TierPlate key={t} tier={t} meaning="long" />
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}

function NeedsYouCard({ c, now, onOpen }: { c: InboxCase; now: number | null; onOpen: (id: string) => void }) {
  const r = c.record;
  const pending = c.approvals.find((a) => a.status === "PENDING");
  const action = pending ? actionFor(pending, r) : undefined;
  const left = countdown(pending?.card.approve_by, now);
  const cause = causeSign(r);
  const lane = laneCode(r);
  const dest = plantName(r.affected?.labels, r.affected?.plant ?? "");
  return (
    <article className="overflow-hidden rounded-[14px] border-4 border-asphalt bg-signal-yellow" data-testid="inbox-case">
      <GantrySign className="rounded-[10px] rounded-b-none">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {lane && <RouteShield code={lane} />}
          <span className="text-2xl font-black tracking-wide uppercase">{corridor(r) ?? caseTitle(r)}</span>
          <span className="font-mono text-xs tracking-[0.08em] uppercase">
            Case {shortId(r.case_id)} · opened {r.day0 ? dayShort(r.day0, r.created_at).replace(/ \d\d:\d\d WIB$/, "") : ""}
          </span>
          {cause && (
            <WarningPlate size="sm" className="ml-auto">
              <span className="sign-label text-xs">{cause}</span>
            </WarningPlate>
          )}
        </div>
        <div className="mt-3 grid grid-cols-3 border-t-2 border-white/80 pt-3">
          {[
            ["At risk", r.risk ? juta(r.risk.max_exposure) : "—"],
            ["Plan cost", r.summary ? juta(r.summary.case_cost ?? r.summary.chosen_cost) : "—"],
            [`Cutoff at ${dest}`, r.risk?.deadline ? dayShort(r.day0, r.risk.deadline).replace(" WIB", "") : "—"],
          ].map(([k, v], i) => (
            <div key={k} className={cn("px-3", i > 0 && "border-l-2 border-white/80")}>
              <div className="text-sm font-bold">{k}</div>
              <div className="text-2xl font-black">{v}</div>
            </div>
          ))}
        </div>
      </GantrySign>
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 text-asphalt">
        <span className="font-bold">
          Approve {SHORT[action?.kind ?? ""] ?? "action"} ({pending ? juta(pending.card.cost) : ""})
          {pending?.card.approve_by ? ` by ${dayShort(r.day0, pending.card.approve_by)}` : ""}
        </span>
        {left && (
          <span className={cn("ml-auto rounded-[6px] px-2.5 py-1 font-mono text-sm font-bold", left.expired ? "bg-stop-red text-white" : "bg-asphalt text-signal-yellow")}>
            {left.expired ? "Expired" : `${left.text} left`}
          </span>
        )}
        <button
          onClick={() => onOpen(r.case_id)}
          data-testid="open-case"
          className={cn("inline-flex min-h-11 items-center gap-2 text-sm font-black tracking-[0.1em] uppercase hover:underline", !left && "ml-auto")}
        >
          Open case <ArrowRight className="size-4" aria-hidden />
        </button>
      </div>
    </article>
  );
}

function CaseRow({ c, onOpen }: { c: InboxCase; onOpen: (id: string) => void }) {
  const r = c.record;
  const lane = laneCode(r);
  let detail = "";
  if (r.status === "RESOLVED" && r.summary)
    detail = `${juta(r.summary.exposure_avoided)} protected for ${juta(r.summary.case_cost ?? r.summary.chosen_cost)}`;
  else if (r.status === "ESCALATED") detail = r.escalation_reason ? escalation(r.escalation_reason).title : "Handed to a planner";
  else if (r.status === "REOPENED") detail = "SAP no longer shows the planned supply arriving in time";
  else detail = r.stage ? `At ${STAGE_LABEL[r.stage as keyof typeof STAGE_LABEL] ?? r.stage}` : "Starting";
  return (
    <article
      className="flex flex-wrap items-center gap-4 rounded-[12px] border-2 border-asphalt bg-road-white px-4 py-3"
      data-testid="inbox-case"
    >
      {lane && <RouteShield code={lane} />}
      <div className="min-w-0 flex-1">
        <div className="font-black">{caseTitle(r)}</div>
        <div className="text-sm text-ink-2">
          <span className="font-mono">{shortId(r.case_id)}</span> · {detail}
        </div>
      </div>
      <button
        onClick={() => onOpen(r.case_id)}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-black tracking-[0.1em] uppercase hover:underline"
      >
        Open case <ArrowRight className="size-4" aria-hidden />
      </button>
    </article>
  );
}

/** Demo inputs: dashed so they read as demo-only. */
function DemoInputs({ onStarted, disabled, onReset }: { onStarted: (id: string) => void; disabled: boolean; onReset: () => void }) {
  const [text, setText] = useState("");
  const [pdf, setPdf] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      if (text.trim()) form.append("whatsapp", text);
      if (pdf) form.append("pdf", pdf);
      const { case_id } = await api.startCase(form);
      onStarted(case_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[12px] border-2 border-dashed border-asphalt-muted p-4" data-testid="signal-inbox">
      <SignHeading className="mb-3">Demo inputs</SignHeading>
      <div className="space-y-2">
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={async () => setText(await api.demoWhatsapp())}
        >
          <MessageCircle aria-hidden /> Load demo WhatsApp
        </Button>
        <Button
          variant="outline"
          className="w-full justify-start"
          onClick={async () => {
            const blob = await api.demoPdf();
            setPdf(new File([blob], "forwarder_notice.pdf", { type: "application/pdf" }));
          }}
        >
          <FileText aria-hidden /> Load forwarder PDF
        </Button>
        <label className="block">
          <span className="sr-only">WhatsApp message (driver)</span>
          <textarea
            data-testid="whatsapp-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={3}
            lang="id"
            placeholder="Or paste a driver's WhatsApp message"
            className="w-full rounded-[8px] border-2 border-curb bg-road-white p-2 text-sm text-asphalt italic"
          />
        </label>
        <div className="flex items-center gap-2 text-sm">
          <button onClick={() => fileRef.current?.click()} className="font-bold text-brand-ink underline">
            Choose PDF
          </button>
          <span data-testid="pdf-name" className="truncate text-ink-2">
            {pdf ? pdf.name : "no file"}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => setPdf(e.target.files?.[0] ?? null)}
          />
        </div>
        <Button
          className="w-full"
          size="lg"
          data-testid="start-case"
          onClick={start}
          disabled={busy || disabled || (!text.trim() && !pdf)}
        >
          {busy ? "Starting" : "Start case"}
        </Button>
        {error && <p className="text-sm font-bold text-risk-ink">{error}</p>}
        <p className="text-xs text-ink-2">
          Sends the seeded Pantura scenario through the same Case API a real WhatsApp message uses.
        </p>
        <button onClick={onReset} data-testid="reset" className="text-xs font-bold text-ink-2 underline">
          Reset demo
        </button>
      </div>
    </section>
  );
}
