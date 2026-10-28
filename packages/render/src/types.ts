/** Store contract the renderer reads (a Zustand store satisfies it structurally). */
import type { Finish, Item, Level, Mm, Proposal, Vec } from '@plumb/core';

export interface ViewState {
  /** world→screen: sx = (wx - x) * s */
  x: Mm;
  y: Mm;
  /** px per mm */
  s: number;
}

export type Selection =
  | { type: 'item'; id: string }
  | { type: 'wall'; id: string }
  | { type: 'room'; id: string }
  | { type: 'door'; id: string }
  | { type: 'window'; id: string };

export interface WallDraft {
  a: Vec;
  cur: Vec | null;
}

export interface MeasureState {
  a: Vec;
  b: Vec | null;
}

export interface AgentViewState {
  proposal: Proposal | null;
  marks: { x: Mm; y: Mm }[];
  flash: { roomIds: string[]; until: number } | null;
}

export interface UiState {
  selection: Selection | null;
  hover: Selection | null;
  unit: 'm' | 'ft';
  draft: WallDraft | null;
  measure: MeasureState | null;
  cursor: Vec | null;
  /** True while the user is dragging an item; turns the outline pen-red on conflict. */
  dragging: boolean;
  /** Read-only grey DXF-import underlay (SPEC §11); never exported. */
  underlay?: Vec[][];
}

export interface RendererState {
  level: Level;
  view: ViewState;
  ui: UiState;
  agent: AgentViewState;
}

export interface PlumbStore {
  getState(): RendererState;
  subscribe(fn: () => void): () => void;
  /** Narrow mutation for hot paths (pan/zoom). */
  setView(view: ViewState): void;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export type FinishName = Finish;
export type { Item, Level, Vec, Proposal, Mm };
