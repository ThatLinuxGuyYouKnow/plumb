import { describe, expect, it } from 'vitest';
import { fmt, fmtArea, fromUnit, toUnit } from '../src/units.js';

describe('units (SPEC §6)', () => {
  it('formats metres to 2 decimals', () => {
    expect(fmt(4040)).toBe('4.04 m');
    expect(fmt(10200)).toBe('10.20 m');
    expect(fmt(0)).toBe('0.00 m');
  });

  it('formats feet and inches to the nearest inch', () => {
    expect(fmt(4040, 'ft')).toBe('13′3″');
    expect(fmt(0, 'ft')).toBe('0′0″');
  });

  it('carries 12″ to the next foot', () => {
    // 1816.1 mm = 71.5 in, which rounds to 72 in = 6′0″.
    expect(fmt(1816.1, 'ft')).toBe('6′0″');
  });

  it('formats areas', () => {
    expect(fmtArea(14705600)).toBe('14.7 m²');
    expect(fmtArea(14705600, 'ft')).toBe('158 ft²');
    expect(fmtArea(70033600, 'ft')).toBe('754 ft²');
  });

  it('converts numeric fields both ways', () => {
    expect(toUnit(4040)).toBe('4.04');
    expect(toUnit(4038.6, 'ft')).toBe('13.25');
    expect(fromUnit(4.04)).toBeCloseTo(4040, 9);
    // Display values round to 2 decimals, so ft round-trips are approximate.
    expect(fromUnit(13.25, 'ft')).toBeCloseTo(4038.6, 9);
  });
});
