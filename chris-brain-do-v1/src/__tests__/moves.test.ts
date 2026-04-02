import { describe, it, expect } from 'vitest';
import { buildStageDirective } from '../moves';
import { mockState, mockIntel } from './helpers';
import type { StageDirectiveInput } from '../types';

function directive(overrides: Partial<StageDirectiveInput>): ReturnType<typeof buildStageDirective> {
  return buildStageDirective({
    stage: overrides.stage ?? 'greeting',
    wowStep: overrides.wowStep ?? null,
    intel: overrides.intel ?? mockIntel(),
    state: overrides.state ?? mockState(),
  });
}

// ─── Greeting ────────────────────────────────────────────────────────────────

describe('greeting stage', () => {
  it('speaks welcome line', () => {
    const d = directive({
      stage: 'greeting',
      state: mockState({ firstName: 'Trent' }),
    });
    expect(d.speak).toContain('Hey Trent');
    expect(d.speak).toContain('personalised AI Agent demonstration');
    expect(d.ask).toBe(false);
    expect(d.waitForUser).toBe(true);
  });
});

// ─── WOW steps ──────────────────────────────────────────────────────────────

describe('wow steps', () => {
  it('wow_1_research_intro — research credibility', () => {
    const d = directive({
      stage: 'wow',
      wowStep: 'wow_1_research_intro',
      state: mockState({ firstName: 'Trent', business: 'KPMG' }),
    });
    expect(d.speak).toContain("We've researched");
    expect(d.speak).toContain('KPMG');
    expect(d.ask).toBe(true);
    expect(d.waitForUser).toBe(true);
  });

  it('wow_2_reputation_trial — shows rating when >= 3', () => {
    const intel = mockIntel();
    const state = mockState({
      intel: {
        fast: null, consultant: null,
        deep: { googleMaps: { rating: 4.5, review_count: 120 } },
        industryLanguagePack: null, mergedVersion: 0,
      },
    });
    const d = directive({ stage: 'wow', wowStep: 'wow_2_reputation_trial', state, intel });
    expect(d.speak).toContain('4.5');
    expect(d.speak).toContain('120');
    expect(d.canSkip).toBe(false);
  });

  it('wow_2_reputation_trial — canSkip when no rating', () => {
    const d = directive({
      stage: 'wow',
      wowStep: 'wow_2_reputation_trial',
      state: mockState({
        intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
      }),
    });
    expect(d.canSkip).toBe(true);
  });

  it('wow_8_source_check — asks about lead source', () => {
    const d = directive({
      stage: 'wow',
      wowStep: 'wow_8_source_check',
      state: mockState({
        intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
      }),
    });
    expect(d.speak).toContain('referrals');
    expect(d.ask).toBe(true);
    expect(d.extract).toContain('leadSourceDominant');
  });

  it('wow_8_source_check — skips if source already known', () => {
    const d = directive({
      stage: 'wow',
      wowStep: 'wow_8_source_check',
      state: mockState({
        leadSourceDominant: 'website',
        routingConfidence: 'high',
        intel: { fast: null, consultant: null, deep: {}, industryLanguagePack: null, mergedVersion: 0 },
      }),
    });
    expect(d.canSkip).toBe(true);
  });
});

// ─── Recommendation ──────────────────────────────────────────────────────────

describe('recommendation stage', () => {
  it('alex + chris variant', () => {
    const d = directive({
      stage: 'recommendation',
      state: mockState({
        alexEligible: true, chrisEligible: true, maddieEligible: false,
      }),
    });
    expect(d.speak).toContain('Alex');
    expect(d.speak).toContain('Chris');
    expect(d.speak).toContain('faster follow-up');
    expect(d.ask).toBe(true);
  });

  it('maddie only variant', () => {
    const d = directive({
      stage: 'recommendation',
      state: mockState({
        alexEligible: false, chrisEligible: false, maddieEligible: true,
      }),
    });
    expect(d.speak).toContain('Maddie');
    expect(d.speak).not.toContain('Alex');
  });

  it('all three variant', () => {
    const d = directive({
      stage: 'recommendation',
      state: mockState({
        alexEligible: true, chrisEligible: true, maddieEligible: true,
      }),
    });
    expect(d.speak).toContain('Alex');
    expect(d.speak).toContain('Chris');
    expect(d.speak).toContain('Maddie');
  });
});

// ─── Anchor ACV ──────────────────────────────────────────────────────────────

describe('anchor_acv stage', () => {
  it('asks for average client value', () => {
    const d = directive({
      stage: 'anchor_acv',
      state: mockState({ business: 'TestCo' }),
    });
    expect(d.speak).toContain('new');
    expect(d.speak).toContain('worth');
    expect(d.speak).toContain('TestCo');
    expect(d.ask).toBe(true);
    expect(d.extract).toContain('acv');
  });
});

// ─── Channel stages — two modes ──────────────────────────────────────────────

