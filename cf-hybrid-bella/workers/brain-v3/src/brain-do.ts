/**
 * brain-v3/src/brain-do.ts — BrainDO Durable Object
 * Chunk 1 — V3
 *
 * Choreographer: stage machine, TurnPlan gen, deterministic ROI, warm memory.
 * Zero Gemini calls — Brain is pure logic.
 */

import { DurableObject } from 'cloudflare:workers';
import { TurnRequestV1, IntelReadyEventV1, ExtractionResultV1 } from '@bella/contracts';
import { emit, checkSLO } from '@bella/telemetry';
import type { TurnRequest, IntelReadyEvent, ExtractionPayload } from '@bella/contracts';
import type { ConversationState, WarmFact, DataSource } from './types';
import { initialState } from './state';
import { hydrateFacts, persistFacts, resolveBusinessName } from './facts';
import { processFlow } from './stage-machine';
import { buildStageDirective } from './moves';
import { buildTurnPlan } from './turn-plan';
import { deriveEligibility } from './gate';
import { buildInitialQueue, deriveTopAgents, rebuildFutureQueueOnLateLoad } from './queue';
import { extractEngagementSignals, scoreEngagement, engagementLevel } from './engagement';
import { mergeIntelEvent, mergeConsultant, mergeDeepScrape } from './intel-merge';
import { deterministicExtract } from './deterministic-extract';
import { queryKB, type KBResult } from './kb';
import { z } from 'zod';

// Minimal validation for partial event payloads (not full IntelReadyEventV1 shape)
const ConsultantEventSchema = z.object({ lid: z.string().min(1), consultant: z.record(z.unknown()) }).passthrough();
const DeepScrapeEventSchema = z.object({ lid: z.string().min(1), deep: z.object({ googleMaps: z.union([z.array(z.unknown()), z.record(z.unknown())]).optional() }).passthrough().optional() }).passthrough();

interface Env {
  DB: D1Database;
  BRAIN_DO: DurableObjectNamespace;
  EXTRACTION_WORKFLOW?: Fetcher;
  BRAIN_VECTORS?: VectorizeIndex;
}

