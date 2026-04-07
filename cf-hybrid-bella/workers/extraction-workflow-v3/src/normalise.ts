/**
 * extraction-workflow-v3/src/normalise.ts
 * Convert spoken number words to digits before regex extraction.
 * Root fix for V2 zero-extraction bug: "fifty leads" → "50 leads" → regex catches \d+
 */

import { parseSpokenNumber } from './deterministic-extract';

/**
 * Replace spoken number words with digit equivalents in an utterance.
 * Longer/more-specific phrases replaced FIRST to prevent partial matches.
 * parseSpokenNumber() is the single source of truth for word→digit conversion.
 */
export function normaliseUtterance(utterance: string): string {
  if (!utterance) return '';
  let s = utterance;

  // Hundreds of thousands: "two hundred thousand" → "200000"
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine)\s+hundred\s+(?:and\s+)?(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)?[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\s*(?:thousand|grand|k)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Tens-ones thousand: "twenty five thousand" → "25000"
  s = s.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\s*(?:thousand|grand|k)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Single word × thousand: "fifty thousand" → "50000"
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s*(?:thousand|grand|k)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Compound phrases: "half a mill", "quarter mill", "a hundred thousand"
  s = s.replace(
    /\b(?:quarter|half|a|one|couple|few)\s+(?:of\s+)?(?:a\s+)?(?:mill(?:ion)?|hundred\s+thousand|thousand|grand|hundred)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Hundreds: "three hundred" → "300"
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine)\s+hundred\s*(?:and\s*)?(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)?[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\b/gi,
    (match) => {
      const val = parseSpokenNumber(match);
      return val !== null ? String(val) : match;
    }
  );

  // Tens-ones: "twenty five" → "25"
  s = s.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Standalone tens/teens/ones: "fifty" → "50", "fifteen" → "15"
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi,
    (match) => {
      const val = parseSpokenNumber(match);
      return val !== null ? String(val) : match;
    }
  );

  return s;
}
