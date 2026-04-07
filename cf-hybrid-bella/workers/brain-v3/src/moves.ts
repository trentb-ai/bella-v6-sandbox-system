/**
 * brain-v3/src/moves.ts — Per-stage directive builder
 * Chunk 1 — V3
 *
 * Ported from V2 moves.ts (doc-bella-roi-delivery-moves-source-20260407).
 * Brain builds directives; Prompt Worker turns them into Gemini calls.
 */

import type {
  StageId,
  ConversationState,
  StageDirective,
} from './types';
import { getFact, shouldAskQuestion } from './facts';
import { STAGE_POLICIES, shouldForceAdvance, maxQuestionsReached } from './gate';
import { bandToSpokenLabel } from './helpers';

// ─── Greeting ───────────────────────────────────────────────────────────────

function buildGreetingDirective(state: ConversationState): StageDirective {
  const biz = state.businessName;
  return {
    objective: 'Greet the prospect who just submitted their details on the website.',
    allowedMoves: ['greet'],
    requiredData: [],
    speak: `Hi! Thanks for submitting your details. I've had a look at ${biz} and I'm really excited to show you what we can do. How are you going?`,
    ask: true,
    waitForUser: true,
    canSkip: false,
    advanceOn: ['user_replied'],
  };
}

// ─── WOW Steps ──────────────────────────────────────────────────────────────

function buildWowDirective(state: ConversationState): StageDirective {
  const step = state.wowStep;
  const stage = state.currentStage;

  // Layer 11: 4-tier observation stack for wow_1 (spec §7B)
  // Layer 11: 7-tier observation stack for wow_6 (spec §7C)
  let observationNote: string | undefined;
  if (stage === 'wow_1') {
    const obs =
      state.scriptFills?.website_positive_comment ??
      (state.consultantData?.copyAnalysis as Record<string, unknown> | undefined)?.strongestLine as string | undefined ??
      state.fastIntelData?.bella_opener as string | undefined ??
      'I can see you run a strong operation';
    observationNote = `OBSERVATION: ${obs}`;
  } else if (stage === 'wow_6') {
    const gp = state.deepIntel?.googlePresence?.[0] as Record<string, unknown> | undefined;
    const ci = state.consultantData?.mostImpressive as Array<Record<string, unknown>> | undefined;
    const obs =
      state.scriptFills?.scrapedDataSummary ??
      gp?.bellaLine as string | undefined ??
      ci?.[0]?.bellaLine as string | undefined ??
      (state.consultantData?.conversationHooks as Array<Record<string, unknown>> | undefined)?.[0]?.topic as string | undefined ??
      (state.consultantData?.hiringAnalysis as Record<string, unknown> | undefined)?.topHiringWedge as string | undefined ??
      state.deepIntel?.hiringMatches?.[0] ??
      "You've built a solid business — let me show you what that means for growth";
    observationNote = `OBSERVATION: ${obs}`;
  }

  // Layer 5: Active listening cue — acknowledge new fact from previous turn (spec §8B)
  const newlyCaptured = Object.keys(state.hotMemory).find(
    k => state.hotMemory[k] != null && !state.priorHotMemoryKeys.includes(k)
  );
  const activeListeningCue = newlyCaptured
    ? `Acknowledge what they just shared about ${newlyCaptured} naturally before continuing.`
    : undefined;

  return {
    objective: `WOW step ${step}: deliver personalised business insight ${step} of 8.`,
    allowedMoves: [`wow:step_${step}`],
    requiredData: [],
    speak: '',
    ask: step >= 3,
    waitForUser: step >= 3,
    canSkip: false,
    notes: [
      `wow_step=${step}`,
      `min_stall_gate=${step >= 3 ? 'active' : 'inactive'}`,
      ...(observationNote ? [observationNote] : []),
    ],
    activeListeningCue,
  };
}

// ─── Recommendation ─────────────────────────────────────────────────────────

