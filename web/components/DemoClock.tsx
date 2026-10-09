"use client";

import { useEffect, useState } from "react";
import { clock } from "@/lib/format";
import type { CaseEvent } from "@/lib/types";

export default function DemoClock({ events }: { events: CaseEvent[] }) {
  // Read the clock only in the browser (Cache Components prerenders the page shell).
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, []);

  const start = events[0] ? Date.parse(events[0].ts) : null;
  const end = events.find((e) => e.stage === "CASE" && ["resolved", "escalated"].includes(e.status));
  const verified = end?.status === "resolved";
  const stop = end ? Date.parse(end.ts) : (now ?? start ?? 0);
  const seconds = start ? (stop - start) / 1000 : 0;

  return (
    <div
      data-testid="demo-clock"
      className="flex items-center gap-4 rounded-xl bg-slate-900 px-5 py-3 text-white shadow-sm"
    >
      <div>
        <div className="text-[11px] uppercase tracking-widest text-slate-400">
          Signal → {verified ? "verified" : end ? "escalated" : "…"}
        </div>
        <div
          className={`font-mono text-4xl font-bold tabular-nums ${verified ? "text-emerald-400" : "text-white"}`}
        >
          {clock(seconds)}
        </div>
      </div>
      <div className="border-l border-slate-700 pl-4 text-xs leading-5 text-slate-300">
        <div>
          Manual today: <span className="font-semibold text-white">~3 days</span>
        </div>
        <div>
          SIAGA: <span className="font-semibold text-white">minutes</span>, with a human approving
        </div>
      </div>
    </div>
  );
}
