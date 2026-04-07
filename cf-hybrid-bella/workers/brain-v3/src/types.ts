/**
 * brain-v3/src/types.ts — Internal types for Brain TurnPlan Engine
 * Chunk 1 — V3
 */

// ─── Stage IDs ──────────────────────────────────────────────────────────────

export type StageId =
  | 'greeting'
  | 'wow_1' | 'wow_2' | 'wow_3' | 'wow_4'
  | 'wow_5' | 'wow_6' | 'wow_7' | 'wow_8'
  | 'recommendation'
  | 'anchor_acv'
  | 'ch_alex' | 'ch_chris' | 'ch_maddie'
  | 'ch_sarah' | 'ch_james'
  | 'roi_delivery'
  | 'optional_side_agents'
  | 'close';

export type WowStepId = 'wow_1' | 'wow_2' | 'wow_3' | 'wow_4' | 'wow_5' | 'wow_6' | 'wow_7' | 'wow_8';

export type CoreAgent = 'alex' | 'chris' | 'maddie';
export type OptionalAgent = 'sarah' | 'james';
export type Agent = CoreAgent | OptionalAgent;

export type ChannelStageId = 'ch_alex' | 'ch_chris' | 'ch_maddie' | 'ch_sarah' | 'ch_james';

// ─── Data Sources ───────────────────────────────────────────────────────────

export type DataSource = 'prospect' | 'consultant' | 'scrape' | 'industry_default';

export const SOURCE_PRIORITY: DataSource[] = ['prospect', 'consultant', 'scrape', 'industry_default'];

// ─── Warm Facts ─────────────────────────────────────────────────────────────

export interface WarmFact {
  fact_key: string;
  fact_value: string;
  data_source: DataSource;
  confidence: number;
}

// ─── Queue ──────────────────────────────────────────────────────────────────

export interface QueueItem {
  stage: ChannelStageId;
  agent: CoreAgent;
  priority: number;
  why: string;
}

// ─── Eligibility ────────────────────────────────────────────────────────────

export interface EligibilityResult {
  alexEligible: boolean;
  chrisEligible: boolean;
  maddieEligible: boolean;
  whyRecommended: string[];
}

// ─── Stage Policy ───────────────────────────────────────────────────────────

export interface StagePolicy {
  stage: ChannelStageId;
  requiredFields: string[];
  eitherOrFields: string[][];
  maxQuestions: number;
  forceAdvanceWhenSatisfied: boolean;
  calculatorKey: string;
  fallbackPolicy: string[];
}

// ─── Stage Directive ────────────────────────────────────────────────────────

export interface StageDirective {
  objective: string;
  allowedMoves: string[];
  requiredData: string[];
  speak: string;
  ask: boolean;
  waitForUser: boolean;
  canSkip: boolean;
  skipReason?: string;
  advanceOn?: string[];
  extract?: string[];
  maxQuestions?: number;
  forceAdvanceWhenSatisfied?: boolean;
  calculatorKey?: string;
  notes?: string[];
  activeListeningCue?: string;
}

// ─── ROI Types ──────────────────────────────────────────────────────────────

export type ResponseSpeedBand =
  | 'under_30_seconds'
  | 'under_5_minutes'
  | '5_to_30_minutes'
  | '30_minutes_to_2_hours'
  | '2_to_24_hours'
  | 'next_day_plus'
  | 'unknown';

export interface AlexRoiInputs {
  leads: number;
  conversions?: number | null;
  conversionRate?: number | null;
  responseSpeedBand: ResponseSpeedBand;
  acv: number;
}

export interface ChrisRoiInputs {
  leads: number;
  conversions?: number | null;
  conversionRate?: number | null;
  acv: number;
}

export interface MaddieRoiInputs {
  phoneVolume: number;
  missedCalls?: number | null;
  missedCallRate?: number | null;
  acv: number;
}

export interface AgentRoiResult {
  agent: string;
  weeklyValue: number;
  confidence: 'low' | 'medium' | 'high';
  assumptionsUsed: string[];
  rationale: string;
  conservative: boolean;
}

export interface CombinedRoiResult {
  totalWeeklyValue: number;
  perAgent: Partial<Record<CoreAgent, AgentRoiResult>>;
  orderedAgents: CoreAgent[];
}

// ─── Conversation State ─────────────────────────────────────────────────────

export interface ConversationState {
  callId: string;
  leadId: string;
  businessName: string;

  currentStage: StageId;
  completedStages: StageId[];
  wowStep: number;
  turnIndex: number;

  currentQueue: QueueItem[];
  topAgents: CoreAgent[];

  alexEligible: boolean;
  chrisEligible: boolean;
  maddieEligible: boolean;
  whyRecommended: string[];

  questionCounts: Record<string, number>;

  hotMemory: Record<string, string | number | null>;

  calculatorResults: Partial<Record<CoreAgent, AgentRoiResult>>;

  intelReceived: boolean;

  stall: number;

  warmFacts: WarmFact[];

  // Layer 4: Engagement scoring
  engagementScore: number;
  engagementHistory: number[];

  // Layer 5: Active listening
  priorHotMemoryKeys: string[];

  // Layer 2 + 8: Hybrid freestyle / consultant readiness
  consultantReady: boolean;

  // Layer 11: Full data activation — populated on intel arrival
  fastIntelData: Record<string, unknown> | null;
  intelFlags: Record<string, boolean> | null;
  websiteHealth: Record<string, unknown> | null;
  scriptFills: Record<string, string | null> | null;
  consultantData: Record<string, unknown> | null;
  deepIntel: { googlePresence?: Array<Record<string, unknown>>; ads?: unknown; hiringMatches?: string[]; } | null;
}
