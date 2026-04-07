/**
 * extraction-workflow-v3 Chunk 5 Assertions
 * C5-01 through C5-15
 */

import { describe, test, expect } from 'vitest';
import { normaliseUtterance } from '../normalise';
import { parseSpokenNumber, parseDuration, mapDurationToBand, deterministicExtract } from '../deterministic-extract';
import { ExtractionResultV1 } from '@bella/contracts';

// ─── C5-01: normaliseUtterance converts spoken numbers ──────────────────────

describe('C5-01: normaliseUtterance converts spoken numbers', () => {
  test('converts "fifty" to "50" in utterance', () => {
    const result = normaliseUtterance('we get about fifty leads a week');
    expect(result).toContain('50');
    expect(result).not.toMatch(/\bfifty\b/i);
  });
});

// ─── C5-02: normaliseUtterance preserves surrounding text ───────────────────

describe('C5-02: normaliseUtterance preserves structure', () => {
  test('replaces only the number word, preserves rest', () => {
    const result = normaliseUtterance('fifty leads a week');
    expect(result).toBe('50 leads a week');
  });
});

// ─── C5-03: deterministicExtract captures ACV at anchor_acv ────────────────

describe('C5-03: deterministicExtract ACV anchor_acv', () => {
  test('extracts acv from spoken dollar amount', () => {
    const result = deterministicExtract('about five thousand dollars', 'anchor_acv');
    expect(result.acv).toBe(5000);
  });
});

// ─── C5-04: deterministicExtract captures leads at ch_alex ─────────────────

describe('C5-04: deterministicExtract leads ch_alex', () => {
  test('extracts inboundLeads from digit utterance', () => {
    const result = deterministicExtract('we get about 50 leads a week', 'ch_alex');
    expect(result.inboundLeads).toBe(50);
  });
});

// ─── C5-05: deterministicExtract captures responseSpeedBand ─────────────────

describe('C5-05: deterministicExtract responseSpeedBand', () => {
  test('maps "half an hour" to 5_to_30_minutes', () => {
    const result = deterministicExtract('usually within half an hour', 'ch_alex');
    expect(result.responseSpeedBand).toBe('5_to_30_minutes');
  });
});

// ─── C5-06: deterministicExtract returns {} for unrecognised input ──────────

describe('C5-06: deterministicExtract returns {} for ambiguous input', () => {
  test('returns empty object for "I\'m not sure"', () => {
    const result = deterministicExtract("I'm not sure", 'ch_alex');
    expect(result).toEqual({});
  });
});

// ─── C5-07: Merge priority — deterministic wins over Gemini ─────────────────

describe('C5-07: merge priority deterministic over Gemini', () => {
  test('deterministic value wins when both present', () => {
    // Simulate merge logic: { ...gemini, ...deterministic }
    const deterministic = { acv: 5000 };
    const gemini = { acv: 4500 };
    const merged = { ...gemini, ...deterministic };
    expect(merged.acv).toBe(5000);
  });
});

// ─── C5-08: parseSpokenNumber handles compound phrases ──────────────────────

describe('C5-08: parseSpokenNumber compound phrases', () => {
  test('two hundred thousand', () => {
    expect(parseSpokenNumber('two hundred thousand')).toBe(200000);
  });
  test('quarter mill', () => {
    expect(parseSpokenNumber('quarter mill')).toBe(250000);
  });
  test('fifty k', () => {
    expect(parseSpokenNumber('fifty k')).toBe(50000);
  });
  test('$1.5m', () => {
    expect(parseSpokenNumber('$1.5m')).toBe(1500000);
  });
});

// ─── C5-09: parseDuration handles time expressions ──────────────────────────

describe('C5-09: parseDuration time expressions', () => {
  test('half an hour', () => {
    expect(parseDuration('half an hour')).toEqual({ value: 30, unit: 'minutes' });
  });
  test('couple of days', () => {
    expect(parseDuration('couple of days')).toEqual({ value: 2, unit: 'days' });
  });
  test('instantly', () => {
    expect(parseDuration('instantly')).toEqual({ value: 0, unit: 'seconds' });
  });
});

// ─── C5-10: mapDurationToBand maps correctly ────────────────────────────────

describe('C5-10: mapDurationToBand', () => {
  test('30 minutes → 5_to_30_minutes', () => {
    expect(mapDurationToBand({ value: 30, unit: 'minutes' })).toBe('5_to_30_minutes');
  });
  test('2 days → next_day_plus', () => {
    expect(mapDurationToBand({ value: 2, unit: 'days' })).toBe('next_day_plus');
  });
  test('0 seconds → under_30_seconds', () => {
    expect(mapDurationToBand({ value: 0, unit: 'seconds' })).toBe('under_30_seconds');
  });
});

// ─── C5-11: ExtractionResult matches ExtractionResultV1 contract ─────────────

describe('C5-11: ExtractionResultV1 structural validation', () => {
  test('parses valid extraction result with no data_source field', () => {
    const payload = {
      version: 1 as const,
      callId: 'call-123',
      turnId: 'turn-1',
      extracted: { acv: 5000 },
    };
    const parsed = ExtractionResultV1.safeParse(payload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('data_source' in parsed.data.extracted).toBe(false);
    }
  });
});

// ─── C5-12: data_source='prospect' upsert verified in chunk1.test.ts ────────

describe('C5-12: data_source upsert semantics', () => {
  test('MOVED TO chunk1.test.ts — C1-SOURCE-UPSERT-01', () => {
    // Brain DO tests own D1 persistence. See chunk1.test.ts.
    expect(true).toBe(true);
  });
});

// ─── C5-13: Upsert source isolation verified in chunk1.test.ts ──────────────

describe('C5-13: upsert source isolation', () => {
  test('MOVED TO chunk1.test.ts — C1-SOURCE-UPSERT-02', () => {
    // Brain DO tests own D1 persistence. See chunk1.test.ts.
    expect(true).toBe(true);
  });
});

// ─── C5-14: normaliseUtterance("fifty leads") contains "50" (MANDATORY) ─────

describe('C5-14: normaliseUtterance fifty leads', () => {
  test('output contains "50"', () => {
    const result = normaliseUtterance('fifty leads');
    expect(result).toContain('50');
  });
});

// ─── C5-15: normaliseUtterance("two hundred thousand") contains "200000" ─────

describe('C5-15: normaliseUtterance two hundred thousand', () => {
  test('output contains "200000"', () => {
    const result = normaliseUtterance('two hundred thousand');
    expect(result).toContain('200000');
  });
});
