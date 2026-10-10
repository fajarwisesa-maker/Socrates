"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

// Which row of the disruption card each evidence field feeds.
const ROW: Record<string, string> = {
  is_disruption: "cause",
  cause: "cause",
  lane: "location",
  location: "location",
  delay: "delay",
  references: "references",
};

interface Link {
  d: string;
  x2: number;
  y2: number;
}

/**
 * Lines from each highlighted WhatsApp phrase to the field it produced (wow moment 1).
 * Positions are measured from the DOM inside `container`; drawn once, ~1.5 s.
 */
export function EvidenceLinks({ container, startDelay = 0.4 }: { container: React.RefObject<HTMLElement | null>; startDelay?: number }) {
  const reduce = useReducedMotion();
  const [links, setLinks] = useState<Link[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  // useEffect, not useLayoutEffect: the parent's ref is attached after a child's layout effect
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    function measure() {
      if (!root) return;
      const c = root.getBoundingClientRect();
      const bubble = root.querySelector('[data-testid="signal-whatsapp"]')?.getBoundingClientRect();
      const out: Link[] = [];
      root.querySelectorAll<HTMLElement>('[data-testid="signal-whatsapp"] mark[data-field]').forEach((m) => {
        const row = root.querySelector<HTMLElement>(`[data-field-row="${ROW[m.dataset.field ?? ""]}"]`);
        if (!row || !bubble) return;
        const rects = m.getClientRects();
        const r = rects[rects.length - 1] ?? m.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        const x1 = r.right - c.left;
        const y1 = r.top + r.height / 2 - c.top;
        const x2 = rr.left - c.left + 6;
        const y2 = rr.top + rr.height / 2 - c.top;
        const bx = bubble.right - c.left + 8;
        out.push({ d: `M${x1} ${y1} C ${bx} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`, x2, y2 });
      });
      setLinks(out);
      setSize({ w: c.width, h: c.height });
    }
    const raf = requestAnimationFrame(measure);
    const ro = new ResizeObserver(measure);
    ro.observe(root);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [container]);

  if (!links.length) return null;
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10"
      width={size.w}
      height={size.h}
      viewBox={`0 0 ${size.w} ${size.h}`}
      aria-hidden
      data-testid="evidence-links"
    >
      {links.map((l, i) => (
        <g key={i}>
          <motion.path
            d={l.d}
            fill="none"
            stroke="var(--brand)"
            strokeWidth={2}
            strokeOpacity={0.6}
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ delay: reduce ? 0 : startDelay + i * 0.22, duration: 0.45, ease: "easeOut" }}
          />
          <motion.circle
            cx={l.x2}
            cy={l.y2}
            r={4}
            fill="var(--brand)"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: reduce ? 0 : startDelay + i * 0.22 + 0.4 }}
          />
        </g>
      ))}
    </svg>
  );
}
