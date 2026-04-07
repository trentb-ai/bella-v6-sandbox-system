/**
 * brain-v3/src/engagement.ts — Prospect engagement scoring
 * Chunk 7 — Layer 4 (Intelligence Layers)
 * Pure sync — scored per turn, trended over call.
 */

export type EngagementLevel = 'low' | 'medium' | 'high';

export interface EngagementSignals {
  wordCount: number;
  hasQuestion: boolean;
  hasAffirmation: boolean;
  hasMention: boolean;
}

const AFFIRMATION_RE = /\b(yes|yeah|yep|right|exactly|absolutely|definitely|sure|correct|true)\b/i;
const QUESTION_RE = /\?/;
const MENTION_RE = /\b(we|our|my|i|us)\b/i;

export function extractEngagementSignals(utterance: string): EngagementSignals {
  return {
    wordCount: utterance.trim().split(/\s+/).length,
    hasQuestion: QUESTION_RE.test(utterance),
    hasAffirmation: AFFIRMATION_RE.test(utterance),
    hasMention: MENTION_RE.test(utterance),
  };
}

export function scoreEngagement(signals: EngagementSignals): number {
  let score = 0;
  if (signals.wordCount >= 20) score += 2;
  else if (signals.wordCount >= 10) score += 1;
  if (signals.hasQuestion) score += 2;
  if (signals.hasAffirmation) score += 1;
  if (signals.hasMention) score += 1;
  return Math.min(score, 5);
}

export function engagementLevel(score: number): EngagementLevel {
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}
