// UI v3 building blocks (the owner's mockup, docs/ui-v3-plan.md): soft status chips, page
// headers, KPI cards and titled panels on white cards with one hairline. Numbers are
// backend values, formatted by the caller.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CARD } from "../signs";

export type ChipTone = "risk" | "needs" | "ok" | "info" | "muted";

const CHIP: Record<ChipTone, string> = {
  risk: "bg-chip-risk-bg text-chip-risk-fg",
  needs: "bg-chip-needs-bg text-chip-needs-fg",
  ok: "bg-chip-ok-bg text-chip-ok-fg",
  info: "bg-chip-info-bg text-chip-info-fg",
  muted: "bg-chip-muted-bg text-chip-muted-fg",
};

/** A soft status pill; its colour changes over 320 ms when the tone changes. */
export function Chip({
  tone,
  children,
  icon,
  className,
  testId,
}: {
  tone: ChipTone;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap",
        "transition-colors duration-[var(--dur-base)] ease-[var(--ease-standard)] [&_svg]:size-3.5",
        CHIP[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

/** Page title block: chips above, one-line title, one supporting line, actions on the right. */
export function PageHeader({
  chips,
  title,
  description,
  actions,
}: {
  chips?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-6">
      <div className="flex max-w-3xl min-w-0 flex-col gap-2">
        {chips && <div className="flex flex-wrap items-center gap-2">{chips}</div>}
        <h1 className="text-3xl leading-tight font-black text-asphalt" data-testid="page-title">
          {title}
        </h1>
        {description && <p className="text-base text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

/** A titled white card. */
export function Panel({
  title,
  icon,
  right,
  description,
  children,
  className,
  testId,
}: {
  title: ReactNode;
  icon?: ReactNode;
  right?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={cn(CARD, "flex min-w-0 flex-col gap-4 p-6", className)} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="flex items-center gap-2 text-lg font-black text-asphalt [&_svg]:size-5 [&_svg]:text-sign-green">
            {icon}
            {title}
          </h2>
          {description && <p className="text-sm text-ink-2">{description}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

const KPI_TONE = {
  ink: "text-asphalt",
  risk: "text-chip-risk-fg",
  ok: "text-brand-ink",
  needs: "text-chip-needs-fg",
} as const;

/** One headline number: label, icon, value, one note line. */
export function Kpi({
  label,
  value,
  note,
  icon,
  tone = "ink",
  testId,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  tone?: keyof typeof KPI_TONE;
  testId?: string;
}) {
  return (
    <div className={cn(CARD, "flex min-w-0 flex-col gap-1 p-6")} data-testid={testId}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">{label}</span>
        {icon && (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-[8px] bg-surface-2 text-sign-green [&_svg]:size-4">
            {icon}
          </span>
        )}
      </div>
      <div className={cn("text-3xl leading-tight font-black whitespace-nowrap", KPI_TONE[tone])}>{value}</div>
      {note && <p className="text-sm text-ink-2">{note}</p>}
    </div>
  );
}

/** Label over value, for small fact grids. */
export function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-xs font-bold tracking-[0.06em] text-ink-2 uppercase">{label}</span>
      <span className="text-base font-bold text-asphalt">{children}</span>
    </div>
  );
}

/** Placeholder for a part of the mockup that has no data source yet. */
export function ComingLater({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-[12px] bg-surface-2 p-6 text-ink-2" data-testid={testId}>
      <Chip tone="muted" className="self-start">
        Coming later
      </Chip>
      <h2 className="text-lg font-black text-asphalt">{title}</h2>
      <p className="text-sm">{children}</p>
    </div>
  );
}
