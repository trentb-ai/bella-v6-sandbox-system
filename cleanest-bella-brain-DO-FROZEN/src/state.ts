/**
 * call-brain-do/src/state.ts — v3.0.1-bella-v2
 * DO storage operations: init, load, persist, V1→V2 migration.
 */

// Cross-call memory persistence: implemented in Chunk 7.
// - exportMemoryToKV: writes active lead/account-scoped notes to KV on call_end
// - importMemoryFromKV: reads prior notes from KV on new session_init
// - mergeImportedMemory: dedup by id, status-aware + latest timestamp wins, 100-note cap
// - TranscriptLog is session-only (not exported cross-call)
// - KV key: lead:{leadId}:memory
// - Known temporary limitation: account-scoped notes are stored under the lead key.
//   True account-level aggregation across multiple leads is a future feature.

import type {
  ConversationState,
  IndustryLanguagePack,
  WowStepId,
  StageId,
  MemoryNote,
} from './types';

// ─── Constants ───────────────────────────────────────────────────────────────

const STATE_KEY = 'call_brain_state';

export const GENERIC_INDUSTRY_PACK: IndustryLanguagePack = {
  industryLabel: 'business',
  singularOutcome: 'client',
  pluralOutcome: 'clients',
  leadNoun: 'lead',
  conversionVerb: 'convert',
  revenueEvent: 'new client won',
  kpiLabel: 'conversion rate',
  missedOpportunity: 'missed opportunity',
  tone: 'friendly',
  examples: [],
};

// ─── Init ────────────────────────────────────────────────────────────────────

