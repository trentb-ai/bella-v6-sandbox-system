import { initState, GENERIC_INDUSTRY_PACK } from '../state';
import type { ConversationState, MergedIntel, PendingDelivery, WowStepId } from '../types';
import { WOW_STEP_ORDER } from '../flow-constants';

/** All 8 wow steps — use in test fixtures where wow is already completed. */
export const ALL_WOW_STEPS: WowStepId[] = [...WOW_STEP_ORDER];

export function mockState(overrides?: Partial<ConversationState>): ConversationState {
  return { ...initState('test-call', 'test-lead'), ...overrides };
}

export function mockIntel(overrides?: Partial<MergedIntel>): MergedIntel {
  return {
    fast: {},
    consultant: {},
    deep: {},
    ...overrides,
  };
}

export function mockPendingDelivery(overrides?: Partial<PendingDelivery>): PendingDelivery {
  return {
    deliveryId: 'test_move_0',
    moveId: 'test_move',
    stage: 'greeting',
    wowStep: null,
    waitForUser: false,
    issuedAt: Date.now() - 5000, // 5s ago — past DELIVERY_MIN_WINDOW_MS so gate doesn't hold
    seq: 0,
    status: 'pending',
    attempts: 1,
    ...overrides,
  };
}

export { GENERIC_INDUSTRY_PACK };
