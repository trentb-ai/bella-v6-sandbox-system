/**
 * call-brain-do/src/flow-constants.ts — v4.9.1-flow-scaffold
 * Constants and lookup tables for the flow harness.
 * Additive only — no behavior changes.
 */

import type { WowStepId, StageId } from './types';

// ─── Delivery Constants ──────────────────────────────────────────────────────

/** Default max time (ms) to wait for bridge to confirm delivery before marking stale */
export const DELIVERY_TIMEOUT_MS = 15_000;

/**
 * Type-aware delivery timeouts (Sprint 1A — Issue 6).
 * Shorter timeouts for short/statement directives prevent reissue storms
 * when llm_reply_done arrives slightly late.
 */
const DELIVERY_TIMEOUT_BY_TYPE: Record<string, number> = {
  wow_statement:       5_000,   // wow non-waitForUser (wow_2, wow_5, wow_6): short, no user reply expected
  wow_question:       20_000,   // wow waitForUser (wow_1, wow_3, wow_4, wow_7, wow_8): awaiting user — Gemini TTFB can exceed 8s
  channel_question:    8_000,   // ch_alex/chris/maddie question collection
  channel_synthesis:   8_000,   // ROI delivery per agent — must be heard in full
  roi_delivery:        8_000,   // combined ROI — critical delivery
  greeting:            6_000,   // greeting — short opener
  default:            15_000,   // everything else — bumped from 8s to handle slow Gemini turns
};

/**
 * Compute the delivery timeout for a given directive context.
 * Called from flow.ts when setting pendingDelivery.
 */
export function getDeliveryTimeoutMs(
  stage: StageId,
  waitForUser: boolean,
  isSynthesis: boolean,
): number {
  if (stage === 'greeting') return DELIVERY_TIMEOUT_BY_TYPE.greeting;
  if (stage === 'wow') {
    return waitForUser ? DELIVERY_TIMEOUT_BY_TYPE.wow_question : DELIVERY_TIMEOUT_BY_TYPE.wow_statement;
  }
  if (stage === 'roi_delivery') return DELIVERY_TIMEOUT_BY_TYPE.roi_delivery;
  const channelStages: StageId[] = ['ch_alex', 'ch_chris', 'ch_maddie', 'ch_sarah', 'ch_james'];
  if (channelStages.includes(stage)) {
    return isSynthesis ? DELIVERY_TIMEOUT_BY_TYPE.channel_synthesis : DELIVERY_TIMEOUT_BY_TYPE.channel_question;
  }
  return DELIVERY_TIMEOUT_BY_TYPE.default;
}

/** Max consecutive timeouts before degrading the call */
export const MAX_CONSECUTIVE_TIMEOUTS = 3;

/** Max delivery attempts before force-clearing (timeout reissue budget) */
export const MAX_DELIVERY_ATTEMPTS = 3;

/** Minimum ms after directive issue before implicit_user_spoke can clear it.
 *  Prevents residual speech from the previous turn from eating freshly-issued directives.
 *  Gemini TTFB is 3-5s, so any user speech within 2s of issue is not a response to the new directive. */
export const DELIVERY_MIN_WINDOW_MS = 2_000;

// ─── Audit Constants ─────────────────────────────────────────────────────────

/** Max flow log entries kept in state (FIFO eviction) */
export const FLOW_LOG_CAP = 200;

// ─── WOW Step Ordering ──────────────────────────────────────────────────────

export const WOW_STEP_ORDER: WowStepId[] = [
  'wow_1_research_intro',
  'wow_2_reputation_trial',
  'wow_3_icp_problem_solution',
  'wow_4_conversion_action',
  'wow_5_alignment_bridge',
  'wow_6_scraped_observation',
  'wow_7_explore_or_recommend',
  'wow_8_source_check',
];

// ─── WOW Skip Table ─────────────────────────────────────────────────────────

/**
 * Conditions under which a WOW step can be skipped.
 * Keys are WowStepId values. Values are functions that return true if the step
 * should be skipped given the available intel signals.
 *
 * Steps NOT in this table are never auto-skipped.
 */
export const WOW_SKIP_TABLE: Partial<Record<WowStepId, (intel: { hasRating: boolean; hasConsultant: boolean; hasDeep: boolean; hasScrapedSummary: boolean }) => boolean>> = {
  wow_2_reputation_trial: (i) => !i.hasRating,
  wow_6_scraped_observation: (i) => !i.hasScrapedSummary,
};

/**
 * Check if a WOW step should be skipped based on available intel signals.
 * Returns true if the step is in the skip table and its condition is met.
 */
export function shouldSkipWowStep(
  step: WowStepId,
  signals: { hasRating: boolean; hasConsultant: boolean; hasDeep: boolean; hasScrapedSummary: boolean },
): boolean {
  const checker = WOW_SKIP_TABLE[step];
  return checker ? checker(signals) : false;
}
