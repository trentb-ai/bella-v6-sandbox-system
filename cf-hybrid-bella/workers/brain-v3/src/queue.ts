/**
 * brain-v3/src/queue.ts — Channel queue builder and navigation
 * Chunk 1 — V3
 *
 * Ported from V2 gate.ts queue logic.
 */

import type {
  StageId,
  CoreAgent,
  QueueItem,
  ConversationState,
} from './types';

// ─── Build Initial Queue ────────────────────────────────────────────────────

/**
 * Build the initial channel queue from topAgents.
 * Alex-first rule applies when no consultant priority ordering available.
 */
export function buildInitialQueue(topAgents: CoreAgent[]): QueueItem[] {
  const WHY: Record<CoreAgent, string> = {
    alex: 'Alex leads whenever inbound demand likely exists.',
    chris: 'Chris follows when website actions matter.',
    maddie: 'Maddie is added when phone is commercially important.',
  };
  const STAGE: Record<CoreAgent, 'ch_alex' | 'ch_chris' | 'ch_maddie'> = {
    alex: 'ch_alex',
    chris: 'ch_chris',
    maddie: 'ch_maddie',
  };

  return topAgents.map((agent, index) => ({
    stage: STAGE[agent],
    agent,
    priority: index + 1,
    why: WHY[agent],
  }));
}

// ─── Derive Top Agents ──────────────────────────────────────────────────────

/**
 * Derive ordered top agents from eligibility flags.
 * Uses consultant routing.priority_agents when available, else Alex-first.
 */
export function deriveTopAgents(
  alexEligible: boolean,
  chrisEligible: boolean,
  maddieEligible: boolean,
  consultantPriority?: string[],
): CoreAgent[] {
  const eligible: CoreAgent[] = [];
  if (alexEligible) eligible.push('alex');
  if (chrisEligible) eligible.push('chris');
  if (maddieEligible) eligible.push('maddie');

  if (eligible.length === 0) return [];

  if (consultantPriority && consultantPriority.length > 0) {
    eligible.sort((a, b) => {
      const ai = consultantPriority.indexOf(a);
      const bi = consultantPriority.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    console.log(`[TOP_AGENTS] consultant_priority=[${consultantPriority.join(',')}] result=[${eligible.join(',')}]`);
  } else {
    console.log(`[TOP_AGENTS] no consultant priority — Alex-first default result=[${eligible.join(',')}]`);
  }

  return eligible;
}

// ─── Next Channel From Queue ────────────────────────────────────────────────

/**
 * Returns the next channel stage from the queue, or 'roi_delivery' if exhausted.
 */
export function nextChannelFromQueue(state: ConversationState): StageId {
  const completedSet = new Set<StageId>(state.completedStages);
  for (const item of state.currentQueue) {
    if (!completedSet.has(item.stage)) return item.stage;
  }
  return 'roi_delivery';
}

// ─── Rebuild Future Queue on Late Intel ─────────────────────────────────────

/**
 * Rebuild the future queue when late-arriving intel changes eligibility.
 * INVARIANTS (spec Section 5.8):
 * 1. Completed stages are IMMUTABLE — never re-enqueue
 * 2. Current in-progress stage is NOT interrupted
 * 3. Only future (unvisited, uncompleted) items are candidates
 */
export function rebuildFutureQueueOnLateLoad(
  state: ConversationState,
  newTopAgents: CoreAgent[],
): QueueItem[] {
  const completedSet = new Set<StageId>(state.completedStages);
  const currentStage = state.currentStage;

  const freshQueue = buildInitialQueue(newTopAgents);

  return freshQueue.filter(item =>
    !completedSet.has(item.stage) && item.stage !== currentStage
  );
}
