import { describe, expect, it } from 'vitest';
import { gridMajor, gridStep } from '../src/grid.js';
import { computeFit, levelBounds, scaleBarMm, scaleReadout, zoomedView } from '../src/fit.js';
import { loadLevel } from './fixture.js';

describe('grid', () => {
  it('picks the smallest step that is at least 9 px', () => {
    expect(gridStep(0.0673)).toBe(500); // 100 mm → 6.7 px, 500 mm → 33.7 px
    expect(gridStep(0.09)).toBe(100); // 100 mm → 9 px
    expect(gridStep(0.004)).toBe(5000); // nothing smaller reaches 9 px
  });

  it('majors every 1000 mm below 1000, else 5× step', () => {
    expect(gridMajor(500)).toBe(1000);
    expect(gridMajor(1000)).toBe(5000);
    expect(gridMajor(5000)).toBe(25000);
  });
});

describe('fit', () => {
  it('bounds the fixture walls including thickness', () => {
    const b = levelBounds(loadLevel());
    expect(b).toEqual({ x0: -100, y0: -100, x1: 10100, y1: 7700 });
  });

  it('fits into 1200×800 within the clamp and centres the plan', () => {
    const b = levelBounds(loadLevel());
    const v = computeFit(b, 1200, 800);
    expect(v.s).toBeGreaterThan(0.015);
    expect(v.s).toBeLessThan(0.6);
    // The plan centre sits at the centre of the usable area.
    const cx = (b.x0 + b.x1) / 2;
    const screenX = (cx - v.x) * v.s;
    expect(screenX).toBeGreaterThan(560);
    expect(screenX).toBeLessThan(640);
  });

  it('zoom keeps the world point under the cursor fixed', () => {
    const v = { x: 100, y: 100, s: 0.08 };
    const z = zoomedView(v, 300, 200, 1.25);
    expect(z.s).toBeCloseTo(0.1, 10);
    const wx = 300 / v.s + v.x;
    const wy = 200 / v.s + v.y;
    expect((wx - z.x) * z.s).toBeCloseTo(300, 8);
    expect((wy - z.y) * z.s).toBeCloseTo(200, 8);
  });

  it('clamps zoom', () => {
    expect(zoomedView({ x: 0, y: 0, s: 0.5 }, 0, 0, 100).s).toBe(0.6);
    expect(zoomedView({ x: 0, y: 0, s: 0.02 }, 0, 0, 0.001).s).toBe(0.015);
  });
});

describe('scale', () => {
  it('picks the first bar length at least 70 px', () => {
    expect(scaleBarMm(0.0673)).toBe(2000); // 1000 mm → 67.3 px is still short
    expect(scaleBarMm(0.08)).toBe(1000); // 1000 mm → 80 px
  });

  it('reads 1:N with N = round(1/(s×0.26458))', () => {
    expect(scaleReadout(0.0756)).toBe('1:50');
    expect(scaleReadout(0.0673)).toBe('1:56');
  });
});
