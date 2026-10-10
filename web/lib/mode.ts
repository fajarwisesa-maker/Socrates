"use client";

// Presenter / Planner mode as a tiny external store: the server renders Presenter, the
// browser switches to ?mode= or the last choice without a hydration mismatch.
import { useSyncExternalStore } from "react";

export type Mode = "presenter" | "planner";
const KEY = "siaga.mode";
const listeners = new Set<() => void>();
let current: Mode | null = null;

function read(): Mode {
  const q = new URLSearchParams(window.location.search).get("mode");
  if (q === "planner" || q === "presenter") return q;
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved === "planner" || saved === "presenter") return saved;
  } catch {}
  return "presenter";
}

export function setMode(m: Mode) {
  current = m;
  try {
    window.localStorage.setItem(KEY, m);
  } catch {}
  listeners.forEach((l) => l());
}

export function useMode(): Mode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (current ??= read()),
    () => "presenter",
  );
}
