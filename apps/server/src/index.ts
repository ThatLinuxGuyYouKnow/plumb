/** @plumb/server: Hono API (agent SSE + convert proxy). The API key never reaches the browser. */
import './env.js';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { handleAgent, resolveProvider, sseEncode, AGENT_TIMEOUT_MS } from './agentRoute.js';
import { handleConvertProxy } from './convert.js';
import { RateLimiter } from './rateLimit.js';

const PORT = Number(process.env.PORT ?? 3101);
const limiter = new RateLimiter();

const app = new Hono();

app.get('/api/health', (c) => {
  const { provider, apiKey, model } = resolveProvider({});
  return c.json({ ok: true, provider, model: model ?? null, keyConfigured: Boolean(apiKey) });
});

app.post('/api/agent', async (c) => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  const body: unknown = await c.req.json().catch(() => null);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), AGENT_TIMEOUT_MS);
  // Collect-then-send: SSE streaming with backpressure is overkill here; the
  // chunks are small and the client parses the stream either way.
  const chunks: string[] = [];
  let status = 200;
  try {
    ({ status } = await handleAgent(body, ip, ctl.signal, { limiter }, (s) => chunks.push(s)));
  } finally {
    clearTimeout(timer);
  }
  if (!chunks.some((s) => s.includes('"done"'))) chunks.push(sseEncode({ event: 'done' }));
  return new Response(chunks.join(''), {
    status,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
});

app.all('/api/convert/*', (c) => handleConvertProxy(c, c.req.path.replace(/^\/api\/convert/, '') || '/'));

serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`plumb server on :${PORT}`);
});

export { app };
