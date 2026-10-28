import { describe, expect, it } from 'vitest';
import { diffLevels, previewOps } from '../src/diff.js';
import type { Op } from '@plumb/core';
import { loadLevel } from './fixture.js';

describe('diff-based preview (SPEC §5)', () => {
  it('detects a moved item and reports the move vector', () => {
    const level = loadLevel();
    const ops: Op[] = [{ op: 'item.update', id: 'i_desk', patch: { x: 8500 } }];
    const preview = previewOps(level, ops);
    if (!preview) throw new Error('preview failed');
    expect(preview.diff.items.changed).toHaveLength(1);
    const changed = preview.diff.items.changed[0];
    if (!changed) throw new Error('no change');
    expect(changed.before.id).toBe('i_desk');
    expect(changed.after.x).toBe(8500);
    const move = preview.diff.moves[0];
    if (!move) throw new Error('no move');
    expect(move.from).toEqual([8300, 3440]);
    expect(move.to).toEqual([8500, 3440]);
  });

  it('detects added and removed items and floor changes', () => {
    const level = loadLevel();
    const ops: Op[] = [
      { op: 'item.add', item: { id: 'i_new', type: 'plant', label: 'Plant', x: 2000, y: 2000, w: 500, d: 500, rot: 0 } },
      { op: 'item.remove', id: 'i_coffee' },
      { op: 'room.update', id: 'bed1', patch: { floor: 'timber' } },
    ];
    const preview = previewOps(level, ops);
    if (!preview) throw new Error('preview failed');
    expect(preview.diff.items.added.map((i) => i.id)).toEqual(['i_new']);
    expect(preview.diff.items.removed.map((i) => i.id)).toEqual(['i_coffee']);
    expect(preview.diff.rooms.map((r) => r.id)).toEqual(['bed1']);
    const rd = preview.diff.rooms[0];
    if (!rd) throw new Error('no room diff');
    expect(rd.beforeFloor).toBe('carpet');
    expect(rd.afterFloor).toBe('timber');
  });

  it('detects added rooms, walls and openings for from-scratch builds', () => {
    const level = loadLevel();
    const empty: typeof level = { ...level, walls: [], openings: [], rooms: [], items: [] };
    const ops: Op[] = [
      { op: 'room.add', room: { id: 'r_lobby', name: 'Lobby', rect: { x: 0, y: 0, w: 6000, h: 4500 }, floor: 'tile' } },
      { op: 'wall.add', wall: { id: 'w_new', a: [0, 0], b: [6000, 0], thickness: 200 } },
    ];
    const preview = previewOps(empty, ops);
    if (!preview) throw new Error('preview failed');
    expect(preview.diff.roomsAdded.map((r) => r.id)).toEqual(['r_lobby']);
    expect(preview.diff.wallsAdded.map((w) => w.id)).toEqual(['w_new']);
    const withWall = preview.after;
    const full = previewOps(withWall, [
      { op: 'opening.add', opening: { kind: 'door', id: 'd_new', wall: 'w_new', at: 3000, width: 900, swing: 1, hinge: 'a' } },
    ]);
    if (!full) throw new Error('opening preview failed');
    expect(full.diff.openingsAdded.map((o) => o.id)).toEqual(['d_new']);
  });

  it('returns null for an invalid batch (nothing to preview)', () => {    const level = loadLevel();
    const ops: Op[] = [{ op: 'item.update', id: 'missing', patch: { x: 1 } }];
    expect(previewOps(level, ops)).toBeNull();
  });

  it('sees no diff between a level and itself', () => {
    const level = loadLevel();
    const d = diffLevels(level, loadLevel());
    expect(d.items.added).toHaveLength(0);
    expect(d.items.removed).toHaveLength(0);
    expect(d.items.changed).toHaveLength(0);
    expect(d.rooms).toHaveLength(0);
    expect(d.walls).toHaveLength(0);
    expect(d.openings).toHaveLength(0);
  });
});
