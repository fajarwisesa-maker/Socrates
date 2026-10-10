import type { Evidence } from "@/lib/types";

/**
 * Signal text with the evidence spans that code located in it. Only located spans are
 * highlighted (offsets come from the backend). `window` > 0 shows just the sentences
 * around each span, joined with "…".
 */
export function Highlighted({ text, spans, window = 0 }: { text: string; spans: Evidence[]; window?: number }) {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const pieces: React.ReactNode[] = [];
  const ranges = window > 0 ? excerptRanges(text, sorted, window) : [[0, text.length] as [number, number]];
  ranges.forEach(([from, to], r) => {
    if (window > 0 && from > 0) pieces.push(<span key={`pre${r}`}>…</span>);
    let pos = from;
    for (const s of sorted) {
      if (s.start < from || s.end > to || s.start < pos) continue;
      pieces.push(<span key={`t${r}-${s.start}`}>{text.slice(pos, s.start)}</span>);
      pieces.push(
        <mark
          key={`m${r}-${s.start}`}
          data-field={s.field}
          data-evidence={`${s.signal}:${s.start}`}
          className="rounded-md bg-brand-soft px-0.5 text-brand-ink not-italic font-semibold [box-decoration-break:clone]"
        >
          {text.slice(s.start, s.end)}
        </mark>,
      );
      pos = s.end;
    }
    pieces.push(<span key={`end${r}`}>{text.slice(pos, to)}</span>);
    if (window > 0 && to < text.length) pieces.push(<span key={`post${r}`}>… </span>);
  });
  return <>{pieces}</>;
}

/** Ranges of +-window chars around each span, snapped to word boundaries and merged. */
function excerptRanges(text: string, spans: Evidence[], window: number): [number, number][] {
  const out: [number, number][] = [];
  for (const s of spans) {
    let a = Math.max(0, s.start - window);
    let b = Math.min(text.length, s.end + window);
    while (a > 0 && !/\s/.test(text[a - 1])) a--;
    while (b < text.length && !/\s/.test(text[b])) b++;
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}
