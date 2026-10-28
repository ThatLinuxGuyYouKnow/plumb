import { describe, expect, it } from 'vitest';
import { hitTest } from '../src/hit.js';
import { loadLevel, loadView } from './fixture.js';

describe('hitTest priority (SPEC §7)', () => {
  const level = loadLevel();
  const view = loadView();

  it('hits the top-most non-rug item', () => {
    expect(hitTest(level, [8300, 3440], view)).toEqual({ type: 'item', id: 'i_desk' });
  });

  it('hits openings before walls', () => {
    // Inside door d2's span on wall w5 (at 5300, width 800 → 4900..5700).
    expect(hitTest(level, [5000, 3800], view)).toEqual({ type: 'door', id: 'd2' });
  });

  it('hits walls between openings', () => {
    // On w5, clear of d1 (2850..3750) and d2 (4900..5700).
    expect(hitTest(level, [4300, 3800], view)).toEqual({ type: 'wall', id: 'w5' });
  });

  it('hits rugs below non-rug items but above rooms', () => {
    expect(hitTest(level, [2000, 6000], view)).toEqual({ type: 'item', id: 'i_rug' });
  });

  it('falls back to the room', () => {
    expect(hitTest(level, [1000, 3000], view)).toEqual({ type: 'room', id: 'bed1' });
  });

  it('returns null off-plan', () => {
    expect(hitTest(level, [-5000, -5000], view)).toBeNull();
  });
});
