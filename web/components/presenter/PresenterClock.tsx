"use client";

import { Timer } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { caseClock } from "@/lib/caseClock";
import { clock } from "@/lib/format";
import type { CaseEvent } from "@/lib/types";
import { useNow } from "@/lib/useNow";

/** Elapsed from "Start case" to "Verified"; freezes when the case ends. */
export function PresenterClock({ events }: { events: CaseEvent[] }) {
  const now = useNow();
  const reduce = useReducedMotion();
  const { seconds, stoppedBy } = caseClock(events, now);
  const label =
    stoppedBy === "resolved" ? "Signal to verified" : stoppedBy ? `Signal to ${stoppedBy}` : "Signal to verified";
  return (
    <div data-testid="demo-clock" className="flex items-center gap-2 text-signal-yellow">
      <Timer className="size-6" aria-hidden />
      <div className="text-right">
        <div className="sign-label text-xs leading-none">{label}</div>
        <motion.div
          key={stoppedBy ?? "running"}
          data-stopped={stoppedBy ?? undefined}
          className="font-mono text-3xl leading-none font-bold tabular-nums"
          // the clock stops: one pulse when the case is verified
          initial={stoppedBy === "resolved" && !reduce ? { scale: 1.25 } : false}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 14 }}
        >
          {events.length ? clock(seconds) : "00:00"}
        </motion.div>
      </div>
    </div>
  );
}
