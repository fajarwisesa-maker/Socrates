"use client";

import { useCountUp } from "@/lib/motion";
import { Figure } from "../Figure";

/**
 * A number that counts up from 0 once when it appears (display only), ending on exactly
 * `format(value)`. Instant with reduced motion. The final string reserves the width.
 */
export function CountUp({ value, format, duration = 0.9 }: { value: number; format: (n: number) => string; duration?: number }) {
  const shown = useCountUp(value, format, { duration: duration * 1000, delay: 150 });
  return <Figure shown={shown ?? format(value)} final={format(value)} />;
}
