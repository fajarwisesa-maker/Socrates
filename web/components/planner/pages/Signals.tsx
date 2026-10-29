"use client";

// Signals (mockup "Inbox Gangguan WA"): every case on the left, the open case's messages in
// the middle with the quotes code located in them, and on the right what SIAGA extracted and
// how sure it is. Demo inputs sit under the list.
import { ArrowRight, FileText, MessageCircle, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Reveal } from "@/components/Reveal";
import { AgentWritten } from "@/components/signs";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { caseTitle, shortId } from "@/lib/caseView";
import { dayShort } from "@/lib/format";
import { useWithExits } from "@/lib/motion";
import { CAUSE, delay, delayChip, FIELD, glossFor, uniqueSpans } from "@/lib/present";
import type { CaseRecord, Evidence } from "@/lib/types";
import type { InboxCase } from "@/lib/useInbox";
import { cn } from "@/lib/utils";
import { CARD } from "../../signs";
import { STATUS_CHIP } from "../Shell";
import { Chip, PageHeader, Panel } from "../ui";
import type { CasePageProps, InboxProps } from "./types";

export function Signals({ inbox, caseProps, openId }: { inbox: InboxProps; caseProps: CasePageProps | null; openId: string | null }) {
  const record = caseProps?.record ?? null;
  return (
    <div className="flex flex-col gap-8" data-testid="page-signals">
      <PageHeader
        chips={record?.signals.some((s) => s.via === "whatsapp_api") ? <Chip tone="ok">Received live on WhatsApp</Chip> : undefined}
        title="Signals"
        description="Messages and notices that opened a case. SIAGA finds each quote it relies on in the text itself; a quote it cannot find is dropped."
        actions={
          record && (
            <Button onClick={() => caseProps!.onPage("impact")} data-testid="signals-next">
              Open impact analysis <ArrowRight aria-hidden />
            </Button>
          )
        }
      />
      {/* three columns on a wide screen; at 1280 px the extracted fields sit under the messages */}
      <div className="grid gap-8 lg:grid-cols-[288px_minmax(0,1fr)] 2xl:grid-cols-[288px_minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-8">
          <CaseList cases={inbox.cases} loaded={inbox.loaded} openId={openId} onOpen={inbox.onOpen} />
          <DemoInputs onStarted={inbox.onStarted} disabled={inbox.busy} onReset={inbox.onReset} />
        </div>
        {record ? (
          <div className="grid min-w-0 gap-8 2xl:contents">
            <Messages record={record} />
            <Extracted record={record} />
          </div>
        ) : (
          <div className={cn(CARD, "p-6 text-base text-ink-2 2xl:col-span-2")} data-testid="no-case">
            No case open. Load the demo inputs and start a case, or pick one from the list.
          </div>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ list

function preview(r: CaseRecord): string {
  const t = r.signals[0]?.text ?? "";
  return t.length > 72 ? `${t.slice(0, 72)}…` : t;
}

function CaseList({ cases, loaded, openId, onOpen }: { cases: InboxCase[]; loaded: boolean; openId: string | null; onOpen: (id: string) => void }) {
  const listed = useWithExits(cases, (c) => c.record.case_id);
  const open = cases.filter((c) => !["RESOLVED"].includes(c.record.status)).length;
  return (
    <Panel
      title="Cases"
      icon={<MessageCircle aria-hidden />}
      right={open > 0 ? <Chip tone="needs">{open} open</Chip> : undefined}
      testId="inbox"
      className="p-4"
    >
      {loaded && cases.length === 0 && <p className="text-sm text-ink-2">No case yet.</p>}
      <ul className="flex flex-col gap-2">
        {listed.map(({ item: c, exiting }, i) => {
          const r = c.record;
          const s = STATUS_CHIP[r.status] ?? { tone: "info" as const, text: "Running" };
          const active = r.case_id === openId;
          return (
            <Reveal as="li" key={r.case_id} delay={Math.min(i, 4) * 70} className={exiting ? "fade-out" : undefined}>
              <button
                onClick={() => onOpen(r.case_id)}
                data-testid="inbox-case"
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-[8px] p-2 text-left transition-[background-color,box-shadow] duration-[var(--dur-fast)]",
                  active ? "bg-brand-soft inset-ring inset-ring-sign-green" : "hover:bg-surface-2",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-black">{caseTitle(r)}</span>
                  <span className="shrink-0 font-mono text-xs text-ink-2">{r.created_at.slice(11, 16)}</span>
                </span>
                <span lang="id" className="text-xs text-ink-2 italic">
                  {preview(r)}
                </span>
                <span className="flex items-center justify-between gap-2">
                  <Chip tone={s.tone}>{s.text}</Chip>
                  <span className="font-mono text-xs text-ink-2">{shortId(r.case_id)}</span>
                </span>
              </button>
            </Reveal>
          );
        })}
      </ul>
    </Panel>
  );
}

// ------------------------------------------------------------------ messages

function numbered(ev: Evidence[]): Map<string, number> {
  const sorted = uniqueSpans(ev).sort((a, b) => a.signal - b.signal || a.start - b.start);
  return new Map(sorted.map((e, i) => [`${e.signal}:${e.start}`, i + 1]));
}

/** Signal text with the quotes code located in it, numbered. */
function Marked({ text, spans, nums }: { text: string; spans: Evidence[]; nums: Map<string, number> }) {
  const out: React.ReactNode[] = [];
  let pos = 0;
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < pos) continue;
    out.push(<span key={`t${s.start}`}>{text.slice(pos, s.start)}</span>);
    out.push(
      <mark key={`m${s.start}`} data-field={s.field} className="rounded-[3px] bg-signal-yellow px-0.5 font-bold text-asphalt not-italic [box-decoration-break:clone]">
        {text.slice(s.start, s.end)}
        <sup className="ml-0.5 font-mono text-[0.7em]">{nums.get(`${s.signal}:${s.start}`)}</sup>
      </mark>,
    );
    pos = s.end;
  }
  out.push(<span key="end">{text.slice(pos)}</span>);
  return <>{out}</>;
}

function Messages({ record }: { record: CaseRecord }) {
  const d = record.disruption;
  const ev = uniqueSpans(d?.evidence ?? []);
  const nums = numbered(ev);
  const glosses = ev.filter((e) => glossFor(e));
  return (
    <Panel title="Messages" icon={<MessageCircle aria-hidden />} description={`Case ${shortId(record.case_id)} · opened ${dayShort(record.day0, record.created_at)}`}>
      <div className="flex flex-col gap-4 rounded-[12px] bg-surface-2 p-4">
        {record.signals.map((s, i) => {
          const spans = ev.filter((e) => e.signal === i + 1);
          return s.type === "pdf" ? (
            <article key={i} className={cn(CARD, "flex flex-col gap-2 p-4")} data-testid="sheet-pdf">
              <header className="flex items-center gap-2 text-sm font-bold text-ink-2">
                <FileText className="size-4" aria-hidden /> Forwarder notice · {s.filename ?? "PDF"}
              </header>
              <ul className="flex flex-wrap gap-2">
                {spans.length === 0 && <li className="text-sm text-ink-2">No quote from this notice was used.</li>}
                {[...spans]
                  .sort((x, y) => x.start - y.start)
                  .map((e) => (
                    <li key={e.start}>
                      <mark className="rounded-[3px] bg-signal-yellow px-1 text-sm font-bold text-asphalt">
                        {e.text.replace(/\s+/g, " ")}
                        <sup className="ml-0.5 font-mono text-[0.7em]">{nums.get(`${e.signal}:${e.start}`)}</sup>
                      </mark>
                    </li>
                  ))}
              </ul>
            </article>
          ) : (
            <article key={i} className="flex max-w-[92%] flex-col gap-1 self-start rounded-[12px] rounded-tl-[4px] bg-road-white p-4 inset-ring inset-ring-hairline" data-testid="sheet-whatsapp">
              <header className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-2">
                <MessageCircle className="size-4" aria-hidden /> Driver · WhatsApp
                {s.via === "whatsapp_api" && (
                  <span className="font-mono text-xs font-normal">received live{s.sender ? ` from ${s.sender}` : ""}</span>
                )}
              </header>
              <p lang="id" className="text-base leading-relaxed italic">
                <Marked text={s.text} spans={spans} nums={nums} />
              </p>
              {s.received_at && <span className="self-end font-mono text-xs text-ink-2">{s.received_at.slice(11, 16)}</span>}
            </article>
          );
        })}
      </div>
      {glosses.length > 0 && (
        <div className="flex flex-col gap-1">
          <AgentWritten />
          <ul className="flex flex-col gap-1 text-sm">
            {glosses.map((e) => (
              <li key={`${e.signal}:${e.start}`}>
                <span className="font-mono">{nums.get(`${e.signal}:${e.start}`)}</span>{" "}
                <span lang="id" className="italic">“{e.text}”</span> means <span lang="en">{glossFor(e)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ extracted

function Extracted({ record }: { record: CaseRecord }) {
  const d = record.disruption;
  if (!d) {
    return (
      <Panel title="Extracted and checked" icon={<ShieldCheck aria-hidden />}>
        <p className="text-sm text-ink-2">Reading the signals.</p>
      </Panel>
    );
  }
  const ev = d.evidence ?? [];
  const nums = numbered(ev);
  const cite = (fields: string[]) =>
    ev
      .filter((e) => fields.includes(e.field))
      .map((e) => nums.get(`${e.signal}:${e.start}`))
      .filter((n, i, all) => all.indexOf(n) === i)
      .sort((a, b) => a! - b!);
  const from = (fields: string[]) => [...new Set(ev.filter((e) => fields.includes(e.field)).map((e) => e.source))];
  const rows: [string, string, string[]][] = [
    [FIELD.cause, CAUSE[d.cause] ?? d.cause, ["cause", "is_disruption"]],
    [FIELD.lane, d.lane ?? "unknown", ["lane"]],
    [FIELD.location, d.location ?? "unknown", ["location"]],
    [FIELD.delay, delay(d.delay_hours_min, d.delay_hours_max), ["delay"]],
    [FIELD.references, d.references.map((r) => `PO ${r}`).join(", ") || "none", ["references"]],
  ];
  const progression = d.confidence_basis?.progression ?? [];
  const agreeing = d.confidence_basis?.corroborated_fields ?? [];
  const chip = delayChip(record.delay_prediction);
  return (
    <div className="flex flex-col gap-8">
      <Panel title="Extracted and checked" icon={<ShieldCheck aria-hidden />} description="Fields from the model, each tied to quotes code found">
        <table className="w-full text-sm" data-testid="disruption-fields">
          <tbody>
            {rows.map(([k, v, f]) => (
              <tr key={k} className="border-b border-divider align-top last:border-0">
                <td className="py-2 pr-2 text-ink-2">{k}</td>
                <td className="py-2 pr-2 font-bold">{v}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <span className="inline-flex items-center gap-1 text-brand-ink" aria-label={`from ${from(f).join(" and ") || "no quote"}`}>
                    {from(f).includes("whatsapp") && <MessageCircle className="size-4" aria-hidden />}
                    {from(f).includes("pdf") && <FileText className="size-4" aria-hidden />}
                    <span className="font-mono text-xs text-ink-2">{cite(f).join(", ")}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {chip && (
          <Chip tone={chip.tone === "brand" ? "ok" : chip.tone === "human" ? "needs" : "muted"} testId="delay-chip" className="self-start whitespace-normal">
            {chip.hours && <b>{chip.hours}</b>}
            {chip.hours && " · "}
            {chip.text}
          </Chip>
        )}
        {record.pii && (
          <Chip tone="info" testId="pii-chip" className="self-start">
            {record.pii.masked ? `PII masked · ${record.pii.masked}` : "PII check · nothing to mask"}
          </Chip>
        )}
      </Panel>
      <Panel title="Confidence" icon={<ShieldCheck aria-hidden />} testId="sheet-confidence">
        <p className="text-2xl font-black" data-testid="margin-confidence">
          {progression.length > 1 ? progression.map((x) => x.label).join(" → ") : d.confidence}
        </p>
        <p className="text-sm text-ink-2">
          {d.confidence === "High" && agreeing.length
            ? `Medium from the WhatsApp alone; the forwarder notice agrees on ${agreeing.join(" and ")}.`
            : "One informal source; a second that agrees on lane and delay raises it to High."}{" "}
          Computed in code, never by the model.
        </p>
      </Panel>
    </div>
  );
}

// ------------------------------------------------------------------ demo inputs

/** Demo inputs: the seeded Pantura scenario, through the same Case API a WhatsApp uses. */
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
    <Panel title="Demo inputs" right={<Chip tone="muted">Demo only</Chip>} testId="signal-inbox" className="p-4">
      <div className="flex flex-col gap-2">
        <Button variant="outline" className="w-full justify-start" onClick={async () => setText(await api.demoWhatsapp())}>
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
          <Button variant="link" className="text-sm" onClick={() => fileRef.current?.click()}>
            Choose PDF
          </Button>
          <span data-testid="pdf-name" className="truncate text-ink-2">
            {pdf ? pdf.name : "no file"}
          </span>
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
        </div>
        <Button className="w-full" size="lg" data-testid="start-case" onClick={start} disabled={busy || disabled || (!text.trim() && !pdf)}>
          {busy ? "Starting" : "Start case"}
        </Button>
        {error && <p className="text-sm font-bold text-risk-ink">{error}</p>}
        <Button variant="link" onClick={onReset} data-testid="reset" className="self-start text-xs text-ink-2">
          Reset demo
        </Button>
      </div>
    </Panel>
  );
}
