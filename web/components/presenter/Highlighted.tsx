"use client";

import { motion, useReducedMotion } from "motion/react";
import { glossFor } from "@/lib/present";
import type { Evidence } from "@/lib/types";

/**
 * Signal text with the evidence spans that code located in it. Only located spans are
 * highlighted (offsets come from the backend); they light up one after another. A v2 English
 * gloss (Signal Agent) sits under its phrase.
 */
export function Highlighted({ text, spans, stagger = 0.25 }: { text: string; spans: Evidence[]; stagger?: number }) {
  const reduce = useReducedMotion();
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const pieces: React.ReactNode[] = [];
  let pos = 0;
  sorted.forEach((s, i) => {
    if (s.start < pos) return; // overlapping quotes: keep the first
    pieces.push(<span key={`t${s.start}`}>{text.slice(pos, s.start)}</span>);
    const gloss = glossFor(s);
    pieces.push(
      <motion.mark
        key={`m${s.start}`}
        data-field={s.field}
        data-evidence={`${s.signal}:${s.start}`}
        className={
          gloss
            ? "inline-flex flex-col rounded-md px-0.5 align-top leading-[1.2] font-semibold not-italic"
            : "rounded-md px-0.5 font-semibold not-italic [box-decoration-break:clone]"
        }
        initial={reduce ? false : { backgroundColor: "rgba(227,241,239,0)", color: "#0f172a" }}
        animate={{ backgroundColor: "#e3f1ef", color: "#0a4f4a" }}
        transition={{ delay: reduce ? 0 : 0.2 + i * stagger, duration: 0.35 }}
      >
        {gloss ? (
          <>
            <span>{text.slice(s.start, s.end)}</span>
            <span lang="en" data-testid="gloss" className="text-lg leading-[1.05] font-medium text-ink-2">
              {gloss}
            </span>
          </>
        ) : (
          text.slice(s.start, s.end)
        )}
      </motion.mark>,
    );
    pos = s.end;
  });
  pieces.push(<span key="end">{text.slice(pos)}</span>);
  return <>{pieces}</>;
}
