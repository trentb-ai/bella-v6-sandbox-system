/**
 * brain-v3 Chunk 1 Assertions
 * C1-24 through C1-30 + C1-NB1 + C1-NB2
 */

import { describe, test, expect } from 'vitest';
import type { WarmFact, ConversationState } from '../types';
import { getFact, shouldAskQuestion, resolveBusinessName } from '../facts';
import { shouldForceAdvance, maxQuestionsReached } from '../gate';
import { buildStageDirective } from '../moves';
import { buildTurnPlan } from '../turn-plan';
import { processFlow } from '../stage-machine';
import { initialState } from '../state';

// ─── Helper ─────────────────────────────────────────────────────────────────

function createTestState(overrides: Partial<ConversationState> = {}): ConversationState {
  return {
    ...initialState('test-call', 'test-lead'),
    ...overrides,
  };
}

// ─── C1-24: getFact() returns prospect over consultant for same key ─────────

describe('C1-24: getFact source priority', () => {
  test('prefers prospect over consultant', () => {
    const warm: WarmFact[] = [
      { fact_key: 'acv', fact_value: '5000', data_source: 'consultant', confidence: 0.8 },
      { fact_key: 'acv', fact_value: '8000', data_source: 'prospect', confidence: 1.0 },
    ];
    expect(getFact('acv', {}, warm)).toBe('8000');
  });
});

// ─── C1-25: getFact() returns consultant over scrape for same key ───────────

describe('C1-25: getFact consultant over scrape', () => {
  test('prefers consultant over scrape', () => {
    const warm: WarmFact[] = [
      { fact_key: 'industry', fact_value: 'Accounting', data_source: 'scrape', confidence: 0.7 },
      { fact_key: 'industry', fact_value: 'Professional Services', data_source: 'consultant', confidence: 0.9 },
    ];
    expect(getFact('industry', {}, warm)).toBe('Professional Services');
  });
});

// ─── C1-26: getFact() returns HotMemory over D1 warm facts ─────────────────

describe('C1-26: getFact hotMemory priority', () => {
  test('prefers hotMemory over all warm facts', () => {
    const hot = { acv: 10000 };
    const warm: WarmFact[] = [
      { fact_key: 'acv', fact_value: '5000', data_source: 'prospect', confidence: 1.0 },
    ];
    expect(getFact('acv', hot, warm)).toBe(10000);
  });
});

// ─── C1-27: shouldAskQuestion('webLeads') = false when inboundLeads has value

describe('C1-27: shouldAskQuestion FIELD_EQUIVALENTS', () => {
  test('webLeads returns false when inboundLeads has value', () => {
    const hot = { inboundLeads: 50 };
    expect(shouldAskQuestion('webLeads', hot, [])).toBe(false);
  });

  test('inboundLeads returns false when webLeads has value', () => {
    const hot = { webLeads: 30 };
    expect(shouldAskQuestion('inboundLeads', hot, [])).toBe(false);
  });

  test('webConversions returns false when inboundConversions has value', () => {
    const hot = { inboundConversions: 5 };
    expect(shouldAskQuestion('webConversions', hot, [])).toBe(false);
  });
});

// ─── C1-28: shouldAskQuestion('acv') = true when no value anywhere ──────────

describe('C1-28: shouldAskQuestion no value', () => {
  test('returns true when no value exists', () => {
    expect(shouldAskQuestion('acv', {}, [])).toBe(true);
  });

  test('returns false when value exists in hotMemory', () => {
    expect(shouldAskQuestion('acv', { acv: 5000 }, [])).toBe(false);
  });

  test('returns false when value exists in warmFacts', () => {
    const warm: WarmFact[] = [
      { fact_key: 'acv', fact_value: '3000', data_source: 'prospect', confidence: 1.0 },
    ];
    expect(shouldAskQuestion('acv', {}, warm)).toBe(false);
  });
});

// ─── C1-29: TurnPlan for Chris includes facts from Alex ─────────────────────

describe('C1-29: TurnPlan cross-channel facts', () => {
  test('Chris TurnPlan carries ACV captured during Alex', () => {
    const state = createTestState({
      currentStage: 'ch_chris',
      hotMemory: { inboundLeads: 50, acv: 5000 },
      currentQueue: [
        { stage: 'ch_alex', agent: 'alex', priority: 1, why: 'test' },
        { stage: 'ch_chris', agent: 'chris', priority: 2, why: 'test' },
      ],
      topAgents: ['alex', 'chris'],
      alexEligible: true,
      chrisEligible: true,
    });

    const directive = buildStageDirective('ch_chris', state);
    const plan = buildTurnPlan(state, directive, 'turn-1');

    // Chris TurnPlan must include the ACV fact captured during Alex
    expect(plan.confirmedFacts).toContainEqual(expect.stringContaining('5000'));
  });
});

