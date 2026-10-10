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
      <p className="text-xl font-medium text-brand-ink">
        Stage {STAGES.indexOf(stage) + 1} of 7 · {STAGE_LABEL[stage]}
        {kicker ? ` · ${kicker}` : ""}
      </p>
      <h1
        data-testid="canvas-headline"
        className={cn(
          "mt-1 text-[2.5rem] leading-[1.1] font-bold tracking-tight text-balance",
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
    <div data-testid={testId} className={cn("rounded-[var(--radius-card)] bg-surface-2 p-5", className)}>
      {children}
    </div>
  );
}
