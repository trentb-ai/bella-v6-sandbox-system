/**
 * brain-v3/src/roi.ts — Deterministic ROI calculators
 * Chunk 1 — V3
 *
 * Ported VERBATIM from V2 call-brain-do/src/roi.ts (doc-bella-roi-calculators-source-20260407).
 * Do not modify formulas, constants, or guard logic.
 *
 * Core agents (Alex, Chris, Maddie) → default queue + combined ROI.
 * Optional agents (Sarah, James) → deferred to Chunk 7.
 *
 * ROI COMMERCIAL NOTE (AUDIT-1, 27 March 2026):
 * DO formulas produce ~10x larger figures than the legacy bridge formulas.
 * This is CORRECT — the bridge had a /52 bug dividing weekly inputs by 52.
 * Approved by founder for launch.
 */

import type {
  CoreAgent,
  ResponseSpeedBand,
  AlexRoiInputs,
  ChrisRoiInputs,
  MaddieRoiInputs,
  AgentRoiResult,
  CombinedRoiResult,
} from './types';

import { normalizeConversionRate, alexGapFactor } from './helpers';

// ─── Constants ──────────────────────────────────────────────────────────────

// Alex — speed-to-lead
const ALEX_MAX_UPLIFT = 3.94;
const ALEX_CONVERSION_CAP = 0.40;

// Chris — website conversion
const CHRIS_UPLIFT = 0.23;
const CHRIS_CONVERSION_CAP = 0.35;

// Maddie — missed call recovery
const MADDIE_RECOVERY_RATE = 0.35;
const MADDIE_BOOKED_VALUE_RATE = 0.5;

// ─── Alex ROI ───────────────────────────────────────────────────────────────

/**
 * Alex ROI: speed-to-lead conversion uplift.
 * The slower the current response, the bigger the gap Alex can close.
 */
export function computeAlexRoi(input: AlexRoiInputs): AgentRoiResult {
  const currentRate = normalizeConversionRate(input.leads, input.conversions, input.conversionRate);

  // Implausible rate guard — conversions >= leads means extraction artifact
  if (currentRate >= 0.95) {
    console.log(`[CALC_GUARD] Alex currentRate=${(currentRate * 100).toFixed(1)}% — implausibly high (leads=${input.leads} conv=${input.conversions} rate=${input.conversionRate}), using conservative 15% default`);
    return computeAlexRoi({ ...input, conversions: null, conversionRate: 0.15 });
  }

  console.log(`[CALC_INPUT] Alex leads=${input.leads} conv=${input.conversions} rate=${input.conversionRate} band=${input.responseSpeedBand} currentRate=${(currentRate * 100).toFixed(1)}%`);

  const gap = alexGapFactor(input.responseSpeedBand);
  const effectiveLift = ALEX_MAX_UPLIFT * gap;
  const projectedRate = Math.min(currentRate * (1 + effectiveLift), ALEX_CONVERSION_CAP);
  const incrementalRate = Math.max(0, projectedRate - currentRate);
  const weeklyValue = Math.round(input.leads * incrementalRate * input.acv);

  return {
    agent: 'alex',
    weeklyValue,
    confidence: currentRate > 0 ? 'medium' : 'low',
    assumptionsUsed: [
      `currentRate=${(currentRate * 100).toFixed(1)}%`,
      `gapFactor=${gap}`,
      `effectiveLift=${(effectiveLift * 100).toFixed(1)}%`,
      `projectedRate=${(projectedRate * 100).toFixed(1)}%`,
    ],
    rationale: `Speed-to-lead uplift: ${input.responseSpeedBand} response → ${(incrementalRate * 100).toFixed(1)}% incremental conversion rate on ${input.leads} leads.`,
    conservative: true,
  };
}

// ─── Chris ROI ──────────────────────────────────────────────────────────────

/**
 * Chris ROI: website conversion rate uplift.
 * Flat 23% improvement on current conversion rate, capped at 35%.
 */
export function computeChrisRoi(input: ChrisRoiInputs): AgentRoiResult {
  const currentRate = normalizeConversionRate(input.leads, input.conversions, input.conversionRate);
  const projectedRate = Math.min(currentRate * (1 + CHRIS_UPLIFT), CHRIS_CONVERSION_CAP);
  const incrementalRate = Math.max(0, projectedRate - currentRate);
  const weeklyValue = Math.round(input.leads * incrementalRate * input.acv);

  return {
    agent: 'chris',
    weeklyValue,
    confidence: currentRate > 0 ? 'medium' : 'low',
    assumptionsUsed: [
      `currentRate=${(currentRate * 100).toFixed(1)}%`,
      `uplift=${(CHRIS_UPLIFT * 100).toFixed(0)}%`,
      `projectedRate=${(projectedRate * 100).toFixed(1)}%`,
    ],
    rationale: `Website conversion uplift: ${(CHRIS_UPLIFT * 100).toFixed(0)}% improvement on ${input.leads} leads at $${input.acv} ACV.`,
    conservative: true,
  };
}

// ─── Maddie ROI ─────────────────────────────────────────────────────────────

/**
 * Maddie ROI: missed call recovery.
 * Recovers 35% of missed calls, 50% of those convert to booked value.
 */
export function computeMaddieRoi(input: MaddieRoiInputs): AgentRoiResult {
  const missed = input.missedCalls ?? Math.round(input.phoneVolume * (input.missedCallRate ?? 0));
  const recoverableCalls = missed * MADDIE_RECOVERY_RATE;
  const weeklyValue = Math.round(recoverableCalls * input.acv * MADDIE_BOOKED_VALUE_RATE);

  return {
    agent: 'maddie',
    weeklyValue,
    confidence: typeof input.missedCalls === 'number' ? 'medium' : 'low',
    assumptionsUsed: [
      `missedCalls=${missed}`,
      `recoveryRate=${(MADDIE_RECOVERY_RATE * 100).toFixed(0)}%`,
      `bookedValueRate=${(MADDIE_BOOKED_VALUE_RATE * 100).toFixed(0)}%`,
    ],
    rationale: `Missed call recovery: ${missed} missed calls × ${(MADDIE_RECOVERY_RATE * 100).toFixed(0)}% recovery × $${input.acv} ACV.`,
    conservative: true,
  };
}

// ─── Combined ROI ───────────────────────────────────────────────────────────

/**
 * Aggregate ROI across core agents only (Alex, Chris, Maddie).
 * Sarah and James are NEVER included in the combined total.
 */
export function computeCombinedRoi(
  results: Partial<Record<CoreAgent, AgentRoiResult>>,
): CombinedRoiResult {
  const coreOrder: CoreAgent[] = ['alex', 'chris', 'maddie'];
  const orderedAgents = coreOrder.filter(a => results[a] != null);

  let totalWeeklyValue = 0;
  for (const agent of orderedAgents) {
    totalWeeklyValue += results[agent]!.weeklyValue;
  }

  return { totalWeeklyValue, perAgent: results, orderedAgents };
}
