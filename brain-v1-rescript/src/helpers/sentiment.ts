/**
 * helpers/sentiment.ts — Sprint 2 (Issue 8)
 *
 * Keyword-based sentiment extraction for wow_3/wow_4 user responses.
 * Classifies the prospect's reply as positive (confirms), neutral (ambiguous),
 * or negative (rejects/corrects). Used by flow.ts to skip wow_4 when wow_3
 * gets a negative response.
 *
 * Design: fast, deterministic, no LLM dependency. Regex-only.
 * False-negative-safe: defaults to 'positive' so we never skip unless
 * we're confident the prospect pushed back.
 */

export type WowSentiment = 'positive' | 'neutral' | 'negative';

// ── Negative patterns: prospect rejects, corrects, or pushes back ──
const NEGATIVE_PATTERNS: RegExp[] = [
  /\b(no|nah|nope)\b/i,
  /\bnot\s+(really|quite|exactly|accurate|right|correct)\b/i,
  /\bthat'?s?\s+(not|wrong|incorrect|off|inaccurate)\b/i,
  /\bactually\b/i,               // correction opener
  /\bnot\s+what\s+we\s+do\b/i,
  /\bwe\s+don'?t\b/i,
  /\bi\s+wouldn'?t\s+say\b/i,
  /\bnot\s+how\b/i,
  /\bcompletely\s+(wrong|off|different)\b/i,
  /\bmissed\s+the\s+mark\b/i,
  /\bway\s+off\b/i,
  /\bi\s+disagree\b/i,
];

// ── Positive patterns: prospect confirms ──
const POSITIVE_PATTERNS: RegExp[] = [
  /\b(yes|yeah|yep|yup|correct|exactly|spot\s*on|that'?s?\s+right|absolutely|definitely|for\s+sure)\b/i,
  /\bsounds?\s+(right|good|about\s+right|correct|accurate)\b/i,
  /\bthat'?s?\s+(correct|accurate|pretty\s+much|close\s+enough|bang\s+on)\b/i,
  /\bpretty\s+much\b/i,
  /\bmore\s+or\s+less\b/i,
  /\bon\s+the\s+money\b/i,
  /\bnailed\s+it\b/i,
];

/**
 * extractWowSentiment — classify user speech as positive/neutral/negative.
 *
 * Evaluation order: negative first (we want to catch corrections even when
 * the prospect hedges with "yeah but actually..."). Then positive. If neither
 * matches, return 'neutral' (treated same as positive in flow — no skip).
 */
export function extractWowSentiment(transcript: string): WowSentiment {
  const text = transcript.trim();
  if (!text || text.length < 2) return 'positive'; // empty → filler → confirm

  // Check negative patterns
  for (const pattern of NEGATIVE_PATTERNS) {
    if (pattern.test(text)) {
      // Guard: "not bad" and "not wrong" are actually positive
      if (/\bnot\s+bad\b/i.test(text)) continue;
      if (/\bnot\s+wrong\b/i.test(text)) continue;
      // Guard: "actually yes" / "actually that's right" is positive
      if (/\bactually\b/i.test(text) && POSITIVE_PATTERNS.some(p => p.test(text))) {
        return 'positive';
      }
      return 'negative';
    }
  }

  // Check positive patterns
  for (const pattern of POSITIVE_PATTERNS) {
    if (pattern.test(text)) return 'positive';
  }

  return 'neutral';
}
