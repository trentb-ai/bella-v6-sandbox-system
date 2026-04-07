/**
 * prompt-worker-v3/src/gemini.ts — Gemini 2.5 Flash streaming via OpenAI-compat endpoint
 * Chunk 2 — V3
 *
 * OpenAI-compatible endpoint — NOT native generateContent.
 * Bearer token auth only (no x-goog-api-key).
 * reasoning_effort: 'none' — disables thinking tokens (critical for latency + token budget).
 * temperature: 0.3 — consistent directive following with natural speech variation.
 * 15s hard timeout via AbortSignal.timeout().
 */

import type { GeminiMessage } from './types';

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL = 'gemini-2.5-flash';

/**
 * Call Gemini 2.5 Flash with streaming enabled.
 * Returns the raw Response — caller must handle SSE body.
 * Throws on non-200 or timeout.
 */
export async function streamGemini(
  messages: GeminiMessage[],
  apiKey: string,
  maxTokens: number,
): Promise<Response> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: maxTokens,
      reasoning_effort: 'none',
      stream_options: { include_usage: true },
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok || !response.body) {
    const errText = await response.text().catch(() => '(no body)');
    console.error(`[PROMPT] Gemini ${response.status}: ${errText}`);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  return response;
}
