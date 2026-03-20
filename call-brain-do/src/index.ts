/**
 * call-brain-do/src/index.ts — v2.0.0-do-alpha.1
 * CallBrainDO: Durable Object HTTP handler.
 *
 * Routes:
 *   POST /turn   — hot path: user_turn → extract → gate → NextTurnPacket
 *   POST /event  — all other BrainEvents (session_init, intel, llm_reply_done, call_end)
 *   GET  /state  — debug/shadow-mode state snapshot
 */

import type { Env, BrainEvent, NextTurnPacket, CallBrainState } from './types';
import { initState, loadState, persistState } from './state';
import { extractFromTranscript, applyExtraction } from './extract';
import { advanceIfGateOpen } from './gate';
import { buildNextTurnPacket } from './moves';
import { mergeIntel, initQueueFromIntel } from './intel';
import { computeROI } from './roi';

// ─── Durable Object ─────────────────────────────────────────────────────────

export class CallBrainDO {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
    // Cheap constructor — hibernation-safe
    this.state = state;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (request.method === 'POST' && path === '/turn') {
        return await this.handleTurn(request);
      }
      if (request.method === 'POST' && path === '/event') {
        return await this.handleEvent(request);
      }
      if (request.method === 'GET' && path === '/state') {
        return await this.handleGetState();
      }

