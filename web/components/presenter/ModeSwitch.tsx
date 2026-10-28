"use client";

import type { Mode } from "@/lib/mode";
import { cn } from "@/lib/utils";

/** PLANNER | PRESENTER switch for the asphalt header (also the P key). */
export function ModeSwitch({
  mode,
  onChange,
  tone = "dark",
}: {
  mode: Mode;
  onChange: (m: Mode) => void;
  /** dark: on the asphalt header; light: on concrete */
  tone?: "dark" | "light";
}) {
  const dark = tone === "dark";
  return (
    <div
      role="radiogroup"
      aria-label="Mode (P)"
      data-testid="mode-switch"
      className={cn(
        "inline-flex shrink-0 overflow-hidden rounded-[6px] border-2 text-xs font-black tracking-[0.08em] uppercase",
        dark ? "border-white" : "border-asphalt",
      )}
    >
      {(["planner", "presenter"] as const).map((m) => (
        <button
          key={m}
          role="radio"
          aria-checked={mode === m}
          onClick={() => onChange(m)}
          className={cn(
            "min-h-9 px-3 uppercase",
            dark
              ? mode === m ? "bg-white text-asphalt" : "text-white hover:bg-white/15"
              : mode === m ? "bg-asphalt text-white" : "text-asphalt hover:bg-surface-2",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}
