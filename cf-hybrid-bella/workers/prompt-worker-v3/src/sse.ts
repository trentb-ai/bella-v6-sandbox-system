/**
 * prompt-worker-v3/src/sse.ts — SSE helpers
 * Chunk 2 — V3
 *
 * buildDeterministicSSE() — builds a full SSE response from pre-computed text (no Gemini)
 * splitIntoSSEChunks()    — word-boundary chunking for natural TTS cadence
 * teeSSEStream()          — tees Gemini body for passthrough + compliance capture
 * collectSSEText()        — reads SSE stream, extracts content deltas
 */

import type { TurnPlan } from '@bella/contracts';
import type { SSEChunk } from './types';

// ─── splitIntoSSEChunks() ────────────────────────────────────────────────────

/**
 * Split text into ~4-word chunks with trailing space on non-final chunks.
 * Simulates natural TTS streaming cadence.
 */
export function splitIntoSSEChunks(text: string): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 4) {
    const chunk = words.slice(i, i + 4).join(' ');
    // Trailing space on non-final chunks
    chunks.push(i + 4 < words.length ? chunk + ' ' : chunk);
  }
  return chunks;
}

// ─── buildDeterministicSSE() ─────────────────────────────────────────────────

/**
 * Build a complete SSE response from pre-computed speak text.
 * mandatory=true + speakText → deterministic bypass (no Gemini call).
 * Guarantees ROI numbers are exact — eliminates V2 Bug 6 (Gemini math hallucination).
 */
export function buildDeterministicSSE(text: string, plan: TurnPlan): Response {
  const chunks = splitIntoSSEChunks(text);

  const body =
    chunks
      .map(chunk => {
        const event: SSEChunk = {
          id: plan.turnId,
          object: 'chat.completion.chunk',
          choices: [{ delta: { content: chunk }, index: 0, finish_reason: null }],
        };
        return `data: ${JSON.stringify(event)}\n\n`;
      })
      .join('') + 'data: [DONE]\n\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Bella-Stage': plan.stage,
      'X-Bella-Move': plan.moveId,
      'X-Bella-Deterministic': 'true',
    },
  });
}

// ─── teeSSEStream() ──────────────────────────────────────────────────────────

/**
 * Tee a ReadableStream into passthrough (for response) and a capture promise (for compliance).
 * Does NOT parse/re-serialize SSE — body passes through untouched.
 */
export function teeSSEStream(body: ReadableStream<Uint8Array>): {
  passthrough: ReadableStream<Uint8Array>;
  capture: Promise<string>;
} {
  const [stream1, stream2] = body.tee();
  const capture = collectSSEText(stream2);
  return { passthrough: stream1, capture };
}

// ─── collectSSEText() ────────────────────────────────────────────────────────

/**
 * Read a Gemini SSE stream and extract all content deltas into a single string.
 * Used for compliance capture after the response stream completes.
 */
export async function collectSSEText(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? ''; // keep incomplete last line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const parsed = JSON.parse(data) as SSEChunk;
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content) fullText += content;
        } catch {
          // Ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}
