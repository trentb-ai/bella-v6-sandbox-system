/**
 * call-brain-do/src/moves.ts — v2.0.0-do-alpha.1
 * THE BIG ONE: buildNextTurnPacket replaces buildStageDirective.
 * Returns structured NextTurnPacket for each stage/stall.
 */

import type { CallBrainState, NextTurnPacket, IndustryLanguagePack, Stage } from './types';
import { runCalcs, calcAgentROI, roiDeliveryCheck, computeROI } from './roi';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function lp(state: CallBrainState): IndustryLanguagePack {
  return state.intel.industryLanguage ?? {
    industryLabel: 'business', singularOutcome: 'client', pluralOutcome: 'clients',
    leadNoun: 'lead', conversionVerb: 'convert', revenueEvent: 'new client',
    kpiLabel: 'client value', missedOpportunity: 'missed opportunity',
    tone: 'practical', examples: [],
  };
}

function shortBiz(state: CallBrainState): string {
  const full = (state.intel.fast as any)?.core_identity?.business_name
    ?? (state.intel.consultant as any)?.businessIdentity?.correctedName
    ?? '';
  if (!full) return 'your business';
  const words = full.split(/\s+/);
  const stopWords = new Set(['the', 'a', 'an', 'and', 'of', 'in', 'for', 'by', 'at', 'to', 'pty', 'ltd', 'inc', 'llc', 'co', 'group', 'services', 'solutions', 'australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide']);
  const meaningful = words.filter((w: string) => !stopWords.has(w.toLowerCase()) && w.length > 1);
  return meaningful.slice(0, 3).join(' ') || full.slice(0, 30);
}

function firstName(state: CallBrainState): string {
  return (state.intel.fast as any)?.core_identity?.first_name
    ?? (state.intel.fast as any)?.firstName
    ?? '';
}

function bizName(state: CallBrainState): string {
  return (state.intel.fast as any)?.core_identity?.business_name
    ?? (state.intel.consultant as any)?.businessIdentity?.correctedName
    ?? shortBiz(state);
}

function tf(state: CallBrainState): string {
  return state.extracted.timeframe === 'weekly' ? 'week' : 'month';
}

function deep(state: CallBrainState): Record<string, any> {
  return (state.intel.deep as any) ?? {};
}

function consultant(state: CallBrainState): Record<string, any> {
  return (state.intel.consultant as any) ?? {};
}

function sf(state: CallBrainState): Record<string, any> {
  return consultant(state).scriptFills ?? {};
}

// ─── Extract targets per stage ───────────────────────────────────────────────

function extractTargetsForStage(stage: Stage): string[] {
  switch (stage) {
    case 'wow': return [];
    case 'anchor_acv': return ['acv'];
    case 'anchor_timeframe': return ['timeframe'];
    case 'ch_website': return ['web_leads', 'web_conversions', 'web_followup_speed'];
    case 'ch_ads': return ['ads_leads', 'ads_conversions', 'ads_followup_speed'];
    case 'ch_phone': return ['phone_volume', 'missed_call_handling', 'missed_call_callback_speed'];
    case 'ch_old_leads': return ['old_leads'];
    case 'ch_reviews': return ['new_customers', 'has_review_system'];
    case 'roi_delivery': return [];
    case 'close': return [];
  }
}

// ─── Style defaults ──────────────────────────────────────────────────────────

function baseStyle(state: CallBrainState): NextTurnPacket['style'] {
  const pack = lp(state);
  return {
    tone: pack.tone,
    industryTerms: pack.examples.slice(0, 3),
    maxSentences: 3,
    noApology: true,
  };
}

// ─── Build critical facts from intel ─────────────────────────────────────────

function buildCriticalFacts(state: CallBrainState, max: number = 5): string[] {
  const facts: string[] = [];
  const fn = firstName(state);
  const biz = bizName(state);
  const pack = lp(state);
  const d = deep(state);
  const c = consultant(state);

  if (fn) facts.push(`Prospect name: ${fn}`);
  if (biz) facts.push(`Business: ${biz}`);
  if (pack.industryLabel !== 'business') facts.push(`Industry: ${pack.industryLabel}`);

  const rating = d.googleMaps?.rating;
  if (rating) facts.push(`Google rating: ${rating} stars (${d.googleMaps?.review_count ?? 0} reviews)`);

  const routing = c.routing;
  if (routing?.priority_agents?.length) {
    facts.push(`Priority agents: ${routing.priority_agents.slice(0, 2).join(', ')}`);
  }

  return facts.slice(0, max);
}

