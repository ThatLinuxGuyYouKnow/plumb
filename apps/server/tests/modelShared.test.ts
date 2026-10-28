import { describe, expect, it } from 'vitest';
import { AGENT_TIMEOUT_MS } from '../src/agentRoute.js';
import { modelFailureHint, TOOL_DEFS } from '../src/modelShared.js';

describe('model failure hints', () => {
  it('extracts status + provider message from a 401 body', () => {
    const hint = modelFailureHint(
      new Error('model 401: {"error":{"message":"Authentication Fails, key invalid","code":"invalid_request_error"}}'),
    );
    expect(hint).toContain('HTTP 401');
    expect(hint).toContain('Authentication Fails');
  });

  it('names an abort as the time budget instead of "unreachable"', () => {
    const err = new Error('The operation was aborted.');
    err.name = 'AbortError';
    expect(modelFailureHint(err)).toContain('aborted');
    expect(modelFailureHint(err)).not.toContain('unreachable');
  });

  it('prefixes network failures without leaking anything else', () => {
    expect(modelFailureHint(new TypeError('fetch failed'))).toContain('network:');
    expect(modelFailureHint('boom')).toContain('boom');
  });
});

describe('agent time budget', () => {
  it('allows multi-round from-scratch builds (>= 60 s)', () => {
    expect(AGENT_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});

describe('propose_edit tool description', () => {
  it('shows the exact nested shapes that burned four model rounds', () => {
    const def = TOOL_DEFS.find((t) => t.name === 'propose_edit');
    if (!def) throw new Error('no propose_edit tool');
    // The live failure: model sent a top-level id on room.add instead of room.
    expect(def.description).toContain('"op":"room.add","room"');
    expect(def.description).toContain('"rect"');
    expect(def.description).toContain('"op":"wall.add","wall"');
    expect(def.description).toContain('"op":"opening.add","opening"');
    expect(def.description).toContain('"op":"item.add","item"');
  });
});
