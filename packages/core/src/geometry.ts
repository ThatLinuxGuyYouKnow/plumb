/**
 * Pure geometry. Y-down world, clockwise degrees. Conventions per SPEC §4:
 * wall frame u = a→b unit, n = (-u.y, u.x); item back is local -y.
 */
import type { Door, Item, Room, Vec, Wall } from './schemas.js';

/** Edges closer than this count as touching, not overlapping. */
export const TOUCH_TOLERANCE_MM = 0.5;

const TAU = Math.PI * 2;
const EPS = 1e-9;

export interface WallFrame {
  /** Length a→b in mm. */
  length: number;
  /** Unit vector a→b. */
  u: Vec;
  /** Unit normal (-u.y, u.x). */
  n: Vec;
}

export function wallFrame(wall: Pick<Wall, 'a' | 'b'>): WallFrame {
  const dx = wall.b[0] - wall.a[0];
  const dy = wall.b[1] - wall.a[1];
  const length = Math.hypot(dx, dy);
  if (!(length > 0)) return { length: 0, u: [1, 0], n: [0, 1] };
  const u: Vec = [dx / length, dy / length];
  return { length, u, n: [-u[1], u[0]] };
}

/** Point at distance `s` along the wall from `a`, offset `o` along the normal. */
export function wallPoint(wall: Pick<Wall, 'a' | 'b'>, s: number, o: number): Vec {
  const { u, n } = wallFrame(wall);
  return [wall.a[0] + u[0] * s + n[0] * o, wall.a[1] + u[1] * s + n[1] * o];
}

/** Opening span along its wall: [at - width/2, at + width/2]. */
export function openingSpan(opening: { at: number; width: number }): readonly [number, number] {
  return [opening.at - opening.width / 2, opening.at + opening.width / 2];
}

export interface DoorGeometry {
  /** Hinge point on the wall centreline. */
  H: Vec;
  /** Unit vector from the hinge toward the other end of the opening. */
  uDir: Vec;
  /** Unit swing vector (n * swing); the leaf runs H → H + sv * width. */
  sv: Vec;
  /** Leaf tip H + sv * width. */
  tip: Vec;
  /** Far end of the opening H + uDir * width. */
  end: Vec;
}

export function doorGeometry(door: Door, wall: Wall): DoorGeometry {
  const { u, n } = wallFrame(wall);
  const sH = door.hinge === 'a' ? door.at - door.width / 2 : door.at + door.width / 2;
  const dirSign = door.hinge === 'a' ? 1 : -1;
  const uDir: Vec = [u[0] * dirSign, u[1] * dirSign];
  const sv: Vec = [n[0] * door.swing, n[1] * door.swing];
  const H = wallPoint(wall, sH, 0);
  return {
    H,
    uDir,
    sv,
    tip: [H[0] + sv[0] * door.width, H[1] + sv[1] * door.width],
    end: [H[0] + uDir[0] * door.width, H[1] + uDir[1] * door.width],
  };
}

// ---------------------------------------------------------------------------
// Oriented boxes
// ---------------------------------------------------------------------------

export interface Obb {
  cx: number;
  cy: number;
  hx: number;
  hy: number;
  /** Local x axis in world (unit). */
  ux: number;
  uy: number;
  /** Local y axis in world (unit). */
  vx: number;
  vy: number;
}

