/**
 * call-brain-do/src/moves.ts — v4.1.0-audit1-parity
 * V2 directive builder: buildStageDirective.
 *
 * Chunk 4A: greeting, wow (8 WowStepId steps), recommendation (4 variants), anchor_acv.
 * Chunk 4B: ch_alex, ch_chris, ch_maddie, roi_delivery, optional_side_agents, close.
 *
 * v4.1.0 AUDIT-1 fixes: icpNarrative, convNarrative, bellaCheckLine priorities,
 * audit framing in wow_5, normaliseBizName in biz(), ttsAcronym for TTS safety.
 *
 * No V1 compat — all consumers migrated to buildStageDirective.
 */

import type {
  ConversationState,
  StageId,
  WowStepId,
  CoreAgent,
  StageDirective,
  StageDirectiveInput,
  MergedIntel,
  IndustryLanguagePack,
  StagePolicy,
  AgentRoiResult,
} from './types';

import { GENERIC_INDUSTRY_PACK } from './state';
import { STAGE_POLICIES, shouldForceAdvance, maxQuestionsReached } from './gate';
import { getDeepIntelFallbackWow } from './helpers/deepIntelFallback';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve industry language pack from state. */
function lp(state: ConversationState): IndustryLanguagePack {
  if (state.industryLanguage && state.industryLanguage.industryLabel !== 'business') {
    return state.industryLanguage;
  }
  if (state.intel.industryLanguagePack && state.intel.industryLanguagePack.industryLabel !== 'business') {
    return state.intel.industryLanguagePack;
  }
  return GENERIC_INDUSTRY_PACK;
}

/** Resolve prospect first name. */
function fn(state: ConversationState): string {
  if (state.firstName) return state.firstName;
  const fast = state.intel.fast as any;
  return fast?.core_identity?.first_name ?? fast?.firstName ?? '';
}

/**
 * ttsAcronym: "AMP" → "A. M. P.", "KPMG" → "K. P. M. G."
 * Deepgram TTS reads all-caps 2-4 letter names as words.
 * Letter-spacing forces letter-by-letter pronunciation.
 */
function ttsAcronym(name: string): string {
  if (!name || name.length < 2 || name.length > 4) return name;
  if (!/^[A-Z]+$/.test(name)) return name;
  return name.split('').join('. ') + '.';
}

/**
 * normaliseBizName: strip Australian city suffixes and legal suffixes
 * so Bella says "Pitcher Partners" not "Pitcher Partners Sydney Pty Ltd".
 * Ported from bridge (deepgram-bridge-v11/src/index.ts).
 */
function normaliseBizName(raw: string): string {
  if (!raw || raw === 'your business') return raw;
  let name = raw.trim();
  // Strip legal first, then city (order matters: "Foo Sydney Pty Ltd" → "Foo Sydney" → "Foo")
  name = name.replace(/\s+(?:Pty\.?\s*Ltd\.?|Ltd\.?|Inc\.?|LLC|Co\.?|Corp\.?|Limited|Proprietary)\s*$/i, '').trim();
  name = name.replace(/\s+(?:Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|Geelong|Newcastle|Wollongong|Cairns|Townsville|Toowoomba|Ballarat|Bendigo|Mandurah|Launceston|Mackay|Rockhampton|Bunbury|Bundaberg|Hervey Bay|Wagga Wagga|Mildura|Shepparton|Gladstone|Albury|Australia|AU|NZ|New Zealand)\s*$/i, '').trim();
  // Safety: if we stripped everything, return original
  return name.length >= 2 ? name : raw.trim();
}

/** Resolve full business name — normalised for speech and TTS-safe. */
function biz(state: ConversationState): string {
  let rawName: string;
  if (state.business) {
    rawName = state.business;
  } else {
    const fast = state.intel.fast as any;
    const cons = (state.intel.consultant as any) ?? {};
    rawName = fast?.core_identity?.business_name
      ?? cons?.businessIdentity?.correctedName
      ?? 'your business';
  }
  if (rawName === 'your business') return rawName;
  return ttsAcronym(normaliseBizName(rawName));
}

/** Short business name — spokenName priority 1, then strip stop words, take first 3 meaningful words, TTS-safe. */
function shortBiz(state: ConversationState): string {
  // Priority 1: consultant spokenName — already optimised for speech
  const cons = (state.intel.consultant as any) ?? {};
  const spokenName = cons?.businessIdentity?.spokenName;
  if (spokenName && typeof spokenName === 'string' && spokenName.length >= 2) {
    return ttsAcronym(spokenName);
  }

  // Fallback: strip stop words from full biz name
  const full = biz(state);
  if (full === 'your business') return full;
  const words = full.split(/\s+/);
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'of', 'in', 'for', 'by', 'at', 'to',
    'pty', 'ltd', 'inc', 'llc', 'co', 'group', 'services', 'solutions',
    'australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide',
  ]);
  const meaningful = words.filter((w: string) => !stopWords.has(w.toLowerCase()) && w.length > 1);
  const short = meaningful.slice(0, 3).join(' ') || full.slice(0, 30);
  return ttsAcronym(short);
}

/** Consultant intel blob. */
function consultant(state: ConversationState): Record<string, any> {
  return (state.intel.consultant as any) ?? {};
}

/** Script fills from consultant. */
function sf(state: ConversationState): Record<string, any> {
  return consultant(state).scriptFills ?? {};
}

/** Deep intel blob. */
function deep(state: ConversationState): Record<string, any> {
  return (state.intel.deep as any) ?? {};
}

/** Map responseSpeedBand to a natural spoken label. */
function bandToSpokenLabel(band: string | null | undefined): string {
  switch (band) {
    case 'under_30_seconds':      return 'under thirty seconds';
    case 'under_5_minutes':       return 'under five minutes';
    case '5_to_30_minutes':       return 'five to thirty minutes';
    case '30_minutes_to_2_hours': return 'thirty minutes to two hours';
    case '2_to_24_hours':         return 'two to twenty-four hours';
    case 'next_day_plus':         return 'next day or longer';
    default:                      return 'your current response time';
  }
}

