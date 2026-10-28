/**
 * App store (SPEC §3): plan + history + view + ui + agent.
 * Zustand + Immer. Hot paths (drag/pan/zoom) call `set` directly with no
 * React re-render in between; the renderer reads through `rendererStore`.
 */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import {
  applyOps,
  fmtArea,
  runChecks,
  type HistoryEntry,
  type Issue,
  type Level,
  type Op,
  type Plan,
  type Proposal,
  type Vec,
} from '@plumb/core';
import type { PlumbStore, RendererState, Selection, ViewState } from '@plumb/render';
import fixtureJson from '../../../fixtures/twoBed.plan.json';
import { PlanSchema } from '@plumb/core';

export type Tool = 'select' | 'pan' | 'wall' | 'door' | 'window' | 'measure' | 'library';

export interface AgentStep {
  name: string;
  summary: string;
}
export interface AgentMessage {
  id: string;
  role: 'user' | 'agent';
  text: string;
  steps?: AgentStep[];
  table?: string[][];
  proposalId?: string | null;
}
export interface Toast {
  id: string;
  text: string;
}

export interface UiState {
  tool: Tool;
  selection: Selection | null;
  hover: Selection | null;
  draft: { a: Vec; cur: Vec | null } | null;
  measure: { a: Vec; b: Vec | null } | null;
  cursor: Vec | null;
  dragging: boolean;
  snap: boolean;
  unit: 'm' | 'ft';
  theme: 'system' | 'light' | 'dark';
  spacePan: boolean;
  /** Read-only grey DXF-import underlay (SPEC §11); never exported. */
  underlay: Vec[][];
}

export interface AgentState {
  messages: AgentMessage[];
  busy: boolean;
  proposal: Proposal | null;
  marks: Array<{ x: number; y: number }>;
  flash: { roomIds: string[]; until: number } | null;
  chips: string[];
}

interface AppState {
  plan: Plan;
  history: { undo: HistoryEntry[]; redo: HistoryEntry[] };
  view: ViewState;
  ui: UiState;
  agent: AgentState;
  toasts: Toast[];
}

function loadFixturePlan(): Plan {
  return PlanSchema.parse(fixtureJson);
}

function levelOf(plan: Plan): Level {
  const level = plan.levels[0];
  if (!level) throw new Error('plan has no levels');
  return level;
}

function selectionAlive(plan: Plan, sel: Selection | null): Selection | null {
  if (!sel) return null;
  const level = levelOf(plan);
  const exists =
    sel.type === 'item'
      ? level.items.some((i) => i.id === sel.id)
      : sel.type === 'wall'
        ? level.walls.some((w) => w.id === sel.id)
        : sel.type === 'room'
          ? level.rooms.some((r) => r.id === sel.id)
          : level.openings.some((o) => o.id === sel.id);
  return exists ? sel : null;
}

export const useApp = create<AppState>(() => ({
  plan: loadFixturePlan(),
  history: { undo: [], redo: [] },
  view: { x: 0, y: 0, s: 0.067 },
  ui: {
    tool: 'select',
    selection: null,
    hover: null,
    draft: null,
    measure: null,
    cursor: null,
    dragging: false,
    snap: true,
    unit: 'm',
    theme: 'system',
    spacePan: false,
    underlay: [],
  },
  agent: { messages: [], busy: false, proposal: null, marks: [], flash: null, chips: [] },
  toasts: [],
}));

// ---------------------------------------------------------------------------
// Narrow mutation API for hot paths + tools
// ---------------------------------------------------------------------------

export function getLevel(): Level {
  return levelOf(useApp.getState().plan);
}

/** Apply ops to the plan. When `commit` is true, push one history entry. */
export function applyOpsToPlan(ops: Op[], label: string, source: HistoryEntry['source'], commit: boolean): boolean {
  const state = useApp.getState();
  const level = levelOf(state.plan);
  let next: Level;
  let inverse: Op[];
  try {
    ({ level: next, inverse } = applyOps(level, ops));
  } catch {
    return false;
  }
  const levels = state.plan.levels.map((l, i) => (i === 0 ? next : l));
  const entry: HistoryEntry | null = commit ? { id: `h_${nanoid(6)}`, label, ops, inverse, source } : null;
  useApp.setState((s) => ({
    plan: { ...s.plan, levels },
    history: entry
      ? { undo: [...s.history.undo.slice(-199), entry], redo: [] }
      : s.history,
    ui: { ...s.ui, selection: selectionAlive({ ...s.plan, levels }, s.ui.selection) },
  }));
  return true;
}

/** Silent plan swap used mid-drag (history is pushed once at pointer-up). */
export function setPlanLevelSilent(level: Level): void {
  useApp.setState((s) => ({ plan: { ...s.plan, levels: s.plan.levels.map((l, i) => (i === 0 ? level : l)) } }));
}

export function pushHistoryEntry(entry: HistoryEntry): void {
  useApp.setState((s) => ({ history: { undo: [...s.history.undo.slice(-199), entry], redo: [] } }));
}

export function doUndo(): boolean {
  const state = useApp.getState();
  const entry = state.history.undo[state.history.undo.length - 1];
  if (!entry) return false;
  try {
    const { level } = applyOps(levelOf(state.plan), entry.inverse);
    const levels = state.plan.levels.map((l, i) => (i === 0 ? level : l));
    useApp.setState((s) => ({
      plan: { ...s.plan, levels },
      history: { undo: s.history.undo.slice(0, -1), redo: [...s.history.redo, entry] },
      ui: { ...s.ui, selection: selectionAlive({ ...s.plan, levels }, s.ui.selection) },
    }));
    // Mark an applied proposal undone when its entry leaves the stack.
    const p = useApp.getState().agent.proposal;
    if (p && p.status === 'applied' && entry.label.includes(p.title)) {
      setProposal({ ...p, status: 'undone' });
    }
    return true;
  } catch {
    return false;
  }
}

