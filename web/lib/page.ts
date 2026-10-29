"use client";

// Planner page (UI v3, the mockup's sidebar app) as a tiny external store synced to
// ?page=, so a link or a reload opens the same page. Mirrors lib/mode.ts.
import { useSyncExternalStore } from "react";

export const PAGES = [
  "overview",
  "signals",
  "impact",
  "options",
  "approvals",
  "verification",
  "audit",
  "architecture",
  "evaluation",
] as const;
export type Page = (typeof PAGES)[number];

const listeners = new Set<() => void>();
let current: Page | null | undefined;

function read(): Page | null {
  const q = new URLSearchParams(window.location.search).get("page");
  return (PAGES as readonly string[]).includes(q ?? "") ? (q as Page) : null;
}

export function setPage(p: Page) {
  current = p;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set("page", p);
    window.history.replaceState(null, "", url);
  } catch {}
  listeners.forEach((l) => l());
}

/** The page the planner picked, or null when none was picked yet (the caller chooses). */
export function usePickedPage(): Page | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (current === undefined ? (current = read()) : current),
    () => null,
  );
}
