/**
 * call-brain-do/src/flow-audit.ts — v5.0.0-h1-source
 * Append-only audit log utilities for the flow harness.
 * Additive only — no behavior changes.
 */

import type { CompletionMode, ConversationState, FlowAction, FlowEntry, StageId, WowStepId } from './types';
import { FLOW_LOG_CAP } from './flow-constants';

export type AuditSource = 'turn' | 'alarm' | 'event' | 'scribe';

// ─── Core Append ─────────────────────────────────────────────────────────────

/**
 * Append a flow entry to state.flowLog with auto-incrementing seq.
 * Enforces FLOW_LOG_CAP via FIFO eviction.
 */
export function appendAudit(
  state: ConversationState,
  action: FlowAction,
  stage: StageId,
  wowStep?: WowStepId | null,
  detail?: string,
  completionMode?: CompletionMode,
  source?: AuditSource,
): FlowEntry {
  const entry: FlowEntry = {
    seq: state.flowSeq++,
    action,
    stage,
    wowStep: wowStep ?? undefined,
    ts: new Date().toISOString(),
    detail,
    ...(completionMode ? { completionMode } : {}),
    ...(source ? { source } : {}),
  };

  state.flowLog.push(entry);

  if (state.flowLog.length > FLOW_LOG_CAP) {
    state.flowLog = state.flowLog.slice(-FLOW_LOG_CAP);
  }

  return entry;
}

// ─── Typed Helpers ───────────────────────────────────────────────────────────

export function auditDirectiveIssued(
  state: ConversationState,
  stage: StageId,
  wowStep?: WowStepId | null,
  detail?: string,
  source?: AuditSource,
): FlowEntry {
  return appendAudit(state, 'directive_issued', stage, wowStep, detail, undefined, source);
}

export function auditDeliveryResolved(
  state: ConversationState,
  stage: StageId,
  wowStep?: WowStepId | null,
  detail?: string,
  source?: AuditSource,
): FlowEntry {
  return appendAudit(state, 'delivery_resolved', stage, wowStep, detail, undefined, source);
}

export function auditStageAdvanced(
  state: ConversationState,
  fromStage: StageId,
  toStage: StageId,
  detail?: string,
  completionMode?: CompletionMode,
  source?: AuditSource,
): FlowEntry {
  return appendAudit(state, 'stage_advanced', fromStage, undefined, detail ?? `→ ${toStage}`, completionMode, source);
}

export function auditStepSkipped(
  state: ConversationState,
  stage: StageId,
  wowStep: WowStepId,
  reason: string,
  source?: AuditSource,
): FlowEntry {
  return appendAudit(state, 'step_skipped', stage, wowStep, reason, undefined, source);
}

export function auditStaleEvent(
  state: ConversationState,
  stage: StageId,
  detail: string,
  source?: AuditSource,
): FlowEntry {
  return appendAudit(state, 'stale_event', stage, undefined, detail, undefined, source);
}

export function auditCallDegraded(
  state: ConversationState,
  stage: StageId,
  reason: string,
  source?: AuditSource,
): FlowEntry {
  return appendAudit(state, 'call_degraded', stage, undefined, reason, undefined, source);
}
