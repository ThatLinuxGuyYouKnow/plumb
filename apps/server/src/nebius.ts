/**
 * Nebius Token Factory provider (SPEC §9): OpenAI-compatible
 * `https://api.tokenfactory.nebius.com/v1/chat/completions` with Bearer auth.
 * No SDK dependency; plain fetch. Loop is shared with DeepSeek
 * (`openaiCompat.ts`); tool events are identical to the other providers.
 *
 * Model choice (live experiment 2026-10-20, same prompts + tool defs):
 * - `nvidia/Nemotron-3_5-Lightning` (text2text) is the default: ~1–2 s and
 *   ~130–460 completion tokens per round, exact op shapes, no spurious tool
 *   calls. Built for high-volume text agent tasks.
 * - `nvidia/Nemotron-3.5-Super-VL` (image2text, 120B MoE) also passed every
 *   round with slightly more precise prose, but at ~2–5 s and 3–7x the
 *   completion tokens (1000+ hidden reasoning tokens per call). Pick it via
 *   `PLUMB_MODEL` when the backend starts sending plan images.
 */
import { runOpenAICompat, type OpenAICompatOptions } from './openaiCompat.js';

export const NEBIUS_BASE_URL = 'https://api.tokenfactory.nebius.com/v1';

/** Default model: fast text2text agent model (see note above). */
export const NEBIUS_DEFAULT_MODEL = 'nvidia/Nemotron-3_5-Lightning';

/** Opt-in multimodal model for future vision input (slower, costlier). */
export const NEBIUS_SUPER_VL_MODEL = 'nvidia/Nemotron-3.5-Super-VL';

export type NebiusOptions = OpenAICompatOptions;

/** Run the model loop, emitting client SSE payloads (same events as Anthropic). */
export async function runNebius(opts: NebiusOptions): Promise<void> {
  await runOpenAICompat({ ...opts, baseUrl: opts.baseUrl ?? NEBIUS_BASE_URL });
}
