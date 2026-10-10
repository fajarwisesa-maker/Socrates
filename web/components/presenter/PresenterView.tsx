"use client";

import { dayShort } from "@/lib/format";
import { currentStage } from "@/lib/stages";
import type { CaseState } from "@/lib/useCase";
import { ImpactMeter } from "./ImpactMeter";
import { PresenterClock } from "./PresenterClock";
import { StageCanvas } from "./StageCanvas";
import { StageRail } from "./StageRail";
import { StartCanvas } from "./StartCanvas";
import { Wordmark } from "./Wordmark";

/**
 * Presenter mode (projector): at most three focal elements — the current stage, the
 * impact meter and the clock. Everything else lives in the details drawer (step 5).
 */
export function PresenterView({ state, modeSwitch }: { state: CaseState; modeSwitch: React.ReactNode }) {
  const { config, record, events, apiDown, follow } = state;
  const stage = record ? (currentStage(events) ?? "PERCEIVE") : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden" data-testid="presenter">
      <header className="flex h-[5.5rem] shrink-0 items-center gap-6 px-8">
        <Wordmark />
        {record && (
          <div className="text-xl text-ink-2" data-testid="case-line">
            Case <span className="font-semibold text-ink">#{record.case_id.replace(/^case-/, "").slice(0, 6)}</span>
            {record.day0 && <> · {dayShort(record.day0, record.created_at)}</>}
          </div>
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
        <div className="mx-8 mb-2 rounded-[var(--radius-control)] bg-human-soft px-4 py-2 text-xl text-human-ink">
          Reconnecting to the Case API…
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)_21rem] gap-6 px-8 pb-8">
        <div className="pt-2">
          <StageRail events={events} record={record} focus={stage} />
        </div>
        <section className="min-h-0 rounded-[var(--radius-card)] bg-surface p-8 shadow-[var(--shadow-card)]">
          {record && stage ? (
            <StageCanvas stage={stage} events={events} record={record} />
          ) : (
            <StartCanvas onStarted={follow} />
          )}
        </section>
        <ImpactMeter record={record} />
      </main>
    </div>
  );
}
