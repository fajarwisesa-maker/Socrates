// Schematic lane map in the Jalan Tol style (docs/redesign-prompt.md 5). Roads and markers
// are inline SVG; every word is an HTML plate positioned over it, so the type follows the
// scale (and Presenter's rem scaling) and stays measurable by the projector check. No map
// tiles, no library, no network. Built from lib/laneModel.ts.
import { Check, Truck } from "lucide-react";
import type { CSSProperties } from "react";
import { COAST, MAP_H, MAP_W, type Anchor } from "@/lib/laneLayout";
import { LEGEND_TEXT, type LaneModel, type MapRoad, type Plate, type PlateTone, type RoadState } from "@/lib/laneModel";
import { cn } from "@/lib/utils";

const GAP = "0.375rem";
/** marker radius per node kind (map units): plates start just outside the marker */
const RADIUS = { dest: 19, disruption: 22, origin: 11, source: 10, air: 10 } as const;

/** Move the plate's anchor point to the edge of the marker in the anchor's direction. */
function edge(x: number, y: number, anchor: Anchor, r: number): [number, number] {
  const dy = anchor.startsWith("top") ? -r : anchor.startsWith("bottom") ? r : 0;
  const dx = anchor === "left" ? -r : anchor === "right" ? r : 0;
  return [x + dx, y + dy];
}
const ANCHOR: Record<Anchor, { transform: string; align: string }> = {
  bottom: { transform: `translate(-50%, ${GAP})`, align: "items-center" },
  top: { transform: `translate(-50%, calc(-100% - ${GAP}))`, align: "items-center" },
  left: { transform: `translate(calc(-100% - ${GAP}), -50%)`, align: "items-end" },
  right: { transform: `translate(${GAP}, -50%)`, align: "items-start" },
  "top-left": { transform: `translate(calc(-100% + 0.5rem), calc(-100% - ${GAP}))`, align: "items-end" },
  "top-right": { transform: `translate(-0.5rem, calc(-100% - ${GAP}))`, align: "items-start" },
  "bottom-left": { transform: `translate(calc(-100% + 0.5rem), ${GAP})`, align: "items-end" },
  "bottom-right": { transform: `translate(-0.5rem, ${GAP})`, align: "items-start" },
};

const TONE: Record<PlateTone, string> = {
  green: "bg-sign-green text-white border-white shadow-[0_0_0_2px_var(--sign-green)]",
  white: "bg-road-white text-asphalt border-asphalt",
  yellow: "bg-signal-yellow text-asphalt border-asphalt",
  red: "bg-stop-red text-white border-stop-red",
  asphalt: "bg-asphalt text-white border-asphalt",
};

function pos(x: number, y: number): CSSProperties {
  return { left: `${(x / MAP_W) * 100}%`, top: `${(y / MAP_H) * 100}%` };
}

function PlateBox({ plate, size }: { plate: Plate; size: "sm" | "md" }) {
  return (
    <span
      data-testid={plate.testId}
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] border-2 px-1.5 py-px leading-tight font-black tracking-[0.05em] whitespace-nowrap uppercase",
        size === "sm" ? "text-xs" : "text-sm",
        TONE[plate.tone],
      )}
    >
      {plate.icon === "truck" && <Truck className="size-[1.2em] shrink-0" aria-hidden />}
      {plate.icon === "check" && <Check className="size-[1.2em] shrink-0" strokeWidth={3} aria-hidden />}
      {plate.text}
    </span>
  );
}

function path(points: [number, number][]) {
  return points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");
}

