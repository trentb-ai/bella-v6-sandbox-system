/**
 * brain-v3 Chunk 8 Assertions
 * C8-01 through C8-15 — Data Relay + Late Intel (merge laws)
 */

import { describe, test, expect } from 'vitest';
import { isContaminated, mergeIntelEvent, mergeConsultant, mergeDeepScrape } from '../intel-merge';
import { initialState } from '../state';
import type { ConversationState } from '../types';
import type { IntelReadyEvent } from '@bella/contracts';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockState(overrides: Partial<ConversationState> = {}): ConversationState {
  return { ...initialState('test-call', 'test-lead'), ...overrides };
}

function validPayload(overrides: Partial<IntelReadyEvent> = {}): IntelReadyEvent {
  return {
    version: 1,
    lid: 'test-lid',
    ts: new Date().toISOString(),
    source: 'fast_intel',
    business_name: 'KPMG Australia',
    core_identity: { business_name: 'KPMG Australia', industry: 'Professional Services', location: 'Sydney' },
    ...overrides,
  };
}

// ─── C8-01: mergeIntelEvent merges business_name ─────────────────────────────

describe('C8-01', () => {
  test('mergeIntelEvent merges core_identity.business_name into state.businessName', () => {
    const state = mockState({ businessName: '' });
    const payload = validPayload();
    mergeIntelEvent(state, payload);
    expect(state.businessName).toBe('KPMG Australia');
  });
});

// ─── C8-02: mergeIntelEvent rejects contaminated payload ─────────────────────

describe('C8-02', () => {
  test('mergeIntelEvent rejects {{placeholder}} contamination, returns 0', () => {
    const state = mockState();
    const payload = validPayload({ business_name: '{{companyName}}' });
    const merged = mergeIntelEvent(state, payload);
    expect(merged).toBe(0);
    expect(state.businessName).toBe('your business');
  });
});

// ─── C8-03: mergeConsultant blocks consultant:false ──────────────────────────

describe('C8-03', () => {
  test('mergeConsultant blocks consultant:false payload, returns 0', () => {
    const state = mockState();
    const merged = mergeConsultant(state, false);
    expect(merged).toBe(0);
    expect(state.consultantReady).toBe(false);
  });
});

// ─── C8-04: mergeConsultant blocks null ──────────────────────────────────────

describe('C8-04', () => {
  test('mergeConsultant blocks null payload, returns 0', () => {
    const state = mockState();
    const merged = mergeConsultant(state, null);
    expect(merged).toBe(0);
    expect(state.consultantReady).toBe(false);
  });
});

// ─── C8-05: mergeConsultant sets consultantReady on valid payload ─────────────

describe('C8-05', () => {
  test('mergeConsultant sets state.consultantReady = true on valid payload', () => {
    const state = mockState();
    const merged = mergeConsultant(state, {
      businessIdentity: { correctedName: 'KPMG Australia' },
      scriptFills: { website_positive_comment: 'Great site' },
    });
    expect(state.consultantReady).toBe(true);
    expect(merged).toBeGreaterThan(0);
  });
});

// ─── C8-06: mergeConsultant rejects contaminated payload ─────────────────────

describe('C8-06', () => {
  test('mergeConsultant rejects contaminated payload, returns 0', () => {
    const state = mockState();
    const merged = mergeConsultant(state, { businessIdentity: { name: '{{placeholder}}' } });
    expect(merged).toBe(0);
    expect(state.consultantReady).toBe(false);
  });
});

// ─── C8-07: mergeDeepScrape merges googleMaps ────────────────────────────────

describe('C8-07', () => {
  test('mergeDeepScrape merges googleMaps into state.deepIntel.googlePresence', () => {
    const state = mockState();
    const merged = mergeDeepScrape(state, {
      googleMaps: [{ placeName: 'KPMG Sydney', rating: 4.5, bellaLine: 'Top-rated firm' }],
    });
    expect(merged).toBeGreaterThan(0);
    expect(state.deepIntel?.googlePresence).toBeDefined();
    expect(Array.isArray(state.deepIntel?.googlePresence)).toBe(true);
  });
});

// ─── C8-08: mergeDeepScrape sets review_signals flag ─────────────────────────

describe('C8-08', () => {
  test('mergeDeepScrape sets review_signals flag when googleMaps.rating present', () => {
    const state = mockState();
    mergeDeepScrape(state, {
      googleMaps: { rating: 4.8 },
    });
    expect(state.intelFlags?.review_signals).toBe(true);
  });
});

// ─── C8-09: mergeDeepScrape rejects contaminated payload ─────────────────────

describe('C8-09', () => {
  test('mergeDeepScrape rejects contaminated payload, returns 0', () => {
    const state = mockState();
    const merged = mergeDeepScrape(state, { googleMaps: { rating: '{{rating}}' } });
    expect(merged).toBe(0);
    expect(state.deepIntel).toBeNull();
  });
});

// ─── C8-10: isContaminated detects {{placeholder}} in string ─────────────────

describe('C8-10', () => {
  test('isContaminated detects {{placeholder}} in string', () => {
    expect(isContaminated('Hello {{name}}')).toBe(true);
  });
});

// ─── C8-11: isContaminated detects {{placeholder}} nested in object ──────────

describe('C8-11', () => {
  test('isContaminated detects {{placeholder}} nested in object', () => {
    expect(isContaminated({ a: { b: '{{companyName}}' } })).toBe(true);
  });
});

// ─── C8-12: isContaminated returns false for clean data ──────────────────────

describe('C8-12', () => {
  test('isContaminated returns false for clean data', () => {
    expect(isContaminated({ name: 'KPMG', rating: 4.5, tags: ['b2b', 'accounting'] })).toBe(false);
  });
});

// ─── C8-13: mergeIntelEvent returns >0 for valid payload with core_identity ───

describe('C8-13', () => {
  test('mergeIntelEvent returns >0 merged for valid payload with core_identity', () => {
    const state = mockState();
    const payload = validPayload({ flags: { is_running_ads: true } });
    const merged = mergeIntelEvent(state, payload);
    expect(merged).toBeGreaterThan(0);
  });
});

// ─── C8-14: mergeConsultant does NOT set consultantReady when consultant=false ─

describe('C8-14', () => {
  test('mergeConsultant does NOT set consultantReady when consultant is false', () => {
    const state = mockState();
    mergeConsultant(state, false);
    expect(state.consultantReady).toBe(false);
  });
});

// ─── C8-15: consultantReady false→true lifecycle ─────────────────────────────

describe('C8-15', () => {
  test('state.consultantReady starts false, becomes true after valid mergeConsultant', () => {
    const state = mockState();
    expect(state.consultantReady).toBe(false);
    mergeConsultant(state, { businessIdentity: { name: 'KPMG' } });
    expect(state.consultantReady).toBe(true);
  });
});
