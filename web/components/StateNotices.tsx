"use client";

import { AlertTriangle, RefreshCw, RotateCcw, ShieldAlert, UserRound } from "lucide-react";
import type { Notice } from "@/lib/notices";
import { cn } from "@/lib/utils";

const ICON = {
  retrying: RefreshCw,
  retried: RotateCcw,
  denied: ShieldAlert,
  budget: AlertTriangle,
  escalated: UserRound,
  reopened: AlertTriangle,
};

/** Retry / policy block / budget / hand-over notices. `size`: presenter (20px) or planner. */
export function StateNotices({ items, size = "presenter" }: { items: Notice[]; size?: "presenter" | "planner" }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-col gap-2" data-testid="state-notices">
      {items.map((n) => {
        const Icon = ICON[n.kind];
        return (
          <li
            key={`${n.kind}-${n.seq}`}
            data-testid={`notice-${n.kind}`}
            className={cn(
              "flex items-start gap-3 rounded-[var(--radius-control)]",
              size === "presenter" ? "px-4 py-3 text-xl" : "px-3 py-2 text-sm",
              n.tone === "risk" ? "bg-risk-soft text-risk-ink" : "bg-surface-2 text-ink-2",
            )}
          >
            <Icon
              className={cn(
                "mt-0.5 shrink-0",
                size === "presenter" ? "size-6" : "size-4",
                n.kind === "retrying" && "animate-spin motion-reduce:animate-none",
              )}
              aria-hidden
            />
            <span>
              <b className={n.tone === "risk" ? "text-risk-ink" : "text-ink"}>{n.title}</b>
              <span className="block">{n.detail}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
