/**
 * Operations: every mutation goes through `applyOps`, which is pure,
 * atomic (all-or-nothing) and returns the inverse batch for undo.
 */
import { openingSpan, wallFrame } from './geometry.js';
import type { Item, Level, Opening, Op, Room, Vec, Wall } from './schemas.js';
import { OpSchema } from './schemas.js';

/** Typed rejection of a whole batch. `index` is the failing op, -1 for shape errors. */
export class OpError extends Error {
  readonly index: number;
  readonly reason: string;

  constructor(index: number, reason: string) {
    super(`op ${index}: ${reason}`);
    this.name = 'OpError';
    this.index = index;
    this.reason = reason;
  }
}

const MIN_SIZE_MM = 100;
const MIN_WALL_THICKNESS_MM = 50;
const MAX_WALL_THICKNESS_MM = 600;

function cloneLevel(level: Level): Level {
  return JSON.parse(JSON.stringify(level)) as Level;
}

function copyVec(v: Vec): Vec {
  return [v[0], v[1]];
}

function fail(index: number, reason: string): never {
  throw new OpError(index, reason);
}

function needFinite(index: number, what: string, v: number): void {
  if (!Number.isFinite(v)) fail(index, `${what} must be a finite number`);
}

function needSize(index: number, what: string, v: number): void {
  needFinite(index, what, v);
  if (v < MIN_SIZE_MM) fail(index, `${what} must be at least ${MIN_SIZE_MM} mm`);
}

function findWall(level: Level, id: string): Wall | undefined {
  return level.walls.find((w) => w.id === id);
}

function findItem(level: Level, id: string): Item | undefined {
  return level.items.find((i) => i.id === id);
}

function findOpening(level: Level, id: string): Opening | undefined {
  return level.openings.find((o) => o.id === id);
}

function findRoom(level: Level, id: string): Room | undefined {
  return level.rooms.find((r) => r.id === id);
}

function idTaken(level: Level, id: string): boolean {
  return (
    level.walls.some((w) => w.id === id) ||
    level.items.some((i) => i.id === id) ||
    level.openings.some((o) => o.id === id) ||
    level.rooms.some((r) => r.id === id)
  );
}

function checkItemDims(index: number, item: Pick<Item, 'w' | 'd' | 'x' | 'y' | 'rot'>): void {
  needSize(index, 'item width', item.w);
  needSize(index, 'item depth', item.d);
  needFinite(index, 'item x', item.x);
  needFinite(index, 'item y', item.y);
  needFinite(index, 'item rotation', item.rot);
}

function checkWall(index: number, wall: Pick<Wall, 'a' | 'b' | 'thickness'>): void {
  needFinite(index, 'wall ax', wall.a[0]);
  needFinite(index, 'wall ay', wall.a[1]);
  needFinite(index, 'wall bx', wall.b[0]);
  needFinite(index, 'wall by', wall.b[1]);
  needFinite(index, 'wall thickness', wall.thickness);
  if (wall.thickness < MIN_WALL_THICKNESS_MM || wall.thickness > MAX_WALL_THICKNESS_MM) {
    fail(index, `wall thickness must be between ${MIN_WALL_THICKNESS_MM} and ${MAX_WALL_THICKNESS_MM} mm`);
  }
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  if (!(len >= 1)) fail(index, 'wall must have non-zero length');
}

function checkRoom(index: number, room: Pick<Room, 'name' | 'rect'>): void {
  if (room.name.trim().length === 0) fail(index, 'room name must not be empty');
  needFinite(index, 'room x', room.rect.x);
  needFinite(index, 'room y', room.rect.y);
  needSize(index, 'room width', room.rect.w);
  needSize(index, 'room height', room.rect.h);
}

/** Openings must sit on their wall, clear of the ends by a wall thickness. */
function checkOpeningOnWall(index: number, opening: Pick<Opening, 'at' | 'width'>, wall: Wall): void {
  needFinite(index, 'opening position', opening.at);
  needSize(index, 'opening width', opening.width);
  const { length } = wallFrame(wall);
  const [s0, s1] = openingSpan(opening);
  if (!(s0 >= wall.thickness - 1e-9 && s1 <= length - wall.thickness + 1e-9)) {
    fail(index, `opening [${s0}, ${s1}] lies outside wall (length ${length}, thickness ${wall.thickness})`);
  }
}

function checkDoorEnds(index: number, swing: number, hinge: string): void {
  if (swing !== 1 && swing !== -1) fail(index, 'door swing must be 1 or -1');
  if (hinge !== 'a' && hinge !== 'b') fail(index, "door hinge must be 'a' or 'b'");
}

