/**
 * realtime-agent-v3/src/speaker.ts — Speaker identity determination
 * Chunk 3 — V3
 *
 * Speaker is identified by audio DIRECTION, not voice analysis.
 * STT events are ALWAYS prospect (inbound browser audio).
 * 'bella' is never sent as a TurnRequest — Brain already knows what it generated.
 */

import type { DeepgramSTTEvent } from './types';

/**
 * Classify a Deepgram STT event into a speaker flag.
 *
 * - Final transcript with content → 'prospect' (STT = inbound browser audio)
 * - Non-final or empty transcript → 'unknown' (do not dispatch)
 */
export function determineSpeaker(
  event: DeepgramSTTEvent,
): 'prospect' | 'unknown' {
  if (
    event.is_final &&
    event.channel?.alternatives?.[0]?.transcript
  ) {
    return 'prospect';
  }
  return 'unknown';
}

/**
 * Extract the transcript text from a Deepgram STT event.
 * Returns empty string if no transcript available.
 */
export function extractTranscript(event: DeepgramSTTEvent): string {
  return event.channel?.alternatives?.[0]?.transcript ?? '';
}