function Road({ road }: { road: MapRoad }) {
  const d = path(road.points);
  const common = { d, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (road.state) {
    case "blocked":
    case "faded":
      return (
        <g opacity={road.state === "faded" ? 0.35 : 1}>
          <path {...common} stroke="var(--stop-red)" strokeWidth={15} />
          <path {...common} stroke="url(#siaga-hatch)" strokeWidth={10} strokeLinecap="butt" />
        </g>
      );
    case "candidate":
      return <path {...common} stroke="#8d8f8b" strokeWidth={8} />;
    case "pending":
      return (
        <g>
          <path {...common} stroke="var(--asphalt)" strokeWidth={13} />
          <path {...common} stroke="var(--signal-yellow)" strokeWidth={8} strokeDasharray="14 8" strokeLinecap="butt" />
        </g>
      );
    case "rejected":
      return (
        <g>
          <path {...common} stroke="var(--stop-red)" strokeWidth={13} />
          <path {...common} stroke="#fff" strokeWidth={7} />
        </g>
      );
    default: // chosen, verified
      return (
        <g>
          <path {...common} stroke="var(--sign-green)" strokeWidth={13} />
          <path {...common} stroke="#fff" strokeWidth={2} strokeDasharray="10 8" strokeLinecap="butt" />
        </g>
      );
  }
}

function LegendSwatch({ state }: { state: RoadState }) {
  return (
    <svg viewBox="0 0 32 12" className="h-3 w-8 shrink-0" aria-hidden>
      <Road road={{ id: state, state, text: "", points: [[4, 6], [28, 6]] }} />
    </svg>
  );
}

export function LaneMap({
  model,
  variant = "full",
  size = "md",
  className,
  testId = "lane-map",
}: {
  model: LaneModel;
  variant?: "full" | "mini";
  /** plate type size: "sm" (12px) where the map is narrow, e.g. the Presenter canvas */
  size?: "sm" | "md";
  className?: string;
  testId?: string;
}) {
  const mini = variant === "mini";
  return (
    <figure
      data-testid={testId}
      className={cn(
        "shrink-0 overflow-x-auto overflow-y-hidden rounded-[12px] border-[3px] border-asphalt bg-sea",
        mini && "rounded-[8px] border-2",
        className,
      )}
      aria-label={model.title}
    >
      <div className="relative max-md:min-w-[640px]" style={{ aspectRatio: `${MAP_W} / ${MAP_H}` }}>
        <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} className="absolute inset-0 size-full" aria-hidden>
          <defs>
            <pattern id="siaga-hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="10" height="10" fill="#fff" />
              <rect width="5" height="10" fill="var(--stop-red)" />
            </pattern>
          </defs>
          <path d={COAST} fill="var(--land)" />
          {model.roads.map((r) => (
            <Road key={r.id} road={r} />
          ))}
          {model.nodes.map((n) => {
            if (n.kind === "dest")
              return (
                <polygon
                  key={n.key}
                  points={`${n.x},${n.y - 17} ${n.x + 17},${n.y} ${n.x},${n.y + 17} ${n.x - 17},${n.y}`}
                  fill="#fff"
                  stroke="var(--asphalt)"
                  strokeWidth={5}
                  strokeLinejoin="round"
                />
              );
            if (n.kind === "disruption")
              return (
                <g key={n.key}>
                  <polygon
                    points={`${n.x},${n.y - 20} ${n.x + 20},${n.y} ${n.x},${n.y + 20} ${n.x - 20},${n.y}`}
                    fill="var(--signal-yellow)"
                    stroke="var(--asphalt)"
                    strokeWidth={3}
                    strokeLinejoin="round"
                  />
                  <rect x={n.x - 2.25} y={n.y - 10} width={4.5} height={11} rx={1.5} fill="var(--asphalt)" />
                  <circle cx={n.x} cy={n.y + 6} r={2.4} fill="var(--asphalt)" />
                </g>
              );
            if (n.kind === "origin")
              return (
                <g key={n.key}>
                  <circle cx={n.x} cy={n.y} r={10} fill="#fff" stroke="var(--asphalt)" strokeWidth={3} />
                  <circle cx={n.x} cy={n.y} r={5} fill="var(--asphalt)" />
                </g>
              );
            const tone = n.plates[0]?.tone;
            return (
              <circle
                key={n.key}
                cx={n.x}
                cy={n.y}
                r={8}
                fill={tone === "yellow" ? "var(--signal-yellow)" : "#fff"}
                stroke={tone === "green" ? "var(--sign-green)" : tone === "white" ? "#8d8f8b" : "var(--asphalt)"}
                strokeWidth={4}
                strokeDasharray={n.kind === "air" ? "4 3" : undefined}
              />
            );
          })}
        </svg>

        {!mini && (
          <>
            <span className="absolute top-[5%] right-[5%] text-sm font-bold tracking-[0.4em] text-asphalt-muted uppercase">
              Laut Jawa
            </span>
            {model.nodes.map((n) => (
              <div
                key={n.key}
                className={cn("absolute flex flex-col gap-1", ANCHOR[n.anchor].align)}
                style={{ ...pos(...edge(n.x, n.y, n.anchor, RADIUS[n.kind])), transform: ANCHOR[n.anchor].transform }}
                data-node={n.key}
              >
                {n.plates.map((p, i) => (
                  <PlateBox key={i} plate={p} size={size} />
                ))}
              </div>
            ))}
            {model.badges.map((b, i) => (
              <div
                key={i}
                className={cn("absolute flex flex-col gap-1", ANCHOR[b.anchor].align)}
                style={{ ...pos(b.x, b.y), transform: ANCHOR[b.anchor].transform }}
              >
                {b.plates.map((p, j) => (
                  <PlateBox key={j} plate={p} size={size} />
                ))}
              </div>
            ))}
          </>
        )}
      </div>
      {!mini && model.legend.length > 0 && (
        <ul
          className="flex flex-wrap gap-x-4 gap-y-0.5 border-t-2 border-asphalt bg-road-white px-2 py-1 text-xs font-bold text-asphalt"
          aria-label="Legend"
          data-testid="map-legend"
        >
          {model.legend.map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <LegendSwatch state={s} />
              {LEGEND_TEXT[s]}
            </li>
          ))}
        </ul>
      )}
      {/* the same roads in words, for screen readers */}
      <figcaption className="sr-only">
        <ul>
          {model.roads.map((r) => (
            <li key={r.id}>{r.text}</li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}
