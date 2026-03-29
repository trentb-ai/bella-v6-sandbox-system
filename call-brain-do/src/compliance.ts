/**
 * compliance.ts — Sprint A1: Closed-loop compliance checker
 *
 * Functions:
 *   checkCompliance     — word overlap + fuzzy + ASR variant matching
 *   normalizeDollar     — parse dollar amounts from spoken/written text
 *   checkDollarCompliance — compare spoken dollars vs expected (5% tolerance)
 *   buildCorrectionPrefix — terse internal correction for re-issue
 *   runLlmJudge         — async Gemini 2.5 Flash compliance judge (never throws)
 */

import type { ComplianceResult, JudgeResult, Env } from './types';

// ─── ASR Variants ────────────────────────────────────────────────────────────

const ASR_VARIANTS: Record<string, string[]> = {
  alex: ['alice', 'alec', 'alexis'],
  chris: ['kris', 'christopher'],
  maddie: ['mattie', 'maddy'],
};

// ─── Levenshtein Distance ────────────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = [i];
  }
  for (let j = 0; j <= n; j++) {
    dp[0][j] = j;
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[m][n];
}

function levenshteinSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ─── checkCompliance ─────────────────────────────────────────────────────────

export function checkCompliance(
  spokenText: string,
  mustContainPhrases: string[],
): ComplianceResult {
  if (mustContainPhrases.length === 0) {
    return { compliant: true, score: 1.0, missedPhrases: [], dollarCompliant: null };
  }

  const spokenLower = spokenText.toLowerCase();
  const spokenWords = spokenLower.split(/\s+/).filter(w => w.length > 0);

  const phraseScores: number[] = [];
  const missed: string[] = [];

  for (const phrase of mustContainPhrases) {
    const phraseLower = phrase.toLowerCase();
    const phraseWords = phraseLower.split(/\s+/).filter(w => w.length > 0);

    if (phraseWords.length === 0) {
      phraseScores.push(1.0);
      continue;
    }

    // Layer 1: Word overlap
    let matchCount = 0;
    for (const pw of phraseWords) {
      if (spokenWords.includes(pw)) {
        matchCount++;
      }
    }
    const wordOverlap = matchCount / phraseWords.length;

    // Layer 2: Levenshtein fuzzy on full phrase
    const fuzzyScore = levenshteinSimilarity(phraseLower, spokenLower) * 0.7;

    // Layer 3: Name variant check
    let variantMatch = false;
    for (const [canonical, variants] of Object.entries(ASR_VARIANTS)) {
      // Check if phrase contains canonical name
      if (phraseWords.includes(canonical)) {
        // Check if spoken contains any variant
        for (const variant of variants) {
          if (spokenWords.includes(variant)) {
            variantMatch = true;
            // Boost word overlap: count the variant as matching the canonical
            matchCount++;
            break;
          }
        }
      }
    }

    // Recalculate word overlap with variant matches
    const adjustedWordOverlap = variantMatch
      ? Math.min(1.0, matchCount / phraseWords.length)
      : wordOverlap;

    const effectiveScore = Math.max(
      adjustedWordOverlap,
      fuzzyScore,
      variantMatch ? 0.8 : 0,
    );

    phraseScores.push(effectiveScore);
    if (effectiveScore < 0.5) {
      missed.push(phrase);
    }
  }

  const avgScore = phraseScores.reduce((sum, s) => sum + s, 0) / phraseScores.length;

  return {
    compliant: avgScore >= 0.6,
    score: avgScore,
    missedPhrases: missed,
    dollarCompliant: null,
  };
}

// ─── normalizeDollar ─────────────────────────────────────────────────────────

const WRITTEN_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  hundred: 100, thousand: 1000, million: 1000000,
};

function parseWrittenNumber(words: string[]): number | null {
  if (words.length === 0) return null;

  let result = 0;
  let current = 0;

  for (const word of words) {
    const val = WRITTEN_NUMBERS[word.toLowerCase()];
    if (val === undefined) continue;

    if (val === 100) {
      current = current === 0 ? 100 : current * 100;
    } else if (val === 1000) {
      current = current === 0 ? 1000 : current * 1000;
      result += current;
      current = 0;
    } else if (val === 1000000) {
      current = current === 0 ? 1000000 : current * 1000000;
      result += current;
      current = 0;
    } else {
      current += val;
    }
  }

  result += current;
  return result > 0 ? result : null;
}

