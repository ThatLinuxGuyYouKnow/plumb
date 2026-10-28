import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyOps, OpError } from '../src/ops.js';
import type { Level, Op } from '../src/schemas.js';
import { loadLevel } from './fixture.js';

function itemIds(level: Level): string[] {
  return level.items.map((i) => i.id);
}
function roomIds(level: Level): string[] {
  return level.rooms.map((r) => r.id);
}
function doorIds(level: Level): string[] {
  return level.openings.filter((o) => o.kind === 'door').map((o) => o.id);
}
function doorWidth(level: Level, id: string): number {
  const o = level.openings.find((x) => x.id === id);
  if (!o) throw new Error(`missing opening ${id}`);
  return o.width;
}

/**
 * Arbitrary batches that are valid against the base level: field updates
 * that only narrow (or leave) constrained values, so sequential application
 * stays valid however the ops compose.
 */
function batchArb(level: Level): fc.Arbitrary<Op[]> {
  const items = itemIds(level);
  const rooms = roomIds(level);
  const doors = doorIds(level);
  const itemUpdate: fc.Arbitrary<Op> = fc
    .tuple(
      fc.constantFrom(...items),
      fc.option(fc.integer({ min: -5000, max: 15000 }), { nil: undefined }),
      fc.option(fc.integer({ min: -5000, max: 15000 }), { nil: undefined }),
      fc.option(fc.integer({ min: 100, max: 3000 }), { nil: undefined }),
      fc.option(fc.integer({ min: 100, max: 3000 }), { nil: undefined }),
      fc.option(fc.constantFrom(0, 90, 180, 270), { nil: undefined }),
    )
    .map(([id, x, y, w, d, rot]) => {
      const patch: { x?: number; y?: number; w?: number; d?: number; rot?: number } = {};
      if (x !== undefined) patch.x = x;
      if (y !== undefined) patch.y = y;
      if (w !== undefined) patch.w = w;
      if (d !== undefined) patch.d = d;
      if (rot !== undefined) patch.rot = rot;
      return { op: 'item.update', id, patch } as Op;
    });
  const roomUpdate: fc.Arbitrary<Op> = fc
    .tuple(fc.constantFrom(...rooms), fc.constantFrom('timber', 'tile', 'carpet', 'stone'))
    .map(([id, floor]) => ({ op: 'room.update', id, patch: { floor } }) as Op);
  const doorUpdate: fc.Arbitrary<Op> = fc
    .tuple(fc.constantFrom(...doors), fc.constantFrom(1, -1), fc.constantFrom('a', 'b'))
    .map(([id, swing, hinge]) => ({ op: 'opening.update', id, patch: { swing, hinge } }) as Op);
  const narrowWidth: fc.Arbitrary<Op> = fc
    .tuple(
      fc.constantFrom(...doors),
      fc.integer({ min: 0, max: 1000 }),
    )
    .map(([id, salt]) => {
      const max = doorWidth(level, id);
      const width = 100 + (salt % Math.max(1, max - 100 + 1));
      return { op: 'opening.update', id, patch: { width } } as Op;
    });
  const wallAdd: fc.Arbitrary<Op> = fc.constant({
    op: 'wall.add',
    wall: { id: 'pc_wall', a: [-3000, -3000], b: [-3000, 3000], thickness: 120 },
  } as Op);
  const itemAdd: fc.Arbitrary<Op> = fc.constant({
    op: 'item.add',
    item: { id: 'pc_item', type: 'plant', label: 'Plant', x: -2000, y: -2000, w: 500, d: 500, rot: 0 },
  } as Op);
  const updates = fc.array(fc.oneof(itemUpdate, roomUpdate, doorUpdate, narrowWidth), {
    minLength: 1,
    maxLength: 6,
  });
  // Adds use fresh ids and (for the opening) the freshly added wall, so every
  // batch stays valid and every inverse restores exact order: adds undo via
  // remove, while removes of pre-existing entities are covered by the
  // dedicated cascade test (re-added entities append at the end).
  return fc
    .tuple(updates, fc.option(wallAdd, { nil: undefined }), fc.option(itemAdd, { nil: undefined }))
    .map(([ups, wall, item]): Op[] => {
      const ops: Op[] = [...ups];
      if (wall !== undefined) {
        ops.push(wall);
        ops.push({
          op: 'opening.add',
          opening: { kind: 'window', id: 'pc_win', wall: 'pc_wall', at: 3000, width: 900 },
        });
      }
      if (item !== undefined) ops.push(item);
      return ops;
    });
}