function buildRecommendationDirective(state: ConversationState): StageDirective {
  const agents = state.topAgents;
  const agentNames = agents.map(a => a.charAt(0).toUpperCase() + a.slice(1));
  const listStr = agentNames.length <= 2
    ? agentNames.join(' and ')
    : agentNames.slice(0, -1).join(', ') + ', and ' + agentNames[agentNames.length - 1];

  // Layer 11 §7D: Routing colour from consultant — additive notes only (spec §7D)
  const reasoning = (state.consultantData?.routing as Record<string, Record<string, string>> | undefined)?.reasoning;
  const colourNotes: string[] = [];
  if (reasoning) {
    const alexColour = reasoning.alex?.split('.')[0];
    const chrisColour = reasoning.chris?.split('.')[0];
    const maddieColour = reasoning.maddie?.split('.')[0];
    if (alexColour) colourNotes.push(`Alex: ${alexColour}.`);
    if (chrisColour) colourNotes.push(`Chris: ${chrisColour}.`);
    if (maddieColour) colourNotes.push(`Maddie: ${maddieColour}.`);
  }

  return {
    objective: 'Recommend the prioritised agent lineup based on intel signals.',
    allowedMoves: ['recommend'],
    requiredData: [],
    speak: `Based on what I've seen, I think ${listStr} would be the most impactful for ${state.businessName}. Let me walk you through what each one could do for you.`,
    ask: true,
    waitForUser: true,
    canSkip: false,
    advanceOn: ['user_replied'],
    notes: colourNotes,
  };
}

// ─── Anchor ACV ─────────────────────────────────────────────────────────────

function buildAnchorAcvDirective(state: ConversationState): StageDirective {
  const existingAcv = getFact('acv', state.hotMemory, state.warmFacts);

  if (existingAcv != null) {
    return {
      objective: 'ACV already captured — auto-advance to first channel.',
      allowedMoves: ['advance:first_channel'],
      requiredData: [],
      speak: '',
      ask: false,
      waitForUser: false,
      canSkip: true,
    };
  }

  return {
    objective: 'Capture average deal value before channel ROI calculations.',
    allowedMoves: ['extract:acv'],
    requiredData: ['acv'],
    speak: 'Before we dig into the specifics — roughly what would you say your average customer or deal is worth to you?',
    ask: true,
    waitForUser: true,
    canSkip: false,
    extract: ['acv'],
    maxQuestions: 1,
    forceAdvanceWhenSatisfied: true,
  };
}

// ─── Channel: Alex ──────────────────────────────────────────────────────────

