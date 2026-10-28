import { STAGE_LABEL, STAGES } from "@/lib/stages";
import type { Stage } from "@/lib/types";
import { cn } from "@/lib/utils";

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
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="stage-canvas" data-stage={stage} data-round={round}>
      <p className="sign-label font-mono text-sm text-asphalt-muted">
        KM {STAGES.indexOf(stage) + 1} of 7 · {STAGE_LABEL[stage]}
        {kicker ? ` · ${kicker}` : ""}
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
      <div className="mt-5 min-h-0 flex-1">{children}</div>
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
    <div data-testid={testId} className={cn("rounded-[12px] border-2 border-asphalt bg-road-white p-5", className)}>
      {children}
    </div>
  );
}
