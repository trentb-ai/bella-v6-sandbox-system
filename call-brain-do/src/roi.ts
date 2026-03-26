/**
 * call-brain-do/src/roi.ts — v3.0.0-bella-v2
 * V2 deterministic ROI calculators. Weekly-native, no /52 conversion.
 *
 * Core agents (Alex, Chris, Maddie) → default queue + combined ROI.
 * Optional agents (Sarah, James) → on-demand only, never in combined ROI.
 */

import type {
  CoreAgent,
  ResponseSpeedBand,
  AlexRoiInputs,
  ChrisRoiInputs,
  MaddieRoiInputs,
  SarahRoiInputs,
  JamesRoiInputs,
  AgentRoiResult,
  CombinedRoiResult,
} from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Derive a conversion rate from whichever data is available.
 * Priority: explicit rate → computed from conversions/leads → 0.
 */
export function normalizeConversionRate(
  leads: number,
  conversions?: number | null,
  rate?: number | null,
): number {
  if (rate != null) return rate;
  if (conversions != null && leads > 0) return conversions / leads;
  return 0;
}

/**
 * Alex gap-factor lookup — measures how much speed-to-lead improvement is possible.
 * 0.0 = already fast (no gap), 1.0 = very slow (maximum gap to close).
 */
export function alexGapFactor(band: ResponseSpeedBand): number {
  switch (band) {
    case 'under_30_seconds':      return 0.0;   // already fast — no uplift
    case 'under_5_minutes':       return 0.05;  // small gap
    case '5_to_30_minutes':       return 0.35;  // moderate gap
    case '30_minutes_to_2_hours': return 0.6;   // significant gap
    case '2_to_24_hours':         return 0.85;  // large gap
    case 'next_day_plus':         return 1.0;   // maximum gap
    case 'unknown':               return 0.35;  // conservative default
  }
}

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

// Sarah — database reactivation (optional)
const SARAH_REACTIVATION_RATE = 0.05;

// James — review revenue uplift (optional)
// James constants moved inline to computeJamesRoi

// ─── Core Agent Calculators ─────────────────────────────────────────────────

/**
 * Alex ROI: speed-to-lead conversion uplift.
 * The slower the current response, the bigger the gap Alex can close.
 */
