/**
 * call-brain-do/src/types.ts — v3.0.0-bella-v2
 * V2 TypeScript contracts for the Call Brain Durable Object.
 * SOURCE OF TRUTH: Bella V2 Implementation Package.
 *
 * V1 backward-compat types live at the bottom of this file.
 * They will be removed once all consumers are migrated (Chunks 2+).
 */

// ─── Agent IDs ───────────────────────────────────────────────────────────────

export type CoreAgent = 'alex' | 'chris' | 'maddie';
export type OptionalAgent = 'sarah' | 'james';
export type AnyAgent = CoreAgent | OptionalAgent;

// ─── Stage IDs ───────────────────────────────────────────────────────────────

export type StageId =
  | 'greeting'
  | 'wow'
  | 'recommendation'
  | 'anchor_acv'
  | 'ch_alex'
  | 'ch_chris'
  | 'ch_maddie'
  | 'ch_sarah'
  | 'ch_james'
  | 'roi_delivery'
  | 'optional_side_agents'
  | 'close';

export type WowStepId =
  | 'wow_1_research_intro'
  | 'wow_2_reputation_trial'
  | 'wow_3_icp_problem_solution'
  | 'wow_4_conversion_action'
  | 'wow_5_alignment_bridge'
  | 'wow_6_scraped_observation'
  | 'wow_7_explore_or_recommend'
  | 'wow_8_source_check';

// ─── Enums & Bands ───────────────────────────────────────────────────────────

export type LeadSource = 'website' | 'ads' | 'phone' | 'organic' | 'other' | null;
export type ExplorePreference = 'self_explore' | 'bella_recommend' | null;
export type RoutingConfidence = 'low' | 'medium' | 'high';
export type RoiConfidence = 'low' | 'medium' | 'high';

export type ResponseSpeedBand =
  | 'under_30_seconds'
  | 'under_5_minutes'
  | '5_to_30_minutes'
  | '30_minutes_to_2_hours'
  | '2_to_24_hours'
  | 'next_day_plus'
  | 'unknown';

// ─── Industry Language Pack (unchanged from V1) ──────────────────────────────

export interface IndustryLanguagePack {
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
}

// ─── Intel Types ─────────────────────────────────────────────────────────────

export interface PlacesIntel {
  rating?: number | null;
  reviewCount?: number | null;
}

export interface ScriptFills {
  icp_guess?: string | null;
  problem1?: string | null;
  problem2?: string | null;
  solution1?: string | null;
  solution2?: string | null;
  primaryCTA?: string | null;
  primaryCTAShort?: string | null;
  secondaryCTAClause?: string | null;
  scrapedDataSummary?: string | null;
  cta1?: string | null;
  cta2?: string | null;
}

export interface FastIntel {
  business?: string | null;
  industry?: string | null;
  visibleSiteCue?: string | null;
  websiteActions?: string[];
  phoneSignals?: string[];
  adsSignals?: string[];
  websiteExists?: boolean;
  phoneVisible?: boolean;
}

export interface ConsultantIntel {
  industryLanguage?: Partial<IndustryLanguagePack>;
  toneAndVoice?: string | null;
  offerNames?: string[];
  servicePages?: string[];
  notes?: string[];
}

export interface DeepIntel {
  status?: 'idle' | 'pending' | 'done' | 'failed';
  observations?: string[];
}

export interface MergedIntel {
  fast: FastIntel;
  consultant: ConsultantIntel;
  deep: DeepIntel;
  places?: PlacesIntel;
  scriptFills?: ScriptFills;
}

// ─── ROI Input Contracts ─────────────────────────────────────────────────────

export interface AlexRoiInputs {
  acv: number;
  leads: number;
  conversions?: number | null;
  conversionRate?: number | null;
  responseSpeedBand: ResponseSpeedBand;
}

export interface ChrisRoiInputs {
  acv: number;
  leads: number;
  conversions?: number | null;
  conversionRate?: number | null;
}

export interface MaddieRoiInputs {
  acv: number;
  phoneVolume: number;
  missedCalls?: number | null;
  missedCallRate?: number | null;
}

export interface SarahRoiInputs {
  acv: number;
  oldLeads: number;
}

export interface JamesRoiInputs {
  acv: number;
  newCustomersPerWeek: number;
  currentStars: number;          // Current Google star rating (e.g. 3.5, 4.2)
  hasReviewSystem: boolean;      // Already collecting reviews actively?
}

// ─── ROI Result Contracts ────────────────────────────────────────────────────

export interface AgentRoiResult {
  agent: AnyAgent;
  weeklyValue: number;
  confidence: RoiConfidence;
  assumptionsUsed: string[];
  rationale: string;
  conservative: true;
}

export interface CombinedRoiResult {
  totalWeeklyValue: number;
  perAgent: Partial<Record<CoreAgent, AgentRoiResult>>;
  orderedAgents: CoreAgent[];
}