export function obb(item: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot'>): Obb {
  const rad = (item.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { cx: item.x, cy: item.y, hx: item.w / 2, hy: item.d / 2, ux: cos, uy: sin, vx: -sin, vy: cos };
}

export type Point = readonly [number, number];

export function obbCorners(b: Obb): [Point, Point, Point, Point] {
  const { cx, cy, hx, hy, ux, uy, vx, vy } = b;
  return [
    [cx + ux * hx + vx * hy, cy + uy * hx + vy * hy],
    [cx - ux * hx + vx * hy, cy - uy * hx + vy * hy],
    [cx - ux * hx - vx * hy, cy - uy * hx - vy * hy],
    [cx + ux * hx - vx * hy, cy + uy * hx - vy * hy],
  ];
}

export function itemCorners(item: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot'>): [Point, Point, Point, Point] {
  return obbCorners(obb(item));
}

export interface Aabb {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function aabb(item: Pick<Item, 'w' | 'd' | 'rot' | 'x' | 'y'>): Aabb {
  const rad = (item.rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const hw = (item.w * c + item.d * s) / 2;
  const hd = (item.w * s + item.d * c) / 2;
  return { x0: item.x - hw, x1: item.x + hw, y0: item.y - hd, y1: item.y + hd };
}

/** True when point `p` lies inside the item (plus `pad` mm on each side). Boundary counts. */
export function pointInItem(p: Point, item: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot'>, pad = 0): boolean {
  const rad = (item.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p[0] - item.x;
  const dy = p[1] - item.y;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  return Math.abs(lx) <= item.w / 2 + pad && Math.abs(ly) <= item.d / 2 + pad;
}

export function roomAt(rooms: readonly Room[], x: number, y: number): Room | undefined {
  return rooms.find((r) => x >= r.rect.x && x <= r.rect.x + r.rect.w && y >= r.rect.y && y <= r.rect.y + r.rect.h);
}

// ---------------------------------------------------------------------------
// SAT overlap (touching within 0.5 mm does not overlap)
// ---------------------------------------------------------------------------

function project(corners: readonly Point[], ax: number, ay: number): readonly [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, y] of corners) {
    const t = x * ax + y * ay;
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  return [lo, hi];
}

/** SAT overlap test for two convex quads. Touching (≤ tolerance) is not overlap. */
export function quadsOverlap(
  a: readonly [Point, Point, Point, Point],
  b: readonly [Point, Point, Point, Point],
  tolerance = TOUCH_TOLERANCE_MM,
): boolean {
  const quads = [a, b];
  for (const q of quads) {
    for (let i = 0; i < 4; i++) {
      const p = q[i];
      const n = q[(i + 1) % 4];
      if (!p || !n) continue;
      const ex = n[0] - p[0];
      const ey = n[1] - p[1];
      const len = Math.hypot(ex, ey);
      if (!(len > 0)) continue;
      const ax = -ey / len;
      const ay = ex / len;
      const [a0, a1] = project(a, ax, ay);
      const [b0, b1] = project(b, ax, ay);
      if (Math.min(a1, b1) - Math.max(a0, b0) <= tolerance) return false;
    }
  }
  return true;
}

/** Overlap between two items using SAT on oriented boxes. */
export function itemsOverlap(
  a: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot'>,
  b: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot'>,
): boolean {
  return quadsOverlap(itemCorners(a), itemCorners(b));
}

// ---------------------------------------------------------------------------
// Door swing: item OBB vs quarter-disc sector (analytic)
// ---------------------------------------------------------------------------

function dot(ax: number, ay: number, bx: number, by: number): number {
  return ax * bx + ay * by;
}

/** Circle-vs-OBB: does the disc (centre, radius) touch the item box? Boundary counts. */
export function circleOverlapsItem(
  centre: Point,
  radius: number,
  item: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot'>,
): boolean {
  const rad = (item.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = centre[0] - item.x;
  const dy = centre[1] - item.y;
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  const qx = Math.max(-item.w / 2, Math.min(item.w / 2, lx));
  const qy = Math.max(-item.d / 2, Math.min(item.d / 2, ly));
  return Math.hypot(lx - qx, ly - qy) <= radius + EPS;
}

function pointInSector(p: Point, g: DoorGeometry, width: number): boolean {
  const vx = p[0] - g.H[0];
  const vy = p[1] - g.H[1];
  if (Math.hypot(vx, vy) > width + EPS) return false;
  return dot(vx, vy, g.uDir[0], g.uDir[1]) >= -EPS && dot(vx, vy, g.sv[0], g.sv[1]) >= -EPS;
}

/** Segment-vs-OBB via the slab test in the item's local frame. */
export function segmentIntersectsItem(
  p1: Point,
  p2: Point,
  item: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot'>,
): boolean {
  const rad = (item.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const toLocal = (p: Point): Point => {
    const dx = p[0] - item.x;
    const dy = p[1] - item.y;
    return [dx * cos + dy * sin, -dx * sin + dy * cos];
  };
  const [ax, ay] = toLocal(p1);
  const [bx, by] = toLocal(p2);
  const hx = item.w / 2;
  const hy = item.d / 2;
  // Trivial accept: an endpoint inside.
  if (Math.abs(ax) <= hx && Math.abs(ay) <= hy) return true;
  if (Math.abs(bx) <= hx && Math.abs(by) <= hy) return true;
  const dx = bx - ax;
  const dy = by - ay;
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < EPS) return q >= 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return (
    clip(-dx, ax + hx) && clip(dx, hx - ax) && clip(-dy, ay + hy) && clip(dy, hy - ay) && t0 <= t1
  );
}

/** Parameters t in [0,1] where segment p1→p2 meets the circle. */
function segmentCircleTs(p1: Point, p2: Point, c: Point, r: number): number[] {
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const fx = p1[0] - c[0];
  const fy = p1[1] - c[1];
  const a = dx * dx + dy * dy;
  if (!(a > 0)) return [];
  const b = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return [];
  if (disc === 0) {
    const t = -b / (2 * a);
    return t >= 0 && t <= 1 ? [t] : [];
  }
  const sq = Math.sqrt(disc);
  const out: number[] = [];
  for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
    if (t >= 0 && t <= 1) out.push(t);
  }
  return out;
}

/**
 * Analytic door-swing test: item OBB vs the quarter-disc sector
 * { P : |P-H| <= width, (P-H)·uDir >= 0, (P-H)·sv >= 0 }.
 * Boundary contact counts as a conflict (matches the prototype).
 */
export function itemInDoorSwing(
  item: Pick<Item, 'x' | 'y' | 'w' | 'd' | 'rot' | 'type'>,
  door: Door,
  wall: Wall,
): boolean {
  if (item.type === 'rug') return false;
  const width = door.width;
  const g = doorGeometry(door, wall);
  // 1. Broad phase: full disc vs box.
  if (!circleOverlapsItem(g.H, width, item)) return false;
  // 2. Hinge inside the item.
  if (pointInItem(g.H, item)) return true;
  // 3. Item centre inside the sector.
  if (pointInSector([item.x, item.y], g, width)) return true;
  const corners = itemCorners(item);
  // 4. Any corner inside the sector.
  for (const c of corners) if (pointInSector(c, g, width)) return true;
  // 5. Either radial edge of the sector crosses the item.
  const r1: Point = [g.H[0] + g.uDir[0] * width, g.H[1] + g.uDir[1] * width];
  const r2: Point = [g.H[0] + g.sv[0] * width, g.H[1] + g.sv[1] * width];
  if (segmentIntersectsItem(g.H, r1, item)) return true;
  if (segmentIntersectsItem(g.H, r2, item)) return true;
  // 6. Any item edge crosses the arc.
  for (let i = 0; i < 4; i++) {
    const p1 = corners[i];
    const p2 = corners[(i + 1) % 4];
    if (!p1 || !p2) continue;
    for (const t of segmentCircleTs(p1, p2, g.H, width)) {
      const q: Point = [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
      if (pointInSector(q, g, width)) return true;
    }
  }
  return false;
}

/** Centre of the opening on the wall centreline. */
export function openingCentre(opening: { at: number }, wall: Wall): Vec {
  return wallPoint(wall, opening.at, 0);
}

/** A point `dist` mm into the swing side of a door (used to name the door's room). */
export function doorRoomPoint(door: Door, wall: Wall, dist = 500): Vec {
  const g = doorGeometry(door, wall);
  const cx = g.H[0] + g.uDir[0] * (door.width / 2) + g.sv[0] * dist;
  const cy = g.H[1] + g.uDir[1] * (door.width / 2) + g.sv[1] * dist;
  return [cx, cy];
}

export function angleMod360(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

export { TAU };
