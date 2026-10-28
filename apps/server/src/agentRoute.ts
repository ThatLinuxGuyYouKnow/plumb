/**
 * POST /api/agent: validates input, rate-limits, then streams SSE.
 * With a provider key set it runs the model tool loop; otherwise the
 * deterministic fallback agent (same events, same interface).
 * Providers: `anthropic` (default), `deepseek` and `nebius`, via PLUMB_PROVIDER.
 */
import { FallbackAgent, type AgentContext, type AgentEvent } from '@plumb/agent';
import { LevelSchema, runChecks } from '@plumb/core';
import { z } from 'zod';
import { runModel, type ChatMessage } from './anthropic.js';
import { runDeepSeek } from './deepseek.js';
import { NEBIUS_BASE_URL, NEBIUS_DEFAULT_MODEL, runNebius } from './nebius.js';
import { modelFailureHint, AGENT_TIMEOUT_MS } from './modelShared.js';

export { AGENT_TIMEOUT_MS };
import type { RateLimiter } from './rateLimit.js';

const BodySchema = z.object({
  message: z.string().min(1).max(4000),
  level: z.unknown(),
  selection: z.object({ type: z.string(), id: z.string() }).nullable().optional(),
  unit: z.enum(['m', 'ft']).optional(),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string() })).max(20).optional(),
});

export interface AgentRouteDeps {
  limiter: RateLimiter;
  getApiKey?: () => string | undefined;
  getModel?: () => string | undefined;
  getProvider?: () => string | undefined;
  getDeepSeekKey?: () => string | undefined;
  getNebiusKey?: () => string | undefined;
  getBaseUrl?: () => string | undefined;
  fetchImpl?: typeof fetch;
}

/** Resolve the active provider, its key and its default model. */
export function resolveProvider(deps: Pick<AgentRouteDeps, 'getProvider' | 'getApiKey' | 'getDeepSeekKey' | 'getNebiusKey' | 'getModel' | 'getBaseUrl'>): {
  provider: string;
  apiKey: string | undefined;
  model: string | undefined;
  baseUrl: string | undefined;
  keyVar: string;
} {
  const provider = deps.getProvider?.() ?? process.env.PLUMB_PROVIDER ?? 'anthropic';
  if (provider === 'deepseek') {
    return {
      provider,
      apiKey: deps.getDeepSeekKey?.() ?? process.env.DEEPSEEK_API_KEY,
      model: deps.getModel?.() ?? process.env.PLUMB_MODEL ?? 'deepseek-chat',
      baseUrl: deps.getBaseUrl?.() ?? process.env.DEEPSEEK_BASE_URL,
      keyVar: 'DEEPSEEK_API_KEY',
    };
  }
  if (provider === 'nebius') {
    return {
      provider,
      // NEBIUS_KEY is the legacy local name (see .env.example); the documented
      // Token Factory name NEBIUS_API_KEY wins when both are set.
      apiKey: deps.getNebiusKey?.() ?? process.env.NEBIUS_API_KEY ?? process.env.NEBIUS_KEY,
      model: deps.getModel?.() ?? process.env.PLUMB_MODEL ?? NEBIUS_DEFAULT_MODEL,
      baseUrl: deps.getBaseUrl?.() ?? process.env.NEBIUS_BASE_URL ?? NEBIUS_BASE_URL,
      keyVar: 'NEBIUS_API_KEY',
    };
  }
  return {
    provider,
    apiKey: deps.getApiKey?.() ?? process.env.ANTHROPIC_API_KEY,
    model: deps.getModel?.() ?? process.env.PLUMB_MODEL,
    baseUrl: undefined,
    keyVar: 'ANTHROPIC_API_KEY',
  };
}

export function sseEncode(ev: Record<string, unknown>): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

function toSse(ev: AgentEvent): Record<string, unknown> | null {
  switch (ev.type) {
    case 'step':
      return { event: 'step', name: ev.name, summary: ev.summary, status: ev.status };
    case 'text':
      return { event: 'text', delta: ev.delta };
    case 'table':
      return { event: 'table', rows: ev.rows };
    case 'proposal':
      return { event: 'proposal', proposal: ev.proposal };
    case 'marks':
      return { event: 'marks', marks: ev.marks };
    case 'flash':
      return { event: 'flash', roomIds: ev.roomIds };
    case 'chips':
      return { event: 'chips', chips: ev.chips };
    case 'undo-request':
      return { event: 'text', delta: 'Undone on the server side is not possible; press undo in the app.' };
    case 'done':
      return { event: 'done' };
  }
}

export async function handleAgent(
  body: unknown,
  ip: string,
  signal: AbortSignal,
  deps: AgentRouteDeps,
  onChunk: (s: string) => void,
): Promise<{ status: number }> {
  if (!deps.limiter.allow(ip)) {
    onChunk(sseEncode({ event: 'error', message: 'Rate limit: slow down and try again in a minute.' }));
    return { status: 429 };
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    onChunk(sseEncode({ event: 'error', message: 'Invalid request.' }));
    return { status: 400 };
  }
  const levelParsed = LevelSchema.safeParse(parsed.data.level);
  if (!levelParsed.success) {
    onChunk(sseEncode({ event: 'error', message: 'Invalid plan.' }));
    return { status: 400 };
  }
  const level = levelParsed.data;
  const unit = parsed.data.unit ?? 'm';
  const selection =
    parsed.data.selection && ['item', 'wall', 'room', 'door', 'window'].includes(parsed.data.selection.type)
      ? (parsed.data.selection as AgentContext['selection'])
      : null;

  const { apiKey, model, baseUrl, keyVar, provider } = resolveProvider(deps);
  const history: ChatMessage[] = (parsed.data.history ?? []).slice(-20);

  if (provider !== 'anthropic' && provider !== 'deepseek' && provider !== 'nebius') {
    onChunk(sseEncode({ event: 'text', delta: `Unknown PLUMB_PROVIDER "${provider}"; here is the local answer instead. ` }));
  } else if (apiKey && model) {
    try {
      const common = {
        apiKey,
        model,
        message: parsed.data.message,
        level,
        selection,
        unit,
        history,
        signal,
        emit: (ev: Record<string, unknown>) => onChunk(sseEncode(ev)),
        fetchImpl: deps.fetchImpl,
      };
      if (provider === 'deepseek') await runDeepSeek({ ...common, baseUrl });
      else if (provider === 'nebius') await runNebius({ ...common, baseUrl });
      else await runModel(common);
      onChunk(sseEncode({ event: 'done' }));
      return { status: 200 };
    } catch (e) {
      // Network/model failure → deterministic fallback, same as the client path.
      // Log server-side and tell the client the status: a bare "call failed"
      // cost a full debug session when a pasted key turned out to be a 401.
      const hint = modelFailureHint(e);
      console.error(`[agent] model call failed (${hint})`);
      onChunk(
        sseEncode({
          event: 'text',
          delta: `The model call failed (${hint}); here is the local answer instead. `,
        }),
      );
    }
  } else if (apiKey && !model) {
    onChunk(sseEncode({ event: 'text', delta: 'Set PLUMB_MODEL to enable the model; here is the local answer instead. ' }));
  } else {
    onChunk(sseEncode({ event: 'text', delta: `Set ${keyVar} to enable the model; here is the local answer instead. ` }));
  }

  const ctx: AgentContext = { level, issues: runChecks(level), selection, unit, canUndo: false };
  for await (const ev of new FallbackAgent().respond(parsed.data.message, ctx)) {
    if (signal.aborted) break;
    const sse = toSse(ev);
    if (sse) onChunk(sseEncode(sse));
  }
  return { status: 200 };
}
