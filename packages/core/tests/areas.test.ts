import { describe, expect, it } from 'vitest';
import { fmtArea } from '../src/units.js';
import { loadLevel } from './fixture.js';

describe('twoBed fixture areas (SPEC §13)', () => {
  it('formats each net room area', () => {
    const level = loadLevel();
    const areaOf = (id: string): string => {
      const room = level.rooms.find((r) => r.id === id);
      if (!room) throw new Error(`missing room ${id}`);
      return fmtArea(room.rect.w * room.rect.h);
    };
    expect(areaOf('bed1')).toBe('14.7 m²');
    expect(areaOf('bath')).toBe('7.6 m²');
    expect(areaOf('bed2')).toBe('12.5 m²');
    expect(areaOf('living')).toBe('22.0 m²');
    expect(areaOf('kitchen')).toBe('13.2 m²');
  });

  it('totals 70.0 m²', () => {
    const level = loadLevel();
    const total = level.rooms.reduce((s, r) => s + r.rect.w * r.rect.h, 0);
    expect(fmtArea(total)).toBe('70.0 m²');
  });
});
