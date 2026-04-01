/**
 * flow-delivery.test.ts — Group 3: Delivery Resolution Functions
 *
 * Tests the exported resolution functions from flow.ts:
 * - resolveDeliveryCompleted
 * - resolveDeliveryBargedIn
 * - resolveDeliveryFailed
 * - resolveDeliveryTimeout
 *
 * NOTE: canAdvanceAfterDelivery / resolveDeliveryGate are internal to processFlow
 * and tested indirectly via Group 4 (flow-process) and Group 5 (flow-integration).
 */

import { describe, it, expect } from 'vitest';
import { mockState, mockPendingDelivery } from './helpers';
import {
  resolveDeliveryCompleted,
  resolveDeliveryBargedIn,
  resolveDeliveryFailed,
  resolveDeliveryTimeout,
} from '../flow';
import { MAX_DELIVERY_ATTEMPTS, MAX_CONSECUTIVE_TIMEOUTS } from '../flow-constants';

describe('flow-delivery', () => {
  // ─── resolveDeliveryCompleted ───────────────────────────────────────────────

  describe('resolveDeliveryCompleted', () => {
    it('succeeds with matching deliveryId — status=completed, resets consecutiveTimeouts', () => {
      const state = mockState({
        consecutiveTimeouts: 2,
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_5',
          moveId: 'move',
          status: 'pending',
        }),
      });

      const result = resolveDeliveryCompleted(state, 'move_5', 'move');

      expect(result).toBe(true);
      expect(state.pendingDelivery!.status).toBe('completed');
      expect(state.pendingDelivery!.resolution).toBe('completed');
      expect(state.pendingDelivery!.completedAt).toBeGreaterThan(0);
      expect(state.consecutiveTimeouts).toBe(0);
    });

    it('returns false with mismatched deliveryId (stale event)', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({ deliveryId: 'move_5' }),
      });
      const initialLogLen = state.flowLog.length;

      const result = resolveDeliveryCompleted(state, 'wrong_id', 'move');

      expect(result).toBe(false);
      expect(state.pendingDelivery!.status).toBe('pending'); // unchanged
      // Should have appended a stale_event audit
      expect(state.flowLog.length).toBeGreaterThan(initialLogLen);
      expect(state.flowLog[state.flowLog.length - 1].action).toBe('stale_event');
    });

    it('returns false when no pending delivery', () => {
      const state = mockState({ pendingDelivery: null });

      const result = resolveDeliveryCompleted(state, 'any_id', 'any_move');

      expect(result).toBe(false);
    });

    it('returns false when moveId mismatches (correlation check)', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_5',
          moveId: 'move',
        }),
      });

      const result = resolveDeliveryCompleted(state, 'move_5', 'wrong_move');

      expect(result).toBe(false);
      expect(state.pendingDelivery!.status).toBe('pending');
    });

    it('returns false when status already != pending (first-valid-event-wins)', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_5',
          moveId: 'move',
          status: 'barged_in', // already resolved
        }),
      });

      const result = resolveDeliveryCompleted(state, 'move_5', 'move');

      expect(result).toBe(false);
      expect(state.pendingDelivery!.status).toBe('barged_in'); // unchanged
    });
  });

  // ─── resolveDeliveryBargedIn ────────────────────────────────────────────────

  describe('resolveDeliveryBargedIn', () => {
    it('succeeds with matching deliveryId — status=barged_in, resets timeouts', () => {
      const state = mockState({
        consecutiveTimeouts: 1,
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_5',
          moveId: 'move',
          waitForUser: true,
        }),
      });

      const result = resolveDeliveryBargedIn(state, 'move_5', 'move');

      expect(result).toBe(true);
      expect(state.pendingDelivery!.status).toBe('barged_in');
      expect(state.pendingDelivery!.resolution).toBe('barged_in_question_implicit_success');
      expect(state.consecutiveTimeouts).toBe(0);
    });

    it('sets monologue resolution when waitForUser=false', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_5',
          moveId: 'move',
          waitForUser: false,
        }),
      });

      const result = resolveDeliveryBargedIn(state, 'move_5', 'move');

      expect(result).toBe(true);
      expect(state.pendingDelivery!.resolution).toBe('barged_in_monologue_partial');
    });

    it('returns false with mismatched deliveryId', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({ deliveryId: 'move_5' }),
      });

      const result = resolveDeliveryBargedIn(state, 'wrong_id', 'move');

      expect(result).toBe(false);
      expect(state.pendingDelivery!.status).toBe('pending');
    });

    it('returns false when already resolved (first-valid-event-wins)', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_5',
          moveId: 'move',
          status: 'completed',
        }),
      });

      const result = resolveDeliveryBargedIn(state, 'move_5', 'move');

      expect(result).toBe(false);
    });
  });

  // ─── resolveDeliveryFailed ─────────────────────────────────────────────────

  describe('resolveDeliveryFailed', () => {
    it('succeeds with matching deliveryId — status=failed, records errorCode', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_5',
          moveId: 'move',
        }),
      });

      const result = resolveDeliveryFailed(state, 'move_5', 'move', 'GEMINI_500');

      expect(result).toBe(true);
      expect(state.pendingDelivery!.status).toBe('failed');
      expect(state.pendingDelivery!.resolution).toBe('failed_error=GEMINI_500');
      expect(state.pendingDelivery!.completedAt).toBeGreaterThan(0);
    });

    it('uses "unknown" when errorCode is omitted', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_5',
          moveId: 'move',
        }),
      });

      const result = resolveDeliveryFailed(state, 'move_5', 'move');

      expect(result).toBe(true);
      expect(state.pendingDelivery!.resolution).toBe('failed_error=unknown');
    });

    it('returns false when already resolved', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          deliveryId: 'move_5',
          moveId: 'move',
          status: 'completed',
        }),
      });

      const result = resolveDeliveryFailed(state, 'move_5', 'move', 'ERR');

      expect(result).toBe(false);
    });

    it('returns false with mismatched deliveryId', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({ deliveryId: 'move_5' }),
      });

      const result = resolveDeliveryFailed(state, 'wrong_id', 'move');

      expect(result).toBe(false);
    });
  });

  // ─── resolveDeliveryTimeout ────────────────────────────────────────────────

  describe('resolveDeliveryTimeout', () => {
    it('reissues when pending + attempts < MAX — increments attempts, returns reissue:true', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          attempts: 1, // < MAX_DELIVERY_ATTEMPTS (3)
          status: 'pending',
          issuedAt: Date.now() - 20_000,
        }),
        consecutiveTimeouts: 0,
      });

      const result = resolveDeliveryTimeout(state);

      expect(result.reissue).toBe(true);
      expect(result.degraded).toBe(false);
      expect(state.pendingDelivery!.attempts).toBe(2);
      expect(state.pendingDelivery!.status).toBe('pending'); // stays pending for reissue
      expect(state.consecutiveTimeouts).toBe(1);
    });

    it('marks failed when attempts exhausted — returns reissue:false', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          attempts: MAX_DELIVERY_ATTEMPTS, // at max, cannot reissue
          status: 'pending',
        }),
        consecutiveTimeouts: 0,
      });

      const result = resolveDeliveryTimeout(state);

      expect(result.reissue).toBe(false);
      expect(state.pendingDelivery!.status).toBe('failed');
      expect(state.pendingDelivery!.resolution).toBe('timed_out');
      expect(state.pendingDelivery!.completedAt).toBeGreaterThan(0);
      expect(state.consecutiveTimeouts).toBe(1);
    });

    it('returns no-op when no pending delivery (idempotent alarm guard)', () => {
      const state = mockState({ pendingDelivery: null });

      const result = resolveDeliveryTimeout(state);

      expect(result.reissue).toBe(false);
      expect(result.degraded).toBe(false);
    });

    it('returns no-op when already resolved (idempotent alarm guard)', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({ status: 'completed' }),
      });

      const result = resolveDeliveryTimeout(state);

      expect(result.reissue).toBe(false);
      expect(result.degraded).toBe(false);
    });

    it('triggers degraded when consecutiveTimeouts reaches threshold', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          attempts: 1,
          status: 'pending',
        }),
        consecutiveTimeouts: MAX_CONSECUTIVE_TIMEOUTS - 1, // will reach threshold after increment
      });

      const result = resolveDeliveryTimeout(state);

      expect(result.reissue).toBe(true);
      expect(result.degraded).toBe(true);
      expect(state.consecutiveTimeouts).toBe(MAX_CONSECUTIVE_TIMEOUTS);
    });

    it('triggers degraded on exhausted attempts at threshold', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          attempts: MAX_DELIVERY_ATTEMPTS,
          status: 'pending',
        }),
        consecutiveTimeouts: MAX_CONSECUTIVE_TIMEOUTS - 1,
      });

      const result = resolveDeliveryTimeout(state);

      expect(result.reissue).toBe(false);
      expect(result.degraded).toBe(true);
      expect(state.pendingDelivery!.status).toBe('failed');
      expect(state.pendingDelivery!.resolution).toBe('timed_out');
    });

    it('does NOT trigger degraded when below threshold', () => {
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          attempts: MAX_DELIVERY_ATTEMPTS,
          status: 'pending',
        }),
        consecutiveTimeouts: 0, // well below threshold
      });

      const result = resolveDeliveryTimeout(state);

      expect(result.degraded).toBe(false);
    });

    it('resets issuedAt on reissue (for next timeout window)', () => {
      const oldIssuedAt = Date.now() - 30_000;
      const state = mockState({
        pendingDelivery: mockPendingDelivery({
          attempts: 1,
          status: 'pending',
          issuedAt: oldIssuedAt,
        }),
      });

      resolveDeliveryTimeout(state);

      expect(state.pendingDelivery!.issuedAt).toBeGreaterThan(oldIssuedAt);
    });
  });
});
