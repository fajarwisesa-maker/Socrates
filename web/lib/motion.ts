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