// ─── WOW stall builders (9 stalls) ──────────────────────────────────────────

function buildWowPacket(state: CallBrainState): NextTurnPacket {
  const fn = firstName(state);
  const biz = bizName(state);
  const pack = lp(state);
  const d = deep(state);
  const c = consultant(state);
  const s = sf(state);

  const googleRating = d.googleMaps?.rating ?? null;
  const googleReviews = d.googleMaps?.review_count ?? 0;
  const icpGuess = s.icp_guess ?? '';
  const icpProblems = c.icpAnalysis?.icpProblems ?? [];
  const icpSolutions = c.icpAnalysis?.icpSolutions ?? [];
  const referenceOffer = s.reference_offer ?? '';
  const websitePositive = s.website_positive_comment ?? '';
  const heroQuote = s.hero_header_quote ?? '';
  const cea = c.conversionEventAnalysis ?? {};
  const primaryCTA = cea.primaryCTA ?? s.top_2_website_ctas ?? '';
  const hiringData = d.hiring ?? {};
  const hiringMatches = hiringData.hiring_agent_matches ?? [];
  const isHiring = !!(hiringData.is_hiring || hiringMatches.length > 0);
  const routing = c.routing ?? {};
  const priorityAgents: string[] = (routing.priority_agents ?? []).map((a: string) =>
    a.charAt(0).toUpperCase() + a.slice(1).toLowerCase());

  const adsOn = !!(
    (state.intel.fast as any)?.flags?.is_running_ads
    || d.ads?.is_running_google_ads
    || (d.ads?.google_ads_count ?? 0) > 0
    || (d.ads?.fb_ads_count ?? 0) > 0
  );

  const stall = state.wowStall;
  const style = { ...baseStyle(state), maxSentences: 3 };

  // Stall 1: Research intro + permission
  if (stall === 1) {
    return {
      stage: 'wow', wowStall: 1,
      objective: 'Establish credibility with research intro, get permission to continue',
      chosenMove: {
        id: 'wow_s1_research',
        kind: 'insight',
        text: `Now ${fn}, I think you'll be impressed. We've done some research on ${biz}, and we use that to pre-train your agents so they understand your ${pack.pluralOutcome}, your industry, and how you win business. Can I quickly confirm a couple of our findings with you, just to make sure your agents are dialled in?`,
      },
      criticalFacts: buildCriticalFacts(state, 3),
      extractTargets: [],
      validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
      style,
    };
  }

  // Stall 2: Reputation + free trial (skip if no rating >= 3)
  if (stall === 2) {
    if (googleRating && googleRating >= 3) {
      state.flags.trialMentioned = true;
      return {
        stage: 'wow', wowStall: 2,
        objective: 'Leverage reputation for free trial mention',
        chosenMove: {
          id: 'wow_s2_reputation',
          kind: 'insight',
          text: `Oh ${fn}, I noticed ${biz} has a ${googleRating}-star reputation from ${googleReviews} reviews — that's strong. Businesses already delivering good ${pack.singularOutcome} outcomes qualify for our free trial, so if you'd like, I can get that set up for you at any point during this demo.`,
        },
        criticalFacts: buildCriticalFacts(state, 3),
        extractTargets: [],
        validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
        style,
      };
    }
    // No reviews → skip to stall 3 (DO will increment wowStall)
    state.wowStall = 3;
    return buildWowPacket(state);
  }

  // Stall 3: ICP + problems + solutions (combined per Perplexity spec)
  if (stall === 3) {
    const cleanIcp = icpGuess
      ? icpGuess.replace(/^it\s+(looks|seems)\s+like\s+/i, '').replace(/[,;—–-]+\s*(is that right|right|yeah)\??\s*$/i, '').replace(/\?+$/, '').trim()
      : '';
    const bellaCheck = c.icpAnalysis?.bellaCheckLine ?? '';
    let insightText = '';

    // PRIMARY: ICP + problems + solutions when data is rich
    if (cleanIcp && icpProblems.length >= 2 && icpSolutions.length >= 2) {
      insightText = `It looks like you're primarily targeting ${cleanIcp}. The typical challenges your ${pack.pluralOutcome} face are ${icpProblems[0]} and ${icpProblems[1]}, and you solve those through ${icpSolutions[0]} and ${icpSolutions[1]}. Does that sound right?`;
    }
    // FALLBACK: positioning from referenceOffer
    else if (referenceOffer && cleanIcp) {
      const industryAudience = cleanIcp || pack.pluralOutcome;
      insightText = `From your website, it looks like your positioning is really centred around ${referenceOffer}, and the way you present it suggests you're speaking to ${industryAudience}. Does that sound right?`;
    }
    // LAST RESORT: bellaCheckLine or generic
    else if (bellaCheck) {
      insightText = bellaCheck;
    } else {
      insightText = `The site does a strong job of positioning what ${shortBiz(state)} does. Does that sound right?`;
    }

    return {
      stage: 'wow', wowStall: 3,
      objective: 'Confirm ICP, problems, and solutions',
      chosenMove: { id: 'wow_s3_icp', kind: 'question', text: insightText },
      criticalFacts: buildCriticalFacts(state, 3),
      extractTargets: [],
      validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
      style,
    };
  }

  // Stall 4: Pre-training connect (exact Perplexity spec text)
  if (stall === 4) {
    let trialAppend = '';
    if (!state.flags.trialMentioned) {
      state.flags.trialMentioned = true;
      trialAppend = ` If you'd like, I can also help you activate the free trial during this session.`;
    }
    return {
      stage: 'wow', wowStall: 4,
      objective: 'Connect pre-training to revenue generation',
      chosenMove: {
        id: 'wow_s4_pretrain',
        kind: 'insight',
        text: `That's exactly the kind of business intelligence we've used to pre-train your AI team — so they don't sound generic. They understand your positioning, your ${pack.pluralOutcome}, your reputation, and most importantly how you generate revenue.${trialAppend}`,
      },
      criticalFacts: buildCriticalFacts(state, 3),
      extractTargets: [],
      validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
      style: { ...style, maxSentences: trialAppend ? 3 : 2 },
    };
  }

  // Stall 5: Conversion event alignment — use consultant pre-built spoken lines
  if (stall === 5) {
    const convNarrative = cea.conversionNarrative ?? '';
    const agentTrainingLine = cea.agentTrainingLine ?? '';
    let conversionLine = '';
    // Priority 1: conversionNarrative (already written for Bella to speak)
    if (convNarrative) conversionLine = convNarrative;
    // Priority 2: agentTrainingLine
    else if (agentTrainingLine) conversionLine = agentTrainingLine;
    // Priority 3: rebuild from primaryCTA
    else if (primaryCTA) conversionLine = `So looking at your website, it seems your main conversion event is ${primaryCTA}. That's how you turn interest into new ${pack.pluralOutcome}, and it's exactly the kind of action we train your AI agents to drive more of, automatically`;
    else conversionLine = `And looking at how your site is set up to convert visitors into ${pack.pluralOutcome}, that's exactly the kind of action we train our AI agents to drive more of, automatically`;

    return {
      stage: 'wow', wowStall: 5,
      objective: 'Align conversion events with agent capabilities',
      chosenMove: { id: 'wow_s5_conversion', kind: 'insight', text: `${conversionLine}. Would that be useful?` },
      criticalFacts: buildCriticalFacts(state, 3),
      extractTargets: [],
      validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
      style,
    };
  }

  // Stall 6: Audit setup transition (bridge move, NOT a question — per Perplexity Channel Speed Rule)
  if (stall === 6) {
    return {
      stage: 'wow', wowStall: 6,
      objective: 'Transition from WOW insights to audit questions',
      chosenMove: {
        id: 'wow_s6_audit', kind: 'bridge',
        text: `Perfect — so that confirms your agents are trained to bring in the right kind of ${pack.pluralOutcome} and move them toward your key conversion points. I've just got a couple of quick opportunity-audit questions so I can work out which agent mix would be most valuable for ${biz}.`,
      },
      criticalFacts: buildCriticalFacts(state, 3),
      extractTargets: [],
      validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
      style,
    };
  }

  // Stall 7: Main controllable source — 3 variants per Perplexity spec
  if (stall === 7) {
    // Detect if source is already mostly clear from intel signals
    const priorityAgentsList = routing.priority_agents ?? [];
    const hasStrongPhoneSignal = !!(
      (state.intel.fast as any)?.flags?.call_handling_needed
      || (state.intel.fast as any)?.flags?.speed_to_lead_needed
    );
    const sourceAlreadyClear = priorityAgentsList.length >= 2 && (adsOn || hasStrongPhoneSignal);
    const detectedChannel = adsOn ? 'paid advertising' : hasStrongPhoneSignal ? 'inbound phone calls' : 'your website';

    let sourceQ = '';
    if (sourceAlreadyClear) {
      sourceQ = `Now ${fn}, apart from referrals, it looks like ${detectedChannel} is a meaningful source of new ${pack.leadNoun}s for you — is that fair to say?`;
    } else if (adsOn) {
      sourceQ = `Now ${fn}, I can see you're already running ads, which is interesting. Apart from referrals, would you say that's your main source of new ${pack.leadNoun}s, or is another channel doing most of the heavy lifting?`;
    } else {
      sourceQ = `Apart from referrals, what would you say is your main source of new ${pack.leadNoun}s right now — your website, phone calls, organic, paid ads, or something else?`;
    }
    return {
      stage: 'wow', wowStall: 7,
      objective: 'Identify main lead source',
      chosenMove: { id: 'wow_s7_source', kind: 'question', text: sourceQ },
      criticalFacts: buildCriticalFacts(state, 3),
      extractTargets: [],
      validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
      style,
    };
  }

  // Stall 8: Hiring / capacity wedge (skip if no wedge + budget tight)
  if (stall === 8) {
    if (!isHiring && state.flags.questionBudgetTight) {
      state.wowStall = 9;
      return buildWowPacket(state);
    }
    const topHiringWedge = c.hiringAnalysis?.topHiringWedge ?? '';
    let hiringLine = '';
    if (topHiringWedge) {
      // Use consultant's pre-written wedge line as PRIMARY
      hiringLine = topHiringWedge;
    } else if (isHiring && hiringMatches.length > 0) {
      hiringLine = `I also noticed you're hiring for ${hiringMatches[0].role || hiringMatches[0].title}, which is interesting because that's exactly the kind of workload one of our agents can often absorb.`;
    } else if (isHiring) {
      hiringLine = `I noticed you're actively hiring — some of those roles are exactly what our AI agents handle.`;
    } else {
      hiringLine = `And are you doing any hiring at the moment?`;
    }

    return {
      stage: 'wow', wowStall: 8,
      objective: 'Hiring capacity wedge or data check',
      chosenMove: { id: 'wow_s8_hiring', kind: isHiring || topHiringWedge ? 'insight' : 'question', text: hiringLine },
      criticalFacts: buildCriticalFacts(state, 3),
      extractTargets: [],
      validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
      style,
    };
  }

  // Stall 9: Provisional recommendation + SHORT bridge to numbers (per Perplexity spec)
  {
    const a1 = priorityAgents[0] ?? 'Chris';
    const a2 = priorityAgents[1] ?? 'Alex';
    const ctaMapping = cea.ctaAgentMapping ?? '';

    // Recommendation part — use ctaAgentMapping if available
    let recLine = '';
    if (ctaMapping) {
      recLine = `Based on what I've found so far, the likely standouts for ${biz} look like ${a1} and ${a2}. ${ctaMapping}`;
    } else if (isHiring && hiringMatches.length > 0) {
      const topMatch = hiringMatches[0];
      const hiringAgent = topMatch.agents?.[0] ?? a1;
      recLine = `Based on what I've found so far, the likely standouts for ${biz} look like ${hiringAgent} and ${a2}. ${hiringAgent} would help with ${topMatch.wedge || 'that role you\'re hiring for'}, and ${a2} would help with making sure every ${pack.singularOutcome} lead gets followed up.`;
    } else {
      recLine = `Based on what I've found so far, the likely standouts for ${biz} look like ${a1} and ${a2}. ${a1} would help with engaging visitors on your website before they bounce, and ${a2} would help with following up every ${pack.singularOutcome} enquiry.`;
    }
    // Bridge part — SHORT, one line, then STOP
    recLine += ` If you want, I can now work out which of those would likely generate the most extra revenue for you.`;

    return {
      stage: 'wow', wowStall: 9,
      objective: 'Recommend agents and bridge to number crunching',
      chosenMove: { id: 'wow_s9_rec', kind: 'bridge', text: recLine },
      criticalFacts: buildCriticalFacts(state, 5),
      extractTargets: [],
      validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
      style: { ...style, maxSentences: 4 },
    };
  }
}

