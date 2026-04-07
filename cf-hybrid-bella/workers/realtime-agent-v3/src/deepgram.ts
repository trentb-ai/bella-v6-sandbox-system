/**
 * realtime-agent-v3/src/deepgram.ts — Deepgram WebSocket connections
 * Chunk 3 — V3
 *
 * Uses Deepgram Listen (STT) + Speak (TTS) as SEPARATE WebSocket connections.
 * NOT the Voice Agent API (wss://agent.deepgram.com/v1/agent/converse).
 * V3 needs independent control of STT, Gemini (via Brain/Prompt), and TTS layers.
 *
 * Auth: Authorization: Token <key> header on WebSocket upgrade.
 * Config: passed as query parameters on the URL.
 */

// ─── STT ─────────────────────────────────────────────────────────────────────

const DG_STT_URL = 'wss://api.deepgram.com/v1/listen';

const DG_STT_PARAMS: Record<string, string> = {
  model: 'nova-3',
  language: 'en',
  smart_format: 'true',
  utterance_end_ms: '1200',
  interim_results: 'true',
  endpointing: '300',
  vad_events: 'true',
  encoding: 'linear16',
  sample_rate: '16000',
  channels: '1',
};

export function buildDGSTTUrl(): string {
  const params = new URLSearchParams(DG_STT_PARAMS);
  return `${DG_STT_URL}?${params.toString()}`;
}

/**
 * Open a Deepgram STT WebSocket connection.
 * Returns the connected WebSocket.
 * Throws if the connection cannot be established.
 */
export function openDeepgramSTT(apiKey: string): WebSocket {
  const url = buildDGSTTUrl();
  const ws = new WebSocket(url, ['token', apiKey]);
  return ws;
}

// ─── TTS ─────────────────────────────────────────────────────────────────────

const DG_TTS_URL = 'wss://api.deepgram.com/v1/speak';

const DG_TTS_PARAMS: Record<string, string> = {
  model: 'aura-2-theia-en',
  encoding: 'linear16',
  sample_rate: '16000',
  container: 'none',
};

export function buildDGTTSUrl(): string {
  const params = new URLSearchParams(DG_TTS_PARAMS);
  return `${DG_TTS_URL}?${params.toString()}`;
}

/**
 * Open a Deepgram TTS WebSocket connection.
 * Returns the connected WebSocket.
 */
export function openDeepgramTTS(apiKey: string): WebSocket {
  const url = buildDGTTSUrl();
  const ws = new WebSocket(url, ['token', apiKey]);
  return ws;
}

// ─── Keepalive ────────────────────────────────────────────────────────────────

export const KEEPALIVE_MS = 5000;

/**
 * Start a keepalive interval that sends KeepAlive to Deepgram STT every 5s.
 * Prevents idle connection drop.
 * Caller must store the return value and call clearInterval() on cleanup.
 */
export function startKeepAlive(sttWs: WebSocket): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (sttWs.readyState === WebSocket.OPEN) {
      sttWs.send(JSON.stringify({ type: 'KeepAlive' }));
    }
  }, KEEPALIVE_MS);
}
