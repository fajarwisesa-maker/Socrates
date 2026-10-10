"use client";

import { Timer } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { caseClock } from "@/lib/caseClock";
import { clock } from "@/lib/format";
import type { CaseEvent } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

/** Elapsed from "Start case" to "Verified"; freezes when the case ends. */
export function PresenterClock({ events }: { events: CaseEvent[] }) {
  const now = useNow();
  const reduce = useReducedMotion();
  const { seconds, stoppedBy } = caseClock(events, now);
  const label =
    stoppedBy === "resolved" ? "Signal → verified" : stoppedBy ? `Signal → ${stoppedBy}` : "Signal → now";
  return (
    <div data-testid="demo-clock" className="flex items-center gap-3">
      <Timer className={cn("size-8", stoppedBy === "resolved" ? "text-ok" : "text-ink-2")} aria-hidden />
      <div className="text-right">
        <div className="text-base font-medium text-ink-2">{label}</div>
        <motion.div
          key={stoppedBy ?? "running"}
          data-stopped={stoppedBy ?? undefined}
          className={cn(
            "font-mono text-[2.5rem] leading-none font-semibold tabular-nums",
            stoppedBy === "resolved" ? "text-ok-ink" : "text-ink",
          )}
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
