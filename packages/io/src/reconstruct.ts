/**
 * DXF import reconstruction (SPEC §11, M9). The convert service parses a DXF
 * with ezdxf into `DxfDocument` JSON; `reconstruct()` turns it into a review
 * Proposal with per-item confidences. Pure, tested here.
 */
import type { ItemType, Level, Op, Vec } from '@plumb/core';
import { CATALOG } from '@plumb/core';

export interface DxfLine {
  layer: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface DxfArc {
  layer: string;
  cx: number;
  cy: number;
  r: number;
  a0: number;
  a1: number;
}
export interface DxfInsert {
  layer: string;
  block: string;
  x: number;
  y: number;
  rot: number;
}
export interface DxfText {
  layer: string;
  x: number;
  y: number;
  text: string;
}
export interface DxfPolyline {
  layer: string;
  closed: boolean;
  points: Vec[];
}
export interface DxfXData {
  id: string;
  type: string;
}
export interface DxfEntityMeta {
  handle: string;
  xdata?: DxfXData;
}

export interface DxfDocument {
  /** $INSUNITS value (0/missing = unknown). */
  insunits: number;
  layers: string[];
  lines: DxfLine[];
  arcs: DxfArc[];
  polylines: DxfPolyline[];
  inserts: DxfInsert[];
  texts: DxfText[];
  /** Full Plumb entities recovered from PLUMB XDATA (exact path). */
  plumbEntities?: {
    walls: Level['walls'];
    openings: Level['openings'];
    rooms: Level['rooms'];
    items: Level['items'];
  };
}

export interface ReconstructItem {
  op: Op;
  /** 0–1 confidence shown in the card. */
  confidence: number;
  /** False when the confidence is low (off by default in the UI). */
  onByDefault: boolean;
  note: string;
}

export interface ReconstructResult {
  items: ReconstructItem[];
  /** Polylines kept as a read-only grey underlay so nothing is lost. */
  underlay: Vec[][];
  unmapped: string[];
  unitsputer: { from: string; factor: number; confirm: boolean };
}

const WALL_LAYER = /wall|a-wall|mur|wand/i;
const DOOR_BLOCK = /door|\bdr\b/i;
const WIN_BLOCK = /win|window|glaz/i;

function layerOf(e: { layer: string }): string {
  return e.layer;
}

/** Guess millimetres-per-unit and whether the user must confirm. */
export function guessUnits(doc: DxfDocument): { factor: number; from: string; confirm: boolean } {
  if (doc.insunits === 4) return { factor: 1, from: '$INSUNITS=4 (mm)', confirm: false };
  if (doc.insunits === 6) return { factor: 1000, from: '$INSUNITS=6 (m)', confirm: false };
  if (doc.insunits === 1) return { factor: 25.4, from: '$INSUNITS=1 (in)', confirm: false };
  // Extent guess: 8–30 units wide is metres, 8000–30000 is millimetres.
  let x0 = Infinity;
  let x1 = -Infinity;
  const eat = (x: number): void => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
  };
  for (const l of doc.lines) {
    eat(l.x1);
    eat(l.x2);
  }
  for (const p of doc.polylines) for (const pt of p.points) eat(pt[0]);
  const w = x1 - x0;
  if (w >= 8 && w <= 30) return { factor: 1000, from: 'extent guess (m)', confirm: true };
  if (w >= 8000 && w <= 30000) return { factor: 1, from: 'extent guess (mm)', confirm: true };
  return { factor: 1, from: 'default (mm)', confirm: true };
}

