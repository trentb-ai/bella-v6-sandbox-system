/**
 * call-brain-do/src/types.ts — v2.0.0-do-alpha.1
 * All TypeScript contracts for the Call Brain Durable Object.
 */

// ─── Stage (tightened — 9-stall WOW, merged source question) ─────────────────

export type Stage =
  | 'wow'
  | 'anchor_acv'
  | 'anchor_timeframe'
  | 'ch_website'
  | 'ch_ads'
  | 'ch_phone'
  | 'ch_old_leads'
  | 'ch_reviews'
  | 'roi_delivery'
  | 'close';

export type ChannelStage =
  | 'ch_website'
  | 'ch_ads'
  | 'ch_phone'
  | 'ch_old_leads'
  | 'ch_reviews';

// ─── IndustryLanguagePack ────────────────────────────────────────────────────

export type IndustryLanguagePack = {
  industryLabel: string;
  singularOutcome: string;
  pluralOutcome: string;
  leadNoun: string;
  conversionVerb: string;
  revenueEvent: string;
  kpiLabel: string;
  missedOpportunity: string;
  tone: 'formal' | 'practical' | 'strategic' | 'friendly';
  examples: string[];
};

// ─── CallBrainState (DO-owned, strongly consistent) ──────────────────────────

export type CallBrainState = {
  callId: string;
  leadId: string;
  createdAt: string;
  updatedAt: string;

  // ── Stage machine ──
  stage: Stage;
  wowStall: number;
  completedStages: Stage[];
  currentQueue: Stage[];

  // ── Extracted values (validated before advancing) ──
  extracted: {
    acv: number | null;
    timeframe: 'weekly' | 'monthly' | null;
    web_leads: number | null;
    web_conversions: number | null;
    web_followup_speed: string | null;
    ads_leads: number | null;
    ads_conversions: number | null;
    ads_followup_speed: string | null;
    phone_volume: number | null;
    missed_call_handling: string | null;
    missed_call_callback_speed: string | null;
    old_leads: number | null;
    new_customers: number | null;
    has_review_system: boolean | null;
  };

  // ── Flags ──
  flags: {
    trialMentioned: boolean;
    apifyDone: boolean;
    roiComputed: boolean;
    roiDelivered: boolean;
    justDemo: boolean;
    questionBudgetTight: boolean;
  };

  // ── What's been spoken (prevents repeats) ──
  spoken: {
    moveIds: string[];
    factsUsed: string[];
    agentPitchesGiven: string[];
  };

  // ── Intel (loaded at init, updated via events) ──
  intel: {
    fast: Record<string, unknown> | null;
    consultant: Record<string, unknown> | null;
    deep: Record<string, unknown> | null;
    industryLanguage: IndustryLanguagePack | null;
    mergedVersion: number;
  };

  // ── ROI (computed by DO, not bridge) ──
  roi: {
    agentValues: Record<string, number>;
    totalValue: number | null;
  };

  // ── Intel version tracking (dedup stale events) ──
  intelVersions: {
    fast?: number;
    consultant?: number;
    deep?: number;
  };

  // ── Retry tracking ──
  retry: {
    extractionMisses: Record<string, number>;
    stageLoops: number;
  };

  // ── Watchdog (alarm-driven per-call monitoring) ──
  watchdog: {
    mustDeliverRoiNext: boolean;
    deepIntelMissingEscalation: boolean;
    lastTurnAt: string | null;
    nextChecks: Array<'deep_missing' | 'roi_pending' | 'call_stale' | 'stage_loop'>;
  };
};

// ─── BrainEvent (workflow/services → DO) ─────────────────────────────────────

export type BrainEvent =
  | { type: 'session_init'; leadId: string; starterIntel?: Record<string, unknown> }
  | { type: 'fast_intel_ready'; payload: Record<string, unknown>; version: number }
  | { type: 'consultant_ready'; payload: Record<string, unknown>; version: number }
  | { type: 'deep_ready'; payload: Record<string, unknown>; version: number }
  | { type: 'user_turn'; transcript: string; turnId: string; ts: string }
  | { type: 'llm_reply_done'; spokenText: string; moveId: string; ts: string }
  | { type: 'call_end'; reason: string; ts: string };

// ─── NextTurnPacket (DO → bridge, per-turn response) ─────────────────────────

export type NextTurnPacket = {
  stage: Stage;
  wowStall: number | null;
  objective: string;
  chosenMove: {
    id: string;
    kind: 'question' | 'insight' | 'bridge' | 'roi' | 'close';
    text: string;
  };
  criticalFacts: string[];
  extractTargets: string[];
  validation: {
    mustCaptureAny: string[];
    advanceOnlyIf: string[];
    doNotAdvanceIf: string[];
  };
  style: {
    tone: string;
    industryTerms: string[];
    maxSentences: number;
    noApology: boolean;
  };
  roi?: {
    agentValues: Record<string, number>;
    totalValue: number;
  };
};

// ─── ExtractionResult ────────────────────────────────────────────────────────

export type ExtractionResult = {
  fields: Record<string, number | string | boolean | null>;
  confidence: number;
  raw: string;
  normalized: Record<string, string>;
};

// ─── Env binding ─────────────────────────────────────────────────────────────

export interface Env {
  CALL_BRAIN: DurableObjectNamespace;
  LEADS_KV: KVNamespace;
}
