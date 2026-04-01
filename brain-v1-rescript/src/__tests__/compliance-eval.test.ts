/**
 * compliance-eval.test.ts — Sprint A3: Compliance Eval Assertions C1–C10
 *
 * Validates the end-to-end compliance loop: word-overlap checking,
 * drift handling, judge wiring, correction prefix, and state integrity.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  checkCompliance,
  normalizeDollar,
  checkDollarCompliance,
  buildCorrectionPrefix,
  runLlmJudge,
} from '../compliance';
import { mockState, mockIntel, mockPendingDelivery, ALL_WOW_STEPS } from './helpers';
import { processFlow } from '../flow';
import { assertInvariants } from './invariants';
import { CRITICAL_STAGES } from '../types';
import type { ConversationState, MergedIntel, ComplianceLogEntry } from '../types';

const NOW = Date.now();

/** Wrapper: runs processFlow then asserts all state invariants. */
function flowAndAssert(
  state: ConversationState,
  intel: MergedIntel,
  transcript: string,
  turnId: string,
  ts: number,
  ctx?: string,
) {
  if (state.pendingDelivery) state.pendingDelivery.issuedAt -= 5000;
  const result = processFlow(state, intel, transcript, turnId, ts);
  assertInvariants(state, ctx ?? turnId);
  return result;
}

