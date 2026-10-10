"use client";

import { useEffect, useState } from "react";

/** Date.now(), refreshed every `ms`; null during prerender (Cache Components). */
export function useNow(ms = 250): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
