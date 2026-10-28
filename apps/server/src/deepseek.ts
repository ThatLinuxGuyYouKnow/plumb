/**
 * DeepSeek tool loop over the OpenAI-compatible chat completions API
 * (SPEC §9). No SDK dependency; plain fetch. Use `deepseek-chat` — the
 * reasoning models do not support function calling.
 */
import { runOpenAICompat, type OpenAICompatOptions } from './openaiCompat.js';

export type DeepSeekOptions = OpenAICompatOptions;

/** Run the model loop, emitting client SSE payloads (same events as Anthropic). */
export async function runDeepSeek(opts: DeepSeekOptions): Promise<void> {
  await runOpenAICompat({ ...opts, baseUrl: opts.baseUrl ?? 'https://api.deepseek.com' });
}
