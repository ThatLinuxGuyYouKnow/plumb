/**
 * Placement suggestions: deterministic, no randomness.
 * Ports the prototype's `nudgeFix` / `findSpot` onto the analytic checks.
 */
import { CATALOG, type ItemType } from './catalog.js';
import { aabb, doorGeometry, itemCorners, itemInDoorSwing, quadsOverlap, roomAt, wallPoint } from './geometry.js';
import type { Door, Item, Level, Room } from './schemas.js';

export interface ConflictSet {
  overlaps: Item[];
  swings: Door[];
  outside: boolean;
}

function wallById(level: Level, id: string) {
  return level.walls.find((w) => w.id === id);
}

function doorsOf(level: Level): Door[] {
  return level.openings.filter((o): o is Door => o.kind === 'door');
}

/** Conflicts for a candidate item pose. Rugs never conflict. */
export function conflictsOf(level: Level, candidate: Item): ConflictSet {
  if (candidate.type === 'rug') return { overlaps: [], swings: [], outside: false };
  const A = aabb(candidate);
  const overlaps = level.items.filter(
    (o) => o.id !== candidate.id && o.type !== 'rug' && quadsOverlapItems(candidate, o),
  );
  const swings = doorsOf(level).filter((d) => {
    const wall = wallById(level, d.wall);
    return wall ? itemInDoorSwing(candidate, d, wall) : false;
  });
  const room = roomAt(level.rooms, candidate.x, candidate.y);
  const outside = room
    ? A.x0 < room.rect.x - 5 || A.x1 > room.rect.x + room.rect.w + 5 || A.y0 < room.rect.y - 5 || A.y1 > room.rect.y + room.rect.h + 5
    : false;
  return { overlaps, swings, outside };
}

function quadsOverlapItems(a: Item, b: Item): boolean {
  return quadsOverlap(itemCorners(a), itemCorners(b));
}

export function hasConflict(c: ConflictSet): boolean {
  return c.overlaps.length > 0 || c.swings.length > 0 || c.outside;
}

/**
 * Search offsets of 100 mm up to 2000 mm in the order
 * east, west, south, north. First clear pose wins, else null.
 */
export function suggestNudge(item: Item, level: Level): { x: number; y: number } | null {
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const;
  for (let r = 100; r <= 2000; r += 100) {
    for (const [dx, dy] of dirs) {
      const candidate: Item = { ...item, x: item.x + dx * r, y: item.y + dy * r };
      if (!hasConflict(conflictsOf(level, candidate))) return { x: candidate.x, y: candidate.y };
    }
  }
  return null;
}

export interface Spot {
  x: number;
  y: number;
  rot: number;
}

export interface FindSpotResult {
  best: Spot | null;
  triedCount: number;
}

/**
 * Find a clear pose for `type` in `room`. Wall-backed types slide along
 * each wall with the back against it; free types scan a 100 mm grid with a
 * 300 mm margin. Wall-backed prefers farthest from the room's doors, free
 * prefers closest to the room centre.
 */
export function findSpot(room: Room, type: ItemType, level: Level): FindSpotResult {
  const entry = CATALOG[type];
  const doors = doorsOf(level)
    .map((d) => {
      const wall = wallById(level, d.wall);
      if (!wall) return null;
      const g = doorGeometry(d, wall);
      const near =
        g.H[0] >= room.rect.x - 300 &&
        g.H[0] <= room.rect.x + room.rect.w + 300 &&
        g.H[1] >= room.rect.y - 300 &&
        g.H[1] <= room.rect.y + room.rect.h + 300;
      if (!near) return null;
      return wallPoint(wall, d.at, 0);
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const rots = entry.wallBacked ? [0, 90, 180, 270] : [0, 90];
  const r = room.rect;
  let triedCount = 0;
  const candidates: Array<Spot & { score: number }> = [];

  for (const rot of rots) {
    const rotated = rot % 180 !== 0;
    const sw = rotated ? entry.d : entry.w;
    const sd = rotated ? entry.w : entry.d;
    const hx = sw / 2;
    const hy = sd / 2;
    const positions: Array<[number, number]> = [];
    if (entry.wallBacked) {
      if (rot === 0) for (let x = r.x + hx; x <= r.x + r.w - hx + 0.1; x += 100) positions.push([x, r.y + hy]);
      if (rot === 180)
        for (let x = r.x + hx; x <= r.x + r.w - hx + 0.1; x += 100) positions.push([x, r.y + r.h - hy]);
      if (rot === 90) for (let y = r.y + hy; y <= r.y + r.h - hy + 0.1; y += 100) positions.push([r.x + r.w - hx, y]);
      if (rot === 270) for (let y = r.y + hy; y <= r.y + r.h - hy + 0.1; y += 100) positions.push([r.x + hx, y]);
    } else {
      for (let x = r.x + hx + 300; x <= r.x + r.w - hx - 300 + 0.1; x += 100) {
        for (let y = r.y + hy + 300; y <= r.y + r.h - hy - 300 + 0.1; y += 100) {
          positions.push([x, y]);
        }
      }
    }
    for (const [x, y] of positions) {
      triedCount += 1;
      const candidate: Item = { id: '__candidate__', type, label: entry.label, x, y, w: entry.w, d: entry.d, rot };
      if (hasConflict(conflictsOf(level, candidate))) continue;
      const score = entry.wallBacked
        ? -Math.min(9999, ...doors.map((p) => Math.hypot(p[0] - x, p[1] - y)))
        : Math.hypot(x - (r.x + r.w / 2), y - (r.y + r.h / 2));
      candidates.push({ x, y, rot, score });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0];
  return { best: best ? { x: best.x, y: best.y, rot: best.rot } : null, triedCount };
}
