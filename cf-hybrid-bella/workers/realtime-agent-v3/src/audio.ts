/**
 * realtime-agent-v3/src/audio.ts — Audio format constants and PCM helpers
 * Chunk 3 — V3
 *
 * Audio is forwarded as-is between browser and Deepgram — no transcoding.
 * Browser sends PCM 16kHz 16-bit mono → Deepgram STT (untouched).
 * Deepgram TTS returns PCM 16kHz 16-bit → Browser (untouched).
 */

// ─── Audio Format Constants ───────────────────────────────────────────────────

export const AUDIO_FORMAT = {
  encoding: 'linear16' as const,
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
} as const;

export const BYTES_PER_SAMPLE = AUDIO_FORMAT.bitsPerSample / 8; // 2

/**
 * Check if a WebSocket message is a binary audio frame (not JSON control).
 * Browser audio and Deepgram TTS audio both arrive as ArrayBuffer.
 */
export function isAudioFrame(data: unknown): data is ArrayBuffer {
  return data instanceof ArrayBuffer;
}

/**
 * Approximate duration of a PCM chunk in milliseconds.
 */
export function pcmDurationMs(byteLength: number): number {
  const samples = byteLength / BYTES_PER_SAMPLE;
  return (samples / AUDIO_FORMAT.sampleRate) * 1000;
}
