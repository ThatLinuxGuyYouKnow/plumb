/** Room-centre label positions without a DOM dependency (SVG export). */
import type { Level } from '@plumb/core';

export function layoutRoomLabelsShim(level: Level): Record<string, { x: number; y: number }> {
  const out: Record<string, { x: number; y: number }> = {};
  for (const r of level.rooms) {
    out[r.id] = { x: r.rect.x + r.rect.w / 2, y: r.rect.y + r.rect.h / 2 };
  }
  return out;
}