// ─── Stage Policy ────────────────────────────────────────────────────────────

export interface StagePolicy {
  stage: StageId;
  requiredFields: string[];
  minFieldsForEstimate?: string[];
  maxQuestions?: number;
  forceAdvanceWhenSatisfied?: boolean;
  fallbackPolicy?: string[];
  calculatorKey?: 'alex_speed_to_lead' | 'chris_website_conversion' | 'maddie_missed_call_recovery' | 'sarah_database_reactivation' | 'james_reputation_uplift';
}

// ─── Queue & Eligibility ─────────────────────────────────────────────────────

export interface QueueItem {
  stage: Extract<StageId, 'ch_alex' | 'ch_chris' | 'ch_maddie'>;
  agent: CoreAgent;
  priority: number;
  why: string;
}

export interface EligibilityResult {
  alexEligible: boolean;
  chrisEligible: boolean;
  maddieEligible: boolean;
  whyRecommended: string[];
}

export interface QuestionCounts {
  ch_alex: number;
  ch_chris: number;
  ch_maddie: number;
  ch_sarah: number;
  ch_james: number;
}

// ─── ConversationState (V2 — replaces CallBrainState) ────────────────────────

export interface ConversationState {
  // ── Session identity ──
  callId: string;
  leadId: string;
  createdAt: string;
  updatedAt: string;

  // ── Stage machine ──
  currentStage: StageId;
  currentWowStep?: WowStepId | null;
  completedStages: StageId[];
  completedWowSteps: WowStepId[];
  currentQueue: QueueItem[];
  topAgents: CoreAgent[];
  whyRecommended: string[];

  // ── Prospect identity ──
  firstName?: string | null;
  business?: string | null;
  industry?: string | null;
  industryLanguage: IndustryLanguagePack;

  // ── Routing ──
  explorePreference: ExplorePreference;
  routingConfidence: RoutingConfidence;
  leadSourceDominant: LeadSource;
  leadSourceSecondary?: string | null;

  // ── Channel relevance flags ──
  websiteRelevant: boolean;
  phoneRelevant: boolean;
  adsConfirmed: boolean;

  // ── Agent eligibility ──
  alexEligible: boolean;
  chrisEligible: boolean;
  maddieEligible: boolean;

  // ── Flow control ──
  proceedToROI?: boolean | null;
  trialMentioned: boolean;
  questionBudgetTight: boolean;

  // ── ACV (shared anchor for all calculators) ──
  acv?: number | null;

  // ── Alex inputs ──
  inboundLeads?: number | null;
  inboundConversions?: number | null;
  inboundConversionRate?: number | null;
  responseSpeedBand?: ResponseSpeedBand | null;

  // ── Chris inputs ──
  webLeads?: number | null;
  webConversions?: number | null;
  webConversionRate?: number | null;

  // ── Maddie inputs ──
  phoneVolume?: number | null;
  missedCalls?: number | null;
  missedCallRate?: number | null;

  // ── Budgets & results ──
  questionCounts: QuestionCounts;
  calculatorResults: Partial<Record<AnyAgent, AgentRoiResult>>;

  // ── Optional agent flags ──
  prospectAskedAboutSarah?: boolean;
  prospectAskedAboutJames?: boolean;

  // ── Sarah (database reactivation) inputs ──
  oldLeads?: number | null;

  // ── James (reputation manager) inputs ──
  newCustomersPerWeek?: number | null;
  currentStars?: number | null;
  hasReviewSystem?: boolean | null;

  // ── Intel (loaded at init, updated via events) ──
  intel: {
    fast: Record<string, unknown> | null;
    consultant: Record<string, unknown> | null;
    deep: Record<string, unknown> | null;
    industryLanguagePack: IndustryLanguagePack | null;
    mergedVersion: number;
  };

  // ── Intel version tracking (dedup stale events) ──
  intelVersions: {
    fast?: number;
    consultant?: number;
    deep?: number;
  };

  // ── Spoken tracking (prevents repeats) ──
  spoken: {
    moveIds: string[];
    factsUsed: string[];
  };

  // ── Watchdog ──
  watchdog: {
    deepIntelMissingEscalation: boolean;
    lastTurnAt: string | null;
  };

  // ── Transcript log (append-only, capped at 200 entries) ──
  transcriptLog: TranscriptEntry[];

  // ── Durable memory notes (capped at 100 entries) ──
  memoryNotes: MemoryNote[];

  // ── Scribe note tracking (per-turnIndex accepted IDs) ──
  scribeProcessed?: Record<number, string[]>;

  // ── Flow harness (Chunk 1 scaffold) ──
  pendingDelivery: PendingDelivery | null;
  flowLog: FlowEntry[];
  flowSeq: number;
  consecutiveTimeouts: number;
}

// ─── Transcript & Memory ────────────────────────────────────────────────────

export interface TranscriptEntry {
  role: 'user' | 'bella';
  text: string;
  turnId?: string;
  ts: string;
}

