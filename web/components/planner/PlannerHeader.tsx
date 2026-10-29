"use client";

import { Check, TriangleAlert } from "lucide-react";
import type { CaseEvent, Config } from "@/lib/types";
import type { AuditData } from "@/lib/useInbox";
import { sapModelNote } from "@/lib/present";
import { cn } from "@/lib/utils";
import { Logo } from "../signs";

export type Nav = "inbox" | "cases" | "audit";

/** "Model: Claude via SAP AI Core" etc., from the case's own events, else /config. */
export function modelNote(config: Config | null, events: CaseEvent[]): string | null {
  const sap = sapModelNote(events);
  if (sap) return sap;
  if (!config) return null;
  if (config.replay) return null; // the REPLAY plate says it
  if (config.llm_provider === "sap_genai") return "Model: Claude via SAP AI Core";
  if (config.llm_provider === "fake") return "Model: scripted (fake), offline";
  return `Model: ${config.llm_provider}`;
}

export function PlannerHeader({
  nav,
  onNav,
  config,
  events,
  audit,
  modeSwitch,
}: {
  nav: Nav;
  onNav: (n: Nav) => void;
  config: Config | null;
  events: CaseEvent[];
  audit: AuditData | null;
  modeSwitch: React.ReactNode;
}) {
  const note = modelNote(config, events);
  const v = audit?.verification;
  return (
    <header className="sticky top-0 z-30 bg-asphalt text-white" data-testid="planner-header">
      <div className="mx-auto flex min-h-16 max-w-[1440px] flex-wrap items-center gap-x-8 gap-y-2 px-6 py-2">
        <Logo height={28} />
        <nav aria-label="Planner" className="flex items-center gap-6">
          {(
            [
              ["inbox", "Inbox"],
              ["cases", "Cases"],
              ["audit", "Audit trail"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => onNav(id)}
              data-testid={`nav-${id}`}
              aria-current={nav === id ? "page" : undefined}
              className={cn(
                "min-h-11 text-sm font-black tracking-[0.1em] uppercase transition-[color,box-shadow] duration-[var(--dur-fast)]",
                nav === id ? "text-white shadow-[inset_0_-4px_0_var(--signal-yellow)]" : "text-white/80 hover:text-white",
              )}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          {config?.replay && (
            <span
              data-testid="replay-badge"
              className="rounded-[6px] bg-road-white px-2 py-1 text-xs font-black tracking-[0.08em] text-asphalt uppercase"
              title={config.replay_source ? `Recorded ${config.replay_source.recorded_at}` : "Recorded run"}
            >
              REPLAY · recorded run{config.replay_source ? ` (${config.replay_source.provider})` : ""}
            </span>
          )}
          {note && (
            <span data-testid="model-note" className="font-mono text-xs">
              {note}
              {config?.orchestration === "multi" ? " · Multi-agent" : ""}
            </span>
          )}
          {v && (
            <span
              data-testid="header-audit"
              className={cn(
                "inline-flex items-center gap-1 text-xs font-black tracking-[0.08em] uppercase",
                v.ok ? "text-[#7fd8a6]" : "text-[#ff8a99]",
              )}
            >
              {v.ok ? <Check className="size-4" strokeWidth={3} aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
              {v.ok ? "Audit chain OK" : "Audit chain broken"}
            </span>
          )}
          {modeSwitch}
        </div>
      </div>
    </header>
  );
}
