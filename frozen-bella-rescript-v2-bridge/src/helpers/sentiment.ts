export interface SentimentResult {
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: 'high' | 'medium' | 'low';
  markers: string[];
}

const NEGATIVE_PATTERNS = [
  /\b(no|nope|nah)\b/gi,
  /\b(didn't|doesn't|don't|not|never|wrong|incorrect|false)\b/gi,
  /you\s+(don't|didn't|haven't)\s+(have|get|got)/gi,
  /that'?s\s+(not|wrong|incorrect)/gi,
  /not\s+(right|accurate|correct)/gi,
];

const POSITIVE_PATTERNS = [
  /\b(yes|yeah|yep|yup)\b/gi,
  /\b(correct|right|exactly|accurate|confirmed)\b/gi,
  /sounds?\s+(right|good|correct)/gi,
  /that'?s\s+right/gi,
  /makes\s+sense/gi,
];

export function extractWowSentiment(text: string): SentimentResult {
  if (!text || text.trim().length < 2) {
    return { sentiment: 'neutral', confidence: 'low', markers: [] };
  }

  const neg: string[] = NEGATIVE_PATTERNS.flatMap(p =>
    Array.from(text.matchAll(p)).map(m => m[0].trim())
  );
  const pos: string[] = POSITIVE_PATTERNS.flatMap(p =>
    Array.from(text.matchAll(p)).map(m => m[0].trim())
  );

  if (neg.length > pos.length) {
    return {
      sentiment: 'negative',
      confidence: neg.length >= 2 ? 'high' : 'medium',
      markers: neg,
    };
  }
  if (pos.length > neg.length) {
    return {
      sentiment: 'positive',
      confidence: pos.length >= 2 ? 'high' : 'medium',
      markers: pos,
    };
  }
  return { sentiment: 'neutral', confidence: 'low', markers: [] };
}
