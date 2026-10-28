import { describe, expect, it } from 'vitest';
import {
  applyOpsToPlan,
  doRedo,
  doUndo,
  getLevel,
  replacePlan,
  loadFixturePlan,
  useApp,
} from '../src/store.js';

describe('store history', () => {
  it('commits one entry per op batch and undoes/redoes it', () => {
    replacePlan(loadFixturePlan());
    const before = getLevel().items.find((i) => i.id === 'i_desk');
    if (!before) throw new Error('no desk');
    expect(useApp.getState().history.undo).toHaveLength(0);

    const ok = applyOpsToPlan([{ op: 'item.update', id: 'i_desk', patch: { x: 8500 } }], 'Move Desk', 'user', true);
    expect(ok).toBe(true);
    expect(getLevel().items.find((i) => i.id === 'i_desk')?.x).toBe(8500);
    expect(useApp.getState().history.undo).toHaveLength(1);

    expect(doUndo()).toBe(true);
    expect(getLevel().items.find((i) => i.id === 'i_desk')?.x).toBe(before.x);
    expect(doRedo()).toBe(true);
    expect(getLevel().items.find((i) => i.id === 'i_desk')?.x).toBe(8500);

    // A new entry clears the redo stack.
    applyOpsToPlan([{ op: 'item.update', id: 'i_desk', patch: { x: 8600 } }], 'Move Desk', 'user', true);
    expect(useApp.getState().history.redo).toHaveLength(0);
    replacePlan(loadFixturePlan());
  });

  it('rejects invalid batches without touching the plan', () => {
    replacePlan(loadFixturePlan());
    const snapshot = JSON.stringify(getLevel());
    const ok = applyOpsToPlan([{ op: 'item.update', id: 'missing', patch: { x: 1 } }], 'Bad', 'user', true);
    expect(ok).toBe(false);
    expect(JSON.stringify(getLevel())).toBe(snapshot);
    expect(useApp.getState().history.undo).toHaveLength(0);
  });

  it('selection clears when the selected entity is removed', () => {
    replacePlan(loadFixturePlan());
    useApp.setState((s) => ({ ui: { ...s.ui, selection: { type: 'item', id: 'i_desk' } } }));
    applyOpsToPlan([{ op: 'item.remove', id: 'i_desk' }], 'Remove Desk', 'user', true);
    expect(useApp.getState().ui.selection).toBeNull();
    expect(doUndo()).toBe(true);
    replacePlan(loadFixturePlan());
  });
});
