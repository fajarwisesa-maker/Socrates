// "Jalan Tol" sign components (docs/redesign-prompt.md 4.4), all in one place. Every sign
// stands for a real state: green = route / done, yellow = needs a person, red = blocked /
// rejected, white = not reached, asphalt = structure. Each status also carries a word.
import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The white wordmark for asphalt surfaces (28px high by default). Never recoloured. */
export function Logo({ height = 28, className }: { height?: number; className?: string }) {
  // the file's viewBox is 2623 x 924.5
  const width = Math.round((height * 2623) / 924.5);
  return (
    <Image
      src="/brand/siaga-wordmark-white.svg"
      alt="siaga"
      width={width}
      height={height}
      priority
      unoptimized
      className={cn("block shrink-0", className)}
      style={{ height, width: "auto" }}
      data-testid="logo"
    />
  );
}

/** Green panel with a white inner border: case header, impact, outcome, approved. */
export function GantrySign({
  children,
  className,
  testId,
  as: Tag = "div",
  label,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
  as?: "div" | "section" | "header";
  label?: string;
}) {
  return (
    <Tag
      data-testid={testId}
      aria-label={label}
      className={cn(
        "rounded-[12px] bg-sign-green text-white shadow-[inset_0_0_0_4px_var(--sign-green),inset_0_0_0_7px_#fff,var(--shadow-sign)]",
        "px-5 py-4",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/** White route shield with an asphalt border: lane codes, e.g. SMG-JKT. */
export function RouteShield({ code, className }: { code: string; className?: string }) {
  return (
    <span
      data-testid="route-shield"
      aria-label={`Route ${code}`}
      className={cn(
        "inline-flex shrink-0 items-center justify-center border-[3px] border-asphalt bg-road-white px-3 pt-1 pb-1.5",
        "font-mono text-sm leading-none font-bold tracking-wide whitespace-nowrap text-asphalt uppercase",
        "rounded-t-[8px] rounded-b-[45%_60%] shadow-[var(--shadow-sign)]",
        className,
      )}
    >
      {code}
    </span>
  );
}

/** Signal-yellow plate, 4px asphalt border: approval, "needs you", the disruption cause. */
export function WarningPlate({
  children,
  className,
  testId,
  size = "md",
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
  size?: "sm" | "md" | "lg";
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "border-asphalt bg-signal-yellow text-asphalt shadow-[var(--shadow-sign)]",
        size === "sm" && "rounded-[8px] border-[3px] px-2 py-0.5",
        size === "md" && "rounded-[10px] border-4 px-3 py-1.5",
        size === "lg" && "rounded-[12px] border-4 p-5",
        className,
      )}
    >
      {children}
    </div>
  );
}

export type PlateTone = "needs" | "done" | "rejected" | "verified" | "running" | "escalated" | "muted";

const PLATE: Record<PlateTone, string> = {
  needs: "bg-signal-yellow text-asphalt border-asphalt",
  done: "bg-sign-green text-white border-sign-green",
  rejected: "bg-stop-red text-white border-stop-red",
  verified: "bg-road-white text-brand-ink border-sign-green",
  running: "bg-road-white text-asphalt border-asphalt",
  escalated: "bg-asphalt text-white border-asphalt",
  muted: "bg-road-white text-asphalt-muted border-curb",
};

/** Small rectangular status plate: NEEDS YOU, DONE AUTOMATICALLY, REJECTED, VERIFIED… */
export function StatusPlate({
  tone,
  children,
  count,
  className,
  testId,
  icon,
}: {
  tone: PlateTone;
  children: ReactNode;
  count?: number;
  className?: string;
  testId?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-[6px] border-2 px-2 py-0.5 text-xs leading-tight font-black tracking-[0.1em] whitespace-nowrap uppercase",
        PLATE[tone],
        className,
      )}
    >
      {icon}
      {children}
      {count !== undefined && <span className="font-mono tracking-normal">{count}</span>}
    </span>
  );
}

export type PostState = "done" | "current" | "flagged" | "pending" | "verified";

