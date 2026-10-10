// Schematic lane: origin ── ✕ blocked point ── destination, plus mitigation flows into the
// destination. Drawn in a 520-unit-wide SVG: 1 unit ≈ 1px at 1280×720, scaled above that.

export interface Flow {
  from: string;
  label: string;
  tone: "ok" | "human" | "plain";
}

const W = 520;
const TOP = 56;
const ROW = 76;

export function LaneMap({
  origin,
  blockedAt,
  dest,
  stuck,
  flows = [],
  cutoff,
  dimBlocked = false,
}: {
  origin: string;
  blockedAt: string | null;
  dest: string;
  stuck?: string;
  flows?: Flow[];
  cutoff?: string;
  dimBlocked?: boolean;
}) {
  const h = TOP + 64 + (stuck ? 36 : 0) + flows.length * ROW;
  const bx = 250;
  const dx = W - 30;
  const color = { ok: "var(--ok)", human: "var(--human)", plain: "var(--ink-2)" };
  const ink = { ok: "var(--ok-ink)", human: "var(--human-ink)", plain: "var(--ink-2)" };
  const firstFlowY = TOP + 64 + (stuck ? 36 : 0) + 22;

  return (
    <svg viewBox={`0 0 ${W} ${h}`} className="w-full" role="img" aria-label={`${origin} to ${dest}`}>
      <g opacity={dimBlocked ? 0.45 : 1}>
        <line x1={20} y1={TOP} x2={bx - 20} y2={TOP} stroke="var(--ink-2)" strokeWidth={4} strokeLinecap="round" />
        <line x1={bx + 20} y1={TOP} x2={dx - 26} y2={TOP} stroke="var(--risk)" strokeWidth={4} strokeDasharray="10 9" />
        <circle cx={14} cy={TOP} r={10} fill="var(--ink-2)" />
        <text x={0} y={TOP + 40} fontSize={20} fontWeight={600} fill="var(--ink)">
          {origin}
        </text>
        {blockedAt && (
          <>
            <circle cx={bx} cy={TOP} r={19} fill="var(--risk)" />
            <path
              d={`M${bx - 7} ${TOP - 7} L${bx + 7} ${TOP + 7} M${bx + 7} ${TOP - 7} L${bx - 7} ${TOP + 7}`}
              stroke="white"
              strokeWidth={4}
              strokeLinecap="round"
            />
            <text x={bx} y={TOP + 44} fontSize={20} fontWeight={600} fill="var(--risk-ink)" textAnchor="middle">
              {blockedAt}
            </text>
          </>
        )}
        {stuck && (
          <text x={bx} y={TOP + 76} fontSize={20} fill="var(--risk-ink)" textAnchor="middle">
            {stuck}
          </text>
        )}
      </g>
      {cutoff && (
        <text x={W} y={TOP - 32} fontSize={20} fill="var(--ink-2)" textAnchor="end">
          {cutoff}
        </text>
      )}
      <rect x={dx - 22} y={TOP - 22} width={44} height={44} rx={12} fill="var(--brand)" />
      <rect x={dx - 9} y={TOP - 9} width={18} height={18} rx={3} fill="white" />
      <text x={W} y={TOP + 44} fontSize={20} fontWeight={700} fill="var(--ink)" textAnchor="end">
        {dest}
      </text>
      {flows.map((f, i) => {
        const y = firstFlowY + i * ROW;
        return (
          <g key={i}>
            <circle cx={14} cy={y} r={9} fill={color[f.tone]} />
            <path
              d={`M28 ${y} H ${dx - 18} Q ${dx} ${y} ${dx} ${y - 18} V ${TOP + 66}`}
              fill="none"
              stroke={color[f.tone]}
              strokeWidth={4}
              strokeLinecap="round"
              strokeDasharray={f.tone === "human" ? "10 8" : undefined}
            />
            <path d={`M${dx - 8} ${TOP + 78} L${dx} ${TOP + 64} L${dx + 8} ${TOP + 78}`} fill="none" stroke={color[f.tone]} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
            <text x={36} y={y - 12} fontSize={20} fontWeight={600} fill="var(--ink)">
              {f.from}
            </text>
            <text x={36} y={y + 30} fontSize={20} fill={ink[f.tone]}>
              {f.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
