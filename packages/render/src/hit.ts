/** Hit testing in the §7 priority order: items, openings, walls, rugs, rooms. */
import { pointInItem, wallFrame, type Wall } from '@plumb/core';
import type { Level } from '@plumb/core';
import type { Selection, ViewState } from './types.js';

export function wallCoords(
  wall: Pick<Wall, 'a' | 'b'>,
  p: readonly [number, number]
): { s: number; o: number; L: number } {
  const { u, n, length } = wallFrame(wall);
  const rx = p[0] - wall.a[0];
  const ry = p[1] - wall.a[1];
  return { s: rx * u[0] + ry * u[1], o: rx * n[0] + ry * n[1], L: length };
}

export function nearestWall(
  level: Level,
  p: readonly [number, number],
  tolPx: number,
  view: ViewState
): { wallId: string; s: number; o: number } | null {
  let best: { wallId: string; s: number; o: number; dist: number } | null = null;
  const tol = tolPx / view.s;
  for (const w of level.walls) {
    const c = wallCoords(w, p);
    if (c.s < -w.thickness / 2 || c.s > c.L + w.thickness / 2) continue;
    const dist = Math.abs(c.o);
    if (dist <= w.thickness / 2 + tol && (best === null || dist < best.dist)) {
      best = { wallId: w.id, s: c.s, o: c.o, dist };
    }
  }
  return best ? { wallId: best.wallId, s: best.s, o: best.o } : null;
}

/** Hit test a world point. Priority: items (top-most, no rugs) → openings → walls → rugs → rooms. */
export function hitTest(level: Level, p: readonly [number, number], view: ViewState): Selection | null {
  const tol = 3 / view.s;
  for (let i = level.items.length - 1; i >= 0; i--) {
    const it = level.items[i];
    if (it && it.type !== 'rug' && pointInItem(p, it, tol)) return { type: 'item', id: it.id };
  }
  for (const o of level.openings) {
    const wall = level.walls.find((w) => w.id === o.wall);
    if (!wall) continue;
    const c = wallCoords(wall, p);
    if (c.s >= o.at - o.width / 2 && c.s <= o.at + o.width / 2 && Math.abs(c.o) <= wall.thickness / 2 + tol) {
      return { type: o.kind, id: o.id };
    }
  }
  const nw = nearestWall(level, p, 4, view);
  if (nw) return { type: 'wall', id: nw.wallId };
  for (let i = level.items.length - 1; i >= 0; i--) {
    const it = level.items[i];
    if (it && it.type === 'rug' && pointInItem(p, it, 0)) return { type: 'item', id: it.id };
  }
  const room = level.rooms.find(
    (r) => p[0] >= r.rect.x && p[0] <= r.rect.x + r.rect.w && p[1] >= r.rect.y && p[1] <= r.rect.y + r.rect.h
  );
  return room ? { type: 'room', id: room.id } : null;
}
