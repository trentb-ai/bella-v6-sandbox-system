/**
 * call-brain-do/src/index.ts — v2.1.0-hardened
 * CallBrainDO: Durable Object HTTP handler.
 *
 * V2.1.0 fixes:
 *   - ensureSession: idempotent session init (FIX 1)
 *   - Turn dedup: cache by turnId + transcriptHash (FIX 2)
 *   - Version-guarded intel merge (FIX 3)
 *
 * Routes:
 *   POST /turn   — hot path: user_turn → extract → gate → NextTurnPacket
 *   POST /event  — all other BrainEvents (session_init, intel, llm_reply_done, call_end)
 *   GET  /state  — debug/shadow-mode state snapshot
 */

import type { Env, BrainEvent, NextTurnPacket, CallBrainState } from './types';
import { initState, loadState, persistState } from './state';
import { extractFromTranscript, applyExtraction } from './extract';
import { advanceIfGateOpen, advance } from './gate';
import { buildNextTurnPacket } from './moves';
import { mergeIntel, initQueueFromIntel } from './intel';
import { computeROI } from './roi';

// ─── SHA-256 helper for turn dedup ──────────────────────────────────────────

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Version guard for intel events ─────────────────────────────────────────

function shouldApplyVersion(next: number, current?: number): boolean {
  return current == null || next > current;
}

// ─── Durable Object ─────────────────────────────────────────────────────────

export class CallBrainDO {
  private state: DurableObjectState;
  private env: Env;

