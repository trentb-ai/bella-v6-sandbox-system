/**
 * call-brain-do/src/gate.ts — v3.0.0-bella-v2
 * V2 queue builder, eligibility engine, stage policies, and force-advance logic.
 *
 * Pure functions — no state mutation, no side effects.
 * The controller (index.ts) handles all state writes.
 */

import type {
  StageId,
  CoreAgent,
  ConversationState,
  MergedIntel,
  QueueItem,
  EligibilityResult,
  StagePolicy,
} from './types';

// ─── Stage Policies ─────────────────────────────────────────────────────────

export const STAGE_POLICIES: Record<
  Extract<StageId, 'ch_alex' | 'ch_chris' | 'ch_maddie' | 'ch_sarah' | 'ch_james'>,
  StagePolicy
> = {
  ch_alex: {
    stage: 'ch_alex',
    requiredFields: ['acv', 'inboundLeads', 'inboundConversionsOrRate', 'responseSpeedBand'],
    minFieldsForEstimate: ['acv', 'inboundLeads', 'inboundConversionsOrRate', 'responseSpeedBand'],
    maxQuestions: 3,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'alex_speed_to_lead',
    fallbackPolicy: [
      'Ask for rough conversion percentage once if raw conversions are missing.',
      'Map vague response-time language to the nearest approved band.',
      'If still incomplete after one clarification, use approved conservative fallback or skip.',
    ],
  },
  ch_chris: {
    stage: 'ch_chris',
    requiredFields: ['acv', 'webLeads', 'webConversionsOrRate'],
    minFieldsForEstimate: ['acv', 'webLeads', 'webConversionsOrRate'],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'chris_website_conversion',
    fallbackPolicy: [
      'Ask for rough conversion percentage once if raw conversions are missing.',
      'If still incomplete after one clarification, use approved conservative fallback or skip.',
    ],
  },
  ch_maddie: {
    stage: 'ch_maddie',
    requiredFields: ['phoneVolume', 'missedCallsOrRate'],
    minFieldsForEstimate: ['phoneVolume', 'missedCallsOrRate'],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'maddie_missed_call_recovery',
    fallbackPolicy: [
      'Ask for rough missed-call percentage once if raw missed-call count is missing.',
      'If still incomplete after one clarification, use approved conservative fallback or skip.',
    ],
  },
  ch_sarah: {
    stage: 'ch_sarah',
    requiredFields: ['acv', 'oldLeads'],
    minFieldsForEstimate: ['acv', 'oldLeads'],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'sarah_database_reactivation',
    fallbackPolicy: [
      'If prospect is unsure of exact number, accept a rough estimate ("a few hundred", "maybe a thousand").',
      'If still incomplete after one clarification, skip with a note that Sarah ROI was not computed.',
    ],
  },
  ch_james: {
    stage: 'ch_james',
    requiredFields: ['acv', 'newCustomersPerWeek', 'currentStars', 'hasReviewSystem'],
    minFieldsForEstimate: ['acv', 'newCustomersPerWeek', 'currentStars', 'hasReviewSystem'],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
    calculatorKey: 'james_reputation_uplift',
    fallbackPolicy: [
      'If prospect is unsure about review system, assume they do not have one.',
      'If still incomplete after one clarification, skip with a note that James ROI was not computed.',
    ],
  },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Returns true if v is not null, not undefined, and not empty string. */
export function hasValue(v: unknown): boolean {
  return v !== null && v !== undefined && v !== '';
}

// ─── Minimum-Data Checks ────────────────────────────────────────────────────

export function hasAlexMinimumData(state: ConversationState): boolean {
  const hasConv = hasValue(state.inboundConversions) || hasValue(state.inboundConversionRate);
  return hasValue(state.acv) && hasValue(state.inboundLeads) && hasConv && hasValue(state.responseSpeedBand);
}

export function hasChrisMinimumData(state: ConversationState): boolean {
  const hasConv = hasValue(state.webConversions) || hasValue(state.webConversionRate);
  return hasValue(state.acv) && hasValue(state.webLeads) && hasConv;
}

export function hasMaddieMinimumData(state: ConversationState): boolean {
  const hasMissed = hasValue(state.missedCalls) || hasValue(state.missedCallRate);
  return hasValue(state.acv) && hasValue(state.phoneVolume) && hasMissed;
}

export function hasSarahMinimumData(state: ConversationState): boolean {
  return hasValue(state.acv) && hasValue(state.oldLeads);
}

export function hasJamesMinimumData(state: ConversationState): boolean {
  return hasValue(state.acv) && hasValue(state.newCustomersPerWeek) && hasValue(state.currentStars) && state.hasReviewSystem !== undefined && state.hasReviewSystem !== null;
}

// ─── Force-Advance & Question Budget ────────────────────────────────────────

/** Returns true if the channel stage has all minimum data to run its calculator. */
export function shouldForceAdvance(stage: StageId, state: ConversationState): boolean {
  if (stage === 'ch_alex') return hasAlexMinimumData(state);
  if (stage === 'ch_chris') return hasChrisMinimumData(state);
  if (stage === 'ch_maddie') return hasMaddieMinimumData(state);
  if (stage === 'ch_sarah') return hasSarahMinimumData(state);
  if (stage === 'ch_james') return hasJamesMinimumData(state);
  return false;
}

/** Returns true if the question budget for this channel stage is exhausted. */
export function maxQuestionsReached(stage: StageId, state: ConversationState): boolean {
  if (stage === 'ch_alex') return state.questionCounts.ch_alex >= 3;
  if (stage === 'ch_chris') return state.questionCounts.ch_chris >= 2;
  if (stage === 'ch_maddie') return state.questionCounts.ch_maddie >= 2;
  if (stage === 'ch_sarah') return state.questionCounts.ch_sarah >= 2;
  if (stage === 'ch_james') return state.questionCounts.ch_james >= 2;
  return false;
}

// ─── Eligibility ────────────────────────────────────────────────────────────

/** Derive agent eligibility from intel signals and conversation state. */
export function deriveEligibility(intel: MergedIntel, state: ConversationState): EligibilityResult {
  const websiteSignals = !!(
    intel.fast.websiteExists
    || (intel.fast.websiteActions && intel.fast.websiteActions.length > 0)
    || state.leadSourceDominant === 'website'
    || state.leadSourceDominant === 'ads'
    || state.websiteRelevant
  );

  const phoneSignals = !!(
    intel.fast.phoneVisible
    || (intel.fast.phoneSignals && intel.fast.phoneSignals.length > 0)
    || state.leadSourceDominant === 'phone'
    || state.phoneRelevant
  );

  const explicitNoInbound = state.leadSourceDominant === 'other'
    && !websiteSignals && !phoneSignals && !state.adsConfirmed;

  const alexEligible = !explicitNoInbound;

  const chrisEligible = websiteSignals && (
    state.leadSourceDominant === 'website'
    || state.leadSourceDominant === 'ads'
    || state.leadSourceDominant === 'organic'
    || state.websiteRelevant
  );

  const maddieEligible = phoneSignals && (
    state.leadSourceDominant === 'phone'
    || state.phoneRelevant
  );

  const whyRecommended: string[] = [];
  if (alexEligible) whyRecommended.push('Alex: inbound demand signals detected — speed-to-lead uplift likely.');
  if (chrisEligible) whyRecommended.push('Chris: website actions or web-sourced leads — conversion uplift applies.');
  if (maddieEligible) whyRecommended.push('Maddie: phone signals detected — missed call recovery opportunity.');

  return { alexEligible, chrisEligible, maddieEligible, whyRecommended };
}

// ─── Top Agents (Alex-first rule) ───────────────────────────────────────────

/**
 * Derive ordered top agents from eligibility flags.
 * Uses consultant routing.priority_agents when available, else Alex-first.
 */
export function deriveTopAgents(state: ConversationState): CoreAgent[] {
  const { alexEligible, chrisEligible, maddieEligible } = state;

  // Build eligible set
  const eligible: CoreAgent[] = [];
  if (alexEligible) eligible.push('alex');
  if (chrisEligible) eligible.push('chris');
  if (maddieEligible) eligible.push('maddie');

  if (eligible.length === 0) return [];

  // Apply consultant priority ordering if available
  const consultantPriority = (
    (state.intel.consultant as any)?.routing?.priority_agents ?? []
  ) as string[];

  if (consultantPriority.length > 0) {
    eligible.sort((a, b) => {
      const ai = consultantPriority.indexOf(a);
      const bi = consultantPriority.indexOf(b);
      // Agents not in priority list sort to end, preserving relative order
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    console.log(`[TOP_AGENTS] consultant_priority=[${consultantPriority.join(',')}] result=[${eligible.join(',')}]`);
  } else {
    console.log(`[TOP_AGENTS] no consultant priority — Alex-first default result=[${eligible.join(',')}]`);
  }

  return eligible;
}

// ─── Queue Builder ──────────────────────────────────────────────────────────

/** Build the initial channel queue from topAgents. Sorted by priority ascending. */
export function buildInitialQueue(state: ConversationState): QueueItem[] {
  const queue: QueueItem[] = [];

  if (state.topAgents.includes('alex')) {
    queue.push({ stage: 'ch_alex', agent: 'alex', priority: 1, why: 'Alex leads whenever inbound demand likely exists.' });
  }
  if (state.topAgents.includes('chris')) {
    queue.push({ stage: 'ch_chris', agent: 'chris', priority: 2, why: 'Chris follows when website actions matter.' });
  }
  if (state.topAgents.includes('maddie')) {
    queue.push({ stage: 'ch_maddie', agent: 'maddie', priority: 3, why: 'Maddie is added when phone is commercially important.' });
  }

  queue.sort((a, b) => a.priority - b.priority);
  return queue;
}

// ─── Queue Rebuild on Late Intel ────────────────────────────────────────────

/**
 * Rebuild the future queue when late-arriving intel changes eligibility.
 * Derives fresh eligibility, recomputes topAgents, rebuilds queue,
 * then filters out any stages already completed.
 */
export function rebuildFutureQueueOnLateLoad(
  currentQueue: QueueItem[],
  state: ConversationState,
  intel: MergedIntel,
): QueueItem[] {
  const completedSet = new Set<StageId>(state.completedStages);

  // Derive fresh eligibility from latest intel
  const eligibility = deriveEligibility(intel, state);

  // Build a temporary updated state with fresh eligibility
  const updatedState: ConversationState = {
    ...state,
    alexEligible: eligibility.alexEligible,
    chrisEligible: eligibility.chrisEligible,
    maddieEligible: eligibility.maddieEligible,
    whyRecommended: eligibility.whyRecommended,
    topAgents: [], // placeholder — computed next
  };

  // Recompute topAgents from the updated eligibility
  updatedState.topAgents = deriveTopAgents(updatedState);

  // Build fresh queue from updated state
  const freshQueue = buildInitialQueue(updatedState);

  // Filter out already-completed stages
  return freshQueue.filter((item) => !completedSet.has(item.stage));
}

// ─── Next Channel ───────────────────────────────────────────────────────────

/** Returns the next channel stage from the queue, or 'roi_delivery' if exhausted. */
export function nextChannelFromQueue(state: ConversationState): StageId {
  const completedSet = new Set<StageId>(state.completedStages);
  for (const item of state.currentQueue) {
    if (!completedSet.has(item.stage)) return item.stage;
  }
  return 'roi_delivery';
}

