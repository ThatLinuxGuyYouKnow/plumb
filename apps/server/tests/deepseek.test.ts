import { describe, expect, it } from 'vitest';
import { PlanSchema } from '@plumb/core';
import { handleAgent, type AgentRouteDeps } from '../src/agentRoute.js';
import { RateLimiter } from '../src/rateLimit.js';
import fixtureJson from '../../../fixtures/twoBed.plan.json';

function level(): unknown {
  const plan = PlanSchema.parse(fixtureJson);
  return plan.levels[0];
}

const DEEPSEEK = {
  getProvider: () => 'deepseek',
  getDeepSeekKey: () => 'ds-test-secret',
  getModel: () => 'deepseek-chat',
} satisfies Partial<AgentRouteDeps>;

function collect(
  body: unknown,
  deps?: Partial<AgentRouteDeps>,
  capture?: { url?: string; init?: RequestInit },
): Promise<{ status: number; events: Record<string, unknown>[] }> {
  const chunks: string[] = [];
  const limiter = new RateLimiter();
  const ctl = new AbortController();
  const fetchImpl = deps?.fetchImpl;
  return handleAgent(body, 'test-ip', ctl.signal, {
    limiter,
    ...deps,
    ...(fetchImpl
      ? {
          fetchImpl: (async (url: string, init?: RequestInit) => {
            if (capture) {
              capture.url = url;
              capture.init = init;
            }
            return (fetchImpl as typeof fetch)(url, init);
          }) as typeof fetch,
        }
      : {}),
  }, (s) => chunks.push(s)).then((r) => {
    const events = chunks
      .join('')
      .split('\n\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => JSON.parse(s.replace(/^data:\s*/, '')) as Record<string, unknown>);
    return { status: r.status, events };
  });
}

function chatWith(calls: Array<{ id: string; name: string; args: unknown }> | null, text: string): unknown {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: text,
          ...(calls ? { tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
        },
      },
    ],
  };
}

