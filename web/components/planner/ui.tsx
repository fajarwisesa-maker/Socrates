// UI v3 building blocks (the owner's mockup, docs/ui-v3-plan.md; polish pass
// docs/ui-v3-polish-plan.md): soft status chips, page headers, tinted KPI cards, titled
// panels on white cards with one hairline, rows divided by hairlines and note rows.
// Numbers are backend values, formatted by the caller.
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

export type Tone = "risk" | "needs" | "ok" | "info" | "neutral";

/** Tinted surfaces (UI v3 polish 3.1): only KPI cards, the approval sign and one highlight
 *  row per panel get one. Text on them uses the chip fg; the value uses the strong colour. */
export const TINT: Record<Tone, { surface: string; label: string; strong: string; tile: string }> = {
  risk: {
    surface: "bg-tint-risk-bg inset-ring inset-ring-tint-risk-line",
    label: "text-chip-risk-fg",
    strong: "text-stop-red",
    tile: "bg-chip-risk-bg text-chip-risk-fg",
  },
  needs: {
    surface: "bg-tint-needs-bg inset-ring inset-ring-tint-needs-line",
    label: "text-chip-needs-fg",
    strong: "text-asphalt",
    tile: "bg-chip-needs-bg text-chip-needs-fg",
  },
  ok: {
    surface: "bg-tint-ok-bg inset-ring inset-ring-tint-ok-line",
    label: "text-chip-ok-fg",
    strong: "text-chip-ok-fg",
    tile: "bg-chip-ok-bg text-chip-ok-fg",
  },
  info: {
    surface: "bg-tint-info-bg inset-ring inset-ring-tint-info-line",
    label: "text-chip-info-fg",
    strong: "text-asphalt",
    tile: "bg-chip-info-bg text-chip-info-fg",
  },
  neutral: {
    surface: "bg-road-white inset-ring inset-ring-hairline",
    label: "text-ink-2",
    strong: "text-asphalt",
    tile: "bg-chip-muted-bg text-sign-green",
  },
};

/** Chip tone for a meaning tone ("neutral" reads as the muted chip). */
export function chipTone(t: Tone): ChipTone {
  return t === "neutral" ? "muted" : t;
}

/** 32 px rounded icon tile in a tone's chip colours. */
export function IconTile({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-[8px] [&_svg]:size-4",
        "transition-colors duration-[var(--dur-base)] ease-[var(--ease-standard)]",
        TINT[tone].tile,
      )}
    >
      {children}
    </span>
  );
}

/** A titled white card. It fills its grid row (equal heights); the footer is pinned to the
 *  bottom so footers in one row line up. */
export function Panel({
  title,
  icon,
  tone = "neutral",
  right,
  description,
  children,
  footer,
  className,
  testId,
}: {
  title: ReactNode;
  icon?: ReactNode;
  /** colours the icon tile only; the body stays white */
  tone?: Tone;
  right?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={cn(CARD, "flex h-full min-w-0 flex-col gap-4 p-6", className)} data-testid={testId}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-4">
          {icon && <IconTile tone={tone}>{icon}</IconTile>}
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 className="text-lg leading-8 font-black text-asphalt">{title}</h2>
            {description && <p className="text-sm text-ink-2">{description}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
      {footer && <div className="mt-auto flex flex-col gap-2 border-t border-divider pt-4">{footer}</div>}
    </section>
  );
}

/** One headline number on a tinted card: label, icon tile, value, one note line. */
export function Kpi({
  label,
  value,
  note,
  icon,
  tone = "neutral",
  compact = false,
  className,
  testId,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon?: ReactNode;
  tone?: Tone;
  /** five in a row (Impact): smaller value and padding so 1280 px still fits */
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const t = TINT[tone];
  return (
    <div
      className={cn(
        "flex h-full min-w-0 flex-col gap-1 rounded-[12px]",
        compact ? "p-4" : "p-5",
        "transition-[background-color,box-shadow] duration-[var(--dur-base)] ease-[var(--ease-standard)]",
        t.surface,
        className,
      )}
      data-testid={testId}
      data-tone={tone}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={cn("text-xs font-bold tracking-[0.06em] uppercase", t.label)}>{label}</span>
        {icon && <IconTile tone={tone}>{icon}</IconTile>}
      </div>
      <div className={cn("leading-tight font-black whitespace-nowrap", compact ? "text-[1.5rem]" : "text-3xl", t.strong)}>{value}</div>
      {note && <p className="text-sm text-ink-2">{note}</p>}
    </div>
  );
}

/** Rows inside a panel, divided by hairlines (no boxes inside boxes). */
export function Rows({ children, className, label, testId }: { children: ReactNode; className?: string; label?: string; testId?: string }) {
  return (
    <ul className={cn("flex flex-col divide-y divide-divider", className)} aria-label={label} data-testid={testId}>
      {children}
    </ul>
  );
}

/** One row. `tone` makes it the panel's one tinted highlight row. */
export function RowItem({
  children,
  tone,
  className,
  testId,
}: {
  children: ReactNode;
  tone?: Exclude<Tone, "neutral">;
  className?: string;
  testId?: string;
}) {
  return (
    <li
      data-testid={testId}
      className={cn(
        "flex min-w-0 items-start gap-4 py-3 transition-colors duration-[var(--dur-fast)]",
        tone ? cn("my-1 rounded-[8px] border-0 px-4", TINT[tone].surface) : "first:pt-0 last:pb-0",
        className,
      )}
    >
      {children}
    </li>
  );
}

/** A small note row inside a panel: a chip and one muted line (replaces the grey boxes). */
export function Note({
  chip,
  tone = "muted",
  icon,
  children,
  className,
  testId,
}: {
  chip?: string;
  tone?: ChipTone;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <p className={cn("flex items-start gap-2 text-sm text-ink-2", className)} data-testid={testId}>
      {icon && <span className="mt-0.5 shrink-0 [&_svg]:size-4">{icon}</span>}
      {chip && (
        <Chip tone={tone} className="shrink-0">
          {chip}
        </Chip>
      )}
      <span className="min-w-0">{children}</span>
    </p>
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
