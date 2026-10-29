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
import { useCountUp } from "@/lib/motion";
import { Reveal } from "../Reveal";
import { Figure } from "../Figure";
import { CARD, GantrySign, RouteShield, SignHeading, StatusPlate, TierPlate, WarningPlate, type PlateTone } from "../signs";
import { Button } from "../ui/button";

const SHORT: Record<string, string> = {
  alternate_supplier: "bridge PO",
  spot_air: "air charter",
  stock_transfer: "transfer",
  reschedule_customer: "customer reschedule",
};

type Group = "needs" | "reopened" | "escalated" | "running" | "resolved";

const GROUPS: { id: Group; label: string; tone: PlateTone }[] = [
  { id: "needs", label: "Needs you", tone: "needs" },
  { id: "reopened", label: "Reopened", tone: "rejected" },
  { id: "escalated", label: "Escalated", tone: "escalated" },
  { id: "running", label: "Running", tone: "running" },
  { id: "resolved", label: "Resolved", tone: "verified" },
];

/** Stagger for a list entrance: 70 ms apart, at most five steps. */
const stagger = (i: number) => Math.min(i, 4) * 70;

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
  const others = GROUPS.filter((g) => g.id !== "needs");

  return (
    <main className="mx-auto grid max-w-[1440px] gap-8 px-8 py-8 lg:grid-cols-[minmax(0,1fr)_280px]" data-testid="inbox">
      <div className="flex min-w-0 flex-col gap-8">
        <div className="flex flex-col gap-1">
          <h1 className="text-4xl font-black">Inbox</h1>
          <p className="text-base text-ink-2" data-testid="inbox-summary">
            {!loaded
              ? "Loading cases."
              : needs
                ? `${needs} case${needs === 1 ? "" : "s"} need${needs === 1 ? "s" : ""} your decision, by approve-by time.`
                : cases.length
                  ? "Nothing needs your decision right now."
                  : "No cases yet. Start one from the demo inputs, or send the WhatsApp signal."}
          </p>
        </div>

        <section className="flex flex-col gap-4" data-testid="inbox-needs">
          <StatusPlate tone="needs" count={needs} className="self-start px-4 text-sm">
            Needs you
          </StatusPlate>
          {needs === 0 ? (
            <p className="text-base text-ink-2">Nothing waits for your decision.</p>
          ) : (
            groups.needs.map((c, i) => (
              <Reveal key={c.record.case_id} delay={stagger(i)}>
                <NeedsYouCard c={c} now={now} onOpen={onOpen} />
              </Reveal>
            ))
          )}
        </section>

        {/* the other groups as one row of count tiles; their cases are listed under it */}
        <ul className="grid grid-cols-2 gap-4 md:grid-cols-4" data-testid="inbox-tiles" aria-label="Other cases">
          {others.map((g, i) => (
            <Reveal as="li" key={g.id} delay={stagger(i)} testId={`inbox-tile-${g.id}`}>
              <div className={cn(CARD, "flex flex-col gap-1 px-6 py-4")}>
                <StatusPlate tone={g.tone} className="self-start">
                  {g.label}
                </StatusPlate>
                <span className="text-3xl font-black">{groups[g.id].length}</span>
              </div>
            </Reveal>
          ))}
        </ul>
        {others
          .filter((g) => groups[g.id].length > 0)
          .map((g) => (
            <section key={g.id} className="flex flex-col gap-2" data-testid={`inbox-${g.id}`}>
              <SignHeading>{g.label}</SignHeading>
              {groups[g.id].map((c, i) => (
                <Reveal key={c.record.case_id} delay={stagger(i)}>
                  <CaseRow c={c} onOpen={onOpen} />
                </Reveal>
              ))}
            </section>
          ))}
      </div>
      <aside className="flex flex-col gap-8">
        <DemoInputs onStarted={onStarted} disabled={busy} onReset={onReset} />
        <div>
          <SignHeading className="mb-4">What SIAGA may do alone</SignHeading>
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((t) => (
              <TierPlate key={t} tier={t} meaning="short" />
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
  const atRisk = useCountUp(r.risk?.max_exposure ?? null, juta, { id: `inbox-${r.case_id}-at-risk` });
  const cost = r.summary ? (r.summary.case_cost ?? r.summary.chosen_cost) : null;
  const planCost = useCountUp(cost, juta, { id: `inbox-${r.case_id}-plan-cost` });
  const figure = (v: number | null, shown: string | null) => (v === null ? "Not yet" : <Figure shown={shown ?? juta(v)} final={juta(v)} />);
  return (
    // the one heavy sign on the inbox: the green gantry with its white inner line
    <article className="overflow-hidden rounded-[12px] bg-signal-yellow" data-testid="inbox-case">
      <GantrySign className="rounded-b-none">
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
        <div className="mt-4 grid grid-cols-3 border-t border-white/40 pt-4">
          {(
            [
              ["At risk", figure(r.risk?.max_exposure ?? null, atRisk)],
              ["Plan cost", figure(cost, planCost)],
              [`Cutoff at ${dest}`, r.risk?.deadline ? dayShort(r.day0, r.risk.deadline).replace(" WIB", "") : "Not yet"],
            ] as const
          ).map(([k, v], i) => (
            <div key={k} className={cn("flex flex-col gap-1 px-4", i > 0 && "border-l border-white/40")}>
              <div className="text-sm font-bold">{k}</div>
              <div className="text-2xl font-black">{v}</div>
            </div>
          ))}
        </div>
      </GantrySign>
      <div className="flex flex-wrap items-center gap-4 px-6 py-4 text-asphalt">
        <span className="font-bold">
          Approve {SHORT[action?.kind ?? ""] ?? "action"} ({pending ? juta(pending.card.cost) : ""})
          {pending?.card.approve_by ? ` by ${dayShort(r.day0, pending.card.approve_by)}` : ""}
        </span>
        {left && (
          <span className={cn("ml-auto rounded-[6px] px-2 py-1 font-mono text-sm font-bold", left.expired ? "bg-stop-red text-white" : "bg-asphalt text-signal-yellow")}>
            {left.expired ? "Expired" : `${left.text} left`}
          </span>
        )}
        <Button
          onClick={() => onOpen(r.case_id)}
          data-testid="open-case"
          variant="outline"
          className={cn("text-sm tracking-[0.1em] uppercase", !left && "ml-auto")}
        >
          Open case <ArrowRight aria-hidden />
        </Button>
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
    <article className={cn(CARD, "flex flex-wrap items-center gap-4 px-6 py-4")} data-testid="inbox-case">
      {lane && <RouteShield code={lane} />}
      <div className="min-w-0 flex-1">
        <div className="font-black">{caseTitle(r)}</div>
        <div className="text-sm text-ink-2">
          <span className="font-mono">{shortId(r.case_id)}</span> · {detail}
        </div>
      </div>
      <Button variant="link" className="text-sm tracking-[0.1em] uppercase" onClick={() => onOpen(r.case_id)}>
        Open case <ArrowRight aria-hidden />
      </Button>
    </article>
  );
}

/** Demo inputs, labelled as demo-only. */
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
    <section className={cn(CARD, "p-6")} data-testid="signal-inbox">
      <div className="mb-4 flex items-center justify-between gap-2">
        <SignHeading>Demo inputs</SignHeading>
        <StatusPlate tone="muted">Demo only</StatusPlate>
      </div>
      <div className="flex flex-col gap-2">
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
            className="w-full rounded-[8px] bg-road-white p-2 text-sm text-asphalt italic inset-ring inset-ring-hairline"
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
