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
import { Chip } from "./ui";

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
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {STAGES.map((stage, i) => {
          const info = stageInfo(stage, events, record, now);
          const post = postState(stage, info.state, events, record);
          const note = stageNote(stage, record, events, now);
          const current = post === "current";
          const showNote = note && (current || note.tone === "risk");
          const here = STAGE_PAGE[stage] === page;
          // tinted pill on the current stage: needs while waiting for a person, info while working
          const pill = current
            ? info.state === "waiting"
              ? "bg-tint-needs-bg inset-ring inset-ring-tint-needs-line"
              : "bg-tint-info-bg inset-ring inset-ring-tint-info-line"
            : post === "verified"
              ? "bg-tint-ok-bg inset-ring inset-ring-tint-ok-line"
              : post === "flagged" && info.state === "escalated"
                ? "bg-tint-risk-bg inset-ring inset-ring-tint-risk-line"
                : null;
          return (
            <li key={stage} data-testid={`stage-${stage}`} data-state={info.state} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden className={cn("h-0.5 w-3 transition-colors duration-[var(--dur-base)]", post === "pending" ? "bg-hairline" : "bg-sign-green")} />}
              <button
                type="button"
                onClick={() => onPage(STAGE_PAGE[stage])}
                disabled={post === "pending"}
                aria-current={here && current ? "step" : undefined}
                className={cn(
                  "flex min-h-9 items-center gap-2 rounded-full py-1 pr-2 pl-1 text-sm disabled:cursor-default",
                  "transition-[background-color,box-shadow] duration-[var(--dur-base)]",
                  pill ?? (here ? "bg-row-hover inset-ring inset-ring-hairline" : "hover:bg-row-hover"),
                )}
              >
                <span
                  aria-hidden
                  key={current ? "current" : post}
                  data-post={post}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full text-xs font-black transition-colors duration-[var(--dur-base)]",
                    DOT[post],
                    current && info.state === "running" && "pulse-once",
                  )}
                >
                  {i + 1}
                </span>
                <span className={cn("font-bold", post === "pending" ? "text-ink-2" : "text-asphalt")}>{STAGE_LABEL[stage]}</span>
                {agents[stage] && (
                  <span className="sr-only" data-testid={`agent-${stage}`}>
                    {agents[stage]}
                  </span>
                )}
                {showNote && (
                  <Chip tone={note.tone} testId={`stage-note-${stage}`}>
                    {note.text}
                  </Chip>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
