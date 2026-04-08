/**
 * prompt-worker-v3/src/index.ts — Prompt Worker fetch handler
 * Chunk 2 — V3
 *
 * Stateless worker. No DO, no D1, no KV.
 * Receives TurnPlan from Brain → assembles prompt → streams Gemini → returns SSE.
 * Deterministic bypass: mandatory=true + speakText → skip Gemini entirely.
 */

import { TurnPlanV1 } from '@bella/contracts';
import type { Env, GenerateRequestBody } from './types';
import type { TurnPlan } from '@bella/contracts';
import { emit, checkSLO } from '@bella/telemetry';
import { buildPrompt } from './prompt-builder';
import { streamGemini } from './gemini';
import { buildDeterministicSSE, teeSSEStream } from './sse';
import { fireComplianceCheck } from './compliance';

const VERSION = '1.0.4';

// ─── Worker ──────────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: VERSION, worker: 'prompt-worker-v3' });
    }

    if (url.pathname === '/generate' && request.method === 'POST') {
      return handleGenerate(request, env, ctx);
    }

    return new Response('Not found', { status: 404 });
  },
};

// ─── handleGenerate() — 8-step control flow ──────────────────────────────────

async function handleGenerate(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  // Step 1: Parse body as GenerateRequestBody
  let body: GenerateRequestBody;
  try {
    body = await request.json() as GenerateRequestBody;
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('plan' in body)) {
    return Response.json({ error: 'Missing required field: plan' }, { status: 400 });
  }

  // Step 2: Validate body.plan against TurnPlanV1
  const parsed = TurnPlanV1.safeParse(body.plan);
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid TurnPlan', details: parsed.error.issues },
      { status: 400 }
    );
  }
  const plan: TurnPlan = parsed.data;
  const utterance: string = typeof body.utterance === 'string' ? body.utterance : '';

  console.log(`[PROMPT] callId=${plan.callId} turnId=${plan.turnId} stage=${plan.stage} mandatory=${plan.mandatory}`);

  // Step 3: Deterministic bypass — mandatory=true + speakText → skip Gemini
  if (plan.mandatory && plan.speakText) {
    console.log(`[PROMPT] deterministic bypass turnId=${plan.turnId} chars=${plan.speakText.length}`);
    ctx.waitUntil(
      fireComplianceCheck(plan, plan.speakText, utterance, env)
    );
    return buildDeterministicSSE(plan.speakText, plan);
  }

  // Step 4: Build prompt
  const messages = buildPrompt(plan);
  const totalChars = messages.reduce((acc, m) => acc + m.content.length, 0);
  console.log(`[PROMPT] prompt chars=${totalChars} maxTokens=${plan.maxTokens}`);

  // Step 5: Call Gemini — §11: prompt.execution TTFB timing
  const promptStart = Date.now();
  let geminiResponse: Response;
  try {
    geminiResponse = await streamGemini(messages, env.GEMINI_API_KEY, plan.maxTokens);
  } catch (err) {
    console.error('[PROMPT] Gemini error:', err);
    return Response.json(
      { error: 'Gemini unavailable', details: String(err) },
      { status: 503 }
    );
  }

  // TTFB = time from promptStart to first HTTP response headers (stream ready)
  const ttfb = Date.now() - promptStart;
  emit({
    family: 'prompt.execution',
    callId: plan.callId,
    ts: Date.now(),
    durationMs: ttfb,
    event: 'prompt.ttfb',
    stage: plan.stage,
    model: 'gemini-2.5-flash',
  });
  checkSLO('promptToFirstToken', ttfb, { callId: plan.callId, turnId: plan.turnId });

  // Step 6: Tee SSE stream — passthrough for response, capture for compliance
  const { passthrough, capture } = teeSSEStream(geminiResponse.body!);

  // Step 7: Fire compliance after stream completes (non-blocking)
  ctx.waitUntil(
    capture.then(text => {
      const totalMs = Date.now() - promptStart;
      emit({
        family: 'prompt.execution',
        callId: plan.callId,
        ts: Date.now(),
        durationMs: totalMs,
        event: 'prompt.complete',
      });
      return fireComplianceCheck(plan, text, utterance, env);
    }).catch(err => console.error('[PROMPT] compliance stream error:', err))
  );

  // Step 8: Return passthrough stream with stage/move headers
  return new Response(passthrough, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Bella-Stage': plan.stage,
      'X-Bella-Move': plan.moveId,
    },
  });
}
