/**
 * compliance-workflow-v3/src/ring1.ts
 * Ring 1 — synchronous inline compliance check (<50ms).
 * Pure TS, zero network calls. Brain DO calls this pre-speak.
 */

import type { CompliancePayload, ComplianceResult } from '@bella/contracts';
import { verifyRoiExactMatch } from './roi-match';

const COLD_CALL_PHRASES = [
  /\bhi\s+this\s+is\s+\w+\s+calling\s+from\b/i,
  /\bi('m|\s+am)\s+calling\s+(you\s+)?today\s+(to|about)\b/i,
  /\bsorry\s+to\s+(bother|disturb)\b/i,
];

const WEBSITE_CRITIQUE_PHRASES = [
  /\byour\s+(website|site)\s+(is\s+)?(bad|poor|outdated|terrible|lacks?)\b/i,
  /\bwebsite\s+(needs?\s+(work|improvement|fixing)|is\s+(bad|old|outdated))\b/i,
];

export function inlineCheck(payload: CompliancePayload): ComplianceResult {
  const { callId, turnId, stage, directive, bellaResponse } = payload;

  // ── ROI exact match (roi_delivery only) ──
  if (stage === 'roi_delivery') {
    const roiResult = verifyRoiExactMatch(directive, bellaResponse);
    if (!roiResult.match) {
      return {
        version: 1,
        callId,
        turnId,
        score: 0.0,
        driftType: 'false_claim',
        details: `ROI mismatch: ${roiResult.details}`,
      };
    }
  }

  // ── Cold-call framing ──
  for (const re of COLD_CALL_PHRASES) {
    if (re.test(bellaResponse)) {
      return {
        version: 1,
        callId,
        turnId,
        score: 0.1,
        driftType: 'false_claim',
        details: `Cold-call framing: "${bellaResponse.slice(0, 80)}"`,
      };
    }
  }

  // ── Website critique ──
  for (const re of WEBSITE_CRITIQUE_PHRASES) {
    if (re.test(bellaResponse)) {
      return {
        version: 1,
        callId,
        turnId,
        score: 0.2,
        driftType: 'false_claim',
        details: 'Website critique detected (Law 8)',
      };
    }
  }

  return { version: 1, callId, turnId, score: 1.0, driftType: 'none' };
}
