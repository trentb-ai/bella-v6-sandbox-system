import { describe, it, expect } from 'vitest';
import { mockState, mockIntel } from './helpers';
import {
  deriveEligibility,
  deriveTopAgents,
  buildInitialQueue,
  shouldForceAdvance,
  maxQuestionsReached,
  nextChannelFromQueue,
} from '../gate';
import {
  computeAlexRoi,
  computeChrisRoi,
  computeMaddieRoi,
  computeCombinedRoi,
} from '../roi';
import type { ConversationState, CoreAgent } from '../types';

/**
 * Simulate a full conversation path using real exported pure functions.
 * No invented controller harness — just state mutation + real helpers.
 */

// ─── Scenario 1: Alex Only ──────────────────────────────────────────────────

describe('Scenario 1: Alex Only (adsConfirmed, no web/phone signals)', () => {
  it('follows: eligibility → queue → Alex questions → force advance → ROI → delivery', () => {
    // Setup: adsConfirmed but leadSource='other' → Alex only
    // Note: leadSourceDominant='ads' would make websiteSignals=true → Chris eligible
    const intel = mockIntel({ fast: {} });
    const state = mockState({
      leadSourceDominant: 'other',
      adsConfirmed: true,
      websiteRelevant: false,
      phoneRelevant: false,
    });

    // 1. Derive eligibility
    const elig = deriveEligibility(intel, state);
    expect(elig.alexEligible).toBe(true);
    expect(elig.chrisEligible).toBe(false);
    expect(elig.maddieEligible).toBe(false);

    // 2. Apply eligibility and derive top agents
    state.alexEligible = elig.alexEligible;
    state.chrisEligible = elig.chrisEligible;
    state.maddieEligible = elig.maddieEligible;
    state.topAgents = deriveTopAgents(state);
    expect(state.topAgents).toEqual(['alex']);

    // 3. Build queue
    state.currentQueue = buildInitialQueue(state);
    expect(state.currentQueue).toHaveLength(1);
    expect(state.currentQueue[0].stage).toBe('ch_alex');

    // 4. Navigate to ch_alex
    const nextStage = nextChannelFromQueue(state);
    expect(nextStage).toBe('ch_alex');

    // 5. Simulate Alex questions (≤3 budget)
    expect(shouldForceAdvance('ch_alex', state)).toBe(false);

    // Question 1: capture ACV
    state.acv = 5000;
    state.questionCounts.ch_alex++;
    expect(state.questionCounts.ch_alex).toBe(1);

    // Question 2: capture leads
    state.inboundLeads = 50;
    state.questionCounts.ch_alex++;

    // Question 3: capture conversions + speed
    state.inboundConversions = 5;
    state.responseSpeedBand = 'next_day_plus';
    state.questionCounts.ch_alex++;

    // Verify budget not exceeded
    expect(state.questionCounts.ch_alex).toBe(3);
    expect(maxQuestionsReached('ch_alex', state)).toBe(true);

    // 6. Force advance fires
    expect(shouldForceAdvance('ch_alex', state)).toBe(true);

    // 7. Compute Alex ROI
    const alexResult = computeAlexRoi({
      acv: state.acv!,
      leads: state.inboundLeads!,
      conversions: state.inboundConversions,
      responseSpeedBand: state.responseSpeedBand!,
    });
    expect(alexResult.weeklyValue).toBeGreaterThan(0);
    expect(alexResult.agent).toBe('alex');
    state.calculatorResults.alex = alexResult;

    // 8. Mark ch_alex complete
    state.completedStages.push('ch_alex');

    // 9. Next channel → roi_delivery (no more channels)
    expect(nextChannelFromQueue(state)).toBe('roi_delivery');

    // 10. Combined ROI
    const combined = computeCombinedRoi({ alex: alexResult });
    expect(combined.totalWeeklyValue).toBe(alexResult.weeklyValue);
    expect(combined.orderedAgents).toEqual(['alex']);
  });
});

// ─── Scenario 2: Alex + Chris ────────────────────────────────────────────────

