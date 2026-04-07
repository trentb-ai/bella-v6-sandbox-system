/**
 * prompt-worker-v3/src/types.ts — Internal types for Prompt Worker
 * Chunk 2 — V3
 */

// ─── Gemini Messages ─────────────────────────────────────────────────────────

export interface GeminiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// ─── Request Body ────────────────────────────────────────────────────────────

/**
 * POST /generate body — wraps TurnPlan with prospect utterance for compliance.
 * Body.plan is validated against TurnPlanV1 separately.
 */
export interface GenerateRequestBody {
  plan: unknown;      // Validated against TurnPlanV1.safeParse() on receipt
  utterance: string;  // Prospect's utterance — passed through to compliance
}

// ─── SSE Chunk ───────────────────────────────────────────────────────────────

export interface SSEChunk {
  id: string;
  object: 'chat.completion.chunk';
  choices: Array<{
    delta: { content: string };
    index: number;
    finish_reason: string | null;
  }>;
}

// ─── Env ─────────────────────────────────────────────────────────────────────

export interface Env {
  GEMINI_API_KEY: string;
  COMPLIANCE_WORKFLOW?: Fetcher;
  VERSION?: string;
}