export function doRedo(): boolean {
  const state = useApp.getState();
  const entry = state.history.redo[state.history.redo.length - 1];
  if (!entry) return false;
  try {
    const { level } = applyOps(levelOf(state.plan), entry.ops);
    const levels = state.plan.levels.map((l, i) => (i === 0 ? level : l));
    useApp.setState((s) => ({
      plan: { ...s.plan, levels },
      history: { undo: [...s.history.undo, entry], redo: s.history.redo.slice(0, -1) },
      ui: { ...s.ui, selection: selectionAlive({ ...s.plan, levels }, s.ui.selection) },
    }));
    return true;
  } catch {
    return false;
  }
}

export function setView(view: ViewState): void {
  useApp.setState({ view });
}

export function patchUi(patch: Partial<UiState>): void {
  useApp.setState((s) => ({ ui: { ...s.ui, ...patch } }));
}

export function postMessage(msg: Omit<AgentMessage, 'id'>): string {
  const id = `m_${nanoid(6)}`;
  useApp.setState((s) => ({ agent: { ...s.agent, messages: [...s.agent.messages, { ...msg, id }] } }));
  return id;
}

export function appendMessageText(id: string, delta: string): void {
  useApp.setState((s) => ({
    agent: {
      ...s.agent,
      messages: s.agent.messages.map((m) => (m.id === id ? { ...m, text: m.text + delta } : m)),
    },
  }));
}

export function appendMessageStep(id: string, step: AgentStep): void {
  useApp.setState((s) => ({
    agent: {
      ...s.agent,
      messages: s.agent.messages.map((m) => (m.id === id ? { ...m, steps: [...(m.steps ?? []), step] } : m)),
    },
  }));
}

export function attachMessageTable(id: string, table: string[][]): void {
  useApp.setState((s) => ({
    agent: {
      ...s.agent,
      messages: s.agent.messages.map((m) => (m.id === id ? { ...m, table } : m)),
    },
  }));
}

export function attachMessageProposal(id: string, proposalId: string): void {
  useApp.setState((s) => ({
    agent: {
      ...s.agent,
      messages: s.agent.messages.map((m) => (m.id === id ? { ...m, proposalId } : m)),
    },
  }));
}

export function setBusy(busy: boolean): void {
  useApp.setState((s) => ({ agent: { ...s.agent, busy } }));
}

export function setChips(chips: string[]): void {
  useApp.setState((s) => ({ agent: { ...s.agent, chips } }));
}

export function setMarks(marks: Array<{ x: number; y: number }>): void {
  useApp.setState((s) => ({ agent: { ...s.agent, marks } }));
}

export function setFlash(roomIds: string[] | null): void {
  useApp.setState((s) => ({ agent: { ...s.agent, flash: roomIds ? { roomIds, until: Date.now() + 3500 } : null } }));
}

export function setUnderlay(underlay: Vec[][]): void {
  useApp.setState((s) => ({ ui: { ...s.ui, underlay } }));
}

/** Only one proposal may be pending; a newer one supersedes the older. */
export function setProposal(p: Proposal | null): void {
  useApp.setState((s) => {
    const old = s.agent.proposal;
    const next =
      old && old.status === 'pending' && (!p || p.id !== old.id) ? { ...old, status: 'superseded' as const } : old;
    void next;
    return { agent: { ...s.agent, proposal: p } };
  });
}

export function toast(text: string): void {
  const id = `t_${nanoid(6)}`;
  useApp.setState((s) => ({ toasts: [...s.toasts, { id, text }] }));
  window.setTimeout(() => {
    useApp.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  }, 3200);
}

export function replacePlan(plan: Plan): void {
  const checked = PlanSchema.parse(plan);
  useApp.setState((s) => ({
    plan: checked,
    history: { undo: [], redo: [] },
    ui: { ...s.ui, selection: null, hover: null, draft: null, measure: null, underlay: [] },
    agent: { messages: [], busy: false, proposal: null, marks: [], flash: null, chips: [] },
  }));
}

export function planSummary(plan: Plan): { area: string; rooms: number; items: number } {
  const level = levelOf(plan);
  const area = level.rooms.reduce((s, r) => s + r.rect.w * r.rect.h, 0);
  return { area: fmtArea(area, useApp.getState().ui.unit), rooms: level.rooms.length, items: level.items.length };
}

export function currentIssues(): Issue[] {
  return runChecks(getLevel());
}

// ---------------------------------------------------------------------------
// Renderer adapter: projects the app state onto the RendererState contract.
// ---------------------------------------------------------------------------

export function rendererStore(): PlumbStore {
  return {
    getState(): RendererState {
      const s = useApp.getState();
      return {
        level: levelOf(s.plan),
        view: s.view,
        ui: {
          selection: s.ui.selection,
          hover: s.ui.hover,
          unit: s.ui.unit,
          draft: s.ui.draft,
          measure: s.ui.measure,
          cursor: s.ui.cursor,
          dragging: s.ui.dragging,
          underlay: s.ui.underlay,
        },
        agent: { proposal: s.agent.proposal, marks: s.agent.marks, flash: s.agent.flash },
      };
    },
    subscribe(fn: () => void): () => void {
      return useApp.subscribe(fn);
    },
    setView,
  };
}

export { loadFixturePlan };
