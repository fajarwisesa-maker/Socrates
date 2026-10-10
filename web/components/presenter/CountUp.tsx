"use client";

import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

/**
 * A number that counts up from `start` when it first appears, then from its previous value
 * to each new one. Instant with reduced motion.
 */
export function CountUp({
  value,
  format,
  duration = 0.9,
  start = 0,
}: {
  value: number;
  format: (n: number) => string;
  duration?: number;
  start?: number;
}) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(reduce ? value : start);
  const from = useRef(reduce ? value : start);
  useEffect(() => {
    if (reduce || from.current === value) {
      from.current = value;
      setShown(value);
      return;
    }
    const controls = animate(from.current, value, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setShown(v),
      onComplete: () => setShown(value),
    });
    from.current = value;
    return () => controls.stop();
  }, [value, reduce, duration]);
  return <>{format(shown)}</>;
}
