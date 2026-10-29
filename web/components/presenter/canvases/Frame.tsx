import { createContext, useContext } from "react";
import { CARD } from "@/components/signs";
import { STAGE_LABEL, STAGES } from "@/lib/stages";
import type { Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

/** The agent of the stage on screen, named in the kicker ("KM 2 · Assess · Impact Agent"). */
export const AgentContext = createContext<string | undefined>(undefined);

/** Kicker, one headline sentence, one visual. */
export function Frame({
  stage,
  round,
  kicker,
  headline,
  tone = "ink",
  children,
}: {
  stage: Stage;
  round: number;
  kicker?: string;
  headline: React.ReactNode;
  tone?: "ink" | "risk" | "human" | "ok";
  children: React.ReactNode;
}) {
  const agent = useContext(AgentContext);
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="stage-canvas" data-stage={stage} data-round={round}>
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
      <div className="mt-6 min-h-0 flex-1">{children}</div>
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