function buildAlexDirective(state: ConversationState): StageDirective {
  const policy = STAGE_POLICIES.ch_alex;
  const forceAdv = shouldForceAdvance('ch_alex', state.hotMemory, state.warmFacts);
  const budgetExhausted = maxQuestionsReached('ch_alex', state.questionCounts);

  if (forceAdv || budgetExhausted) {
    const result = state.calculatorResults.alex;

    if (result) {
      const band = getFact('responseSpeedBand', state.hotMemory, state.warmFacts);
      const leads = getFact('inboundLeads', state.hotMemory, state.warmFacts);
      const acv = getFact('acv', state.hotMemory, state.warmFacts);
      return {
        objective: 'Deliver Alex speed-to-lead ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: `So with an average deal value of ${acv} dollars, around ${leads} inbound leads a week, and a response time of ${bandToSpokenLabel(band as string)}, Alex could conservatively add around ${result.weeklyValue.toLocaleString()} dollars a week just by tightening speed-to-lead and follow-up consistency. Does that make sense?`,
        ask: true,
        waitForUser: true,
        canSkip: false,
        advanceOn: ['user_replied'],
        calculatorKey: policy.calculatorKey,
      };
    }

    if (forceAdv) {
      return {
        objective: 'Signal controller to compute Alex ROI.',
        allowedMoves: ['compute:alex', 'advance:next_channel'],
        requiredData: [],
        speak: 'Let me size Alex based on that.',
        ask: false,
        waitForUser: false,
        canSkip: false,
        calculatorKey: policy.calculatorKey,
      };
    }

    return {
      objective: 'Alex question budget exhausted — insufficient data, skip.',
      allowedMoves: ['advance:next_channel'],
      requiredData: [],
      speak: '',
      ask: false,
      waitForUser: false,
      canSkip: true,
      skipReason: 'Question budget exhausted without sufficient data for Alex calculation.',
      notes: policy.fallbackPolicy,
    };
  }

  // Collect inputs mode
  let questionText: string;
  let extractFields: string[];

  const qCount = state.questionCounts['ch_alex'] ?? 0;
  const conversionsSlotAttempted = qCount >= 2;
  const conversionsSlotUnresolved =
    getFact('inboundConversions', state.hotMemory, state.warmFacts) == null &&
    getFact('inboundConversionRate', state.hotMemory, state.warmFacts) == null;

  if (shouldAskQuestion('inboundLeads', state.hotMemory, state.warmFacts)) {
    questionText = 'Roughly how many enquiries or leads are coming in through your website in a typical week?';
    extractFields = ['inboundLeads'];
  } else if (!conversionsSlotAttempted && conversionsSlotUnresolved) {
    questionText = 'And how many of those are turning into paying customers?';
    extractFields = ['inboundConversions', 'inboundConversionRate'];
  } else if (shouldAskQuestion('responseSpeedBand', state.hotMemory, state.warmFacts)) {
    questionText = 'How quickly are those usually followed up?';
    extractFields = ['responseSpeedBand'];
  } else {
    questionText = 'Is there anything else about your lead follow-up process I should know?';
    extractFields = ['responseSpeedBand'];
  }

  return {
    objective: 'Capture Alex speed-to-lead inputs.',
    allowedMoves: ['extract:alexInputs'],
    requiredData: policy.requiredFields,
    speak: questionText,
    ask: true,
    waitForUser: true,
    canSkip: false,
    extract: extractFields,
    maxQuestions: policy.maxQuestions,
    forceAdvanceWhenSatisfied: policy.forceAdvanceWhenSatisfied,
    calculatorKey: policy.calculatorKey,
    notes: policy.fallbackPolicy,
  };
}

// ─── Channel: Chris ─────────────────────────────────────────────────────────

