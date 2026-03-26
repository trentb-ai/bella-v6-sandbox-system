/**
 * call-brain-do/src/flow-audit.ts — v4.9.1-flow-scaffold
 * Append-only audit log utilities for the flow harness.
 * Additive only — no behavior changes.
 */

import type { CompletionMode, ConversationState, FlowAction, FlowEntry, StageId, WowStepId } from './types';
import { FLOW_LOG_CAP } from './flow-constants';

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
): FlowEntry {
  const entry: FlowEntry = {
    seq: state.flowSeq++,
    action,
    stage,
    wowStep: wowStep ?? undefined,
    ts: new Date().toISOString(),
    detail,
    ...(completionMode ? { completionMode } : {}),
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
): FlowEntry {
  return appendAudit(state, 'directive_issued', stage, wowStep, detail);
}

export function auditDeliveryResolved(
  state: ConversationState,
  stage: StageId,
  wowStep?: WowStepId | null,
  detail?: string,
): FlowEntry {
  return appendAudit(state, 'delivery_resolved', stage, wowStep, detail);
}

export function auditStageAdvanced(
  state: ConversationState,
  fromStage: StageId,
  toStage: StageId,
  detail?: string,
  completionMode?: CompletionMode,
): FlowEntry {
  return appendAudit(state, 'stage_advanced', fromStage, undefined, detail ?? `→ ${toStage}`, completionMode);
}

export function auditStepSkipped(
  state: ConversationState,
  stage: StageId,
  wowStep: WowStepId,
  reason: string,
): FlowEntry {
  return appendAudit(state, 'step_skipped', stage, wowStep, reason);
}

export function auditStaleEvent(
  state: ConversationState,
  stage: StageId,
  detail: string,
): FlowEntry {
  return appendAudit(state, 'stale_event', stage, undefined, detail);
}

export function auditCallDegraded(
  state: ConversationState,
  stage: StageId,
  reason: string,
): FlowEntry {
  return appendAudit(state, 'call_degraded', stage, undefined, reason);
}
