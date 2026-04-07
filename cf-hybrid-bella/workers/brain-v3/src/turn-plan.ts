/**
 * brain-v3/src/turn-plan.ts — TurnPlan assembler
 * Chunk 1 — V3 | Chunk 7: Intelligence Layers wired
 */

import type { TurnPlan } from '@bella/contracts';
import type { ConversationState, StageDirective } from './types';
import { getFact } from './facts';
import { detectIntent } from './intent';
import { needsRepair } from './repair';
import { extractEngagementSignals, scoreEngagement, engagementLevel } from './engagement';
// queryKB imported for Chunk 10 integration — Vectorize embedding wired in Chunk 10
import { queryKB } from './kb'; // eslint-disable-line @typescript-eslint/no-unused-vars

// ─── Critical stage set — strict improv, no freestyle ────────────────────────

const CRITICAL_STAGES = ['roi_delivery', 'recommendation', 'ch_alex', 'ch_chris', 'ch_maddie', 'close'];

// ─── buildCriticalFacts — Layer 11 ───────────────────────────────────────────

/** Local helper — NOT imported from moves.ts (spec §7A P1-2 fix) */
function cleanFacts(facts: string[]): string[] {
  return facts.filter(f => typeof f === 'string' && f.trim().length > 0);
}

/**
 * Build a pool of up to 6 critical consultant facts for the current stage.
 * Returns [] when consultantData is null.
 * Exported for test assertions (C7-13, C7-14).
 */
export function buildCriticalFacts(stage: string, state: ConversationState): string[] {
  const c = state.consultantData;
  if (!c) return [];

  const raw: string[] = [];

  // Slots 1-2: always include
  const marketPos = (c.icpAnalysis as Record<string, unknown> | undefined)?.marketPositionNarrative;
  if (typeof marketPos === 'string') raw.push(marketPos);
  const strongest = (c.valuePropAnalysis as Record<string, unknown> | undefined)?.strongestBenefit;
  if (typeof strongest === 'string') raw.push(strongest);

  // Slots 3-4: stage-specific
  const agentKey = stage.startsWith('ch_alex') ? 'alex'
    : stage.startsWith('ch_chris') ? 'chris'
    : stage.startsWith('ch_maddie') ? 'maddie'
    : null;
  const routing = c.routing as Record<string, unknown> | undefined;
  if (agentKey && routing?.reasoning) {
    const r = (routing.reasoning as Record<string, string>)[agentKey];
    if (r) raw.push(r.split('.')[0] + '.');
  }
  const hiring = (c.hiringAnalysis as Record<string, unknown> | undefined)?.topHiringWedge;
  if (typeof hiring === 'string') raw.push(hiring.split('.')[0] + '.');

  // Slots 5-6: optional fill
  const bizId = c.businessIdentity as Record<string, unknown> | undefined;
  if (raw.length < 6 && typeof bizId?.businessModel === 'string') raw.push(bizId.businessModel);
  if (raw.length < 6 && typeof bizId?.serviceArea === 'string') raw.push(bizId.serviceArea);
  if (raw.length < 6 && stage.match(/recommendation|close/)) {
    const ctaMap = (c.consultant as Record<string, unknown> | undefined)?.ctaAgentMapping;
    if (typeof ctaMap === 'string') raw.push(ctaMap);
  }

  return cleanFacts(raw).slice(0, 6);
}

// ─── buildTurnPlan ────────────────────────────────────────────────────────────

/**
 * Build a TurnPlan from current state, directive, and optional utterance.
 * utterance is used for intent detection and repair handling.
 */
export function buildTurnPlan(
  state: ConversationState,
  directive: StageDirective,
  turnId: string,
  utterance = '',
): TurnPlan {
  const isCritical = CRITICAL_STAGES.includes(state.currentStage);

  // Layer 3: Intent detection
  const intent = detectIntent(utterance);

  // Layer 7: Conversational repair
  const repair = needsRepair(intent, state);

  // Layer 2: Hybrid freestyle settings
  const improvisationBand: 'strict' | 'wide' | 'narrow' = repair.needed
    ? 'narrow'
    : (isCritical ? 'strict' : 'wide');

  // Layer 11: Critical facts → context notes
  const criticalFacts = buildCriticalFacts(state.currentStage, state);
  const contextNotes: string[] = [
    ...(directive.notes ?? []),
    ...criticalFacts.map(f => `FACT: ${f}`),
  ];

  // Active listening cue from directive (set by moves.ts Layer 5)
  if (directive.activeListeningCue) {
    contextNotes.push(`LISTEN: ${directive.activeListeningCue}`);
  }

  return {
    version: 1,
    callId: state.callId,
    turnId,
    stage: state.currentStage,
    moveId: `${state.currentStage}_${state.turnIndex}`,
    directive: directive.objective,
    speakText: repair.needed ? repair.repairSpeak : (directive.speak || undefined),
    mandatory: !directive.canSkip,
    maxTokens: directive.ask ? 150 : 80,
    confirmedFacts: buildConfirmedFactsList(state),
    activeMemory: [],
    contextNotes,
    extractionTargets: directive.extract ?? [],
    allowFreestyle: !isCritical,
    improvisationBand,
    intent,
    consultantReady: state.consultantReady,
  };
}

// ─── buildConfirmedFactsList ──────────────────────────────────────────────────

/**
 * Build confirmed facts list for Prompt Worker's "DO NOT re-ask" section.
 * Every read goes through getFact() — Universal Data Law.
 */
function buildConfirmedFactsList(state: ConversationState): string[] {
  const confirmed: string[] = [];

  const check = (key: string, label: string) => {
    const val = getFact(key, state.hotMemory, state.warmFacts);
    if (val != null) confirmed.push(`${label}: ${val}`);
  };

  check('business_name', 'Business name');
  check('acv', 'Average deal value');
  check('inboundLeads', 'Inbound leads/week');
  check('webLeads', 'Website leads/week');
  check('inboundConversions', 'Inbound conversions/week');
  check('inboundConversionRate', 'Inbound conversion rate');
  check('webConversions', 'Website conversions/week');
  check('webConversionRate', 'Website conversion rate');
  check('responseSpeedBand', 'Response speed');
  check('phoneVolume', 'Phone volume/week');
  check('missedCalls', 'Missed calls/week');
  check('missedCallRate', 'Missed call rate');

  return confirmed;
}
