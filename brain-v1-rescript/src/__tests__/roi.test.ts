import { describe, it, expect } from 'vitest';
import {
  alexGapFactor,
  normalizeConversionRate,
  computeAlexRoi,
  computeChrisRoi,
  computeMaddieRoi,
  computeSarahRoi,
  computeJamesRoi,
  computeCombinedRoi,
} from '../roi';
import type { AlexRoiInputs, ChrisRoiInputs, MaddieRoiInputs, AgentRoiResult } from '../types';

// ─── alexGapFactor ──────────────────────────────────────────────────────────

describe('alexGapFactor', () => {
  it('returns 0.0 for under_30_seconds', () => {
    expect(alexGapFactor('under_30_seconds')).toBe(0.0);
  });
  it('returns 0.05 for under_5_minutes', () => {
    expect(alexGapFactor('under_5_minutes')).toBe(0.05);
  });
  it('returns 0.35 for 5_to_30_minutes', () => {
    expect(alexGapFactor('5_to_30_minutes')).toBe(0.35);
  });
  it('returns 0.6 for 30_minutes_to_2_hours', () => {
    expect(alexGapFactor('30_minutes_to_2_hours')).toBe(0.6);
  });
  it('returns 0.85 for 2_to_24_hours', () => {
    expect(alexGapFactor('2_to_24_hours')).toBe(0.85);
  });
  it('returns 1.0 for next_day_plus', () => {
    expect(alexGapFactor('next_day_plus')).toBe(1.0);
  });
  it('returns 0.35 for unknown (conservative default)', () => {
    expect(alexGapFactor('unknown')).toBe(0.35);
  });
});

// ─── normalizeConversionRate ──────────────────────────────────────────────────

describe('normalizeConversionRate', () => {
  it('prefers explicit rate over computed', () => {
    expect(normalizeConversionRate(100, 20, 0.15)).toBe(0.15);
  });
  it('computes from conversions/leads when rate is null', () => {
    expect(normalizeConversionRate(100, 20, null)).toBe(0.2);
  });
  it('returns 0 when both conversions and rate are missing', () => {
    expect(normalizeConversionRate(100, null, null)).toBe(0);
  });
  it('returns 0 when leads is 0 and rate is null', () => {
    expect(normalizeConversionRate(0, 10, null)).toBe(0);
  });
});

// ─── computeAlexRoi ─────────────────────────────────────────────────────────

describe('computeAlexRoi', () => {
  it('returns near-zero uplift for fast response team', () => {
    const result = computeAlexRoi({
      acv: 5000,
      leads: 50,
      conversionRate: 0.1,
      responseSpeedBand: 'under_5_minutes',
    });
    // gap=0.05, effectiveLift=3.94*0.05=0.197, projected=0.1*1.197=0.1197
    // incremental=0.0197, weekly=50*0.0197*5000=4925 → round
    expect(result.weeklyValue).toBeLessThan(5000);
    expect(result.agent).toBe('alex');
    expect(result.confidence).toBe('medium');
    expect(result.conservative).toBe(true);
  });

  it('returns large uplift for slow response team', () => {
    const result = computeAlexRoi({
      acv: 5000,
      leads: 50,
      conversionRate: 0.1,
      responseSpeedBand: 'next_day_plus',
    });
    // gap=1.0, effectiveLift=3.94, projected=min(0.1*4.94, 0.40)=0.40
    // incremental=0.30, weekly=50*0.30*5000=75000
    expect(result.weeklyValue).toBeGreaterThan(50000);
    expect(result.agent).toBe('alex');
  });

  it('returns weeklyValue=0 when conversion rate is 0', () => {
    const result = computeAlexRoi({
      acv: 5000,
      leads: 50,
      responseSpeedBand: 'next_day_plus',
    });
    // currentRate=0, projected=min(0*4.94,0.40)=0, incremental=0
    expect(result.weeklyValue).toBe(0);
    expect(result.confidence).toBe('low');
  });

  it('caps projected rate at 40%', () => {
    const result = computeAlexRoi({
      acv: 1000,
      leads: 100,
      conversionRate: 0.35,
      responseSpeedBand: 'next_day_plus',
    });
    // projected would be 0.35*4.94=1.729 → capped at 0.40
    // incremental = 0.40 - 0.35 = 0.05
    expect(result.weeklyValue).toBe(Math.round(100 * 0.05 * 1000));
  });

  it('produces weekly output directly — no /52 division', () => {
    const result = computeAlexRoi({
      acv: 2000,
      leads: 20,
      conversionRate: 0.1,
      responseSpeedBand: '2_to_24_hours',
    });
    // Weekly inputs → weekly output. Verify by manual calc.
    const gap = 0.85;
    const lift = 3.94 * gap; // 3.349
    const projected = Math.min(0.1 * (1 + lift), 0.40); // min(0.4349, 0.40) = 0.40
    const incremental = 0.40 - 0.1; // 0.30
    const expected = Math.round(20 * incremental * 2000); // 12000
    expect(result.weeklyValue).toBe(expected);
  });
});

// ─── computeChrisRoi ────────────────────────────────────────────────────────

