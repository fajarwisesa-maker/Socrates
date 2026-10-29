"use client";

// The agent's seven stages as a slim stepper under the top bar: where the case is, and a
// shortcut to the page that shows each stage. Names only, plus one note on the current or
// a flagged stage; the agent (multi-agent mode) is said to screen readers.
import { postState, stageNote } from "@/lib/caseView";
import type { Page } from "@/lib/page";
import { stageInfo, STAGE_LABEL, STAGES } from "@/lib/stages";
import type { CaseEvent, CaseRecord, Stage } from "@/lib/types";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

/** Which page shows a stage. */
export const STAGE_PAGE: Record<Stage, Page> = {
  PERCEIVE: "signals",
  ASSESS: "impact",
  PLAN: "options",
  SIMULATE: "options",
  REFLECT: "options",
  ACT: "approvals",
  VERIFY: "verification",
};

const DOT = {
  done: "bg-sign-green text-white",
  verified: "bg-sign-green text-white",
  current: "bg-signal-yellow text-asphalt",
  flagged: "bg-stop-red text-white",
  pending: "bg-road-white text-ink-2 inset-ring inset-ring-hairline",
} as const;

export function Journey({
  record,
  events,
  agents,
  page,
  onPage,
}: {
  record: CaseRecord;
  events: CaseEvent[];
  agents: Partial<Record<Stage, string>>;
  page: Page;
  onPage: (p: Page) => void;
}) {
  const now = useNow(1000);
  return (
    <nav aria-label="Agent stages" data-testid="timeline" className="bg-road-white px-8 py-2 shadow-[inset_0_-1px_0_var(--hairline)]">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {STAGES.map((stage, i) => {
          const info = stageInfo(stage, events, record, now);
          const post = postState(stage, info.state, events, record);
          const note = stageNote(stage, record, events, now);
          const current = info.state === "running" || info.state === "waiting";
          const showNote = note && (current || note.tone === "risk");
          const here = STAGE_PAGE[stage] === page;
          return (
            <li key={stage} data-testid={`stage-${stage}`} data-state={info.state} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className={cn("h-0.5 w-4", info.state === "pending" ? "bg-hairline" : "bg-sign-green")} />}
              <button
                type="button"
                onClick={() => onPage(STAGE_PAGE[stage])}
                disabled={info.state === "pending"}
                aria-current={here && current ? "step" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm disabled:cursor-default",
                  "transition-[background-color] duration-[var(--dur-fast)]",
                  here ? "bg-surface-2" : "hover:bg-surface-2",
                )}
              >
                <span
                  aria-hidden
                  data-post={post}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-black transition-colors duration-[var(--dur-base)]",
                    DOT[post],
                  )}
                >
                  {i + 1}
                </span>
                <span className={cn("font-bold", info.state === "pending" ? "text-ink-2" : "text-asphalt")}>{STAGE_LABEL[stage]}</span>
                {agents[stage] && (
                  <span className="sr-only" data-testid={`agent-${stage}`}>
                    {agents[stage]}
                  </span>
                )}
                {showNote && (
                  <span
                    className={cn(
                      "text-xs font-bold",
                      note.tone === "risk" ? "text-chip-risk-fg" : note.tone === "needs" ? "text-chip-needs-fg" : "text-ink-2",
                    )}
                  >
                    {note.text}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