describe('deepseek provider', () => {
  it('runs the tool loop over /chat/completions with Bearer auth', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) return { ok: true, json: async () => chatWith([{ id: 'call1', name: 'run_checks', args: {} }], 'I will check.') };
      return { ok: true, json: async () => chatWith(null, 'No conflicts.') };
    }) as unknown as typeof fetch;
    const { status, events } = await collect({ message: 'check the plan', level: level() }, { ...DEEPSEEK, fetchImpl }, capture);
    expect(status).toBe(200);
    expect(capture.url).toBe('https://api.deepseek.com/chat/completions');
    expect((capture.init?.headers as Record<string, string>)?.authorization).toBe('Bearer ds-test-secret');
    const body = JSON.parse(String(capture.init?.body)) as { model: string; tools: unknown[] };
    expect(body.model).toBe('deepseek-chat');
    expect(body.tools).toHaveLength(6);
    expect(events.some((e) => e.event === 'step' && (e as { name?: string }).name === 'run_checks')).toBe(true);
    expect(events.some((e) => e.event === 'text')).toBe(true);
    expect(events[events.length - 1]?.event).toBe('done');
    expect(JSON.stringify(events)).not.toContain('ds-test-secret');
  });

  it('surfaces propose_edit as a pending proposal', async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) {
        return {
          ok: true,
          json: async () =>
            chatWith(
              [{ id: 'call1', name: 'propose_edit', args: { title: 'Add plant', ops: [{ op: 'item.add', item: { id: 'i_x1', type: 'plant', label: 'Plant', x: 5000, y: 1000, w: 400, d: 400, rot: 0 } }] } }],
              'Adding it now.',
            ),
        };
      }
      return { ok: true, json: async () => chatWith(null, 'Done.') };
    }) as unknown as typeof fetch;
    const { status, events } = await collect({ message: 'add a plant to Bedroom 2', level: level() }, { ...DEEPSEEK, fetchImpl });
    expect(status).toBe(200);
    const proposal = events.find((e) => e.event === 'proposal') as { proposal?: { title?: string; status?: string } } | undefined;
    expect(proposal?.proposal?.title).toBe('Add plant');
  });

  it('builds from an empty plan: room.add with ops sent as a JSON string, budget 8192', async () => {
    const capture: { init?: RequestInit } = {};
    const plan = PlanSchema.parse(fixtureJson);
    const l = plan.levels[0];
    if (!l) throw new Error('no level');
    const empty = { ...l, walls: [], openings: [], rooms: [], items: [] };
    // The exact failure mode seen live: `ops` arrives as a JSON string, not
    // an array (models double-stringify nested arrays under escaping).
    const room = { op: 'room.add', room: { id: 'r_lobby', name: 'Lobby', rect: { x: 0, y: 0, w: 6000, h: 4500 }, floor: 'tile' } };
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) {
        return {
          ok: true,
          json: async () => chatWith([{ id: 'call1', name: 'propose_edit', args: { title: 'Add lobby', ops: JSON.stringify([room]) } }], 'Building it.'),
        };
      }
      return { ok: true, json: async () => chatWith(null, 'Done.') };
    }) as unknown as typeof fetch;
    const { status, events } = await collect({ message: 'build a lobby', level: empty }, { ...DEEPSEEK, fetchImpl }, capture);
    expect(status).toBe(200);
    const body = JSON.parse(String(capture.init?.body)) as { max_tokens?: number };
    expect(body.max_tokens).toBe(8192);
    const proposal = events.find((e) => e.event === 'proposal') as { proposal?: { title?: string; ops?: unknown[]; status?: string } } | undefined;
    expect(proposal?.proposal?.title).toBe('Add lobby');
    expect(proposal?.proposal?.ops).toHaveLength(1);
    expect(proposal?.proposal?.status).toBe('pending');
  });

  it('feeds invalid arguments JSON back as an error and ends gracefully', async () => {
    let n = 0;
    const bodies: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      n += 1;
      if (n === 1) {
        return {
          ok: true,
          json: async () => ({
            choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'measure', arguments: '{broken' } }] } }],
          }),
        };
      }
      return { ok: true, json: async () => chatWith(null, 'Could not parse that.') };
    }) as unknown as typeof fetch;
    const { status, events } = await collect({ message: 'measure', level: level() }, { ...DEEPSEEK, fetchImpl });
    expect(status).toBe(200);
    const second = bodies[1] as { messages: Array<{ role: string; content: string }> };
    const toolMsg = second.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('invalid arguments JSON');
    expect(events[events.length - 1]?.event).toBe('done');
  });

  it('names the HTTP status when the provider rejects the key (401), then falls back', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 401,
      text: async () =>
        '{"error":{"message":"Authentication Fails, Your api key: ****c063 is invalid","type":"authentication_error","code":"invalid_request_error"}}',
    })) as unknown as typeof fetch;
    const { status, events } = await collect(
      { message: 'build a lobby', level: level() },
      { ...DEEPSEEK, fetchImpl },
    );
    expect(status).toBe(200);
    const text = events.filter((e) => e.event === 'text').map((e) => String(e.delta)).join('');
    expect(text).toContain('HTTP 401');
    expect(text).toContain('Authentication Fails');
    expect(text).toContain('local answer');
    expect(JSON.stringify(events)).not.toContain('ds-test-secret');
  });

  it('falls back without leaking the key when the model call fails', async () => {
    const { status, events } = await collect(
      { message: 'check the plan', level: level() },
      { ...DEEPSEEK, fetchImpl: (() => Promise.reject(new Error('down'))) as typeof fetch },
    );
    expect(status).toBe(200);
    const text = events.filter((e) => e.event === 'text').map((e) => String(e.delta)).join('');
    expect(text).toContain('local answer');
    expect(JSON.stringify(events)).not.toContain('ds-test-secret');
  });

  it('names DEEPSEEK_API_KEY when the key is missing, then falls back', async () => {
    const { status, events } = await collect(
      { message: 'hi', level: level() },
      { getProvider: () => 'deepseek', getDeepSeekKey: () => undefined },
    );
    expect(status).toBe(200);
    const text = events.filter((e) => e.event === 'text').map((e) => String(e.delta)).join('');
    expect(text).toContain('DEEPSEEK_API_KEY');
    expect(events[events.length - 1]?.event).toBe('done');
  });

  it('answers locally on an unknown provider', async () => {
    const { status, events } = await collect(
      { message: 'hi', level: level() },
      { getProvider: () => 'mystery' },
    );
    expect(status).toBe(200);
    const text = events.filter((e) => e.event === 'text').map((e) => String(e.delta)).join('');
    expect(text).toContain('Unknown PLUMB_PROVIDER');
    expect(events[events.length - 1]?.event).toBe('done');
  });
});
