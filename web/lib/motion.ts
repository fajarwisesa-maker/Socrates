"use client";

// Motion helpers (docs/polish-prompt.md 4 and 5). Motion explains a change and never
// blocks work: nothing waits for an animation, and with reduced motion everything shows its
// end state at once. `?motion=off` forces that for tests (html[data-motion="off"]).
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function forcedOff(): boolean {
  if (typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("motion") === "off") {
    document.documentElement.dataset.motion = "off";
  }
  return document.documentElement.dataset.motion === "off";
}

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

/** True when the OS asks for reduced motion, or `?motion=off` forces it. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => forcedOff() || window.matchMedia(QUERY).matches,
    () => false,
  );
}

/** Same as motion's `useReducedMotion`, but also honours the forced switch. */
export const useReducedMotion = usePrefersReducedMotion;

/** Numbers that already counted up on this page load (by id): they never count again. */
const counted = new Set<string>();

/**
 * Count a number up from 0 once, with requestAnimationFrame (ease-out, 900 ms after a short
 * delay). Display only: the last frame, and every frame after it, is exactly
 * `format(target)`; the interpolated value is never used for anything else. Returns null
 * while `target` is null (not revealed yet).
 */
export function useCountUp(
  target: number | null,
  format: (n: number) => string,
  { delay = 200, enabled = true, id, duration = 900 }: { delay?: number; enabled?: boolean; id?: string; duration?: number } = {},
): string | null {
  const reduce = usePrefersReducedMotion();
  const skip = !enabled || reduce || (!!id && counted.has(id));
  // the frame on screen; null = finished, the final value from now on
  const [frame, setFrame] = useState<number | null>(skip ? null : 0);
  const done = useRef(skip);

  useEffect(() => {
    if (done.current || skip || target === null) return;
    let raf = 0;
    let t0 = 0;
    const tick = (t: number) => {
      t0 ||= t;
      const p = Math.min(1, Math.max(0, (t - t0 - delay) / duration));
      if (p >= 1) {
        done.current = true;
        if (id) counted.add(id);
        setFrame(null);
        return;
      }
      setFrame(target * (1 - (1 - p) ** 3));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, skip, delay, duration, id]);

  if (target === null) return null;
  return skip || frame === null ? format(target) : format(frame);
}

/** False for the first `ms`, then true: a loading note shows only if loading takes longer. */
export function useDelayed(ms = 300): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return ready;
}

/**
 * A list on a poll: items that left stay for `ms` (marked `exiting`, at their old place) so
 * they can fade out; everything else renders as given. Unchanged items keep their keys, so
 * they never re-animate.
 */
export function useWithExits<T>(items: T[], key: (t: T) => string, ms = 200): { item: T; exiting: boolean }[] {
  const [prev, setPrev] = useState(items);
  const [gone, setGone] = useState<{ item: T; at: number }[]>([]);
  if (prev !== items) {
    const now = new Set(items.map(key));
    const left = prev.flatMap((p, at) => (now.has(key(p)) ? [] : [{ item: p, at }]));
    setPrev(items);
    if (left.length) setGone((g) => [...g.filter((x) => !now.has(key(x.item))), ...left]);
  }
  useEffect(() => {
    if (!gone.length) return;
    const t = setTimeout(() => setGone([]), ms);
    return () => clearTimeout(t);
  }, [gone, ms]);
  const out = items.map((item) => ({ item, exiting: false }));
  for (const g of gone) {
    if (items.some((i) => key(i) === key(g.item))) continue;
    out.splice(Math.min(g.at, out.length), 0, { item: g.item, exiting: true });
  }
  return out;
}