// ─── Channel stage packet builders ──────────────────────────────────────────

function buildAnchorAcvPacket(state: CallBrainState): NextTurnPacket {
  const fn = firstName(state);
  const biz = bizName(state);
  const pack = lp(state);
  const e = state.extracted;

  if (e.acv) {
    return {
      stage: 'anchor_acv', wowStall: null,
      objective: 'Confirm value and ask timeframe',
      chosenMove: { id: 'acv_confirmed', kind: 'question', text: `Got it, thanks. And when you think about lead flow, do you usually measure it weekly or monthly?` },
      criticalFacts: [`${pack.singularOutcome} value: $${e.acv.toLocaleString()}`],
      extractTargets: ['timeframe'],
      validation: { mustCaptureAny: ['timeframe'], advanceOnlyIf: ['timeframe'], doNotAdvanceIf: [] },
      style: baseStyle(state),
    };
  }

  return {
    stage: 'anchor_acv', wowStall: null,
    objective: 'Capture client value',
    chosenMove: {
      id: 'acv_ask', kind: 'question',
      text: `Perfect. What's a new ${pack.singularOutcome} worth to ${biz} on average? A ballpark is totally fine.`,
    },
    criticalFacts: buildCriticalFacts(state, 3),
    extractTargets: ['acv'],
    validation: { mustCaptureAny: ['acv'], advanceOnlyIf: ['acv'], doNotAdvanceIf: [] },
    style: baseStyle(state),
  };
}