export interface MemoryNote {
  /** Stable deterministic ID: category-hash-tN */
  id: string;
  text: string;
  category: MemoryCategory;
  tags?: string[];
  /** Who said this */
  source: 'user' | 'bella';
  /** Index into transcriptLog where this was captured */
  sourceTurnIndex?: number;
  confidence: 'stated' | 'inferred';
  /** ISO timestamp when created */
  createdAt: string;
  /** ISO timestamp if updated/corrected */
  updatedAt?: string;
  /** Whether this note is active or has been replaced */
  status: 'active' | 'superseded' | 'fulfilled';
  /** ID of the note that replaced this one */
  supersededById?: string;
  /** Persistence scope for cross-call use */
  scope: 'session' | 'lead' | 'account';
  /** Importance for retrieval: 1=low, 2=normal, 3=high */
  salience?: 1 | 2 | 3;
}

// TODO: COMMITMENT LIFECYCLE — future follow-up tracking:
// 'fulfilled' status is supported on MemoryNote.status.
// To mark a commitment fulfilled, set status='fulfilled' and updatedAt to current ISO string.
// Future: add fulfilledAt?: string, fulfilledBy?: string for audit trail.

export type MemoryCategory =
  | 'preference'
  | 'personal'
  | 'business_context'
  | 'objection'
  | 'relationship'
  | 'scheduling'
  | 'communication_style'
  | 'constraint'
  | 'roi_context'
  | 'commitment'
  | 'other';

// ─── Extraction Result (V2 — replaces V1 any alias) ────────────────────────

export interface ExtractionResult {
  fields: Partial<Record<string, number | string | boolean | null>>;
  confidence: number;
  raw: string;
  normalized: Record<string, string>;
  correctionDetected: boolean;
  memoryNotes: MemoryNote[];
}

// ─── Stage Directive I/O ─────────────────────────────────────────────────────

export interface StageDirectiveInput {
  stage: StageId;
  wowStep?: WowStepId | null;
  intel: MergedIntel;
  state: ConversationState;
}

export interface StageDirective {
  objective: string;
  allowedMoves: string[];
  requiredData: string[];
  minFieldsForEstimate?: string[];
  maxQuestions?: number;
  forceAdvanceWhenSatisfied?: boolean;
  fallbackPolicy?: string[];
  calculatorKey?: StagePolicy['calculatorKey'];
  speak: string;
  ask: boolean;
  extract?: string[];
  waitForUser: boolean;
  canSkip: boolean;
  skipReason?: string;
  advanceOn?: string[];
  notes?: string[];
}

// ─── Flow Harness Types ──────────────────────────────────────────────────────

export type DeliveryStatus = 'pending' | 'completed' | 'barged_in' | 'failed';

export interface DeliveryResolution {
  status: DeliveryStatus;
  reason: string;
  ts: string;
}

export interface PendingDelivery {
  deliveryId: string;
  moveId: string;
  stage: StageId;
  wowStep?: WowStepId | null;
  waitForUser: boolean;
  issuedAt: number;
  seq: number;
  status: DeliveryStatus;
  resolution?: string;
  completedAt?: number;
  attempts: number;
}

export type FlowAction =
  | 'directive_issued'
  | 'delivery_resolved'
  | 'stage_advanced'
  | 'step_skipped'
  | 'stale_event'
  | 'call_degraded';

export type CompletionMode = 'complete' | 'budget_exhausted' | 'stuck_escape';

export interface FlowEntry {
  seq: number;
  action: FlowAction;
  stage: StageId;
  wowStep?: WowStepId | null;
  ts: string;
  detail?: string;
  completionMode?: CompletionMode;
}

export interface FlowResult {
  directive: StageDirective;
  moveId: string;
  advanced: boolean;
}

// ─── BrainEvent (workflow/services → DO) ─────────────────────────────────────

export type BrainEvent =
  | { type: 'session_init'; leadId: string; starterIntel?: Record<string, unknown> }
  | { type: 'fast_intel_ready'; payload: Record<string, unknown>; version: number }
  | { type: 'consultant_ready'; payload: Record<string, unknown>; version: number }
  | { type: 'deep_ready'; payload: Record<string, unknown>; version: number }
  | { type: 'user_turn'; transcript: string; turnId: string; ts: string }
  | { type: 'llm_reply_done'; spokenText: string; moveId: string; deliveryId?: string; ts: string }
  | { type: 'delivery_barged_in'; deliveryId: string; moveId: string; ts: string }
  | { type: 'delivery_failed'; deliveryId: string; moveId: string; errorCode?: string; ts: string }
  | { type: 'call_end'; reason: string; ts: string };

// ─── Env binding ─────────────────────────────────────────────────────────────

export interface Env {
  CALL_BRAIN: DurableObjectNamespace;
  LEADS_KV: KVNamespace;
  GEMINI_API_KEY: string;
}