const POST: Record<PostState, string> = {
  done: "bg-sign-green text-white border-sign-green",
  verified: "bg-sign-green text-white border-sign-green",
  current: "bg-signal-yellow text-asphalt border-asphalt",
  flagged: "bg-stop-red text-white border-stop-red",
  pending: "bg-road-white text-asphalt border-asphalt",
};

/** 42px kilometre post with "KM" over the stage number (the stage rail). */
export function KmPost({ n, state, className }: { n: number; state: PostState; className?: string }) {
  return (
    <span
      aria-hidden
      data-post={state}
      className={cn(
        "relative z-10 flex h-[2.75rem] w-[2.625rem] shrink-0 flex-col items-center justify-center rounded-[6px] border-2 leading-none",
        POST[state],
        className,
      )}
    >
      <span className="text-[0.625rem] font-extrabold tracking-[0.08em]">KM</span>
      <span className="text-xl font-black">{n}</span>
    </span>
  );
}

/** 8px asphalt strip with a dashed white centre line, between KM posts or as a divider. */
export function RoadLine({ vertical = false, className }: { vertical?: boolean; className?: string }) {
  return <span aria-hidden className={cn(vertical ? "road-v w-2" : "road-h h-2", "block", className)} />;
}

/** Yellow dashed line with a centred label: "Done by SIAGA" above, "Needs you" below. */
export function LaneDivider({ label, className }: { label: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3", className)} role="separator" aria-label={label}>
      <span aria-hidden className="h-1 flex-1 bg-[repeating-linear-gradient(to_right,var(--signal-yellow)_0_22px,transparent_22px_34px)]" />
      <span className="sign-label text-xs text-asphalt">{label}</span>
      <span aria-hidden className="h-1 flex-1 bg-[repeating-linear-gradient(to_right,var(--signal-yellow)_0_22px,transparent_22px_34px)]" />
    </div>
  );
}

export const TIER_MEANING: Record<number, { short: string; long: string }> = {
  0: { short: "Observed", long: "SAP reads, risk, simulations, status checks." },
  1: { short: "Drafted", long: "Drafts such as an RFQ. Nothing is sent." },
  2: { short: "Done automatically", long: "Internal, reversible actions under Rp 50 jt." },
  3: { short: "Needs your approval", long: "Supplier POs, spot air, customer date changes, or Rp 50 jt and above." },
};

/** TIER 0..3 plate, optionally with its plain-word meaning beside it. */
export function TierPlate({ tier, meaning, className }: { tier: number; meaning?: "short" | "long"; className?: string }) {
  const tone =
    tier >= 3
      ? "bg-signal-yellow text-asphalt border-asphalt"
      : tier === 2
        ? "bg-sign-green text-white border-sign-green"
        : "bg-road-white text-asphalt border-asphalt";
  const plate = (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-[6px] border-2 px-1.5 py-0.5 text-xs leading-tight font-black tracking-[0.08em] whitespace-nowrap uppercase",
        tone,
        !meaning && className,
      )}
    >
      Tier {tier}
    </span>
  );
  if (!meaning) return plate;
  const m = TIER_MEANING[tier];
  return (
    <span className={cn("flex items-start gap-3", className)}>
      {plate}
      <span className="text-sm text-asphalt">
        <b className="font-bold">{m?.short}.</b> {meaning === "long" ? m?.long : null}
      </span>
    </span>
  );
}

/** Small teal label marking model-written text. */
export function AgentWritten({ by, className }: { by?: string | null; className?: string }) {
  return (
    <span className={cn("text-xs font-bold tracking-[0.06em] text-brand-teal-ink uppercase", className)}>
      Written by {by ? `the ${by}` : "the agent"}
    </span>
  );
}

/** Small honesty label for solver numbers. */
export function SolverLabel({ children = "Calculated by the solver, not AI", className }: { children?: ReactNode; className?: string }) {
  return <span className={cn("text-xs font-semibold text-asphalt-muted", className)}>{children}</span>;
}

/** Uppercase section heading on concrete or white (not a state). */
export function SignHeading({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn("sign-label text-sm text-asphalt", className)}>{children}</h2>;
}
