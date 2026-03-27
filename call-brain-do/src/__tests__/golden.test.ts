/**
 * call-brain-do/src/__tests__/golden.test.ts — Sprint GOLDEN-1
 * Pre-Deletion Golden Scenario Pack: 40 deterministic tests.
 *
 * Deletion-readiness gate for Sprint M5 (~1800 lines bridge brain removal).
 * Target: >= 38/40 pass. No production source files changed.
 *
 * Tests call DO functions DIRECTLY — no Gemini, no bridge, no network.
 * Modules under test: moves.ts, flow.ts, gate.ts, roi.ts, extract.ts.
 *
 * Adaptations from prompt (Production-Truth Rule §14):
 * - File placed at src/__tests__/golden.test.ts (vitest config requires src/__tests__/**)
 * - Test 13: James near-ceiling uses currentStars=4.97 (projectedUplift <= 0.05)
 * - Test 25-26: parseNumber tested with digit strings (spoken word compounds not supported)
 * - Test 31: Uses "we never miss a call" (regex requires single-char gap for always.?X)
 */

import { describe, it, expect } from 'vitest';

// ── Production imports (read-only) ──
import { buildStageDirective } from '../moves';
import { processFlow, tryRunCalculator, buildMergedIntel } from '../flow';
import {
  computeAlexRoi,
  computeChrisRoi,
  computeMaddieRoi,
  computeSarahRoi,
  computeJamesRoi,
  computeCombinedRoi,
  normalizeConversionRate,
  alexGapFactor,
} from '../roi';
import {
  parseNumber,
  normalizeSpokenNumbers,
  inferAcvMultiplier,
  extractFromTranscript,
  applyExtraction,
  extractBellaMemoryNotes,
  commitmentKey,
} from '../extract';
import {
  buildInitialQueue,
  deriveEligibility,
  deriveTopAgents,
  nextChannelFromQueue,
  shouldForceAdvance,
  maxQuestionsReached,
  hasAlexMinimumData,
  hasChrisMinimumData,
  hasMaddieMinimumData,
  hasSarahMinimumData,
  hasJamesMinimumData,
} from '../gate';
import { WOW_STEP_ORDER } from '../flow-constants';

// ── Test helpers ──
import { mockState, mockIntel, ALL_WOW_STEPS, GENERIC_INDUSTRY_PACK } from './helpers';
import type { ConversationState, MergedIntel, CoreAgent, IndustryLanguagePack } from '../types';

