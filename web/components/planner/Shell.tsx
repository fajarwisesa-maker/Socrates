"use client";

// UI v3 shell (the owner's mockup): a sidebar with the eight pages of a case's journey,
// a top bar with the case and its status, and the engine card. Counts and labels come from
// the case and /config; nothing here is invented.
import {
  ClipboardCheck,
  Boxes,
  FlaskConical,
  History,
  LayoutGrid,
  MessageSquareText,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  Check,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { caseTitle, countdown, laneCode, shortId } from "@/lib/caseView";
import type { Page } from "@/lib/page";
import { sapModelNote } from "@/lib/present";
import type { Approval, CaseEvent, CaseRecord, Config } from "@/lib/types";
import type { AuditData } from "@/lib/useInbox";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";
import { Logo, RouteShield } from "../signs";
import { Chip, type ChipTone } from "./ui";

/** "Model: Claude via SAP AI Core" etc., from the case's own events, else /config. */
export function modelNote(config: Config | null, events: CaseEvent[]): string | null {
  const sap = sapModelNote(events);
  if (sap) return sap;
  if (!config) return null;
  if (config.replay) return null; // the REPLAY badge says it
  if (config.llm_provider === "sap_genai") return "Model: Claude via SAP AI Core";
  if (config.llm_provider === "fake") return "Model: scripted (fake), offline";
  return `Model: ${config.llm_provider}`;
}

export const NAV: { id: Page; label: string; icon: LucideIcon; group?: string }[] = [
  { id: "overview", label: "Overview", icon: LayoutGrid },
  { id: "signals", label: "Signals", icon: MessageSquareText },
  { id: "impact", label: "Impact", icon: Network },
  { id: "options", label: "Response options", icon: SlidersHorizontal },
  { id: "approvals", label: "Approvals", icon: ShieldCheck },
  { id: "verification", label: "Verification", icon: ClipboardCheck },
  { id: "audit", label: "Audit trail", icon: History },
  { id: "architecture", label: "Architecture", icon: Boxes, group: "System" },
  { id: "evaluation", label: "Evaluation", icon: FlaskConical },
];

export function Sidebar({
  page,
  onPage,
  counts,
  config,
  events,
}: {
  page: Page;
  onPage: (p: Page) => void;
  counts: Partial<Record<Page, { n: number; tone: ChipTone; label: string }>>;
  config: Config | null;
  events: CaseEvent[];
}) {
  const note = modelNote(config, events);
  return (
    // the white column runs the full page height; its content sticks to the viewport
    <div className="w-60 shrink-0 bg-road-white shadow-[inset_-1px_0_0_var(--hairline)]">
    <aside className="sticky top-0 flex h-screen flex-col" data-testid="sidebar">
      <div className="flex h-16 shrink-0 items-center gap-2 bg-sign-green px-6">
        <Logo height={24} />
        <span className="text-[0.625rem] leading-tight font-bold tracking-[0.12em] text-sign-green-tint uppercase">
          Supply
          <br />
          intelligence
        </span>
      </div>
      <nav aria-label="Pages" className="flex flex-1 flex-col gap-1 overflow-y-auto px-4 py-6">
        <span className="px-2 pb-2 text-xs font-bold tracking-[0.1em] text-ink-2 uppercase">Case journey</span>
        {NAV.map(({ id, label, icon: Icon, group }) => {
          const c = counts[id];
          const active = page === id;
          return [
            group && (
              <span key={group} className="px-2 pt-4 pb-2 text-xs font-bold tracking-[0.1em] text-ink-2 uppercase">
                {group}
              </span>
            ),
            <button
              key={id}
              onClick={() => onPage(id)}
              data-testid={`nav-${id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-[8px] px-2 text-left text-sm font-bold",
                "transition-[background-color,color] duration-[var(--dur-fast)] ease-[var(--ease-standard)]",
                active ? "bg-sign-green text-white" : "text-asphalt hover:bg-surface-2",
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden />
              <span className="flex-1">{label}</span>
              {c && c.n > 0 && (
                <Chip tone={active ? "muted" : c.tone} testId={`nav-count-${id}`}>
                  {c.n} {c.label}
                </Chip>
              )}
            </button>,
          ];
        })}
      </nav>
      <div className="m-4 flex flex-col gap-1 rounded-[12px] bg-surface-2 p-4 text-xs" data-testid="engine-card">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold tracking-[0.08em] text-ink-2 uppercase">Engine</span>
          {config && (
            <Chip tone={config.replay ? "info" : config.llm_provider === "fake" ? "needs" : "ok"}>
              {config.replay ? "Replay" : config.llm_provider === "fake" ? "Scripted" : "Live"}
            </Chip>
          )}
        </div>
        {config?.replay && (
          <span data-testid="replay-badge" className="font-bold text-asphalt">
            REPLAY · recorded run{config.replay_source ? ` (${config.replay_source.provider})` : ""}
          </span>
        )}
        {note && (
          <span data-testid="model-note" className="font-bold text-asphalt">
            {note}
          </span>
        )}
        {config?.orchestration === "multi" && <span className="text-ink-2">Multi-agent (5 specialists)</span>}
        <span className="text-ink-2">Solver: PuLP / CBC · policy: Cedar</span>
      </div>
    </aside>
    </div>
  );
}

export const STATUS_CHIP: Record<string, { tone: ChipTone; text: string }> = {
  AWAITING_APPROVAL: { tone: "needs", text: "Needs you" },
  RESOLVED: { tone: "ok", text: "Resolved" },
  REOPENED: { tone: "risk", text: "Reopened" },
  ESCALATED: { tone: "risk", text: "Escalated" },
  VERIFYING: { tone: "info", text: "Verifying" },
};

/** The case status as one chip whose colour changes in place. */
export function CaseStatus({ record, approvals }: { record: CaseRecord; approvals: Approval[] }) {
  const now = useNow(1000);
  const next = approvals
    .filter((a) => a.status === "PENDING" && a.card.approve_by)
    .map((a) => a.card.approve_by!)
    .sort()[0];
  const left = countdown(next, now);
  const replanning = record.status === "RUNNING" && approvals.some((a) => a.status === "REJECTED");
  const s = STATUS_CHIP[record.status] ?? { tone: "info" as const, text: replanning ? "Replanning" : "Running" };
  return (
    <span data-testid="case-status" data-status={record.status}>
      <Chip
        tone={s.tone}
        className="px-4 py-1 text-sm"
        icon={record.status === "RESOLVED" ? <Check aria-hidden strokeWidth={3} /> : undefined}
      >
        {s.text}
        {record.status === "AWAITING_APPROVAL" && left ? ` · ${left.expired ? "expired" : `${left.text} left`}` : ""}
      </Chip>
    </span>
  );
}

export function TopBar({
  record,
  approvals,
  audit,
  modeSwitch,
}: {
  record: CaseRecord | null;
  approvals: Approval[];
  audit: AuditData | null;
  modeSwitch: React.ReactNode;
}) {
  const v = audit?.verification;
  const lane = record ? laneCode(record) : null;
  return (
    <header
      className="sticky top-0 z-30 flex min-h-16 flex-wrap items-center gap-x-6 gap-y-2 bg-road-white px-8 py-2 shadow-[inset_0_-1px_0_var(--hairline)]"
      data-testid="planner-header"
    >
      {record ? (
        <div className="flex min-w-0 flex-1 items-center gap-4">
          {lane && <RouteShield code={lane} />}
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-base font-black" data-testid="case-title" title={caseTitle(record)}>
              {caseTitle(record)}
            </span>
            <span className="font-mono text-xs text-ink-2">
              Case {shortId(record.case_id)}
              {record.disruption?.references[0] ? ` · PO ${record.disruption.references[0]}` : ""}
            </span>
          </div>
          <CaseStatus record={record} approvals={approvals} />
        </div>
      ) : (
        <span className="flex-1 text-base font-bold text-ink-2">No case open</span>
      )}
      <div className="flex items-center gap-4">
        {v && (
          <span
            data-testid="header-audit"
            className={cn("inline-flex items-center gap-1 text-xs font-bold", v.ok ? "text-brand-ink" : "text-chip-risk-fg")}
          >
            {v.ok ? <Check className="size-4" strokeWidth={3} aria-hidden /> : <TriangleAlert className="size-4" aria-hidden />}
            {v.ok ? "Audit chain OK" : "Audit chain broken"}
          </span>
        )}
        {modeSwitch}
      </div>
    </header>
  );
}
