import { describe, expect, it } from 'vitest';
import { PlanSchema } from '@plumb/core';
import { FallbackAgent } from '../src/fallback.js';
import { executeTool } from '../src/tools.js';
import type { AgentContext, AgentEvent } from '../src/types.js';
import fixtureJson from '../../../fixtures/twoBed.plan.json';

function ctx(): AgentContext {
  const plan = PlanSchema.parse(fixtureJson);
  const level = plan.levels[0];
  if (!level) throw new Error('no level');
  return { level, issues: [], selection: null, unit: 'm', canUndo: false };
}

async function collect(text: string, c: AgentContext): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of new FallbackAgent().respond(text, c)) out.push(e);
  return out;
}

describe('fallback agent', () => {
  it('answers check with steps, marks and a fix proposal', async () => {
    const events = await collect('check the plan for issues', ctx());
    expect(events.some((e) => e.type === 'step')).toBe(true);
    expect(events.some((e) => e.type === 'marks')).toBe(true);
    const prop = events.find((e) => e.type === 'proposal');
    expect(prop?.type === 'proposal' ? prop.proposal.ops : []).toHaveLength(1);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('reports areas as a table and flashes rooms', async () => {
    const events = await collect('show areas', ctx());
    expect(events.some((e) => e.type === 'table')).toBe(true);
    expect(events.some((e) => e.type === 'flash')).toBe(true);
  });

  it('proposes adding a plant to Bedroom 2', async () => {
    const events = await collect('add a plant to Bedroom 2', ctx());
    const prop = events.find((e) => e.type === 'proposal');
    if (prop?.type !== 'proposal') throw new Error('no proposal');
    expect(prop.proposal.ops[0]?.op).toBe('item.add');
  });

  it('asks for undo when nothing to undo', async () => {
    const events = await collect('undo that', ctx());
    expect(events.some((e) => e.type === 'text' && e.delta.includes('nothing to undo'))).toBe(true);
  });

  it('requests undo when history exists', async () => {
    const events = await collect('undo', { ...ctx(), canUndo: true });
    expect(events.some((e) => e.type === 'undo-request')).toBe(true);
  });

  it('helps on unknown input', async () => {
    const events = await collect('blargh wibble', ctx());
    expect(events.some((e) => e.type === 'text' && e.delta.includes('I did not catch that'))).toBe(true);
  });
});

describe('agent tools', () => {
  it('propose_edit dry-runs and reports issuesAfter', () => {
    const c = ctx();
    const res = executeTool(
      'propose_edit',
      { title: 'Move desk', ops: [{ op: 'item.update', id: 'i_desk', patch: { x: 8500 } }] },
      { level: c.level },
    );
    if (!res.ok) throw new Error('tool failed');
    const data = res.data as { valid: boolean; issuesAfter: unknown[]; proposal?: { summary: string[] } };
    expect(data.valid).toBe(true);
    expect(data.proposal?.summary).toHaveLength(1);
  });

  it('propose_edit rejects invalid ops with errors', () => {
    const c = ctx();
    const res = executeTool('propose_edit', { title: 'Bad', ops: [{ op: 'item.update', id: 'nope', patch: { x: 1 } }] }, {
      level: c.level,
    });
    if (!res.ok) throw new Error('tool failed');
    const data = res.data as { valid: boolean; errors?: string[] };
    expect(data.valid).toBe(false);
    expect(data.errors?.length).toBeGreaterThan(0);
  });

  it('propose_edit normalizes the ways models serialize ops', () => {
    const c = ctx();
    const op = {
      op: 'room.add',
      room: { id: 'r_lobby', name: 'Lobby', rect: { x: 0, y: 0, w: 6000, h: 4500 }, floor: 'tile' },
    };
    const variants: Array<[string, unknown]> = [
      ['JSON string of the array', JSON.stringify([op])],
      ['single op object', op],
      ['array of JSON-encoded op strings', [JSON.stringify(op)]],
      ['object wrapping an ops array', { ops: [op] }],
    ];
    for (const [name, ops] of variants) {
      const res = executeTool('propose_edit', { title: 'Add lobby', ops }, { level: c.level });
      if (!res.ok) throw new Error(`${name}: tool failed: ${res.error}`);
      const data = res.data as { valid: boolean; proposal?: { ops: unknown[]; summary: string[] } };
      expect(data.valid, name).toBe(true);
      expect(data.proposal?.ops, name).toHaveLength(1);
      expect(data.proposal?.summary[0], name).toContain('Lobby');
    }
  });

  it('propose_edit reports where the shape went wrong, not just "invalid input"', () => {
    const c = ctx();
    const missing = executeTool('propose_edit', { ops: [] }, { level: c.level });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain('title');
    const junk = executeTool('propose_edit', { title: 'Bad', ops: 42 }, { level: c.level });
    expect(junk.ok).toBe(false);
    if (!junk.ok) expect(junk.error).toContain('ops must be an array');
  });

  it('find_space finds a plant spot in bed2', () => {
    const c = ctx();
    const bed2 = c.level.rooms.find((r) => r.id === 'bed2');
    if (!bed2) throw new Error('no bed2');
    const res = executeTool('find_space', { roomId: bed2.id, type: 'plant' }, { level: c.level });
    if (!res.ok) throw new Error('tool failed');
    expect(res.data).not.toBeNull();
  });
});
