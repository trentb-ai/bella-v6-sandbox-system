/**
 * call-brain-do/src/moves.ts — v4.0.0-final-script-aligned
 * V2 directive builder: buildStageDirective.
 *
 * Chunk 4A: greeting, wow (8 WowStepId steps), recommendation (4 variants), anchor_acv.
 * Chunk 4B: ch_alex, ch_chris, ch_maddie, roi_delivery, optional_side_agents, close.
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

/** Resolve full business name. */
function biz(state: ConversationState): string {
  if (state.business) return state.business;
  const fast = state.intel.fast as any;
  const cons = (state.intel.consultant as any) ?? {};
  return fast?.core_identity?.business_name
    ?? cons?.businessIdentity?.correctedName
    ?? 'your business';
}

/** Short business name — strip stop words, take first 3 meaningful words. */
function shortBiz(state: ConversationState): string {
  const full = biz(state);
  if (full === 'your business') return full;
  const words = full.split(/\s+/);
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'of', 'in', 'for', 'by', 'at', 'to',
    'pty', 'ltd', 'inc', 'llc', 'co', 'group', 'services', 'solutions',
    'australia', 'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide',
  ]);
  const meaningful = words.filter((w: string) => !stopWords.has(w.toLowerCase()) && w.length > 1);
  return meaningful.slice(0, 3).join(' ') || full.slice(0, 30);
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
  return inputs.map(cleanFact).filter((x): x is string => Boolean(x)).slice(0, 5);
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
    case 'wow_1_research_intro':
      console.log(`[WOW1_RESOLVE] ts=${new Date().toISOString()} name=${name} biz=${business.slice(0, 30)} industry=${lang.industryLabel}`);
      return {
        objective: 'Demo frame + research intro, get permission to continue.',
        allowedMoves: ['advance:wow_2_reputation_trial'],
        requiredData: ['firstName', 'business', 'industry'],
        speak: `So ${name}, your pre-trained agents are ready to go. You can play a prospective ${shortBiz(state)} ${lang.singularOutcome}, and they'll engage like they've worked for ${business} for years — answering questions, qualifying the opportunity, and moving people toward your key conversion point on autopilot. Now ${name}, I think you'll be impressed. We've researched ${business}, and we use that to pre-train your agents around your ${lang.pluralOutcome}, your industry, and how you win business. Before we begin, can I confirm a couple of findings so your agents are dialled in and aimed at the highest-value opportunities?`,
        ask: true,
        waitForUser: true,
        canSkip: false,
        extract: ['research_permission'],
        advanceOn: ['wow_2_reputation_trial'],
      };

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
      const icpProblems: unknown[] = c.icpAnalysis?.icpProblems ?? [];
      const icpSolutions: unknown[] = c.icpAnalysis?.icpSolutions ?? [];
      const referenceOffer = fills.reference_offer ?? '';
      const cleanProblems = cleanFacts(icpProblems);
      const cleanSolutions = cleanFacts(icpSolutions);

      let insightText: string;
      let wow3Branch: string;
      if (icpGuess && cleanProblems.length >= 2 && cleanSolutions.length >= 2) {
        wow3Branch = 'ICP_FULL';
        insightText = `It looks like you mainly serve ${icpGuess}. The main problems they come to you with are ${cleanProblems[0]} and ${cleanProblems[1]}, and you solve those through ${cleanSolutions[0]} and ${cleanSolutions[1]}. Does that sound right?`;
      } else if (referenceOffer) {
        wow3Branch = 'REF_OFFER';
        const industryAudience = icpGuess || lang.pluralOutcome;
        insightText = `From your website, it looks like your positioning is centred around ${referenceOffer}, and it seems like you're speaking mainly to ${industryAudience}. Does that sound right?`;
      } else {
        wow3Branch = 'GENERIC';
        insightText = `The site does a strong job of positioning what ${shortBiz(state)} does. Does that sound right?`;
      }

      console.log(`[WOW3_RESOLVE] ts=${new Date().toISOString()} branch=${wow3Branch} raw_icp="${rawIcpGuess.slice(0, 60)}" cleaned_icp="${icpGuess.slice(0, 40)}" problems=${cleanProblems.length} solutions=${cleanSolutions.length} refOffer=${!!referenceOffer}`);

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

      // Classify CTA type for type-specific speech
      const ctaTypeLabel = classifyCTAType(ctaType, primaryCTA);

      let conversionLine: string;
      let wow4Branch: string;

      if (agentTrainingLine && agentTrainingLine.length > 30) {
        // Best path: consultant produced a Bella-ready line referencing all CTAs
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
      console.log(`[WOW4_RESOLVE] ts=${new Date().toISOString()} branch=${wow4Branch} ctaType="${ctaType || 'none'}" ctaLabel=${ctaTypeLabel} cta="${(primaryCTA || 'none').slice(0, 40)}" hasTrainingLine=${!!agentTrainingLine} hasBellaLine=${!!ceaBellaLine}`);

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

    case 'wow_5_alignment_bridge':
      return {
        objective: 'Confirm agents are dialled in.',
        allowedMoves: ['advance:wow_6_scraped_observation'],
        requiredData: [],
        speak: `Great — that helps confirm your agents are dialled in around the highest-value opportunities.`,
        ask: false,
        waitForUser: false,
        canSkip: false,
        advanceOn: ['wow_6_scraped_observation'],
      };

    case 'wow_6_scraped_observation': {
      const scrapedSummary = fills.scrapedDataSummary ?? '';
      const mostImpressiveLine = (c.mostImpressive?.[0]?.bellaLine ?? '').trim();

      let observationLine: string;
      let wow6Source: string;
      if (scrapedSummary) {
        wow6Source = 'SCRAPED_SUMMARY';
        observationLine = `Also ${name}, we noticed ${scrapedSummary}. That helps show where the biggest upside from automation could be for ${business}.`;
      } else if (mostImpressiveLine) {
        wow6Source = 'MOST_IMPRESSIVE';
        const cleaned = mostImpressiveLine.replace(/[.!]+$/, '');
        observationLine = `Also ${name}, ${cleaned} — and that tells us there's a real opportunity for automation to drive even more value for ${business}.`;
      } else {
        wow6Source = 'GENERIC';
        observationLine = `Also ${name}, from what we can already see on your site, there looks to be a clear opportunity to improve how inbound demand gets captured and converted.`;
      }

      console.log(`[WOW6_RESOLVE] ts=${new Date().toISOString()} source=${wow6Source} scrapedSummary=${!!scrapedSummary} mostImpressive="${mostImpressiveLine.slice(0, 60)}" speak_preview="${observationLine.slice(0, 80)}"`);

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
      return {
        objective: 'Deliver Alex speed-to-lead ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: `So with an average ${lang.singularOutcome} value of ${state.acv} dollars, around ${state.inboundLeads} inbound leads a week, and a response time of ${bandToSpokenLabel(state.responseSpeedBand)}, Alex could conservatively add around ${result.weeklyValue.toLocaleString()} dollars a week just by tightening speed-to-lead and follow-up consistency. Does that make sense?`,
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

  if (adsPath) {
    // Ads-scoped — ask about ad/campaign lead volume
    channelScope = 'ads/campaign';
    if (state.inboundLeads == null) {
      questionText = `Roughly how many leads are your ads generating in a typical week?`;
      extractFields = ['inboundLeads'];
    } else if (state.inboundConversions == null && state.inboundConversionRate == null) {
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
    } else if (state.inboundConversions == null && state.inboundConversionRate == null) {
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
    } else if (state.inboundConversions == null && state.inboundConversionRate == null) {
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

  // Chris needs only 2 inputs: webLeads + webConversions/Rate.
  // No follow-up-speed question — Chris uplift is conversion-rate-based, not speed-based.
  if (state.webLeads == null) {
    questionText = `Roughly how many website enquiries are you getting in a typical week?`;
    extractFields = ['webLeads'];
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

      return {
        objective: 'Deliver Maddie missed call recovery ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: `So if you're getting around ${state.phoneVolume} inbound calls a week and ${missedDesc}, that's a meaningful number of live opportunities at risk. When people hit voicemail, a lot of them just try the next option. That's why Maddie is so valuable — she captures and qualifies more of those calls before they disappear. Conservatively, that could mean around ${result.weeklyValue.toLocaleString()} dollars a week in recovered revenue. Does that track?`,
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

  return {
    objective: 'Deliver combined ROI total — conservative, core agents only.',
    allowedMoves: ['advance:optional_side_agents', 'advance:close'],
    requiredData: [],
    speak: `So ${name}, if we add that up, we've got ${agentSummary}. That's a combined total of roughly ${totalWeeklyValue.toLocaleString()} dollars a week in additional revenue, and those are conservative numbers. Does that all make sense?`,
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
      return {
        objective: 'Deliver Sarah database reactivation ROI.',
        allowedMoves: ['advance:next_channel'],
        requiredData: [],
        speak: `So you've got around ${state.oldLeads} old leads sitting in your database. Even at a conservative five percent reactivation rate, Sarah could bring back around ${result.weeklyValue.toLocaleString()} dollars a week in found revenue — and these are people who already know ${state.business || 'your business'}. Does that make sense?`,
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