  constructor(state: DurableObjectState, env: Env) {
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

  // ── FIX 1: Idempotent session creation ──────────────────────────────────────

  private async ensureSession(
    leadId: string,
    starterIntel?: Record<string, unknown>,
  ): Promise<{ brain: CallBrainState; created: boolean }> {
    let brain = await loadState(this.state.storage);

    if (!brain) {
      // Fresh session
      brain = initState(this.state.id.toString(), leadId);
      if (starterIntel) {
        brain.intel.fast = starterIntel;
        brain.intel.mergedVersion = 1;
        initQueueFromIntel(brain);
      }
      await persistState(this.state.storage, brain);
      console.log(`[INIT] callId=${this.state.id.toString()} leadId=${leadId} queue=[${brain.currentQueue.join(',')}]`);
      return { brain, created: true };
    }

    // State exists — merge intel ONLY if missing, never reset
    if (!brain.leadId) brain.leadId = leadId;
    if (starterIntel && !brain.intel.fast) {
      brain.intel.fast = starterIntel;
      brain.intel.mergedVersion = Math.max(brain.intel.mergedVersion, 1);
    }
    await persistState(this.state.storage, brain);
    console.log(`[ENSURE] existing session — stage=${brain.stage} stall=${brain.wowStall} (not reset)`);
    return { brain, created: false };
  }

  // ── POST /turn — hot path with dedup (FIX 2) ───────────────────────────────

  private async handleTurn(request: Request): Promise<Response> {
    const body = await request.json<{
      leadId?: string;
      transcript: string;
      turnId: string;
      ts?: string;
    }>();

    const { transcript, turnId, leadId } = body;

    // Self-heal: ensure session exists (lazy init on /turn)
    const { brain } = await this.ensureSession(leadId ?? 'unknown');

    // ── FIX 2: Dedup by turnId + transcript hash ──
    const cleanTranscript = (transcript || '').trim();
    const hash = await sha256Hex(cleanTranscript);
    const cacheKey = `turn:${turnId}:${hash}`;

    const cached = await this.state.storage.get<any>(cacheKey);
    if (cached) {
      console.log(`[DEDUP] turnId=${turnId} — returning cached packet`);
      return json({ ...cached, dedup: true });
    }

    // 1. Extract values from transcript
    const targets = extractTargetsForCurrentStage(brain);
    const result = extractFromTranscript(transcript, targets, brain.stage, brain.intel.industryLanguage?.industryLabel, brain.extracted);
    const applied = applyExtraction(brain, result);

    console.log(`[TURN] turnId=${turnId} stage=${brain.stage} stall=${brain.wowStall} extracted=[${applied.join(',')}]`);

    // 2. Gate check + advance
    let advanced = advanceIfGateOpen(brain);
    if (advanced) {
      console.log(`[ADVANCE] → ${brain.stage}`);
    }

    // 3. WOW stall increment (if still in wow and didn't advance)
    if (!advanced && brain.stage === 'wow') {
      brain.wowStall = Math.min(brain.wowStall + 1, 10);
    }

    // 3b. Channel stage escape hatch: force-advance after 5 loops
    if (!advanced && brain.stage.startsWith('ch_') && brain.retry.stageLoops >= 5) {
      console.log(`[ESCAPE] force-advancing from ${brain.stage} after ${brain.retry.stageLoops} stalls`);
      advanceIfGateOpen(brain);
      if (brain.stage.startsWith('ch_')) {
        advance(brain);
        advanced = true;
        console.log(`[ADVANCE] → ${brain.stage} (escape)`);
      }
    }

    // 4. Build next turn packet
    const packet = buildNextTurnPacket(brain);

    // 5. Track retry misses
    if (!advanced && targets.length > 0) {
      brain.retry.stageLoops++;
      if (applied.length === 0) {
        for (const t of targets) {
          brain.retry.extractionMisses[t] = (brain.retry.extractionMisses[t] ?? 0) + 1;
        }
      }
    } else if (advanced) {
      brain.retry.stageLoops = 0;
    }

    // 6. Persist state + cache turn result
    const responseBody = {
      packet,
      extraction: {
        applied,
        confidence: result.confidence,
        normalized: result.normalized,
      },
      extractedState: brain.extracted,
      advanced,
      stage: brain.stage,
      wowStall: brain.wowStall,
    };

    await persistState(this.state.storage, brain);
    await this.state.storage.put(cacheKey, responseBody);

    return json({ ...responseBody, dedup: false });
  }

  // ── POST /event — all other events ─────────────────────────────────────────

  private async handleEvent(request: Request): Promise<Response> {
    const event = await request.json<BrainEvent>();

    switch (event.type) {
      case 'session_init': {
        // Route through ensureSession — idempotent
        const { brain, created } = await this.ensureSession(event.leadId, event.starterIntel);
        const packet = buildNextTurnPacket(brain);
        return json({
          status: created ? 'initialized' : 'existing',
          callId: this.state.id.toString(),
          leadId: event.leadId,
          packet,
          stage: brain.stage,
          wowStall: brain.wowStall,
        });
      }

      case 'fast_intel_ready':
      case 'consultant_ready':
      case 'deep_ready':
        return await this.handleIntelEvent(event);

      case 'user_turn':
        return json({ error: 'use_turn_endpoint', message: 'POST /turn for user turns' }, 400);

      case 'llm_reply_done':
        return await this.handleLlmReplyDone(event);

      case 'call_end':
        return await this.handleCallEnd(event);

      default:
        return json({ error: 'unknown_event', message: `Unknown event type` }, 400);
    }
  }

  // ── Intel events with version guard (FIX 3) ────────────────────────────────

  private async handleIntelEvent(
    event: Extract<BrainEvent, { type: 'fast_intel_ready' | 'consultant_ready' | 'deep_ready' }>,
  ): Promise<Response> {
    // Intel can arrive BEFORE first /turn — ensureSession creates session if needed
    const callId = this.state.id.toString();
    const { brain } = await this.ensureSession(callId);

    // Version guard: only apply if version > last applied
    const intelType = event.type === 'fast_intel_ready' ? 'fast'
      : event.type === 'consultant_ready' ? 'consultant'
      : 'deep';

    if (!shouldApplyVersion(event.version, brain.intelVersions[intelType])) {
      console.log(`[INTEL_SKIP] type=${event.type} version=${event.version} <= current=${brain.intelVersions[intelType]}`);
      return json({
        status: 'skipped',
        reason: 'stale_version',
        type: event.type,
        version: event.version,
        currentVersion: brain.intelVersions[intelType],
      });
    }

    // Version accepted — merge
    brain.intelVersions[intelType] = event.version;
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

    if (event.moveId && !brain.spoken.moveIds.includes(event.moveId)) {
      brain.spoken.moveIds.push(event.moveId);
    }

    if (event.moveId === 'roi_delivery_total') {
      brain.flags.roiDelivered = true;
      advanceIfGateOpen(brain);
    }

    if (event.moveId?.endsWith('_roi')) {
      const agentName = event.moveId.replace('ch_', '').replace('_roi', '');
      if (!brain.spoken.agentPitchesGiven.includes(agentName)) {
        brain.spoken.agentPitchesGiven.push(agentName);
      }
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
    case 'ch_website': return ['web_leads', 'web_conversions', 'web_followup_speed'];
    case 'ch_ads': return ['ads_leads', 'ads_conversions', 'ads_followup_speed'];
    case 'ch_phone': return ['phone_volume', 'missed_call_handling', 'missed_call_callback_speed'];
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

    if (url.pathname === '/health') {
      return json({ status: 'ok', version: '2.1.0-hardened', worker: 'call-brain-do' });
    }

    const callId = request.headers.get('x-call-id') ?? url.searchParams.get('callId');
    if (!callId) {
      return json({ error: 'missing_call_id', message: 'Provide x-call-id header or callId param' }, 400);
    }

    const doId = env.CALL_BRAIN.idFromName(callId);
    const stub = env.CALL_BRAIN.get(doId);

    return stub.fetch(request);
  },
};
