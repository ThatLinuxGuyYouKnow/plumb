import { describe, expect, it } from 'vitest';
import { runChecks } from '../src/checks.js';
import type { Level } from '../src/schemas.js';

/** Minimal north-wall room: wall w1, one window, one door. */
function miniLevel(): Level {
  return {
    id: 'level_mini',
    name: 'Mini',
    walls: [{ id: 'w1', a: [0, 0], b: [10000, 0], thickness: 200 }],
    openings: [
      { kind: 'window', id: 'n1', wall: 'w1', at: 5000, width: 1600 },
      { kind: 'door', id: 'd1', wall: 'w1', at: 1500, width: 900, swing: 1, hinge: 'a' },
    ],
    rooms: [{ id: 'r1', name: 'Studio', rect: { x: 0, y: 0, w: 10000, h: 4000 }, floor: 'timber' }],
    items: [],
  };
}

describe('window-blocked (warn)', () => {
  it('flags a wardrobe covering more than half the window', () => {
    const level = miniLevel();
    level.items.push({ id: 'i_ward', type: 'wardrobe', label: 'Wardrobe', x: 5000, y: 500, w: 1800, d: 600, rot: 0 });
    const issues = runChecks(level, { checks: ['window-blocked'] });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('warn');
    expect(issues[0]?.message).toContain('Wardrobe');
  });

  it('stays quiet when the wardrobe is far from the window', () => {
    const level = miniLevel();
    level.items.push({ id: 'i_ward', type: 'wardrobe', label: 'Wardrobe', x: 1000, y: 3400, w: 1800, d: 600, rot: 0 });
    expect(runChecks(level, { checks: ['window-blocked'] })).toHaveLength(0);
  });

  it('ignores short furniture under the window', () => {
    const level = miniLevel();
    level.items.push({ id: 'i_desk', type: 'desk', label: 'Desk', x: 5000, y: 500, w: 1400, d: 600, rot: 0 });
    expect(runChecks(level, { checks: ['window-blocked'] })).toHaveLength(0);
  });
});

describe('passage (warn)', () => {
  it('flags furniture standing in the doorway approach', () => {
    const level = miniLevel();
    // Door d1: hinge 'a' at s=1050, uDir east, swing +n (south, into the room).
    // Approach corridor: x 1050..1950, y 0..900.
    level.items.push({ id: 'i_box', type: 'dresser', label: 'Dresser', x: 1500, y: 500, w: 1200, d: 450, rot: 0 });
    const issues = runChecks(level, { checks: ['passage'] });
    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe('warn');
    expect(issues[0]?.itemIds).toContain('d1');
  });

  it('stays quiet when the approach is clear', () => {
    const level = miniLevel();
    level.items.push({ id: 'i_box', type: 'dresser', label: 'Dresser', x: 5000, y: 3000, w: 1200, d: 450, rot: 0 });
    expect(runChecks(level, { checks: ['passage'] })).toHaveLength(0);
  });
});
