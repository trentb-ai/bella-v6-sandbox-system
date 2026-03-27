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
import { WOW_STEP_ORDER, DELIVERY_TIMEOUT_MS, MAX_DELIVERY_ATTEMPTS, MAX_CONSECUTIVE_TIMEOUTS, DELIVERY_MIN_WINDOW_MS } from './flow-constants';
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

/** Run the ROI calculator for a channel stage if minimum data is available. */
export function tryRunCalculator(stage: StageId, state: ConversationState): boolean {
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
}

function resolveDeliveryGate(
  state: ConversationState,
  transcript: string,
  source: AuditSource = 'turn',
): GateResult {
  const p = state.pendingDelivery;
  if (!p) return { action: 'open', clearedFailed: false };

  // Already resolved by event handler or alarm — just clear
  if (p.status !== 'pending') {
    const wasFailed = p.status === 'failed';
    auditDeliveryResolved(state, p.stage, p.wowStep,
      `gate_clear status=${p.status} resolution=${p.resolution ?? 'none'} moveId=${p.moveId}`, source);
    state.pendingDelivery = null;
    return { action: 'open', clearedFailed: wasFailed };
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
      return { action: 'hold', clearedFailed: false };
    }
    auditDeliveryResolved(state, p.stage, p.wowStep, `implicit_user_spoke moveId=${p.moveId}`, source);
    state.consecutiveTimeouts = 0;
    state.pendingDelivery = null;
    return { action: 'open', clearedFailed: false };
  }

  // Edge case: empty transcript on /turn (shouldn't happen, handle gracefully)
  state.pendingDelivery = null;
  return { action: 'open', clearedFailed: false };
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
): void {
  if (state.pendingDelivery && state.pendingDelivery.status === 'pending') {
    console.warn(`[FLOW_WARN] overwriting unresolved pendingDelivery moveId=${state.pendingDelivery.moveId} deliveryId=${state.pendingDelivery.deliveryId} with ${moveId}`);
  }

  const deliveryId = `${moveId}_${state.flowSeq}`;

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
  };

  auditDirectiveIssued(state, state.currentStage, state.currentWowStep, `moveId=${moveId} deliveryId=${deliveryId}`, source);
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
        state.completedStages.push('recommendation');

        // ── just_demo skip: bypass entire numbers path ──
        if (state.proceedToROI === false) {
          state.currentStage = 'close';
          advanced = true;
          auditStageAdvanced(state, 'recommendation', 'close', 'just_demo_skip', 'just_demo_skip', 'turn');
          console.log(`[JUST_DEMO_SKIP] recommendation → close (proceedToROI=false)`);
          break;
        }

        state.currentStage = 'anchor_acv';
        advanced = true;
        auditStageAdvanced(state, 'recommendation', 'anchor_acv', `queue=[${state.currentQueue.map(q => q.stage).join(',')}]`, undefined, 'turn');
        console.log(`[ADVANCE] recommendation → anchor_acv (queue=[${state.currentQueue.map(q => q.stage).join(',')}])`);
      }
      break;
    }

    // ── ANCHOR ACV ────────────────────────────────────────────────────────
    case 'anchor_acv': {
      // ── just_demo mid-flow skip ──
      if (state.proceedToROI === false) {
        state.completedStages.push('anchor_acv');
        state.currentStage = 'close';
        advanced = true;
        auditStageAdvanced(state, 'anchor_acv', 'close', 'just_demo_skip', 'just_demo_skip', 'turn');
        console.log(`[JUST_DEMO_SKIP] anchor_acv → close (proceedToROI=false)`);
        break;
      }

      if (state.acv != null) {
        state.completedStages.push('anchor_acv');
        state.currentStage = nextChannelFromQueue(state);
        advanced = true;
        auditStageAdvanced(state, 'anchor_acv', state.currentStage, `acv=$${state.acv}`, undefined, 'turn');
        console.log(`[ADVANCE] anchor_acv → ${state.currentStage} (acv=$${state.acv})`);
      }
      break;
    }

    // ── CHANNEL STAGES ────────────────────────────────────────────────────
    case 'ch_alex':
    case 'ch_chris':
    case 'ch_maddie':
    case 'ch_sarah':
    case 'ch_james': {
      const stage = state.currentStage;
      const agentMap: Record<string, AnyAgent> = { ch_alex: 'alex', ch_chris: 'chris', ch_maddie: 'maddie', ch_sarah: 'sarah', ch_james: 'james' };
      const agent = agentMap[stage];
      const qKey = stage as keyof typeof state.questionCounts;
      const maxQ = stage === 'ch_alex' ? 3 : 2; // Alex=3, Chris=2, Maddie=2

      // ── just_demo mid-flow skip: prospect opted out of numbers ──
      if (state.proceedToROI === false) {
        state.completedStages.push(stage);
        state.currentStage = 'close';
        advanced = true;
        auditStageAdvanced(state, stage, 'close', 'just_demo_skip', 'just_demo_skip', 'turn');
        console.log(`[JUST_DEMO_SKIP] ${stage} → close (proceedToROI=false)`);
        break;
      }

      // ── 24/7 skip: skip ch_maddie at execution time if maddieSkip is true ──
      if (stage === 'ch_maddie' && state.maddieSkip) {
        state.completedStages.push('ch_maddie');
        state.currentStage = nextChannelFromQueue(state);
        advanced = true;
        auditStageAdvanced(state, 'ch_maddie', state.currentStage, 'maddieSkip=true (24/7 coverage)', 'skipped_24_7', 'turn');
        console.log(`[ADVANCE] ch_maddie → ${state.currentStage} (skipped_24_7 — 24/7 phone coverage)`);
        break;
      }

      // Try to run calculator if we have enough data
      const force = shouldForceAdvance(stage, state);
      const budgetDone = maxQuestionsReached(stage, state);

      if (force || budgetDone) {
        // Run calculator if not yet computed
        if (!state.calculatorResults[agent]) {
          tryRunCalculator(stage, state);
        }

        const hasResult = !!state.calculatorResults[agent];
        const hasSpoken = state.spoken.moveIds.includes(`v2_${stage}`);
        // Anti-churn: if stuck past budget + 1 turn, force-advance regardless
        const isStuck = budgetDone && state.questionCounts[qKey] > maxQ;

        if ((hasResult && hasSpoken) || (budgetDone && !hasResult) || isStuck) {
          const completionMode: CompletionMode = isStuck ? 'stuck_escape' : (hasResult && hasSpoken) ? 'complete' : 'budget_exhausted';
          state.completedStages.push(stage);
          // Optional agents return to optional_side_agents; core agents follow the queue
          if (stage === 'ch_sarah' || stage === 'ch_james') {
            state.currentStage = 'optional_side_agents';
          } else {
            state.currentStage = nextChannelFromQueue(state);
          }
          advanced = true;
          auditStageAdvanced(state, stage, state.currentStage, `hasResult=${hasResult} hasSpoken=${hasSpoken} budgetDone=${budgetDone} isStuck=${isStuck} qCount=${state.questionCounts[qKey]}`, completionMode, 'turn');
          console.log(`[ADVANCE] ${stage} → ${state.currentStage} (${completionMode}) (hasResult=${hasResult} hasSpoken=${hasSpoken} budgetDone=${budgetDone} isStuck=${isStuck} qCount=${state.questionCounts[qKey]})`);
        }
        // Otherwise the directive will show ROI this turn — don't advance yet
      }
      break;
    }

    // ── ROI DELIVERY ──────────────────────────────────────────────────────
    case 'roi_delivery': {
      // After user confirms combined ROI, advance
      // Preserve exact spoken-marker check: prefix match on 'v2_roi_delivery'
      if (cleanTranscript.length > 0 && state.spoken.moveIds.some(id => id.startsWith('v2_roi_delivery'))) {
        state.completedStages.push('roi_delivery');
        state.currentStage = 'optional_side_agents';
        advanced = true;
        auditStageAdvanced(state, 'roi_delivery', 'optional_side_agents', 'roi_confirmed', undefined, 'turn');
        console.log(`[ADVANCE] roi_delivery → optional_side_agents`);
      }
      break;
    }

    // ── OPTIONAL SIDE AGENTS ──────────────────────────────────────────────
    case 'optional_side_agents': {
      // Route to Sarah/James if triggered, otherwise advance to close
      if (state.prospectAskedAboutSarah && !state.completedStages.includes('ch_sarah')) {
        state.currentStage = 'ch_sarah';
        advanced = true;
        auditStageAdvanced(state, 'optional_side_agents', 'ch_sarah', 'prospect_asked', undefined, 'turn');
        console.log(`[ADVANCE] optional_side_agents → ch_sarah (prospect asked)`);
      } else if (state.prospectAskedAboutJames && !state.completedStages.includes('ch_james')) {
        state.currentStage = 'ch_james';
        advanced = true;
        auditStageAdvanced(state, 'optional_side_agents', 'ch_james', 'prospect_asked', undefined, 'turn');
        console.log(`[ADVANCE] optional_side_agents → ch_james (prospect asked)`);
      } else {
        state.completedStages.push('optional_side_agents');
        state.currentStage = 'close';
        advanced = true;
        auditStageAdvanced(state, 'optional_side_agents', 'close', 'no_optional_pending', undefined, 'turn');
        console.log(`[ADVANCE] optional_side_agents → close`);
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

  const moveId = `v2_${state.currentStage}${state.currentWowStep ? '_' + state.currentWowStep : ''}`;

  // ═════════════════════════════════════════════════════════════════════════
  // PHASE 4: SET PENDING DELIVERY
  // ═════════════════════════════════════════════════════════════════════════

  setPendingDelivery(state, directive, moveId, 'turn');

  return { directive, moveId, advanced, clearedFailedDelivery };
}
