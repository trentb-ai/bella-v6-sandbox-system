/**
 * realtime-agent-v3/src/types.ts — Internal types for Realtime Transport Agent
 * Chunk 3 — V3
 */

// ─── Env ─────────────────────────────────────────────────────────────────────

export interface Env {
  REALTIME_AGENT: DurableObjectNamespace;
  BRAIN: Fetcher;
  PROMPT_WORKER: Fetcher;
  DEEPGRAM_API_KEY: string;
  VERSION?: string;
}

// ─── Browser Messages ─────────────────────────────────────────────────────────

export type BrowserMessage =
  | { type: 'barge_in' }
  | { type: 'end' }
  | { type: 'mute'; muted: boolean };

// ─── Realtime Agent → Browser ─────────────────────────────────────────────────

export type AgentMessage =
  | { type: 'ready'; callId: string }
  | { type: 'listening' }
  | { type: 'speaking'; turnId: string }
  | { type: 'clear_audio' }
  | { type: 'turn_start'; stage: string }
  | { type: 'error'; message: string }
  | { type: 'end' }
  | { type: 'interim'; text: string };

// ─── Deepgram STT Event ───────────────────────────────────────────────────────

export interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words?: Array<{ word: string; start: number; end: number; confidence: number }>;
}

export interface DeepgramSTTEvent {
  type: 'Results' | 'SpeechStarted' | 'UtteranceEnd' | 'Metadata' | 'Error';
  is_final?: boolean;
  channel?: {
    alternatives?: DeepgramAlternative[];
  };
  speech_final?: boolean;
  duration?: number;
  start?: number;
}

// ─── Deepgram TTS Event ───────────────────────────────────────────────────────

export interface DeepgramTTSEvent {
  type: 'Flushed' | 'Warning' | 'Error';
  message?: string;
}

// ─── Deepgram TTS Commands ────────────────────────────────────────────────────

export interface SpeakCommand {
  type: 'Speak';
  text: string;
}

export interface FlushCommand {
  type: 'Flush';
}

export interface ClearCommand {
  type: 'Clear';
}

export interface KeepAliveCommand {
  type: 'KeepAlive';
}

// ─── Agent State (passed to turn-dispatch and barge-in) ──────────────────────

/**
 * Mutable state interface used by dispatchTurn() and handleBargeIn().
 * These functions live outside the DO class, so state is passed explicitly (P1-1/P1-2 fix).
 */
export interface AgentState {
  isSpeaking: boolean;
  pendingTurnId: string | null;
  activeTtsAbort: AbortController | null;
}

// ─── Turn Queue Entry ─────────────────────────────────────────────────────────

export interface QueuedTurn {
  utterance: string;
  speakerFlag: 'prospect';
}
