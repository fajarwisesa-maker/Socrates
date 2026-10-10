"use client";

import { motion, useReducedMotion } from "motion/react";
import type { Evidence } from "@/lib/types";

/**
 * Signal text with the evidence spans that code located in it. Only located spans are
 * highlighted (offsets come from the backend); they light up one after another.
 */
export function Highlighted({ text, spans, stagger = 0.25 }: { text: string; spans: Evidence[]; stagger?: number }) {
  const reduce = useReducedMotion();
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const pieces: React.ReactNode[] = [];
  let pos = 0;
  sorted.forEach((s, i) => {
    if (s.start < pos) return; // overlapping quotes: keep the first
    pieces.push(<span key={`t${s.start}`}>{text.slice(pos, s.start)}</span>);
    pieces.push(
      <motion.mark
        key={`m${s.start}`}
        data-field={s.field}
        data-evidence={`${s.signal}:${s.start}`}
        className="rounded-md px-0.5 font-semibold not-italic [box-decoration-break:clone]"
        initial={reduce ? false : { backgroundColor: "rgba(227,241,239,0)", color: "#0f172a" }}
        animate={{ backgroundColor: "#e3f1ef", color: "#0b5d57" }}
        transition={{ delay: reduce ? 0 : 0.2 + i * stagger, duration: 0.35 }}
      >
        {text.slice(s.start, s.end)}
      </motion.mark>,
    );
    pos = s.end;
  });
  pieces.push(<span key="end">{text.slice(pos)}</span>);
  return <>{pieces}</>;
}
