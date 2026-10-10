// Style tile for the SIAGA visual system (redesign step 2). Not linked from the dashboard.
import { Check, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Wordmark } from "@/components/presenter/Wordmark";

const TOKENS: [string, string, string][] = [
  ["canvas", "#f4f5f3", "page background (off-white, less glare)"],
  ["surface", "#ffffff", "cards"],
  ["surface-2", "#eceeeb", "filled areas instead of hairlines"],
  ["line", "#cbd2d9", "2px borders only"],
  ["ink", "#0f172a", "text"],
  ["ink-2", "#475569", "secondary text (never lighter)"],
  ["brand", "#0f766e", "SIAGA: progress, current stage, primary action"],
  ["risk", "#dc2626", "money at risk, rejected (fills / big numbers)"],
  ["risk-ink", "#b91c1c", "risk text"],
  ["human", "#d97706", "waiting for a human (fills)"],
  ["human-ink", "#92400e", "human text"],
  ["ok", "#16a34a", "resolved / executed (fills)"],
  ["ok-ink", "#166534", "resolved text"],
];

function lum(hex: string) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
function contrast(a: string, b: string) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

export default function DesignPage() {
  return (
    <main className="mx-auto max-w-6xl space-y-10 p-10 text-ink">
      <div className="flex items-center justify-between">
        <Wordmark />
        <span className="text-lg text-ink-2">Visual system · redesign step 2</span>
      </div>

      <section>
        <h2 className="mb-4 text-2xl font-bold">Colour tokens · contrast on white / on canvas</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {TOKENS.map(([name, hex, use]) => (
            <div key={name} className="flex items-center gap-4 rounded-2xl bg-surface p-3 shadow-[var(--shadow-card)]">
              <span className="size-14 shrink-0 rounded-xl border-2 border-line" style={{ background: hex }} />
              <div className="text-sm">
                <div className="font-mono font-semibold">
                  {name} {hex}
                </div>
                <div className="text-ink-2">{use}</div>
                <div className="font-mono text-ink-2">
                  {contrast(hex, "#ffffff").toFixed(1)}:1 · {contrast(hex, "#f4f5f3").toFixed(1)}:1
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-base text-ink-2">
          Status colours carry meaning only: red = money at risk / rejected, amber = waiting for a human,
          green = resolved / executed. Text uses the *-ink shades (≥ 4.5:1); the base hues are for fills,
          icons and numbers ≥ 24px bold (≥ 3:1).
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold">Type · Geist, tabular figures (Presenter sizes at 1280×720)</h2>
        <div className="space-y-3 rounded-2xl bg-surface p-6 shadow-[var(--shadow-card)]">
          <div className="text-[4rem] leading-none font-semibold tracking-tight text-risk-ink">Rp 340 jt</div>
          <div className="text-sm text-ink-2">Hero number · 64px semibold</div>
          <div className="text-[2.75rem] leading-none font-semibold">Rp 11,4 jt</div>
          <div className="text-sm text-ink-2">Meter number · 44px</div>
          <div className="text-[2.5rem] leading-tight font-bold tracking-tight">Critic rejected the cheapest plan</div>
          <div className="text-sm text-ink-2">Stage title · 40px bold</div>
          <div className="text-xl">Bandung DC would drop to 50 cartons, below its safety stock of 400.</div>
          <div className="text-sm text-ink-2">Body · 20px (minimum for Presenter content)</div>
          <div className="text-xl italic" lang="id">
            “Bos, lalin Pantura <mark className="rounded bg-human-soft px-1 not-italic text-human-ink">macet total</mark> dr subuh…”
          </div>
          <div className="text-sm text-ink-2">Original Bahasa kept, italic; highlights use the tinted surface</div>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-bold">Controls · 8px grid · radius 12 (controls) / 16 (cards)</h2>
        <div className="flex flex-wrap items-center gap-4 rounded-2xl bg-surface p-6 shadow-[var(--shadow-card)]">
          <Button size="xl">Start case</Button>
          <Button size="xl" variant="approve">
            <Check /> Approve
          </Button>
          <Button size="lg" variant="danger">
            Reject
          </Button>
          <Button size="lg" variant="outline">
            Details <Kbd>D</Kbd>
          </Button>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-risk-soft px-3 py-1 text-lg font-semibold text-risk-ink">
            <RotateCcw className="size-5" /> 1 replan
          </span>
          <span className="rounded-full bg-human-soft px-3 py-1 text-lg font-semibold text-human-ink">Needs you</span>
          <span className="rounded-full bg-ok-soft px-3 py-1 text-lg font-semibold text-ok-ink">Executed</span>
        </div>
      </section>
    </main>
  );
}
