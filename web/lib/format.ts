// Formatting mirrors siaga_common (money.py, timeline.py) so the UI and CLI agree.

/** 11400000 -> "Rp 11.400.000" (Indonesian thousands separator). */
export function rupiah(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return "-";
  const sign = amount < 0 ? "-" : "";
  const digits = Math.round(Math.abs(amount)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${sign}Rp ${digits}`;
}

export function thousands(n: number | null | undefined): string {
  if (n === null || n === undefined) return "-";
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

const WIB = "Asia/Jakarta";

function wibParts(d: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: WIB,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { y: get("year"), m: get("month"), d: get("day"), hh: get("hour"), mm: get("minute"), wd: get("weekday") };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Day 2 18:00 · Sat 31 Oct WIB", relative to day 0 (midnight WIB). */
export function dayLabel(day0Iso: string | null | undefined, iso: string | null | undefined): string {
  if (!iso) return "-";
  const t = wibParts(new Date(iso));
  const local = `${Number(t.d)} ${MONTHS[Number(t.m) - 1]}`;
  if (!day0Iso) return `${t.wd} ${local} ${t.hh}:${t.mm} WIB`;
  const z = wibParts(new Date(day0Iso));
  const days = Math.round(
    (Date.UTC(+t.y, +t.m - 1, +t.d) - Date.UTC(+z.y, +z.m - 1, +z.d)) / 86_400_000,
  );
  return `Day ${days} ${t.hh}:${t.mm} · ${t.wd} ${local} WIB`;
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = (s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}
