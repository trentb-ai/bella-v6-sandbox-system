/**
 * flow-integration.test.ts — Group 5: Delivery Gate + Advancement Combined
 *
 * Integration tests that combine delivery gate resolution with stage advancement,
 * full conversation simulations, and audit trail verification.
 */

import { describe, it, expect } from 'vitest';
import { mockState, mockIntel, mockPendingDelivery, ALL_WOW_STEPS } from './helpers';
import { processFlow, resolveDeliveryCompleted, resolveDeliveryBargedIn } from '../flow';
import { assertInvariants } from './invariants';
import type { QueueItem, FlowEntry, ConversationState, FlowResult, MergedIntel } from '../types';

const NOW = Date.now();

/** Wrapper: runs processFlow then asserts all state invariants.
 *  Ages any existing pendingDelivery so the delivery gate doesn't hold
 *  (in production there's always 1-5s between turns; tests run in same ms). */
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

describe('flow-integration', () => {
  // ─── DELIVERY GATE + ADVANCEMENT ──────────────────────────────────────────

  describe('delivery gate interaction with advancement', () => {
    it('clears pending delivery (implicit user speech) then advances normally', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_3_icp_problem_solution',
        completedStages: ['greeting'],
        completedWowSteps: ['wow_1_research_intro', 'wow_2_reputation_trial'],
        pendingDelivery: mockPendingDelivery({
          stage: 'wow',
          wowStep: 'wow_3_icp_problem_solution',
          status: 'pending',
          waitForUser: true,
        }),
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yeah thats exactly right', 'turn_4', NOW);

      // Gate clears pending via implicit user speech, advancement runs
      expect(state.pendingDelivery).not.toBeNull();
      // New pending set by processFlow for the new directive
      expect(state.pendingDelivery!.stage).not.toBe('wow_3_icp_problem_solution');
      expect(state.completedWowSteps).toContain('wow_3_icp_problem_solution');
    });

    it('clears already-completed delivery then advances', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_3_icp_problem_solution',
        completedStages: ['greeting'],
        completedWowSteps: ['wow_1_research_intro', 'wow_2_reputation_trial'],
        pendingDelivery: mockPendingDelivery({
          stage: 'wow',
          status: 'completed',
          resolution: 'completed',
          completedAt: NOW - 1000,
        }),
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yes correct', 'turn_4', NOW);

      // Gate clears completed delivery, advancement continues
      expect(state.completedWowSteps).toContain('wow_3_icp_problem_solution');
    });

    it('clears barged_in delivery and still advances (gate does not block)', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_5_alignment_bridge',
        completedStages: ['greeting'],
        completedWowSteps: [
          'wow_1_research_intro',
          'wow_2_reputation_trial',
          'wow_3_icp_problem_solution',
          'wow_4_conversion_action',
        ],
        pendingDelivery: mockPendingDelivery({
          stage: 'wow',
          status: 'barged_in',
          resolution: 'barged_in_monologue_partial',
          completedAt: NOW - 500,
        }),
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'yeah so what about automation', 'turn_6', NOW);

      // Gate clears barged_in, advancement to wow_6 happens
      expect(state.completedWowSteps).toContain('wow_5_alignment_bridge');
    });

    it('event resolution + next turn gate clear is seamless', () => {
      // Simulate: event resolves delivery → next /turn gate clears it → advances
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_3_icp_problem_solution',
        completedStages: ['greeting'],
        completedWowSteps: ['wow_1_research_intro', 'wow_2_reputation_trial'],
        flowSeq: 10,
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_10',
          moveId: 'move',
          stage: 'wow',
          wowStep: 'wow_3_icp_problem_solution',
          status: 'pending',
        }),
      });

      // Step 1: Event resolves delivery
      const resolved = resolveDeliveryCompleted(state, 'move_10', 'move');
      expect(resolved).toBe(true);
      expect(state.pendingDelivery!.status).toBe('completed');

      // Step 2: Next /turn — gate clears completed delivery, advancement runs
      const intel = mockIntel();
      const result = flowAndAssert(state, intel, 'yes', 'turn_5', NOW);

      // Gate should have cleared the delivery, new pending set
      expect(state.pendingDelivery!.deliveryId).not.toBe('move_10');
      expect(state.completedWowSteps).toContain('wow_3_icp_problem_solution');
    });
  });

  // ─── FULL CONVERSATION SIMULATION ─────────────────────────────────────────

  describe('full conversation simulation', () => {
    it('greeting → wow (with chain-skip) → recommendation → anchor → alex → roi → close', () => {
      const state = mockState();
      const intel = mockIntel(); // empty deep → wow_2 will chain-skip

      // Turn 1: Greeting → wow
      flowAndAssert(state, intel, 'Hey there', 'turn_1', NOW);
      expect(state.currentStage).toBe('wow');
      expect(state.currentWowStep).toBe('wow_1_research_intro');

      // Turn 2: wow_1 → wow_2 (chain-skip) → wow_3
      flowAndAssert(state, intel, 'yeah sounds great', 'turn_2', NOW);
      expect(state.completedWowSteps).toContain('wow_1_research_intro');
      expect(state.completedWowSteps).toContain('wow_2_reputation_trial'); // chain-skipped
      expect(state.currentWowStep).toBe('wow_3_icp_problem_solution');

      // Turn 3: wow_3 → wow_4
      flowAndAssert(state, intel, 'yes thats correct', 'turn_3', NOW);
      expect(state.completedWowSteps).toContain('wow_3_icp_problem_solution');
      expect(state.currentWowStep).toBe('wow_4_conversion_action');

      // Turn 4: wow_4 → wow_5
      flowAndAssert(state, intel, 'yep we do that', 'turn_4', NOW);
      expect(state.completedWowSteps).toContain('wow_4_conversion_action');
      expect(state.currentWowStep).toBe('wow_5_alignment_bridge');

      // Turn 5: wow_5 → wow_6 (non-skippable, generic observation)
      flowAndAssert(state, intel, 'makes sense', 'turn_5', NOW);
      expect(state.completedWowSteps).toContain('wow_5_alignment_bridge');
      expect(state.currentWowStep).toBe('wow_6_scraped_observation');

      // Turn 6: wow_6 → wow_7
      flowAndAssert(state, intel, 'interesting', 'turn_6', NOW);
      expect(state.completedWowSteps).toContain('wow_6_scraped_observation');
      expect(state.currentWowStep).toBe('wow_7_explore_or_recommend');

      // Turn 7: wow_7 → wow_8
      flowAndAssert(state, intel, 'recommend for me', 'turn_7', NOW);
      expect(state.completedWowSteps).toContain('wow_7_explore_or_recommend');
      expect(state.currentWowStep).toBe('wow_8_source_check');

      // Turn 8: wow_8 → recommendation
      flowAndAssert(state, intel, 'mostly from the website and some ads', 'turn_8', NOW);
      expect(state.currentStage).toBe('recommendation');
      expect(state.completedStages).toContain('wow');

      // Set up routing data (as if extracted from transcript)
      state.leadSourceDominant = 'ads';
      state.adsConfirmed = true;
      state.alexEligible = true;

      // Turn 9: recommendation → anchor_acv
      flowAndAssert(state, intel, 'sounds good lets go', 'turn_9', NOW);
      expect(state.currentStage).toBe('anchor_acv');
      expect(state.completedStages).toContain('recommendation');
      expect(state.currentQueue.length).toBeGreaterThan(0);

      // Set ACV
      state.acv = 5000;

      // Turn 10: anchor_acv → ch_alex
      flowAndAssert(state, intel, 'about five thousand', 'turn_10', NOW);
      expect(state.currentStage).toBe('ch_alex');
      expect(state.completedStages).toContain('anchor_acv');

      // Set Alex data (as if extracted)
      state.inboundLeads = 50;
      state.inboundConversions = 5;
      state.responseSpeedBand = 'next_day_plus';
      state.spoken.moveIds.push('v2_ch_alex');
      // Sprint 1A: synthesis delivery must also be confirmed before advancement
      state.spoken.moveIds.push('v2_ch_alex_synthesis');

      // Turn 11: ch_alex → roi_delivery (force advance with data)
      flowAndAssert(state, intel, 'yeah makes sense', 'turn_11', NOW);
      expect(state.currentStage).toBe('roi_delivery');
      expect(state.completedStages).toContain('ch_alex');
      expect(state.calculatorResults.alex).toBeDefined();

      // Add ROI spoken marker
      state.spoken.moveIds.push('v2_roi_delivery_combined');

      // Turn 12: roi_delivery → optional_side_agents → close
      flowAndAssert(state, intel, 'yes that all tracks', 'turn_12', NOW);
      expect(state.currentStage).toBe('optional_side_agents');

      // optional_side_agents → close (no sarah/james asked)
      flowAndAssert(state, intel, 'nope im good', 'turn_13', NOW);
      expect(state.currentStage).toBe('close');
      expect(state.completedStages).toContain('optional_side_agents');

      // ── Verify audit trail ──
      expect(state.flowLog.length).toBeGreaterThan(0);

      // Check that we have stage_advanced entries for each major transition
      const stageAdvances = state.flowLog.filter((e: FlowEntry) => e.action === 'stage_advanced');
      expect(stageAdvances.length).toBeGreaterThanOrEqual(5); // greeting→wow, wow→rec, rec→anchor, anchor→alex, alex→roi, roi→optional, optional→close

      // Check directive_issued entries exist
      const directives = state.flowLog.filter((e: FlowEntry) => e.action === 'directive_issued');
      expect(directives.length).toBeGreaterThan(0);

      // Verify completedStages array
      expect(state.completedStages).toContain('greeting');
      expect(state.completedStages).toContain('wow');
      expect(state.completedStages).toContain('recommendation');
      expect(state.completedStages).toContain('anchor_acv');
      expect(state.completedStages).toContain('ch_alex');
      expect(state.completedStages).toContain('roi_delivery');
      expect(state.completedStages).toContain('optional_side_agents');

      // Verify no gaps: flowSeq should be monotonically increasing
      for (let i = 1; i < state.flowLog.length; i++) {
        expect(state.flowLog[i].seq).toBeGreaterThan(state.flowLog[i - 1].seq);
      }
    });
  });

  // ─── SPARSE DATA SIMULATION ───────────────────────────────────────────────

  describe('sparse data simulation', () => {
    it('wow_2 skipped (no rating) via chain-skip after wow_1', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_1_research_intro',
        completedStages: ['greeting'],
      });
      const intel = mockIntel(); // no deep data → wow_2 canSkip

      flowAndAssert(state, intel, 'yeah', 'turn_2', NOW);

      expect(state.completedWowSteps).toContain('wow_2_reputation_trial');
      const skipEntries = state.flowLog.filter(
        (e: FlowEntry) => e.action === 'step_skipped' && e.wowStep === 'wow_2_reputation_trial',
      );
      expect(skipEntries.length).toBe(1);
    });
  });

  // ─── BUDGET EXHAUSTION ────────────────────────────────────────────────────

  describe('budget exhaustion', () => {
    it('ch_alex budget_exhausted after maxQuestions with no data → advances', () => {
      const queue: QueueItem[] = [
        { stage: 'ch_alex', agent: 'alex', priority: 1, why: 'test' },
      ];
      const state = mockState({
        currentStage: 'ch_alex',
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv'],
        currentWowStep: null,
        completedWowSteps: ALL_WOW_STEPS,
        questionCounts: { ch_alex: 3, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
        currentQueue: queue,
        alexEligible: true,
        topAgents: ['alex'],
        // No Alex data fields → shouldForceAdvance=false, but maxQuestionsReached=true
      });
      const intel = mockIntel();

      const result = flowAndAssert(state, intel, 'I really dont know the numbers', 'turn_15', NOW);

      expect(result.advanced).toBe(true);
      expect(state.completedStages).toContain('ch_alex');
      expect(state.calculatorResults.alex).toBeUndefined();

      // Verify audit entry for advancement
      const advanceEntries = state.flowLog.filter(
        (e: FlowEntry) => e.action === 'stage_advanced' && e.stage === 'ch_alex',
      );
      expect(advanceEntries.length).toBe(1);
      expect(advanceEntries[0].detail).toContain('budgetDone=true');
    });

    it('multi-channel budget exhaustion walks through queue', () => {
      const queue: QueueItem[] = [
        { stage: 'ch_alex', agent: 'alex', priority: 1, why: 'test' },
        { stage: 'ch_chris', agent: 'chris', priority: 2, why: 'test' },
      ];
      const state = mockState({
        currentStage: 'ch_alex',
        completedStages: ['greeting', 'wow', 'recommendation', 'anchor_acv'],
        currentWowStep: null,
        completedWowSteps: ALL_WOW_STEPS,
        questionCounts: { ch_alex: 3, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
        currentQueue: queue,
        alexEligible: true,
        chrisEligible: true,
        topAgents: ['alex', 'chris'],
      });
      const intel = mockIntel();

      // Turn 1: Alex budget exhausted → advances to Chris
      const r1 = flowAndAssert(state, intel, 'no idea', 'turn_15', NOW);
      expect(r1.advanced).toBe(true);
      expect(state.currentStage).toBe('ch_chris');

      // Set Chris budget exhausted too
      state.questionCounts.ch_chris = 2;

      // Turn 2: Chris budget exhausted → advances to roi_delivery
      const r2 = flowAndAssert(state, intel, 'still no idea', 'turn_16', NOW);
      expect(r2.advanced).toBe(true);
      expect(state.currentStage).toBe('roi_delivery');
    });
  });

  // ─── AUDIT TRAIL COMPLETENESS ─────────────────────────────────────────────

  describe('audit trail', () => {
    it('flowLog seq values are strictly monotonic', () => {
      const state = mockState();
      const intel = mockIntel();

      flowAndAssert(state, intel, 'hello', 'turn_1', NOW);
      flowAndAssert(state, intel, 'yes', 'turn_2', NOW);
      flowAndAssert(state, intel, 'sounds good', 'turn_3', NOW);

      for (let i = 1; i < state.flowLog.length; i++) {
        expect(state.flowLog[i].seq).toBeGreaterThan(state.flowLog[i - 1].seq);
      }
    });

    it('every stage transition produces a stage_advanced audit entry', () => {
      const state = mockState();
      const intel = mockIntel();

      // greeting → wow
      flowAndAssert(state, intel, 'hi', 'turn_1', NOW);

      const advances = state.flowLog.filter((e: FlowEntry) => e.action === 'stage_advanced');
      expect(advances.length).toBeGreaterThan(0);
      expect(advances[0].stage).toBe('greeting'); // fromStage
    });

    it('chain-skip produces step_skipped audit entries', () => {
      const state = mockState({
        currentStage: 'wow',
        currentWowStep: 'wow_1_research_intro',
        completedStages: ['greeting'],
      });
      const intel = mockIntel(); // wow_2 will chain-skip

      flowAndAssert(state, intel, 'ok sure', 'turn_2', NOW);

      const skips = state.flowLog.filter((e: FlowEntry) => e.action === 'step_skipped');
      expect(skips.length).toBeGreaterThan(0);
      expect(skips.some((e: FlowEntry) => e.wowStep === 'wow_2_reputation_trial')).toBe(true);
    });
  });
});
