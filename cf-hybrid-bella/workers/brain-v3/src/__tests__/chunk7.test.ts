/**
 * brain-v3 Chunk 7 Assertions
 * C7-01 through C7-20 — Intelligence Layers
 */

import { describe, test, expect } from 'vitest';
import { detectIntent } from '../intent';
import { extractEngagementSignals, scoreEngagement, engagementLevel } from '../engagement';
import { needsRepair } from '../repair';
import { queryKB } from '../kb';
import { buildCriticalFacts, buildTurnPlan } from '../turn-plan';
import { buildStageDirective } from '../moves';
import { initialState } from '../state';
import type { ConversationState } from '../types';

// ─── Helper ─────────────────────────────────────────────────────────────────

function mockState(overrides: Partial<ConversationState> = {}): ConversationState {
  return { ...initialState('test-call', 'test-lead'), ...overrides };
}

// ─── C7-01: detectIntent 'interested' ────────────────────────────────────────

describe('C7-01', () => {
  test('detectIntent → interested', () => {
    expect(detectIntent('that sounds interesting, tell me more')).toBe('interested');
  });
});

// ─── C7-02: detectIntent 'objecting' ─────────────────────────────────────────

describe('C7-02', () => {
  test('detectIntent → objecting', () => {
    expect(detectIntent("it's too expensive for us")).toBe('objecting');
  });
});

// ─── C7-03: detectIntent 'confused' ──────────────────────────────────────────

describe('C7-03', () => {
  test('detectIntent → confused', () => {
    expect(detectIntent('what do you mean by that')).toBe('confused');
  });
});

// ─── C7-04: detectIntent 'ready_to_buy' ──────────────────────────────────────

describe('C7-04', () => {
  test('detectIntent → ready_to_buy', () => {
    expect(detectIntent('how do we get started')).toBe('ready_to_buy');
  });
});

// ─── C7-05: detectIntent 'neutral' for empty string ──────────────────────────

describe('C7-05', () => {
  test('detectIntent → neutral for empty string', () => {
    expect(detectIntent('')).toBe('neutral');
  });
});

// ─── C7-06: scoreEngagement max score ────────────────────────────────────────

describe('C7-06', () => {
  test('scoreEngagement → 5 (capped) for all high signals', () => {
    expect(scoreEngagement({ wordCount: 25, hasQuestion: true, hasAffirmation: true, hasMention: true })).toBe(5);
  });
});

// ─── C7-07: scoreEngagement zero score ───────────────────────────────────────

describe('C7-07', () => {
  test('scoreEngagement → 0 for all low signals', () => {
    expect(scoreEngagement({ wordCount: 5, hasQuestion: false, hasAffirmation: false, hasMention: false })).toBe(0);
  });
});

// ─── C7-08: engagementLevel 'high' ───────────────────────────────────────────

describe('C7-08', () => {
  test('engagementLevel(4) → high', () => {
    expect(engagementLevel(4)).toBe('high');
  });
});

// ─── C7-09: engagementLevel 'medium' ─────────────────────────────────────────

describe('C7-09', () => {
  test('engagementLevel(2) → medium', () => {
    expect(engagementLevel(2)).toBe('medium');
  });
});

// ─── C7-10: engagementLevel 'low' ────────────────────────────────────────────

describe('C7-10', () => {
  test('engagementLevel(1) → low', () => {
    expect(engagementLevel(1)).toBe('low');
  });
});

// ─── C7-11: needsRepair → needed for confused ────────────────────────────────

describe('C7-11', () => {
  test('needsRepair(confused) → needed=true with repairSpeak', () => {
    const state = mockState({ currentStage: 'wow_3' });
    const result = needsRepair('confused', state);
    expect(result.needed).toBe(true);
    expect(typeof result.repairSpeak).toBe('string');
    expect(result.repairSpeak!.length).toBeGreaterThan(0);
  });
});

// ─── C7-12: needsRepair → not needed for interested ──────────────────────────

describe('C7-12', () => {
  test('needsRepair(interested) → needed=false', () => {
    const state = mockState({ currentStage: 'wow_3' });
    const result = needsRepair('interested', state);
    expect(result.needed).toBe(false);
  });
});

// ─── C7-13: buildCriticalFacts returns <= 6 items ────────────────────────────

