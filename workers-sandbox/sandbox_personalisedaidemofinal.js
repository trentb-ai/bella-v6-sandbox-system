// ============================================================
// V3 CHUNK 1 STUB — FastContext + Single KV Write
// Purpose: Provides the shape contract for the V3 scraper refactor.
//          This stub is safe and does NOT affect any existing V2 routes below.
//          Remove this block entirely when C3 (Scraper Fast Track) is complete.
// ============================================================

/**
 * sanitizedInt — safely converts messy string numbers to integers.
 * Canonical version lives in schemas.ts; mirrored here for plain-JS workers.
 */
function sanitizedInt(value) {
  if (typeof value === "number") return Math.round(value);
  if (!value) return 0;
  const str = String(value).toLowerCase().trim();
  if (str.endsWith("k")) {
    const num = parseFloat(str.replace("k", ""));
    return isNaN(num) ? 0 : Math.round(num * 1000);
  }
  const cleaned = str.replace(/[^0-9.]/g, "");
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : Math.round(num);
}

// ============================================================
// V3 UTILITY: Recursive Deep Merge
// Purpose: Protects nested data (e.g. intel.deep) from being
//          wiped by shallow spreads during concurrent writes.
//          Arrays and primitives are overwritten; plain objects
//          are recursively merged.
// ============================================================
function deepMergeV3(target, source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return source;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (
      srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
      tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
    ) {
      result[key] = deepMergeV3(tgtVal, srcVal);
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

/**
 * buildFastContextStub — returns a safe default FastContext payload.
 * C3 will replace this with real HTMLRewriter + Proxycurl data.
 */
function buildFastContextStub(lid, targetUrl) {
  return {
    v: 1,
    lid,
    ts: new Date().toISOString(),
    business: { name: "", domain: targetUrl ?? "", location: "", rating: 0, review_count: 0, logo_url: "" },
    hero: { v: 1, url: targetUrl ?? "", h1: "", h2: "", title: "", meta_description: "", og_title: "", og_description: "" },
    person: { first_name: "", job_title: "Unknown Role", tenure: "", source: "stub" },
    ads: { is_running_ads: false, estimated_monthly_spend_aud: 0 },
    numbers: { one_real_number_for_opener: 0 },
  };
}

/**
 * buildNormalizedIntelStub — wraps FastContext in the full NormalizedIntel shape.
 * C5 will inject real deterministic SC scoring here.
 */
function buildNormalizedIntelStub(lid, targetUrl) {
  const fast_context = buildFastContextStub(lid, targetUrl);
  return {
    v: 1,
    lid,
    grade: "C",
    agent_ranking: ["chris", "alex", "maddie", "sarah", "james"],
    top_fixes: [],
    bella_opener: "",
    memory_prefill: { crm_detected: false, runs_ads: false, country: "AU", currency: "AUD" },
    computed_numbers: { estimated_weekly_bleed_aud: 0, confidence: "low" },
    fast_context,
  };
}

/** KV TTL — 30 days */
const KV_TTL_SECONDS = 2592000;

// ============================================================
// END V3 CHUNK 1 STUB
// ============================================================

// ============================================================
// V3 CHUNK 4: DEEP TRACK ENGINE (Option B — Capture Page Kickoff)
// Purpose: runDeepScrapeAsync() is called via ctx.waitUntil() from /log-lead.
//          It runs Apify actors in parallel, then does a safe additive merge
//          into lead:${lid}:intel under intel.deep.* only.
//          A raw backup is also written to lead:${lid}:deepIntel.
// ============================================================

/**
 * runApifyActorV3 — top-level Apify actor runner (mirrors the scoped one at ~L890).
 * Returns the parsed dataset items array, or null on any failure.
 * Polls up to 12 times at 3s intervals (~36s max wait per actor).
 */
async function runApifyActorV3(apiKey, actorId, input) {
  if (!apiKey) return null;
  try {
    const runResp = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!runResp.ok) return null;
    const runData = await runResp.json();
    const runId = runData?.data?.id;
    if (!runId) return null;
    for (let i = 0; i < 9; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const statusResp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiKey}`);
      if (!statusResp.ok) break;
      const statusData = await statusResp.json();
      const status = statusData?.data?.status;
      if (status === "SUCCEEDED") {
        const datasetId = statusData?.data?.defaultDatasetId;
        if (!datasetId) return null;
        const dataResp = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}&limit=10`);
        if (!dataResp.ok) return null;
        return await dataResp.json();
      }
      if (status === "FAILED" || status === "ABORTED") return null;
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * runDeepScrapeAsync — the Deep Track background worker.
 * Called via ctx.waitUntil() from /log-lead. Never blocks the response.
 *
 * Flow:
 *  1. Write a "processing" marker to KV (additive merge)
 *  2. Run 4 Apify actors in parallel (FB Ads, Google Ads, Indeed, LinkedIn)
 *  3. Build a compact deep summary
 *  4. Write raw results to lead:${lid}:deepIntel (belt-and-braces)
 *  5. Additive merge into lead:${lid}:intel under intel.deep only
 */
async function runDeepScrapeAsync(env, lid, websiteUrl, businessName) {
  const t0 = Date.now();
  const key = `lead:${lid}:intel`;
  const apiKey = env.APIFY_API_KEY;
  const sources = [];

  try {
    // ── 0. Guard: skip if already done ─────────────────────────────────────
    const guardRaw = await env.LEADS_KV.get(key);
    if (guardRaw) {
      try {
        const guardData = JSON.parse(guardRaw);
        if (guardData?.intel?.deep?.status === "done") {
          console.log(`[V3 Deep Track] Skipped — already done for lid: ${lid}`);
          return;
        }
      } catch (_) { /* continue if parse fails */ }
    }

    // ── 1. Write "processing" marker ───────────────────────────────────────
    console.log(`[V3 Deep Track] Starting for lid: ${lid}, url: ${websiteUrl}`);
    const existingRaw1 = await env.LEADS_KV.get(key);
    let envelope = existingRaw1 ? JSON.parse(existingRaw1) : { v: 1, lid, ts: new Date().toISOString(), fast_context: {}, intel: {} };
    envelope.intel = envelope.intel || {};
    envelope.intel.deep = {
      status: "processing",
      ts_start: new Date().toISOString(),
      websiteUrl,
    };
    await env.LEADS_KV.put(key, JSON.stringify(envelope), { expirationTtl: KV_TTL_SECONDS });

    // ── 2. Derive domain + company name ────────────────────────────────────
    let domain = "";
    try { domain = new URL(websiteUrl).hostname.replace("www.", ""); } catch (_) { }
    const companyName = businessName || domain.split(".")[0] || "";
    const companySlug = companyName.toLowerCase().replace(/\s+/g, "-");

    // ── 3. Run Apify actors in parallel ────────────────────────────────────
    const t1_apify = Date.now();

    // V3: FB + Google ads REMOVED from Deep Track — Phase B handles ads to avoid double Apify spend
    const fbPromise = Promise.resolve(null);
    const googleAdsPromise = Promise.resolve(null);

    // Fix 8: Indeed switched to async via runApifyActorV3
    const indeedPromise = runApifyActorV3(apiKey, "misceres~indeed-scraper", {
      queries: `"${companyName}" (sales OR SDR OR "business development" OR marketing OR growth OR "office manager" OR receptionist OR "customer service")`,
      country: "AU", maxItems: 5, proxy: { useApifyProxy: true },
    });

    // Fix 8: LinkedIn switched to async via runApifyActorV3
    const linkedInPromise = companySlug.length > 2
      ? runApifyActorV3(apiKey, "anchor~linkedin-company-scraper", {
        searchUrls: [`https://www.linkedin.com/company/${companySlug}`],
        proxy: { useApifyProxy: true },
      })
      : Promise.resolve(null);

    // Fix 9: Updated actor ID to compass/Google-Maps-Reviews-Scraper
    const googleMapsPromise = runApifyActorV3(apiKey, "compass/Google-Maps-Reviews-Scraper", {
      searchStringsArray: [companyName + " " + domain],
      maxCrawledPlacesPerSearch: 1,
      language: "en",
      maxReviews: 10,
    });

    // Fix 9: Added missing contact-info-scraper actor
    const contactInfoPromise = runApifyActorV3(apiKey, "vdrmota/contact-info-scraper", {
      startUrls: [{ url: websiteUrl }],
      maxRequestsPerStartUrl: 3,
    });

    const [fbItems, googleAdsItems, indeedItems, linkedInItems, googleMapsItems, contactInfoItems] = await Promise.all([
      fbPromise, googleAdsPromise, indeedPromise, linkedInPromise, googleMapsPromise, contactInfoPromise,
    ]);

    const apifyDuration = Date.now() - t1_apify;

    // ── 4. Build compact deep summary ──────────────────────────────────────
    // 4a. Facebook Ads
    let adsSummary = { fb: null, google: null };
    if (fbItems && fbItems.length > 0) {
      const ctas = [...new Set(fbItems.map((a) => a.callToActionType || a.cta_type || "").filter(Boolean).map((c) => c.replace(/_/g, " ").toLowerCase()))];
      const creatives = fbItems.slice(0, 3).map((a) => a.bodyText || a.caption || a.body || "").filter((c) => c.length > 10);
      adsSummary.fb = { running: true, count: fbItems.length, ctas, creatives_sample: creatives };
      sources.push({ source: "fb_ads", ok: true, latency_ms: apifyDuration });
    } else {
      adsSummary.fb = { running: false, count: 0 };
      sources.push({ source: "fb_ads", ok: true, latency_ms: apifyDuration, note: "no_ads_found" });
    }

    // 4b. Google Ads
    if (googleAdsItems && googleAdsItems.length > 0) {
      const headlines = googleAdsItems.slice(0, 5).map((a) => a.headline || a.title || "").filter(Boolean);
      adsSummary.google = { running: true, count: googleAdsItems.length, headlines_sample: headlines };
      sources.push({ source: "google_ads", ok: true, latency_ms: apifyDuration });
    } else {
      adsSummary.google = { running: false, count: 0 };
      sources.push({ source: "google_ads", ok: true, latency_ms: apifyDuration, note: "no_ads_found" });
    }

    // 4c. Hiring signals (Indeed)
    let hiringSummary = { is_hiring: false, roles: [] };
    if (indeedItems && indeedItems.length > 0) {
      const relevant = indeedItems.filter((job) => {
        const t = (job.title || "").toLowerCase();
        return t.includes("receptionist") || t.includes("admin") || t.includes("customer service") || t.includes("office manager") || t.includes("sales") || t.includes("business development") || t.includes("sdr") || t.includes("marketing") || t.includes("growth");
      });
      hiringSummary = {
        is_hiring: relevant.length > 0,
        roles: relevant.slice(0, 3).map((j) => ({ title: j.title, salary: j.salary || null, source: "Indeed" })),
      };
      sources.push({ source: "indeed", ok: true, latency_ms: apifyDuration });
    } else {
      sources.push({ source: "indeed", ok: true, latency_ms: apifyDuration, note: "no_results" });
    }

    // 4d. LinkedIn company
    let linkedInSummary = null;
    if (linkedInItems && linkedInItems[0]) {
      const li = linkedInItems[0];
      linkedInSummary = {
        employeeCount: li.employeeCount || null,
        industry: li.industry || null,
        headquarters: li.headquarters || null,
        founded: li.founded || null,
        specialties: li.specialties || null,
      };
      sources.push({ source: "linkedin", ok: true, latency_ms: apifyDuration });
    } else {
      sources.push({ source: "linkedin", ok: true, latency_ms: apifyDuration, note: "not_found" });
    }

    // 4e. Google Maps / Places (G1)
    let googleMapsSummary = null;
    if (googleMapsItems && googleMapsItems[0]) {
      const place = googleMapsItems[0];
      googleMapsSummary = {
        name: place.title || place.name || "",
        rating: sanitizedInt(place.totalScore || place.rating || 0),
        review_count: sanitizedInt(place.reviewsCount || place.reviews || 0),
        address: place.address || "",
        categories: place.categories || [],
        reviews_sample: (place.reviews || []).slice(0, 5).map(r => ({
          text: (r.text || "").substring(0, 200),
          stars: r.stars || 0,
          author: r.name || "Anonymous",
        })),
      };
      sources.push({ source: "google_maps", ok: true, latency_ms: apifyDuration });
    } else {
      sources.push({ source: "google_maps", ok: true, latency_ms: apifyDuration, note: "not_found" });
    }

    // 4f. Contact Info (Fix 9)
    let contactInfoSummary = null;
    if (contactInfoItems && contactInfoItems[0]) {
      const ci = contactInfoItems[0];
      contactInfoSummary = {
        emails: ci.emails || [],
        phones: ci.phones || [],
        socials: ci.socials || {},
        source: "contact-info-scraper",
      };
      sources.push({ source: "contact_info", ok: true, latency_ms: apifyDuration });
    } else {
      sources.push({ source: "contact_info", ok: true, latency_ms: apifyDuration, note: "not_found" });
    }

    // ── 5. Write raw backup to lead:${lid}:deepIntel ───────────────────────
    const rawPayload = {
      v: 1, lid, ts: new Date().toISOString(),
      fb_ads_raw: fbItems || [],
      google_ads_raw: googleAdsItems || [],
      indeed_raw: indeedItems || [],
      linkedin_raw: linkedInItems || [],
      google_maps_raw: googleMapsItems || [],
      contact_info_raw: contactInfoItems || [],
    };
    await env.LEADS_KV.put(`lead:${lid}:deepIntel`, JSON.stringify(rawPayload), { expirationTtl: KV_TTL_SECONDS });

    // ── 6. Safe additive merge into lead:${lid}:intel ──────────────────────
    const existingRaw2 = await env.LEADS_KV.get(key);
    let finalEnvelope = existingRaw2 ? JSON.parse(existingRaw2) : { v: 1, lid, ts: new Date().toISOString(), fast_context: {}, intel: {} };
    finalEnvelope.intel = finalEnvelope.intel || {};
    finalEnvelope.intel.deep = {
      status: "done",
      ts_start: envelope.intel.deep.ts_start,
      ts_done: new Date().toISOString(),
      duration_ms: Date.now() - t0,
      sources,
      ads: adsSummary,
      hiring: hiringSummary,
      linkedin: linkedInSummary,
      googleMaps: googleMapsSummary,
      contactInfo: contactInfoSummary,
    };
    await env.LEADS_KV.put(key, JSON.stringify(finalEnvelope), { expirationTtl: KV_TTL_SECONDS });

    console.log("[V3 Deep Track] Complete:", JSON.stringify({
      lid, duration_ms: Date.now() - t0,
      fb_ads: adsSummary.fb?.count || 0,
      google_ads: adsSummary.google?.count || 0,
      hiring_roles: hiringSummary.roles.length,
      linkedin: !!linkedInSummary,
      google_maps: !!googleMapsSummary,
      google_maps_rating: googleMapsSummary?.rating || 0,
      contact_info: !!contactInfoSummary,
    }));

  } catch (err) {
    // ── Error path: mark as error, preserve Fast Track ──────────────────
    console.error(`[V3 Deep Track] Error for lid ${lid}:`, err.message);
    try {
      const existingRawErr = await env.LEADS_KV.get(key);
      let errEnvelope = existingRawErr ? JSON.parse(existingRawErr) : { v: 1, lid, ts: new Date().toISOString(), fast_context: {}, intel: {} };
      errEnvelope.intel = errEnvelope.intel || {};
      errEnvelope.intel.deep = {
        status: "error",
        ts_start: new Date().toISOString(),
        ts_done: new Date().toISOString(),
        duration_ms: Date.now() - t0,
        error: err.message,
        sources,
      };
      await env.LEADS_KV.put(key, JSON.stringify(errEnvelope), { expirationTtl: KV_TTL_SECONDS });
    } catch (kvErr) {
      console.error(`[V3 Deep Track] KV error-write failed for lid ${lid}:`, kvErr.message);
    }
  }
}

// ============================================================
// END V3 CHUNK 4: DEEP TRACK ENGINE
// ============================================================

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });


// worker.js
var worker_default = {
  async fetch(request, env, ctx) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
      "Access-Control-Allow-Headers": "*",
      "Content-Type": "application/json"
    };
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }
    try {
      let generateLeadId = function () {
        return "lid_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
      };
      __name(generateLeadId, "generateLeadId");
      const url = new URL(request.url);
      if (url.pathname === "/gemini") {
        const body2 = await request.json();
        const { message, leadId, agentId } = body2;
        let leadData = {};
        if (leadId) {
          const kvLead = await env.LEADS_KV.get(leadId);
          if (kvLead) leadData = JSON.parse(kvLead);
        }
        const apiKey = env.GEMINI_API_KEY;
        const geminiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: body2.contents,
            system_instruction: { parts: [{ text: body2.system_instruction }] },
            generationConfig: body2.generationConfig || {
              temperature: 0.7,
              maxOutputTokens: 1024
            }
          })
        });
        const data = await geminiResponse.json();
        return new Response(JSON.stringify(data), { headers: corsHeaders });
      }
      async function queryFlowiseAgent(agentId, userMessage, leadData, env2) {
        const FLOWISE_IDS = {
          "bella": env2.FLOWISE_ID_BELLA || "PLACEHOLDER_ID",
          "chris": env2.FLOWISE_ID_CHRIS || "PLACEHOLDER_ID",
          "maddie": env2.FLOWISE_ID_MADDIE || "PLACEHOLDER_ID",
          "alex": env2.FLOWISE_ID_ALEX || "PLACEHOLDER_ID",
          "james": env2.FLOWISE_ID_JAMES || "PLACEHOLDER_ID",
          "sarah": env2.FLOWISE_ID_SARAH || "PLACEHOLDER_ID",
          "trent": env2.FLOWISE_ID_TRENT || "PLACEHOLDER_ID"
        };
        const flowId = FLOWISE_IDS[agentId?.toLowerCase()] || FLOWISE_IDS["bella"];
        const baseUrl = env2.FLOWISE_API_URL || "https://your-flowise.railway.app";
        const customVars = {};
        const safeData = leadData.scraped || leadData.customFields || {};
        const fields = [
          "business_name",
          "industry",
          "location",
          "services",
          "google_rating",
          "review_count",
          "recent_reviews",
          "running_ads",
          "ad_platforms",
          "has_live_chat",
          "has_crm",
          "hiring_signals",
          "website_speed",
          "social_links",
          "tech_stack"
          // Add all other specific fields here as needed
        ];
        fields.forEach((f) => {
          if (safeData[f]) customVars[f] = safeData[f];
        });
        const response = await fetch(`${baseUrl}/api/v1/prediction/${flowId}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: userMessage,
            overrideConfig: {
              vars: customVars
            }
          })
        });
        if (!response.ok) throw new Error(`Flowise API Error: ${response.statusText}`);
        const json = await response.json();
        return json.text;
      }
      __name(queryFlowiseAgent, "queryFlowiseAgent");
      // Fix 2: body declared in outer scope so /log-lead can populate before V2 sync path
      let body = null;
      if (url.pathname === "/log-lead" && request.method === "POST") {
        const body2 = await request.json();

        // Input validation
        const websiteUrlRaw = body2.websiteUrl || body2.website_url || body2.website || "";
        const firstNameRaw = body2.firstName || body2.first_name || "";
        // Normalise: title-case (handles ALL-CAPS entries like "TRENT")
        const firstNameVal = firstNameRaw.trim()
          ? firstNameRaw.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
          : firstNameRaw;
        if (!websiteUrlRaw || !websiteUrlRaw.trim()) {
          return new Response(JSON.stringify({ success: false, error: "Missing required field: websiteUrl" }), { status: 400, headers: corsHeaders });
        }
        if (!firstNameVal || !firstNameVal.trim()) {
          return new Response(JSON.stringify({ success: false, error: "Missing required field: firstName" }), { status: 400, headers: corsHeaders });
        }

        const leadId = body2.lid || generateLeadId();
        let websiteUrlNorm = websiteUrlRaw.trim();
        if (websiteUrlNorm && !websiteUrlNorm.startsWith("http")) {
          websiteUrlNorm = "https://" + websiteUrlNorm;
        }
        const locationVal = body2.location || body2.city || "";
        const ts = new Date().toISOString();

        // Build minimal stub — enough for the frontend to proceed immediately
        let domain = "";
        try { domain = new URL(websiteUrlNorm).hostname.replace("www.", ""); } catch (_) {}
        const stub = {
          v: 1, lid: leadId, ts,
          // Root-level fields for MCP worker compatibility (rawBare.firstName etc.)
          firstName: firstNameVal,
          first_name: firstNameVal,
          websiteUrl: websiteUrlNorm,
          business_name: domain,
          fast_context: {
            v: 1, lid: leadId, ts,
            business: { name: domain, domain, location: "", rating: 0, review_count: 0, logo_url: "" },
            hero: { v: 1, url: websiteUrlNorm, h1: "", h2: "", h3: "", title: "", meta_description: "", og_title: "", og_description: "" },
            person: { first_name: firstNameVal, job_title: "Unknown Role", tenure: "", source: "stub" },
            ads: { is_running_ads: false, estimated_monthly_spend_aud: 0, facebook_ads_running: false, google_ads_running: false },
            numbers: { one_real_number_for_opener: 0 },
            normalized_name: domain, target_audience: "", business_description: "",
            benefits: [], pain_points: [], usps: [], services: [], pricing_info: "",
            confidence_score: 0, critical_fixes: [], marketing_intelligence: { overallGrade: "pending" }
          },
          intel: {
            grade: "D", top_fixes: [],
            memory_prefill: { country: "AU", currency: "AUD", runs_ads: false, crm_detected: false },
            bella_opener: "Hi " + firstNameVal + "! I was just looking at your site — looking forward to chatting about " + domain + ".",
            phaseA: {
              success: true, scrapeStatus: "pending", business_name: domain,
              firstName: firstNameVal, lid: leadId, url: websiteUrlNorm,
              deepScrapeStatus: "processing",
              marketing_intelligence: {
                overallGrade: "pending",
                grades: {
                  speedToLead: { grade: "—", score: null },
                  reputation: { grade: "—", score: null },
                  websiteConversion: { grade: "—", score: null },
                  techStack: { grade: "—", score: null },
                  adEfficiency: { grade: "—", score: null },
                  overall: { grade: "—", score: null }
                },
                adIntelligence: { isRunningAds: false, verdict: "pending" },
                reputationIntelligence: { googleRating: null, reviewCount: null },
                techStackIntelligence: { score: null, level: "pending", missing: [] },
                reviewMining: {
                  agentNeedIndicators: { alex: [], maddie: [], chris: [], sarah: [], james: [] },
                  summary: { alex: 0, maddie: 0, chris: 0, sarah: 0, james: 0 }
                },
                landingPageScore: null, socialMedia: {}, scraperResults: { tier: "pending" }
              }
            },
            deep: { status: "processing" }
          }
        };

        // Write stub to both KV keys — awaited with explicit error logging
        const stubStr = JSON.stringify(stub);
        try {
          console.log(`[/log-lead] Writing KV for lid=${leadId}, KV binding exists=${!!env.LEADS_KV}`);
          await env.LEADS_KV.put(leadId, stubStr, { expirationTtl: 2592000 });
          console.log(`[/log-lead] KV bare lid write OK: ${leadId}`);
          await env.LEADS_KV.put(`lead:${leadId}:intel`, stubStr, { expirationTtl: 2592000 });
          console.log(`[/log-lead] KV intel write OK: lead:${leadId}:intel`);
        } catch (kvErr) {
          console.error(`[/log-lead] KV WRITE FAILED for lid=${leadId}: ${kvErr.message || kvErr}`);
        }
        // Kick off full async scrape in background — writes enriched data back to KV when done
        // Deep scrape now runs in deep-scrape-workflow-sandbox (Cloudflare Workflow)
        // This replaces ctx.waitUntil(runDeepScrapeAsync) which was silently killed at 30s
        ctx.waitUntil(
          fetch('https://deep-scrape-workflow-sandbox.trentbelasco.workers.dev/trigger', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lid: leadId, websiteUrl: websiteUrlNorm, businessName: domain }),
          }).then(r => r.json()).then(d => {
            console.log(`[/log-lead] Deep scrape workflow triggered lid=${leadId}`, d);
          }).catch(err => {
            console.error(`[/log-lead] Failed to trigger deep scrape workflow lid=${leadId}:`, err.message);
          })
        );

        // Return after KV write confirmed
        // Phase B KV enrichment: direct fetch to target website (NO self-call — proper CF protocol).
        // Extracts clean text blob for Gemini, writes to KV. Mockup proxy (?proxy=) untouched.
        ctx.waitUntil((async () => {
          const t0 = Date.now();
          try {
            console.log(`[Phase B KV] Starting lid=${leadId} url=${websiteUrlNorm}`);
            const UA = [
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
              "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
            ];
            let html = null;
            for (let i = 0; i < 2; i++) {
              try {
                const r = await fetch(websiteUrlNorm, {
                  headers: { "User-Agent": UA[i], "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-AU,en-US;q=0.9,en;q=0.8" }
                });
                if (r.ok && (r.headers.get("content-type") || "").includes("text/html")) { html = await r.text(); break; }
              } catch (_) {}
              if (i < 1) await new Promise(r => setTimeout(r, 300));
            }
            if (!html) { console.error(`[Phase B KV] No HTML for lid=${leadId}`); return; }
            console.log(`[Phase B KV] ${html.length} chars in ${Date.now() - t0}ms`);
            const blob = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 20000);
            const gm = (p) => (html.match(p)?.[1] || '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
            const title = gm(/<title[^>]*>([^<]{1,200})<\/title>/i);
            const h1 = gm(/<h1[^>]*>([^<]{1,200})<\/h1>/i);
            const h2 = gm(/<h2[^>]*>([^<]{1,200})<\/h2>/i);
            const metaDesc = gm(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i) || gm(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i);
            const ogTitle = gm(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i);
            const ogDesc = gm(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,300})["']/i);
            const ogSiteName = gm(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,200})["']/i);
            const bizName = ogSiteName || title.split(/[-|–—:]/)[0].trim() || domain;
            const exRaw = await env.LEADS_KV.get(`lead:${leadId}:intel`);
            const ex = exRaw ? JSON.parse(exRaw) : {};
            const enriched = { ...ex, business_name: bizName || ex.business_name, scrapeStatus: 'phase_a', phase_a_ts: new Date().toISOString(), site_content_blob: blob,
              hero: { ...(ex.hero || {}), h1: h1 || ex.hero?.h1 || '', h2: h2 || ex.hero?.h2 || '', title: title || ex.hero?.title || '', meta_description: metaDesc || ex.hero?.meta_description || '', og_title: ogTitle || ex.hero?.og_title || '', og_description: ogDesc || ex.hero?.og_description || '' },
              core_identity: { ...(ex.core_identity || {}), business_name: bizName || ex.core_identity?.business_name || domain } };
            const s = JSON.stringify(enriched);
            await env.LEADS_KV.put(`lead:${leadId}:intel`, s, { expirationTtl: 2592000 });
            await env.LEADS_KV.put(leadId, s, { expirationTtl: 2592000 });
            console.log(`[Phase B KV] DONE lid=${leadId} biz="${bizName}" h1="${h1}" blob=${blob.length}ch ${Date.now() - t0}ms`);
          } catch (e) { console.error(`[Phase B KV] FAIL lid=${leadId}: ${e.message}`); }
        })());

        return new Response(JSON.stringify(stub), { status: 200, headers: corsHeaders });
      }
      if (url.pathname === "/get-lead") {
        const leadId = url.searchParams.get("lid");
        if (!leadId) {
          return new Response(JSON.stringify({ error: "Missing lid parameter" }), { status: 400, headers: corsHeaders });
        }
        // Fix 4: Cascading KV lookup — prefer rich V3 envelope over bare skeleton
        // Defense 2: Check bare lid FIRST (Phase B writes 110 points here)
        // then fall back to lead:lid:intel (legacy V3 merge key)
        const leadData = await env.LEADS_KV.get(leadId) || await env.LEADS_KV.get(`lead:${leadId}:intel`) || await env.LEADS_KV.get(`lead:${leadId}`);
        if (!leadData) {
          return new Response(JSON.stringify({ error: "Lead not found" }), { status: 404, headers: corsHeaders });
        }
        return new Response(leadData, { headers: corsHeaders });
      }
      if (url.pathname === "/update-lead" && request.method === "POST") {
        const body2 = await request.json();
        const leadId = body2.lid;
        if (!leadId) {
          return new Response(JSON.stringify({ error: "Missing lid" }), { status: 400, headers: corsHeaders });
        }
        // Fix 4: Cascading KV fetch — prefer rich V3 envelope
        // Defense 2: Check bare lid FIRST (Phase B writes 110 points here)
        const existingDataStr = await env.LEADS_KV.get(leadId) || await env.LEADS_KV.get(`lead:${leadId}:intel`) || await env.LEADS_KV.get(`lead:${leadId}`);
        if (!existingDataStr) {
          return new Response(JSON.stringify({ error: "Lead not found" }), { status: 404, headers: corsHeaders });
        }
        const existingData = JSON.parse(existingDataStr);
        const updatedData = deepMergeV3(existingData, body2.updates);
        // Write to BOTH keys to prevent future fragmentation
        const updatedStr = JSON.stringify(updatedData);
        await env.LEADS_KV.put(`lead:${leadId}:intel`, updatedStr, { expirationTtl: KV_TTL_SECONDS });
        await env.LEADS_KV.put(leadId, updatedStr, { expirationTtl: KV_TTL_SECONDS });
        return new Response(JSON.stringify({ success: true, lid: leadId }), { headers: corsHeaders });
      }
      if (url.pathname === "/list-leads") {
        try {
          const keys = await env.LEADS_KV.list({ limit: 50 });
          const leads = await Promise.all(
            keys.keys.map(async (k) => {
              const data = await env.LEADS_KV.get(k.name);
              return data ? JSON.parse(data) : null;
            })
          );
          return new Response(
            JSON.stringify(leads.filter(Boolean)),
            { headers: corsHeaders }
          );
        } catch (err) {
          return new Response(JSON.stringify({ error: "Failed to list leads" }), { status: 500, headers: corsHeaders });
        }
      }
      const proxyTarget = url.searchParams.get("proxy");
      const contactId = url.searchParams.get("contact_id");
      let bodyText = "";
      // Fix 2: If /log-lead already populated `body`, skip re-parsing (request body already consumed)
      if (!body || !body._v3_leadId) {
        body = {};
        if (request.method === "POST") {
          bodyText = await request.text();
          try {
            body = JSON.parse(bodyText);
          } catch (e) {
            body = {};
          }
        }
      }
      if (contactId) {
        const ghlApiKey = url.searchParams.get("api_key") || body.ghl_api_key;
        const locationId = url.searchParams.get("location_id") || body.location_id;
        if (!ghlApiKey) {
          return new Response(JSON.stringify({ success: false, error: "Missing ghl_api_key" }), { status: 200, headers: corsHeaders });
        }
        try {
          const ghlResponse = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}`, {
            headers: {
              "Authorization": `Bearer ${ghlApiKey}`,
              "Version": "2021-07-28",
              "Content-Type": "application/json"
            }
          });
          if (!ghlResponse.ok) {
            return new Response(JSON.stringify({ success: false, error: "Failed to fetch contact from GHL" }), { status: 200, headers: corsHeaders });
          }
          const ghlData = await ghlResponse.json();
          const contact = ghlData.contact || ghlData;
          const customFields = contact.customFields || contact.customField || [];
          const fieldMap = {};
          if (Array.isArray(customFields)) {
            customFields.forEach((cf) => {
              if (cf.id && cf.value !== void 0) {
                fieldMap[cf.id] = cf.value;
              }
              if (cf.key && cf.value !== void 0) {
                fieldMap[cf.key] = cf.value;
              }
            });
          }
          return new Response(JSON.stringify({
            success: true,
            contact_id: contactId,
            email: contact.email,
            phone: contact.phone,
            firstName: contact.firstName,
            lastName: contact.lastName,
            name: contact.name || `${contact.firstName || ""} ${contact.lastName || ""}`.trim(),
            customFields: fieldMap,
            // Convenience mappings for common fields
            business_name: fieldMap.business_name || fieldMap["business_name"] || contact.companyName || "",
            services: fieldMap.services || fieldMap["services"] || "",
            industry: fieldMap.industry || fieldMap["industry"] || "",
            target_audience: fieldMap.target_audience || fieldMap["target_audience"] || "",
            sales_call_terminology: fieldMap.sales_call_terminology || fieldMap["sales_call_terminology"] || "enquiries",
            primary_color: fieldMap.primary_color || fieldMap["primary_color"] || "#0443AE",
            secondary_color: fieldMap.secondary_color || fieldMap["secondary_color"] || "",
            primary_font: fieldMap.primary_font || fieldMap["primary_font"] || "Inter",
            logo_url: fieldMap.logo_url || fieldMap["logo_url"] || "",
            location: fieldMap.location || fieldMap["location"] || "",
            business_description: fieldMap.business_description || fieldMap["business_description"] || "",
            website_url: fieldMap.website_url || contact.website || "",
            benefit_1: fieldMap.benefit_1 || fieldMap["benefit_1"] || "",
            benefit_2: fieldMap.benefit_2 || fieldMap["benefit_2"] || "",
            benefit_3: fieldMap.benefit_3 || fieldMap["benefit_3"] || "",
            pain_point_1: fieldMap.pain_point_1 || fieldMap["pain_point_1"] || "",
            pain_point_2: fieldMap.pain_point_2 || fieldMap["pain_point_2"] || "",
            pain_point_3: fieldMap.pain_point_3 || fieldMap["pain_point_3"] || "",
            cta_1: fieldMap.cta_1 || fieldMap["cta_1"] || "",
            cta_2: fieldMap.cta_2 || fieldMap["cta_2"] || "",
            site_context_blob: fieldMap.site_context_blob || fieldMap["site_context_blob"] || "",
            agent_knowledge_blob: fieldMap.agent_knowledge_blob || fieldMap["agent_knowledge_blob"] || ""
          }), { status: 200, headers: corsHeaders });
        } catch (err) {
          return new Response(JSON.stringify({ success: false, error: "GHL API error: " + err.message }), { status: 200, headers: corsHeaders });
        }
      }
      if (proxyTarget) {
        let targetUrl = proxyTarget.startsWith("http") ? proxyTarget : "https://" + proxyTarget;
        const PROXY_USER_AGENTS = [
          "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ];
        let html2 = null;
        let fetchSuccess = false;
        for (let i = 0; i < 2; i++) {
          try {
            const response = await fetch(targetUrl, {
              headers: {
                "User-Agent": PROXY_USER_AGENTS[i % PROXY_USER_AGENTS.length],
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-AU,en-US;q=0.9,en;q=0.8"
              }
            });
            if (response.ok) {
              const contentType = response.headers.get("content-type");
              if (contentType && contentType.includes("text/html")) {
                html2 = await response.text();
                fetchSuccess = true;
                break;
              } else {
                const newHeaders2 = new Headers(response.headers);
                newHeaders2.delete("x-frame-options");
                newHeaders2.delete("content-security-policy");
                newHeaders2.delete("cross-origin-resource-policy");
                newHeaders2.set("Access-Control-Allow-Origin", "*");
                return new Response(response.body, { status: response.status, headers: newHeaders2 });
              }
            }
          } catch (err) {
          }
          if (i < 1) await new Promise((r) => setTimeout(r, 300));
        }
        if (!fetchSuccess && env.SCRAPINGANT_KEY) {
          try {
            const antUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(targetUrl)}&x-api-key=${env.SCRAPINGANT_KEY}`;
            const beeResponse = await fetch(antUrl);
            if (beeResponse.ok) {
              html2 = await beeResponse.text();
              fetchSuccess = true;
            }
          } catch (e) {
          }
        }
        if (!fetchSuccess || !html2) {
          return new Response("Error: Site could not be loaded", { status: 502, headers: corsHeaders });
        }
        const baseUrl = new URL(targetUrl).origin;
        if (html2.toLowerCase().includes("<head>")) {
          html2 = html2.replace(/<head>/i, `<head><base href="${baseUrl}/">`);
        } else {
          html2 = `<base href="${baseUrl}/">` + html2;
        }
        const cookieHiderCSS = `<style id="cookie-killer-css">
[class*="cookie"],[class*="Cookie"],[class*="consent"],[class*="Consent"],[class*="gdpr"],[class*="GDPR"],[class*="privacy"],[id*="cookie"],[id*="Cookie"],[id*="consent"],[id*="Consent"],[id*="gdpr"],[id*="GDPR"],[data-cookie],[data-consent],[data-gdpr],[aria-label*="cookie"],[aria-label*="consent"],
[class*="onetrust"],[id*="onetrust"],#onetrust-consent-sdk,#onetrust-banner-sdk,#onetrust-pc-sdk,.onetrust-pc-dark-filter,.otFlat,.otFloatingRounded,
#CybotCookiebotDialog,#CybotCookiebotDialogBody,.CybotCookiebotDialogActive,[class*="cookiebot"],[id*="cookiebot"],#Cookiebot,
.qc-cmp-ui-container,.qc-cmp2-container,#qcCmpUi,.qc-cmp-showing,[class*="quantcast"],[id*="quantcast"],.cmpboxBG,.cmpbox,
#truste-consent-track,#trustarc-banner,.truste_box_overlay,.truste_overlay,[class*="trustarc"],[class*="truste"],#consent_blackbar,
#ccc,.ccc-notify,.ccc-overlay,.ccc-content,[class*="civic-cookie"],#civic-cookie-control,
.cc-banner,.cc-window,.cc-revoke,.cc-animate,.cc-floating,.cc-bottom,.cc-top,.cc-overlay,.cc-grower,.cc-link,.cc-btn,.cc-dismiss,
#usercentrics-root,#uc-center-container,.uc-banner,.uc-embedding-container,[class*="usercentrics"],
.klaro,.cookie-modal,.cookie-notice,#iubenda-cs-banner,.iubenda-cs-container,[class*="iubenda"],[id*="iubenda"],
#didomi-host,.didomi-popup,.didomi-notice,[class*="didomi"],#axeptio_overlay,#axeptio_btn,.axeptio_widget,[class*="axeptio"],
.cmplz-cookiebanner,.cmplz-message,#cmplz-cookiebanner,[class*="cmplz"],
#cookie-law-info-bar,.cli-bar-container,.cli-modal,[class*="cookie-law-info"],[id*="cookie-law-info"],
#BorlabsCookieBox,.BorlabsCookie,.borlabs-cookie,[class*="borlabs"],[id*="borlabs"],
#ch-preference-center,.ch-cookie-consent,[class*="cookiehub"],#cookiescript_injected,.cookiescript_badge,[class*="cookiescript"],
[data-termly-consent],[class*="termly"],#termly-code-snippet-support,
.cookie-banner,.cookie-notice,.cookie-popup,.cookie-alert,.cookie-notification,.cookie-warning,.cookie-bar,.cookie-modal,.cookie-container,.cookie-wrapper,.cookie-overlay,.cookie-message,.cookie-dialog,.cookie-disclaimer,.cookie-policy,.cookie-compliance,
.cookies-banner,.cookies-notice,.cookies-bar,.cookies-popup,.consent-banner,.consent-modal,.consent-popup,.consent-bar,.consent-notice,.consent-dialog,.consent-overlay,.consent-container,.consent-wrapper,.consent-message,.consent-notification,
.gdpr-banner,.gdpr-modal,.gdpr-popup,.gdpr-notice,.gdpr-bar,.gdpr-overlay,.gdpr-container,.gdpr-wrapper,.gdpr-notification,
.privacy-banner,.privacy-notice,.privacy-popup,.privacy-bar,.privacy-modal,.privacy-overlay,.privacy-notification,
#cookie-banner,#cookie-notice,#cookie-popup,#cookie-bar,#cookie-modal,#cookie-dialog,#cookie-container,#cookie-wrapper,
#cookies-banner,#cookies-notice,#cookies-bar,#cookies-popup,#consent-banner,#consent-modal,#consent-popup,#consent-bar,
#gdpr-banner,#gdpr-modal,#gdpr-popup,#gdpr-notice,#privacy-banner,#privacy-notice,#privacy-popup,
.eu-cookie,.eu-cookie-compliance,.eu-cookie-bar,.CookieConsent,.cookieConsent,.cookie_notice,.cookie-consent-banner,.cookie-consent-modal,
.cookie-law,.cookie-policy-banner,.cookie-preferences,.accept-cookies,.reject-cookies,.manage-cookies,
div[style*="position: fixed"][style*="z-index: 2147483"],div[style*="position: fixed"][style*="z-index: 99999"]
{display:none!important;visibility:hidden!important;opacity:0!important;pointer-events:none!important;height:0!important;max-height:0!important;overflow:hidden!important;}
body.cookie-open,body.modal-open,body.cookie-consent-open,body.cmplz-blocked,body.borlabs-cookie-blocked,body[style*="overflow: hidden"],html[style*="overflow: hidden"]{overflow:auto!important;position:static!important;}
</style>`;
        const cookieKillerJS = `<script id="cookie-killer-js">
(function(){var COOKIE_KEYWORDS=['cookie','consent','gdpr','privacy-banner','onetrust','cookiebot','quantcast','trustarc','truste','civic','usercentrics','klaro','iubenda','didomi','axeptio','complianz','borlabs','cookiehub','cookiescript','termly','cc-banner','cc-window','cli-bar','CybotCookiebot','qc-cmp','cmpbox','eu-cookie'];
function isCookieElement(el){if(!el||!el.tagName)return false;var tag=el.tagName.toLowerCase();if(tag==='script'||tag==='style'||tag==='link')return false;var classAttr=(el.className||'').toString().toLowerCase();var idAttr=(el.id||'').toLowerCase();var ariaLabel=(el.getAttribute('aria-label')||'').toLowerCase();for(var i=0;i<COOKIE_KEYWORDS.length;i++){var kw=COOKIE_KEYWORDS[i];if(classAttr.indexOf(kw)!==-1||idAttr.indexOf(kw)!==-1||ariaLabel.indexOf(kw)!==-1)return true;}try{var style=window.getComputedStyle(el);if(style.position==='fixed'&&parseInt(style.zIndex)>99999){var text=(el.textContent||'').toLowerCase();if(text.indexOf('cookie')!==-1||text.indexOf('consent')!==-1||text.indexOf('accept')!==-1)return true;}}catch(e){}return false;}
function removeCookieElements(){var all=document.querySelectorAll('*');for(var i=0;i<all.length;i++){if(isCookieElement(all[i])){try{all[i].parentNode.removeChild(all[i]);}catch(e){}}}if(document.body){document.body.style.overflow='auto';document.body.style.position='static';}if(document.documentElement){document.documentElement.style.overflow='auto';}}
removeCookieElements();if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',removeCookieElements);}
window.addEventListener('load',function(){removeCookieElements();setTimeout(removeCookieElements,500);setTimeout(removeCookieElements,1500);setTimeout(removeCookieElements,3000);});
if(typeof MutationObserver!=='undefined'){var observer=new MutationObserver(function(mutations){for(var i=0;i<mutations.length;i++){var mutation=mutations[i];for(var j=0;j<mutation.addedNodes.length;j++){var node=mutation.addedNodes[j];if(node.nodeType===1&&isCookieElement(node)){try{node.parentNode.removeChild(node);}catch(e){}}}}});observer.observe(document.documentElement,{childList:true,subtree:true});}
function autoAccept(){var sels=['[class*="accept"]','[id*="accept"]','[class*="agree"]','[id*="agree"]','.cc-btn','.cc-accept','.cc-dismiss'];for(var i=0;i<sels.length;i++){try{var btns=document.querySelectorAll(sels[i]);for(var j=0;j<btns.length;j++){var btn=btns[j];if(btn.offsetParent!==null){var t=(btn.textContent||'').toLowerCase();if(t.indexOf('accept')!==-1||t.indexOf('agree')!==-1||t.indexOf('allow')!==-1||t.indexOf('ok')!==-1||t.indexOf('got it')!==-1){btn.click();}}}}catch(e){}}};setTimeout(autoAccept,1000);setTimeout(autoAccept,3000);
})();
<\/script>`;
        html2 = html2.replace(/<script[^>]*src="[^"]*(?:onetrust|cookiebot|quantcast|trustarc|usercentrics|iubenda|didomi|axeptio|complianz|cookiehub|cookiescript|termly|osano|cookieconsent)[^"]*"[^>]*><\/script>/gi, "<!-- cookie script blocked -->");
        html2 = html2.replace(/<\/head>/i, cookieHiderCSS + "</head>");
        html2 = html2.replace(/<\/body>/i, cookieKillerJS + "</body>");
        const newHeaders = new Headers();
        newHeaders.set("Content-Type", "text/html; charset=utf-8");
        newHeaders.set("Access-Control-Allow-Origin", "*");
        return new Response(html2, { status: 200, headers: newHeaders });
      }
      const traceLog = [];
      let website_url = body.website || body.website_url || body.url || body.Website_Url || body.websiteUrl;
      if (!website_url) {
        return new Response(JSON.stringify({ success: false, error: "No URL provided" }), { status: 200, headers: corsHeaders });
      }
      website_url = website_url.trim();
      if (!website_url.startsWith("http")) {
        website_url = "https://" + website_url;
      }
      const leadIdForReconcile = body.lid || url.searchParams.get("lid");
      let leadMemory = {};
      if (leadIdForReconcile && env.LEADS_KV) {
        const kvMemory = await env.LEADS_KV.get(leadIdForReconcile);
        if (kvMemory) leadMemory = JSON.parse(kvMemory);
      }
      const overBusinessName = body.businessName || body.business_name || leadMemory.business_name || null;
      const overIndustry = body.industry || leadMemory.industry || null;
      const overTargetAudience = body.targetAudience || body.target_audience || leadMemory.target_audience || null;
      const overSalesTerm = body.salesTerm || body.sales_call_terminology || leadMemory.sales_call_terminology || null;
      const reconcile = /* @__PURE__ */ __name((scraped, override) => override && override !== "" ? override : scraped, "reconcile");
      const USER_AGENTS = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:121.0) Gecko/20100101 Firefox/121.0"
      ];
      async function fetchWithRetry(url2, maxRetries = 3) {
        let lastError = null;
        for (let i = 0; i < maxRetries; i++) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);
            const response = await fetch(url2, {
              signal: controller.signal,
              headers: {
                "User-Agent": USER_AGENTS[i % USER_AGENTS.length],
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-AU,en-US;q=0.9,en;q=0.8",
                "Accept-Encoding": "gzip, deflate, br",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Upgrade-Insecure-Requests": "1"
              }
            });
            clearTimeout(timeoutId);
            if (response.ok) {
              const html2 = await response.text();
              return { success: true, html: html2 };
            }
            lastError = `HTTP ${response.status}`;
          } catch (err) {
            lastError = err.name === "AbortError" ? "Timeout (2.5s)" : err.message;
          }
          if (i < maxRetries - 1) {
            await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
          }
        }
        return { success: false, error: lastError };
      }
      __name(fetchWithRetry, "fetchWithRetry");

      // ======================================================================
      // V3 CHUNK 3: FAST TRACK (HTMLRewriter)
      // ======================================================================
      if (body.v3_fast_track) {
        const t0_ft = Date.now();
        const lid = body.lid || url.searchParams.get("lid") || "anon_" + Date.now().toString(36);
        let hero = { v: 1, url: website_url, h1: "", h2: "", h3: "", title: "", meta_description: "", og_title: "", og_description: "" };

        let t_fetch = 0, t_hero = 0, t_kv = 0;

        // 1. Fetch site
        const ftFetchRes = await fetchWithRetry(website_url, 3);
        t_fetch = Date.now() - t0_ft;

        const t1_hero = Date.now();
        // 2. Extract hero if fetch succeeded
        if (ftFetchRes.success) {
          const res = new Response(ftFetchRes.html);
          let h1Count = 0, h2Count = 0, titleCount = 0;

          const rewriter = new HTMLRewriter()
            .on("title", {
              element() { titleCount++; },
              text(t) { if (titleCount === 1) hero.title += t.text; }
            })
            .on("meta[name='description'], meta[name='Description']", {
              element(e) { if (!hero.meta_description) hero.meta_description = e.getAttribute("content") || ""; }
            })
            .on("meta[property='og:title']", {
              element(e) { if (!hero.og_title) hero.og_title = e.getAttribute("content") || ""; }
            })
            .on("meta[property='og:description']", {
              element(e) { if (!hero.og_description) hero.og_description = e.getAttribute("content") || ""; }
            })
            .on("h1", {
              element() { h1Count++; },
              text(t) { if (h1Count === 1) hero.h1 += t.text; }
            })
            .on("h2", {
              element() { h2Count++; },
              text(t) { if (h2Count === 1) hero.h2 += t.text; }
            })
            .on("h3", {
              element() { if (!hero.h3) hero.h3 = ""; },
              text(t) { if (hero.h3 !== undefined && hero.h3.length < 200) hero.h3 += t.text; }
            });

          await rewriter.transform(res).text(); // Drain

          hero.title = hero.title.trim().replace(/\s+/g, ' ');
          hero.h1 = hero.h1.trim().replace(/\s+/g, ' ');
          hero.h2 = hero.h2.trim().replace(/\s+/g, ' ');
          hero.h3 = (hero.h3 || '').trim().replace(/\s+/g, ' ');
          hero.meta_description = (hero.meta_description || '').trim();
          hero.og_title = (hero.og_title || '').trim();
          hero.og_description = (hero.og_description || '').trim();
        }
        t_hero = Date.now() - t1_hero;

        // 3. Build Safe Stub (FastContext & NormalizedIntel)
        const fast_context = {
          v: 1,
          lid: lid,
          ts: new Date().toISOString(),
          business: {
            name: hero.og_title || hero.title || website_url,
            domain: new URL(website_url).hostname.replace("www.", ""),
            location: "",
            rating: 0,
            review_count: 0,
            logo_url: ""
          },
          hero: hero,
          person: { first_name: "", job_title: "Unknown Role", tenure: "", source: "fast_track" },
          ads: { is_running_ads: false, estimated_monthly_spend_aud: 0 },
          numbers: {
            one_real_number_for_opener: 0 // Fallback if no reviews
          }
        };

        // G3: Lightweight deterministic grade from available hero data
        function computeQuickGrade(h) {
          let score = 0;
          if (h.h1 && h.h1.length > 5) score += 25;
          if (h.meta_description && h.meta_description.length > 20) score += 20;
          if (h.og_title) score += 15;
          if (h.h2 && h.h2.length > 5) score += 15;
          if (h.og_description) score += 10;
          if (h.h3 && h.h3.length > 5) score += 10;
          if (h.title && h.title.length > 10) score += 5;
          if (score >= 70) return "A";
          if (score >= 45) return "B";
          if (score >= 20) return "C";
          return "D";
        }

        const intel_stub = {
          v: 1,
          lid: lid,
          ts: new Date().toISOString(),
          fast_context: fast_context, // returned to frontend
          intel: {
            grade: computeQuickGrade(hero),
            top_fixes: [],
            memory_prefill: {
              country: "AU",
              currency: "AUD",
              runs_ads: false,
              crm_detected: false
            },
            bella_opener: `Hi! I was just looking at your site, ${fast_context.business.domain}. I noticed your main message is: ${hero.h1 || hero.title}`
          } // C4/5 will overwrite this 'intel' object later
        };

        // 4. Save intel_stub for later merge with V2 data
        // DO NOT write to KV or return here — fall through to V2 sync scraper
        // so that phaseAResponse (110 data points) gets populated.
        // The V2 path will reuse ftFetchRes to avoid a double-fetch.
        var v3_intel_stub = intel_stub;
        var v3_ftFetchRes = ftFetchRes;

        console.log(`[V3 Fast Track] Hero extracted in ${t_hero}ms, falling through to V2 sync path for 110-point merge...`);

        // Execution continues into V2 sync block below
      }
      // ======================================================================
      // Reuse the Fast Track fetch result if available, otherwise fetch fresh
      let fetchResult = v3_ftFetchRes || await fetchWithRetry(website_url, 3);
      if (!fetchResult.success && env.SCRAPINGANT_KEY) {
        try {
          const antUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(website_url)}&x-api-key=${env.SCRAPINGANT_KEY}`;
          const beeResponse = await fetch(antUrl);
          if (beeResponse.ok) {
            const html2 = await beeResponse.text();
            fetchResult = { success: true, html: html2, source: "scrapingbee" };
          }
        } catch (e) {
        }
      }
      let html = "";
      let scrapingFailed = false;
      if (!fetchResult.success) {
        traceLog.push("Scraping failed - continuing with domain-based APIs");
        scrapingFailed = true;
        html = "";
      } else {
        html = fetchResult.html;
        traceLog.push("Scraping succeeded");
      }
      const htmlLower = html.toLowerCase();
      let cleanBlob = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gmi, "").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gmi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().substring(0, 15e3);
      let quickBusinessName = "";
      let quickLocation = "";
      const genericWords = ["home", "welcome", "about", "contact", "services", "products", "blog", "news", "main", "index", "default", "page", "site", "website", "official"];
      const ogSiteNameMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i) || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
      if (ogSiteNameMatch && ogSiteNameMatch[1].trim().length > 2) {
        quickBusinessName = ogSiteNameMatch[1].trim();
      }
      if (!quickBusinessName || genericWords.includes(quickBusinessName.toLowerCase())) {
        const quickTitleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (quickTitleMatch) {
          const titleParts = quickTitleMatch[1].split(/[-|–—:·]/);
          for (const part of [...titleParts].reverse()) {
            const cleaned = part.trim();
            if (cleaned.length > 2 && !genericWords.includes(cleaned.toLowerCase().split(" ")[0])) {
              quickBusinessName = cleaned;
              break;
            }
          }
          if (!quickBusinessName || genericWords.includes(quickBusinessName.toLowerCase().split(" ")[0])) {
            for (const part of titleParts) {
              const cleaned = part.trim();
              if (cleaned.length > 2 && !genericWords.includes(cleaned.toLowerCase().split(" ")[0])) {
                quickBusinessName = cleaned;
                break;
              }
            }
          }
        }
      }
      if (!quickBusinessName || genericWords.includes(quickBusinessName.toLowerCase().split(" ")[0])) {
        try {
          const domainName = new URL(website_url).hostname.replace("www.", "").split(".")[0];
          quickBusinessName = domainName.charAt(0).toUpperCase() + domainName.slice(1);
        } catch (e) {
          quickBusinessName = "Business";
        }
      }
      const quickLocationMatch = html.match(/(Sydney|Melbourne|Brisbane|Perth|Adelaide|Hobart|Darwin|Canberra|Gold Coast|Newcastle)/i);
      if (quickLocationMatch) quickLocation = quickLocationMatch[1];
      let googlePlacesData = null;
      let googlePlacesDebug = {
        quickBusinessName: "",
        quickLocation: "",
        targetDomain: "",
        searchStrategiesUsed: [],
        candidatesEvaluated: [],
        selectedPlace: null,
        selectionReason: null
      };
      if (env.GOOGLE_PLACES_API_KEY && quickBusinessName) {
        try {
          googlePlacesDebug.quickBusinessName = quickBusinessName;
          googlePlacesDebug.quickLocation = quickLocation;
          const targetDomain = website_url.toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "").replace("www.", "");
          googlePlacesDebug.targetDomain = targetDomain;
          const searchStrategies = [
            { query: `${quickBusinessName} head office`, type: "findPlace" },
            { query: `${quickBusinessName} ${quickLocation}`, type: "findPlace" },
            { query: quickBusinessName, type: "findPlace" },
            { query: quickBusinessName.split(" ").slice(0, 2).join(" ") + " " + quickLocation, type: "findPlace" },
            // TextSearch is more lenient for discovering businesses
            { query: `${quickBusinessName} head office`, type: "textSearch" },
            { query: `${quickBusinessName} ${quickLocation}`, type: "textSearch" },
            { query: quickBusinessName, type: "textSearch" }
          ];
          const phoneAreaCodes = {
            "02": "Sydney/NSW",
            "03": "Melbourne/VIC",
            "07": "Brisbane/QLD",
            "08": "Perth/Adelaide"
          };
          let place = null;
          let websiteMatchedPlace = null;
          let nameMatchedPlaces = [];
          for (const strategy of searchStrategies) {
            if (!strategy.query || strategy.query.trim().length < 3) continue;
            if (websiteMatchedPlace) break;
            let apiUrl;
            if (strategy.type === "findPlace") {
              apiUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(strategy.query)}&inputtype=textquery&fields=place_id,name,rating,user_ratings_total,photos,formatted_phone_number,website,types,price_level,business_status,formatted_address,geometry&key=${env.GOOGLE_PLACES_API_KEY}`;
            } else {
              apiUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(strategy.query)}&key=${env.GOOGLE_PLACES_API_KEY}`;
            }
            const placesResponse = await fetch(apiUrl);
            const placesResult = await placesResponse.json();
            const candidates = placesResult.candidates || placesResult.results || [];
            googlePlacesDebug.searchStrategiesUsed.push({
              query: strategy.query,
              type: strategy.type,
              candidateCount: candidates.length,
              candidateNames: candidates.slice(0, 5).map((c) => c.name || "UNNAMED")
            });
            for (const candidate of candidates.slice(0, 10)) {
              const candidateWebsite = (candidate.website || "").toLowerCase();
              const candidateName = (candidate.name || "").toLowerCase();
              const targetName = quickBusinessName.toLowerCase();
              const candidatePhone = candidate.formatted_phone_number || "";
              const candidateWebsiteClean = candidateWebsite.replace("www.", "").replace(/^https?:\/\//, "");
              const websiteMatch = candidateWebsiteClean.length > 0 && (candidateWebsite.includes(targetDomain) || targetDomain.includes(candidateWebsiteClean.split("/")[0]));
              const targetFirstWord = targetName.split(" ")[0];
              const candidateFirstWord = candidateName.split(" ")[0];
              const nameMatch = targetFirstWord.length >= 3 && candidateName.includes(targetFirstWord) || candidateFirstWord.length >= 3 && targetName.includes(candidateFirstWord);
              const phonePrefix = candidatePhone.replace(/[^\d]/g, "").substring(0, 2);
              const phoneLocation = phoneAreaCodes[phonePrefix] || "Unknown";
              googlePlacesDebug.candidatesEvaluated.push({
                name: candidate.name,
                website: candidate.website || "NONE",
                phone: candidatePhone || "NONE",
                phonePrefix,
                phoneLocation,
                rating: candidate.rating,
                reviewCount: candidate.user_ratings_total,
                address: candidate.formatted_address || candidate.vicinity || "N/A",
                validation: {
                  targetDomain,
                  websiteMatch,
                  nameMatch,
                  passed: websiteMatch || nameMatch,
                  priority: websiteMatch ? "WEBSITE (highest)" : nameMatch ? "NAME (fallback)" : "REJECTED"
                }
              });
              if (websiteMatch) {
                websiteMatchedPlace = candidate;
                googlePlacesDebug.selectionReason = "website_match";
                break;
              }
              if (nameMatch && !nameMatchedPlaces.find((p) => p.place_id === candidate.place_id)) {
                nameMatchedPlaces.push({
                  ...candidate,
                  phonePrefix,
                  phoneLocation
                });
              }
            }
          }
          if (websiteMatchedPlace) {
            place = websiteMatchedPlace;
            googlePlacesDebug.selectedPlace = place.name;
            googlePlacesDebug.selectionReason = "website_match";
          } else if (nameMatchedPlaces.length > 0) {
            const sydneyOffice = nameMatchedPlaces.find((p) => p.phonePrefix === "02");
            if (sydneyOffice) {
              place = sydneyOffice;
              googlePlacesDebug.selectionReason = "name_match_sydney_phone";
            } else {
              place = nameMatchedPlaces.sort(
                (a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0)
              )[0];
              googlePlacesDebug.selectionReason = "name_match_most_reviews";
            }
            googlePlacesDebug.selectedPlace = place.name;
            googlePlacesDebug.nameMatchCandidates = nameMatchedPlaces.map((p) => ({
              name: p.name,
              phone: p.formatted_phone_number,
              phonePrefix: p.phonePrefix,
              reviews: p.user_ratings_total
            }));
          }
          if (place) {
            googlePlacesData = {
              name: place.name,
              rating: place.rating,
              reviewCount: place.user_ratings_total,
              placeId: place.place_id,
              // NEW: Extended fields for comprehensive intelligence
              phone: place.formatted_phone_number || null,
              website: place.website || null,
              types: place.types || [],
              priceLevel: place.price_level || null,
              businessStatus: place.business_status || null,
              address: place.formatted_address || null,
              geometry: place.geometry || null,
              photoCount: place.photos ? place.photos.length : 0,
              // Store photo references for logo detection
              photoRefs: place.photos ? place.photos.slice(0, 10).map((p) => ({
                ref: p.photo_reference,
                width: p.width,
                height: p.height
              })) : []
            };
            if (place.place_id) {
              const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${place.place_id}&fields=reviews,opening_hours,editorial_summary,url,international_phone_number&key=${env.GOOGLE_PLACES_API_KEY}`;
              const detailsResponse = await fetch(detailsUrl);
              const detailsResult = await detailsResponse.json();
              if (detailsResult.result) {
                const result = detailsResult.result;
                if (result.opening_hours) {
                  googlePlacesData.openingHours = {
                    isOpen: result.opening_hours.open_now,
                    weekdayText: result.opening_hours.weekday_text || [],
                    periods: result.opening_hours.periods || []
                  };
                }
                googlePlacesData.editorialSummary = result.editorial_summary?.overview || null;
                googlePlacesData.googleMapsUrl = result.url || null;
                googlePlacesData.internationalPhone = result.international_phone_number || null;
                if (result.reviews && result.reviews.length > 0) {
                  const reviews = result.reviews;
                  const reviewsWithResponse = reviews.filter((r) => r.author_url && r.author_url.includes("/contrib/"));
                  googlePlacesData.ownerResponseRate = reviews.length > 0 ? reviewsWithResponse.length / reviews.length : 0;
                  googlePlacesData.reviews = reviews.map((r) => ({
                    rating: r.rating,
                    text: r.text || "",
                    // FULL TEXT - no truncation
                    time: r.time,
                    // Unix timestamp for old review detection
                    relativeTime: r.relative_time_description,
                    authorName: r.author_name || "",
                    language: r.language || "en",
                    // For Sarah's sleeping giant: positive reviews > 1 year old
                    isOldPositive: r.rating >= 4 && r.time && Date.now() / 1e3 - r.time > 31536e3
                  }));
                  googlePlacesData.reviewStats = {
                    total: reviews.length,
                    avgRating: reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length,
                    negativeCount: reviews.filter((r) => r.rating <= 2).length,
                    positiveCount: reviews.filter((r) => r.rating >= 4).length,
                    oldPositiveCount: reviews.filter((r) => r.rating >= 4 && r.time && Date.now() / 1e3 - r.time > 31536e3).length
                  };
                }
              }
            }
          }
        } catch (e) {
          console.error("Google Places API error:", e);
        }
      }
      let competitorData = null;
      if (env.GOOGLE_PLACES_API_KEY && googlePlacesData?.geometry && googlePlacesData?.types?.length > 0) {
        try {
          const location = googlePlacesData.geometry.location;
          const primaryType = googlePlacesData.types.find(
            (t) => !["point_of_interest", "establishment", "premise", "street_address"].includes(t)
          ) || googlePlacesData.types[0];
          const nearbyUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${location.lat},${location.lng}&radius=5000&type=${primaryType}&key=${env.GOOGLE_PLACES_API_KEY}`;
          const nearbyResponse = await fetch(nearbyUrl);
          const nearbyResult = await nearbyResponse.json();
          if (nearbyResult.results && nearbyResult.results.length > 1) {
            const competitors = nearbyResult.results.filter((p) => p.place_id !== googlePlacesData.placeId).slice(0, 5).map((p) => ({
              name: p.name,
              rating: p.rating || null,
              reviewCount: p.user_ratings_total || 0,
              vicinity: p.vicinity || "",
              types: p.types || [],
              isOpenNow: p.opening_hours?.open_now || null
            }));
            if (competitors.length > 0) {
              const avgCompetitorRating = competitors.filter((c) => c.rating).length > 0 ? competitors.reduce((sum, c) => sum + (c.rating || 0), 0) / competitors.filter((c) => c.rating).length : null;
              const avgCompetitorReviews = competitors.length > 0 ? Math.round(competitors.reduce((sum, c) => sum + c.reviewCount, 0) / competitors.length) : 0;
              competitorData = {
                competitors,
                count: competitors.length,
                avgRating: avgCompetitorRating ? Math.round(avgCompetitorRating * 10) / 10 : null,
                avgReviewCount: avgCompetitorReviews,
                businessRating: googlePlacesData.rating,
                businessReviewCount: googlePlacesData.reviewCount,
                // Competitive position
                isRatingAboveAvg: googlePlacesData.rating && avgCompetitorRating ? googlePlacesData.rating >= avgCompetitorRating : null,
                isReviewCountAboveAvg: googlePlacesData.reviewCount && avgCompetitorReviews ? googlePlacesData.reviewCount >= avgCompetitorReviews : null,
                // Named insights for each agent
                insights: {
                  james: avgCompetitorRating && googlePlacesData.rating && googlePlacesData.rating < avgCompetitorRating ? `Your competitors average ${avgCompetitorRating.toFixed(1)} stars. You have ${googlePlacesData.rating}. ${competitors[0]?.name} leads with ${competitors[0]?.rating} stars.` : googlePlacesData.rating >= (avgCompetitorRating || 0) ? `You're outperforming the local competition on ratings. Maintain this advantage with James.` : null,
                  chris: null,
                  // Will calculate chat widget presence if we scrape competitor sites
                  alex: null
                }
              };
            }
          }
        } catch (e) {
          console.error("Competitor detection error:", e);
          competitorData = null;
        }
      }
      let facebookAdData = null;
      let googleAdsTransparencyData = null;
      let campaignAnalysis = null;
      try {
        const domain = (() => {
          try {
            return new URL(website_url).hostname.replace("www.", "");
          } catch (e) {
            return "";
          }
        })();
        async function runApifyActor(actorId, input) {
          if (!env.APIFY_API_KEY) return null;
          try {
            const runResp = await fetch(`https://api.apify.com/v2/acts/${actorId}/runs?token=${env.APIFY_API_KEY}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(input)
            });
            if (!runResp.ok) return null;
            const runData = await runResp.json();
            const runId = runData?.data?.id;
            if (!runId) return null;
            for (let i = 0; i < 10; i++) {
              await new Promise((r) => setTimeout(r, 2e3));
              const statusResp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${env.APIFY_API_KEY}`);
              if (!statusResp.ok) break;
              const statusData = await statusResp.json();
              const status = statusData?.data?.status;
              if (status === "SUCCEEDED") {
                const datasetId = statusData?.data?.defaultDatasetId;
                if (!datasetId) return null;
                const dataResp = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${env.APIFY_API_KEY}&limit=10`);
                if (!dataResp.ok) return null;
                return await dataResp.json();
              }
              if (status === "FAILED" || status === "ABORTED") return null;
            }
            return null;
          } catch (e) {
            return null;
          }
        }
        __name(runApifyActor, "runApifyActor");
        async function analyseAdLandingPage(url2) {
          if (!url2 || !env.FIRECRAWL_KEY || !env.GEMINI_API_KEY) return null;
          try {
            const fcResp = await fetch("https://api.firecrawl.dev/v1/scrape", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.FIRECRAWL_KEY}` },
              body: JSON.stringify({ url: url2, formats: ["markdown"] })
            });
            if (!fcResp.ok) return null;
            const fcData = await fcResp.json();
            const markdown = fcData?.data?.markdown;
            if (!markdown || markdown.length < 200) return null;
            const geminiPrompt = `You are a marketing analyst. Analyse the following ad landing page content and output a JSON object with these keys:
- offer: string (the main offer or CTA on the page)
- pain_points_addressed: string[] (list of pain points the page targets)
- funnel_type: string (e.g. lead-gen, e-commerce, booking, webinar)
- headline: string (the main h1 or hero headline)
- key_benefits: string[] (up to 3 key benefits listed)

Landing Page Content:
${markdown.substring(0, 6e3)}

Output ONLY the JSON object, no markdown.`;
            const gemResp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: [{ text: geminiPrompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 512 } })
            });
            if (!gemResp.ok) return null;
            const gemData = await gemResp.json();
            const raw = gemData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
            const match = raw.replace(/^```(?:json)?\s*/im, "").replace(/```\s*$/m, "").match(/{[\s\S]*}/);
            return match ? JSON.parse(match[0]) : null;
          } catch (e) {
            return null;
          }
        }
        __name(analyseAdLandingPage, "analyseAdLandingPage");
        // V3 FIX: Always run Apify ad scrapers in Phase B — Deep Track (:intel) data
        // doesn't flow into the 110-point responseData, so Phase B needs its own ad data.
        const fbPromise = runApifyActor("apify~facebook-ads-scraper", {
          searchQuery: quickBusinessName,
          country: "AU",
          maxItems: 10
        });
        const googlePromise = runApifyActor("apify~google-ads-scraper", {
          domain,
          region: "AU",
          maxItems: 10
        });
        const [fbItems, googleItems] = await Promise.all([fbPromise, googlePromise]);
        if (fbItems && fbItems.length > 0) {
          const allCtas = [...new Set(fbItems.map((a) => a.callToActionType || a.cta_type || "").filter(Boolean).map((c) => c.replace(/_/g, " ").toLowerCase()))];
          const allUrls = [...new Set(fbItems.map((a) => a.linkUrl || a.link_url || "").filter(Boolean))];
          const allCreatives = fbItems.slice(0, 5).map((a) => a.bodyText || a.caption || a.body || "").filter((c) => c.length > 10);
          facebookAdData = {
            isRunningAds: true,
            isRunningFacebookAds: true,
            adCount: fbItems.length,
            ctas: allCtas,
            primaryCTA: allCtas[0] || "unknown",
            creatives: allCreatives,
            ad_urls: allUrls,
            primaryAdUrl: allUrls[0] || null
          };
          if (allUrls[0]) {
            campaignAnalysis = await analyseAdLandingPage(allUrls[0]);
          }
        } else {
          const hasFbPixel = htmlLower.includes("fbq(") || htmlLower.includes("facebook.net/en_us/fbevents.js");
          facebookAdData = { isRunningAds: hasFbPixel, isRunningFacebookAds: hasFbPixel, adCount: 0, ctas: [], ad_urls: [], apify_result: "no_ads_found" };
        }
        if (googleItems && googleItems.length > 0) {
          const googleUrls = [...new Set(googleItems.map((a) => a.finalUrl || a.url || "").filter(Boolean))];
          const googleCreatives = googleItems.slice(0, 5).map((a) => a.headline || a.title || "").filter(Boolean);
          googleAdsTransparencyData = {
            isRunningGoogleAds: true,
            domain,
            adCount: googleItems.length,
            ad_urls: googleUrls,
            headlines: googleCreatives
          };
          if (!campaignAnalysis && googleUrls[0]) {
            campaignAnalysis = await analyseAdLandingPage(googleUrls[0]);
          }
        } else {
          const hasGTag = htmlLower.includes("gtag(") || htmlLower.includes("googletag.pubads");
          const hasGAds = htmlLower.includes("google_conversion") || htmlLower.includes("googleadservices");
          googleAdsTransparencyData = { isRunningGoogleAds: hasGTag || hasGAds, domain, adCount: 0, ad_urls: [], apify_result: "no_ads_found" };
        }
      } catch (e) {
        console.error("Ad ecosystem scraper error:", e.message);
        facebookAdData = null;
        googleAdsTransparencyData = null;
      }
      let builtWithData = null;
      traceLog.push("BuiltWith Start");
      if (env.BUILTWITH_API_KEY) {
        try {
          let domain = "";
          try {
            domain = new URL(website_url).hostname.replace("www.", "");
          } catch (e) {
          }
          if (domain) {
            const builtWithUrl = `https://api.builtwith.com/free1/api.json?KEY=${env.BUILTWITH_API_KEY}&LOOKUP=${domain}`;
            const bwResponse = await fetch(builtWithUrl);
            if (bwResponse.ok) {
              const bwResult = await bwResponse.json();
              if (bwResult.groups) {
                const allTech = [];
                const categories = {};
                for (const group of bwResult.groups) {
                  categories[group.name] = group.categories?.map((c) => c.name) || [];
                  if (group.categories) {
                    for (const cat of group.categories) {
                      if (cat.live && Array.isArray(cat.live)) {
                        allTech.push(...cat.live.map((t) => t.name));
                      }
                    }
                  }
                }
                const allCats = Object.values(categories).flat();
                builtWithData = {
                  domain,
                  techCount: allTech.length,
                  technologies: allTech.slice(0, 30),
                  // Top 30
                  categories,
                  // Core detections (existing)
                  // Category-based fallback (since Free API hides specific tech names)
                  // We check both specific tech names AND category names
                  hasChatTech: allTech.some((t) => /intercom|drift|livechat|zendesk|tidio|crisp|olark|freshchat|tawk|hubspot chat/i.test(t)) || allCats.some((c) => /chat|messaging|help desk/i.test(c)),
                  hasCRMTech: allTech.some((t) => /hubspot|salesforce|pipedrive|zoho|activecampaign|mailchimp|keap|infusionsoft|close\.io|copper/i.test(t)) || allCats.some((c) => /crm|marketing automation|email marketing/i.test(c)),
                  hasAnalytics: allTech.some((t) => /google analytics|gtm|tag manager|hotjar|mixpanel|amplitude|heap|segment|fullstory/i.test(t)) || allCats.some((c) => /analytics|tracking/i.test(c)),
                  hasEcommerce: allTech.some((t) => /shopify|woocommerce|magento|bigcommerce|squarespace|stripe|paypal/i.test(t)) || allCats.some((c) => /ecommerce|shop|cart/i.test(c)),
                  hasCMS: allTech.some((t) => /wordpress|webflow|wix|squarespace|drupal|joomla|ghost/i.test(t)) || allCats.some((c) => /cms|blog|content management/i.test(c)),
                  hasAdTech: allTech.some((t) => /google ads|facebook pixel|linkedin|twitter ads|bing ads|adroll|criteo/i.test(t)) || allCats.some((c) => /advertising|pixel|remarketing/i.test(c)),
                  // NEW: Extended detections for agent opportunities
                  hasCallTracking: allTech.some((t) => /callrail|calltrackingmetrics|whatconverts|invoca|dialogtech|marchex|phonewagon|retreaver/i.test(t)),
                  hasScheduling: allTech.some((t) => /calendly|acuity|hubspot meetings|doodle|simplybook|setmore|booksy|schedulicity|square appointments/i.test(t)),
                  hasSMSMarketing: allTech.some((t) => /twilio|podium|birdeye|textmagic|clicksend|sms|attentive|postscript|klaviyo sms/i.test(t)),
                  hasReviewManagement: allTech.some((t) => /podium|birdeye|reputation\.com|yotpo|trustpilot|grade\.us|reviewtrackers|getfivestars/i.test(t)),
                  hasMarketingAutomation: allTech.some((t) => /marketo|pardot|eloqua|act-on|drip|autopilot|customer\.io|klaviyo/i.test(t)),
                  hasPhoneSystem: allTech.some((t) => /ringcentral|dialpad|vonage|8x8|grasshopper|nextiva|aircall|justcall/i.test(t)),
                  hasHelpDesk: allTech.some((t) => /zendesk|freshdesk|intercom|helpscout|kayako|groove|happyfox/i.test(t)),
                  hasBookingWidget: allTech.some((t) => /calendly|acuity|simplybook|booksy|setmore|mindbody|fresha|vagaro/i.test(t)),
                  // Calculate tech stack score
                  techStackScore: (() => {
                    let score = 0;
                    if (allTech.some((t) => /google analytics|gtm/i.test(t))) score += 15;
                    if (allTech.some((t) => /hubspot|salesforce|pipedrive|zoho/i.test(t))) score += 25;
                    if (allTech.some((t) => /intercom|drift|livechat|zendesk|tidio/i.test(t))) score += 20;
                    if (allTech.some((t) => /mailchimp|klaviyo|activecampaign|constant contact/i.test(t))) score += 15;
                    if (allTech.some((t) => /google ads|facebook pixel/i.test(t))) score += 10;
                    if (allTech.some((t) => /callrail|calltrackingmetrics/i.test(t))) score += 10;
                    if (allTech.length > 20) score += 5;
                    return {
                      score: Math.min(score, 100),
                      level: score >= 70 ? "Advanced" : score >= 40 ? "Moderate" : "Basic",
                      opportunities: 100 - Math.min(score, 100)
                    };
                  })(),
                  // Identify missing critical tech (agent opportunities)
                  missingTech: (() => {
                    const missing = [];
                    if (!allTech.some((t) => /hubspot|salesforce|pipedrive|zoho|activecampaign/i.test(t))) missing.push({ tech: "CRM", agent: "Alex", impact: "Speed-to-lead" });
                    if (!allTech.some((t) => /intercom|drift|livechat|zendesk|tidio|crisp/i.test(t))) missing.push({ tech: "Live Chat", agent: "Chris", impact: "Website conversion" });
                    if (!allTech.some((t) => /callrail|calltrackingmetrics|whatconverts/i.test(t))) missing.push({ tech: "Call Tracking", agent: "Maddie", impact: "Missed call detection" });
                    if (!allTech.some((t) => /mailchimp|klaviyo|activecampaign|constant contact/i.test(t))) missing.push({ tech: "Email Marketing", agent: "Sarah", impact: "Database reactivation" });
                    if (!allTech.some((t) => /podium|birdeye|reputation\.com|trustpilot/i.test(t))) missing.push({ tech: "Review Management", agent: "James", impact: "Reputation monitoring" });
                    if (!allTech.some((t) => /calendly|acuity|simplybook|booksy/i.test(t))) missing.push({ tech: "Online Booking", agent: "Maddie", impact: "Appointment scheduling" });
                    return missing;
                  })()
                };
              }
            } else {
              builtWithData = { _httpError: bwResponse.status, _statusText: bwResponse.statusText, domain };
            }
          }
        } catch (e) {
          console.error("BuiltWith API error:", e);
          builtWithData = { _error: e.message || String(e), _apiKeyPresent: true };
        }
      }
      const phaseADomain = (() => {
        try {
          return new URL(website_url).hostname.replace("www.", "");
        } catch (e) {
          return "";
        }
      })();
      const phaseABizName = (() => {
        const genericWords2 = ["home", "welcome", "about", "contact", "services", "blog", "index", "page", "site", "official"];
        let websiteName = "";
        const ogMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{3,})["']/i) || html.match(/<meta[^>]+content=["']([^"']{3,})["'][^>]+property=["']og:site_name["']/i);
        if (ogMatch) websiteName = ogMatch[1].trim();
        if (!websiteName) {
          const titleMatch = html.match(/<title[^>]*>([^<]{3,})<\/title>/i);
          if (titleMatch) {
            const segments = titleMatch[1].split(/[-|–—:·]/).map((s) => s.trim()).filter((s) => s.length > 2);
            const nonGeneric = segments.filter((s) => !genericWords2.includes(s.toLowerCase().split(" ")[0]));
            websiteName = nonGeneric.length > 0 ? nonGeneric[nonGeneric.length - 1] : segments[segments.length - 1] || "";
          }
        }
        if (googlePlacesData?.name && websiteName) {
          const placesFirst = googlePlacesData.name.toLowerCase().split(" ")[0];
          const siteFirst = websiteName.toLowerCase().split(" ")[0];
          const placesMatchesSite = placesFirst.length >= 3 && (siteFirst.startsWith(placesFirst) || placesFirst.startsWith(siteFirst) || googlePlacesData.name.toLowerCase().includes(siteFirst) || websiteName.toLowerCase().includes(placesFirst));
          if (placesMatchesSite) return googlePlacesData.name;
          return websiteName;
        }
        if (googlePlacesData?.name && !websiteName) return googlePlacesData.name;
        if (websiteName) return websiteName;
        if (phaseADomain) return phaseADomain.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return "";
      })();
      const phaseALogoUrl = `https://logo.clearbit.com/${phaseADomain}`;
      const phaseAIsRunningAds = !!(facebookAdData?.isRunningAds || googleAdsTransparencyData?.isRunningGoogleAds);
      const phaseAFirstName = body.firstName || body.first_name || "";
      let phaseAPrimaryColor = "";
      const themeColorMatch = html.match(/<meta[^>]*name=["']theme-color["'][^>]*content=["']([^"']+)["']/i) || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']theme-color["']/i);
      if (themeColorMatch) phaseAPrimaryColor = themeColorMatch[1];
      const phaseAResponse = {
        success: true,
        scrapeStatus: "phase_a",
        // Core identity (fast)
        business_name: phaseABizName,
        firstName: phaseAFirstName,
        logo_url: phaseALogoUrl,
        primary_color: phaseAPrimaryColor || null,
        // Google Places fast data
        star_rating: googlePlacesData?.rating?.toString() || null,
        review_count: googlePlacesData?.reviewCount?.toString() || null,
        phone: googlePlacesData?.phone || null,
        location: googlePlacesData?.address || quickLocation || null,
        // Ad status (fast API)
        is_running_ads: phaseAIsRunningAds,
        running_ads: phaseAIsRunningAds,
        facebook_ads_running: facebookAdData?.isRunningAds || false,
        google_ads_running: googleAdsTransparencyData?.isRunningGoogleAds || false,
        // Ad intelligence from Apify (Phase A)
        facebook_ads_data: facebookAdData || null,
        google_ads_data: googleAdsTransparencyData || null,
        campaign_analysis: campaignAnalysis || null,
        // Pass-through identifiers
        lid: body._v3_leadId || body.lid || null,
        url: website_url,
        // Signal to frontend that deep data is still processing
        deepScrapeStatus: "processing",
        // Defense 4: Skeleton marketing_intelligence so flatten logic at L6075 never operates on {}
        marketing_intelligence: {
          overallGrade: "pending",
          grades: { speedToLead: { grade: "—", score: null }, reputation: { grade: "—", score: null }, websiteConversion: { grade: "—", score: null }, techStack: { grade: "—", score: null }, adEfficiency: { grade: "—", score: null }, overall: { grade: "—", score: null } },
          adIntelligence: { isRunningAds: false, funnelScore: { score: null, verdict: "pending" }, verdict: "pending" },
          reputationIntelligence: { googleRating: null, reviewCount: null },
          techStackIntelligence: { score: null, level: "pending", missing: [] },
          reviewMining: { agentNeedIndicators: { alex: [], maddie: [], chris: [], sarah: [], james: [] }, summary: { alex: 0, maddie: 0, chris: 0, sarah: 0, james: 0 } },
          landingPageScore: null,
          socialMedia: {},
          scraperResults: { tier: "pending" }
        }
      };
      const leadIdFromRequest = body._v3_leadId || body.lid || url.searchParams.get("lid");

      // ── Phase A KV Write — get real data into KV FAST (before Phase B) ──────
      // Bridge reads lead:{lid}:intel every turn. This merge adds Google Places,
      // ad detection, business name etc. so Bella has real data within ~15-20s.
      // Phase B will overwrite with richer data when it finishes.
      if (leadIdFromRequest && env.LEADS_KV) {
        try {
          const existingRaw = await env.LEADS_KV.get(`lead:${leadIdFromRequest}:intel`);
          const existing = existingRaw ? JSON.parse(existingRaw) : {};
          const phaseAMerge = {
            ...existing,
            // Root-level fields the bridge's website_health synthesizer reads
            star_rating: phaseAResponse.star_rating || existing.star_rating || null,
            review_count: phaseAResponse.review_count || existing.review_count || null,
            location: phaseAResponse.location || existing.location || null,
            logo_url: phaseAResponse.logo_url || existing.logo_url || null,
            business_name: phaseAResponse.business_name || existing.business_name || null,
            is_running_ads: phaseAResponse.is_running_ads || existing.is_running_ads || false,
            facebook_ads_running: phaseAResponse.facebook_ads_running || false,
            google_ads_running: phaseAResponse.google_ads_running || false,
            scrapeStatus: "phase_a",
            phase_a_ts: new Date().toISOString(),
          };
          const mergeStr = JSON.stringify(phaseAMerge);
          await env.LEADS_KV.put(`lead:${leadIdFromRequest}:intel`, mergeStr, { expirationTtl: 2592000 });
          await env.LEADS_KV.put(leadIdFromRequest, mergeStr, { expirationTtl: 2592000 });
          console.log(`[Phase A KV] Merged into lead:${leadIdFromRequest}:intel — rating=${phaseAMerge.star_rating} biz="${phaseAMerge.business_name}" ads=${phaseAMerge.is_running_ads} (${mergeStr.length} bytes)`);
        } catch (phaseAKvErr) {
          console.error(`[Phase A KV] Write FAILED for lid=${leadIdFromRequest}:`, phaseAKvErr.message);
        }
      }

      ctx.waitUntil((async () => {
        const phaseBStart = Date.now();
        console.log(`[Phase B START] lid: ${leadIdFromRequest} — background enrichment beginning at ${new Date().toISOString()}`);
        
        // V3: No timeout — let Phase B run to completion. CF Workers have 30s CPU limit on paid plan.
        
        try {
        {
        try {
          // V3: Gemini retry helper — handles 503 rate limits with exponential backoff
          async function geminiCallWithRetry(url, body, maxRetries = 2) {
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
              if (resp.ok) return resp;
              if (resp.status === 503 && attempt < maxRetries) {
                const delay = 1000 * Math.pow(2, attempt); // 1s, 2s
                console.log(`[Gemini Retry] HTTP 503 — waiting ${delay}ms before retry ${attempt + 1}/${maxRetries}`);
                await new Promise(r => setTimeout(r, delay));
                continue;
              }
              return resp; // non-503 error or final attempt
            }
          }
          let calculateReviewTrends = function (reviews) {
            if (!reviews || reviews.length < 3) return null;
            const now = Date.now() / 1e3;
            const DAY = 86400;
            const last30 = reviews.filter((r) => r.time && now - r.time < 30 * DAY);
            const last90 = reviews.filter((r) => r.time && now - r.time < 90 * DAY);
            const older = reviews.filter((r) => r.time && now - r.time >= 90 * DAY);
            const avg = /* @__PURE__ */ __name((arr) => arr.length > 0 ? arr.reduce((s, r) => s + r.rating, 0) / arr.length : null, "avg");
            const avgLast30 = avg(last30);
            const avgLast90 = avg(last90);
            const avgOlder = avg(older);
            let trend = "stable";
            let trendMessage = "";
            if (avgLast90 !== null && avgOlder !== null) {
              const change = avgLast90 - avgOlder;
              if (change > 0.3) {
                trend = "improving";
                trendMessage = `Rating improved ${change.toFixed(1)} stars in 90 days`;
              } else if (change < -0.3) {
                trend = "declining";
                trendMessage = `Rating dropped ${Math.abs(change).toFixed(1)} stars - James can reverse this`;
              }
            }
            return {
              trend,
              trendMessage,
              last30Days: { count: last30.length, avgRating: avgLast30 },
              last90Days: { count: last90.length, avgRating: avgLast90 },
              older: { count: older.length, avgRating: avgOlder },
              recentVelocity: last30.length > 0 ? "active" : last90.length > 0 ? "moderate" : "slow"
            };
          }, resolveLogo = function (websiteLogoUrl, ogImage2, googlePlacesData2, domain, apiKey) {
            const sources = [];
            if (websiteLogoUrl && !websiteLogoUrl.includes("placeholder")) {
              sources.push({ url: websiteLogoUrl, source: "website_logo", confidence: "high", tier: 1 });
            }
            if (ogImage2 && !ogImage2.includes("placeholder") && !ogImage2.includes("stock")) {
              sources.push({ url: ogImage2, source: "og_image", confidence: "medium", tier: 2 });
            }
            if (googlePlacesData2?.photoRefs && googlePlacesData2.photoRefs.length > 0) {
              const logoLikePhotos = googlePlacesData2.photoRefs.filter((p) => {
                if (!p.width || !p.height) return false;
                const aspectRatio = p.width / p.height;
                return aspectRatio >= 0.8 && aspectRatio <= 1.2;
              });
              if (logoLikePhotos.length > 0) {
                const photoRef = logoLikePhotos[0].ref;
                const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoRef}&key=${apiKey}`;
                sources.push({ url: photoUrl, source: "google_places_photo", confidence: "medium", tier: 3 });
              } else if (googlePlacesData2.photoRefs[0]) {
                const photoRef = googlePlacesData2.photoRefs[0].ref;
                const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoRef}&key=${apiKey}`;
                sources.push({ url: photoUrl, source: "google_places_photo", confidence: "low", tier: 4 });
              }
            }
            if (domain) {
              sources.push({ url: `https://logo.clearbit.com/${domain}`, source: "clearbit", confidence: "low", tier: 5 });
            }
            if (sources.length === 0) {
              return null;
            }
            sources.sort((a, b) => a.tier - b.tier);
            return {
              primary: sources[0],
              alternates: sources.slice(1),
              sourceCount: sources.length
            };
          }, analyzeAdCTA = function (ctaText) {
            if (!ctaText) return { cta: "unknown", score: 3, type: "unknown", isMoneyLeak: true, isCriticalFail: true };
            const normalized = ctaText.toLowerCase().trim().replace(/_/g, " ");
            for (const [cta, data] of Object.entries(CTA_SCORING)) {
              if (normalized.includes(cta)) {
                return {
                  cta,
                  score: data.score,
                  type: data.type,
                  isMoneyLeak: data.score < 5,
                  isCriticalFail: data.score <= 2,
                  // Traffic CTAs with no conversion path
                  agentOpportunity: data.agentOpportunity,
                  recommendation: data.score <= 2 ? `\u{1F6A8} CRITICAL: You're paying for traffic with no conversion path. Every click is wasted.` : data.score < 5 ? `\u26A0\uFE0F Money leak: Low-intent CTA. Add Chris to capture these visitors.` : `\u2705 Good CTA. Consider Alex for faster follow-up.`
                };
              }
            }
            return {
              cta: ctaText,
              score: 3,
              type: "unknown",
              isMoneyLeak: true,
              isCriticalFail: false,
              agentOpportunity: "Chris to capture traffic",
              recommendation: "\u26A0\uFE0F Unknown CTA type. Recommend adding a website concierge."
            };
          }, calculateAdFunnelScore = function (fbAdData, googleAdData, hasCRM2, hasChatWidget2, hasVoiceAI) {
            const issues = [];
            let score = 100;
            const isRunningFBAds = fbAdData?.isRunningAds || false;
            const isRunningGoogleAds = googleAdData?.isRunningGoogleAds || false;
            const isRunningAnyAds = isRunningFBAds || isRunningGoogleAds;
            const fbMonthlySpend = fbAdData?.estimatedSpend?.monthly || (isRunningFBAds ? 2e3 : 0);
            const googleMonthlySpend = isRunningGoogleAds ? 3e3 : 0;
            const totalMonthlySpend = fbMonthlySpend + googleMonthlySpend;
            if (isRunningAnyAds && !hasCRM2) {
              score -= 35;
              const weeklyWaste = Math.round(totalMonthlySpend / 4 * 0.78);
              issues.push({
                issue: `Running ${isRunningGoogleAds && isRunningFBAds ? "Google + Facebook" : isRunningGoogleAds ? "Google" : "Facebook"} ads with no speed-to-lead system`,
                impact: `MIT study: 78% of leads go to whichever business responds FIRST`,
                fix: `Alex can follow up in <60 seconds via SMS/email`,
                weeklyLoss: Math.max(weeklyWaste, 400),
                severity: "critical"
              });
            }
            if (isRunningAnyAds && !hasChatWidget2 && !hasVoiceAI) {
              score -= 25;
              const weeklyWaste = Math.round(totalMonthlySpend / 4 * 0.4);
              issues.push({
                issue: `Sending ad traffic to website with no chat or voice AI`,
                impact: `Forrester: Chat increases conversions by 40% - visitors leaving without engaging`,
                fix: `Add Chris as 24/7 website concierge to capture these visitors`,
                weeklyLoss: Math.max(weeklyWaste, 300),
                severity: "warning"
              });
            }
            if (fbAdData?.primaryCTA) {
              const ctaAnalysis = analyzeAdCTA(fbAdData.primaryCTA);
              if (ctaAnalysis.isCriticalFail) {
                score -= 30;
                issues.push({
                  issue: `Critical Facebook CTA fail: "${fbAdData.primaryCTA}"`,
                  impact: `Clicks lead nowhere - complete waste of ad spend`,
                  fix: `Add Chris as website concierge to capture these clicks`,
                  weeklyLoss: Math.round(fbMonthlySpend / 4 * 0.7),
                  severity: "critical"
                });
              } else if (ctaAnalysis.isMoneyLeak) {
                score -= 15;
                issues.push({
                  issue: `Low-intent Facebook CTA: "${fbAdData.primaryCTA}"`,
                  impact: `Traffic but weak lead capture - visitors browse and leave`,
                  fix: `Add Chris to proactively engage and convert visitors`,
                  weeklyLoss: Math.round(fbMonthlySpend / 4 * 0.3),
                  severity: "warning"
                });
              }
            }
            if (fbAdData?.oldestAdAgeDays && fbAdData.oldestAdAgeDays > 90) {
              score -= 15;
              issues.push({
                issue: `Facebook ad running for ${fbAdData.oldestAdAgeDays} days without refresh`,
                impact: `AdEspresso study: CTR drops ~50% after 90 days of same creative`,
                fix: `Sarah can A/B test new messaging based on customer feedback`,
                weeklyLoss: Math.round(fbMonthlySpend * 0.15 / 4),
                severity: "warning"
              });
            }
            if (isRunningAnyAds && !hasVoiceAI) {
              score -= 20;
              const afterHoursLoss = Math.round(totalMonthlySpend / 4 * 0.4 * 0.5);
              issues.push({
                issue: `Ad traffic arriving 24/7 but no after-hours response capability`,
                impact: `~40% of clicks happen outside 9-5. These leads call, get voicemail, call competitor`,
                fix: `Maddie answers every call 24/7, qualifies leads, books appointments`,
                weeklyLoss: Math.max(afterHoursLoss, 200),
                severity: "warning"
              });
            }
            if (issues.length === 0 && isRunningAnyAds) {
              score -= 10;
              issues.push({
                issue: `Good funnel but no proactive engagement`,
                impact: `Industry avg: 97% of website visitors leave without converting`,
                fix: `Chris can proactively engage hesitant visitors before they leave`,
                weeklyLoss: Math.round(totalMonthlySpend / 4 * 0.15),
                severity: "opportunity"
              });
            }
            if (!isRunningAnyAds) {
              issues.push({
                issue: `No active advertising detected`,
                impact: `Competitors running ads are capturing market share`,
                fix: `When you do run ads, ensure Chris/Alex capture every lead`,
                weeklyLoss: 0,
                // Can't quantify without ad spend
                severity: "info"
              });
            }
            const totalWeeklyLoss = issues.reduce((sum, i) => sum + (i.weeklyLoss || 0), 0);
            const adjustedWeeklyLoss = isRunningAnyAds ? Math.max(totalWeeklyLoss, 200) : totalWeeklyLoss;
            let verdict;
            if (score > 80) verdict = "Minor Opportunities";
            else if (score > 60) verdict = "Leaking Money";
            else if (score > 40) verdict = "Significant Leaks";
            else verdict = "Hemorrhaging Cash";
            return {
              score: Math.max(0, score),
              issues,
              totalWeeklyLoss: adjustedWeeklyLoss,
              totalMonthlyLoss: adjustedWeeklyLoss * 4,
              estimatedMonthlyAdSpend: totalMonthlySpend,
              verdict,
              hasCriticalIssues: issues.some((i) => i.severity === "critical"),
              isRunningAds: isRunningAnyAds,
              platforms: {
                google: isRunningGoogleAds,
                facebook: isRunningFBAds
              }
            };
          }, mineReviewsForAgentNeeds = function (reviews) {
            if (!reviews || !Array.isArray(reviews)) return null;
            const results = {
              alex: [],
              maddie: [],
              chris: [],
              sarah: [],
              james: [],
              sarahSleepingGiant: []
              // Old positive reviews > 1 year
            };
            reviews.forEach((review) => {
              const textLower = (review.text || "").toLowerCase();
              for (const [agent, keywords] of Object.entries(AGENT_NEED_KEYWORDS)) {
                for (const keyword of keywords) {
                  if (textLower.includes(keyword)) {
                    results[agent].push({
                      keyword,
                      text: review.text.substring(0, 300),
                      rating: review.rating,
                      relativeTime: review.relativeTime || review.relative_time_description,
                      source: "Google"
                    });
                    break;
                  }
                }
              }
              if (review.isOldPositive || review.rating >= 4 && review.time && Date.now() / 1e3 - review.time > 31536e3) {
                results.sarahSleepingGiant.push({
                  text: review.text?.substring(0, 200) || "",
                  rating: review.rating,
                  relativeTime: review.relativeTime || review.relative_time_description,
                  source: "Google"
                });
              }
            });
            const allAgentNeeds = [...results.alex, ...results.maddie, ...results.chris];
            const showListenToPublic = allAgentNeeds.filter((r) => r.rating <= 3).length >= 3;
            return {
              agentNeedIndicators: results,
              listenToThePublic: showListenToPublic ? allAgentNeeds.filter((r) => r.rating <= 3).slice(0, 4) : [],
              showListenToPublic,
              sarahSleepingGiantCount: results.sarahSleepingGiant.length,
              summary: {
                alex: results.alex.length,
                maddie: results.maddie.length,
                chris: results.chris.length,
                sarah: results.sarah.length + results.sarahSleepingGiant.length,
                james: results.james.length
              }
            };
          }, normalizeIndustryKey = function (industry2) {
            if (!industry2) return null;
            const lower = industry2.toLowerCase().replace(/[^a-z\s\/]/g, "");
            if (INDUSTRY_BENCHMARKS[lower]) return lower;
            for (const key of Object.keys(INDUSTRY_BENCHMARKS)) {
              if (lower.includes(key) || key.includes(lower)) return key;
            }
            const aliases = {
              "real estate": "realestate",
              "property": "real estate",
              "dentist": "dental",
              "lawyer": "legal",
              "attorney": "legal",
              "mechanic": "automotive",
              "physio": "physiotherapy",
              "chiro": "chiropractic",
              "vet": "veterinary",
              "gym": "fitness"
            };
            for (const [alias, key] of Object.entries(aliases)) {
              if (lower.includes(alias)) return key;
            }
            return null;
          }, calculateFixRevenue = function (fixId, industryKey, reviewCount2, isRunningAds, userProvidedValue) {
            const normalizedKey = normalizeIndustryKey(industryKey);
            const benchmarks = normalizedKey ? INDUSTRY_BENCHMARKS[normalizedKey] : null;
            const impact = FIX_IMPACTS[fixId];
            if (!impact) return null;
            const avgValue = userProvidedValue || benchmarks?.avgClientValue || benchmarks?.avgJobValue || null;
            if (!avgValue) return null;
            let sizeScalar = 1;
            if (reviewCount2 <= 10) sizeScalar = 0.5;
            else if (reviewCount2 <= 50) sizeScalar = 1;
            else if (reviewCount2 <= 200) sizeScalar = 2;
            else sizeScalar = 5;
            const baseLeads = benchmarks?.avgMonthlyLeads || 30;
            let estimatedLeads = baseLeads * sizeScalar;
            if (isRunningAds) estimatedLeads *= 1.5;
            const conversionRate = benchmarks?.conversionRate || 0.05;
            const baseRevenue = estimatedLeads * conversionRate * avgValue;
            const improvedRevenue = baseRevenue * (impact.multiplier - 1);
            return {
              monthlyRevenue: Math.round(improvedRevenue),
              confidence: reviewCount2 > 10 ? "High" : "Medium",
              study: impact.study,
              hasFinancials: true
            };
          }, buildPrioritizedFixes = function (fixes, industryKey, reviewCount2, isRunningAds, businessName2, userProvidedValue) {
            const allFixes = [];
            let hasFinancials = false;
            if (fixes.needsSpeedToLead) {
              const revenue = calculateFixRevenue("speedToLead", industryKey, reviewCount2, isRunningAds, userProvidedValue);
              if (revenue) hasFinancials = true;
              allFixes.push({
                ...FIX_IMPACTS.speedToLead,
                detected: true,
                monthlyRevenue: revenue?.monthlyRevenue || null,
                hasFinancials: !!revenue,
                confidence: revenue?.confidence || "N/A",
                copyHeadline: `We noticed ${businessName2} is running ads but has no instant follow-up system`,
                copyBody: revenue ? `Studies show 78% of leads go with whoever responds first. You could be losing $${revenue.monthlyRevenue.toLocaleString()}+/month.` : `Studies show 78% of leads go with whoever responds first. You could be losing leads by not responding instantly.`
              });
            }
            if (fixes.needsWebsiteConcierge) {
              const revenue = calculateFixRevenue("websiteConcierge", industryKey, reviewCount2, isRunningAds, userProvidedValue);
              if (revenue) hasFinancials = true;
              allFixes.push({
                ...FIX_IMPACTS.websiteConcierge,
                detected: true,
                monthlyRevenue: revenue?.monthlyRevenue || null,
                hasFinancials: !!revenue,
                confidence: revenue?.confidence || "N/A",
                copyHeadline: `${businessName2} doesn't have a 24/7 website assistant`,
                copyBody: revenue ? `Visitors are leaving without engaging. A website concierge could capture an extra $${revenue.monthlyRevenue.toLocaleString()}+/month.` : `Visitors are leaving without engaging. A website concierge could capture significantly more leads.`
              });
            }
            if (fixes.needsReputationManagement) {
              const revenue = calculateFixRevenue("reputationManagement", industryKey, reviewCount2, isRunningAds, userProvidedValue);
              if (revenue) hasFinancials = true;
              const rating = fixes.googleRating || "Unknown";
              allFixes.push({
                ...FIX_IMPACTS.reputationManagement,
                detected: true,
                monthlyRevenue: revenue?.monthlyRevenue || null,
                hasFinancials: !!revenue,
                confidence: revenue?.confidence || "N/A",
                copyHeadline: `${businessName2}'s ${rating}-star rating is costing you customers`,
                copyBody: revenue ? `A 0.5-star increase can boost conversions by 9%. That's potentially $${revenue.monthlyRevenue.toLocaleString()}+/month you're missing.` : `A 0.5-star increase can boost conversions by 9%. You're likely missing significant revenue.`
              });
            }
            if (fixes.needsReviewResponseManagement) {
              const revenue = calculateFixRevenue("reviewResponse", industryKey, reviewCount2, isRunningAds, userProvidedValue);
              if (revenue) hasFinancials = true;
              allFixes.push({
                ...FIX_IMPACTS.reviewResponse,
                detected: true,
                monthlyRevenue: revenue?.monthlyRevenue || null,
                hasFinancials: !!revenue,
                confidence: revenue?.confidence || "N/A",
                copyHeadline: `Customers are waiting for ${businessName2} to respond to reviews`,
                copyBody: revenue ? `89% of consumers read business responses. Unanswered reviews could be costing $${revenue.monthlyRevenue.toLocaleString()}+/month in lost trust.` : `89% of consumers read business responses. Unanswered reviews are costing you trust and customers.`
              });
            }
            if (fixes.needsCallHandling) {
              const revenue = calculateFixRevenue("callHandling", industryKey, reviewCount2, isRunningAds, userProvidedValue);
              if (revenue) hasFinancials = true;
              allFixes.push({
                ...FIX_IMPACTS.callHandling,
                detected: true,
                monthlyRevenue: revenue?.monthlyRevenue || null,
                hasFinancials: !!revenue,
                confidence: revenue?.confidence || "N/A",
                copyHeadline: `Every missed call at ${businessName2} is money walking away`,
                copyBody: revenue ? `With no AI receptionist detected, you could be missing $${revenue.monthlyRevenue.toLocaleString()}+/month in unanswered opportunities.` : `With no AI receptionist detected, you could be missing significant opportunities from unanswered calls.`
              });
            }
            if (fixes.needsDatabaseReactivation) {
              const revenue = calculateFixRevenue("databaseReactivation", industryKey, reviewCount2, isRunningAds, userProvidedValue);
              if (revenue) hasFinancials = true;
              allFixes.push({
                ...FIX_IMPACTS.databaseReactivation,
                detected: true,
                monthlyRevenue: revenue?.monthlyRevenue || null,
                hasFinancials: !!revenue,
                confidence: revenue?.confidence || "N/A",
                copyHeadline: `${businessName2} has leads that haven't been contacted in months`,
                copyBody: revenue ? `You've already paid to acquire these leads. Reactivating just 5% could mean $${revenue.monthlyRevenue.toLocaleString()}+/month recovered.` : `You've already paid to acquire these leads. Reactivating just 5% could mean significant recovered revenue.`
              });
            }
            if (fixes.needsLeadCapture) {
              const revenue = calculateFixRevenue("leadCapture", industryKey, reviewCount2, isRunningAds, userProvidedValue);
              if (revenue) hasFinancials = true;
              allFixes.push({
                ...FIX_IMPACTS.leadCapture,
                detected: true,
                monthlyRevenue: revenue?.monthlyRevenue || null,
                hasFinancials: !!revenue,
                confidence: revenue?.confidence || "N/A",
                copyHeadline: `${businessName2}'s website visitors are leaving without a way to connect`,
                copyBody: revenue ? `No lead capture forms detected. You could be missing $${revenue.monthlyRevenue.toLocaleString()}+/month in unconverted visitors.` : `No lead capture forms detected. You could be missing significant revenue from unconverted visitors.`
              });
            }
            allFixes.sort((a, b) => (b.monthlyRevenue || 0) - (a.monthlyRevenue || 0));
            return {
              topFixes: allFixes.slice(0, 4),
              additionalFixes: allFixes.slice(4),
              totalMonthlyOpportunity: allFixes.reduce((sum, f) => sum + (f.monthlyRevenue || 0), 0),
              hasFinancials,
              fixCount: allFixes.length
            };
          }, scoreToGrade = function (score) {
            if (score >= 90) return "A";
            if (score >= 80) return "B+";
            if (score >= 70) return "B";
            if (score >= 60) return "C+";
            if (score >= 50) return "C";
            if (score >= 40) return "D+";
            if (score >= 30) return "D";
            return "F";
          };
          __name(calculateReviewTrends, "calculateReviewTrends");
          __name(resolveLogo, "resolveLogo");
          __name(analyzeAdCTA, "analyzeAdCTA");
          __name(calculateAdFunnelScore, "calculateAdFunnelScore");
          __name(mineReviewsForAgentNeeds, "mineReviewsForAgentNeeds");
          __name(normalizeIndustryKey, "normalizeIndustryKey");
          __name(calculateFixRevenue, "calculateFixRevenue");
          __name(buildPrioritizedFixes, "buildPrioritizedFixes");
          __name(scoreToGrade, "scoreToGrade");
          traceLog.push("Phase B: Background Gemini pipeline starting");
          traceLog.push(`Gemini Tech Start. Existing data: ${!!builtWithData} CleanBlob: ${!!cleanBlob}`);
          if (env.GEMINI_API_KEY && (!builtWithData || builtWithData.techCount === 0) && cleanBlob) {
            try {
              const techPrompt = `Analyze this website content and identify the technology stack.
                    Look for specific signatures of:
                    - CMS (WordPress, Shopify, Webflow, etc)
                    - LIVE CHAT (Intercom, Drift, Tawk.to, etc)
                    - CRM/MARKETING (HubSpot, Salesforce, Mailchimp, etc)
                    - ANALYTICS (Google Analytics, GTM, etc)
                    
                    Content: ${cleanBlob.substring(0, 5e3)}
                    
                    Return ONLY valid JSON:
                    {"technologies":["TechName1", "TechName2"], "has_chat": boolean, "has_crm": boolean, "has_ecommerce": boolean}`;
              const techResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: techPrompt }] }]
                  })
                }
              );
              if (techResponse.ok) {
                const techResult = await techResponse.json();
                const techText = techResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";
                const jsonMatch = techText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  const detected = JSON.parse(jsonMatch[0]);
                  if (!builtWithData) {
                    builtWithData = {
                      domain: new URL(website_url).hostname,
                      techCount: 0,
                      technologies: [],
                      categories: {}
                    };
                  }
                  if (detected.technologies && Array.isArray(detected.technologies)) {
                    builtWithData.technologies.push(...detected.technologies);
                    builtWithData.techCount += detected.technologies.length;
                    builtWithData.geminiDetected = true;
                  }
                  if (detected.has_chat) builtWithData.hasChatTech = true;
                  if (detected.has_crm) builtWithData.hasCRMTech = true;
                  if (detected.has_ecommerce) builtWithData.hasEcommerce = true;
                }
              }
            } catch (e) {
              console.error("Gemini Tech Detect Error", e);
              if (!builtWithData) {
                builtWithData = {
                  domain: new URL(website_url).hostname,
                  techCount: 0,
                  technologies: [],
                  categories: {},
                  _geminiError: e.message || String(e)
                };
              }
            }
          }
          traceLog.push(`Final FailSafe Check. Has data: ${!!builtWithData}`);
          if (!builtWithData) {
            traceLog.push("Triggering Final FailSafe");
            builtWithData = {
              domain: new URL(website_url).hostname,
              techCount: 0,
              technologies: [],
              categories: {},
              _finalFallback: true
            };
          }
          let scraperTier = "primary";
          let scraperApiData = null;
          let firecrawlData = null;
          let zenrowsData = null;
          if (env.SCRAPINGANT_KEY && (!html || html.length < 1e3)) {
            traceLog.push("TIER 1: ScrapingAnt Start (primary fallback)");
            try {
              const scraperApiUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(website_url)}&x-api-key=${env.SCRAPINGANT_KEY}&render_js=true`;
              const saResponse = await fetch(scraperApiUrl);
              if (saResponse.ok) {
                const saHtml = await saResponse.text();
                if (saHtml && saHtml.length > 1e3) {
                  html = saHtml;
                  scraperApiData = { success: true, source: "scraperapi", bytesReceived: saHtml.length };
                  scraperTier = "scraperapi";
                  traceLog.push(`ScraperAPI Success: ${saHtml.length} bytes`);
                } else {
                  traceLog.push("ScraperAPI: Response too small, trying Firecrawl");
                }
              } else {
                traceLog.push(`ScraperAPI Failed: HTTP ${saResponse.status}, trying Firecrawl`);
              }
            } catch (e) {
              traceLog.push(`ScraperAPI Error: ${e.message}, trying Firecrawl`);
            }
          }
          const needsFirecrawl = !html || html.length < 1e3 || scraperTier === "primary";
          if (env.FIRECRAWL_API_KEY && needsFirecrawl) {
            traceLog.push("TIER 2: Firecrawl Start (LLM-optimized)");
            try {
              const firecrawlUrl = "https://api.firecrawl.dev/v0/scrape";
              const fcResponse = await fetch(firecrawlUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${env.FIRECRAWL_API_KEY}`,
                  "Content-Type": "application/json"
                },
                body: JSON.stringify({
                  url: website_url,
                  pageOptions: {
                    onlyMainContent: true,
                    includeHtml: false
                  }
                })
              });
              if (fcResponse.ok) {
                const fcResult = await fcResponse.json();
                if (fcResult.success && fcResult.data) {
                  firecrawlData = {
                    markdown: fcResult.data.markdown || null,
                    title: fcResult.data.metadata?.title || null,
                    description: fcResult.data.metadata?.description || null,
                    ogImage: fcResult.data.metadata?.ogImage || null,
                    links: fcResult.data.links?.slice(0, 20) || []
                  };
                  if (firecrawlData.markdown && firecrawlData.markdown.length > 500) {
                    cleanBlob = firecrawlData.markdown;
                    scraperTier = "firecrawl";
                    traceLog.push(`Firecrawl Success: ${firecrawlData.markdown.length} chars markdown \u2192 cleanBlob`);
                  }
                  if (!html || html.length < 1e3) {
                    traceLog.push("Firecrawl: No HTML but got markdown content");
                  }
                }
              } else {
                traceLog.push(`Firecrawl Failed: HTTP ${fcResponse.status}, trying ZenRows`);
              }
            } catch (e) {
              traceLog.push(`Firecrawl Error: ${e.message}, trying ZenRows`);
            }
          }
          if (env.SCRAPINGANT_KEY && (!html || html.length < 1e3)) {
            traceLog.push("TIER 3: ScrapingAnt JS Render Start (anti-bot specialist)");
            try {
              const antBotUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(website_url)}&x-api-key=${env.SCRAPINGANT_KEY}&browser=true&wait_for_selector=body`;
              const zrResponse = await fetch(antBotUrl);
              if (zrResponse.ok) {
                const zrHtml = await zrResponse.text();
                if (zrHtml && zrHtml.length > 1e3) {
                  html = zrHtml;
                  zenrowsData = { success: true, source: "zenrows", bytesReceived: zrHtml.length };
                  scraperTier = "zenrows";
                  traceLog.push(`ZenRows Success: ${zrHtml.length} bytes`);
                }
              } else {
                traceLog.push(`ZenRows Failed: HTTP ${zrResponse.status}`);
              }
            } catch (e) {
              traceLog.push(`ZenRows Error: ${e.message}`);
            }
          }
          if (!html || html.length < 1e3) {
            scraperTier = "protected_site";
            traceLog.push("ALL TIERS FAILED: Site marked as protected");
          }
          let outscraperData = null;
          let extendedReviews = null;
          const googleReviewCount = googlePlacesData?.reviewCount || 0;
          const shouldFetchExtendedReviews = env.OUTSCRAPER_API_KEY && googlePlacesData?.reviews?.length === 5 && // We got max 5 from Google
            googleReviewCount >= 20;
          if (shouldFetchExtendedReviews) {
            traceLog.push(`Outscraper Start (prospect has ${googleReviewCount} reviews, got 5 from Google)`);
            try {
              const reviewsToFetch = Math.min(30, googleReviewCount - 5);
              const outscraperUrl = `https://api.app.outscraper.com/maps/reviews-v3?query=${encodeURIComponent(quickBusinessName + " " + quickLocation)}&reviewsLimit=${reviewsToFetch}&sort=newest&async=false`;
              const osResponse = await fetch(outscraperUrl, {
                headers: { "X-API-KEY": env.OUTSCRAPER_API_KEY }
              });
              if (osResponse.ok) {
                const osResult = await osResponse.json();
                if (osResult.data && osResult.data[0] && osResult.data[0].reviews_data) {
                  extendedReviews = osResult.data[0].reviews_data.map((r) => ({
                    rating: r.review_rating,
                    text: r.review_text,
                    time: r.review_datetime_utc,
                    authorName: r.author_title
                  }));
                  outscraperData = {
                    reviewsFetched: extendedReviews.length,
                    totalAvailable: googleReviewCount,
                    source: "outscraper"
                  };
                  if (googlePlacesData && extendedReviews.length > 0) {
                    googlePlacesData.reviews = [
                      ...googlePlacesData.reviews || [],
                      ...extendedReviews
                    ].slice(0, 50);
                  }
                  traceLog.push(`Outscraper Success: +${extendedReviews.length} reviews (total: ${googlePlacesData?.reviews?.length || 0})`);
                }
              } else {
                traceLog.push(`Outscraper Failed: HTTP ${osResponse.status}`);
              }
            } catch (e) {
              traceLog.push(`Outscraper Error: ${e.message}`);
            }
          } else if (env.OUTSCRAPER_API_KEY) {
            traceLog.push(`Outscraper Skipped: Only ${googleReviewCount} reviews (threshold: 20+) or got <5 from Google`);
          }
          let apifyData = {
            linkedIn: null,
            jobPostings: null,
            facebookPage: null
          };
          let hiringSignals = null;
          // Fix 6: Skip slow Apify hiring calls when /log-lead flow — Deep Track handles them
          if (env.APIFY_API_KEY && !body._v3_leadId) {
            const companyName = quickBusinessName || new URL(website_url).hostname.split(".")[0];
            traceLog.push("Apify Indeed Start");
            try {
              const indeedActorUrl = "https://api.apify.com/v2/acts/misceres~indeed-scraper/run-sync-get-dataset-items";
              const jobResponse = await fetch(`${indeedActorUrl}?token=${env.APIFY_API_KEY}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  queries: `"${companyName}" (sales OR SDR OR "business development" OR marketing OR growth OR "office manager" OR receptionist OR "customer service")`,
                  country: "AU",
                  maxItems: 5,
                  proxy: { useApifyProxy: true }
                })
              });
              if (jobResponse.ok) {
                const jobs = await jobResponse.json();
                const relevantJobs = (jobs || []).filter((job) => {
                  const title2 = (job.title || "").toLowerCase();
                  return title2.includes("receptionist") || title2.includes("admin") || title2.includes("customer service") || title2.includes("office manager") || title2.includes("front desk") || title2.includes("sales") || title2.includes("business development") || title2.includes("sdr") || title2.includes("marketing") || title2.includes("account manager") || title2.includes("growth");
                });
                if (relevantJobs.length > 0) {
                  hiringSignals = {
                    isHiring: true,
                    hiringRoles: relevantJobs.map((j) => ({
                      title: j.title,
                      salary: j.salary,
                      posted: j.postedAt,
                      url: j.url,
                      description: j.description,
                      // Added description
                      source: "Indeed"
                    })),
                    relevantForMaddie: true,
                    // Default true, refined below
                    heroOverrideTrigger: true,
                    salesHook: `You're hiring a ${relevantJobs[0].title}${relevantJobs[0].salary ? ` at ${relevantJobs[0].salary}` : ""} - we can help.`
                  };
                  traceLog.push(`Indeed: Found ${relevantJobs.length} relevant hiring signals!`);
                }
                apifyData.jobPostings = { searched: true, found: jobs?.length || 0, relevant: relevantJobs.length };
              }
            } catch (e) {
              traceLog.push(`Apify Indeed Error: ${e.message}`);
            }
            if (!hiringSignals || hiringSignals.hiringRoles.length === 0) {
              traceLog.push("Apify Seek Start");
              try {
                const seekActorUrl = "https://api.apify.com/v2/acts/shahidirfan~seek-job-scraper/run-sync-get-dataset-items";
                const seekResponse = await fetch(`${seekActorUrl}?token=${env.APIFY_API_KEY}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    keyword: companyName,
                    // Search for the specific company
                    location: "Australia",
                    limit: 10
                  })
                });
                if (seekResponse.ok) {
                  const seekJobs = await seekResponse.json();
                  const relevantSeekJobs = (seekJobs || []).filter((job) => {
                    const title2 = (job.title || "").toLowerCase();
                    return title2.includes("receptionist") || title2.includes("admin") || title2.includes("sales") || title2.includes("marketing") || title2.includes("customer service") || title2.includes("growth");
                  });
                  if (relevantSeekJobs.length > 0) {
                    hiringSignals = {
                      isHiring: true,
                      hiringRoles: relevantSeekJobs.map((j) => ({
                        title: j.title,
                        salary: j.salary,
                        // Critical for pitch
                        posted: j.listingDate || j.postedTime,
                        // Normalizing field name
                        url: j.url,
                        description: j.description || j.content || null,
                        // Best effort fetch
                        source: "Seek"
                      })),
                      relevantForMaddie: true,
                      heroOverrideTrigger: true,
                      salesHook: `I see you have a live Seek ad for a ${relevantSeekJobs[0].title}...`
                    };
                    traceLog.push(`Seek: Found ${relevantSeekJobs.length} jobs.`);
                  }
                  apifyData.seekPostings = { searched: true, found: seekJobs?.length || 0, relevant: relevantSeekJobs.length };
                }
              } catch (e) {
                traceLog.push(`Apify Seek Error: ${e.message}`);
              }
            }
            if (companyName && companyName.length > 2) {
              traceLog.push("Apify LinkedIn Start");
              try {
                const linkedInActorUrl = "https://api.apify.com/v2/acts/anchor~linkedin-company-scraper/run-sync-get-dataset-items";
                const liResponse = await fetch(`${linkedInActorUrl}?token=${env.APIFY_API_KEY}`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    searchUrls: [`https://www.linkedin.com/company/${companyName.toLowerCase().replace(/\s+/g, "-")}`],
                    proxy: { useApifyProxy: true }
                  })
                });
                if (liResponse.ok) {
                  const liData = await liResponse.json();
                  if (liData && liData[0]) {
                    apifyData.linkedIn = {
                      employeeCount: liData[0].employeeCount,
                      industry: liData[0].industry,
                      headquarters: liData[0].headquarters,
                      founded: liData[0].founded,
                      specialties: liData[0].specialties
                    };
                    traceLog.push(`LinkedIn: ${liData[0].employeeCount || "unknown"} employees`);
                  }
                }
              } catch (e) {
                traceLog.push(`Apify LinkedIn Error: ${e.message}`);
              }
            }
          }
          let geminiIntelligence = null;
          if (env.GEMINI_API_KEY && googlePlacesData?.reviews && googlePlacesData.reviews.length > 0) {
            try {
              const reviewTexts = googlePlacesData.reviews.filter((r) => r.text && r.text.length > 10).slice(0, 10).map((r, i) => `[${i + 1}] ${r.rating}\u2B50 - "${r.text}"`).join("\n\n");
              const reviewAnalysisPrompt = `You are analyzing Google reviews for "${quickBusinessName}". 

For each review, provide:
1. SENTIMENT: positive, negative, or neutral
2. AGENT_MATCH: Which of our AI agents could help with the pain/praise mentioned?
   - Alex: Speed-to-Lead (slow response, no follow-up, waiting too long)
   - Maddie: Call Handling (missed calls, can't reach, voicemail)  
   - Chris: Website Concierge (confusing website, no chat, questions unanswered)
   - Sarah: Database Reactivation (past customer, dormant, haven't returned)
   - James: Reputation Management (reviews, ratings, trust)
3. QUOTABLE_SCORE: 1-10 rating of how powerful this quote would be for sales
4. PAIN_POINT: What specific problem is mentioned (if any)?
5. KEY_QUOTE: The most impactful sentence we could use verbatim

Reviews:
${reviewTexts}

Return ONLY valid JSON array with this structure for each review:
[{"sentiment":"positive","agent_match":"none","quotable_score":5,"pain_point":null,"key_quote":"..."},...]`;
              const geminiResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: reviewAnalysisPrompt }] }],
                    generationConfig: { temperature: 0.2, maxOutputTokens: 2e3 }
                  })
                }
              );
              if (geminiResponse.ok) {
                const geminiResult = await geminiResponse.json();
                const geminiText = geminiResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";
                const jsonMatch = geminiText.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                  try {
                    const analysisArray = JSON.parse(jsonMatch[0]);
                    const topQuotes = analysisArray.filter((a) => a.quotable_score >= 5 && a.key_quote).sort((a, b) => b.quotable_score - a.quotable_score).slice(0, 3).map((a) => ({
                      quote: a.key_quote,
                      score: a.quotable_score,
                      sentiment: a.sentiment,
                      agent: a.agent_match
                    }));
                    const agentMentions = analysisArray.reduce((acc, a) => {
                      if (a.agent_match && a.agent_match !== "none") {
                        acc[a.agent_match] = (acc[a.agent_match] || 0) + 1;
                      }
                      return acc;
                    }, {});
                    const allPainPoints = analysisArray.filter((a) => a.pain_point).map((a) => a.pain_point);
                    geminiIntelligence = {
                      reviewAnalysis: analysisArray,
                      topQuotes,
                      agentOpportunities: agentMentions,
                      painPointsSummary: [...new Set(allPainPoints)].slice(0, 5),
                      sentimentBreakdown: {
                        positive: analysisArray.filter((a) => a.sentiment === "positive").length,
                        negative: analysisArray.filter((a) => a.sentiment === "negative").length,
                        neutral: analysisArray.filter((a) => a.sentiment === "neutral").length
                      },
                      hasQuotableContent: topQuotes.length > 0,
                      strongestAgent: Object.entries(agentMentions).sort((a, b) => b[1] - a[1])[0]?.[0] || null
                    };
                  } catch (parseErr) {
                    console.log("Gemini parse note:", parseErr);
                  }
                }
              } else {
                geminiIntelligence = { _httpError: geminiResponse.status, _statusText: geminiResponse.statusText };
              }
            } catch (geminiErr) {
              console.error("Gemini review analysis error:", geminiErr);
              geminiIntelligence = { _error: geminiErr.message || String(geminiErr), _apiKeyPresent: true };
            }
          }
          let geminiFeatures = null;
          if (env.GEMINI_API_KEY && html) {
            try {
              const cleanText = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").substring(0, 8e3);
              const featuresPrompt = `You are the Master Normalizer for business intelligence. Analyze this website and extract:

## REQUIRED FIELDS:

### 1. NORMALIZED IDENTITY (CRITICAL - Prevent Hallucinations)
- **normalized_name**: The CONVERSATIONAL brand name (e.g., "Accenture" not "Accenture Cloud Hosting Pty Ltd")
- **normalized_location**: CONVERSATIONAL location (e.g., "Richmond", "Melbourne", "Victoria", or "Australia-wide")
  - DO NOT use ", VIC" or postal codes
  - Use city-level unless state/national is more appropriate
- **business_description**: 1-2 sentence summary of what they do

### 2. IDEAL CUSTOMER PROFILE
- **ideal_customer_persona**: Who is their target customer? (e.g., "small trades businesses", "enterprise healthcare")

### 3. PRICING INTELLIGENCE
- **pricing_info**: Any pricing mentioned (packages, rates, "from $X") or "Not publicly listed"

### 4. SALES INTELLIGENCE
- **services**: List of actual services offered (not blog titles)
- **features**: Specific capabilities or differentiators
- **benefits**: Outcomes customers receive
- **pain_points**: Customer problems they solve (struggles, frustrations, challenges)
- **usps**: Unique Selling Propositions - what makes THIS business different from competitors

### 5. CONFIDENCE SCORE (0-1.0)
Rate your confidence in the accuracy of the data you extracted:
- 1.0 = Extremely confident (clear, explicit data on website)
- 0.7-0.9 = High confidence (strong evidence)
- 0.4-0.6 = Moderate (some inference required)
- 0-0.3 = Low (guessing or missing data)

Website: ${quickBusinessName}
Content: ${cleanText.substring(0, 4e3)}

Return ONLY valid JSON (use EXACT key names below):
{
  "normalized_name": "...",
  "normalized_location": "...",
  "business_description": "...",
  "ideal_customer_persona": "...",
  "pricing_info": "...",
  "services": ["..."],
  "features": ["..."],
  "benefits": ["..."],
  "pain_points": ["..."],
  "usps": ["..."],
  "confidence_score": 0.85
}`;
              const featuresResponse = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    contents: [{ parts: [{ text: featuresPrompt }] }],
                    generationConfig: { temperature: 0.1, maxOutputTokens: 1500 }
                  })
                }
              );
              if (featuresResponse.ok) {
                const featuresResult = await featuresResponse.json();
                const featuresText = featuresResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";
                const jsonMatch = featuresText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  try {
                    geminiFeatures = JSON.parse(jsonMatch[0]);
                  } catch (e) {
                  }
                }
              }
            } catch (e) {
              console.log("Gemini features extraction note:", e);
            }
          }
          const reviewTrends = googlePlacesData?.reviews ? calculateReviewTrends(googlePlacesData.reviews) : null;
          if (googlePlacesData && googlePlacesData.reviews) {
            const reviewsWithLikelyResponse = googlePlacesData.reviews.filter(
              (r) => r.text && (r.text.toLowerCase().includes("thank you for") || r.text.toLowerCase().includes("appreciate your") || r.text.toLowerCase().includes("response from owner:") || r.text.toLowerCase().includes("owner replied"))
            );
            googlePlacesData.estimatedResponseRate = googlePlacesData.reviews.length > 0 ? reviewsWithLikelyResponse.length / googlePlacesData.reviews.length : 0;
          }
          const landingPageAudit = {
            // Check for above-fold CTA
            hasAboveFoldCTA: (() => {
              const heroMatch = html.match(/<(section|div|header)[^>]*class="[^"]*hero[^"]*"[^>]*>[\s\S]{0,2000}/i);
              if (heroMatch) {
                return /(<button|<a[^>]*btn|<input[^>]*submit|book now|get started|contact us|call now)/i.test(heroMatch[0]);
              }
              return /(<button|<a[^>]*btn|<input[^>]*submit)/i.test(html.substring(0, 3e3));
            })(),
            // Count form fields (fewer is better)
            formFieldCount: (() => {
              const inputs = html.match(/<input[^>]*type="(text|email|tel|number)"/gi) || [];
              const textareas = html.match(/<textarea/gi) || [];
              return inputs.length + textareas.length;
            })(),
            // Check for mobile optimization
            mobileOptimized: html.includes("viewport") && html.includes("width=device-width"),
            // Count testimonials
            testimonialCount: (() => {
              const testimonialIndicators = html.match(/testimonial|review|customer said|client says|feedback/gi) || [];
              return Math.min(testimonialIndicators.length, 10);
            })(),
            // Check for trust badges
            trustBadgeCount: (() => {
              const badges = html.match(/(guarantee|certified|secure|ssl|trusted|verified|member of|accredited)/gi) || [];
              return Math.min(badges.length, 10);
            })(),
            // Check for video
            hasVideo: /<video|youtube\.com|vimeo\.com|wistia\.com/i.test(html),
            // Check for exit intent
            hasExitIntent: /exit.?intent|mouseleave|mouseout/i.test(html),
            // Check for live chat (different from Voice AI)
            hasLiveChat: /intercom|drift|livechat|zendesk|tidio|crisp|tawk/i.test(html),
            // Check for phone click-to-call
            hasClickToCall: /tel:|click.?to.?call|call.?now/i.test(html),
            // Calculate overall score
            score: 0
            // Will calculate below
          };
          landingPageAudit.score = (landingPageAudit.hasAboveFoldCTA ? 20 : 0) + (landingPageAudit.formFieldCount <= 4 ? 15 : landingPageAudit.formFieldCount <= 6 ? 10 : 0) + (landingPageAudit.mobileOptimized ? 15 : 0) + (landingPageAudit.testimonialCount >= 3 ? 15 : landingPageAudit.testimonialCount >= 1 ? 10 : 0) + (landingPageAudit.trustBadgeCount >= 3 ? 10 : landingPageAudit.trustBadgeCount >= 1 ? 5 : 0) + (landingPageAudit.hasVideo ? 10 : 0) + (landingPageAudit.hasLiveChat ? 10 : 0) + (landingPageAudit.hasClickToCall ? 5 : 0);
          let socialMediaIntelligence = null;
          const facebookPageUrl = html.match(/href="(https?:\/\/(?:www\.)?facebook\.com\/[^"]+)"/i)?.[1];
          const instagramPageUrl = html.match(/href="(https?:\/\/(?:www\.)?instagram\.com\/[^"]+)"/i)?.[1];
          socialMediaIntelligence = {
            facebook: {
              pageUrl: facebookPageUrl,
              hasPage: !!facebookPageUrl,
              // Note: Full FB page scraping requires Graph API access
              // We capture the URL for manual review or future API integration
              scraped: false,
              note: facebookPageUrl ? "Page detected - reviews available for manual review" : "No Facebook page found"
            },
            instagram: {
              pageUrl: instagramPageUrl,
              hasPage: !!instagramPageUrl,
              // Note: IG scraping requires login or API access
              scraped: false,
              note: instagramPageUrl ? "Profile detected - engagement available for manual review" : "No Instagram found"
            }
          };
          const CTA_SCORING = {
            // 🟢 HIGH INTENT CTAs (Good - they're capturing leads)
            "book now": { score: 10, type: "booking", agentOpportunity: "Maddie can handle overflow" },
            "schedule call": { score: 10, type: "booking", agentOpportunity: "Maddie can pre-qualify" },
            "book appointment": { score: 10, type: "booking", agentOpportunity: "Maddie can pre-qualify" },
            "get quote": { score: 9, type: "lead_capture", agentOpportunity: "Alex for instant follow-up" },
            "request quote": { score: 9, type: "lead_capture", agentOpportunity: "Alex for instant follow-up" },
            "get started": { score: 9, type: "conversion", agentOpportunity: "Chris to guide onboarding" },
            "download": { score: 8, type: "lead_magnet", agentOpportunity: "Alex to nurture post-download" },
            "sign up": { score: 8, type: "conversion", agentOpportunity: "Sarah for trial activation" },
            "subscribe": { score: 8, type: "conversion", agentOpportunity: "Sarah for engagement" },
            "apply now": { score: 9, type: "conversion", agentOpportunity: "Alex for instant follow-up" },
            "call now": { score: 9, type: "call", agentOpportunity: "Maddie if missed" },
            // 🟡 MEDIUM INTENT CTAs (OK - but leaving money on table)
            "learn more": { score: 5, type: "traffic", agentOpportunity: "Chris to convert on arrival" },
            "contact us": { score: 5, type: "contact", agentOpportunity: "Chris + instant response" },
            "shop now": { score: 6, type: "ecommerce", agentOpportunity: "Cart abandonment follow-up" },
            "send message": { score: 6, type: "contact", agentOpportunity: "Alex for instant response" },
            "get offer": { score: 7, type: "lead_capture", agentOpportunity: "Alex for follow-up" },
            // 🔴 LOW INTENT CTAs (MONEY LEAK!)
            "visit website": { score: 2, type: "traffic", agentOpportunity: "\u{1F6A8} MAJOR LEAK - No capture!" },
            "see more": { score: 1, type: "traffic", agentOpportunity: "\u{1F6A8} MAJOR LEAK - No capture!" },
            "watch more": { score: 2, type: "traffic", agentOpportunity: "\u{1F6A8} MAJOR LEAK - No capture!" },
            "like page": { score: 0, type: "vanity", agentOpportunity: "\u{1F6A8} CRITICAL - Zero conversion path!" },
            "no button": { score: 1, type: "traffic", agentOpportunity: "\u{1F6A8} No CTA - Traffic is wasted!" }
          };
          const AGENT_NEED_KEYWORDS = {
            alex: ["never got back", "took days", "still waiting", "no reply", "had to chase", "slow response", "didn't follow up", "no callback", "waited forever", "never responded", "slow to respond"],
            maddie: ["couldn't get through", "no one answered", "phone just rings", "voicemail", "left message", "hard to reach", "no answer", "nobody picks up", "after hours", "closed when i called"],
            chris: ["confusing website", "couldn't find", "no one to ask", "had questions", "doesn't explain", "wish there was chat", "unclear", "hard to navigate", "wanted to ask", "no information"],
            sarah: ["used them before", "forgot about", "used to be customer", "haven't heard from", "went elsewhere", "previous customer", "came back after", "years ago"],
            james: ["see the bad reviews", "almost didn't use", "reviews scared me", "ignored the reviews", "despite reviews", "worried about reviews", "glad i ignored"]
          };
          const INDUSTRY_BENCHMARKS = {
            // ============ HEALTHCARE (12) ============
            "dental": { avgClientValue: 2500, conversionRate: 0.03, closeRate: 0.3, avgMonthlyLeads: 30 },
            "medical": { avgClientValue: 800, conversionRate: 0.04, closeRate: 0.5, avgMonthlyLeads: 80 },
            "chiropractic": { avgClientValue: 1800, conversionRate: 0.04, closeRate: 0.35, avgMonthlyLeads: 35 },
            "physiotherapy": { avgClientValue: 1200, conversionRate: 0.04, closeRate: 0.4, avgMonthlyLeads: 40 },
            "optometry": { avgClientValue: 600, conversionRate: 0.05, closeRate: 0.45, avgMonthlyLeads: 35 },
            "veterinary": { avgClientValue: 450, conversionRate: 0.05, closeRate: 0.55, avgMonthlyLeads: 60 },
            "psychology": { avgClientValue: 2e3, conversionRate: 0.03, closeRate: 0.35, avgMonthlyLeads: 25 },
            "podiatry": { avgClientValue: 800, conversionRate: 0.04, closeRate: 0.45, avgMonthlyLeads: 30 },
            "pharmacy": { avgClientValue: 150, conversionRate: 0.08, closeRate: 0.7, avgMonthlyLeads: 150 },
            "aged care": { avgClientValue: 8e3, conversionRate: 0.02, closeRate: 0.2, avgMonthlyLeads: 15 },
            "disability services": { avgClientValue: 6e3, conversionRate: 0.02, closeRate: 0.25, avgMonthlyLeads: 20 },
            "healthtech": { avgClientValue: 15e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 20 },
            // ============ TECHNOLOGY & FINTECH (22) ============
            "fintech": { avgClientValue: 25e3, conversionRate: 0.02, closeRate: 0.12, avgMonthlyLeads: 20 },
            "banking": { avgClientValue: 5e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 40 },
            "lending": { avgClientValue: 4500, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 25 },
            "SaaS": { avgClientValue: 8e3, conversionRate: 0.02, closeRate: 0.18, avgMonthlyLeads: 30 },
            "enterprise software": { avgClientValue: 5e4, conversionRate: 0.01, closeRate: 0.1, avgMonthlyLeads: 15 },
            "CRM": { avgClientValue: 12e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 20 },
            "ERP": { avgClientValue: 75e3, conversionRate: 0.01, closeRate: 0.08, avgMonthlyLeads: 10 },
            "cybersecurity": { avgClientValue: 2e4, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 20 },
            "cloud services": { avgClientValue: 15e3, conversionRate: 0.02, closeRate: 0.18, avgMonthlyLeads: 25 },
            "data analytics": { avgClientValue: 18e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 20 },
            "AI/ML": { avgClientValue: 3e4, conversionRate: 0.02, closeRate: 0.12, avgMonthlyLeads: 15 },
            "telecommunications": { avgClientValue: 3e3, conversionRate: 0.03, closeRate: 0.25, avgMonthlyLeads: 50 },
            "ISP": { avgClientValue: 1200, conversionRate: 0.04, closeRate: 0.3, avgMonthlyLeads: 60 },
            "payments": { avgClientValue: 2e4, conversionRate: 0.02, closeRate: 0.12, avgMonthlyLeads: 20 },
            "ecommerce": { avgClientValue: 5e3, conversionRate: 0.03, closeRate: 0.2, avgMonthlyLeads: 40 },
            "API/integration": { avgClientValue: 15e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 15 },
            "technology": { avgClientValue: 1e4, conversionRate: 0.02, closeRate: 0.18, avgMonthlyLeads: 25 },
            "consumer electronics": { avgClientValue: 500, conversionRate: 0.06, closeRate: 0.4, avgMonthlyLeads: 100 },
            "software development": { avgClientValue: 25e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 15 },
            "neobank": { avgClientValue: 2e3, conversionRate: 0.03, closeRate: 0.2, avgMonthlyLeads: 100 },
            "wealthtech": { avgClientValue: 1e4, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 25 },
            "regtech": { avgClientValue: 35e3, conversionRate: 0.01, closeRate: 0.1, avgMonthlyLeads: 10 },
            "insurtech": { avgClientValue: 8e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 30 },
            "proptech": { avgClientValue: 12e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 25 },
            "HR tech": { avgClientValue: 15e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 20 },
            "edtech": { avgClientValue: 5e3, conversionRate: 0.03, closeRate: 0.2, avgMonthlyLeads: 40 },
            // ============ FINANCE (7) ============
            "asset management": { avgClientValue: 5e4, conversionRate: 0.01, closeRate: 0.1, avgMonthlyLeads: 10 },
            "private equity": { avgClientValue: 1e5, conversionRate: 0.01, closeRate: 0.08, avgMonthlyLeads: 5 },
            "superannuation": { avgClientValue: 5e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 30 },
            "trading": { avgClientValue: 3e3, conversionRate: 0.03, closeRate: 0.2, avgMonthlyLeads: 50 },
            "invoice finance": { avgClientValue: 8e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 20 },
            "business lending": { avgClientValue: 6e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 25 },
            "BNPL": { avgClientValue: 200, conversionRate: 0.08, closeRate: 0.5, avgMonthlyLeads: 500 },
            // ============ PROFESSIONAL SERVICES (13) ============
            "legal": { avgClientValue: 5e3, conversionRate: 0.02, closeRate: 0.2, avgMonthlyLeads: 20 },
            "accounting": { avgClientValue: 3e3, conversionRate: 0.02, closeRate: 0.25, avgMonthlyLeads: 25 },
            "financial services": { avgClientValue: 4e3, conversionRate: 0.02, closeRate: 0.2, avgMonthlyLeads: 25 },
            "insurance": { avgClientValue: 1800, conversionRate: 0.02, closeRate: 0.2, avgMonthlyLeads: 30 },
            "real estate": { avgClientValue: 12e3, conversionRate: 0.03, closeRate: 0.15, avgMonthlyLeads: 30 },
            "recruitment": { avgClientValue: 8e3, conversionRate: 0.02, closeRate: 0.18, avgMonthlyLeads: 25 },
            "consulting": { avgClientValue: 1e4, conversionRate: 0.02, closeRate: 0.2, avgMonthlyLeads: 15 },
            "architecture": { avgClientValue: 25e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 10 },
            "interior design": { avgClientValue: 8e3, conversionRate: 0.03, closeRate: 0.25, avgMonthlyLeads: 15 },
            "graphic design": { avgClientValue: 3e3, conversionRate: 0.04, closeRate: 0.3, avgMonthlyLeads: 25 },
            "web development": { avgClientValue: 8e3, conversionRate: 0.03, closeRate: 0.25, avgMonthlyLeads: 20 },
            "marketing": { avgClientValue: 5e3, conversionRate: 0.03, closeRate: 0.25, avgMonthlyLeads: 25 },
            "IT services": { avgClientValue: 6e3, conversionRate: 0.03, closeRate: 0.25, avgMonthlyLeads: 30 },
            // ============ BEAUTY & WELLNESS (7) ============
            "hair salon": { avgClientValue: 150, conversionRate: 0.06, closeRate: 0.5, avgMonthlyLeads: 80 },
            "spa": { avgClientValue: 300, conversionRate: 0.05, closeRate: 0.45, avgMonthlyLeads: 50 },
            "beauty": { avgClientValue: 200, conversionRate: 0.06, closeRate: 0.5, avgMonthlyLeads: 70 },
            "fitness": { avgClientValue: 800, conversionRate: 0.05, closeRate: 0.35, avgMonthlyLeads: 60 },
            "yoga": { avgClientValue: 600, conversionRate: 0.05, closeRate: 0.4, avgMonthlyLeads: 50 },
            "martial arts": { avgClientValue: 1200, conversionRate: 0.04, closeRate: 0.35, avgMonthlyLeads: 40 },
            "dance": { avgClientValue: 800, conversionRate: 0.05, closeRate: 0.4, avgMonthlyLeads: 40 },
            // ============ HOSPITALITY & FOOD (6) ============
            "restaurant": { avgClientValue: 45, conversionRate: 0.1, closeRate: 0.8, avgMonthlyLeads: 300 },
            "cafe": { avgClientValue: 15, conversionRate: 0.12, closeRate: 0.85, avgMonthlyLeads: 400 },
            "bakery": { avgClientValue: 25, conversionRate: 0.1, closeRate: 0.8, avgMonthlyLeads: 250 },
            "catering": { avgClientValue: 2500, conversionRate: 0.04, closeRate: 0.35, avgMonthlyLeads: 25 },
            "bar": { avgClientValue: 50, conversionRate: 0.1, closeRate: 0.75, avgMonthlyLeads: 200 },
            "hospitality": { avgClientValue: 250, conversionRate: 0.06, closeRate: 0.5, avgMonthlyLeads: 100 },
            // ============ RETAIL (4) ============
            "florist": { avgClientValue: 120, conversionRate: 0.08, closeRate: 0.55, avgMonthlyLeads: 60 },
            "jewelry": { avgClientValue: 800, conversionRate: 0.04, closeRate: 0.3, avgMonthlyLeads: 40 },
            "furniture": { avgClientValue: 2e3, conversionRate: 0.04, closeRate: 0.25, avgMonthlyLeads: 30 },
            "retail": { avgClientValue: 150, conversionRate: 0.08, closeRate: 0.5, avgMonthlyLeads: 100 },
            // ============ EDUCATION (5) ============
            "tutoring": { avgClientValue: 2e3, conversionRate: 0.04, closeRate: 0.35, avgMonthlyLeads: 40 },
            "driving school": { avgClientValue: 800, conversionRate: 0.06, closeRate: 0.45, avgMonthlyLeads: 50 },
            "music school": { avgClientValue: 1500, conversionRate: 0.04, closeRate: 0.4, avgMonthlyLeads: 35 },
            "childcare": { avgClientValue: 15e3, conversionRate: 0.03, closeRate: 0.3, avgMonthlyLeads: 25 },
            "early education": { avgClientValue: 12e3, conversionRate: 0.03, closeRate: 0.3, avgMonthlyLeads: 25 },
            // ============ EVENTS & CREATIVE (5) ============
            "photography": { avgJobValue: 2e3, conversionRate: 0.04, closeRate: 0.3, avgMonthlyLeads: 25 },
            "videography": { avgJobValue: 3500, conversionRate: 0.03, closeRate: 0.25, avgMonthlyLeads: 20 },
            "wedding": { avgJobValue: 5e3, conversionRate: 0.03, closeRate: 0.25, avgMonthlyLeads: 20 },
            "events": { avgJobValue: 3e3, conversionRate: 0.04, closeRate: 0.3, avgMonthlyLeads: 25 },
            "printing": { avgJobValue: 500, conversionRate: 0.06, closeRate: 0.45, avgMonthlyLeads: 50 },
            // ============ AUTOMOTIVE (3) ============
            "automotive": { avgJobValue: 550, conversionRate: 0.06, closeRate: 0.4, avgMonthlyLeads: 60 },
            "car wash": { avgJobValue: 50, conversionRate: 0.1, closeRate: 0.7, avgMonthlyLeads: 150 },
            "car dealership": { avgJobValue: 25e3, conversionRate: 0.03, closeRate: 0.15, avgMonthlyLeads: 40 },
            // ============ TRADES (17) ============
            "plumbing": { avgJobValue: 450, conversionRate: 0.08, closeRate: 0.4, avgMonthlyLeads: 55 },
            "electrical": { avgJobValue: 380, conversionRate: 0.08, closeRate: 0.38, avgMonthlyLeads: 50 },
            "hvac": { avgJobValue: 650, conversionRate: 0.07, closeRate: 0.35, avgMonthlyLeads: 45 },
            "roofing": { avgJobValue: 8500, conversionRate: 0.05, closeRate: 0.2, avgMonthlyLeads: 18 },
            "landscaping": { avgJobValue: 1200, conversionRate: 0.07, closeRate: 0.35, avgMonthlyLeads: 35 },
            "pest control": { avgJobValue: 250, conversionRate: 0.08, closeRate: 0.5, avgMonthlyLeads: 60 },
            "cleaning": { avgJobValue: 180, conversionRate: 0.08, closeRate: 0.45, avgMonthlyLeads: 80 },
            "moving": { avgJobValue: 800, conversionRate: 0.06, closeRate: 0.4, avgMonthlyLeads: 40 },
            "painting": { avgJobValue: 2500, conversionRate: 0.06, closeRate: 0.3, avgMonthlyLeads: 25 },
            "carpentry": { avgJobValue: 3e3, conversionRate: 0.05, closeRate: 0.3, avgMonthlyLeads: 20 },
            "fencing": { avgJobValue: 3500, conversionRate: 0.06, closeRate: 0.3, avgMonthlyLeads: 25 },
            "solar": { avgJobValue: 12e3, conversionRate: 0.04, closeRate: 0.2, avgMonthlyLeads: 30 },
            "locksmith": { avgJobValue: 200, conversionRate: 0.1, closeRate: 0.6, avgMonthlyLeads: 70 },
            "towing": { avgJobValue: 150, conversionRate: 0.1, closeRate: 0.7, avgMonthlyLeads: 80 },
            "pool services": { avgJobValue: 400, conversionRate: 0.07, closeRate: 0.45, avgMonthlyLeads: 40 },
            "tiling": { avgJobValue: 2e3, conversionRate: 0.06, closeRate: 0.35, avgMonthlyLeads: 25 },
            "appliance repair": { avgJobValue: 250, conversionRate: 0.08, closeRate: 0.5, avgMonthlyLeads: 50 },
            "construction": { avgJobValue: 5e4, conversionRate: 0.03, closeRate: 0.15, avgMonthlyLeads: 10 },
            // ============ OTHER (8) ============
            "security": { avgClientValue: 3e3, conversionRate: 0.04, closeRate: 0.3, avgMonthlyLeads: 30 },
            "pet grooming": { avgJobValue: 80, conversionRate: 0.08, closeRate: 0.6, avgMonthlyLeads: 80 },
            "pet boarding": { avgJobValue: 200, conversionRate: 0.06, closeRate: 0.5, avgMonthlyLeads: 50 },
            "travel": { avgClientValue: 3e3, conversionRate: 0.04, closeRate: 0.25, avgMonthlyLeads: 40 },
            "funeral services": { avgJobValue: 8e3, conversionRate: 0.03, closeRate: 0.4, avgMonthlyLeads: 15 },
            "storage": { avgClientValue: 1200, conversionRate: 0.06, closeRate: 0.4, avgMonthlyLeads: 50 },
            "manufacturing": { avgClientValue: 25e3, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 15 },
            "logistics": { avgClientValue: 1e4, conversionRate: 0.02, closeRate: 0.2, avgMonthlyLeads: 20 },
            "wholesale": { avgClientValue: 5e3, conversionRate: 0.03, closeRate: 0.25, avgMonthlyLeads: 30 },
            // ============ ALIASES (Common Variations) ============
            "realestate": { avgClientValue: 12e3, conversionRate: 0.03, closeRate: 0.15, avgMonthlyLeads: 30 },
            "mortgage": { avgClientValue: 4500, conversionRate: 0.02, closeRate: 0.15, avgMonthlyLeads: 25 }
            // NOTE: No 'default' - if industry not matched, financials should be hidden
          };
          const FIX_IMPACTS = {
            speedToLead: {
              id: "speedToLead",
              multiplier: 3.91,
              study: "MIT Lead Response Study",
              studyCitation: "MIT Lead Response Management Study (2007), Oldroyd, McElheran & Elkington",
              statDescription: "78% of leads go with whoever responds first*",
              appliesTo: "qualificationRate",
              agent: "Alex",
              agentRole: "Speed-to-Lead Specialist",
              icon: "\u26A1",
              title: "Ads Without Speed-to-Lead",
              baseScore: 10
            },
            websiteConcierge: {
              id: "websiteConcierge",
              multiplier: 1.4,
              study: "Forrester Live Chat Research",
              studyCitation: 'Forrester Research (2010), "Making Proactive Chat Work"',
              statDescription: "44% of consumers say live chat is the most important feature*",
              appliesTo: "conversionRate",
              agent: "Chris",
              agentRole: "Website Concierge",
              icon: "\u{1F4AC}",
              title: "No 24/7 Personalised Concierge",
              baseScore: 8
            },
            reputationManagement: {
              id: "reputationManagement",
              multiplier: 1.09,
              study: "Harvard Business Review",
              studyCitation: 'Harvard Business Review (2016), Luca, M. "Reviews, Reputation, and Revenue"',
              statDescription: "A one-star increase leads to 5-9% revenue increase*",
              appliesTo: "totalRevenue",
              agent: "James",
              agentRole: "Reputation Manager",
              icon: "\u2B50",
              title: "Reputation at Risk",
              baseScore: 9
            },
            reviewResponse: {
              id: "reviewResponse",
              multiplier: 1.25,
              study: "BrightLocal Consumer Survey",
              studyCitation: "BrightLocal Local Consumer Review Survey (2023)",
              statDescription: "88% of consumers trust businesses that respond to reviews*",
              appliesTo: "trustScore",
              agent: "James",
              agentRole: "Review Response Handler",
              icon: "\u{1F4AC}",
              title: "Unanswered Reviews",
              baseScore: 7
            },
            callHandling: {
              id: "callHandling",
              multiplier: 1.35,
              study: "Invoca Call Analytics",
              studyCitation: "Invoca Call Intelligence Report (2022)",
              statDescription: "62% of calls to SMBs go unanswered*",
              appliesTo: "leadCapture",
              agent: "Maddie",
              agentRole: "AI Receptionist",
              icon: "\u{1F4DE}",
              title: "Missed Calls = Missed Revenue",
              baseScore: 8
            },
            databaseReactivation: {
              id: "databaseReactivation",
              multiplier: 1.2,
              study: "MarketingSherpa",
              studyCitation: "MarketingSherpa Lead Generation Benchmark Report (2017)",
              statDescription: "79% of leads never convert due to lack of nurturing*",
              appliesTo: "dormantLeads",
              agent: "Sarah",
              agentRole: "Database Reactivation Specialist",
              icon: "\u{1F4A4}",
              title: "Sleeping Database",
              baseScore: 6
            },
            leadCapture: {
              id: "leadCapture",
              multiplier: 1.5,
              study: "HubSpot Lead Gen Report",
              studyCitation: "HubSpot State of Marketing Report (2023)",
              statDescription: "Personalised CTAs convert 202% better than generic*",
              appliesTo: "conversionRate",
              agent: "Chris",
              agentRole: "Lead Capture Expert",
              icon: "\u{1F4DD}",
              title: "No Personalised Lead Capture",
              baseScore: 7
            }
          };
          const hasWord = /* @__PURE__ */ __name((word) => new RegExp(`\\b${word}\\b`, "i").test(html), "hasWord");
          const hasPhrase = /* @__PURE__ */ __name((phrase) => htmlLower.includes(phrase.toLowerCase()), "hasPhrase");
          const blobHas = /* @__PURE__ */ __name((phrase) => cleanBlob.includes(phrase.toLowerCase()), "blobHas");
          const blobHasWord = /* @__PURE__ */ __name((word) => new RegExp(`\\b${word}\\b`, "i").test(cleanBlob), "blobHasWord");
          const blobCount = /* @__PURE__ */ __name((phrase) => (cleanBlob.match(new RegExp(phrase.toLowerCase(), "gi")) || []).length, "blobCount");
          const footerContext = blobCount("copyright") + blobCount("all rights reserved") + blobCount("privacy policy");
          const careersContext = blobCount("career") + blobCount("job") + blobCount("position") + blobCount("apply now");
          const blogContext = blobCount("blog") + blobCount("article") + blobCount("posted on") + blobCount("read more");
          const archiveContext = blobCount("archive") + blobCount("category") + blobCount("tag");
          const isHighCareersContext = careersContext > 5;
          const isHighBlogContext = blogContext > 5;
          const isHighFooterContext = footerContext > 3;
          const getMetaContent = /* @__PURE__ */ __name((name) => {
            const patterns = [
              new RegExp(`<meta[^>]*property=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
              new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']${name}["']`, "i"),
              new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["']`, "i"),
              new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["']`, "i")
            ];
            for (const pattern of patterns) {
              const match = html.match(pattern);
              if (match) return match[1].trim();
            }
            return "";
          }, "getMetaContent");
          const ogTitle = getMetaContent("og:title");
          const ogDescription = getMetaContent("og:description");
          const ogImage = getMetaContent("og:image");
          const ogSiteName = getMetaContent("og:site_name");
          const metaDescription = getMetaContent("description");
          const metaKeywords = getMetaContent("keywords");
          let schemaData = {};
          const schemaMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
          if (schemaMatches) {
            for (const schemaScript of schemaMatches) {
              try {
                const jsonStr = schemaScript.replace(/<script[^>]*>|<\/script>/gi, "").trim();
                const parsed = JSON.parse(jsonStr);
                const schemas = Array.isArray(parsed) ? parsed : [parsed];
                for (const schema of schemas) {
                  if (schema["@type"] === "LocalBusiness" || schema["@type"] === "Organization" || schema["@type"]?.includes("Business") || schema["@type"]?.includes("Store")) {
                    schemaData = { ...schemaData, ...schema };
                  }
                }
              } catch (e) {
              }
            }
          }
          const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const title = titleMatch ? titleMatch[1].replace(/<[^>]*>/g, "").trim() : "";
          let businessName = schemaData.name || ogSiteName || ogTitle || body.company_name || title.split("|")[0].split("-")[0].split(":")[0].split("\u2013")[0].trim();
          businessName = businessName.replace(/\s*(home|homepage|welcome to|official site|official website)$/i, "").trim();
          let description = schemaData.description || ogDescription || metaDescription || "";
          const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
          const mainHeadline = h1Match ? h1Match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : "";
          let tagline = "";
          const taglinePatterns = [
            /<(?:h2|p)[^>]*class="[^"]*(?:tagline|slogan|subtitle|hero-text)[^"]*"[^>]*>([\s\S]*?)<\/(?:h2|p)>/i,
            /<meta[^>]*name=["']tagline["'][^>]*content=["']([^"']*)["']/i
          ];
          for (const pattern of taglinePatterns) {
            const match = html.match(pattern);
            if (match) {
              tagline = match[1].replace(/<[^>]*>/g, "").trim();
              break;
            }
          }
          const socialMedia = {};
          const socialPatterns = {
            facebook: /href=["'](https?:\/\/(?:www\.)?facebook\.com\/[^"'\s>]+)["']/i,
            instagram: /href=["'](https?:\/\/(?:www\.)?instagram\.com\/[^"'\s>]+)["']/i,
            linkedin: /href=["'](https?:\/\/(?:www\.)?linkedin\.com\/[^"'\s>]+)["']/i,
            twitter: /href=["'](https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[^"'\s>]+)["']/i,
            youtube: /href=["'](https?:\/\/(?:www\.)?youtube\.com\/[^"'\s>]+)["']/i,
            tiktok: /href=["'](https?:\/\/(?:www\.)?tiktok\.com\/[^"'\s>]+)["']/i
          };
          for (const [platform, pattern] of Object.entries(socialPatterns)) {
            const match = html.match(pattern);
            if (match) socialMedia[platform] = match[1];
          }
          const domainForLogo = new URL(website_url).hostname.replace("www.", "").split(".")[0].toLowerCase();
          let logoUrl = ogImage || "";
          if (!logoUrl) {
            const domainLogoPattern = new RegExp(`<img[^>]*src=["']([^"']*${domainForLogo}[^"']*\\.(?:png|jpg|jpeg|svg|webp))[^"']*["']`, "i");
            const domainMatch = html.match(domainLogoPattern);
            if (domainMatch && domainMatch[1] && !domainMatch[1].startsWith("data:")) {
              logoUrl = domainMatch[1];
            }
          }
          if (!logoUrl) {
            const headerPatterns = [
              /<header[^>]*>[\s\S]*?<img[^>]*src=["']([^"']+)["'][^>]*>/i,
              /<nav[^>]*>[\s\S]*?<img[^>]*src=["']([^"']+)["'][^>]*>/i,
              /<div[^>]*class="[^"]*(?:header|navbar|nav-bar|top-bar)[^"]*"[^>]*>[\s\S]*?<img[^>]*src=["']([^"']+)["']/i,
              /<a[^>]*href=["']\/["'][^>]*>[\s\S]*?<img[^>]*src=["']([^"']+)["']/i
            ];
            for (const pattern of headerPatterns) {
              const match = html.match(pattern);
              if (match && match[1] && !match[1].startsWith("data:")) {
                const src = match[1];
                if (src.startsWith("/") || src.includes(domainForLogo)) {
                  logoUrl = src;
                  break;
                }
              }
            }
          }
          if (!logoUrl) {
            const logoFilePatterns = [
              /<img[^>]*src=["']([^"']*[-/]logo[^"']*\.(?:png|jpg|jpeg|svg|webp))[^"']*["']/i,
              /<img[^>]*src=["']([^"']*logo[-_.][^"']*\.(?:png|jpg|jpeg|svg|webp))[^"']*["']/i
            ];
            for (const pattern of logoFilePatterns) {
              const match = html.match(pattern);
              if (match && match[1] && !match[1].startsWith("data:")) {
                const src = match[1];
                if (src.includes(domainForLogo) || src.startsWith("/") && !src.startsWith("//")) {
                  logoUrl = src;
                  break;
                }
              }
            }
          }
          if (!logoUrl) {
            const iconPatterns = [
              /<link[^>]*rel=["']apple-touch-icon[^"]*["'][^>]*href=["']([^"']+)["']/i,
              /<link[^>]*rel=["']icon["'][^>]*href=["']([^"']+)["']/i,
              /<link[^>]*rel=["']shortcut icon["'][^>]*href=["']([^"']+)["']/i
            ];
            for (const pattern of iconPatterns) {
              const match = html.match(pattern);
              if (match && match[1] && !match[1].startsWith("data:")) {
                logoUrl = match[1];
                break;
              }
            }
          }
          if (logoUrl && logoUrl.startsWith("//")) {
            logoUrl = "https:" + logoUrl;
          }
          if (logoUrl && !logoUrl.startsWith("http")) {
            const baseUrl = new URL(website_url).origin;
            logoUrl = logoUrl.startsWith("/") ? baseUrl + logoUrl : baseUrl + "/" + logoUrl;
          }
          let copyrightYear = "";
          const yearPatterns = [/©\s*(\d{4})/i, /copyright\s*(\d{4})/i, /(\d{4})\s*©/i];
          for (const pattern of yearPatterns) {
            const match = html.match(pattern);
            if (match && parseInt(match[1]) >= 2e3 && parseInt(match[1]) <= (/* @__PURE__ */ new Date()).getFullYear() + 1) {
              copyrightYear = match[1];
              break;
            }
          }
          let starRating = schemaData.aggregateRating?.ratingValue || "";
          let reviewCount = schemaData.aggregateRating?.reviewCount || schemaData.aggregateRating?.ratingCount || "";
          if (!starRating) {
            const ratingMatch = html.match(/(\d+\.?\d*)\s*(?:out of\s*5|\/\s*5|stars?)/i);
            if (ratingMatch) starRating = ratingMatch[1];
          }
          if (starRating) {
            const ratingNum = parseFloat(starRating);
            if (isNaN(ratingNum) || ratingNum < 0 || ratingNum > 5) starRating = "";
          }
          if (!reviewCount) {
            const reviewMatch = html.match(/(\d+)\s*(?:reviews?|ratings?)/i);
            if (reviewMatch) reviewCount = reviewMatch[1];
          }
          // V3 FIX: Promote Google Places data to top-level if HTML schema extraction missed them
          if ((!starRating || starRating === "") && googlePlacesData?.rating) {
            starRating = String(googlePlacesData.rating);
          }
          if ((!reviewCount || reviewCount === "") && googlePlacesData?.reviewCount) {
            reviewCount = String(googlePlacesData.reviewCount);
          }
          let location = schemaData.address?.addressLocality || schemaData.areaServed || "";
          if (!location) {
            const locationPatterns = [
              /serving\s+([a-z\s,]+(?:nsw|vic|qld|sa|wa|tas|nt|act))/i,
              /based\s+in\s+([a-z\s,]+)/i,
              /located\s+in\s+([a-z\s,]+)/i,
              /([a-z]+,\s*(?:nsw|vic|qld|sa|wa|tas|nt|act))/i
            ];
            for (const pattern of locationPatterns) {
              const match = html.match(pattern);
              if (match) {
                location = match[1].trim();
                break;
              }
            }
          }
          const INDUSTRY_MASTER = {
            // HEALTHCARE (12)
            "dental": { audience: "patients", salesTerm: "appointments", benefits: ["Gentle, caring approach", "Modern dental technology", "Family-friendly environment"], features: ["General dentistry", "Cosmetic dentistry", "Emergency dental care"], ctas: ["Book an Appointment", "Call Us Today"], valueProps: ["Experienced dental team"] },
            "medical": { audience: "patients", salesTerm: "appointments", benefits: ["Compassionate care", "Convenient appointments", "Bulk billing available"], features: ["General practice", "Health checks", "Chronic disease management"], ctas: ["Book an Appointment", "Call the Clinic"], valueProps: ["Qualified doctors"] },
            "chiropractic": { audience: "patients", salesTerm: "appointments", benefits: ["Natural pain relief", "Holistic approach", "Personalised treatment"], features: ["Spinal adjustments", "Posture correction", "Sports injuries"], ctas: ["Book an Appointment", "Get Relief Today"], valueProps: ["Qualified chiropractors"] },
            "physiotherapy": { audience: "patients", salesTerm: "appointments", benefits: ["Faster recovery", "Personalised treatment plans", "Expert care"], features: ["Sports physio", "Post-surgery rehab", "Pain management"], ctas: ["Book an Appointment", "Start Your Recovery"], valueProps: ["Qualified physiotherapists"] },
            "optometry": { audience: "patients", salesTerm: "appointments", benefits: ["Comprehensive eye care", "Latest technology", "Wide frame selection"], features: ["Eye exams", "Contact lenses", "Prescription glasses"], ctas: ["Book an Eye Test", "Visit Us"], valueProps: ["Qualified optometrists"] },
            "veterinary": { audience: "pet owners", salesTerm: "appointments", benefits: ["Compassionate pet care", "Modern facilities", "Experienced vets"], features: ["Vaccinations", "Surgery", "Dental care", "Emergency services"], ctas: ["Book an Appointment", "Call Us"], valueProps: ["Caring for pets like family"] },
            "psychology": { audience: "clients", salesTerm: "appointments", benefits: ["Confidential support", "Evidence-based treatment", "Safe space"], features: ["Individual therapy", "Couples counselling", "Anxiety treatment"], ctas: ["Book an Appointment", "Get Support"], valueProps: ["Registered psychologists"] },
            "podiatry": { audience: "patients", salesTerm: "appointments", benefits: ["Expert foot care", "Pain relief", "Custom orthotics"], features: ["Foot assessments", "Orthotics", "Sports podiatry"], ctas: ["Book an Appointment", "Get Help Today"], valueProps: ["Qualified podiatrists"] },
            "pharmacy": { audience: "customers", salesTerm: "orders", benefits: ["Friendly advice", "Fast service", "Competitive prices"], features: ["Prescriptions", "Health advice", "Vaccinations"], ctas: ["Visit Us", "Order Online"], valueProps: ["Trusted pharmacists"] },
            "aged care": { audience: "families", salesTerm: "enquiries", benefits: ["Compassionate care", "Safe environment", "Quality of life focus"], features: ["Residential care", "Respite care", "Home care"], ctas: ["Enquire Now", "Book a Tour"], valueProps: ["Experienced carers"] },
            "disability services": { audience: "clients", salesTerm: "consultations", benefits: ["Person-centred support", "Dignity and respect", "Independence focus"], features: ["NDIS services", "Support coordination", "Daily living support"], ctas: ["Contact Us", "Learn More"], valueProps: ["NDIS registered"] },
            "healthtech": { audience: "businesses", salesTerm: "demos", benefits: ["Better patient outcomes", "Streamlined workflows", "Data-driven insights"], features: ["Healthcare platform", "Patient management", "Telehealth"], ctas: ["Book a Demo", "Get Started"], valueProps: ["Healthcare innovation"] },
            // TECHNOLOGY & FINTECH (22)
            "fintech": { audience: "businesses", salesTerm: "demos", benefits: ["Seamless payments", "Secure transactions", "Fast settlement"], features: ["Payment processing", "API integration", "Dashboard"], ctas: ["Book a Demo", "Get Started"], valueProps: ["Bank-grade security"] },
            "banking": { audience: "account holders", salesTerm: "applications", benefits: ["Competitive rates", "Easy access", "Secure banking"], features: ["Savings accounts", "Loans", "Credit cards"], ctas: ["Apply Now", "Open an Account"], valueProps: ["Trusted bank"] },
            "lending": { audience: "borrowers", salesTerm: "applications", benefits: ["Competitive rates", "Fast approval", "Flexible terms"], features: ["Personal loans", "Home loans", "Business loans"], ctas: ["Apply Now", "Get a Quote"], valueProps: ["Fast approvals"] },
            "SaaS": { audience: "businesses", salesTerm: "demos", benefits: ["Save time", "Increase efficiency", "Easy to use"], features: ["Dashboard", "Reporting", "Integrations", "API access"], ctas: ["Book a Demo", "Start Free Trial"], valueProps: ["24/7 support"] },
            "enterprise software": { audience: "enterprise clients", salesTerm: "demos", benefits: ["Scalable solutions", "Enterprise security", "Dedicated support"], features: ["Enterprise platform", "Custom integrations", "SLA support"], ctas: ["Book a Demo", "Contact Sales"], valueProps: ["Enterprise-grade"] },
            "CRM": { audience: "businesses", salesTerm: "demos", benefits: ["Better customer relationships", "Sales automation", "Data insights"], features: ["Contact management", "Sales pipeline", "Reporting"], ctas: ["Book a Demo", "Try Free"], valueProps: ["Trusted by businesses"] },
            "ERP": { audience: "businesses", salesTerm: "demos", benefits: ["Unified operations", "Real-time visibility", "Process automation"], features: ["Finance", "Inventory", "HR", "Operations"], ctas: ["Book a Demo", "Contact Us"], valueProps: ["Complete business solution"] },
            "cybersecurity": { audience: "organisations", salesTerm: "assessments", benefits: ["Protect your data", "Compliance ready", "Peace of mind"], features: ["Security assessments", "Penetration testing", "Managed security"], ctas: ["Get an Assessment", "Contact Us"], valueProps: ["Certified experts"] },
            "cloud services": { audience: "businesses", salesTerm: "consultations", benefits: ["Scalable infrastructure", "Cost efficiency", "High availability"], features: ["Cloud hosting", "Migration", "Managed services"], ctas: ["Get a Consultation", "Learn More"], valueProps: ["Cloud experts"] },
            "data analytics": { audience: "businesses", salesTerm: "demos", benefits: ["Data-driven decisions", "Actionable insights", "Competitive advantage"], features: ["Business intelligence", "Dashboards", "Reports"], ctas: ["Book a Demo", "See It in Action"], valueProps: ["Data experts"] },
            "AI/ML": { audience: "businesses", salesTerm: "demos", benefits: ["Automation", "Intelligent insights", "Innovation"], features: ["Machine learning", "AI solutions", "Automation"], ctas: ["Book a Demo", "Explore Solutions"], valueProps: ["AI innovation"] },
            "telecommunications": { audience: "businesses", salesTerm: "quotes", benefits: ["Reliable connectivity", "Competitive rates", "Expert support"], features: ["Business phone", "Internet", "Unified communications"], ctas: ["Get a Quote", "Contact Us"], valueProps: ["Reliable network"] },
            "ISP": { audience: "customers", salesTerm: "sign-ups", benefits: ["Fast internet", "Reliable connection", "Great value"], features: ["Broadband", "NBN", "Business internet"], ctas: ["Sign Up", "Check Availability"], valueProps: ["Fast and reliable"] },
            "payments": { audience: "merchants", salesTerm: "integrations", benefits: ["Accept payments easily", "Fast settlements", "Low fees"], features: ["Payment gateway", "POS", "Online payments"], ctas: ["Get Started", "Contact Sales"], valueProps: ["Trusted payments"] },
            "ecommerce": { audience: "businesses", salesTerm: "demos", benefits: ["Sell online easily", "Grow your business", "Powerful features"], features: ["Online store", "Inventory", "Payments"], ctas: ["Start Free Trial", "Book a Demo"], valueProps: ["Ecommerce platform"] },
            "API/integration": { audience: "developers", salesTerm: "demos", benefits: ["Easy integration", "Powerful API", "Great documentation"], features: ["REST API", "Webhooks", "SDKs"], ctas: ["Get API Access", "Read Docs"], valueProps: ["Developer-friendly"] },
            "technology": { audience: "businesses", salesTerm: "demos", benefits: ["Innovative solutions", "Improved efficiency", "Competitive advantage"], features: ["Custom development", "Integration", "Support"], ctas: ["Book a Demo", "Contact Us"], valueProps: ["Expert team"] },
            "consumer electronics": { audience: "customers", salesTerm: "orders", benefits: ["Latest technology", "Quality products", "Great value"], features: ["Smartphones", "Tablets", "Accessories"], ctas: ["Shop Now", "Buy Today"], valueProps: ["Quality guaranteed"] },
            "software development": { audience: "businesses", salesTerm: "consultations", benefits: ["Custom solutions", "Expert developers", "On-time delivery"], features: ["Web development", "App development", "Custom software"], ctas: ["Get a Quote", "Discuss Your Project"], valueProps: ["Experienced developers"] },
            "neobank": { audience: "consumers", salesTerm: "sign-ups", benefits: ["No fees", "Easy app", "Great rates"], features: ["Mobile banking", "Savings", "Payments"], ctas: ["Sign Up", "Download App"], valueProps: ["Banking made easy"] },
            "wealthtech": { audience: "investors", salesTerm: "consultations", benefits: ["Grow your wealth", "Smart investing", "Low fees"], features: ["Investment platform", "Portfolio management", "Robo-advice"], ctas: ["Get Started", "Book a Consultation"], valueProps: ["Smart investing"] },
            "regtech": { audience: "businesses", salesTerm: "demos", benefits: ["Stay compliant", "Reduce risk", "Save time"], features: ["Compliance monitoring", "Reporting", "Risk management"], ctas: ["Book a Demo", "Learn More"], valueProps: ["Compliance experts"] },
            "insurtech": { audience: "customers", salesTerm: "quotes", benefits: ["Better coverage", "Easy claims", "Fair prices"], features: ["Insurance comparison", "Online quotes", "Claims"], ctas: ["Get a Quote", "Compare Now"], valueProps: ["Insurance innovation"] },
            "proptech": { audience: "property owners", salesTerm: "demos", benefits: ["Manage properties easily", "Increase returns", "Save time"], features: ["Property management", "Tenant portal", "Reporting"], ctas: ["Book a Demo", "Get Started"], valueProps: ["Property technology"] },
            "HR tech": { audience: "businesses", salesTerm: "demos", benefits: ["Streamline HR", "Better employee experience", "Save time"], features: ["HR platform", "Payroll", "Recruitment"], ctas: ["Book a Demo", "Try Free"], valueProps: ["HR made easy"] },
            "edtech": { audience: "students", salesTerm: "sign-ups", benefits: ["Learn anywhere", "Expert instructors", "Flexible learning"], features: ["Online courses", "Certifications", "Learning platform"], ctas: ["Sign Up", "Start Learning"], valueProps: ["Quality education"] },
            // FINANCE (7)
            "asset management": { audience: "investors", salesTerm: "consultations", benefits: ["Grow your portfolio", "Expert management", "Diversification"], features: ["Investment management", "Portfolio advice", "Reporting"], ctas: ["Book a Consultation", "Learn More"], valueProps: ["Licensed advisors"] },
            "private equity": { audience: "investors", salesTerm: "consultations", benefits: ["Access to opportunities", "Expert team", "Strong returns"], features: ["Private equity", "Venture capital", "Deal flow"], ctas: ["Contact Us", "Learn More"], valueProps: ["Experienced team"] },
            "superannuation": { audience: "members", salesTerm: "sign-ups", benefits: ["Grow your super", "Low fees", "Great performance"], features: ["Super fund", "Investment options", "Insurance"], ctas: ["Join Now", "Compare"], valueProps: ["Strong performance"] },
            "trading": { audience: "traders", salesTerm: "sign-ups", benefits: ["Low fees", "Fast execution", "Powerful tools"], features: ["Trading platform", "Research", "Tools"], ctas: ["Start Trading", "Open Account"], valueProps: ["Trusted platform"] },
            "invoice finance": { audience: "businesses", salesTerm: "applications", benefits: ["Improve cash flow", "Fast funding", "Flexible"], features: ["Invoice factoring", "Invoice discounting"], ctas: ["Apply Now", "Get a Quote"], valueProps: ["Fast approvals"] },
            "business lending": { audience: "businesses", salesTerm: "applications", benefits: ["Grow your business", "Fast approval", "Flexible terms"], features: ["Business loans", "Equipment finance", "Lines of credit"], ctas: ["Apply Now", "Get a Quote"], valueProps: ["Fast funding"] },
            "BNPL": { audience: "customers", salesTerm: "sign-ups", benefits: ["Buy now, pay later", "No interest", "Easy payments"], features: ["Payment plans", "Shop everywhere", "App"], ctas: ["Sign Up", "Download App"], valueProps: ["Interest-free"] },
            // PROFESSIONAL SERVICES (12)
            "legal": { audience: "clients", salesTerm: "consultations", benefits: ["Expert legal advice", "Personalised service", "Clear communication"], features: ["Legal advice", "Representation", "Document preparation"], ctas: ["Book a Consultation", "Contact Us"], valueProps: ["Experienced solicitors"] },
            "accounting": { audience: "clients", salesTerm: "consultations", benefits: ["Maximise your returns", "Reduce stress", "Expert advice"], features: ["Tax returns", "Bookkeeping", "BAS lodgement", "Business advice"], ctas: ["Book a Consultation", "Get in Touch"], valueProps: ["Qualified accountants"] },
            "financial services": { audience: "clients", salesTerm: "consultations", benefits: ["Grow your wealth", "Secure your future", "Expert guidance"], features: ["Financial planning", "Investment advice", "Retirement planning"], ctas: ["Book a Consultation", "Start Planning"], valueProps: ["Licensed advisors"] },
            "insurance": { audience: "policyholders", salesTerm: "quotes", benefits: ["Peace of mind", "Comprehensive coverage", "Competitive premiums"], features: ["Home insurance", "Car insurance", "Life insurance"], ctas: ["Get a Quote", "Contact Us"], valueProps: ["Trusted providers"] },
            "real estate": { audience: "buyers and sellers", salesTerm: "consultations", benefits: ["Local market expertise", "Maximum sale price", "Smooth transactions"], features: ["Property sales", "Property management", "Valuations"], ctas: ["Book an Appraisal", "Contact Us"], valueProps: ["Experienced agents"] },
            "recruitment": { audience: "employers", salesTerm: "consultations", benefits: ["Find the right talent", "Save time", "Expert screening"], features: ["Permanent recruitment", "Contract staffing", "Executive search"], ctas: ["Contact Us", "Post a Job"], valueProps: ["Recruitment experts"] },
            "consulting": { audience: "businesses", salesTerm: "consultations", benefits: ["Expert insights", "Proven strategies", "Measurable results"], features: ["Strategy consulting", "Business advisory", "Implementation support"], ctas: ["Book a Consultation", "Get in Touch"], valueProps: ["Experienced consultants"] },
            "architecture": { audience: "clients", salesTerm: "consultations", benefits: ["Creative designs", "Expert planning", "Quality outcomes"], features: ["Architectural design", "Planning", "Project management"], ctas: ["Book a Consultation", "View Portfolio"], valueProps: ["Award-winning designs"] },
            "interior design": { audience: "clients", salesTerm: "consultations", benefits: ["Beautiful spaces", "Expert design", "Personal style"], features: ["Interior design", "Styling", "Renovations"], ctas: ["Book a Consultation", "View Portfolio"], valueProps: ["Creative designers"] },
            "graphic design": { audience: "businesses", salesTerm: "quotes", benefits: ["Stand out", "Professional branding", "Creative designs"], features: ["Logo design", "Branding", "Marketing materials"], ctas: ["Get a Quote", "View Portfolio"], valueProps: ["Creative team"] },
            "web development": { audience: "businesses", salesTerm: "quotes", benefits: ["Professional website", "User-friendly", "SEO optimised"], features: ["Website design", "Web development", "Ecommerce"], ctas: ["Get a Quote", "View Portfolio"], valueProps: ["Expert developers"] },
            "marketing": { audience: "businesses", salesTerm: "consultations", benefits: ["Grow your business", "Reach more customers", "Measurable results"], features: ["Digital marketing", "SEO", "Social media", "Content"], ctas: ["Book a Consultation", "Get a Quote"], valueProps: ["Marketing experts"] },
            "IT services": { audience: "businesses", salesTerm: "consultations", benefits: ["Reliable IT support", "Reduce downtime", "Expert team"], features: ["IT support", "Managed services", "Cloud solutions"], ctas: ["Contact Us", "Get a Quote"], valueProps: ["Certified technicians"] },
            // BEAUTY & WELLNESS (7)
            "hair salon": { audience: "clients", salesTerm: "appointments", benefits: ["Expert stylists", "Personalised service", "Relaxing experience"], features: ["Haircuts", "Colour", "Styling", "Treatments"], ctas: ["Book an Appointment", "Call Us"], valueProps: ["Experienced stylists"] },
            "spa": { audience: "clients", salesTerm: "bookings", benefits: ["Ultimate relaxation", "Expert therapists", "Luxurious environment"], features: ["Massage", "Facials", "Body treatments", "Packages"], ctas: ["Book Now", "Treat Yourself"], valueProps: ["Qualified therapists"] },
            "beauty": { audience: "clients", salesTerm: "appointments", benefits: ["Look your best", "Expert beauticians", "Quality products"], features: ["Facials", "Waxing", "Nails", "Makeup"], ctas: ["Book an Appointment", "Call Us"], valueProps: ["Beauty experts"] },
            "fitness": { audience: "members", salesTerm: "memberships", benefits: ["Achieve your goals", "Expert trainers", "Modern equipment"], features: ["Gym access", "Group classes", "Personal training"], ctas: ["Join Now", "Start Your Journey"], valueProps: ["Qualified trainers"] },
            "yoga": { audience: "members", salesTerm: "classes", benefits: ["Mind and body wellness", "Expert instructors", "Supportive community"], features: ["Yoga classes", "Meditation", "Workshops"], ctas: ["Book a Class", "Try a Free Class"], valueProps: ["Experienced instructors"] },
            "martial arts": { audience: "students", salesTerm: "classes", benefits: ["Build confidence", "Get fit", "Learn self-defence"], features: ["Martial arts classes", "Kids programs", "Adult classes"], ctas: ["Book a Trial", "Join Now"], valueProps: ["Expert instructors"] },
            "dance": { audience: "students", salesTerm: "classes", benefits: ["Express yourself", "Get fit", "Have fun"], features: ["Dance classes", "Kids programs", "Adult classes"], ctas: ["Book a Class", "Join Now"], valueProps: ["Professional dancers"] },
            // HOSPITALITY & FOOD (6)
            "restaurant": { audience: "diners", salesTerm: "reservations", benefits: ["Fresh ingredients", "Great atmosphere", "Excellent service"], features: ["Dine-in", "Takeaway", "Catering", "Private functions"], ctas: ["Book a Table", "Order Now"], valueProps: ["Fresh, local produce"] },
            "cafe": { audience: "customers", salesTerm: "orders", benefits: ["Great coffee", "Fresh food", "Welcoming atmosphere"], features: ["Coffee", "Breakfast", "Lunch", "Cakes"], ctas: ["Visit Us", "Order Online"], valueProps: ["Expert baristas"] },
            "bakery": { audience: "customers", salesTerm: "orders", benefits: ["Fresh baked daily", "Quality ingredients", "Delicious treats"], features: ["Bread", "Pastries", "Cakes", "Catering"], ctas: ["Order Now", "Visit Us"], valueProps: ["Fresh baked"] },
            "catering": { audience: "clients", salesTerm: "quotes", benefits: ["Delicious food", "Professional service", "Stress-free events"], features: ["Corporate catering", "Event catering", "Private functions"], ctas: ["Get a Quote", "Contact Us"], valueProps: ["Quality catering"] },
            "bar": { audience: "patrons", salesTerm: "bookings", benefits: ["Great drinks", "Fun atmosphere", "Live entertainment"], features: ["Cocktails", "Beer", "Wine", "Events"], ctas: ["Book a Table", "See Events"], valueProps: ["Great vibes"] },
            "hospitality": { audience: "guests", salesTerm: "bookings", benefits: ["Comfortable rooms", "Great location", "Friendly service"], features: ["Accommodation", "Room service", "Facilities", "Events"], ctas: ["Book Now", "Check Availability"], valueProps: ["Prime location"] },
            // RETAIL (4)
            "florist": { audience: "customers", salesTerm: "orders", benefits: ["Beautiful arrangements", "Fresh flowers", "Same-day delivery"], features: ["Bouquets", "Arrangements", "Weddings", "Events"], ctas: ["Order Now", "Shop Flowers"], valueProps: ["Fresh flowers"] },
            "jewelry": { audience: "customers", salesTerm: "orders", benefits: ["Quality pieces", "Expert craftsmanship", "Beautiful designs"], features: ["Rings", "Necklaces", "Earrings", "Custom design"], ctas: ["Shop Now", "Browse Collection"], valueProps: ["Quality jewelry"] },
            "furniture": { audience: "customers", salesTerm: "orders", benefits: ["Quality furniture", "Great designs", "Competitive prices"], features: ["Sofas", "Beds", "Dining", "Office"], ctas: ["Shop Now", "Visit Showroom"], valueProps: ["Quality furniture"] },
            "retail": { audience: "customers", salesTerm: "orders", benefits: ["Quality products", "Great prices", "Fast delivery"], features: ["Wide range", "Easy returns", "Fast shipping"], ctas: ["Shop Now", "Buy Today"], valueProps: ["Quality guaranteed"] },
            // EDUCATION (5)
            "tutoring": { audience: "students and families", salesTerm: "sessions", benefits: ["Improved grades", "Personalised learning", "Expert tutors"], features: ["One-on-one tutoring", "Group classes", "Exam preparation"], ctas: ["Book a Session", "Get Started"], valueProps: ["Qualified tutors"] },
            "driving school": { audience: "learners", salesTerm: "lessons", benefits: ["Learn to drive safely", "Patient instructors", "High pass rates"], features: ["Driving lessons", "Test preparation"], ctas: ["Book a Lesson", "Get Started"], valueProps: ["Patient instructors"] },
            "music school": { audience: "students", salesTerm: "lessons", benefits: ["Learn from experts", "Develop your skills", "All ages welcome"], features: ["Music lessons", "Group classes", "Performances"], ctas: ["Book a Lesson", "Enquire Now"], valueProps: ["Experienced teachers"] },
            "childcare": { audience: "families", salesTerm: "enrollments", benefits: ["Safe environment", "Qualified educators", "Stimulating programs"], features: ["Early learning", "Before/after school care", "Holiday programs"], ctas: ["Enrol Now", "Book a Tour"], valueProps: ["Qualified educators"] },
            "early education": { audience: "families", salesTerm: "enrollments", benefits: ["Strong foundation", "Quality care", "Learning through play"], features: ["Preschool", "Kindergarten", "Early learning"], ctas: ["Enrol Now", "Book a Tour"], valueProps: ["Qualified teachers"] },
            // EVENTS & CREATIVE (5)
            "photography": { audience: "clients", salesTerm: "sessions", benefits: ["Stunning images", "Professional quality", "Memorable moments"], features: ["Portraits", "Events", "Commercial", "Editing"], ctas: ["Book a Session", "View Portfolio"], valueProps: ["Award-winning photographer"] },
            "videography": { audience: "clients", salesTerm: "quotes", benefits: ["Professional videos", "Creative storytelling", "High quality"], features: ["Video production", "Editing", "Corporate video"], ctas: ["Get a Quote", "View Portfolio"], valueProps: ["Professional videographers"] },
            "wedding": { audience: "couples", salesTerm: "consultations", benefits: ["Dream wedding", "Stress-free planning", "Attention to detail"], features: ["Wedding planning", "Venue", "Catering", "Decorations"], ctas: ["Book a Consultation", "See Packages"], valueProps: ["Wedding experts"] },
            "events": { audience: "clients", salesTerm: "consultations", benefits: ["Stress-free planning", "Creative ideas", "Flawless execution"], features: ["Weddings", "Corporate events", "Private parties"], ctas: ["Book a Consultation", "Start Planning"], valueProps: ["Experienced planners"] },
            "printing": { audience: "businesses", salesTerm: "quotes", benefits: ["Quality printing", "Fast turnaround", "Great prices"], features: ["Business cards", "Flyers", "Banners", "Large format"], ctas: ["Get a Quote", "Order Now"], valueProps: ["Quality printing"] },
            // AUTOMOTIVE (3)
            "automotive": { audience: "vehicle owners", salesTerm: "bookings", benefits: ["Expert mechanics", "Quality repairs", "Fair prices"], features: ["Servicing", "Repairs", "Tyres", "Roadworthy"], ctas: ["Book a Service", "Call Now"], valueProps: ["Licensed mechanics"] },
            "car wash": { audience: "vehicle owners", salesTerm: "bookings", benefits: ["Sparkling clean", "Convenient", "Quality products"], features: ["Car wash", "Detailing", "Interior cleaning"], ctas: ["Book Now", "Visit Us"], valueProps: ["Quality results"] },
            "car dealership": { audience: "buyers", salesTerm: "enquiries", benefits: ["Great selection", "Competitive prices", "Quality vehicles"], features: ["New cars", "Used cars", "Finance", "Trade-ins"], ctas: ["Browse Vehicles", "Contact Us"], valueProps: ["Quality vehicles"] },
            // TRADES (17)
            "plumbing": { audience: "homeowners", salesTerm: "quotes", benefits: ["Fast response times", "Upfront pricing", "Quality workmanship"], features: ["Repairs", "Installations", "Maintenance", "Emergency plumbing"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Licensed plumbers"] },
            "electrical": { audience: "homeowners", salesTerm: "quotes", benefits: ["Safe and reliable", "Upfront pricing", "Clean and tidy work"], features: ["Repairs", "Installations", "Safety inspections", "Upgrades"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Licensed electricians"] },
            "hvac": { audience: "homeowners", salesTerm: "quotes", benefits: ["Year-round comfort", "Energy efficient", "Expert installation"], features: ["Installation", "Repairs", "Maintenance", "Ducted systems"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Licensed technicians"] },
            "roofing": { audience: "homeowners", salesTerm: "quotes", benefits: ["Quality materials", "Experienced team", "Weather-proof results"], features: ["Roof repairs", "Roof restoration", "Gutter replacement", "New roofs"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Licensed roofers"] },
            "landscaping": { audience: "homeowners", salesTerm: "quotes", benefits: ["Transform your outdoor space", "Professional design", "Quality plants"], features: ["Garden design", "Lawn care", "Paving", "Retaining walls"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Experienced landscapers"] },
            "pest control": { audience: "homeowners", salesTerm: "quotes", benefits: ["Effective treatments", "Safe for families", "Long-lasting results"], features: ["General pest control", "Termite inspections", "Rodent control"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Licensed technicians"] },
            "cleaning": { audience: "homeowners", salesTerm: "quotes", benefits: ["Sparkling clean results", "Trustworthy team", "Flexible scheduling"], features: ["Regular cleaning", "Deep cleaning", "End of lease", "Office cleaning"], ctas: ["Get a Free Quote", "Book Now"], valueProps: ["Police-checked cleaners"] },
            "moving": { audience: "clients", salesTerm: "quotes", benefits: ["Stress-free move", "Careful handling", "On-time service"], features: ["Home moves", "Office relocations", "Packing", "Storage"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Professional movers"] },
            "painting": { audience: "homeowners", salesTerm: "quotes", benefits: ["Quality finish", "Clean and tidy", "Colour advice"], features: ["Interior painting", "Exterior painting", "Commercial"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Licensed painters"] },
            "carpentry": { audience: "homeowners", salesTerm: "quotes", benefits: ["Quality craftsmanship", "Custom solutions", "Attention to detail"], features: ["Custom joinery", "Cabinets", "Decks", "Renovations"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Skilled carpenters"] },
            "fencing": { audience: "homeowners", salesTerm: "quotes", benefits: ["Quality fencing", "Secure property", "Great value"], features: ["Timber fencing", "Colorbond", "Pool fencing", "Gates"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Quality fencing"] },
            "solar": { audience: "homeowners", salesTerm: "quotes", benefits: ["Reduce power bills", "Clean energy", "Increase property value"], features: ["Solar panels", "Battery storage", "Installation"], ctas: ["Get a Free Quote", "Calculate Savings"], valueProps: ["CEC accredited"] },
            "locksmith": { audience: "clients", salesTerm: "bookings", benefits: ["Fast response", "24/7 service", "Licensed locksmith"], features: ["Emergency lockout", "Lock installation", "Key cutting"], ctas: ["Call Now", "Get Help"], valueProps: ["Licensed locksmith"] },
            "towing": { audience: "vehicle owners", salesTerm: "bookings", benefits: ["Fast response", "24/7 service", "Safe transport"], features: ["Towing", "Roadside assistance", "Accident recovery"], ctas: ["Call Now", "Get Help"], valueProps: ["24/7 service"] },
            "pool services": { audience: "homeowners", salesTerm: "quotes", benefits: ["Crystal clear pool", "Expert care", "Regular maintenance"], features: ["Pool cleaning", "Maintenance", "Repairs", "Equipment"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Pool experts"] },
            "tiling": { audience: "homeowners", salesTerm: "quotes", benefits: ["Quality finish", "Expert installation", "Wide range"], features: ["Floor tiling", "Wall tiling", "Bathroom tiling"], ctas: ["Get a Free Quote", "Call Now"], valueProps: ["Expert tilers"] },
            "appliance repair": { audience: "homeowners", salesTerm: "bookings", benefits: ["Fast repairs", "Expert technicians", "Affordable prices"], features: ["Washing machine repair", "Fridge repair", "Dishwasher repair"], ctas: ["Book a Repair", "Call Now"], valueProps: ["Expert technicians"] },
            "construction": { audience: "clients", salesTerm: "quotes", benefits: ["Quality craftsmanship", "On-time delivery", "Transparent pricing"], features: ["New builds", "Renovations", "Extensions", "Commercial construction"], ctas: ["Get a Free Quote", "Discuss Your Project"], valueProps: ["Licensed builder"] },
            // OTHER (8)
            "security": { audience: "clients", salesTerm: "consultations", benefits: ["Peace of mind", "Professional service", "24/7 monitoring"], features: ["Security systems", "CCTV", "Alarm monitoring", "Guards"], ctas: ["Get a Quote", "Contact Us"], valueProps: ["Licensed security"] },
            "pet grooming": { audience: "pet owners", salesTerm: "appointments", benefits: ["Happy pets", "Professional grooming", "Gentle handling"], features: ["Dog grooming", "Cat grooming", "Nail trimming", "Bathing"], ctas: ["Book an Appointment", "Call Us"], valueProps: ["Pet lovers"] },
            "pet boarding": { audience: "pet owners", salesTerm: "bookings", benefits: ["Safe and comfortable", "Loving care", "Peace of mind"], features: ["Dog boarding", "Cat boarding", "Day care"], ctas: ["Book Now", "Contact Us"], valueProps: ["Pet lovers"] },
            "travel": { audience: "travellers", salesTerm: "bookings", benefits: ["Dream holidays", "Expert advice", "Great deals"], features: ["Flights", "Hotels", "Packages", "Cruises"], ctas: ["Book Now", "Get a Quote"], valueProps: ["Travel experts"] },
            "funeral services": { audience: "families", salesTerm: "consultations", benefits: ["Compassionate support", "Dignified farewells", "Personal service"], features: ["Funeral services", "Memorial services", "Pre-planning"], ctas: ["Contact Us", "Speak to Us"], valueProps: ["Compassionate care"] },
            "storage": { audience: "customers", salesTerm: "bookings", benefits: ["Secure storage", "Easy access", "Flexible terms"], features: ["Self storage", "Business storage", "Vehicle storage"], ctas: ["Book Now", "Get a Quote"], valueProps: ["Secure facilities"] },
            "manufacturing": { audience: "businesses", salesTerm: "quotes", benefits: ["Quality products", "On-time delivery", "Competitive pricing"], features: ["Manufacturing", "Custom production", "Assembly"], ctas: ["Get a Quote", "Contact Us"], valueProps: ["Quality manufacturing"] },
            "logistics": { audience: "businesses", salesTerm: "quotes", benefits: ["Reliable delivery", "Fast turnaround", "Tracking"], features: ["Freight", "Warehousing", "Distribution"], ctas: ["Get a Quote", "Contact Us"], valueProps: ["Reliable logistics"] },
            "wholesale": { audience: "retailers", salesTerm: "orders", benefits: ["Competitive prices", "Quality products", "Reliable supply"], features: ["Wholesale products", "Bulk ordering", "Distribution"], ctas: ["Open an Account", "Contact Us"], valueProps: ["Trade prices"] }
          };
          const GENERIC_FALLBACKS = {
            audience: "clients",
            salesTerm: "appointments",
            benefits: ["Professional service", "Experienced team", "Quality results"],
            features: ["Expert advice", "Professional service", "Reliable support"],
            painPoints: ["Wasted time and frustration", "Uncertainty about next steps", "Difficulty finding reliable help"],
            ctas: ["Contact Us", "Get in Touch"],
            valueProps: ["Experienced team", "Quality service"],
            validators: ["service", "professional", "quality"]
          };
          const INDUSTRY_PAIN_POINTS = {
            // Healthcare
            "dental": ["Anxiety about dental visits", "Long waiting times", "Cost concerns"],
            "medical": ["Difficulty getting appointments", "Long wait times", "Feeling unheard by doctors"],
            "legal": ["Confusion about legal rights", "Stress dealing with legal matters", "Uncertainty about compensation"],
            "accounting": ["Tax deadline stress", "Fear of ATO audits", "Messy financial records"],
            "financial services": ["Uncertainty about retirement", "Complex investment options", "Worry about financial future"],
            // Trades
            "plumbing": ["Emergency leaks causing damage", "Unreliable tradies who don't show up", "Unexpected repair costs"],
            "electrical": ["Safety concerns with old wiring", "Power outages", "Finding trustworthy electricians"],
            "construction": ["Project delays and cost blowouts", "Difficulty finding reliable builders", "Communication issues"],
            // Technology
            "SaaS": ["Complex software that's hard to use", "Wasted time on manual processes", "Data scattered across systems"],
            "IT services": ["System downtime affecting business", "Cybersecurity concerns", "Outdated technology"],
            // Hospitality
            "restaurant": ["Difficulty finding good restaurants", "Long wait times", "Inconsistent food quality"],
            "fitness": ["Lack of motivation", "Not seeing results", "Expensive gym memberships"],
            // Retail/E-commerce
            "retail": ["Finding quality products", "Poor customer service", "Returns hassle"],
            "ecommerce": ["Shipping delays", "Product quality uncertainty", "Returns process"]
          };
          const INDUSTRY_VALIDATORS = {
            // HEALTHCARE (12)
            "dental": ["dental", "dentist", "teeth", "orthodont", "smile", "oral"],
            "medical": ["doctor", "medical", "clinic", "gp", "physician", "health"],
            "chiropractic": ["chiropract", "spine", "adjustment", "back pain"],
            "physiotherapy": ["physio", "rehabilitation", "exercise", "mobility"],
            "optometry": ["optom", "eye", "vision", "glasses", "lens"],
            "veterinary": ["vet", "animal", "pet", "dog", "cat"],
            "psychology": ["psycholog", "therap", "counsell", "mental health"],
            "podiatry": ["podiatr", "foot", "feet", "orthotics"],
            "pharmacy": ["pharmacy", "chemist", "prescription", "medication"],
            "aged care": ["aged care", "elderly", "nursing home", "senior"],
            "disability services": ["disability", "ndis", "support worker"],
            "healthtech": ["healthtech", "digital health", "patient platform"],
            // TECHNOLOGY & FINTECH (22)
            "fintech": ["fintech", "financial technology", "payment platform"],
            "banking": ["bank", "savings", "account", "deposit"],
            "lending": ["loan", "lend", "mortgage", "borrow", "finance"],
            "SaaS": ["saas", "software", "platform", "cloud", "subscription"],
            "enterprise software": ["enterprise", "software", "solution", "platform"],
            "CRM": ["crm", "customer relationship", "sales pipeline"],
            "ERP": ["erp", "enterprise resource", "business software"],
            "cybersecurity": ["cyber", "security", "breach", "protect"],
            "cloud services": ["cloud", "aws", "azure", "hosting"],
            "data analytics": ["analytics", "data", "insights", "dashboard"],
            "AI/ML": ["artificial intelligence", "machine learning", "ai"],
            "telecommunications": ["telecom", "phone", "network", "connectivity"],
            "ISP": ["internet", "broadband", "nbn", "isp"],
            "payments": ["payment", "transaction", "checkout", "merchant"],
            "ecommerce": ["ecommerce", "online store", "shopify"],
            "API/integration": ["api", "integration", "webhook", "developer"],
            "technology": ["technology", "tech", "software", "digital"],
            "consumer electronics": ["iphone", "ipad", "phone", "device", "electronics", "gadget"],
            "software development": ["developer", "software", "coding", "app"],
            "neobank": ["neobank", "mobile banking", "digital bank"],
            "wealthtech": ["wealth", "invest", "portfolio", "robo"],
            "regtech": ["regtech", "compliance", "regulation"],
            "insurtech": ["insurtech", "insurance platform"],
            "proptech": ["proptech", "property tech", "real estate platform"],
            "HR tech": ["hr tech", "hrtech", "people platform", "payroll"],
            "edtech": ["edtech", "learning platform", "online course"],
            // FINANCE (7)
            "asset management": ["asset", "fund", "investment management"],
            "private equity": ["private equity", "venture", "capital"],
            "superannuation": ["super", "superannuation", "retirement"],
            "trading": ["trading", "broker", "stock", "share"],
            "invoice finance": ["invoice", "factoring", "debtor"],
            "business lending": ["business loan", "equipment finance"],
            "BNPL": ["buy now pay later", "bnpl", "afterpay", "zip"],
            // PROFESSIONAL SERVICES (13)
            "legal": ["lawyer", "solicitor", "attorney", "law firm", "legal", "barrister"],
            "accounting": ["accountant", "accounting", "tax", "bookkeep", "bas", "cpa", "audit", "advisory", "financial advice"],
            "financial services": ["financial plann", "wealth", "advisor"],
            "insurance": ["insurance", "policy", "premium", "cover", "claim"],
            "real estate": ["real estate", "property", "house", "apartment", "agent"],
            "recruitment": ["recruit", "staffing", "job", "talent"],
            "consulting": ["consult", "advisory", "strategy"],
            "architecture": ["architect", "design", "building"],
            "interior design": ["interior", "design", "decorat"],
            "graphic design": ["graphic", "design", "brand", "logo"],
            "web development": ["web", "website", "developer"],
            "marketing": ["marketing", "seo", "digital marketing", "advertising"],
            "IT services": ["it service", "managed service", "tech support"],
            // BEAUTY & WELLNESS (7)
            "hair salon": ["hair", "salon", "stylist", "haircut", "colour"],
            "spa": ["spa", "massage", "relax", "treatment"],
            "beauty": ["beauty", "facial", "wax", "nail"],
            "fitness": ["fitness", "gym", "train", "workout"],
            "yoga": ["yoga", "pilates", "meditation"],
            "martial arts": ["martial art", "karate", "taekwondo", "mma"],
            "dance": ["dance", "ballet", "studio"],
            // HOSPITALITY & FOOD (6)
            "restaurant": ["restaurant", "menu", "dining", "chef", "food"],
            "cafe": ["cafe", "coffee", "barista"],
            "bakery": ["bakery", "bread", "cake", "pastry"],
            "catering": ["catering", "event", "function"],
            "bar": ["bar", "pub", "cocktail", "beer"],
            "hospitality": ["hotel", "motel", "accommodation", "room"],
            // RETAIL (4)
            "florist": ["florist", "flower", "bouquet"],
            "jewelry": ["jewel", "ring", "necklace", "diamond"],
            "furniture": ["furniture", "sofa", "bed", "table"],
            "retail": ["shop", "store", "buy", "product"],
            // EDUCATION (5)
            "tutoring": ["tutor", "tutoring", "study", "exam"],
            "driving school": ["driving", "learner", "licence", "lesson"],
            "music school": ["music", "lesson", "instrument", "piano"],
            "childcare": ["childcare", "daycare", "early learning"],
            "early education": ["preschool", "kindergarten", "early education"],
            // EVENTS & CREATIVE (5)
            "photography": ["photo", "photographer", "shoot"],
            "videography": ["video", "film", "production"],
            "wedding": ["wedding", "bride", "ceremony"],
            "events": ["event", "party", "function"],
            "printing": ["print", "flyer", "banner", "signage"],
            // AUTOMOTIVE (3)
            "automotive": ["mechanic", "car service", "vehicle", "auto"],
            "car wash": ["car wash", "detail", "clean"],
            "car dealership": ["car", "vehicle", "dealer", "used car"],
            // TRADES (17)
            "plumbing": ["plumber", "plumbing", "pipe", "drain", "hot water"],
            "electrical": ["electrician", "electrical", "power", "wiring"],
            "hvac": ["hvac", "air condition", "heating", "cooling"],
            "roofing": ["roof", "gutter", "tile"],
            "landscaping": ["landscap", "garden", "lawn", "paving"],
            "pest control": ["pest", "termite", "rodent", "exterminator"],
            "cleaning": ["clean", "maid", "domestic", "office clean"],
            "moving": ["mov", "removalist", "relocat"],
            "painting": ["paint", "painter", "colour"],
            "carpentry": ["carpenter", "joinery", "cabinet", "wood"],
            "fencing": ["fence", "fencing", "gate"],
            "solar": ["solar", "panel", "energy"],
            "locksmith": ["locksmith", "lock", "key"],
            "towing": ["tow", "roadside", "breakdown"],
            "pool services": ["pool", "swimming", "chlorine"],
            "tiling": ["tile", "tiler", "floor"],
            "appliance repair": ["appliance", "repair", "washing machine"],
            "construction": ["construction", "builder", "build", "renovate"],
            // OTHER (8)
            "security": ["security", "cctv", "guard", "alarm"],
            "pet grooming": ["groom", "pet", "dog groom"],
            "pet boarding": ["boarding", "kennel", "pet care"],
            "travel": ["travel", "holiday", "flight", "tour"],
            "funeral services": ["funeral", "memorial", "cremation"],
            "storage": ["storage", "self storage", "unit"],
            "manufacturing": ["manufactur", "factory", "production"],
            "logistics": ["logistics", "freight", "shipping", "warehouse"],
            "wholesale": ["wholesale", "distributor", "trade"]
          };
          let industry = "";
          let serviceType = "";
          let industryNiche = "";
          const industryRules = [
            // PRIORITY 0: Healthcare (Check FIRST - very specific terms)
            { check: /* @__PURE__ */ __name(() => hasWord("dental") || hasWord("dentist") || hasWord("orthodont"), "check"), industry: "dental", serviceType: "dental practice" },
            { check: /* @__PURE__ */ __name(() => hasWord("medical") || hasWord("doctor") || hasWord("physician") || hasWord("gp ") || hasPhrase("general practice"), "check"), industry: "medical", serviceType: "medical practice" },
            { check: /* @__PURE__ */ __name(() => hasWord("chiro") || hasPhrase("chiropractor"), "check"), industry: "chiropractic", serviceType: "chiropractic services" },
            { check: /* @__PURE__ */ __name(() => hasWord("physio") || hasPhrase("physiotherapy") || hasPhrase("physical therapy"), "check"), industry: "physiotherapy", serviceType: "physiotherapy services" },
            { check: /* @__PURE__ */ __name(() => hasWord("optom") || hasPhrase("eye care") || hasPhrase("optician"), "check"), industry: "optometry", serviceType: "optometry services" },
            { check: /* @__PURE__ */ __name(() => hasWord("veterina") || hasWord("vet ") || hasPhrase("animal hospital") || hasPhrase("pet clinic"), "check"), industry: "veterinary", serviceType: "veterinary practice" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("psychology") || hasPhrase("psychologist") || hasPhrase("counsell") || hasPhrase("mental health"), "check"), industry: "psychology", serviceType: "psychology services" },
            { check: /* @__PURE__ */ __name(() => hasWord("podiatr") || hasPhrase("foot doctor"), "check"), industry: "podiatry", serviceType: "podiatry services" },
            { check: /* @__PURE__ */ __name(() => hasWord("pharmacy") || hasWord("chemist") || hasPhrase("dispensary"), "check"), industry: "pharmacy", serviceType: "pharmacy services" },
            // PRIORITY 1: Technology & Enterprise (Check these next to avoid false positives)
            { check: /* @__PURE__ */ __name(() => hasPhrase("fintech") || hasPhrase("financial technology"), "check"), industry: "fintech", serviceType: "fintech solutions" },
            { check: /* @__PURE__ */ __name(() => hasWord("bank") && (hasPhrase("banking") || hasPhrase("credit union") || hasPhrase("financial")), "check"), industry: "banking", serviceType: "banking services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("mortgage") || hasPhrase("home loan") || hasWord("lender"), "check"), industry: "lending", serviceType: "lending services" },
            { check: /* @__PURE__ */ __name(() => hasWord("saas") || hasPhrase("software as a service") || hasPhrase("cloud platform"), "check"), industry: "SaaS", serviceType: "SaaS platform" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("enterprise software") || hasPhrase("business software"), "check"), industry: "enterprise software", serviceType: "enterprise software" },
            { check: /* @__PURE__ */ __name(() => hasWord("crm") || hasPhrase("customer relationship"), "check"), industry: "CRM", serviceType: "CRM software" },
            { check: /* @__PURE__ */ __name(() => hasWord("erp") || hasPhrase("enterprise resource"), "check"), industry: "ERP", serviceType: "ERP software" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("cyber security") || hasPhrase("cybersecurity") || hasWord("infosec"), "check"), industry: "cybersecurity", serviceType: "cybersecurity services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("cloud computing") || hasPhrase("cloud services") || hasWord("aws") || hasWord("azure"), "check"), industry: "cloud services", serviceType: "cloud computing" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("data analytics") || hasPhrase("business intelligence"), "check"), industry: "data analytics", serviceType: "data analytics" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("artificial intelligence") || hasPhrase("machine learning"), "check"), industry: "AI/ML", serviceType: "AI solutions" },
            { check: /* @__PURE__ */ __name(() => hasWord("telecom") || hasPhrase("telecommunications") || hasWord("telco"), "check"), industry: "telecommunications", serviceType: "telecommunications" },
            { check: /* @__PURE__ */ __name(() => hasWord("isp") || hasPhrase("internet provider") || hasPhrase("broadband"), "check"), industry: "ISP", serviceType: "internet services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("payment") && (hasPhrase("processing") || hasPhrase("gateway") || hasPhrase("solution")), "check"), industry: "payments", serviceType: "payment solutions" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("ecommerce platform") || hasPhrase("online store") || hasWord("shopify"), "check"), industry: "ecommerce", serviceType: "ecommerce platform" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("developer platform") || hasPhrase("api platform"), "check"), industry: "API/integration", serviceType: "API services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("tech company") || hasPhrase("technology company") || hasPhrase("tech startup"), "check"), industry: "technology", serviceType: "technology solutions" },
            { check: /* @__PURE__ */ __name(() => hasWord("iphone") || hasWord("ipad") || hasWord("macbook") || hasWord("android") || hasPhrase("smartphone"), "check"), industry: "consumer electronics", serviceType: "consumer electronics" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("software development") || hasPhrase("custom software") || hasWord("devops"), "check"), industry: "software development", serviceType: "software development" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("asset management") || hasPhrase("investment management") || hasPhrase("fund manager"), "check"), industry: "asset management", serviceType: "asset management" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("private equity") || hasPhrase("venture capital"), "check"), industry: "private equity", serviceType: "investment services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("superannuation") || hasPhrase("super fund") || hasPhrase("retirement fund"), "check"), industry: "superannuation", serviceType: "superannuation services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("stock broker") || hasPhrase("trading platform") || hasPhrase("investment platform"), "check"), industry: "trading", serviceType: "trading platform" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("invoice") && (hasPhrase("finance") || hasPhrase("factoring")), "check"), industry: "invoice finance", serviceType: "invoice financing" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("business loan") || hasPhrase("commercial lending") || hasPhrase("sme lending"), "check"), industry: "business lending", serviceType: "business lending" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("buy now pay later") || hasWord("bnpl") || hasWord("afterpay") || hasWord("klarna"), "check"), industry: "BNPL", serviceType: "BNPL services" },
            { check: /* @__PURE__ */ __name(() => hasWord("neobank") || hasPhrase("digital bank") || hasPhrase("challenger bank"), "check"), industry: "neobank", serviceType: "digital banking" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("wealth tech") || hasPhrase("wealthtech") || hasPhrase("robo advis"), "check"), industry: "wealthtech", serviceType: "wealth technology" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("regtech") || hasPhrase("compliance software"), "check"), industry: "regtech", serviceType: "regulatory technology" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("insurtech") || hasPhrase("insurance technology"), "check"), industry: "insurtech", serviceType: "insurance technology" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("proptech") || hasPhrase("property technology"), "check"), industry: "proptech", serviceType: "property technology" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("hr tech") || hasPhrase("hrtech") || hasPhrase("people platform"), "check"), industry: "HR tech", serviceType: "HR technology" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("edtech") || hasPhrase("education technology") || hasPhrase("learning platform"), "check"), industry: "edtech", serviceType: "education technology" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("healthtech") || hasPhrase("health technology") || hasPhrase("digital health"), "check"), industry: "healthtech", serviceType: "health technology" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("logistics") || hasPhrase("supply chain") || hasPhrase("freight"), "check"), industry: "logistics", serviceType: "logistics services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("manufacturing") || hasWord("manufacturer"), "check"), industry: "manufacturing", serviceType: "manufacturing" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("wholesale") || hasWord("distributor"), "check"), industry: "wholesale", serviceType: "wholesale distribution" },
            // Professional Services
            { check: /* @__PURE__ */ __name(() => hasPhrase("law firm") || hasWord("attorney") || hasWord("solicitor") || hasWord("lawyer"), "check"), industry: "legal", serviceType: "legal services" },
            { check: /* @__PURE__ */ __name(() => hasWord("accountant") || hasWord("bookkeeping") || hasPhrase("tax return") || hasWord("cpa"), "check"), industry: "accounting", serviceType: "accounting services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("financial plan") || hasPhrase("wealth management") || hasPhrase("financial advis"), "check"), industry: "financial services", serviceType: "financial planning" },
            { check: /* @__PURE__ */ __name(() => hasWord("insurance") && !hasPhrase("fully insured") && (hasPhrase("policy") || hasPhrase("cover") || hasPhrase("premium")), "check"), industry: "insurance", serviceType: "insurance services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("real estate") || hasWord("realtor") || hasPhrase("property management"), "check"), industry: "real estate", serviceType: "real estate services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("recruitment") || hasWord("staffing") || hasPhrase("job agency"), "check"), industry: "recruitment", serviceType: "recruitment services" },
            { check: /* @__PURE__ */ __name(() => hasWord("consulting") || hasWord("consultant"), "check"), industry: "consulting", serviceType: "consulting services" },
            { check: /* @__PURE__ */ __name(() => hasWord("architect") && hasPhrase("architecture"), "check"), industry: "architecture", serviceType: "architecture services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("interior design"), "check"), industry: "interior design", serviceType: "interior design services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("graphic design") || hasPhrase("branding agency"), "check"), industry: "graphic design", serviceType: "design services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("web design") || hasPhrase("web development") || hasPhrase("digital agency"), "check"), industry: "web development", serviceType: "web development services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("marketing agency") || hasPhrase("digital marketing") || hasWord("seo") && hasPhrase("service"), "check"), industry: "marketing", serviceType: "marketing services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("it services") || hasPhrase("managed services") || hasWord("msp"), "check"), industry: "IT services", serviceType: "IT services" },
            // NOTE: Healthcare rules moved to Priority 0 section above (lines 430-439)
            // Beauty & Wellness
            { check: /* @__PURE__ */ __name(() => hasWord("salon") || hasWord("hairdresser") || hasPhrase("hair stylist"), "check"), industry: "hair salon", serviceType: "hair salon" },
            { check: /* @__PURE__ */ __name(() => hasWord("spa") || hasPhrase("day spa") || hasWord("massage"), "check"), industry: "spa", serviceType: "spa services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("beauty salon") || hasWord("aesthetics") || hasWord("beautician"), "check"), industry: "beauty", serviceType: "beauty services" },
            { check: /* @__PURE__ */ __name(() => hasWord("gym") || hasWord("fitness") || hasPhrase("personal training"), "check"), industry: "fitness", serviceType: "fitness services" },
            { check: /* @__PURE__ */ __name(() => hasWord("yoga") || hasWord("pilates"), "check"), industry: "yoga", serviceType: "yoga studio" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("martial arts") || hasWord("karate") || hasWord("taekwondo") || hasWord("mma"), "check"), industry: "martial arts", serviceType: "martial arts" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("dance studio") || hasPhrase("dance school"), "check"), industry: "dance", serviceType: "dance studio" },
            // Hospitality & Food
            { check: /* @__PURE__ */ __name(() => hasWord("restaurant") || hasWord("dining"), "check"), industry: "restaurant", serviceType: "restaurant" },
            { check: /* @__PURE__ */ __name(() => hasWord("cafe") || hasWord("coffee"), "check"), industry: "cafe", serviceType: "cafe" },
            { check: /* @__PURE__ */ __name(() => hasWord("bakery") || hasWord("pastry"), "check"), industry: "bakery", serviceType: "bakery" },
            { check: /* @__PURE__ */ __name(() => hasWord("catering"), "check"), industry: "catering", serviceType: "catering services" },
            { check: /* @__PURE__ */ __name(() => hasWord("bar") || hasWord("pub") || hasWord("nightclub"), "check"), industry: "bar", serviceType: "bar" },
            { check: /* @__PURE__ */ __name(() => hasWord("hotel") || hasWord("motel") || hasWord("accommodation"), "check"), industry: "hospitality", serviceType: "accommodation" },
            // Retail
            { check: /* @__PURE__ */ __name(() => hasWord("florist") || hasPhrase("flower shop"), "check"), industry: "florist", serviceType: "florist" },
            { check: /* @__PURE__ */ __name(() => hasWord("jewel") || hasPhrase("jewelry store"), "check"), industry: "jewelry", serviceType: "jewelry store" },
            { check: /* @__PURE__ */ __name(() => hasWord("furniture") || hasPhrase("home decor"), "check"), industry: "furniture", serviceType: "furniture store" },
            // Education & Childcare
            { check: /* @__PURE__ */ __name(() => hasWord("tutoring") || hasWord("tutor"), "check"), industry: "tutoring", serviceType: "tutoring services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("driving school") || hasPhrase("driving lesson"), "check"), industry: "driving school", serviceType: "driving school" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("music school") || hasPhrase("music lesson"), "check"), industry: "music school", serviceType: "music school" },
            { check: /* @__PURE__ */ __name(() => hasWord("childcare") || hasWord("daycare") || hasPhrase("child care"), "check"), industry: "childcare", serviceType: "childcare services" },
            { check: /* @__PURE__ */ __name(() => hasWord("preschool") || hasWord("kindergarten"), "check"), industry: "early education", serviceType: "early education" },
            // Events & Creative
            { check: /* @__PURE__ */ __name(() => hasWord("photographer") || hasWord("photography"), "check"), industry: "photography", serviceType: "photography services" },
            { check: /* @__PURE__ */ __name(() => hasWord("videographer") || hasPhrase("video production"), "check"), industry: "videography", serviceType: "videography services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("wedding") && (hasWord("venue") || hasWord("planner")), "check"), industry: "wedding", serviceType: "wedding services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("event planning") || hasPhrase("event management"), "check"), industry: "events", serviceType: "event planning" },
            { check: /* @__PURE__ */ __name(() => hasWord("printing") || hasPhrase("print shop"), "check"), industry: "printing", serviceType: "printing services" },
            // Automotive
            { check: /* @__PURE__ */ __name(() => hasWord("mechanic") || hasPhrase("auto repair") || hasPhrase("car service"), "check"), industry: "automotive", serviceType: "auto repair" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("car wash") || hasWord("detailing"), "check"), industry: "car wash", serviceType: "car wash" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("car dealer") || hasPhrase("auto sales"), "check"), industry: "car dealership", serviceType: "car dealership" },
            // Trade Services (CHECK LAST - more likely to have false positives)
            { check: /* @__PURE__ */ __name(() => hasPhrase("plumb") && (hasPhrase("service") || hasPhrase("repair") || hasPhrase("plumber")), "check"), industry: "plumbing", serviceType: "plumbing services" },
            { check: /* @__PURE__ */ __name(() => hasWord("electrician") || hasPhrase("electrical") && hasPhrase("service"), "check"), industry: "electrical", serviceType: "electrical services" },
            { check: /* @__PURE__ */ __name(() => hasWord("hvac") || hasPhrase("air conditioning") || hasPhrase("heating and cooling"), "check"), industry: "hvac", serviceType: "HVAC services" },
            { check: /* @__PURE__ */ __name(() => hasWord("roofing") || hasWord("roofer"), "check"), industry: "roofing", serviceType: "roofing services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("landscap") || hasWord("gardening") || hasPhrase("lawn care"), "check"), industry: "landscaping", serviceType: "landscaping services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("pest control") || hasWord("exterminator"), "check"), industry: "pest control", serviceType: "pest control services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("cleaning service") || hasWord("janitorial") || hasPhrase("house cleaning"), "check"), industry: "cleaning", serviceType: "cleaning services" },
            { check: /* @__PURE__ */ __name(() => hasWord("removalist") || hasPhrase("moving company") || hasWord("movers"), "check"), industry: "moving", serviceType: "moving services" },
            { check: /* @__PURE__ */ __name(() => (hasWord("painter") || hasPhrase("painting")) && hasPhrase("service"), "check"), industry: "painting", serviceType: "painting services" },
            { check: /* @__PURE__ */ __name(() => hasWord("carpentry") || hasWord("carpenter") && (hasPhrase("service") || hasPhrase("woodwork") || hasPhrase("cabinet")), "check"), industry: "carpentry", serviceType: "carpentry services" },
            { check: /* @__PURE__ */ __name(() => hasWord("fencing") || hasPhrase("fence builder"), "check"), industry: "fencing", serviceType: "fencing services" },
            { check: /* @__PURE__ */ __name(() => hasWord("solar") && hasPhrase("panel"), "check"), industry: "solar", serviceType: "solar installation" },
            { check: /* @__PURE__ */ __name(() => hasWord("locksmith"), "check"), industry: "locksmith", serviceType: "locksmith services" },
            { check: /* @__PURE__ */ __name(() => hasWord("towing") || hasPhrase("roadside assistance"), "check"), industry: "towing", serviceType: "towing services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("pool service") || hasPhrase("pool cleaning"), "check"), industry: "pool services", serviceType: "pool services" },
            { check: /* @__PURE__ */ __name(() => hasWord("tiling") || hasWord("tiler"), "check"), industry: "tiling", serviceType: "tiling services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("appliance repair"), "check"), industry: "appliance repair", serviceType: "appliance repair" },
            { check: /* @__PURE__ */ __name(() => hasWord("builder") || hasWord("construction") || hasWord("contractor"), "check"), industry: "construction", serviceType: "construction services" },
            // Other Services
            { check: /* @__PURE__ */ __name(() => hasWord("security") && !hasPhrase("cyber security"), "check"), industry: "security", serviceType: "security services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("pet grooming") || hasPhrase("dog grooming"), "check"), industry: "pet grooming", serviceType: "pet grooming" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("pet boarding") || hasWord("kennel"), "check"), industry: "pet boarding", serviceType: "pet boarding" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("travel agent") || hasPhrase("travel agency"), "check"), industry: "travel", serviceType: "travel agency" },
            { check: /* @__PURE__ */ __name(() => hasWord("funeral") || hasWord("cremation"), "check"), industry: "funeral services", serviceType: "funeral services" },
            { check: /* @__PURE__ */ __name(() => hasPhrase("self storage") || hasPhrase("storage facility"), "check"), industry: "storage", serviceType: "storage services" },
            // Generic retail last (very broad)
            { check: /* @__PURE__ */ __name(() => hasWord("shop") || hasWord("store") || hasWord("cart") || hasWord("checkout"), "check"), industry: "retail", serviceType: "retail store" }
          ];
          const industryScores = {};
          const industryServiceTypes = {};
          for (const rule of industryRules) {
            if (rule.check()) {
              let score = 1;
              const keyTerms = rule.industry.toLowerCase().split(/[\s\/]+/);
              for (const term of keyTerms) {
                if (term.length > 2) {
                  score += blobCount(term);
                }
              }
              if (!industryScores[rule.industry] || score > industryScores[rule.industry]) {
                industryScores[rule.industry] = score;
                industryServiceTypes[rule.industry] = rule.serviceType;
              }
            }
          }
          const sortedIndustries = Object.entries(industryScores).sort((a, b) => b[1] - a[1]);
          if (sortedIndustries.length > 0) {
            industry = sortedIndustries[0][0];
            serviceType = industryServiceTypes[industry];
          }
          if (industry) {
            const nicheModifiers = {
              "plumbing": ["commercial", "residential", "industrial", "emergency", "gas", "drainage", "hot water", "blocked drain"],
              "electrical": ["commercial", "residential", "industrial", "solar", "emergency", "data", "automation", "ev charger"],
              "legal": ["family law", "criminal", "corporate", "property", "immigration", "personal injury", "employment", "wills", "conveyancing"],
              "real estate": ["residential", "commercial", "luxury", "investment", "property management", "rural", "industrial"],
              "construction": ["commercial", "residential", "industrial", "renovation", "new build", "extension", "custom home"],
              "dental": ["cosmetic", "general", "emergency", "pediatric", "implant", "orthodontic", "holistic"],
              "medical": ["general practice", "specialist", "women's health", "men's health", "pediatric", "sports medicine", "mental health"],
              "cleaning": ["commercial", "residential", "office", "industrial", "end of lease", "carpet", "window", "pressure washing"],
              "photography": ["wedding", "portrait", "commercial", "real estate", "event", "product", "fashion", "newborn"],
              "accounting": ["small business", "corporate", "tax", "bookkeeping", "forensic", "audit", "advisory"],
              "marketing": ["digital", "social media", "content", "seo", "ppc", "branding", "b2b", "b2c"],
              "fitness": ["personal training", "group fitness", "24 hour", "crossfit", "boutique", "women only", "functional"],
              "restaurant": ["fine dining", "casual", "fast food", "family", "italian", "asian", "seafood", "steakhouse"],
              "automotive": ["european", "japanese", "american", "diesel", "hybrid", "classic", "performance", "fleet"],
              // Enterprise & Fintech niches
              "banking": ["retail", "commercial", "investment", "private", "corporate", "digital", "mobile"],
              "lending": ["mortgage", "personal", "business", "commercial", "equipment", "asset", "invoice"],
              "fintech": ["payments", "lending", "wealth", "insurance", "banking", "regtech", "blockchain"],
              "SaaS": ["enterprise", "smb", "vertical", "horizontal", "b2b", "b2c", "freemium"],
              "technology": ["enterprise", "consumer", "b2b", "b2c", "hardware", "software", "platform"],
              "insurance": ["life", "general", "health", "commercial", "personal", "motor", "property"],
              "consulting": ["management", "strategy", "technology", "digital", "operations", "hr", "financial"],
              "IT services": ["managed", "cloud", "security", "infrastructure", "support", "consulting"],
              "cybersecurity": ["enterprise", "smb", "managed", "cloud", "identity", "network", "endpoint"],
              "asset management": ["institutional", "retail", "wealth", "alternative", "fixed income", "equity"]
            };
            const modifiers = nicheModifiers[industry] || [];
            for (const modifier of modifiers) {
              if (blobHas(modifier)) {
                industryNiche = modifier + " " + industry;
                serviceType = modifier + " " + serviceType;
                break;
              }
            }
          }
          if (!industry) {
            if (metaKeywords) {
              const keywords = metaKeywords.toLowerCase().split(",").map((k) => k.trim());
              for (const keyword of keywords) {
                if (keyword.length > 3 && keyword.length < 30) {
                  industry = keyword;
                  serviceType = keyword + " services";
                  break;
                }
              }
            }
            if (!industry) {
              const h2Match = html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
              if (h2Match) {
                const h2Text = h2Match[1].replace(/<[^>]*>/g, "").trim().toLowerCase();
                if (h2Text.length > 3 && h2Text.length < 50 && !h2Text.includes("welcome")) {
                  industry = h2Text.split(" ").slice(0, 3).join(" ");
                }
              }
            }
            if (!industry) {
              industry = "business";
              serviceType = "professional services";
            }
          }
          let targetAudience = "";
          let icpDetails = "";
          if (blobHas("residential") && blobHas("commercial")) targetAudience = "residential and commercial clients";
          else if (blobHas("residential") || blobHas("homeowner")) targetAudience = "homeowners";
          else if (blobHas("commercial") || blobHas("business owner")) targetAudience = "businesses";
          const industryICP = {
            "medical": "patients",
            "dental": "patients",
            "chiropractic": "patients",
            "physiotherapy": "patients",
            "optometry": "patients",
            "veterinary": "pet owners",
            "pet grooming": "pet owners",
            "pet boarding": "pet owners",
            "restaurant": "diners",
            "cafe": "customers",
            "bar": "patrons",
            "hospitality": "guests",
            "childcare": "families",
            "tutoring": "students and families",
            "early education": "families",
            "fitness": "members",
            "gym": "members",
            "yoga": "members",
            "martial arts": "students",
            "real estate": "buyers and sellers",
            "legal": "clients",
            "accounting": "businesses and individuals",
            "photography": "clients",
            "wedding": "couples",
            "events": "event organizers",
            // Enterprise & Fintech
            "banking": "account holders",
            "lending": "borrowers",
            "fintech": "businesses",
            "SaaS": "businesses",
            "enterprise software": "enterprise clients",
            "technology": "businesses",
            "insurance": "policyholders",
            "consulting": "clients",
            "IT services": "businesses",
            "cybersecurity": "organisations",
            "asset management": "investors",
            "payments": "merchants",
            "neobank": "consumers",
            "wealthtech": "investors",
            "proptech": "property owners",
            "manufacturing": "businesses",
            "logistics": "businesses",
            "wholesale": "retailers",
            // Additional healthcare
            "psychology": "clients",
            "podiatry": "patients",
            "pharmacy": "customers"
          };
          if (!targetAudience && industryICP[industry]) {
            targetAudience = industryICP[industry];
          }
          const icpKeywords = ["small business", "enterprise", "startup", "corporate", "family", "individual", "senior", "youth", "women", "men", "professional", "first home buyer", "investor", "landlord", "tenant"];
          for (const keyword of icpKeywords) {
            if (blobHas(keyword)) {
              icpDetails = icpDetails ? icpDetails + ", " + keyword : keyword;
            }
          }
          let businessModel = "";
          if (blobHas("b2b") || blobHas("business to business") || blobHas("corporate client") || blobHas("enterprise")) {
            businessModel = "B2B";
          } else if (blobHas("b2c") || blobHas("consumer") || blobHas("household")) {
            businessModel = "B2C";
          } else if (blobHas("residential") && blobHas("commercial")) {
            businessModel = "B2B & B2C";
          }
          if (!targetAudience) targetAudience = "clients";
          let salesTerm = "";
          const industrySalesTerm = {
            "medical": "appointments",
            "dental": "appointments",
            "chiropractic": "appointments",
            "physiotherapy": "appointments",
            "legal": "consultations",
            "accounting": "consultations",
            "financial services": "consultations",
            "consulting": "consultations",
            "plumbing": "jobs",
            "electrical": "jobs",
            "hvac": "jobs",
            "roofing": "jobs",
            "construction": "projects",
            "real estate": "listings",
            "restaurant": "reservations",
            "hospitality": "bookings",
            "fitness": "memberships",
            "gym": "memberships",
            "yoga": "classes",
            "photography": "sessions",
            "wedding": "packages",
            "events": "events",
            "childcare": "enrollments",
            "tutoring": "sessions",
            "driving school": "lessons",
            "veterinary": "appointments",
            "salon": "appointments",
            "spa": "bookings",
            // Enterprise & Fintech
            "banking": "accounts",
            "lending": "applications",
            "fintech": "demos",
            "SaaS": "demos",
            "enterprise software": "demos",
            "technology": "demos",
            "insurance": "quotes",
            "cybersecurity": "assessments",
            "IT services": "assessments",
            "asset management": "consultations",
            "payments": "integrations",
            "neobank": "sign-ups",
            "wealthtech": "consultations",
            "proptech": "demos",
            "manufacturing": "quotes",
            "logistics": "quotes",
            "wholesale": "orders",
            "consumer electronics": "orders"
          };
          if (blobHas("shop now") || blobHas("add to cart") || blobHas("buy now") || blobHas("shop iphone") || blobHas("shop mac") || blobHas("shop gifts") || blobHas("buy") && (industry === "consumer electronics" || industry === "retail")) {
            salesTerm = "orders";
          } else if (blobHas("book a demo") || blobHas("request demo") || blobHas("schedule demo") || blobHas("get demo") || blobHas("see demo")) salesTerm = "demos";
          else if (blobHas("book appointment") || blobHas("schedule appointment") || blobHas("make an appointment")) salesTerm = "appointments";
          else if (blobHas("free consultation") || blobHas("book a consultation") || blobHas("schedule consultation")) salesTerm = "consultations";
          else if (blobHas("get a quote") || blobHas("free quote") || blobHas("request quote") || blobHas("free estimate")) salesTerm = "quotes";
          else if (blobHas("book online") || blobHas("book now") || blobHas("make a booking")) salesTerm = "bookings";
          else if ((blobHas("reservation") || blobHas("reserve a table")) && (blobHas("restaurant") || blobHas("dining") || blobHas("menu"))) salesTerm = "reservations";
          else if ((blobHas("apply now") || blobHas("submit application") || blobHas("apply online")) && (industry === "banking" || industry === "lending" || industry === "fintech" || industry === "insurance")) {
            salesTerm = "applications";
          } else if (blobHas("sign up") || blobHas("register now") || blobHas("create account")) salesTerm = "sign-ups";
          else if (blobHas("join now") || blobHas("become a member") || blobHas("membership")) salesTerm = "memberships";
          else if (blobHas("contact us") || blobHas("get in touch") || blobHas("enquir") || blobHas("inquir")) salesTerm = "enquiries";
          else if (blobHas("order now") || blobHas("place order") || blobHas("shop ") || blobHas("buy ")) salesTerm = "orders";
          if (!salesTerm) {
            salesTerm = industrySalesTerm[industry] || "sales";
          }
          const services = [];
          const servicePatterns = [
            /(?:we offer|our services|we provide|services include|what we do)[:\s]+([^.!?]+)/gi,
            /<li[^>]*>([^<]+(?:service|repair|install|clean|maint)[^<]*)<\/li>/gi,
            /<h3[^>]*>([^<]{5,60})<\/h3>/gi
          ];
          for (const pattern of servicePatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
              if (match[1] && match[1].length < 100 && match[1].length > 3) {
                const service = match[1].replace(/<[^>]*>/g, "").trim();
                if (!services.includes(service)) services.push(service);
              }
            }
            if (services.length >= 6) break;
          }
          const servicesText = services.length > 0 ? services.join(", ").substring(0, 500) : "professional " + serviceType;
          const valueProps = [];
          const vpChecks = [
            { check: blobHas("24/7") || blobHas("24 hours"), value: "24/7 availability" },
            { check: blobHas("emergency"), value: "emergency services" },
            { check: blobHas("same day"), value: "same-day service" },
            { check: blobHas("next day"), value: "next-day service" },
            { check: blobHas("licensed") || blobHas("certified"), value: "licensed professionals" },
            { check: blobHas("free quote") || blobHas("free estimate"), value: "free quotes" },
            { check: blobHas("no obligation"), value: "no obligation quotes" },
            { check: blobHas("guaranteed") || blobHas("warranty"), value: "guaranteed work" },
            { check: blobHas("family owned") || blobHas("family business"), value: "family-owned" },
            { check: blobHas("locally owned") || blobHas("local business"), value: "locally owned" },
            { check: blobHas("years experience") || blobHas("years in business"), value: "experienced team" },
            { check: blobHas("award"), value: "award-winning" },
            { check: blobHas("satisfaction guarantee"), value: "satisfaction guaranteed" },
            { check: blobHas("on time") || blobHas("punctual"), value: "on-time service" },
            { check: blobHas("upfront pricing") || blobHas("no hidden"), value: "transparent pricing" },
            { check: blobHas("fully insured"), value: "fully insured" },
            { check: blobHas("eco friendly") || blobHas("sustainable") || blobHas("green"), value: "eco-friendly" }
          ];
          for (const vp of vpChecks) {
            if (vp.check) valueProps.push(vp.value);
          }
          const faqs = [];
          if (schemaMatches) {
            for (const schemaScript of schemaMatches) {
              try {
                const jsonStr = schemaScript.replace(/<script[^>]*>|<\/script>/gi, "").trim();
                const parsed = JSON.parse(jsonStr);
                if (parsed["@type"] === "FAQPage" && parsed.mainEntity) {
                  for (const item of parsed.mainEntity) {
                    if (item.name && item.acceptedAnswer?.text) {
                      faqs.push({
                        question: item.name.substring(0, 200),
                        answer: item.acceptedAnswer.text.substring(0, 500)
                      });
                    }
                    if (faqs.length >= 10) break;
                  }
                }
              } catch (e) {
              }
            }
          }
          if (faqs.length < 5) {
            const faqPatterns = [
              // Accordion pattern
              /<(?:button|div|h[2-4])[^>]*class="[^"]*(?:accordion|faq|question)[^"]*"[^>]*>([\s\S]*?)<\/(?:button|div|h[2-4])>[\s\S]*?<(?:div|p)[^>]*class="[^"]*(?:panel|answer|content)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|p)>/gi,
              // Details/summary pattern
              /<details[^>]*>[\s\S]*?<summary[^>]*>([\s\S]*?)<\/summary>([\s\S]*?)<\/details>/gi,
              // Question/Answer pairs
              /<(?:dt|h[3-5])[^>]*>([\s\S]*?\?[\s\S]*?)<\/(?:dt|h[3-5])>[\s\S]*?<(?:dd|p)[^>]*>([\s\S]*?)<\/(?:dd|p)>/gi
            ];
            for (const pattern of faqPatterns) {
              const matches = html.matchAll(pattern);
              for (const match of matches) {
                const q = match[1].replace(/<[^>]*>/g, "").trim();
                const a = match[2].replace(/<[^>]*>/g, "").trim();
                if (q.length > 10 && q.length < 200 && a.length > 20 && a.length < 500) {
                  faqs.push({ question: q, answer: a });
                }
                if (faqs.length >= 10) break;
              }
              if (faqs.length >= 10) break;
            }
          }
          if (faqs.length < 5) {
            const qaPattern = /(?:Q:|Question:)\s*([^?]+\?)\s*(?:A:|Answer:)\s*([^Q]+?)(?=(?:Q:|Question:)|$)/gi;
            const matches = cleanBlob.matchAll(qaPattern);
            for (const match of matches) {
              const q = match[1].trim();
              const a = match[2].trim();
              if (q.length > 10 && a.length > 20) {
                faqs.push({ question: q.substring(0, 200), answer: a.substring(0, 500) });
              }
              if (faqs.length >= 10) break;
            }
          }
          const benefits = [];
          const benefitSectionPatterns = [
            /<(?:section|div)[^>]*class="[^"]*(?:why-choose|benefits|advantages|reasons)[^"]*"[^>]*>([\s\S]*?)<\/(?:section|div)>/gi,
            /(?:why choose us|our benefits|our advantages|why us|our difference)[:\s]*<[^>]*>([\s\S]{100,2000}?)(?=<(?:section|footer|\/section|\/footer))/gi
          ];
          for (const pattern of benefitSectionPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
              const sectionContent = match[1] || match[0];
              const itemPatterns = [
                /<li[^>]*>([\s\S]*?)<\/li>/gi,
                /<h[3-5][^>]*>([\s\S]*?)<\/h[3-5]>/gi,
                /<p[^>]*>([\s\S]{20,200})<\/p>/gi
              ];
              for (const itemPattern of itemPatterns) {
                const items = sectionContent.matchAll(itemPattern);
                for (const item of items) {
                  const text = item[1].replace(/<[^>]*>/g, "").trim();
                  if (text.length > 10 && text.length < 200 && !benefits.includes(text)) {
                    benefits.push(text);
                  }
                  if (benefits.length >= 8) break;
                }
                if (benefits.length >= 8) break;
              }
            }
            if (benefits.length >= 5) break;
          }
          if (benefits.length < 3) {
            const benefitIndicators = [
              /(?:we offer|you get|includes?|features?)[:\s]+([^.!?]{20,150}[.!?])/gi,
              /(?:✓|✔|☑|•)\s*([^.!?\n]{15,100})/gi
            ];
            for (const pattern of benefitIndicators) {
              const matches = html.matchAll(pattern);
              for (const match of matches) {
                const text = match[1].replace(/<[^>]*>/g, "").trim();
                if (text.length > 15 && text.length < 150 && !benefits.includes(text)) {
                  benefits.push(text);
                }
                if (benefits.length >= 8) break;
              }
            }
          }
          const features = [];
          const featurePatterns = [
            /<(?:section|div)[^>]*class="[^"]*(?:features?|specs?|specifications?)[^"]*"[^>]*>([\s\S]*?)<\/(?:section|div)>/gi,
            /(?:features?|specifications?|what's included|package includes)[:\s]*<[^>]*>([\s\S]{100,2000}?)(?=<(?:section|footer|\/section|\/footer))/gi
          ];
          for (const pattern of featurePatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
              const sectionContent = match[1] || match[0];
              const liMatches = sectionContent.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);
              for (const li of liMatches) {
                const text = li[1].replace(/<[^>]*>/g, "").trim();
                if (text.length > 5 && text.length < 150 && !features.includes(text)) {
                  features.push(text);
                }
                if (features.length >= 10) break;
              }
            }
            if (features.length >= 5) break;
          }
          if (features.length < 5) {
            const iconFeaturePattern = /<(?:div|span)[^>]*class="[^"]*(?:icon|feature)[^"]*"[^>]*>[\s\S]*?<(?:h[3-6]|p|span)[^>]*>([^<]{10,100})<\/(?:h[3-6]|p|span)>/gi;
            const matches = html.matchAll(iconFeaturePattern);
            for (const match of matches) {
              const text = match[1].trim();
              if (text.length > 5 && !features.includes(text)) {
                features.push(text);
              }
              if (features.length >= 10) break;
            }
          }
          const ctas = [];
          const ctaPatterns = [
            /<(?:a|button)[^>]*class="[^"]*(?:btn|button|cta)[^"]*"[^>]*>([^<]{3,50})<\/(?:a|button)>/gi,
            /<(?:a|button)[^>]*>(?:<[^>]*>)*([A-Z][^<]{5,40})(?:<[^>]*>)*<\/(?:a|button)>/gi,
            /<input[^>]*type=["']submit["'][^>]*value=["']([^"']{3,50})["']/gi
          ];
          const ctaBlacklist = ["read more", "learn more", "click here", "submit", "send", "home", "about", "contact", "privacy", "terms", "view more", "see more", "show more"];
          for (const pattern of ctaPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
              const text = match[1].replace(/<[^>]*>/g, "").trim();
              const textLower = text.toLowerCase();
              if (text.length < 3 || text.length > 50) continue;
              if (ctaBlacklist.includes(textLower)) continue;
              if (ctas.includes(text)) continue;
              if (text.match(/^\d+$/)) continue;
              if (!text.match(/[a-zA-Z]/)) continue;
              const isSingleWord = !text.includes(" ");
              const isProperCase = /^[A-Z][a-z]+$/.test(text);
              const hasActionVerb = /^(get|book|schedule|request|start|try|claim|download|sign|join|buy|order|shop|call|contact|view|see|find|discover|learn|explore)/i.test(text);
              if (isSingleWord && isProperCase && !hasActionVerb) continue;
              ctas.push(text);
              if (ctas.length >= 10) break;
            }
          }
          const priorityCTAs = ctas.filter(
            (cta) => /^(get|book|schedule|request|start|try|claim|download|sign|join|buy|order|shop)/i.test(cta)
          );
          const otherCTAs = ctas.filter((cta) => !priorityCTAs.includes(cta));
          const sortedCTAs = [...priorityCTAs, ...otherCTAs].slice(0, 8);
          const painPoints = [];
          const painPatterns = [
            /(?:tired of|struggling with|frustrated by|sick of|don't want to|stop wasting|no more|avoid)[:\s]+([^.!?]{15,150}[.!?]?)/gi,
            /(?:problem|challenge|issue|difficulty|pain)[:\s]+([^.!?]{15,150}[.!?]?)/gi,
            /(?:do you|are you)[:\s]+([^.!?]*(?:struggle|worry|stress|waste|lose|miss)[^.!?]{10,100}[.!?]?)/gi
          ];
          for (const pattern of painPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
              const text = match[1].replace(/<[^>]*>/g, "").trim();
              if (text.length > 15 && text.length < 200 && !painPoints.includes(text)) {
                painPoints.push(text);
              }
              if (painPoints.length >= 5) break;
            }
          }
          const problemSolutionPattern = /<(?:div|section)[^>]*class="[^"]*(?:problem|before|challenge)[^"]*"[^>]*>([\s\S]*?)<\/(?:div|section)>/gi;
          const psMatches = html.matchAll(problemSolutionPattern);
          for (const match of psMatches) {
            const text = match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
            if (text.length > 20 && text.length < 300 && !painPoints.includes(text)) {
              painPoints.push(text.substring(0, 200));
            }
            if (painPoints.length >= 5) break;
          }
          let mainUSP = tagline || "";
          if (!mainUSP) {
            const heroPatterns = [
              /<(?:section|div)[^>]*class="[^"]*(?:hero|banner|masthead)[^"]*"[^>]*>[\s\S]*?<(?:h1|h2)[^>]*>([\s\S]*?)<\/(?:h1|h2)>/gi,
              /<(?:h1|h2)[^>]*class="[^"]*(?:hero|headline|main)[^"]*"[^>]*>([\s\S]*?)<\/(?:h1|h2)>/gi
            ];
            for (const pattern of heroPatterns) {
              const match = html.match(pattern);
              if (match && match[1]) {
                const text = match[1].replace(/<[^>]*>/g, "").trim();
                if (text.length > 10 && text.length < 200) {
                  mainUSP = text;
                  break;
                }
              }
            }
          }
          if (!mainUSP) {
            mainUSP = metaDescription || mainHeadline || "";
          }
          let phone = schemaData.telephone || "";
          if (!phone) {
            const phonePattern = /(?:\+?61\s?)?(?:\(0?[2-8]\)\s?|\(?0?[2-8]\)?[\s-]?)\d{4}[\s-]?\d{4}|\d{4}\s?\d{3}\s?\d{3}|1[38]00\s?\d{3}\s?\d{3}/g;
            const phoneMatches = html.match(phonePattern);
            phone = phoneMatches ? phoneMatches[0].trim() : "";
          }
          if (phone) {
            const cleanPhone = phone.replace(/[\s\-\(\)]/g, "");
            const isValidPrefix = cleanPhone.startsWith("0") || cleanPhone.startsWith("+") || /^1[38]00\d{6}$/.test(cleanPhone) || /^13\d{4}$/.test(cleanPhone);
            const isValidLength = /^\+?\d{8,15}$/.test(cleanPhone);
            if (!isValidPrefix || !isValidLength) phone = "";
          }
          let email = schemaData.email || "";
          if (!email) {
            const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
            const emailMatches = html.match(emailPattern);
            if (emailMatches) {
              const filtered = emailMatches.filter((e) => !e.includes(".png") && !e.includes(".jpg") && !e.includes(".gif"));
              email = filtered.length > 0 ? filtered[0] : "";
            }
          }
          let address = "";
          if (schemaData.address) {
            const addr = schemaData.address;
            address = [addr.streetAddress, addr.addressLocality, addr.addressRegion, addr.postalCode].filter(Boolean).join(", ");
          }
          if (!address) {
            const addressPattern = /\d+\s+[A-Za-z\s]+(?:street|st|road|rd|avenue|ave|drive|dr|court|ct|place|pl|lane|ln),?\s+[A-Za-z\s]+,?\s+(?:NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\s+\d{4}/i;
            const addressMatch = html.match(addressPattern);
            address = addressMatch ? addressMatch[0].trim() : "";
          }
          let businessHours = "";
          if (schemaData.openingHours) {
            businessHours = Array.isArray(schemaData.openingHours) ? schemaData.openingHours.join(", ") : schemaData.openingHours;
          }
          if (!businessHours) {
            const hoursPatterns = [
              /(?:monday|mon|weekdays?)[\s:]+(\d{1,2}(?::\d{2})?\s?(?:am|pm)?[\s-]+\d{1,2}(?::\d{2})?\s?(?:am|pm)?)/i,
              /open[\s:]+(\d{1,2}(?::\d{2})?\s?(?:am|pm)?[\s-]+\d{1,2}(?::\d{2})?\s?(?:am|pm)?)/i
            ];
            for (const pattern of hoursPatterns) {
              const match = html.match(pattern);
              if (match) {
                businessHours = match[0].trim();
                break;
              }
            }
          }
          if (!phone && googlePlacesData?.phone) {
            phone = googlePlacesData.phone;
          }
          if (!phone && googlePlacesData?.internationalPhone) {
            phone = googlePlacesData.internationalPhone;
          }
          if (!address && googlePlacesData?.address) {
            address = googlePlacesData.address;
          }
          if (!description && googlePlacesData?.editorialSummary) {
            description = googlePlacesData.editorialSummary;
          }
          if (!businessHours && googlePlacesData?.openingHours?.weekdayText?.length > 0) {
            businessHours = googlePlacesData.openingHours.weekdayText.join("; ");
          }
          const testimonials = [];
          const testimonialPatterns = [
            /<div[^>]*class="[^"]*(?:testimonial|review|quote)[^"]*"[^>]*>([\s\S]{20,400}?)<\/div>/gi,
            /<blockquote[^>]*>([\s\S]{20,400}?)<\/blockquote>/gi,
            // NEW: Look for quote marks with attribution
            /"([^"]{30,300})"\s*[-–—]\s*([A-Z][a-zA-Z\s]+)/g
          ];
          for (const pattern of testimonialPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
              const content = match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
              if (content.length > 20 && content.length < 400 && !testimonials.includes(content)) {
                testimonials.push(content);
              }
              if (testimonials.length >= 3) break;
            }
            if (testimonials.length >= 3) break;
          }
          const reviewPatterns = [
            // "5 stars" or "4.8/5 stars" followed by text
            /(?:5|4\.\d)\s*(?:star|\/5)[^<]{0,20}["']([^"']{20,200})["']/gi,
            // Review text in specific classes
            /<div[^>]*class="[^"]*(?:review-text|customer-review|client-review)[^"]*"[^>]*>([\s\S]{20,300}?)<\/div>/gi,
            // Yelp/Google patterns
            /<p[^>]*class="[^"]*comment[^"]*"[^>]*>([\s\S]{20,300}?)<\/p>/gi
          ];
          for (const pattern of reviewPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
              const content = match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
              if (content.length > 20 && content.length < 300 && !testimonials.includes(content)) {
                testimonials.push(content);
              }
              if (testimonials.length >= 5) break;
            }
            if (testimonials.length >= 5) break;
          }
          const caseStudies = [];
          const caseStudyPatterns = [
            // Look for case study headings/titles
            /<(?:h[2-4]|div)[^>]*class="[^"]*(?:case-study|case_study|client-story|success-story)[^"]*"[^>]*>([^<]{10,100})/gi,
            // Look for "Case Study:" or "Client Story:" prefixes
            /(?:case study|client story|success story):\s*([^<\n]{10,100})/gi,
            // Look for structured case study data
            /<a[^>]*href="[^"]*case-stud[^"]*"[^>]*>([^<]{5,80})<\/a>/gi,
            // Look for project/portfolio items
            /<div[^>]*class="[^"]*(?:portfolio-item|project-item|work-item)[^"]*"[^>]*>[\s\S]*?<(?:h[2-4]|strong)[^>]*>([^<]{5,60})/gi,
            // Look for client logos with alt text
            /<img[^>]*class="[^"]*(?:client-logo|partner-logo)[^"]*"[^>]*alt="([^"]{5,50})"/gi,
            // "Our clients include" sections
            /our (?:clients|customers) include[^<]*<[^>]*>([^<]{10,200})/gi
          ];
          for (const pattern of caseStudyPatterns) {
            const matches = html.matchAll(pattern);
            for (const match of matches) {
              const content = match[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
              if (content.length > 5 && content.length < 100 && !content.toLowerCase().includes("read more") && !content.toLowerCase().includes("view all") && !content.toLowerCase().includes("logo") && !caseStudies.includes(content)) {
                caseStudies.push(content);
              }
              if (caseStudies.length >= 5) break;
            }
            if (caseStudies.length >= 5) break;
          }
          let yearsInBusiness = schemaData.foundingDate ? `${(/* @__PURE__ */ new Date()).getFullYear() - parseInt(schemaData.foundingDate)}+ years` : "";
          if (!yearsInBusiness) {
            const yearsPattern = /(?:established|since|serving since|founded)\s+(?:in\s+)?(\d{4})|(\d+)\+?\s*years?\s+(?:experience|in business)/i;
            const yearsMatch = html.match(yearsPattern);
            if (yearsMatch) {
              if (yearsMatch[1]) yearsInBusiness = `${(/* @__PURE__ */ new Date()).getFullYear() - parseInt(yearsMatch[1])}+ years (est. ${yearsMatch[1]})`;
              else if (yearsMatch[2]) yearsInBusiness = `${yearsMatch[2]}+ years`;
            }
          }
          const certifications = [];
          const certMatches = html.match(/(?:licensed|certified|accredited|qualified|approved|member of)(?:\s+(?:by|with))?\s+([A-Z][A-Za-z\s&]{2,50})/gi);
          if (certMatches) {
            for (const match of certMatches) {
              if (match.length < 60) certifications.push(match.trim());
              if (certifications.length >= 3) break;
            }
          }
          const guarantees = [];
          if (blobHas("money back")) guarantees.push("money-back guarantee");
          if (blobHas("satisfaction guarantee")) guarantees.push("satisfaction guarantee");
          if (blobHas("lifetime warranty")) guarantees.push("lifetime warranty");
          if (blobHas("workmanship guarantee")) guarantees.push("workmanship guarantee");
          const warrantyMatch = html.match(/(\d+[\s-]?(?:year|month))[\s-]+(?:warranty|guarantee)/i);
          if (warrantyMatch) guarantees.push(warrantyMatch[0].trim());
          let pricingInfo = "";
          const pricingPatterns = [/from\s+\$(\d+)/i, /starting\s+(?:at\s+)?\$(\d+)/i, /\$(\d+)[\s-]+\$(\d+)/i];
          for (const pattern of pricingPatterns) {
            const match = html.match(pattern);
            if (match) {
              pricingInfo = match[0].trim();
              break;
            }
          }
          const serviceAreas = [];
          const areaMatches = html.match(/(?:servicing|serving|covering)\s+([A-Z][a-z]+(?:,\s*[A-Z][a-z]+)*)/gi);
          if (areaMatches) {
            for (const match of areaMatches) {
              const area = match.replace(/(?:servicing|serving|covering)\s+/i, "").trim();
              if (area.length > 3 && area.length < 50 && !serviceAreas.includes(area)) serviceAreas.push(area);
              if (serviceAreas.length >= 10) break;
            }
          }
          let teamSize = schemaData.numberOfEmployees || "";
          if (!teamSize) {
            const teamMatch = html.match(/(\d+)\+?\s+(?:qualified|experienced|professional|expert)?\s*(?:technicians?|staff|employees|team members?)/i);
            if (teamMatch) teamSize = `${teamMatch[1]}+ team members`;
          }
          const specialOffers = [];
          const offerMatches = html.match(/(?:discount|save|offer|special|promotion|deal)[:\s]+[^.!?<]{10,120}/gi);
          if (offerMatches) {
            for (const match of offerMatches) {
              const offer = match.replace(/<[^>]*>/g, "").trim();
              if (offer.length > 10 && offer.length < 150 && !specialOffers.includes(offer)) specialOffers.push(offer);
              if (specialOffers.length >= 2) break;
            }
          }
          const paymentMethods = [];
          if (blobHas("visa") || blobHas("mastercard") || blobHas("credit card")) paymentMethods.push("credit cards");
          if (blobHas("afterpay") || blobHas("zip pay")) paymentMethods.push("buy now pay later");
          if (blobHas("payment plan")) paymentMethods.push("payment plans");
          if (blobHas("eftpos")) paymentMethods.push("EFTPOS");
          const emergencyService = blobHas("emergency") && (blobHas("24/7") || blobHas("24 hour") || blobHas("emergency service") || blobHas("emergency appointment") || blobHas("same day emergency") || blobHas("urgent") || blobHas("after hours"));
          let responseTime = "";
          const responsePatterns = [/(?:respond|arrive)(?:\s+within)?\s+(\d+\s+(?:minutes?|hours?))/i, /same[\s-]day\s+service/i];
          for (const pattern of responsePatterns) {
            const match = html.match(pattern);
            if (match) {
              responseTime = match[0].trim();
              break;
            }
          }
          let insuranceInfo = "";
          if (blobHas("fully insured")) insuranceInfo = "fully insured";
          else if (blobHas("insured")) insuranceInfo = "insured";
          if (blobHas("public liability")) insuranceInfo = insuranceInfo ? insuranceInfo + ", public liability" : "public liability";
          const hexPattern = /#([0-9a-fA-F]{3}){1,2}\b/g;
          const allColors = html.match(hexPattern) || [];
          const colorCounts = {};
          const expandHex = /* @__PURE__ */ __name((hex) => hex.length === 4 ? "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3] : hex, "expandHex");
          const isGray = /* @__PURE__ */ __name((hex) => {
            const e = expandHex(hex);
            const r = parseInt(e.substr(1, 2), 16), g = parseInt(e.substr(3, 2), 16), b = parseInt(e.substr(5, 2), 16);
            return Math.abs(r - g) < 20 && Math.abs(g - b) < 20;
          }, "isGray");
          const isLight = /* @__PURE__ */ __name((hex) => {
            const e = expandHex(hex);
            const r = parseInt(e.substr(1, 2), 16), g = parseInt(e.substr(3, 2), 16), b = parseInt(e.substr(5, 2), 16);
            return (r * 299 + g * 587 + b * 114) / 1e3 > 200;
          }, "isLight");
          allColors.forEach((color) => {
            let c = expandHex(color.toLowerCase());
            if (!["#000000", "#ffffff", "#fff", "#000", "#fefefe", "#fafafa", "#f0f0f0", "#333333", "#eeeeee"].includes(c)) {
              colorCounts[c] = (colorCounts[c] || 0) + 1;
            }
          });
          const sortedColors = Object.entries(colorCounts).sort((a, b) => b[1] - a[1]);
          let primaryColor = "#F45100", secondaryColor = "#0741ad", accentColor = "#F45100";
          const brandColors = sortedColors.filter((c) => !isGray(c[0]) && !isLight(c[0]));
          if (brandColors.length > 0) primaryColor = brandColors[0][0];
          if (brandColors.length > 1) secondaryColor = brandColors[1][0];
          if (brandColors.length > 2) accentColor = brandColors[2][0];
          const fonts = [];
          const googleFontMatches = html.match(/fonts\.googleapis\.com\/css[2]?\?family=([^"&]+)/g);
          if (googleFontMatches) {
            googleFontMatches.forEach((link) => {
              const familyMatch = link.match(/family=([^:&]+)/);
              if (familyMatch) familyMatch[1].split("|").forEach((f) => fonts.push(f.replace(/\+/g, " ").split(":")[0]));
            });
          }
          const fontFamilyMatches = html.match(/font-family:\s*['"]?([^;,'"]+)['"]?/gi);
          if (fontFamilyMatches) {
            fontFamilyMatches.forEach((f) => {
              const font = f.replace(/font-family:\s*['"]?/i, "").replace(/['"]?$/, "").trim();
              if (!["sans-serif", "serif", "inherit", "initial", "arial", "helvetica"].includes(font.toLowerCase()) && !fonts.includes(font)) fonts.push(font);
            });
          }
          const primaryFont = fonts.length > 0 ? fonts[0] : "Inter";
          const secondaryFont = fonts.length > 1 ? fonts[1] : primaryFont;
          const highAuthoritySources = (businessName + " " + title + " " + description).toLowerCase();
          const blobFrequency = /* @__PURE__ */ __name((term) => {
            const regex = new RegExp(term.toLowerCase(), "gi");
            return (cleanBlob.match(regex) || []).length;
          }, "blobFrequency");
          const inHighAuthority = /* @__PURE__ */ __name((term) => highAuthoritySources.includes(term.toLowerCase()), "inHighAuthority");
          let industryConfidence = "low";
          const industryScoresV2 = {};
          const pageTitle = (html.match(/<title[^>]*>([^<]+)<\/title>/i) || ["", ""])[1].toLowerCase();
          const businessNameLower = (businessName || "").toLowerCase();
          const titleAndName = pageTitle + " " + businessNameLower;
          for (const [candidateIndustry, candidateValidators] of Object.entries(INDUSTRY_VALIDATORS)) {
            let score = 0;
            for (const term of candidateValidators) {
              const freq = blobFrequency(term);
              score += freq;
              if (inHighAuthority(term)) {
                score += freq * 9;
              }
              if (titleAndName.includes(term.toLowerCase())) {
                score += 50;
              }
            }
            industryScoresV2[candidateIndustry] = score;
          }
          const sortedIndustriesV2 = Object.entries(industryScoresV2).filter(([_, score]) => score > 0).sort((a, b) => b[1] - a[1]);
          if (sortedIndustriesV2.length > 0) {
            const [topIndustry, topScore] = sortedIndustriesV2[0];
            const secondScore = sortedIndustriesV2.length > 1 ? sortedIndustriesV2[1][1] : 0;
            const meetsMinimumScore = topScore >= 5;
            const dominatesSecondChoice = topScore >= secondScore * 1.5;
            const industryDefiningTerms = INDUSTRY_VALIDATORS[topIndustry] || [];
            const hasHighAuthorityMatch = industryDefiningTerms.some((term) => inHighAuthority(term));
            if (meetsMinimumScore && dominatesSecondChoice && (topScore >= 10 || hasHighAuthorityMatch)) {
              industry = topIndustry;
              industryNiche = "";
              const masterData = INDUSTRY_MASTER[industry];
              if (masterData) {
                serviceType = `${industry} services`;
              }
              industryConfidence = topScore >= 10 ? "high" : topScore >= 5 ? "medium" : "low";
            }
          }
          const audienceBlacklist = ["undefined", "null", "select", "click", "menu", "nav"];
          const audienceInBlob = blobHas(targetAudience) || blobHas(targetAudience.slice(0, -1));
          const audienceKeywords = [
            "client",
            "customer",
            "patient",
            "member",
            "user",
            "buyer",
            "seller",
            "owner",
            "investor",
            "tenant",
            "guest",
            "family",
            "individual",
            "business",
            "professional",
            "student",
            "parent",
            "homeowner",
            "renter"
          ];
          const looksLikeAudience = audienceKeywords.some((kw) => targetAudience.toLowerCase().includes(kw));
          if (!audienceInBlob || !looksLikeAudience || audienceBlacklist.some((bl) => targetAudience.toLowerCase().includes(bl))) {
            const masterData = INDUSTRY_MASTER[industry];
            if (masterData && masterData.audience) {
              targetAudience = masterData.audience;
            }
          }
          const salesTermInBlob = blobHas(salesTerm) || blobHas(salesTerm.slice(0, -1));
          if (!salesTermInBlob) {
            if (blobFrequency("book") > 3 || blobFrequency("appointment") > 2) salesTerm = "appointments";
            else if (blobFrequency("quote") > 2) salesTerm = "quotes";
            else if (blobFrequency("demo") > 2) salesTerm = "demos";
            else if (blobFrequency("order") > 2 || blobFrequency("cart") > 1) salesTerm = "orders";
            else if (blobFrequency("consultation") > 2) salesTerm = "consultations";
            else if (blobFrequency("enquir") > 2 || blobFrequency("contact") > 5) salesTerm = "enquiries";
            else {
              const masterData = INDUSTRY_MASTER[industry];
              if (masterData) salesTerm = masterData.salesTerm;
            }
          }
          const servicesBlacklist = [
            // Navigation patterns
            "advice for my",
            "advice for me",
            "for my business",
            "for me",
            "blog",
            "posts",
            "select",
            "location",
            "latest",
            "read more",
            "learn more",
            "click",
            "here",
            "home",
            "about",
            "contact",
            "careers",
            "login",
            "sign in",
            "sidenav",
            "sidebar",
            "footer",
            "header",
            "menu",
            "nav",
            "overview",
            // Social media
            "facebook",
            "instagram",
            "linkedin",
            "youtube",
            "twitter",
            // Project/client names
            "client story",
            "case study",
            "podcast",
            "webinar",
            "event",
            "experience across",
            "industries",
            "pfd",
            "urbnsurf",
            "latitude",
            "customs house",
            "taking you global",
            "connect with",
            "food services"
          ];
          const servicePhrases = [
            // Professional services
            "accounting services",
            "tax advice",
            "audit services",
            "tax services",
            "business advisory",
            "financial planning",
            "wealth management",
            "legal services",
            "consulting services",
            "property management",
            // Healthcare
            "dental services",
            "medical services",
            "health services",
            // Trade
            "cleaning services",
            "repair services",
            "maintenance services",
            "plumbing services",
            "electrical services",
            "building services",
            // Tech
            "web design",
            "web development",
            "software development",
            "it services",
            "tech support",
            "digital services",
            // Other
            "marketing services",
            "insurance services",
            "real estate services",
            "photography services",
            "catering services",
            "security services"
          ];
          const verifiedServices = services.filter((svc) => {
            const cleanSvc = svc.toLowerCase();
            if (servicesBlacklist.some((bl) => cleanSvc.includes(bl))) return false;
            if (cleanSvc.length < 5 || cleanSvc.length > 60) return false;
            return servicePhrases.some((phrase) => cleanSvc.includes(phrase));
          });
          if (verifiedServices.length >= 2) {
            services.length = 0;
            services.push(...verifiedServices);
          } else {
            const masterData = INDUSTRY_MASTER[industry];
            if (masterData && masterData.features) {
              services.length = 0;
              services.push(...masterData.features);
            }
          }
          const verifiedBenefits = benefits.filter(
            (b) => b.length > 10 && b.length < 200 && !b.includes("<") && !b.includes("http") && !b.startsWith("we recommend") && !b.includes("browser") && !b.includes("cookie") && // Systemic: Filter incomplete sentences (start with lowercase or conjunctions)
              !/^[a-z]/.test(b) && !/^(and |or |the |a |an |to |in |of |for |with |by |from |errors |if |when |while )/.test(b.toLowerCase()) && // Systemic: Filter fragments that look like list continuations
              !b.includes("diagnosis") && !b.includes("aftercare") && // Systemic: Must start with capital letter or number
              /^[A-Z0-9]/.test(b)
          );
          const benefitTemplates = {
            "Professional service": ["expert service", "quality service", "trusted service", "reliable service", "dedicated service", "exceptional service"],
            "Experienced team": ["experienced staff", "skilled team", "qualified team", "expert team", "professional team", "years of experience", "decades of experience"],
            "Quality results": ["quality outcomes", "excellent results", "proven results", "guaranteed results", "best results", "great results"],
            "Gentle, caring approach": ["gentle care", "compassionate care", "caring service", "patient care"],
            "Modern technology": ["latest technology", "advanced technology", "state-of-the-art", "cutting-edge"]
          };
          const findVariation = /* @__PURE__ */ __name((template, templates) => {
            const variations = templates[template] || [];
            for (const variation of variations) {
              if (blobHas(variation)) {
                return variation.charAt(0).toUpperCase() + variation.slice(1);
              }
            }
            return template;
          }, "findVariation");
          if (verifiedBenefits.length < 2) {
            const masterData = INDUSTRY_MASTER[industry];
            let fallbackBenefits = masterData?.benefits || GENERIC_FALLBACKS.benefits;
            const guidedBenefits = fallbackBenefits.map((b) => {
              if (benefitTemplates[b]) {
                return findVariation(b, benefitTemplates);
              }
              return b;
            });
            benefits.length = 0;
            benefits.push(...guidedBenefits);
          } else {
            const benefitKeywords = [
              "quality",
              "professional",
              "expert",
              "trusted",
              "reliable",
              "experienced",
              "best",
              "excellent",
              "premium",
              "dedicated",
              "friendly",
              "fast",
              "affordable",
              "guaranteed",
              "care",
              "support",
              "help",
              "peace of mind",
              "satisfaction",
              "results",
              "value"
            ];
            const looksLikeBenefits = verifiedBenefits.some(
              (b) => benefitKeywords.some((kw) => b.toLowerCase().includes(kw))
            );
            if (looksLikeBenefits) {
              benefits.length = 0;
              benefits.push(...verifiedBenefits);
            } else {
              const masterData = INDUSTRY_MASTER[industry];
              let fallbackBenefits = masterData?.benefits || GENERIC_FALLBACKS.benefits;
              const guidedBenefits = fallbackBenefits.map((b) => benefitTemplates[b] ? findVariation(b, benefitTemplates) : b);
              benefits.length = 0;
              benefits.push(...guidedBenefits);
            }
          }
          const featuresBlacklist = [
            // Navigation/UI
            "sidenav",
            "sidebar",
            "footer",
            "header",
            "menu",
            "nav",
            "overview",
            "body",
            "main",
            "section",
            "container",
            "wrapper",
            "widget",
            "facebook",
            "instagram",
            "linkedin",
            "youtube",
            "twitter",
            "read more",
            "learn more",
            "click",
            "back to",
            "skip to",
            "select",
            // Navigation headings
            "advice for my",
            "advice for me",
            "for my business",
            "for me",
            "connect with",
            "client story",
            "case study",
            "podcast",
            "webinar",
            // Client/project names
            "pfd",
            "urbnsurf",
            "latitude",
            "customs house",
            "taking you global",
            "food services"
          ];
          const featurePhrases = [
            // Service delivery
            "free consultation",
            "same day",
            "next day",
            "24 hour",
            "24/7",
            "online booking",
            "free quote",
            "no obligation",
            // Quality indicators
            "years experience",
            "qualified",
            "certified",
            "licensed",
            "insured",
            "award winning",
            "satisfaction guarantee",
            "money back",
            // Tech/capability
            "latest technology",
            "state of the art",
            "cutting edge",
            "custom solutions",
            "tailored approach",
            "personalised service"
          ];
          const verifiedFeatures = features.filter((f) => {
            const cleanF = f.toLowerCase();
            if (featuresBlacklist.some((bl) => cleanF.includes(bl))) return false;
            if (f.length < 5 || f.length > 80) return false;
            if (f.includes("<") || f.includes("&#") || f.includes("&amp;") || f.includes("&nbsp;")) return false;
            return featurePhrases.some((phrase) => cleanF.includes(phrase)) || f.length > 15 && !f.startsWith("We") && !f.startsWith("For more");
          });
          if (verifiedFeatures.length >= 2) {
            features.length = 0;
            features.push(...verifiedFeatures);
          } else {
            const masterData = INDUSTRY_MASTER[industry];
            if (masterData && masterData.features) {
              features.length = 0;
              features.push(...masterData.features);
            }
          }
          const ctaGarbageBlacklist = [
            "urbnsurf",
            "latitude",
            "pfd",
            "customs house",
            "client story",
            "case study",
            "podcast",
            "webinar"
          ];
          const verifiedCTAs = sortedCTAs.filter((cta) => {
            const cleanCTA = cta.toLowerCase();
            if (ctaGarbageBlacklist.some((bl) => cleanCTA.includes(bl))) return false;
            return /^(get|book|schedule|request|start|contact|call|enquire|apply|sign|join|download|learn|find|speak|talk)/i.test(cta) || cleanCTA.includes("now") || cleanCTA.includes("today");
          });
          if (verifiedCTAs.length >= 2) {
            sortedCTAs.length = 0;
            sortedCTAs.push(...verifiedCTAs);
          } else {
            const ctaTemplates = {
              "Contact Us": ["get in touch", "speak to us", "reach out", "call us", "talk to us"],
              "Get in Touch": ["contact us", "speak with us", "reach out", "call now"],
              "Book an Appointment": ["schedule appointment", "make an appointment", "book online", "book now"],
              "Get a Quote": ["request quote", "free quote", "get pricing", "request estimate"],
              "Learn More": ["find out more", "read more", "discover more", "explore"],
              "Book a Demo": ["request demo", "schedule demo", "see it in action", "try it free"]
            };
            const masterData = INDUSTRY_MASTER[industry];
            let fallbackCTAs = masterData?.ctas || GENERIC_FALLBACKS.ctas;
            const guidedCTAs = fallbackCTAs.map((cta) => {
              if (ctaTemplates[cta]) {
                const variations = ctaTemplates[cta];
                for (const variation of variations) {
                  if (blobHas(variation)) {
                    return variation.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                  }
                }
              }
              return cta;
            });
            sortedCTAs.length = 0;
            sortedCTAs.push(...guidedCTAs);
          }
          const b2bSignals = blobFrequency("enterprise") + blobFrequency("business") + blobFrequency("company") + blobFrequency("organisation");
          const b2cSignals = blobFrequency("individual") + blobFrequency("personal") + blobFrequency("consumer") + blobFrequency("you");
          if (b2bSignals > b2cSignals * 2) businessModel = "B2B";
          else if (b2cSignals > b2bSignals * 2) businessModel = "B2C";
          else {
            const b2bIndustries = [
              "SaaS",
              "IT services",
              "commercial real estate",
              "manufacturing",
              "logistics",
              "wholesale",
              "business consulting",
              "corporate law"
            ];
            const b2cIndustries = [
              "dental",
              "medical",
              "restaurant",
              "retail",
              "fitness",
              "residential real estate",
              "beauty",
              "automotive repair"
            ];
            if (b2bIndustries.includes(industry)) businessModel = "B2B";
            else if (b2cIndustries.includes(industry)) businessModel = "B2C";
            else businessModel = "B2C";
          }
          const locationBlacklist = [
            "undefined",
            "null",
            "select",
            "your area",
            "menu",
            "up advic",
            "advic",
            "your team",
            "footer",
            "header",
            "nav"
          ];
          const locationWhitelist = [
            // Australian states
            "nsw",
            "vic",
            "qld",
            "sa",
            "wa",
            "tas",
            "nt",
            "act",
            "new south wales",
            "victoria",
            "queensland",
            "south australia",
            "western australia",
            "tasmania",
            "northern territory",
            // Australian cities
            "sydney",
            "melbourne",
            "brisbane",
            "perth",
            "adelaide",
            "hobart",
            "darwin",
            "canberra",
            "newcastle",
            "gold coast",
            "geelong",
            "wollongong",
            "townsville",
            "cairns",
            // Generic
            "australia",
            "nationwide",
            "national"
          ];
          const locationClean = location?.toLowerCase() || "";
          const validLocationStarts = [
            // Cities
            "sydney",
            "melbourne",
            "brisbane",
            "perth",
            "adelaide",
            "hobart",
            "darwin",
            "canberra",
            "newcastle",
            "gold coast",
            "geelong",
            "wollongong",
            "townsville",
            "cairns",
            // States
            "nsw",
            "vic",
            "qld",
            "sa",
            "wa",
            "tas",
            "nt",
            "act",
            "new south wales",
            "victoria",
            "queensland",
            "south australia",
            "western australia",
            "tasmania",
            "northern territory",
            "australia",
            "nationwide"
          ];
          const locationValid = location && !locationBlacklist.some((bl) => locationClean.includes(bl)) && location.length > 2 && validLocationStarts.some((start) => locationClean.startsWith(start));
          if (!locationValid) {
            const ausCities = [
              "Sydney",
              "Melbourne",
              "Brisbane",
              "Perth",
              "Adelaide",
              "Hobart",
              "Darwin",
              "Canberra",
              "Newcastle",
              "Gold Coast",
              "Geelong"
            ];
            let foundCity = null;
            for (const city of ausCities) {
              if (blobHas(city.toLowerCase())) {
                foundCity = city;
                break;
              }
            }
            const ausStates = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"];
            let foundState = null;
            for (const state of ausStates) {
              if (blobHas(state.toLowerCase()) || blobHas(state)) {
                foundState = state;
                break;
              }
            }
            if (foundCity && foundState) {
              location = `${foundCity}, ${foundState}`;
            } else if (foundCity) {
              location = foundCity;
            } else if (foundState) {
              location = foundState;
            } else {
              location = "Australia";
            }
          }
          const verifiedPainPoints = painPoints.filter(
            (pp) => pp.length > 15 && pp.length < 300 && !pp.includes("<") && !pp.includes("http") && // Systemic: Must start with capital letter (not incomplete sentence)
              /^[A-Z]/.test(pp) && // Systemic: Filter incomplete sentences starting with conjunctions
              !/^(and |or |the |a |an |to |in |of |for |with |by |from |if |when |while )/.test(pp.toLowerCase()) && // Must contain pain-indicating keywords
              (pp.includes("problem") || pp.includes("struggle") || pp.includes("difficult") || pp.includes("challenge") || pp.includes("pain") || pp.includes("frustrat") || pp.includes("stress") || pp.includes("worry") || pp.includes("concern") || pp.includes("tired") || pp.includes("sick of") || pp.includes("fed up") || pp.includes("injured") || pp.includes("hurt") || pp.includes("suffer"))
          );
          const painPointTemplates = {
            "Wasted time and frustration": ["wasting time", "too much time", "time-consuming", "frustrated", "frustrating"],
            "Uncertainty about next steps": ["not sure what to do", "confused about", "unsure how to", "uncertain"],
            "Difficulty finding reliable help": ["hard to find", "difficult to find", "unreliable", "can't find"],
            "Confusion about legal rights": ["don't know your rights", "understand your rights", "entitled to", "compensation"],
            "Stress dealing with legal matters": ["stressful", "overwhelming", "complex legal", "difficult time"],
            "Anxiety about dental visits": ["dental anxiety", "nervous about", "scared of dentist", "fear"],
            "Long waiting times": ["long wait", "waiting too long", "wait times", "appointment availability"]
          };
          if (verifiedPainPoints.length < 1) {
            const industryPains = INDUSTRY_PAIN_POINTS[industry] || GENERIC_FALLBACKS.painPoints;
            const guidedPainPoints = industryPains.map((pp) => {
              if (painPointTemplates[pp]) {
                const variations = painPointTemplates[pp];
                for (const variation of variations) {
                  if (blobHas(variation)) {
                    return pp;
                  }
                }
              }
              return pp;
            });
            painPoints.length = 0;
            painPoints.push(...guidedPainPoints);
          } else {
            painPoints.length = 0;
            painPoints.push(...verifiedPainPoints);
          }
          const icpSignals = [
            { term: "injured", icp: "injured individuals", ignoreIfCareers: false },
            { term: "business owner", icp: "business owners", ignoreIfCareers: false },
            { term: "homeowner", icp: "homeowners", ignoreIfCareers: false },
            { term: "family", icp: "families", ignoreIfCareers: false },
            { term: "patient", icp: "patients", ignoreIfCareers: false },
            { term: "client", icp: "clients", ignoreIfCareers: false },
            { term: "customer", icp: "customers", ignoreIfCareers: false },
            { term: "member", icp: "members", ignoreIfCareers: false },
            { term: "worker", icp: "workers", ignoreIfCareers: true },
            // Often in careers
            { term: "employer", icp: "employers", ignoreIfCareers: false },
            { term: "investor", icp: "investors", ignoreIfCareers: false },
            { term: "student", icp: "students", ignoreIfCareers: true },
            // Often in "student careers"
            { term: "parent", icp: "parents", ignoreIfCareers: false },
            { term: "professional", icp: "professionals", ignoreIfCareers: true },
            // Often in "experienced professionals"
            { term: "small business", icp: "small businesses", ignoreIfCareers: false },
            { term: "enterprise", icp: "enterprises", ignoreIfCareers: false }
          ];
          let bestIcpMatch = null;
          let bestIcpFreq = 0;
          for (const signal of icpSignals) {
            if (signal.ignoreIfCareers && careersContext > 3) continue;
            const freq = blobFrequency(signal.term);
            if (freq > bestIcpFreq) {
              bestIcpFreq = freq;
              bestIcpMatch = signal.icp;
            }
          }
          if (bestIcpMatch && bestIcpFreq >= 2) {
            icpDetails = bestIcpMatch;
          } else {
            const masterData = INDUSTRY_MASTER[industry];
            if (masterData && masterData.audience) {
              icpDetails = masterData.audience;
            }
          }
          const verificationScore = (audienceInBlob ? 1 : 0) + (salesTermInBlob ? 1 : 0) + (verifiedServices.length >= 2 ? 1 : 0) + (verifiedBenefits.length >= 2 ? 1 : 0) + (verifiedCTAs.length >= 2 ? 1 : 0) + (verifiedPainPoints.length >= 1 ? 1 : 0) + (icpDetails ? 1 : 0);
          if (verificationScore >= 5) industryConfidence = "high";
          else if (verificationScore >= 3) industryConfidence = "medium";
          const icpValidationRules = {
            "consumer electronics": ["consumers", "customers", "users"],
            "banking": ["customers", "account holders", "clients"],
            "SaaS": ["businesses", "teams", "organizations", "users"],
            "restaurant": ["diners", "guests", "customers"],
            "dental": ["patients"],
            "legal": ["clients"],
            "real estate": ["buyers", "sellers", "investors", "homeowners"]
          };
          const expectedICPs = icpValidationRules[industry];
          if (expectedICPs && !expectedICPs.includes(targetAudience.split(" ")[0].toLowerCase())) {
            if (blobHas("patient")) targetAudience = "patients";
            else if (blobHas("member") && (blobHas("join") || blobHas("membership"))) targetAudience = "members";
            else if (blobHas("customer") || blobHas("shop") || blobHas("buy")) targetAudience = "customers";
            else if (blobHas("client")) targetAudience = "clients";
            else if (blobHas("business") && blobHas("enterprise")) targetAudience = "businesses";
            else if (blobHas("homeowner")) targetAudience = "homeowners";
          }
          const salesTermValidation = {
            "reservations": ["restaurant", "hospitality", "hotel", "booking"],
            "appointments": ["medical", "dental", "salon", "service"],
            "demos": ["SaaS", "software", "technology", "fintech", "enterprise"],
            "quotes": ["construction", "trades", "insurance", "service"],
            "orders": ["retail", "ecommerce", "consumer electronics", "shop"]
          };
          const validContexts = salesTermValidation[salesTerm] || [];
          let salesTermValid = validContexts.some((ctx2) => industry.toLowerCase().includes(ctx2) || blobHas(ctx2));
          if (!salesTermValid) {
            if (blobHas("shop now") || blobHas("add to cart") || blobHas("buy now")) salesTerm = "orders";
            else if (blobHas("book a demo") || blobHas("request demo") || blobHas("see a demo")) salesTerm = "demos";
            else if (blobHas("book online") || blobHas("book now") || blobHas("make a booking")) salesTerm = "bookings";
            else if (blobHas("schedule appointment") || blobHas("book appointment")) salesTerm = "appointments";
            else if (blobHas("get quote") || blobHas("free quote")) salesTerm = "quotes";
            else if (blobHas("contact us") || blobHas("get in touch")) salesTerm = "enquiries";
          }
          if (servicesText === "professional " + serviceType || services.length === 0) {
            const navServicePatterns = [
              /<a[^>]*href="[^"]*(?:services?|products?|solutions?)[^"]*"[^>]*>([^<]+)<\/a>/gi,
              /<nav[^>]*>([\s\S]*?)<\/nav>/gi
            ];
            const extractedServices = [];
            for (const pattern of navServicePatterns) {
              const matches = html.matchAll(pattern);
              for (const match of matches) {
                const text = match[1].replace(/<[^>]*>/g, "").trim();
                if (text.length > 3 && text.length < 50 && !extractedServices.includes(text)) {
                  extractedServices.push(text);
                }
                if (extractedServices.length >= 5) break;
              }
            }
            if (extractedServices.length > 0) {
              if (services.length === 0) {
                services.push(...extractedServices);
              }
            }
          }
          const finalServicesText = services.length > 0 ? services.join(", ").substring(0, 500) : "professional " + serviceType;
          if (!businessModel) {
            if (blobHas("enterprise") || blobHas("business") && (blobHas("solution") || blobHas("platform"))) {
              businessModel = "B2B";
            } else if (blobHas("consumers") || blobHas("personal") || blobHas("individual") || blobHas("shop now")) {
              businessModel = "B2C";
            } else if (industry === "consumer electronics" || industry === "retail") {
              businessModel = "B2C";
            } else if (industry === "SaaS" || industry === "enterprise software") {
              businessModel = "B2B";
            }
          }
          const confidence = {};
          const countBlobMatches = /* @__PURE__ */ __name((terms) => terms.filter((t) => blobHas(t)).length, "countBlobMatches");
          confidence.industry = industryConfidence;
          if (salesTerm && (blobHas(salesTerm) || blobHas(salesTerm.slice(0, -1)))) {
            confidence.sales_term = "high";
          } else if (salesTerm === industrySalesTerm[industry]) {
            confidence.sales_term = "medium";
          } else {
            confidence.sales_term = salesTerm === "sales" ? "low" : "medium";
          }
          if (blobHas(targetAudience) || blobHas(targetAudience.slice(0, -1))) {
            confidence.target_audience = "high";
          } else {
            confidence.target_audience = targetAudience === "clients" ? "low" : "medium";
          }
          confidence.services = services.length >= 3 ? "high" : services.length >= 1 ? "medium" : "low";
          confidence.benefits = benefits.length >= 3 ? "high" : benefits.length >= 1 ? "medium" : "low";
          confidence.features = features.length >= 3 ? "high" : features.length >= 1 ? "medium" : "low";
          confidence.ctas = sortedCTAs.length >= 3 ? "high" : sortedCTAs.length >= 1 ? "medium" : "low";
          confidence.faqs = faqs.length >= 3 ? "high" : faqs.length >= 1 ? "medium" : "low";
          confidence.value_propositions = valueProps.length >= 3 ? "high" : valueProps.length >= 1 ? "medium" : "low";
          confidence.pain_points = painPoints.length >= 2 ? "high" : painPoints.length >= 1 ? "medium" : "low";
          confidence.main_usp = mainUSP && mainUSP.length > 20 ? "high" : mainUSP ? "medium" : "low";
          confidence.special_offers = specialOffers.length >= 1 ? "medium" : "low";
          confidence.tagline = tagline && tagline.length > 5 ? "medium" : "low";
          if (businessModel && (blobHas("b2b") || blobHas("b2c") || blobHas("enterprise") || blobHas("consumer"))) {
            confidence.business_model = "high";
          } else if (businessModel) {
            confidence.business_model = "medium";
          } else {
            confidence.business_model = "low";
          }
          confidence.business_description = description && description.length > 50 ? "high" : description ? "medium" : "low";
          confidence.guarantees = guarantees.length >= 1 ? "medium" : "low";
          confidence.icp_details = icpDetails ? "medium" : "low";
          confidence.service_type = serviceType ? "medium" : "low";
          confidence.industry_niche = industryNiche ? "high" : "low";
          const confScores = { high: 3, medium: 2, low: 1 };
          const criticalFields = ["industry", "sales_term", "target_audience", "services"];
          let totalScore = 0;
          for (const field of criticalFields) {
            totalScore += confScores[confidence[field]] || 1;
          }
          confidence.overall = totalScore >= 10 ? "high" : totalScore >= 6 ? "medium" : "low";
          const industryDefaults = INDUSTRY_MASTER[industry] || GENERIC_FALLBACKS;
          if (!targetAudience || targetAudience === "unknown") {
            targetAudience = industryDefaults.audience || GENERIC_FALLBACKS.audience;
          }
          if (!salesTerm || salesTerm === "sales") {
            const detectedSalesTerm = industryDefaults.salesTerm || GENERIC_FALLBACKS.salesTerm;
            if (detectedSalesTerm && detectedSalesTerm !== "sales") {
              salesTerm = detectedSalesTerm;
            }
          }
          let finalBenefits = benefits;
          if (!benefits || benefits.length < 2) {
            finalBenefits = industryDefaults.benefits || GENERIC_FALLBACKS.benefits;
          }
          let finalFeatures = features;
          if (!features || features.length < 2) {
            finalFeatures = industryDefaults.features || GENERIC_FALLBACKS.features;
          }
          let finalCTAs = sortedCTAs;
          if (!sortedCTAs || sortedCTAs.length < 2) {
            finalCTAs = industryDefaults.ctas || GENERIC_FALLBACKS.ctas;
          }
          const valuePropTemplates = {
            "Experienced team": ["years of experience", "decades of experience", "experienced professionals", "skilled team", "expert team"],
            "Quality service": ["quality workmanship", "excellence in", "premium service", "high quality"],
            "Trusted since": ["established in", "serving since", "trusted for", "over 20 years"],
            "award-winning": ["award winning", "award-winning", "industry awards", "nationally recognised"],
            "Family owned": ["family-owned", "family owned", "local family", "family business"]
          };
          let finalValueProps = valueProps;
          if (!valueProps || valueProps.length === 0) {
            let fallbackProps = industryDefaults.valueProps || GENERIC_FALLBACKS.valueProps;
            const guidedProps = fallbackProps.map((prop) => {
              if (valuePropTemplates[prop]) {
                const variations = valuePropTemplates[prop];
                for (const variation of variations) {
                  if (blobHas(variation)) {
                    return variation.charAt(0).toUpperCase() + variation.slice(1);
                  }
                }
              }
              return prop;
            });
            finalValueProps = guidedProps;
          }
          let lpBusinessName = businessName || "your business";
          const taglineBlacklist = ["don't forget", "use your", "limited time", "sale ends", "shop now", "buy now", "order now", "sign up", "subscribe", "cookie", "privacy"];
          const taglineTemplates = {
            "legal": ["justice", "compensation", "rights", "fight for you", "on your side"],
            "dental": ["smile", "gentle care", "family dentist", "dental care"],
            "medical": ["health", "care", "wellness", "healing"],
            "plumbing": ["reliable", "24/7", "emergency", "trusted tradies"],
            "electrical": ["safe", "reliable", "licensed", "qualified"],
            "real estate": ["dream home", "trusted agent", "local expert"],
            "SaaS": ["transform", "streamline", "automate", "simplify"]
          };
          let lpTagline = tagline || mainHeadline || description?.substring(0, 100) || "";
          if (lpTagline && taglineBlacklist.some((phrase) => lpTagline.toLowerCase().includes(phrase))) {
            lpTagline = description?.substring(0, 100) || `Quality ${serviceType || "services"} you can trust`;
          }
          if (!lpTagline || lpTagline.length < 10) {
            const industryTags = taglineTemplates[industry];
            if (industryTags) {
              for (const tag of industryTags) {
                if (blobHas(tag)) {
                  lpTagline = `Your trusted ${industry} partner`;
                  break;
                }
              }
            }
            if (!lpTagline) lpTagline = "Transform the way you work";
          }
          const lpServices = finalServicesText || "your services";
          let lpTargetAudience = targetAudience || "your clients";
          const lpSalesTerm = salesTerm || "appointments";
          let lpLocation = location || "your area";
          const lpPhone = phone || "your team";
          const lpMainUSP = mainUSP || (tagline ? tagline : `Trusted ${serviceType || "services"} for ${lpTargetAudience}`);
          const lpBenefits = finalBenefits.length > 0 ? finalBenefits : ["Professional service", "Experienced team", "Quality results"];
          const lpFeatures = finalFeatures.length > 0 ? finalFeatures : ["Expert advice", "Reliable support", "Tailored solutions"];
          const lpPainPoints = painPoints.length > 0 ? painPoints : [];
          const agentKnowledgeBlob = JSON.stringify({
            // Operational details
            business_hours: businessHours || null,
            years_in_business: yearsInBusiness || null,
            team_size: teamSize || null,
            service_areas: serviceAreas.length > 0 ? serviceAreas : null,
            emergency_service: emergencyService || null,
            response_time: responseTime || null,
            // Trust signals
            certifications: certifications.length > 0 ? certifications : null,
            guarantees: guarantees.length > 0 ? guarantees : null,
            insurance_info: insuranceInfo || null,
            // Commercial
            payment_methods: paymentMethods.length > 0 ? paymentMethods : null,
            pricing_info: pricingInfo || null,
            special_offers: specialOffers.length > 0 ? specialOffers : null,
            // Social proof
            testimonials: testimonials.length > 0 ? testimonials : null,
            case_studies: caseStudies.length > 0 ? caseStudies : null,
            star_rating: starRating || null,
            review_count: reviewCount || null,
            // FAQs for agent conversations
            faqs: faqs.length > 0 ? faqs : null,
            // Branding
            primary_color: primaryColor || null,
            secondary_color: secondaryColor || null,
            accent_color: accentColor || null,
            // Social links
            social_media: Object.keys(socialMedia).length > 0 ? socialMedia : null
          });
          const chatWidgetPatterns = [
            "intercom",
            "drift",
            "tidio",
            "livechat",
            "zendesk",
            "hubspot",
            "crisp",
            "freshchat",
            "olark",
            "tawk",
            "chatra",
            "smartsupp",
            "purechat",
            "userlike",
            "comm100",
            "kayako",
            "zoho",
            "liveagent"
          ];
          const hasChatWidget = chatWidgetPatterns.some((p) => htmlLower.includes(p));
          const hasLeadForm = /<form[^>]*>[\s\S]*?(email|contact|enquir|inquiry|subscribe|newsletter|get.*(quote|started|touch))[\s\S]*?<\/form>/i.test(html);
          const hasContactForm = hasPhrase("contact form") || hasPhrase("get in touch") || hasPhrase("request a quote");
          const hasAnyLeadCapture = hasLeadForm || hasContactForm;
          const crmPatterns = [
            "hubspot",
            "salesforce",
            "activecampaign",
            "mailchimp",
            "klaviyo",
            "marketo",
            "pardot",
            "infusionsoft",
            "keap",
            "pipedrive",
            "zoho crm",
            "gohighlevel",
            "highlevel",
            "clickfunnels"
          ];
          const hasCRM = crmPatterns.some((p) => htmlLower.includes(p));
          const hasGoogleAds = htmlLower.includes("googleadservices") || htmlLower.includes("google_conversion") || htmlLower.includes("gtag") && htmlLower.includes("aw-") || htmlLower.includes("google ads");
          const hasFacebookPixel = htmlLower.includes("fbevents") || htmlLower.includes("facebook pixel") || htmlLower.includes("connect.facebook.net") || htmlLower.includes("fbq(");
          const hasCallTracking = htmlLower.includes("callrail") || htmlLower.includes("dialogtech") || htmlLower.includes("calltracking") || htmlLower.includes("phonexa");
          const hasBookingSystem = htmlLower.includes("calendly") || htmlLower.includes("acuity") || htmlLower.includes("bookings") || htmlLower.includes("schedule a call") || htmlLower.includes("book online") || htmlLower.includes("book now");
          const fbCtaAnalysis = facebookAdData?.primaryCTA ? analyzeAdCTA(facebookAdData.primaryCTA) : null;
          const hasCRMDetected = hasCRM || builtWithData?.hasCRMTech;
          const hasChatDetected = hasChatWidget || builtWithData?.hasChatTech;
          const hasVoiceAIDetected = htmlLower.includes("voice ai") || htmlLower.includes("ai receptionist") || htmlLower.includes("vapi") || htmlLower.includes("retell") || builtWithData?.technologies?.some((t) => /vapi|retell|bland\.ai|air\.ai|play\.ht|ruby receptionist|smith\.ai/i.test(t)) || false;
          const adFunnelResult = calculateAdFunnelScore(facebookAdData, googleAdsTransparencyData, hasCRMDetected, hasChatDetected, hasVoiceAIDetected);
          const reviewMiningResult = googlePlacesData?.reviews ? mineReviewsForAgentNeeds(googlePlacesData.reviews) : null;
          const grades = {
            speedToLead: (() => {
              let score = 100;
              if (!hasCRMDetected) score -= 40;
              if ((facebookAdData?.isRunningAds || googleAdsTransparencyData?.isRunningGoogleAds) && !hasCRMDetected) score -= 30;
              if (reviewMiningResult?.summary?.alex > 0) score -= reviewMiningResult.summary.alex * 10;
              return { grade: scoreToGrade(Math.max(0, score)), score: Math.max(0, score), factors: [] };
            })(),
            reputation: (() => {
              let score = 100;
              const rating = googlePlacesData?.rating || parseFloat(starRating) || 4;
              if (rating < 4) score -= 40;
              else if (rating < 4.5) score -= 20;
              const responseRate = googlePlacesData?.ownerResponseRate || 0;
              if (responseRate < 0.3) score -= 30;
              else if (responseRate < 0.5) score -= 15;
              const negatives = googlePlacesData?.reviewStats?.negativeCount || 0;
              if (negatives > 3) score -= 20;
              else if (negatives > 1) score -= 10;
              return { grade: scoreToGrade(Math.max(0, score)), score: Math.max(0, score), factors: [] };
            })(),
            websiteConversion: (() => {
              let score = 100;
              if (!hasChatDetected) score -= 30;
              if (!hasAnyLeadCapture) score -= 25;
              if (!hasBookingSystem && !builtWithData?.hasScheduling) score -= 20;
              if (reviewMiningResult?.summary?.chris > 0) score -= reviewMiningResult.summary.chris * 10;
              return { grade: scoreToGrade(Math.max(0, score)), score: Math.max(0, score), factors: [] };
            })(),
            techStack: (() => {
              const bwScore = builtWithData?.techStackScore?.score || 30;
              return { grade: scoreToGrade(bwScore), score: bwScore, factors: builtWithData?.missingTech || [] };
            })(),
            adEfficiency: (() => {
              if (!facebookAdData?.isRunningAds && !googleAdsTransparencyData?.isRunningGoogleAds) {
                return { grade: "N/A", score: null, factors: ["Not running ads"] };
              }
              return { grade: scoreToGrade(adFunnelResult.score), score: adFunnelResult.score, factors: adFunnelResult.issues.map((i) => i.issue) };
            })()
          };
          const validScores = [grades.speedToLead.score, grades.reputation.score, grades.websiteConversion.score, grades.techStack.score];
          if (grades.adEfficiency.score !== null) validScores.push(grades.adEfficiency.score);
          const overallScore = Math.round(validScores.reduce((a, b) => a + b, 0) / validScores.length);
          grades.overall = { grade: scoreToGrade(overallScore), score: overallScore };

          // ── V3 Gemini Business Intelligence Extraction ──────────────────────
          // Uses the rich Firecrawl/ScrapingAnt markdown to extract fields regex misses
          let geminiBusinessExtract = null;
          if (env.GEMINI_API_KEY && cleanBlob && cleanBlob.length > 500) {
            traceLog.push(`Gemini Business Extract: cleanBlob=${cleanBlob.length} chars — starting`);
            try {
              traceLog.push("Gemini Business Extract: Starting");
              const bizExtractPrompt = `You are analyzing a business website for "${quickBusinessName}".
Extract the following business intelligence from the website content. Only include data you can find evidence for — leave fields as null if not present.

Website Content:
${cleanBlob.substring(0, 15000)}

Return ONLY valid JSON:
{
  "faqs": [{"q": "question", "a": "answer"}],
  "testimonials": ["Direct customer quote 1", "Direct customer quote 2"],
  "case_studies": ["Case study title or client story name"],
  "team_size": "e.g. '50+ employees' or '200+ staff across 6 offices' or null",
  "network_size": "e.g. 'Part of Baker Tilly network across 141 territories' or null",
  "pricing_info": "Any pricing, packages, or fee structure mentioned",
  "guarantees": ["Any guarantees or promises mentioned"],
  "service_areas": ["Geographic areas served"],
  "payment_methods": ["Accepted payment methods"],
  "certifications": ["Professional certifications, accreditations, awards"],
  "years_in_business": "e.g. 'Established 1991' or '30+ years'",
  "business_description": "A compelling 2-sentence description of what this business does and who they serve, written for a sales context",
  "target_audience_detailed": "Specific description of who their ideal customers are based on the website content",
  "key_differentiators": ["What makes them unique vs competitors - extract from their messaging"],
  "industry_niche": "Their specific sub-industry or specialization"
}`;
              const bizExtractResponse = await geminiCallWithRetry(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_API_KEY}`,
                {
                    contents: [{ parts: [{ text: bizExtractPrompt }] }],
                    generationConfig: { temperature: 0.2, maxOutputTokens: 4000 }
                });
              if (bizExtractResponse.ok) {
                const bizResult = await bizExtractResponse.json();
                const bizText = bizResult?.candidates?.[0]?.content?.parts?.[0]?.text || "";
                const bizJson = bizText.match(/\{[\s\S]*\}/);
                if (bizJson) {
                  geminiBusinessExtract = JSON.parse(bizJson[0]);
                  traceLog.push(`Gemini Business Extract: Success — ${Object.keys(geminiBusinessExtract).filter(k => geminiBusinessExtract[k] && geminiBusinessExtract[k] !== null).length} fields extracted`);
                } else {
                  traceLog.push("Gemini Business Extract: No valid JSON");
                }
              } else {
                traceLog.push(`Gemini Business Extract: HTTP ${bizExtractResponse.status}`);
              }
            } catch (e) {
              traceLog.push(`Gemini Business Extract: Error - ${e.message}`);
            }
          }


          let geminiConsultative = null;
          // V3: Consultant is now a separate atomic worker via service binding
          if (env.CONSULTANT) {
            try {
              traceLog.push("Consultant Worker: Starting (service binding)");
              const consultantPayload = {
                businessName: businessName || "Unknown Business",
                industry: industry || "business",
                industryNiche: industryNiche || null,
                location: location || quickLocation || "Australia",
                yearsInBusiness: yearsInBusiness || null,
                targetAudience: targetAudience || "clients",
                salesTerm: salesTerm || "appointments",
                businessModel: businessModel || "B2B",
                description: description || null,
                google: {
                  rating: googlePlacesData?.rating || null,
                  reviewCount: googlePlacesData?.reviewCount || 0,
                  ownerResponseRate: googlePlacesData?.ownerResponseRate || null,
                  openingHours: googlePlacesData?.openingHours?.weekdayText || [],
                },
                competitors: competitorData?.competitors?.slice(0, 10).map(c => ({
                  name: c.name, rating: c.rating, reviewCount: c.reviewCount
                })) || [],
                reviews: googlePlacesData?.reviews?.map(r => ({
                  rating: r.rating, text: r.text || "", time: r.relative_time_description
                })) || [],
                facebookAds: {
                  isRunning: facebookAdData?.isRunningAds || false,
                  adCount: facebookAdData?.adCount || 0,
                  ctas: facebookAdData?.ctas || [],
                  creatives: facebookAdData?.creatives || [],
                },
                googleAds: {
                  isRunning: googleAdsTransparencyData?.isRunningGoogleAds || false,
                  adCount: googleAdsTransparencyData?.adCount || 0,
                  headlines: googleAdsTransparencyData?.headlines || [],
                },
                campaignAnalysis: campaignAnalysis || null,
                techStack: {
                  hasCRM: hasCRMDetected || false,
                  hasChatWidget: hasChatDetected || false,
                  hasBookingSystem: hasBookingSystem || false,
                  hasVoiceAI: hasVoiceAIDetected || false,
                  techCount: builtWithData?.techCount || 0,
                  missingTech: builtWithData?.missingTech || [],
                },
                landingPage: {
                  hasAboveFoldCTA: landingPageAudit?.hasAboveFoldCTA || false,
                  formFieldCount: landingPageAudit?.formFieldCount || 0,
                  mobileOptimized: landingPageAudit?.mobileOptimized || false,
                  testimonialCount: landingPageAudit?.testimonialCount || 0,
                  trustBadgeCount: landingPageAudit?.trustBadgeCount || 0,
                  hasVideo: landingPageAudit?.hasVideo || false,
                  hasLiveChat: landingPageAudit?.hasLiveChat || false,
                  hasClickToCall: landingPageAudit?.hasClickToCall || false,
                  score: landingPageAudit?.score || 0,
                },
                aiExtracted: geminiBusinessExtract || {},
                scraped: {
                  services: services || [],
                  ctas: ctas || [],
                  testimonials: testimonials?.slice(0, 3) || [],
                  certifications: certifications || [],
                  socialMedia: socialMedia || {},
                  valuePropositions: finalValueProps || [],
                },
                branding: {
                  tagline: tagline || mainHeadline || null,
                  heroH1: mainHeadline || null,
                  primaryColor: primaryColor || null,
                },
                websiteContent: cleanBlob?.substring(0, 5000) || "",
                grades: grades,
              };
              const consultantResp = await env.CONSULTANT.fetch("https://consultant/", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(consultantPayload),
              });
              if (consultantResp.ok) {
                geminiConsultative = await consultantResp.json();
                traceLog.push(`Consultant Worker: Success — ${geminiConsultative._fallback ? "FALLBACK" : "Gemini"}`);
              } else {
                traceLog.push(`Consultant Worker: HTTP ${consultantResp.status}`);
              }
            } catch (e) {
              traceLog.push(`Consultant Worker: Error - ${e.message}`);
            }
          }

          const criticalFixes = {
            // Website gaps (Chris can solve)
            hasChatWidget: hasChatDetected,
            hasLeadForm: hasAnyLeadCapture,
            hasBookingSystem: hasBookingSystem || builtWithData?.hasScheduling,
            // Follow-up gaps (Alex/Sarah can solve)
            hasCRM: hasCRMDetected,
            hasCallTracking: hasCallTracking || builtWithData?.hasCallTracking,
            hasEmailMarketing: builtWithData?.hasMarketingAutomation || builtWithData?.hasCRMTech,
            // Advertising detection - combined from pixel detection + external APIs
            hasGoogleAdsPixel: hasGoogleAds,
            hasFacebookPixel,
            // External API: Google Ads Transparency
            googleAdsTransparency: googleAdsTransparencyData,
            isRunningGoogleAds: googleAdsTransparencyData?.isRunningGoogleAds || hasGoogleAds,
            // External API: Facebook Ad Library (ENHANCED)
            facebookAdLibrary: facebookAdData,
            isRunningFacebookAds: facebookAdData?.isRunningAds || hasFacebookPixel,
            facebookAdCount: facebookAdData?.adCount || 0,
            facebookCtaAnalysis: fbCtaAnalysis,
            facebookEstimatedSpend: facebookAdData?.estimatedSpend || null,
            facebookAdAge: facebookAdData?.oldestAdAgeDays || null,
            facebookHasStaleAds: facebookAdData?.hasStaleAds || false,
            // Combined ads status
            isRunningAds: googleAdsTransparencyData?.isRunningGoogleAds || hasGoogleAds || (facebookAdData?.isRunningAds || hasFacebookPixel),
            // Ad Funnel Intelligence (NEW)
            adFunnelScore: adFunnelResult,
            adFunnelVerdict: adFunnelResult.verdict,
            adWeeklyLoss: adFunnelResult.totalWeeklyLoss,
            hasCriticalAdIssues: adFunnelResult.hasCriticalIssues,
            // External API: Google Places (ENHANCED)
            googlePlaces: googlePlacesData,
            googlePlacesDebug,
            // DEBUG: Remove after fixing
            // DEBUG: Trace API issues
            _debug: {
              geminiApiKeySet: !!env.GEMINI_API_KEY,
              builtWithApiKeySet: !!env.BUILTWITH_API_KEY,
              reviewsAvailable: googlePlacesData?.reviews?.length || 0,
              geminiIntelligencePopulated: geminiIntelligence !== null,
              builtWithDataPopulated: builtWithData !== null,
              traceLog
            },
            googleRating: googlePlacesData?.rating || null,
            googleReviewCount: googlePlacesData?.reviewCount || null,
            googleOwnerResponseRate: googlePlacesData?.ownerResponseRate || null,
            googleReviewStats: googlePlacesData?.reviewStats || null,
            googleOpeningHours: googlePlacesData?.openingHours || null,
            googleBusinessStatus: googlePlacesData?.businessStatus || null,
            // Review Mining Intelligence (NEW - THE GOLDMINE)
            reviewMining: reviewMiningResult,
            showListenToPublic: reviewMiningResult?.showListenToPublic || false,
            listenToThePublic: reviewMiningResult?.listenToThePublic || [],
            sarahSleepingGiantCount: reviewMiningResult?.sarahSleepingGiantCount || 0,
            // NEW: Review Trends (FIX #9)
            reviewTrends,
            reviewTrendDirection: reviewTrends?.trend || "unknown",
            reviewTrendMessage: reviewTrends?.trendMessage || null,
            // NEW: Gemini AI Analysis (FIX #1, #2, #8)
            geminiIntelligence,
            topQuotes: geminiIntelligence?.topQuotes || [],
            hasQuotableContent: geminiIntelligence?.hasQuotableContent || false,
            strongestAgentFromReviews: geminiIntelligence?.strongestAgent || null,
            // NEW: Gemini Consultative Intelligence Layer (Super-Intelligence)
            geminiConsultative,
            aiCriticalIssues: geminiConsultative?.criticalIssues || [],
            aiAgentCopy: geminiConsultative?.agentCopy || null,
            aiHeroOverride: geminiConsultative?.heroOverride || null,
            aiPrimaryPainPoint: geminiConsultative?.primaryPainPoint || null,
            aiStrongestAgent: geminiConsultative?.strongestAgent || null,
            // NEW: AI-Extracted Content (FIX #10)
            aiExtractedContent: geminiFeatures,
            // NEW: Landing Page Audit (FIX #11)
            landingPageAudit,
            landingPageScore: landingPageAudit?.score || 0,
            // NEW: Social Media Intelligence (FIX #4, #5)
            socialMedia: socialMediaIntelligence,
            // Tech Stack Intelligence (ENHANCED)
            techStack: builtWithData,
            techStackScore: builtWithData?.techStackScore || null,
            missingTech: builtWithData?.missingTech || [],
            // Competitor Intelligence (NEW - Named competitors only)
            competitors: competitorData,
            competitorCount: competitorData?.count || 0,
            competitorAvgRating: competitorData?.avgRating || null,
            competitorInsights: competitorData?.insights || {},
            isRatingAboveCompetitors: competitorData?.isRatingAboveAvg || null,
            // Calculated Grades (NEW)
            // Calculated Grades (NEW)
            grades,
            // ============================================
            // SALES-FIRST RECOMMENDATIONS
            // Default = THEY NEED US. Build the argument WHY.
            // ============================================
            // CHRIS (Concierge) - No Voice AI = they need us, period
            needsWebsiteConcierge: (() => {
              const hasVoiceAI = htmlLower.includes("voice ai") || htmlLower.includes("ai receptionist") || htmlLower.includes("vapi") || htmlLower.includes("retell") || builtWithData?.technologies?.some((t) => /vapi|retell|bland\.ai|air\.ai|play\.ht/i.test(t));
              return !hasVoiceAI;
            })(),
            conciergeEvidence: (() => {
              const evidence = [];
              if (!hasChatDetected) evidence.push("No live chat detected");
              if (hasChatDetected && !htmlLower.includes("24/7")) evidence.push("Chat widget found but no 24/7 coverage indicated");
              if (reviewMiningResult?.summary?.chris > 0) evidence.push(`${reviewMiningResult.summary.chris} reviews mention website confusion`);
              if (evidence.length === 0) evidence.push("No Voice AI detected - missing instant, intelligent engagement");
              return evidence;
            })(),
            // ALEX (Speed-to-Lead) - Running ads OR has form = they need instant follow-up
            needsSpeedToLead: (() => {
              const isRunningAnyAds = googleAdsTransparencyData?.isRunningGoogleAds || hasGoogleAds || (facebookAdData?.isRunningAds || hasFacebookPixel);
              return isRunningAnyAds || hasAnyLeadCapture;
            })(),
            speedToLeadEvidence: (() => {
              const evidence = [];
              const isRunningAnyAds = googleAdsTransparencyData?.isRunningGoogleAds || hasGoogleAds || (facebookAdData?.isRunningAds || hasFacebookPixel);
              if (isRunningAnyAds) evidence.push("Running paid ads - leads expect instant response");
              if (hasAnyLeadCapture) evidence.push("Has lead capture forms - responses need automation");
              if (!hasCRMDetected) evidence.push("No CRM detected - likely manual follow-up");
              if (hasCRMDetected) evidence.push("CRM detected but that doesn't guarantee speed");
              if (reviewMiningResult?.summary?.alex > 0) evidence.push(`${reviewMiningResult.summary.alex} reviews mention slow response`);
              if (evidence.length === 0) evidence.push("No instant response automation detected");
              return evidence;
            })(),
            // MADDIE (Call Handling) - No Voice AI answering = they need us
            needsCallHandling: (() => {
              const hasVoiceAI = builtWithData?.technologies?.some((t) => /vapi|retell|bland\.ai|air\.ai|ruby receptionist|smith\.ai/i.test(t));
              const has24_7Claim = htmlLower.includes("24/7") || htmlLower.includes("24 hours");
              return !hasVoiceAI;
            })(),
            callHandlingEvidence: (() => {
              const evidence = [];
              const has24_7Claim = htmlLower.includes("24/7") || htmlLower.includes("24 hours");
              if (!has24_7Claim) evidence.push("No 24/7 availability claimed");
              if (!hasCallTracking && !builtWithData?.hasCallTracking) evidence.push("No call tracking detected");
              if (reviewMiningResult?.summary?.maddie > 0) evidence.push(`${reviewMiningResult.summary.maddie} reviews mention missed calls or hard to reach`);
              if (evidence.length === 0) evidence.push("No AI phone handling detected - calls after hours go unanswered");
              return evidence;
            })(),
            // SARAH (Database Reactivation) - 1+ years OR has reviews = dormant leads exist
            needsDatabaseReactivation: (() => {
              const years = parseInt(yearsInBusiness) || 0;
              const revCount = googlePlacesData?.reviewCount || 0;
              return years >= 1 || revCount > 10 || (reviewMiningResult?.sarahSleepingGiantCount || 0) > 0;
            })(),
            databaseReactivationEvidence: (() => {
              const evidence = [];
              const years = parseInt(yearsInBusiness) || 0;
              if (years >= 1) evidence.push(`${years}+ years in business - guaranteed dormant database`);
              const sleepingGiants = reviewMiningResult?.sarahSleepingGiantCount || 0;
              if (sleepingGiants > 0) evidence.push(`${sleepingGiants} positive reviews over 1 year old - past customers to reactivate`);
              if (!builtWithData?.hasMarketingAutomation) evidence.push("No email marketing automation detected");
              if (evidence.length === 0) evidence.push("Every business has past customers worth reactivating");
              return evidence;
            })(),
            // JAMES (Reputation) - Industry-adjusted, always room to improve
            needsReputationManagement: (() => {
              const rating = googlePlacesData?.rating || parseFloat(starRating) || null;
              const responseRate = googlePlacesData?.ownerResponseRate || 0;
              const reviewCount2 = googlePlacesData?.reviewCount || 0;
              return !rating || rating < 4.8 || responseRate < 0.8 || reviewCount2 < 50;
            })(),
            reputationEvidence: (() => {
              const evidence = [];
              const rating = googlePlacesData?.rating || parseFloat(starRating);
              const responseRate = googlePlacesData?.ownerResponseRate || 0;
              const reviewCount2 = googlePlacesData?.reviewCount || 0;
              if (!rating) evidence.push("No Google rating found - missing social proof");
              else if (rating < 4.5) evidence.push(`${rating} star rating - below optimal 4.5+ threshold`);
              else if (rating < 4.8) evidence.push(`${rating} stars - good but not dominant`);
              if (responseRate < 0.5) evidence.push(`${Math.round(responseRate * 100)}% owner response rate - hurting local SEO`);
              if (reviewCount2 < 50) evidence.push(`Only ${reviewCount2} reviews - need more social proof`);
              if (reviewMiningResult?.summary?.james > 0) evidence.push(`${reviewMiningResult.summary.james} reviews mention reputation concerns`);
              const negatives = googlePlacesData?.reviewStats?.negativeCount || 0;
              if (negatives > 0) evidence.push(`${negatives} negative reviews need response`);
              if (evidence.length === 0) evidence.push("Reputation always needs active management");
              return evidence;
            })(),
            // Lead capture is SEPARATE from speed-to-lead
            needsLeadCapture: !hasAnyLeadCapture,
            needsReviewResponseManagement: googlePlacesData?.ownerResponseRate !== void 0 && googlePlacesData.ownerResponseRate < 0.5,
            // Evidence flags from review mining (EMPHASIZE when found)
            hasSlowResponseEvidence: (reviewMiningResult?.summary?.alex || 0) > 0,
            hasMissedCallEvidence: (reviewMiningResult?.summary?.maddie || 0) > 0,
            hasWebsiteConfusionEvidence: (reviewMiningResult?.summary?.chris || 0) > 0,
            hasDormantCustomerEvidence: (reviewMiningResult?.summary?.sarah || 0) > 0 || (reviewMiningResult?.sarahSleepingGiantCount || 0) > 0,
            hasReputationEvidence: (reviewMiningResult?.summary?.james || 0) > 0
          };
          const contextBlob = `BUSINESS: ${lpBusinessName} | INDUSTRY: ${industryNiche || industry} (${industryConfidence}) | ICP: ${lpTargetAudience} (${confidence.target_audience}) | MODEL: ${businessModel} | SALES_TERM: ${lpSalesTerm} (${confidence.sales_term}) | SERVICES: ${lpServices} | USPs: ${finalValueProps.join(", ")} | BENEFITS: ${lpBenefits.slice(0, 3).join("; ")} | FEATURES: ${lpFeatures.slice(0, 5).join("; ")} | CTAS: ${finalCTAs.slice(0, 3).join(", ")} | LOCATION: ${lpLocation} | PHONE: ${lpPhone} | RATING: ${starRating} | DESCRIPTION: ${description} | OVERALL CONFIDENCE: ${confidence.overall} | CONTENT: ${cleanBlob.substring(0, 4e3)}`;
          const confidenceThreshold = 0.7;
          const useGeminiOverrides = geminiFeatures?.confidence_score >= confidenceThreshold;
          if (useGeminiOverrides && geminiFeatures.normalized_name) {
            businessName = geminiFeatures.normalized_name;
            lpBusinessName = geminiFeatures.normalized_name;
          }
          if (useGeminiOverrides && geminiFeatures.normalized_location) {
            location = geminiFeatures.normalized_location;
            lpLocation = geminiFeatures.normalized_location;
          }
          if (useGeminiOverrides && geminiFeatures.ideal_customer_persona) {
            targetAudience = geminiFeatures.ideal_customer_persona;
            lpTargetAudience = geminiFeatures.ideal_customer_persona;
          }
          if (useGeminiOverrides && geminiFeatures.pricing_info && geminiFeatures.pricing_info !== "Not publicly listed") {
            pricingInfo = geminiFeatures.pricing_info;
          }
          if (useGeminiOverrides && geminiFeatures.business_description) {
            description = geminiFeatures.business_description;
          }
          // ── V3: Apply Gemini Business Intelligence overrides (fills regex gaps) ──
          const gbeOverrides = {};
          if (geminiBusinessExtract) {
            const gbe = geminiBusinessExtract;
            if (gbe.business_description && (!description || description.length < 50)) description = gbe.business_description;
            if (gbe.target_audience_detailed && (!targetAudience || targetAudience === "clients")) targetAudience = gbe.target_audience_detailed;
            if (gbe.industry_niche && (!industryNiche || industryNiche === industry)) industryNiche = gbe.industry_niche;
            if (gbe.pricing_info && !pricingInfo) pricingInfo = gbe.pricing_info;
            if (gbe.years_in_business && !yearsInBusiness) yearsInBusiness = gbe.years_in_business;
            if (gbe.team_size) gbeOverrides.team_size = gbe.team_size;
            if (gbe.network_size) gbeOverrides.network_size = gbe.network_size;
            // Arrays: store as overrides, merge into responseData later
            if (gbe.service_areas && gbe.service_areas.length > 0) gbeOverrides.service_areas = gbe.service_areas;
            if (gbe.certifications && gbe.certifications.length > 0) gbeOverrides.certifications = gbe.certifications;
            if (gbe.guarantees && gbe.guarantees.length > 0) gbeOverrides.guarantees = gbe.guarantees;
            if (gbe.key_differentiators && gbe.key_differentiators.length > 0) gbeOverrides.key_differentiators = gbe.key_differentiators;
            if (gbe.payment_methods && gbe.payment_methods.length > 0) gbeOverrides.payment_methods = gbe.payment_methods;
            if (gbe.faqs && gbe.faqs.length > 0) gbeOverrides.faqs = gbe.faqs;
            if (gbe.testimonials && gbe.testimonials.length > 0) gbeOverrides.testimonials = gbe.testimonials;
            if (gbe.case_studies && gbe.case_studies.length > 0) gbeOverrides.case_studies = gbe.case_studies;
          }
          const responseData = {
            success: true,
            scrapeStatus: "complete",
            // -- CORE IDENTITY --
            business_name: businessName,
            tagline,
            industry: industryNiche || industry,
            industry_base: industry,
            industry_niche: industryNiche,
            industry_confidence: industryConfidence,
            service_type: serviceType,
            business_model: businessModel,
            // -- TARGET AUDIENCE / ICP --
            target_audience: targetAudience,
            icp_details: icpDetails,
            business_description: description,
            // -- SALES --
            sales_call_terminology: salesTerm,
            services: finalServicesText,
            pricing_info: pricingInfo,
            special_offers: specialOffers.join(", "),
            // -- BRANDING --
            primary_color: primaryColor,
            secondary_color: secondaryColor,
            accent_color: accentColor,
            primary_font: primaryFont,
            secondary_font: secondaryFont,
            logo_url: logoUrl,
            // NEW: Resolved logo from multiple sources
            logo_intelligence: (() => {
              let domain = "";
              try {
                domain = new URL(website_url).hostname.replace("www.", "");
              } catch (e) {
              }
              return resolveLogo(logoUrl, ogImage, googlePlacesData, domain, env.GOOGLE_PLACES_API_KEY);
            })(),
            // -- CONTACT --
            phone,
            email,
            address,
            location,
            business_hours: businessHours,
            // -- SOCIAL PROOF --
            star_rating: starRating,
            review_count: reviewCount,
            testimonials: testimonials.length > 0 ? testimonials : (gbeOverrides.testimonials || null),
            case_studies: caseStudies.length > 0 ? caseStudies : (gbeOverrides.case_studies || null),
            years_in_business: yearsInBusiness,
            certifications: (certifications.length > 0 ? certifications : (gbeOverrides.certifications || [])).join(", "),
            guarantees: (guarantees.length > 0 ? guarantees : (gbeOverrides.guarantees || [])).join(", "),
            value_propositions: (finalValueProps.length > 0 ? finalValueProps : (gbeOverrides.key_differentiators || [])).join(", "),
            // -- SOCIAL MEDIA --
            social_media: socialMedia,
            facebook: socialMedia.facebook || "",
            instagram: socialMedia.instagram || "",
            linkedin: socialMedia.linkedin || "",
            // -- OPERATIONAL --
            service_areas: (serviceAreas.length > 0 ? serviceAreas : (gbeOverrides.service_areas || [])).join(", "),
            team_size: teamSize || gbeOverrides.team_size || gbeOverrides.network_size || null,
            payment_methods: (paymentMethods.length > 0 ? paymentMethods : (gbeOverrides.payment_methods || [])).join(", "),
            emergency_service: emergencyService ? "Yes" : "No",
            response_time: responseTime,
            insurance_info: insuranceInfo,
            copyright_year: copyrightYear,
            // -- SALES INTELLIGENCE (with fallbacks applied) --
            faqs: faqs.length > 0 ? faqs : (gbeOverrides.faqs || null),
            benefits: finalBenefits,
            features: finalFeatures,
            ctas: finalCTAs,
            pain_points: painPoints,
            main_usp: mainUSP,
            // -- CONFIDENCE SCORES --
            confidence,
            sales_term_confidence: confidence.sales_term,
            target_audience_confidence: confidence.target_audience,
            overall_confidence: confidence.overall,
            // -- LANDING PAGE COPY (with conversational fallbacks) --
            lp_business_name: lpBusinessName,
            lp_tagline: lpTagline,
            lp_services: lpServices,
            lp_target_audience: lpTargetAudience,
            lp_sales_term: lpSalesTerm,
            lp_location: lpLocation,
            lp_phone: lpPhone,
            lp_main_usp: lpMainUSP,
            lp_benefits: lpBenefits,
            lp_features: lpFeatures,
            lp_pain_points: lpPainPoints.length > 0 ? lpPainPoints : void 0,
            lp_ctas: finalCTAs,
            lp_value_props: finalValueProps,
            // -- AI CONTEXT --
            site_context_blob: contextBlob,
            agent_knowledge_blob: agentKnowledgeBlob,
            // -- GEMINI CONSULTATIVE INTELLIGENCE (FOR AGENTS & VOICE WIDGETS) --
            // This contains AI-generated insights for demo agents to use
            // -- CONSULTANT INTELLIGENCE (V3 — full output from consultant-sandbox worker) --
            consultative_intelligence: geminiConsultative || null,
            // -- CRITICAL FIXES ANALYSIS (NEW) --
            critical_fixes: criticalFixes,
            // -- PRIORITIZED FIXES WITH REVENUE ESTIMATES (NEW) --
            prioritized_fixes: buildPrioritizedFixes(
              criticalFixes,
              industry,
              googlePlacesData?.reviewCount || 0,
              criticalFixes.isRunningAds,
              lpBusinessName,
              body?.avgClientValue || body?.annualCustomerValue || null
              // User-provided value from chat/calculator
            ),
            // -- MARKETING INTELLIGENCE (COMPREHENSIVE - For Chris & all agents) --
            marketing_intelligence: {
              // Grades (calculated from data)
              grades: criticalFixes.grades,
              overallGrade: criticalFixes.grades?.overall?.grade || "N/A",
              // Ad Intelligence
              adIntelligence: {
                isRunningAds: criticalFixes.isRunningAds,
                facebookAds: {
                  isRunning: criticalFixes.isRunningFacebookAds,
                  adCount: criticalFixes.facebookAdCount,
                  estimatedSpend: criticalFixes.facebookEstimatedSpend,
                  ctaAnalysis: criticalFixes.facebookCtaAnalysis,
                  adAge: criticalFixes.facebookAdAge,
                  hasStaleAds: criticalFixes.facebookHasStaleAds,
                  creatives: facebookAdData?.creatives || [],
                  headlines: facebookAdData?.headlines || [],
                  landingPages: facebookAdData?.landingPages || []
                },
                googleAds: {
                  isRunning: criticalFixes.isRunningGoogleAds,
                  data: googleAdsTransparencyData
                },
                funnelScore: criticalFixes.adFunnelScore,
                verdict: criticalFixes.adFunnelVerdict,
                weeklyLoss: criticalFixes.adWeeklyLoss,
                hasCriticalIssues: criticalFixes.hasCriticalAdIssues
              },
              // Reputation Intelligence
              reputationIntelligence: {
                googleRating: criticalFixes.googleRating,
                reviewCount: criticalFixes.googleReviewCount,
                ownerResponseRate: criticalFixes.googleOwnerResponseRate,
                reviewStats: criticalFixes.googleReviewStats,
                openingHours: criticalFixes.googleOpeningHours,
                businessStatus: criticalFixes.googleBusinessStatus,
                grade: criticalFixes.grades?.reputation?.grade || "N/A"
              },
              // Tech Stack Intelligence
              techStackIntelligence: {
                score: criticalFixes.techStackScore?.score || 0,
                level: criticalFixes.techStackScore?.level || "Unknown",
                missing: criticalFixes.missingTech,
                hasCRM: criticalFixes.hasCRM,
                hasChat: criticalFixes.hasChatWidget,
                hasCallTracking: criticalFixes.hasCallTracking,
                hasEmailMarketing: criticalFixes.hasEmailMarketing,
                grade: criticalFixes.grades?.techStack?.grade || "N/A"
              },
              // Review Mining Intelligence (THE GOLDMINE)
              reviewMining: criticalFixes.reviewMining,
              showListenToPublic: criticalFixes.showListenToPublic,
              listenToThePublic: criticalFixes.listenToThePublic,
              // Sarah's Sleeping Giant
              sarahSleepingGiant: {
                count: criticalFixes.sarahSleepingGiantCount,
                hasOpportunity: criticalFixes.sarahSleepingGiantCount > 0,
                pitch: criticalFixes.sarahSleepingGiantCount > 0 ? `You have ${criticalFixes.sarahSleepingGiantCount} positive reviews over 1 year old. When did you last reach out to these satisfied customers for renewals, upsells, or referrals?` : null
              },
              // Evidence-based agent needs
              evidenceBasedNeeds: {
                alex: { hasEvidence: criticalFixes.hasSlowResponseEvidence, indicators: criticalFixes.reviewMining?.agentNeedIndicators?.alex || [] },
                maddie: { hasEvidence: criticalFixes.hasMissedCallEvidence, indicators: criticalFixes.reviewMining?.agentNeedIndicators?.maddie || [] },
                chris: { hasEvidence: criticalFixes.hasWebsiteConfusionEvidence, indicators: criticalFixes.reviewMining?.agentNeedIndicators?.chris || [] },
                sarah: { hasEvidence: criticalFixes.hasDormantCustomerEvidence, indicators: criticalFixes.reviewMining?.agentNeedIndicators?.sarah || [] },
                james: { hasEvidence: (criticalFixes.reviewMining?.summary?.james || 0) > 0, indicators: criticalFixes.reviewMining?.agentNeedIndicators?.james || [] }
              },
              // Total opportunity
              totalWeeklyOpportunity: criticalFixes.adWeeklyLoss + criticalFixes.sarahSleepingGiantCount * 100,
              // Rough estimate
              verdict: criticalFixes.adFunnelVerdict || "Needs Attention",
              // NEW: Gemini AI Intelligence (FIX #1, #2, #8)
              geminiIntelligence,
              // NEW: Top Quotable Content (FIX #2 - SALES GOLD)
              topQuotes: geminiIntelligence?.topQuotes || [],
              hasQuotableContent: geminiIntelligence?.hasQuotableContent || false,
              painPointsSummary: geminiIntelligence?.painPointsSummary || [],
              strongestAgentFromReviews: geminiIntelligence?.strongestAgent || null,
              // NEW: AI-Extracted Features/Benefits (FIX #10)
              aiExtractedServices: geminiFeatures?.services || [],
              aiExtractedFeatures: geminiFeatures?.features || [],
              aiExtractedBenefits: geminiFeatures?.benefits || [],
              aiExtractedPainPoints: geminiFeatures?.pain_points || [],
              aiExtractedUSPs: geminiFeatures?.usps || [],
              // NEW: Gemini Normalization Intelligence
              geminiNormalization: geminiFeatures ? {
                normalized_name: geminiFeatures.normalized_name,
                normalized_location: geminiFeatures.normalized_location,
                ideal_customer_persona: geminiFeatures.ideal_customer_persona,
                pricing_info: geminiFeatures.pricing_info,
                business_description: geminiFeatures.business_description,
                confidence_score: geminiFeatures.confidence_score,
                override_applied: useGeminiOverrides
              } : null,
              // NEW: Review Trends (FIX #9)
              reviewTrends,
              // NEW: Landing Page Audit (FIX #11)
              landingPageAudit,
              landingPageScore: landingPageAudit?.score || 0,
              // NEW: Social Media Intelligence (FIX #4, #5)
              socialMedia: socialMediaIntelligence,
              // NEW: Cascading Scraper Results
              scraperResults: {
                tier: scraperTier,
                // 'primary', 'scraperapi', 'firecrawl', 'zenrows', 'protected_site'
                scraperApi: scraperApiData,
                firecrawl: firecrawlData,
                zenrows: zenrowsData,
                outscraper: outscraperData,
                apify: apifyData
              },
              // NEW: Hiring Signals (For "Hiring Hero" Feature)
              hiringSignals
            },
            // -- META --
            url: website_url,
            title,
            main_headline: mainHeadline,
            og_image: ogImage
          };
          const cleanResponse = {};
          for (const [key, value] of Object.entries(responseData)) {
            if (key === "success") {
              cleanResponse[key] = value;
            } else if (Array.isArray(value) && value.length === 0) {
              continue;
            } else if (value === "" || value === null || value === void 0) {
              continue;
            } else if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
              continue;
            } else {
              cleanResponse[key] = value;
            }
          }
          const shouldRedirect = url.searchParams.get("redirect") === "true";
          const redirectContactId = body.contact_id || body.contactId || url.searchParams.get("contact_id") || "";
          if (shouldRedirect) {
            const demoBaseUrl = "https://agentdemoloadingpage.netlify.app";
            const demoParams = new URLSearchParams();
            if (redirectContactId) demoParams.set("cid", redirectContactId);
            if (businessName) demoParams.set("biz", businessName);
            if (tagline) demoParams.set("tag", tagline);
            if (industry) demoParams.set("ind", industry);
            if (industryNiche) demoParams.set("niche", industryNiche);
            if (serviceType) demoParams.set("stype", serviceType);
            if (businessModel) demoParams.set("bmodel", businessModel);
            if (description) demoParams.set("desc", description.substring(0, 200));
            if (targetAudience) demoParams.set("aud", targetAudience);
            if (salesTerm) demoParams.set("call", salesTerm);
            if (finalServicesText) demoParams.set("serv", finalServicesText.substring(0, 200));
            if (pricingInfo) demoParams.set("price", pricingInfo);
            if (primaryColor) demoParams.set("pcolor", primaryColor);
            if (secondaryColor) demoParams.set("scolor", secondaryColor);
            if (accentColor) demoParams.set("acolor", accentColor);
            if (primaryFont) demoParams.set("pfont", primaryFont);
            if (logoUrl) demoParams.set("logo", logoUrl);
            if (phone) demoParams.set("phone", phone);
            if (location) demoParams.set("loc", location);
            if (website_url) demoParams.set("web", website_url);
            if (businessHours) demoParams.set("hours", businessHours);
            if (starRating) demoParams.set("rating", starRating);
            if (reviewCount) demoParams.set("reviews", reviewCount);
            if (yearsInBusiness) demoParams.set("years", yearsInBusiness);
            if (finalBenefits && finalBenefits.length > 0) {
              demoParams.set("bene", finalBenefits.slice(0, 5).join("|"));
            }
            if (painPoints && painPoints.length > 0) {
              demoParams.set("pain", painPoints.slice(0, 3).join("|"));
            }
            if (finalValueProps && finalValueProps.length > 0) {
              demoParams.set("vprops", finalValueProps.slice(0, 4).join("|"));
            }
            if (finalCTAs && finalCTAs.length > 0) {
              demoParams.set("ctas", finalCTAs.slice(0, 3).join("|"));
            }
            if (mainUSP) demoParams.set("usp", mainUSP.substring(0, 150));
            const redirectUrl = `${demoBaseUrl}?${demoParams.toString()}`;
            return new Response(null, {
              status: 302,
              headers: {
                "Location": redirectUrl,
                "Access-Control-Allow-Origin": "*"
              }
            });
          }
          if (leadIdFromRequest && env.LEADS_KV) {
            try {
              const existingData = await env.LEADS_KV.get("lead:" + leadIdFromRequest);
              let leadData = existingData ? JSON.parse(existingData) : {};
              // V3 FIX: Also read the bare lid key (Safety Net) to preserve firstName/email
              const safetyNetRaw = await env.LEADS_KV.get(leadIdFromRequest);
              const safetyNetData = safetyNetRaw ? JSON.parse(safetyNetRaw) : {};
              const updatedLeadData = {
                ...safetyNetData,
                ...leadData,
                ...cleanResponse,
                // V3 FIX: Explicitly preserve person data from Safety Net / /log-lead
                firstName: safetyNetData.firstName || leadData.firstName || body._v3_firstName || cleanResponse.firstName || "",
                first_name: safetyNetData.firstName || leadData.firstName || body._v3_firstName || cleanResponse.firstName || "",
                email: safetyNetData.email || leadData.email || cleanResponse.email || "",
                lid: leadIdFromRequest,
                scrapedAt: (/* @__PURE__ */ new Date()).toISOString(),
                scrapeStatus: "complete",
                status: "scraped"
              };
              await env.LEADS_KV.put("lead:" + leadIdFromRequest, JSON.stringify(updatedLeadData), { expirationTtl: 2592e3 });
              await env.LEADS_KV.put(leadIdFromRequest, JSON.stringify(updatedLeadData), { expirationTtl: 2592e3 });
              // V3 FIX: Write lead:{lid}:intel stub so MCP reports pipeline_status: "complete"
              // Deep Track (Apify) will overwrite with enriched data when it finishes
              try {
                const intelStub = {
                  v: 1, lid: leadIdFromRequest,
                  // Normalise first_name: title-case (handles raw ALL-CAPS form input)
                  first_name: (() => {
                    const raw = updatedLeadData.firstName || updatedLeadData.first_name || "";
                    return raw.trim() ? raw.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : raw;
                  })(),
                  // Use Gemini normalised_name (e.g. "Pitcher Partners") not raw domain
                  core_identity: {
                    business_name: businessName || updatedLeadData.lp_business_name || updatedLeadData.business_name || "",
                    industry_niche: updatedLeadData.industry || "",
                    model: updatedLeadData.business_model || "",
                    tagline: updatedLeadData.lp_tagline || ""
                  },
                  icp: { target_audience: updatedLeadData.target_audience || "", pain_points: updatedLeadData.pain_points || [] },
                  services: updatedLeadData.services || "",
                  routing: { top_agents: updatedLeadData.prioritized_fixes?.topFixes?.map(f => f.agent) || [] },
                  agent_ranking: updatedLeadData.prioritized_fixes?.topFixes?.map(f => f.agent) || [],
                  bella_opener: `I was looking at ${businessName || updatedLeadData.business_name || "your website"}. ${updatedLeadData.main_headline ? "Your main message is: " + updatedLeadData.main_headline : "There is some really exciting opportunity here."}`.trim(),
                  top_fix: updatedLeadData.prioritized_fixes?.topFixes?.[0] || {},
                  website_health: { google_rating: updatedLeadData.critical_fixes?.googleRating || null, review_count: updatedLeadData.critical_fixes?.googleReviewCount || null },
                  flags: { is_running_ads: updatedLeadData.critical_fixes?.isRunningAds || false },
                  // V3: Merge Consultant output so Bella's voice agent can read it
                  consultant: geminiConsultative || null,
                  phase_b_generated: true, ts: new Date().toISOString()
                };
                await env.LEADS_KV.put("lead:" + leadIdFromRequest + ":intel", JSON.stringify(intelStub), { expirationTtl: 2592e3 });
                console.log("Phase B: Intel stub written to lead:" + leadIdFromRequest + ":intel — MCP will now report complete");
              } catch (intelStubErr) { console.error("Phase B: Intel stub write failed:", intelStubErr); }
              console.log("Phase B: Full KV write complete for lid:", leadIdFromRequest, "— duration:", Date.now() - phaseBStart, "ms");
              try {
                const scriptStages = {
                  "stage_welcome": {
                    "text": "Hi {{first_name}}, welcome to your personalised AI demo. I am Bella, Strategic Intel Director at Pillar and Post. We have done a deep dive into {{business_name}} and I have to say, there is some really exciting opportunity here.",
                    "fallbacks": ["Hi there, welcome to your personalised AI demo. I am Bella, Strategic Intel Director at Pillar and Post. We have had a look at your business and I have to say, there is some really exciting opportunity here."]
                  },
                  "stage_website_positive": {
                    "text": "I love your website. {{hero_header_quote}}. It presents really well and {{website_positive_comment}}.",
                    "fallbacks": ["Your website presents really well. I can see you have put thought into your online presence."]
                  },
                  "stage_deep_dive_offer_icp": {
                    "text": "Your key offer around {{reference_offer}} is solid, and the data points to {{icp_guess}} as your ideal customer. Does that sound right?",
                    "fallbacks": ["From what I can see, you have a strong offering. Who would you say is your ideal customer?"]
                  },
                  "stage_ads_scan": {
                    "text": "Now looking at your advertising. {{ads_scan_dynamic}}. How are those performing for you?",
                    "fallbacks": ["We could not see any active Google or Facebook campaigns. Is that intentional, or have you run ads before?"]
                  },
                  "stage_reputation_audit": {
                    "text": "Your online reputation is sitting at {{star_rating}} stars from {{review_count}} Google reviews. {{top_review_quote}}. That is a solid foundation.",
                    "fallbacks": ["From what I can see online, there is plenty of room to grow your review presence with the right system in place."]
                  },
                  "stage_explain_demo": {
                    "text": "So here is how today works. We have pre-trained your AI agent team on over a hundred data points about {{business_name}}, so they will demo exactly as if they are already on your payroll. I would love for you to roleplay as one of your prospects.",
                    "fallbacks": ["So here is how today works. We have pre-trained your AI agent team on your business data, so they will demo exactly as if they are already on your payroll. I would love for you to roleplay as one of your prospects."]
                  },
                  "stage_choice_work_out_opportunities": {
                    "text": "My job right now is to crunch your numbers, identify your highest ROI gaps, and recommend the top three agents to deploy. Sound good?",
                    "fallbacks": ["My job right now is to crunch your numbers, identify your highest ROI gaps, and recommend the top three agents to deploy. Sound good?"]
                  },
                  "stage_before_you_go_acv_setup": {
                    "text": "Before I do, I need one number from you. What would you say an average new customer is worth to {{business_name}} over their lifetime?",
                    "fallbacks": ["Before I do, I need one number from you. What would you say an average new customer is worth to your business over their lifetime?"]
                  },
                  "stage_acv_ack": {
                    "text": "{{acv_value}}, got it. That is a really useful number. Let me crunch that against what we have found.",
                    "fallbacks": ["Got it. That is a really useful number. Let me crunch that against what we have found."]
                  },
                  "stage_running_ads_leads_question": {
                    "text": "You mentioned you are running ads. How many leads a week or month would you say you are getting from Google or Facebook?",
                    "fallbacks": ["How many leads a week or month would you say you are getting from your current marketing?"]
                  },
                  "stage_not_running_ads_question": {
                    "text": "Since you are not currently running paid ads, where would you say most of your new leads are coming from right now?",
                    "fallbacks": ["Where would you say most of your new leads are coming from right now?"]
                  },
                  "stage_follow_up_time_question": {
                    "text": "And what is your typical follow up time when a new lead comes in? Are we talking minutes, hours, or sometimes the next day?",
                    "fallbacks": ["And what is your typical follow up time when a new lead comes in?"]
                  },
                  "stage_website_leads_question": {
                    "text": "Your website CTAs I can see are {{top_2_website_ctas}}. How many leads would you say you get monthly from the website?",
                    "fallbacks": ["How many leads would you say you get monthly from the website?"]
                  },
                  "stage_site_followup_rate_question": {
                    "text": "And what percentage of those website leads would you say actually get followed up?",
                    "fallbacks": ["And what percentage of those website leads would you say actually get followed up?"]
                  },
                  "stage_inbound_calls_question": {
                    "text": "Your phone number is visible on the site. Inbound calls, how many appointments does that book per week at {{location}}?",
                    "fallbacks": ["Your phone number is visible on the site. How many inbound calls would you say convert to appointments per week?"]
                  },
                  "stage_after_hours_question": {
                    "text": "I did not see any twenty four seven chat or after hours coverage on the site. Are after hours calls going to voicemail right now?",
                    "fallbacks": ["Do you currently have any after hours coverage, or are those calls going to voicemail?"]
                  },
                  "stage_last_two_questions_setup": {
                    "text": "Great, just two more quick questions and then I will have everything I need to crunch your numbers.",
                    "fallbacks": ["Great, just two more quick questions and then I will have everything I need to crunch your numbers."]
                  },
                  "stage_old_leads_question": {
                    "text": "{{business_name}} looks like you have been operating for a solid {{years_in_business}} years. In the last twelve months, roughly how many old leads or past customers would be sitting in your database?",
                    "fallbacks": ["In the last twelve months, roughly how many old leads or past customers would be sitting in your database?"]
                  },
                  "stage_review_system_question": {
                    "text": "You are sitting at {{star_rating}} stars and {{review_count}} reviews. Do you have a system in place to request reviews from happy customers, or is that something that just happens organically?",
                    "fallbacks": ["Do you have a system in place to request reviews from happy customers, or is that something that just happens organically?"]
                  },
                  "stage_recommend_top_3": {
                    "text": "Thanks {{first_name}}, that gives me a really clear picture. Based on everything, here are your top three ROI agents. Number one is {{agent_1}}. {{agent_1_roi_narrative}}. Number two is {{agent_2}}. {{agent_2_roi_narrative}}. Number three is {{agent_3}}. {{agent_3_roi_narrative}}.",
                    "fallbacks": ["Thanks, that gives me a really clear picture. Based on everything we have discussed, here are the three agents that would have the biggest impact on your bottom line."]
                  },
                  "stage_total_from_three": {
                    "text": "Combined, the top three agents represent around {{total_roi_monthly}} per month in conservative uplift for {{business_name}}.",
                    "fallbacks": ["Combined, these three agents represent significant conservative monthly uplift for your business."]
                  },
                  "stage_other_two_overview": {
                    "text": "Now the other two agents, {{agent_4}} and {{agent_5}}, are also worth a look. They round out the full suite and cover additional gaps we identified.",
                    "fallbacks": ["The remaining agents in the suite also cover important gaps we identified, and they are all included in the trial."]
                  },
                  "stage_trial_close_and_exit": {
                    "text": "We include all five agents in the free seven day trial. No credit card, and I will personally onboard you. Based on the numbers we just ran, you would see a meaningful improvement in the first week alone. Does that sound worth seven days of your time?",
                    "fallbacks": ["We include all five agents in the free seven day trial. No credit card required. Based on everything we have discussed, does that sound worth seven days of your time?"]
                  }
                };
                await env.LEADS_KV.put(
                  "lead:" + leadIdFromRequest + ":script_stages",
                  JSON.stringify(scriptStages),
                  { expirationTtl: 2592e3 }
                );
                console.log("Phase B: Voice RAG script stages seeded for lid:", leadIdFromRequest);
              } catch (scriptSeedError) {
                console.error("Phase B Script Seed Error:", scriptSeedError);
              }
            } catch (kvError) {
              console.error("Phase B KV Save Error:", kvError);
            }
          }
        } catch (phaseBError) {
          console.error(`[Phase B FAILED] lid: ${leadIdFromRequest} — ${phaseBError.message} — duration: ${Date.now() - phaseBStart}ms`, phaseBError.stack);
        }
        }  // close inner block
        console.log(`[Phase B END] lid: ${leadIdFromRequest} — total duration: ${Date.now() - phaseBStart}ms`);
        } catch (outerErr) {
          console.error(`[Phase B OUTER ERROR] lid: ${leadIdFromRequest} — ${outerErr.message} — Duration: ${Date.now() - phaseBStart}ms`);
        }
      })());
      // ── V3 PAYLOAD MERGE: Combine V2's 110 data points into V3 envelope ──
      if (body._v3_leadId && v3_intel_stub) {
        // Merge phaseAResponse fields into fast_context
        v3_intel_stub.fast_context = deepMergeV3(v3_intel_stub.fast_context, {
          business: {
            name: phaseAResponse.business_name || v3_intel_stub.fast_context.business.name,
            location: phaseAResponse.location || v3_intel_stub.fast_context.business.location,
            rating: parseFloat(phaseAResponse.star_rating) || v3_intel_stub.fast_context.business.rating,
            review_count: parseInt(phaseAResponse.review_count) || v3_intel_stub.fast_context.business.review_count,
            logo_url: phaseAResponse.logo_url || v3_intel_stub.fast_context.business.logo_url,
          },
          person: {
            first_name: phaseAResponse.firstName || v3_intel_stub.fast_context.person.first_name,
          },
          ads: {
            is_running_ads: phaseAResponse.is_running_ads || false,
            facebook_ads_running: phaseAResponse.facebook_ads_running || false,
            google_ads_running: phaseAResponse.google_ads_running || false,
            estimated_monthly_spend_aud: v3_intel_stub.fast_context.ads.estimated_monthly_spend_aud,
          },
        });

        // Attach the full V2 phaseAResponse as a nested payload for downstream consumers
        v3_intel_stub.intel.phaseA = phaseAResponse;
        v3_intel_stub.intel.deep = v3_intel_stub.intel.deep || { status: "processing" };
        v3_intel_stub.ts = new Date().toISOString();

        // ── Fix 3: Data Contract Alignment ─────────────────────────────────────
        // Flatten Master Normalizer (geminiFeatures) output from deep inside
        // marketing_intelligence to root of fast_context so the frontend can
        // read benefits, pain_points, target_audience directly.
        const mi = phaseAResponse.marketing_intelligence || {};
        const aiFeats = mi.aiExtractedFeatures || phaseAResponse.geminiFeatures || {};
        v3_intel_stub.fast_context.normalized_name = aiFeats.normalized_name || v3_intel_stub.fast_context.business.name || '';
        v3_intel_stub.fast_context.target_audience = aiFeats.ideal_customer_persona || '';
        v3_intel_stub.fast_context.business_description = aiFeats.business_description || '';
        v3_intel_stub.fast_context.benefits = aiFeats.benefits || [];
        v3_intel_stub.fast_context.pain_points = aiFeats.pain_points || [];
        v3_intel_stub.fast_context.usps = aiFeats.usps || [];
        v3_intel_stub.fast_context.services = aiFeats.services || [];
        v3_intel_stub.fast_context.pricing_info = aiFeats.pricing_info || '';
        v3_intel_stub.fast_context.confidence_score = aiFeats.confidence_score || 0;
        // Map services as critical_fixes fallback (frontend expects this key)
        v3_intel_stub.fast_context.critical_fixes = phaseAResponse.critical_fixes || aiFeats.services || [];
        // Preserve the full marketing_intelligence for downstream consumers
        v3_intel_stub.fast_context.marketing_intelligence = mi;
        // Also flatten to root of phaseAResponse stored in intel.phaseA
        if (aiFeats.normalized_name) v3_intel_stub.intel.phaseA.businessName = aiFeats.normalized_name;
        if (aiFeats.normalized_location) v3_intel_stub.intel.phaseA.location = aiFeats.normalized_location;
        // ── End Fix 3 ──────────────────────────────────────────────────────────

        // Recalculate bella_opener with real data
        const bizName = v3_intel_stub.fast_context.normalized_name || v3_intel_stub.fast_context.business.name;
        const h1Text = v3_intel_stub.fast_context.hero.h1 || v3_intel_stub.fast_context.hero.title;
        if (bizName && h1Text) {
          v3_intel_stub.intel.bella_opener = `Hi! I was just looking at your site for ${bizName}. I noticed your main message is: ${h1Text}`;
        }

        // ── V3 SAFETY NET: Write stub to KV immediately with "enriching" status ──
        // This ensures Bella can always find SOMETHING even if Phase B crashes.
        // Phase B will overwrite with full 110-point payload when complete.
        // Uses "enriching" status so consumers know full data is coming.
        const safetyNetPayload = JSON.parse(JSON.stringify(v3_intel_stub));
        safetyNetPayload.scrapeStatus = "enriching";
        safetyNetPayload.status = "enriching";
        safetyNetPayload.safetyNet = true;
        safetyNetPayload.safetyNetTs = new Date().toISOString();
        try {
          await env.LEADS_KV.put("lead:" + body._v3_leadId, JSON.stringify(safetyNetPayload), { expirationTtl: 2592e3 });
          await env.LEADS_KV.put(body._v3_leadId, JSON.stringify(safetyNetPayload), { expirationTtl: 2592e3 });
          console.log(`[V3 Safety Net] KV stub written for lid: ${body._v3_leadId} — Phase B will overwrite with full payload`);
        } catch (safetyErr) {
          console.error(`[V3 Safety Net] KV write FAILED for lid: ${body._v3_leadId}`, safetyErr);
        }

        // Return V3 envelope instead of raw phaseAResponse
        return new Response(JSON.stringify(v3_intel_stub), { status: 200, headers: corsHeaders });
      }
      return new Response(JSON.stringify(phaseAResponse), { status: 200, headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: e.message, stack: e.stack }), { status: 200, headers: corsHeaders });
    }
  }
};
export {
  worker_default as default
};
//# sourceMappingURL=worker.js.map

