import { describe, expect, it } from 'vitest';
import { ALL_CHECKS, runChecks } from '../src/checks.js';
import { applyOps } from '../src/ops.js';
import type { Op } from '../src/schemas.js';
import { conflictsOf, hasConflict, suggestNudge } from '../src/suggest.js';
import { loadLevel } from './fixture.js';

describe('checks on the twoBed fixture (SPEC §13)', () => {
  it('returns exactly one issue: door-swing, Desk vs door d3 (Bedroom 2)', () => {
    const level = loadLevel();
    const issues = runChecks(level);
    expect(issues).toHaveLength(1);
    const issue = issues[0];
    if (!issue) throw new Error('expected one issue');
    expect(issue.check).toBe('door-swing');
    expect(issue.severity).toBe('error');
    expect(issue.itemIds).toContain('i_desk');
    expect(issue.itemIds).toContain('d3');
    expect(issue.message).toContain('Desk');
    expect(issue.message).toContain('Bedroom 2');
  });

  it('stays at one issue when all checks run (passage also flags the desk)', () => {
    const level = loadLevel();
    const issues = runChecks(level, { checks: ALL_CHECKS });
    const errors = issues.filter((i) => i.severity === 'error');
    const warns = issues.filter((i) => i.severity === 'warn');
    expect(errors).toHaveLength(1);
    expect(errors[0]?.check).toBe('door-swing');
    // The desk also stands in the doorway approach: one passage warn, nothing else.
    expect(warns).toHaveLength(1);
    expect(warns[0]?.check).toBe('passage');
    expect(warns[0]?.itemIds).toContain('i_desk');
  });

  it('suggestNudge(desk) returns (+200, 0) mm', () => {
    const level = loadLevel();
    const desk = level.items.find((i) => i.id === 'i_desk');
    if (!desk) throw new Error('missing desk');
    expect(suggestNudge(desk, level)).toEqual({ x: 8500, y: 3440 });
  });

  it('applying the nudge clears every check', () => {
    const level = loadLevel();
    const desk = level.items.find((i) => i.id === 'i_desk');
    if (!desk) throw new Error('missing desk');
    const spot = suggestNudge(desk, level);
    if (!spot) throw new Error('expected a nudge');
    const ops: Op[] = [{ op: 'item.update', id: desk.id, patch: { x: spot.x, y: spot.y } }];
    const { level: after } = applyOps(level, ops);
    expect(runChecks(after)).toHaveLength(0);
    expect(runChecks(after, { checks: ALL_CHECKS })).toHaveLength(0);
    const moved = after.items.find((i) => i.id === 'i_desk');
    if (!moved) throw new Error('desk vanished');
    expect(hasConflict(conflictsOf(after, moved))).toBe(false);
  });
});