describe('Scenario 2: Alex + Chris (website-driven business)', () => {
  it('follows: eligibility → queue → Alex → Chris → combined ROI', () => {
    const intel = mockIntel({ fast: { websiteExists: true } });
    const state = mockState({
      leadSourceDominant: 'website',
      websiteRelevant: true,
      phoneRelevant: false,
    });

    // Eligibility
    const elig = deriveEligibility(intel, state);
    expect(elig.alexEligible).toBe(true);
    expect(elig.chrisEligible).toBe(true);
    expect(elig.maddieEligible).toBe(false);

    state.alexEligible = elig.alexEligible;
    state.chrisEligible = elig.chrisEligible;
    state.maddieEligible = elig.maddieEligible;
    state.topAgents = deriveTopAgents(state);
    expect(state.topAgents).toEqual(['alex', 'chris']);

    state.currentQueue = buildInitialQueue(state);
    expect(state.currentQueue).toHaveLength(2);

    // Alex stage
    state.acv = 3000;
    state.inboundLeads = 40;
    state.inboundConversionRate = 0.08;
    state.responseSpeedBand = '2_to_24_hours';
    expect(shouldForceAdvance('ch_alex', state)).toBe(true);

    const alexResult = computeAlexRoi({
      acv: 3000, leads: 40, conversionRate: 0.08,
      responseSpeedBand: '2_to_24_hours',
    });
    state.calculatorResults.alex = alexResult;
    state.completedStages.push('ch_alex');

    // Next → ch_chris
    expect(nextChannelFromQueue(state)).toBe('ch_chris');

    // Chris stage
    state.webLeads = 80;
    state.webConversions = 4;
    expect(shouldForceAdvance('ch_chris', state)).toBe(true);

    const chrisResult = computeChrisRoi({
      acv: 3000, leads: 80, conversions: 4,
    });
    state.calculatorResults.chris = chrisResult;
    state.completedStages.push('ch_chris');

    // Next → roi_delivery
    expect(nextChannelFromQueue(state)).toBe('roi_delivery');

    // Combined
    const combined = computeCombinedRoi({
      alex: alexResult, chris: chrisResult,
    });
    expect(combined.totalWeeklyValue).toBe(alexResult.weeklyValue + chrisResult.weeklyValue);
    expect(combined.orderedAgents).toEqual(['alex', 'chris']);
  });
});

// ─── Scenario 3: Alex + Maddie ───────────────────────────────────────────────

describe('Scenario 3: Alex + Maddie (phone-driven business)', () => {
  it('follows: eligibility → queue → Alex → Maddie → combined ROI', () => {
    const intel = mockIntel({ fast: { phoneVisible: true } });
    const state = mockState({
      leadSourceDominant: 'phone',
      phoneRelevant: true,
      websiteRelevant: false,
    });

    const elig = deriveEligibility(intel, state);
    expect(elig.alexEligible).toBe(true);
    expect(elig.maddieEligible).toBe(true);

    state.alexEligible = elig.alexEligible;
    state.chrisEligible = elig.chrisEligible;
    state.maddieEligible = elig.maddieEligible;
    state.topAgents = deriveTopAgents(state);
    state.currentQueue = buildInitialQueue(state);

    // Alex
    state.acv = 2000;
    state.inboundLeads = 30;
    state.inboundConversions = 3;
    state.responseSpeedBand = '30_minutes_to_2_hours';
    const alexResult = computeAlexRoi({
      acv: 2000, leads: 30, conversions: 3,
      responseSpeedBand: '30_minutes_to_2_hours',
    });
    state.calculatorResults.alex = alexResult;
    state.completedStages.push('ch_alex');

    expect(nextChannelFromQueue(state)).toBe('ch_maddie');

    // Maddie
    state.phoneVolume = 60;
    state.missedCalls = 12;
    expect(shouldForceAdvance('ch_maddie', state)).toBe(true);

    const maddieResult = computeMaddieRoi({
      acv: 2000, phoneVolume: 60, missedCalls: 12,
    });
    state.calculatorResults.maddie = maddieResult;
    state.completedStages.push('ch_maddie');

    expect(nextChannelFromQueue(state)).toBe('roi_delivery');

    const combined = computeCombinedRoi({
      alex: alexResult, maddie: maddieResult,
    });
    expect(combined.totalWeeklyValue).toBe(alexResult.weeklyValue + maddieResult.weeklyValue);
    expect(combined.orderedAgents).toEqual(['alex', 'maddie']);
  });
});

// ─── Scenario 4: Alex + Chris + Maddie ───────────────────────────────────────

describe('Scenario 4: Alex + Chris + Maddie (full stack)', () => {
  it('follows: all three channels → combined ROI with 3 agents', () => {
    const intel = mockIntel({
      fast: { websiteExists: true, phoneVisible: true },
    });
    const state = mockState({
      leadSourceDominant: 'website',
      websiteRelevant: true,
      phoneRelevant: true,
    });

    const elig = deriveEligibility(intel, state);
    state.alexEligible = elig.alexEligible;
    state.chrisEligible = elig.chrisEligible;
    state.maddieEligible = elig.maddieEligible;
    state.topAgents = deriveTopAgents(state);
    state.currentQueue = buildInitialQueue(state);

    expect(state.topAgents).toEqual(['alex', 'chris', 'maddie']);
    expect(state.currentQueue).toHaveLength(3);

    // Alex
    state.acv = 4000;
    state.inboundLeads = 60;
    state.inboundConversionRate = 0.12;
    state.responseSpeedBand = 'next_day_plus';
    const alexResult = computeAlexRoi({
      acv: 4000, leads: 60, conversionRate: 0.12,
      responseSpeedBand: 'next_day_plus',
    });
    state.calculatorResults.alex = alexResult;
    state.completedStages.push('ch_alex');

    // Chris
    state.webLeads = 100;
    state.webConversions = 8;
    const chrisResult = computeChrisRoi({
      acv: 4000, leads: 100, conversions: 8,
    });
    state.calculatorResults.chris = chrisResult;
    state.completedStages.push('ch_chris');

    // Maddie
    state.phoneVolume = 80;
    state.missedCalls = 15;
    const maddieResult = computeMaddieRoi({
      acv: 4000, phoneVolume: 80, missedCalls: 15,
    });
    state.calculatorResults.maddie = maddieResult;
    state.completedStages.push('ch_maddie');

    expect(nextChannelFromQueue(state)).toBe('roi_delivery');

    // Combined
    const combined = computeCombinedRoi({
      alex: alexResult, chris: chrisResult, maddie: maddieResult,
    });
    expect(combined.totalWeeklyValue).toBe(
      alexResult.weeklyValue + chrisResult.weeklyValue + maddieResult.weeklyValue,
    );
    expect(combined.orderedAgents).toEqual(['alex', 'chris', 'maddie']);

    // No agents are missing from results
    for (const agent of state.topAgents) {
      expect(state.calculatorResults[agent]).toBeDefined();
    }
  });
});

