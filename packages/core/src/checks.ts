/**
 * Design checks. Each check returns `Issue[]` with human-readable messages.
 * Default run covers the error checks; `passage` and `window-blocked` warns
 * are opt-in via `opts.checks` (see DECISIONS.md).
 */
import { TALL_TYPES } from './catalog.js';
import {
  aabb,
  doorRoomPoint,
  itemCorners,
  itemInDoorSwing,
  openingSpan,
  quadsOverlap,
  roomAt,
  wallFrame,
  wallPoint,
} from './geometry.js';
import type {
  CheckId,
  Door,
  Issue,
  Item,
  Level,
  Room,
  Vec,
  Wall,
  Window,
} from './schemas.js';
import { DEFAULT_CHECK_CONFIG, type CheckConfig } from './schemas.js';

/** Checks run by default: the error checks. Warns are opt-in. */
export const DEFAULT_CHECKS: readonly CheckId[] = ['door-swing', 'overlap', 'outside-room'];

export const ALL_CHECKS: readonly CheckId[] = [
  'door-swing',
  'overlap',
  'outside-room',
  'passage',
  'window-blocked',
];

export interface RunChecksOptions {
  checks?: readonly CheckId[];
  config?: CheckConfig;
}

function wallById(level: Level, id: string): Wall | undefined {
  return level.walls.find((w) => w.id === id);
}

function isRug(item: Item): boolean {
  return item.type === 'rug';
}

export function runChecks(level: Level, opts: RunChecksOptions = {}): Issue[] {
  const checks = opts.checks ?? DEFAULT_CHECKS;
  const config = opts.config ?? DEFAULT_CHECK_CONFIG;
  const wanted = new Set<CheckId>(checks);
  const out: Issue[] = [];
  if (wanted.has('door-swing')) out.push(...checkDoorSwing(level));
  if (wanted.has('overlap')) out.push(...checkOverlap(level));
  if (wanted.has('outside-room')) out.push(...checkOutsideRoom(level));
  if (wanted.has('passage')) out.push(...checkPassage(level, config.minPassage));
  if (wanted.has('window-blocked')) out.push(...checkWindowBlocked(level));
  return out;
}

// ---------------------------------------------------------------------------
// door-swing (error)
// ---------------------------------------------------------------------------

