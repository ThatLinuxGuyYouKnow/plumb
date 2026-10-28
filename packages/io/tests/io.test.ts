import { describe, expect, it } from 'vitest';
import { PlanSchema } from '@plumb/core';
import { exportSvg } from '../src/svg.js';
import { parsePlumbFile, serializePlumbFile } from '../src/json.js';
import { reconstruct, resetReconstructCounter, type DxfDocument } from '../src/reconstruct.js';
import fixtureJson from '../../../fixtures/twoBed.plan.json';

describe('plumb.json round trip', () => {
  it('parse(serialize(plan)) deep-equals plan', () => {
    const plan = PlanSchema.parse(fixtureJson);
    expect(parsePlumbFile(serializePlumbFile(plan)).plan).toEqual(plan);
  });

  it('migrates a v0 document', () => {
    const v0 = JSON.stringify({ schemaVersion: 0, plan: { name: 'Old', levels: [{ walls: [], openings: [], rooms: [], items: [] }] } });
    const parsed = parsePlumbFile(v0);
    expect(parsed.plan.levels).toHaveLength(1);
    expect(parsed.plan.name).toBe('Old');
  });

  it('rejects invalid JSON', () => {
    expect(() => parsePlumbFile('nope')).toThrow();
  });
});

describe('svg export', () => {
  it('emits the AIA layers and room labels', () => {
    const plan = PlanSchema.parse(fixtureJson);
    const level = plan.levels[0];
    if (!level) throw new Error('no level');
    const svg = exportSvg(level);
    for (const layer of ['A-WALL', 'A-DOOR', 'A-GLAZ', 'A-FURN', 'A-FLOR', 'A-AREA', 'A-ANNO-TEXT']) {
      expect(svg).toContain(`id="${layer}"`);
    }
    expect(svg).toContain('BEDROOM 1');
  });
});

describe('dxf reconstruct', () => {
  it('rebuilds Plumb XDATA exactly', () => {
    resetReconstructCounter();
    const plan = PlanSchema.parse(fixtureJson);
    const level = plan.levels[0];
    if (!level) throw new Error('no level');
    const doc: DxfDocument = {
      insunits: 4,
      layers: ['A-WALL'],
      lines: [],
      arcs: [],
      polylines: [],
      inserts: [],
      texts: [],
      plumbEntities: { walls: level.walls, openings: level.openings, rooms: level.rooms, items: level.items },
    };
    const res = reconstruct(doc);
    expect(res.underlay).toEqual([]);
    expect(res.unmapped).toEqual([]);
    const wallAdds = res.items.filter((i) => i.op.op === 'wall.add');
    expect(wallAdds).toHaveLength(level.walls.length);
    expect(res.items.filter((i) => i.op.op === 'room.add')).toHaveLength(level.rooms.length);
    expect(res.items.every((i) => i.confidence === 1 && i.onByDefault)).toBe(true);
  });

  it('pairs wall segments and maps furniture blocks, keeping the rest as underlay', () => {
    resetReconstructCounter();
    const doc: DxfDocument = {
      insunits: 4,
      layers: ['A-WALL', '0'],
      lines: [
        { layer: 'A-WALL', x1: 0, y1: 0, x2: 4000, y2: 0 },
        { layer: 'A-WALL', x1: 0, y1: 200, x2: 4000, y2: 200 },
        { layer: '0', x1: 5000, y1: 5000, x2: 6000, y2: 5000 },
      ],
      arcs: [],
      polylines: [],
      inserts: [{ layer: '0', block: 'SOFA_3D', x: 1000, y: 1000, rot: 0 }],
      texts: [],
    };
    const res = reconstruct(doc);
    expect(res.items.filter((i) => i.op.op === 'wall.add')).toHaveLength(1);
    expect(res.items.some((i) => i.op.op === 'item.add')).toBe(true);
    expect(res.underlay.length).toBeGreaterThan(0);
  });

  it('guesses metres from extent and asks for confirmation', () => {
    resetReconstructCounter();
    const doc: DxfDocument = {
      insunits: 0,
      layers: ['A-WALL'],
      lines: [{ layer: 'A-WALL', x1: 0, y1: 0, x2: 10, y2: 0 }],
      arcs: [],
      polylines: [],
      inserts: [],
      texts: [],
    };
    const res = reconstruct(doc);
    expect(res.unitsputer.factor).toBe(1000);
    expect(res.unitsputer.confirm).toBe(true);
  });
});
