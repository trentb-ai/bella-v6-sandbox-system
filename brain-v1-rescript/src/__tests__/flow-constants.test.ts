/**
 * flow-constants.test.ts — Group 1: Skip Table + Constants
 */

import { describe, it, expect } from 'vitest';
import {
  DELIVERY_TIMEOUT_MS,
  MAX_CONSECUTIVE_TIMEOUTS,
  MAX_DELIVERY_ATTEMPTS,
  FLOW_LOG_CAP,
  WOW_STEP_ORDER,
  shouldSkipWowStep,
} from '../flow-constants';
import type { WowStepId } from '../types';

describe('flow-constants', () => {
  describe('constants values', () => {
    it('DELIVERY_TIMEOUT_MS is 15000', () => {
      expect(DELIVERY_TIMEOUT_MS).toBe(15_000);
    });

    it('MAX_CONSECUTIVE_TIMEOUTS is 3', () => {
      expect(MAX_CONSECUTIVE_TIMEOUTS).toBe(3);
    });

    it('MAX_DELIVERY_ATTEMPTS is 3', () => {
      expect(MAX_DELIVERY_ATTEMPTS).toBe(3);
    });

    it('FLOW_LOG_CAP is 200', () => {
      expect(FLOW_LOG_CAP).toBe(200);
    });
  });

  describe('WOW_STEP_ORDER', () => {
    it('has exactly 8 entries', () => {
      expect(WOW_STEP_ORDER).toHaveLength(8);
    });

    it('is in correct sequence', () => {
      expect(WOW_STEP_ORDER).toEqual([
        'wow_1_research_intro',
        'wow_2_reputation_trial',
        'wow_3_icp_problem_solution',
        'wow_4_conversion_action',
        'wow_5_alignment_bridge',
        'wow_6_scraped_observation',
        'wow_7_explore_or_recommend',
        'wow_8_source_check',
      ]);
    });
  });

  describe('shouldSkipWowStep', () => {
    const fullSignals = { hasRating: true, hasConsultant: true, hasDeep: true, hasScrapedSummary: true };
    const noRating = { ...fullSignals, hasRating: false };
    const noScrape = { ...fullSignals, hasScrapedSummary: false };

    it('returns false for always-deliver steps (wow_1)', () => {
      expect(shouldSkipWowStep('wow_1_research_intro', fullSignals)).toBe(false);
      expect(shouldSkipWowStep('wow_1_research_intro', noRating)).toBe(false);
    });

    it('returns false for always-deliver steps (wow_3, wow_4, wow_5, wow_7, wow_8)', () => {
      const alwaysDeliver: WowStepId[] = [
        'wow_3_icp_problem_solution',
        'wow_4_conversion_action',
        'wow_5_alignment_bridge',
        'wow_7_explore_or_recommend',
        'wow_8_source_check',
      ];
      for (const step of alwaysDeliver) {
        expect(shouldSkipWowStep(step, noRating)).toBe(false);
        expect(shouldSkipWowStep(step, noScrape)).toBe(false);
      }
    });

    it('returns true for wow_2 when no rating', () => {
      expect(shouldSkipWowStep('wow_2_reputation_trial', noRating)).toBe(true);
    });

    it('returns false for wow_2 when rating IS present', () => {
      expect(shouldSkipWowStep('wow_2_reputation_trial', fullSignals)).toBe(false);
    });

    it('returns true for wow_6 when no scraped summary', () => {
      expect(shouldSkipWowStep('wow_6_scraped_observation', noScrape)).toBe(true);
    });

    it('returns false for wow_6 when scraped summary IS present', () => {
      expect(shouldSkipWowStep('wow_6_scraped_observation', fullSignals)).toBe(false);
    });
  });
});