// ─── Scenario 5: Maddie Only (phone-only, no inbound) ────────────────────────

describe('Scenario 5: Maddie Only (manual eligibility override)', () => {
  it('follows: alex NOT eligible → maddie only → single-agent ROI', () => {
    // Note: deriveEligibility cannot produce Maddie-only because
    // phoneSignals=true → explicitNoInbound=false → alexEligible=true.
    // Maddie-only path is reachable only via manual eligibility override
    // (e.g., operator disable, or future eligibility rules).
    // This test validates the downstream queue/ROI path works correctly.
    const state = mockState({
      leadSourceDominant: 'other',
      websiteRelevant: false,
      phoneRelevant: true,
      adsConfirmed: false,
    });

    // Set eligibility directly (bypass deriveEligibility)
    state.alexEligible = false;
    state.chrisEligible = false;
    state.maddieEligible = true;

    state.topAgents = deriveTopAgents(state);
    expect(state.topAgents).toEqual(['maddie']);

    state.currentQueue = buildInitialQueue(state);
    expect(state.currentQueue).toHaveLength(1);
    expect(state.currentQueue[0].stage).toBe('ch_maddie');

    expect(nextChannelFromQueue(state)).toBe('ch_maddie');

    // Maddie questions (budget = 2) — acv required for hasMaddieMinimumData
    state.acv = 1500;
    state.phoneVolume = 40;
    state.questionCounts.ch_maddie++;
    state.missedCalls = 8;
    state.questionCounts.ch_maddie++;
    expect(maxQuestionsReached('ch_maddie', state)).toBe(true);
    expect(shouldForceAdvance('ch_maddie', state)).toBe(true);

    const maddieResult = computeMaddieRoi({
      acv: 1500, phoneVolume: 40, missedCalls: 8,
    });
    state.calculatorResults.maddie = maddieResult;
    state.completedStages.push('ch_maddie');

    expect(nextChannelFromQueue(state)).toBe('roi_delivery');

    // Combined — only Maddie
    const combined = computeCombinedRoi({ maddie: maddieResult });
    expect(combined.totalWeeklyValue).toBe(maddieResult.weeklyValue);
    expect(combined.orderedAgents).toEqual(['maddie']);

    // Alex is NOT in results
    expect(state.calculatorResults.alex).toBeUndefined();
  });
});

// ─── Cross-scenario invariants ───────────────────────────────────────────────

describe('cross-scenario invariants', () => {
  it('question budgets are never exceeded', () => {
    // Alex = 3, Chris = 2, Maddie = 2
    const state = mockState({
      questionCounts: { ch_alex: 3, ch_chris: 2, ch_maddie: 2, ch_sarah: 0, ch_james: 0 },
    });
    expect(maxQuestionsReached('ch_alex', state)).toBe(true);
    expect(maxQuestionsReached('ch_chris', state)).toBe(true);
    expect(maxQuestionsReached('ch_maddie', state)).toBe(true);
  });

  it('combined ROI never includes optional agents', () => {
    // Even if Sarah/James results exist, computeCombinedRoi only sums core agents
    const combined = computeCombinedRoi({
      alex: { agent: 'alex', weeklyValue: 1000, confidence: 'medium', assumptionsUsed: [], rationale: '', conservative: true },
    });
    // The type signature only accepts CoreAgent keys
    expect(combined.orderedAgents).not.toContain('sarah');
    expect(combined.orderedAgents).not.toContain('james');
  });

  it('deriveTopAgents always puts Alex first when eligible', () => {
    // Test all permutations where Alex is eligible
    const permutations: [boolean, boolean][] = [
      [false, false], [true, false], [false, true], [true, true],
    ];
    for (const [chris, maddie] of permutations) {
      const state = mockState({
        alexEligible: true, chrisEligible: chris, maddieEligible: maddie,
      });
      const agents = deriveTopAgents(state);
      expect(agents[0]).toBe('alex');
    }
  });
});
