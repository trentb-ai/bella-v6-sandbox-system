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

// ─── Cross-Channel State (Sprint 1B) ─────────────────────────────────────────

/** Canonical cross-channel field store — prevents re-asking captured data. */
export interface UnifiedLeadState {
  inbound_volume_weekly?: number;
  conversion_rate?: number;
  avg_client_value?: number;
  response_time_hours?: number;
  // Timestamps for 2-minute correction window
  inbound_volume_weekly_set_at?: number;
  conversion_rate_set_at?: number;
  avg_client_value_set_at?: number;
  response_time_hours_set_at?: number;
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

  // ── Explicit skip flags (only set by prospect feedback, never by data absence) ──
  maddieSkip: boolean;
  chrisSkip: boolean;

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

  // ── Close stage sub-states ──
  closeSubStage?: 'offer' | 'email_capture' | 'confirmed' | 'agent_handoff' | null;
  closeChoice?: 'trial' | 'demo' | null;
  closeComplete?: boolean | null;
  trialEmail?: string | null;
  agentRequested?: string | null;
  closePricingObjectionPending?: boolean | null;

  // ── Sarah (database reactivation) inputs ──
  oldLeads?: number | null;

  // ── James (reputation manager) inputs ──
  newCustomersPerWeek?: number | null;
  currentStars?: number | null;
  hasReviewSystem?: boolean | null;

  // ── Cross-channel canonical store (Sprint 1B) ──
  unifiedState: UnifiedLeadState;

  // ── WOW rejection tracking (Sprint 2 — Issue 8) ──
  rejectedWowSteps: WowStepId[];
  lastWowSentiment: 'positive' | 'neutral' | 'negative' | null;

  // ── V1 rescript — user override tracking ──
  confirmedICP?: boolean | null;
  overriddenICP?: boolean | null;
  confirmedCTA?: boolean | null;
  overriddenCTA?: boolean | null;
  lowConfidence?: {
    icp?: boolean;
    cta?: boolean;
    step1?: boolean;
  } | null;
  userOverrides?: {
    icp?: string | null;
    problems?: string[] | null;
    primaryCTA?: string | null;
  } | null;
  correctionContext?: {
    icpCorrection?: string | null;
    ctaCorrection?: string | null;
    capturedAt?: string | null;
  } | null;

  // ── V1 rescript — supplement versioning ──
  supplementVersion?: number | null;
  supplementUpdatedAt?: string | null;

  // ── V1 rescript — scriptFills arrival flag (D10+B12) ──
  // Set to true the moment deep_scriptFills are received in DO state (via KV hydrate, supplement, or alarm).
  // WOW6 source selection checks this before falling back to GOOGLE_PRESENCE.
  scriptFillsArrived?: boolean;

  // ── V1 rescript — deep insight dedup ──
  spokenDeepInsightIds?: string[];

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

  // ── Monthly normalization tracking ──
  detectedInputUnits: Record<string, 'weekly' | 'monthly'>;

  // ── Flow harness (Chunk 1 scaffold) ──
  pendingDelivery: PendingDelivery | null;
  flowLog: FlowEntry[];
  flowSeq: number;
  consecutiveTimeouts: number;

  // ── KV export versioning (H1 stale-write prevention) ──
  kvExportVersion: number;

  // ── Observability: last-turn intelligence context (FIX 5) ──
  lastCriticalFacts?: string[] | null;
  lastContextNotes?: string[] | null;

  // ── Rolling transcript buffer (Sprint E1: deterministic extraction) ──
  recentUserTranscripts: string[];

  // ── Compliance log (Sprint A2: closed-loop compliance) ──
  complianceLog: ComplianceLogEntry[];
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

export type DeliveryStatus = 'pending' | 'completed' | 'barged_in' | 'failed' | 'drifted';

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
  missedPhrases?: string[];
  driftCount?: number;
  /** Type-aware timeout (ms) for this delivery. Falls back to DELIVERY_TIMEOUT_MS if absent. */
  timeoutMs?: number;
}

export type FlowAction =
  | 'directive_issued'
  | 'delivery_resolved'
  | 'stage_advanced'
  | 'step_skipped'
  | 'stale_event'
  | 'call_degraded';

export type CompletionMode = 'complete' | 'budget_exhausted' | 'stuck_escape' | 'skipped_24_7' | 'just_demo_skip';

export interface FlowEntry {
  seq: number;
  action: FlowAction;
  stage: StageId;
  wowStep?: WowStepId | null;
  ts: string;
  detail?: string;
  completionMode?: CompletionMode;
  source?: 'turn' | 'alarm' | 'event' | 'scribe';
}

export interface FlowResult {
  directive: StageDirective;
  moveId: string;
  advanced: boolean;
  /** True when the delivery gate just cleared a failed delivery — question was never spoken */
  clearedFailedDelivery?: boolean;
}

// ─── Compliance Types (Sprint A1: closed-loop compliance) ─────────────────────

export interface ComplianceResult {
  compliant: boolean;
  score: number;
  missedPhrases: string[];
  dollarCompliant: boolean | null; // null if no dollar check needed
}

export interface ComplianceLogEntry {
  stage: string;
  ts: number;
  score: number;
  driftType: 'omission' | 'substitution' | 'hallucination' | 'false_claim' | null;
  judgeCompliant: boolean | null; // null if judge didn't run or errored
  missedPhrases: string[];
  reason: string | null;
}

export interface JudgeResult {
  compliant: boolean;
  driftType: 'omission' | 'substitution' | 'hallucination' | 'false_claim' | null;
  reason: string;
}

export const CRITICAL_STAGES: string[] = [
  'recommendation', 'ch_alex', 'ch_chris', 'ch_maddie', 'roi_delivery', 'close',
];

// ─── Compliance Checks (M3: observability-only delivery verification) ────────

export interface ComplianceChecks {
  mustContainPhrases: string[];
}

// ─── BrainEvent (workflow/services → DO) ─────────────────────────────────────

export type BrainEvent =
  | { type: 'session_init'; leadId: string; starterIntel?: Record<string, unknown>; eventId?: string }
  | { type: 'fast_intel_ready'; payload: Record<string, unknown>; version: number; eventId?: string }
  | { type: 'consultant_ready'; payload: Record<string, unknown>; version: number; eventId?: string }
  | { type: 'deep_ready'; payload: Record<string, unknown>; version: number; eventId?: string }
  | { type: 'user_turn'; transcript: string; turnId: string; ts: string; eventId?: string }
  | { type: 'llm_reply_done'; spokenText: string; moveId: string; deliveryId?: string; ts: string; eventId?: string; compliance_status?: 'pass' | 'drift'; compliance_score?: number; missed_phrases?: string[] }
  | { type: 'delivery_barged_in'; deliveryId: string; moveId: string; ts: string; eventId?: string }
  | { type: 'delivery_failed'; deliveryId: string; moveId: string; errorCode?: string; ts: string; eventId?: string }
  | { type: 'call_end'; reason: string; ts: string; eventId?: string };

// ─── Env binding ─────────────────────────────────────────────────────────────

export interface Env {
  CALL_BRAIN: DurableObjectNamespace;
  LEADS_KV: KVNamespace;
  GEMINI_API_KEY: string;
}