// ── Dental industry pack for industry-specific tests ──
const DENTAL_PACK: IndustryLanguagePack = {
  industryLabel: 'dental',
  singularOutcome: 'patient',
  pluralOutcome: 'patients',
  leadNoun: 'enquiry',
  conversionVerb: 'book',
  revenueEvent: 'new patient booked',
  kpiLabel: 'booking rate',
  missedOpportunity: 'missed patient',
  tone: 'friendly',
  examples: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 1: DIRECTIVE CONTENT (Tests 1–12)
// buildStageDirective smoke tests — does the right speak/canSkip/ask emerge?
// ═══════════════════════════════════════════════════════════════════════════════

describe('Group 1: Directive Content', () => {
  const intel = mockIntel();

  it('T01 — greeting speaks prospect first name', () => {
    const state = mockState({ firstName: 'Trent' });
    const d = buildStageDirective({ stage: 'greeting', wowStep: null, intel, state });
    expect(d.speak).toContain('Trent');
    expect(d.waitForUser).toBe(true);
    expect(d.canSkip).toBe(false);
  });

  it('T02 — wow_1 speaks business name and first name', () => {
    const state = mockState({
      firstName: 'Trent',
      business: 'Pitcher Partners',
      currentStage: 'wow',
      currentWowStep: 'wow_1_research_intro',
    });
    const d = buildStageDirective({ stage: 'wow', wowStep: 'wow_1_research_intro', intel, state });
    expect(d.speak).toContain('Pitcher Partners');
    expect(d.speak).toContain('Trent');
    expect(d.waitForUser).toBe(true);
  });

  it('T03 — wow_2 skips when no Google rating', () => {
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_2_reputation_trial',
      intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
    });
    const d = buildStageDirective({ stage: 'wow', wowStep: 'wow_2_reputation_trial', intel, state });
    expect(d.canSkip).toBe(true);
    expect(d.speak).toBe('');
    expect(d.waitForUser).toBe(false);
  });

  it('T04 — wow_2 fires reputation trial when rating >= 3', () => {
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_2_reputation_trial',
      intel: {
        fast: null,
        consultant: null,
        deep: { googleMaps: { rating: 4.6, review_count: 120 } },
        industryLanguagePack: null,
        mergedVersion: 0,
      },
    });
    const d = buildStageDirective({ stage: 'wow', wowStep: 'wow_2_reputation_trial', intel, state });
    expect(d.canSkip).toBe(false);
    expect(d.speak).toContain('4.6');
    expect(d.speak).toContain('120');
    expect(d.speak).toContain('free trial');
  });

  it('T05 — wow_3 ICP_NARRATIVE priority path when icpNarrative > 30 chars', () => {
    const narrative = 'Your business primarily serves mid-market accounting firms seeking digital transformation';
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_3_icp_problem_solution',
      intel: {
        fast: null,
        consultant: { icpAnalysis: { icpNarrative: narrative } },
        deep: {},
        industryLanguagePack: null,
        mergedVersion: 0,
      },
    });
    const d = buildStageDirective({ stage: 'wow', wowStep: 'wow_3_icp_problem_solution', intel, state });
    expect(d.speak).toContain(narrative);
    expect(d.ask).toBe(true);
    expect(d.waitForUser).toBe(true);
  });

  it('T06 — wow_3 ICP_FULL when problems + solutions + icpGuess present', () => {
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_3_icp_problem_solution',
      intel: {
        fast: null,
        consultant: {
          icpAnalysis: {
            icpProblems: ['cash flow management issues', 'payroll compliance headaches'],
            icpSolutions: ['automated bookkeeping workflows', 'real-time payroll systems'],
          },
          scriptFills: { icp_guess: 'small business owners across Sydney' },
        },
        deep: {},
        industryLanguagePack: null,
        mergedVersion: 0,
      },
    });
    const d = buildStageDirective({ stage: 'wow', wowStep: 'wow_3_icp_problem_solution', intel, state });
    expect(d.speak).toContain('small business owners across Sydney');
    expect(d.speak).toContain('cash flow management issues');
    expect(d.speak).toContain('automated bookkeeping workflows');
  });

  it('T07 — wow_3 GENERIC fallback when no ICP data', () => {
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_3_icp_problem_solution',
      business: 'KPMG',
      intel: { fast: null, consultant: {}, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
    });
    const d = buildStageDirective({ stage: 'wow', wowStep: 'wow_3_icp_problem_solution', intel, state });
    expect(d.speak).toContain('strong job');
    expect(d.speak).toContain('Does that sound right');
  });

  it('T08 — wow_4 CONV_NARRATIVE priority when conversionNarrative > 30 chars', () => {
    const convNarrative = 'Your site drives conversions primarily through a booking widget that captures new patient enquiries';
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_4_conversion_action',
      intel: {
        fast: null,
        consultant: {
          conversionEventAnalysis: { conversionNarrative: convNarrative },
        },
        deep: {},
        industryLanguagePack: null,
        mergedVersion: 0,
      },
    });
    const d = buildStageDirective({ stage: 'wow', wowStep: 'wow_4_conversion_action', intel, state });
    expect(d.speak).toContain(convNarrative);
    expect(d.speak).toContain('Is that the right focus');
  });

  it('T09 — wow_5 re-offers trial when trialMentioned=false', () => {
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_5_alignment_bridge',
      trialMentioned: false,
      intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
    });
    const d = buildStageDirective({ stage: 'wow', wowStep: 'wow_5_alignment_bridge', intel, state });
    expect(d.speak).toContain('free trial');
    expect(state.trialMentioned).toBe(true);
  });

  it('T10 — wow_8 skips when leadSource known with high confidence', () => {
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_8_source_check',
      leadSourceDominant: 'website',
      routingConfidence: 'high',
      intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
    });
    const d = buildStageDirective({ stage: 'wow', wowStep: 'wow_8_source_check', intel, state });
    expect(d.canSkip).toBe(true);
    expect(d.speak).toBe('');
  });

  it('T11 — recommendation mentions all 3 agents when all eligible', () => {
    const state = mockState({
      currentStage: 'recommendation',
      alexEligible: true,
      chrisEligible: true,
      maddieEligible: true,
      intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
    });
    const d = buildStageDirective({ stage: 'recommendation', intel, state });
    expect(d.speak).toContain('Alex');
    expect(d.speak).toContain('Chris');
    expect(d.speak).toContain('Maddie');
    expect(d.ask).toBe(true);
  });

  it('T12 — anchor_acv uses industry language pack singularOutcome', () => {
    const state = mockState({
      currentStage: 'anchor_acv',
      industryLanguage: DENTAL_PACK,
      business: 'Smile Dental',
      intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
    });
    const d = buildStageDirective({ stage: 'anchor_acv', intel, state });
    expect(d.speak).toContain('patient');
    expect(d.speak).toContain('Smile Dental');
    expect(d.ask).toBe(true);
    expect(d.waitForUser).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 2: ROI CALCULATORS (Tests 13–18)
// Pure-function calculators — exact numeric assertions.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Group 2: ROI Calculators', () => {
  it('T13 — James near-ceiling (4.97 stars) → weeklyValue=0', () => {
    // maxRoom = 5.0 - 4.97 = 0.03, projectedUplift = min(0.5, 0.03) = 0.03 <= 0.05 → 0
    const result = computeJamesRoi({
      acv: 5000,
      newCustomersPerWeek: 10,
      currentStars: 4.97,
      hasReviewSystem: false,
    });
    expect(result.agent).toBe('james');
    expect(result.weeklyValue).toBe(0);
    expect(result.conservative).toBe(true);
  });

  it('T14 — Alex ROI: next_day_plus, 50 leads, 10% conv, ACV=5000', () => {
    // currentRate=0.10, gap=1.0, effectiveLift=3.94
    // projectedRate=min(0.10*4.94, 0.40)=0.40, incrementalRate=0.30
    // weeklyValue=round(50*0.30*5000)=75000
    const result = computeAlexRoi({
      acv: 5000,
      leads: 50,
      conversions: 5,
      conversionRate: null,
      responseSpeedBand: 'next_day_plus',
    });
    expect(result.agent).toBe('alex');
    expect(result.weeklyValue).toBe(75000);
    expect(result.confidence).toBe('medium');
  });

  it('T15 — Chris ROI: 30 web leads, 10% rate, ACV=5000', () => {
    // currentRate=0.10, projectedRate=min(0.123, 0.35)=0.123
    // incrementalRate=0.023, weeklyValue=round(30*0.023*5000)=3450
    const result = computeChrisRoi({
      acv: 5000,
      leads: 30,
      conversions: 3,
      conversionRate: null,
    });
    expect(result.agent).toBe('chris');
    expect(result.weeklyValue).toBe(3450);
  });

  it('T16 — Maddie ROI: 200 phone vol, 40 missed, ACV=5000', () => {
    // missed=40, recoverableCalls=40*0.35=14
    // weeklyValue=round(14*5000*0.5)=35000
    const result = computeMaddieRoi({
      acv: 5000,
      phoneVolume: 200,
      missedCalls: 40,
      missedCallRate: null,
    });
    expect(result.agent).toBe('maddie');
    expect(result.weeklyValue).toBe(35000);
  });

  it('T17 — Sarah ROI: 2000 dormant leads, ACV=5000 → pool value', () => {
    // weeklyValue=round(2000*0.05*5000)=500000
    const result = computeSarahRoi({
      acv: 5000,
      oldLeads: 2000,
    });
    expect(result.agent).toBe('sarah');
    expect(result.weeklyValue).toBe(500000);
    expect(result.confidence).toBe('low');
  });

  it('T18 — James ROI: 10 new cust/wk, 3.5 stars, no review system, ACV=5000', () => {
    // baseUplift=0.5, maxRoom=1.5, projectedUplift=0.5
    // weeklyRevenueBase=50000, weeklyValue=round(50000*0.5*0.07)=1750
    const result = computeJamesRoi({
      acv: 5000,
      newCustomersPerWeek: 10,
      currentStars: 3.5,
      hasReviewSystem: false,
    });
    expect(result.agent).toBe('james');
    expect(result.weeklyValue).toBe(1750);
    expect(result.confidence).toBe('medium');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 3: COMBINED ROI (Test 19)
// Core agents only in total — Sarah/James excluded by type.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Group 3: Combined ROI', () => {
  it('T19 — computeCombinedRoi sums only core agents', () => {
    const alexResult = computeAlexRoi({ acv: 5000, leads: 50, conversions: 5, responseSpeedBand: 'next_day_plus' });
    const chrisResult = computeChrisRoi({ acv: 5000, leads: 30, conversions: 3 });
    const maddieResult = computeMaddieRoi({ acv: 5000, phoneVolume: 200, missedCalls: 40 });

    const combined = computeCombinedRoi({
      alex: alexResult,
      chris: chrisResult,
      maddie: maddieResult,
    });

    expect(combined.totalWeeklyValue).toBe(alexResult.weeklyValue + chrisResult.weeklyValue + maddieResult.weeklyValue);
    expect(combined.totalWeeklyValue).toBe(75000 + 3450 + 35000);
    expect(combined.orderedAgents).toEqual(['alex', 'chris', 'maddie']);
    // Sarah and James are excluded by type signature — cannot pass them to computeCombinedRoi
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 4: EXTRACTION (Tests 20–31)
// parseNumber, normalizeSpokenNumbers, extractFromTranscript, applyExtraction.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Group 4: Extraction', () => {
  it('T20 — parseNumber("$5000") = 5000', () => {
    expect(parseNumber('$5000')).toBe(5000);
  });

  it('T21 — parseNumber("couple thousand") = 2000', () => {
    expect(parseNumber('couple thousand')).toBe(2000);
  });

  it('T22 — parseNumber("quarter mill") = 250000', () => {
    expect(parseNumber('quarter mill')).toBe(250000);
  });

  it('T23 — extractFromTranscript captures ACV from "about five thousand dollars"', () => {
    const result = extractFromTranscript(
      'about five thousand dollars',
      ['acv'],
      'anchor_acv',
    );
    expect(result.fields.acv).toBe(5000);
  });

  it('T24 — extractFromTranscript captures responseSpeedBand from "within an hour"', () => {
    const result = extractFromTranscript(
      'we usually follow up within an hour',
      ['responseSpeedBand'],
      'ch_alex',
    );
    expect(result.fields.responseSpeedBand).toBe('30_minutes_to_2_hours');
  });

  it('T25 — parseNumber("250") and inferAcvMultiplier("dental") → 250 × 10', () => {
    // Adaptation: "two fifty" doesn't parse as 250 — spoken compound not supported.
    // Testing the numeric parse + multiplier lookup separately.
    expect(parseNumber('250')).toBe(250);
    expect(inferAcvMultiplier('dental')).toBe(10);
    // Product: 250 * 10 = 2500
  });

  it('T26 — parseNumber("five thousand") = 5000 and inferAcvMultiplier("legal") = 1000', () => {
    expect(parseNumber('five thousand')).toBe(5000);
    expect(inferAcvMultiplier('legal')).toBe(1000);
  });

  it('T27 — monthly normalization: "we get about 200 a month" → ÷4.33', () => {
    const state = mockState({ acv: 5000 });
    const result = extractFromTranscript(
      'we get about 200 a month',
      ['inboundLeads'],
      'ch_alex',
      undefined,
      state,
    );
    // Regex captures "200 a month" → fields.inboundLeads = 200
    expect(result.fields.inboundLeads).toBe(200);

    // Apply extraction to trigger monthly normalization
    const applied = applyExtraction(state, result);
    expect(applied).toContain('inboundLeads');
    // 200 / 4.33 = 46.19 → round = 46
    expect(state.inboundLeads).toBe(46);
    expect(state.detectedInputUnits.inboundLeads).toBe('monthly');
  });

  it('T28 — correction detection overwrites existing value', () => {
    const state = mockState({
      inboundLeads: 50,
      acv: 5000,
      currentStage: 'ch_alex',
    });
    const result = extractFromTranscript(
      "actually it's more like 80 leads",
      ['inboundLeads'],
      'ch_alex',
      undefined,
      state,
    );
    expect(result.correctionDetected).toBe(true);
    // "80 leads" should be captured
    expect(result.fields.inboundLeads).toBe(80);

    // Apply with correction → overwrites existing 50
    applyExtraction(state, result);
    expect(state.inboundLeads).toBe(80);
  });

  it('T29 — ACV fragment guard: "fifty" filtered when acv=5000', () => {
    // 50 × 100 = 5000 → ACV fragment → should NOT be captured as inboundLeads
    const state = mockState({ acv: 5000, currentStage: 'ch_alex' });
    const result = extractFromTranscript(
      'yeah about fifty',
      ['inboundLeads'],
      'ch_alex',
      undefined,
      state,
    );
    expect(result.fields.inboundLeads).toBeUndefined();
  });

  it('T30 — memory note detection: "my wife handles the books"', () => {
    const result = extractFromTranscript(
      'my wife handles the books and the admin side of things',
      ['acv'],
      'wow',
    );
    expect(result.memoryNotes.length).toBeGreaterThanOrEqual(1);
    const personalNote = result.memoryNotes.find(n => n.category === 'personal');
    expect(personalNote).toBeDefined();
    expect(personalNote!.source).toBe('user');
    expect(personalNote!.tags).toContain('family');
  });

  it('T31 — 24/7 coverage detection: "we never miss a call"', () => {
    // "never miss" matches "never.?miss" (space = 1 char matches .?)
    const result = extractFromTranscript(
      'we never miss a call',
      ['phoneVolume'],
      'ch_maddie',
    );
    expect(result.fields.maddieSkip).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 5: FLOW HARNESS (Tests 32–37)
// processFlow state transitions — deterministic, no Gemini.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Group 5: Flow Harness', () => {
  const intel = mockIntel();

  it('T32 — greeting → wow on user speech', () => {
    const state = mockState({
      currentStage: 'greeting',
      pendingDelivery: null,
      flowSeq: 0,
    });
    const result = processFlow(state, intel, 'hello', 'turn1', Date.now());
    expect(state.currentStage).toBe('wow');
    expect(state.currentWowStep).toBe('wow_1_research_intro');
    expect(result.advanced).toBe(true);
    expect(state.completedStages).toContain('greeting');
  });

  it('T33 — wow auto-skip: wow_2 skips to wow_3 when no rating', () => {
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_2_reputation_trial',
      completedStages: ['greeting'],
      completedWowSteps: ['wow_1_research_intro'],
      pendingDelivery: null,
      flowSeq: 1,
      intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
    });
    const result = processFlow(state, intel, 'sounds good', 'turn2', Date.now());
    // wow_2 has canSkip=true + waitForUser=false → auto-skip chain skips to wow_3
    expect(state.currentWowStep).toBe('wow_3_icp_problem_solution');
    expect(state.completedWowSteps).toContain('wow_2_reputation_trial');
    expect(result.moveId).toContain('wow_3_icp_problem_solution');
  });

  it('T34 — ch_alex force-advances when all data present + spoken', () => {
    const state = mockState({
      currentStage: 'ch_alex',
      currentWowStep: null,
      completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv'],
      completedWowSteps: [...ALL_WOW_STEPS],
      acv: 5000,
      inboundLeads: 50,
      inboundConversions: 5,
      responseSpeedBand: 'next_day_plus',
      spoken: { moveIds: ['v2_ch_alex'], factsUsed: [] },
      pendingDelivery: null,
      flowSeq: 5,
      questionCounts: { ch_alex: 3, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
      currentQueue: [
        { stage: 'ch_alex', agent: 'alex' as CoreAgent, priority: 1, why: 'test' },
        { stage: 'ch_chris', agent: 'chris' as CoreAgent, priority: 2, why: 'test' },
      ],
      alexEligible: true,
      chrisEligible: true,
    });
    const result = processFlow(state, intel, 'yeah that sounds right', 'turn6', Date.now());
    expect(result.advanced).toBe(true);
    expect(state.completedStages).toContain('ch_alex');
    expect(state.calculatorResults.alex).toBeDefined();
    expect(state.calculatorResults.alex!.weeklyValue).toBe(75000);
    // Next channel from queue should be ch_chris
    expect(state.currentStage).toBe('ch_chris');
  });

  it('T35 — ch_maddie skips when maddieSkip=true (24/7 coverage)', () => {
    const state = mockState({
      currentStage: 'ch_maddie',
      currentWowStep: null,
      completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv', 'ch_alex', 'ch_chris'],
      completedWowSteps: [...ALL_WOW_STEPS],
      maddieSkip: true,
      acv: 5000,
      pendingDelivery: null,
      flowSeq: 8,
      questionCounts: { ch_alex: 3, ch_chris: 2, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
      currentQueue: [
        { stage: 'ch_alex', agent: 'alex' as CoreAgent, priority: 1, why: 'done' },
        { stage: 'ch_chris', agent: 'chris' as CoreAgent, priority: 2, why: 'done' },
        { stage: 'ch_maddie', agent: 'maddie' as CoreAgent, priority: 3, why: 'test' },
      ],
      maddieEligible: true,
    });
    const result = processFlow(state, intel, 'yeah', 'turn9', Date.now());
    expect(result.advanced).toBe(true);
    expect(state.completedStages).toContain('ch_maddie');
    // After maddie skip, nextChannelFromQueue → roi_delivery (alex+chris already done)
    expect(state.currentStage).toBe('roi_delivery');
  });

  it('T36 — just_demo skips anchor_acv → close', () => {
    const state = mockState({
      currentStage: 'anchor_acv',
      currentWowStep: null,
      completedStages: ['greeting', 'wow', 'recommendation'],
      completedWowSteps: [...ALL_WOW_STEPS],
      proceedToROI: false,
      pendingDelivery: null,
      flowSeq: 4,
    });
    const result = processFlow(state, intel, 'just show me the demo', 'turn5', Date.now());
    expect(result.advanced).toBe(true);
    expect(state.currentStage).toBe('close');
    expect(state.completedStages).toContain('anchor_acv');
  });

  it('T37 — delivery gate holds when delivery too fresh (<2000ms)', () => {
    const state = mockState({
      currentStage: 'wow',
      currentWowStep: 'wow_3_icp_problem_solution',
      pendingDelivery: {
        deliveryId: 'v2_wow_wow_3_0',
        moveId: 'v2_wow_wow_3',
        stage: 'wow',
        wowStep: 'wow_3_icp_problem_solution',
        waitForUser: true,
        issuedAt: Date.now() - 500, // 500ms ago — less than DELIVERY_MIN_WINDOW_MS (2000ms)
        seq: 0,
        status: 'pending',
        attempts: 1,
      },
      flowSeq: 1,
      intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
    });
    const result = processFlow(state, intel, 'yeah', 'turn2', Date.now());
    // Gate should hold — no advancement, pendingDelivery still present
    expect(result.advanced).toBe(false);
    expect(state.pendingDelivery).not.toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 6: GATE & QUEUE (Tests 38–39)
// Eligibility derivation, queue ordering, minimum-data checks.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Group 6: Gate & Queue', () => {
  it('T38 — buildInitialQueue sorts by fixed priority (alex=1, chris=2, maddie=3)', () => {
    // Even if topAgents is reversed, queue sorts by priority
    const state = mockState({
      topAgents: ['maddie', 'chris', 'alex'] as CoreAgent[],
    });
    const queue = buildInitialQueue(state);
    expect(queue).toHaveLength(3);
    expect(queue[0].agent).toBe('alex');
    expect(queue[0].priority).toBe(1);
    expect(queue[1].agent).toBe('chris');
    expect(queue[1].priority).toBe(2);
    expect(queue[2].agent).toBe('maddie');
    expect(queue[2].priority).toBe(3);
  });

  it('T39 — deriveEligibility: all 3 eligible with website + phone signals', () => {
    const testIntel: MergedIntel = {
      fast: { websiteExists: true, phoneVisible: true } as any,
      consultant: {},
      deep: {},
    };
    const state = mockState({
      leadSourceDominant: 'website',
      phoneRelevant: true,
      websiteRelevant: true,
      maddieSkip: false,
    });
    const elig = deriveEligibility(testIntel, state);
    expect(elig.alexEligible).toBe(true);
    expect(elig.chrisEligible).toBe(true);
    expect(elig.maddieEligible).toBe(true);
    expect(elig.whyRecommended).toHaveLength(3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// GROUP 7: INTEGRATION (Test 40)
// Multi-turn processFlow sequence: greeting → wow_1 → wow_2 skip → wow_3.
// ═══════════════════════════════════════════════════════════════════════════════

describe('Group 7: Integration', () => {
  it('T40 — 3-turn sequence: greeting → wow_1 → wow_2 auto-skip → wow_3', () => {
    const intel = mockIntel(); // No deep intel → wow_2 will skip
    const state = mockState({
      firstName: 'Trent',
      business: 'TestCo',
      pendingDelivery: null,
      flowSeq: 0,
      intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
    });

    // ── Turn 1: greeting ──
    const r1 = processFlow(state, intel, 'hello', 'turn1', Date.now());
    expect(state.currentStage).toBe('wow');
    expect(state.currentWowStep).toBe('wow_1_research_intro');
    expect(r1.advanced).toBe(true);
    expect(r1.moveId).toBe('v2_wow_wow_1_research_intro');

    // Simulate delivery completion before next turn
    state.pendingDelivery!.status = 'completed';
    state.pendingDelivery!.completedAt = Date.now();

    // ── Turn 2: at wow_1, user confirms → advance to wow_2 → auto-skip to wow_3 ──
    const r2 = processFlow(state, intel, 'yeah absolutely', 'turn2', Date.now());
    expect(state.completedWowSteps).toContain('wow_1_research_intro');
    expect(state.completedWowSteps).toContain('wow_2_reputation_trial');
    // wow_2 was auto-skipped (no googleMaps rating), landed on wow_3
    expect(state.currentWowStep).toBe('wow_3_icp_problem_solution');
    expect(r2.moveId).toBe('v2_wow_wow_3_icp_problem_solution');

    // Simulate delivery completion
    state.pendingDelivery!.status = 'completed';
    state.pendingDelivery!.completedAt = Date.now();

    // ── Turn 3: at wow_3, user confirms → advance to wow_4 ──
    const r3 = processFlow(state, intel, 'yep that sounds right', 'turn3', Date.now());
    expect(state.completedWowSteps).toContain('wow_3_icp_problem_solution');
    expect(state.currentWowStep).toBe('wow_4_conversion_action');
    expect(r3.moveId).toBe('v2_wow_wow_4_conversion_action');

    // Verify invariant: currentWowStep is set when stage is wow
    expect(state.currentStage).toBe('wow');
    expect(state.currentWowStep).not.toBeNull();
  });
});
