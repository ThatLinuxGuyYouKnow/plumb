import { describe, expect, it } from 'vitest';
import { findSpot, hasConflict, conflictsOf } from '../src/suggest.js';
import { loadLevel } from './fixture.js';

describe('findSpot (SPEC §13)', () => {
  it("finds a clear, wall-backed spot for a plant in Bedroom 2, away from the door", () => {
    const level = loadLevel();
    const room = level.rooms.find((r) => r.id === 'bed2');
    if (!room) throw new Error('missing bed2');
    const { best, triedCount } = findSpot(room, 'plant', level);
    expect(triedCount).toBeGreaterThan(0);
    if (!best) throw new Error('expected a spot');
    // Back against a wall: touches one of the room edges.
    const r = room.rect;
    const onWall =
      best.y - 250 === r.y || best.y + 250 === r.y + r.h || best.x - 250 === r.x || best.x + 250 === r.x + r.w;
    expect(onWall).toBe(true);
    // No conflicts at the pose.
    const candidate = { id: '__probe__', type: 'plant' as const, label: 'Plant', x: best.x, y: best.y, w: 500, d: 500, rot: best.rot };
    expect(hasConflict(conflictsOf(level, candidate))).toBe(false);
    // Away from the Bedroom 2 door (d3 centre at [7300, 3800]).
    expect(Math.hypot(best.x - 7300, best.y - 3800)).toBeGreaterThan(1500);
  });
});
