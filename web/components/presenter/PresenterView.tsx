"use client";

import { Radio } from "lucide-react";
import { useState } from "react";
import { dayShort } from "@/lib/format";
import { stageRounds } from "@/lib/present";
import { currentStage } from "@/lib/stages";
import type { Stage } from "@/lib/types";
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
  const { config, record, events, apiDown, follow, refresh } = state;
  // View cursor: follow the agent live, or show a stage the presenter picked on the rail.
  const [pinned, setPinned] = useState<{ caseId: string; stage: Stage; round: number } | null>(null);
  const pin = pinned && record && pinned.caseId === record.case_id ? pinned : null;
  const liveStage = record ? (currentStage(events) ?? "PERCEIVE") : null;
  const stage = pin?.stage ?? liveStage;
  const rounds = (s: Stage) => Math.max(1, stageRounds(events, s).length);
  const round = pin?.round ?? (stage ? rounds(stage) : 1);

  function select(s: Stage) {
    if (!record || !events.some((e) => e.stage === s)) return;
    // Clicking the shown stage again steps back through its rounds (e.g. Reflect 2 -> 1).
    const next = pin?.stage === s ? (pin.round > 1 ? pin.round - 1 : rounds(s)) : rounds(s);
    setPinned({ caseId: record.case_id, stage: s, round: next });
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden" data-testid="presenter">
      <header className="flex h-[5.5rem] shrink-0 items-center gap-6 px-6">
        <Wordmark />
        {record && (
          <div className="text-xl text-ink-2" data-testid="case-line">
            Case <span className="font-semibold text-ink">#{record.case_id.replace(/^case-/, "").slice(0, 6)}</span>
            {record.day0 && <> · {dayShort(record.day0, record.created_at)}</>}
          </div>
        )}
        {pin && (
          <button
            onClick={() => setPinned(null)}
            data-testid="follow-live"
            className="inline-flex items-center gap-2 rounded-full border-2 border-brand px-3 py-1 text-base font-semibold text-brand-ink hover:bg-brand-soft"
          >
            <Radio className="size-4" aria-hidden /> Back to live
          </button>
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

      <main className="grid min-h-0 flex-1 grid-cols-[15.5rem_minmax(0,1fr)_20rem] gap-5 px-6 pb-6">
        <div className="pt-2">
          <StageRail events={events} record={record} focus={stage} onSelect={select} />
        </div>
        <section className="min-h-0 overflow-hidden rounded-[var(--radius-card)] bg-surface p-6 shadow-[var(--shadow-card)]">
          {record && stage ? (
            <StageCanvas stage={stage} round={round} events={events} record={record} onDecided={refresh} />
          ) : (
            <StartCanvas onStarted={follow} />
          )}
        </section>
        <ImpactMeter record={record} />
      </main>
    </div>
  );
}