function buildAnchorTimeframePacket(state: CallBrainState): NextTurnPacket {
  const e = state.extracted;
  if (e.timeframe) {
    return {
      stage: 'anchor_timeframe', wowStall: null,
      objective: 'Acknowledge timeframe, advance to channels',
      chosenMove: { id: 'tf_confirmed', kind: 'bridge', text: `Great, ${e.timeframe} it is. Let me ask you a few quick questions about your current lead channels.` },
      criticalFacts: [`Timeframe: ${e.timeframe}`, `ACV: $${e.acv?.toLocaleString()}`],
      extractTargets: [],
      validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
      style: baseStyle(state),
    };
  }

  return {
    stage: 'anchor_timeframe', wowStall: null,
    objective: 'Capture weekly vs monthly preference',
    chosenMove: { id: 'tf_ask', kind: 'question', text: `Got it, thanks. And when you think about lead flow, do you usually measure it weekly or monthly?` },
    criticalFacts: [`ACV: $${e.acv?.toLocaleString() ?? 'pending'}`],
    extractTargets: ['timeframe'],
    validation: { mustCaptureAny: ['timeframe'], advanceOnlyIf: ['timeframe'], doNotAdvanceIf: [] },
    style: baseStyle(state),
  };
}

function buildChannelAdsPacket(state: CallBrainState): NextTurnPacket {
  const e = state.extracted;
  const fn = firstName(state);
  const pack = lp(state);
  const period = tf(state);

  const adsOn = !!(
    (state.intel.fast as any)?.flags?.is_running_ads
    || deep(state).ads?.is_running_google_ads
    || (deep(state).ads?.google_ads_count ?? 0) > 0
    || (deep(state).ads?.fb_ads_count ?? 0) > 0
  );

  // All inputs captured → deliver ROI inline
  if (e.ads_leads !== null && e.ads_conversions !== null) {
    const alexCalc = calcAgentROI('Alex', state);
    if (alexCalc) {
      return {
        stage: 'ch_ads', wowStall: null,
        objective: 'Deliver Alex ROI calculation',
        chosenMove: {
          id: 'ch_ads_roi', kind: 'roi',
          text: `So your average ${pack.singularOutcome} is worth ${e.acv!.toLocaleString()} dollars, and you're currently converting ${e.ads_conversions} from ${e.ads_leads} ad leads per ${period}. Based on the follow-up speed you mentioned, Alex could conservatively add around ${alexCalc.weekly.toLocaleString()} dollars per week just by improving speed-to-lead. Does that make sense?`,
        },
        criticalFacts: [`Alex weekly: $${alexCalc.weekly.toLocaleString()}`],
        extractTargets: [],
        validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
        style: { ...baseStyle(state), maxSentences: 4 },
      };
    }
  }

  // Need more data
  let questionText = '';
  if (e.ads_leads == null) {
    questionText = adsOn
      ? `How many leads are your ads generating per ${period}? Just a rough figure is fine.`
      : `I didn't see any Google or Facebook ads campaigns — is that right? Are you running any other online campaigns?`;
  } else if (e.ads_conversions == null) {
    questionText = `And roughly how many of those are converting into paying ${pack.pluralOutcome}?`;
  } else if (e.ads_followup_speed == null) {
    questionText = `And when those ad leads come in, how quickly is your team following up — under 30 minutes, 30 minutes to 3 hours, 3 to 24 hours, or more than 24 hours?`;
  }

  return {
    stage: 'ch_ads', wowStall: null,
    objective: 'Capture ads channel metrics',
    chosenMove: { id: 'ch_ads_ask', kind: 'question', text: questionText },
    criticalFacts: buildCriticalFacts(state, 3),
    extractTargets: extractTargetsForStage('ch_ads'),
    validation: { mustCaptureAny: ['ads_leads', 'ads_conversions'], advanceOnlyIf: ['ads_leads', 'ads_conversions'], doNotAdvanceIf: [] },
    style: baseStyle(state),
  };
}

