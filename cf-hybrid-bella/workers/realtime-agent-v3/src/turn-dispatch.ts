/**
 * realtime-agent-v3/src/turn-dispatch.ts — Turn dispatch + SSE→TTS streaming
 * Chunk 3 — V3
 *
 * dispatchTurn() — builds TurnRequest, POSTs to Brain DO, calls Prompt Worker,
 *                  streams SSE→TTS WebSocket→browser.
 *
 * streamSSEToTTS() — parses OpenAI-compatible SSE, sends Speak commands to
 *                    Deepgram TTS WebSocket. Abort-aware (P1-NEW-1).
 *
 * All connection references are passed as explicit params (P1-1 fix —
 * function lives outside the DO class, no `this` references).
 */

import type { TurnRequest, TurnPlan } from '@bella/contracts';
import { TurnRequestV1 } from '@bella/contracts';
import type { Env, AgentState } from './types';

// ─── dispatchTurn() ──────────────────────────────────────────────────────────

/**
 * Full turn lifecycle: TurnRequest → Brain DO → TurnPlan → Prompt Worker → SSE → TTS.
 *
 * P1-2: Sets isSpeaking=true BEFORE streamSSEToTTS() — critical for barge-in ordering.
 * P1-NEW-1: Creates AbortController stored on state.activeTtsAbort — barge-in calls abort().
 * isSpeaking is set to false by TTS Flushed event, NOT at end of this function
 * (audio may still be buffered in Deepgram after SSE completes).
 */
export async function dispatchTurn(
  callId: string,
  utterance: string,
  speakerFlag: 'prospect',
  turnIndex: number,
  env: Env,
  ttsWs: WebSocket,
  browserWs: WebSocket,
  state: AgentState,
): Promise<void> {
  // 1. Build TurnRequest
  const turnId = crypto.randomUUID();
  const turnRequest: TurnRequest = {
    version: 1,
    callId,
    turnId,
    utterance,
    speakerFlag,
    turnIndex,
  };

  // Validate (dev safety — contracts guarantee this at build time)
  const parsed = TurnRequestV1.safeParse(turnRequest);
  if (!parsed.success) {
    console.error('[RT] Invalid TurnRequest built:', parsed.error.issues);
    return;
  }

  // 2. POST to Brain DO
  let brainResponse: Response;
  try {
    brainResponse = await env.BRAIN.fetch(
      new Request(`https://brain/turn?callId=${callId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(turnRequest),
      })
    );
  } catch (err) {
    console.error('[RT] Brain fetch error:', err);
    safeSend(browserWs, { type: 'error', message: 'Brain unavailable' });
    return;
  }

  if (!brainResponse.ok) {
    const errText = await brainResponse.text().catch(() => '');
    console.error(`[RT] Brain error ${brainResponse.status}: ${errText}`);
    safeSend(browserWs, { type: 'error', message: `Brain error: ${brainResponse.status}` });
    return;
  }

  let plan: TurnPlan;
  try {
    plan = await brainResponse.json() as TurnPlan;
  } catch (err) {
    console.error('[RT] Brain response parse error:', err);
    return;
  }

  console.log(`[RT] TurnPlan received stage=${plan.stage} mandatory=${plan.mandatory}`);
  safeSend(browserWs, { type: 'turn_start', stage: plan.stage });

  // 3. POST to Prompt Worker
  let promptResponse: Response;
  try {
    promptResponse = await env.PROMPT_WORKER.fetch(
      new Request('https://prompt/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan, utterance }),
      })
    );
  } catch (err) {
    console.error('[RT] Prompt Worker fetch error:', err);
    safeSend(browserWs, { type: 'error', message: 'Prompt Worker unavailable' });
    return;
  }

  if (!promptResponse.ok || !promptResponse.body) {
    console.error(`[RT] Prompt Worker error ${promptResponse.status}`);
    safeSend(browserWs, { type: 'error', message: `Prompt error: ${promptResponse.status}` });
    return;
  }

  // 4. P1-2: Set isSpeaking BEFORE streaming TTS
  state.isSpeaking = true;
  state.pendingTurnId = turnId;
  safeSend(browserWs, { type: 'speaking', turnId });

  // 5. P1-NEW-1: AbortController so barge-in can kill the SSE stream
  const abort = new AbortController();
  state.activeTtsAbort = abort;

  // 6. Stream SSE → TTS WebSocket → browser (via TTS audio handler)
  await streamSSEToTTS(promptResponse.body, ttsWs, browserWs, abort.signal);

  // Cleanup abort ref if stream completed normally (not barge-in)
  if (state.activeTtsAbort === abort) {
    state.activeTtsAbort = null;
  }

  // Note: isSpeaking is set to false by TTS Flushed event (§9.2) — not here.
  // Audio may still be buffered in Deepgram TTS after SSE stream completes.
}

// ─── streamSSEToTTS() ────────────────────────────────────────────────────────

/**
 * Parse OpenAI-compatible SSE stream from Prompt Worker.
 * Send text chunks to Deepgram TTS WebSocket as Speak commands.
 * On [DONE], send Flush command.
 * Abort-aware: checks abortSignal on each iteration (P1-NEW-1).
 */
export async function streamSSEToTTS(
  sseBody: ReadableStream<Uint8Array>,
  ttsWs: WebSocket,
  browserWs: WebSocket,
  abortSignal: AbortSignal,
): Promise<void> {
  if (!ttsWs || ttsWs.readyState !== WebSocket.OPEN) {
    console.error('[RT] TTS WebSocket not open — cannot stream');
    return;
  }

  const reader = sseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      // P1-NEW-1: Check abort on each iteration — barge-in kills this loop
      if (abortSignal.aborted) {
        console.log('[RT] SSE stream aborted (barge-in)');
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (abortSignal.aborted) break; // P1-NEW-1: inner loop check too

        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();

        if (data === '[DONE]') {
          // Signal Deepgram TTS to flush remaining buffered audio
          if (ttsWs.readyState === WebSocket.OPEN) {
            ttsWs.send(JSON.stringify({ type: 'Flush' }));
          }
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content && ttsWs.readyState === WebSocket.OPEN) {
            ttsWs.send(JSON.stringify({ type: 'Speak', text: content }));
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeSend(ws: WebSocket | null, msg: object): void {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
