import { describe, it, expect } from 'vitest';
import {
  hasValue,
  hasAlexMinimumData,
  hasChrisMinimumData,
  hasMaddieMinimumData,
  shouldForceAdvance,
  maxQuestionsReached,
  deriveEligibility,
  deriveTopAgents,
  buildInitialQueue,
  nextChannelFromQueue,
} from '../gate';
import { mockState, mockIntel } from './helpers';

// ─── hasValue ───────────────────────────────────────────────────────────────

describe('hasValue', () => {
  it('returns true for non-empty values', () => {
    expect(hasValue(42)).toBe(true);
    expect(hasValue('hello')).toBe(true);
    expect(hasValue(0)).toBe(true);
    expect(hasValue(false)).toBe(true);
  });

  it('returns false for null, undefined, empty string', () => {
    expect(hasValue(null)).toBe(false);
    expect(hasValue(undefined)).toBe(false);
    expect(hasValue('')).toBe(false);
  });
});

// ─── Minimum data checks ─────────────────────────────────────────────────────

describe('hasAlexMinimumData', () => {
  it('returns true when all Alex fields are present', () => {
    const state = mockState({
      acv: 5000,
      inboundLeads: 50,
      inboundConversions: 5,
      responseSpeedBand: 'next_day_plus',
    });
    expect(hasAlexMinimumData(state)).toBe(true);
  });

  it('returns true with conversionRate instead of conversions', () => {
    const state = mockState({
      acv: 5000,
      inboundLeads: 50,
      inboundConversionRate: 0.1,
      responseSpeedBand: 'next_day_plus',
    });
    expect(hasAlexMinimumData(state)).toBe(true);
  });

  it('returns false when responseSpeedBand is missing', () => {
    const state = mockState({
      acv: 5000,
      inboundLeads: 50,
      inboundConversions: 5,
    });
    expect(hasAlexMinimumData(state)).toBe(false);
  });

  it('returns false when acv is missing', () => {
    const state = mockState({
      inboundLeads: 50,
      inboundConversions: 5,
      responseSpeedBand: 'next_day_plus',
    });
    expect(hasAlexMinimumData(state)).toBe(false);
  });
});

describe('hasChrisMinimumData', () => {
  it('returns true with acv + webLeads + webConversions', () => {
    const state = mockState({
      acv: 3000,
      webLeads: 100,
      webConversions: 5,
    });
    expect(hasChrisMinimumData(state)).toBe(true);
  });

  it('returns false without webLeads', () => {
    const state = mockState({ acv: 3000, webConversions: 5 });
    expect(hasChrisMinimumData(state)).toBe(false);
  });
});

describe('hasMaddieMinimumData', () => {
  it('returns true with phoneVolume + missedCalls + acv', () => {
    const state = mockState({ acv: 3000, phoneVolume: 50, missedCalls: 10 });
    expect(hasMaddieMinimumData(state)).toBe(true);
  });

  it('returns true with phoneVolume + missedCallRate + acv', () => {
    const state = mockState({ acv: 3000, phoneVolume: 50, missedCallRate: 0.2 });
    expect(hasMaddieMinimumData(state)).toBe(true);
  });

  it('returns false with phoneVolume only', () => {
    const state = mockState({ phoneVolume: 50 });
    expect(hasMaddieMinimumData(state)).toBe(false);
  });
});

// ─── shouldForceAdvance ─────────────────────────────────────────────────────

