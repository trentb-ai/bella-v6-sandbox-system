/**
 * prompt-worker-v3/src/compliance.ts — Compliance dispatch
 * Chunk 2 — V3
 *
 * fireComplianceCheck() — fire-and-forget to Compliance Workflow (Chunk 6 stub).
 * Non-blocking: caller wraps in ctx.waitUntil().
 */

import type { TurnPlan, CompliancePayload } from '@bella/contracts';
import type { Env } from './types';

/**
 * Dispatch a CompliancePayload to the Compliance Workflow service binding.
 * Always resolves — errors are logged but not re-thrown (non-blocking).
 */
export async function fireComplianceCheck(
  plan: TurnPlan,
  bellaResponse: string,
  prospectUtterance: string,
  env: Env,
): Promise<void> {
  if (!env.COMPLIANCE_WORKFLOW) {
    console.log(`[PROMPT] compliance binding absent — skipping (callId=${plan.callId} turnId=${plan.turnId})`);
    return;
  }

  const payload: CompliancePayload = {
    version: 1,
    callId: plan.callId,
    turnId: plan.turnId,
    stage: plan.stage,
    directive: plan.directive,
    bellaResponse,
    prospectUtterance,
  };

  await env.COMPLIANCE_WORKFLOW.fetch(
    new Request('https://compliance/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  ).catch(err => console.error('[PROMPT] compliance dispatch failed:', err));
}
