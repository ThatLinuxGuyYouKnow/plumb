/** Anthropic Messages API tool loop (SPEC §9). No SDK dependency; plain fetch. */
import {
  anthropicTools,
  buildSystem,
  execTool,
  historyMessages,
  MAX_ROUNDS,
  MAX_OUTPUT_TOKENS,
  summarizeInput,
  type ModelRunOptions,
} from './modelShared.js';

export type { ChatMessage, ModelRunOptions } from './modelShared.js';

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface MessageResponse {
  content: ContentBlock[];
  stop_reason: string;
}

/** Run the model loop, emitting client SSE payloads. */
export async function runModel(opts: ModelRunOptions): Promise<void> {
  const { apiKey, model, signal } = opts;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const system = buildSystem(opts.level, opts.selection, opts.unit);
  const messages: Array<{ role: string; content: unknown }> = historyMessages(opts.history, opts.message);

  for (let round = 0; round < MAX_ROUNDS; round++) {
    if (signal.aborted) break;
    const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: MAX_OUTPUT_TOKENS, system, tools: anthropicTools(), messages }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`model ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as MessageResponse;
    const toolUses = data.content.filter((b) => b.type === 'tool_use');
    for (const b of data.content) {
      if (b.type === 'text' && b.text) opts.emit({ event: 'text', delta: b.text });
    }
    if (toolUses.length === 0 || data.stop_reason !== 'tool_use') break;

    const toolResults: unknown[] = [];
    for (const tu of toolUses) {
      const name = tu.name ?? '';
      opts.emit({ event: 'step', name, summary: summarizeInput(name, tu.input), status: 'run' });
      const result = execTool(name, tu.input ?? {}, opts.level, opts.emit);
      opts.emit({ event: 'step', name, summary: '', status: 'done' });
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: JSON.stringify(result).slice(0, 8000) });
    }
    messages.push({ role: 'assistant', content: data.content });
    messages.push({ role: 'user', content: toolResults });
  }
}