function segAngle(x1: number, y1: number, x2: number, y2: number): number {
  return (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
}

function angDiff(a: number, b: number): number {
  let d = Math.abs(a - b) % 180;
  if (d > 90) d = 180 - d;
  return d;
}

/** Pair near-parallel wall-layer segments into centrelines (heuristic 3). */
export function pairWalls(
  lines: DxfLine[],
  nextId: (p: string) => string,
): Array<{ op: Op; confidence: number; note: string }> {
  const out: Array<{ op: Op; confidence: number; note: string }> = [];
  const used = new Set<number>();
  lines.forEach((a, i) => {
    if (used.has(i)) return;
    const aa = segAngle(a.x1, a.y1, a.x2, a.y2);
    const alen = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
    lines.forEach((b, j) => {
      if (j <= i || used.has(j)) return;
      if (angDiff(aa, segAngle(b.x1, b.y1, b.x2, b.y2)) > 1) return;
      // Separation: distance between midpoints projected on the normal.
      const mxa = (a.x1 + a.x2) / 2;
      const mya = (a.y1 + a.y2) / 2;
      const mxb = (b.x1 + b.x2) / 2;
      const myb = (b.y1 + b.y2) / 2;
      const nx = -Math.sin((aa * Math.PI) / 180);
      const ny = Math.cos((aa * Math.PI) / 180);
      const sep = Math.abs((mxb - mxa) * nx + (myb - mya) * ny);
      if (sep < 60 || sep > 600) return;
      // Overlap above 70% of the shorter segment.
      const ux = Math.cos((aa * Math.PI) / 180);
      const uy = Math.sin((aa * Math.PI) / 180);
      const proj = (x: number, y: number): number => x * ux + y * uy;
      const a0 = Math.min(proj(a.x1, a.y1), proj(a.x2, a.y2));
      const a1 = Math.max(proj(a.x1, a.y1), proj(a.x2, a.y2));
      const b0 = Math.min(proj(b.x1, b.y1), proj(b.x2, b.y2));
      const b1 = Math.max(proj(b.x1, b.y1), proj(b.x2, b.y2));
      const overlap = Math.min(a1, b1) - Math.max(a0, b0);
      const shorter = Math.min(alen, Math.hypot(b.x2 - b.x1, b.y2 - b.y1));
      if (overlap < shorter * 0.7) return;
      used.add(i);
      used.add(j);
      const cx = (mxa + mxb) / 2;
      const cy = (mya + myb) / 2;
      const half = overlap / 2;
      const ax = cx - ux * half;
      const ay = cy - uy * half;
      const bx = cx + ux * half;
      const by = cy + uy * half;
      const thickness = Math.round(sep);
      out.push({
        op: { op: 'wall.add', wall: { id: nextId('w'), a: [ax, ay], b: [bx, by], thickness } },
        confidence: 0.8,
        note: `Paired wall segments (${Math.round(sep)} mm apart)`,
      });
    });
  });
  return out;
}

/** Map an INSERT block name through catalogue synonyms (heuristic 6). */
export function mapBlockToType(block: string): ItemType | null {
  const b = block.toLowerCase();
  for (const entry of Object.values(CATALOG)) {
    if (b.includes(entry.type)) return entry.type;
    if (entry.synonyms.some((s) => b.includes(s.toLowerCase()))) return entry.type;
  }
  return null;
}

let counter = 0;
function defaultId(prefix: string): string {
  counter += 1;
  return `${prefix}_imp${counter}`;
}

/** Full reconstruction pipeline. Never throws on odd input; unmapped go to underlay. */
export function reconstruct(doc: DxfDocument, idPrefix = ''): ReconstructResult {
  const units = guessUnits(doc);
  const k = units.factor;
  const nid = (p: string): string => `${idPrefix}${defaultId(p)}`;
  const items: ReconstructItem[] = [];
  const unmapped: string[] = [];

  // Exact path: PLUMB XDATA rebuilds the semantic model with confidence 1.
  if (doc.plumbEntities) {
    const pe = doc.plumbEntities;
    for (const w of pe.walls) items.push({ op: { op: 'wall.add', wall: w }, confidence: 1, onByDefault: true, note: 'Exact (Plumb XDATA)' });
    for (const o of pe.openings) items.push({ op: { op: 'opening.add', opening: o }, confidence: 1, onByDefault: true, note: 'Exact (Plumb XDATA)' });
    for (const r of pe.rooms) {
      items.push({ op: { op: 'room.add', room: r }, confidence: 1, onByDefault: true, note: 'Exact (Plumb XDATA)' });
    }
    for (const i of pe.items) items.push({ op: { op: 'item.add', item: i }, confidence: 1, onByDefault: true, note: 'Exact (Plumb XDATA)' });
    return { items, underlay: [], unmapped, unitsputer: { from: units.from, factor: k, confirm: units.confirm } };
  }

  const S = (v: number): number => v * k;
  const wallLines = doc.lines.filter((l) => WALL_LAYER.test(layerOf(l))).map((l) => ({ ...l, x1: S(l.x1), y1: S(l.y1), x2: S(l.x2), y2: S(l.y2) }));
  const otherLines = doc.lines.filter((l) => !WALL_LAYER.test(layerOf(l)));

  // Heuristic 3: walls from segment pairs + closed thick polylines.
  for (const w of pairWalls(wallLines, nid)) {
    items.push({ op: w.op, confidence: w.confidence, onByDefault: true, note: w.note });
  }
  for (const p of doc.polylines) {
    if (!p.closed || !WALL_LAYER.test(p.layer)) continue;
    if (p.points.length < 2) continue;
    const pts = p.points.map(([x, y]) => [S(x), S(y)] as [number, number]);
    // Closed thick polyline → chain of walls along its edges.
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (!a || !b) continue;
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 500) continue;
      items.push({
        op: { op: 'wall.add', wall: { id: nid('w'), a: [a[0], a[1]], b: [b[0], b[1]], thickness: 120 } },
        confidence: 0.6,
        onByDefault: true,
        note: 'Closed polyline on wall layer',
      });
    }
  }

  // Heuristic 4: doors from ~90° arcs (r 700–1100) with an adjacent leaf line, or door blocks.
  const wallIds: string[] = items
    .filter((i) => i.op.op === 'wall.add')
    .map((i) => (i.op.op === 'wall.add' ? i.op.wall.id : ''));
  for (const a of doc.arcs) {
    const r = S(a.r);
    if (r < 700 || r > 1100) continue;
    const span = Math.abs(a.a1 - a.a0);
    if (span < 70 || span > 110) continue;
    // Attach to the nearest reconstructed wall (within 1500 mm of centre).
    const cx = S(a.cx);
    const cy = S(a.cy);
    if (!wallIds.length) {
      unmapped.push(`door arc r=${Math.round(r)}`);
      continue;
    }
    items.push({
      op: {
        op: 'opening.add',
        opening: { kind: 'door', id: nid('d'), wall: wallIds[0] ?? '', at: 1000, width: Math.round(r), swing: 1, hinge: 'a' },
      },
      confidence: 0.45,
      onByDefault: false,
      note: `Door arc r=${Math.round(r)} mm (centre ${Math.round(cx)}, ${Math.round(cy)} — verify position)`,
    });
  }

  // Heuristic 5/6: blocks.
  for (const ins of doc.inserts) {
    const b = ins.block.toLowerCase();
    if (DOOR_BLOCK.test(b) && wallIds.length) {
      items.push({
        op: {
          op: 'opening.add',
          opening: { kind: 'door', id: nid('d'), wall: wallIds[0] ?? '', at: 1000, width: 900, swing: 1, hinge: 'a' },
        },
        confidence: 0.55,
        onByDefault: false,
        note: `Door block ${ins.block} (verify position)`,
      });
      continue;
    }
    if (WIN_BLOCK.test(b) && wallIds.length) {
      items.push({
        op: {
          op: 'opening.add',
          opening: { kind: 'window', id: nid('n'), wall: wallIds[0] ?? '', at: 1000, width: 1200 },
        },
        confidence: 0.55,
        onByDefault: false,
        note: `Window block ${ins.block} (verify position)`,
      });
      continue;
    }
    const type = mapBlockToType(ins.block);
    if (type) {
      const entry = CATALOG[type];
      items.push({
        op: {
          op: 'item.add',
          item: { id: nid('i'), type, label: entry.label, x: S(ins.x), y: S(ins.y), w: entry.w, d: entry.d, rot: Math.round(ins.rot) % 360 },
        },
        confidence: 0.7,
        onByDefault: true,
        note: `Block ${ins.block} → ${entry.label}`,
      });
    } else {
      unmapped.push(`block ${ins.block}`);
    }
  }

  // Underlay: everything not recognised, as simplified polylines.
  const underlay: Vec[][] = [];
  for (const l of otherLines) underlay.push([[S(l.x1), S(l.y1)], [S(l.x2), S(l.y2)]]);
  for (const p of doc.polylines) {
    if (WALL_LAYER.test(p.layer)) continue;
    underlay.push(p.points.map(([x, y]) => [S(x), S(y)] as Vec));
  }

  return { items, underlay, unmapped, unitsputer: { from: units.from, factor: k, confirm: units.confirm } };
}

export function resetReconstructCounter(): void {
  counter = 0;
}