describe('ops (SPEC §5)', () => {
  it('round-trips random valid batches: apply(inverse) restores the level, input untouched', () => {
    const level = loadLevel();
    fc.assert(
      fc.property(batchArb(level), (ops) => {
        const before = JSON.parse(JSON.stringify(level)) as Level;
        const { level: after, inverse } = applyOps(level, ops);
        // Pure: the input is never mutated.
        expect(level).toEqual(before);
        const { level: restored } = applyOps(after, inverse);
        expect(restored).toEqual(before);
      }),
      { numRuns: 150 },
    );
  });

  it('wall.remove cascades to its openings and undoes cleanly', () => {
    const level = loadLevel();
    const before = JSON.parse(JSON.stringify(level)) as Level;
    const doorsOnW5 = level.openings.filter((o) => o.wall === 'w5').length;
    expect(doorsOnW5).toBeGreaterThan(0);
    const { level: after, inverse } = applyOps(level, [{ op: 'wall.remove', id: 'w5' }]);
    expect(after.walls.some((w) => w.id === 'w5')).toBe(false);
    expect(after.openings.some((o) => o.wall === 'w5')).toBe(false);
    // The inverse re-adds the wall then its openings.
    expect(inverse[0]).toEqual({
      op: 'wall.add',
      wall: expect.objectContaining({ id: 'w5' }),
    });
    expect(inverse.slice(1).every((o) => o.op === 'opening.add')).toBe(true);
    const { level: restored } = applyOps(after, inverse);
    // Set-equal; re-added entities append at the end (documented in DECISIONS.md).
    const byId = (a: { id: string }, b: { id: string }): number =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    expect([...restored.walls].sort(byId)).toEqual([...before.walls].sort(byId));
    expect([...restored.openings].sort(byId)).toEqual([...before.openings].sort(byId));
    expect(restored.items).toEqual(before.items);
    expect(restored.rooms).toEqual(before.rooms);
  });

  it('creates and removes rooms from scratch, undoing cleanly', () => {
    const level = loadLevel();
    const before = JSON.parse(JSON.stringify(level)) as Level;
    const room = { id: 'r_new', name: 'Lobby', rect: { x: 0, y: 0, w: 6000, h: 4500 }, floor: 'tile' as const };
    const { level: added, inverse } = applyOps(level, [{ op: 'room.add', room }]);
    expect(added.rooms.some((r) => r.id === 'r_new')).toBe(true);
    expect(inverse).toEqual([{ op: 'room.remove', id: 'r_new' }]);
    const { level: removed } = applyOps(added, [{ op: 'room.remove', id: 'r_new' }]);
    expect(removed.rooms).toEqual(before.rooms);
    const { level: restored } = applyOps(added, inverse);
    expect(restored.rooms).toEqual(before.rooms);
    // Bad room batches reject atomically.
    expect(() => applyOps(level, [{ op: 'room.add', room: { ...room, id: 'bed1' } }])).toThrow(OpError);
    expect(() => applyOps(level, [{ op: 'room.add', room: { ...room, id: 'r_x', rect: { x: 0, y: 0, w: 50, h: 50 } } }])).toThrow(OpError);
    expect(() => applyOps(level, [{ op: 'room.remove', id: 'missing' }])).toThrow(OpError);
    expect(level).toEqual(before);
  });

  it('rejects bad batches atomically with a typed error', () => {    const level = loadLevel();
    const before = JSON.parse(JSON.stringify(level)) as Level;
    const bad: Op[][] = [
      [{ op: 'item.update', id: 'nope', patch: { x: 1 } }],
      [{ op: 'item.update', id: 'i_desk', patch: { w: 50 } }],
      [{ op: 'opening.add', opening: { kind: 'door', id: 'dx', wall: 'w5', at: 100, width: 900, swing: 1, hinge: 'a' } }],
      [{ op: 'wall.remove', id: 'w5' }, { op: 'item.update', id: 'i_desk', patch: { w: 10 } }],
    ];
    for (const ops of bad) {
      expect(() => applyOps(level, ops)).toThrow(OpError);
    }
    expect(level).toEqual(before);
  });
});
