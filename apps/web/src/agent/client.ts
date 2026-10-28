/**
 * Agent client: streams the fallback agent locally, or POSTs to /api/agent
 * (SSE) when the server is reachable. Falls back on network failure (SPEC §9).
 */
import { FallbackAgent, type AgentContext, type AgentEvent } from '@plumb/agent';
import { runChecks } from '@plumb/core';
import {
  appendMessageStep,
  appendMessageText,
  attachMessageProposal,
  attachMessageTable,
  doUndo,
  getLevel,
  postMessage,
  setBusy,
  setChips,
  setFlash,
  setMarks,
  setProposal,
  useApp,
} from '../store.js';

/**
 * Client budget for one agent request; matches the server's
 * `AGENT_TIMEOUT_MS` (apps/server). 35 s aborted multi-round from-scratch
 * builds mid-stream and dumped them into the local fallback.
 */
const AGENT_TIMEOUT_MS = 150_000;

function agentContext(): AgentContext {
  const s = useApp.getState();
  const level = getLevel();
  return {
    level,
    issues: runChecks(level),
    selection: s.ui.selection,
    unit: s.ui.unit,
    canUndo: s.history.undo.length > 0,
  };
}

async function* fallbackStream(text: string): AsyncIterable<AgentEvent> {
  yield* new FallbackAgent().respond(text, agentContext());
}

interface ServerEvent {
  event: 'step' | 'text' | 'table' | 'proposal' | 'marks' | 'flash' | 'chips' | 'done' | 'error';
  name?: string;
  summary?: string;
  status?: 'run' | 'done';
  delta?: string;
  rows?: string[][];
  proposal?: import('@plumb/core').Proposal;
  marks?: Array<{ x: number; y: number }>;
  roomIds?: string[];
  chips?: string[];
  message?: string;
}

async function* serverStream(text: string, signal: AbortSignal): AsyncIterable<AgentEvent> {
  const ctx = agentContext();
  const history = useApp
    .getState()
    .agent.messages.filter((m) => m.text.trim().length > 0)
    .slice(-20)
    .map((m) => ({ role: m.role === 'user' ? ('user' as const) : ('assistant' as const), text: m.text }));
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: text,
      level: ctx.level,
      selection: ctx.selection,
      unit: ctx.unit,
      history,
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`server ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const pump = async (): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx = buf.indexOf('\n\n');
      while (idx >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = chunk.split('\n').find((l) => l.startsWith('data:'));
        if (line) {
          const ev = JSON.parse(line.slice(5).trim()) as ServerEvent;
          pending.push(ev);
        }
        idx = buf.indexOf('\n\n');
      }
    }
  };
  const pending: ServerEvent[] = [];
  const pumpPromise = pump();
  try {
    for (;;) {
      if (pending.length) {
        const ev = pending.shift();
        if (ev) yield* mapServerEvent(ev);
        continue;
      }
      // Wait briefly for more data.
      await new Promise((r) => setTimeout(r, 30));
      if (pending.length) continue;
      // Check the pump is still alive by racing a flag.
      let settled = false;
      void pumpPromise.then(() => {
        settled = true;
      });
      await new Promise((r) => setTimeout(r, 0));
      if (settled && !pending.length) break;
      if (signal.aborted) break;
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
}

function* mapServerEvent(ev: ServerEvent): Generator<AgentEvent> {
  switch (ev.event) {
    case 'step':
      yield { type: 'step', name: ev.name ?? '', summary: ev.summary ?? '', status: ev.status ?? 'done' };
      break;
    case 'text':
      if (ev.delta) yield { type: 'text', delta: ev.delta };
      break;
    case 'table':
      if (ev.rows) yield { type: 'table', rows: ev.rows };
      break;
    case 'proposal':
      if (ev.proposal) yield { type: 'proposal', proposal: ev.proposal };
      break;
    case 'marks':
      if (ev.marks) yield { type: 'marks', marks: ev.marks };
      break;
    case 'flash':
      if (ev.roomIds) yield { type: 'flash', roomIds: ev.roomIds };
      break;
    case 'chips':
      if (ev.chips) yield { type: 'chips', chips: ev.chips };
      break;
    case 'error':
      yield { type: 'text', delta: ev.message ?? 'The model call failed; here is the local answer instead.' };
      break;
    case 'done':
      yield { type: 'done' };
      break;
  }
}

export async function sendMessage(text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed || useApp.getState().agent.busy) return;
  postMessage({ role: 'user', text: trimmed });
  const replyId = postMessage({ role: 'agent', text: '' });
  setBusy(true);
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), AGENT_TIMEOUT_MS);
  try {
    // Always try the server first: a sticky `serverOk = false` (set during a
    // restart blip or a timed-out build) silently pinned every later message
    // to the local fallback. The probe below recovers per message instead.
    const stream = withFallbackProbe(serverStream(trimmed, ctl.signal), trimmed);
    for await (const ev of stream) {
      applyEvent(replyId, ev);
      if (ev.type === 'done') break;
    }
  } finally {
    window.clearTimeout(timer);
    setBusy(false);
  }
}

/**
 * If the server stream throws before any event, switch to the fallback for
 * THIS message (never sticky — the next message retries the server, which
 * may only have been restarting or slow). Says so in the thread so a silent
 * downgrade can't masquerade as the agent's answer.
 */
async function* withFallbackProbe(
  stream: AsyncIterable<AgentEvent>,
  text: string,
): AsyncIterable<AgentEvent> {
  try {
    for await (const ev of stream) yield ev;
  } catch {
    yield { type: 'text', delta: 'The agent server did not respond; here is the local answer instead. ' };
    yield* fallbackStream(text);
  }
}

function applyEvent(replyId: string, ev: AgentEvent): void {
  switch (ev.type) {
    case 'step':
      if (ev.status === 'done') appendMessageStep(replyId, { name: ev.name, summary: ev.summary });
      break;
    case 'text':
      appendMessageText(replyId, ev.delta);
      break;
    case 'table':
      attachMessageTable(replyId, ev.rows);
      break;
    case 'proposal':
      setProposal(ev.proposal);
      attachMessageProposal(replyId, ev.proposal.id);
      break;
    case 'marks':
      setMarks(ev.marks);
      break;
    case 'flash':
      setFlash(ev.roomIds);
      break;
    case 'chips':
      setChips(ev.chips);
      break;
    case 'undo-request':
      doUndo();
      break;
    case 'done':
      break;
  }
}

/** Proactive check on open: local checks, no model call (SPEC §9). */
export async function proactiveCheck(): Promise<void> {
  const replyId = postMessage({ role: 'agent', text: '' });
  setBusy(true);
  try {
    for await (const ev of fallbackStream('check the plan for issues')) {
      applyEvent(replyId, ev);
      if (ev.type === 'done') break;
    }
  } finally {
    setBusy(false);
  }
}
