/** Shared agent types. Both the fallback and the LLM agent implement `Agent`. */
import type { Issue, Level, Proposal } from '@plumb/core';

export interface AgentSelection {
  type: 'item' | 'wall' | 'room' | 'door' | 'window';
  id: string;
}

export interface AgentContext {
  level: Level;
  issues: Issue[];
  selection: AgentSelection | null;
  unit: 'm' | 'ft';
  /** True when there is a history entry to undo (fallback `undo` intent). */
  canUndo: boolean;
}

export type AgentEvent =
  | { type: 'step'; name: string; summary: string; status: 'run' | 'done' }
  | { type: 'text'; delta: string }
  | { type: 'table'; rows: string[][] }
  | { type: 'proposal'; proposal: Proposal }
  | { type: 'marks'; marks: Array<{ x: number; y: number }> }
  | { type: 'flash'; roomIds: string[] }
  | { type: 'chips'; chips: string[] }
  | { type: 'undo-request' }
  | { type: 'done' };

export interface Agent {
  respond(text: string, ctx: AgentContext): AsyncIterable<AgentEvent>;
}

export const DEFAULT_CHIPS = ['Show areas', 'Add a plant to Bedroom 2', 'Swap Bedroom 1 floor to oak'];