export function initState(callId: string, leadId: string): ConversationState {
  const now = new Date().toISOString();
  return {
    // ── Session identity ──
    callId,
    leadId,
    createdAt: now,
    updatedAt: now,

    // ── Stage machine ──
    currentStage: 'greeting',
    currentWowStep: null,
    completedStages: [],
    completedWowSteps: [],
    currentQueue: [],
    topAgents: [],
    whyRecommended: [],

    // ── Prospect identity ──
    firstName: null,
    business: null,
    industry: null,
    industryLanguage: GENERIC_INDUSTRY_PACK,

    // ── Routing ──
    explorePreference: null,
    routingConfidence: 'low',
    leadSourceDominant: null,
    leadSourceSecondary: null,

    // ── Channel relevance flags ──
    websiteRelevant: false,
    phoneRelevant: false,
    adsConfirmed: false,

    // ── Agent eligibility ──
    alexEligible: false,
    chrisEligible: false,
    maddieEligible: false,

    // ── 24/7 phone coverage skip ──
    maddieSkip: false,

    // ── Flow control ──
    proceedToROI: null,
    trialMentioned: false,
    questionBudgetTight: false,

    // ── ACV ──
    acv: null,

    // ── Alex inputs ──
    inboundLeads: null,
    inboundConversions: null,
    inboundConversionRate: null,
    responseSpeedBand: null,

    // ── Chris inputs ──
    webLeads: null,
    webConversions: null,
    webConversionRate: null,

    // ── Maddie inputs ──
    phoneVolume: null,
    missedCalls: null,
    missedCallRate: null,

    // ── Budgets & results ──
    questionCounts: { ch_alex: 0, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
    calculatorResults: {},

    // ── Cross-channel canonical store (Sprint 1B) ──
    unifiedState: {},

    // ── WOW rejection tracking (Sprint 2) ──
    rejectedWowSteps: [],
    lastWowSentiment: null,

    // ── Optional agent flags ──
    prospectAskedAboutSarah: false,
    prospectAskedAboutJames: false,

    // ── Intel ──
    intel: {
      fast: null,
      consultant: null,
      deep: null,
      industryLanguagePack: null,
      mergedVersion: 0,
    },

    // ── Intel version tracking ──
    intelVersions: {},

    // ── Spoken tracking ──
    spoken: {
      moveIds: [],
      factsUsed: [],
    },

    // ── Watchdog ──
    watchdog: {
      deepIntelMissingEscalation: false,
      lastTurnAt: null,
    },

    // ── Transcript & memory ──
    transcriptLog: [],
    memoryNotes: [],

    // ── Monthly normalization ──
    detectedInputUnits: {},

    // ── Flow harness ──
    pendingDelivery: null,
    flowLog: [],
    flowSeq: 0,
    consecutiveTimeouts: 0,

    // ── KV export versioning ──
    kvExportVersion: 0,

    // ── Observability: last-turn intelligence context (FIX 5) ──
    lastCriticalFacts: null,
    lastContextNotes: null,

    // ── Rolling transcript buffer (Sprint E1) ──
    recentUserTranscripts: [],

    // ── Compliance log ──
    complianceLog: [],
  };
}

// ─── Storage Operations ──────────────────────────────────────────────────────

export async function loadState(storage: DurableObjectStorage): Promise<ConversationState | null> {
  const raw = await storage.get(STATE_KEY);
  if (!raw) return null;
  const state = raw as ConversationState;

  // Backward-compat: hydrate flow harness fields on pre-scaffold states
  if (state.pendingDelivery === undefined) state.pendingDelivery = null;
  if (!Array.isArray(state.flowLog)) state.flowLog = [];
  if (typeof state.flowSeq !== 'number') state.flowSeq = 0;
  if (typeof state.consecutiveTimeouts !== 'number') state.consecutiveTimeouts = 0;
  if (!state.detectedInputUnits) state.detectedInputUnits = {};
  if (typeof state.kvExportVersion !== 'number') state.kvExportVersion = 0;
  if (typeof state.maddieSkip !== 'boolean') state.maddieSkip = false;
  if (!Array.isArray(state.recentUserTranscripts)) state.recentUserTranscripts = [];
  if (!Array.isArray(state.rejectedWowSteps)) state.rejectedWowSteps = [];
  if (state.lastWowSentiment === undefined) state.lastWowSentiment = null;

  // Backward-compat: Chunk 3 PendingDelivery field migration
  if (state.pendingDelivery) {
    const p = state.pendingDelivery;
    // issuedAt changed from ISO string to numeric (Date.now())
    if (typeof p.issuedAt === 'string') {
      (p as any).issuedAt = new Date(p.issuedAt as any).getTime() || Date.now();
    }
    // New required fields with defaults
    if (!p.deliveryId) p.deliveryId = `${p.moveId}_${p.seq}`;
    if (!p.status) (p as any).status = 'pending';
    if (typeof p.attempts !== 'number') p.attempts = 1;
  }

  return state;
}

export async function persistState(storage: DurableObjectStorage, state: ConversationState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await storage.put(STATE_KEY, state);
}

// ─── Compatibility Exports (Sprint S0) ──────────────────────────────────────
// Mirror canonical DO state to legacy KV keys for downstream consumers.
// Consumers: bella-tools-worker /resolve_intel_hot, /get_roi_confirmed
//            workflows-backend bella.ts node-s3-kv-get-captured
// These are NOT authoritative state — they are compatibility mirrors only.
// Deterministic overwrites: same state → same payload shape.

/** Map DO ResponseSpeedBand to legacy bridge ads_followup enum */
function mapSpeedBandToLegacy(band: string | null | undefined): string | null {
  if (!band) return null;
  switch (band) {
    case 'under_30_seconds':
    case 'under_5_minutes':
    case '5_to_30_minutes':  return '<30m';
    case '30_minutes_to_2_hours': return '30m_to_3h';
    case '2_to_24_hours':    return '3h_to_24h';
    case 'next_day_plus':    return '>24h';
    default:                 return null;
  }
}

/** Agent name casing: DO uses lowercase, downstream expects capitalized */
const COMPAT_AGENT_NAMES: Record<string, string> = {
  alex: 'Alex', chris: 'Chris', maddie: 'Maddie', sarah: 'Sarah', james: 'James',
};

/**
 * Build legacy captured_inputs payload from canonical DO state.
 * Fields that DO does not track are set to null (matches "not yet captured" semantics).
 * Unmappable: ad_spend, web_followup_speed, phone_conversion, after_hours, missed_call_callback_speed.
 */
export function buildCompatCapturedInputs(brain: ConversationState): Record<string, any> {
  return {
    acv: brain.acv ?? null,
    timeframe: 'weekly',  // Blueprint: weekly canonical unit
    ads_leads: brain.inboundLeads ?? null,
    ads_conversions: brain.inboundConversions ?? null,
    ads_followup: mapSpeedBandToLegacy(brain.responseSpeedBand),
    ad_spend: null,  // Not tracked by DO
    web_leads: brain.webLeads ?? null,
    web_conversions: brain.webConversions ?? null,
    web_followup_speed: null,  // Not tracked by DO
    phone_volume: brain.phoneVolume ?? null,
    phone_conversion: null,  // Not tracked by DO
    after_hours: null,  // Not tracked by DO
    missed_calls: brain.missedCalls ?? null,
    missed_call_callback_speed: null,  // Not tracked by DO
    old_leads: brain.oldLeads ?? null,
    star_rating: brain.currentStars ?? null,
    review_count: (brain.intel.deep as any)?.googleMaps?.review_count ?? null,
    has_review_system: brain.hasReviewSystem ?? null,
    new_cust_per_period: brain.newCustomersPerWeek ?? null,
    updated_at: new Date().toISOString(),
    stage: brain.currentStage,
    lid: brain.leadId,
  };
}

/**
 * Build legacy roi payload from canonical DO calculatorResults.
 * Sarah is excluded from total_monthly per Blueprint Section 11.3 (pool value, not recurring).
 * Returns null if no calculator results exist yet.
 */
export function buildCompatRoi(brain: ConversationState): Record<string, any> | null {
  const allAgents = ['alex', 'chris', 'maddie', 'sarah', 'james'] as const;
  const entries = allAgents
    .map(a => [a, brain.calculatorResults[a]] as const)
    .filter(([_, r]) => r != null);

  if (entries.length === 0) return null;

  const agents: Record<string, any> = {};
  let recurringWeekly = 0;

  for (const [agent, result] of entries) {
    const weekly = result!.weeklyValue;
    const name = COMPAT_AGENT_NAMES[agent] ?? agent;
    agents[name] = {
      monthly_opportunity: Math.round(weekly * 4.33),
      weekly,
      precise: result!.confidence === 'high',
      why: result!.rationale,
    };
    // Sarah excluded from recurring total per Blueprint S11.3
    if (agent !== 'sarah') {
      recurringWeekly += weekly;
    }
  }

  return {
    agents,
    total_monthly: Math.round(recurringWeekly * 4.33),
    inputs_snapshot: buildCompatCapturedInputs(brain),
    updated_at: new Date().toISOString(),
  };
}

/**
 * Export compatibility KV keys for downstream consumers.
 * Non-fatal: KV write failures are logged but never throw.
 * Deterministic: same state produces identical payloads.
 */
export async function exportCompatToKV(
  kv: KVNamespace,
  brain: ConversationState,
): Promise<void> {
  const lid = brain.leadId;
  if (!lid || lid === 'unknown') return;

  try {
    // captured_inputs: always write (deterministic overwrite)
    const capturedPayload = JSON.stringify(buildCompatCapturedInputs(brain));
    await kv.put(`lead:${lid}:captured_inputs`, capturedPayload);

    // roi: write only when calculator results exist
    const roiData = buildCompatRoi(brain);
    if (roiData) {
      await kv.put(`lead:${lid}:roi`, JSON.stringify(roiData));
    }

    console.log(`[COMPAT_EXPORT] lid=${lid} captured=yes roi=${roiData ? 'yes' : 'no_calcs'}`);
  } catch (err: any) {
    console.error(`[COMPAT_EXPORT_ERR] lid=${lid} error=${err.message}`);
  }
}

// ─── Cross-Call Memory Persistence ──────────────────────────────────────────

const MEMORY_KV_PREFIX = 'lead:';
const MEMORY_KV_SUFFIX = ':memory';

function memoryKey(leadId: string): string {
  return `${MEMORY_KV_PREFIX}${leadId}${MEMORY_KV_SUFFIX}`;
}

/**
 * Export active non-session memory notes to KV for cross-call persistence.
 * Non-fatal: KV write failures are logged but never throw.
 *
 * Also writes a legacy-compatible conv_memory export (Sprint DR-3b) for
 * external consumers during bridge-brain deletion migration.
 */
export async function exportMemoryToKV(
  kv: KVNamespace,
  leadId: string,
  memoryNotes: MemoryNote[],
): Promise<void> {
  if (!leadId || leadId === 'unknown') {
    console.warn(`[MEMORY_EXPORT_SKIP] invalid leadId="${leadId}"`);
    return;
  }

  // ── Canonical export: lead:{lid}:memory (structured MemoryNote[]) ──────
  try {
    const exportable = memoryNotes.filter(
      n => n.scope !== 'session' && n.status === 'active',
    );
    const key = memoryKey(leadId);

    if (exportable.length === 0) {
      await kv.delete(key);
      console.log(`[MEMORY_EXPORT] leadId=${leadId} notes=0 (key deleted)`);
    } else {
      await kv.put(key, JSON.stringify(exportable));
      console.log(`[MEMORY_EXPORT] leadId=${leadId} notes=${exportable.length}`);
    }
  } catch (err: any) {
    console.error(`[MEMORY_EXPORT_ERR] leadId=${leadId} error=${err.message}`);
  }

  // ── Legacy conv_memory compatibility export (Sprint DR-3b) ─────────────
  // Architecture:
  //   lead:{lid}:memory      = canonical source of truth (structured MemoryNote[])
  //   lead:{lid}:conv_memory = temporary legacy compatibility mirror for external
  //     consumers (bella-tools /run_deep_analysis, /snapshot; workflows-backend
  //     Stage 3 ROI node) during bridge-brain deletion migration.
  //     Remove this shim after all consumers migrate to lead:{lid}:memory.
  // Best-effort: failures are logged but never thrown or retried.
  // Empty-memory: writes empty string to clear stale bridge data.
  try {
    const convMemory = flattenNotesForLegacyConvMemory(memoryNotes);
    await kv.put(`lead:${leadId}:conv_memory`, convMemory);
    console.log(`[CONV_MEMORY_COMPAT] leadId=${leadId} chars=${convMemory.length}`);
  } catch (err: any) {
    console.error(`[CONV_MEMORY_COMPAT_ERR] leadId=${leadId} error=${err.message}`);
  }
}

/**
 * Flatten active memory notes into a legacy-compatible conv_memory bullet-string.
 *
 * This is a temporary compatibility shim (Sprint DR-3b) — NOT a canonical interface.
 * Canonical memory lives in lead:{lid}:memory as structured MemoryNote[].
 * This output mirrors the bridge's legacy conv_memory format for downstream consumers.
 *
 * Deterministic: same notes → identical output.
 * Ordering: by createdAt ascending (oldest first, matching bridge append behavior).
 * Filtering: active, non-session scope, non-empty text only. Deduped by normalized text.
 * Format: "- [category] text" per line, newline-joined.
 * Empty case: returns empty string (caller writes empty string to KV).
 */
export function flattenNotesForLegacyConvMemory(notes: MemoryNote[]): string {
  // Same filter criteria as canonical export: active + non-session
  const exportable = notes.filter(
    n => n.scope !== 'session' && n.status === 'active' && n.text.trim().length > 0,
  );

  if (exportable.length === 0) return '';

  // Deterministic order: createdAt ascending (oldest first)
  const sorted = [...exportable].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  // Dedupe by normalized text (keep first/oldest occurrence)
  const seen = new Set<string>();
  const deduped: MemoryNote[] = [];
  for (const note of sorted) {
    const normKey = note.text.toLowerCase().trim();
    if (!seen.has(normKey)) {
      seen.add(normKey);
      deduped.push(note);
    }
  }

  // Concise bullet format matching legacy bridge conv_memory style
  return deduped
    .map(n => `- [${n.category}] ${n.text.trim()}`)
    .join('\n');
}

/**
 * Import prior memory notes from KV for a returning lead.
 * Non-fatal: KV read failures return [] and log an error.
 */
export async function importMemoryFromKV(
  kv: KVNamespace,
  leadId: string,
): Promise<MemoryNote[]> {
  if (!leadId || leadId === 'unknown') {
    console.warn(`[MEMORY_IMPORT_SKIP] invalid leadId="${leadId}"`);
    return [];
  }

  try {
    const raw = await kv.get(memoryKey(leadId), 'json') as unknown;
    if (!Array.isArray(raw)) return [];

    // Validate each note defensively
    const valid: MemoryNote[] = [];
    for (const note of raw) {
      if (
        note && typeof note === 'object'
        && typeof note.id === 'string'
        && typeof note.text === 'string'
        && typeof note.status === 'string'
        && typeof note.scope === 'string'
      ) {
        valid.push(note as MemoryNote);
      } else {
        console.warn(`[MEMORY_IMPORT_REJECT] malformed note id=${note?.id ?? 'missing'}`);
      }
    }

    console.log(`[MEMORY_IMPORT] leadId=${leadId} notes=${valid.length}`);
    return valid;
  } catch (err: any) {
    console.error(`[MEMORY_IMPORT_ERR] leadId=${leadId} error=${err.message}`);
    return [];
  }
}

/**
 * Merge imported cross-call notes with current session notes.
 * Dedup by id. Precedence: active > superseded, then newer timestamp, then existing.
 * Returns merged array sorted by createdAt ascending, capped at 100.
 */
export function mergeImportedMemory(
  existing: MemoryNote[],
  imported: MemoryNote[],
): MemoryNote[] {
  const map = new Map<string, MemoryNote>();

  // Seed with existing (session-local) notes
  for (const note of existing) {
    map.set(note.id, note);
  }

  // Merge imported notes
  for (const imp of imported) {
    const curr = map.get(imp.id);
    if (!curr) {
      map.set(imp.id, imp);
      continue;
    }

    // Collision: apply precedence rules
    const STATUS_RANK: Record<string, number> = { active: 2, fulfilled: 1, superseded: 0 };
    const currRank = STATUS_RANK[curr.status] ?? 0;
    const impRank = STATUS_RANK[imp.status] ?? 0;

    if (impRank > currRank) {
      // Imported has higher-priority status — use it
      map.set(imp.id, imp);
    } else if (impRank === currRank) {
      // Same status — newer timestamp wins, ties prefer existing
      const currTs = curr.updatedAt ?? curr.createdAt;
      const impTs = imp.updatedAt ?? imp.createdAt;
      if (impTs > currTs) {
        map.set(imp.id, imp);
      }
      // else keep existing (session-local is fresher)
    }
    // else imported has lower-priority status — keep existing
  }

  // Sort by createdAt ascending and cap at 100
  const merged = [...map.values()].sort((a, b) =>
    a.createdAt.localeCompare(b.createdAt),
  );

  if (merged.length > 100) {
    return merged.slice(-100);
  }

  return merged;
}

// ─── V1 → V2 Migration ──────────────────────────────────────────────────────

const V1_STAGE_MAP: Record<string, StageId> = {
  wow: 'wow',
  anchor_acv: 'anchor_acv',
  anchor_timeframe: 'anchor_acv',        // timeframe removed in V2, fall back to acv
  ch_website: 'ch_chris',
  ch_ads: 'ch_alex',
  ch_phone: 'ch_maddie',
  ch_old_leads: 'roi_delivery',           // Sarah removed from core flow
  ch_reviews: 'roi_delivery',             // James removed from core flow
  roi_delivery: 'roi_delivery',
  close: 'close',
};

const V1_WOW_STEP_MAP: Record<number, WowStepId> = {
  1: 'wow_1_research_intro',
  2: 'wow_2_reputation_trial',
  3: 'wow_3_icp_problem_solution',
  4: 'wow_4_conversion_action',
  5: 'wow_5_alignment_bridge',
  6: 'wow_6_scraped_observation',
  7: 'wow_7_explore_or_recommend',
  // 8+ maps to wow_8_source_check
};

/**
 * Maps a V1 ads_followup_speed string to V2 ResponseSpeedBand.
 */
function mapResponseSpeed(v1Speed: string | null | undefined): ConversationState['responseSpeedBand'] {
  if (!v1Speed) return null;
  switch (v1Speed) {
    case '<30m': return 'under_5_minutes';
    case '30m_to_3h': return '30_minutes_to_2_hours';
    case '3h_to_24h': return '2_to_24_hours';
    case '>24h': return 'next_day_plus';
    default: return null;
  }
}

/**
 * Migrate a V1 CallBrainState (any shape) to V2 ConversationState.
 * Handles all known V1 field mappings. Ambiguous fields are documented with TODOs.
 */
export function migrateV1toV2(old: any): ConversationState {
  if (!old || typeof old !== 'object') {
    return initState('unknown', 'unknown');
  }

  // ── Stage mapping ──
  const v1Stage: string = old.stage ?? '';
  const currentStage: StageId = V1_STAGE_MAP[v1Stage] ?? 'greeting';

  // ── WOW step mapping ──
  const v1Stall: number = typeof old.wowStall === 'number' ? old.wowStall : 0;
  const currentWowStep: WowStepId | null =
    currentStage === 'wow'
      ? (V1_WOW_STEP_MAP[v1Stall] ?? 'wow_8_source_check')
      : null;

  // ── Completed WOW steps (derive from stall number) ──
  const completedWowSteps: WowStepId[] = [];
  if (currentStage === 'wow' && v1Stall > 1) {
    for (let i = 1; i < v1Stall; i++) {
      const step = V1_WOW_STEP_MAP[i];
      if (step) completedWowSteps.push(step);
    }
  }

  // ── Completed stages (map V1 stage names to V2) ──
  const completedStages: StageId[] = [];
  if (Array.isArray(old.completedStages)) {
    for (const s of old.completedStages) {
      const mapped = V1_STAGE_MAP[s];
      if (mapped && !completedStages.includes(mapped)) {
        completedStages.push(mapped);
      }
    }
  }

  // ── Extract V1 field values ──
  const ext = old.extracted ?? {};
  const flags = old.flags ?? {};

  // ── Intel ──
  const oldIntel = old.intel ?? {};

  return {
    // ── Session identity ──
    callId: old.callId ?? 'unknown',
    leadId: old.leadId ?? 'unknown',
    createdAt: old.createdAt ?? new Date().toISOString(),
    updatedAt: old.updatedAt ?? new Date().toISOString(),

    // ── Stage machine ──
    currentStage,
    currentWowStep,
    completedStages,
    completedWowSteps,
    currentQueue: [],  // V1 queue used V1 Stage names — rebuild from intel in Chunk 2
    topAgents: [],
    whyRecommended: [],

    // ── Prospect identity ──
    firstName: null,
    business: null,
    industry: null,
    industryLanguage: GENERIC_INDUSTRY_PACK,

    // ── Routing ──
    explorePreference: null,
    routingConfidence: 'low',
    leadSourceDominant: null,
    leadSourceSecondary: null,

    // ── Channel relevance flags ──
    websiteRelevant: ext.web_leads != null || ext.web_conversions != null,
    phoneRelevant: ext.phone_volume != null,
    adsConfirmed: ext.ads_leads != null || ext.ads_conversions != null,

    // ── Agent eligibility ──
    alexEligible: ext.ads_leads != null,
    chrisEligible: ext.web_leads != null,
    maddieEligible: ext.phone_volume != null,

    // ── 24/7 phone coverage skip ──
    maddieSkip: false,

    // ── Flow control ──
    proceedToROI: null,
    trialMentioned: flags.trialMentioned ?? false,
    questionBudgetTight: flags.questionBudgetTight ?? false,

    // ── ACV ──
    acv: ext.acv ?? null,

    // ── Alex inputs ──
    // TODO: verify mapping — V1 treated ads as a separate channel, V2 maps ads→Alex
    inboundLeads: ext.ads_leads ?? null,
    inboundConversions: ext.ads_conversions ?? null,
    inboundConversionRate: null,  // V1 didn't store a derived rate
    responseSpeedBand: mapResponseSpeed(ext.ads_followup_speed),

    // ── Chris inputs ──
    webLeads: ext.web_leads ?? null,
    webConversions: ext.web_conversions ?? null,
    webConversionRate: null,  // V1 didn't store a derived rate

    // ── Maddie inputs ──
    phoneVolume: ext.phone_volume ?? null,
    // TODO: V1 stored missed_call_handling as a string description, V2 needs a number.
    // Setting both null — manual review needed for active calls during migration.
    missedCalls: null,
    missedCallRate: null,

    // ── Budgets & results ──
    questionCounts: { ch_alex: 0, ch_chris: 0, ch_maddie: 0, ch_sarah: 0, ch_james: 0 },
    calculatorResults: {},

    // ── Cross-channel canonical store (Sprint 1B) ──
    unifiedState: {},

    // ── WOW rejection tracking (Sprint 2) ──
    rejectedWowSteps: [],
    lastWowSentiment: null,

    // ── Optional agent flags ──
    prospectAskedAboutSarah: false,
    prospectAskedAboutJames: false,

    // ── Intel (copy directly from V1) ──
    intel: {
      fast: oldIntel.fast ?? null,
      consultant: oldIntel.consultant ?? null,
      deep: oldIntel.deep ?? null,
      industryLanguagePack: oldIntel.industryLanguage ?? null,  // V1 key was "industryLanguage"
      mergedVersion: oldIntel.mergedVersion ?? 0,
    },

    // ── Intel version tracking ──
    intelVersions: old.intelVersions ?? {},

    // ── Spoken tracking ──
    spoken: {
      moveIds: old.spoken?.moveIds ?? [],
      factsUsed: old.spoken?.factsUsed ?? [],
      // V1 had agentPitchesGiven — dropped in V2
    },

    // ── Watchdog ──
    watchdog: {
      deepIntelMissingEscalation: old.watchdog?.deepIntelMissingEscalation ?? false,
      lastTurnAt: old.watchdog?.lastTurnAt ?? null,
    },

    // ── Transcript & memory ──
    transcriptLog: old.transcriptLog ?? [],
    // Backfill Chunk 6.1 memory fields on legacy notes
    memoryNotes: (old.memoryNotes ?? []).map((note: any, i: number) => ({
      ...note,
      id: note.id ?? `legacy-${i}`,
      source: note.source ?? 'user',
      status: note.supersededBy != null ? 'superseded' as const : (note.status ?? 'active' as const),
      supersededById: note.supersededById ?? undefined,
      scope: note.scope ?? 'lead',
      confidence: note.confidence ?? 'stated',
      createdAt: note.createdAt ?? old.createdAt ?? new Date().toISOString(),
      salience: note.salience ?? 2,
    })),

    // ── Monthly normalization ──
    detectedInputUnits: {},

    // ── Flow harness ──
    pendingDelivery: null,
    flowLog: [],
    flowSeq: 0,
    consecutiveTimeouts: 0,

    // ── KV export versioning ──
    kvExportVersion: 0,

    // ── Observability: last-turn intelligence context (FIX 5) ──
    lastCriticalFacts: null,
    lastContextNotes: null,

    // ── Rolling transcript buffer (Sprint E1) ──
    recentUserTranscripts: [],

    // ── Compliance log ──
    complianceLog: [],
  };
}
