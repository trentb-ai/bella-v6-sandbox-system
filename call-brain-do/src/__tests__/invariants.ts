/**
 * invariants.ts — State Invariant Validator
 *
 * Structural rules that must ALWAYS hold after any processFlow() call,
 * regardless of path. Called after every processFlow() in every test.
 * If any invariant fails, the test fails with a descriptive message.
 *
 * This catches bugs that happy-path assertions miss — like stale fields,
 * impossible state combinations, and ordering violations.
 */

import { expect } from 'vitest';
import type { ConversationState, FlowEntry, StageId, WowStepId } from '../types';
import { WOW_STEP_ORDER } from '../flow-constants';

const STAGE_ORDER: StageId[] = [
  'greeting',
  'wow',
  'recommendation',
  'anchor_acv',
  'ch_alex',
  'ch_chris',
  'ch_maddie',
  'ch_sarah',
  'ch_james',
  'roi_delivery',
  'optional_side_agents',
  'close',
];

const CHANNEL_STAGES: StageId[] = ['ch_alex', 'ch_chris', 'ch_maddie', 'ch_sarah', 'ch_james'];

/**
 * Assert all structural invariants on a ConversationState.
 * Call this after every processFlow() in every test.
 */
export function assertInvariants(state: ConversationState, context?: string): void {
  const ctx = context ? ` [${context}]` : '';

  // ── INV-1: currentWowStep must be null when currentStage !== 'wow' ──
  // The bug that killed the Pitcher call. If wow is done, wowStep must be cleared.
  if (state.currentStage !== 'wow') {
    expect(
      state.currentWowStep,
      `INV-1${ctx}: currentWowStep must be null when stage=${state.currentStage}`,
    ).toBeNull();
  }

  // ── INV-2: currentWowStep must be a valid WowStepId when in wow stage ──
  if (state.currentStage === 'wow' && state.currentWowStep != null) {
    expect(
      WOW_STEP_ORDER,
      `INV-2${ctx}: currentWowStep=${state.currentWowStep} is not a valid WowStepId`,
    ).toContain(state.currentWowStep);
  }

  // ── INV-3: completedWowSteps must be a subset of WOW_STEP_ORDER ──
  for (const step of state.completedWowSteps) {
    expect(
      WOW_STEP_ORDER,
      `INV-3${ctx}: completedWowSteps contains invalid step: ${step}`,
    ).toContain(step);
  }

  // ── INV-4: no duplicates in completedWowSteps ──
  const uniqueWow = new Set(state.completedWowSteps);
  expect(
    uniqueWow.size,
    `INV-4${ctx}: completedWowSteps has duplicates: ${JSON.stringify(state.completedWowSteps)}`,
  ).toBe(state.completedWowSteps.length);

  // ── INV-5: no duplicates in completedStages ──
  const uniqueStages = new Set(state.completedStages);
  expect(
    uniqueStages.size,
    `INV-5${ctx}: completedStages has duplicates: ${JSON.stringify(state.completedStages)}`,
  ).toBe(state.completedStages.length);

  // ── INV-6: currentStage must not be in completedStages ──
  expect(
    state.completedStages,
    `INV-6${ctx}: currentStage=${state.currentStage} is already in completedStages`,
  ).not.toContain(state.currentStage);

  // ── INV-7: completedStages ordering must follow STAGE_ORDER ──
  // Exception: ch_sarah and ch_james are optional agents reached via optional_side_agents
  // AFTER roi_delivery, so they can appear out of linear order.
  const OPTIONAL_STAGES: StageId[] = ['ch_sarah', 'ch_james'];
  const nonOptionalCompleted = state.completedStages.filter((s) => !OPTIONAL_STAGES.includes(s));
  for (let i = 1; i < nonOptionalCompleted.length; i++) {
    const prevIdx = STAGE_ORDER.indexOf(nonOptionalCompleted[i - 1]);
    const currIdx = STAGE_ORDER.indexOf(nonOptionalCompleted[i]);
    expect(
      currIdx,
      `INV-7${ctx}: completedStages out of order: ${nonOptionalCompleted[i - 1]} (${prevIdx}) before ${nonOptionalCompleted[i]} (${currIdx})`,
    ).toBeGreaterThan(prevIdx);
  }

  // ── INV-8: if wow is in completedStages, all 8 wow steps must be completed ──
  // (they can be chain-skipped, but they must be in completedWowSteps)
  if (state.completedStages.includes('wow')) {
    for (const step of WOW_STEP_ORDER) {
      expect(
        state.completedWowSteps,
        `INV-8${ctx}: wow is completed but ${step} is missing from completedWowSteps`,
      ).toContain(step);
    }
  }

  // ── INV-9: currentWowStep must not be in completedWowSteps ──
  if (state.currentWowStep) {
    expect(
      state.completedWowSteps,
      `INV-9${ctx}: currentWowStep=${state.currentWowStep} is already in completedWowSteps`,
    ).not.toContain(state.currentWowStep);
  }

  // ── INV-10: completedWowSteps ordering must follow WOW_STEP_ORDER ──
  for (let i = 1; i < state.completedWowSteps.length; i++) {
    const prevIdx = WOW_STEP_ORDER.indexOf(state.completedWowSteps[i - 1]);
    const currIdx = WOW_STEP_ORDER.indexOf(state.completedWowSteps[i]);
    expect(
      currIdx,
      `INV-10${ctx}: completedWowSteps out of order: ${state.completedWowSteps[i - 1]} before ${state.completedWowSteps[i]}`,
    ).toBeGreaterThan(prevIdx);
  }

  // ── INV-11: flowLog seq values must be strictly monotonic ──
  for (let i = 1; i < state.flowLog.length; i++) {
    expect(
      state.flowLog[i].seq,
      `INV-11${ctx}: flowLog seq not monotonic at index ${i}: ${state.flowLog[i - 1].seq} → ${state.flowLog[i].seq}`,
    ).toBeGreaterThan(state.flowLog[i - 1].seq);
  }

  // ── INV-12: flowSeq must be >= flowLog length (seq counter never behind log) ──
  expect(
    state.flowSeq,
    `INV-12${ctx}: flowSeq (${state.flowSeq}) < flowLog.length (${state.flowLog.length})`,
  ).toBeGreaterThanOrEqual(state.flowLog.length);

  // ── INV-13: pendingDelivery.stage must match currentStage ──
  if (state.pendingDelivery && state.pendingDelivery.status === 'pending') {
    expect(
      state.pendingDelivery.stage,
      `INV-13${ctx}: pendingDelivery.stage=${state.pendingDelivery.stage} but currentStage=${state.currentStage}`,
    ).toBe(state.currentStage);
  }

  // ── INV-14: pendingDelivery.wowStep must match currentWowStep ──
  if (state.pendingDelivery && state.pendingDelivery.status === 'pending') {
    const expectedWow = state.currentWowStep ?? null;
    const actualWow = state.pendingDelivery.wowStep ?? null;
    expect(
      actualWow,
      `INV-14${ctx}: pendingDelivery.wowStep=${actualWow} but currentWowStep=${expectedWow}`,
    ).toBe(expectedWow);
  }

  // ── INV-15: moveId in pendingDelivery must not contain wowStep suffix when stage !== wow ──
  if (state.pendingDelivery && state.currentStage !== 'wow') {
    const moveId = state.pendingDelivery.moveId;
    for (const step of WOW_STEP_ORDER) {
      expect(
        moveId.includes(step),
        `INV-15${ctx}: moveId "${moveId}" contains stale wowStep "${step}" but stage=${state.currentStage}`,
      ).toBe(false);
    }
  }

  // ── INV-16: spoken.moveIds entries for non-wow stages must not contain wowStep suffixes ──
  for (const mid of state.spoken.moveIds) {
    // Parse: v2_{stage} or v2_wow_{wowStep}
    if (mid.startsWith('v2_wow_')) continue; // wow moveIds legitimately have step suffix
    // Non-wow moveId should not contain any wowStep
    for (const step of WOW_STEP_ORDER) {
      expect(
        mid.includes(step),
        `INV-16${ctx}: spoken.moveId "${mid}" contains stale wowStep "${step}"`,
      ).toBe(false);
    }
  }

  // ── INV-17: consecutiveTimeouts must be non-negative ──
  expect(
    state.consecutiveTimeouts,
    `INV-17${ctx}: consecutiveTimeouts is negative: ${state.consecutiveTimeouts}`,
  ).toBeGreaterThanOrEqual(0);

  // ── INV-18: questionCounts must be non-negative for all channels ──
  for (const [ch, count] of Object.entries(state.questionCounts)) {
    expect(
      count,
      `INV-18${ctx}: questionCounts.${ch} is negative: ${count}`,
    ).toBeGreaterThanOrEqual(0);
  }

  // ── INV-19: calculatorResults keys must be for completed channel stages ──
  for (const agent of Object.keys(state.calculatorResults)) {
    const chStage = `ch_${agent}` as StageId;
    expect(
      state.completedStages.includes(chStage) || state.currentStage === chStage,
      `INV-19${ctx}: calculatorResults has "${agent}" but ch_${agent} is not completed or current`,
    ).toBe(true);
  }

  // ── INV-20: if currentStage is a channel, it must be in currentQueue or already completed ──
  if (CHANNEL_STAGES.includes(state.currentStage) && !['ch_sarah', 'ch_james'].includes(state.currentStage)) {
    const inQueue = state.currentQueue.some((q) => q.stage === state.currentStage);
    expect(
      inQueue || state.completedStages.includes(state.currentStage),
      `INV-20${ctx}: currentStage=${state.currentStage} is not in currentQueue and not completed`,
    ).toBe(true);
  }
}
