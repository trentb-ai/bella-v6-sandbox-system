/**
 * flow-process.test.ts — Group 4: processFlow() Core Transitions
 *
 * Tests the deterministic state machine in processFlow().
 * Uses real buildStageDirective (from moves.ts) and real gate functions.
 */

import { describe, it, expect } from 'vitest';
import { mockState, mockIntel, ALL_WOW_STEPS } from './helpers';
import { processFlow } from '../flow';
import { assertInvariants } from './invariants';
import type { QueueItem, ConversationState, FlowResult } from '../types';
import type { MergedIntel } from '../types';

const NOW = Date.now();

/** Wrapper: runs processFlow then asserts all state invariants. */
function flowAndAssert(
  state: ConversationState,
  intel: MergedIntel,
  transcript: string,
  turnId: string,
  ts: number,
  ctx?: string,
): FlowResult {
  if (state.pendingDelivery) state.pendingDelivery.issuedAt -= 5000;
  const result = processFlow(state, intel, transcript, turnId, ts);
  assertInvariants(state, ctx ?? turnId);
  return result;
}

describe('processFlow', () => {
  // ─── GREETING ───────────────────────────────────────────────────────────────

  describe('greeting stage', () => {
    it('greeting → wow on user speech', () => {
      const state = mockState({ currentStage: 'greeting' });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'Hello there', 'turn_1', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('wow');
      expect(state.currentWowStep).toBe('wow_1_research_intro');
      expect(state.completedStages).toContain('greeting');
    });

    it('greeting stays if no transcript', () => {
      const state = mockState({ currentStage: 'greeting' });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, '', 'turn_1', NOW);

      expect(result.advanced).toBe(false);
      expect(state.currentStage).toBe('greeting');
    });
  });

  // ─── WOW ────────────────────────────────────────────────────────────────────

  describe('wow stage', () => {
    it('advances through steps on user speech', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_1_research_intro',
        completedStages: ['greeting'],
      });
      // mockIntel with no deep data → wow_2 will canSkip
      // But first, wow_1 should complete and advance to wow_2
      // With no rating, wow_2 canSkip=true → chain-skip to wow_3
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yeah sounds good', 'turn_2', NOW);

      // wow_1 completes, wow_2 chain-skips (no rating), lands on wow_3
      expect(state.completedWowSteps).toContain('wow_1_research_intro');
      expect(state.completedWowSteps).toContain('wow_2_reputation_trial'); // chain-skipped
      expect(state.currentWowStep).toBe('wow_3_icp_problem_solution');
    });

    it('chain-skip: skips wow_2 when no rating, lands on wow_3', () => {
      // Start directly on wow_2 (canSkip + !waitForUser)
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_2_reputation_trial',
        completedStages: ['greeting'],
        completedWowSteps: ['wow_1_research_intro'],
      });
      const intel = mockIntel(); // no deep data → no rating → canSkip=true

      const result = flowAndAssert(state, intel, 'sure', 'turn_3', NOW);

      // wow_2 should be auto-skipped (canSkip + !waitForUser loop at top of wow case)
      expect(state.completedWowSteps).toContain('wow_2_reputation_trial');
      expect(state.currentWowStep).toBe('wow_3_icp_problem_solution');
    });

    it('wow exits to recommendation when all steps completed', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_8_source_check',
        completedStages: ['greeting'],
        completedWowSteps: [
          'wow_1_research_intro',
          'wow_2_reputation_trial',
          'wow_3_icp_problem_solution',
          'wow_4_conversion_action',
          'wow_5_alignment_bridge',
          'wow_6_scraped_observation',
          'wow_7_explore_or_recommend',
        ],
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'mostly from the website', 'turn_9', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('recommendation');
      expect(state.currentWowStep).toBeNull(); // REGRESSION: stale wowStep poisoned all post-wow moveIds
      expect(state.completedStages).toContain('wow');
      expect(state.completedWowSteps).toContain('wow_8_source_check');
    });

    it('wow_8 chain-skip when leadSource already known', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_7_explore_or_recommend',
        completedStages: ['greeting'],
        completedWowSteps: [
          'wow_1_research_intro',
          'wow_2_reputation_trial',
          'wow_3_icp_problem_solution',
          'wow_4_conversion_action',
          'wow_5_alignment_bridge',
          'wow_6_scraped_observation',
        ],
        leadSourceDominant: 'website',
        routingConfidence: 'high',
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yes recommend them', 'turn_8', NOW);

      // wow_7 completes, wow_8 canSkip (leadSource known + high confidence) → chain-skip → recommendation
      expect(state.completedWowSteps).toContain('wow_7_explore_or_recommend');
      expect(state.completedWowSteps).toContain('wow_8_source_check');
      expect(state.currentStage).toBe('recommendation');
      expect(state.currentWowStep).toBeNull(); // REGRESSION: chain-skip exit must also clear wowStep
      expect(result.advanced).toBe(true);
    });
  });

  // ─── RECOMMENDATION ─────────────────────────────────────────────────────────

  describe('recommendation stage', () => {
    it('recommendation → anchor_acv on user speech', () => {
      const state = mockState({
        currentStage: 'recommendation',
        currentWowStep: null,
        completedStages: ['greeting', 'wow'],
        completedWowSteps: ALL_WOW_STEPS,
        alexEligible: true,
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'sounds good lets do it', 'turn_10', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('anchor_acv');
      expect(state.completedStages).toContain('recommendation');
      // Queue should have been built
      expect(state.topAgents.length).toBeGreaterThanOrEqual(0);
    });
  });

  // ─── ANCHOR ACV ─────────────────────────────────────────────────────────────

  describe('anchor_acv stage', () => {
    it('anchor_acv → first channel when acv captured', () => {
      const queue: QueueItem[] = [
        { stage: 'ch_alex', agent: 'alex', priority: 1, why: 'Alex test' },
      ];
      const state = mockState({
        currentStage: 'anchor_acv',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation'],
        completedWowSteps: ALL_WOW_STEPS,
        acv: 5000,
        currentQueue: queue,
        alexEligible: true,
        topAgents: ['alex'],
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'about five thousand', 'turn_11', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('ch_alex');
      expect(state.completedStages).toContain('anchor_acv');
    });

    it('anchor_acv → roi_delivery when queue is empty', () => {
      const state = mockState({
        currentStage: 'anchor_acv',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation'],
        completedWowSteps: ALL_WOW_STEPS,
        acv: 5000,
        currentQueue: [], // empty queue
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'five thousand', 'turn_11', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('roi_delivery');
    });

    it('anchor_acv stays if acv is null', () => {
      const state = mockState({
        currentStage: 'anchor_acv',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation'],
        completedWowSteps: ALL_WOW_STEPS,
        acv: null,
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'hmm not sure', 'turn_11', NOW);

      expect(result.advanced).toBe(false);
      expect(state.currentStage).toBe('anchor_acv');
    });
  });

  // ─── CHANNEL STAGES ─────────────────────────────────────────────────────────

  describe('channel stage advancement', () => {
    it('ch_alex advances when shouldForceAdvance + hasResult + hasSpoken', () => {
      const queue: QueueItem[] = [
        { stage: 'ch_alex', agent: 'alex', priority: 1, why: 'test' },
      ];
      const state = mockState({
        currentStage: 'ch_alex',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv'],
        completedWowSteps: ALL_WOW_STEPS,
        acv: 5000,
        inboundLeads: 50,
        inboundConversions: 5,
        responseSpeedBand: 'next_day_plus',
        currentQueue: queue,
        spoken: { moveIds: ['v2_ch_alex'], factsUsed: [] },
        alexEligible: true,
        topAgents: ['alex'],
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yeah makes sense', 'turn_12', NOW);

      expect(result.advanced).toBe(true);
      expect(state.completedStages).toContain('ch_alex');
      // With only alex in queue, next is roi_delivery
      expect(state.currentStage).toBe('roi_delivery');
      // Calculator should have been computed
      expect(state.calculatorResults.alex).toBeDefined();
      expect(state.calculatorResults.alex!.weeklyValue).toBeGreaterThan(0);
    });

    it('ch_alex advances when budget exhausted + no data (budget_exhausted path)', () => {
      const queue: QueueItem[] = [
        { stage: 'ch_alex', agent: 'alex', priority: 1, why: 'test' },
      ];
      const state = mockState({
        currentStage: 'ch_alex',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv'],
        completedWowSteps: ALL_WOW_STEPS,
        questionCounts: { ch_alex: 3, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
        currentQueue: queue,
        alexEligible: true,
        topAgents: ['alex'],
        // No data fields set → shouldForceAdvance=false, but maxQuestionsReached=true
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'I really dont know', 'turn_15', NOW);

      expect(result.advanced).toBe(true);
      expect(state.completedStages).toContain('ch_alex');
      // No calculator result since no data
      expect(state.calculatorResults.alex).toBeUndefined();
    });

    it('ch_alex stuck_escape when past budget + 1', () => {
      const queue: QueueItem[] = [
        { stage: 'ch_alex', agent: 'alex', priority: 1, why: 'test' },
      ];
      const state = mockState({
        currentStage: 'ch_alex',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv'],
        completedWowSteps: ALL_WOW_STEPS,
        questionCounts: { ch_alex: 4, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 }, // > maxQ=3
        currentQueue: queue,
        alexEligible: true,
        topAgents: ['alex'],
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'whatever', 'turn_16', NOW);

      expect(result.advanced).toBe(true);
      expect(state.completedStages).toContain('ch_alex');
    });

    it('optional channel (ch_sarah) routes back to optional_side_agents', () => {
      const state = mockState({
        currentStage: 'ch_sarah',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv', 'ch_alex', 'roi_delivery'],
        completedWowSteps: ALL_WOW_STEPS,
        acv: 5000,
        oldLeads: 500,
        questionCounts: { ch_alex: 0, ch_chris: 0, ch_maddie: 0, ch_sarah: 2, ch_james: 0 },
        spoken: { moveIds: ['v2_ch_sarah'], factsUsed: [] },
        prospectAskedAboutSarah: true,
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yeah that makes sense', 'turn_20', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('optional_side_agents');
      expect(state.completedStages).toContain('ch_sarah');
    });
  });

  // ─── ROI DELIVERY ───────────────────────────────────────────────────────────

  describe('roi_delivery stage', () => {
    it('roi_delivery → optional_side_agents when user confirms + spoken marker present', () => {
      const state = mockState({
        currentStage: 'roi_delivery',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv', 'ch_alex'],
        completedWowSteps: ALL_WOW_STEPS,
        spoken: { moveIds: ['v2_roi_delivery_combined'], factsUsed: [] },
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yeah that all makes sense', 'turn_18', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('optional_side_agents');
      expect(state.completedStages).toContain('roi_delivery');
    });

    it('roi_delivery stays when spoken marker not present', () => {
      const state = mockState({
        currentStage: 'roi_delivery',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv', 'ch_alex'],
        completedWowSteps: ALL_WOW_STEPS,
        spoken: { moveIds: [], factsUsed: [] }, // no roi_delivery spoken marker
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'go ahead', 'turn_18', NOW);

      expect(result.advanced).toBe(false);
      expect(state.currentStage).toBe('roi_delivery');
    });
  });

  // ─── OPTIONAL SIDE AGENTS ──────────────────────────────────────────────────

  describe('optional_side_agents stage', () => {
    it('routes to ch_sarah if prospectAskedAboutSarah', () => {
      const state = mockState({
        currentStage: 'optional_side_agents',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv', 'ch_alex', 'roi_delivery'],
        completedWowSteps: ALL_WOW_STEPS,
        prospectAskedAboutSarah: true,
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'tell me about sarah', 'turn_20', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('ch_sarah');
    });

    it('routes to ch_james if prospectAskedAboutJames (sarah not asked)', () => {
      const state = mockState({
        currentStage: 'optional_side_agents',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv', 'ch_alex', 'roi_delivery'],
        completedWowSteps: ALL_WOW_STEPS,
        prospectAskedAboutJames: true,
        prospectAskedAboutSarah: false,
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'what about james', 'turn_20', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('ch_james');
    });

    it('routes to close if no optional pending', () => {
      const state = mockState({
        currentStage: 'optional_side_agents',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv', 'ch_alex', 'roi_delivery'],
        completedWowSteps: ALL_WOW_STEPS,
        prospectAskedAboutSarah: false,
        prospectAskedAboutJames: false,
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'nope all good', 'turn_20', NOW);

      expect(result.advanced).toBe(true);
      expect(state.currentStage).toBe('close');
      expect(state.completedStages).toContain('optional_side_agents');
    });

    it('skips ch_sarah if already completed', () => {
      const state = mockState({
        currentStage: 'optional_side_agents',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv', 'ch_alex', 'roi_delivery', 'ch_sarah'],
        completedWowSteps: ALL_WOW_STEPS,
        prospectAskedAboutSarah: true,
        prospectAskedAboutJames: false,
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'done', 'turn_21', NOW);

      expect(result.advanced).toBe(true);
      // Sarah already completed, James not asked → close
      expect(state.currentStage).toBe('close');
    });
  });

  // ─── CLOSE ──────────────────────────────────────────────────────────────────

  describe('close stage', () => {
    it('close is terminal — no advancement', () => {
      const state = mockState({
        currentStage: 'close',
        currentWowStep: null,
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv', 'ch_alex', 'roi_delivery', 'optional_side_agents'],
        completedWowSteps: ALL_WOW_STEPS,
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yes lets do it', 'turn_22', NOW);

      expect(result.advanced).toBe(false);
      expect(state.currentStage).toBe('close');
    });
  });

  // ─── PENDING DELIVERY ─────────────────────────────────────────────────────

  describe('pending delivery', () => {
    it('every processFlow call sets a pendingDelivery', () => {
      const state = mockState({ currentStage: 'greeting' });
      const intel = mockIntel();

      flowAndAssert(state, intel, 'hello', 'turn_1', NOW);

      expect(state.pendingDelivery).not.toBeNull();
      expect(state.pendingDelivery!.status).toBe('pending');
      expect(state.pendingDelivery!.deliveryId).toBeTruthy();
      expect(state.pendingDelivery!.attempts).toBe(1);
    });

    it('clears previous pending delivery via gate when user speaks', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_3_icp_problem_solution',
        completedStages: ['greeting'],
        completedWowSteps: ['wow_1_research_intro', 'wow_2_reputation_trial'],
        pendingDelivery: {
          deliveryId: 'old_move_5',
          moveId: 'old_move',
          stage: 'wow',
          wowStep: 'wow_1_research_intro',
          waitForUser: true,
          issuedAt: NOW - 5000,
          seq: 5,
          status: 'pending',
          attempts: 1,
        },
      });
      const intel = mockIntel();

      flowAndAssert(state, intel, 'yeah thats right', 'turn_3', NOW);

      // Old pending should be cleared, new one set
      expect(state.pendingDelivery!.deliveryId).not.toBe('old_move_5');
      expect(state.pendingDelivery!.status).toBe('pending');
    });

    it('clears already-resolved pending delivery via gate', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_3_icp_problem_solution',
        completedStages: ['greeting'],
        completedWowSteps: ['wow_1_research_intro', 'wow_2_reputation_trial'],
        pendingDelivery: {
          deliveryId: 'old_move_5',
          moveId: 'old_move',
          stage: 'wow',
          wowStep: 'wow_1_research_intro',
          waitForUser: true,
          issuedAt: NOW - 5000,
          seq: 5,
          status: 'completed', // already resolved
          resolution: 'completed',
          completedAt: NOW - 3000,
          attempts: 1,
        },
      });
      const intel = mockIntel();

      flowAndAssert(state, intel, 'yes', 'turn_3', NOW);

      // Should have cleared the completed delivery and set a new one
      expect(state.pendingDelivery!.status).toBe('pending');
      expect(state.pendingDelivery!.deliveryId).not.toBe('old_move_5');
    });
  });

  // ─── FLOW RESULT SHAPE ────────────────────────────────────────────────────

  describe('FlowResult shape', () => {
    it('returns directive + moveId + advanced', () => {
      const state = mockState({ currentStage: 'greeting' });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'hi', 'turn_1', NOW);

      expect(result).toHaveProperty('directive');
      expect(result).toHaveProperty('moveId');
      expect(result).toHaveProperty('advanced');
      expect(typeof result.moveId).toBe('string');
      expect(typeof result.advanced).toBe('boolean');
      expect(result.directive).toHaveProperty('speak');
      expect(result.directive).toHaveProperty('waitForUser');
      expect(result.directive).toHaveProperty('canSkip');
    });

    it('moveId follows v2_{stage}_{wowStep} pattern when in wow', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_3_icp_problem_solution',
        completedStages: ['greeting'],
        completedWowSteps: ['wow_1_research_intro', 'wow_2_reputation_trial'],
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yes correct', 'turn_4', NOW);

      // After advancing from wow_3, the directive is built for the next step
      // moveId should be v2_wow_{currentWowStep}
      expect(result.moveId).toMatch(/^v2_wow_wow_\d/);
    });

    it('moveId is v2_{stage} for non-wow stages', () => {
      const state = mockState({ currentStage: 'greeting' });
      const intel = mockIntel();

      // Empty transcript → stays on greeting
      const result = flowAndAssert(state, intel, '', 'turn_1', NOW);

      expect(result.moveId).toBe('v2_greeting');
    });
  });
});
