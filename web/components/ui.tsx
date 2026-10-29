import type { ReactNode } from "react";

export function Panel({
  title,
  right,
  children,
  className = "",
  testId,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section
      data-testid={testId}
      className={`rounded-[12px] bg-road-white inset-ring inset-ring-hairline ${className}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-divider px-6 py-4">
        <h2 className="sign-label text-sm text-asphalt">{title}</h2>
        {right}
      </header>
      <div className="px-6 py-4">{children}</div>
    </section>
  );
}

// Tone names kept for the callers; colours are the design tokens (status colours = status).
const TONES = {
  slate: "bg-road-white text-asphalt ring-asphalt",
  sky: "bg-road-white text-sign-green ring-sign-green",
  emerald: "bg-sign-green text-white ring-sign-green",
  amber: "bg-signal-yellow text-asphalt ring-asphalt",
  red: "bg-stop-red text-white ring-stop-red",
  violet: "bg-road-white text-asphalt ring-asphalt",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-xs font-extrabold tracking-[0.04em] ring-2 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

export function TierBadge({ tier }: { tier: number }) {
  const tone: Tone = tier >= 3 ? "amber" : tier === 2 ? "emerald" : "slate";
  const name = ["Observe", "Draft", "Execute", "Escalate"][tier] ?? "";
  return (
    <Badge tone={tone}>
      Tier {tier} · {name}
    </Badge>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium tracking-wide text-ink-2 uppercase">{label}</div>
      <div className="whitespace-nowrap text-lg font-semibold tabular-nums text-ink">{value}</div>
      {sub && <div className="text-xs text-ink-2">{sub}</div>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-ink-2">{children}</p>;
}
