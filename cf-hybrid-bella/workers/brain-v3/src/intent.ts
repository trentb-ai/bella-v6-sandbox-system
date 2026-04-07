/**
 * brain-v3/src/intent.ts — Prospect intent detection
 * Chunk 7 — Layer 3 (Intelligence Layers)
 * Pure sync — no Gemini calls.
 */

export type IntentType =
  | 'interested'
  | 'objecting'
  | 'confused'
  | 'ready_to_buy'
  | 'off_topic'
  | 'neutral';

const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  interested: [
    /\b(sounds? good|tell me more|interesting|love that|that'?s? great|makes sense)\b/i,
    /\b(how does? (that|it) work|walk me through)\b/i,
  ],
  objecting: [
    /\b(too expensive|can'?t? afford|already have|not (the )?right time|busy|think about it)\b/i,
    /\b(competitor|already (using|working with)|contract)\b/i,
    /\b(not sure|not convinced|doubt|skeptic)\b/i,
  ],
  confused: [
    /\b(what do you mean|don'?t? (understand|follow)|can you (explain|clarify)|confused)\b/i,
    /\b(sorry\??|huh\??|pardon)\b/i,
  ],
  ready_to_buy: [
    /\b(how (do|can) (we|i) (get started|sign up|proceed)|next steps?|let'?s? do (it|this))\b/i,
    /\b(send (me|us) (the|more) (info|details|proposal)|set (up|that) up)\b/i,
  ],
  off_topic: [
    /\b(by the way|unrelated|different (topic|question)|quick question about)\b/i,
  ],
  neutral: [],
};

export function detectIntent(utterance: string): IntentType {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [IntentType, RegExp[]][]) {
    if (intent === 'neutral') continue;
    if (patterns.some(p => p.test(utterance))) return intent;
  }
  return 'neutral';
}