export function computeAlexRoi(input: AlexRoiInputs): AgentRoiResult {
  // Current conversion rate from whatever data is available
  const currentRate = normalizeConversionRate(input.leads, input.conversions, input.conversionRate);

  // Implausible rate guard — conversions >= leads means extraction artifact
  if (currentRate >= 0.95) {
    console.log(`[CALC_GUARD] Alex currentRate=${(currentRate * 100).toFixed(1)}% — implausibly high (leads=${input.leads} conv=${input.conversions} rate=${input.conversionRate}), using conservative 15% default`);
    // Override with conservative industry default
    return computeAlexRoi({ ...input, conversions: null, conversionRate: 0.15 });
  }

  console.log(`[CALC_INPUT] Alex leads=${input.leads} conv=${input.conversions} rate=${input.conversionRate} band=${input.responseSpeedBand} currentRate=${(currentRate * 100).toFixed(1)}%`);

  // Gap factor: 0 (already fast) → 1 (very slow)
  const gap = alexGapFactor(input.responseSpeedBand);

  // Effective lift scales max uplift by how much gap exists
  const effectiveLift = ALEX_MAX_UPLIFT * gap;

  // Project new rate, capped at 40%
  const projectedRate = Math.min(currentRate * (1 + effectiveLift), ALEX_CONVERSION_CAP);

  // Only count the incremental improvement
  const incrementalRate = Math.max(0, projectedRate - currentRate);

  // Weekly value = incremental conversions × ACV
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

/**
 * Chris ROI: website conversion rate uplift.
 * Flat 23% improvement on current conversion rate, capped at 35%.
 */
export function computeChrisRoi(input: ChrisRoiInputs): AgentRoiResult {
  const currentRate = normalizeConversionRate(input.leads, input.conversions, input.conversionRate);

  // 23% uplift on current rate, capped at 35%
  const projectedRate = Math.min(currentRate * (1 + CHRIS_UPLIFT), CHRIS_CONVERSION_CAP);

  const incrementalRate = Math.max(0, projectedRate - currentRate);

  // Weekly value = leads × incremental rate × ACV
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

/**
 * Maddie ROI: missed call recovery.
 * Recovers 35% of missed calls, 50% of those convert to booked value.
 */
export function computeMaddieRoi(input: MaddieRoiInputs): AgentRoiResult {
  // Missed calls: use direct count if available, else derive from volume × rate
  const missed = input.missedCalls ?? Math.round(input.phoneVolume * (input.missedCallRate ?? 0));

  // 35% of missed calls recovered
  const recoverableCalls = missed * MADDIE_RECOVERY_RATE;

  // 50% of recovered calls convert to booked value
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

// ─── Optional Agent Calculators ─────────────────────────────────────────────

/**
 * Sarah ROI: dormant lead reactivation.
 * Conservative 5% reactivation rate on old leads.
 * Optional agent — never included in default combined ROI.
 */
export function computeSarahRoi(input: SarahRoiInputs): AgentRoiResult {
  const weeklyValue = Math.round(input.oldLeads * SARAH_REACTIVATION_RATE * input.acv);

  return {
    agent: 'sarah',
    weeklyValue,
    confidence: 'low',
    assumptionsUsed: [
      `oldLeads=${input.oldLeads}`,
      `reactivationRate=${(SARAH_REACTIVATION_RATE * 100).toFixed(0)}%`,
    ],
    rationale: 'Based on dormant lead reactivation at conservative 5% rate.',
    conservative: true,
  };
}

/**
 * James ROI: review-driven revenue uplift.
 *
 * Stats (Harvard Business School / BrightLocal):
 *   - 1-star increase = 5-9% revenue boost (we use 7% midpoint)
 *   - Automated review campaigns lift rating ~0.5 stars in 3 months
 *   - If prospect already collects reviews actively, assume 0.3 star uplift
 *
 * Ceiling: cannot exceed 5.0 stars.
 * If currentStars >= 4.8, uplift is negligible — James value is near zero.
 */
const JAMES_REVENUE_PER_STAR = 0.07;          // 7% revenue boost per star (midpoint of 5-9%)
const JAMES_UPLIFT_NO_SYSTEM = 0.5;           // Expected star improvement with automated campaign
const JAMES_UPLIFT_HAS_SYSTEM = 0.3;          // Reduced uplift if they already collect reviews

export function computeJamesRoi(input: JamesRoiInputs): AgentRoiResult {
  const baseUplift = input.hasReviewSystem ? JAMES_UPLIFT_HAS_SYSTEM : JAMES_UPLIFT_NO_SYSTEM;
  const maxRoom = 5.0 - input.currentStars;
  const projectedUplift = Math.min(baseUplift, Math.max(0, maxRoom));

  if (projectedUplift <= 0.05) {
    return {
      agent: 'james',
      weeklyValue: 0,
      confidence: 'low',
      assumptionsUsed: [
        `currentStars=${input.currentStars}`,
        `hasReviewSystem=${input.hasReviewSystem}`,
        'nearCeiling=true',
      ],
      rationale: `At ${input.currentStars} stars, there's minimal room for review-driven revenue uplift.`,
      conservative: true,
    };
  }

  const weeklyRevenueBase = input.newCustomersPerWeek * input.acv;
  const weeklyValue = Math.round(weeklyRevenueBase * projectedUplift * JAMES_REVENUE_PER_STAR);

  return {
    agent: 'james',
    weeklyValue,
    confidence: input.hasReviewSystem ? 'low' : 'medium',
    assumptionsUsed: [
      `currentStars=${input.currentStars}`,
      `projectedUplift=${projectedUplift.toFixed(1)}stars`,
      `revenuePerStar=${(JAMES_REVENUE_PER_STAR * 100).toFixed(0)}%`,
      `newCustomersPerWeek=${input.newCustomersPerWeek}`,
      `hasReviewSystem=${input.hasReviewSystem}`,
    ],
    rationale: `Automated review campaign projects a ${projectedUplift.toFixed(1)}-star improvement (from ${input.currentStars} to ${(input.currentStars + projectedUplift).toFixed(1)}). At 7% revenue uplift per star, that's ~${Math.round(projectedUplift * JAMES_REVENUE_PER_STAR * 100)}% additional revenue.`,
    conservative: true,
  };
}

// ─── Combined ROI (core agents only) ────────────────────────────────────────

/**
 * Aggregate ROI across core agents only (Alex, Chris, Maddie).
 * Sarah and James are NEVER included in the combined total.
 */
export function computeCombinedRoi(
  results: Partial<Record<CoreAgent, AgentRoiResult>>,
): CombinedRoiResult {
  const coreOrder: CoreAgent[] = ['alex', 'chris', 'maddie'];

  // Only include agents that have results
  const orderedAgents = coreOrder.filter((a) => results[a] != null);

  // Sum weekly values across core agents
  let totalWeeklyValue = 0;
  for (const agent of orderedAgents) {
    totalWeeklyValue += results[agent]!.weeklyValue;
  }

  return {
    totalWeeklyValue,
    perAgent: results,
    orderedAgents,
  };
}

