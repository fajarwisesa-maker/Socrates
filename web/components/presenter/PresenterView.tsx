"use client";

import { PanelRight, Pause, Radio } from "lucide-react";
import { useEffect, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { dayShort } from "@/lib/format";
import { useDwell, usePacing } from "@/lib/pacing";
import { agentsByStage } from "@/lib/present";
import { STAGE_LABEL } from "@/lib/stages";
import type { CaseState } from "@/lib/useCase";
import { DetailsDrawer } from "./DetailsDrawer";
import { ImpactMeter } from "./ImpactMeter";
import { PresenterClock } from "./PresenterClock";
import { StageCanvas } from "./StageCanvas";
import { StageRail } from "./StageRail";
import { StartCanvas } from "./StartCanvas";
import { caseTitle, shortId } from "@/lib/caseView";
import { Logo } from "../signs";
import { modelNote } from "../planner/PlannerHeader";

const KEYS: [string, string][] = [
  ["Space", "next"],
  ["←", "back"],
  ["H", "hold"],
  ["R", "restart"],
  ["L", "live"],
  ["D", "details"],
  ["P", "planner"],
];

/**
 * Presenter mode (projector): at most three focal elements — the current stage, the
 * impact meter and the clock. The view walks through the case step by step with a
 * minimum dwell per step (Space advances, H holds, R restarts the view, ← → step).
 */
export function PresenterView({ state, modeSwitch }: { state: CaseState; modeSwitch: React.ReactNode }) {
  const { config, record, events, apiDown, follow, refresh, reset } = state;
  const [drawer, setDrawer] = useState(false);
  const dwell = useDwell();
  const pacing = usePacing(record?.case_id ?? null, events, dwell);
  const { step, viewEvents } = pacing;
  // a case opened from WhatsApp plays from its first step, like one started here
  const [playedIncoming, setPlayedIncoming] = useState<string | null>(null);
  if (state.incomingId && state.incomingId !== playedIncoming) {
    setPlayedIncoming(state.incomingId);
    pacing.fromStart(state.incomingId);
  }

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
      else if (e.key === "d" || e.key === "D") setDrawer((o) => !o);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pacing]);

  const next = pacing.steps[pacing.index + 1];
  const note = modelNote(config, events);

  return (
    <div
      className="flex h-screen flex-col overflow-hidden"
      data-testid="presenter"
      data-dwell={dwell}
      data-step={pacing.index}
      data-steps={pacing.steps.length}
      data-held={pacing.held ? "1" : undefined}
    >
      <header className="flex h-14 shrink-0 items-center gap-5 bg-asphalt px-6 whitespace-nowrap text-white">
        <Logo height={26} />
        {record && (
          <span className="min-w-0 truncate text-lg font-black" data-testid="presenter-case-title" title={caseTitle(record)}>
            {caseTitle(record)}
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          {note && (
            <span data-testid="model-note" className="font-mono text-xs">
              {note}
            </span>
          )}
          {config?.replay && (
            <span
              data-testid="replay-badge"
              className="rounded-[4px] border-2 border-white px-2 py-0.5 text-xs font-black tracking-[0.08em]"
              title={config.replay_source ? `Recorded run (${config.replay_source.provider})` : "Recorded run"}
            >
              REPLAY
            </span>
          )}
          <button
            onClick={() => setDrawer(true)}
            data-testid="open-details"
            title="Details (D)"
            className="inline-flex min-h-9 items-center gap-2 rounded-[6px] px-2 text-sm font-bold hover:bg-white/15"
          >
            <PanelRight className="size-4" aria-hidden />
            <span className="sr-only">Details</span>
            <Kbd className="border-white/70 bg-transparent text-white">D</Kbd>
          </button>
          {modeSwitch}
          <PresenterClock events={events} />
        </div>
      </header>

      {apiDown && (
        <div className="mx-6 mb-2 rounded-[var(--radius-control)] bg-human-soft px-4 py-2 text-xl text-human-ink">
          Reconnecting to the Case API…
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-[15rem_minmax(0,1fr)_19rem] gap-5 px-6 py-4">
        <div>
          <StageRail
            events={viewEvents}
            record={record}
            focus={step?.stage ?? null}
            onSelect={pacing.show}
            agents={agentsByStage(viewEvents, config)}
          />
        </div>
        <section className="relative min-h-0 overflow-hidden rounded-[12px] border-[3px] border-asphalt bg-road-white p-5 shadow-[var(--shadow-card)]">
          {record && step ? (
            <StageCanvas
              key={`${record.case_id}-${pacing.index}`}
              stage={step.stage}
              round={step.round}
              events={events}
              record={record}
              approvals={state.approvals}
              live={pacing.isLatest}
              onDecided={() => {
                refresh();
                pacing.touch();
              }}
            />
          ) : record ? (
            <p className="text-xl font-bold">Reading the signals…</p>
          ) : (
            <StartCanvas
              onStarted={(id) => {
                pacing.fromStart(id);
                follow(id);
              }}
            />
          )}
          {pacing.progress !== null && next && (
            <div className="absolute inset-x-0 bottom-0 h-1.5 bg-curb" data-testid="dwell" aria-hidden>
              <div className="h-full bg-signal-yellow" style={{ width: `${pacing.progress * 100}%` }} />
            </div>
          )}
        </section>
        <ImpactMeter record={record} viewEvents={viewEvents} isLatest={pacing.isLatest} />
      </main>
      <footer className="flex h-9 shrink-0 items-center gap-4 bg-asphalt px-6 text-sm whitespace-nowrap text-white">
        {record && (
          <span className="font-mono text-xs" data-testid="case-line">
            Case {shortId(record.case_id)}
            {record.day0 && <> · opened {dayShort(record.day0, record.created_at)}</>}
          </span>
        )}
        {record && pacing.held && (
          <span data-testid="held" className="inline-flex items-center gap-1.5 font-bold text-signal-yellow">
            <Pause className="size-4" aria-hidden /> Held
          </span>
        )}
        {record && pacing.held && !pacing.isLatest && (
          <button
            onClick={pacing.toLatest}
            data-testid="follow-live"
            className="inline-flex items-center gap-1.5 rounded-[4px] border-2 border-signal-yellow px-2 font-bold text-signal-yellow hover:bg-white/10"
          >
            <Radio className="size-4" aria-hidden /> Jump to live
          </button>
        )}
        {record && pacing.progress !== null && next && (
          <span className="inline-flex items-center gap-1.5 font-bold" data-testid="next-step">
            Next: {STAGE_LABEL[next.stage]}
            {next.round > 1 ? ` (${next.round})` : ""}
          </span>
        )}
        <ul className="ml-auto flex items-center gap-4" aria-label="Keys" data-testid="key-footer">
          {KEYS.map(([k, what]) => (
            <li key={k} className="inline-flex items-center gap-1.5">
              <Kbd className="border-white/70 bg-transparent text-white">{k}</Kbd>
              <span>{what}</span>
            </li>
          ))}
        </ul>
      </footer>
      <DetailsDrawer
        open={drawer}
        onOpenChange={setDrawer}
        record={record}
        events={events}
        step={step}
        config={config}
        onReset={async () => {
          await reset();
          setDrawer(false);
        }}
      />
    </div>
  );
}
