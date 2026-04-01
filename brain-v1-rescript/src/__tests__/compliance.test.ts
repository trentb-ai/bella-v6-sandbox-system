/**
 * compliance.test.ts — Sprint A1: TDD tests for compliance.ts
 * Written FIRST — all tests must FAIL before compliance.ts exists.
 *
 * Tests: checkCompliance, normalizeDollar, checkDollarCompliance,
 *        buildCorrectionPrefix, runLlmJudge
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkCompliance,
  normalizeDollar,
  checkDollarCompliance,
  buildCorrectionPrefix,
  runLlmJudge,
} from '../compliance';

// ─── checkCompliance ─────────────────────────────────────────────────────────

describe('checkCompliance', () => {
  it('exact match — all phrases verbatim → score >= 0.9, compliant true', () => {
    const spoken = 'Alex can recover eight hundred thousand dollars per week for your business';
    const phrases = ['Alex can recover', 'eight hundred thousand dollars'];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.missedPhrases).toHaveLength(0);
  });

  it('70% overlap — most words match, some missing → score ~0.7, compliant true', () => {
    const spoken = 'Alex can recover around thousand dollars per week for your business';
    const phrases = ['Alex can recover eight hundred thousand dollars per week'];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.6);
  });

  it('40% fail — spoken barely matches → score < 0.5, compliant false', () => {
    const spoken = 'the weather is nice today and I like dogs';
    const phrases = ['Alex can recover eight hundred thousand dollars per week'];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(false);
    expect(result.score).toBeLessThan(0.5);
  });

  it('empty phrases — nothing to check → score 1.0, compliant true', () => {
    const spoken = 'anything at all';
    const phrases: string[] = [];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(true);
    expect(result.score).toBe(1.0);
  });

  it('ASR variant: "Alice" for "Alex" → compliant true', () => {
    const spoken = 'Alice can help recover value for your business';
    const phrases = ['Alex can help recover'];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(true);
  });

  it('ASR variant: "Kris" for "Chris" → compliant true', () => {
    const spoken = 'Kris handles your website concierge service';
    const phrases = ['Chris handles your website'];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(true);
  });

  it('ASR variant: "Mattie" for "Maddie" → compliant true', () => {
    const spoken = 'Mattie manages your phone calls after hours';
    const phrases = ['Maddie manages your phone calls'];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(true);
  });

  it('3 of 4 phrases matched → score ~0.75, compliant true', () => {
    const spoken = 'Alex recovers leads, Chris handles website, Maddie answers phones';
    const phrases = [
      'Alex recovers leads',
      'Chris handles website',
      'Maddie answers phones',
      'total combined ROI is eight hundred thousand',
    ];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.6);
    expect(result.missedPhrases.length).toBeGreaterThanOrEqual(1);
  });

  it('1 of 4 phrases matched → score ~0.25, compliant false', () => {
    const spoken = 'Alex recovers leads for the company';
    const phrases = [
      'Alex recovers leads',
      'Chris handles website conversions expertly',
      'Maddie answers missed phone calls overnight',
      'total combined ROI is eight hundred thousand',
    ];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(false);
    expect(result.missedPhrases.length).toBeGreaterThanOrEqual(2);
  });

  it('case insensitive — "ALEX" matches "alex" → compliant true', () => {
    const spoken = 'ALEX can help recover value for your business';
    const phrases = ['alex can help recover'];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(true);
  });
});

// ─── normalizeDollar ─────────────────────────────────────────────────────────

describe('normalizeDollar', () => {
  it('$800K → [800000]', () => {
    expect(normalizeDollar('$800K')).toEqual([800000]);
  });

  it('$800,000 → [800000]', () => {
    expect(normalizeDollar('$800,000')).toEqual([800000]);
  });

  it('$1.2M → [1200000]', () => {
    expect(normalizeDollar('$1.2M')).toEqual([1200000]);
  });

  it('$1,200,000 → [1200000]', () => {
    expect(normalizeDollar('$1,200,000')).toEqual([1200000]);
  });

  it('eight hundred thousand → [800000]', () => {
    expect(normalizeDollar('eight hundred thousand')).toEqual([800000]);
  });

  it('eight hundred thousand dollars → [800000]', () => {
    expect(normalizeDollar('eight hundred thousand dollars')).toEqual([800000]);
  });

  it('$400K and $800K → [400000, 800000]', () => {
    const result = normalizeDollar('$400K and $800K');
    expect(result).toContain(400000);
    expect(result).toContain(800000);
    expect(result).toHaveLength(2);
  });

  it('no dollars here → []', () => {
    expect(normalizeDollar('no dollars here')).toEqual([]);
  });

  it('$50K → [50000]', () => {
    expect(normalizeDollar('$50K')).toEqual([50000]);
  });

  it('$2.5m → [2500000] (case insensitive)', () => {
    expect(normalizeDollar('$2.5m')).toEqual([2500000]);
  });
});

// ─── checkDollarCompliance ───────────────────────────────────────────────────

describe('checkDollarCompliance', () => {
  it('spoken "$800K", expected [800000] → true (exact)', () => {
    expect(checkDollarCompliance('the value is $800K per week', [800000])).toBe(true);
  });

  it('spoken "$840K", expected [800000] → true (within 5% tolerance)', () => {
    expect(checkDollarCompliance('approximately $840K in value', [800000])).toBe(true);
  });

  it('spoken "$400K", expected [800000] → false (50% off)', () => {
    expect(checkDollarCompliance('about $400K in total', [800000])).toBe(false);
  });

  it('spoken "$800K and $400K", expected [800000, 400000] → true', () => {
    expect(checkDollarCompliance('Alex at $800K and Chris at $400K', [800000, 400000])).toBe(true);
  });

  it('spoken "significant amount", expected [800000] → false (no dollar found)', () => {
    expect(checkDollarCompliance('a significant amount of revenue', [800000])).toBe(false);
  });

  it('expected [] (no dollars expected) → true (nothing to check)', () => {
    expect(checkDollarCompliance('anything here', [])).toBe(true);
  });
});

// ─── buildCorrectionPrefix ───────────────────────────────────────────────────

describe('buildCorrectionPrefix', () => {
  const missed = ['Alex can recover'];
  const directive = 'Now tell them about the speed to lead advantage.';

  it('output contains the missed phrase text', () => {
    const result = buildCorrectionPrefix(missed, directive);
    expect(result).toContain('Alex can recover');
  });

  it('output contains "Do not acknowledge"', () => {
    const result = buildCorrectionPrefix(missed, directive);
    expect(result.toLowerCase()).toContain('do not acknowledge');
  });

  it('output contains "Do not apologise"', () => {
    const result = buildCorrectionPrefix(missed, directive);
    expect(result.toLowerCase()).toContain('do not apologise');
  });

  it('output ends with the directive speak string', () => {
    const result = buildCorrectionPrefix(missed, directive);
    expect(result.endsWith(directive)).toBe(true);
  });

  it('output does NOT contain "sorry" or "apolog" (no speakable apology fragments)', () => {
    const result = buildCorrectionPrefix(missed, directive);
    // The "do not apologise" instruction is internal — but the output must not
    // contain standalone apology words Bella could speak aloud.
    // We check the part BEFORE the correction prefix ends (the bracketed section)
    const bracketEnd = result.indexOf(']');
    const internalPart = result.slice(0, bracketEnd + 1);
    // "apologise" appears in "Do not apologise" instruction — that's fine (internal).
    // Check that no standalone "sorry" or "I apologize" appears.
    expect(result).not.toMatch(/\bsorry\b/i);
    expect(result).not.toMatch(/\bI apolog/i);
  });

  it('output starts with "[COMPLIANCE CORRECTION:"', () => {
    const result = buildCorrectionPrefix(missed, directive);
    expect(result.startsWith('[COMPLIANCE CORRECTION:')).toBe(true);
  });

  it('output does NOT contain speakable correction phrases', () => {
    const result = buildCorrectionPrefix(missed, directive);
    expect(result).not.toMatch(/I forgot to mention/i);
    expect(result).not.toMatch(/Let me correct myself/i);
  });
});

// ─── runLlmJudge (mock tests) ───────────────────────────────────────────────

describe('runLlmJudge', () => {
  const mockEnv = {
    GEMINI_API_KEY: 'test-key',
    CALL_BRAIN: {} as any,
    LEADS_KV: {} as any,
  };

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('success — mock returns valid JSON → returns JudgeResult', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              compliant: true,
              driftType: null,
              reason: 'All content delivered correctly',
            }),
          },
        }],
      }),
    };
    (globalThis.fetch as any).mockResolvedValue(mockResponse);

    const result = await runLlmJudge('spoken text', 'directive text', 'ch_alex', mockEnv);
    expect(result).not.toBeNull();
    expect(result!.compliant).toBe(true);
    expect(result!.driftType).toBeNull();
    expect(result!.reason).toBe('All content delivered correctly');
  });

  it('timeout — mock fetch throws → returns null', async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error('timeout'));

    const result = await runLlmJudge('spoken text', 'directive text', 'ch_alex', mockEnv);
    expect(result).toBeNull();
  });

  it('bad JSON — mock returns non-JSON → returns null', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'this is not valid json at all',
          },
        }],
      }),
    };
    (globalThis.fetch as any).mockResolvedValue(mockResponse);

    const result = await runLlmJudge('spoken text', 'directive text', 'ch_alex', mockEnv);
    expect(result).toBeNull();
  });

  it('API error — mock returns 500 → returns null', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    };
    (globalThis.fetch as any).mockResolvedValue(mockResponse);

    const result = await runLlmJudge('spoken text', 'directive text', 'ch_alex', mockEnv);
    expect(result).toBeNull();
  });

  it('empty response — mock returns {} → returns null', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '{}',
          },
        }],
      }),
    };
    (globalThis.fetch as any).mockResolvedValue(mockResponse);

    const result = await runLlmJudge('spoken text', 'directive text', 'ch_alex', mockEnv);
    expect(result).toBeNull();
  });
});
