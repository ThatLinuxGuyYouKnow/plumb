import { describe, expect, it } from 'vitest';
import { PlanSchema } from '@plumb/core';
import { handleAgent, resolveProvider, type AgentRouteDeps } from '../src/agentRoute.js';
import { NEBIUS_BASE_URL, NEBIUS_DEFAULT_MODEL } from '../src/nebius.js';
import { RateLimiter } from '../src/rateLimit.js';
import fixtureJson from '../../../fixtures/twoBed.plan.json';

function level(): unknown {
  const plan = PlanSchema.parse(fixtureJson);
  return plan.levels[0];
}

const NEBIUS = {
  getProvider: () => 'nebius',
  getNebiusKey: () => 'nb-test-secret',
  getModel: () => NEBIUS_DEFAULT_MODEL,
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

describe('nebius provider', () => {
  it('defaults to the Lightning model on the Token Factory base URL', () => {
    const r = resolveProvider({ getProvider: () => 'nebius' });
    expect(r.provider).toBe('nebius');
    expect(r.model).toBe('nvidia/Nemotron-3_5-Lightning');
    expect(r.baseUrl).toBe(NEBIUS_BASE_URL);
    expect(r.keyVar).toBe('NEBIUS_API_KEY');
  });

  it('runs the tool loop over /chat/completions with Bearer auth', async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      if (n === 1) return { ok: true, json: async () => chatWith([{ id: 'call1', name: 'run_checks', args: {} }], 'I will check.') };
      return { ok: true, json: async () => chatWith(null, 'No conflicts.') };
    }) as unknown as typeof fetch;
    const { status, events } = await collect({ message: 'check the plan', level: level() }, { ...NEBIUS, fetchImpl }, capture);
    expect(status).toBe(200);
    expect(capture.url).toBe(`${NEBIUS_BASE_URL}/chat/completions`);
    expect((capture.init?.headers as Record<string, string>)?.authorization).toBe('Bearer nb-test-secret');
    const body = JSON.parse(String(capture.init?.body)) as { model: string; tools: unknown[]; max_tokens: number };
    expect(body.model).toBe(NEBIUS_DEFAULT_MODEL);
    expect(body.tools).toHaveLength(6);
    expect(body.max_tokens).toBe(8192);
    expect(events.some((e) => e.event === 'step' && (e as { name?: string }).name === 'run_checks')).toBe(true);
    expect(events.some((e) => e.event === 'text')).toBe(true);
    expect(events[events.length - 1]?.event).toBe('done');
    expect(JSON.stringify(events)).not.toContain('nb-test-secret');
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
    const { status, events } = await collect({ message: 'add a plant to Bedroom 2', level: level() }, { ...NEBIUS, fetchImpl });
    expect(status).toBe(200);
    const proposal = events.find((e) => e.event === 'proposal') as { proposal?: { title?: string; status?: string } } | undefined;
    expect(proposal?.proposal?.title).toBe('Add plant');
  });

  it('names the HTTP status when the provider rejects the key (401), then falls back', async () => {
    const fetchImpl = (async () => ({
      ok: false,
      status: 401,
      text: async () => '{"error":{"message":"Invalid API key","type":"authentication_error"}}',
    })) as unknown as typeof fetch;
    const { status, events } = await collect(
      { message: 'build a lobby', level: level() },
      { ...NEBIUS, fetchImpl },
    );
    expect(status).toBe(200);
    const text = events.filter((e) => e.event === 'text').map((e) => String(e.delta)).join('');
    expect(text).toContain('HTTP 401');
    expect(text).toContain('local answer');
    expect(JSON.stringify(events)).not.toContain('nb-test-secret');
  });

  it('falls back without leaking the key when the model call fails', async () => {
    const { status, events } = await collect(
      { message: 'check the plan', level: level() },
      { ...NEBIUS, fetchImpl: (() => Promise.reject(new Error('down'))) as typeof fetch },
    );
    expect(status).toBe(200);
    const text = events.filter((e) => e.event === 'text').map((e) => String(e.delta)).join('');
    expect(text).toContain('local answer');
    expect(JSON.stringify(events)).not.toContain('nb-test-secret');
  });

  it('names NEBIUS_API_KEY when the key is missing, then falls back', async () => {
    const { status, events } = await collect(
      { message: 'hi', level: level() },
      { getProvider: () => 'nebius', getNebiusKey: () => undefined },
    );
    expect(status).toBe(200);
    const text = events.filter((e) => e.event === 'text').map((e) => String(e.delta)).join('');
    expect(text).toContain('NEBIUS_API_KEY');
    expect(events[events.length - 1]?.event).toBe('done');
  });
});