describe('shouldForceAdvance', () => {
  it('returns true for ch_alex with all data', () => {
    const state = mockState({
      acv: 5000, inboundLeads: 50, inboundConversions: 5,
      responseSpeedBand: 'next_day_plus',
    });
    expect(shouldForceAdvance('ch_alex', state)).toBe(true);
  });

  it('returns false for ch_alex with missing data', () => {
    const state = mockState({ acv: 5000, inboundLeads: 50 });
    expect(shouldForceAdvance('ch_alex', state)).toBe(false);
  });

  it('returns true for ch_chris with all data', () => {
    const state = mockState({ acv: 3000, webLeads: 100, webConversions: 5 });
    expect(shouldForceAdvance('ch_chris', state)).toBe(true);
  });

  it('returns true for ch_maddie with all data', () => {
    const state = mockState({ acv: 3000, phoneVolume: 50, missedCalls: 10 });
    expect(shouldForceAdvance('ch_maddie', state)).toBe(true);
  });

  it('returns false for non-channel stages', () => {
    const state = mockState({ acv: 5000 });
    expect(shouldForceAdvance('greeting', state)).toBe(false);
    expect(shouldForceAdvance('wow', state)).toBe(false);
    expect(shouldForceAdvance('roi_delivery', state)).toBe(false);
  });
});

// ─── maxQuestionsReached ────────────────────────────────────────────────────

