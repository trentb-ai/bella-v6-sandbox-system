/**
 * call-brain-do/src/flow.ts — v5.0.0-flow-harness
 *
 * The Flow Harness: a single deterministic function that ALL /turn calls
 * pass through. No state advancement happens outside this function.
 *
 * SEPARATION OF CONCERNS:
 * - Harness (this file)    -> flow control: which step, when to advance
 * - Script engine (moves)  -> content: what to say at each step
 * - Gate (gate.ts)         -> eligibility: who qualifies, force-advance
 * - ROI (roi.ts)           -> calculators: weekly value per agent
 *
 * IRON RULES:
 * 1. processFlow() is the ONLY place stage advancement happens
 * 2. /event handlers may resolve delivery, but MUST NOT advance stages
 * 3. One pending delivery at a time (one in-flight spoken directive)
 */

import type {
  CompletionMode,
  ConversationState,
  MergedIntel,
  StageId,
  WowStepId,
  StageDirective,
  FlowResult,
  AnyAgent,
  CoreAgent,
} from './types';
import { CRITICAL_STAGES } from './types';
import { buildCorrectionPrefix } from './compliance';

import { buildStageDirective } from './moves';
import {
  shouldForceAdvance,
  maxQuestionsReached,
  nextChannelFromQueue,
  buildInitialQueue,
  deriveTopAgents,
  hasAlexMinimumData,
  hasChrisMinimumData,
  hasMaddieMinimumData,
  hasSarahMinimumData,
  hasJamesMinimumData,
} from './gate';
import { WOW_STEP_ORDER, DELIVERY_TIMEOUT_MS, MAX_DELIVERY_ATTEMPTS, MAX_CONSECUTIVE_TIMEOUTS, DELIVERY_MIN_WINDOW_MS, getDeliveryTimeoutMs } from './flow-constants';
import type { AuditSource } from './flow-audit';
import {
  auditDirectiveIssued,
  auditDeliveryResolved,
  auditStageAdvanced,
  auditStepSkipped,
  auditStaleEvent,
  auditCallDegraded,
} from './flow-audit';
import {
  computeAlexRoi,
  computeChrisRoi,
  computeMaddieRoi,
  computeSarahRoi,
  computeJamesRoi,
} from './roi';
import { extractWowSentiment } from './helpers/sentiment';

// ─── Helpers ────────────────────────────────────────────────────────────────

function nextWowStep(current: WowStepId | null | undefined): WowStepId | null {
  if (!current) return WOW_STEP_ORDER[0];
  const idx = WOW_STEP_ORDER.indexOf(current);
  if (idx < 0 || idx >= WOW_STEP_ORDER.length - 1) return null;
  return WOW_STEP_ORDER[idx + 1];
}