function buildChannelWebsitePacket(state: CallBrainState): NextTurnPacket {
  const e = state.extracted;
  const pack = lp(state);
  const period = tf(state);

  if (e.web_leads !== null && e.web_conversions !== null) {
    const chrisCalc = calcAgentROI('Chris', state);
    if (chrisCalc) {
      return {
        stage: 'ch_website', wowStall: null,
        objective: 'Deliver Chris ROI calculation',
        chosenMove: {
          id: 'ch_web_roi', kind: 'roi',
          text: `So you're getting around ${e.web_leads} website leads per ${period}, and converting about ${e.web_conversions} of them into paying ${pack.pluralOutcome}. Chris, our Website Concierge, typically lifts conversion by engaging visitors in real time, and at your value of ${e.acv!.toLocaleString()} dollars that could mean roughly ${chrisCalc.weekly.toLocaleString()} dollars per week in additional revenue. Does that sound reasonable?`,
        },
        criticalFacts: [`Chris weekly: $${chrisCalc.weekly.toLocaleString()}`, 'Conversion lift: ~23% (real-time engagement)'],
        extractTargets: [],
        validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
        style: { ...baseStyle(state), maxSentences: 4 },
      };
    }
  }

  let questionText = '';
  if (e.web_leads == null) {
    questionText = `How many enquiries or leads is your website generating per ${period}?`;
  } else if (e.web_conversions == null) {
    questionText = `And roughly how many of those convert into paying ${pack.pluralOutcome}?`;
  } else if (e.web_followup_speed == null) {
    questionText = `And when a website enquiry comes in, how quickly is your team usually getting back to them?`;
  }

  return {
    stage: 'ch_website', wowStall: null,
    objective: 'Capture website channel metrics',
    chosenMove: { id: 'ch_web_ask', kind: 'question', text: questionText },
    criticalFacts: buildCriticalFacts(state, 3),
    extractTargets: extractTargetsForStage('ch_website'),
    validation: { mustCaptureAny: ['web_leads', 'web_conversions'], advanceOnlyIf: ['web_leads', 'web_conversions'], doNotAdvanceIf: [] },
    style: baseStyle(state),
  };
}