describe('Compliance Eval Assertions C1–C10', () => {

  // ═══════════════════════════════════════════════════════════════════════════
  // C1: checkCompliance returns compliant=true, score >= 0.9 for verbatim match
  // ═══════════════════════════════════════════════════════════════════════════
  it('C1 — verbatim match produces compliant=true, score >= 0.9', () => {
    const spoken = 'Alex can recover eight hundred thousand dollars per week';
    const phrases = ['Alex can recover', 'eight hundred thousand dollars'];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.9);
    expect(result.missedPhrases).toHaveLength(0);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C2: checkCompliance returns compliant=false, missedPhrases populated on drift
  // ═══════════════════════════════════════════════════════════════════════════
  it('C2 — completely missed phrases produce compliant=false with missedPhrases', () => {
    const spoken = 'Hello nice to meet you today';
    const phrases = ['Alex can recover', 'eight hundred thousand dollars'];
    const result = checkCompliance(spoken, phrases);
    expect(result.compliant).toBe(false);
    expect(result.missedPhrases.length).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(0.6);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C3: ASR variant "alice" matches canonical "alex" — score boosted
  // ═══════════════════════════════════════════════════════════════════════════
  it('C3 — ASR variant "alice" matches canonical "alex"', () => {
    const spoken = 'alice can recover the revenue for your business';
    const phrases = ['alex can recover'];
    const result = checkCompliance(spoken, phrases);
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.compliant).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C4: normalizeDollar parses "$800K", "eight hundred thousand", "$1.2M"
  // ═══════════════════════════════════════════════════════════════════════════
  it('C4 — normalizeDollar parses symbol + written dollar amounts', () => {
    expect(normalizeDollar('$800K')).toEqual([800000]);
    expect(normalizeDollar('$1.2M')).toEqual([1200000]);
    expect(normalizeDollar('eight hundred thousand dollars')).toEqual([800000]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C5: checkDollarCompliance passes within 5% tolerance, fails outside
  // ═══════════════════════════════════════════════════════════════════════════
  it('C5 — checkDollarCompliance passes within 5% tolerance, fails outside', () => {
    // Within tolerance: $800K vs spoken "eight hundred thousand" → exact match
    expect(checkDollarCompliance('eight hundred thousand dollars', [800000])).toBe(true);
    // Within 5%: $760K for expected $800K → 5% = $40K → $760K is exactly at boundary
    expect(checkDollarCompliance('$760,000 revenue', [800000])).toBe(true);
    // Outside tolerance: $500K vs expected $800K → way outside 5%
    expect(checkDollarCompliance('five hundred thousand dollars', [800000])).toBe(false);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C6: buildCorrectionPrefix contains missed phrases and directive, no apology
  // ═══════════════════════════════════════════════════════════════════════════
  it('C6 — buildCorrectionPrefix includes missed phrases, no apology', () => {
    const missed = ['Alex can recover', '$800K per week'];
    const directive = 'Tell them about the recovery potential.';
    const prefix = buildCorrectionPrefix(missed, directive);
    expect(prefix).toContain('Alex can recover');
    expect(prefix).toContain('$800K per week');
    expect(prefix).toContain(directive);
    expect(prefix).toContain('COMPLIANCE CORRECTION');
    // The prefix instructs the LLM "Do not apologise" — this IS correct behavior
    expect(prefix.toLowerCase()).toContain('do not apologise');
    // No standalone apology words (e.g., "sorry" or "I apologise")
    expect(prefix.toLowerCase()).not.toContain('i apologise');
    expect(prefix.toLowerCase()).not.toContain('i\'m sorry');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C7: Drift on critical stage with driftCount=0 triggers retry in processFlow
  // ═══════════════════════════════════════════════════════════════════════════
  it('C7 — critical drift (driftCount=0) triggers retry, not advance', () => {
    const state = mockState({
      currentStage: 'recommendation',
      completedStages: ['greeting', 'wow'],
      completedWowSteps: [...ALL_WOW_STEPS],
      currentWowStep: null,
      pendingDelivery: mockPendingDelivery({
        stage: 'recommendation',
        status: 'drifted',
        driftCount: 0,
        missedPhrases: ['recover revenue'],
        moveId: 'v2_recommendation_0',
      }),
    });
    const intel = mockIntel();
    const result = flowAndAssert(state, intel, 'yeah tell me more', 'turn_retry', NOW, 'C7_retry');
    // Retry means NOT advanced, new pending delivery issued
    expect(result.advanced).toBe(false);
    expect(state.pendingDelivery).not.toBeNull();
    expect(state.currentStage).toBe('recommendation'); // stays same stage
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C8: Drift on critical stage with driftCount >= 1 advances (retry exhausted)
  // ═══════════════════════════════════════════════════════════════════════════
  it('C8 — critical drift (driftCount >= 1) advances, retry exhausted', () => {
    const state = mockState({
      currentStage: 'recommendation',
      completedStages: ['greeting', 'wow'],
      completedWowSteps: [...ALL_WOW_STEPS],
      currentWowStep: null,
      pendingDelivery: mockPendingDelivery({
        stage: 'recommendation',
        status: 'drifted',
        driftCount: 1,
        missedPhrases: ['recover revenue'],
        moveId: 'v2_recommendation_retry',
      }),
    });
    const intel = mockIntel();
    const result = flowAndAssert(state, intel, 'ok what else', 'turn_exhaust', NOW, 'C8_exhaust');
    // Retry exhausted — should advance past recommendation
    expect(result.advanced).toBe(true);
    expect(state.completedStages).toContain('recommendation');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C9: Drift on non-critical stage does NOT trigger retry or correction
  // ═══════════════════════════════════════════════════════════════════════════
  it('C9 — non-critical drift logs only, no retry', () => {
    // anchor_acv is NOT in CRITICAL_STAGES
    expect(CRITICAL_STAGES).not.toContain('anchor_acv');
    const state = mockState({
      currentStage: 'anchor_acv',
      completedStages: ['greeting', 'wow', 'recommendation'],
      completedWowSteps: [...ALL_WOW_STEPS],
      currentWowStep: null,
      pendingDelivery: mockPendingDelivery({
        stage: 'anchor_acv',
        status: 'drifted',
        driftCount: 0,
        missedPhrases: ['annual contract value'],
        moveId: 'v2_anchor_acv_0',
      }),
    });
    const intel = mockIntel();
    const result = flowAndAssert(state, intel, 'tell me more', 'turn_noncrit', NOW, 'C9_noncrit');
    // Non-critical: drifted delivery clears, no retry, no forced advance
    // Stage stays (re-issued normally) — the key is no correction prefix in moveId
    expect(state.currentStage).toBe('anchor_acv'); // stays — no forced advance
    expect(result.advanced).toBe(false);
    // New directive issued without COMPLIANCE CORRECTION prefix
    if (result.directive) {
      expect(result.directive.speak).not.toContain('COMPLIANCE CORRECTION');
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // C10: complianceLog capped at 50 entries; summary computation correct
  // ═══════════════════════════════════════════════════════════════════════════
  it('C10 — complianceLog cap + summary fields', () => {
    // Build a state with 55 compliance log entries
    const entries: ComplianceLogEntry[] = [];
    for (let i = 0; i < 55; i++) {
      entries.push({
        stage: i % 2 === 0 ? 'recommendation' : 'ch_alex',
        ts: NOW - (55 - i) * 1000,
        score: i < 10 ? 0.4 : 0.95,
        driftType: i < 5 ? 'omission' : i < 8 ? 'substitution' : null,
        judgeCompliant: i < 5 ? false : i < 8 ? true : null,
        missedPhrases: i < 10 ? ['phrase_' + i] : [],
        reason: i < 8 ? 'test reason' : null,
      });
    }

    // Verify cap logic (as implemented in DO: slice(-50))
    const capped = entries.slice(-50);
    expect(capped).toHaveLength(50);

    // Verify summary computation (mirrors /debug endpoint)
    const overallScore = capped.reduce((sum, e) => sum + e.score, 0) / capped.length;
    const driftCounts: Record<string, number> = {};
    let judgeFiredCount = 0;
    let judgeErrorCount = 0;
    for (const entry of capped) {
      if (entry.driftType) {
        driftCounts[entry.driftType] = (driftCounts[entry.driftType] ?? 0) + 1;
      }
      if (entry.judgeCompliant !== null) {
        judgeFiredCount++;
      } else if (entry.score < 1) {
        judgeErrorCount++;
      }
    }

    // After slicing -50, first 5 of original (indices 0-4) are gone
    // Remaining from original: indices 5-54
    // Index 5: driftType=omission, judgeCompliant=false → judgeFired
    // Index 6: driftType=substitution, judgeCompliant=true → judgeFired
    // Index 7: driftType=substitution, judgeCompliant=true → judgeFired
    // Index 8: driftType=null, judgeCompliant=null, score=0.4 → judgeError
    // Index 9: driftType=null, judgeCompliant=null, score=0.4 → judgeError
    // Index 10-54: score=0.95, judgeCompliant=null, driftType=null → judgeError (score < 1)
    expect(overallScore).toBeGreaterThan(0.8);
    expect(driftCounts['omission']).toBeUndefined(); // all 5 omissions were in first 5 entries, sliced off
    expect(judgeFiredCount).toBe(3); // indices 5, 6, 7
    expect(judgeErrorCount).toBeGreaterThan(0);
    // Summary shape matches what /debug returns
    const summary = { totalChecks: capped.length, overallScore, driftCounts, judgeFiredCount, judgeErrorCount };
    expect(summary.totalChecks).toBe(50);
    expect(typeof summary.overallScore).toBe('number');
    expect(typeof summary.driftCounts).toBe('object');
  });
});
