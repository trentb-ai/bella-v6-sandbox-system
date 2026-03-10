/**
 * bella-tools-worker v5.0.0
 * V5 additions:
 *   - CONSULTANT service binding for Tier 2 /run_deep_analysis
 *   - /run_deep_analysis: calls Consultant /analyze, returns result + stall phrase
 * All endpoints rebuilt clean for V5.
 */

export interface Env {
  LEADS_KV: KVNamespace;
  CONSULTANT: Fetcher;    // V5: Tier 2 deep analysis
  BEARER_TOKEN: string;
}

const j = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), {
    status: s,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });

function auth(req: Request, env: Env): boolean {
  const tok = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  return tok === env.BEARER_TOKEN;
}

function toWords(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".0", "")} million`;
  if (n >= 1_000) return `${Math.round(n / 1_000)} thousand`;
  return String(Math.round(n));
}

async function getLeadData(lid: string, env: Env) {
  const [rawJson, intelJson, bellaJson, nameJson] = await Promise.all([
    env.LEADS_KV.get(`lead:${lid}`),
    env.LEADS_KV.get(`lead:${lid}:intel`),
    env.LEADS_KV.get(`lead:${lid}:bella:plan`),
    env.LEADS_KV.get(`lead:${lid}:name`),
  ]);
  if (!rawJson && !intelJson) return null;
  let raw: any = {}, intel: any = {}, bellaPlan: any = {}, nameData: any = {};
  try { if (rawJson) raw = JSON.parse(rawJson); } catch {}
  try { if (intelJson) intel = JSON.parse(intelJson); } catch {}
  try { if (bellaJson) bellaPlan = JSON.parse(bellaJson); } catch {}
  try { if (nameJson) nameData = JSON.parse(nameJson); } catch {}
  return {
    ...raw,
    first_name: nameData.first_name || raw.firstName || raw.first_name || "",
    bella_plan: bellaPlan,
    _intel: intel,
    _pipeline_status: intelJson ? "complete" : "raw_only",
  };
}

// ── /resolve_intel_hot ────────────────────────────────────────────────────────
async function handleResolveIntelHot(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const data = await getLeadData(lid, env);
  if (!data) return j({ success: false, reason: "no_data_for_lid", lid });

  const intel = data._intel ?? {};
  const flags = intel.flags ?? {};
  const fc = intel.fast_context ?? {};
  const deepTrack = intel.deep ?? {};
  const deepGMaps = deepTrack.googleMaps ?? {};
  const websiteHealth = intel.website_health ?? {};
  const industryBenchmark = intel.industry_benchmark ?? {};
  const topFix = intel.top_fix ?? {};
  const routing = intel.routing ?? {};
  const marketingIntel = data.marketing_intelligence ?? {};
  const consultIntel = data.consultative_intelligence ?? {};
  const prioritizedFixes = data.prioritized_fixes ?? {};
  const reputationIntel = marketingIntel.reputationIntelligence ?? {};
  const adIntel = marketingIntel.adIntelligence ?? {};

  const agentRanking: string[] =
    intel.agent_ranking?.length ? intel.agent_ranking :
    intel.recommended_agents?.length ? intel.recommended_agents :
    routing.top_agents?.length ? routing.top_agents : [];

  // Business name resolution
  let businessName = data.business_name ?? data.businessName ?? "";
  if (!businessName || businessName === "your business") {
    const ci = intel.core_identity ?? {};
    businessName = ci.business_name ?? "";
  }
  if (!businessName && data.url) {
    try {
      const host = new URL(data.url.startsWith("http") ? data.url : "https://" + data.url).hostname.replace(/^www\./, "");
      businessName = host.split(".")[0].charAt(0).toUpperCase() + host.split(".")[0].slice(1);
    } catch {}
  }

  // ROI reads
  const ROI_AGENTS = ["alex", "chris", "maddie", "sarah", "james"];
  const topAgents = agentRanking.slice(0, 5).length ? agentRanking.slice(0, 5) : ROI_AGENTS;
  const roiResults: Record<string, any> = {};
  let totalMonthlyROI = 0;
  await Promise.all(topAgents.map(async (agent) => {
    const confirmed = await env.LEADS_KV.get(`lead:${lid}:${agent}:roi_confirmed`);
    const estimate = confirmed ?? await env.LEADS_KV.get(`lead:${lid}:${agent}:roi_estimate`);
    if (estimate) {
      try {
        const roi = JSON.parse(estimate);
        roi._source = confirmed ? "confirmed" : "estimate";
        roiResults[agent] = roi;
        totalMonthlyROI += Number(roi.monthly_opportunity ?? 0);
      } catch {}
    }
  }));

  const acvStr = await env.LEADS_KV.get(`lead:${lid}:user_acv`);
  const acvConfirmed = acvStr ? Number(acvStr) : null;

  return j({
    success: true, lid,
    pipeline_status: data._pipeline_status,
    data_available: data._pipeline_status === "complete",
    first_name: data.first_name,
    business_name: businessName,
    industry: intel.core_identity?.industry ?? data.industry ?? "",
    location: intel.core_identity?.location ?? data.location ?? "",
    star_rating: websiteHealth.google_rating ?? deepGMaps.rating ?? null,
    review_count: websiteHealth.review_count ?? deepGMaps.review_count ?? null,
    is_running_ads: flags.is_running_ads ?? false,
    ad_funnel_verdict: flags.ad_funnel_verdict ?? "",
    total_monthly_opportunity: totalMonthlyROI || Number(topFix.monthly_revenue ?? 0),
    agent_ranking: agentRanking,
    top_agents: topAgents,
    industry_benchmark: industryBenchmark,
    flags,
    roi: roiResults,
    total_roi_monthly: totalMonthlyROI,
    acv_confirmed: acvConfirmed,
    bella_opener: intel.bella_opener ?? "",
    pitch_hook: intel.pitch_hook ?? "",
    close_strategies: intel.close_strategies ?? {},
    consultant: intel.consultant ?? {},
    google_maps_data: Object.keys(deepGMaps).length > 0 ? deepGMaps : null,
    review_highlights: (deepGMaps.reviews_sample ?? []).slice(0, 3),
  });
}

// ── KV helpers ────────────────────────────────────────────────────────────────
async function handleKvGetFact(req: Request, env: Env) {
  const { key } = await req.json() as any;
  if (!key) return j({ error: "key required" }, 400);
  const val = await env.LEADS_KV.get(key);
  if (!val) return j({ found: false, key });
  try { return j({ found: true, key, value: JSON.parse(val) }); }
  catch { return j({ found: true, key, value: val }); }
}

async function handleKvWrite(req: Request, env: Env) {
  const body: any = await req.json();
  if (!body.key) return j({ error: "key required" }, 400);
  if (body.value === undefined) return j({ error: "value required" }, 400);
  const opts: any = body.ttl > 0 ? { expirationTtl: Number(body.ttl) } : undefined;
  await env.LEADS_KV.put(body.key, JSON.stringify(body.value), opts);
  return j({ success: true, key: body.key });
}

async function handleKvSearch(req: Request, env: Env) {
  const body: any = await req.json();
  const prefix = String(body.prefix ?? "").trim();
  const limit = Math.min(Number(body.limit ?? 10), 50);
  if (!prefix) return j({ error: "prefix required" }, 400);
  const list = await env.LEADS_KV.list({ prefix, limit });
  if (!list.keys.length) return j({ found: false, prefix, keys: [] });
  const out: Record<string, any> = {};
  for (const k of list.keys) {
    const v = await env.LEADS_KV.get(k.name);
    try { out[k.name] = JSON.parse(v!); } catch { out[k.name] = v; }
  }
  return j({ found: true, prefix, keys: list.keys.map(k => k.name), values: out });
}

// ── Lead lifecycle ────────────────────────────────────────────────────────────
async function handleSaveLeadPatch(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const existing = await env.LEADS_KV.get(`lead:${lid}`);
  let data: any = {};
  try { if (existing) data = JSON.parse(existing); } catch {}
  await env.LEADS_KV.put(`lead:${lid}`, JSON.stringify({ ...data, ...body.patch, _updated: new Date().toISOString() }));
  return j({ success: true, lid, updated: Object.keys(body.patch ?? {}) });
}

async function handleLogEvent(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  const event = String(body.event ?? "").trim();
  if (!lid || !event) return j({ error: "lid and event required" }, 400);
  await env.LEADS_KV.put(`event:${lid}:${Date.now()}`,
    JSON.stringify({ event, data: body.data ?? {}, ts: new Date().toISOString() }),
    { expirationTtl: 604800 });
  return j({ success: true, lid, event });
}

async function handleHandoffAction(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  const action = String(body.action ?? "").trim();
  if (!lid || !action) return j({ error: "lid and action required" }, 400);
  await env.LEADS_KV.put(`handoff:${lid}`,
    JSON.stringify({ action, agent: body.agent ?? "", notes: body.notes ?? "", ts: new Date().toISOString() }),
    { expirationTtl: 86400 });
  return j({ success: true, lid, action });
}

async function handleWriteOutcome(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const outcome = {
    qualified: body.qualified === true,
    pain_confirmed: String(body.pain_confirmed ?? ""),
    ltv_estimate: String(body.ltv_estimate ?? ""),
    next_step: String(body.next_step ?? ""),
    booked: body.booked === true,
    notes: String(body.notes ?? ""),
    call_timestamp: new Date().toISOString(),
  };
  await env.LEADS_KV.put(`outcome:${lid}`, JSON.stringify(outcome), { expirationTtl: 2592000 });
  return j({ success: true, lid });
}

// ── ACV + ROI ─────────────────────────────────────────────────────────────────
async function handleCaptureAcv(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  const acvRaw = body.acv ?? body.value ?? body.ltv ?? body.customer_value;
  if (!lid) return j({ error: "lid required" }, 400);
  if (acvRaw == null) return j({ error: "acv required" }, 400);
  const acv = parseFloat(String(acvRaw).replace(/[^0-9.]/g, ""));
  if (isNaN(acv) || acv <= 0) return j({ error: "acv must be a positive number (AUD)" }, 400);
  const bizName = String(body.business_name ?? "your business");
  await env.LEADS_KV.put(`lead:${lid}:user_acv`, String(acv));
  return j({
    success: true, lid, acv, currency: "AUD",
    message: `ACV $${acv.toLocaleString()} captured`,
    bella_bridge: `Perfect — got your average customer value at ${toWords(acv)} dollars. Let me crunch the exact numbers for ${bizName}.`,
  });
}

async function handleGetRoiConfirmed(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);

  let agentRanking: string[] = [];
  let businessName = "";
  try {
    const intelStr = await env.LEADS_KV.get(`lead:${lid}:intel`);
    if (intelStr) {
      const intel = JSON.parse(intelStr);
      agentRanking = intel.agent_ranking ?? intel.recommended_agents ?? intel.routing?.top_agents ?? [];
      businessName = intel.core_identity?.business_name ?? "";
    }
  } catch {}

  if (!agentRanking.length) agentRanking = ["alex", "chris", "maddie", "sarah", "james"];

  const acvStr = await env.LEADS_KV.get(`lead:${lid}:user_acv`);
  const acvValue = acvStr ? Number(acvStr) : null;

  const topAgents = agentRanking.slice(0, 5);
  const results: Record<string, any> = {};
  let totalMonthly = 0;
  await Promise.all(topAgents.map(async (agent) => {
    const confirmed = await env.LEADS_KV.get(`lead:${lid}:${agent}:roi_confirmed`);
    const raw = confirmed ?? await env.LEADS_KV.get(`lead:${lid}:${agent}:roi_estimate`);
    if (raw) {
      try {
        const roi = JSON.parse(raw);
        roi._source = confirmed ? "confirmed" : "estimate";
        results[agent] = roi;
        totalMonthly += Number(roi.monthly_opportunity ?? 0);
      } catch {}
    }
  }));

  const summaryLines = Object.entries(results)
    .filter(([_, r]) => r.monthly_opportunity > 0)
    .map(([agent, r]) => `${agent} — ${toWords(r.monthly_opportunity)} dollars a month`);

  const combinedSpoken = totalMonthly > 0
    ? `Total combined opportunity: ${toWords(totalMonthly)} dollars a month`
    : "ROI still calculating — use benchmark estimates";

  return j({
    success: true, lid, business_name: businessName,
    acv_confirmed: acvValue, currency: "AUD",
    top_agents: topAgents, roi: results,
    total_monthly_opportunity: totalMonthly,
    spoken_summary: summaryLines,
    combined_spoken: combinedSpoken,
    voice_ready: `Here are the numbers for ${businessName || "your business"}. ${summaryLines.join(". ")}. ${combinedSpoken}.`,
  });
}

// ── Conversation memory ───────────────────────────────────────────────────────
const KEY_MAP: Record<string, string> = {
  acv: "user_acv", customer_value: "user_acv", ltv: "user_acv",
  website_leads: "user_website_leads", leads_per_week: "user_website_leads",
  ad_leads: "user_ad_leads", phone_leads: "user_phone_leads", phone_bookings: "user_phone_leads",
  reviews: "user_reviews", google_reviews: "user_reviews",
  old_crm: "user_old_crm", crm_size: "user_old_crm",
  followup_rate: "user_followup_rate", follow_up_rate: "user_followup_rate",
};

async function handleSaveConversationData(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const data = body.data ?? {};
  if (!Object.keys(data).length) return j({ error: "data required" }, 400);
  const savedKeys: string[] = [];
  for (const [field, val] of Object.entries(data)) {
    const schemaKey = KEY_MAP[field];
    if (schemaKey) {
      await env.LEADS_KV.put(`lead:${lid}:${schemaKey}`, String(val));
      savedKeys.push(`lead:${lid}:${schemaKey}`);
    }
  }
  return j({ success: true, lid, saved: savedKeys });
}

async function handleGetConversationMemory(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  if (!lid) return j({ error: "lid required" }, 400);
  const [acvS, webS, adS, phoneS, reviewsS, crmS, followupS] = await Promise.all([
    env.LEADS_KV.get(`lead:${lid}:user_acv`),
    env.LEADS_KV.get(`lead:${lid}:user_website_leads`),
    env.LEADS_KV.get(`lead:${lid}:user_ad_leads`),
    env.LEADS_KV.get(`lead:${lid}:user_phone_leads`),
    env.LEADS_KV.get(`lead:${lid}:user_reviews`),
    env.LEADS_KV.get(`lead:${lid}:user_old_crm`),
    env.LEADS_KV.get(`lead:${lid}:user_followup_rate`),
  ]);
  const acv = acvS ? Number(acvS) : null;
  const memory: Record<string, number | null> = {
    user_acv: acv,
    user_website_leads: webS ? Number(webS) : null,
    user_ad_leads: adS ? Number(adS) : null,
    user_phone_leads: phoneS ? Number(phoneS) : null,
    user_reviews: reviewsS ? Number(reviewsS) : null,
    user_old_crm: crmS ? Number(crmS) : null,
    user_followup_rate: followupS ? Number(followupS) : null,
  };
  const known = Object.entries(memory).filter(([, v]) => v !== null).map(([k]) => k);
  return j({
    success: true, lid, memory, acv_captured: acv,
    fields_available: known,
    summary: known.length > 0
      ? `User has shared: ${known.join(", ")}.${acv ? ` ACV confirmed at $${acv}.` : ""}`
      : "No conversation data saved yet.",
  });
}

// ── V5 NEW: /run_deep_analysis — Tier 2 Consultant call ──────────────────────
// Called by Gemini (via bridge) when prospect asks something beyond cached intel.
// Calls Consultant /analyze via service binding (~8s), returns result + stall phrase.
async function handleRunDeepAnalysis(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  const question = String(body.question ?? "").trim(); // What prospect asked
  const focus = String(body.focus ?? "general").trim(); // e.g. "website", "ads", "reputation", "roi"
  if (!lid) return j({ error: "lid required" }, 400);

  // Pull current cached data to give Consultant context
  const [rawStr, intelStr, memoryStr] = await Promise.all([
    env.LEADS_KV.get(`lead:${lid}`),
    env.LEADS_KV.get(`lead:${lid}:intel`),
    env.LEADS_KV.get(`lead:${lid}:memory`),
  ]);

  let raw: any = {}, intel: any = {}, memory: any = {};
  try { if (rawStr) raw = JSON.parse(rawStr); } catch {}
  try { if (intelStr) intel = JSON.parse(intelStr); } catch {}
  try { if (memoryStr) memory = JSON.parse(memoryStr); } catch {}

  const websiteUrl = raw.websiteUrl ?? raw.url ?? intel.core_identity?.website ?? "";
  const businessName = intel.core_identity?.business_name ?? raw.businessName ?? raw.business_name ?? "";

  // Stall phrase Bella speaks immediately while we wait for Consultant (~8s)
  const stallPhrases: Record<string, string> = {
    website:    `Great question — give me two seconds while I pull a deeper look at their website.`,
    ads:        `Good one — let me dig into their ad ecosystem right now.`,
    reputation: `On it — pulling their full reputation profile.`,
    roi:        `Let me run the exact numbers on that for you, two seconds.`,
    general:    `Great question — give me two seconds while I pull that up.`,
  };
  const stallPhrase = stallPhrases[focus] ?? stallPhrases.general;

  // Call Consultant /analyze via service binding
  let consultantResult: any = null;
  let consultantError: string | null = null;
  try {
    const consultReq = new Request("https://consultant-internal/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lid,
        websiteUrl,
        businessName,
        question,
        focus,
        cached_intel: intel,
        conversation_memory: memory,
      }),
    });
    const res = await env.CONSULTANT.fetch(consultReq);
    if (res.ok) {
      consultantResult = await res.json();
    } else {
      consultantError = `Consultant returned HTTP ${res.status}`;
    }
  } catch (e) {
    consultantError = String(e);
  }

  if (consultantError || !consultantResult) {
    // Graceful fallback — return cached intel rather than failing the call
    return j({
      success: false,
      lid,
      stall_phrase: stallPhrase,
      error: consultantError ?? "No result from Consultant",
      fallback: "Use cached intel from /resolve_intel_hot — Consultant is temporarily unavailable.",
      cached_intel_available: !!intelStr,
    });
  }

  // Cache the fresh analysis back to KV so subsequent calls are instant
  const freshIntel = consultantResult.intel ?? consultantResult;
  if (freshIntel && typeof freshIntel === "object") {
    const merged = { ...intel, ...freshIntel, _deep_analysis_ts: new Date().toISOString() };
    await env.LEADS_KV.put(`lead:${lid}:intel`, JSON.stringify(merged));
  }

  return j({
    success: true,
    lid,
    stall_phrase: stallPhrase,
    analysis: consultantResult,
    business_name: businessName,
    website_url: websiteUrl,
    _cached_to_kv: true,
  });
}

// ── /fetch_script_stage — backtrack safety stub ───────────────────────────────
async function handleFetchScriptStage(req: Request, env: Env) {
  const body: any = await req.json();
  const lid = String(body.lid ?? "").trim();
  const stage = String(body.stage ?? "").trim().toLowerCase();
  if (!lid) return j({ error: "lid required" }, 400);
  if (!stage) return j({ error: "stage required" }, 400);

  const stagesJson = await env.LEADS_KV.get(`lead:${lid}:script_stages`);
  if (!stagesJson) return j({ found: false, stage, instructions: null, message: "No script stages loaded." });

  let stages: any = {};
  try { stages = JSON.parse(stagesJson); } catch { return j({ error: "script_stages corrupted" }, 500); }

  const stageData = stages[stage] ?? null;
  if (!stageData) return j({ found: false, stage, available_stages: Object.keys(stages), instructions: null });

  const text = typeof stageData === "string" ? stageData : stageData.text ?? JSON.stringify(stageData);
  const fallbacks = Array.isArray(stageData?.fallbacks) ? stageData.fallbacks : [];

  // Simple variable injection from intel
  const intelStr = await env.LEADS_KV.get(`lead:${lid}:intel`);
  const intel: any = intelStr ? JSON.parse(intelStr) : {};
  const ci = intel.core_identity ?? {};
  const vars: Record<string, string> = {
    business_name: ci.business_name ?? "",
    industry: ci.industry ?? "",
    location: ci.location ?? "",
    star_rating: String(intel.website_health?.google_rating ?? ""),
  };
  const inject = (s: string) => s.replace(/\{\{([^}]+)\}\}/g, (m, k) => vars[k.trim()] ?? m);

  return j({ found: true, stage, instructions: inject(text), fallbacks: fallbacks.map(inject) });
}

// ── Main router ───────────────────────────────────────────────────────────────
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      }});
    }

    const url = new URL(req.url);
    const path = url.pathname;

    // Snapshot debug endpoint (no auth)
    const snapMatch = path.match(/^\/snapshot\/([a-z0-9_-]+)$/i);
    if (snapMatch) {
      const lid = snapMatch[1];
      const [intel, memory] = await Promise.all([
        env.LEADS_KV.get(`lead:${lid}:intel`, { type: "json" }),
        env.LEADS_KV.get(`lead:${lid}:memory`, { type: "json" }),
      ]);
      return new Response(JSON.stringify({ lid, intel, memory, status: "ok", ts: new Date().toISOString() }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }

    if (path === "/health") {
      return j({ status: "ok", worker: "bella-tools-worker-v6", version: "6.0.0", endpoints: [
        "/resolve_intel_hot", "/kv_get_fact", "/kv_write", "/kv_search",
        "/save_lead_patch", "/log_event", "/handoff_action", "/write_outcome",
        "/capture_acv", "/get_roi_confirmed",
        "/save_conversation_data", "/get_conversation_memory",
        "/run_deep_analysis",  // V5 NEW
        "/fetch_script_stage",
      ]});
    }

    if (req.method !== "POST") return j({ error: "POST required" }, 405);
    if (!auth(req, env)) return j({ error: "Unauthorized" }, 401);

    switch (path) {
      case "/resolve_intel_hot":      return handleResolveIntelHot(req, env);
      case "/kv_get_fact":            return handleKvGetFact(req, env);
      case "/kv_write":               return handleKvWrite(req, env);
      case "/kv_search":              return handleKvSearch(req, env);
      case "/save_lead_patch":        return handleSaveLeadPatch(req, env);
      case "/log_event":              return handleLogEvent(req, env);
      case "/handoff_action":         return handleHandoffAction(req, env);
      case "/write_outcome":          return handleWriteOutcome(req, env);
      case "/capture_acv":            return handleCaptureAcv(req, env);
      case "/get_roi_confirmed":      return handleGetRoiConfirmed(req, env);
      case "/save_conversation_data": return handleSaveConversationData(req, env);
      case "/get_conversation_memory":return handleGetConversationMemory(req, env);
      case "/run_deep_analysis":      return handleRunDeepAnalysis(req, env);  // V5 NEW
      case "/fetch_script_stage":     return handleFetchScriptStage(req, env);
      default:                        return j({ error: "Not found" }, 404);
    }
  },
};
