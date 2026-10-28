// Sign tile of the "Jalan Tol" visual system (docs/redesign-prompt.md). Not linked from the dashboard.
import { Check } from "lucide-react";
import {
  AgentWritten,
  GantrySign,
  KmPost,
  LaneDivider,
  Logo,
  RoadLine,
  RouteShield,
  SolverLabel,
  StatusPlate,
  TierPlate,
  WarningPlate,
} from "@/components/signs";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

const TOKENS: [string, string, string][] = [
  ["concrete", "#edede8", "page background"],
  ["road-white", "#ffffff", "plates, tables, cards"],
  ["asphalt", "#1e2124", "header, text, sign borders"],
  ["asphalt-muted", "#36393e", "secondary text (brief #50545A, darkened for the washout check)"],
  ["curb", "#c9cac4", "dividers, table rules"],
  ["sign-green", "#005a33", "route, done, verified, primary action (brief #00653A, darkened)"],
  ["sign-green-tint", "#cfe6d9", "tints and rules on green signs"],
  ["signal-yellow", "#ffc20e", "needs you, approval, deadline (asphalt text and border)"],
  ["stop-red", "#b00d28", "blocked, rejected, reopened, at risk (brief #C8102E, darkened)"],
  ["brand-teal", "#0f766e", "logo, focus ring"],
  ["brand-teal-ink", "#0a4f4a", "Written by the agent labels"],
  ["sea", "#cfdde2", "lane map only"],
  ["land", "#e4e4dc", "lane map only"],
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
      <div className="flex items-center justify-between rounded-[12px] bg-asphalt px-6 py-4">
        <Logo />
        <span className="sign-label text-sm text-white">Jalan Tol · sign tile</span>
      </div>

      <section>
        <h2 className="mb-4 text-2xl font-black">Colour tokens · contrast on white / on concrete</h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {TOKENS.map(([name, hex, use]) => (
            <div key={name} className="flex items-center gap-4 rounded-[12px] bg-surface p-3 shadow-[var(--shadow-card)]">
              <span className="size-14 shrink-0 rounded-[8px] border-2 border-line" style={{ background: hex }} />
              <div className="text-sm">
                <div className="font-mono font-semibold">
                  {name} {hex}
                </div>
                <div className="text-ink-2">{use}</div>
                <div className="font-mono text-ink-2">
                  {contrast(hex, "#ffffff").toFixed(1)}:1 · {contrast(hex, "#edede8").toFixed(1)}:1
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-black">Type · Overpass and Overpass Mono · 12 / 14 / 16 / 20 / 30 / 44</h2>
        <div className="space-y-2 rounded-[12px] bg-surface p-6 shadow-[var(--shadow-card)]">
          <div className="text-4xl font-black text-stop-red">Rp 340 jt</div>
          <div className="text-2xl font-black">Assess: what the flood puts at risk</div>
          <div className="text-xl">Bandung DC would drop to 50 cartons, below its safety stock of 400.</div>
          <div className="text-base">Body copy stays sentence case.</div>
          <div className="sign-label text-sm">Sign label · uppercase, open tracking</div>
          <div className="font-mono text-xs">PO 4500018231 · 7 h 42 m · 3f9a1c2e</div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-2xl font-black">Signs</h2>
        <GantrySign>
          <div className="flex items-center gap-4">
            <RouteShield code="SMG-JKT" />
            <span className="text-2xl font-black">Flood near Brebes blocks the Pantura corridor</span>
          </div>
        </GantrySign>
        <div className="flex flex-wrap items-center gap-3">
          <WarningPlate size="sm">
            <span className="sign-label text-xs">Banjir · Brebes</span>
          </WarningPlate>
          <StatusPlate tone="needs" count={1}>Needs you</StatusPlate>
          <StatusPlate tone="done">Done automatically</StatusPlate>
          <StatusPlate tone="rejected">Rejected</StatusPlate>
          <StatusPlate tone="verified" icon={<Check className="size-3.5" strokeWidth={3} aria-hidden />}>
            Verified
          </StatusPlate>
          <StatusPlate tone="running">Running</StatusPlate>
          <StatusPlate tone="escalated">Escalated</StatusPlate>
        </div>
        <div className="flex items-end gap-6">
          {(["done", "current", "flagged", "pending"] as const).map((s, i) => (
            <div key={s} className="flex flex-col items-center gap-1">
              <KmPost n={i + 1} state={s} />
              <span className="text-xs text-ink-2">{s}</span>
            </div>
          ))}
          <RoadLine vertical className="h-16" />
          <RoadLine className="w-40" />
        </div>
        <LaneDivider label="Needs you" />
        <div className="grid gap-2">
          {[0, 1, 2, 3].map((t) => (
            <TierPlate key={t} tier={t} meaning="long" />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <AgentWritten />
          <SolverLabel />
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-2xl font-black">Controls</h2>
        <div className="flex flex-wrap items-center gap-4 rounded-[12px] bg-surface p-6 shadow-[var(--shadow-card)]">
          <Button size="xl">Start case</Button>
          <Button size="xl" variant="approve">
            <Check /> Approve purchase order
          </Button>
          <Button size="lg" variant="danger">
            Reject purchase order
          </Button>
          <Button size="lg" variant="outline">
            Details <Kbd>D</Kbd>
          </Button>
        </div>
      </section>
    </main>
  );
}
