// var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var COUNTRY = "AU";
var CURRENCY = "AUD";
var LOCALE = {
  country: "AU",
  currency: "AUD",
  timezone: "Australia/Sydney",
  date_format: "DD/MM/YYYY",
  phone_format: "+61",
  locked: true
};
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(jsonResponse, "jsonResponse");
var worker_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    const path = new URL(request.url).pathname;
    try {
      if (path === "/validate") return await handleValidate(request, env);
      if (path === "/steer") return await handleSteer(request, env);
      if (path.startsWith("/normalize/")) return await handleNormalize(request, env);
      return jsonResponse({ error: "Use /validate, /steer, or /normalize/{lid}" }, 404);
    } catch (err) {
      console.error("Supreme Court fatal:", err.stack || err.message);
      return jsonResponse({ error: err.message }, 500);
    }
  }
};
function extract(raw) {
  const cf = raw.critical_fixes || {};
  const mi = raw.marketing_intelligence || {};
  const ads = mi.adIntelligence || {};
  const rep = mi.reputationIntelligence || {};
  const tech = mi.techStackIntelligence || {};
  const sr = mi.scraperResults || {};
  const pf = raw.prioritized_fixes || {};
  const ci = raw.consultative_intelligence || {};
  const ss = mi.sarahSleepingGiant || {};
  const gp = cf.googlePlaces || {};
  const bizName = raw.business_name || gp.name || raw.lp_business_name || "this business";
  const rating = cf.googleRating || raw.star_rating || null;
  const reviewCount = cf.googleReviewCount || raw.review_count || 0;
  const yearsInBusiness = raw.years_in_business || 0;
  const adAge = ads.facebookAds?.adAge || cf.facebookAdAge || 0;
  return { cf, mi, ads, rep, tech, sr, pf, ci, ss, gp, bizName, rating, reviewCount, yearsInBusiness, adAge };
}
__name(extract, "extract");
function scoreAgents(raw) {
  const { cf, sr, ss, yearsInBusiness, adAge } = extract(raw);
  const s = { alex: 0, chris: 0, maddie: 0, sarah: 0, james: 0 };
  if (cf.isRunningAds) s.alex += 40;
  if (cf.isRunningGoogleAds) s.alex += 15;
  if (cf.isRunningFacebookAds) s.alex += 15;
  if (cf.needsSpeedToLead) s.alex += 25;
  if (!cf.hasCRM) s.alex += 15;
  if (!cf.hasCallTracking) s.alex += 5;
  if (cf.hasCriticalAdIssues) s.alex += 10;
  if ((cf.adWeeklyLoss || 0) > 500) s.alex += 10;
  if ((cf.adWeeklyLoss || 0) > 1e3) s.alex += 5;
  if (cf.needsWebsiteConcierge) s.chris += 30;
  if (!cf.hasLeadForm) s.chris += 20;
  if (!cf.hasBookingSystem) s.chris += 15;
  if ((cf.landingPageScore || 0) < 30) s.chris += 20;
  else if ((cf.landingPageScore || 0) < 50) s.chris += 10;
  if (!cf.hasChatWidget) s.chris += 15;
  if (cf.needsLeadCapture) s.chris += 10;
  if (cf.needsCallHandling) s.maddie += 35;
  if (!cf.hasCallTracking) s.maddie += 20;
  if (cf.hasMissedCallEvidence) s.maddie += 25;
  if (cf.isRunningAds && !cf.hasCallTracking) s.maddie += 10;
  if (cf.isRunningAds && !cf.hasChatWidget && !cf.hasLeadForm) s.maddie += 10;
  if ((ss.count || cf.sarahSleepingGiantCount || 0) > 0) s.sarah += 50;
  if (!cf.hasEmailMarketing) s.sarah += 25;
  if (!cf.hasCRM) s.sarah += 10;
  if (cf.hasDormantCustomerEvidence) s.sarah += 20;
  if (cf.needsDatabaseReactivation) s.sarah += 15;
  if (yearsInBusiness >= 2) s.sarah += 30;
  if (adAge >= 365) s.sarah += 30;
  const rc = cf.googleReviewCount || 0;
  const rat = cf.googleRating || 5;
  if (rc > 50) s.james += 25;
  if (rc > 200) s.james += 10;
  if (rat < 4.3) s.james += 35;
  if (rat >= 4.3 && rc > 20) s.james += 15;
  if (cf.hasQuotableContent) s.james += 15;
  if ((sr.outscraper_sentiment?.james_boost || 0) > 3) s.james += 20;
  if (cf.needsReviewResponseManagement) s.james += 20;
  if ((cf.googleOwnerResponseRate ?? sr.owner_reply_rate ?? 1) < 0.5) s.james += 15;
  const ranking = Object.entries(s).sort((a, b) => b[1] - a[1]).map(([a]) => a);
  return { ranking, scores: s };
}
__name(scoreAgents, "scoreAgents");
function buildPreFilled(raw) {
  const { cf, mi, ads, rep, tech, sr, pf, ci, ss, gp, bizName, rating, reviewCount } = extract(raw);
  const ib = raw.industry_benchmark || null;
  const topFix = (pf.topFixes || [])[0] || {};
  return {
    alex: {
      business_name: bizName,
      is_running_ads: cf.isRunningAds || false,
      is_running_google_ads: cf.isRunningGoogleAds || false,
      is_running_facebook_ads: cf.isRunningFacebookAds || false,
      facebook_ad_count: cf.facebookAdCount || 0,
      weekly_ad_bleed: cf.adWeeklyLoss || null,
      monthly_ad_bleed: cf.adFunnelScore?.totalMonthlyLoss || null,
      funnel_score: cf.adFunnelScore?.score || null,
      funnel_verdict: cf.adFunnelScore?.verdict || null,
      has_critical_ad_issues: cf.hasCriticalAdIssues || false,
      crm_detected: cf.hasCRM || false,
      call_tracking_detected: cf.hasCallTracking || false,
      speed_to_lead_grade: cf.grades?.speedToLead?.grade || null,
      top_fix_monthly_revenue: topFix.monthlyRevenue || null,
      total_monthly_opportunity: pf.totalMonthlyOpportunity || null,
      primary_pain_point: ci.primaryPainPoint || null,
      acv: ib?.acv || null,
      monthly_leads_benchmark: ib?.monthly_leads || null,
      currency: CURRENCY,
      country: COUNTRY
    },
    chris: {
      business_name: bizName,
      has_chat_widget: cf.hasChatWidget || false,
      has_lead_form: cf.hasLeadForm || false,
      has_booking_system: cf.hasBookingSystem || false,
      landing_page_score: cf.landingPageScore || 0,
      website_grade: cf.grades?.websiteConversion?.grade || null,
      tech_grade: tech.grade || null,
      tech_score: tech.score || 0,
      primary_cta: (raw.ctas || [])[0] || null,
      main_headline: raw.main_headline || null,
      primary_color: raw.primary_color || null,
      logo_url: raw.logo_url || null
    },
    maddie: {
      business_name: bizName,
      phone: raw.phone || null,
      business_hours: raw.business_hours || null,
      emergency_service: raw.emergency_service || "No",
      has_call_tracking: cf.hasCallTracking || false,
      has_missed_call_evidence: cf.hasMissedCallEvidence || false,
      google_rating: rating,
      review_count: reviewCount,
      service_areas: raw.service_areas || null,
      is_running_ads: cf.isRunningAds || false,
      after_hours_bleed: (cf.adFunnelScore?.issues || []).find((i) => i.issue?.includes("after-hours"))?.weeklyLoss || null
    },
    sarah: {
      business_name: bizName,
      sleeping_giant_count: ss.count || cf.sarahSleepingGiantCount || 0,
      sleeping_giant_pitch: ss.pitch || null,
      has_email_marketing: cf.hasEmailMarketing || false,
      has_crm: cf.hasCRM || false,
      has_dormant_evidence: cf.hasDormantCustomerEvidence || false,
      review_count: reviewCount,
      avg_rating: rating,
      acv: ib?.acv || null,
      currency: CURRENCY
    },
    james: {
      business_name: bizName,
      google_rating: rating,
      review_count: reviewCount,
      owner_reply_rate: sr.owner_reply_rate ?? cf.googleOwnerResponseRate ?? null,
      review_trend: cf.reviewTrendDirection || "stable",
      outscraper_triggered: (sr.outscraper_trigger_conditions || []).length > 0,
      outscraper_conditions: sr.outscraper_trigger_conditions || [],
      outscraper_sentiment: sr.outscraper_sentiment || null,
      james_boost: sr.outscraper_sentiment?.james_boost || null,
      top_quotes: (cf.topQuotes || []).slice(0, 3),
      has_quotable_content: cf.hasQuotableContent || false,
      reputation_grade: rep.grade || null,
      competitor_avg_rating: cf.competitorAvgRating || null,
      is_above_competitors: cf.isRatingAboveCompetitors || false,
      needs_review_mgmt: cf.needsReviewResponseManagement || false
    }
  };
}
__name(buildPreFilled, "buildPreFilled");
function buildMissing(raw, pf) {
  const { cf, sr } = extract(raw);
  const ib = raw.industry_benchmark;
  const m = { global: [], alex: [], chris: [], maddie: [], sarah: [], james: [] };
  if (!ib?.acv) m.global.push("avg_client_value");
  if (!raw.business_name && !pf.alex?.business_name?.match(/[A-Z]/)) m.global.push("confirmed_business_name");
  if (!pf.alex.is_running_ads) m.alex.push("ad_platform_confirmed");
  if (!pf.alex.acv) m.alex.push("avg_client_value");
  if (!pf.alex.weekly_ad_bleed) m.alex.push("current_ad_spend");
  if (!pf.chris.has_lead_form && !pf.chris.has_booking_system) m.chris.push("preferred_booking_method");
  if (!pf.maddie.phone) m.maddie.push("phone_number");
  if (!cf.hasCallTracking) m.maddie.push("avg_daily_call_volume");
  if (!cf.hasEmailMarketing) m.sarah.push("database_size");
  m.sarah.push("last_campaign_date");
  if (!sr.outscraper_sentiment) m.james.push("deep_review_analysis_pending");
  return m;
}
__name(buildMissing, "buildMissing");
function gradeData(raw) {
  const { cf, gp } = extract(raw);
  let s = 0;
  if (raw.business_name || gp.name) s += 20;
  if (raw.industry_benchmark?.acv) s += 20;
  if (cf.googleRating) s += 15;
  if ((cf.googleReviewCount || 0) > 5) s += 10;
  if (raw.phone) s += 10;
  if (cf.isRunningAds !== void 0) s += 10;
  if (raw.business_hours) s += 5;
  if (raw.services || raw.lp_services) s += 10;
  if (s >= 90) return "A";
  if (s >= 70) return "B";
  if (s >= 45) return "C";
  return "F";
}
__name(gradeData, "gradeData");
function buildLeanContext(raw) {
  const { cf, mi, sr, pf, ci, ss, gp, bizName, rating, reviewCount } = extract(raw);
  const ib = raw.industry_benchmark || null;
  const BLOB_KEYS = [
    "agent_knowledge_blob",
    "site_context_blob",
    "raw_html",
    "full_page_text",
    "page_content",
    "lp_content",
    "scraped_content",
    "raw_content",
    "full_text",
    "detailed_services",
    "ai_analysis",
    "site_analysis",
    "full_analysis",
    "competitor_analysis",
    "industry_analysis",
    "market_analysis"
  ];
  const lean = {
    bizName,
    industry: raw.industry || ib?.industry_key || "unknown",
    location: raw.location || "Australia",
    industry_benchmark: ib,
    is_running_ads: cf.isRunningAds || false,
    weekly_ad_bleed: cf.adWeeklyLoss || null,
    monthly_ad_bleed: cf.adFunnelScore?.totalMonthlyLoss || null,
    funnel_verdict: cf.adFunnelScore?.verdict || null,
    needs_speed_to_lead: cf.needsSpeedToLead || false,
    has_crm: cf.hasCRM || false,
    has_chat: cf.hasChatWidget || false,
    has_booking: cf.hasBookingSystem || false,
    has_call_tracking: cf.hasCallTracking || false,
    has_email_mktg: cf.hasEmailMarketing || false,
    landing_page_score: cf.landingPageScore || 0,
    google_rating: rating,
    review_count: reviewCount,
    owner_reply_rate: sr.owner_reply_rate ?? cf.googleOwnerResponseRate ?? null,
    outscraper_triggered: (sr.outscraper_trigger_conditions || []).length > 0,
    james_boost: sr.outscraper_sentiment?.james_boost || null,
    // Cap top quotes to 1, max 100 chars
    top_quote: (cf.topQuotes || [])[0]?.quote?.slice(0, 100) || null,
    has_quotable: cf.hasQuotableContent || false,
    sleeping_giant_count: ss.count || cf.sarahSleepingGiantCount || 0,
    primary_pain: ci.primaryPainPoint || null,
    // Top fix: just id, agent, revenue
    top_fix_id: (pf.topFixes || [])[0]?.id || null,
    top_fix_agent: (pf.topFixes || [])[0]?.agent || null,
    top_fix_revenue: (pf.topFixes || [])[0]?.monthlyRevenue || null,
    total_opportunity: pf.totalMonthlyOpportunity || null,
    overall_grade: cf.grades?.overall?.grade || null
  };
  return lean;
}
__name(buildLeanContext, "buildLeanContext");
async function callGemini(apiKey, prompt, maxTokens = 8192, temperature = 0.25) {
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens }
      })
    }
  );
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  const clean = raw.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/m, "").trim();
  const match = clean.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Gemini no JSON found. Raw start: ${raw.slice(0, 200)}`);
  try {
    return JSON.parse(match[0]);
  } catch (e) {
    throw new Error(`Gemini JSON parse fail: ${e.message}. Raw: ${raw.slice(0, 300)}`);
  }
}
__name(callGemini, "callGemini");
function buildGeminiPrompt(ctx, ranking) {
  const acv = ctx.industry_benchmark?.acv || null;
  const bleed = ctx.weekly_ad_bleed || null;
  return `You are the Pillar+Post AI Supreme Court language engine. Australia only. AUD only.
