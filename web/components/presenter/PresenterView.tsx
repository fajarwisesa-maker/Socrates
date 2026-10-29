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
import { cn } from "@/lib/utils";
import { CARD, Logo } from "../signs";
import { AgentContext } from "./canvases/Frame";
import { modelNote } from "../planner/Shell";

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

  // Act with a decision pending: the story waits for the planner, so Next is disabled
  const awaiting =
    step?.stage === "ACT" && !pacing.steps[pacing.index + 1] && state.approvals.some((a) => a.status === "PENDING");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === " ") {
        e.preventDefault();
        if (!awaiting) pacing.advance();
      } else if (e.key === "ArrowRight") {
        if (!awaiting) pacing.advance();
      }
      else if (e.key === "ArrowLeft") pacing.back();
      else if (e.key === "h" || e.key === "H") pacing.toggleHold();
      else if (e.key === "r" || e.key === "R") pacing.restart();
      else if (e.key === "l" || e.key === "L") pacing.toLatest();
      else if (e.key === "d" || e.key === "D") setDrawer((o) => !o);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pacing, awaiting]);

  const next = pacing.steps[pacing.index + 1];
  const agents = agentsByStage(viewEvents, config);
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
      <header className="flex h-14 shrink-0 items-center gap-6 bg-sign-green px-8 whitespace-nowrap text-white">
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
              className="rounded-[6px] bg-road-white px-2 py-1 text-xs font-black tracking-[0.08em] text-asphalt"
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
            <Kbd className="bg-transparent text-white inset-ring-white/70">D</Kbd>
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

      <main className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)_17rem] gap-8 px-8 py-4">
        <div>
          <StageRail
            events={viewEvents}
            record={record}
            focus={step?.stage ?? null}
            onSelect={pacing.show}
            agents={agents}
          />
        </div>
        <section className={cn(CARD, "relative min-h-0 overflow-hidden p-6")}>
          {record && step ? (
            <AgentContext.Provider value={agents[step.stage]}>
            <StageCanvas
              key={record.case_id}
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
            </AgentContext.Provider>
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
      <footer className="flex h-9 shrink-0 items-center gap-4 bg-sign-green px-8 text-sm whitespace-nowrap text-white">
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
            className="inline-flex items-center gap-1 rounded-[6px] bg-signal-yellow px-2 font-bold text-asphalt transition-colors duration-[var(--dur-fast)] hover:bg-[#ffd24d]"
          >
            <Radio className="size-4" aria-hidden /> Jump to live
          </button>
        )}
        {record && awaiting ? (
          <span className="inline-flex items-center gap-1 font-bold text-white" data-testid="next-step" aria-disabled="true">
            Next: after your approval
          </span>
        ) : (
          record &&
          pacing.progress !== null &&
          next && (
            <span className="inline-flex items-center gap-1 font-bold" data-testid="next-step">
              Next: {STAGE_LABEL[next.stage]}
              {next.round > 1 ? ` (${next.round})` : ""}
            </span>
          )
        )}
        <ul className="ml-auto flex items-center gap-4" aria-label="Keys" data-testid="key-footer">
          {KEYS.map(([k, what]) => (
            <li key={k} className="inline-flex items-center gap-1.5">
              <Kbd className="bg-transparent text-white inset-ring-white/70">{k}</Kbd>
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
