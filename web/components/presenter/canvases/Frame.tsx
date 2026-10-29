import { createContext, useContext } from "react";
import { LaneMap } from "@/components/LaneMap";
import { Reveal } from "@/components/Reveal";
import type { LaneModel } from "@/lib/laneModel";
import { CARD } from "@/components/signs";
import { STAGE_LABEL, STAGES } from "@/lib/stages";
import type { Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The agent of the stage on screen, named in the kicker ("KM 2 · Assess · Impact Agent"). */
export const AgentContext = createContext<string | undefined>(undefined);

/**
 * Kicker, one headline sentence, one visual. With `map`, the lane map sits between the
 * headline and the content and is NOT keyed by the step: StageCanvas renders one Frame for
 * Assess, Act and Verify, so the map stays mounted and morphs (Act to Verify).
 */
export function Frame({
  stage,
  round,
  kicker,
  headline,
  tone = "ink",
  stepKey,
  map,
  bodyDelay = 80,
  children,
}: {
  stage: Stage;
  round: number;
  kicker?: string;
  headline: React.ReactNode;
  tone?: "ink" | "risk" | "human" | "ok";
  /** the step on screen: its heading and content rise in when it changes */
  stepKey?: string;
  map?: LaneModel | null;
  /** ms before the content rises in (after the map has drawn, on Assess) */
  bodyDelay?: number;
  children: React.ReactNode;
}) {
  const agent = useContext(AgentContext);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="stage-canvas" data-stage={stage} data-round={round}>
      <Reveal key={`head-${stepKey}`}>
        <p className="sign-label font-mono text-sm text-asphalt-muted" data-testid="canvas-kicker">
          KM {STAGES.indexOf(stage) + 1} · {STAGE_LABEL[stage]}
          {kicker ? ` · ${kicker}` : ""}
          {agent ? ` · ${agent}` : ""}
        </p>
        <h1
          data-testid="canvas-headline"
          className={cn(
            "mt-1 text-3xl leading-[1.15] font-black text-balance",
            tone === "risk" && "text-risk-ink",
            tone === "human" && "text-human-ink",
            tone === "ok" && "text-ok-ink",
          )}
        >
          {headline}
        </h1>
      </Reveal>
      {map && (
        // fades in once; afterwards it only morphs
        <Reveal kind="fade-in" className="mt-4 shrink-0">
          <LaneMap key="map" model={map} size="sm" className="mx-auto w-[80%]" />
        </Reveal>
      )}
      <Reveal key={`body-${stepKey}`} delay={bodyDelay} className={cn(map ? "mt-4" : "mt-6", "min-h-0 flex-1")}>
        {children}
      </Reveal>
    </div>
  );
}

export function Card({
  className,
  children,
  testId,
}: {
  className?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={cn(CARD, "p-6", className)}>
      {children}
    </div>
  );
}