/**
 * Apply a batch of ops to `level` (never mutated). Returns the new level
 * plus the inverse batch: `applyOps(applyOps(l, ops).level, inverse).level`
 * deep-equals `l`. The batch is atomic: any failure rejects everything.
 */
export function applyOps(level: Level, ops: Op[]): { level: Level; inverse: Op[] } {
  const parsed = OpSchema.array().safeParse(ops);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const at = first?.path.length ? ` at ops.${first.path.map(String).join('.')}` : '';
    throw new OpError(-1, `invalid ops${at}: ${first?.message ?? 'schema error'}`);
  }
  const draft = cloneLevel(level);
  const inverseSteps: Op[][] = [];

  parsed.data.forEach((op, index) => {
    switch (op.op) {
      case 'item.add': {
        if (idTaken(draft, op.item.id)) fail(index, `id ${op.item.id} is already used`);
        checkItemDims(index, op.item);
        draft.items.push({ ...op.item });
        inverseSteps.push([{ op: 'item.remove', id: op.item.id }]);
        break;
      }
      case 'item.update': {
        const target = findItem(draft, op.id);
        if (!target) fail(index, `unknown item ${op.id}`);
        if (op.patch.w !== undefined) needSize(index, 'item width', op.patch.w);
        if (op.patch.d !== undefined) needSize(index, 'item depth', op.patch.d);
        if (op.patch.x !== undefined) needFinite(index, 'item x', op.patch.x);
        if (op.patch.y !== undefined) needFinite(index, 'item y', op.patch.y);
        if (op.patch.rot !== undefined) needFinite(index, 'item rotation', op.patch.rot);
        const undo: { x?: number; y?: number; w?: number; d?: number; rot?: number; label?: string } = {};
        if (op.patch.x !== undefined) undo.x = target.x;
        if (op.patch.y !== undefined) undo.y = target.y;
        if (op.patch.w !== undefined) undo.w = target.w;
        if (op.patch.d !== undefined) undo.d = target.d;
        if (op.patch.rot !== undefined) undo.rot = target.rot;
        if (op.patch.label !== undefined) undo.label = target.label;
        Object.assign(target, op.patch);
        inverseSteps.push([{ op: 'item.update', id: op.id, patch: undo }]);
        break;
      }
      case 'item.remove': {
        const at = draft.items.findIndex((i) => i.id === op.id);
        if (at < 0) fail(index, `unknown item ${op.id}`);
        const removed = draft.items[at];
        if (!removed) fail(index, `unknown item ${op.id}`);
        draft.items.splice(at, 1);
        inverseSteps.push([{ op: 'item.add', item: { ...removed } }]);
        break;
      }
      case 'wall.add': {
        if (idTaken(draft, op.wall.id)) fail(index, `id ${op.wall.id} is already used`);
        checkWall(index, op.wall);
        draft.walls.push({ ...op.wall, a: copyVec(op.wall.a), b: copyVec(op.wall.b) });
        inverseSteps.push([{ op: 'wall.remove', id: op.wall.id }]);
        break;
      }
      case 'wall.update': {
        const target = findWall(draft, op.id);
        if (!target) fail(index, `unknown wall ${op.id}`);
        const next: Wall = {
          id: target.id,
          a: op.patch.a ? copyVec(op.patch.a) : copyVec(target.a),
          b: op.patch.b ? copyVec(op.patch.b) : copyVec(target.b),
          thickness: op.patch.thickness ?? target.thickness,
        };
        checkWall(index, next);
        const undo: { a?: Vec; b?: Vec; thickness?: number } = {};
        if (op.patch.a !== undefined) undo.a = copyVec(target.a);
        if (op.patch.b !== undefined) undo.b = copyVec(target.b);
        if (op.patch.thickness !== undefined) undo.thickness = target.thickness;
        if (op.patch.a !== undefined) target.a = copyVec(op.patch.a);
        if (op.patch.b !== undefined) target.b = copyVec(op.patch.b);
        if (op.patch.thickness !== undefined) target.thickness = op.patch.thickness;
        inverseSteps.push([{ op: 'wall.update', id: op.id, patch: undo }]);
        break;
      }
      case 'wall.remove': {
        const at = draft.walls.findIndex((w) => w.id === op.id);
        if (at < 0) fail(index, `unknown wall ${op.id}`);
        const removed = draft.walls[at];
        if (!removed) fail(index, `unknown wall ${op.id}`);
        const cut = draft.openings.filter((o) => o.wall === op.id);
        draft.openings = draft.openings.filter((o) => o.wall !== op.id);
        draft.walls.splice(at, 1);
        const undo: Op[] = [
          { op: 'wall.add', wall: { ...removed, a: copyVec(removed.a), b: copyVec(removed.b) } },
        ];
        for (const o of cut) undo.push({ op: 'opening.add', opening: { ...o } });
        inverseSteps.push(undo);
        break;
      }
      case 'opening.add': {
        if (idTaken(draft, op.opening.id)) fail(index, `id ${op.opening.id} is already used`);
        const wall = findWall(draft, op.opening.wall);
        if (!wall) fail(index, `unknown wall ${op.opening.wall}`);
        checkOpeningOnWall(index, op.opening, wall);
        if (op.opening.kind === 'door') checkDoorEnds(index, op.opening.swing, op.opening.hinge);
        draft.openings.push({ ...op.opening });
        inverseSteps.push([{ op: 'opening.remove', id: op.opening.id }]);
        break;
      }
      case 'opening.update': {
        const target = findOpening(draft, op.id);
        if (!target) fail(index, `unknown opening ${op.id}`);
        const wall = findWall(draft, target.wall);
        if (!wall) fail(index, `opening ${op.id} is on missing wall ${target.wall}`);
        checkOpeningOnWall(index, { at: op.patch.at ?? target.at, width: op.patch.width ?? target.width }, wall);
        if (target.kind === 'door') {
          checkDoorEnds(
            index,
            op.patch.swing ?? target.swing,
            op.patch.hinge ?? target.hinge,
          );
        } else if (op.patch.swing !== undefined || op.patch.hinge !== undefined) {
          fail(index, 'windows have no swing or hinge');
        }
        const undo: { at?: number; width?: number; swing?: 1 | -1; hinge?: 'a' | 'b' } = {};
        if (op.patch.at !== undefined) undo.at = target.at;
        if (op.patch.width !== undefined) undo.width = target.width;
        if (target.kind === 'door') {
          if (op.patch.swing !== undefined) undo.swing = target.swing;
          if (op.patch.hinge !== undefined) undo.hinge = target.hinge;
        }
        if (op.patch.at !== undefined) target.at = op.patch.at;
        if (op.patch.width !== undefined) target.width = op.patch.width;
        if (target.kind === 'door') {
          if (op.patch.swing !== undefined) target.swing = op.patch.swing;
          if (op.patch.hinge !== undefined) target.hinge = op.patch.hinge;
        }
        inverseSteps.push([{ op: 'opening.update', id: op.id, patch: undo }]);
        break;
      }
      case 'opening.remove': {
        const at = draft.openings.findIndex((o) => o.id === op.id);
        if (at < 0) fail(index, `unknown opening ${op.id}`);
        const removed = draft.openings[at];
        if (!removed) fail(index, `unknown opening ${op.id}`);
        draft.openings.splice(at, 1);
        inverseSteps.push([{ op: 'opening.add', opening: { ...removed } }]);
        break;
      }
      case 'room.add': {
        if (idTaken(draft, op.room.id)) fail(index, `id ${op.room.id} is already used`);
        checkRoom(index, op.room);
        draft.rooms.push({ ...op.room, rect: { ...op.room.rect } });
        inverseSteps.push([{ op: 'room.remove', id: op.room.id }]);
        break;
      }
      case 'room.remove': {
        const at = draft.rooms.findIndex((r) => r.id === op.id);
        if (at < 0) fail(index, `unknown room ${op.id}`);
        const removed = draft.rooms[at];
        if (!removed) fail(index, `unknown room ${op.id}`);
        draft.rooms.splice(at, 1);
        inverseSteps.push([{ op: 'room.add', room: { ...removed, rect: { ...removed.rect } } }]);
        break;
      }
      case 'room.update': {
        const target = findRoom(draft, op.id);
        if (!target) fail(index, `unknown room ${op.id}`);
        if (op.patch.rect) {
          needFinite(index, 'room x', op.patch.rect.x);
          needFinite(index, 'room y', op.patch.rect.y);
          needSize(index, 'room width', op.patch.rect.w);
          needSize(index, 'room height', op.patch.rect.h);
        }
        const undo: { name?: string; floor?: Room['floor']; rect?: Room['rect'] } = {};
        if (op.patch.name !== undefined) undo.name = target.name;
        if (op.patch.floor !== undefined) undo.floor = target.floor;
        if (op.patch.rect !== undefined) undo.rect = { ...target.rect };
        if (op.patch.name !== undefined) target.name = op.patch.name;
        if (op.patch.floor !== undefined) target.floor = op.patch.floor;
        if (op.patch.rect !== undefined) target.rect = { ...op.patch.rect };
        inverseSteps.push([{ op: 'room.update', id: op.id, patch: undo }]);
        break;
      }
      default: {
        const _exhaustive: never = op;
        void _exhaustive;
        fail(index, 'unknown op');
      }
    }
  });

  return { level: draft, inverse: inverseSteps.reverse().flat() };
}
