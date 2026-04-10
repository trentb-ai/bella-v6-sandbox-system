// BELLA V1 SCRIPT CONFIG
// ─────────────────────────────────────────────────────────────
// THIS IS THE ONLY FILE TRENT EDITS.
// All spoken lines, directives, templates, and placeholders live here.
// Logic code reads from this file. Never hardcode speech in logic files.
// ─────────────────────────────────────────────────────────────

export const BELLA_SCRIPT = {

  // ── WOW STAGE (9 steps) ────────────────────────────────────────────────────────

  wow_1_research_intro: {
    speak: `Now {{firstName}}, I think you'll be impressed. We've done some research on {{businessName}}, and we use that to pre-train your agents so they understand your {{customerType}}s, your industry, and how you win business. Can I quickly confirm a couple of our findings with you, just to make sure your agents are dialled in?`,
    notes: `Opens with credibility. Uses firstName, businessName, customerType from intel. Extraction: none (just acknowledgment).`,
  },

  wow_2_reputation_trial: {
    speak: `Oh {{firstName}}, I noticed {{businessName}} has a {{googleRating}}-star reputation from {{googleReviews}} reviews — that's strong. Businesses already delivering good {{customerType}} outcomes qualify for our free trial, so if you'd like, I can get that set up for you at any point during this demo.`,
    notes: `ONLY delivered if googleRating >= 3. Early trial teaser for strong reputation. Uses googleRating, googleReviews from deep-scrape. Extraction: trial interest (optional).`,
    condition: `googleRating >= 3`,
  },

  wow_3_icp_problems_solutions: {
    speak_narrative: `{{icpNarrative}}`,
    speak_fallback: `It looks like you're primarily targeting {{icpGuess}}. The typical challenges your {{customerType}}s face are {{icpProblem1}} and {{icpProblem2}}, and you solve those through {{icpSolution1}} and {{icpSolution2}}. Does that sound right?`,
    speak_positioning: `From your website, it looks like your positioning is really centred around {{referenceOffer}}, and the way you present it suggests you're speaking to {{icpGuess}}. Does that sound right?`,
    speak_generic: `The site does a strong job of positioning what {{shortBusinessName}} does. Does that sound right?`,
    notes: `ICP + problems + solutions combined. Priority: icpNarrative (consultant pre-built) > mechanical stitch from arrays > positioning from referenceOffer > bellaCheckLine > generic. Extraction: ICP confirmation.`,
  },

  wow_4_pretraining_connect: {
    speak: `That's exactly the kind of business intelligence we've used to pre-train your AI team — so they don't sound generic. They understand your positioning, your {{customerType}}s, your reputation, and most importantly how you generate revenue.`,
    speak_trial_append: ` If you'd like, I can also help you activate the free trial during this session.`,
    notes: `Pre-training value statement. trial_append ONLY if wow_2 was skipped (no reviews). Uses customerType. Extraction: none.`,
  },

  wow_5_conversion_events: {
    speak_narrative: `{{conversionNarrative}}. Would that be useful?`,
    speak_agent_training: `{{agentTrainingLine}}. Would that be useful?`,
    speak_primary_cta: `So looking at your website, it seems your main conversion event is {{primaryCTA}}. That's how you turn interest into new {{customerType}}s, and it's exactly the kind of action we train your AI agents to drive more of, automatically. Would that be useful?`,
    speak_generic: `And looking at how your site is set up to convert visitors into {{customerType}}s, that's exactly the kind of action we train our AI agents to drive more of, automatically. Would that be useful?`,
    notes: `Conversion event alignment. Priority: conversionNarrative (consultant pre-built) > agentTrainingLine > primaryCTA rebuild > generic. ALWAYS ends with "Would that be useful?" soft close. Extraction: conversion alignment confirmation.`,
  },

  wow_6_audit_transition: {
    speak: `Perfect — so that confirms your agents are trained to bring in the right kind of {{customerType}}s and move them toward your key conversion points. I've just got a couple of quick opportunity-audit questions so I can work out which agent mix would be most valuable for {{businessName}}.`,
    notes: `Bridge move to channel discovery. NOT a question — just a transition statement. Uses customerType, businessName. Extraction: none (just acknowledgment).`,
  },

  wow_7_lead_source: {
    speak_source_clear: `Now {{firstName}}, apart from referrals, it looks like {{detectedChannel}} is a meaningful source of new {{customerType}}s for you — is that fair to say?`,
    speak_ads_running: `Now {{firstName}}, I can see you're already running ads, which is interesting. Apart from referrals, would you say that's your main source of new {{customerType}}s, or is another channel doing most of the heavy lifting?`,
    speak_generic: `Apart from referrals, what would you say is your main source of new {{customerType}}s right now — your website, phone calls, organic, paid ads, or something else?`,
    notes: `Main controllable lead source. 3 variants based on intel confidence. detectedChannel = "paid advertising" OR "inbound phone calls" OR "your website". Extraction: leadSourceDominant, leadSourceSecondary.`,
  },

  wow_8_lead_source_deep: {
    branch_ads: `I can see {{businessName}} is running {{adsPlatforms}} — are those performing well for you? And apart from referrals, is paid traffic your main source of new {{customerType}}s or is another channel pulling weight too?`,
    branch_chat_basic: `I noticed you've got {{chatTool}} on the site — is that generating many enquiries? And apart from referrals, where does most of your new business come from?`,
    branch_booking: `I can see you're using {{bookingTool}} — are most new {{customerType}}s coming through online bookings, or do they tend to find you another way first?`,
    branch_email: `It looks like {{businessName}} has an active email list via {{emailTool}} — is that a meaningful source of new business or more for retention?`,
    branch_reviews: `I can see {{businessName}} has a {{googleRating}}-star rating from {{googleReviews}} reviews on Google — are most new {{customerType}}s finding you through search, or is it more word of mouth?`,
    branch_hiring: `I noticed {{businessName}} is actively hiring — sounds like a growth phase. Is demand coming mainly through your website, referrals, or paid campaigns?`,
    branch_fallback: `Apart from referrals, where does most of your new business come from right now — your website, phone calls, organic search, or something else?`,
    notes: `Multi-signal branching — scrape intel makes the question smarter, not unnecessary. ALWAYS asks (no skip logic). Priority: ads > chat > booking > email > reviews > hiring > fallback. Uses adsPlatforms (e.g. "Google and Meta"), chatTool, bookingTool, emailTool, googleRating, googleReviews, businessName, customerType. Extraction: ['leadSourceDominant', 'leadSourceSecondary', 'adsConfirmed', 'websiteRelevant', 'phoneRelevant'].`,
  },

  wow_9_hiring_wedge: {
    speak_consultant_wedge: `{{topHiringWedge}}`,
    speak_hiring_role: `I also noticed you're hiring for {{hiringRole}}, which is interesting because that's exactly the kind of workload one of our agents can often absorb.`,
    speak_hiring_generic: `I noticed you're actively hiring — some of those roles are exactly what our AI agents handle.`,
    speak_question: `And are you doing any hiring at the moment?`,
    notes: `Hiring/capacity wedge. Priority: topHiringWedge (consultant pre-built) > hiringRole > generic hiring statement > question. Uses topHiringWedge, hiringRole from deep-scrape hiring_agent_matches. Extraction: hiring status, capacity constraints.`,
  },

  wow_10_provisional_rec_bridge: {
    speak_cta_mapping: `Based on what I've found so far, the likely standouts for {{businessName}} look like {{agent1}} and {{agent2}}. {{ctaAgentMapping}}`,
    speak_hiring_match: `Based on what I've found so far, the likely standouts for {{businessName}} look like {{hiringAgent}} and {{agent2}}. {{hiringAgent}} would help with {{hiringWedge}}, and {{agent2}} would help with making sure every {{customerType}} lead gets followed up.`,
    speak_generic: `Based on what I've found so far, the likely standouts for {{businessName}} look like {{agent1}} and {{agent2}}. {{agent1}} would help with engaging visitors on your website before they bounce, and {{agent2}} would help with following up every {{customerType}} enquiry.`,
    notes: `V1 CHANGE: This is now the FINAL recommendation (no bridge to "work out ROI"). Priority: ctaAgentMapping (consultant pre-built) > hiring match > generic. Uses businessName, agent1, agent2 (from consultant routing.priority_agents), hiringAgent, hiringWedge, ctaAgentMapping, customerType. Extraction: provisional agent acceptance.`,
  },

  // ── CHANNEL STAGES (DISCOVERY ONLY — NO ROI) ───────────────────────────────────

  ch_ads_discovery: {
    q1_leads: `How many leads are your ads generating per {{period}}? Just a rough figure is fine.`,
    q1_no_ads: `I didn't see any Google or Facebook ads campaigns — is that right? Are you running any other online campaigns?`,
    q2_conversions: `And roughly how many of those are converting into paying {{customerType}}s?`,
    q3_followup: `And when those ad leads come in, how quickly is your team following up — under 30 minutes, 30 minutes to 3 hours, 3 to 24 hours, or more than 24 hours?`,
    recommendation: `Based on {{adsLeads}} leads and {{adsConversions}} conversions per {{period}}, Alex can handle those leads within 5 minutes and materially improve your conversion rate. Speed-to-lead is the biggest lever in paid advertising — Alex makes sure nobody waits.`,
    notes: `Alex — Ads Discovery. NO ROI delivery. period = "week" or "month". Uses adsLeads, adsConversions, period, customerType. Extraction: ads_leads, ads_conversions, ads_followup. Recommendation is VALUE language only, no dollar figures.`,
  },

  ch_website_discovery: {
    q1_leads: `How many enquiries or leads is your website generating per {{period}}?`,
    q2_conversions: `And roughly how many of those convert into paying {{customerType}}s?`,
    q3_followup: `And when a website enquiry comes in, how quickly is your team usually getting back to them?`,
    recommendation: `{{webLeads}} website enquiries per {{period}} is solid volume. Chris handles those in real time — so instead of prospects bouncing because nobody replied, they get an immediate response. More conversations, more conversions.`,
    notes: `Chris — Website Discovery. NO ROI delivery. Uses webLeads, period, customerType. Extraction: web_leads, web_conversions, web_followup_speed. Recommendation is outcome language, no calculations.`,
  },

  ch_phone_discovery: {
    q1_volume: `Roughly how many inbound calls does {{businessName}} get per {{period}}?`,
    q2_after_hours: `And when calls are missed — whether that's after hours or during busy periods — what usually happens?`,
    q3_callback_speed: `And how quickly are missed calls usually called back?`,
    recommendation: `Every missed call is a missed opportunity. Maddie picks up after hours, on weekends, whenever your team can't — so {{businessName}} never loses a lead just because nobody answered.`,
    skip_24_7: `Maddie — 24/7 coverage confirmed. Skip Maddie, acknowledge and advance.`,
    notes: `Maddie — Phone Discovery. NO ROI delivery. Uses businessName, period, phoneVolume. Extraction: phone_volume, after_hours, missed_call_callback_speed. If after_hours = "24/7 coverage" → skip Maddie entirely. Recommendation is reliability language, no numbers.`,
  },

  ch_old_leads_discovery: {
    q1_old_leads: `How many past {{customerType}}s or older leads would you say are sitting in your database that haven't been contacted in a while?`,
    recommendation: `{{oldLeads}} dormant leads is a real asset. Sarah systematically re-engages those — no manual work, no awkward cold calls, just smart follow-up that brings past opportunities back to life.`,
    notes: `Sarah — Old Leads Discovery. NO ROI delivery. Uses oldLeads, customerType. Extraction: old_leads. Recommendation is reactivation language, no dollar projections.`,
  },

  ch_reviews_discovery: {
    q1_new_customers: `Roughly how many new {{customerType}}s do you bring in each {{period}}?`,
    q2_rating: `What's your current average rating?`,
    q3_review_count: `Roughly how many reviews do you have?`,
    q4_review_system: `Do you have any kind of system that asks new {{customerType}}s for a review after you've delighted them with your service?`,
    q4_with_known_reviews: `And finally {{firstName}}, I see you have {{googleRating}} stars from {{googleReviews}} reviews. Do you have any kind of system that asks new {{customerType}}s for a review after you've delighted them with your service?`,
    recommendation: `With {{newCustomers}} new {{customerType}}s per {{period}}, even a modest lift in review volume and response consistency can materially improve trust and conversion. James automates review requests and monitors your reputation 24/7 — so you're always building trust, never missing negative reviews.`,
    skip_has_system: `Great, sounds like you've already got that covered.`,
    notes: `James — Reviews Discovery. NO ROI delivery. Uses newCustomers, period, customerType, firstName, googleRating, googleReviews. Extraction: new_cust_per_period, star_rating, review_count, has_review_system. If has_review_system = true → skip James. Recommendation is reputation language, no calculations.`,
  },

  // ── CLOSE STAGE (3 VERSIONS — CC WRITES, TRENT PICKS) ──────────────────────────
  // NOTE: Agents already recommended at wow_9, validated through channels.
  // Close = free trial activation ONLY. No agent repeat.

  close_v1_short: {
    speak: `Perfect {{firstName}}. Would you like to go ahead and activate your free trial? It takes about ten minutes to set up, there's no credit card required, and you could start seeing results this week.`,
    notes: `SHORT VERSION — Direct, clean, 2 sentences. Uses firstName only. Zero risk framing embedded. Clear yes/no question. Agents already known from wow_9 recommendation.`,
  },

  close_v2_medium: {
    speak: `Perfect {{firstName}}. So that's {{agentList}} for {{businessName}} — exactly the right fit based on everything you've shared. Would you like to activate your free trial? Takes about ten minutes, no credit card required, and you'll start seeing results this week.`,
    notes: `MEDIUM VERSION — Brief recap of agents (one phrase, not a re-pitch), then trial activation. Uses firstName, agentList (e.g. "Alex and Chris"), businessName. Slightly more closure before the ask.`,
  },

  close_v3_punchy: {
    speak: `Alright {{firstName}}, let's get you set up. Free trial, no credit card, ten minutes, and you'll see results this week. Want me to activate that for you?`,
    notes: `PUNCHY VERSION — Assumes the sale. Confident, warm, no hesitation. Uses firstName only. Shortest path to yes. "Let's get you set up" = momentum, not asking permission. Then the formal yes/no question.`,
  },

  close_pricing_objection: {
    speak: `We work on performance-based pricing after the trial — you only pay a percentage of the conversions we generate, so there's literally zero financial risk. But let's get you set up first.`,
    notes: `PRICING OBJECTION RESPONSE — Use if prospect asks about cost or pricing. Zero risk framing. Do not elaborate further. Then return to close.`,
  },

  // ── OUTPUT RULES (V1 — REPLACES ROI RULES) ─────────────────────────────────────

  output_rules: [
    `ONLY SPOKEN WORDS. No labels, headers, XML tags, markdown, code formatting, or symbols in the output.`,
    `Use up to 3 statements and one question per turn, 4 sentences maximum.`,
    `Say numbers naturally in spoken form. NEVER use dollar signs, commas, or numeric symbols.`,
    `NEVER APOLOGISE, NEVER BACKTRACK, NEVER DEFLECT. If challenged, say "That's the conservative estimate from our model" and move to the current directive. Never say sorry, my mistake, good catch, I misspoke, you're right to pull me up, I missed the mark, I got ahead of myself, or any synonym of apology.`,
    `SCRIPT COMPLIANCE: Deliver the scripted instruction from the MANDATORY SCRIPT section exactly as written. You may add ONE brief natural sentence before it, but the scripted line must remain WORD-FOR-WORD unchanged.`,
    `QUESTION COMPLIANCE: If the prospect gives filler instead of answering a question, briefly acknowledge and re-ask. Do not pretend the question was answered.`,
    `Do not mention missing data, internal systems, routing logic, controllers, calculators, or enrichment pipelines.`,
    `RECOMMENDATION FOCUS: After channel discovery, recommend the agent based on confirmed need. Use value language ("materially improve conversion", "handle leads faster", "never miss a call") — NEVER dollar figures, weekly value, ROI, or financial projections.`,
    `FREE TRIAL CLOSE: After recommendations, offer the free trial directly. No pivot, no hesitation.`,
    `ZERO RISK FRAMING: If prospect asks about cost or pricing, use the pricing_objection_response. Do not elaborate further. Then return to close.`,
  ],

};

