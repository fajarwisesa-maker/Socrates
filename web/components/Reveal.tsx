import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Content that rises in once when it mounts (opacity 0 to 1, 8px up; 10px in Presenter).
 * A re-render never replays it, so polling stays calm; a new `key` does. Buttons inside
 * are clickable from the first frame.
 */
export function Reveal({
  children,
  delay = 0,
  className,
  as: Tag = "div",
  kind = "rise",
  testId,
}: {
  children: ReactNode;
  /** ms before it starts (stagger 60 to 80 ms between related items) */
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section" | "span" | "p";
  kind?: "rise" | "fade-in";
  testId?: string;
}) {
  return (
    <Tag data-testid={testId} className={cn(kind, className)} style={{ "--delay": `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}
