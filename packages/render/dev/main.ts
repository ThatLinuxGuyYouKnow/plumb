/* Dev harness: proves M2 parity (pan, zoom, fit, theme, ghosts) outside React. */
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '../src/tokens.css';
import './dev.css';
import fixtureJson from '../../../fixtures/twoBed.plan.json';
import { PlanSchema, runChecks, suggestNudge, type Level, type Op, type Proposal } from '@plumb/core';
import { attachViewGestures, createRenderer } from '../src/index.js';
import type { PlumbStore, RendererState, ViewState } from '../src/index.js';

const h = document.querySelector<HTMLDivElement>('#stage') as HTMLDivElement;
const cv = document.querySelector<HTMLCanvasElement>('#cv') as HTMLCanvasElement;

function loadLevel(): Level {
  const plan = PlanSchema.parse(fixtureJson);
  const level = plan.levels[0];
  if (!level) throw new Error('fixture has no levels');
  return level;
}

class HarnessStore implements PlumbStore {
  private state: RendererState;
  private listeners: Array<() => void> = [];

  constructor(level: Level) {
    this.state = {
      level,
      view: { x: 0, y: 0, s: 0.067 },
      ui: { selection: null, hover: null, unit: 'm', draft: null, measure: null, cursor: null, dragging: false },
      agent: { proposal: null, marks: [], flash: null },
    };
  }

  getState(): RendererState {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  setView(view: ViewState): void {
    this.state = { ...this.state, view };
    this.emit();
  }

  patch(patch: Partial<RendererState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

const store = new HarnessStore(loadLevel());

// On-load parity state, like the prototype: pending proposal (desk fix) + issue mark.
function bootProposal(): void {
  const level = store.getState().level;
  const issues = runChecks(level);
  const desk = issues[0] ? level.items.find((i) => i.id === issues[0]?.itemIds[0]) : undefined;
  const marks = issues.map((i) => {
    const item = level.items.find((x) => x.id === i.itemIds[0]);
    return { x: item?.x ?? 0, y: item?.y ?? 0 };
  });
  let proposal: Proposal | null = null;
  if (desk) {
    const spot = suggestNudge(desk, level);
    if (spot) {
      const ops: Op[] = [{ op: 'item.update', id: desk.id, patch: { x: spot.x, y: spot.y } }];
      proposal = { id: 'p_demo', title: `Move ${desk.label}`, ops, status: 'pending', summary: ['Move the desk clear of the door swing'] };
    }
  }
  store.patch({ agent: { proposal, marks, flash: null } });
}
bootProposal();

const renderer = createRenderer(cv, store);
attachViewGestures(cv, store);

// Controls.
const themeBtn = document.querySelector('#theme') as HTMLButtonElement;
const unitBtn = document.querySelector('#unit') as HTMLButtonElement;
const fitBtn = document.querySelector('#fit') as HTMLButtonElement;
const ghostBtn = document.querySelector('#ghost') as HTMLButtonElement;

if (new URLSearchParams(location.search).get('theme') === 'dark') {
  document.documentElement.dataset.theme = 'dark';
}
themeBtn.addEventListener('click', () => {
  const root = document.documentElement;
  const dark =
    root.dataset.theme === 'dark' ||
    (!root.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  root.dataset.theme = dark ? 'light' : 'dark';
});
unitBtn.addEventListener('click', () => {
  const unit = store.getState().ui.unit === 'm' ? 'ft' : 'm';
  store.patch({ ui: { ...store.getState().ui, unit } });
});
fitBtn.addEventListener('click', () => renderer.fit());
ghostBtn.addEventListener('click', () => {
  const agent = store.getState().agent;
  store.patch({ agent: { ...agent, proposal: agent.proposal ? null : bootGhost() } });
});

function bootGhost(): Proposal | null {
  const level = store.getState().level;
  const desk = level.items.find((i) => i.id === 'i_desk');
  if (!desk) return null;
  return {
    id: 'p_ghost',
    title: 'Move Desk',
    ops: [{ op: 'item.update', id: desk.id, patch: { x: 8500 } }],
    status: 'pending',
    summary: ['Move the desk 0.20 m east'],
  };
}

void h;
