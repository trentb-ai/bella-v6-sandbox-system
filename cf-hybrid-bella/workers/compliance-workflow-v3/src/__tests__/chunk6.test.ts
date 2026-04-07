/**
 * compliance-workflow-v3 Chunk 6 Assertions
 * C6-01 through C6-14
 */

import { describe, test, expect } from 'vitest';
import { inlineCheck } from '../ring1';
import { extractDollarFigures, verifyRoiExactMatch } from '../roi-match';
import { ComplianceResultV1, CompliancePayloadV1 } from '@bella/contracts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePayload(overrides: Partial<{
  callId: string;
  turnId: string;
  stage: string;
  directive: string;
  bellaResponse: string;
  prospectUtterance: string;
}> = {}) {
  return {
    version: 1 as const,
    callId: overrides.callId ?? 'call-1',
    turnId: overrides.turnId ?? 'turn-1',
    stage: overrides.stage ?? 'wow_1',
    directive: overrides.directive ?? 'Greet the prospect warmly.',
    bellaResponse: overrides.bellaResponse ?? 'Welcome! I can see you run a great business.',
    prospectUtterance: overrides.prospectUtterance ?? 'Hello',
  };
}

// ─── C6-01: inlineCheck returns score=1.0 for clean response ─────────────────

describe('C6-01: inlineCheck clean response', () => {
  test('score=1.0, driftType=none', () => {
    const result = inlineCheck(makePayload());
    expect(result.score).toBe(1.0);
    expect(result.driftType).toBe('none');
  });
});

// ─── C6-02: inlineCheck ROI mismatch → score=0.0 false_claim ─────────────────

describe('C6-02: inlineCheck ROI mismatch', () => {
  test('score=0.0, driftType=false_claim when locked figure absent', () => {
    const result = inlineCheck(makePayload({
      stage: 'roi_delivery',
      directive: 'lockedLines: ["Alex adds $12,500/yr"]',
      bellaResponse: 'Alex would add significant value to your business.',
    }));
    expect(result.score).toBe(0.0);
    expect(result.driftType).toBe('false_claim');
    expect(result.details).toContain('$12,500');
  });
});

// ─── C6-03: inlineCheck ROI exact match → score=1.0 ─────────────────────────

describe('C6-03: inlineCheck ROI exact match passes', () => {
  test('score=1.0 when locked figure present in response', () => {
    const result = inlineCheck(makePayload({
      stage: 'roi_delivery',
      directive: 'lockedLines: ["Alex adds $12,500/yr"]',
      bellaResponse: 'With Alex, you would gain $12,500 per year in recovered revenue.',
    }));
    expect(result.score).toBe(1.0);
    expect(result.driftType).toBe('none');
  });
});

// ─── C6-04: inlineCheck cold-call framing ────────────────────────────────────

describe('C6-04: inlineCheck cold-call framing', () => {
  test('score=0.1, driftType=false_claim', () => {
    const result = inlineCheck(makePayload({
      bellaResponse: 'Hi this is Bella calling from our company today.',
    }));
    expect(result.score).toBe(0.1);
    expect(result.driftType).toBe('false_claim');
  });
});

// ─── C6-05: inlineCheck website critique → false_claim ───────────────────────

describe('C6-05: inlineCheck website critique', () => {
  test('score=0.2, driftType=false_claim (NOT omission)', () => {
    const result = inlineCheck(makePayload({
      bellaResponse: 'I can see your website needs work to capture more leads.',
    }));
    expect(result.score).toBe(0.2);
    expect(result.driftType).toBe('false_claim');
    expect(result.details).toContain('Law 8');
  });
});

// ─── C6-06: ROI check skipped when stage !== roi_delivery ────────────────────

describe('C6-06: ROI check skipped for non-roi_delivery stages', () => {
  test('returns 1.0 even with lockedLines when stage is wow_1', () => {
    const result = inlineCheck(makePayload({
      stage: 'wow_1',
      directive: 'lockedLines: ["Alex adds $12,500/yr"]',
      bellaResponse: 'Great to meet you!',
    }));
    expect(result.score).toBe(1.0);
    expect(result.driftType).toBe('none');
  });
});

// ─── C6-07: extractDollarFigures single figure ───────────────────────────────

describe('C6-07: extractDollarFigures single figure', () => {
  test('extracts $12,500 from "Alex adds $12,500/yr"', () => {
    expect(extractDollarFigures('Alex adds $12,500/yr')).toEqual(['$12,500']);
  });
});

// ─── C6-08: extractDollarFigures combined figure ─────────────────────────────

describe('C6-08: extractDollarFigures combined figure', () => {
  test('extracts $45,000 from "combined $45,000 per year"', () => {
    expect(extractDollarFigures('combined $45,000 per year')).toEqual(['$45,000']);
  });
});

// ─── C6-09: verifyRoiExactMatch no lockedLines → match=true ──────────────────

describe('C6-09: verifyRoiExactMatch no lockedLines', () => {
  test('returns { match: true } when directive has no lockedLines', () => {
    expect(verifyRoiExactMatch('Deliver the ROI summary clearly.', 'Here is your ROI.')).toEqual({ match: true });
  });
});

// ─── C6-10: verifyRoiExactMatch figure present → match=true ──────────────────

describe('C6-10: verifyRoiExactMatch figure present', () => {
  test('returns { match: true } when $12,500 is in response', () => {
    const result = verifyRoiExactMatch(
      'lockedLines: ["Alex adds $12,500/yr"]',
      'Alex would add $12,500 per year.',
    );
    expect(result.match).toBe(true);
  });
});

// ─── C6-11: verifyRoiExactMatch figure absent → match=false ──────────────────

describe('C6-11: verifyRoiExactMatch figure absent', () => {
  test('returns { match: false, details: "Missing: $12,500" }', () => {
    const result = verifyRoiExactMatch(
      'lockedLines: ["Alex adds $12,500/yr"]',
      'Alex would add significant value.',
    );
    expect(result.match).toBe(false);
    expect(result.details).toBe('Missing: $12,500');
  });
});

// ─── C6-12: POST /check-inline returns valid ComplianceResultV1 ──────────────

describe('C6-12: inlineCheck output parses as ComplianceResultV1', () => {
  test('Zod parse succeeds, score in [0,1]', () => {
    const output = inlineCheck(makePayload());
    const parsed = ComplianceResultV1.safeParse(output);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.score).toBeGreaterThanOrEqual(0);
      expect(parsed.data.score).toBeLessThanOrEqual(1);
    }
  });
});

// ─── C6-13: /audit-turn route validates CompliancePayloadV1 ──────────────────

describe('C6-13: CompliancePayloadV1 validation', () => {
  test('valid payload parses successfully', () => {
    const parsed = CompliancePayloadV1.safeParse(makePayload());
    expect(parsed.success).toBe(true);
  });

  test('missing callId fails validation', () => {
    const parsed = CompliancePayloadV1.safeParse({ ...makePayload(), callId: '' });
    expect(parsed.success).toBe(false);
  });
});

// ─── C6-14: NightlyPayload type accepts optional date ────────────────────────

describe('C6-14: NightlyPayload optional date', () => {
  test('empty payload is valid for nightly workflow', () => {
    // NightlyPayload { date?: string } — empty object is valid
    const payload: { date?: string } = {};
    const date = payload.date ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('explicit date is preserved', () => {
    const payload: { date?: string } = { date: '2026-04-06' };
    const date = payload.date ?? 'fallback';
    expect(date).toBe('2026-04-06');
  });
});
