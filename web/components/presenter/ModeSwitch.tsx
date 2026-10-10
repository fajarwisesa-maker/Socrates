"use client";

import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import type { Mode } from "@/lib/mode";

/** Small Presenter / Planner switch (also the P key). */
export function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-medium text-ink-2 select-none" data-testid="mode-switch">
      <span className={mode === "presenter" ? "text-ink" : undefined}>Presenter</span>
      <Switch
        checked={mode === "planner"}
        onCheckedChange={(on) => onChange(on ? "planner" : "presenter")}
        aria-label="Planner mode"
      />
      <span className={mode === "planner" ? "text-ink" : undefined}>Planner</span>
      <Kbd>P</Kbd>
    </label>
  );
}