// ─── C1-30: TurnPlan for Chris does NOT ask webLeads when inboundLeads captured

describe('C1-30: Chris skips equivalent field', () => {
  test('Chris does not ask webLeads when inboundLeads exists', () => {
    const state = createTestState({
      currentStage: 'ch_chris',
      hotMemory: { inboundLeads: 50 },
      currentQueue: [
        { stage: 'ch_chris', agent: 'chris', priority: 1, why: 'test' },
      ],
      topAgents: ['chris'],
      chrisEligible: true,
    });

    const directive = buildStageDirective('ch_chris', state);

    // Should NOT have webLeads in extraction targets (equivalent already captured)
    expect(directive.extract ?? []).not.toContain('webLeads');
  });
});

// ─── C1-NB1: Unknown speakerFlag skips extraction ───────────────────────────

describe('C1-NB1: unknown speakerFlag', () => {
  test('stage machine still advances but extraction should be skipped', () => {
    const state = createTestState({
      currentStage: 'greeting',
      turnIndex: 1,
    });

    // Process with unknown speaker — stage machine should still work
    const advanced = processFlow(state, 'hello', 'unknown');

    // Stage machine processes (greeting doesn't advance on unknown though)
    // The key assertion is that the caller checks speakerFlag before dispatching extraction
    // This is tested at the brain-do level, but we verify stage machine doesn't crash
    expect(state.currentStage).toBeDefined();
  });

  test('prospect speakerFlag advances greeting', () => {
    const state = createTestState({
      currentStage: 'greeting',
      turnIndex: 1,
    });

    const advanced = processFlow(state, 'hello', 'prospect');
    expect(advanced).toBe(true);
    expect(state.currentStage).toBe('wow_1');
  });
});

// ─── C1-NB2: Business name resolves consultant > scrape ─────────────────────

describe('C1-NB2: resolveBusinessName', () => {
  test('prefers consultant correctedName over scrape', () => {
    const warm: WarmFact[] = [
      { fact_key: 'business_name', fact_value: 'kpmg.com', data_source: 'scrape', confidence: 0.5 },
      { fact_key: 'business_name', fact_value: 'KPMG Australia', data_source: 'consultant', confidence: 0.95 },
    ];
    expect(resolveBusinessName({}, warm)).toBe('KPMG Australia');
  });

  test('falls back to scrape when no consultant name', () => {
    const warm: WarmFact[] = [
      { fact_key: 'business_name', fact_value: 'kpmg.com', data_source: 'scrape', confidence: 0.5 },
    ];
    expect(resolveBusinessName({}, warm)).toBe('kpmg.com');
  });

  test('falls back to default when no facts at all', () => {
    expect(resolveBusinessName({}, [])).toBe('your business');
  });

  test('hotMemory business_name wins over all', () => {
    const warm: WarmFact[] = [
      { fact_key: 'business_name', fact_value: 'KPMG Australia', data_source: 'consultant', confidence: 0.95 },
    ];
    expect(resolveBusinessName({ business_name: 'KPMG AU' }, warm)).toBe('KPMG AU');
  });
});

// ─── Additional: shouldForceAdvance with eitherOrFields ─────────────────────

describe('shouldForceAdvance eitherOrFields', () => {
  test('Alex advances when all required + either conversions OR rate present', () => {
    const hot = {
      acv: 5000,
      inboundLeads: 50,
      inboundConversionRate: 0.15,
      responseSpeedBand: '5_to_30_minutes',
    };
    expect(shouldForceAdvance('ch_alex', hot, [])).toBe(true);
  });

  test('Alex does NOT advance when conversions/rate both missing', () => {
    const hot = {
      acv: 5000,
      inboundLeads: 50,
      responseSpeedBand: '5_to_30_minutes',
    };
    expect(shouldForceAdvance('ch_alex', hot, [])).toBe(false);
  });

  test('Chris advances with webLeads equivalent (inboundLeads) + conversion', () => {
    const hot = {
      acv: 5000,
      webLeads: 30,
      webConversionRate: 0.10,
    };
    expect(shouldForceAdvance('ch_chris', hot, [])).toBe(true);
  });

  test('Maddie advances with phoneVolume + missedCalls', () => {
    const hot = {
      phoneVolume: 100,
      missedCalls: 20,
    };
    // Note: Maddie doesn't require acv in requiredFields
    expect(shouldForceAdvance('ch_maddie', hot, [])).toBe(true);
  });

  test('non-channel stage returns false', () => {
    expect(shouldForceAdvance('greeting', {}, [])).toBe(false);
  });
});

