/**
 * call-brain-do/src/flow-constants.ts — v4.9.1-flow-scaffold
 * Constants and lookup tables for the flow harness.
 * Additive only — no behavior changes.
 */

import type { WowStepId } from './types';

// ─── Delivery Constants ──────────────────────────────────────────────────────

/** Max time (ms) to wait for bridge to confirm delivery before marking stale */
export const DELIVERY_TIMEOUT_MS = 15_000;

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