function buildChannelPhonePacket(state: CallBrainState): NextTurnPacket {
  const e = state.extracted;
  const biz = bizName(state);
  const pack = lp(state);
  const period = tf(state);

  if (e.phone_volume !== null && e.missed_call_handling !== null) {
    const maddieCalc = calcAgentROI('Maddie', state);
    if (maddieCalc) {
      return {
        stage: 'ch_phone', wowStall: null,
        objective: 'Deliver Maddie ROI calculation',
        chosenMove: {
          id: 'ch_phone_roi', kind: 'roi',
          text: `So you're getting around ${e.phone_volume} inbound calls per ${period}, and when calls are missed they're currently handled by ${e.missed_call_handling}. Even a small percentage of missed opportunities there adds up fast, so conservatively Maddie could recover around ${maddieCalc.weekly.toLocaleString()} dollars per week in extra revenue by answering and qualifying more of those calls consistently. Does that track?`,
        },
        criticalFacts: [`Maddie weekly: $${maddieCalc.weekly.toLocaleString()}`],
        extractTargets: [],
        validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
        style: { ...baseStyle(state), maxSentences: 4 },
      };
    }
  }

  let questionText = '';
  if (e.phone_volume == null) {
    questionText = `Roughly how many inbound calls does ${biz} get per ${period}?`;
  } else if (e.missed_call_handling == null) {
    questionText = `And when calls are missed — whether that's after hours or during busy periods — what usually happens?`;
  } else if (e.missed_call_callback_speed == null) {
    questionText = `And how quickly are missed calls usually called back?`;
  }

  return {
    stage: 'ch_phone', wowStall: null,
    objective: 'Capture phone channel metrics',
    chosenMove: { id: 'ch_phone_ask', kind: 'question', text: questionText },
    criticalFacts: buildCriticalFacts(state, 3),
    extractTargets: extractTargetsForStage('ch_phone'),
    validation: { mustCaptureAny: ['phone_volume', 'missed_call_handling'], advanceOnlyIf: ['phone_volume', 'missed_call_handling'], doNotAdvanceIf: [] },
    style: baseStyle(state),
  };
}

