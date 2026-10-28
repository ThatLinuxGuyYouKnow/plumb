/**
 * Room-label layout: put each label in the emptiest spot of its room
 * (SPEC §7). Pure; cached on a key of item poses and room names/floors
 * until the store can supply a dirty flag (see DECISIONS.md).
 */
import type { Level, Room, Vec } from '@plumb/core';

const LABEL_W_MM = 1500;
const LABEL_H_MM = 620;
const SCAN_STEP_MM = 150;

function layoutKey(level: Level): string {
  return (
    level.items.map((i) => `${i.x},${i.y},${i.rot},${i.w},${i.d}`).join('|') +
    '#' +
    level.rooms.map((r) => `${r.id}:${r.name}:${r.floor}:${r.rect.w}x${r.rect.h}`).join('|')
  );
}

let cacheKey = '';
let cachePos: Record<string, Vec> = {};

interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Position for every room's label: the emptiest spot, then nearest centre. */
export function layoutRoomLabels(level: Level): Record<string, Vec> {
  const key = layoutKey(level);
  if (key === cacheKey) return cachePos;
  const boxes: Box[] = level.items
    .filter((i) => i.type !== 'rug')
    .map((i) => {
      const a = Math.abs((i.rot * Math.PI) / 180);
      const c = Math.abs(Math.cos(a));
      const s = Math.abs(Math.sin(a));
      const hw = (i.w * c + i.d * s) / 2;
      const hd = (i.w * s + i.d * c) / 2;
      return { x0: i.x - hw, x1: i.x + hw, y0: i.y - hd, y1: i.y + hd };
    });
  const pos: Record<string, Vec> = {};
  for (const room of level.rooms) {
    pos[room.id] = bestSpot(room, boxes);
  }
  cacheKey = key;
  cachePos = pos;
  return pos;
}

function bestSpot(room: Room, boxes: Box[]): Vec {
  const r = room.rect;
  const lw = LABEL_W_MM;
  const lh = LABEL_H_MM;
  let best: { x: number; y: number; score: number } | null = null;
  for (let x = r.x + lw / 2 + SCAN_STEP_MM; x <= r.x + r.w - lw / 2 - SCAN_STEP_MM + 0.1; x += SCAN_STEP_MM) {
    for (let y = r.y + lh / 2 + SCAN_STEP_MM; y <= r.y + r.h - lh / 2 - SCAN_STEP_MM + 0.1; y += SCAN_STEP_MM) {
      const B = { x0: x - lw / 2, x1: x + lw / 2, y0: y - lh / 2, y1: y + lh / 2 };
      let overlapArea = 0;
      for (const b of boxes) {
        const ox = Math.min(B.x1, b.x1) - Math.max(B.x0, b.x0);
        const oy = Math.min(B.y1, b.y1) - Math.max(B.y0, b.y0);
        if (ox > 0 && oy > 0) overlapArea += ox * oy;
      }
      const dc = Math.hypot(x - (r.x + r.w / 2), y - (r.y + r.h / 2));
      const score = overlapArea * 1000 + dc;
      if (best === null || score < best.score) best = { x, y, score };
    }
  }
  return best ? [best.x, best.y] : [r.x + r.w / 2, r.y + r.h / 2];
}
