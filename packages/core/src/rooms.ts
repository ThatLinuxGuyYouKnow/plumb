/**
 * Room detection from the wall graph (M8, SPEC sect 4 note + sect 11 heuristic 7).
 * v1 scope: orthogonal plans. Free-space flood fill on a 100 mm grid finds the
 * bounded faces of the wall graph; user names/finishes carry over by overlap,
 * and open-plan areas that share one face keep their authored rects.
 */
import type { Level, Room, Vec } from './schemas.js';

const CELL = 100;
const PAD = 1000;

function distToSeg(p: Vec, a: Vec, b: Vec): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlapArea(a: Rect, b: Rect): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
}

/** Bounded free-space faces of the wall graph, as rects. */
export function detectFaces(level: Level): Rect[] {
  if (level.walls.length === 0) return [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const w of level.walls) {
    for (const p of [w.a, w.b]) {
      x0 = Math.min(x0, p[0]);
      x1 = Math.max(x1, p[0]);
      y0 = Math.min(y0, p[1]);
      y1 = Math.max(y1, p[1]);
    }
  }
  x0 -= PAD;
  y0 -= PAD;
  x1 += PAD;
  y1 += PAD;
  const cols = Math.max(1, Math.ceil((x1 - x0) / CELL));
  const rows = Math.max(1, Math.ceil((y1 - y0) / CELL));
  const solid = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = x0 + (c + 0.5) * CELL;
      const py = y0 + (r + 0.5) * CELL;
      for (const w of level.walls) {
        if (distToSeg([px, py], w.a, w.b) < w.thickness / 2 + 1) {
          solid[r * cols + c] = 1;
          break;
        }
      }
    }
  }
  // Outside: flood fill from the border over non-solid cells.
  const outside = new Uint8Array(cols * rows);
  const stack: Array<[number, number]> = [];
  for (let c = 0; c < cols; c++) {
    stack.push([c, 0], [c, rows - 1]);
  }
  for (let r = 0; r < rows; r++) {
    stack.push([0, r], [cols - 1, r]);
  }
  while (stack.length) {
    const [c, r] = stack.pop() as [number, number];
    if (c < 0 || r < 0 || c >= cols || r >= rows) continue;
    const i = r * cols + c;
    if (solid[i] === 1 || outside[i] === 1) continue;
    outside[i] = 1;
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  // Remaining components are rooms.
  const seen = new Uint8Array(cols * rows);
  const faces: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (solid[i] === 1 || outside[i] === 1 || seen[i] === 1) continue;
      let c0 = c;
      let c1 = c;
      let r0 = r;
      let r1 = r;
      const q: Array<[number, number]> = [[c, r]];
      seen[i] = 1;
      while (q.length) {
        const [cc, rr] = q.pop() as [number, number];
        c0 = Math.min(c0, cc);
        c1 = Math.max(c1, cc);
        r0 = Math.min(r0, rr);
        r1 = Math.max(r1, rr);
        const nb: Array<[number, number]> = [
          [cc + 1, rr],
          [cc - 1, rr],
          [cc, rr + 1],
          [cc, rr - 1],
        ];
        for (const [nc, nr] of nb) {
          if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
          const ni = nr * cols + nc;
          if (solid[ni] === 1 || outside[ni] === 1 || seen[ni] === 1) continue;
          seen[ni] = 1;
          q.push([nc, nr]);
        }
      }
      faces.push({ x: x0 + c0 * CELL, y: y0 + r0 * CELL, w: (c1 - c0 + 1) * CELL, h: (r1 - r0 + 1) * CELL });
    }
  }
  return faces;
}

let autoCounter = 0;

/**
 * Full detection: faces from the walls, names/finishes from the authored
 * rooms by max overlap. Faces shared by several authored rooms (open plan)
 * keep the authored rects so nothing the user named is lost.
 */
export function detectRooms(level: Level): Room[] {
  const faces = detectFaces(level);
  if (faces.length === 0) return level.rooms.map((r) => ({ ...r }));
  const out: Room[] = [];
  const used = new Set<number>();
  for (const room of level.rooms) {
    let best = -1;
    let bestArea = 0;
    faces.forEach((f, i) => {
      const a = overlapArea(room.rect, f);
      if (a > bestArea) {
        bestArea = a;
        best = i;
      }
    });
    if (best < 0 || bestArea <= 0) {
      out.push({ ...room });
      continue;
    }
    used.add(best);
    const face = faces[best] as Rect;
    // How much of the face does this room cover? If several rooms share the
    // face (open plan), keep the authored rect.
    const sharers = level.rooms.filter((o) => {
      const f2 = faces[best] as Rect;
      return overlapArea(o.rect, f2) > (f2.w * f2.h) * 0.05;
    });
    if (sharers.length > 1) {
      out.push({ ...room });
    } else {
      out.push({ ...room, rect: { ...face } });
    }
  }
  // Faces nobody claimed become new rooms.
  faces.forEach((f, i) => {
    if (used.has(i)) return;
    autoCounter += 1;
    out.push({ id: `r_auto${autoCounter}`, name: `Room ${autoCounter}`, rect: { ...f }, floor: 'carpet' });
  });
  return out;
}

export function resetRoomCounter(): void {
  autoCounter = 0;
}
