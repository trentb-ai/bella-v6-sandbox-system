/**
 * call-brain-do/src/state.ts — v2.0.0-do-alpha.1
 * DO storage operations: init, load, persist.
 */

import type { CallBrainState, Stage } from './types';

const STATE_KEY = 'call_brain_state';

export function initState(callId: string, leadId: string): CallBrainState {
  const now = new Date().toISOString();
  return {
    callId,
    leadId,
    createdAt: now,
    updatedAt: now,

    stage: 'wow',
    wowStall: 1,
    completedStages: [],
    currentQueue: [],

    extracted: {
      acv: null,
      timeframe: null,
      web_leads: null,
      web_conversions: null,
      web_followup_speed: null,
      ads_leads: null,
      ads_conversions: null,
      ads_followup_speed: null,
      phone_volume: null,
      missed_call_handling: null,
      missed_call_callback_speed: null,
      old_leads: null,
      new_customers: null,
      has_review_system: null,
    },

    flags: {
      trialMentioned: false,
      apifyDone: false,
      roiComputed: false,
      roiDelivered: false,
      justDemo: false,
      questionBudgetTight: false,
    },

    spoken: {
      moveIds: [],
      factsUsed: [],
      agentPitchesGiven: [],
    },

    intel: {
      fast: null,
      consultant: null,
      deep: null,
      industryLanguage: null,
      mergedVersion: 0,
    },

    roi: {
      agentValues: {},
      totalValue: null,
    },

    intelVersions: {},

    retry: {
      extractionMisses: {},
      stageLoops: 0,
    },

    watchdog: {
      mustDeliverRoiNext: false,
      deepIntelMissingEscalation: false,
      lastTurnAt: null,
      nextChecks: [],
    },
  };
}

export async function loadState(storage: DurableObjectStorage): Promise<CallBrainState | null> {
  const raw = await storage.get<CallBrainState>(STATE_KEY);
  return raw ?? null;
}

export async function persistState(storage: DurableObjectStorage, state: CallBrainState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await storage.put(STATE_KEY, state);
}