Warm, direct, no fluff. Use real numbers from context. Australian English.

CONTEXT (all signals pre-extracted \u2014 do NOT add your own):
${JSON.stringify(ctx, null, 0)}

TOP AGENT RANKING (computed, not yours to change): ${ranking.slice(0, 3).join(" > ")}

OUTPUT EXACTLY this JSON object \u2014 no markdown, no extra text, no explanations:
{
  "bella_opener": "<2 sentences max. Cold-read opener Bella says in first 10 sec. Use 1 real number from context.>",
  "pitch_hook": "<The core problem, 8 words max, punchy.>",
  "roi_narrative": "<1 sentence. Use AUD amounts. E.g.: '$X/week ad bleed \xD7 12 = $Y gone without a fix.'>",
  "agent_snippets": {
    "bella": "<1 sentence. Warm open + route to top agent.>",
    "alex": "<1 sentence. Ad/speed-to-lead angle with real number.>",
    "chris": "<1 sentence. Website/concierge gap angle.>",
    "maddie": "<1 sentence. Call handling / after-hours angle.>",
    "sarah": "<1 sentence. Database reactivation angle.>",
    "james": "<1 sentence. Reputation angle with real rating/review number.>",
    "trent": "<1 sentence. Tech integration opportunity.>",
    "agent8": "<1 sentence. Flex pitch for biggest remaining gap.>"
  },
  "close_strategies": {
    "price_objection": "<1 sentence. Use AUD payback number.>",
    "timing_objection": "<1 sentence. Daily cost of delay in AUD.>",
    "not_interested_objection": "<10 words max. One killer number.>"
  }
}`;
}
__name(buildGeminiPrompt, "buildGeminiPrompt");
function fallbackLanguage(ctx, ranking, bizName) {
  const acv = ctx.industry_benchmark?.acv || 2500;
  const bleed = ctx.weekly_ad_bleed || 0;
  const top = ranking[0] || "Alex";
  return {
    bella_opener: `G'day! We've analysed ${bizName} \u2014 there's a ${bleed ? `$${bleed}/week` : "significant"} leak we can plug. Got 60 seconds?`,
    pitch_hook: bleed > 0 ? `Ad spend bleeding weekly, no follow-up system.` : `Leads arriving, none being caught.`,
    roi_narrative: bleed > 0 ? `$${bleed}/week ad bleed \xD7 52 = $${bleed * 52} AUD/year left on the table.` : `At $${acv} AUD per client, one extra conversion/week = $${acv * 52} AUD/year.`,
    agent_snippets: {
      bella: `Warm open, reference the biggest signal, route to ${top}.`,
      alex: `Lead with the ad spend gap for ${bizName}.`,
      chris: `Website conversion gap angle for ${bizName}.`,
      maddie: `After-hours call handling for ${bizName}.`,
      sarah: `Database reactivation opportunity for ${bizName}.`,
      james: `Reputation leverage for ${bizName}.`,
      trent: `Full tech integration for ${bizName}.`,
      agent8: `Flex specialist \u2014 biggest remaining gap for ${bizName}.`
    },
    close_strategies: {
      price_objection: `One recovered lead at $${acv} AUD covers the cost \u2014 we're done.`,
      timing_objection: bleed > 0 ? `You're losing $${Math.round(bleed / 7)} AUD today alone.` : `Every unanswered lead calls the competitor next.`,
      not_interested_objection: bleed > 0 ? `$${bleed}/week. Every week.` : `One lead/day \xD7 $${acv} = done.`
    }
  };
}
__name(fallbackLanguage, "fallbackLanguage");
function ensureAllAgents(snippets, ranking, bizName) {
  const defaults = {
    bella: `Warm open, reference the biggest signal, route to ${ranking[0] || "Alex"}.`,
    alex: `Ad/speed-to-lead gap for ${bizName}.`,
    chris: `Website concierge gap for ${bizName}.`,
    maddie: `After-hours call handling for ${bizName}.`,
    sarah: `Database reactivation for ${bizName}.`,
    james: `Reputation leverage for ${bizName}.`,
    trent: `Tech integration opportunity for ${bizName}.`,
    agent8: `Flex specialist for ${bizName}.`
  };
  const out = { ...snippets || {} };
  for (const [k, v] of Object.entries(defaults)) {
    if (!out[k]) out[k] = v;
  }
  return out;
}
__name(ensureAllAgents, "ensureAllAgents");
async function handleNormalize(request, env) {
  const url = new URL(request.url);
  const lid = url.pathname.replace(/^\/normalize\//, "").trim();
  if (!lid) return jsonResponse({ error: "Missing lid in URL path" }, 400);
  const existingIntel = await env.LEADS_KV.get(`lead:${lid}:intel`);
  if (existingIntel) {
    console.log(`\u26A1 /normalize/${lid}: intel already exists, skipping`);
    try {
      return jsonResponse({ success: true, cached: true, lid, intel: JSON.parse(existingIntel) });
    } catch {
      return jsonResponse({ success: true, cached: true, lid });
    }
  }
  let raw = null;
  const POLL_RAW_INTERVAL = 1e3;
  const MAX_RAW_POLLS = 8;
  for (let i = 0; i < MAX_RAW_POLLS; i++) {
    const rawPrimary = await env.LEADS_KV.get(`lead:${lid}`);
    if (rawPrimary) {
      try {
        raw = JSON.parse(rawPrimary);
        break;
      } catch {
        raw = null;
      }
    }
    const rawFallback = await env.LEADS_KV.get(`lead:${lid}:raw`);
    if (rawFallback) {
      try {
        raw = JSON.parse(rawFallback);
        break;
      } catch {
        raw = null;
      }
    }
    if (i < MAX_RAW_POLLS - 1) {
      console.log(`\u23F3 /normalize/${lid}: Waiting for raw data (Attempt ${i + 1}/${MAX_RAW_POLLS})`);
      await new Promise((r) => setTimeout(r, POLL_RAW_INTERVAL));
    }
  }
  if (!raw) {
    console.error(`/normalize/${lid}: no raw data found in lead:${lid} or lead:${lid}:raw after ${MAX_RAW_POLLS}s timeout`);
    return jsonResponse({
      success: true,
      lid,
      cached: false,
      intel: {
        agent_ranking: ["hot", "chris", "alex", "maddie", "sarah", "james"],
        bella_opener: `G'day! I've been reviewing your business performance and found some massive missed opportunities.`,
        pipeline_complete: true,
        flags: {
          is_running_ads: false,
          speed_to_lead_needed: true,
          website_concierge_needed: false,
          call_handling_needed: false,
          database_reactivation: false,
          lead_capture_needed: false,
          crm_missing: true,
          email_marketing_missing: true,
          call_tracking_missing: true,
          benchmark_available: false,
          outscraper_fired: false
        },
        critical_fixes: {},
        prioritized_fixes: {}
      }
    }, 200);
  }
  console.log(`\u2696\uFE0F  Supreme Court /normalize: ${lid}`);
  const { ranking, scores } = scoreAgents(raw);
  const preFilled = buildPreFilled(raw);
  const missing = buildMissing(raw, preFilled);
  const grade = gradeData(raw);
  const { bizName, rating, reviewCount } = extract(raw);
  const ib = raw.industry_benchmark || null;
  const cf = raw.critical_fixes || {};
  const pf = raw.prioritized_fixes || {};
  const mi = raw.marketing_intelligence || {};
  const sr = mi.scraperResults || {};
  const ctx = buildLeanContext(raw);
  let lang;
  try {
    const prompt = buildGeminiPrompt(ctx, ranking);
    lang = await callGemini(env.GEMINI_API_KEY, prompt, 8192, 0.25);
  } catch (e) {
    console.error(`/normalize/${lid} Gemini failed, using fallback:`, e.message);
    lang = fallbackLanguage(ctx, ranking, bizName);
  }
  const intel = {
    lid,
    timestamp: Date.now(),
    country: COUNTRY,
    currency: CURRENCY,
    validation_grade: grade,
    core_identity: {
      business_name: bizName,
      industry: raw.industry || ib?.industry_key || "unknown",
      industry_key: ib?.industry_key || null,
      model: raw.business_model || "B2C",
      location: raw.location || "Australia",
      phone: raw.phone || null,
      email: raw.email || null,
      business_hours: raw.business_hours || null,
      sales_term: raw.sales_call_terminology || "appointments",
      tagline: raw.tagline || raw.lp_tagline || null
    },
    industry_benchmark: ib,
    agent_ranking: ranking,
    agent_scores: scores,
    top_fix: {
      id: pf.topFixes?.[0]?.id || null,
      agent: pf.topFixes?.[0]?.agent || ranking[0],
      monthly_revenue: pf.topFixes?.[0]?.monthlyRevenue || null,
      total_monthly_opportunity: pf.totalMonthlyOpportunity || null,
      headline: pf.topFixes?.[0]?.copyHeadline || null
    },
    website_health: {
      google_rating: rating,
      review_count: reviewCount,
      landing_page_score: cf.landingPageScore || 0,
      has_chat: cf.hasChatWidget || false,
      has_booking: cf.hasBookingSystem || false,
      has_crm: cf.hasCRM || false,
      tech_grade: (mi.techStackIntelligence || {}).grade || null,
      overall_grade: cf.grades?.overall?.grade || null
    },
    flags: {
      is_running_ads: cf.isRunningAds || false,
      speed_to_lead_needed: cf.needsSpeedToLead || false,
      website_concierge_needed: cf.needsWebsiteConcierge || false,
      call_handling_needed: cf.needsCallHandling || false,
      database_reactivation: cf.needsDatabaseReactivation || false,
      lead_capture_needed: cf.needsLeadCapture || false,
      crm_missing: !cf.hasCRM,
      email_marketing_missing: !cf.hasEmailMarketing,
      call_tracking_missing: !cf.hasCallTracking,
      benchmark_available: !!ib?.acv,
      outscraper_fired: (sr.outscraper_trigger_conditions || []).length > 0
    },
    critical_fixes: cf,
    prioritized_fixes: pf,
    pre_filled: preFilled,
    missing,
    bella_opener: lang.bella_opener || `G'day! Done some research on ${bizName} \u2014 got 60 seconds?`,
    pitch_hook: lang.pitch_hook || "Lead leakage detected.",
    roi_narrative: lang.roi_narrative || null,
    agent_snippets: ensureAllAgents(lang.agent_snippets, ranking, bizName),
    close_strategies: lang.close_strategies || {}
  };
  const TTL = { expirationTtl: 2592e3 };
  await Promise.all([
    env.LEADS_KV.put(`lead:${lid}:intel`, JSON.stringify(intel), TTL),
    env.LEADS_KV.put(`lead:${lid}:locale`, JSON.stringify(LOCALE), TTL),
    setStatus(env, lid, { stage: "supreme_complete", supreme_court_complete: true }, TTL)
  ]);
  console.log(`\u2705 /normalize done: ${lid} | Grade:${grade} | Top:${ranking[0]} | biz="${bizName}" | reviews=${reviewCount} | rating=${rating}`);
  return jsonResponse({ success: true, lid, business_name: bizName, grade, top_agent: ranking[0], intel });
}
__name(handleNormalize, "handleNormalize");
async function handleValidate(request, env) {
  const body = await request.json();
  const { lid, raw_data: bodyRaw } = body;
  if (!lid) return jsonResponse({ error: "Missing lid" }, 400);
  let raw = bodyRaw || null;
  if (!raw) {
    const kv = await env.LEADS_KV.get(`lead:${lid}:raw`);
    if (kv) raw = JSON.parse(kv);
  }
  if (!raw) return jsonResponse({ error: "No raw data. Run scraper first." }, 400);
  console.log(`\u2696\uFE0F  Supreme Court: ${lid}`);
  const { ranking, scores } = scoreAgents(raw);
  const preFilled = buildPreFilled(raw);
  const missing = buildMissing(raw, preFilled);
  const grade = gradeData(raw);
  const { bizName, rating, reviewCount } = extract(raw);
  const ib = raw.industry_benchmark || null;
  const cf = raw.critical_fixes || {};
  const pf = raw.prioritized_fixes || {};
  const mi = raw.marketing_intelligence || {};
  const sr = mi.scraperResults || {};
  const ctx = buildLeanContext(raw);
  let lang;
  try {
    const prompt = buildGeminiPrompt(ctx, ranking);
    lang = await callGemini(env.GEMINI_API_KEY, prompt, 8192, 0.25);
  } catch (e) {
    console.error("Gemini failed, using fallback:", e.message);
    lang = fallbackLanguage(ctx, ranking, bizName);
  }
  const intel = {
    lid,
    timestamp: Date.now(),
    country: COUNTRY,
    currency: CURRENCY,
    validation_grade: grade,
    core_identity: {
      business_name: bizName,
      industry: raw.industry || ib?.industry_key || "unknown",
      industry_key: ib?.industry_key || null,
      model: raw.business_model || "B2C",
      location: raw.location || "Australia",
      phone: raw.phone || null,
      email: raw.email || null,
      business_hours: raw.business_hours || null,
      sales_term: raw.sales_call_terminology || "appointments",
      tagline: raw.tagline || raw.lp_tagline || null
    },
    // Scraper benchmark — no mutation
    industry_benchmark: ib,
    // Scoring
    agent_ranking: ranking,
    agent_scores: scores,
    // Top fix
    top_fix: {
      id: pf.topFixes?.[0]?.id || null,
      agent: pf.topFixes?.[0]?.agent || ranking[0],
      monthly_revenue: pf.topFixes?.[0]?.monthlyRevenue || null,
      total_monthly_opportunity: pf.totalMonthlyOpportunity || null,
      headline: pf.topFixes?.[0]?.copyHeadline || null
    },
    // Website health
    website_health: {
      google_rating: rating,
      review_count: reviewCount,
      landing_page_score: cf.landingPageScore || 0,
      has_chat: cf.hasChatWidget || false,
      has_booking: cf.hasBookingSystem || false,
      has_crm: cf.hasCRM || false,
      tech_grade: (mi.techStackIntelligence || {}).grade || null,
      overall_grade: cf.grades?.overall?.grade || null
    },
    // Flags
    flags: {
      is_running_ads: cf.isRunningAds || false,
      speed_to_lead_needed: cf.needsSpeedToLead || false,
      website_concierge_needed: cf.needsWebsiteConcierge || false,
      call_handling_needed: cf.needsCallHandling || false,
      database_reactivation: cf.needsDatabaseReactivation || false,
      lead_capture_needed: cf.needsLeadCapture || false,
      crm_missing: !cf.hasCRM,
      email_marketing_missing: !cf.hasEmailMarketing,
      call_tracking_missing: !cf.hasCallTracking,
      benchmark_available: !!ib?.acv,
      outscraper_fired: (sr.outscraper_trigger_conditions || []).length > 0
    },
    // Per-agent
    pre_filled: preFilled,
    missing,
    // Language (Gemini or fallback)
    bella_opener: lang.bella_opener || `G'day! Done some research on ${bizName} \u2014 got 60 seconds?`,
    pitch_hook: lang.pitch_hook || "Lead leakage detected.",
    roi_narrative: lang.roi_narrative || null,
    agent_snippets: ensureAllAgents(lang.agent_snippets, ranking, bizName),
    close_strategies: lang.close_strategies || {}
  };
  const TTL = { expirationTtl: 2592e3 };
  await Promise.all([
    env.LEADS_KV.put(`lead:${lid}:intel`, JSON.stringify(intel), TTL),
    env.LEADS_KV.put(`lead:${lid}:locale`, JSON.stringify(LOCALE), TTL),
    setStatus(env, lid, { stage: "supreme_complete", supreme_court_complete: true }, TTL)
  ]);
  console.log(`\u2705 Done: ${lid} | Grade:${grade} | Top:${ranking[0]} | Opp:$${pf.totalMonthlyOpportunity || "?"}`);
  return jsonResponse(intel);
}
__name(handleValidate, "handleValidate");
async function handleSteer(request, env) {
  const { lid, agent_name, objection, stage, context } = await request.json();
  if (!lid || !agent_name || !objection)
    return jsonResponse({ error: "Missing: lid, agent_name, objection" }, 400);
  const intelRaw = await env.LEADS_KV.get(`lead:${lid}:intel`);
  const intel = intelRaw ? JSON.parse(intelRaw) : {};
  const agentPF = intel.pre_filled?.[agent_name] || {};
  const ib = intel.industry_benchmark || {};
  const cs = intel.close_strategies || {};
  const prompt = `Pillar+Post AI \u2013 Supreme Court steering. Australia, AUD, Australian English. Max 3 sentences.
BUSINESS: ${intel.core_identity?.business_name || "unknown"}
AGENT: ${agent_name}
ACV: $${ib.acv || "?"} AUD
KEY DATA: ${JSON.stringify(agentPF)}
CLOSE STRATEGIES: ${JSON.stringify(cs)}
OBJECTION: "${objection}"
STAGE: ${stage || "discovery"}

Use real numbers. Output ONLY: {"close_script":"..."}`;
  const result = await callGemini(env.GEMINI_API_KEY, prompt, 400, 0.4);
  return jsonResponse({
    agent: agent_name,
    close_script: result.close_script || "Let me pull up your specific numbers.",
    country: COUNTRY,
    currency: CURRENCY
  });
}
__name(handleSteer, "handleSteer");
async function setStatus(env, lid, updates, ttl) {
  try {
    const ex = await env.LEADS_KV.get(`status:${lid}`);
    const cur = ex ? JSON.parse(ex) : { lid };
    await env.LEADS_KV.put(`status:${lid}`, JSON.stringify({ ...cur, ...updates, updated_at: (/* @__PURE__ */ new Date()).toISOString() }), ttl);
  } catch {
  }
}
__name(setStatus, "setStatus");
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map
