/**
 * M7/M8 golden tests: DXF export (ezdxf audit, axis flip, layers, XDATA),
 * IFC export structure, and the Plumb-DXF exact round trip.
 * Spawns the Python convert service CLI (services/convert/cli.py).
 */
import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { PlanSchema } from '@plumb/core';
import { reconstruct, resetReconstructCounter } from '../src/reconstruct.js';
import fixtureJson from '../../../fixtures/twoBed.plan.json';

const CLI = new URL('../../../services/convert/cli.py', import.meta.url).pathname;

function run(cmd: string, input: string | Uint8Array, binary: true): Uint8Array;
function run(cmd: string, input: string | Uint8Array, binary?: false): string;
function run(cmd: string, input: string | Uint8Array, binary = false): string | Uint8Array {
  const out = execFileSync('python3', [CLI, cmd], { input, maxBuffer: 32 * 1024 * 1024, timeout: 120_000 });
  return binary ? out : out.toString('utf-8');
}

function fixturePlan(): { levels: Array<Record<string, unknown>> } {
  return PlanSchema.parse(fixtureJson) as unknown as { levels: Array<Record<string, unknown>> };
}

describe('dxf export', () => {
  it('audits clean under ezdxf with R2013/mm headers', () => {
    const dxf = run('dxf', JSON.stringify(fixtureJson));
    expect(dxf).toContain('$ACADVER');
    expect(dxf).toContain('AC1027');
    expect(dxf).toContain('$INSUNITS');
    const audit = run('audit', dxf);
    expect(audit.split('\n')[0]).toBe('errors=0');
  });

  it('uses the AIA layers and flips y / negates rotation', () => {
    const dxf = run('dxf', JSON.stringify(fixtureJson));
    for (const layer of ['A-WALL', 'A-DOOR', 'A-GLAZ', 'A-FURN', 'A-FLOR', 'A-AREA', 'A-ANNO-TEXT', 'A-ANNO-DIMS']) {
      expect(dxf).toContain(layer);
    }
    const plan = fixturePlan();
    const level = plan.levels[0] as unknown as {
      items: Array<{ x: number; y: number; rot: number }>;
      openings: Array<{ kind: string }>;
    };
    // Every furniture INSERT is present; y is negated in the DXF body.
    const item = level.items[0] as { x: number; y: number; rot: number };
    expect(dxf).toContain('FURN_');
    expect(dxf).toContain(`${item.x.toFixed(1)}`);
    expect(dxf).toContain(`${(-item.y).toFixed(1)}`);
    const doors = level.openings.filter((o) => o.kind === 'door').length;
    const wins = level.openings.filter((o) => o.kind === 'window').length;
    expect((dxf.match(/DOOR_/g) ?? []).length).toBeGreaterThanOrEqual(doors);
    expect((dxf.match(/WIN_/g) ?? []).length).toBeGreaterThanOrEqual(wins);
    // Paper-space layout + real dimensions.
    expect(dxf).toContain('A3_1-50');
    expect(dxf).toContain('DIMENSION');
  });

  it('carries PLUMB XDATA on every semantic entity', () => {
    const dxf = run('dxf', JSON.stringify(fixtureJson));
    const plan = fixturePlan();
    const level = plan.levels[0] as unknown as { walls: unknown[]; openings: unknown[]; rooms: unknown[]; items: unknown[] };
    const count = level.walls.length + level.openings.length + level.rooms.length + level.items.length;
    expect((dxf.match(/PLUMB/g) ?? []).length).toBeGreaterThanOrEqual(count);
  });
});

describe('dxf import round trip', () => {
  it('parse(export(plan)) recovers walls, openings, rooms and items exactly', () => {
    const dxf = run('dxf', JSON.stringify(fixtureJson));
    const doc = JSON.parse(run('parse', dxf)) as {
      insunits: number;
      plumbEntities: { walls: unknown[]; openings: unknown[]; rooms: unknown[]; items: unknown[] };
    };
    expect(doc.insunits).toBe(4);
    const plan = fixturePlan();
    const level = plan.levels[0] as unknown as Record<string, unknown>;
    expect(doc.plumbEntities.walls).toEqual(level.walls);
    expect(doc.plumbEntities.openings).toEqual(level.openings);
    expect(doc.plumbEntities.rooms).toEqual(level.rooms);
    expect(doc.plumbEntities.items).toEqual(level.items);
  });

  it('reconstruct() of a Plumb-authored file yields confidence-1 add ops', () => {
    resetReconstructCounter();
    const dxf = run('dxf', JSON.stringify(fixtureJson));
    const doc = JSON.parse(run('parse', dxf)) as Parameters<typeof reconstruct>[0];
    const res = reconstruct(doc);
    expect(res.underlay).toEqual([]);
    expect(res.unmapped).toEqual([]);
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items.every((i) => i.confidence === 1 && i.onByDefault)).toBe(true);
    const kinds = res.items.map((i) => i.op.op).sort();
    expect(kinds).toContain('wall.add');
    expect(kinds).toContain('room.add');
    expect(kinds).toContain('opening.add');
    expect(kinds).toContain('item.add');
  });
});

describe('ifc export', () => {
  it('emits structurally sound IFC4 with the spec mapping table', () => {
    const ifc = run('ifc', JSON.stringify(fixtureJson));
    expect(ifc.startsWith('ISO-10303-21;')).toBe(true);
    expect(ifc).toContain("FILE_SCHEMA(('IFC4'))");
    const count = (t: string): number => ifc.split(t).length - 1;
    const plan = fixturePlan();
    const level = plan.levels[0] as unknown as {
      walls: unknown[];
      openings: Array<{ kind: string }>;
      rooms: Array<{ name: string; floor: string; rect: { w: number; h: number } }>;
      items: unknown[];
    };
    expect(count('IFCWALL(')).toBe(level.walls.length);
    expect(count('IFCOPENINGELEMENT(')).toBe(level.openings.length);
    expect(count('IFCDOOR(')).toBe(level.openings.filter((o) => o.kind === 'door').length);
    expect(count('IFCWINDOW(')).toBe(level.openings.filter((o) => o.kind === 'window').length);
    expect(count('IFCSPACE(')).toBe(level.rooms.length);
    expect(count('IFCFURNITURE(')).toBe(level.items.length);
    expect(count('Qto_SpaceBaseQuantities')).toBeGreaterThanOrEqual(level.rooms.length);
    // Areas + finishes survive.
    for (const r of level.rooms) {
      expect(ifc).toContain((r.rect.w * r.rect.h / 1e6).toFixed(1));
      expect(ifc).toContain(r.floor);
      expect(ifc).toContain(r.name.replace("'", "''"));
    }
    // Entity numbering sequential, refs resolve, parens balance.
    const lines = ifc.split('\n').filter((l) => l.startsWith('#'));
    expect(lines.length).toBeGreaterThan(100);
    const refs = [...ifc.matchAll(/#(\d+)/g)].map((m) => Number(m[1]));
    expect(refs.every((n) => n >= 1 && n <= lines.length)).toBe(true);
    expect(lines.every((l) => l.split('(').length === l.split(')').length)).toBe(true);
    expect(ifc.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true);
  });
});
