"use client";

import { Timer } from "lucide-react";
import { caseClock } from "@/lib/caseClock";
import { clock } from "@/lib/format";
import type { CaseEvent } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

/** Elapsed from "Start case" to "Verified"; freezes when the case ends. */
export function PresenterClock({ events }: { events: CaseEvent[] }) {
  const now = useNow();
  const { seconds, stoppedBy } = caseClock(events, now);
  const label =
    stoppedBy === "resolved" ? "Signal → verified" : stoppedBy ? `Signal → ${stoppedBy}` : "Signal → now";
  return (
    <div data-testid="demo-clock" className="flex items-center gap-3">
      <Timer className={cn("size-8", stoppedBy === "resolved" ? "text-ok" : "text-ink-2")} aria-hidden />
      <div className="text-right">
        <div className="text-base font-medium text-ink-2">{label}</div>
        <div
          className={cn(
            "font-mono text-[2.5rem] leading-none font-semibold tabular-nums",
            stoppedBy === "resolved" ? "text-ok-ink" : "text-ink",
          )}
        >
          {events.length ? clock(seconds) : "00:00"}
        </div>
      </div>
    </div>
  );
}
