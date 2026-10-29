// Lane-map layout: where each place sits on the schematic of Java's north coast. These are
// layout, not business data: SAP has no coordinates. Keys are location codes from the case
// (plants, suppliers) plus a few places matched in the disruption text. Positions keep the
// rough west-to-east order of the coast; anything unknown gets an automatic slot instead of
// failing. Units: a 640 x 300 box (sea on top).

export const MAP_W = 640;
export const MAP_H = 300;

export type Anchor = "top" | "bottom" | "left" | "right" | "top-left" | "top-right" | "bottom-left" | "bottom-right";

export interface Place {
  x: number;
  y: number;
  /** where the name plate sits relative to the marker */
  label: Anchor;
  /** where the status plates sit: their own anchor, or next to the name ("row") or under it
   *  ("stack", the default) */
  status?: Anchor | "row" | "stack";
  /** nudges in map units, so no plate sits on a road or a node */
  dx?: number;
  dy?: number;
  sdx?: number;
  sdy?: number;
  /** words that identify this place in free text (the disruption location) */
  match?: string[];
  /** name for a place matched in text */
  name?: string;
}

export const LAYOUT: Record<string, Place> = {
  // suppliers and plants (codes from SAP)
  // name above, status below (the road leaves to the right)
  "V-2002": { x: 44, y: 150, label: "top-right", status: "bottom-right" }, // PT Agro Pangan Tangerang
  // below-right, between the blocked road and Bandung's label and clear of the Bandung road
  // that leaves downwards (below-left has no room: Tangerang's status and the map's edge)
  "DC-CKR": { x: 250, y: 158, label: "bottom-right", dx: 20, dy: 3 }, // Cikarang DC (destination in the demo)
  "DC-BDG": { x: 230, y: 266, label: "right", status: "row", dy: 5 }, // Bandung DC (inland, not on Pantura)
  // above the node, kept inside the map's right edge
  "V-1001": { x: 585, y: 92, label: "top-left" }, // PT Sumber Pangan Semarang
  "DC-SMG": { x: 585, y: 92, label: "top-left" },
  // air charter: flies in over the sea; its label runs right, clear of its own road
  AIR: { x: 150, y: 30, label: "right", status: "row", dx: 8 },
  // places matched in the disruption location text: the sign's label sits above it, left of
  // Semarang's
  BREBES: { x: 430, y: 104, label: "top-left", match: ["brebes", "tegal"], name: "Brebes" },
  CIKAMPEK: { x: 290, y: 140, label: "bottom", match: ["cikampek"], name: "Cikampek" },
  PRIOK: { x: 190, y: 92, label: "top", match: ["priok", "tanjung priok"], name: "Tanjung Priok" },
};

/** The coastline: land below this path, sea above. */
export const COAST =
  "M0 72 C 60 64, 110 82, 170 76 S 260 60, 320 74 S 430 88, 480 70 S 580 56, 640 66 L 640 300 L 0 300 Z";

/** Position of a code, or an automatic slot (left to right along the bottom) if unknown. */
export function place(code: string, fallbackIndex: number): Place {
  return LAYOUT[code] ?? { x: 70 + ((fallbackIndex * 130) % 500), y: 268, label: "top", status: "row" };
}

/** A place named in free text (e.g. "Jalur Pantura, Brebes-Tegal"), if the layout knows it. */
export function placeInText(text: string | null | undefined): { key: string; place: Place } | null {
  const t = (text ?? "").toLowerCase();
  for (const [key, p] of Object.entries(LAYOUT)) {
    if (p.match?.some((w) => t.includes(w))) return { key, place: p };
  }
  return null;
}
