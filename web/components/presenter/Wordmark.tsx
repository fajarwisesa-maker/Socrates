/** SIAGA wordmark. "Siaga" = alert / ready in Bahasa Indonesia: a beacon with one ring. */
export function Wordmark() {
  return (
    <div className="flex items-center gap-3" aria-label="SIAGA">
      <svg viewBox="0 0 32 32" className="size-9" aria-hidden>
        <rect width="32" height="32" rx="9" fill="var(--brand)" />
        <circle cx="16" cy="16" r="9" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="2.5" />
        <circle cx="16" cy="16" r="4" fill="white" />
      </svg>
      <span className="text-[1.75rem] leading-none font-bold tracking-[0.06em] text-ink">SIAGA</span>
    </div>
  );
}
