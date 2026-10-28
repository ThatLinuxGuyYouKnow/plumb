import { describe, expect, it } from 'vitest';
import { layoutRoomLabels } from '../src/labels.js';
import { loadLevel } from './fixture.js';

describe('room label layout', () => {
  it('places every label inside its room', () => {
    const level = loadLevel();
    const pos = layoutRoomLabels(level);
    for (const r of level.rooms) {
      const p = pos[r.id];
      if (!p) throw new Error(`no label for ${r.id}`);
      expect(p[0]).toBeGreaterThanOrEqual(r.rect.x);
      expect(p[0]).toBeLessThanOrEqual(r.rect.x + r.rect.w);
      expect(p[1]).toBeGreaterThanOrEqual(r.rect.y);
      expect(p[1]).toBeLessThanOrEqual(r.rect.y + r.rect.h);
    }
  });

  it('is deterministic and cached', () => {
    const level = loadLevel();
    const a = layoutRoomLabels(level);
    const b = layoutRoomLabels(loadLevel());
    expect(a).toEqual(b);
    expect(layoutRoomLabels(level)).toBe(a); // same object: cache hit
  });
});
