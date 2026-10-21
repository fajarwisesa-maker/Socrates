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
      className={`rounded-[var(--radius-card)] bg-surface shadow-[var(--shadow-card)] ${className}`}
    >
      <header className="flex items-center justify-between gap-3 border-b-2 border-surface-2 px-4 py-3">
        <h2 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{title}</h2>
        {right}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

// Tone names kept for the callers; colours are the design tokens (status colours = status).
const TONES = {
  slate: "bg-surface-2 text-ink-2 ring-line",
  sky: "bg-brand-soft text-brand-ink ring-brand/30",
  emerald: "bg-ok-soft text-ok-ink ring-ok/40",
  amber: "bg-human-soft text-human-ink ring-human/40",
  red: "bg-risk-soft text-risk-ink ring-risk/40",
  violet: "bg-surface-2 text-ink-2 ring-line",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]}`}
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
