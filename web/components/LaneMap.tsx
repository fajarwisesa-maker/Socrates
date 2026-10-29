"use client";

// Schematic lane map in the Jalan Tol style (docs/redesign-prompt.md 5). Roads and markers
// are inline SVG; every word is an HTML plate positioned over it, so the type follows the
// scale (and Presenter's rem scaling) and stays measurable by the projector check. No map
// tiles, no library, no network. Built from lib/laneModel.ts.
import { Check, Truck } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
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

// filled plates; white ones carry the grey hairline. Colours change over 400 ms when a
// route's state changes (the map stays mounted and morphs).
const TONE: Record<PlateTone, string> = {
  green: "bg-sign-green text-white",
  white: "bg-road-white text-asphalt inset-ring inset-ring-hairline",
  yellow: "bg-signal-yellow text-asphalt",
  red: "bg-stop-red text-white",
  asphalt: "bg-asphalt text-white",
};

function pos(x: number, y: number): CSSProperties {
  return { left: `${(x / MAP_W) * 100}%`, top: `${(y / MAP_H) * 100}%` };
}

function PlateBox({ plate, size }: { plate: Plate; size: "sm" | "md" }) {
  return (
    <span
      data-testid={plate.testId}
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] px-2 py-0.5 leading-tight font-black tracking-[0.05em] whitespace-nowrap uppercase",
        "transition-[background-color,color,box-shadow] duration-[400ms] ease-[var(--ease-standard)]",
        size === "sm" ? "text-xs" : "text-sm",
        TONE[plate.tone],
        // on Verify the routes turn first, then the DC's coverage plate
        plate.testId === "map-coverage" && "delay-[400ms]",
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

/** Paint per road state: the base stroke (the part that draws in) and an overlay. */
const PAINT: Record<RoadState, { base: string; width: number; opacity?: number; overlay?: { stroke: string; width: number; dash?: string } }> = {
  blocked: { base: "var(--stop-red)", width: 15, overlay: { stroke: "url(#siaga-hatch)", width: 10 } },
  faded: { base: "var(--stop-red)", width: 15, opacity: 0.35, overlay: { stroke: "url(#siaga-hatch)", width: 10 } },
  candidate: { base: "#8d8f8b", width: 8 },
  pending: { base: "var(--asphalt)", width: 13, overlay: { stroke: "var(--signal-yellow)", width: 8, dash: "14 8" } },
  failed: { base: "var(--stop-red)", width: 13, overlay: { stroke: "#fff", width: 4, dash: "10 8" } },
  rejected: { base: "var(--stop-red)", width: 13, overlay: { stroke: "#fff", width: 7 } },
  chosen: { base: "var(--sign-green)", width: 13, overlay: { stroke: "#fff", width: 2, dash: "10 8" } },
  verified: { base: "var(--sign-green)", width: 13, overlay: { stroke: "#fff", width: 2, dash: "10 8" } },
};
const EXECUTED: RoadState[] = ["chosen", "verified"];

/**
 * One road. It draws in from its first point (the source) to its last (the DC) one frame
 * after it appears, and again when its action is executed (pending or candidate to
 * chosen). Other state changes transition its colours and opacity in place.
 */
function Road({ road, animate = true }: { road: MapRoad; animate?: boolean }) {
  const executed = EXECUTED.includes(road.state);
  const [was, setWas] = useState(executed);
  const [generation, setGeneration] = useState(0);
  if (was !== executed) {
    setWas(executed);
    if (executed) setGeneration((g) => g + 1);
  }
  return <DrawnRoad key={generation} road={road} animate={animate} />;
}

function DrawnRoad({ road, animate }: { road: MapRoad; animate: boolean }) {
  const [drawn, setDrawn] = useState(!animate);
  useEffect(() => {
    if (drawn) return;
    // two frames: the hidden state is painted first, so the transition has a start
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setDrawn(true));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
    };
  }, [drawn]);
  const d = path(road.points);
  const paint = PAINT[road.state];
  const common = { d, fill: "none", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <g
      data-road={road.id}
      data-state={road.state}
      style={{ opacity: paint.opacity ?? 1, transition: "opacity 400ms var(--ease-standard)" }}
    >
      <path
        {...common}
        pathLength={1}
        strokeWidth={paint.width}
        style={{
          stroke: paint.base,
          // dash 1, gap 1.1: at offset 1.05 the whole road (and both caps) sits in the gap
          strokeDasharray: "1 1.1",
          strokeDashoffset: drawn ? 0 : 1.05,
          transition: "stroke-dashoffset var(--dur-slow) var(--ease-out), stroke 400ms var(--ease-standard)",
        }}
      />
      {paint.overlay && (
        <path
          {...common}
          strokeWidth={paint.overlay.width}
          strokeLinecap={paint.overlay.dash || paint.overlay.stroke.startsWith("url") ? "butt" : "round"}
          strokeDasharray={paint.overlay.dash}
          style={{
            stroke: paint.overlay.stroke,
            opacity: drawn ? 1 : 0,
            transition: `opacity var(--dur-base) var(--ease-standard) ${animate ? "var(--dur-slow)" : "0ms"}, stroke 400ms var(--ease-standard)`,
          }}
        />
      )}
    </g>
  );
}

function LegendSwatch({ state }: { state: RoadState }) {
  return (
    <svg viewBox="0 0 32 12" className="h-3 w-8 shrink-0" aria-hidden>
      <Road road={{ id: state, state, text: "", points: [[4, 6], [28, 6]] }} animate={false} />
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
        // the hairline is an outline: it is painted over the map, never changes its size
        "shrink-0 overflow-x-auto overflow-y-hidden rounded-[12px] bg-sea outline outline-1 -outline-offset-1 outline-hairline",
        mini && "rounded-[8px]",
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
                strokeWidth={4}
                strokeDasharray={n.kind === "air" ? "4 3" : undefined}
                style={{
                  fill: tone === "yellow" ? "var(--signal-yellow)" : "#fff",
                  stroke: tone === "green" ? "var(--sign-green)" : tone === "white" ? "#8d8f8b" : "var(--asphalt)",
                  transition: "fill 400ms var(--ease-standard), stroke 400ms var(--ease-standard)",
                }}
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
          className="flex flex-wrap gap-x-4 gap-y-1 border-t border-hairline bg-road-white px-4 py-1 text-xs font-bold text-asphalt"
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
