/**
 * Generic, diff-based proposal preview (SPEC §5): apply the ops to a copy and
 * diff by id. The renderer never special-cases an op type.
 */
import { applyOps, type Item, type Level, type Op, type Opening, type Room, type Vec, type Wall } from '@plumb/core';

export interface ItemDiff {
  /** Items present only after. */
  added: Item[];
  /** Items present only before. */
  removed: Item[];
  /** Items whose pose, size or label changed. */
  changed: Array<{ before: Item; after: Item }>;
}

export interface RoomDiff {
  id: string;
  beforeFloor: string;
  afterFloor: string;
  rectChanged: boolean;
}

export interface WallDiff {
  id: string;
}

export interface OpeningDiff {
  id: string;
}

export interface LevelDiff {
  items: ItemDiff;
  rooms: RoomDiff[];
  /** Rooms present only after (e.g. agent building from scratch). */
  roomsAdded: Room[];
  walls: WallDiff[];
  /** Walls present only after. */
  wallsAdded: Wall[];
  openings: OpeningDiff[];
  /** Openings present only after. */
  openingsAdded: Opening[];
  /** Centre-of-mass shift per moved item, for arrows and distance labels. */
  moves: Array<{ id: string; from: Vec; to: Vec }>;
}

function itemPoseKey(i: Item): string {
  return `${i.x},${i.y},${i.w},${i.d},${i.rot},${i.label}`;
}

/** Diff two levels by id. Pure. */
export function diffLevels(before: Level, after: Level): LevelDiff {
  const beforeById = new Map(before.items.map((i) => [i.id, i]));
  const afterById = new Map(after.items.map((i) => [i.id, i]));
  const added: Item[] = [];
  const removed: Item[] = [];
  const changed: Array<{ before: Item; after: Item }> = [];
  for (const [id, b] of beforeById) {
    const a = afterById.get(id);
    if (!a) removed.push(b);
    else if (itemPoseKey(a) !== itemPoseKey(b)) changed.push({ before: b, after: a });
  }
  for (const [id, a] of afterById) {
    if (!beforeById.has(id)) added.push(a);
  }
  const moves = changed.map(({ before: b, after: a }) => ({ id: b.id, from: [b.x, b.y] as Vec, to: [a.x, a.y] as Vec }));
  const rooms: RoomDiff[] = [];
  const afterRooms = new Map(after.rooms.map((r) => [r.id, r]));
  const beforeRoomIds = new Set(before.rooms.map((r) => r.id));
  const roomsAdded = after.rooms.filter((r) => !beforeRoomIds.has(r.id));
  for (const rb of before.rooms) {
    const ra = afterRooms.get(rb.id);
    if (!ra) continue;
    if (ra.floor !== rb.floor || ra.rect.x !== rb.rect.x || ra.rect.y !== rb.rect.y || ra.rect.w !== rb.rect.w || ra.rect.h !== rb.rect.h) {
      rooms.push({
        id: rb.id,
        beforeFloor: rb.floor,
        afterFloor: ra.floor,
        rectChanged:
          ra.rect.x !== rb.rect.x || ra.rect.y !== rb.rect.y || ra.rect.w !== rb.rect.w || ra.rect.h !== rb.rect.h,
      });
    }
  }
  const walls: WallDiff[] = [];
  const afterWalls = new Map(after.walls.map((w) => [w.id, w]));
  const beforeWallIds = new Set(before.walls.map((w) => w.id));
  const wallsAdded = after.walls.filter((w) => !beforeWallIds.has(w.id));
  for (const wb of before.walls) {
    const wa = afterWalls.get(wb.id);
    if (
      wa &&
      (wa.a[0] !== wb.a[0] ||
        wa.a[1] !== wb.a[1] ||
        wa.b[0] !== wb.b[0] ||
        wa.b[1] !== wb.b[1] ||
        wa.thickness !== wb.thickness)
    ) {
      walls.push({ id: wb.id });
    }
  }
  const openings: OpeningDiff[] = [];
  const afterOpenings = new Map(after.openings.map((o) => [o.id, o]));
  const beforeOpeningIds = new Set(before.openings.map((o) => o.id));
  const openingsAdded = after.openings.filter((o) => !beforeOpeningIds.has(o.id));
  for (const ob of before.openings) {
    const oa = afterOpenings.get(ob.id);
    if (
      oa &&
      (oa.at !== ob.at ||
        oa.width !== ob.width ||
        oa.wall !== ob.wall ||
        (oa.kind === 'door' && ob.kind === 'door' && (oa.swing !== ob.swing || oa.hinge !== ob.hinge)))
    ) {
      openings.push({ id: ob.id });
    }
  }
  return { items: { added, removed, changed }, rooms, roomsAdded, walls, wallsAdded, openings, openingsAdded, moves };
}

/** Apply proposal ops safely; null when the batch is invalid (nothing to preview). */
export function previewOps(level: Level, ops: Op[]): { after: Level; diff: LevelDiff } | null {
  try {
    const { level: after } = applyOps(level, ops);
    return { after, diff: diffLevels(level, after) };
  } catch {
    return null;
  }
}
