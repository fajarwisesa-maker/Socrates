// Plan stage pieces shared by Planner and Presenter: candidates as direction signs with
// strategy plates, the reason for a replan, and cited precedents as info plates.
import { ArrowRight, BookOpen, CalendarClock, Factory, Plane, Truck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { firstSentence, type PrecedentHit, type ReplanReason } from "@/lib/planView";
import { period, STRATEGY } from "@/lib/present";
import type { Candidate } from "@/lib/types";
import { cn } from "@/lib/utils";
import { AgentWritten, CARD, StatusPlate } from "./signs";

const ICON: Record<string, LucideIcon> = {
  stock_transfer: Truck,
  alternate_supplier: Factory,
  spot_air: Plane,
  reschedule_customer: CalendarClock,
};

/** A strategy as a white symbol plate (green on a sign, asphalt on white). */
export function StrategyPlate({ strategy, onSign = false, large = false }: { strategy: string; onSign?: boolean; large?: boolean }) {
  const Icon = ICON[strategy];
  return (
    <span
      data-strategy={strategy}
      className={cn(
        "inline-flex items-center gap-1 rounded-[6px] bg-road-white font-bold whitespace-nowrap",
        onSign ? "text-sign-green" : "text-asphalt inset-ring inset-ring-hairline",
        large ? "px-2 py-1 text-lg" : "px-2 py-1 text-sm",
      )}
    >
      {Icon && <Icon className={large ? "size-5" : "size-4"} strokeWidth={2.5} aria-hidden />}
      {STRATEGY[strategy] ?? strategy.replaceAll("_", " ")}
    </span>
  );
}

/**
 * One candidate as a green direction sign: option id, label, the strategies it combines and
 * an arrow on to Simulate. The model chose the strategies; the solver prices them next.
 */
export function CandidateSign({
  candidate,
  large = false,
  className,
}: {
  candidate: Candidate;
  large?: boolean;
  className?: string;
}) {
  return (
    <div
      data-testid={`candidate-${candidate.option_id}`}
      className={cn(
        "flex items-center gap-4 rounded-[12px] bg-sign-green text-white",
        large ? "px-6 py-4" : "px-6 py-4",
        className,
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-[6px] bg-road-white font-mono font-black text-sign-green",
          large ? "h-11 min-w-12 px-2 text-xl" : "h-9 min-w-10 px-1 text-base",
        )}
      >
        {candidate.option_id}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn("leading-tight font-black", large ? "text-2xl" : "text-xl")}>{candidate.label}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {candidate.strategies.map((s) => (
            <StrategyPlate key={s} strategy={s} onSign large={large} />
          ))}
        </div>
      </div>
      <ArrowRight className={cn("shrink-0", large ? "size-9" : "size-7")} strokeWidth={3} aria-label="priced next in Simulate" />
    </div>
  );
}

/** Why the agent planned again: a red-bordered plate with what changed. */
export function ReplanPlate({ reason, large = false }: { reason: ReplanReason; large?: boolean }) {
  return (
    <div
      data-testid="replan-reason"
      className={cn(
        "flex flex-wrap items-center gap-4 rounded-[12px] bg-road-white inset-ring-2 inset-ring-stop-red",
        large ? "px-6 py-2" : "px-6 py-2",
      )}
    >
      <StatusPlate tone="rejected" className={large ? "text-sm" : undefined}>
        {reason.label}
      </StatusPlate>
      <span className={cn("font-bold first-letter:uppercase", large ? "text-xl" : "text-base")}>{reason.text}</span>
    </div>
  );
}

/**
 * A cited precedent as an information plate. Its lesson is the knowledge-base text, not
 * the model's. Precedents in the demo KB are synthetic and say so.
 */
export function PrecedentPlate({
  hit,
  strategies = [],
  large = false,
  more = 0,
}: {
  hit: PrecedentHit;
  /** precedents not shown here (Presenter shows one; the rest are in the drawer) */
  more?: number;
  /** strategies of this case's candidates: tags that match are shown */
  strategies?: string[];
  large?: boolean;
}) {
  const matches = hit.tags.filter((t) => strategies.includes(t));
  return (
    <div data-testid={`precedent-${hit.id}`} className={CARD}>
      <div className={cn("flex flex-wrap items-center gap-2 border-b border-divider", large ? "px-6 py-2" : "px-6 py-2")}>
        <BookOpen className={large ? "size-5" : "size-4"} aria-hidden />
        <span className="font-mono text-sm font-bold">{hit.id}</span>
        {hit.period && <span className="font-mono text-sm">{period(hit.period)}</span>}
        <span className="ml-auto flex items-center gap-2">
          {more > 0 && <span className="text-sm">+{more} more in details (D)</span>}
          {hit.synthetic && <StatusPlate tone="muted">Synthetic precedent</StatusPlate>}
        </span>
      </div>
      <div className={large ? "px-6 py-2" : "px-6 py-4"}>
        <div className={cn("leading-snug font-black", large ? "text-xl" : "text-base")}>{hit.title}</div>
        {hit.lesson && (
          <p className={cn("mt-1 leading-snug", large ? "text-lg" : "text-sm")} data-testid="precedent-lesson">
            <b>Lesson:</b> {large ? firstSentence(hit.lesson) : hit.lesson}
          </p>
        )}
        {!large && matches.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="sign-label text-xs">Used here</span>
            {matches.map((s) => (
              <StrategyPlate key={s} strategy={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The model's search query, labelled as model-written. */
export function SearchQuery({ query }: { query: string }) {
  return (
    <p className="text-sm" data-testid="precedent-query">
      <span className="sign-label text-xs">Search</span> <span className="font-mono">{query}</span>{" "}
      <AgentWritten />
    </p>
  );
}
