import { cn } from "@/lib/utils";

/** A keyboard key hint, e.g. <Kbd>P</Kbd>. */
export function Kbd({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <kbd
      className={cn(
        "inline-flex min-w-[1.6em] items-center justify-center rounded-[4px] border-2 border-curb bg-road-white px-[0.35em] font-mono text-[0.8em] font-semibold text-ink-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
