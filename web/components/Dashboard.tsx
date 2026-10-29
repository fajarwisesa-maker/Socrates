"use client";

import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { setMode, useMode } from "@/lib/mode";
import { useReducedMotion } from "@/lib/motion";
import { useCase } from "@/lib/useCase";
import PlannerView from "./PlannerView";
import { ModeSwitch } from "./presenter/ModeSwitch";
import { PresenterView } from "./presenter/PresenterView";

export default function Dashboard() {
  const state = useCase();
  const mode = useMode();
  const reduce = useReducedMotion();

  useEffect(() => {
    // Presenter mode scales the root font size with the viewport (globals.css).
    document.documentElement.classList.toggle("presenter", mode === "presenter");
  }, [mode]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || t?.closest("input, textarea, [contenteditable]")) return;
      if (e.key === "p" || e.key === "P") setMode(mode === "presenter" ? "planner" : "presenter");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  const toggle = <ModeSwitch mode={mode} onChange={setMode} />;
  // With reduced motion (the OS setting, or ?motion=off) motion skips transforms, the CSS
  // ends every transition at once and components show their end state (lib/motion.ts).
  return (
    <MotionConfig reducedMotion={reduce ? "always" : "user"}>
      {mode === "presenter" ? (
        <PresenterView state={state} modeSwitch={toggle} />
      ) : (
        <PlannerView state={state} modeSwitch={toggle} />
      )}
    </MotionConfig>
  );
}