describe('C7-13', () => {
  test('buildCriticalFacts returns array length <= 6', () => {
    const state = mockState({
      currentStage: 'ch_alex',
      consultantData: {
        icpAnalysis: { marketPositionNarrative: 'Strong local market position' },
        valuePropAnalysis: { strongestBenefit: 'Speed to lead advantage' },
        routing: { reasoning: { alex: 'Alex fits because of high inbound volume. More detail.' } },
        hiringAnalysis: { topHiringWedge: 'They are hiring salespeople. Growth signal.' },
        businessIdentity: { businessModel: 'B2B SaaS', serviceArea: 'Australia-wide' },
      },
    });
    const facts = buildCriticalFacts('ch_alex', state);
    expect(facts.length).toBeLessThanOrEqual(6);
    expect(Array.isArray(facts)).toBe(true);
  });
});

// ─── C7-14: buildCriticalFacts → [] when consultantData is null ──────────────

describe('C7-14', () => {
  test('buildCriticalFacts returns empty array when consultantData is null', () => {
    const state = mockState({ consultantData: null });
    expect(buildCriticalFacts('ch_alex', state)).toEqual([]);
  });
});

// ─── C7-15: queryKB stub-safe — returns [] when no binding ───────────────────

describe('C7-15', () => {
  test('queryKB → [] when BRAIN_VECTORS binding absent', async () => {
    const result = await queryKB('any query', { BRAIN_VECTORS: undefined });
    expect(result).toEqual([]);
  });
});

// ─── C7-16: TurnPlan allowFreestyle=true for 'wow_1' ─────────────────────────

describe('C7-16', () => {
  test('TurnPlan has allowFreestyle=true for wow_1 stage', () => {
    const state = mockState({ currentStage: 'wow_1', wowStep: 1 });
    const directive = buildStageDirective('wow_1', state);
    const plan = buildTurnPlan(state, directive, 'turn-1');
    expect(plan.allowFreestyle).toBe(true);
  });
});

// ─── C7-17: TurnPlan allowFreestyle=false for 'roi_delivery' ─────────────────

describe('C7-17', () => {
  test('TurnPlan has allowFreestyle=false for roi_delivery stage', () => {
    const state = mockState({ currentStage: 'roi_delivery' });
    const directive = buildStageDirective('roi_delivery', state);
    const plan = buildTurnPlan(state, directive, 'turn-1');
    expect(plan.allowFreestyle).toBe(false);
  });
});

// ─── C7-18: TurnPlan.improvisationBand='strict' for 'roi_delivery' ───────────

describe('C7-18', () => {
  test('TurnPlan.improvisationBand = strict for roi_delivery', () => {
    const state = mockState({ currentStage: 'roi_delivery' });
    const directive = buildStageDirective('roi_delivery', state);
    const plan = buildTurnPlan(state, directive, 'turn-1');
    expect(plan.improvisationBand).toBe('strict');
  });
});

// ─── C7-19: TurnPlan.improvisationBand='wide' for 'wow_3' ────────────────────

describe('C7-19', () => {
  test('TurnPlan.improvisationBand = wide for wow_3', () => {
    const state = mockState({ currentStage: 'wow_3', wowStep: 3 });
    const directive = buildStageDirective('wow_3', state);
    const plan = buildTurnPlan(state, directive, 'turn-1');
    expect(plan.improvisationBand).toBe('wide');
  });
});

// ─── C7-20: No duplicate active listening cue for already-known key ──────────

describe('C7-20', () => {
  test('active listening cue absent when priorHotMemoryKeys already contains key', () => {
    const state = mockState({
      currentStage: 'wow_2',
      wowStep: 2,
      hotMemory: { acv: 5000 },
      priorHotMemoryKeys: ['acv'], // acv was already known in prior turn
    });
    const directive = buildStageDirective('wow_2', state);
    // activeListeningCue should be absent — acv is already in priorHotMemoryKeys
    expect(directive.activeListeningCue).toBeUndefined();
  });
});

// ─── C7-21: TurnPlan allowFreestyle=false for 'optional_side_agents' ──────────

describe('C7-21', () => {
  test('TurnPlan has allowFreestyle=false for optional_side_agents stage', () => {
    const state = mockState({ currentStage: 'optional_side_agents' });
    const directive = buildStageDirective('optional_side_agents', state);
    const plan = buildTurnPlan(state, directive, 'turn-1');
    expect(plan.allowFreestyle).toBe(false);
  });
});

// ─── C7-22: TurnPlan allowFreestyle=false for 'close' ────────────────────────

describe('C7-22', () => {
  test('TurnPlan has allowFreestyle=false for close stage', () => {
    const state = mockState({ currentStage: 'close' });
    const directive = buildStageDirective('close', state);
    const plan = buildTurnPlan(state, directive, 'turn-1');
    expect(plan.allowFreestyle).toBe(false);
  });
});
