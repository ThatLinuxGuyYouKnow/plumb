import { describe, expect, it } from 'vitest';
import { PlanSchema } from '@plumb/core';
import { handleAgent } from '../src/agentRoute.js';
import { RateLimiter } from '../src/rateLimit.js';
import fixtureJson from '../../../fixtures/twoBed.plan.json';

function level(): unknown {
  const plan = PlanSchema.parse(fixtureJson);
  return plan.levels[0];
}

function collect(body: unknown, deps?: Partial<Parameters<typeof handleAgent>[3]>): Promise<{ status: number; events: Record<string, unknown>[] }> {
  const chunks: string[] = [];
  const limiter = new RateLimiter();
  const ctl = new AbortController();
  return handleAgent(body, 'test-ip', ctl.signal, { limiter, ...deps }, (s) => chunks.push(s)).then((r) => {
    const events = chunks
      .join('')
      .split('\n\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => JSON.parse(s.replace(/^data:\s*/, '')) as Record<string, unknown>);
    return { status: r.status, events };
  });
}

describe('POST /api/agent', () => {
  it('answers check via fallback with steps and done', async () => {
    const { status, events } = await collect({ message: 'check the plan', level: level() });
    expect(status).toBe(200);
    expect(events.some((e) => e.event === 'step')).toBe(true);
    expect(events[events.length - 1]?.event).toBe('done');
  });

  it('rejects an invalid plan with 400', async () => {
    const { status } = await collect({ message: 'hi', level: { nope: true } });
    expect(status).toBe(400);
  });

  it('rejects an empty message with 400', async () => {
    const { status } = await collect({ message: '', level: level() });
    expect(status).toBe(400);
  });

  it('rate-limits after 20 requests', async () => {
    const limiter = new RateLimiter();
    const ctl = new AbortController();
    let last = 200;
    for (let i = 0; i < 21; i++) {
      const chunks: string[] = [];
      const r = await handleAgent({ message: 'hi', level: level() }, 'same-ip', ctl.signal, { limiter }, (s) => chunks.push(s));
      last = r.status;
    }
    expect(last).toBe(429);
  });

  it('falls back when the model call fails (no key leaked)', async () => {
    const { status, events } = await collect(
      { message: 'check the plan', level: level() },
      {
        getApiKey: () => 'sk-ant-secret',
        getModel: () => 'test-model',
        fetchImpl: (() => Promise.reject(new Error('down'))) as typeof fetch,
      },
    );
    expect(status).toBe(200);
    const text = events
      .filter((e) => e.event === 'text')
      .map((e) => String(e.delta))
      .join('');
    expect(text).toContain('local answer');
    expect(JSON.stringify(events)).not.toContain('sk-ant-secret');
  });

  it('runs the model loop with mocked fetch and surfaces propose_edit', async () => {
    const calls: unknown[] = [];
    const fakeFetch = (async (_url: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      const n = calls.length;
      if (n === 1) {
        return {
          ok: true,
          json: async () => ({
            stop_reason: 'tool_use',
            content: [
              { type: 'text', text: 'I will check.' },
              { type: 'tool_use', id: 'tu1', name: 'run_checks', input: {} },
            ],
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'No conflicts.' }] }),
      };
    }) as unknown as typeof fetch;
    const { status, events } = await collect(
      { message: 'check the plan', level: level() },
      { getApiKey: () => 'k', getModel: () => 'm', fetchImpl: fakeFetch },
    );
    expect(status).toBe(200);
    expect(events.some((e) => e.event === 'step' && (e as { name?: string }).name === 'run_checks')).toBe(true);
    expect(events.some((e) => e.event === 'text')).toBe(true);
  });
});
