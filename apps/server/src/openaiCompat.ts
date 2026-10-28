/**
 * Generic OpenAI-compatible `/chat/completions` tool loop.
 * DeepSeek (`deepseek.ts`) and Nebius Token Factory (`nebius.ts`) are thin
 * wrappers supplying their own base URL / default model; everything
 * deterministic (tool defs, prompt, tool execution) still lives in
 * `modelShared.ts`. No SDK dependency; plain fetch.
 */
import {
  buildSystem,
  execTool,
  historyMessages,
  MAX_ROUNDS,
  MAX_OUTPUT_TOKENS,
  openAITools,
  summarizeInput,
  type ModelRunOptions,
} from './modelShared.js';

export interface OpenAICompatOptions extends ModelRunOptions {
  /** API base override; must include the version prefix (e.g. `.../v1`). */
  baseUrl?: string;
}

interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface Message {
  role: string;
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

interface ChatResponse {
  choices?: Array<{ message?: Message }>;
}

function parseArgs(raw: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    return { ok: false };
  }
}

/** Run the model loop, emitting client SSE payloads (same events as Anthropic). */
export async function runOpenAICompat(opts: OpenAICompatOptions & { baseUrl: string }): Promise<void> {
  const { apiKey, model, signal } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');
  const system = buildSystem(opts.level, opts.selection, opts.unit);
  const messages: Message[] = [
    { role: 'system', content: system },
    ...historyMessages(opts.history, opts.message),
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal.aborted) break;
    const res = await fetchImpl(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, tools: openAITools(), max_tokens: MAX_OUTPUT_TOKENS }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`model ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as ChatResponse;
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error('model returned no choices');
    if (msg.content) opts.emit({ event: 'text', delta: msg.content });
    const calls = msg.tool_calls ?? [];
    if (calls.length === 0) break;

    // Echo the assistant turn (with its tool calls) so the follow-up stays coherent.
    messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: calls });
    for (const call of calls) {
      const name = call.function?.name ?? '';
      const parsed = parseArgs(call.function?.arguments ?? '');
      const input = parsed.ok ? parsed.value : {};
      opts.emit({ event: 'step', name, summary: summarizeInput(name, input), status: 'run' });
      const result = parsed.ok ? execTool(name, input, opts.level, opts.emit) : { error: 'invalid arguments JSON' };
      opts.emit({ event: 'step', name, summary: '', status: 'done' });
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result).slice(0, 8000) });
    }
  }
}