function buildChannelOldLeadsPacket(state: CallBrainState): NextTurnPacket {
  const e = state.extracted;
  const pack = lp(state);

  if (e.old_leads !== null) {
    const sarahCalc = calcAgentROI('Sarah', state);
    if (sarahCalc) {
      return {
        stage: 'ch_old_leads', wowStall: null,
        objective: 'Deliver Sarah ROI calculation',
        chosenMove: {
          id: 'ch_old_roi', kind: 'roi',
          text: `If even a small percentage of those older leads re-engage, Sarah could turn that dormant database into a real revenue channel. Based on the number you gave me, that could look like around ${sarahCalc.weekly.toLocaleString()} dollars per week in recovered opportunity. Sound fair?`,
        },
        criticalFacts: [`Sarah weekly: $${sarahCalc.weekly.toLocaleString()}`, `Database: ${e.old_leads.toLocaleString()} past ${pack.pluralOutcome}`],
        extractTargets: [],
        validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
        style: { ...baseStyle(state), maxSentences: 3 },
      };
    }
  }

  return {
    stage: 'ch_old_leads', wowStall: null,
    objective: 'Capture dormant leads count',
    chosenMove: { id: 'ch_old_ask', kind: 'question', text: `How many past ${pack.pluralOutcome} or older leads would you say are sitting in your database that haven't been contacted in a while?` },
    criticalFacts: buildCriticalFacts(state, 3),
    extractTargets: ['old_leads'],
    validation: { mustCaptureAny: ['old_leads'], advanceOnlyIf: ['old_leads'], doNotAdvanceIf: [] },
    style: baseStyle(state),
  };
}

