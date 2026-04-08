/**
 * brain-v3/src/state.ts — ConversationState factory
 * Chunk 1 — V3
 */

import type { ConversationState } from './types';
import { buildInitialQueue } from './queue';

export function initialState(callId: string, leadId: string): ConversationState {
  return {
    callId,
    leadId,
    businessName: 'your business',

    currentStage: 'greeting',
    completedStages: [],
    wowStep: 0,
    turnIndex: 0,

    topAgents: ['alex'],
    currentQueue: buildInitialQueue(['alex']),

    alexEligible: true,
    chrisEligible: false,
    maddieEligible: false,
    whyRecommended: [],

    questionCounts: {},

    hotMemory: {},

    calculatorResults: {},

    intelReceived: false,

    stall: 0,

    warmFacts: [],

    engagementScore: 0,
    engagementHistory: [],

    priorHotMemoryKeys: [],
    recentUserTranscripts: [],

    consultantReady: false,

    fastIntelData: null,
    intelFlags: null,
    websiteHealth: null,
    scriptFills: null,
    consultantData: null,
    deepIntel: null,

    callStartedEmitted: false,
  };
}
