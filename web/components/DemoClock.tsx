"use client";

import { useEffect, useState } from "react";
import { clock } from "@/lib/format";
import type { CaseEvent } from "@/lib/types";

export default function DemoClock({ events, compact = false }: { events: CaseEvent[]; compact?: boolean }) {
  // Read the clock only in the browser (Cache Components prerenders the page shell).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, []);

  const start = events[0] ? Date.parse(events[0].ts) : null;
  const end = events.find(
    (e) => e.stage === "CASE" && ["resolved", "escalated", "reopened"].includes(e.status),
  );
  const verified = end?.status === "resolved";
  const stop = end ? Date.parse(end.ts) : (now ?? start ?? 0);
  const seconds = start ? (stop - start) / 1000 : 0;

  return (
    <div
      data-testid="demo-clock"
      className="flex items-center gap-4 rounded-[var(--radius-card)] bg-surface px-4 py-2 shadow-[var(--shadow-card)]"
    >
      <div>
        <div className="text-xs tracking-wide text-ink-2 uppercase">
          Signal → {verified ? "verified" : end ? end.status : "now"}
        </div>
        <div className={`font-mono text-3xl font-semibold tabular-nums ${verified ? "text-ok-ink" : "text-ink"}`}>
          {clock(seconds)}
        </div>
      </div>
      <div className={`border-l-2 border-surface-2 pl-4 text-xs leading-5 text-ink-2 ${compact ? "hidden 2xl:block" : ""}`}>
        <div>
          Manual today: <span className="font-semibold text-ink">~3 days</span>
        </div>
        <div>
          SIAGA: <span className="font-semibold text-ink">minutes</span>, with a human approving
        </div>
      </div>
    </div>
  );
}
