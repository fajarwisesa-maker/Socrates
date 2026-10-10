"use client";

import { Pause, Radio } from "lucide-react";
import { useEffect } from "react";
import { Kbd } from "@/components/ui/kbd";
import { dayShort } from "@/lib/format";
import { useDwell, usePacing } from "@/lib/pacing";
import { STAGE_LABEL } from "@/lib/stages";
import type { CaseState } from "@/lib/useCase";
import { ImpactMeter } from "./ImpactMeter";
import { PresenterClock } from "./PresenterClock";
import { StageCanvas } from "./StageCanvas";
import { StageRail } from "./StageRail";
import { StartCanvas } from "./StartCanvas";
import { Wordmark } from "./Wordmark";

/**
 * Presenter mode (projector): at most three focal elements — the current stage, the
 * impact meter and the clock. The view walks through the case step by step with a
 * minimum dwell per step (Space advances, H holds, R restarts the view, ← → step).
 */
export function PresenterView({ state, modeSwitch }: { state: CaseState; modeSwitch: React.ReactNode }) {
  const { config, record, events, apiDown, follow, refresh } = state;
  const dwell = useDwell();
  const pacing = usePacing(record?.case_id ?? null, events, dwell);
  const { step, viewEvents } = pacing;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === " ") {
        e.preventDefault();
        pacing.advance();
      } else if (e.key === "ArrowRight") pacing.advance();
      else if (e.key === "ArrowLeft") pacing.back();
      else if (e.key === "h" || e.key === "H") pacing.toggleHold();
      else if (e.key === "r" || e.key === "R") pacing.restart();
      else if (e.key === "l" || e.key === "L") pacing.toLatest();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pacing]);

  const next = pacing.steps[pacing.index + 1];

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      data-testid="presenter"
      data-dwell={dwell}
      data-step={pacing.index}
      data-steps={pacing.steps.length}
      data-held={pacing.held ? "1" : undefined}
    >
      <header className="flex h-[5.5rem] shrink-0 items-center gap-6 px-6">
        <Wordmark />
        {record && (
          <div className="text-xl text-ink-2" data-testid="case-line">
            Case <span className="font-semibold text-ink">#{record.case_id.replace(/^case-/, "").slice(0, 6)}</span>
            {record.day0 && <> · {dayShort(record.day0, record.created_at)}</>}
          </div>
        )}
        {record && pacing.held && (
          <span
            data-testid="held"
            className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-base font-semibold text-ink-2"
          >
            <Pause className="size-4" aria-hidden /> Held <Kbd>H</Kbd>
          </span>
        )}
        {record && pacing.held && !pacing.isLatest && (
          <button
            onClick={pacing.toLatest}
            data-testid="follow-live"
            className="inline-flex items-center gap-2 rounded-full border-2 border-brand px-3 py-1 text-base font-semibold text-brand-ink hover:bg-brand-soft"
          >
            <Radio className="size-4" aria-hidden /> Jump to live
          </button>
        )}
        {record && pacing.progress !== null && next && (
          <span className="inline-flex items-center gap-2 text-base font-medium text-ink-2" data-testid="next-step">
            Next: {STAGE_LABEL[next.stage]}
            {next.round > 1 ? ` (round ${next.round})` : ""} <Kbd>Space</Kbd>
          </span>
        )}
        <div className="ml-auto flex items-center gap-6">
          {config?.replay && (
            <span
              data-testid="replay-badge"
              className="rounded-full bg-surface-2 px-3 py-1 text-sm font-semibold tracking-wide text-ink-2"
              title={config.replay_source ? `Recorded run (${config.replay_source.provider})` : "Recorded run"}
            >
              REPLAY
            </span>
          )}
          {modeSwitch}
          <PresenterClock events={events} />
        </div>
      </header>

      {apiDown && (
        <div className="mx-6 mb-2 rounded-[var(--radius-control)] bg-human-soft px-4 py-2 text-xl text-human-ink">
          Reconnecting to the Case API…
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)_20rem] gap-5 px-6 pb-6">
        <div className="pt-2">
          <StageRail events={viewEvents} record={record} focus={step?.stage ?? null} onSelect={pacing.show} />
        </div>
        <section className="relative min-h-0 overflow-hidden rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-card)]">
          {record && step ? (
            <StageCanvas
              key={`${record.case_id}-${pacing.index}`}
              stage={step.stage}
              round={step.round}
              events={events}
              record={record}
              onDecided={() => {
                refresh();
                pacing.touch();
              }}
            />
          ) : record ? (
            <p className="text-xl text-ink-2">Reading the signals…</p>
          ) : (
            <StartCanvas
              onStarted={(id) => {
                pacing.fromStart(id);
                follow(id);
              }}
            />
          )}
          {pacing.progress !== null && next && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-surface-2" data-testid="dwell" aria-hidden>
              <div className="h-full bg-brand" style={{ width: `${pacing.progress * 100}%` }} />
            </div>
          )}
        </section>
        <ImpactMeter record={record} viewEvents={viewEvents} isLatest={pacing.isLatest} />
      </main>
    </div>
  );
}