function buildChrisDirective(state: ConversationState): StageDirective {
  const policy = STAGE_POLICIES.ch_chris;
  const forceAdv = shouldForceAdvance('ch_chris', state.hotMemory, state.warmFacts);
  const budgetExhausted = maxQuestionsReached('ch_chris', state.questionCounts);

  if (forceAdv || budgetExhausted) {
    const result = state.calculatorResults.chris;

    if (result) {
      const leads = getFact('webLeads', state.hotMemory, state.warmFacts)
        ?? getFact('inboundLeads', state.hotMemory, state.warmFacts);
      const acv = getFact('acv', state.hotMemory, state.warmFacts);
      return {
        objective: 'Deliver Chris website conversion ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: `So you're getting around ${leads} website leads a week. Chris typically lifts conversion by engaging people in real time, and at an average value of ${acv} dollars that could mean roughly ${result.weeklyValue.toLocaleString()} dollars a week in extra revenue. Does that sound reasonable?`,
        ask: true,
        waitForUser: true,
        canSkip: false,
        advanceOn: ['user_replied'],
        calculatorKey: policy.calculatorKey,
      };
    }

    if (forceAdv) {
      return {
        objective: 'Signal controller to compute Chris ROI.',
        allowedMoves: ['compute:chris', 'advance:next_channel'],
        requiredData: [],
        speak: 'Let me size Chris based on that.',
        ask: false,
        waitForUser: false,
        canSkip: false,
        calculatorKey: policy.calculatorKey,
      };
    }

    return {
      objective: 'Chris question budget exhausted — insufficient data, skip.',
      allowedMoves: ['advance:next_channel'],
      requiredData: [],
      speak: '',
      ask: false,
      waitForUser: false,
      canSkip: true,
      skipReason: 'Question budget exhausted without sufficient data for Chris calculation.',
      notes: policy.fallbackPolicy,
    };
  }

  // Collect inputs — cross-channel dedup: use inboundLeads if already captured
  let questionText: string;
  let extractFields: string[];

  const existingLeads = getFact('webLeads', state.hotMemory, state.warmFacts)
    ?? getFact('inboundLeads', state.hotMemory, state.warmFacts);

  if (existingLeads == null) {
    questionText = 'Roughly how many website enquiries are you getting in a typical week?';
    extractFields = ['webLeads'];
  } else {
    questionText = 'And how many of those turn into paying customers?';
    extractFields = ['webConversions', 'webConversionRate'];
  }

  return {
    objective: 'Capture Chris website conversion inputs.',
    allowedMoves: ['extract:chrisInputs'],
    requiredData: policy.requiredFields,
    speak: questionText,
    ask: true,
    waitForUser: true,
    canSkip: false,
    extract: extractFields,
    maxQuestions: policy.maxQuestions,
    forceAdvanceWhenSatisfied: policy.forceAdvanceWhenSatisfied,
    calculatorKey: policy.calculatorKey,
    notes: policy.fallbackPolicy,
  };
}

// ─── Channel: Maddie ────────────────────────────────────────────────────────

function buildMaddieDirective(state: ConversationState): StageDirective {
  const policy = STAGE_POLICIES.ch_maddie;
  const forceAdv = shouldForceAdvance('ch_maddie', state.hotMemory, state.warmFacts);
  const budgetExhausted = maxQuestionsReached('ch_maddie', state.questionCounts);

  if (forceAdv || budgetExhausted) {
    const result = state.calculatorResults.maddie;

    if (result) {
      const vol = getFact('phoneVolume', state.hotMemory, state.warmFacts);
      const missed = getFact('missedCalls', state.hotMemory, state.warmFacts);
      const missedDesc = missed != null ? `missing about ${missed}` : 'missing some';
      return {
        objective: 'Deliver Maddie missed call recovery ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: `So if you're getting around ${vol} inbound calls a week and ${missedDesc}, that's a meaningful number of live opportunities at risk. Maddie captures and qualifies more of those calls before they disappear. Conservatively, that could mean around ${result.weeklyValue.toLocaleString()} dollars a week in recovered revenue. Does that track?`,
        ask: true,
        waitForUser: true,
        canSkip: false,
        advanceOn: ['user_replied'],
        calculatorKey: policy.calculatorKey,
      };
    }

    if (forceAdv) {
      return {
        objective: 'Signal controller to compute Maddie ROI.',
        allowedMoves: ['compute:maddie', 'advance:next_channel'],
        requiredData: [],
        speak: 'Let me size Maddie based on that.',
        ask: false,
        waitForUser: false,
        canSkip: false,
        calculatorKey: policy.calculatorKey,
      };
    }

    return {
      objective: 'Maddie question budget exhausted — insufficient data, skip.',
      allowedMoves: ['advance:next_channel'],
      requiredData: [],
      speak: '',
      ask: false,
      waitForUser: false,
      canSkip: true,
      skipReason: 'Question budget exhausted without sufficient data for Maddie calculation.',
      notes: policy.fallbackPolicy,
    };
  }

  // Collect inputs
  let questionText: string;
  let extractFields: string[];

  if (shouldAskQuestion('phoneVolume', state.hotMemory, state.warmFacts)) {
    questionText = 'Roughly how many inbound calls do you get in a typical week?';
    extractFields = ['phoneVolume'];
  } else {
    questionText = 'And roughly how many of those get missed?';
    extractFields = ['missedCalls', 'missedCallRate'];
  }

  return {
    objective: 'Capture Maddie missed call recovery inputs.',
    allowedMoves: ['extract:maddieInputs'],
    requiredData: policy.requiredFields,
    speak: questionText,
    ask: true,
    waitForUser: true,
    canSkip: false,
    extract: extractFields,
    maxQuestions: policy.maxQuestions,
    forceAdvanceWhenSatisfied: policy.forceAdvanceWhenSatisfied,
    calculatorKey: policy.calculatorKey,
    notes: policy.fallbackPolicy,
  };
}

// ─── ROI Delivery ───────────────────────────────────────────────────────────

function buildRoiDeliveryDirective(state: ConversationState): StageDirective {
  const results = state.calculatorResults;
  const agents = (['alex', 'chris', 'maddie'] as const).filter(a => results[a] != null);

  let totalWeekly = 0;
  const clauses: string[] = [];
  for (const agent of agents) {
    const r = results[agent]!;
    totalWeekly += r.weeklyValue;
    clauses.push(`${agent.charAt(0).toUpperCase() + agent.slice(1)} at about ${r.weeklyValue.toLocaleString()} dollars a week`);
  }

  const speak = agents.length > 0
    ? `So putting it all together — ${clauses.join(', ')} — that's a combined potential of around ${totalWeekly.toLocaleString()} dollars a week. And these are conservative numbers.`
    : 'Based on what we have discussed, there are clear opportunities to grow your business with our agents.';

  return {
    objective: 'Deliver combined ROI across all core agents.',
    allowedMoves: ['advance:optional_side_agents'],
    requiredData: [],
    speak,
    ask: true,
    waitForUser: true,
    canSkip: false,
    advanceOn: ['user_replied'],
  };
}

// ─── Optional Side Agents (Chunk 1 stub) ────────────────────────────────────

function buildOptionalSideAgentsDirective(): StageDirective {
  return {
    objective: 'Optional side agents — Chunk 1 stub, auto-advance to close.',
    allowedMoves: ['advance:close'],
    requiredData: [],
    speak: '',
    ask: false,
    waitForUser: false,
    canSkip: true,
  };
}

// ─── Close ──────────────────────────────────────────────────────────────────

function buildCloseDirective(state: ConversationState): StageDirective {
  return {
    objective: 'Close the demo — offer next steps.',
    allowedMoves: ['close'],
    requiredData: [],
    speak: `I think there's a really strong fit here for ${state.businessName}. Would you like to book a time to go deeper with the team?`,
    ask: true,
    waitForUser: true,
    canSkip: false,
    advanceOn: ['user_replied'],
  };
}

// ─── Master Dispatcher ──────────────────────────────────────────────────────

export function buildStageDirective(stage: StageId, state: ConversationState): StageDirective {
  switch (stage) {
    case 'greeting':              return buildGreetingDirective(state);
    case 'wow_1': case 'wow_2': case 'wow_3': case 'wow_4':
    case 'wow_5': case 'wow_6': case 'wow_7': case 'wow_8':
      return buildWowDirective(state);
    case 'recommendation':        return buildRecommendationDirective(state);
    case 'anchor_acv':            return buildAnchorAcvDirective(state);
    case 'ch_alex':               return buildAlexDirective(state);
    case 'ch_chris':              return buildChrisDirective(state);
    case 'ch_maddie':             return buildMaddieDirective(state);
    case 'roi_delivery':          return buildRoiDeliveryDirective(state);
    case 'optional_side_agents':  return buildOptionalSideAgentsDirective();
    case 'close':                 return buildCloseDirective(state);
    default: {
      console.warn(`[MOVES] unknown stage: ${stage}`);
      return {
        objective: `Unknown stage: ${stage}`,
        allowedMoves: [],
        requiredData: [],
        speak: '',
        ask: false,
        waitForUser: false,
        canSkip: false,
      };
    }
  }
}