      return json({ error: 'not_found', message: `Unknown route: ${request.method} ${path}` }, 404);
    } catch (err: any) {
      console.error('[CallBrainDO] Unhandled error:', err.message, err.stack);
      return json({ error: 'internal', message: err.message }, 500);
    }
  }

  // ── POST /turn — hot path ──────────────────────────────────────────────────

  private async handleTurn(request: Request): Promise<Response> {
    const body = await request.json<{
      transcript: string;
      turnId: string;
      ts?: string;
    }>();

    const brain = await loadState(this.state.storage);
    if (!brain) {
      return json({ error: 'no_session', message: 'Call session_init first' }, 400);
    }

    const { transcript, turnId } = body;

    // 1. Extract values from transcript
    const targets = extractTargetsForCurrentStage(brain);
    const result = extractFromTranscript(transcript, targets, brain.stage, brain.intel.industryLanguage?.industryLabel);
    const applied = applyExtraction(brain, result);

    console.log(`[TURN] turnId=${turnId} stage=${brain.stage} stall=${brain.wowStall} extracted=[${applied.join(',')}]`);

    // 2. Gate check + advance
    const advanced = advanceIfGateOpen(brain);
    if (advanced) {
      console.log(`[ADVANCE] → ${brain.stage}`);
    }

    // 3. WOW stall increment (if still in wow and didn't advance)
    if (!advanced && brain.stage === 'wow') {
      brain.wowStall = Math.min(brain.wowStall + 1, 10);
    }

    // 4. Build next turn packet
    const packet = buildNextTurnPacket(brain);

    // 5. Track retry misses
    if (applied.length === 0 && targets.length > 0) {
      brain.retry.stageLoops++;
      for (const t of targets) {
        brain.retry.extractionMisses[t] = (brain.retry.extractionMisses[t] ?? 0) + 1;
      }
    } else {
      brain.retry.stageLoops = 0;
    }

    // 6. Persist
    await persistState(this.state.storage, brain);

    return json({
      packet,
      extraction: {
        applied,
        confidence: result.confidence,
        normalized: result.normalized,
      },
      advanced,
      stage: brain.stage,
      wowStall: brain.wowStall,
    });
  }

  // ── POST /event — all other events ─────────────────────────────────────────

  private async handleEvent(request: Request): Promise<Response> {
    const event = await request.json<BrainEvent>();

    switch (event.type) {
      case 'session_init':
        return await this.handleSessionInit(event);

      case 'fast_intel_ready':
      case 'consultant_ready':
      case 'deep_ready':
        return await this.handleIntelEvent(event);

      case 'user_turn':
        // user_turn via /event is allowed but callers should prefer /turn
        return json({ error: 'use_turn_endpoint', message: 'POST /turn for user turns' }, 400);

      case 'llm_reply_done':
        return await this.handleLlmReplyDone(event);

      case 'call_end':
        return await this.handleCallEnd(event);

      default:
        return json({ error: 'unknown_event', message: `Unknown event type` }, 400);
    }
  }

  // ── session_init ───────────────────────────────────────────────────────────

  private async handleSessionInit(
    event: Extract<BrainEvent, { type: 'session_init' }>,
  ): Promise<Response> {
    const callId = this.state.id.toString();
    const brain = initState(callId, event.leadId);

    // Seed starter intel if provided
    if (event.starterIntel) {
      brain.intel.fast = event.starterIntel;
      brain.intel.mergedVersion = 1;
      initQueueFromIntel(brain);
    }

    await persistState(this.state.storage, brain);

    console.log(`[INIT] callId=${callId} leadId=${event.leadId} queue=[${brain.currentQueue.join(',')}]`);

    // Return initial packet (wow stall 1)
    const packet = buildNextTurnPacket(brain);

    return json({
      status: 'initialized',
      callId,
      leadId: event.leadId,
      packet,
      stage: brain.stage,
      wowStall: brain.wowStall,
    });
  }

  // ── Intel events ───────────────────────────────────────────────────────────

  private async handleIntelEvent(
    event: Extract<BrainEvent, { type: 'fast_intel_ready' | 'consultant_ready' | 'deep_ready' }>,
  ): Promise<Response> {
    const brain = await loadState(this.state.storage);
    if (!brain) {
      return json({ error: 'no_session', message: 'No active session' }, 400);
    }

    mergeIntel(brain, event);

    // Re-init queue if this is the first intel and queue is empty
    if (brain.currentQueue.length === 0 && brain.stage === 'wow') {
      initQueueFromIntel(brain);
    }

    console.log(`[INTEL] type=${event.type} version=${event.version} mergedVersion=${brain.intel.mergedVersion}`);

    await persistState(this.state.storage, brain);

    return json({
      status: 'merged',
      type: event.type,
      mergedVersion: brain.intel.mergedVersion,
      queueLength: brain.currentQueue.length,
    });
  }

  // ── llm_reply_done ─────────────────────────────────────────────────────────

  private async handleLlmReplyDone(
    event: Extract<BrainEvent, { type: 'llm_reply_done' }>,
  ): Promise<Response> {
    const brain = await loadState(this.state.storage);
    if (!brain) {
      return json({ error: 'no_session', message: 'No active session' }, 400);
    }

    // Track spoken move
    if (event.moveId && !brain.spoken.moveIds.includes(event.moveId)) {
      brain.spoken.moveIds.push(event.moveId);
    }

    // Mark ROI delivered if roi move was spoken
    if (event.moveId === 'roi_delivery_total') {
      brain.flags.roiDelivered = true;
      // Advance if gate now opens (roiDelivered is the gate for roi_delivery stage)
      advanceIfGateOpen(brain);
    }

    // Mark per-channel ROI delivered
    if (event.moveId?.endsWith('_roi')) {
      const agentName = event.moveId.replace('ch_', '').replace('_roi', '');
      if (!brain.spoken.agentPitchesGiven.includes(agentName)) {
        brain.spoken.agentPitchesGiven.push(agentName);
      }
      // Advance past channel stage after ROI is delivered
      advanceIfGateOpen(brain);
    }

    await persistState(this.state.storage, brain);

    return json({
      status: 'recorded',
      moveId: event.moveId,
      stage: brain.stage,
    });
  }

  // ── call_end ───────────────────────────────────────────────────────────────

  private async handleCallEnd(
    event: Extract<BrainEvent, { type: 'call_end' }>,
  ): Promise<Response> {
    const brain = await loadState(this.state.storage);
    if (!brain) {
      return json({ status: 'no_session' });
    }

    // Compute final ROI if not done
    if (!brain.flags.roiComputed) {
      computeROI(brain);
    }

    await persistState(this.state.storage, brain);

    console.log(`[CALL_END] reason=${event.reason} stage=${brain.stage} roi=${brain.roi.totalValue}`);

    return json({
      status: 'ended',
      finalStage: brain.stage,
      completedStages: brain.completedStages,
      roi: brain.roi,
    });
  }

  // ── GET /state ─────────────────────────────────────────────────────────────

  private async handleGetState(): Promise<Response> {
    const brain = await loadState(this.state.storage);
    if (!brain) {
      return json({ error: 'no_session', message: 'No active session' }, 404);
    }
    return json(brain);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTargetsForCurrentStage(state: CallBrainState): string[] {
  switch (state.stage) {
    case 'wow': return ['_just_demo'];
    case 'anchor_acv': return ['acv', 'timeframe'];
    case 'anchor_timeframe': return ['timeframe'];
    case 'ch_website': return ['web_leads', 'web_conversions'];
    case 'ch_ads': return ['ads_leads', 'ads_conversions', 'ads_followup_speed'];
    case 'ch_phone': return ['phone_volume', 'missed_call_handling'];
    case 'ch_old_leads': return ['old_leads'];
    case 'ch_reviews': return ['new_customers', 'has_review_system'];
    case 'roi_delivery': return [];
    case 'close': return [];
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─── Worker entrypoint ──────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Health check
    if (url.pathname === '/health') {
      return json({ status: 'ok', version: '2.0.0-do-alpha.1', worker: 'call-brain-do' });
    }

    // Route to DO by callId (from header or query param)
    const callId = request.headers.get('x-call-id') ?? url.searchParams.get('callId');
    if (!callId) {
      return json({ error: 'missing_call_id', message: 'Provide x-call-id header or callId param' }, 400);
    }

    const doId = env.CALL_BRAIN.idFromName(callId);
    const stub = env.CALL_BRAIN.get(doId);

    return stub.fetch(request);
  },
};