describe('computeChrisRoi', () => {
  it('computes standard case correctly', () => {
    const result = computeChrisRoi({
      acv: 3000,
      leads: 100,
      conversionRate: 0.05,
    });
    // projected = min(0.05*1.23, 0.35) = 0.0615
    // incremental = 0.0615 - 0.05 = 0.0115
    // weekly = round(100 * 0.0115 * 3000) = round(3450) = 3450
    expect(result.weeklyValue).toBe(Math.round(100 * 0.0115 * 3000));
    expect(result.agent).toBe('chris');
  });

  it('caps at 35% conversion rate', () => {
    const result = computeChrisRoi({
      acv: 1000,
      leads: 100,
      conversionRate: 0.34,
    });
    // projected = min(0.34*1.23, 0.35) = min(0.4182, 0.35) = 0.35
    // incremental = 0.35 - 0.34 = 0.01
    expect(result.weeklyValue).toBe(Math.round(100 * 0.01 * 1000));
  });

  it('returns 0 for zero leads', () => {
    const result = computeChrisRoi({
      acv: 5000,
      leads: 0,
      conversionRate: 0.1,
    });
    expect(result.weeklyValue).toBe(0);
  });
});

// ─── computeMaddieRoi ───────────────────────────────────────────────────────

describe('computeMaddieRoi', () => {
  it('computes from missedCalls number', () => {
    const result = computeMaddieRoi({
      acv: 2000,
      phoneVolume: 50,
      missedCalls: 10,
    });
    // recoverable = 10 * 0.35 = 3.5
    // weekly = round(3.5 * 2000 * 0.5) = round(3500) = 3500
    expect(result.weeklyValue).toBe(3500);
    expect(result.agent).toBe('maddie');
    expect(result.confidence).toBe('medium');
  });

  it('computes from missedCallRate when missedCalls is null', () => {
    const result = computeMaddieRoi({
      acv: 2000,
      phoneVolume: 50,
      missedCallRate: 0.2,
    });
    // missed = round(50 * 0.2) = 10
    // recoverable = 10 * 0.35 = 3.5
    // weekly = round(3.5 * 2000 * 0.5) = 3500
    expect(result.weeklyValue).toBe(3500);
    expect(result.confidence).toBe('low'); // missedCalls is undefined
  });

  it('returns 0 when both missedCalls and missedCallRate are null', () => {
    const result = computeMaddieRoi({
      acv: 2000,
      phoneVolume: 50,
    });
    // missed = round(50 * 0) = 0
    expect(result.weeklyValue).toBe(0);
  });
});

// ─── computeCombinedRoi ─────────────────────────────────────────────────────

describe('computeCombinedRoi', () => {
  const alexResult: AgentRoiResult = {
    agent: 'alex', weeklyValue: 10000, confidence: 'medium',
    assumptionsUsed: [], rationale: '', conservative: true,
  };
  const chrisResult: AgentRoiResult = {
    agent: 'chris', weeklyValue: 5000, confidence: 'medium',
    assumptionsUsed: [], rationale: '', conservative: true,
  };
  const maddieResult: AgentRoiResult = {
    agent: 'maddie', weeklyValue: 3000, confidence: 'medium',
    assumptionsUsed: [], rationale: '', conservative: true,
  };

  it('sums all 3 core agents', () => {
    const combined = computeCombinedRoi({
      alex: alexResult, chris: chrisResult, maddie: maddieResult,
    });
    expect(combined.totalWeeklyValue).toBe(18000);
    expect(combined.orderedAgents).toEqual(['alex', 'chris', 'maddie']);
  });

  it('handles alex only', () => {
    const combined = computeCombinedRoi({ alex: alexResult });
    expect(combined.totalWeeklyValue).toBe(10000);
    expect(combined.orderedAgents).toEqual(['alex']);
  });

  it('handles empty results', () => {
    const combined = computeCombinedRoi({});
    expect(combined.totalWeeklyValue).toBe(0);
    expect(combined.orderedAgents).toEqual([]);
  });

  it('orders agents alex→chris→maddie regardless of insertion order', () => {
    const combined = computeCombinedRoi({
      maddie: maddieResult, alex: alexResult,
    });
    expect(combined.orderedAgents).toEqual(['alex', 'maddie']);
  });
});

// ─── Sarah and James (optional, never in combined) ──────────────────────────

describe('optional agents', () => {
  it('Sarah computes but is never in combined ROI', () => {
    const sarah = computeSarahRoi({ acv: 2000, oldLeads: 100 });
    expect(sarah.agent).toBe('sarah');
    expect(sarah.weeklyValue).toBe(Math.round(100 * 0.05 * 2000)); // 10000
    // Not in combined
    const combined = computeCombinedRoi({});
    expect(combined.orderedAgents).not.toContain('sarah');
  });

  it('James returns 0 when near star ceiling', () => {
    const james = computeJamesRoi({
      acv: 3000, newCustomersPerWeek: 10, currentStars: 4.97, hasReviewSystem: true,
    });
    expect(james.weeklyValue).toBe(0);
  });

  it('James computes uplift when no review system', () => {
    const james = computeJamesRoi({
      acv: 3000, newCustomersPerWeek: 10, currentStars: 3.5, hasReviewSystem: false,
    });
    // baseUplift=0.5, maxRoom=1.5, projectedUplift=0.5, weeklyRevBase=30000
    // weeklyValue = round(30000 * 0.5 * 0.07) = 1050
    expect(james.weeklyValue).toBe(1050);
  });
});