describe('maxQuestionsReached', () => {
  it('ch_alex budget = 3', () => {
    expect(maxQuestionsReached('ch_alex', mockState({
      questionCounts: { ch_alex: 2, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
    }))).toBe(false);
    expect(maxQuestionsReached('ch_alex', mockState({
      questionCounts: { ch_alex: 3, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
    }))).toBe(true);
  });

  it('ch_chris budget = 2', () => {
    expect(maxQuestionsReached('ch_chris', mockState({
      questionCounts: { ch_alex: 0, ch_chris: 1, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
    }))).toBe(false);
    expect(maxQuestionsReached('ch_chris', mockState({
      questionCounts: { ch_alex: 0, ch_chris: 2, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
    }))).toBe(true);
  });

  it('ch_maddie budget = 2', () => {
    expect(maxQuestionsReached('ch_maddie', mockState({
      questionCounts: { ch_alex: 0, ch_chris: 0, ch_maddie: 1, ch_sarah: 0, ch_james: 0 },
    }))).toBe(false);
    expect(maxQuestionsReached('ch_maddie', mockState({
      questionCounts: { ch_alex: 0, ch_chris: 0, ch_maddie: 2, ch_sarah: 0, ch_james: 0 },
    }))).toBe(true);
  });

  it('returns false for non-channel stages', () => {
    expect(maxQuestionsReached('greeting', mockState())).toBe(false);
    expect(maxQuestionsReached('roi_delivery', mockState())).toBe(false);
  });
});

// ─── deriveEligibility ──────────────────────────────────────────────────────

describe('deriveEligibility', () => {
  it('website + ads → alex + chris eligible, maddie not', () => {
    const intel = mockIntel({ fast: { websiteExists: true } });
    const state = mockState({ leadSourceDominant: 'website', websiteRelevant: true });
    const result = deriveEligibility(intel, state);
    expect(result.alexEligible).toBe(true);
    expect(result.chrisEligible).toBe(true);
    expect(result.maddieEligible).toBe(false);
  });

  it('phone signals → alex + maddie eligible', () => {
    const intel = mockIntel({ fast: { phoneVisible: true } });
    const state = mockState({ leadSourceDominant: 'phone', phoneRelevant: true });
    const result = deriveEligibility(intel, state);
    expect(result.alexEligible).toBe(true);
    expect(result.maddieEligible).toBe(true);
  });

  it('explicit no-inbound → alex NOT eligible', () => {
    const intel = mockIntel({ fast: {} });
    const state = mockState({
      leadSourceDominant: 'other',
      websiteRelevant: false,
      phoneRelevant: false,
      adsConfirmed: false,
    });
    const result = deriveEligibility(intel, state);
    expect(result.alexEligible).toBe(false);
  });

  it('all signals present → all three eligible', () => {
    const intel = mockIntel({
      fast: { websiteExists: true, phoneVisible: true },
    });
    const state = mockState({
      leadSourceDominant: 'website',
      websiteRelevant: true,
      phoneRelevant: true,
    });
    const result = deriveEligibility(intel, state);
    expect(result.alexEligible).toBe(true);
    expect(result.chrisEligible).toBe(true);
    expect(result.maddieEligible).toBe(true);
  });
});

// ─── deriveTopAgents — Alex-first rule ──────────────────────────────────────

describe('deriveTopAgents', () => {
  it('all three eligible → [alex, chris, maddie]', () => {
    const state = mockState({
      alexEligible: true, chrisEligible: true, maddieEligible: true,
    });
    expect(deriveTopAgents(state)).toEqual(['alex', 'chris', 'maddie']);
  });

  it('alex + chris → [alex, chris]', () => {
    const state = mockState({ alexEligible: true, chrisEligible: true, maddieEligible: false });
    expect(deriveTopAgents(state)).toEqual(['alex', 'chris']);
  });

  it('alex + maddie → [alex, maddie]', () => {
    const state = mockState({ alexEligible: true, chrisEligible: false, maddieEligible: true });
    expect(deriveTopAgents(state)).toEqual(['alex', 'maddie']);
  });

  it('alex only → [alex]', () => {
    const state = mockState({ alexEligible: true, chrisEligible: false, maddieEligible: false });
    expect(deriveTopAgents(state)).toEqual(['alex']);
  });

  it('maddie only (alex NOT eligible) → [maddie]', () => {
    const state = mockState({ alexEligible: false, chrisEligible: false, maddieEligible: true });
    expect(deriveTopAgents(state)).toEqual(['maddie']);
  });

  it('chris only → [chris]', () => {
    const state = mockState({ alexEligible: false, chrisEligible: true, maddieEligible: false });
    expect(deriveTopAgents(state)).toEqual(['chris']);
  });

  it('none eligible → []', () => {
    const state = mockState({ alexEligible: false, chrisEligible: false, maddieEligible: false });
    expect(deriveTopAgents(state)).toEqual([]);
  });
});

// ─── buildInitialQueue ──────────────────────────────────────────────────────

describe('buildInitialQueue', () => {
  it('builds 3-item queue sorted by priority', () => {
    const state = mockState({ topAgents: ['alex', 'chris', 'maddie'] });
    const queue = buildInitialQueue(state);
    expect(queue).toHaveLength(3);
    expect(queue[0]).toMatchObject({ stage: 'ch_alex', agent: 'alex', priority: 1 });
    expect(queue[1]).toMatchObject({ stage: 'ch_chris', agent: 'chris', priority: 2 });
    expect(queue[2]).toMatchObject({ stage: 'ch_maddie', agent: 'maddie', priority: 3 });
  });

  it('builds single-item queue', () => {
    const state = mockState({ topAgents: ['alex'] });
    const queue = buildInitialQueue(state);
    expect(queue).toHaveLength(1);
    expect(queue[0].agent).toBe('alex');
  });

  it('builds empty queue when no agents', () => {
    const state = mockState({ topAgents: [] });
    expect(buildInitialQueue(state)).toEqual([]);
  });
});

// ─── nextChannelFromQueue ───────────────────────────────────────────────────

describe('nextChannelFromQueue', () => {
  const fullQueue = [
    { stage: 'ch_alex' as const, agent: 'alex' as const, priority: 1, why: '' },
    { stage: 'ch_chris' as const, agent: 'chris' as const, priority: 2, why: '' },
    { stage: 'ch_maddie' as const, agent: 'maddie' as const, priority: 3, why: '' },
  ];

  it('returns first stage when none completed', () => {
    const state = mockState({ currentQueue: fullQueue, completedStages: [] });
    expect(nextChannelFromQueue(state)).toBe('ch_alex');
  });

  it('returns third stage when first two completed', () => {
    const state = mockState({
      currentQueue: fullQueue,
      completedStages: ['ch_alex', 'ch_chris'],
    });
    expect(nextChannelFromQueue(state)).toBe('ch_maddie');
  });

  it('returns roi_delivery when all completed', () => {
    const state = mockState({
      currentQueue: fullQueue,
      completedStages: ['ch_alex', 'ch_chris', 'ch_maddie'],
    });
    expect(nextChannelFromQueue(state)).toBe('roi_delivery');
  });
});
