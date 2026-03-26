/**
 * flow-audit.test.ts — Group 2: Audit Trail
 */

import { describe, it, expect } from 'vitest';
import { mockState } from './helpers';
import {
  appendAudit,
  auditDirectiveIssued,
  auditDeliveryResolved,
  auditStageAdvanced,
  auditStepSkipped,
  auditStaleEvent,
  auditCallDegraded,
} from '../flow-audit';
import { FLOW_LOG_CAP } from '../flow-constants';

describe('flow-audit', () => {
  describe('appendAudit', () => {
    it('adds entry with monotonically increasing seq', () => {
      const state = mockState();
      const e1 = appendAudit(state, 'directive_issued', 'greeting');
      const e2 = appendAudit(state, 'delivery_resolved', 'greeting');
      const e3 = appendAudit(state, 'stage_advanced', 'wow');

      expect(e1.seq).toBe(0);
      expect(e2.seq).toBe(1);
      expect(e3.seq).toBe(2);
      expect(state.flowSeq).toBe(3);
      expect(state.flowLog).toHaveLength(3);
    });

    it('enforces FIFO cap at FLOW_LOG_CAP', () => {
      const state = mockState();
      // Add more entries than the cap
      const total = FLOW_LOG_CAP + 50;
      for (let i = 0; i < total; i++) {
        appendAudit(state, 'directive_issued', 'greeting', null, `entry_${i}`);
      }

      expect(state.flowLog).toHaveLength(FLOW_LOG_CAP);
      // First entry should be the 51st (0-indexed: entry_50)
      expect(state.flowLog[0].detail).toBe('entry_50');
      // Last entry should be the most recent
      expect(state.flowLog[FLOW_LOG_CAP - 1].detail).toBe(`entry_${total - 1}`);
    });

    it('creates entry with correct shape', () => {
      const state = mockState();
      const entry = appendAudit(state, 'directive_issued', 'wow', 'wow_2_reputation_trial', 'test detail');

      expect(entry.seq).toBe(0);
      expect(entry.action).toBe('directive_issued');
      expect(entry.stage).toBe('wow');
      expect(entry.wowStep).toBe('wow_2_reputation_trial');
      expect(entry.detail).toBe('test detail');
      expect(typeof entry.ts).toBe('string');
      // ts should be ISO format
      expect(new Date(entry.ts).toISOString()).toBe(entry.ts);
    });

    it('sets wowStep to undefined when null is passed', () => {
      const state = mockState();
      const entry = appendAudit(state, 'directive_issued', 'greeting', null);
      expect(entry.wowStep).toBeUndefined();
    });

    it('sets wowStep to undefined when omitted', () => {
      const state = mockState();
      const entry = appendAudit(state, 'directive_issued', 'greeting');
      expect(entry.wowStep).toBeUndefined();
    });
  });

  describe('auditDirectiveIssued', () => {
    it('creates entry with action=directive_issued', () => {
      const state = mockState();
      const entry = auditDirectiveIssued(state, 'wow', 'wow_1_research_intro', 'moveId=v2_wow_wow_1');

      expect(entry.action).toBe('directive_issued');
      expect(entry.stage).toBe('wow');
      expect(entry.wowStep).toBe('wow_1_research_intro');
      expect(entry.detail).toBe('moveId=v2_wow_wow_1');
    });
  });

  describe('auditDeliveryResolved', () => {
    it('creates entry with action=delivery_resolved', () => {
      const state = mockState();
      const entry = auditDeliveryResolved(state, 'greeting', null, 'implicit_user_spoke');

      expect(entry.action).toBe('delivery_resolved');
      expect(entry.stage).toBe('greeting');
      expect(entry.detail).toBe('implicit_user_spoke');
    });
  });

  describe('auditStageAdvanced', () => {
    it('records fromStage as stage and includes detail with toStage', () => {
      const state = mockState();
      const entry = auditStageAdvanced(state, 'greeting', 'wow', 'custom reason');

      expect(entry.action).toBe('stage_advanced');
      expect(entry.stage).toBe('greeting'); // fromStage
      expect(entry.detail).toBe('custom reason');
    });

    it('auto-generates detail when not provided', () => {
      const state = mockState();
      const entry = auditStageAdvanced(state, 'greeting', 'wow');

      expect(entry.detail).toBe('→ wow');
    });
  });

  describe('auditStepSkipped', () => {
    it('creates entry with action=step_skipped and wowStep', () => {
      const state = mockState();
      const entry = auditStepSkipped(state, 'wow', 'wow_2_reputation_trial', 'no_rating');

      expect(entry.action).toBe('step_skipped');
      expect(entry.stage).toBe('wow');
      expect(entry.wowStep).toBe('wow_2_reputation_trial');
      expect(entry.detail).toBe('no_rating');
    });
  });

  describe('auditStaleEvent', () => {
    it('creates entry with action=stale_event and correlation detail', () => {
      const state = mockState();
      const entry = auditStaleEvent(state, 'wow', 'deliveryId=abc expected=xyz');

      expect(entry.action).toBe('stale_event');
      expect(entry.stage).toBe('wow');
      expect(entry.detail).toContain('deliveryId=abc');
      expect(entry.detail).toContain('expected=xyz');
    });
  });

  describe('auditCallDegraded', () => {
    it('creates entry with action=call_degraded and timeout count', () => {
      const state = mockState();
      const entry = auditCallDegraded(state, 'greeting', '3 consecutive timeouts');

      expect(entry.action).toBe('call_degraded');
      expect(entry.stage).toBe('greeting');
      expect(entry.detail).toContain('3 consecutive timeouts');
    });
  });

  describe('all entries have required fields', () => {
    it('every entry has seq, action, stage, ts', () => {
      const state = mockState();
      auditDirectiveIssued(state, 'greeting');
      auditDeliveryResolved(state, 'wow', 'wow_1_research_intro');
      auditStageAdvanced(state, 'greeting', 'wow');
      auditStepSkipped(state, 'wow', 'wow_2_reputation_trial', 'skip');
      auditStaleEvent(state, 'wow', 'stale');
      auditCallDegraded(state, 'greeting', 'degraded');

      for (const entry of state.flowLog) {
        expect(typeof entry.seq).toBe('number');
        expect(typeof entry.action).toBe('string');
        expect(typeof entry.stage).toBe('string');
        expect(typeof entry.ts).toBe('string');
      }
    });
  });
});