function buildChannelReviewsPacket(state: CallBrainState): NextTurnPacket {
  const e = state.extracted;
  const pack = lp(state);
  const period = tf(state);

  if (e.new_customers !== null && e.has_review_system !== null) {
    const jamesCalc = calcAgentROI('James', state);
    if (jamesCalc && jamesCalc.weekly > 0) {
      return {
        stage: 'ch_reviews', wowStall: null,
        objective: 'Deliver James ROI calculation',
        chosenMove: {
          id: 'ch_reviews_roi', kind: 'roi',
          text: `With your current ${pack.singularOutcome} flow, even a modest lift in review volume and response consistency can materially improve trust and conversion. Conservatively, James could create around ${jamesCalc.weekly.toLocaleString()} dollars per week in additional value by increasing review momentum and protecting your reputation. Does that seem realistic?`,
        },
        criticalFacts: [`James weekly: $${jamesCalc.weekly.toLocaleString()}`, '1-star improvement drives ~9% more revenue'],
        extractTargets: [],
        validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
        style: { ...baseStyle(state), maxSentences: 3 },
      };
    }
  }

  let questionText = '';
  if (e.new_customers == null) {
    questionText = `How many new ${pack.pluralOutcome} would you say you're taking on each ${period}?`;
  } else if (e.has_review_system == null) {
    questionText = `And do you have any kind of system in place to ask those ${pack.pluralOutcome} for a review?`;
  }

  return {
    stage: 'ch_reviews', wowStall: null,
    objective: 'Capture review channel metrics',
    chosenMove: { id: 'ch_reviews_ask', kind: 'question', text: questionText },
    criticalFacts: buildCriticalFacts(state, 3),
    extractTargets: extractTargetsForStage('ch_reviews'),
    validation: { mustCaptureAny: ['new_customers', 'has_review_system'], advanceOnlyIf: ['new_customers', 'has_review_system'], doNotAdvanceIf: [] },
    style: baseStyle(state),
  };
}

function buildRoiDeliveryPacket(state: CallBrainState): NextTurnPacket {
  const fn = firstName(state);
  const pack = lp(state);
  const period = tf(state);

  // Compute ROI if not yet done
  if (!state.flags.roiComputed) {
    computeROI(state);
  }

  const calcs = runCalcs(state);
  const total = calcs.reduce((sum, c) => sum + c.weekly, 0);
  const top3 = calcs.slice(0, 3);

  // Perplexity clean format: agent-by-agent + combined total, NO annual, NO trial re-pitch
  const agentLines = top3.map(c => `${c.agent} at about ${c.weekly.toLocaleString()} dollars per ${period}`).join(', and ');

  return {
    stage: 'roi_delivery', wowStall: null,
    objective: 'Deliver combined ROI total — conservative, no trial pitch',
    chosenMove: {
      id: 'roi_delivery_total', kind: 'roi',
      text: `So ${fn}, let me add that up for you. We've got ${agentLines}. That's a combined total of approximately ${total.toLocaleString()} dollars per ${period} in additional revenue across your selected agents — and those are conservative numbers. Does that all make sense?`,
    },
    criticalFacts: top3.map(c => `${c.agent}: $${c.weekly.toLocaleString()}/wk (${c.why})`),
    extractTargets: [],
    validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
    style: { ...baseStyle(state), maxSentences: 4 },
    roi: {
      agentValues: Object.fromEntries(top3.map(c => [c.agent, c.weekly])),
      totalValue: total,
    },
  };
}

function buildClosePacket(state: CallBrainState): NextTurnPacket {
  const fn = firstName(state);
  return {
    stage: 'close', wowStall: null,
    objective: 'Close for trial setup',
    chosenMove: {
      id: 'close_trial', kind: 'close',
      text: `Perfect. Would you like to go ahead and activate your free trial? It takes about ten minutes to set up, there's no credit card required, and you could start seeing results this week.`,
    },
    criticalFacts: buildCriticalFacts(state, 3),
    extractTargets: [],
    validation: { mustCaptureAny: [], advanceOnlyIf: [], doNotAdvanceIf: [] },
    style: baseStyle(state),
  };
}

// ─── MAIN ENTRY POINT ───────────────────────────────────────────────────────

export function buildNextTurnPacket(state: CallBrainState): NextTurnPacket {
  switch (state.stage) {
    case 'wow':              return buildWowPacket(state);
    case 'anchor_acv':       return buildAnchorAcvPacket(state);
    case 'anchor_timeframe': return buildAnchorTimeframePacket(state);
    case 'ch_ads':           return buildChannelAdsPacket(state);
    case 'ch_website':       return buildChannelWebsitePacket(state);
    case 'ch_phone':         return buildChannelPhonePacket(state);
    case 'ch_old_leads':     return buildChannelOldLeadsPacket(state);
    case 'ch_reviews':       return buildChannelReviewsPacket(state);
    case 'roi_delivery':     return buildRoiDeliveryPacket(state);
    case 'close':            return buildClosePacket(state);
  }
}
