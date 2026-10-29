"use client";

import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { glossFor } from "@/lib/present";
import type { Evidence } from "@/lib/types";

/**
 * Signal text with the evidence spans that code located in it. Only located spans are
 * highlighted (offsets come from the backend); they light up one after another. A v2 English
 * gloss (Signal Agent) sits under its phrase.
 */
export function Highlighted({
  text,
  spans,
  start = 0.7,
  end = 1.5,
}: {
  text: string;
  spans: Evidence[];
  /** seconds: the first phrase lights up at `start`, the last at `end` (0.7, 1.1, 1.5 s for three) */
  start?: number;
  end?: number;
}) {
  const reduce = useReducedMotion();
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const stagger = sorted.length > 1 ? Math.min(0.4, (end - start) / (sorted.length - 1)) : 0;
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
        initial={reduce ? false : { backgroundColor: "rgba(255,194,14,0)", color: "#1e2124" }}
        animate={{ backgroundColor: "#ffc20e", color: "#1e2124" }}
        transition={{ delay: reduce ? 0 : start + i * stagger, duration: reduce ? 0 : 0.32 }}
      >
        {gloss ? (
          <>
            <span>{text.slice(s.start, s.end)}</span>
            <span lang="en" data-testid="gloss" className="text-lg leading-[1.05] font-medium text-asphalt">
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
