import type { QuestionCacheEntry } from '../types/flowStateExtension';

// Stop words for keyword extraction — domain words that appear in nearly every question
// are excluded to prevent false-positive Jaccard matches
const STOP_WORDS = new Set([
  'how', 'many', 'much', 'are', 'is', 'you', 'your', 'the', 'a', 'in',
  'per', 'week', 'year', 'month', 'do', 'does', 'what', 'about', 'on',
  'average', 'typically', 'usually', 'roughly', 'around', 'approximately',
  'and', 'or', 'of', 'to', 'for', 'that', 'this', 'it',
]);

function extractKeywords(q: string): string[] {
  return (q.toLowerCase().match(/\b\w+\b/g) ?? [])
    .filter(w => !STOP_WORDS.has(w) && w.length > 2)
    .slice(0, 6);
}

function jaccardSimilarity(q1: string, q2: string): number {
  const s1 = new Set(extractKeywords(q1));
  const s2 = new Set(extractKeywords(q2));
  const intersection = [...s1].filter(x => s2.has(x)).length;
  const union = new Set([...s1, ...s2]).size;
  return union === 0 ? 0 : intersection / union;
}

export interface DedupResult {
  shouldBlock: boolean;
  reason?: string;
  existingValue?: string | number;
}

export function shouldBlockDuplicateQuestion(
  newQuestion: string,
  extractionField: string,
  cache: QuestionCacheEntry[]
): DedupResult {
  for (const entry of cache) {
    // RULE 1 (highest priority): exact field match with a captured value — always block
    if (entry.extractionField === extractionField && entry.extractedValue != null) {
      return {
        shouldBlock: true,
        reason: `Field '${extractionField}' already captured: ${entry.extractedValue}`,
        existingValue: entry.extractedValue as string | number,
      };
    }

    // RULE 2: max attempts on same field — block regardless of whether value was extracted
    if (entry.extractionField === extractionField && entry.attempts >= 3) {
      return {
        shouldBlock: true,
        reason: `Field '${extractionField}' asked ${entry.attempts} times — prospect not engaging`,
      };
    }

    // RULE 3 (secondary): semantic similarity — only fires if RULE 1 didn't already block
    // and the similar question DID extract a value
    if (
      entry.extractedValue != null &&
      jaccardSimilarity(newQuestion, entry.question) >= 0.70
    ) {
      return {
        shouldBlock: true,
        reason: `Semantically similar to already-answered question (${Math.round(
          jaccardSimilarity(newQuestion, entry.question) * 100
        )}% match): "${entry.question}"`,
        existingValue: entry.extractedValue as string | number,
      };
    }
  }

  return { shouldBlock: false };
}