export class BrainDO extends DurableObject {
  private env: Env;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      switch (url.pathname) {
        case '/turn':                    return this.handleTurn(request);
        case '/intel':                   return this.handleIntel(request);
        case '/extraction-result':       return this.handleExtractionResult(request);
        case '/event/fast-intel':        return this.handleEventFastIntel(request);
        case '/event/consultant-ready':  return this.handleEventConsultantReady(request);
        case '/event/deep-scrape':       return this.handleEventDeepScrape(request);
        case '/health':                  return this.handleDoHealth();
        case '/debug':                   return this.handleDebug();
        default:
          return new Response('Not found', { status: 404 });
      }
    } catch (err) {
      console.error(`[BRAIN_ERROR] ${url.pathname}:`, err);
      return Response.json({ error: String(err) }, { status: 500 });
    }
  }

  // ─── POST /turn ─────────────────────────────────────────────────────

  private async handleTurn(request: Request): Promise<Response> {
    const body = await request.json();
    const parsed = TurnRequestV1.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid TurnRequest', details: parsed.error.issues }, { status: 400 });
    }
    const turn: TurnRequest = parsed.data;

    // Load or initialize state
    let state = await this.ctx.storage.get<ConversationState>('state');
    if (!state) {
      state = initialState(turn.callId, turn.callId); // leadId = callId for now
      // Hydrate warm facts from D1 on first turn
      state.warmFacts = await hydrateFacts(this.env.DB, state.leadId);
      state.businessName = resolveBusinessName(state.hotMemory, state.warmFacts);
      console.log(`[BRAIN] New call ${turn.callId} warmFacts=${state.warmFacts.length}`);
    }

    state.turnIndex = turn.turnIndex;

    // §10B: call.lifecycle emit once per call — guard against re-emit on DO eviction + reconnect
    if (!state.callStartedEmitted) {
      state.callStartedEmitted = true;
      await this.ctx.storage.put('state', state); // Close DO concurrency window before non-storage awaits
      emit({ family: 'call.lifecycle', callId: turn.callId, ts: Date.now(), event: 'call.started', stage: 'greeting' });
    }

    // NB1: Speaker flag filter — unknown turns skip extraction
    const shouldExtract = turn.speakerFlag === 'prospect';
    if (turn.speakerFlag === 'unknown') {
      console.log(`[BRAIN] turnId=${turn.turnId} speakerFlag=unknown — skipping extraction`);
    }

    // Layer 4: Engagement scoring for prospect utterances
    if (turn.speakerFlag === 'prospect' && turn.utterance.trim().length > 0) {
      const signals = extractEngagementSignals(turn.utterance);
      const turnScore = scoreEngagement(signals);
      state.engagementHistory = [...state.engagementHistory.slice(-4), turnScore];
      state.engagementScore = state.engagementHistory.reduce((a, b) => a + b, 0) / state.engagementHistory.length;
      console.log(`[BRAIN] engagement turnScore=${turnScore} avg=${state.engagementScore.toFixed(2)} level=${engagementLevel(state.engagementScore)}`);
    }

    // §C9: Apply any pending intel that arrived before first turn
    const [pendingFast, pendingConsultant, pendingDeep, pendingLegacy] = await Promise.all([
      this.ctx.storage.get<IntelReadyEvent>('pending_intel_fast'),
      this.ctx.storage.get<unknown>('pending_intel_consultant'),
      this.ctx.storage.get<unknown>('pending_intel_deep'),
      this.ctx.storage.get<IntelReadyEvent>('pending_intel'),
    ]);
    const effectivePendingFast = pendingFast ?? pendingLegacy;
    const intelApplied = !!(effectivePendingFast || pendingConsultant || pendingDeep);
    if (effectivePendingFast) mergeIntelEvent(state, effectivePendingFast);
    if (pendingConsultant) {
      const p = pendingConsultant as import('@bella/contracts').IntelReadyEvent;
      const consultMerged = mergeConsultant(state, p.consultant);
      if (consultMerged > 0) state.consultantReady = true;
    }
    if (pendingDeep) {
      const deep = ((pendingDeep as Record<string, unknown>).deep ?? {}) as Record<string, unknown>;
      mergeDeepScrape(state, deep);
    }
    if (intelApplied) {
      const elig = deriveEligibility(state.intelFlags ?? {}, state.hotMemory);
      state.alexEligible = elig.alexEligible;
      state.chrisEligible = elig.chrisEligible;
      state.maddieEligible = elig.maddieEligible;
      state.whyRecommended = elig.whyRecommended;
      const _cpFast = ((effectivePendingFast?.consultant as Record<string, unknown> | undefined)
        ?.routing as Record<string, unknown> | undefined)
        ?.priority_agents as string[] | undefined;
      const _cpConsult = (((pendingConsultant as Record<string, unknown> | undefined)
        ?.consultant as Record<string, unknown> | undefined)
        ?.routing as Record<string, unknown> | undefined)
        ?.priority_agents as string[] | undefined;
      const consultantPriority = (_cpFast?.length ? _cpFast : undefined)
        ?? (_cpConsult?.length ? _cpConsult : undefined);
      state.topAgents = deriveTopAgents(elig.alexEligible, elig.chrisEligible, elig.maddieEligible, consultantPriority);
      state.currentQueue = buildInitialQueue(state.topAgents);
      state.intelReceived = true;
      await Promise.all([
        this.ctx.storage.delete('pending_intel_fast'),
        this.ctx.storage.delete('pending_intel_consultant'),
        this.ctx.storage.delete('pending_intel_deep'),
        this.ctx.storage.delete('pending_intel'),
      ]);
      console.log(`[BRAIN] applied pending_intel lid=${state.callId} sources=${[pendingFast&&'fast',pendingConsultant&&'consultant',pendingDeep&&'deep'].filter(Boolean).join(',')}`);
    }

    // §10A: brain.turnplan timing
    const t0 = Date.now();
    const preAdvanceStage = state.currentStage;
    // Derive extract targets from the stage's static policy, not the state-dependent directive.
    // anchor_acv always needs ['acv'] regardless of whether ACV is in warmFacts.
    const preAdvanceExtractTargets: string[] = preAdvanceStage === 'anchor_acv'
      ? ['acv']
      : (buildStageDirective(preAdvanceStage, state).extract ?? []);

    // §10B: KB query fired early (prospect turns only) — awaited just before TurnPlan
    const kbPromise = (turn.speakerFlag === 'prospect' && turn.utterance.trim().length > 0)
      ? queryKB(`${state.currentStage}: ${turn.utterance}`, this.env, { topK: 3, clientId: state.callId })
      : Promise.resolve<KBResult[]>([]);

    // Run stage machine first — directive must use post-advance stage
    const didAdvance = processFlow(state, turn.utterance, turn.speakerFlag);
    if (didAdvance) {
      console.log(`[BRAIN] advanced to ${state.currentStage}`);
    }
    const directive = buildStageDirective(state.currentStage, state);

    // Await KB results — fired early above
    const kbResults = await kbPromise;
    // Anti-clobber: re-read state to capture concurrent event handler writes
    // kbPromise yields to other requests; merge intel-only fields one-way
    const postKbState = await this.ctx.storage.get<ConversationState>('state');
    if (postKbState) {
      // Booleans — one-way (never downgrade)
      if (postKbState.intelReceived) state.intelReceived = true;
      if (postKbState.consultantReady) state.consultantReady = true;
      if (postKbState.alexEligible) state.alexEligible = true;
      if (postKbState.chrisEligible) state.chrisEligible = true;
      if (postKbState.maddieEligible) state.maddieEligible = true;
      // intelFlags — one-way merge
      const freshFlags = (postKbState.intelFlags ?? {}) as Record<string, boolean>;
      const mergedFlags: Record<string, boolean> = { ...(state.intelFlags ?? {}) } as Record<string, boolean>;
      for (const [k, v] of Object.entries(freshFlags)) {
        if (v) mergedFlags[k] = true;
      }
      state.intelFlags = mergedFlags;
      // topAgents + queue + recommendation — prefer postKb if populated by event handler
      if (postKbState.topAgents?.length) state.topAgents = postKbState.topAgents;
      if (postKbState.currentQueue?.length) state.currentQueue = postKbState.currentQueue;
      if (postKbState.whyRecommended?.length) state.whyRecommended = postKbState.whyRecommended;
      // businessName — prefer postKb if enriched beyond default
      if (postKbState.businessName && postKbState.businessName !== 'your business') {
        state.businessName = postKbState.businessName;
      }
      // Intel data — event handler is source of truth for these fields
      if (postKbState.consultantData) state.consultantData = postKbState.consultantData;
      if (postKbState.fastIntelData) state.fastIntelData = postKbState.fastIntelData;
      if (postKbState.scriptFills && Object.keys(postKbState.scriptFills).length > 0) {
        state.scriptFills = { ...state.scriptFills, ...postKbState.scriptFills };
      }
      if (postKbState.deepIntel) state.deepIntel = postKbState.deepIntel;
    }
    if (kbResults.length > 0) {
      directive.notes = [
        ...(directive.notes ?? []),
        ...kbResults
          .filter(r => r.content?.trim().length > 0)
          .map(r => `KB[T${r.tier}]: ${r.content.trim().replace(/\n+/g, ' ')}`),
      ];
    }

    // §Sprint5: deterministicExtract — synchronous <1ms, runs before buildTurnPlan
    if (turn.speakerFlag === 'prospect' && turn.utterance.trim().length > 0) {
      // Maintain rolling buffer (last 12 prospect utterances)
      state.recentUserTranscripts = [
        ...(state.recentUserTranscripts ?? []).slice(-11),
        turn.utterance,
      ];
      // Re-scan all buffered turns — fills only empty slots
      const detFields: Record<string, unknown> = {};
      for (const t of state.recentUserTranscripts) {
        const extracted = deterministicExtract(t, preAdvanceStage);
        for (const [key, value] of Object.entries(extracted)) {
          if (value != null && detFields[key] == null) detFields[key] = value;
        }
      }
      // Merge into hotMemory — prospect-stated wins, never overwrite existing
      for (const [key, value] of Object.entries(detFields)) {
        if (value != null && state.hotMemory[key] == null) {
          (state.hotMemory as Record<string, unknown>)[key] = value;
        }
      }
    }

    const plan = buildTurnPlan(state, directive, turn.turnId, turn.utterance, preAdvanceStage);
    const durationMs = Date.now() - t0;

    emit({
      family: 'brain.turnplan',
      callId: state.callId,
      ts: Date.now(),
      durationMs,
      stage: state.currentStage,
      turnId: plan.turnId,
      stageAdvanced: didAdvance,
    });
    checkSLO('transcriptToTurnPlan', durationMs, { callId: state.callId, turnId: plan.turnId });

    // Layer 5: Update priorHotMemoryKeys for next turn's active listening check
    state.priorHotMemoryKeys = Object.keys(state.hotMemory).filter(k => state.hotMemory[k] != null);

    // MUST await state persist before returning (spec Section 12.1)
    await this.ctx.storage.put('state', state);

    // D1 writes — async, non-blocking (append-only / idempotent)
    this.ctx.waitUntil(this.persistTurnToD1(state, turn, plan.stage));

    // Dispatch extraction for prospect turns with targets
    if (shouldExtract && preAdvanceExtractTargets.length > 0 && this.env.EXTRACTION_WORKFLOW) {
      const payload: ExtractionPayload = {
        version: 1,
        callId: state.callId,
        turnId: turn.turnId,
        utterance: turn.utterance,
        speakerFlag: 'prospect',
        stage: preAdvanceStage,
        targets: preAdvanceExtractTargets,
        existingFacts: state.hotMemory,
      };
      this.ctx.waitUntil(
        this.env.EXTRACTION_WORKFLOW.fetch(
          new Request('https://extraction/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        ).catch(err => console.error('[BRAIN] extraction dispatch failed:', err))
      );
    }

    return Response.json(plan);
  }

  // ─── POST /intel ────────────────────────────────────────────────────

  private async handleIntel(request: Request): Promise<Response> {
    const body = await request.json();
    const parsed = IntelReadyEventV1.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid IntelReadyEvent', details: parsed.error.issues }, { status: 400 });
    }
    const intel: IntelReadyEvent = parsed.data;

    let state = await this.ctx.storage.get<ConversationState>('state');
    if (!state) {
      console.log(`[BRAIN] intel arrived before first turn — storing for later`);
      await this.ctx.storage.put('pending_intel_fast', intel);
      return Response.json({ ok: true, note: 'stored_pending' });
    }

    // Write intel facts to D1 — separate sources for scrape vs consultant
    const scrapeFacts: Record<string, string | number | null> = {};
    if (intel.core_identity?.business_name) scrapeFacts.business_name = intel.core_identity.business_name;
    if (intel.core_identity?.industry) scrapeFacts.industry = intel.core_identity.industry;
    if (intel.core_identity?.location) scrapeFacts.location = intel.core_identity.location;

    const consultantFacts: Record<string, string | number | null> = {};
    const consultantData = intel.consultant as Record<string, any> | undefined;
    if (consultantData?.businessIdentity?.correctedName) {
      consultantFacts.business_name = consultantData.businessIdentity.correctedName;
    }
    if (consultantData?.businessIdentity?.industry) {
      consultantFacts.industry = consultantData.businessIdentity.industry;
    }

    // Persist to D1 — two separate calls for correct data_source tagging
    this.ctx.waitUntil(Promise.all([
      this.persistIntelFacts(state.leadId, scrapeFacts, 'scrape'),
      this.persistIntelFacts(state.leadId, consultantFacts, 'consultant'),
    ]));

    // P3 fix: Merge intel facts into in-memory warmFacts so getFact() sees them immediately
    const newWarmFacts: WarmFact[] = [
      ...Object.entries(scrapeFacts)
        .filter(([, v]) => v != null)
        .map(([k, v]) => ({ fact_key: k, fact_value: String(v), data_source: 'scrape' as DataSource, confidence: 0.8 })),
      ...Object.entries(consultantFacts)
        .filter(([, v]) => v != null)
        .map(([k, v]) => ({ fact_key: k, fact_value: String(v), data_source: 'consultant' as DataSource, confidence: 0.95 })),
    ];
    state.warmFacts = [
      ...state.warmFacts.filter(f => !newWarmFacts.find(nf => nf.fact_key === f.fact_key && nf.data_source === f.data_source)),
      ...newWarmFacts,
    ];

    // Update state with intel
    state.intelReceived = true;
    state.businessName = resolveBusinessName(state.hotMemory, state.warmFacts);

    // Derive eligibility from intel flags
    const incomingFlags = (intel.flags ?? {}) as Record<string, boolean>;
    const mergedFlags: Record<string, boolean> = { ...(state.intelFlags ?? {}) } as Record<string, boolean>;
    for (const [k, v] of Object.entries(incomingFlags)) {
      if (v) mergedFlags[k] = true;
    }
    state.intelFlags = mergedFlags;
    const eligibility = deriveEligibility(state.intelFlags, state.hotMemory);
    state.alexEligible = eligibility.alexEligible;
    state.chrisEligible = eligibility.chrisEligible;
    state.maddieEligible = eligibility.maddieEligible;
    state.whyRecommended = eligibility.whyRecommended;

    // Derive top agents (use consultant priority if available)
    const consultantPriority = (intel.consultant as any)?.routing?.priority_agents as string[] | undefined;
    const newTopAgents = deriveTopAgents(
      state.alexEligible, state.chrisEligible, state.maddieEligible, consultantPriority
    );
    state.topAgents = newTopAgents;

    // Rebuild future queue (spec Section 5.8 — future only)
    if (state.currentQueue.length > 0) {
      const futureItems = rebuildFutureQueueOnLateLoad(state, newTopAgents);
      // Keep completed/current items, replace future
      const completedSet = new Set(state.completedStages);
      const kept = state.currentQueue.filter(
        item => completedSet.has(item.stage) || item.stage === state.currentStage
      );
      state.currentQueue = [...kept, ...futureItems];
    } else {
      state.currentQueue = buildInitialQueue(newTopAgents);
    }

    await this.ctx.storage.put('state', state);
    console.log(`[BRAIN] intel received: topAgents=[${state.topAgents}] queue=${state.currentQueue.length}`);

    // §10C: intel.hydration emit — stub wired in Chunk 8
    emit({ family: 'intel.hydration', callId: intel.lid ?? state.callId, ts: Date.now(), source: 'fast-intel', fieldsReceived: Object.keys(intel).length });

    return Response.json({ ok: true });
  }

  // ─── POST /extraction-result ────────────────────────────────────────

  private async handleExtractionResult(request: Request): Promise<Response> {
    const body = await request.json();
    const parsed = ExtractionResultV1.safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: 'Invalid ExtractionResult', details: parsed.error.issues }, { status: 400 });
    }

    let state = await this.ctx.storage.get<ConversationState>('state');
    if (!state) {
      return Response.json({ error: 'No active call' }, { status: 404 });
    }

    // Merge extracted facts into hotMemory
    const extracted = parsed.data.extracted as Record<string, string | number | null>;
    for (const [key, value] of Object.entries(extracted)) {
      if (value != null) {
        state.hotMemory[key] = value;
        console.log(`[BRAIN] extracted ${key}=${value}`);
      }
    }

    // Persist to D1
    this.ctx.waitUntil(
      persistFacts(this.env.DB, state.leadId, extracted, state.currentStage)
        .catch(err => console.error('[BRAIN] persistFacts failed:', err))
    );

    await this.ctx.storage.put('state', state);

    return Response.json({ ok: true });
  }

  // ─── GET /debug ─────────────────────────────────────────────────────

  private async handleDebug(): Promise<Response> {
    const state = await this.ctx.storage.get<ConversationState>('state');
    return Response.json({ state: state ?? null });
  }

  // ─── Private: loadState ─────────────────────────────────────────────

  private async loadState(): Promise<ConversationState | null> {
    return (await this.ctx.storage.get<ConversationState>('state')) ?? null;
  }

  // ─── GET /health (DO-level) ──────────────────────────────────────────

  private async handleDoHealth(): Promise<Response> {
    const state = await this.loadState();
    return Response.json({
      worker: 'brain-do',
      consultantReady: state?.consultantReady ?? false,
      intelReceived: state?.intelReceived ?? false,
      currentStage: state?.currentStage ?? null,
    });
  }

  // ─── POST /event/fast-intel ──────────────────────────────────────────

  private async handleEventFastIntel(request: Request): Promise<Response> {
    let payload: import('@bella/contracts').IntelReadyEvent;
    try {
      payload = await request.json() as import('@bella/contracts').IntelReadyEvent;
    } catch {
      return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    const state = await this.loadState();
    if (!state) {
      await this.ctx.storage.put('pending_intel_fast', payload);
      return Response.json({ ok: true, note: 'stored_pending' });
    }
    const merged = mergeIntelEvent(state, payload);
    state.intelReceived = true;

    if (merged > 0) {
    // Derive eligibility and rebuild queue — MUST mirror pending_intel block in handleTurn
    // Merge payload flags into state.intelFlags before deriving eligibility
    // One-way boolean law: flags only ever false→true, never downgraded.
    const incomingFlags = (payload.flags ?? {}) as Record<string, boolean>;
    const merged: Record<string, boolean> = { ...(state.intelFlags ?? {}) };
    for (const [k, v] of Object.entries(incomingFlags)) {
      if (v) merged[k] = true;  // one-way: only set to true, never downgrade
    }
    state.intelFlags = merged;
    const elig = deriveEligibility(state.intelFlags, state.hotMemory);
    state.alexEligible = elig.alexEligible;
    state.chrisEligible = elig.chrisEligible;
    state.maddieEligible = elig.maddieEligible;
    state.whyRecommended = elig.whyRecommended;
    const consultantPriority = ((payload.consultant as Record<string, unknown> | undefined)
      ?.routing as Record<string, unknown> | undefined)
      ?.priority_agents as string[] | undefined;
    const newTopAgents = deriveTopAgents(
      elig.alexEligible, elig.chrisEligible, elig.maddieEligible, consultantPriority
    );
    state.topAgents = newTopAgents;
    if (state.currentQueue.length > 0) {
      const futureItems = rebuildFutureQueueOnLateLoad(state, newTopAgents);
      const completedSet = new Set(state.completedStages);
      const kept = state.currentQueue.filter(
        item => completedSet.has(item.stage) || item.stage === state.currentStage
      );
      state.currentQueue = [...kept, ...futureItems];
    } else {
      state.currentQueue = buildInitialQueue(newTopAgents);
    }
    } // end if (merged > 0)

    await this.ctx.storage.put('state', state);
    emit({ family: 'intel.hydration', callId: payload.lid, ts: Date.now(), source: 'fast-intel', fieldsReceived: merged });
    console.log(`[BRAIN] /event/fast-intel: topAgents=[${state.topAgents}] queue=${state.currentQueue.length}`);
    return Response.json({ ok: true, merged });
  }

  // ─── POST /event/consultant-ready ───────────────────────────────────

  private async handleEventConsultantReady(request: Request): Promise<Response> {
    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    const validated = ConsultantEventSchema.safeParse(payload);
    if (!validated.success) {
      return Response.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
    }
    const state = await this.loadState();
    if (!state) {
      await this.ctx.storage.put('pending_intel_consultant', validated.data);
      return Response.json({ ok: true, note: 'stored_pending' });
    }
    const p = validated.data as import('@bella/contracts').IntelReadyEvent;
    const merged = mergeConsultant(state, p.consultant);
    if (merged > 0) {
      state.consultantReady = true;
      const elig = deriveEligibility(state.intelFlags ?? {}, state.hotMemory);
      state.alexEligible = elig.alexEligible;
      state.chrisEligible = elig.chrisEligible;
      state.maddieEligible = elig.maddieEligible;
      state.whyRecommended = elig.whyRecommended;
      const consultantPriority = ((p.consultant as Record<string, unknown> | undefined)
        ?.routing as Record<string, unknown> | undefined)
        ?.priority_agents as string[] | undefined;
      const newTopAgents = deriveTopAgents(elig.alexEligible, elig.chrisEligible, elig.maddieEligible, consultantPriority);
      state.topAgents = newTopAgents;
      if (state.currentQueue.length > 0) {
        const futureItems = rebuildFutureQueueOnLateLoad(state, newTopAgents);
        const completedSet = new Set(state.completedStages);
        const kept = state.currentQueue.filter(
          item => completedSet.has(item.stage) || item.stage === state.currentStage
        );
        state.currentQueue = [...kept, ...futureItems];
      } else {
        state.currentQueue = buildInitialQueue(newTopAgents);
      }
    }
    state.intelReceived = true;
    await this.ctx.storage.put('state', state);
    return Response.json({ ok: true, merged, consultantReady: state.consultantReady });
  }

  // ─── POST /event/deep-scrape ─────────────────────────────────────────

  private async handleEventDeepScrape(request: Request): Promise<Response> {
    let payload: import('@bella/contracts').IntelReadyEvent;
    try {
      const body = await request.json();
      const result = DeepScrapeEventSchema.safeParse(body);
      if (!result.success) {
        return Response.json({ ok: false, error: 'invalid_payload' }, { status: 400 });
      }
      payload = result.data as import('@bella/contracts').IntelReadyEvent;
    } catch {
      return Response.json({ ok: false, error: 'invalid_json' }, { status: 400 });
    }
    const state = await this.loadState();
    if (!state) {
      await this.ctx.storage.put('pending_intel_deep', payload);
      return Response.json({ ok: true, note: 'stored_pending' });
    }
    const deep = (payload.deep ?? {}) as Record<string, unknown>;
    const merged = mergeDeepScrape(state, deep);
    state.intelReceived = true;
    await this.ctx.storage.put('state', state);
    return Response.json({ ok: true, merged });
  }

  // ─── D1 Helpers ─────────────────────────────────────────────────────

  private async persistTurnToD1(
    state: ConversationState,
    turn: TurnRequest,
    stage: string,
  ): Promise<void> {
    try {
      // Upsert call record FIRST (FK parent must exist before child)
      await this.env.DB.prepare(
        `INSERT INTO calls (id, lid, lead_id, status, total_turns)
         VALUES (?, ?, ?, 'active', ?)
         ON CONFLICT (id) DO UPDATE SET total_turns = excluded.total_turns, status = 'active'`
      ).bind(state.callId, state.callId, state.leadId, turn.turnIndex + 1).run();

      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO call_turns (call_id, turn_index, turn_id, speaker, utterance, stage)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).bind(
        state.callId, turn.turnIndex, turn.turnId,
        turn.speakerFlag, turn.utterance ?? '', stage
      ).run();
    } catch (err) {
      console.error('[BRAIN] D1 persist failed:', err);
    }
  }

  private async persistIntelFacts(
    leadId: string,
    facts: Record<string, string | number | null>,
    dataSource: string,
  ): Promise<void> {
    const entries = Object.entries(facts).filter(([, v]) => v != null);
    if (entries.length === 0) return;

    try {
      const stmts = entries.map(([key, value]) =>
        this.env.DB.prepare(
          `INSERT INTO lead_facts (id, lead_id, fact_key, fact_value, data_source, confidence, captured_at, captured_during)
           VALUES (?, ?, ?, ?, ?, 0.8, datetime('now'), 'intel')
           ON CONFLICT (lead_id, fact_key, data_source) DO UPDATE SET
             fact_value = excluded.fact_value,
             captured_at = excluded.captured_at`
        ).bind(`${leadId}_${key}_${dataSource}`, leadId, key, String(value), dataSource)
      );
      await this.env.DB.batch(stmts);
    } catch (err) {
      console.error('[BRAIN] intel facts persist failed:', err);
    }
  }
}