describe('ch_alex — collect vs deliver mode', () => {
  it('collect mode — asks a question', () => {
    const d = directive({
      stage: 'ch_alex',
      state: mockState({ acv: 5000 }),
    });
    expect(d.ask).toBe(true);
    expect(d.speak.length).toBeGreaterThan(0);
  });

  it('deliver mode — presents ROI result', () => {
    const d = directive({
      stage: 'ch_alex',
      state: mockState({
        acv: 5000, inboundLeads: 50, inboundConversions: 5,
        responseSpeedBand: 'next_day_plus',
        calculatorResults: {
          alex: {
            agent: 'alex', weeklyValue: 75000, confidence: 'medium',
            assumptionsUsed: [], rationale: '', conservative: true,
          },
        },
      }),
    });
    expect(d.speak).toContain('75,000');
    expect(d.speak).toContain('dollars');
  });
});

// ─── ROI delivery ────────────────────────────────────────────────────────────

describe('roi_delivery stage', () => {
  it('presents combined total with agent breakdown', () => {
    const d = directive({
      stage: 'roi_delivery',
      state: mockState({
        firstName: 'Trent',
        topAgents: ['alex', 'chris'],
        calculatorResults: {
          alex: {
            agent: 'alex', weeklyValue: 10000, confidence: 'medium',
            assumptionsUsed: [], rationale: '', conservative: true,
          },
          chris: {
            agent: 'chris', weeklyValue: 5000, confidence: 'medium',
            assumptionsUsed: [], rationale: '', conservative: true,
          },
        },
      }),
    });
    expect(d.speak).toContain('Trent');
    expect(d.speak).toContain('10,000');
    expect(d.speak).toContain('5,000');
    expect(d.speak).toContain('15,000');
    expect(d.speak).toContain('conservative');
  });

  it('returns stub when no results available', () => {
    const d = directive({
      stage: 'roi_delivery',
      state: mockState({ topAgents: [] }),
    });
    expect(d.speak).toContain('add');
  });
});

// ─── Close ───────────────────────────────────────────────────────────────────

describe('close stage', () => {
  it('contains trial close language', () => {
    const d = directive({ stage: 'close' });
    expect(d.speak).toContain('free trial');
    expect(d.speak).toContain('no credit card');
    expect(d.ask).toBe(true);
  });
});

// ─── Slot-advance guards (no re-ask loops) ──────────────────────────────────

describe('slot-advance guards', () => {
  it('ch_alex: does NOT re-ask conversions when qCount >= 2 and slot unresolved', () => {
    const d = directive({
      stage: 'ch_alex',
      state: mockState({
        currentStage: 'ch_alex',
        inboundLeads: 50,
        inboundConversions: null,
        inboundConversionRate: null,
        questionCounts: { ch_alex: 2, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
        alexEligible: true, chrisEligible: false, maddieEligible: false,
        topAgents: ['alex'], currentQueue: [],
      }),
    });
    // Should ask about response speed, NOT re-ask conversions
    expect(d.speak).not.toContain('paying');
    expect(d.speak).toContain('follow');
    expect(d.extract).toContain('responseSpeedBand');
  });

  it('ch_alex: DOES ask conversions when qCount < 2', () => {
    const d = directive({
      stage: 'ch_alex',
      state: mockState({
        currentStage: 'ch_alex',
        inboundLeads: 50,
        inboundConversions: null,
        inboundConversionRate: null,
        questionCounts: { ch_alex: 1, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
        alexEligible: true, chrisEligible: false, maddieEligible: false,
        topAgents: ['alex'], currentQueue: [],
      }),
    });
    expect(d.speak).toContain('paying');
    expect(d.extract).toContain('inboundConversions');
  });

  it('ch_chris: does NOT re-ask conversions when qCount >= 2 and slot unresolved', () => {
    const d = directive({
      stage: 'ch_chris',
      state: mockState({
        currentStage: 'ch_chris',
        webLeads: 30,
        webConversions: null,
        webConversionRate: null,
        questionCounts: { ch_alex: 0, ch_chris: 2, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
        alexEligible: false, chrisEligible: true, maddieEligible: false,
        topAgents: ['chris'], currentQueue: [],
      }),
    });
    // Should return a skip/advance directive, not ask about conversions again
    expect(d.speak).not.toContain('paying');
    expect(d.canSkip).toBe(true);
  });

  it('ch_maddie: does NOT re-ask missed calls when qCount >= 2 and slot unresolved', () => {
    const d = directive({
      stage: 'ch_maddie',
      state: mockState({
        currentStage: 'ch_maddie',
        phoneVolume: 40,
        missedCalls: null,
        missedCallRate: null,
        questionCounts: { ch_alex: 0, ch_chris: 0, ch_maddie: 2, ch_sarah: 0, ch_james: 0 },
        alexEligible: false, chrisEligible: false, maddieEligible: true,
        topAgents: ['maddie'], currentQueue: [],
      }),
    });
    // Should return a skip/advance directive, not ask about missed calls again
    expect(d.speak).not.toContain('missed');
    expect(d.canSkip).toBe(true);
  });
});