function isFillerOnly(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length < 30 && /^((yeah|yep|yes|yup|sure|ok|okay|mm+h?m?|uh\s*huh|right|got\s*it|hmm+|ah+|oh+|cool|nice|alright|sounds?\s*good|go\s*ahead|go\s*for\s*it|sure\s*thing|for\s*sure|that's?\s*fine|no\s*worries)\s*[.,!?]*\s*)+$/i.test(trimmed);
}

// ─── Build MergedIntel from state ───────────────────────────────────────────

/** Assemble MergedIntel from ConversationState intel blobs. */
export function buildMergedIntel(state: ConversationState): MergedIntel {
  const deepBlob = (state.intel.deep as any) ?? {};
  return {
    fast: (state.intel.fast as any) ?? {},
    consultant: (state.intel.consultant as any) ?? {},
    deep: deepBlob,
    places: deepBlob.googleMaps
      ? { rating: deepBlob.googleMaps.rating, reviewCount: deepBlob.googleMaps.review_count }
      : undefined,
    scriptFills: (state.intel.consultant as any)?.scriptFills ?? undefined,
  };
}

// ─── Try running a V2 calculator for a channel stage ────────────────────────

// TODO: re-enable for ROI sprint — commented out for V1 rescript
/** Run the ROI calculator for a channel stage if minimum data is available. */
export function tryRunCalculator(stage: StageId, state: ConversationState): boolean {
  /*
  if (stage === 'ch_alex' && hasAlexMinimumData(state)) {
    state.calculatorResults.alex = computeAlexRoi({
      acv: state.acv!,
      leads: state.inboundLeads!,
      conversions: state.inboundConversions,
      conversionRate: state.inboundConversionRate,
      responseSpeedBand: state.responseSpeedBand ?? 'unknown',
    });
    console.log(`[CALC] Alex ROI computed: $${state.calculatorResults.alex.weeklyValue}/wk`);
    return true;
  }

  if (stage === 'ch_chris' && hasChrisMinimumData(state)) {
    state.calculatorResults.chris = computeChrisRoi({
      acv: state.acv!,
      leads: state.webLeads!,
      conversions: state.webConversions,
      conversionRate: state.webConversionRate,
    });
    console.log(`[CALC] Chris ROI computed: $${state.calculatorResults.chris.weeklyValue}/wk`);
    return true;
  }

  if (stage === 'ch_maddie' && hasMaddieMinimumData(state)) {
    state.calculatorResults.maddie = computeMaddieRoi({
      acv: state.acv!,
      phoneVolume: state.phoneVolume!,
      missedCalls: state.missedCalls,
      missedCallRate: state.missedCallRate,
    });
    console.log(`[CALC] Maddie ROI computed: $${state.calculatorResults.maddie.weeklyValue}/wk`);
    return true;
  }

  if (stage === 'ch_sarah' && hasSarahMinimumData(state)) {
    state.calculatorResults.sarah = computeSarahRoi({
      acv: state.acv!,
      oldLeads: state.oldLeads!,
    });
    console.log(`[CALC] Sarah ROI computed: $${state.calculatorResults.sarah.weeklyValue}/wk`);
    return true;
  }

  if (stage === 'ch_james' && hasJamesMinimumData(state)) {
    state.calculatorResults.james = computeJamesRoi({
      acv: state.acv!,
      newCustomersPerWeek: state.newCustomersPerWeek!,
      currentStars: state.currentStars!,
      hasReviewSystem: state.hasReviewSystem!,
    });
    console.log(`[CALC] James ROI computed: $${state.calculatorResults.james.weeklyValue}/wk`);
    return true;
  }

  return false;
  */
  return false;
}

// ─── Delivery Gate ──────────────────────────────────────────────────────────

/**
 * Resolve the delivery gate: check if the previous directive was confirmed.
 *
 * Chunk 3: Event handlers (llm_reply_done, barged_in, failed) and alarm
 * (timeout) may have already resolved the pendingDelivery. If so, the gate
 * just clears it and lets processFlow continue. If still pending, user
 * speech acts as implicit confirmation.
 *
 * Returns 'hold' if the delivery is too fresh to clear (residual speech).
 * When 'hold' is returned, processFlow must NOT advance or overwrite pendingDelivery.
 */
interface GateResult {
  action: 'open' | 'hold';
  /** True when the gate cleared a failed/timed_out delivery — question was never heard by user */
  clearedFailed: boolean;
  /** True when the gate cleared a drifted delivery on a critical stage (needs retry or advance) */
  clearedDrifted: boolean;
  /** Missed phrases from the drifted delivery (for correction prefix) */
  driftedMissedPhrases: string[];
  /** Drift count from the drifted delivery (for retry-exhausted check) */
  driftCount: number;
}

function resolveDeliveryGate(
  state: ConversationState,
  transcript: string,
  source: AuditSource = 'turn',
): GateResult {
  const DEFAULT: GateResult = { action: 'open', clearedFailed: false, clearedDrifted: false, driftedMissedPhrases: [], driftCount: 0 };
  const p = state.pendingDelivery;
  if (!p) return DEFAULT;

  // Already resolved by event handler or alarm — just clear
  if (p.status !== 'pending') {
    const wasFailed = p.status === 'failed';
    const wasDrifted = p.status === 'drifted';
    const missedPhrases = wasDrifted ? (p.missedPhrases ?? []) : [];
    const driftCount = wasDrifted ? (p.driftCount ?? 0) : 0;
    auditDeliveryResolved(state, p.stage, p.wowStep,
      `gate_clear status=${p.status} resolution=${p.resolution ?? 'none'} moveId=${p.moveId}`, source);
    state.pendingDelivery = null;
    return { action: 'open', clearedFailed: wasFailed, clearedDrifted: wasDrifted, driftedMissedPhrases: missedPhrases, driftCount };
  }

  // Still pending — user spoke on /turn → implicit confirmation
  // BUT only if enough time has passed since issue. If the directive was just issued,
  // this user speech is residual from the previous turn (Gemini hasn't even started yet).
  if (transcript.trim().length > 0) {
    const elapsed = Date.now() - p.issuedAt;
    if (elapsed < DELIVERY_MIN_WINDOW_MS) {
      // Too soon — this is residual speech, not a response to the new directive.
      // Do NOT clear, advance, or overwrite. Let llm_reply_done handle it naturally.
      console.log(`[DELIVERY_GATE_HOLD] moveId=${p.moveId} elapsed=${elapsed}ms < min=${DELIVERY_MIN_WINDOW_MS}ms — holding delivery`);
      return { action: 'hold', clearedFailed: false, clearedDrifted: false, driftedMissedPhrases: [], driftCount: 0 };
    }
    auditDeliveryResolved(state, p.stage, p.wowStep, `implicit_user_spoke moveId=${p.moveId}`, source);
    state.consecutiveTimeouts = 0;
    state.pendingDelivery = null;
    return DEFAULT;
  }

  // Edge case: empty transcript on /turn (shouldn't happen, handle gracefully)
  state.pendingDelivery = null;
  return DEFAULT;
}

// ─── Set Pending Delivery ───────────────────────────────────────────────────

/**
 * Record a pending delivery for the directive just issued.
 * NEVER silently overwrites an unresolved pending — logs a warning.
 */
function setPendingDelivery(
  state: ConversationState,
  directive: StageDirective,
  moveId: string,
  source: AuditSource = 'turn',
  isSynthesis: boolean = false,
): void {
  if (state.pendingDelivery && state.pendingDelivery.status === 'pending') {
    console.warn(`[FLOW_WARN] overwriting unresolved pendingDelivery moveId=${state.pendingDelivery.moveId} deliveryId=${state.pendingDelivery.deliveryId} with ${moveId}`);
  }

  const deliveryId = `${moveId}_${state.flowSeq}`;
  const timeoutMs = getDeliveryTimeoutMs(state.currentStage, directive.waitForUser, isSynthesis);

  state.pendingDelivery = {
    deliveryId,
    moveId,
    stage: state.currentStage,
    wowStep: state.currentWowStep ?? null,
    waitForUser: directive.waitForUser,
    issuedAt: Date.now(),
    seq: state.flowSeq,
    status: 'pending',
    attempts: 1,
    timeoutMs,
  };

  auditDirectiveIssued(state, state.currentStage, state.currentWowStep, `moveId=${moveId} deliveryId=${deliveryId} timeoutMs=${timeoutMs}`, source);
}

// ─── Delivery Resolution Functions ─────────────────────────────────────────
//
// IRON RULE: These functions may ONLY:
//   - validate correlation (deliveryId match)
//   - mutate pendingDelivery fields
//   - mutate timeout counters
//   - append audit
//   - return status metadata
//
// They must NOT advance stages, issue directives, rebuild queue,
// or call buildStageDirective().

/**
 * resolveDeliveryCompleted — called when llm_reply_done arrives.
 * Resolves pending delivery to 'completed'.
 */
export function resolveDeliveryCompleted(
  state: ConversationState,
  deliveryId: string,
  moveId: string,
  source: AuditSource = 'event',
): boolean {
  const p = state.pendingDelivery;

  // Stale-event check: deliveryId must match
  if (!p || p.deliveryId !== deliveryId) {
    auditStaleEvent(state, state.currentStage,
      `llm_reply_done deliveryId=${deliveryId} expected=${p?.deliveryId ?? 'none'}`, source);
    console.log(`[STALE_EVENT] llm_reply_done deliveryId=${deliveryId} expected=${p?.deliveryId ?? 'none'}`);
    return false;
  }

  // Correlation check: if moveId is present, verify it matches
  if (moveId && p.moveId !== moveId) {
    auditStaleEvent(state, state.currentStage,
      `llm_reply_done deliveryId=${deliveryId} moveId_mismatch expected=${p.moveId} got=${moveId}`, source);
    console.log(`[STALE_EVENT] llm_reply_done correlation mismatch deliveryId=${deliveryId} moveId=${moveId} expected=${p.moveId}`);
    return false;
  }

  // First-valid-event-wins: already resolved
  if (p.status !== 'pending') {
    auditStaleEvent(state, state.currentStage,
      `llm_reply_done_late deliveryId=${deliveryId} status=${p.status}`, source);
    console.log(`[STALE_EVENT] llm_reply_done arrived but status already ${p.status}`);
    return false;
  }

  p.status = 'completed';
  p.completedAt = Date.now();
  p.resolution = 'completed';
  state.consecutiveTimeouts = 0;

  auditDeliveryResolved(state, p.stage, p.wowStep,
    `delivery_completed deliveryId=${deliveryId} moveId=${p.moveId}`, source);
  console.log(`[DELIVERY] completed deliveryId=${deliveryId} moveId=${p.moveId}`);

  return true;
}

/**
 * resolveDeliveryBargedIn — called when bridge detects UserStartedSpeaking
 * while delivery was still pending.
 */
export function resolveDeliveryBargedIn(
  state: ConversationState,
  deliveryId: string,
  moveId: string,
  source: AuditSource = 'event',
): boolean {
  const p = state.pendingDelivery;

  // Stale-event check
  if (!p || p.deliveryId !== deliveryId) {
    auditStaleEvent(state, state.currentStage,
      `delivery_barged_in deliveryId=${deliveryId} expected=${p?.deliveryId ?? 'none'}`, source);
    console.log(`[STALE_EVENT] barged_in deliveryId=${deliveryId} expected=${p?.deliveryId ?? 'none'}`);
    return false;
  }

  // Correlation check
  if (moveId && p.moveId !== moveId) {
    auditStaleEvent(state, state.currentStage,
      `delivery_barged_in deliveryId=${deliveryId} moveId_mismatch expected=${p.moveId} got=${moveId}`, source);
    console.log(`[STALE_EVENT] barged_in correlation mismatch deliveryId=${deliveryId} moveId=${moveId} expected=${p.moveId}`);
    return false;
  }

  // First-valid-event-wins
  if (p.status !== 'pending') {
    auditStaleEvent(state, state.currentStage,
      `delivery_barged_in_late deliveryId=${deliveryId} status=${p.status}`, source);
    console.log(`[STALE_EVENT] barged_in arrived but status already ${p.status}`);
    return false;
  }

  p.status = 'barged_in';
  p.completedAt = Date.now();
  p.resolution = p.waitForUser ? 'barged_in_question_implicit_success' : 'barged_in_monologue_partial';
  state.consecutiveTimeouts = 0;

  auditDeliveryResolved(state, p.stage, p.wowStep,
    `delivery_barged_in deliveryId=${deliveryId} moveId=${p.moveId} waitForUser=${p.waitForUser}`, source);
  console.log(`[DELIVERY] barged_in deliveryId=${deliveryId} moveId=${p.moveId} waitForUser=${p.waitForUser}`);

  return true;
}

/**
 * resolveDeliveryFailed — called when bridge reports Gemini stream error.
 *
 * Sets status to 'failed'. Actual re-issue happens in processFlow()
 * on the next /turn — this function never issues speech directly.
 */
export function resolveDeliveryFailed(
  state: ConversationState,
  deliveryId: string,
  moveId: string,
  errorCode?: string,
  source: AuditSource = 'event',
): boolean {
  const p = state.pendingDelivery;

  // Stale-event check
  if (!p || p.deliveryId !== deliveryId) {
    auditStaleEvent(state, state.currentStage,
      `delivery_failed deliveryId=${deliveryId} expected=${p?.deliveryId ?? 'none'}`, source);
    console.log(`[STALE_EVENT] failed deliveryId=${deliveryId} expected=${p?.deliveryId ?? 'none'}`);
    return false;
  }

  // Correlation check
  if (moveId && p.moveId !== moveId) {
    auditStaleEvent(state, state.currentStage,
      `delivery_failed deliveryId=${deliveryId} moveId_mismatch expected=${p.moveId} got=${moveId}`, source);
    console.log(`[STALE_EVENT] failed correlation mismatch deliveryId=${deliveryId} moveId=${moveId} expected=${p.moveId}`);
    return false;
  }

  // First-valid-event-wins
  if (p.status !== 'pending') {
    auditStaleEvent(state, state.currentStage,
      `delivery_failed_late deliveryId=${deliveryId} status=${p.status}`, source);
    console.log(`[STALE_EVENT] failed arrived but status already ${p.status}`);
    return false;
  }

  p.status = 'failed';
  p.completedAt = Date.now();
  p.resolution = `failed_error=${errorCode ?? 'unknown'}`;

  auditDeliveryResolved(state, p.stage, p.wowStep,
    `delivery_failed deliveryId=${deliveryId} moveId=${p.moveId} error=${errorCode ?? 'unknown'} attempts=${p.attempts}`, source);
  console.log(`[DELIVERY] failed deliveryId=${deliveryId} moveId=${p.moveId} error=${errorCode ?? 'unknown'} attempts=${p.attempts}`);

  return true;
}

/**
 * resolveDeliveryTimeout — called from alarm handler when DELIVERY_TIMEOUT_MS elapsed.
 *
 * IRON RULE: Alarm handler MUST be idempotent. Re-check deliveryId and
 * status before acting. If already resolved, no-op.
 *
 * Behavior:
 * - If pending and attempts < MAX: increment attempts, reset issuedAt
 *   (re-issue happens on next /turn via the normal gate)
 * - If pending and attempts >= MAX: mark failed with resolution='timed_out'
 * - Increment consecutiveTimeouts. If >= MAX_CONSECUTIVE_TIMEOUTS: degraded.
 */
export function resolveDeliveryTimeout(
  state: ConversationState,
  source: AuditSource = 'alarm',
): { reissue: boolean; degraded: boolean } {
  const p = state.pendingDelivery;

  // Idempotent guard: no pending delivery or already resolved
  if (!p || p.status !== 'pending') {
    console.log(`[ALARM_NOOP] no pending delivery or already resolved`);
    return { reissue: false, degraded: false };
  }

  state.consecutiveTimeouts++;

  if (p.attempts < MAX_DELIVERY_ATTEMPTS) {
    // Increment attempts — leave status as 'pending' so next /turn can reissue
    p.attempts++;
    p.issuedAt = Date.now(); // Reset timer for next timeout window

    auditDeliveryResolved(state, p.stage, p.wowStep,
      `timeout_reissue deliveryId=${p.deliveryId} attempts=${p.attempts} consecutiveTimeouts=${state.consecutiveTimeouts}`, source);
    console.log(`[DELIVERY_TIMEOUT] reissue attempts=${p.attempts} deliveryId=${p.deliveryId}`);

    // Check degradation
    if (state.consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
      auditCallDegraded(state, state.currentStage,
        `${state.consecutiveTimeouts} consecutive timeouts — bridge may be offline`, source);
      console.log(`[CALL_DEGRADED] ${state.consecutiveTimeouts} consecutive timeouts — bridge may be offline`);
      return { reissue: true, degraded: true };
    }

    return { reissue: true, degraded: false };
  }

  // Attempts exhausted — mark failed with timed_out resolution, leave record in place
  // for /turn to consume and clear via the normal gate
  p.status = 'failed';
  p.completedAt = Date.now();
  p.resolution = 'timed_out';

  auditDeliveryResolved(state, p.stage, p.wowStep,
    `delivery_timeout deliveryId=${p.deliveryId} attempts_exhausted=${p.attempts} consecutiveTimeouts=${state.consecutiveTimeouts}`, source);
  console.log(`[DELIVERY_TIMEOUT] force-clear deliveryId=${p.deliveryId} attempts=${p.attempts}`);

  // Check degradation
  if (state.consecutiveTimeouts >= MAX_CONSECUTIVE_TIMEOUTS) {
    auditCallDegraded(state, state.currentStage,
      `${state.consecutiveTimeouts} consecutive timeouts`, source);
    console.log(`[CALL_DEGRADED] ${state.consecutiveTimeouts} consecutive timeouts`);
    return { reissue: false, degraded: true };
  }

  return { reissue: false, degraded: false };
}

// ─── processFlow — THE HARNESS ─────────────────────────────────────────────

/**
 * processFlow — called ONLY on /turn. Mutates state in place.
 *
 * Phases:
 * 1. DELIVERY GATE — clear previous pending delivery
 * 2. ADVANCEMENT — deterministic state machine transitions
 * 3. BUILD DIRECTIVE — calls buildStageDirective() from moves.ts
 * 4. SET PENDING DELIVERY — gate for next turn
 */
export function processFlow(
  state: ConversationState,
  intel: MergedIntel,
  transcript: string,
  turnId: string,
  _now: number,
): FlowResult {
  const cleanTranscript = transcript.trim();

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 1: DELIVERY GATE
  // ═════════════════════════════════════════════════════════════════════════

  const gateResult = resolveDeliveryGate(state, cleanTranscript, 'turn');

  // Gate hold: delivery is too fresh to clear (residual speech from previous turn).
  // Return the EXISTING directive without advancing or overwriting pendingDelivery.
  if (gateResult.action === 'hold') {
    const directive = buildStageDirective({
      stage: state.currentStage,
      wowStep: state.currentWowStep,
      intel,
      state,
    });
    const moveId = `v2_${state.currentStage}${state.currentWowStep ? '_' + state.currentWowStep : ''}`;
    return { directive, moveId, advanced: false };
  }

  // Track if we just cleared a failed delivery — used to skip question counting
  const clearedFailedDelivery = gateResult.clearedFailed;

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 1.5: DRIFT BRANCH (Sprint A2 — compliance retry)
  // ═════════════════════════════════════════════════════════════════════════

  if (gateResult.clearedDrifted) {
    const isCritical = CRITICAL_STAGES.includes(state.currentStage);

    if (isCritical && gateResult.driftCount < 1) {
      // Decision X: ONE retry — rebuild directive with correction prefix
      const retryDirective = buildStageDirective({
        stage: state.currentStage,
        wowStep: state.currentWowStep,
        intel,
        state,
      });
      const correctedSpeak = buildCorrectionPrefix(gateResult.driftedMissedPhrases, retryDirective.speak);
      const correctedDirective: StageDirective = { ...retryDirective, speak: correctedSpeak };
      const moveId = `v2_${state.currentStage}${state.currentWowStep ? '_' + state.currentWowStep : ''}_retry`;

      setPendingDelivery(state, correctedDirective, moveId, 'turn');
      console.log(`[COMPLIANCE_RETRY] stage=${state.currentStage} driftCount=${gateResult.driftCount} missed=${gateResult.driftedMissedPhrases.length}`);
      return { directive: correctedDirective, moveId, advanced: false, clearedFailedDelivery: false };
    }

    if (isCritical && gateResult.driftCount >= 1) {
      // Retry exhausted — continue normally, do NOT block the call
      console.log(`[COMPLIANCE_RETRY_EXHAUSTED] stage=${state.currentStage} driftCount=${gateResult.driftCount} — advancing normally`);
    } else {
      // Non-critical drift — log only, no retry
      console.log(`[COMPLIANCE_DRIFT_NONCRITICAL] stage=${state.currentStage} — no retry for non-critical`);
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 2: ADVANCEMENT — deterministic state machine
  // ═════════════════════════════════════════════════════════════════════════

  let advanced = false;

  switch (state.currentStage) {

    // ── GREETING ──────────────────────────────────────────────────────────
    case 'greeting': {
      if (cleanTranscript.length > 0) {
        state.completedStages.push('greeting');
        state.currentStage = 'wow';
        state.currentWowStep = 'wow_1_research_intro';
        advanced = true;
        auditStageAdvanced(state, 'greeting', 'wow', '→ wow_1_research_intro', undefined, 'turn');
        console.log(`[ADVANCE] greeting → wow (wow_1_research_intro)`);
      }
      break;
    }

    // ── WOW ───────────────────────────────────────────────────────────────
    case 'wow': {
      // Failed delivery recovery: skip the failed step immediately.
      // The user never heard the full directive — re-issuing with stale
      // conversation context causes Gemini off-script behavior.
      if (clearedFailedDelivery && state.currentWowStep) {
        console.log(`[WOW_FAILED_SKIP] ${state.currentWowStep} → skipping past failed delivery`);
        state.completedWowSteps.push(state.currentWowStep);
        const nextAfterFail = nextWowStep(state.currentWowStep);
        if (nextAfterFail) {
          state.currentWowStep = nextAfterFail;
          advanced = true;
          auditStageAdvanced(state, 'wow', 'wow', `failed_delivery_skip → ${nextAfterFail}`, undefined, 'turn');
          console.log(`[WOW] → ${nextAfterFail} (failed delivery skip)`);
        } else {
          state.completedStages.push('wow');
          state.currentWowStep = null;
          state.currentStage = 'recommendation';
          advanced = true;
          auditStageAdvanced(state, 'wow', 'recommendation', 'failed_delivery_skip_exhausted', undefined, 'turn');
          console.log(`[ADVANCE] wow → recommendation (failed delivery skip)`);
        }
        break;
      }

      const filler = isFillerOnly(cleanTranscript);

      // Build directive for current step to check if it's skippable or a question
      const currentDirective = buildStageDirective({
        stage: 'wow',
        wowStep: state.currentWowStep,
        intel,
        state,
      });

      // Auto-skip chain: loop through consecutive skippable steps
      if (currentDirective.canSkip && !currentDirective.waitForUser) {
        let skipStep: WowStepId | null | undefined = state.currentWowStep;
        while (skipStep) {
          const sd = buildStageDirective({ stage: 'wow', wowStep: skipStep, intel, state });
          if (!sd.canSkip || sd.waitForUser) break; // found non-skippable — stop here
          auditStepSkipped(state, 'wow', skipStep, 'canSkip_no_waitForUser', 'turn');
          console.log(`[WOW_SKIP] ${skipStep} (canSkip + no waitForUser)`);
          state.completedWowSteps.push(skipStep);
          const nxt = nextWowStep(skipStep);
          if (nxt) {
            state.currentWowStep = nxt;
            console.log(`[WOW] → ${nxt}`);
            skipStep = nxt;
          } else {
            state.completedStages.push('wow');
            state.currentWowStep = null;
            state.currentStage = 'recommendation';
            advanced = true;
            auditStageAdvanced(state, 'wow', 'recommendation', 'auto_skip_exhausted', undefined, 'turn');
            console.log(`[ADVANCE] wow → recommendation`);
            skipStep = null;
          }
        }
        break; // match old behavior: break out of wow case after auto-skip chain
      }

      // WOW steps are confirmation questions — filler ("yeah", "sure") IS the answer.
      // Only log it, never hold. Channel stages handle filler differently.
      if (currentDirective.ask && filler) {
        console.log(`[WOW_FILLER_OK] step=${state.currentWowStep} — filler accepted as affirmative`);
      }

      // Advance to next WOW step
      if (cleanTranscript.length > 0) {
        // ── Sprint 2 (Issue 8): Sentiment check for wow_3/wow_4 ──
        // Detect negative sentiment (rejection/correction) and adapt flow.
        // wow_3 negative → skip wow_4, jump to wow_5
        // wow_4 negative → record but continue normally
        const SENTIMENT_STEPS: Set<string> = new Set(['wow_3_icp_problem_solution', 'wow_4_conversion_action']);
        if (state.currentWowStep && SENTIMENT_STEPS.has(state.currentWowStep)) {
          const sentiment = extractWowSentiment(cleanTranscript);
          state.lastWowSentiment = sentiment;
          console.log(`[WOW_SENTIMENT] step=${state.currentWowStep} sentiment=${sentiment} transcript="${cleanTranscript.slice(0, 60)}"`);

          if (sentiment === 'negative') {
            state.rejectedWowSteps.push(state.currentWowStep);

            if (state.currentWowStep === 'wow_3_icp_problem_solution') {
              // wow_3 rejected → confirmedICP=false, skip wow_4 entirely, jump to wow_5
              state.confirmedICP = false;
              state.completedWowSteps.push('wow_3_icp_problem_solution');
              state.completedWowSteps.push('wow_4_conversion_action');
              state.currentWowStep = 'wow_5_alignment_bridge';
              advanced = true;
              auditStageAdvanced(state, 'wow', 'wow', 'wow3_rejected → skip wow_4 → wow_5', undefined, 'turn');
              console.log(`[WOW_REJECTION_SKIP] wow_3 rejected → confirmedICP=false → skipping wow_4 → wow_5_alignment_bridge`);
              break;
            }

            if (state.currentWowStep === 'wow_4_conversion_action') {
              // wow_4 negative: prospect gave a correction/alternative
              // Long response (>30 chars) = overridden CTA, short = confirmed false
              if (cleanTranscript.length > 30) {
                state.overriddenCTA = true;
                state.confirmedCTA = false;
                console.log(`[WOW4_CTA] overriddenCTA=true (long correction ${cleanTranscript.length} chars)`);
              } else {
                state.confirmedCTA = false;
                console.log(`[WOW4_CTA] confirmedCTA=false (short negation)`);
              }
            }
            // wow_4 negative → record but continue normal advancement below
          } else {
            // ── D7/D8: Pattern-match affirmations as fallback for SCRIBE misses ──
            // For short responses (≤30 chars) that SCRIBE may have missed, use regex to confirm.
            const AFFIRM_PATTERN = /^(yes|yeah|yep|sure|right|correct|sounds right|that.s right|ok|okay)\b/i;
            const NEGATE_PATTERN = /\b(no|not quite|not really|wrong|incorrect)\b/i;
            const isAffirm = AFFIRM_PATTERN.test(cleanTranscript);
            const isNegate = !isAffirm && NEGATE_PATTERN.test(cleanTranscript);

            if (state.currentWowStep === 'wow_3_icp_problem_solution') {
              if (isAffirm || sentiment === 'positive') {
                state.confirmedICP = true;
                console.log(`[WOW3_ICP] confirmedICP=true (sentiment=${sentiment} affirm=${isAffirm})`);
              } else if (isNegate) {
                state.confirmedICP = false;
                console.log(`[WOW3_ICP] confirmedICP=false (negate pattern)`);
              }
            }

            if (state.currentWowStep === 'wow_4_conversion_action') {
              if (cleanTranscript.length > 30) {
                // Long response without negative sentiment = user provided alternative/correction
                state.overriddenCTA = true;
                state.confirmedCTA = false;
                console.log(`[WOW4_CTA] overriddenCTA=true (long non-negative response ${cleanTranscript.length} chars)`);
              } else if (isAffirm || sentiment === 'positive') {
                state.confirmedCTA = true;
                console.log(`[WOW4_CTA] confirmedCTA=true (sentiment=${sentiment} affirm=${isAffirm})`);
              } else if (isNegate) {
                state.confirmedCTA = false;
                console.log(`[WOW4_CTA] confirmedCTA=false (negate pattern)`);
              }
            }
          }
        }

        if (state.currentWowStep) {
          // Spoken-gate: verify non-waitForUser steps were actually spoken before completing
          const expectedMoveId = `v2_wow_${state.currentWowStep}`;
          const wasSpoken = state.spoken.moveIds.includes(expectedMoveId);
          if (!currentDirective.waitForUser && currentDirective.speak && !wasSpoken) {
            console.log(`[WOW_SPOKEN_GATE] step=${state.currentWowStep} moveId=${expectedMoveId} NOT in spoken.moveIds — completing anyway but flagging`);
          }
          state.completedWowSteps.push(state.currentWowStep);
        }
        const next = nextWowStep(state.currentWowStep);
        if (next) {
          state.currentWowStep = next;
          console.log(`[WOW] → ${next}`);

          // Chain-skip: if the next step is also skippable, keep advancing
          let chainStep: WowStepId | null = next;
          while (chainStep) {
            const nd = buildStageDirective({ stage: 'wow', wowStep: chainStep, intel, state });
            if (!nd.canSkip || nd.waitForUser) break; // found non-skippable — deliver this one
            auditStepSkipped(state, 'wow', chainStep, 'canSkip_chain_skip', 'turn');
            console.log(`[WOW_CHAIN_SKIP] ${chainStep} (canSkip + no waitForUser)`);
            state.completedWowSteps.push(chainStep);
            const nextNext = nextWowStep(chainStep);
            if (nextNext) {
              state.currentWowStep = nextNext;
              console.log(`[WOW] → ${nextNext}`);
              chainStep = nextNext;
            } else {
              state.completedStages.push('wow');
              state.currentWowStep = null;
              state.currentStage = 'recommendation';
              advanced = true;
              auditStageAdvanced(state, 'wow', 'recommendation', 'chain_skip_exhausted', undefined, 'turn');
              console.log(`[ADVANCE] wow → recommendation`);
              chainStep = null;
            }
          }
        } else {
          state.completedStages.push('wow');
          state.currentWowStep = null;
          state.currentStage = 'recommendation';
          advanced = true;
          auditStageAdvanced(state, 'wow', 'recommendation', 'wow_complete', undefined, 'turn');
          console.log(`[ADVANCE] wow → recommendation`);
        }
      }
      break;
    }

    // ── RECOMMENDATION ────────────────────────────────────────────────────
    case 'recommendation': {
      if (cleanTranscript.length > 0) {
        state.topAgents = deriveTopAgents(state);
        state.currentQueue = buildInitialQueue(state);

        // Only advance to close after recommendation has been spoken
        // Check spoken.moveIds for the recommendation moveId
        const recMoveId = 'v2_recommendation';
        const recSpoken = state.spoken.moveIds.includes(recMoveId);

        if (recSpoken) {
          state.completedStages.push('recommendation');
          state.currentStage = 'close';
          advanced = true;
          auditStageAdvanced(state, 'recommendation', 'close', 'v1_rescript', undefined, 'turn');
          console.log(`[ADVANCE] recommendation → close (recommendation spoken)`);
        } else {
          console.log(`[HOLD] recommendation not yet spoken — waiting for delivery before advancing`);
        }
      }
      break;
    }

    // ── CLOSE ─────────────────────────────────────────────────────────────
    case 'close': {
      // Terminal — do not advance
      break;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 3: BUILD DIRECTIVE
  // ═════════════════════════════════════════════════════════════════════════

  const directive = buildStageDirective({
    stage: state.currentStage,
    wowStep: state.currentWowStep,
    intel,
    state,
  });

  // Sprint 1A: context-aware moveId — channel stages get `_synthesis` suffix
  // when the directive is delivering ROI results. This prevents the flat moveId
  // from conflating question delivery with synthesis delivery.
  const CHANNEL_STAGES: Set<StageId> = new Set(['ch_alex', 'ch_chris', 'ch_maddie', 'ch_sarah', 'ch_james']);
  const AGENT_FOR_STAGE: Record<string, string> = { ch_alex: 'alex', ch_chris: 'chris', ch_maddie: 'maddie', ch_sarah: 'sarah', ch_james: 'james' };
  let moveId: string;
  let isSynthesis = false;

  if (CHANNEL_STAGES.has(state.currentStage)) {
    const agentKey = AGENT_FOR_STAGE[state.currentStage];
    const hasRoi = !!(agentKey && state.calculatorResults[agentKey as keyof typeof state.calculatorResults]);
    isSynthesis = hasRoi;
    moveId = hasRoi
      ? `v2_${state.currentStage}_synthesis`
      : `v2_${state.currentStage}`;
  } else {
    moveId = `v2_${state.currentStage}${state.currentWowStep ? '_' + state.currentWowStep : ''}`;
  }

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 4: SET PENDING DELIVERY
  // ═════════════════════════════════════════════════════════════════════════

  setPendingDelivery(state, directive, moveId, 'turn', isSynthesis);

  return { directive, moveId, advanced, clearedFailedDelivery };
}