function checkDoorSwing(level: Level): Issue[] {
  const issues: Issue[] = [];
  const doors = level.openings.filter((o): o is Door => o.kind === 'door');
  for (const door of doors) {
    const wall = wallById(level, door.wall);
    if (!wall) continue;
    for (const item of level.items) {
      if (isRug(item)) continue;
      if (!itemInDoorSwing(item, door, wall)) continue;
      const rp = doorRoomPoint(door, wall);
      const room = roomAt(level.rooms, rp[0], rp[1]);
      const where = room ? `the ${room.name} ` : '';
      issues.push({
        id: `swing-${item.id}-${door.id}`,
        check: 'door-swing',
        severity: 'error',
        itemIds: [item.id, door.id],
        at: [item.x, item.y],
        message: `${item.label} sits inside ${where}door swing`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// overlap (error)
// ---------------------------------------------------------------------------

function checkOverlap(level: Level): Issue[] {
  const issues: Issue[] = [];
  const items = level.items.filter((i) => !isRug(i));
  for (let i = 0; i < items.length; i++) {
    const a = items[i];
    if (!a) continue;
    for (let j = i + 1; j < items.length; j++) {
      const b = items[j];
      if (!b) continue;
      const A = aabb(a);
      const B = aabb(b);
      // Broad phase on AABBs (touching within 0.5 mm is not overlap).
      if (A.x0 >= B.x1 - 0.5 || B.x0 >= A.x1 - 0.5 || A.y0 >= B.y1 - 0.5 || B.y0 >= A.y1 - 0.5) {
        continue;
      }
      if (!quadsOverlap(itemCorners(a), itemCorners(b))) continue;
      const [first, second] = a.id < b.id ? [a, b] : [b, a];
      issues.push({
        id: `overlap-${first.id}-${second.id}`,
        check: 'overlap',
        severity: 'error',
        itemIds: [first.id, second.id],
        at: [(a.x + b.x) / 2, (a.y + b.y) / 2],
        message: `${first.label} overlaps ${second.label}`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// outside-room (error)
// ---------------------------------------------------------------------------

function checkOutsideRoom(level: Level): Issue[] {
  const issues: Issue[] = [];
  for (const item of level.items) {
    if (isRug(item)) continue;
    const room = roomAt(level.rooms, item.x, item.y);
    if (!room) continue;
    const A = aabb(item);
    const r = room.rect;
    if (A.x0 < r.x - 5 || A.x1 > r.x + r.w + 5 || A.y0 < r.y - 5 || A.y1 > r.y + r.h + 5) {
      issues.push({
        id: `outside-${item.id}`,
        check: 'outside-room',
        severity: 'error',
        itemIds: [item.id, room.id],
        at: [item.x, item.y],
        message: `${item.label} runs past the wall of ${room.name}`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// passage (warn): doorway approach clearance (v1 definition)
// ---------------------------------------------------------------------------

/**
 * v1: for each door, the rectangle of the opening width extending
 * `minPassage` into the swing-side room must be clear of furniture.
 * Full walking-route analysis is a later milestone.
 */
function checkPassage(level: Level, minPassage: number): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();
  const doors = level.openings.filter((o): o is Door => o.kind === 'door');
  for (const door of doors) {
    const wall = wallById(level, door.wall);
    if (!wall) continue;
    const [s0, s1] = openingSpan(door);
    const off = door.swing * minPassage;
    const corners = [
      wallPoint(wall, s0, 0),
      wallPoint(wall, s1, 0),
      wallPoint(wall, s1, off),
      wallPoint(wall, s0, off),
    ] as const;
    for (const item of level.items) {
      if (isRug(item)) continue;
      if (!quadsOverlap(corners, itemCorners(item))) continue;
      const key = `${item.id}-${door.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const rp = doorRoomPoint(door, wall);
      const room = roomAt(level.rooms, rp[0], rp[1]);
      const where = room ? ` to the ${room.name}` : '';
      issues.push({
        id: `passage-${key}`,
        check: 'passage',
        severity: 'warn',
        itemIds: [item.id, door.id],
        at: [item.x, item.y] as Vec,
        message: `${item.label} blocks the way through the door${where}`,
      });
    }
  }
  return issues;
}

// ---------------------------------------------------------------------------
// window-blocked (warn)
// ---------------------------------------------------------------------------

function pointToWallDistance(p: readonly [number, number], wall: Wall): number {
  const dx = wall.b[0] - wall.a[0];
  const dy = wall.b[1] - wall.a[1];
  const len2 = dx * dx + dy * dy;
  if (!(len2 > 0)) return Math.hypot(p[0] - wall.a[0], p[1] - wall.a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - wall.a[0]) * dx + (p[1] - wall.a[1]) * dy) / len2));
  return Math.hypot(p[0] - (wall.a[0] + dx * t), p[1] - (wall.a[1] + dy * t));
}

function checkWindowBlocked(level: Level): Issue[] {
  const issues: Issue[] = [];
  const windows = level.openings.filter((o): o is Window => o.kind === 'window');
  const tall = level.items.filter((i) => (TALL_TYPES as readonly string[]).includes(i.type));
  for (const win of windows) {
    const wall = wallById(level, win.wall);
    if (!wall) continue;
    const { u } = wallFrame(wall);
    const [s0, s1] = openingSpan(win);
    for (const item of tall) {
      const corners = itemCorners(item);
      let lo = Infinity;
      let hi = -Infinity;
      for (const c of corners) {
        const t = (c[0] - wall.a[0]) * u[0] + (c[1] - wall.a[1]) * u[1];
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
      const cover = Math.min(hi, s1) - Math.max(lo, s0);
      if (!(cover > win.width * 0.5)) continue;
      const near = corners.some((c) => pointToWallDistance(c, wall) <= wall.thickness + 800);
      if (!near) continue;
      const where = roomNameForWindow(level, wall, win);
      issues.push({
        id: `window-${item.id}-${win.id}`,
        check: 'window-blocked',
        severity: 'warn',
        itemIds: [item.id, win.id],
        at: [item.x, item.y] as Vec,
        message: where
          ? `${item.label} covers more than half of the ${where} window`
          : `${item.label} covers more than half of a window`,
      });
    }
  }
  return issues;
}

function roomNameForWindow(level: Level, wall: Wall, win: Window): string | null {
  for (const side of [1, -1]) {
    const p = wallPoint(wall, win.at, side * (wall.thickness / 2 + 100));
    const room: Room | undefined = roomAt(level.rooms, p[0], p[1]);
    if (room) return room.name;
  }
  return null;
}
