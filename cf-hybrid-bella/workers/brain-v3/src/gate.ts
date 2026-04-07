/**
 * brain-v3/src/gate.ts — Stage policies, eligibility, force-advance logic
 * Chunk 1 — V3
 *
 * Ported from V2 gate.ts (doc-bella-roi-gates-source-20260407) with
 * eitherOrFields modification per spec Section 8.1.
 */

import type {
  StageId,
  ChannelStageId,
  StagePolicy,
  WarmFact,
} from './types';
import { getFact } from './facts';

// ─── Stage Policies ─────────────────────────────────────────────────────────

export const STAGE_POLICIES: Record<ChannelStageId, StagePolicy> = {
  ch_alex: {
    stage: 'ch_alex',
    requiredFields: ['acv', 'inboundLeads', 'responseSpeedBand'],
    eitherOrFields: [['inboundConversions', 'inboundConversionRate']],
    maxQuestions: 3,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'alex_speed_to_lead',
    fallbackPolicy: [
      'Ask for rough conversion percentage once if raw conversions are missing.',
      'Map vague response-time language to the nearest approved band.',
      'If still incomplete after one clarification, use approved conservative fallback or skip.',
    ],
  },
  ch_chris: {
    stage: 'ch_chris',
    requiredFields: ['acv', 'webLeads'],
    eitherOrFields: [['webConversions', 'webConversionRate']],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'chris_website_conversion',
    fallbackPolicy: [
      'Ask for rough conversion percentage once if raw conversions are missing.',
      'If still incomplete after one clarification, use approved conservative fallback or skip.',
    ],
  },
  ch_maddie: {
    stage: 'ch_maddie',
    requiredFields: ['phoneVolume'],
    eitherOrFields: [['missedCalls', 'missedCallRate']],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'maddie_missed_call_recovery',
    fallbackPolicy: [
      'Ask for rough missed-call percentage once if raw missed-call count is missing.',
      'If still incomplete after one clarification, use approved conservative fallback or skip.',
    ],
  },
  ch_sarah: {
    stage: 'ch_sarah',
    requiredFields: ['acv', 'oldLeads'],
    eitherOrFields: [],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'sarah_database_reactivation',
    fallbackPolicy: [],
  },
  ch_james: {
    stage: 'ch_james',
    requiredFields: ['acv', 'newCustomersPerWeek', 'currentStars', 'hasReviewSystem'],
    eitherOrFields: [],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'james_reputation_uplift',
    fallbackPolicy: [],
  },
};

// ─── shouldForceAdvance() ───────────────────────────────────────────────────

/**
 * Returns true if the channel stage has all minimum data to run its calculator.
 * Uses eitherOrFields pattern — NOT composite keys.
 */
export function shouldForceAdvance(
  stage: StageId,
  hotMemory: Record<string, string | number | null>,
  warmFacts: WarmFact[],
): boolean {
  const policy = STAGE_POLICIES[stage as ChannelStageId];
  if (!policy) return false;

  // All simple required fields must have values
  const allRequired = policy.requiredFields.every(
    key => getFact(key, hotMemory, warmFacts) != null
  );
  if (!allRequired) return false;

  // Each either/or pair: at least ONE must have a value
  const allEitherOr = (policy.eitherOrFields ?? []).every(
    pair => pair.some(key => getFact(key, hotMemory, warmFacts) != null)
  );

  return allEitherOr;
}

// ─── maxQuestionsReached() ──────────────────────────────────────────────────

export function maxQuestionsReached(
  stage: StageId,
  questionCounts: Record<string, number>,
): boolean {
  const policy = STAGE_POLICIES[stage as ChannelStageId];
  if (!policy) return false;
  return (questionCounts[stage] ?? 0) >= policy.maxQuestions;
}

// ─── Eligibility ────────────────────────────────────────────────────────────

/**
 * Derive agent eligibility from intel signals and conversation state.
 */
export function deriveEligibility(
  intelFlags: Record<string, boolean>,
  hotMemory: Record<string, string | number | null>,
): {
  alexEligible: boolean;
  chrisEligible: boolean;
  maddieEligible: boolean;
  whyRecommended: string[];
} {
  const websiteSignals = !!(intelFlags.websiteExists || intelFlags.is_running_ads);
  const phoneSignals = !!(intelFlags.phoneVisible);

  // Alex is eligible unless explicitly no inbound signals at all
  const alexEligible = !!(websiteSignals || phoneSignals || true); // Alex leads whenever demand likely exists

  // Chris requires website signals
  const chrisEligible = websiteSignals;

  // Maddie requires phone signals
  const maddieEligible = phoneSignals;

  const whyRecommended: string[] = [];
  if (alexEligible) whyRecommended.push('Alex: inbound demand signals detected — speed-to-lead uplift likely.');
  if (chrisEligible) whyRecommended.push('Chris: website actions or web-sourced leads — conversion uplift applies.');
  if (maddieEligible) whyRecommended.push('Maddie: phone signals detected — missed call recovery opportunity.');

  return { alexEligible, chrisEligible, maddieEligible, whyRecommended };
}