export function normalizeDollar(text: string): number[] {
  const results: number[] = [];

  // Pattern 1: $X.XM or $XM (millions)
  const millionPattern = /\$(\d+(?:\.\d+)?)\s*m(?:illion)?/gi;
  let match;
  while ((match = millionPattern.exec(text)) !== null) {
    results.push(parseFloat(match[1]) * 1000000);
  }

  // Pattern 2: $XK (thousands)
  const kPattern = /\$(\d+(?:\.\d+)?)\s*k/gi;
  while ((match = kPattern.exec(text)) !== null) {
    results.push(parseFloat(match[1]) * 1000);
  }

  // Pattern 3: $X,XXX,XXX or $X,XXX (comma-separated)
  const commaPattern = /\$(\d{1,3}(?:,\d{3})+)/g;
  while ((match = commaPattern.exec(text)) !== null) {
    const numStr = match[1].replace(/,/g, '');
    results.push(parseInt(numStr, 10));
  }

  // Pattern 4: Written numbers (e.g., "eight hundred thousand")
  // Only if no symbol-based matches found yet for this region
  if (results.length === 0) {
    const words = text.toLowerCase().split(/\s+/);
    // Filter to known number words and "dollars"
    const numberWords = words.filter(w =>
      WRITTEN_NUMBERS[w] !== undefined || w === 'dollars',
    );
    // Remove trailing "dollars"
    const cleaned = numberWords.filter(w => w !== 'dollars');
    if (cleaned.length > 0) {
      const parsed = parseWrittenNumber(cleaned);
      if (parsed !== null && parsed > 0) {
        results.push(parsed);
      }
    }
  }

  return results;
}

// ─── checkDollarCompliance ───────────────────────────────────────────────────

export function checkDollarCompliance(
  spokenText: string,
  expectedDollars: number[],
): boolean {
  if (expectedDollars.length === 0) return true;

  const spokenDollars = normalizeDollar(spokenText);
  if (spokenDollars.length === 0) return false;

  // Every expected dollar must have a match within 5% tolerance
  for (const expected of expectedDollars) {
    const tolerance = expected * 0.05;
    const hasMatch = spokenDollars.some(
      spoken => Math.abs(spoken - expected) <= tolerance,
    );
    if (!hasMatch) return false;
  }

  return true;
}

// ─── buildCorrectionPrefix ───────────────────────────────────────────────────

export function buildCorrectionPrefix(
  missedPhrases: string[],
  directiveSpeak: string,
): string {
  const missedList = missedPhrases
    .map(p => `'${p}'`)
    .join('; ');

  return `[COMPLIANCE CORRECTION: required ${missedList} but did not. Include naturally. Do not acknowledge. Do not apologise.] ${directiveSpeak}`;
}

// ─── runLlmJudge ─────────────────────────────────────────────────────────────

export async function runLlmJudge(
  spokenText: string,
  directiveSpeak: string,
  stage: string,
  env: Pick<Env, 'GEMINI_API_KEY'>,
): Promise<JudgeResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const systemPrompt = 'You are a compliance auditor for a voice AI agent. The agent was directed to say specific content. Compare what was directed vs what was spoken. Reply ONLY with JSON: {"compliant": bool, "driftType": "omission"|"substitution"|"hallucination"|"false_claim"|null, "reason": "one sentence"}';
    const userPrompt = `DIRECTIVE: ${directiveSpeak}\nSPOKEN: ${spokenText}\nSTAGE: ${stage}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GEMINI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gemini-2.5-flash',
          temperature: 0,
          max_tokens: 100,
          reasoning_effort: 'none',
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
        signal: controller.signal,
      },
    );

    clearTimeout(timeout);

    if (!response.ok) {
      console.log(`[JUDGE_ERR] status=${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      console.log('[JUDGE_ERR] no content in response');
      return null;
    }

    let parsed: any;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.log('[JUDGE_ERR] invalid JSON in content');
      return null;
    }

    // Validate required fields
    if (typeof parsed.compliant !== 'boolean' || typeof parsed.reason !== 'string') {
      console.log('[JUDGE_ERR] missing required fields');
      return null;
    }

    return {
      compliant: parsed.compliant,
      driftType: parsed.driftType ?? null,
      reason: parsed.reason,
    };
  } catch (err: any) {
    console.log(`[JUDGE_ERR] ${err.message}`);
    return null;
  }
}
