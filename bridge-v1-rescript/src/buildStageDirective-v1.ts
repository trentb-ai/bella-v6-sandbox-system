// V1 buildStageDirective — reads exclusively from BELLA_SCRIPT
// Zero ROI references. Clean placeholder replacement.

import { BELLA_SCRIPT, selectWow8Branch } from './bella-v1-script';

interface State {
  stage: string;
  stall: number;
  inputs: any;
  trial_reviews_done?: boolean;
}

// Helper: Replace {{placeholders}} with actual values
function fillPlaceholders(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || '');
  }
  return result;
}

export function buildStageDirective(
  s: State,
  fn: string,          // firstName
  biz: string,         // businessName
  ind: string,         // industry
  ct: string,          // customerType
  opener: string,
  intel: Record<string, any>,
): string {
  const i = s.inputs;
  const sf = intel.consultant?.scriptFills ?? {};
  const ci = intel.core_identity ?? {};
  const deep = intel?.deep ?? intel?.intel?.deep ?? {};
  const ts = intel.tech_stack ?? {};
  const flags = intel.flags ?? {};

  // Common placeholders
  const commonData: Record<string, string> = {
    firstName: fn,
    businessName: biz,
    shortBusinessName: biz.split(/\s+/)[0] || biz,
    customerType: ct,
    industry: ind,
  };

  // Reviews data
  const googleRating = deep.googleMaps?.rating ?? intel.star_rating ?? null;
  const googleReviews = deep.googleMaps?.review_count ?? intel.review_count ?? 0;

  // Hiring data
  const hiringMatches: any[] = deep.hiring?.hiring_agent_matches ?? intel.hiring_agent_matches ?? [];
  const topHiringWedge = intel.consultant?.hiringAnalysis?.topHiringWedge ?? "";
  const isHiring = !!(deep.hiring?.is_hiring || hiringMatches.length > 0);

  // Ads data
  const adsOn = !!(
    ts.is_running_ads || flags.is_running_ads || flags.has_fb_pixel || flags.has_google_ads
  );

  // ICP analysis
  const icpAnalysis = intel.consultant?.icpAnalysis ?? {};
  const icpProblems = icpAnalysis.icpProblems ?? [];
  const icpSolutions = icpAnalysis.icpSolutions ?? [];
  const icpGuess = sf.icp_guess ?? "";
  const icpNarrative = icpAnalysis.icpNarrative ?? "";
  const bellaCheckLine = icpAnalysis.bellaCheckLine ?? "";

  // Conversion analysis
  const conversionAnalysis = intel.consultant?.conversionEventAnalysis ?? {};
  const conversionNarrative = conversionAnalysis.conversionNarrative ?? "";
  const agentTrainingLine = conversionAnalysis.agentTrainingLine ?? "";
  const primaryCTA = conversionAnalysis.primaryCTA ?? sf.top_2_website_ctas ?? "";
  const ctaAgentMapping = conversionAnalysis.ctaAgentMapping ?? "";
  const referenceOffer = sf.reference_offer ?? "";

  // Routing
  const routing = intel.consultant?.routing ?? {};
  const priorityAgents: string[] = (routing.priority_agents ?? []).map((a: string) =>
    a.charAt(0).toUpperCase() + a.slice(1).toLowerCase());

  // ── WOW STAGE ──────────────────────────────────────────────────────────────
  if (s.stage === "wow") {
    const stall = s.stall;

    if (stall === 1) {
      const template = BELLA_SCRIPT.wow_1_research_intro.speak;
      return `WOW — RESEARCH INTRO\n<DELIVER_THIS>${fillPlaceholders(template, commonData)}</DELIVER_THIS>\nThen STOP and wait for their response.`;
    }

    if (stall === 2) {
      if (googleRating && googleRating >= 3) {
        s.trial_reviews_done = true;
        const template = BELLA_SCRIPT.wow_2_reputation_trial.speak;
        const data = { ...commonData, googleRating: String(googleRating), googleReviews: String(googleReviews) };
        return `WOW — REPUTATION + TRIAL\n<DELIVER_THIS>${fillPlaceholders(template, data)}</DELIVER_THIS>\nThen STOP and wait for their response.`;
      }
      // Skip stall 2 if no reviews
      s.stall = 3;
    }

    if (stall === 3) {
      let insightText = "";
      const cleanIcp = icpGuess
        ? icpGuess.replace(/^it\s+(looks|seems)\s+like\s+/i, "")
            .replace(/[,;—–-]+\s*(is that right|right|yeah)\??\s*$/i, "")
            .replace(/\?+$/, "").trim()
        : "";

      if (icpNarrative) {
        insightText = icpNarrative;
      } else if (cleanIcp && icpProblems.length >= 2 && icpSolutions.length >= 2) {
        const template = BELLA_SCRIPT.wow_3_icp_problems_solutions.speak_fallback;
        insightText = fillPlaceholders(template, {
          ...commonData,
          icpGuess: cleanIcp,
          icpProblem1: icpProblems[0],
          icpProblem2: icpProblems[1],
          icpSolution1: icpSolutions[0],
          icpSolution2: icpSolutions[1],
        });
      } else if (referenceOffer && cleanIcp) {
        const template = BELLA_SCRIPT.wow_3_icp_problems_solutions.speak_positioning;
        insightText = fillPlaceholders(template, { ...commonData, referenceOffer, icpGuess: cleanIcp });
      } else if (bellaCheckLine) {
        insightText = bellaCheckLine;
      } else {
        const template = BELLA_SCRIPT.wow_3_icp_problems_solutions.speak_generic;
        insightText = fillPlaceholders(template, commonData);
      }

      return `WOW — ICP + PROBLEMS + SOLUTIONS\n<DELIVER_THIS>${insightText}</DELIVER_THIS>\nThen STOP and wait for their response.`;
    }

    if (stall === 4) {
      const template = BELLA_SCRIPT.wow_4_pretraining_connect.speak;
      let trialAppend = "";
      if (!s.trial_reviews_done) {
        s.trial_reviews_done = true;
        trialAppend = BELLA_SCRIPT.wow_4_pretraining_connect.speak_trial_append;
      }
      return `WOW — PRE-TRAINING CONNECT\n<DELIVER_THIS>${fillPlaceholders(template, commonData)}${trialAppend}</DELIVER_THIS>\nThen STOP and wait for their response.`;
    }

    if (stall === 5) {
      let conversionLine = "";
      if (conversionNarrative) {
        conversionLine = fillPlaceholders(BELLA_SCRIPT.wow_5_conversion_events.speak_narrative.replace('. Would that be useful?', ''), commonData) + '. ' + conversionNarrative;
      } else if (agentTrainingLine) {
        conversionLine = fillPlaceholders(BELLA_SCRIPT.wow_5_conversion_events.speak_agent_training.replace('. Would that be useful?', ''), commonData) + '. ' + agentTrainingLine;
      } else if (primaryCTA) {
        const template = BELLA_SCRIPT.wow_5_conversion_events.speak_primary_cta;
        conversionLine = fillPlaceholders(template, { ...commonData, primaryCTA });
      } else {
        const template = BELLA_SCRIPT.wow_5_conversion_events.speak_generic;
        conversionLine = fillPlaceholders(template, commonData);
      }
      return `WOW — CONVERSION EVENTS\n<DELIVER_THIS>${conversionLine}</DELIVER_THIS>\nEnd with "Would that be useful?" — soft close. Then STOP.`;
    }

    if (stall === 6) {
      const template = BELLA_SCRIPT.wow_6_audit_transition.speak;
      return `WOW — AUDIT TRANSITION\n<DELIVER_THIS>${fillPlaceholders(template, commonData)}</DELIVER_THIS>\nThen STOP and wait for their response.`;
    }

    if (stall === 7) {
      const hasStrongPhoneSignal = !!(flags.speed_to_lead_needed || flags.call_handling_needed);
      const sourceAlreadyClear = priorityAgents.length >= 2 && (adsOn || hasStrongPhoneSignal);
      const detectedChannel = adsOn ? "paid advertising" : hasStrongPhoneSignal ? "inbound phone calls" : "your website";

      let sourceQ = "";
      if (sourceAlreadyClear) {
        sourceQ = fillPlaceholders(BELLA_SCRIPT.wow_7_lead_source.speak_source_clear, { ...commonData, detectedChannel });
      } else if (adsOn) {
        sourceQ = fillPlaceholders(BELLA_SCRIPT.wow_7_lead_source.speak_ads_running, commonData);
      } else {
        sourceQ = fillPlaceholders(BELLA_SCRIPT.wow_7_lead_source.speak_generic, commonData);
      }
      return `WOW — LEAD SOURCE\nSAY: "${sourceQ}"\nONE question. Then STOP.`;
    }

    if (stall === 8) {
      const { branch, placeholders } = selectWow8Branch(intel);
      const template = BELLA_SCRIPT.wow_8_lead_source_deep[branch];
      const data = { ...commonData, ...placeholders };
      const question = fillPlaceholders(template, data);
      return `WOW — LEAD SOURCE DEEP\nSAY: "${question}"\nThen STOP.`;
    }

    if (stall === 9) {
      let hiringLine = "";
      if (topHiringWedge) {
        hiringLine = topHiringWedge;
      } else if (isHiring && hiringMatches.length > 0) {
        const template = BELLA_SCRIPT.wow_9_hiring_wedge.speak_hiring_role;
        hiringLine = fillPlaceholders(template, { ...commonData, hiringRole: hiringMatches[0].role || hiringMatches[0].title });
      } else if (isHiring) {
        hiringLine = BELLA_SCRIPT.wow_9_hiring_wedge.speak_hiring_generic;
      } else {
        hiringLine = BELLA_SCRIPT.wow_9_hiring_wedge.speak_question;
      }
      return `WOW — HIRING WEDGE\nSAY: "${hiringLine}"\nThen STOP.`;
    }

    // stall 10: PROVISIONAL RECOMMENDATION (V1: final recommendation, no ROI bridge)
    {
      const a1 = priorityAgents[0] ?? "Chris";
      const a2 = priorityAgents[1] ?? "Alex";

      let recLine = "";
      if (ctaAgentMapping) {
        const template = BELLA_SCRIPT.wow_10_provisional_rec_bridge.speak_cta_mapping;
        recLine = fillPlaceholders(template, { ...commonData, agent1: a1, agent2: a2, ctaAgentMapping });
      } else if (isHiring && hiringMatches.length > 0) {
        const topMatch = hiringMatches[0];
        const hiringAgent = topMatch.agents?.[0] ?? a1;
        const hiringWedge = topMatch.wedge || "that role you're hiring for";
        const template = BELLA_SCRIPT.wow_10_provisional_rec_bridge.speak_hiring_match;
        recLine = fillPlaceholders(template, { ...commonData, hiringAgent, agent2: a2, hiringWedge });
      } else {
        const template = BELLA_SCRIPT.wow_10_provisional_rec_bridge.speak_generic;
        recLine = fillPlaceholders(template, { ...commonData, agent1: a1, agent2: a2 });
      }

      return `WOW — PROVISIONAL REC (V1: FINAL)\n<DELIVER_THIS>${recLine}</DELIVER_THIS>\nThen STOP and wait. Channel questions validate this recommendation.`;
    }
  }

  // ── CHANNEL STAGES (DISCOVERY + RECOMMENDATION) ─────────────────────────────
  if (s.stage === "ch_ads") {
    const need: string[] = [];
    if (i.ads_leads == null) {
      const q = adsOn ? BELLA_SCRIPT.ch_ads_discovery.q1_leads : BELLA_SCRIPT.ch_ads_discovery.q1_no_ads;
      need.push(`"${fillPlaceholders(q, commonData)}"`);
    }
    if (i.ads_leads != null && i.ads_conversions == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_ads_discovery.q2_conversions, commonData)}"`);
    }
    if (i.ads_conversions != null && i.ads_followup == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_ads_discovery.q3_followup, commonData)}"`);
    }

    if (!need.length) {
      // All inputs captured → RECOMMEND (no ROI)
      const template = BELLA_SCRIPT.ch_ads_discovery.recommendation;
      const data = { ...commonData, adsLeads: String(i.ads_leads), adsConversions: String(i.ads_conversions) };
      return `ADS — Alex — RECOMMEND\n<DELIVER_THIS>${fillPlaceholders(template, data)}</DELIVER_THIS>\nThen STOP and wait.`;
    }
    return `ADS CHANNEL — Alex\nSAY THIS:\n${need[0]}\nONE question. STOP.`;
  }

  if (s.stage === "ch_website") {
    const need: string[] = [];
    if (i.web_leads == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_website_discovery.q1_leads, commonData)}"`);
    }
    if (i.web_leads != null && i.web_conversions == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_website_discovery.q2_conversions, commonData)}"`);
    }
    if (i.web_conversions != null && i.web_followup_speed == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_website_discovery.q3_followup, commonData)}"`);
    }

    if (!need.length) {
      const template = BELLA_SCRIPT.ch_website_discovery.recommendation;
      const data = { ...commonData, webLeads: String(i.web_leads) };
      return `WEBSITE — Chris — RECOMMEND\n<DELIVER_THIS>${fillPlaceholders(template, data)}</DELIVER_THIS>\nThen STOP and wait.`;
    }
    return `WEBSITE CHANNEL — Chris\nSAY THIS:\n${need[0]}\nONE question. STOP.`;
  }

  if (s.stage === "ch_phone") {
    const need: string[] = [];
    if (i.phone_volume == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_phone_discovery.q1_volume, commonData)}"`);
    }
    if (i.phone_volume != null && i.after_hours == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_phone_discovery.q2_after_hours, commonData)}"`);
    }
    if (i.after_hours != null && !["24/7 coverage"].includes(i.after_hours) && i.missed_call_callback_speed == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_phone_discovery.q3_callback_speed, commonData)}"`);
    }

    if (i.after_hours === "24/7 coverage") {
      return `PHONE — Maddie — 24/7 coverage confirmed. Skip Maddie, acknowledge and advance.`;
    }

    if (!need.length) {
      const template = BELLA_SCRIPT.ch_phone_discovery.recommendation;
      return `PHONE — Maddie — RECOMMEND\n<DELIVER_THIS>${fillPlaceholders(template, commonData)}</DELIVER_THIS>\nThen STOP and wait.`;
    }
    return `PHONE CHANNEL — Maddie\nSAY THIS:\n${need[0]}\nONE question. STOP.`;
  }

  if (s.stage === "ch_old_leads") {
    if (i.old_leads != null) {
      const template = BELLA_SCRIPT.ch_old_leads_discovery.recommendation;
      const data = { ...commonData, oldLeads: String(i.old_leads) };
      return `OLD LEADS — Sarah — RECOMMEND\n<DELIVER_THIS>${fillPlaceholders(template, data)}</DELIVER_THIS>\nThen STOP and wait.`;
    }
    return `OLD LEADS — Sarah\nSAY THIS:\n"${fillPlaceholders(BELLA_SCRIPT.ch_old_leads_discovery.q1_old_leads, commonData)}"\nONE question. STOP.`;
  }

  if (s.stage === "ch_reviews") {
    const need: string[] = [];
    if (i.new_cust_per_period == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_reviews_discovery.q1_new_customers, commonData)}"`);
    }
    if (i.new_cust_per_period != null && i.star_rating == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_reviews_discovery.q2_rating, commonData)}"`);
    }
    if (i.star_rating != null && i.review_count == null) {
      need.push(`"${fillPlaceholders(BELLA_SCRIPT.ch_reviews_discovery.q3_review_count, commonData)}"`);
    }
    if (i.review_count != null && i.has_review_system == null) {
      const q = googleRating
        ? fillPlaceholders(BELLA_SCRIPT.ch_reviews_discovery.q4_with_known_reviews, { ...commonData, googleRating: String(googleRating), googleReviews: String(googleReviews) })
        : fillPlaceholders(BELLA_SCRIPT.ch_reviews_discovery.q4_review_system, commonData);
      need.push(`"${q}"`);
    }

    if (!need.length) {
      if (i.has_review_system === true) {
        return `REVIEWS — James — HAS REVIEW SYSTEM. Skip James, acknowledge and advance.\nSAY: "${BELLA_SCRIPT.ch_reviews_discovery.skip_has_system}"`;
      }
      const template = BELLA_SCRIPT.ch_reviews_discovery.recommendation;
      const data = { ...commonData, newCustomers: String(i.new_cust_per_period) };
      return `REVIEWS — James — RECOMMEND\n<DELIVER_THIS>${fillPlaceholders(template, data)}</DELIVER_THIS>\nThen STOP and wait.`;
    }
    return `REVIEWS — James\nSAY THIS:\n${need[0]}\nONE question. STOP.`;
  }

  // ── CLOSE STAGE ─────────────────────────────────────────────────────────────
  if (s.stage === "close") {
    const template = BELLA_SCRIPT.close_v3_punchy.speak;
    return `CLOSE\n<DELIVER_THIS>${fillPlaceholders(template, commonData)}</DELIVER_THIS>`;
  }

  return `${(s.stage as string).toUpperCase()} — continue naturally.`;
}
