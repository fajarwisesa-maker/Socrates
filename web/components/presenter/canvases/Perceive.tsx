"use client";

import { FileText, MessageCircle } from "lucide-react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { useRef } from "react";
import { CAUSE, delay, FIELD, glossFor, uniqueSpans } from "@/lib/present";
import { cn } from "@/lib/utils";
import type { CaseRecord, Evidence } from "@/lib/types";
import { EvidenceLinks } from "../EvidenceLinks";
import { Highlighted } from "../Highlighted";
import { Card, Frame } from "./Frame";

const SHOWN_FIELDS = ["cause", "location", "delay", "references"] as const;

/** Perceive's story, in seconds from the step's start (docs/polish-prompt.md 4.3). */
const T = { fields: 1.9, links: 2.1, pdf: 2.5, confidence: 2.9 };

export function PerceiveCanvas({ record, round }: { record: CaseRecord; round: number }) {
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement>(null);
  const d = record.disruption;
  if (!d) return <Frame stage="PERCEIVE" round={round} headline="Reading the signals…">{null}</Frame>;
  const ev = d.evidence ?? [];
  // Stable while later stages run (the place is in the Where row).
  const headline = d.is_disruption
    ? `${CAUSE[d.cause] ?? "Disruption"} · ${delay(d.delay_hours_min, d.delay_hours_max)} delay`
    : "No disruption in these signals";

  const value: Record<(typeof SHOWN_FIELDS)[number], string> = {
    cause: CAUSE[d.cause] ?? d.cause,
    location: d.location ?? "unknown",
    delay: delay(d.delay_hours_min, d.delay_hours_max),
    references: d.references.length ? d.references.map((r) => `PO ${r}`).join(", ") : "none",
  };
  const progression = d.confidence_basis?.progression ?? [];
  // v2 glosses make the WhatsApp bubble taller; the PDF phrases then flow on shared lines
  const glossed = ev.some((e) => glossFor(e));

  return (
    <Frame stage="PERCEIVE" round={round} headline={headline}>
      <div ref={box} className="relative grid h-full grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4">
        {/* story (4.3): the WhatsApp phrases light up at 0.7 / 1.1 / 1.5 s, the fields rise in,
            the lines join phrase to field, the PDF phrases arrive, then the confidence */}
        <EvidenceLinks container={box} startDelay={T.links} />
        <div className="flex min-h-0 flex-col gap-3">
          {record.signals.map((s, i) => {
            const spans = ev.filter((e) => e.signal === i + 1);
            return s.type === "pdf" ? (
              <Card key={i} className="p-4" testId="signal-pdf">
                <div className="mb-2 flex items-center gap-2 text-lg font-semibold text-ink-2">
                  <FileText className="size-5" aria-hidden /> Forwarder notice · PDF
                </div>
                <div className={glossed ? "text-xl leading-[1.5]" : "flex flex-wrap gap-1.5"}>
                  {uniqueSpans(spans).sort((x, y) => x.start - y.start).map((e, j) => (
                    <motion.mark
                      key={e.start}
                      initial={reduce ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: reduce ? 0 : T.pdf + j * 0.07, duration: reduce ? 0 : 0.32 }}
                      data-field={e.field}
                      data-evidence={`${e.signal}:${e.start}`}
                      className={
                        glossed
                          ? "mr-1.5 inline-block rounded-md bg-signal-yellow px-1.5 font-bold whitespace-nowrap text-asphalt"
                          : "rounded-md bg-signal-yellow px-1.5 text-xl font-bold text-asphalt"
                      }
                    >
                      {e.text.replace(/\s+/g, " ")}
                    </motion.mark>
                  ))}
                </div>
              </Card>
            ) : (
              <div key={i} data-testid="signal-whatsapp" className="rounded-[var(--radius-card)] rounded-tl-sm bg-surface-2 px-4 py-3">
                <div className="mb-1 flex items-center gap-2 text-lg font-semibold text-ink-2">
                  <MessageCircle className="size-5" aria-hidden /> Driver · WhatsApp
                  {s.via === "whatsapp_api" && (
                    <span data-testid="whatsapp-live" className="text-base font-medium text-brand-ink">
                      · received live{s.sender ? ` from ${s.sender}` : ""}
                    </span>
                  )}
                </div>
                <p lang="id" className={cn("text-xl text-ink italic", glossed ? "leading-[1.35]" : "leading-[1.45]")}>
                  <Highlighted text={s.text} spans={spans} />
                </p>
              </div>
            );
          })}
        </div>

        <Card className="flex flex-col bg-surface p-0" testId="disruption-card">
          <dl className="divide-y-2 divide-surface-2">
            {SHOWN_FIELDS.map((f, i) => (
              <motion.div
                key={f}
                className="px-6 py-2"
                data-field-row={f}
                initial={reduce ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: reduce ? 0 : T.fields + i * 0.07, duration: reduce ? 0 : 0.32 }}
              >
                <dt className="flex items-center justify-between text-lg text-ink-2">
                  {FIELD[f]}
                  <Sources
                    evidence={ev.filter(
                      (e) =>
                        e.field === f ||
                        (f === "location" && e.field === "lane") ||
                        (f === "cause" && e.field === "is_disruption"),
                    )}
                  />
                </dt>
                <dd className="text-xl font-semibold text-ink">{value[f]}</dd>
              </motion.div>
            ))}
            <div className="px-6 py-2" data-testid="confidence">
              <dt className="text-lg text-ink-2">Confidence</dt>
              <dd className="text-xl font-semibold text-ink">
                {progression.length > 1
                  ? progression.map((p, i) => (
                      <motion.span
                        key={i}
                        initial={reduce || i === 0 ? false : { opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        // the second source is fused after the WhatsApp has been read
                        transition={{ delay: reduce ? 0 : T.confidence + (i - 1) * 0.4, duration: reduce ? 0 : 0.32 }}
                      >
                        {i > 0 && <span className="px-1 text-ink-2">→</span>}
                        <span className={i === progression.length - 1 ? "text-brand-ink" : "text-ink-2"}>{p.label}</span>
                      </motion.span>
                    ))
                  : d.confidence}
              </dd>
              {d.confidence === "High" && (
                <motion.p
                  className="text-lg text-ink-2"
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: reduce ? 0 : T.confidence + 0.3, duration: reduce ? 0 : 0.32 }}
                >
                  The notice agrees on lane and delay
                </motion.p>
              )}
            </div>
          </dl>
        </Card>
      </div>
    </Frame>
  );
}

/** Which signals support a field: WhatsApp and/or PDF icons. */
function Sources({ evidence }: { evidence: Evidence[] }) {
  const kinds = [...new Set(evidence.map((e) => e.source))];
  return (
    <span className="flex gap-1 text-brand-ink" aria-label={`from ${kinds.join(" and ") || "no quote"}`}>
      {kinds.includes("whatsapp") && <MessageCircle className="size-5" aria-hidden />}
      {kinds.includes("pdf") && <FileText className="size-5" aria-hidden />}
    </span>
  );
}