// ── HELPER: Get wow_8 branch based on available signals ──────────────────────────

export function selectWow8Branch(intel: any): {
  branch: keyof typeof BELLA_SCRIPT.wow_8_lead_source_deep;
  placeholders: Record<string, string>;
} {
  const flags = intel?.flags ?? {};
  const ft = intel?.tech_stack?.flags_tech ?? {};
  const places = intel?.places ?? {};
  const ts = intel?.tech_stack ?? {};
  const deep = intel?.deep ?? {};

  const adsOn = flags.is_running_ads;
  const adsPlatforms = ts.ads_pixels ?? [];
  const hasChat = ft.has_chat;
  const chatTool = ts.chat_tool;
  const chatBasic = ft.chat_likely_basic || ft.has_non_ai_chat;
  const hasBooking = ft.has_booking;
  const bookingTool = ts.booking_tool;
  const hasEmailList = ft.has_email_marketing;
  const emailTool = ts.email_tool;
  const googleRating = places.rating;
  const googleReviews = places.review_count;
  const isHiring = deep?.hiring?.is_hiring;

  // Priority order — use first signal that's present
  if (adsOn && adsPlatforms.length > 0) {
    const platformNames = adsPlatforms.length > 2
      ? "across a few platforms"
      : adsPlatforms.length === 2
      ? `${adsPlatforms[0]} and ${adsPlatforms[1]}`
      : adsPlatforms[0];
    return {
      branch: 'branch_ads',
      placeholders: { adsPlatforms: platformNames },
    };
  }

  if (hasChat && chatBasic && chatTool) {
    return {
      branch: 'branch_chat_basic',
      placeholders: { chatTool },
    };
  }

  if (hasBooking && bookingTool) {
    return {
      branch: 'branch_booking',
      placeholders: { bookingTool },
    };
  }

  if (hasEmailList && emailTool) {
    return {
      branch: 'branch_email',
      placeholders: { emailTool },
    };
  }

  if (googleRating && googleRating >= 3 && googleReviews && googleReviews > 10) {
    return {
      branch: 'branch_reviews',
      placeholders: {
        googleRating: String(googleRating),
        googleReviews: String(googleReviews),
      },
    };
  }

  if (isHiring) {
    return {
      branch: 'branch_hiring',
      placeholders: {},
    };
  }

  // Fallback — pure discovery question
  return {
    branch: 'branch_fallback',
    placeholders: {},
  };
}