/** Clean a single fact string — strip quotes, JSON fragments, short noise. */
function cleanFact(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^["'`]+|["'`]+$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.includes('{') || s.includes('}') || s.includes('":') || s.includes('[]') || s.length < 6) return null;
  return s;
}

/** Clean an array of facts. */
function cleanFacts(inputs: unknown[]): string[] {
  return inputs.map(cleanFact).filter((x): x is string => Boolean(x));
}

// ─── Critical Facts Builder (stable business truths — whole call) ────────────

/**
 * buildCriticalFacts — stable business truths that hold across the entire call.
 * Hard cap: 6 items. No stage parameter — these never change mid-call.
 */
export function buildCriticalFacts(state: ConversationState): string[] {
  const raw: string[] = [];
  const keys: string[] = [];
  const intel = consultant(state);
  if (!intel || Object.keys(intel).length === 0) {
    console.log(`[CRITICAL_FACTS] count=0 keys=NO_INTEL`);
    return [];
  }

  const marketPosition = intel.icpAnalysis?.marketPositionNarrative;
  if (marketPosition && typeof marketPosition === 'string') {
    raw.push(marketPosition);
    keys.push('marketPosition');
  }

  const strongestBenefit = intel.valuePropAnalysis?.strongestBenefit;
  if (strongestBenefit && typeof strongestBenefit === 'string') {
    raw.push(strongestBenefit);
    keys.push('strongestBenefit');
  }

  const bizModel = intel.businessIdentity?.businessModel;
  if (bizModel && typeof bizModel === 'string' && bizModel.length < 80) {
    raw.push(bizModel);
    keys.push('businessModel');
  }

  const serviceArea = intel.businessIdentity?.serviceArea;
  if (serviceArea && typeof serviceArea === 'string' && serviceArea.length < 80) {
    raw.push(serviceArea);
    keys.push('serviceArea');
  }

  const topHiringWedge = intel.hiringAnalysis?.topHiringWedge;
  if (topHiringWedge && typeof topHiringWedge === 'string') {
    const firstSentence = topHiringWedge.split(/[.!?]/)[0]?.trim();
    if (firstSentence) {
      raw.push(firstSentence + '.');
      keys.push('topHiringWedge');
    }
  }

  const verdictLine = intel.landingPageVerdict?.verdictLine;
  if (verdictLine && typeof verdictLine === 'string') {
    raw.push(verdictLine);
    keys.push('verdictLine');
  }

  const result = cleanFacts(raw).slice(0, 6);
  console.log(`[CRITICAL_FACTS] count=${result.length} keys=${keys.slice(0, result.length).join(',')}`);
  return result;
}

// ─── Context Notes Builder (stage-specific dynamic grounding) ────────────────

/**
 * buildContextNotes — dynamic, stage-specific context that changes every turn.
 * Hard cap: 6 items. Requires stage parameter.
 */
export function buildContextNotes(stage: string, state: ConversationState): string[] {
  const raw: string[] = [];
  const keys: string[] = [];
  const intel = consultant(state);
  if (!intel || Object.keys(intel).length === 0) {
    console.log(`[CONTEXT_NOTES] stage=${stage} count=0 keys=NO_INTEL`);
    return [];
  }

  // Current agent reasoning — why this agent matters NOW
  const agentMap: Record<string, string> = {
    recommendation: 'alex',
    ch_alex: 'alex', ch_chris: 'chris', ch_maddie: 'maddie',
    ch_sarah: 'sarah', ch_james: 'james',
  };
  const currentAgent = agentMap[stage];
  if (currentAgent && intel.routing?.reasoning?.[currentAgent]) {
    const reasoning = intel.routing.reasoning[currentAgent];
    if (typeof reasoning === 'string') {
      const first = reasoning.split(/[.!?]/)[0]?.trim();
      if (first) { raw.push(first + '.'); keys.push(`routing_${currentAgent}`); }
    }
  }

  // CTA agent mapping — rec/close only
  if (stage === 'recommendation' || stage === 'close') {
    const cta = intel.conversionEventAnalysis?.ctaAgentMapping;
    if (cta) {
      const ctaStr = typeof cta === 'string' ? cta : JSON.stringify(cta);
      const first = ctaStr.split(/[.!?]/)[0]?.trim();
      if (first) { raw.push(first + '.'); keys.push('ctaAgentMapping'); }
    }
  }

  // Protective red flag
  const redFlag = intel.redFlags?.[0];
  if (redFlag && typeof redFlag === 'string') { raw.push(redFlag); keys.push('redFlag'); }

  // Strongest line as contextual evidence
  const sl = intel.copyAnalysis?.strongestLine;
  if (sl && typeof sl === 'string') { raw.push(sl); keys.push('strongestLine'); }

  // Questions to prioritise
  const qtp = intel.routing?.questions_to_prioritise;
  if (qtp && typeof qtp === 'string') { raw.push(qtp); keys.push('questionsPrioritise'); }
  else if (Array.isArray(qtp) && qtp.length > 0) { raw.push(qtp[0]); keys.push('questionsPrioritise'); }

  const result = cleanFacts(raw).slice(0, 6);
  console.log(`[CONTEXT_NOTES] stage=${stage} count=${result.length} keys=${keys.slice(0, result.length).join(',')}`);
  return result;
}

// ─── Matched Roles Wedge Helper ──────────────────────────────────────────────

/**
 * getMatchedRoleWedge — returns a hiring wedge sentence for a specific agent
 * in deliver mode, or null if none qualifies.
 * Filters: ourAgent match + urgency=high + length < 150.
 */
function getMatchedRoleWedge(agentKey: string, state: ConversationState): string | null {
  const matchedRoles = consultant(state).hiringAnalysis?.matchedRoles;
  if (!matchedRoles?.length) {
    console.log(`[MATCHED_ROLE_WEDGE] agent=${agentKey} injected=false reason=no_roles`);
    return null;
  }
  const relevant = matchedRoles.filter(
    (r: any) => r.ourAgent === agentKey && r.urgency === 'high',
  );
  if (relevant.length === 0) {
    console.log(`[MATCHED_ROLE_WEDGE] agent=${agentKey} injected=false reason=no_match`);
    return null;
  }
  const wedge = relevant[0].wedge;
  if (!wedge || typeof wedge !== 'string' || wedge.length >= 150) {
    console.log(`[MATCHED_ROLE_WEDGE] agent=${agentKey} injected=false reason=${!wedge ? 'no_wedge' : 'too_long'}`);
    return null;
  }
  console.log(`[MATCHED_ROLE_WEDGE] agent=${agentKey} injected=true wedge="${wedge.slice(0, 60)}"`);
  return wedge;
}

// ─── CTA Type Classification ─────────────────────────────────────────────────

/**
 * Classify CTA type from consultant's ctaType field into spoken-friendly labels.
 * Falls back to pattern matching on primaryCTA text if ctaType is missing.
 */
function classifyCTAType(ctaType: string, primaryCTA: string): string {
  // Direct match from consultant ctaType enum
  if (ctaType === 'book_call' || ctaType === 'booking') return 'booking';
  if (ctaType === 'fill_form') return 'form';
  if (ctaType === 'call_number') return 'phone';
  if (ctaType === 'get_quote') return 'quote';
  if (ctaType === 'buy_online') return 'purchase';
  if (ctaType === 'download') return 'download';

  // Fallback: pattern match on CTA text
  const lower = primaryCTA.toLowerCase();
  if (/\b(book|schedule|appointment|consult)\b/.test(lower)) return 'booking';
  if (/\b(call|phone|ring|1300|1800|0[2-9]\d{2})\b/.test(lower)) return 'phone';
  if (/\b(quote|estimate|pricing)\b/.test(lower)) return 'quote';
  if (/\b(buy|purchase|order|shop|cart|checkout)\b/.test(lower)) return 'purchase';
  if (/\b(download|guide|ebook|whitepaper)\b/.test(lower)) return 'download';
  if (/\b(form|enquir|inquir|submit|register|sign\s*up)\b/.test(lower)) return 'form';

  return 'generic';
}

// ─── WOW Step Builders ──────────────────────────────────────────────────────

function buildWowDirective(
  wowStep: WowStepId | null | undefined,
  state: ConversationState,
): StageDirective {
  const name = fn(state);
  const business = biz(state);
  const lang = lp(state);
  const d = deep(state);
  const c = consultant(state);
  const fills = sf(state);

  switch (wowStep) {
    case 'wow_1_research_intro': {
      // wow_1 4-tier priority stack (LOCKED)
      const copy = c.copyAnalysis ?? {};
      let observationLine: string;
      let wow1Source: string;

      if (fills.website_positive_comment) {
        observationLine = fills.website_positive_comment;
        wow1Source = 'WEBSITE_POSITIVE_COMMENT';
      } else if (copy.strongestLine) {
        observationLine = copy.strongestLine;
        wow1Source = 'STRONGEST_LINE';
      } else if (fills.bella_opener) {
        observationLine = fills.bella_opener;
        wow1Source = 'BELLA_OPENER';
      } else {
        observationLine = `We've researched ${business}, and we use that to pre-train your agents around your ${lang.pluralOutcome}, your industry, and how you win business.`;
        wow1Source = 'GENERIC';
      }

      console.log(`[WOW1_RESOLVE] ts=${new Date().toISOString()} source=${wow1Source} name=${name} biz=${business.slice(0, 30)} industry=${lang.industryLabel}`);
      return {
        objective: 'Demo frame + research intro, get permission to continue.',
        allowedMoves: ['advance:wow_2_reputation_trial'],
        requiredData: ['firstName', 'business', 'industry'],
        speak: `So ${name}, your pre-trained agents are ready to go. You can play a prospective ${shortBiz(state)} ${lang.singularOutcome}, and they'll engage like they've worked for ${business} for years — answering questions, qualifying the opportunity, and moving people toward your key conversion point on autopilot. Now ${name}, I think you'll be impressed. ${observationLine} Before we begin, can I confirm a couple of findings so your agents are dialled in and aimed at the highest-value opportunities?`,
        ask: true,
        waitForUser: true,
        canSkip: false,
        extract: ['research_permission'],
        advanceOn: ['wow_2_reputation_trial'],
      };
    }

    case 'wow_2_reputation_trial': {
      const googleRating = d.googleMaps?.rating ?? null;
      const googleReviews = d.googleMaps?.review_count ?? 0;

      if (!googleRating || googleRating < 3) {
        console.log(`[WOW2_RESOLVE] ts=${new Date().toISOString()} branch=SKIP rating=${googleRating} reviews=${googleReviews} biz=${business.slice(0, 30)}`);
        return {
          objective: 'Skip — no credible reputation data.',
          allowedMoves: ['advance:wow_3_icp_problem_solution'],
          requiredData: [],
          speak: '',
          ask: false,
          waitForUser: false,
          canSkip: true,
          skipReason: 'No Google rating or rating below 3.',
          advanceOn: ['wow_3_icp_problem_solution'],
        };
      }

      console.log(`[WOW2_RESOLVE] ts=${new Date().toISOString()} branch=FIRE rating=${googleRating} reviews=${googleReviews} biz=${business.slice(0, 30)}`);
      state.trialMentioned = true;
      return {
        objective: 'Leverage reputation for free trial mention.',
        allowedMoves: ['advance:wow_3_icp_problem_solution'],
        requiredData: [],
        speak: `And just before we start, I noticed ${business} has a ${googleRating}-star rating from ${googleReviews} reviews — that's strong. Businesses already delivering good outcomes are exactly the kind we like to put through our free trial, so if you'd like, I can set that up for you at any point during this demo.`,
        ask: false,
        waitForUser: false,
        canSkip: false,
        advanceOn: ['wow_3_icp_problem_solution'],
      };
    }

    case 'wow_3_icp_problem_solution': {
      const icpAnalysis = c.icpAnalysis ?? {};
      const rawIcpGuess = (fills.icp_guess ?? '').trim();
      let icpGuess = rawIcpGuess;
      if (icpGuess) {
        // Consultant may return full sentence: "it looks like you mainly work with X, is that right?"
        // Strip wrapping — we only need the audience phrase for "It looks like you mainly serve {X}."
        icpGuess = icpGuess
          .replace(/^it\s+looks\s+like\s+/i, '')
          .replace(/^(you|they)\s+(mainly|primarily|mostly)\s+(serve|work\s+with)\s+/i, '')
          .replace(/^[\w\s]+?\s+(mainly|primarily|mostly)\s+(serve|work\s+with)\s+/i, '')
          .replace(/[,.]?\s*(is\s+that\s+right|does\s+that\s+sound\s+right|would\s+you\s+agree).*$/i, '')
          .replace(/[.!?]+$/, '')
          .trim();
      }
      const icpProblems: unknown[] = icpAnalysis.icpProblems ?? [];
      const icpSolutions: unknown[] = icpAnalysis.icpSolutions ?? [];
      const referenceOffer = fills.reference_offer ?? '';
      const cleanProblems = cleanFacts(icpProblems);
      const cleanSolutions = cleanFacts(icpSolutions);

      // AUDIT-1 Fix 1: icpNarrative — consultant pre-built spoken ICP line (Priority 1)
      const icpNarrative: string = (icpAnalysis.icpNarrative ?? '').trim();
      // AUDIT-1 Fix 3: bellaCheckLine — consultant fallback before generic (Priority 4)
      const bellaCheckLine: string = (icpAnalysis.bellaCheckLine ?? '').trim();

      let insightText: string;
      let wow3Branch: string;

      // Priority 1: icpNarrative — consultant pre-built spoken line (best quality)
      if (icpNarrative && icpNarrative.length > 30) {
        wow3Branch = 'ICP_NARRATIVE';
        insightText = icpNarrative;
        // Ensure it ends with a confirmation question if it doesn't already
        if (!/\?/.test(insightText.slice(-20))) {
          insightText += ' Does that sound right?';
        }
      // Priority 2: ICP_FULL — mechanical stitch from icpGuess + problems + solutions
      } else if (icpGuess && cleanProblems.length >= 2 && cleanSolutions.length >= 2) {
        wow3Branch = 'ICP_FULL';
        insightText = `It looks like you mainly serve ${icpGuess}. The main problems they come to you with are ${cleanProblems[0]} and ${cleanProblems[1]}, and you solve those through ${cleanSolutions[0]} and ${cleanSolutions[1]}. Does that sound right?`;
      // Priority 3: REF_OFFER — referenceOffer + audience
      } else if (referenceOffer) {
        wow3Branch = 'REF_OFFER';
        const industryAudience = icpGuess || lang.pluralOutcome;
        insightText = `From your website, it looks like your positioning is centred around ${referenceOffer}, and it seems like you're speaking mainly to ${industryAudience}. Does that sound right?`;
      // Priority 4: BELLA_CHECK — consultant-written fallback line
      } else if (bellaCheckLine && bellaCheckLine.length > 20) {
        wow3Branch = 'BELLA_CHECK';
        insightText = bellaCheckLine;
        if (!/\?/.test(insightText.slice(-20))) {
          insightText += ' Does that sound right?';
        }
      // Priority 5: GENERIC — last resort
      } else {
        wow3Branch = 'GENERIC';
        insightText = `The site does a strong job of positioning what ${shortBiz(state)} does. Does that sound right?`;
      }

      console.log(`[WOW3_RESOLVE] ts=${new Date().toISOString()} branch=${wow3Branch} raw_icp="${rawIcpGuess.slice(0, 60)}" cleaned_icp="${icpGuess.slice(0, 40)}" problems=${cleanProblems.length} solutions=${cleanSolutions.length} refOffer=${!!referenceOffer} icpNarrative=${!!icpNarrative} bellaCheckLine=${!!bellaCheckLine}`);

      return {
        objective: 'Confirm ICP, problems, and solutions.',
        allowedMoves: ['advance:wow_4_conversion_action'],
        requiredData: [],
        speak: insightText,
        ask: true,
        waitForUser: true,
        canSkip: false,
        extract: ['icp_confirmed', 'icp_corrections'],
        advanceOn: ['wow_4_conversion_action'],
      };
    }

    case 'wow_4_conversion_action': {
      const cea = c.conversionEventAnalysis ?? {};
      const primaryCTA = cea.primaryCTA ?? fills.primaryCTA ?? '';
      const ctaType = (cea.ctaType ?? '').toLowerCase().trim();
      const agentTrainingLine = (cea.agentTrainingLine ?? '').trim();
      const ceaBellaLine = (cea.bellaLine ?? '').trim();
      // AUDIT-1 Fix 2: convNarrative — consultant pre-built spoken conversion line (Priority 0)
      const convNarrative: string = (cea.conversionNarrative ?? '').trim();

      // Classify CTA type for type-specific speech
      const ctaTypeLabel = classifyCTAType(ctaType, primaryCTA);

      let conversionLine: string;
      let wow4Branch: string;

      // Priority 0: convNarrative — consultant pre-built spoken line (best quality)
      if (convNarrative && convNarrative.length > 30) {
        wow4Branch = 'CONV_NARRATIVE';
        conversionLine = `${convNarrative} Is that the right focus?`;
      // Priority 1: agentTrainingLine — consultant-produced Bella-ready line
      } else if (agentTrainingLine && agentTrainingLine.length > 30) {
        wow4Branch = 'TRAINING_LINE';
        conversionLine = `${agentTrainingLine} Is that the right focus?`;
      } else if (ceaBellaLine && ceaBellaLine.length > 20) {
        // Good path: consultant's bellaLine about conversion setup
        wow4Branch = 'BELLA_LINE';
        conversionLine = `${ceaBellaLine} Is that the right focus?`;
      } else if (primaryCTA && ctaTypeLabel !== 'generic') {
        // Type-aware path: we know what kind of CTA it is
        wow4Branch = `CTA_TYPED_${ctaTypeLabel}`;
        const typePhrase = ctaTypeLabel === 'booking' ? 'a booking action'
          : ctaTypeLabel === 'phone' ? 'an inbound call'
          : ctaTypeLabel === 'form' ? 'a contact form'
          : ctaTypeLabel === 'quote' ? 'a quote request'
          : ctaTypeLabel === 'purchase' ? 'an online purchase'
          : ctaTypeLabel === 'download' ? 'a content download'
          : primaryCTA;
        conversionLine = `And it looks like your main conversion action is ${typePhrase} — ${primaryCTA}. That's exactly the kind of conversion we train your AI agents to drive more of. Is that the right focus?`;
      } else if (primaryCTA) {
        // Text-only path: we have CTA text but no type classification
        wow4Branch = 'CTA_TEXT';
        conversionLine = `And it looks like your main conversion action is ${primaryCTA}. That's the key action your agents should be driving more often. Is that the right focus?`;
      } else {
        wow4Branch = 'GENERIC';
        conversionLine = `And looking at how your site is set up to convert visitors into ${lang.pluralOutcome}, that's exactly the kind of action we train your AI agents to drive more of. Is that the right focus?`;
      }
      console.log(`[WOW4_RESOLVE] ts=${new Date().toISOString()} branch=${wow4Branch} ctaType="${ctaType || 'none'}" ctaLabel=${ctaTypeLabel} cta="${(primaryCTA || 'none').slice(0, 40)}" hasConvNarrative=${!!convNarrative} hasTrainingLine=${!!agentTrainingLine} hasBellaLine=${!!ceaBellaLine}`);

      return {
        objective: 'Align conversion events with agent capabilities.',
        allowedMoves: ['advance:wow_5_alignment_bridge'],
        requiredData: [],
        speak: conversionLine,
        ask: true,
        waitForUser: true,
        canSkip: false,
        extract: ['conversion_confirmed', 'conversion_corrections'],
        advanceOn: ['wow_5_alignment_bridge'],
      };
    }

    case 'wow_5_alignment_bridge': {
      // Sprint 2 (Issue 8): Adaptive opening when prospect rejected at wow_3 or wow_4.
      // If rejection detected, acknowledge and pivot rather than assuming confirmation.
      const rejected = state.rejectedWowSteps ?? [];
      const wow3Rejected = rejected.includes('wow_3_icp_problem_solution');
      const wow4Rejected = rejected.includes('wow_4_conversion_action');
      let wow5Speak: string;

      if (wow3Rejected || wow4Rejected) {
        // Prospect pushed back — acknowledge correction, pivot to numbers
        wow5Speak = `Got it — appreciate the correction, that's exactly the kind of detail that helps your agents perform better. Let me move into the numbers side — I've just got a few quick questions so I can size which combination would create the most value for ${shortBiz(state)}.`;
        console.log(`[WOW5_RESOLVE] ts=${new Date().toISOString()} adaptive=true wow3Rejected=${wow3Rejected} wow4Rejected=${wow4Rejected}`);
      } else {
        wow5Speak = `Great — that helps confirm your agents are dialled in around the highest-value opportunities. I've just got a few quick questions so I can size which combination would create the most value for ${shortBiz(state)}.`;
        console.log(`[WOW5_RESOLVE] ts=${new Date().toISOString()} adaptive=false`);
      }
      if (!state.trialMentioned) {
        wow5Speak += ` And by the way, if you'd like to activate a free trial at any point during the demo, just let me know — I can set that up for you.`;
        state.trialMentioned = true;
        console.log(`[WOW5_RESOLVE] ts=${new Date().toISOString()} trialReOffer=true`);
      }
      return {
        objective: 'Confirm agents are dialled in.',
        allowedMoves: ['advance:wow_6_scraped_observation'],
        requiredData: [],
        speak: wow5Speak,
        ask: false,
        waitForUser: false,
        canSkip: false,
        advanceOn: ['wow_6_scraped_observation'],
      };
    }

    case 'wow_6_scraped_observation': {
      // wow_6 7-tier priority stack (LOCKED)
      const scrapedSummary = fills.scrapedDataSummary ?? '';
      const googlePresence = c.googlePresence ?? [];
      const mostImpressiveLine = (c.mostImpressive?.[0]?.bellaLine ?? '').trim();
      const hooks = c.conversationHooks ?? [];
      const topHiringWedge = (c.hiringAnalysis?.topHiringWedge ?? '').trim();

      // Hiring data from deep intel
      const hiringData = d.hiring ?? {};
      const hiringMatches: any[] = hiringData.hiring_agent_matches ?? [];

      let observationLine: string;
      let wow6Source: string;

      if (scrapedSummary) {
        // Priority 1: scrapedDataSummary (will be null until B2 wires consultant)
        wow6Source = 'SCRAPED_SUMMARY';
        observationLine = `Also ${name}, we noticed ${scrapedSummary}. That helps show where the biggest upside from automation could be for ${business}.`;
      } else if (googlePresence[0]?.bellaLine) {
        // Priority 2: googlePresence[0].bellaLine
        wow6Source = 'GOOGLE_PRESENCE';
        const cleaned = googlePresence[0].bellaLine.replace(/[.!]+$/, '');
        observationLine = `Also ${name}, ${cleaned} — and that tells us there's a real opportunity for automation to drive even more value for ${business}.`;
      } else if (mostImpressiveLine) {
        // Priority 3: mostImpressive[0].bellaLine (existing)
        wow6Source = 'MOST_IMPRESSIVE';
        const cleaned = mostImpressiveLine.replace(/[.!]+$/, '');
        observationLine = `Also ${name}, ${cleaned} — and that tells us there's a real opportunity for automation to drive even more value for ${business}.`;
      } else if (hooks[0]) {
        // Priority 4: conversationHooks[0] — use ALL THREE sub-fields: topic, data, how
        wow6Source = 'HOOK';
        const hook = hooks[0];
        if (hook.how) {
          observationLine = `Also ${name}, ${hook.how} — ${hook.data || hook.topic}. That's relevant because it points to a clear automation opportunity for ${business}.`;
        } else {
          observationLine = `Also ${name}, we noticed ${hook.topic}: ${hook.data}. That's relevant because it points to a clear automation opportunity for ${business}.`;
        }
      } else if (topHiringWedge) {
        // Priority 5: topHiringWedge (existing)
        wow6Source = 'HIRING';
        observationLine = `Also ${name}, ${topHiringWedge} That's exactly the kind of workload our agents can take on for ${business}.`;
      } else if (hiringMatches.length > 0) {
        // Priority 6: hiringMatches[0] (existing)
        wow6Source = 'MATCH';
        const topMatch = hiringMatches[0];
        const role = topMatch.role || topMatch.title || 'a role';
        observationLine = `Also ${name}, I noticed you're hiring for ${role}, which is interesting because that's exactly the kind of workload one of our agents can often absorb for a fraction of the cost.`;
      } else {
        // Priority 7: Deep intel direct fallback (Sprint 2 — Issue 3/4)
        const deepFallback = getDeepIntelFallbackWow(state, name, business);
        if (deepFallback) {
          wow6Source = deepFallback.source;
          observationLine = deepFallback.line;
        } else {
          // Priority 8: GENERIC (last resort)
          wow6Source = 'GENERIC';
          observationLine = `Also ${name}, from what we can already see on your site, there looks to be a clear opportunity to improve how inbound demand gets captured and converted.`;
        }
      }

      console.log(`[WOW6_RESOLVE] ts=${new Date().toISOString()} source=${wow6Source} scrapedSummary=${!!scrapedSummary} googlePresence=${!!googlePresence[0]?.bellaLine} mostImpressive="${mostImpressiveLine.slice(0, 60)}" hooks=${hooks.length} topHiringWedge=${!!topHiringWedge} hiringMatches=${hiringMatches.length} speak_preview="${observationLine.slice(0, 80)}"`);

      return {
        objective: 'Connect scraped observation to automation upside.',
        allowedMoves: ['advance:wow_7_explore_or_recommend'],
        requiredData: [],
        speak: observationLine,
        ask: false,
        waitForUser: false,
        canSkip: false,
        advanceOn: ['wow_7_explore_or_recommend'],
      };
    }

    case 'wow_7_explore_or_recommend':
      console.log(`[WOW7_RESOLVE] ts=${new Date().toISOString()} biz=${business.slice(0, 30)}`);
      return {
        objective: 'Offer prospect choice: explore or recommend.',
        allowedMoves: ['advance:wow_8_source_check'],
        requiredData: [],
        speak: `You can explore the agents yourself, or I can recommend the highest-value ones for ${business} and bring the first one on live so you can hear how they'd handle your prospects. Sound good?`,
        ask: true,
        waitForUser: true,
        canSkip: false,
        extract: ['explorePreference'],
        advanceOn: ['wow_8_source_check'],
      };

    case 'wow_8_source_check': {
      const adsOn = !!(
        (state.intel.fast as any)?.flags?.is_running_ads
        || d.ads?.is_running_google_ads
        || (d.ads?.google_ads_count ?? 0) > 0
        || (d.ads?.fb_ads_count ?? 0) > 0
      );

      if (state.leadSourceDominant && state.routingConfidence === 'high') {
        console.log(`[WOW8_RESOLVE] ts=${new Date().toISOString()} branch=SKIP_KNOWN source=${state.leadSourceDominant}`);
        return {
          objective: 'Source already identified — skip to recommendation.',
          allowedMoves: ['advance:recommendation'],
          requiredData: [],
          speak: '',
          ask: false,
          waitForUser: false,
          canSkip: true,
          skipReason: `Lead source already identified as ${state.leadSourceDominant} with high confidence.`,
          advanceOn: ['recommendation'],
        };
      }

      let sourceQuestion: string;
      if (adsOn) {
        sourceQuestion = `Apart from referrals, are paid ads your main source of new ${lang.pluralOutcome}, or is another channel doing a lot of the work as well?`;
      } else {
        sourceQuestion = `Apart from referrals, where does most new business come from right now — your website, paid ads, phone calls, organic, or something else?`;
      }
      console.log(`[WOW8_RESOLVE] ts=${new Date().toISOString()} branch=${adsOn ? 'ADS_ON' : 'NO_ADS'}`);

      return {
        objective: 'Identify dominant lead acquisition path.',
        allowedMoves: ['advance:recommendation'],
        requiredData: [],
        speak: sourceQuestion,
        ask: true,
        waitForUser: true,
        canSkip: false,
        extract: ['leadSourceDominant', 'leadSourceSecondary', 'adsConfirmed', 'websiteRelevant', 'phoneRelevant'],
        advanceOn: ['recommendation'],
        notes: [
          `If prospect gives vague reply, follow up: "Got it — and do you see more new business coming through ${fills.cta1 ?? 'your website'}, ${fills.cta2 ?? 'ads'}, or phone calls?"`,
        ],
      };
    }

    default:
      console.warn(`[MOVES] unknown wowStep: ${wowStep} — defaulting to wow_1_research_intro`);
      return buildWowDirective('wow_1_research_intro', state);
  }
}

// ─── Recommendation Builder (4 variants) ────────────────────────────────────

function buildRecommendationDirective(state: ConversationState): StageDirective {
  const business = biz(state);
  const { alexEligible, chrisEligible, maddieEligible } = state;
  const c = consultant(state);
  const cea = c.conversionEventAnalysis ?? {};
  const fills = sf(state);
  const rawCTA = cea.primaryCTA ?? fills.primaryCTA ?? '';
  const ctaTypeLabel = classifyCTAType((cea.ctaType ?? '').toLowerCase().trim(), rawCTA);
  const primaryCTAShort = rawCTA
    || (ctaTypeLabel !== 'generic' ? `${ctaTypeLabel === 'booking' ? 'bookings' : ctaTypeLabel === 'phone' ? 'inbound calls' : ctaTypeLabel === 'quote' ? 'quote requests' : ctaTypeLabel === 'form' ? 'enquiry forms' : 'conversions'}` : 'your key conversion actions');

  let recLine: string;

  if (alexEligible && chrisEligible && maddieEligible) {
    recLine = `Based on what we've found, Alex looks like the biggest opportunity first, and then Chris and Maddie both look relevant. Alex tightens lead follow-up, Chris drives more website actions, and Maddie captures call opportunities that might otherwise be lost. If you want, I can work out which of those is likely to create the most extra revenue.`;
  } else if (alexEligible && chrisEligible) {
    recLine = `Based on what we've found, Alex looks like the biggest opportunity first, because faster follow-up usually creates the strongest lift once interest is already there. Then Chris looks highly relevant as well, because your website is clearly driving actions like ${primaryCTAShort}. If you want, I can work out what that could be worth.`;
  } else if (alexEligible && maddieEligible) {
    recLine = `Based on what we've found, Alex looks like the biggest opportunity first, because lead follow-up usually gives the fastest uplift where demand already exists. Then Maddie looks highly relevant too, because phone calls are clearly a major path to new business. If you want, I can work out what that could be worth.`;
  } else if (maddieEligible && !alexEligible) {
    recLine = `Based on what you've said, Maddie looks like the strongest fit first, because phone is where the real opportunity sits for ${business}. If you want, I can work out what that could be worth.`;
  } else {
    recLine = `Based on what we've found so far, there are a few agents that could add real value for ${business}. If you want, I can work out what that could be worth.`;
  }

  // Hiring reference append — when hiring data exists, mention alignment
  const recDeep = deep(state);
  const recHiringMatches: any[] = recDeep.hiring?.hiring_agent_matches ?? [];
  if (recHiringMatches.length > 0) {
    const topMatch = recHiringMatches[0];
    const agentName = topMatch.agents?.[0] ?? '';
    if (agentName) {
      recLine += ` And I noticed you're hiring for roles that ${agentName} can start handling immediately.`;
      console.log(`[REC_HIRING] agent=${agentName} role=${topMatch.role || topMatch.title || 'unknown'}`);
    }
  }

  // ── Recommendation colour (Sprint B2) — ADDITIVE ONLY, eligibility UNCHANGED ──
  const routing = c.routing ?? {};
  const secondary = c.secondaryRecommendations ?? [];

  // Determine which agents are recommended from existing eligibility
  const recommendedAgents: string[] = [];
  if (alexEligible) recommendedAgents.push('alex');
  if (chrisEligible) recommendedAgents.push('chris');
  if (maddieEligible) recommendedAgents.push('maddie');

  const colourLines: string[] = [];
  for (const agent of recommendedAgents) {
    const reasoning = routing.reasoning?.[agent];
    if (reasoning && typeof reasoning === 'string') {
      const firstSentence = reasoning.split(/[.!?]/)[0]?.trim();
      if (firstSentence && firstSentence.length > 15) colourLines.push(firstSentence + '.');
    }
  }

  // Secondary recommendation colour
  const whySecond = secondary[0]?.whySecond;
  if (whySecond && typeof whySecond === 'string') {
    const firstSentence = whySecond.split(/[.!?]/)[0]?.trim();
    if (firstSentence) colourLines.push(firstSentence + '.');
  }

  // Append colour — guard against excessive length
  if (colourLines.length > 0) {
    const colourText = colourLines.join(' ');
    if (recLine.length + colourText.length + 1 <= 800) {
      recLine += ' ' + colourText;
    } else {
      // Truncate to first colour line only
      recLine += ' ' + colourLines[0];
    }
  }

  console.log(`[REC_COLOUR] primary=${recommendedAgents[0] || 'unknown'} agents=${recommendedAgents.join(',')} colourLines=${colourLines.length} secondary=${!!whySecond}`);

  return {
    objective: 'Recommend agents and bridge to ROI calculation.',
    allowedMoves: ['advance:anchor_acv'],
    requiredData: [],
    speak: recLine,
    ask: true,
    waitForUser: true,
    canSkip: false,
    extract: ['proceedToROI'],
    advanceOn: ['user_agrees', 'user_unclear'],
  };
}

// ─── Channel Stage Builders (Chunk 4B) ──────────────────────────────────────

/**
 * Alex directive: speed-to-lead.
 * Two variants: generic (follow-up process first) or ads (ad volume first).
 */
function buildAlexDirective(intel: MergedIntel, state: ConversationState): StageDirective {
  const lang = lp(state);
  const policy = STAGE_POLICIES.ch_alex;
  const forceAdvance = shouldForceAdvance('ch_alex', state);
  const budgetExhausted = maxQuestionsReached('ch_alex', state);

  // ── Deliver ROI mode ──
  if (forceAdvance || budgetExhausted) {
    const result = state.calculatorResults.alex;

    if (result) {
      // ROI already computed by controller — deliver it
      let alexSpeak = `So with an average ${lang.singularOutcome} value of ${state.acv} dollars, around ${state.inboundLeads} inbound leads a week, and a response time of ${bandToSpokenLabel(state.responseSpeedBand)}, Alex could conservatively add around ${result.weeklyValue.toLocaleString()} dollars a week just by tightening speed-to-lead and follow-up consistency.`;
      const alexWedge = getMatchedRoleWedge('alex', state);
      if (alexWedge) alexSpeak += ` ${alexWedge}`;
      alexSpeak += ` Does that make sense?`;
      return {
        objective: 'Deliver Alex speed-to-lead ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: alexSpeak,
        ask: true,
        waitForUser: true,
        canSkip: false,
        advanceOn: ['user_replied'],
        calculatorKey: policy.calculatorKey,
      };
    }

    if (forceAdvance) {
      // Minimum data present but controller hasn't run calculator yet — signal it
      return {
        objective: 'Signal controller to compute Alex ROI.',
        allowedMoves: ['compute:alex', 'advance:next_channel'],
        requiredData: [],
        speak: `Let me size Alex based on that.`,
        ask: false,
        waitForUser: false,
        canSkip: false,
        calculatorKey: policy.calculatorKey,
      };
    }

    // Budget exhausted but insufficient data — skip with fallback
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

  // ── Collect inputs mode ──
  // Channel-scoped question routing: Alex owns ads + website/online ONLY.
  // Phone/direct is Maddie's domain — Alex never asks phone-scoped questions.
  const adsPath = state.adsConfirmed || state.leadSourceDominant === 'ads';
  const websitePath = !adsPath && (
    state.websiteRelevant
    || state.leadSourceDominant === 'website'
    || state.leadSourceDominant === 'organic'
  );
  // No phonePath for Alex — phone belongs to Maddie.
  // If phone-dominant with no ads/website signal, Alex falls to aggregate-online.

  let questionText: string;
  let extractFields: string[];
  let channelScope: string;

  // ── Slot-attempt guard (surrogate contract) ──
  // qCount maps to asked-slot progression: Q1=leads, Q2=conversions, Q3=speed.
  // Once the conversions slot has been attempted (qCount >= 2) and extraction
  // still returned null, we move to the next slot instead of re-asking.
  // This prevents verbatim re-ask loops when Gemini/regex miss conversational answers.
  const conversionsSlotAttempted = state.questionCounts.ch_alex >= 2;
  const conversionsSlotUnresolved = state.inboundConversions == null && state.inboundConversionRate == null;
  const skipConversions = conversionsSlotAttempted && conversionsSlotUnresolved;

  if (skipConversions) {
    console.log(`[SLOT_ADVANCE] stage=ch_alex reason=attempted_unresolved slot=inboundConversions qCount=${state.questionCounts.ch_alex}`);
  }

  if (adsPath) {
    // Ads-scoped — ask about ad/campaign lead volume
    channelScope = 'ads/campaign';
    if (state.inboundLeads == null) {
      questionText = `Roughly how many leads are your ads generating in a typical week?`;
      extractFields = ['inboundLeads'];
    } else if (!skipConversions && conversionsSlotUnresolved) {
      questionText = `And how many of those are turning into paying ${lang.pluralOutcome}?`;
      extractFields = ['inboundConversions', 'inboundConversionRate'];
    } else {
      questionText = `When those ad leads come in, how quickly is your team usually following up?`;
      extractFields = ['responseSpeedBand'];
    }
  } else if (websitePath) {
    // Website-scoped — ask about website/online enquiry volume
    channelScope = 'website/online';
    if (state.inboundLeads == null) {
      questionText = `Roughly how many enquiries are coming through your website in a typical week?`;
      extractFields = ['inboundLeads'];
    } else if (!skipConversions && conversionsSlotUnresolved) {
      questionText = `And how many of those are turning into paying ${lang.pluralOutcome}?`;
      extractFields = ['inboundConversions', 'inboundConversionRate'];
    } else {
      questionText = `How quickly are those website enquiries usually followed up?`;
      extractFields = ['responseSpeedBand'];
    }
  } else {
    // Aggregate-online fallback: no ads or website signal distinguished.
    // Still scoped to online/inbound — never phone.
    channelScope = 'aggregate-online';
    if (state.inboundLeads == null) {
      questionText = `Roughly how many online enquiries or leads need follow-up in a typical week?`;
      extractFields = ['inboundLeads'];
    } else if (!skipConversions && conversionsSlotUnresolved) {
      questionText = `And how many of those are turning into paying ${lang.pluralOutcome}?`;
      extractFields = ['inboundConversions', 'inboundConversionRate'];
    } else {
      questionText = `How quickly are those usually followed up?`;
      extractFields = ['responseSpeedBand'];
    }
  }

  console.log(`[ALEX_SCOPE] channelScope=${channelScope} adsPath=${adsPath} websitePath=${websitePath} source=${state.leadSourceDominant} webRelevant=${state.websiteRelevant} phoneRelevant=${state.phoneRelevant}`);

  return {
    objective: `Capture Alex speed-to-lead inputs (${channelScope} channel scope).`,
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

/**
 * Chris directive: website conversion uplift.
 */
function buildChrisDirective(state: ConversationState): StageDirective {
  const lang = lp(state);
  const policy = STAGE_POLICIES.ch_chris;
  const forceAdvance = shouldForceAdvance('ch_chris', state);
  const budgetExhausted = maxQuestionsReached('ch_chris', state);

  // ── Deliver ROI mode ──
  if (forceAdvance || budgetExhausted) {
    const result = state.calculatorResults.chris;

    if (result) {
      const conversionDesc = state.webConversions != null
        ? `converting about ${state.webConversions}`
        : state.webConversionRate != null
          ? `converting at about ${Math.round(state.webConversionRate * 100)}%`
          : 'converting a portion';

      return {
        objective: 'Deliver Chris website conversion ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: `So you're getting around ${state.webLeads} website leads a week and ${conversionDesc}. Chris typically lifts conversion by engaging people in real time, and at an average value of ${state.acv} dollars that could mean roughly ${result.weeklyValue.toLocaleString()} dollars a week in extra revenue. Does that sound reasonable?`,
        ask: true,
        waitForUser: true,
        canSkip: false,
        advanceOn: ['user_replied'],
        calculatorKey: policy.calculatorKey,
      };
    }

    if (forceAdvance) {
      return {
        objective: 'Signal controller to compute Chris ROI.',
        allowedMoves: ['compute:chris', 'advance:next_channel'],
        requiredData: [],
        speak: `Let me size Chris based on that.`,
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

  // ── Collect inputs mode ──
  let questionText: string;
  let extractFields: string[];

  // ── Slot-attempt guard (surrogate contract) ──
  // Chris has 2 slots: Q1=webLeads, Q2=webConversions/Rate.
  // If Q2 was attempted (qCount >= 2) and conversion still null,
  // force-advance instead of re-asking the same slot.
  const chrisConvAttempted = state.questionCounts.ch_chris >= 2;
  const chrisConvUnresolved = state.webConversions == null && state.webConversionRate == null;

  if (chrisConvAttempted && chrisConvUnresolved) {
    console.log(`[SLOT_ADVANCE] stage=ch_chris reason=attempted_unresolved slot=webConversions qCount=${state.questionCounts.ch_chris}`);
    return {
      objective: 'Chris conversions slot unresolved after attempt — advance with available data.',
      allowedMoves: ['compute:chris', 'advance:next_channel'],
      requiredData: [],
      speak: `Let me size Chris based on what we have.`,
      ask: false,
      waitForUser: false,
      canSkip: true,
      skipReason: 'Conversions slot attempted but unresolved — advancing with available data.',
      calculatorKey: policy.calculatorKey,
      notes: policy.fallbackPolicy,
    };
  }

  // Chris needs only 2 inputs: webLeads + webConversions/Rate.
  // No follow-up-speed question — Chris uplift is conversion-rate-based, not speed-based.

  // Sprint 1B: cross-channel dedup — if Alex already captured lead volume, auto-populate
  // webLeads and skip directly to the conversion question. Prevents re-asking "how many
  // enquiries?" when the prospect already answered during ch_alex.
  const knownVolume = state.unifiedState?.inbound_volume_weekly;
  if (state.webLeads == null && knownVolume != null) {
    state.webLeads = knownVolume;
    console.log(`[CHRIS_DEDUP] inbound_volume_weekly already known: ${knownVolume} — auto-populated webLeads, skipping re-ask`);
  }

  if (state.webLeads == null) {
    questionText = `Roughly how many website enquiries are you getting in a typical week?`;
    extractFields = ['webLeads'];
  } else if (knownVolume != null) {
    // Sprint 1B: volume was auto-populated from Alex — reference it naturally
    questionText = `You mentioned around ${knownVolume} enquiries a week earlier. Of those coming through the website, roughly how many are turning into paying ${lang.pluralOutcome}?`;
    extractFields = ['webConversions', 'webConversionRate'];
  } else {
    questionText = `And how many of those turn into paying ${lang.pluralOutcome}?`;
    extractFields = ['webConversions', 'webConversionRate'];
  }

  return {
    objective: 'Capture Chris website conversion inputs (website channel scope).',
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

/**
 * Maddie directive: missed call recovery.
 */
function buildMaddieDirective(state: ConversationState): StageDirective {
  // ── 24/7 skip: prospect confirmed full phone coverage ──
  if (state.maddieSkip) {
    console.log(`[MADDIE_SKIP_DIRECTIVE] maddieSkip=true — returning skip directive`);
    return {
      objective: 'Skip Maddie — prospect confirmed 24/7 phone coverage.',
      allowedMoves: ['advance:next_channel'],
      requiredData: [],
      speak: `Since you've got full coverage on the phones, let's focus on where the bigger opportunity is.`,
      ask: false,
      waitForUser: false,
      canSkip: true,
      skipReason: 'Prospect confirmed 24/7 phone coverage — Maddie missed call recovery not applicable.',
    };
  }

  const lang = lp(state);
  const policy = STAGE_POLICIES.ch_maddie;
  const forceAdvance = shouldForceAdvance('ch_maddie', state);
  const budgetExhausted = maxQuestionsReached('ch_maddie', state);

  // ── Deliver ROI mode ──
  if (forceAdvance || budgetExhausted) {
    const result = state.calculatorResults.maddie;

    if (result) {
      const missedDesc = state.missedCalls != null
        ? `missing about ${state.missedCalls}`
        : state.missedCallRate != null
          ? `missing about ${Math.round(state.missedCallRate * 100)}%`
          : 'missing some';

      let maddieSpeak = `So if you're getting around ${state.phoneVolume} inbound calls a week and ${missedDesc}, that's a meaningful number of live opportunities at risk. When people hit voicemail, a lot of them just try the next option. That's why Maddie is so valuable — she captures and qualifies more of those calls before they disappear. Conservatively, that could mean around ${result.weeklyValue.toLocaleString()} dollars a week in recovered revenue.`;
      const maddieWedge = getMatchedRoleWedge('maddie', state);
      if (maddieWedge) maddieSpeak += ` ${maddieWedge}`;
      maddieSpeak += ` Does that track?`;

      return {
        objective: 'Deliver Maddie missed call recovery ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: maddieSpeak,
        ask: true,
        waitForUser: true,
        canSkip: false,
        advanceOn: ['user_replied'],
        calculatorKey: policy.calculatorKey,
      };
    }

    if (forceAdvance) {
      return {
        objective: 'Signal controller to compute Maddie ROI.',
        allowedMoves: ['compute:maddie', 'advance:next_channel'],
        requiredData: [],
        speak: `Let me size Maddie based on that.`,
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

  // ── Collect inputs mode ──
  let questionText: string;
  let extractFields: string[];

  // ── Slot-attempt guard (surrogate contract) ──
  // Maddie has 2 slots: Q1=phoneVolume, Q2=missedCalls/Rate.
  // If Q2 was attempted (qCount >= 2) and missed calls still null,
  // force-advance instead of re-asking the same slot.
  const maddieMissedAttempted = state.questionCounts.ch_maddie >= 2;
  const maddieMissedUnresolved = state.missedCalls == null && state.missedCallRate == null;

  if (maddieMissedAttempted && maddieMissedUnresolved) {
    console.log(`[SLOT_ADVANCE] stage=ch_maddie reason=attempted_unresolved slot=missedCalls qCount=${state.questionCounts.ch_maddie}`);
    return {
      objective: 'Maddie missed calls slot unresolved after attempt — advance with available data.',
      allowedMoves: ['compute:maddie', 'advance:next_channel'],
      requiredData: [],
      speak: `Let me size Maddie based on what we have.`,
      ask: false,
      waitForUser: false,
      canSkip: true,
      skipReason: 'Missed calls slot attempted but unresolved — advancing with available data.',
      calculatorKey: policy.calculatorKey,
      notes: policy.fallbackPolicy,
    };
  }

  if (state.phoneVolume == null) {
    questionText = `Roughly how many inbound calls do you get in a typical week?`;
    extractFields = ['phoneVolume'];
  } else {
    questionText = `And roughly how many of those get missed?`;
    extractFields = ['missedCalls', 'missedCallRate'];
  }

  return {
    objective: 'Capture Maddie missed call recovery inputs (phone channel scope).',
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

// ─── Combined ROI Delivery ──────────────────────────────────────────────────

function buildCombinedRoiDirective(state: ConversationState): StageDirective {
  const name = fn(state);
  const coreAgents: CoreAgent[] = ['alex', 'chris', 'maddie'];
  const orderedAgents = (state.topAgents as CoreAgent[]).filter(
    (a) => coreAgents.includes(a) && state.calculatorResults[a] != null,
  );

  // No results yet — signal controller
  if (orderedAgents.length === 0) {
    return {
      objective: 'No ROI results available — signal controller to compute.',
      allowedMoves: ['compute:combined'],
      requiredData: [],
      speak: `Let me add all of that up for you.`,
      ask: false,
      waitForUser: false,
      canSkip: false,
    };
  }

  // Build agent-by-agent summary
  let totalWeeklyValue = 0;
  const agentClauses: string[] = [];
  for (const agent of orderedAgents) {
    const result = state.calculatorResults[agent]!;
    totalWeeklyValue += result.weeklyValue;
    agentClauses.push(`${agent.charAt(0).toUpperCase() + agent.slice(1)} at about ${result.weeklyValue.toLocaleString()} dollars a week`);
  }

  let agentSummary: string;
  if (agentClauses.length === 1) {
    agentSummary = agentClauses[0];
  } else if (agentClauses.length === 2) {
    agentSummary = `${agentClauses[0]} and ${agentClauses[1]}`;
  } else {
    agentSummary = `${agentClauses.slice(0, -1).join(', ')}, and ${agentClauses[agentClauses.length - 1]}`;
  }

  // Build speak: core recurring total first, then optional separate mentions
  let speak = `So ${name}, if we add that up, we've got ${agentSummary}. That's a combined total of roughly ${totalWeeklyValue.toLocaleString()} dollars a week in additional revenue, and those are conservative numbers.`;

  // Sarah: pool value, NOT weekly recurring — mention separately if computed
  const sarahResult = state.calculatorResults.sarah;
  if (sarahResult && sarahResult.weeklyValue > 0) {
    speak += ` And separately, Sarah could unlock around ${sarahResult.weeklyValue.toLocaleString()} dollars from your dormant database.`;
  }

  // James: optional, NOT part of core recurring total — mention separately if computed
  const jamesResult = state.calculatorResults.james;
  if (jamesResult && jamesResult.weeklyValue > 0) {
    speak += ` And James could add around ${jamesResult.weeklyValue.toLocaleString()} dollars a week through reputation uplift.`;
  }

  speak += ` Does that all make sense?`;

  return {
    objective: 'Deliver combined ROI total — conservative, core agents only.',
    allowedMoves: ['advance:optional_side_agents', 'advance:close'],
    requiredData: [],
    speak,
    ask: true,
    waitForUser: true,
    canSkip: false,
    extract: ['roiConfirmed'],
    advanceOn: ['user_replied'],
  };
}

// ─── Sarah — Database Reactivation ──────────────────────────────────────────

/**
 * Sarah collects one input: oldLeads (dormant leads in their database).
 * ACV is already captured at anchor_acv.
 * ROI: oldLeads × 5% reactivation rate × ACV.
 */
function buildSarahDirective(state: ConversationState): StageDirective {
  const lang = lp(state);
  const policy = STAGE_POLICIES.ch_sarah;
  const forceAdvance = shouldForceAdvance('ch_sarah', state);
  const budgetExhausted = maxQuestionsReached('ch_sarah', state);

  // ── Deliver ROI mode ──
  if (forceAdvance || budgetExhausted) {
    const result = state.calculatorResults.sarah;

    if (result) {
      let sarahSpeak = `So you've got around ${state.oldLeads} old leads sitting in your database. Even at a conservative five percent reactivation rate, that's a dormant pipeline worth around ${result.weeklyValue.toLocaleString()} dollars that Sarah could help you unlock — and these are people who already know ${state.business || 'your business'}.`;
      const sarahWedge = getMatchedRoleWedge('sarah', state);
      if (sarahWedge) sarahSpeak += ` ${sarahWedge}`;
      sarahSpeak += ` Does that make sense?`;

      return {
        objective: 'Deliver Sarah database reactivation ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: sarahSpeak,
        ask: true,
        waitForUser: true,
        canSkip: false,
        advanceOn: ['user_replied'],
        calculatorKey: policy.calculatorKey,
      };
    }

    if (forceAdvance) {
      return {
        objective: 'Signal controller to compute Sarah ROI.',
        allowedMoves: ['compute:sarah', 'advance:next_channel'],
        requiredData: [],
        speak: `Let me size Sarah based on that.`,
        ask: false,
        waitForUser: false,
        canSkip: false,
        calculatorKey: policy.calculatorKey,
      };
    }

    return {
      objective: 'Sarah question budget exhausted — insufficient data, skip.',
      allowedMoves: ['advance:next_channel'],
      requiredData: [],
      speak: '',
      ask: false,
      waitForUser: false,
      canSkip: true,
      skipReason: 'Question budget exhausted without sufficient data for Sarah calculation.',
      notes: policy.fallbackPolicy,
    };
  }

  // ── Collect inputs mode ──
  const questionText = `Roughly how many old leads or past contacts are sitting in your database right now — even a ballpark is fine?`;
  const extractFields = ['oldLeads'];

  console.log(`[SARAH_SCOPE] oldLeads=${state.oldLeads}`);

  return {
    objective: 'Capture Sarah database reactivation inputs.',
    allowedMoves: ['extract:sarahInputs'],
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

// ─── James — Reputation Manager ─────────────────────────────────────────────

/**
 * James collects two inputs: newCustomersPerWeek + hasReviewSystem.
 * ACV is already captured at anchor_acv.
 * ROI: newCustomersPerWeek × ACV × 9% revenue uplift (if no review system).
 */
function buildJamesDirective(state: ConversationState): StageDirective {
  const lang = lp(state);
  const policy = STAGE_POLICIES.ch_james;
  const forceAdvance = shouldForceAdvance('ch_james', state);
  const budgetExhausted = maxQuestionsReached('ch_james', state);

  // ── Deliver ROI mode ──
  if (forceAdvance || budgetExhausted) {
    const result = state.calculatorResults.james;

    if (result) {
      if (result.weeklyValue === 0) {
        // Has existing review system — no incremental uplift
        return {
          objective: 'Deliver James result — existing review system detected.',
          allowedMoves: ['advance:next_channel'],
          requiredData: [],
          speak: `It sounds like you've already got a review system in place, which is great — that means James would be more of a refinement than a revenue driver for ${state.business || 'your business'} right now.`,
          ask: false,
          waitForUser: false,
          canSkip: true,
          advanceOn: ['spoken'],
          calculatorKey: policy.calculatorKey,
        };
      }

      return {
        objective: 'Deliver James reputation management ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: `So with around ${state.newCustomersPerWeek} new ${lang.pluralOutcome} a week, if James automates your review collection and gets your rating climbing, the data shows a nine percent revenue uplift per star improvement. That works out to roughly ${result.weeklyValue.toLocaleString()} dollars a week in additional revenue as your reputation compounds. Does that track?`,
        ask: true,
        waitForUser: true,
        canSkip: false,
        advanceOn: ['user_replied'],
        calculatorKey: policy.calculatorKey,
      };
    }

    if (forceAdvance) {
      return {
        objective: 'Signal controller to compute James ROI.',
        allowedMoves: ['compute:james', 'advance:next_channel'],
        requiredData: [],
        speak: `Let me size James based on that.`,
        ask: false,
        waitForUser: false,
        canSkip: false,
        calculatorKey: policy.calculatorKey,
      };
    }

    return {
      objective: 'James question budget exhausted — insufficient data, skip.',
      allowedMoves: ['advance:next_channel'],
      requiredData: [],
      speak: '',
      ask: false,
      waitForUser: false,
      canSkip: true,
      skipReason: 'Question budget exhausted without sufficient data for James calculation.',
      notes: policy.fallbackPolicy,
    };
  }

  // ── Collect inputs mode ──
  let questionText: string;
  let extractFields: string[];

  if (state.newCustomersPerWeek == null) {
    questionText = `Roughly how many new ${lang.pluralOutcome} does ${state.business || 'your business'} bring on in a typical week?`;
    extractFields = ['newCustomersPerWeek'];
  } else if (state.currentStars == null) {
    questionText = `And do you know roughly what your current Google star rating is?`;
    extractFields = ['currentStars'];
  } else {
    questionText = `And do you currently have any kind of system for actively collecting and managing your online reviews?`;
    extractFields = ['hasReviewSystem'];
  }

  console.log(`[JAMES_SCOPE] newCustomersPerWeek=${state.newCustomersPerWeek} currentStars=${state.currentStars} hasReviewSystem=${state.hasReviewSystem}`);

  return {
    objective: 'Capture James reputation management inputs.',
    allowedMoves: ['extract:jamesInputs'],
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

// ─── Optional Side Agents ───────────────────────────────────────────────────

function buildOptionalSideAgentsDirective(state: ConversationState): StageDirective {
  const notes: string[] = [];

  if (state.prospectAskedAboutSarah) {
    notes.push('Prospect asked about Sarah — controller may compute and present Sarah ROI.');
  }
  if (state.prospectAskedAboutJames) {
    notes.push('Prospect asked about James — controller may compute and present James ROI.');
  }

  return {
    objective: 'Light teaser for optional agents (Sarah, James).',
    allowedMoves: ['advance:close'],
    requiredData: [],
    speak: `There may also be upside in reactivation or reviews, and you can explore those agents on the page as well.`,
    ask: false,
    waitForUser: false,
    canSkip: true,
    advanceOn: ['spoken'],
    notes: notes.length > 0 ? notes : undefined,
  };
}

// ─── Close ──────────────────────────────────────────────────────────────────

function buildCloseDirective(state: ConversationState): StageDirective {
  // ── just_demo variant: prospect opted out of numbers path ──
  if (state.proceedToROI === false) {
    console.log(`[JUST_DEMO_CLOSE] delivering just_demo close variant`);
    return {
      objective: 'Close for trial setup — just_demo path (no ROI delivery).',
      allowedMoves: ['extract:closeDecision', 'end'],
      requiredData: [],
      speak: `No worries at all — you can explore everything on the page at your own pace. If you'd like to activate the free trial, it takes about ten minutes, no credit card required. Would you like me to set that up?`,
      ask: true,
      waitForUser: true,
      canSkip: false,
      extract: ['closeDecision'],
      advanceOn: ['user_replied'],
    };
  }

  return {
    objective: 'Close for trial setup.',
    allowedMoves: ['extract:closeDecision', 'end'],
    requiredData: [],
    speak: `Perfect. Would you like to go ahead and activate your free trial? It takes about ten minutes to set up, there's no credit card required, and you could start seeing results this week.`,
    ask: true,
    waitForUser: true,
    canSkip: false,
    extract: ['closeDecision'],
    advanceOn: ['user_replied'],
  };
}

// ─── Main Entry Point ───────────────────────────────────────────────────────

export function buildStageDirective(input: StageDirectiveInput): StageDirective {
  const { stage, wowStep, intel, state } = input;

  switch (stage) {
    // ── Opening half (Chunk 4A) ──

    case 'greeting': {
      const greetName = fn(state);
      console.log(`[GREETING_RESOLVE] ts=${new Date().toISOString()} name=${greetName} biz=${biz(state).slice(0, 30)}`);
      return {
        objective: 'Warm human opening.',
        allowedMoves: ['advance:wow'],
        requiredData: ['firstName'],
        speak: `Hey ${greetName}, I'm Bella — welcome to your personalised AI Agent demonstration.`,
        ask: false,
        waitForUser: true,
        canSkip: false,
        advanceOn: ['user_replied'],
      };
    }

    case 'wow':
      return buildWowDirective(wowStep, state);

    case 'recommendation': {
      const recDirective = buildRecommendationDirective(state);
      console.log(`[REC_RESOLVE] ts=${new Date().toISOString()} alex=${state.alexEligible} chris=${state.chrisEligible} maddie=${state.maddieEligible} speak="${recDirective.speak.slice(0, 80)}"`);
      return recDirective;
    }

    case 'anchor_acv': {
      const lang = lp(state);
      const business = biz(state);
      return {
        objective: 'Capture average client value.',
        allowedMoves: ['extract:acv', 'advance:next_channel'],
        requiredData: ['business', 'industryLanguage.singularOutcome'],
        speak: `Perfect. What's a new ${lang.singularOutcome} worth to ${business} on average? A ballpark is totally fine.`,
        ask: true,
        waitForUser: true,
        canSkip: false,
        extract: ['acv'],
        advanceOn: ['acv_captured'],
        notes: ['After prospect provides ACV, acknowledge with "Got it." before proceeding.'],
      };
    }

    // ── Back half (Chunk 4B) ──

    case 'ch_alex':
      return buildAlexDirective(intel, state);

    case 'ch_chris':
      return buildChrisDirective(state);

    case 'ch_maddie':
      return buildMaddieDirective(state);

    case 'ch_sarah':
      return buildSarahDirective(state);

    case 'ch_james':
      return buildJamesDirective(state);

    case 'roi_delivery':
      return buildCombinedRoiDirective(state);

    case 'optional_side_agents':
      return buildOptionalSideAgentsDirective(state);

    case 'close':
      return buildCloseDirective(state);

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