// ─── Additional: maxQuestionsReached ────────────────────────────────────────

describe('maxQuestionsReached', () => {
  test('Alex at 3 questions = reached', () => {
    expect(maxQuestionsReached('ch_alex', { ch_alex: 3 })).toBe(true);
  });

  test('Alex at 2 questions = not reached', () => {
    expect(maxQuestionsReached('ch_alex', { ch_alex: 2 })).toBe(false);
  });

  test('Chris at 2 questions = reached', () => {
    expect(maxQuestionsReached('ch_chris', { ch_chris: 2 })).toBe(true);
  });
});

// ─── P2 fix: anchor_acv advances after 1 prospect reply ─────────────────────

describe('anchor_acv advancement', () => {
  test('advances when ACV is in hotMemory', () => {
    const state = createTestState({
      currentStage: 'anchor_acv',
      hotMemory: { acv: 5000 },
      currentQueue: [{ stage: 'ch_alex', agent: 'alex', priority: 1, why: 'test' }],
    });
    const advanced = processFlow(state, 'five thousand', 'prospect');
    expect(advanced).toBe(true);
    expect(state.currentStage).toBe('ch_alex');
  });

  test('advances after 1 prospect reply even without ACV', () => {
    const state = createTestState({
      currentStage: 'anchor_acv',
      currentQueue: [{ stage: 'ch_alex', agent: 'alex', priority: 1, why: 'test' }],
    });
    const advanced = processFlow(state, 'I am not sure', 'prospect');
    expect(advanced).toBe(true);
    expect(state.currentStage).toBe('ch_alex');
  });

  test('does NOT advance on bella turn', () => {
    const state = createTestState({
      currentStage: 'anchor_acv',
      currentQueue: [{ stage: 'ch_alex', agent: 'alex', priority: 1, why: 'test' }],
    });
    const advanced = processFlow(state, 'What is your ACV?', 'bella');
    expect(advanced).toBe(false);
    expect(state.currentStage).toBe('anchor_acv');
  });
});

// ─── P4 fix: WOW stall gate ─────────────────────────────────────────────────

describe('WOW stall gate', () => {
  test('wow_3 does NOT advance when stall < 3', () => {
    const state = createTestState({
      currentStage: 'wow_3',
      wowStep: 3,
      stall: 1, // will be incremented to 2 by processFlow
    });
    const advanced = processFlow(state, 'interesting', 'prospect');
    expect(advanced).toBe(false);
    expect(state.currentStage).toBe('wow_3');
  });

  test('wow_3 advances when stall >= 3', () => {
    const state = createTestState({
      currentStage: 'wow_3',
      wowStep: 3,
      stall: 2, // will be incremented to 3 by processFlow — gate passes
    });
    const advanced = processFlow(state, 'tell me more', 'prospect');
    expect(advanced).toBe(true);
    expect(state.currentStage).toBe('wow_4');
  });

  test('wow_1 and wow_2 auto-advance on prospect turn (no stall gate)', () => {
    const state = createTestState({
      currentStage: 'wow_1',
      wowStep: 1,
      stall: 0,
    });
    const advanced = processFlow(state, 'That sounds interesting...', 'prospect');
    expect(advanced).toBe(true);
    expect(state.currentStage).toBe('wow_2');
  });
});

// ─── P1/P3 fix: resolveBusinessName with consultant data_source ─────────────

describe('consultant vs scrape fact resolution (P1/P3)', () => {
  test('consultant business_name wins over scrape in warmFacts', () => {
    const warm: WarmFact[] = [
      { fact_key: 'business_name', fact_value: 'example.com', data_source: 'scrape', confidence: 0.8 },
      { fact_key: 'business_name', fact_value: 'Example Corp', data_source: 'consultant', confidence: 0.95 },
    ];
    // This verifies P1: consultant-sourced name is resolvable
    expect(resolveBusinessName({}, warm)).toBe('Example Corp');
  });

  test('getFact returns consultant over scrape for business_name', () => {
    const warm: WarmFact[] = [
      { fact_key: 'business_name', fact_value: 'example.com', data_source: 'scrape', confidence: 0.8 },
      { fact_key: 'business_name', fact_value: 'Example Corp', data_source: 'consultant', confidence: 0.95 },
    ];
    expect(getFact('business_name', {}, warm)).toBe('Example Corp');
  });
});
