/**
 * realtime-agent-v3/src/barge-in.ts — Barge-in handling
 * Chunk 3 — V3
 *
 * handleBargeIn() — aborts active SSE→TTS stream, clears Deepgram TTS buffer,
 * resets isSpeaking state, signals browser to stop audio.
 *
 * SLO: < 100ms from barge-in detection to TTS audio stop at browser.
 * Sequence: abort SSE stream FIRST → TTS Clear → state reset → browser clear_audio.
 * Abort BEFORE Clear prevents new Speak commands reaching Deepgram after Clear.
 */

import type { AgentState } from './types';

/**
 * Handle prospect barge-in during active Bella TTS.
 *
 * Called from:
 * - Browser `{ type: "barge_in" }` message
 * - Deepgram STT `SpeechStarted` event while isSpeaking===true
 * - Deepgram STT `is_final` transcript arriving while isSpeaking===true (P1-6 rule)
 */
export function handleBargeIn(
  sttWs: WebSocket | null,
  ttsWs: WebSocket | null,
  browserWs: WebSocket | null,
  state: AgentState,
): void {
  // 1. Abort active SSE→TTS stream FIRST — stops new Speak commands from
  //    reaching Deepgram after Clear is sent (P1-NEW-1 fix)
  if (state.activeTtsAbort) {
    state.activeTtsAbort.abort();
    state.activeTtsAbort = null;
  }

  // 2. Stop Deepgram TTS output — clears audio buffer immediately
  if (ttsWs && ttsWs.readyState === WebSocket.OPEN) {
    ttsWs.send(JSON.stringify({ type: 'Clear' }));
  }

  // 3. Reset state
  state.isSpeaking = false;
  state.pendingTurnId = null;

  // 4. Tell browser to stop playing buffered audio
  if (browserWs && browserWs.readyState === WebSocket.OPEN) {
    browserWs.send(JSON.stringify({ type: 'clear_audio' }));
    // T3 P2: also send 'listening' to signal barge-in acknowledged
    browserWs.send(JSON.stringify({ type: 'listening' }));
  }

  console.log('[RT] barge-in: SSE aborted + TTS cleared, listening');
}
