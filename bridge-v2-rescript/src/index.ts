/**
 * deepgram-bridge-v9 — RICH ORCHESTRATOR v9.3.0
 *
 * FIXES IN THIS VERSION:
 *   1. Extraction is now AWAITED (fixes race condition — inputs were never reliably saved)
 *   2. Rich full prompt replaces 150-token straitjacket (Gemini gets everything)
 *   3. History distillation (compresses old turns → conv_memory, keeps last 6 raw)
 *
 * ARCHITECTURE:
 *   Bridge = brain. Gemini = voice.
 *   Every turn:
 *     1. Load intel + state from KV
 *     2. AWAIT extraction from last utterance → apply to state → save
 *     3. Advance stage if gate opens
 *     4. Distil history older than 6 turns → save to lead:{lid}:conv_memory
 *     5. Build RICH full prompt (full persona + full intel + full script + YOU ARE HERE)
 *     6. Stream Gemini response → Deepgram → TTS → browser
 */

import { runScribe } from './scribe';

export interface Env {
  LEADS_KV: KVNamespace;
  TOOLS: Fetcher;
  CALL_BRAIN: Fetcher;
  AI: Ai;                          // Workers AI binding (replaced Gemini)
  GEMINI_API_KEY?: string;         // DEPRECATED — switched to Workers AI
  TOOLS_BEARER: string;
  ENABLE_EMBEDDING?: string;
  USE_DO_BRAIN?: string;
}

const VERSION = "v6.32.5"; // DIAGNOSTIC: log raw Workers AI response shape — 2026-04-09

// ─── Deep Merge Utility ──────────────────────────────────────────────────────
// Merges source into target, recursively for nested objects.
// Arrays and primitives from source overwrite target.
function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return source ?? target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) return source;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    const srcVal = source[key];
    const tgtVal = result[key];
    if (srcVal !== null && srcVal !== undefined) {
      if (
        srcVal && typeof srcVal === 'object' && !Array.isArray(srcVal) &&
        tgtVal && typeof tgtVal === 'object' && !Array.isArray(tgtVal)
      ) {
        result[key] = deepMerge(tgtVal, srcVal);
      } else {
        result[key] = srcVal;
      }
    }
  }
  return result;
}

// ─── Chunk C: Vector Retrieval for WOW stall 1-2 ─────────────────────────────
// Gated by ENABLE_EMBEDDING. Reads pre-embedded fast_vector from KV, embeds a
// query string, computes cosine similarity, returns the original fast-intel text
// as a "retrieved snippet" for authoritative citation in the WOW opening.
// Falls back gracefully — never throws, returns null on any failure.

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── Chunk C+: Stage-specific retrieval queries for vector search ─────────────
const stageQueryMap: Record<string, string> = {
  wow:              "hero message unique value proposition tagline ICP",
  deep_dive:        "ad campaign offer CTA hiring role review theme",
  anchor_acv:       "revenue business size transaction value pricing",
  ch_ads:           "Facebook Google ad creative offer CTA campaign landing",
  ch_phone:         "missed calls phone volume after hours call handling",
  ch_website:       "booking form conversion lead capture chat widget",
  ch_old_leads:     "database reactivation dormant leads CRM follow-up",
  ch_reviews:       "Google rating review count reputation star rating",
  anchor_timeframe: "lead flow weekly monthly frequency cadence",
  roi_delivery:     "revenue opportunity ROI total value agent team",
  close:            "trial onboarding free week team deployment",
};

async function retrieveFromVector(
  lid: string,
  query: string,
  env: Env,
  log: (tag: string, msg: string) => void
): Promise<string | null> {
  if (!env.ENABLE_EMBEDDING || env.ENABLE_EMBEDDING !== "true") return null;

  try {
    // 1. Read all available vectors from KV in parallel
    const [fastVecRaw, deepVecRaw, fastIntelRaw] = await Promise.all([
      env.LEADS_KV.get(`lead:${lid}:fast_vector`),
      env.LEADS_KV.get(`lead:${lid}:deep_vector`),
      env.LEADS_KV.get(`lead:${lid}:fast-intel`),
    ]);

    // Parse stored vectors — collect all candidates
    const candidates: { vec: number[]; source: string }[] = [];

    if (fastVecRaw) {
      try {
        const fd = JSON.parse(fastVecRaw);
        if (fd?.v && Array.isArray(fd.v) && fd.v.length > 0) {
          candidates.push({ vec: fd.v, source: "fast" });
        }
      } catch { /* malformed — skip */ }
    }
    if (deepVecRaw) {
      try {
        const dd = JSON.parse(deepVecRaw);
        // deep_vector stores { v: [vec1, vec2, ...] } — array of chunk vectors
        const vecs = dd?.v;
        if (Array.isArray(vecs) && vecs.length > 0) {
          // If nested array of vectors, add each; if flat single vector, add one
          if (Array.isArray(vecs[0])) {
            vecs.forEach((v: number[], idx: number) => candidates.push({ vec: v, source: `deep_${idx}` }));
          } else {
            candidates.push({ vec: vecs, source: "deep_0" });
          }
        }
      } catch { /* malformed — skip */ }
    }

    if (candidates.length === 0) {
      log("VEC_RETRIEVE", `lid=${lid} no vectors in KV`);
      return null;
    }

    // 2. Embed the stage-specific query using Gemini text-embedding-004
    const embRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${env.GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "models/text-embedding-004",
          content: { parts: [{ text: query }] },
          taskType: "RETRIEVAL_QUERY"
        })
      }
    );

    if (!embRes.ok) {
      log("VEC_RETRIEVE", `lid=${lid} embed query failed status=${embRes.status}`);
      return null;
    }

    const embData: any = await embRes.json();
    const queryVec: number[] = embData?.embedding?.values;
    if (!queryVec || queryVec.length === 0) {
      log("VEC_RETRIEVE", `lid=${lid} no query vector returned`);
      return null;
    }

    // 3. Cosine similarity — pick best match across all candidate vectors
    let bestSim = 0;
    let bestSource = "";
    for (const c of candidates) {
      if (c.vec.length !== queryVec.length) continue;
      const sim = cosineSimilarity(c.vec, queryVec);
      if (sim > bestSim) {
        bestSim = sim;
        bestSource = c.source;
      }
    }

    log("VEC_RETRIEVE", `lid=${lid} best_sim=${bestSim.toFixed(4)} source=${bestSource} candidates=${candidates.length}`);

    // Only use if similarity is meaningful (>0.3 threshold)
    if (bestSim < 0.3) {
      log("VEC_RETRIEVE", `lid=${lid} similarity too low (${bestSim.toFixed(4)}), skipping`);
      return null;
    }

    // 4. Extract the best text snippet from the winning source
    if (bestSource.startsWith("deep")) {
      // Deep intel — read deep_flags for the raw text
      const deepRaw = await env.LEADS_KV.get(`lead:${lid}:deep_flags`);
      if (deepRaw) {
        const snippet = deepRaw.slice(0, 500);
        log("VEC_RETRIEVE", `lid=${lid} deep_snippet_len=${snippet.length} sim=${bestSim.toFixed(4)}`);
        return snippet;
      }
    }

    // Fast intel — extract structured snippet
    if (!fastIntelRaw) {
      log("VEC_RETRIEVE", `lid=${lid} no fast-intel text for snippet`);
      return null;
    }

    try {
      const fastIntel = JSON.parse(fastIntelRaw);
      const snippet = fastIntel.consultant?.scriptFills?.website_positive_comment
        || fastIntel.bella_opener
        || fastIntel.consultant?.copyAnalysis?.bellaLine
        || fastIntelRaw.slice(0, 500);
      log("VEC_RETRIEVE", `lid=${lid} fast_snippet_len=${String(snippet).length} sim=${bestSim.toFixed(4)}`);
      return typeof snippet === "string" ? snippet : JSON.stringify(snippet).slice(0, 500);
    } catch {
      return fastIntelRaw.slice(0, 500);
    }

  } catch (e: any) {
    log("VEC_RETRIEVE", `lid=${lid} error=${e.message || "unknown"}`);
    return null;
  }
}

// ─── Merge Intel from Multiple KV Keys ───────────────────────────────────────
// SCHEMA v4: Each writer has their own key, bridge merges with priority:
//   fast-intel > old-intel > deep-intel > stub
// NOTE: Also reads old `lead:{lid}:intel` for backwards compat with sandbox workers
// NOTE: Reads both :deepIntel (old Apify pipeline) AND :deep_flags (workflow pipeline)
async function loadMergedIntel(lid: string, env: Env): Promise<Record<string, any>> {
  const [stubRaw, fastRaw, deepRaw, deepFlagsRaw, oldIntelRaw, deepScriptFillsRaw, deepStatusV2Raw] = await Promise.all([
    env.LEADS_KV.get(`lead:${lid}:stub`),             // big-scraper fallback (v8)
    env.LEADS_KV.get(`lead:${lid}:fast-intel`),       // fast-intel enriched data (v8)
    env.LEADS_KV.get(`lead:${lid}:deepIntel`),        // deep-scrape Apify data (old pipeline)
    env.LEADS_KV.get(`lead:${lid}:deep_flags`),       // workflow Apify data (bella-scrape-workflow)
    env.LEADS_KV.get(`lead:${lid}:intel`),            // OLD: backwards compat with sandbox workers
    env.LEADS_KV.get(`lead:${lid}:deep_scriptFills`), // AI-generated persona/insight fills (bella-scrape-workflow)
    Promise.race([
      env.LEADS_KV.get(`lead:${lid}:deep-status:v2`, 'json'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000))
    ]).catch(() => null), // v2 deep-scrape completion status (2s timeout to prevent hang)
  ]);

  let stub: Record<string, any> = {};
  let fast: Record<string, any> = {};
  let deep: Record<string, any> = {};
  let deepFlags: Record<string, any> = {};
  let oldIntel: Record<string, any> = {};
  let deepScriptFills: Record<string, any> | null = null;
  let deepStatusV2: Record<string, any> = {};

  try { if (stubRaw) stub = JSON.parse(stubRaw); } catch {}
  try { if (fastRaw) fast = JSON.parse(fastRaw); } catch {}
  try { if (deepRaw) deep = JSON.parse(deepRaw); } catch {}
  try { if (deepFlagsRaw) deepFlags = JSON.parse(deepFlagsRaw); } catch {}
  try { if (oldIntelRaw) oldIntel = JSON.parse(oldIntelRaw); } catch {}
  try { if (deepScriptFillsRaw) deepScriptFills = JSON.parse(deepScriptFillsRaw); } catch {}
  try { if (deepStatusV2Raw) deepStatusV2 = typeof deepStatusV2Raw === 'string' ? JSON.parse(deepStatusV2Raw) : deepStatusV2Raw; } catch {}

  // Strip fast-intel placeholder deep field — it must not overwrite real deep data
  if (fast.deep && Object.keys(fast.deep).length === 1 && fast.deep.status === "processing") {
    delete fast.deep;
  }

  // Merge with priority: stub (lowest) → deep → deepFlags → oldIntel → fast (highest)
  let intel = deepMerge({}, stub);
  intel = deepMerge(intel, deep);
  intel = deepMerge(intel, deepFlags);   // Workflow deep data
  intel = deepMerge(intel, oldIntel);    // Backwards compat: old :intel key
  intel = deepMerge(intel, fast);        // V8 fast-intel takes priority

  log("KV_LOAD", `lid=${lid} merged_consultant=${intel.consultant ? Object.keys(intel.consultant).length : 0} root_script_fills=${intel.script_fills ? Object.keys(intel.script_fills).length : 0}`);

  // Inject deep-scrape data at intel.deep if present (from either pipeline)
  // Workflow writes snake_case (google_maps, fb_ads_count, indeed_count)
  // Bridge expects camelCase (googleMaps { rating, review_count, recent_reviews }, hiring { is_hiring })
  if (deepFlags.google_rating !== undefined || deepFlags.google_maps || deepFlags.linkedin || deepFlags.indeed_count || deepFlags.google_search_count || deepFlags.google_ads_transparency_count) {
    // P1 FIX: Preserve existing Places rating/reviews — deep_flags null/0 must NOT overwrite valid data
    const existingRating = intel.deep?.googleMaps?.rating ?? fast?.places?.rating ?? fast?.star_rating ?? null;
    const existingReviews = intel.deep?.googleMaps?.review_count ?? fast?.places?.review_count ?? 0;
    intel.deep = {
      status: "done",
      googleMaps: {
        rating: (deepFlags.google_rating != null && deepFlags.google_rating > 0) ? deepFlags.google_rating : existingRating,
        review_count: (deepFlags.review_count != null && deepFlags.review_count > 0) ? deepFlags.review_count : existingReviews,
        address: deepFlags.address ?? "",
        categories: deepFlags.categories ?? [],
        reviews_sample: deepFlags.reviews_sample ?? [],
        opening_hours: deepFlags.opening_hours ?? null,
        phone: deepFlags.phone ?? null,
        listed_website: deepFlags.listed_website ?? null,
        photos_count: deepFlags.photos_count ?? 0,
      },
      ads: {
        fb_ads_count: deepFlags.fb_ads_count ?? 0,
        fb_ads_sample: deepFlags.fb_ads_sample ?? [],
        google_search_count: deepFlags.google_search_count ?? 0,
        google_search_results: deepFlags.google_search_results ?? [],
        google_ads_count: deepFlags.google_ads_transparency_count ?? 0,
        is_running_google_ads: deepFlags.is_running_google_ads ?? false,
        google_ads_sample: deepFlags.google_ads_sample ?? [],
      },
      hiring: {
        is_hiring: (deepFlags.indeed_count ?? 0) > 0 || (deepFlags.seek_count ?? 0) > 0,
        indeed_count: deepFlags.indeed_count ?? 0,
        jobs_sample: deepFlags.jobs_sample ?? [],
        seek_count: deepFlags.seek_count ?? 0,
        seek_sample: deepFlags.seek_sample ?? [],
        hiring_agent_matches: deepFlags.hiring_agent_matches ?? [],
        top_hiring_wedge: deepFlags.top_hiring_wedge ?? null,
      },
      linkedin: deepFlags.linkedin ?? {},
      ad_landing_pages: deepFlags.ad_landing_pages ?? [],
    };
  } else if (deep.googleMaps || deep.linkedin || deep.hiring) {
    intel.deep = { status: "done", ...deep };
  }

  // Inject deep_scriptFills into intel.deep so the DO supplement path can forward it.
  // This is a separate KV key from deep_flags (written by bella-scrape-workflow AI enrichment).
  if (deepScriptFills) {
    if (!intel.deep) intel.deep = { status: "done" };
    intel.deep.deep_scriptFills = deepScriptFills;
    log("SCRIPTFILLS_INJECT", `lid=${lid} deepInsights=${deepScriptFills.deepInsights?.length ?? 0} heroReview=${!!(deepScriptFills.heroReview?.available)}`);
  }

  // Merge deep-status:v2 if complete (v2-rescript pipeline writes separate status key)
  if (deepStatusV2?.status === "done") {
    if (!intel.deep) intel.deep = { status: "done" };
    intel.deep.status = "done";
    log("DEEP_STATUS_V2", `lid=${lid} status=done merged`);
  }

  const sources = [
    stubRaw ? 'stub' : null,
    oldIntelRaw ? 'old-intel' : null,
    fastRaw ? 'fast-intel' : null,
    deepRaw ? 'deep-intel' : null,
    deepFlagsRaw ? 'deep-flags' : null,
    deepScriptFillsRaw ? 'deep-scriptFills' : null,
  ].filter(Boolean);

  const fiSource = intel.fast_intel?.source ?? "none";
  log("KV_MERGE", `lid=${lid} sources=[${sources.join(',')}] merged_keys=${Object.keys(intel).length} fi_source=${fiSource}`);
  if (fiSource === "stub") {
    log("STUB_MODE", `lid=${lid} — website not scrapeable, stub-aware prompting active`);
  }

  return intel;
}

// ─── SUPERGOD: Load Single call_brief Key ─────────────────────────────────────
// V8 unified schema: bella-scrape-workflow-v9 writes a single call_brief
// Returns null if key doesn't exist (fall back to loadMergedIntel)
async function loadCallBrief(lid: string, env: Env): Promise<Record<string, any> | null> {
  const raw = await env.LEADS_KV.get(`lead:${lid}:call_brief`);
  if (!raw) return null;
  try {
    const brief = JSON.parse(raw);
    log("CALL_BRIEF", `lid=${lid} status=${brief.status ?? 'unknown'} keys=${Object.keys(brief).length}`);
    return brief;
  } catch (e) {
    log("CALL_BRIEF", `lid=${lid} PARSE_ERROR: ${e}`);
    return null;
  }
}

// GEMINI_URL deprecated — switched to Workers AI (Llama 3.1 8B)
const MODEL = "@cf/qwen/qwen3-30b-a3b-fp8"; // Workers AI model

const log = (tag: string, msg: string) =>
  console.log(`[bridge ${VERSION}] [${tag}] ${msg}`);

// ─── Types ────────────────────────────────────────────────────────────────────

interface Msg {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
  name?: string;
}
interface ToolCall {
  id: string; type: "function";
  function: { name: string; arguments: string };
}

type Stage =
  | "wow" | "deep_dive" | "anchor_acv" | "anchor_timeframe"
  | "ch_ads" | "ch_website" | "ch_phone" | "ch_old_leads" | "ch_reviews"
  | "roi_delivery" | "close";

type ChannelStageKey =
  | "ch_ads" | "ch_website" | "ch_phone" | "ch_old_leads" | "ch_reviews";

interface Inputs {
  acv: number | null;
  timeframe: "weekly" | "monthly" | null;
  ads_leads: number | null;
  ads_conversions: number | null;
  ads_followup: string | null;
  ad_spend: number | null;
  web_leads: number | null;
  web_conversions: number | null;
  web_followup_speed: string | null;
  phone_volume: number | null;
  phone_conversion: number | null;
  after_hours: string | null;
  missed_calls: number | null;
  missed_call_callback_speed: string | null;
  old_leads: number | null;
  star_rating: number | null;
  review_count: number | null;
  has_review_system: boolean | null;
  new_cust_per_period: number | null;
}

interface State {
  stage: Stage;
  queue: Stage[];
  done: Stage[];
  inputs: Inputs;
  maddie_skip: boolean;
  wants_numbers: boolean;
  apify_done: boolean;   // true once intel.deep.status==="done" lands in KV
  calc_ready: boolean;
  stall: number;
  init: string;
  _lastTurn: number;     // guards stall — only increment on new user turn, not DG interim transcripts
  _lastUttHash: string;  // content dedup — prevents stall inflation from DG re-sending same utterance
  // T007: Just Demo branch — prospect says "just show me"
  just_demo: boolean;        // true = skip remaining channel stages, go to roi_delivery
  trial_reviews_done: boolean; // true if review-linked free trial was delivered (prevents repeat at stall 5)
  user_disagreed: boolean;   // true if prospect contradicted something Bella said (gate blocker)

  // === SPRINT 0 EXTENSIONS — wired in Sprint 1A/1B/2 ===
  // unifiedState?: UnifiedLeadState;
  // rejectedWowSteps?: string[];
  // lastWowSentiment?: 'positive' | 'negative' | 'neutral' | null;
  // questionCache?: QuestionCacheEntry[];
  // deepIntelReady?: boolean;
  // deepIntelTs?: number | null;
  // NOTE: These are commented out until Sprint 1A wires them in initialState()
}

// ─── BLANK INPUTS ─────────────────────────────────────────────────────────────

const BLANK: Inputs = {
  acv: null, timeframe: null,
  ads_leads: null, ads_conversions: null, ads_followup: null, ad_spend: null,
  web_leads: null, web_conversions: null, web_followup_speed: null,
  phone_volume: null, phone_conversion: null, after_hours: null, missed_calls: null, missed_call_callback_speed: null,
  old_leads: null,
  star_rating: null, review_count: null, has_review_system: null, new_cust_per_period: null,
};

// ─── CHANNEL QUEUE: Branching eligibility + consultant swap ──────────────────

const AGENT_TO_CHANNEL: Record<string, ChannelStageKey> = {
  alex: "ch_ads", chris: "ch_website", maddie: "ch_phone",
  sarah: "ch_old_leads", james: "ch_reviews",
};
interface QueueResult {
  queue: Stage[];
  tease: ChannelStageKey | null;
}

function buildQueue(flags: Record<string, any>, intel: Record<string, any>): QueueResult {
  const deep = (intel as any).intel?.deep ?? intel.deep ?? {};
  const ts = intel.tech_stack ?? {};
  const routing = intel.consultant?.routing ?? {};
  const cea = intel.consultant?.conversionEventAnalysis ?? {};

  // ── Signal detection ──
  const adsOrInbound = !!(flags.is_running_ads || flags.has_fb_pixel || flags.has_google_ads
    || deep.ads?.is_running_google_ads
    || (deep.ads?.google_ads_count ?? 0) > 0 || (deep.ads?.fb_ads_count ?? 0) > 0
    || ts.is_running_ads || intel.google_ads_running || intel.facebook_ads_running
    || (ts.social_channels?.length > 0) || ts.has_email_marketing);

  const ctaType: string = cea.ctaType ?? "";
  const phoneDominantCta = ctaType === "call" || ctaType === "phone"
    || /\bcall\b/i.test(cea.primaryCTA ?? "");

  let queue: Stage[];
  let tease: ChannelStageKey | null;
  let scenario: string;

  if (adsOrInbound) {
    // Scenario 1: Ads / inbound funnel detected — Chris first-contact on landing pages, Alex speed-to-lead follow-up
    queue = ["ch_website", "ch_ads"];
    tease = "ch_phone"; // Maddie tease by default
    scenario = "ads_or_inbound";
  } else {
    // Scenario 2: No ads / no visible inbound funnel — Chris always first
    queue = ["ch_website"];
    if (phoneDominantCta) {
      queue.push("ch_phone");  // Maddie second (phone-dominant CTA)
      tease = "ch_ads";        // Alex tease (follow up whatever comes in)
      scenario = "no_ads+phone_cta";
    } else {
      queue.push("ch_ads");    // Alex second (follow up form/booking submissions)
      tease = "ch_phone";      // Maddie tease
      scenario = "no_ads+form_cta";
    }
  }

  // ── Consultant swap: if top priority agent maps to slot 2, swap slots 1 & 2 ──
  const topAgent = (routing.priority_agents?.[0] ?? "").toLowerCase();
  const topChannel = AGENT_TO_CHANNEL[topAgent];
  if (topChannel && queue.length >= 2 && topChannel === queue[1]) {
    const tmp = queue[0]; queue[0] = queue[1]; queue[1] = tmp;
    scenario += "+consultant_swap";
  }

  log("QUEUE_V2", `scenario=${scenario} queue=[${queue.join(',')}] tease=${tease ?? 'none'} ads=${adsOrInbound} ctaType=${ctaType || 'none'} topAgent=${topAgent || 'none'}`);

  return { queue, tease };
}

// ─── REBUILD FUTURE QUEUE ON LATE DATA ───────────────────────────────────────
function rebuildFutureQueueOnLateLoad(s: State, flags: Record<string, any>, intel: Record<string, any>): State {
  // Don't rebuild if already past channel stages
  if (s.stage === "roi_delivery" || s.stage === "close") return s;

  const { queue: newChannels, tease } = buildQueue(flags, intel);

  // Lock completed + current stages
  const locked = new Set<string>([...s.done, s.stage]);
  const futureChannels = newChannels.filter(ch => !locked.has(ch)) as Stage[];

  log("REBUILD_QUEUE", `locked=[${[...locked].join(',')}] old_queue=[${s.queue.join(',')}] new_future=[${futureChannels.join(',')}] tease=${tease ?? 'none'}`);

  s.queue = futureChannels;
  return s;
}

// ─── STATE: KV LOAD / SAVE / INIT ────────────────────────────────────────────

async function loadState(lid: string, env: Env): Promise<State | null> {
  const raw = await env.LEADS_KV.get(`lead:${lid}:script_state`);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

async function saveState(lid: string, s: State, env: Env) {
  await env.LEADS_KV.put(`lead:${lid}:script_state`, JSON.stringify(s));
}

async function initState(lid: string, env: Env, preloadedIntel?: Record<string, any>): Promise<State> {
  let intel = preloadedIntel ?? {};

  if (!preloadedIntel) {
    const callBrief = await loadCallBrief(lid, env);
    if (callBrief && callBrief.status) {
      intel = callBrief;
    } else {
      intel = await loadMergedIntel(lid, env);
    }
  }

  const flags = intel.flags ?? intel.fast_context?.flags ?? {};
  const { queue, tease } = buildQueue(flags, intel);

  const s: State = {
    stage: "wow", queue, done: [], inputs: { ...BLANK },
    maddie_skip: false, wants_numbers: false, just_demo: false, apify_done: false, calc_ready: false,
    trial_reviews_done: false, user_disagreed: false, stall: 0, init: new Date().toISOString(), _lastTurn: 0, _lastUttHash: "",
  };

  await saveState(lid, s, env);
  log("INIT", `lid=${lid} queue=[${queue.join(",")}] tease=${tease ?? 'none'}`);
  return s;
}

// ─── STAGE GATE ───────────────────────────────────────────────────────────────

function gateOpen(s: State): boolean {
  const { stage: st, inputs: i } = s;
  switch (st) {
    // WOW: stalls 1-9, gate at 10 so stall 9 (bridge to numbers) renders before advancing
    case "wow": return s.stall >= 10 && !s.user_disagreed;
    // deep_dive: no longer a blocking stage — auto-advance
    case "deep_dive": return true;
    case "anchor_acv": return i.acv !== null;
    case "anchor_timeframe": return i.timeframe !== null;
    case "ch_ads": return i.ads_leads !== null && i.ads_conversions !== null;
    case "ch_website": return i.web_leads !== null && i.web_conversions !== null && i.web_followup_speed !== null;
    case "ch_phone": return i.after_hours !== null && i.phone_volume !== null && i.missed_call_callback_speed !== null;
    case "ch_old_leads": return i.old_leads !== null;
    case "ch_reviews": return i.new_cust_per_period !== null && i.star_rating !== null && i.review_count !== null && i.has_review_system !== null;
    case "roi_delivery": return s.stall >= 2;  // Must deliver ROI in stall 0, confirm in stall 1
    case "close": return false;  // Terminal stage — never advance
  }
}

// ─── ADVANCE STAGE ────────────────────────────────────────────────────────────

function advance(s: State): State {
  s.done.push(s.stage);
  s.stall = 0;

  // T007: Just Demo — skip remaining channel stages, go to roi_delivery
  if (s.just_demo && (s.stage === "anchor_timeframe" || s.stage.startsWith("ch_"))) {
    s.stage = "roi_delivery";
    log("ADVANCE", `→ ${s.stage} (just_demo skip)`);
    return s;
  }

  // wow → anchor_acv directly (deep_dive was a blocking dead-end without big scraper)
  if (s.stage === "wow") s.stage = "anchor_acv";
  else if (s.stage === "deep_dive") s.stage = "anchor_acv";
  else if (s.stage === "anchor_acv") s.stage = "anchor_timeframe";
  else if (s.stage === "anchor_timeframe" || s.stage.startsWith("ch_")) {
    s.stage = s.queue.shift() ?? "roi_delivery";
  } else if (s.stage === "roi_delivery") s.stage = "close";
  log("ADVANCE", `→ ${s.stage}`);
  return s;
}

// ─── CALC ENGINE ─────────────────────────────────────────────────────────────


interface Calc { agent: string; weekly: number; precise: boolean; why: string; }

function runCalcs(i: Inputs, maddieSkip?: boolean): Calc[] {
  if (!i.acv) return [];
  const wf = i.timeframe === "monthly" ? 1 / 4.3 : 1;
  const out: Calc[] = [];

  if (i.ads_leads !== null && i.ads_conversions !== null) {
    const tiers: Record<string, number> = { ">24h": 3.91, "3h_to_24h": 2.0, "30m_to_3h": 1.0, "<30m": 0.5 };
    const rate = tiers[i.ads_followup ?? ">24h"] ?? 3.91;
    const weekly = Math.round(i.ads_conversions * wf * rate * i.acv / 52);
    out.push({
      agent: "Alex", weekly, precise: true,
      why: `${i.ads_leads} ad leads, ${i.ads_conversions} conversions, ${(rate * 100).toFixed(0)}% uplift from speed-to-lead`
    });
  }
  if (i.web_leads !== null && i.web_conversions !== null) {
    const extra = i.web_conversions * wf * 0.23;
    const weekly = Math.round(extra * i.acv / 52);
    out.push({
      agent: "Chris", weekly, precise: true,
      why: `${i.web_leads} web enquiries, 23% conversion uplift`
    });
  }
  if (i.phone_volume !== null && i.after_hours && !maddieSkip) {
    const has247 = ["24/7", "24-7", "always", "call centre", "call center"]
      .some(s => i.after_hours!.toLowerCase().includes(s));
    if (!has247) {
      const missed = i.missed_calls ?? Math.round(i.phone_volume * 0.3);
      const rate = i.phone_conversion ?? 0.3;
      const weekly = Math.round(missed * wf * rate * i.acv / 52);
      out.push({
        agent: "Maddie", weekly, precise: !!i.missed_calls,
        why: `~${missed} missed calls, ${(rate * 100).toFixed(0)}% conversion`
      });
    }
  }
  if (i.old_leads !== null) {
    const weekly = Math.round(i.old_leads * 0.05 * i.acv / 52);
    out.push({
      agent: "Sarah", weekly, precise: true,
      why: `${i.old_leads} dormant leads × 5% reactivation`
    });
  }
  if (i.star_rating !== null && i.has_review_system === false) {
    if (i.new_cust_per_period !== null) {
      // James formula: new_customers × ACV = annual revenue base, then 9% uplift
      const annualRevBase = i.new_cust_per_period * (i.timeframe === "monthly" ? 12 : 52) * i.acv;
      const weekly = Math.round(annualRevBase * 0.09 / 52);
      out.push({
        agent: "James", weekly, precise: true,
        why: `${i.new_cust_per_period} new ${i.timeframe === "monthly" ? "monthly" : "weekly"} × $${i.acv.toLocaleString()} ACV → 9% revenue uplift`
      });
    } else {
      // Directional only — no customer volume confirmed
      out.push({
        agent: "James", weekly: 0, precise: false,
        why: `9% revenue uplift from 1-star improvement (directional — need new customer volume to calculate)`
      });
    }
  }
  return out.sort((a, b) => b.weekly - a.weekly);
}

function isCalcReady(i: Inputs, maddieSkip?: boolean): boolean {
  const results = runCalcs(i, maddieSkip);
  return results.length >= 2 && results.some(r => r.precise);
}

// ── Per-channel ROI: calculate for a specific agent given current inputs ──
function calcAgentROI(agent: "Alex" | "Chris" | "Maddie" | "Sarah" | "James", i: Inputs): Calc | null {
  if (!i.acv) return null;
  const wf = i.timeframe === "monthly" ? 1 / 4.3 : 1;

  switch (agent) {
    case "Alex":
      if (i.ads_leads == null || i.ads_conversions == null) return null;
      const tiers: Record<string, number> = { ">24h": 3.91, "3h_to_24h": 2.0, "30m_to_3h": 1.0, "<30m": 0.5 };
      const rate = tiers[i.ads_followup ?? ">24h"] ?? 3.91;
      const alexWeekly = Math.round(i.ads_conversions * wf * rate * i.acv / 52);
      return { agent: "Alex", weekly: alexWeekly, precise: true, why: `${i.ads_leads} ad leads → ${i.ads_conversions} close, ${(rate * 100).toFixed(0)}% uplift from speed-to-lead` };

    case "Chris":
      if (i.web_leads == null || i.web_conversions == null) return null;
      const extra = i.web_conversions * wf * 0.23;
      const chrisWeekly = Math.round(extra * i.acv / 52);
      return { agent: "Chris", weekly: chrisWeekly, precise: true, why: `${i.web_leads} web leads → 23% conversion uplift` };

    case "Maddie":
      if (i.phone_volume == null || !i.after_hours) return null;
      const has247 = ["24/7", "24-7", "always", "call centre", "call center"]
        .some(s => i.after_hours!.toLowerCase().includes(s));
      if (has247) return null; // Skip Maddie
      const missed = i.missed_calls ?? Math.round(i.phone_volume * 0.3);
      const convRate = i.phone_conversion ?? 0.3;
      const maddieWeekly = Math.round(missed * wf * convRate * i.acv / 52);
      return { agent: "Maddie", weekly: maddieWeekly, precise: !!i.missed_calls, why: `~${missed} missed → ${(convRate * 100).toFixed(0)}% conversion` };

    case "Sarah":
      if (i.old_leads == null) return null;
      const sarahWeekly = Math.round(i.old_leads * 0.05 * i.acv / 52);
      return { agent: "Sarah", weekly: sarahWeekly, precise: true, why: `${i.old_leads} dormant leads × 5% reactivation` };

    case "James":
      if (i.star_rating == null || i.has_review_system === true) return null;
      if (i.new_cust_per_period != null) {
        const annualRevBase = i.new_cust_per_period * (i.timeframe === "monthly" ? 12 : 52) * i.acv;
        const jamesWeekly = Math.round(annualRevBase * 0.09 / 52);
        return { agent: "James", weekly: jamesWeekly, precise: true, why: `${i.new_cust_per_period} new ${i.timeframe === "monthly" ? "monthly" : "weekly"} → 9% revenue uplift` };
      }
      return { agent: "James", weekly: 0, precise: false, why: `9% revenue uplift (need customer volume)` };

    default:
      return null;
  }
}

// ─── BUSINESS NAME NORMALISATION ─────────────────────────────────────────────
// Strip city suffixes, legal suffixes, and trailing noise so Bella says
// P1-T2: Strip apology phrases from Gemini output before TTS delivery.
// Handles both single-token and multi-token apology patterns.
// Replacements pivot to confident consultant language.
function stripApologies(text: string): string {
  return text
    // Strip ALL XML/HTML tags — no angle brackets belong in spoken TTS output
    .replace(/<[^>]*>/g, "")
    // Catch bare/lone angle brackets that survived (chunk-split remnants, malformed tags)
    .replace(/[<>]/g, "")
    // Catch DELIVER_THIS regardless of word boundaries — SSE chunks may concatenate
    // e.g. "DELIVER_THISAnd" has no space, so \b fails between two word chars
    .replace(/DELIVER_THIS/gi, "")
    // Strip any other prompt-section labels that may leak
    .replace(/MANDATORY SCRIPT/gi, "")
    // ── "My [Name]" hallucination — Gemini prepends possessive "My" before prospect name
    .replace(/\bMy\s+(?=[A-Z][a-z])/g, "")
    // ── Direct apology phrases ──
    .replace(/\bmy apologies\b[.,]?\s*/gi, "")
    .replace(/\bI apologise\b[.,]?\s*/gi, "")
    .replace(/\bI apologize\b[.,]?\s*/gi, "")
    .replace(/\bI'?m sorry\b[.,]?\s*/gi, "")
    .replace(/\bsorry about that\b[.,]?\s*/gi, "")
    .replace(/\bsorry\b[.,]?\s*/gi, "")
    .replace(/\bapologies\b[.,]?\s*/gi, "")
    .replace(/\bgood catch\b[.,]?\s*/gi, "")
    // ── Semantic apology synonyms — Gemini finds linguistic loopholes ──
    .replace(/\bfor the misunderstanding\b[.,]?\s*/gi, "")
    .replace(/\bfor any misunderstanding\b[.,]?\s*/gi, "")
    .replace(/\bfor any confusion\b[.,]?\s*/gi, "")
    .replace(/\bfor the confusion\b[.,]?\s*/gi, "")
    .replace(/\bfor the oversight\b[.,]?\s*/gi, "")
    .replace(/\bmy mistake\b[.,]?\s*/gi, "")
    // ── Canary v5.11 additions — patterns from Morgans call ──
    .replace(/\bI got ahead of myself\b[.,]?\s*/gi, "")
    .replace(/\bI misspoke[^.]*?\.\s*/gi, "")
    .replace(/\byou are absolutely right[^.]*?\.\s*/gi, "")
    .replace(/\bI missed the mark[^.]*?\.\s*/gi, "")
    .replace(/\bI appreciate you keeping me on track\b[.,]?\s*/gi, "")
    .replace(/\bthank you for the correction\b[.,]?\s*/gi, "")
    .replace(/\bfor the correction\b[.,]?\s*/gi, "")
    .replace(/\bthank you for keeping me on track\b[.,]?\s*/gi, "")
    // ── Deflection phrases — Gemini hedges instead of holding frame ──
    .replace(/\bthanks for (?:the |that |your )?feedback\b[.,]?\s*/gi, "")
    .replace(/\bthank you for (?:the |that |your )?feedback\b[.,]?\s*/gi, "")
    .replace(/\bthat'?s (?:really )?(?:fair|valid|a fair point|a good point|a valid point)\b[.,]?\s*/gi, "")
    .replace(/\bthat'?s (?:really )?helpful (?:to know|to hear|feedback)\b[.,]?\s*/gi, "")
    .replace(/\bI appreciate (?:the |that |your )?(?:feedback|honesty|candour|candor|transparency)\b[.,]?\s*/gi, "")
    .replace(/\bI hear you\b[.,]?\s*/gi, "")
    .replace(/\bI understand (?:where you'?re coming from|your (?:concern|hesitation|perspective))\b[.,]?\s*/gi, "");
}

/** Check if text contains prompt artifacts; returns true if any were found */
function hasPromptArtifacts(text: string): boolean {
  return /<[^>]*>|[<>]|DELIVER_THIS|MANDATORY SCRIPT/i.test(text);
}

// shortBiz: first word UNLESS it's a stop word (e.g. "Let there be change" → use full name)
const STOP_WORDS = new Set(["the","a","an","let","all","we","our","my","your","its","and","or","for","to","in","on","at","of","by","with","from","is","are","be","it","no","not","get","do","go","how","new","one","best","top","just","about"]);

function shortBizName(biz: string): string {
  if (!biz.includes(" ")) return biz;
  const first = biz.split(/\s+/)[0];
  if (STOP_WORDS.has(first.toLowerCase())) return biz;
  return first;
}

// "Pitcher Partners" not "Pitcher Partners Sydney" — conversational, not formal.

function normaliseBizName(raw: string): string {
  if (!raw || raw === "your business") return raw;
  const cities = /\s+(?:Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Hobart|Darwin|Gold Coast|Geelong|Newcastle|Wollongong|Cairns|Townsville|Toowoomba|Ballarat|Bendigo|Mandurah|Launceston|Mackay|Rockhampton|Bunbury|Bundaberg|Hervey Bay|Wagga Wagga|Mildura|Shepparton|Gladstone|Albury|Australia|AU|NZ|New Zealand)\s*$/i;
  const legal = /\s+(?:Pty\.?\s*Ltd\.?|Ltd\.?|Inc\.?|LLC|Group|Holdings|International|Aust(?:ralia)?)\s*$/i;
  let name = raw.trim();
  // Strip legal first, then city (order matters: "Foo Sydney Pty Ltd" → "Foo Sydney" → "Foo")
  name = name.replace(legal, "").trim();
  name = name.replace(cities, "").trim();
  // Safety: if we stripped everything, return original
  return name.length >= 2 ? name : raw.trim();
}

// ttsAcronym: pass-through — modern TTS (Deepgram) handles all-caps acronyms naturally.
// DO NOT add periods/spaces — that forces awful letter-by-letter spelling with pauses.
function ttsAcronym(name: string): string {
  return name;
}

// ─── CUSTOMER TERM (industry-aware) ──────────────────────────────────────────

function custTerm(industry: string): string {
  const map: Record<string, string> = {
    dental: "patient", medical: "patient", health: "patient", physio: "patient",
    legal: "client", law: "client", solicitor: "client",
    real_estate: "listing", property: "listing",
    trade: "job", plumb: "job", electric: "job", build: "job", construct: "job",
    agency: "client", marketing: "client", consult: "client",
    gym: "member", fitness: "member", education: "student", coach: "client",
    insurance: "policy", finance: "client",
    hospitality: "booking", restaurant: "reservation", cafe: "booking",
  };
  const key = industry.toLowerCase();
  return Object.entries(map).find(([k]) => key.includes(k))?.[1] ?? "customer";
}

// ─── REGEX EXTRACTION — pure sync, no LLM call ──────────────────────────────
//
// Parses prospect utterances for numeric inputs, agreement signals, and
// qualitative flags. Zero latency, zero timeout risk.

// ── Number parser: handles "$250k", "quarter million", "a thousand", "2,000", "1.5m" etc.
function parseNumber(raw: string): number | null {
  if (!raw) return null;
  const s = raw.toLowerCase().replace(/,/g, "").replace(/\s+/g, " ").trim();

  // Word-based numbers
  const wordMap: Record<string, number> = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20,
    "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70,
    "eighty": 80, "ninety": 90, "hundred": 100,
  };

  // Compound word phrases: "quarter million", "half a million", "a thousand"
  if (/quarter\s*(?:of\s*a\s*)?mill/i.test(s)) return 250000;
  if (/half\s*(?:a\s*)?mill/i.test(s)) return 500000;
  if (/(?:three\s*quarter|750)\s*(?:of\s*a\s*)?mill/i.test(s)) return 750000;
  if (/(?:a|one)\s*mill/i.test(s)) return 1000000;
  if (/(?:two|2)\s*mill/i.test(s)) return 2000000;
  if (/(?:a|one)\s*hundred\s*(?:thousand|k|grand)/i.test(s)) return 100000;
  if (/(?:a|one)\s*(?:thousand|grand)/i.test(s)) return 1000;
  if (/couple\s*(?:of\s*)?(?:thousand|grand)/i.test(s)) return 2000;
  if (/couple\s*(?:of\s*)?hundred/i.test(s)) return 200;
  if (/few\s*(?:thousand|grand)/i.test(s)) return 3000;
  if (/few\s*hundred/i.test(s)) return 300;

  // "two hundred and fifty thousand", "three hundred thousand" — REQUIRES explicit multiplier
  if (/\b(one|two|three|four|five|six|seven|eight|nine)\s*hundred\s*(?:and\s*)?(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)?\s*(?:thousand|k|grand)\b/i.test(s)) {
    const m = s.match(/\b(one|two|three|four|five|six|seven|eight|nine)\s*hundred\s*(?:and\s*)?(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)?\s*(?:thousand|k|grand)\b/i);
    if (m) {
      const hundreds = wordMap[m[1].toLowerCase()] ?? 0;
      const tens = m[2] ? (wordMap[m[2].toLowerCase()] ?? 0) : 0;
      return (hundreds * 100 + tens) * 1000;
    }
  }

  // "couple hundred thousand", "couple hundred K" — REQUIRES explicit multiplier
  if (/couple\s*(?:of\s*)?hundred\s*(?:thousand|k|grand)/i.test(s)) return 200000;

  // "two fifty K", "one fifty thousand" — explicit K/thousand required, no assumption
  if (/\b(one|two|three|four|five|six|seven|eight|nine)\s+(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)\s*(?:k|thousand|grand)\b/i.test(s)) {
    const m = s.match(/\b(one|two|three|four|five|six|seven|eight|nine)\s+(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)\s*(?:k|thousand|grand)\b/i);
    if (m) {
      const hundreds = wordMap[m[1].toLowerCase()] ?? 0;
      const tens = wordMap[m[2].toLowerCase()] ?? 0;
      return (hundreds * 100 + tens) * 1000;
    }
  }

  // "fifty thousand", "twenty five thousand" etc
  const wordThousandMatch = s.match(/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\s*(?:thousand|grand|k)\b/);
  if (wordThousandMatch) {
    const tens = wordMap[wordThousandMatch[1]] ?? 0;
    const ones = wordThousandMatch[2] ? (wordMap[wordThousandMatch[2]] ?? 0) : 0;
    return (tens + ones) * 1000;
  }

  // Single word numbers as thousands: "five thousand", "ten thousand"
  for (const [word, val] of Object.entries(wordMap)) {
    if (new RegExp(`^${word}\\s*(?:thousand|grand|k)\\b`).test(s)) return val * 1000;
    if (new RegExp(`^${word}\\s*hundred\\s*(?:thousand|grand|k)\\b`).test(s)) return val * 100000;
  }

  // Digit-based with suffix: "$250k", "1.5m", "2k", "500"
  const digitMatch = s.match(/\$?\s*(\d+(?:\.\d+)?)\s*(k|m|mil|million|thousand|grand|hundred)?/);
  if (digitMatch) {
    let num = parseFloat(digitMatch[1]);
    const suffix = digitMatch[2]?.toLowerCase() ?? "";
    if (suffix === "k" || suffix === "thousand" || suffix === "grand") num *= 1000;
    else if (suffix === "m" || suffix === "mil" || suffix === "million") num *= 1000000;
    else if (suffix === "hundred") num *= 100;
    if (num > 0) return Math.round(num);
  }

  // Simple word numbers without multiplier: "five", "twenty"
  for (const [word, val] of Object.entries(wordMap)) {
    if (s === word || s === `a ${word}`) return val;
  }

  return null;
}

// ── Percentage parser: "20%", "one in five", "half of them", "about 30 percent"
function parsePercent(raw: string): number | null {
  const s = raw.toLowerCase().trim();
  // "20%", "30 percent", "about 15%"
  const pctMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)/);
  if (pctMatch) return parseFloat(pctMatch[1]) / 100;
  // "one in five" = 0.2
  const ratioMatch = s.match(/one\s+in\s+(\w+)/);
  if (ratioMatch) {
    const denom = parseNumber(ratioMatch[1]);
    if (denom && denom > 0) return 1 / denom;
  }
  // "half", "about half"
  if (/\bhalf\b/.test(s)) return 0.5;
  if (/\bthird\b/.test(s)) return 0.33;
  if (/\bquarter\b/.test(s)) return 0.25;
  return null;
}

// ── Industry ACV multiplier: educated guess for ambiguous numbers like "two fifty"
function inferAcvMultiplier(industry: string): number {
  const ind = industry.toLowerCase();
  // High-value B2B: assume thousands (250 → 250,000)
  if (/legal|law|consult|advisory|account|finance|insurance|enterprise|corporate/.test(ind)) return 1000;
  // Medium-value services: assume hundreds (250 → 25,000)
  if (/real.?estate|property|agency|market|architect|engineer/.test(ind)) return 100;
  // Lower-value services: assume tens or literal (250 → 2,500 or 250)
  if (/dental|medical|health|physio|chiro|gym|fitness|beauty|salon/.test(ind)) return 10;
  // Trades: job values vary, assume hundreds (250 → 25,000)
  if (/trade|plumb|electric|build|construct|hvac|roof/.test(ind)) return 100;
  // Hospitality/retail: low ACV, take literal (250 → 250)
  if (/restaurant|cafe|hospit|hotel|retail|shop|store/.test(ind)) return 1;
  // Default: assume modest multiplier (250 → 2,500)
  return 10;
}

// ── Normalize spoken word-form numbers to digit strings ──
// Converts "two hundred" → "200", "forty" → "40", "twenty five" → "25", etc.
// Applied BEFORE regex extraction so all \b(\d+)\b patterns catch word numbers.
function normalizeSpokenNumbers(text: string): string {
  const units: Record<string, number> = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  };
  const tens: Record<string, number> = {
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
    seventy: 70, eighty: 80, ninety: 90,
  };
  const allWords = [...Object.keys(units), ...Object.keys(tens), "hundred", "thousand", "a"];

  let s = text.toLowerCase();

  // "a hundred" → "100", "a thousand" → "1000"
  s = s.replace(/\ba\s+hundred\b/gi, "100");
  s = s.replace(/\ba\s+thousand\b/gi, "1000");
  // "a couple hundred" → "200", "a few hundred" → "300"
  s = s.replace(/\ba?\s*couple\s*(?:of\s*)?hundred\b/gi, "200");
  s = s.replace(/\ba?\s*few\s*hundred\b/gi, "300");
  s = s.replace(/\ba?\s*couple\s*(?:of\s*)?thousand\b/gi, "2000");
  s = s.replace(/\ba?\s*few\s*thousand\b/gi, "3000");
  // Standalone "hundred" / "thousand" without article (common in speech: "maybe hundred", "probably thousand")
  // Only convert when preceded by qualifier context to avoid false positives
  s = s.replace(/(?:about|around|roughly|maybe|probably|say|like|approximately)\s+hundred\b/gi, (m) => m.replace(/hundred/i, "100"));
  s = s.replace(/(?:about|around|roughly|maybe|probably|say|like|approximately)\s+thousand\b/gi, (m) => m.replace(/thousand/i, "1000"));

  // Build compound patterns from most specific to least:
  // Pattern: "[unit] hundred [and] [tens[-unit]]" → e.g. "two hundred and fifty" → 250
  // Pattern: "[unit] hundred [and] [unit]" → e.g. "three hundred and five" → 305
  // Pattern: "[unit] hundred" → e.g. "two hundred" → 200
  // Pattern: "[tens] [unit]" → e.g. "twenty five" → 25
  // Pattern: "[tens]-[unit]" → e.g. "twenty-five" → 25
  // Pattern: standalone tens/units → e.g. "forty" → 40

  // [unit] hundred [and] [tens[-unit]] thousand
  const unitPat = Object.keys(units).join("|");
  const tensPat = Object.keys(tens).join("|");

  // X hundred [and] [Y[-Z]] thousand
  s = s.replace(
    new RegExp(`\\b(${unitPat})\\s+hundred\\s*(?:and\\s*)?(${tensPat})(?:[\\s-](${unitPat}))?\\s+thousand\\b`, "gi"),
    (_, u, t, o) => String(((units[u.toLowerCase()] || 0) * 100 + (tens[t.toLowerCase()] || 0) + (o ? (units[o.toLowerCase()] || 0) : 0)) * 1000)
  );

  // X hundred thousand
  s = s.replace(
    new RegExp(`\\b(${unitPat})\\s+hundred\\s+thousand\\b`, "gi"),
    (_, u) => String((units[u.toLowerCase()] || 0) * 100000)
  );

  // X thousand
  s = s.replace(
    new RegExp(`\\b(${unitPat}|${tensPat})\\s+thousand\\b`, "gi"),
    (_, w) => String(((units[w.toLowerCase()] ?? tens[w.toLowerCase()]) || 0) * 1000)
  );

  // [unit] hundred [and] [tens[-unit]] (no thousand suffix)
  s = s.replace(
    new RegExp(`\\b(${unitPat})\\s+hundred\\s*(?:and\\s*)?(${tensPat})(?:[\\s-](${unitPat}))?\\b`, "gi"),
    (_, u, t, o) => String((units[u.toLowerCase()] || 0) * 100 + (tens[t.toLowerCase()] || 0) + (o ? (units[o.toLowerCase()] || 0) : 0))
  );

  // [unit] hundred (standalone — "two hundred" → 200)
  s = s.replace(
    new RegExp(`\\b(${unitPat})\\s+hundred\\b`, "gi"),
    (_, u) => String((units[u.toLowerCase()] || 0) * 100)
  );

  // [tens][-][unit] — "twenty five" or "twenty-five" → 25
  s = s.replace(
    new RegExp(`\\b(${tensPat})[\\s-](${unitPat})\\b`, "gi"),
    (_, t, u) => String((tens[t.toLowerCase()] || 0) + (units[u.toLowerCase()] || 0))
  );

  // Standalone tens — "forty" → 40 (but NOT if followed by word that's part of a bigger number)
  s = s.replace(
    new RegExp(`\\b(${tensPat})\\b(?!\\s*(?:${unitPat}|hundred|thousand))`, "gi"),
    (_, t) => String(tens[t.toLowerCase()] || 0)
  );

  // Standalone units ≤ 19 — only replace when they look like a quantity answer
  // "one" is too common in speech ("one of the things..."), so skip 0-1.
  // Only convert 2-19 when preceded by quantity context or standalone.
  const contextPat = `(?:about|around|roughly|maybe|probably|say|like|approximately|get|getting|have|had|do|did|see|saw|receive|received|handle|handled|average|total)\\s+`;
  for (const [word, val] of Object.entries(units)) {
    if (val < 2) continue; // skip zero/one — too ambiguous
    s = s.replace(
      new RegExp(`(?:${contextPat})\\b${word}\\b`, "gi"),
      (match) => match.replace(new RegExp(`\\b${word}\\b`, "i"), String(val))
    );
  }

  return s;
}

// ── Stage-aware regex extraction: returns fields relevant to the current stage
function regexExtract(utt: string, stage: Stage, industry?: string): Partial<Inputs> & { wants_numbers?: boolean } {
  // Normalize word-form numbers to digits BEFORE any pattern matching
  const s = normalizeSpokenNumbers(utt.toLowerCase());
  const out: Partial<Inputs> & { wants_numbers?: boolean } = {};

  // ── WOW / DEEP_DIVE / DEMO_VALUE_BRIDGE: detect agreement to run numbers OR skip
  if (stage === "wow" || stage === "deep_dive") {
    if (/\b(run .{0,10}numbers|crunch .{0,10}numbers|show me .{0,10}numbers|do the math|what .{0,10}roi|how much .{0,10}worth|calculate|let'?s see .{0,10}figures)\b/.test(s)) {
      out.wants_numbers = true;
    }
    // T007: detect "just show me" / "skip numbers" intent
    if (/\b(just show me|skip .{0,15}number|no numbers|just demo|just see it|don'?t need.{0,15}number|skip.{0,15}math|just.{0,10}overview|show me.{0,10}works|just.{0,10}see.{0,10}works)\b/.test(s)) {
      (out as any).just_demo = true;
    }
  }

  // ── ACV: dollar amounts (this stage specifically asks for annual customer value)
  if (stage === "anchor_acv" || stage === "wow" || stage === "deep_dive") {
    // Look for dollar amounts or standalone large numbers
    const dollarMatch = s.match(/\$\s*([\d,.]+\s*(?:k|m|mil|million|thousand|grand|hundred)?)/i)
      ?? s.match(/(?:about|around|roughly|maybe|probably|say|like|approximately)?\s*(?:\$\s*)?([\d,.]+\s*(?:k|m|mil|million|thousand|grand|hundred))\b/i)
      ?? s.match(/((?:quarter|half|three quarter|one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred).{0,15}(?:thousand|grand|k|million|mil|m|hundred thousand))/i);
    if (dollarMatch) {
      const val = parseNumber(dollarMatch[1] ?? dollarMatch[0]);
      if (val && val >= 100) out.acv = val;
    }

    // Speech with explicit multiplier: "two fifty K", "three hundred thousand"
    if (!out.acv) {
      const speechMatch = s.match(/\b(one|two|three|four|five|six|seven|eight|nine)\s+(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)\s*(?:k|thousand|grand)\b/i)
        ?? s.match(/\b(one|two|three|four|five|six|seven|eight|nine)\s*hundred\s*(?:and\s*)?(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)?\s*(?:thousand|k|grand)\b/i);
      if (speechMatch) {
        const val = parseNumber(speechMatch[0]);
        if (val && val >= 1000) out.acv = val;
      }
    }

    // Ambiguous speech: "two fifty", "three hundred" — use industry multiplier
    if (!out.acv && industry) {
      const ambigMatch = s.match(/\b(one|two|three|four|five|six|seven|eight|nine)\s+(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)\b/i)
        ?? s.match(/\b(one|two|three|four|five|six|seven|eight|nine)\s*hundred\s*(?:and\s*)?(fifty|twenty|thirty|forty|sixty|seventy|eighty|ninety)?\b/i);
      if (ambigMatch) {
        const baseVal = parseNumber(ambigMatch[0]);
        if (baseVal && baseVal >= 50 && baseVal <= 999) {
          const multiplier = inferAcvMultiplier(industry);
          out.acv = baseVal * multiplier;
        }
      }
    }

    // Bare large numbers in ACV context: "about 50000", "250000 a year"
    if (!out.acv) {
      const bareMatch = s.match(/\b(\d{3,7})\b/);
      if (bareMatch) {
        const val = parseInt(bareMatch[1]);
        if (val >= 500 && val <= 10000000) out.acv = val;
      }
    }

    // Small bare numbers with industry multiplier: "250", "500"
    if (!out.acv && industry) {
      const smallMatch = s.match(/\b(\d{2,3})\b/);
      if (smallMatch) {
        const baseVal = parseInt(smallMatch[1]);
        if (baseVal >= 50 && baseVal <= 999) {
          const multiplier = inferAcvMultiplier(industry);
          out.acv = baseVal * multiplier;
        }
      }
    }
  }

  // ── TIMEFRAME
  if (stage === "anchor_timeframe" || stage === "anchor_acv") {
    if (/\bweek/i.test(s)) out.timeframe = "weekly";
    else if (/\bmonth/i.test(s)) out.timeframe = "monthly";
  }

  // ── ADS CHANNEL — extract leads, conversions from conversational context
  if (stage === "ch_ads") {
    // Lead volume — flexible: "about a thousand", "probably 50", "hundred leads", "1000 a month"
    if (!out.ads_leads) {
      // Pattern 1: explicit "leads/enquiries" mention
      const leadMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|get|getting|bring|bringing)?\s*(\$?[\d,.]+\s*(?:k|thousand)?|(?:a\s+)?(?:couple|few|hundred|thousand|ten|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|[\w]+))\s*(?:leads?|enquir|inqu|a\s+week|a\s+month|per\s+week|per\s+month)/i);
      if (leadMatch) {
        const val = parseNumber(leadMatch[1]);
        if (val && val > 0) out.ads_leads = val;
      }
      // Pattern 2: standalone number in response to "how many leads" question
      // "probably about a thousand", "maybe fifty", "around 200"
      if (!out.ads_leads) {
        const standaloneMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|get|getting)?\s*(?:a\s+)?(thousand|hundred|[\d,.]+\s*(?:k|thousand)?|couple\s+hundred|few\s+hundred|couple\s+thousand)/i);
        if (standaloneMatch) {
          const val = parseNumber(standaloneMatch[0]);
          if (val && val > 0) out.ads_leads = val;
        }
      }
    }
    // Conversions — flexible: "ten convert", "about 5 become clients", or just "ten" / "about five"
    if (!out.ads_conversions) {
      // Pattern 1: explicit conversion mention
      const convMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|convert|converting|become|turn into)?\s*(\d+(?:\.\d+)?)\s*(?:convert|become|turn|close|sale|client|customer|booking|job|patient)/i);
      if (convMatch) {
        const val = parseInt(convMatch[1]);
        if (val > 0) out.ads_conversions = val;
      }
      // Pattern 2: standalone small number in response to "how many convert" question
      // "probably ten", "about five", "maybe 3"
      if (!out.ads_conversions) {
        const standaloneConv = s.match(/(?:about|around|roughly|maybe|probably|say|like)?\s*(ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|\d{1,3})\b/i);
        if (standaloneConv) {
          const val = parseNumber(standaloneConv[1]);
          if (val && val > 0 && val <= 500) out.ads_conversions = val;
        }
      }
    }
    // Follow-up speed — be generous with interpretation, don't drill down
    if (/(?:instant|immediate|right away|straight away|within.*minute|under.*minute|less than.*minute|asap|as soon as)/i.test(s)) out.ads_followup = "<30m";
    else if (/(?:within.*hour|couple.*hour|an hour|hour or two|pretty quick|quickly)/i.test(s)) out.ads_followup = "30m_to_3h";
    else if (/(?:same day|few hours|later that day|end of day|half a day|that day|by end of day|before close)/i.test(s)) out.ads_followup = "3h_to_24h";
    else if (/(?:next day|day or two|couple.*day|next business|24 hour|48 hour|few days|a week|tomorrow|next morning)/i.test(s)) out.ads_followup = ">24h";
    // Catch vague answers — default to conservative tier rather than asking more
    else if (/(?:depends|varies|usually|generally|try to|we try)/i.test(s)) out.ads_followup = "3h_to_24h";
    // Ad spend
    const spendMatch = s.match(/(?:spend|spending|budget|invest|putting).*?(\$?\s*[\d,.]+\s*(?:k|thousand|grand|hundred)?)/i)
      ?? s.match(/(\$\s*[\d,.]+\s*(?:k|thousand|grand|hundred)?)\s*(?:a month|per month|monthly|on ads)/i);
    if (spendMatch) {
      const val = parseNumber(spendMatch[1]);
      if (val && val > 0) out.ad_spend = val;
    }
  }

  // ── WEBSITE CHANNEL
  if (stage === "ch_website") {
    const numMatches = s.match(/\b(\d+)\b/g);
    if (numMatches) {
      // First number mentioned is likely lead volume, second is conversions
      const nums = numMatches.map(n => parseInt(n)).filter(n => n > 0 && n < 100000);
      if (nums.length >= 1 && !s.includes("convert") && !s.includes("become") && !s.includes("turn into")) {
        out.web_leads = nums[0];
      }
      if (nums.length >= 2) {
        out.web_leads = nums[0];
        out.web_conversions = nums[1];
      }
    }
    // Single number with conversion context
    const convMatch = s.match(/(\d+)\s*(?:convert|become|turn|close|sale|client|customer)/i);
    if (convMatch) out.web_conversions = parseInt(convMatch[1]);
    // Single number with lead context
    const leadMatch = s.match(/(?:get|getting|about|around|roughly|maybe)\s*(\d+)\s*(?:lead|enquir|inqu|a week|a month)/i);
    if (leadMatch) out.web_leads = parseInt(leadMatch[1]);
    // Web follow-up speed — same tiers as ads_followup
    if (/(?:instant|immediate|right away|straight away|within.*minute|under.*minute|less than.*minute|asap|as soon as)/i.test(s)) out.web_followup_speed = "<30m";
    else if (/(?:within.*hour|couple.*hour|an hour|hour or two|pretty quick|quickly)/i.test(s)) out.web_followup_speed = "30m_to_3h";
    else if (/(?:same day|few hours|later that day|end of day|half a day|that day|by end of day|before close)/i.test(s)) out.web_followup_speed = "3h_to_24h";
    else if (/(?:next day|day or two|couple.*day|next business|24 hour|48 hour|few days|a week|tomorrow|next morning)/i.test(s)) out.web_followup_speed = ">24h";
    else if (/(?:depends|varies|usually|generally|try to|we try)/i.test(s)) out.web_followup_speed = "3h_to_24h";
  }

  // ── PHONE CHANNEL
  if (stage === "ch_phone") {
    // Phone volume
    const phoneMatch = s.match(/(?:about|around|roughly|maybe|probably|get|getting)?\s*(\d+)\s*(?:call|phone|ring|inbound)/i);
    if (phoneMatch) out.phone_volume = parseInt(phoneMatch[1]);
    // Missed calls
    const missedMatch = s.match(/(?:about|around|roughly|maybe|probably)?\s*(\d+)\s*(?:missed|unanswered|lost|drop)/i);
    if (missedMatch) out.missed_calls = parseInt(missedMatch[1]);
    // After hours handling
    if (/(?:voicemail|answering machine|goes to message|no.?one answers|ring.?out|don'?t answer|nobody|nothing|miss.* them|unanswered)/i.test(s)) {
      out.after_hours = "voicemail/unanswered";
    } else if (/(?:24.?7|24.?hour|always.?(?:someone|covered|answer)|call cent|after.?hours.?(?:service|team|staff))/i.test(s)) {
      out.after_hours = "24/7 coverage";
    } else if (/(?:close|shut|finish|knock off|go home|stop.*answer)/i.test(s) && /(?:5|6|7|8|five|six|seven|eight)\s*(?:pm|o'?clock|at night)/i.test(s)) {
      out.after_hours = "close at business hours";
    }
    // Conversion rate
    const pct = parsePercent(s);
    if (pct && pct > 0 && pct <= 1) out.phone_conversion = pct;
    // Missed call callback speed — same tiers as ads_followup
    if (/(?:instant|immediate|right away|straight away|within.*minute|under.*minute|less than.*minute|asap|as soon as)/i.test(s)) out.missed_call_callback_speed = "<30m";
    else if (/(?:within.*hour|couple.*hour|an hour|hour or two|pretty quick|quickly)/i.test(s)) out.missed_call_callback_speed = "30m_to_3h";
    else if (/(?:same day|few hours|later that day|end of day|half a day|that day|by end of day|before close)/i.test(s)) out.missed_call_callback_speed = "3h_to_24h";
    else if (/(?:next day|day or two|couple.*day|next business|24 hour|48 hour|few days|a week|tomorrow|next morning)/i.test(s)) out.missed_call_callback_speed = ">24h";
    else if (/(?:depends|varies|usually|generally|try to|we try|don'?t|never|no)/i.test(s)) out.missed_call_callback_speed = ">24h";
  }

  // ── OLD LEADS
  if (stage === "ch_old_leads") {
    const oldMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like)?\s*(\d[\d,.]*\s*(?:k|thousand|hundred)?)/i);
    if (oldMatch) {
      const val = parseNumber(oldMatch[1]);
      if (val && val > 0) out.old_leads = val;
    }
  }

  // ── REVIEWS
  if (stage === "ch_reviews") {
    // Star rating: "4.5", "four point five", "four and a half"
    const ratingMatch = s.match(/(\d(?:\.\d)?)\s*(?:star|out of|\/)/i);
    if (ratingMatch) out.star_rating = parseFloat(ratingMatch[1]);
    // Review count
    const countMatch = s.match(/(?:about|around|roughly|maybe|probably|have|got)?\s*(\d+)\s*(?:review|rating)/i);
    if (countMatch) out.review_count = parseInt(countMatch[1]);
    // New customers per period: "about 20 new clients a week", "maybe 15", "ten a month"
    const newCustMatch = s.match(/(?:about|around|roughly|maybe|probably|say|like|get|getting|bring|bringing)?\s*(\d+)\s*(?:new|client|customer|patient|job|booking|deal|sale|matter|listing|policy|member)/i);
    if (newCustMatch) out.new_cust_per_period = parseInt(newCustMatch[1]);
    // Review system
    if (/\b(no|nah|not really|don'?t|haven'?t|nothing|no system|no process)\b/i.test(s) && /\b(review|ask|system|process)\b/i.test(s)) {
      out.has_review_system = false;
    } else if (/\b(yes|yeah|yep|we do|we use|send|auto|email|sms|text|follow.?up)\b/i.test(s) && /\b(review|ask|system|process)\b/i.test(s)) {
      out.has_review_system = true;
    }
  }

  // ── Cross-stage: catch numbers said with context clues on any stage
  // "about 20" / "maybe 15" as standalone number responses (common in voice)
  if (Object.keys(out).length === 0 && !["wow", "deep_dive", "roi_delivery", "close"].includes(stage)) {
    const standaloneNum = s.match(/^(?:uh\s*)?(?:about|around|roughly|maybe|probably|say|like|i'?d say|hmm)?\s*(\d+(?:\.\d+)?)\s*(?:ish|or so|maybe|i think|i guess|i reckon)?\.?$/i);
    if (standaloneNum) {
      const val = parseFloat(standaloneNum[1]);
      if (val > 0) {
        // Assign to the first null field for this stage
        if (stage === "anchor_acv" && val >= 100) out.acv = val;
        else if (stage === "ch_ads" && !out.ads_leads) out.ads_leads = val;
        else if (stage === "ch_website" && !out.web_leads) out.web_leads = val;
        else if (stage === "ch_phone" && !out.phone_volume) out.phone_volume = val;
        else if (stage === "ch_old_leads") out.old_leads = val;
      }
    }
  }

  return out;
}

// ─── APPLY EXTRACTION + KV WRITES (sync extraction, async KV only) ──────────

async function extractAndApply(utterance: string, s: State, lid: string, env: Env, stageOverride?: Stage, industry?: string, ctx?: ExecutionContext): Promise<State> {
  if (!utterance) return s;

  const stage = stageOverride ?? s.stage;
  const extracted = regexExtract(utterance, stage, industry);

  // Detect disagreement with Bella's statements
  if (/\b(that's wrong|not right|not accurate|incorrect|disagree|that's not|we don't actually|you're wrong|no that's)\b/i.test(utterance)) {
    s.user_disagreed = true;
    log("DISAGREEMENT", `lid=${lid} prospect contradicted Bella — blocking stage advance`);
  }

  // ch_website: if we extracted web_leads but state already has web_leads, this is actually web_conversions
  if (stage === "ch_website" && extracted.web_leads != null && s.inputs.web_leads != null && extracted.web_conversions == null) {
    extracted.web_conversions = extracted.web_leads;
    delete extracted.web_leads;
  }

  const fields = Object.keys(extracted);

  // Log normalized form if word-numbers were converted
  const normalized = normalizeSpokenNumbers(utterance.toLowerCase());
  if (normalized !== utterance.toLowerCase()) {
    log("NORMALIZE", `"${utterance}" → "${normalized}"`);
  }

  if (fields.length === 0) {
    log("EXTRACT", `lid=${lid} stage=${stage} extractions=0 utt="${utterance.slice(0, 80)}"`);
    return s;
  }

  // Apply regex extraction to state
  for (const [field, value] of Object.entries(extracted)) {
    if (value == null) continue;
    if (field in BLANK) (s.inputs as any)[field] = value;
    if (field === "wants_numbers" && value === true) s.wants_numbers = true;
    if ((field as any) === "just_demo" && value === true) {
      s.just_demo = true;
      log("JUST_DEMO", `intent detected — will skip to just_demo_pivot on next advance`);
    }
    if (field === "after_hours" && typeof value === "string") {
      if (["24/7", "24-7", "always", "call centre", "call center"].some(x => (value as string).toLowerCase().includes(x))) {
        s.maddie_skip = true;
        log("FLAG", "maddie_skip=true");
      }
    }
    log("CAPTURED", `${field}=${JSON.stringify(value)}`);
  }

  log("EXTRACT", `lid=${lid} stage=${stage} extractions=${fields.length} fields=${fields.join(",")}`);

  // Write captured_inputs to KV for demo agents
  if (lid) {
    const capturedPayload = JSON.stringify({
      ...s.inputs,
      updated_at: new Date().toISOString(),
      stage: s.stage,
      lid,
    });
    log("KV_WRITE", `lid=${lid} key=captured_inputs ctx=${!!ctx}`);
    if (ctx) {
      ctx.waitUntil(env.LEADS_KV.put(`lead:${lid}:captured_inputs`, capturedPayload).catch(e => {
        log("KV_WRITE_ERR", `lid=${lid} key=captured_inputs error=${e?.message || e}`);
      }));
    } else {
      env.LEADS_KV.put(`lead:${lid}:captured_inputs`, capturedPayload).catch(e => {
        log("KV_WRITE_ERR", `lid=${lid} key=captured_inputs no_ctx error=${e?.message || e}`);
      });
    }

    // Write ROI to canonical key for bella-tools (FIX-4 schema alignment)
    // Format: { agents: { AgentName: { monthly_opportunity, weekly, precise, why } }, total_monthly, calcs, updated_at }
    const calcs = runCalcs(s.inputs, s.maddie_skip);
    if (calcs.length >= 1) {
      const agents: Record<string, { monthly_opportunity: number; weekly: number; precise: boolean; why: string }> = {};
      let totalWeekly = 0;
      for (const c of calcs) {
        agents[c.agent] = { monthly_opportunity: Math.round(c.weekly * 4.33), weekly: c.weekly, precise: c.precise, why: c.why };
        totalWeekly += c.weekly;
      }
      const roiPayload = JSON.stringify({
        agents,
        total_monthly: Math.round(totalWeekly * 4.33),
        calcs,
        inputs_snapshot: { ...s.inputs },
        updated_at: new Date().toISOString(),
      });
      env.LEADS_KV.put(`lead:${lid}:roi`, roiPayload).catch(() => {});
    }
  }

  // conv_summary write removed (orphan key — nothing reads it)

  return s;
}

// ─── QUALITATIVE MEMORY — regex-based, sync, no API call ─────────────────────
//
// Pattern-matches prospect utterances for qualitative signals: objections,
// buying signals, hesitation, named details. Zero latency, zero timeout risk.
// Returns a bullet string or "" if nothing notable.

function extractQualitativeSignals(utt: string): string {
  const s = utt.toLowerCase();
  const signals: string[] = [];

  // Objections / hesitation
  if (/\b(too expensive|too much|can'?t afford|not in.{0,10}budget|out of.{0,10}budget)\b/.test(s)) signals.push("- Price objection raised");
  if (/\b(not interested|not for us|not right now|not ready|not sure|don'?t think so|don'?t need)\b/.test(s)) signals.push("- Expressed disinterest or hesitation");
  if (/\b(need to think|talk to.{0,15}partner|discuss with|check with|run it by|sleep on it)\b/.test(s)) signals.push("- Wants to consult/think before deciding");
  if (/\b(already have|already using|already got|we use|currently using|happy with.{0,20}current)\b/.test(s)) signals.push("- Has existing solution — handle carefully");
  if (/\b(tried.{0,15}before|didn'?t work|burned|bad experience|skeptic)\b/.test(s)) signals.push("- Past negative experience — build trust");

  // Buying signals
  if (/\b(sounds great|love it|that'?s amazing|exactly what|perfect|brilliant|impressive)\b/.test(s)) signals.push("- Strong positive signal");
  if (/\b(when can we|how do we|how soon|get started|sign up|set it up|next step|free trial)\b/.test(s)) signals.push("- Ready-to-buy signal");
  if (/\b(how much|what'?s the cost|pricing|what does it cost|investment)\b/.test(s)) signals.push("- Asking about pricing — high intent");

  // Engagement signals
  if (/\b(that'?s exactly|you'?re right|spot on|nailed it|hit the nail)\b/.test(s)) signals.push("- Feels understood — strong rapport");
  if (/\b(biggest problem|real issue|pain point|struggling with|challenge is)\b/.test(s)) signals.push("- Volunteered a pain point");

  return signals.slice(0, 3).join("\n");
}

// ─── HISTORY TRIMMER ─────────────────────────────────────────────────────────
//
// Pure history trimmer — no Gemini call. Qualitative memory is now captured
// inside extractAndApply's combined Gemini call (FIX 3).
//
// Keeps last 6 raw turns for natural conversational flow.
// Older turns are discarded — their qualitative signals are already in conv_memory.

const KEEP_RAW = 6;

function trimHistory(messages: Msg[]): Msg[] {
  const history = messages.filter(m => m.role !== "system");
  // Multi-turn: keep only recent USER turns (strip prior Bella utterances to prevent remix)
  if (history.length > 2) {
    const userOnly = history.filter(m => m.role === "user");
    return userOnly.slice(-2); // Last 2 user turns only
  }
  if (history.length <= KEEP_RAW) return history;
  const fresh = history.slice(history.length - KEEP_RAW);
  return fresh[0]?.role === "assistant" ? fresh.slice(1) : fresh;
}

// ─── LEAN SYSTEM CONTEXT — ~1.5K chars, rebuilt every turn ───────────────────
//
// Contains ONLY: lean persona preamble + business intel summary.
// The per-stage directive, confirmed inputs, ROI calcs, and memory are in buildTurnPrompt().
// This replaced the 13K+ full persona + flow framework that was killing latency.

function buildFullSystemContext(intel: Record<string, any>, apifyDone: boolean): string {
  const ci = intel.core_identity ?? {};
  const sf = intel.consultant?.scriptFills ?? intel.script_fills ?? {};
  const cons = intel.consultant ?? {};
  const ts = intel.tech_stack ?? {};
  const flags = intel.flags ?? {};
  const deep = (intel as any).intel?.deep ?? intel.deep ?? {}; // Check intel.intel.deep (big scraper) then root deep
  const hero = (intel as any).hero ?? (intel as any).fast_intel?.hero ?? {};
  const fn = intel.first_name ?? ci.first_name ?? "";
  const spokenName = intel.consultant?.businessIdentity?.spokenName;
  const bizRaw = spokenName || intel.business_name || ci.business_name || intel.fast_context?.business?.name || "your business";
  const biz = ttsAcronym(spokenName || normaliseBizName(bizRaw));
  const ind = ci.industry ?? ci.industry_key ?? "";
  const loc = ci.location ?? "";
  const ct = custTerm(ind);

  // BUG 2 diagnostic — verify fallback path is working
  const lid = intel.lid ?? "unknown";
  log("PROMPT_BUILD", `lid=${lid} sf_keys=${sf ? Object.keys(sf).length : 0} cons_routing_agents=${intel.consultant?.routing?.priority_agents?.length ?? 0}`);

  const rawOpener = intel.bella_opener ?? "";
  const opener = rawOpener && biz !== "your business"
    ? rawOpener.replace(/\bHome\b/g, biz)
    : rawOpener;

  // SCHEMA v3: Read from canonical sources (tech_stack, deep, flags)
  const adsOn = !!(
    ts.is_running_ads
    || (ts.ads_pixels && ts.ads_pixels.length > 0)
    || flags.is_running_ads
    || flags.has_fb_pixel
    || flags.has_google_ads
    || deep.ads?.is_running_google_ads
    || (deep.ads?.google_ads_count ?? 0) > 0
    || (deep.ads?.fb_ads_count ?? 0) > 0
    || intel.google_ads_running
    || intel.facebook_ads_running
    || (intel as any).is_running_google_ads || (intel as any).is_running_fb_ads
    || ((intel as any).google_ads_transparency_count ?? 0) > 0
    || ((intel as any).fb_ads_count ?? 0) > 0
  );

  // SCHEMA v3: Google reviews from deep.googleMaps (canonical) or big scraper root fields
  const googleRating = deep.googleMaps?.rating
    ?? (typeof intel.star_rating === 'number' ? intel.star_rating : (typeof intel.star_rating === 'string' ? parseFloat(intel.star_rating) || null : null));
  const googleReviews = deep.googleMaps?.review_count
    ?? (typeof intel.review_count === 'number' ? intel.review_count : (typeof intel.review_count === 'string' ? parseInt(intel.review_count, 10) || 0 : 0));

  // ── V2 EXECUTION BLOCK — replaces V1 fullPersona ──────────────────────────
  // Behavioral rules only. Per-stage directives, OUTPUT RULES, ROI calcs, and
  // confirmed inputs are in buildDOTurnPrompt / buildTurnPrompt.
  // This section is REFERENCE DATA — Gemini follows the MANDATORY SCRIPT above.
  const executionBlock = `BELLA AI — EXECUTION RULES (V2)

1. CORE OBJECTIVE
You are Bella, a live voice AI running a personalised AI Agent demonstration for a business prospect.
The prospect just submitted their details on your website — they gave you their name and business URL. Your system scraped their site in real time, so you already know about their business. They chose to be here. This is an inbound demo, not a cold call. Never introduce yourself as if you are calling them — they are already on your website talking to you.
Your job is to create a strong early wow effect, confirm just enough business context to dial in the agents, recommend the highest-value agents simply and intelligently, ask only the minimum questions needed to size ROI, deliver ROI clearly and conservatively, and move to close once the best-fit opportunity is clear.
Do not turn this into a broad audit, discovery call, consulting session, or architecture discussion.

2. CONTROLLER AUTHORITY
The runtime stage controller is authoritative.
Follow the current stage, allowed moves, skip rules, question limits, and forced transitions provided in the turn instructions.
Do not invent extra stages, reopen completed stages, or continue questioning once the controller has moved forward.
Do not remain in a question stage once the controller marks that stage ready for ROI.
Do not reopen a completed ROI stage unless the prospect explicitly corrects a key input.

3. TURN BEHAVIOR
Keep turns short and natural.
React briefly to what the prospect just said, then continue the stage.
Ask at most one question at the end of a turn.
Do not stack multiple questions unless the current stage instructions explicitly require a tightly grouped sequence.
Use spoken language, not written language.
Prefer clear, direct sentences over long explanations.
Keep the pace confident, smooth, and commercially focused.

4. TONE
Sound confident, useful, and well prepared.
Do not sound hesitant, data-hungry, or dependent on missing context.
Do not mention internal systems, routing logic, prompt logic, controllers, calculators, APify, deep enrichment, scraping pipelines, or missing data.
Do not read raw context, bullet points, or structured fields aloud.
Avoid filler praise unless it is genuinely natural and necessary.

5. INDUSTRY LANGUAGE
Always use the prospect's industry language wherever the available context supports it.
Prefer the business's natural words for customer type, service type, conversion event, staff roles, sales process, and commercial outcomes.
If the prospect corrects a term, immediately adopt their term going forward.

6. ROI RULES
ROI calculations come from the calculator layer, not from you.
You may explain the business logic behind the result, but must not invent formulas, assumptions, or unsupported benchmarks.
Deliver the numbers exactly as provided.
Keep ROI conservative, practical, and easy to follow.
Do not present ROI as guaranteed.

7. CLOSE RULES
Once combined ROI has been delivered, move to the close unless the prospect asks a direct question.
Do not reopen broad discovery after combined ROI.
Keep the close low-friction and focused on easy setup, no credit card, conservative upside, best-fit agents only, and free trial first.

8. HARD DO-NOT RULES
Do not mention missing data.
Do not hallucinate unsupported business facts.
Do not recommend too many agents too early.
Do not ask every branch in sequence.
Do not exceed question caps.
Do not ignore a forced transition.
Do not improvise ROI formulas.
Do not read internal notes aloud.
Do not explain internal selection logic.
Do not switch into architecture, platform, workers, or implementation talk.

THE AGENTS:
Alex — speed-to-lead and follow-up consistency.
Chris — improving website conversion actions while prospects are warm.
Maddie — capturing live phone opportunities before they disappear.
Sarah — dormant database reactivation.
James — reviews and reputation.`;

  // ── BUSINESS INTEL ──
  const isStubIntel = intel.fast_intel?.source === "stub";
  const intelLines: string[] = [
    `BUSINESS INTEL FOR ${biz.toUpperCase()}`,
    `Business: ${biz}${loc ? ` | Location: ${loc}` : ""} | Industry: ${ind}`,
  ];
  if (isStubIntel) {
    intelLines.push(`[INTEL QUALITY: LIMITED — their website was not accessible during research. Do not claim you reviewed their website, observed specific pages, or noticed specific site features. Use the business name and domain to guide your conversation with general industry knowledge. Stay confident, polished, and commercially focused — never mention missing data or apologise for limited context.]`);
  }
  if (ci.tagline) intelLines.push(`Tagline: "${ci.tagline}"`);
  if (ci.model) intelLines.push(`Business model: ${ci.model}`);
  if (ci.phone) intelLines.push(`Phone: ${ci.phone}`);
  if (ci.business_hours) intelLines.push(`Hours: ${ci.business_hours}`);
  if (googleRating) intelLines.push(`Google: ${googleRating}/5 (${googleReviews} reviews)`);

  const techLines: string[] = [];
  if (ts.crm_name) techLines.push(`CRM: ${ts.crm_name}`);
  if (ts.booking_tool) techLines.push(`Booking: ${ts.booking_tool}`);
  if (ts.chat_tool) {
    techLines.push(`Chat: ${ts.chat_tool}${ts.is_non_ai_chat ? " (NON-AI — legacy chatbot)" : ts.chat_likely_basic ? " (AI-capable, likely basic mode)" : ""}`);
  } else if (ts.has_chat) techLines.push(`Chat: yes (tool unknown)`);
  if (ts.email_tool) techLines.push(`Email marketing: ${ts.email_tool}`);
  if (ts.payment_tool) techLines.push(`Payment: ${ts.payment_tool}`);
  if (ts.ecommerce_platform) techLines.push(`Ecommerce: ${ts.ecommerce_platform}`);
  if (ts.site_platform) techLines.push(`Built with: ${ts.site_platform}`);
  if (techLines.length) intelLines.push(`Tech stack: ${techLines.join(" | ")}`);

  if (ts.ads_pixels?.length) {
    intelLines.push(`Ad pixels on site: ${ts.ads_pixels.join(", ")}`);
  }

  if (ts.social_channels?.length) {
    intelLines.push(`Social presence: ${ts.social_channels.join(", ")}`);
  }


  intelLines.push(`Ads running: ${adsOn ? "YES" : "NO"}`);

  // Prefer consultant scriptFills, fall back to raw hero/tagline data
  if (sf.hero_header_quote) {
    intelLines.push(`Hero message: "${sf.hero_header_quote}"`);
  } else if (hero.h2) {
    intelLines.push(`Hero message (raw): "${hero.h2}"`);
  } else if (hero.og_description) {
    intelLines.push(`Site description: "${hero.og_description}"`);
  }
  if (sf.website_positive_comment) {
    // Strip personal-opinion prefixes — force evidence language throughout
    const cleanWP = (sf.website_positive_comment as string)
      .replace(/^I\s+(really\s+)?like\s+(how|that|the)\s+/i, "The site ")
      .replace(/^It's\s+great\s+(how|that)\s+/i, "The site ");
    intelLines.push(`Website strength: ${cleanWP}`);
  } else if (cons.copyAnalysis?.bellaLine || cons.valuePropAnalysis?.bellaLine) {
    intelLines.push(`Website strength (raw): ${cons.copyAnalysis?.bellaLine ?? cons.valuePropAnalysis?.bellaLine}`);
  }
  if (sf.icp_guess) {
    // Strip trailing validation questions from consultant's ICP guess
    const cleanIcpIntel = (sf.icp_guess as string)
      .replace(/[,;—–-]+\s*(is that right|right|yeah)\??\s*$/i, "")
      .replace(/\?+$/, "").trim();
    intelLines.push(`ICP: ${cleanIcpIntel}`);
  }
  if (intel.top_fix?.copyHeadline) intelLines.push(`Key opportunity: ${intel.top_fix.copyHeadline}`);
  if (opener) intelLines.push(`Opener: ${opener}`);

  if (cons.icpAnalysis?.marketPositionNarrative) intelLines.push(`Market position: ${cons.icpAnalysis.marketPositionNarrative}`);
  else if (cons.icpAnalysis?.whoTheyTarget) intelLines.push(`ICP: ${cons.icpAnalysis.whoTheyTarget}`);
  if (cons.copyAnalysis?.bellaLine || cons.valuePropAnalysis?.bellaLine) intelLines.push(`Site observation: ${cons.copyAnalysis?.bellaLine ?? cons.valuePropAnalysis?.bellaLine}`);
  if (cons.conversationHooks?.length) intelLines.push(`Conversation hooks: ${cons.conversationHooks.slice(0, 3).join(" | ")}`);

  const marker = apifyDone ? "\n[APIFY_ENRICHED]" : "";

  return `${executionBlock}\n${intelLines.join("\n")}${marker}`;
}

// ─── LEAN PER-TURN PROMPT — ~800 chars, rebuilt every turn ───────────────────
//
// Contains ONLY what changes between turns:
//   - Business name + current stage header
//   - Confirmed inputs so far
//   - Live ROI calculations
//   - Conversation memory (qualitative)
//   - Current stage directive (3-5 lines)
//   - Output contract

function buildTurnPrompt(s: State, intel: Record<string, any>, convMemory: string): string {
  const ci = intel.core_identity ?? {};
  const fn = intel.first_name ?? ci.first_name ?? "";
  const spokenName = intel.consultant?.businessIdentity?.spokenName;
  const bizRaw = spokenName || intel.business_name || ci.business_name || intel.fast_context?.business?.name || "your business";
  const biz = ttsAcronym(spokenName || normaliseBizName(bizRaw));
  const ind = ci.industry ?? ci.industry_key ?? "";
  const ct = custTerm(ind);
  const tf = s.inputs.timeframe ?? "weekly";

  // FIX Bug 2: opener must be in scope for buildStageDirective()
  const rawOpener = intel.bella_opener ?? "";
  const opener = rawOpener && biz !== "your business"
    ? rawOpener.replace(/\bHome\b/g, biz)
    : rawOpener;

  const { inputs: i } = s;
  const calcs = runCalcs(s.inputs, s.maddie_skip);
  const top3 = calcs.slice(0, 3);
  const total = top3.reduce((sum, c) => sum + c.weekly, 0);

  // ── CALC DIAGNOSTICS ──
  if (top3.length) {
    log("CALC", `agents=${top3.map(c => `${c.agent}=$${c.weekly}/wk`).join(",")} total=$${total}/wk acv=${i.acv}`);
  } else {
    const missing: string[] = [];
    if (!i.acv) missing.push("acv");
    if (i.ads_leads == null) missing.push("ads_leads");
    if (i.ads_conversions == null) missing.push("ads_conversions");
    if (i.web_leads == null) missing.push("web_leads");
    if (i.web_conversions == null) missing.push("web_conversions");
    if (i.phone_volume == null) missing.push("phone_volume");
    if (!i.after_hours) missing.push("after_hours");
    log("CALC", `no_calcs — missing: ${missing.join(",")}`);
  }

  // ── CONFIRMED INPUTS ──
  const knownLines: string[] = [];
  if (i.acv) knownLines.push(`- ACV: ${i.acv.toLocaleString()} AUD`);
  if (i.timeframe) knownLines.push(`- Timeframe: ${i.timeframe}`);
  if (i.ads_leads) knownLines.push(`- Ad leads: ${i.ads_leads} ${tf}`);
  if (i.ads_conversions) knownLines.push(`- Ad conversions: ${i.ads_conversions} ${tf}`);
  if (i.ads_followup) knownLines.push(`- Followup speed: ${i.ads_followup}`);
  if (i.ad_spend) knownLines.push(`- Ad spend: ${i.ad_spend}/mo`);
  if (i.web_leads) knownLines.push(`- Web leads: ${i.web_leads} ${tf}`);
  if (i.web_conversions) knownLines.push(`- Web conversions: ${i.web_conversions} ${tf}`);
  if (i.web_followup_speed) knownLines.push(`- Web followup speed: ${i.web_followup_speed}`);
  if (i.phone_volume) knownLines.push(`- Phone volume: ${i.phone_volume} ${tf}`);
  if (i.after_hours) knownLines.push(`- After hours: ${i.after_hours}`);
  if (i.missed_calls) knownLines.push(`- Missed calls: ${i.missed_calls} ${tf}`);
  if (i.missed_call_callback_speed) knownLines.push(`- Callback speed: ${i.missed_call_callback_speed}`);
  if (i.old_leads) knownLines.push(`- Old leads: ${i.old_leads}`);
  if (i.new_cust_per_period) knownLines.push(`- New ${ct}s: ${i.new_cust_per_period} ${tf}`);
  if (i.star_rating) knownLines.push(`- Star rating: ${i.star_rating}`);
  if (i.review_count) knownLines.push(`- Review count: ${i.review_count}`);
  if (i.has_review_system != null) knownLines.push(`- Review system: ${i.has_review_system}`);
  const knownSection = knownLines.length
    ? `CONFIRMED THIS CALL (DO NOT re-ask ANY of these — the prospect already told you):\n${knownLines.join("\n")}`
    : "";

  // ── LIVE ROI ──
  let roiSection = "";
  if (top3.length) {
    const roiLines = top3.map(c =>
      `- ${c.agent}: approx ${c.weekly.toLocaleString()} dollars per week ${c.precise ? "(precise)" : "(directional)"} — ${c.why}`
    );
    roiSection = `\nLIVE ROI CALCULATIONS (say as words, never symbols)\n${roiLines.join("\n")}\nTotal: approx ${total.toLocaleString()} dollars per week`;
  }

  // ── CALL MEMORY ──
  const memSection = convMemory
    ? `\nCALL MEMORY\n${convMemory}`
    : "";

  // ── CURRENT STAGE DIRECTIVE ──
  const stageDirective = buildStageDirective(s, fn, biz, ind, ct, tf, top3, total, opener, intel);

  // ── Chunk C+: Inject vector-retrieved snippet if available (all stages) ──
  const vecSnippet = (intel as any)._retrievedSnippet ?? "";
  const vecSection = vecSnippet
    ? `\nRETRIEVED INTEL (cite verbatim where relevant):\n"${vecSnippet}"`
    : "";

  // ── OUTPUT RULES (V2) ──
  const outputRules = `OUTPUT RULES (V2)
1. ONLY SPOKEN WORDS. No labels, headers, XML tags, markdown, code formatting, or symbols in the output.
2. Use up to 3 statements and one question per turn, 4 sentences maximum.
3. Say numbers naturally in spoken form. Say dollar amounts as "[number] dollars".
4. NEVER APOLOGISE, NEVER BACKTRACK, NEVER DEFLECT. If the prospect challenges a number, say "That's the conservative estimate from our model" and move to the current directive. Never say sorry, my mistake, good catch, I misspoke, you're right to pull me up, I missed the mark, I got ahead of myself, or any synonym of apology. Never say "thanks for the feedback", "that's fair", "that's a valid point", "I appreciate the feedback", "I hear you", or any hedging deflection. Hold frame — acknowledge briefly then redirect to the directive.
5. SCRIPT COMPLIANCE: Deliver the scripted instruction from the MANDATORY SCRIPT section exactly as written. You may add ONE brief natural sentence before it, but the scripted line must remain WORD-FOR-WORD unchanged. Do not recalculate, paraphrase, or break the scripted numbers into sub-calculations.
6. QUESTION COMPLIANCE: If the prospect gives filler instead of answering a question, briefly acknowledge and re-ask. Do not pretend the question was answered.
7. Do not mention missing data, internal systems, routing logic, controllers, calculators, or enrichment pipelines.
8. Do not improvise ROI formulas or benchmark claims. Use ONLY the exact dollar figures from the LIVE ROI section and the DELIVER_THIS text. Never multiply, divide, or restate the math yourself.
9. NO PHANTOM ROI: If the LIVE ROI section is empty or absent, do NOT reference any dollar uplift, weekly/monthly value, or "conservative estimate". You have NO calculated numbers to cite — talk about the methodology and what the agents CAN do, not fabricated dollar amounts.`;

  const agentKnowledge = `AGENT KNOWLEDGE (always available — answer any question about any agent at any point in the call):
- Alex (speed-to-lead): Responds to every inbound lead within 30 seconds, 24/7. Businesses responding within 30 seconds convert up to 4x more than those waiting 5 minutes. Most leads decide in under 5 minutes — Alex ensures ${biz} is always first.
- Chris (website concierge): Engages website visitors in real time, runs live sales conversations, qualifies needs, handles objections, drives toward the prospect's primary CTA. Basic chat widgets add ~24% more conversions — Chris is a fully trained ${biz} sales agent, not a chatbot. First-mover advantage — nobody has deployed this yet.
- Maddie (AI receptionist): Answers every inbound call, qualifies the opportunity, books straight into the calendar. Eliminates missed calls and after-hours losses.
- Sarah (database reactivation): Works through dormant leads and past customers who never converted. Turns an existing database into new revenue without new ad spend.
- James (reputation manager): Automates Google review collection and management. Reviews compound over time — James systematises what most businesses leave to chance.`;

  return `${agentKnowledge}

====================================
MANDATORY SCRIPT — FOLLOW EXACTLY
====================================
${stageDirective}
====================================

BUSINESS: ${biz} | STAGE: ${s.stage.toUpperCase()}
${knownSection}${roiSection}${memSection}${vecSection}

${outputRules}`;
}

// ─── STAGE DIRECTIVE — Voice RAG script language with resolved placeholders ───
//
// Each stage serves ACTUAL SCRIPT TEXT from the Voice RAG JSON with placeholders
// resolved from real intel data. Gemini's job is to DELIVER this script naturally,
// not improvise from rules.

function buildStageDirective(
  s: State,
  fn: string,
  biz: string,
  ind: string,
  ct: string,
  tf: string,
  top3: Calc[],
  total: number,
  opener: string,
  intel: Record<string, any>,
): string {
  const i = s.inputs;
  const sf = intel.consultant?.scriptFills ?? {};
  const ci = intel.core_identity ?? {};
  const deep = (intel as any).intel?.deep ?? intel.deep ?? {}; // Check intel.intel.deep (big scraper) then root deep
  const ts = intel.tech_stack ?? {};
  const flags = intel.flags ?? {};
  const loc = ci.location ?? "";

  // Reviews data from deep-scrape (canonical source)
  const googleRating = deep.googleMaps?.rating
    ?? (intel.star_rating != null ? parseFloat(String(intel.star_rating)) || null : null);
  const googleReviews = deep.googleMaps?.review_count
    ?? (intel.review_count != null ? parseInt(String(intel.review_count), 10) || 0 : 0);

  // Hiring data from deep-scrape + consultant
  const hiringData = deep.hiring ?? {};
  const hiringMatches: any[] = hiringData.hiring_agent_matches ?? intel.hiring_agent_matches ?? [];
  const topHiringWedge = (intel.consultant as any)?.hiringAnalysis?.topHiringWedge ?? "";
  const isHiring = !!(hiringData.is_hiring || hiringMatches.length > 0
    || (intel as any).is_hiring || ((intel as any).job_count ?? 0) > 0);

  // Ads running flag — use || not ?? (false is not null, ?? stops at false)
  // Check normalized deep.ads path AND flat intel root (workflow data may not be normalized yet)
  const adsOn = !!(
    ts.is_running_ads || flags.is_running_ads || flags.has_fb_pixel || flags.has_google_ads
    || deep.ads?.is_running_google_ads || (deep.ads?.google_ads_count ?? 0) > 0
    || (deep.ads?.fb_ads_count ?? 0) > 0
    || (intel as any).is_running_google_ads || (intel as any).is_running_fb_ads
    || ((intel as any).google_ads_transparency_count ?? 0) > 0
    || ((intel as any).fb_ads_count ?? 0) > 0
  );

  // Script fills from consultant
  const heroQuote = sf.hero_header_quote ?? "";

  // ICP analysis from consultant (new in v9.5)
  const icpAnalysis = intel.consultant?.icpAnalysis ?? {};
  const icpProblems = icpAnalysis.icpProblems ?? [];
  const icpSolutions = icpAnalysis.icpSolutions ?? [];
  const websitePositive = sf.website_positive_comment ?? "";
  const icpGuess = sf.icp_guess ?? "";

  // Conversion event analysis from consultant — HOW THEY SELL
  const conversionAnalysis = (intel.consultant as any)?.conversionEventAnalysis ?? {};
  const agentTrainingLine: string = conversionAnalysis.agentTrainingLine ?? "";
  const allConversionEvents: string[] = conversionAnalysis.allConversionEvents ?? [];
  const primaryCTA: string = conversionAnalysis.primaryCTA ?? sf.top_2_website_ctas ?? "";
  const ctaBreakdown: Array<{ cta: string; type: string; agent: string; reason: string }> = conversionAnalysis.ctaBreakdown ?? [];
  const ctaAgentMapping: string = conversionAnalysis.ctaAgentMapping ?? "";
  const referenceOffer = sf.reference_offer ?? "";
  const recentReviewSnippet = sf.recent_review_snippet ?? "";

  // ── RAW-DATA FALLBACKS: when consultant scriptFills are empty, use raw intel ──
  const rawHero = intel.hero ?? (intel as any).fast_intel?.hero ?? {};
  const copyBellaLine = intel.consultant?.copyAnalysis?.bellaLine
    ?? intel.consultant?.valuePropAnalysis?.bellaLine ?? "";
  const rawOpenerFull = intel.bella_opener ?? "";
  const rawTagline = ci.tagline ?? rawHero.og_description ?? rawHero.meta_description ?? "";

  // Enriched versions: prefer consultant scriptFills, fall back to raw data
  const websitePositiveFinal = websitePositive
    || copyBellaLine
    || (rawTagline ? `Your positioning around "${rawTagline.slice(0, 100)}" really stands out` : "");
  const heroQuoteFinal = heroQuote
    || rawHero.h2
    || (rawHero.title ? rawHero.title.replace(/\s*[-–|].*/s, "").trim() : "")
    || "";

  switch (s.stage) {
    case "wow": {
      // Multi-turn WOW: 9 stalls, gate at 10 (Perplexity spec)
      // Order: 1=Research → 2=Reputation+Trial(skip if no reviews) → 3=ICP+Problems+Solutions →
      //   4=PreTrain → 5=Conversion → 6=AuditTransition → 7=LeadSource →
      //   8=Hiring → 9=ProvisionalRec+Bridge
      // IMPORTANT: stall is incremented BEFORE this function runs, so stall=1 is first turn

      // DISAGREEMENT HANDLING: If the prospect says something you mentioned is wrong or inaccurate,
      // acknowledge the correction immediately, thank them, and ask what the correct information is.
      // Do NOT move on until you've addressed their concern.
      if (s.user_disagreed) {
        return `WOW — DISAGREEMENT HANDLER
<DELIVER_THIS>Thanks for catching that, ${fn}. I appreciate the correction. Can you tell me the accurate information so I make sure our agents have the right data?</DELIVER_THIS>
Then STOP and wait for their response. Once they clarify, reset the disagreement flag mentally and continue with stall ${s.stall}.`;
      }

      // Consultant pre-built spoken lines (narratives)
      const convNarrative: string = (intel.consultant as any)?.conversionEventAnalysis?.conversionNarrative ?? "";
      const icpNarrative: string = icpAnalysis.icpNarrative ?? "";
      const marketPositionNarrative: string = icpAnalysis.marketPositionNarrative ?? "";
      const bellaCheckLine: string = icpAnalysis.bellaCheckLine ?? "";
      const routing = intel.consultant?.routing ?? {};
      const priorityAgents: string[] = (routing.priority_agents ?? []).map((a: string) =>
        a.charAt(0).toUpperCase() + a.slice(1).toLowerCase());

      if (s.stall === 1) {
        // ── 1. RESEARCH INTRO ──
        return `WOW — RESEARCH INTRO
<DELIVER_THIS>Now ${fn}, I think you'll be impressed. We've done some research on ${biz}, and we use that to pre-train your agents so they understand your ${ct}s, your industry, and how you win business. Can I quickly confirm a couple of our findings with you, just to make sure your agents are dialled in?</DELIVER_THIS>
Then STOP and wait for their response.`;
      }

      if (s.stall === 2) {
        // ── 2. REPUTATION + SHORT TRIAL — ONLY if Google reviews >= 3 stars ──
        const hasGoodRep = googleRating && googleRating >= 3;
        if (hasGoodRep) {
          s.trial_reviews_done = true;
          return `WOW — REPUTATION + TRIAL
<DELIVER_THIS>Oh ${fn}, I noticed ${biz} has a ${googleRating}-star reputation from ${googleReviews} reviews — that's strong. Businesses already delivering good ${ct} outcomes qualify for our free trial, so if you'd like, I can get that set up for you at any point during this demo.</DELIVER_THIS>
Then STOP and wait for their response.`;
        }
        // No reviews or < 3 stars — SKIP stall 2 entirely
        s.stall = 3;
      }

      if (s.stall === 3) {
        // ── 3. ICP + PROBLEMS + SOLUTIONS (combined per Perplexity spec) ──
        const shortBiz = shortBizName(biz);
        const cleanIcp = icpGuess
          ? icpGuess.replace(/^it\s+(looks|seems)\s+like\s+/i, "")
              .replace(/[,;—–-]+\s*(is that right|right|yeah)\??\s*$/i, "")
              .replace(/\?+$/, "").trim()
          : "";
        let insightText = "";

        // PRIORITY 1: icpNarrative — consultant pre-built spoken line (like conversionNarrative)
        if (icpNarrative) {
          insightText = icpNarrative;
        }
        // PRIORITY 2: mechanical stitch from raw arrays
        else if (cleanIcp && icpProblems.length >= 2 && icpSolutions.length >= 2) {
          insightText = `It looks like you're primarily targeting ${cleanIcp}. The typical challenges your ${ct}s face are ${icpProblems[0]} and ${icpProblems[1]}, and you solve those through ${icpSolutions[0]} and ${icpSolutions[1]}. Does that sound right?`;
        }
        // PRIORITY 3: positioning from referenceOffer
        else if (referenceOffer && cleanIcp) {
          insightText = `From your website, it looks like your positioning is really centred around ${referenceOffer}, and the way you present it suggests you're speaking to ${cleanIcp}. Does that sound right?`;
        }
        // LAST RESORT: bellaCheckLine or generic
        else if (bellaCheckLine) {
          insightText = bellaCheckLine;
        } else {
          insightText = `The site does a strong job of positioning what ${shortBiz} does. Does that sound right?`;
        }

        return `WOW — ICP + PROBLEMS + SOLUTIONS
<DELIVER_THIS>${insightText}</DELIVER_THIS>
Then STOP and wait for their response.`;
      }

      if (s.stall === 4) {
        // ── 4. PRE-TRAINING CONNECT (exact Perplexity text) ──
        let trialAppend = "";
        if (!s.trial_reviews_done) {
          s.trial_reviews_done = true;
          trialAppend = ` If you'd like, I can also help you activate the free trial during this session.`;
        }

        return `WOW — PRE-TRAINING CONNECT
<DELIVER_THIS>That's exactly the kind of business intelligence we've used to pre-train your AI team — so they don't sound generic. They understand your positioning, your ${ct}s, your reputation, and most importantly how you generate revenue.${trialAppend}</DELIVER_THIS>
Then STOP and wait for their response.`;
      }

      if (s.stall === 5) {
        // ── 5. CONVERSION EVENT ALIGNMENT — use consultant pre-built spoken lines ──
        let conversionLine = "";
        // Priority 1: conversionNarrative (already written for Bella to speak)
        if (convNarrative) conversionLine = convNarrative;
        // Priority 2: agentTrainingLine
        else if (agentTrainingLine) conversionLine = agentTrainingLine;
        // Priority 3: rebuild from primaryCTA
        else if (primaryCTA) conversionLine = `So looking at your website, it seems your main conversion event is ${primaryCTA}. That's how you turn interest into new ${ct}s, and it's exactly the kind of action we train your AI agents to drive more of, automatically`;
        else conversionLine = `And looking at how your site is set up to convert visitors into ${ct}s, that's exactly the kind of action we train our AI agents to drive more of, automatically`;

        return `WOW — CONVERSION EVENTS
<DELIVER_THIS>${conversionLine}. Would that be useful?</DELIVER_THIS>
End with "Would that be useful?" — soft close. Then STOP.`;
      }

      if (s.stall === 6) {
        // ── 6. AUDIT SETUP TRANSITION (bridge move, NOT a question — per Perplexity Channel Speed Rule) ──
        return `WOW — AUDIT TRANSITION
<DELIVER_THIS>Perfect — so that confirms your agents are trained to bring in the right kind of ${ct}s and move them toward your key conversion points. I've just got a couple of quick opportunity-audit questions so I can work out which agent mix would be most valuable for ${biz}.</DELIVER_THIS>
Then STOP and wait for their response.`;
      }

      if (s.stall === 7) {
        // ── 7. MAIN CONTROLLABLE SOURCE — 3 variants per Perplexity spec ──
        const hasStrongPhoneSignal = !!(flags.speed_to_lead_needed || flags.call_handling_needed);
        const sourceAlreadyClear = priorityAgents.length >= 2 && (adsOn || hasStrongPhoneSignal);
        const detectedChannel = adsOn ? "paid advertising" : hasStrongPhoneSignal ? "inbound phone calls" : "your website";

        let sourceQ = "";
        if (sourceAlreadyClear) {
          sourceQ = `Now ${fn}, apart from referrals, it looks like ${detectedChannel} is a meaningful source of new ${ct}s for you — is that fair to say?`;
        } else if (adsOn) {
          sourceQ = `Now ${fn}, I can see you're already running ads, which is interesting. Apart from referrals, would you say that's your main source of new ${ct}s, or is another channel doing most of the heavy lifting?`;
        } else {
          sourceQ = `Apart from referrals, what would you say is your main source of new ${ct}s right now — your website, phone calls, organic, paid ads, or something else?`;
        }
        return `WOW — LEAD SOURCE
SAY: "${sourceQ}"
ONE question. Then STOP.`;
      }

      if (s.stall === 8) {
        // ── 8. HIRING / CAPACITY WEDGE ──
        let hiringLine = "";
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
        return `WOW — HIRING WEDGE
SAY: "${hiringLine}"
Then STOP.`;
      }

      // stall 9: PROVISIONAL RECOMMENDATION + SHORT BRIDGE
      {
        const a1 = priorityAgents[0] ?? "Chris";
        const a2 = priorityAgents[1] ?? "Alex";

        let recLine = "";
        if (ctaAgentMapping) {
          recLine = `Based on what I've found so far, the likely standouts for ${biz} look like ${a1} and ${a2}. ${ctaAgentMapping}`;
        } else if (isHiring && hiringMatches.length > 0) {
          const topMatch = hiringMatches[0];
          const hiringAgent = topMatch.agents?.[0] ?? a1;
          recLine = `Based on what I've found so far, the likely standouts for ${biz} look like ${hiringAgent} and ${a2}. ${hiringAgent} would help with ${topMatch.wedge || "that role you're hiring for"}, and ${a2} would help with making sure every ${ct} lead gets followed up.`;
        } else {
          recLine = `Based on what I've found so far, the likely standouts for ${biz} look like ${a1} and ${a2}. ${a1} would help with engaging visitors on your website before they bounce, and ${a2} would help with following up every ${ct} enquiry.`;
        }
        recLine += ` If you want, I can now work out which of those would likely generate the most extra revenue for you.`;

        return `WOW — PROVISIONAL REC + BRIDGE
<DELIVER_THIS>${recLine}</DELIVER_THIS>
Then STOP and wait for approval. Do NOT ask for ACV yet — that comes next stage.`;
      }
    }

    case "deep_dive":
      // Auto-advances — shouldn't normally be seen
      return `Continue the WOW naturally. Bridge to numbers.`;

    case "anchor_acv":
      if (i.acv) return `ACV CONFIRMED: ${i.acv.toLocaleString()} dollars.
SAY: "Got it, thanks. And when you think about lead flow, do you usually measure it weekly or monthly?"
ONE question. STOP.`;
      return `ACV SETUP
<DELIVER_THIS>Perfect. What's a new ${ct} worth to ${biz} on average? A ballpark is totally fine.</DELIVER_THIS>
ONE question. STOP.`;

    case "anchor_timeframe":
      if (i.timeframe) return `TIMEFRAME CONFIRMED: ${i.timeframe}.
SAY: "Great, ${i.timeframe} it is."
Acknowledge briefly and advance to the first channel question.`;
      return `TIMEFRAME
ACV confirmed: ${i.acv ? i.acv.toLocaleString() + " dollars" : "(pending)"}.
SAY: "Got it, thanks. And when you think about lead flow, do you usually measure it weekly or monthly?"
ONE question. STOP.`;

    case "ch_ads": {
      const period = tf === "weekly" ? "week" : "month";
      const need: string[] = [];
      if (i.ads_leads == null) {
        if (adsOn) {
          need.push(`"How many leads are your ads generating per ${period}? Just a rough figure is fine."`);
        } else {
          need.push(`"I didn't see any Google or Facebook ads campaigns — is that right? Are you running any other online campaigns?"`);
        }
      }
      if (i.ads_leads != null && i.ads_conversions == null) {
        need.push(`"And roughly how many of those are converting into paying ${ct}s?"`);
      }
      if (i.ads_conversions != null && i.ads_followup == null) {
        need.push(`"And when those ad leads come in, how quickly is your team following up — under 30 minutes, 30 minutes to 3 hours, 3 to 24 hours, or more than 24 hours?"`);
      }
      // ALL INPUTS CAPTURED → DELIVER ROI IMMEDIATELY
      if (!need.length) {
        const alexCalc = calcAgentROI("Alex", i);
        if (alexCalc) {
          return `ADS — Alex — DELIVER ROI NOW
<DELIVER_THIS>So your average ${ct} is worth ${i.acv!.toLocaleString()} dollars, and you're currently converting ${i.ads_conversions} from ${i.ads_leads} ad leads per ${period}. Based on the follow-up speed you mentioned, Alex could conservatively add around ${alexCalc.weekly.toLocaleString()} dollars per week just by improving speed-to-lead. Does that make sense?</DELIVER_THIS>
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
        return `ADS — Alex — inputs captured but missing ACV for calc. Acknowledge and advance.`;
      }
      return `ADS CHANNEL — Alex
${i.ads_leads != null ? `Leads: ${i.ads_leads} ${period}. ` : ""}${i.ads_conversions != null ? `Conversions: ${i.ads_conversions}. ` : ""}${i.ads_followup != null ? `Follow-up: ${i.ads_followup}. ` : ""}
SAY THIS:
${need[0]}
ONE question. STOP.`;
    }

    case "ch_website": {
      const period = tf === "weekly" ? "week" : "month";
      const need: string[] = [];
      if (i.web_leads == null) {
        need.push(`"How many enquiries or leads is your website generating per ${period}?"`);
      }
      if (i.web_leads != null && i.web_conversions == null) {
        need.push(`"And roughly how many of those convert into paying ${ct}s?"`);
      }
      if (i.web_conversions != null && i.web_followup_speed == null) {
        need.push(`"And when a website enquiry comes in, how quickly is your team usually getting back to them?"`);
      }
      // ALL INPUTS CAPTURED → DELIVER ROI IMMEDIATELY
      if (!need.length) {
        const chrisCalc = calcAgentROI("Chris", i);
        if (chrisCalc) {
          return `WEBSITE — Chris — DELIVER ROI NOW
<DELIVER_THIS>So you're getting around ${i.web_leads} website leads per ${period}, and converting about ${i.web_conversions} of them into paying ${ct}s. Chris, our Website Concierge, typically lifts conversion by engaging visitors in real time, and at your value of ${i.acv!.toLocaleString()} dollars that could mean roughly ${chrisCalc.weekly.toLocaleString()} dollars per week in additional revenue. Does that sound reasonable?</DELIVER_THIS>
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
        return `WEBSITE — Chris — inputs captured but missing ACV for calc. Acknowledge and advance.`;
      }
      return `WEBSITE CHANNEL — Chris
${i.web_leads != null ? `Web leads: ${i.web_leads} ${period}. ` : ""}${i.web_conversions != null ? `Conversions: ${i.web_conversions}. ` : ""}${i.web_followup_speed != null ? `Follow-up: ${i.web_followup_speed}. ` : ""}
SAY THIS:
${need[0]}
ONE question. STOP.`;
    }

    case "ch_phone": {
      const period = tf === "weekly" ? "week" : "month";
      const need: string[] = [];
      if (i.phone_volume == null) {
        need.push(`"Roughly how many inbound calls does ${biz} get per ${period}?"`);
      }
      if (i.phone_volume != null && i.after_hours == null) {
        need.push(`"And when calls are missed — whether that's after hours or during busy periods — what usually happens?"`);
      }
      if (i.after_hours != null && !["24/7 coverage"].includes(i.after_hours) && i.missed_call_callback_speed == null) {
        need.push(`"And how quickly are missed calls usually called back?"`);
      }
      // 24/7 coverage → skip Maddie entirely
      if (i.after_hours === "24/7 coverage") return `PHONE — Maddie — 24/7 coverage confirmed. Skip Maddie, acknowledge and advance.`;
      // ALL INPUTS CAPTURED → DELIVER ROI IMMEDIATELY
      if (!need.length) {
        const maddieCalc = calcAgentROI("Maddie", i);
        if (maddieCalc) {
          return `PHONE — Maddie — DELIVER ROI NOW
<DELIVER_THIS>So you're getting around ${i.phone_volume} inbound calls per ${period}, and when calls are missed they're currently handled by ${i.after_hours}. Even a small percentage of missed opportunities there adds up fast, so conservatively Maddie could recover around ${maddieCalc.weekly.toLocaleString()} dollars per week in extra revenue by answering and qualifying more of those calls consistently. Does that track?</DELIVER_THIS>
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
        return `PHONE — Maddie — inputs captured but missing ACV for calc. Acknowledge and advance.`;
      }
      return `PHONE CHANNEL — Maddie
${i.phone_volume != null ? `Phone volume: ${i.phone_volume} ${period}. ` : ""}${i.after_hours != null ? `After hours: ${i.after_hours}. ` : ""}${i.missed_call_callback_speed != null ? `Callback speed: ${i.missed_call_callback_speed}. ` : ""}
SAY THIS:
${need[0]}
ONE question. STOP.`;
    }

    case "ch_old_leads": {
      if (i.old_leads != null) {
        const sarahCalc = calcAgentROI("Sarah", i);
        if (sarahCalc) {
          return `OLD LEADS — Sarah — DELIVER ROI NOW
<DELIVER_THIS>If even a small percentage of those older leads re-engage, Sarah could turn that dormant database into a real revenue channel. Based on the number you gave me, that could look like around ${sarahCalc.weekly.toLocaleString()} dollars per week in recovered opportunity. Sound fair?</DELIVER_THIS>
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
        return `OLD LEADS — Sarah — CONFIRMED: ${i.old_leads} leads but missing ACV. Acknowledge and advance.`;
      }
      return `OLD LEADS — Sarah
SAY THIS:
"How many past ${ct}s or older leads would you say are sitting in your database that haven't been contacted in a while?"
ONE question. STOP.`;
    }

    case "ch_reviews": {
      // stage_review_system_question
      const need: string[] = [];
      if (i.new_cust_per_period == null) {
        need.push(`"Roughly how many new ${ct}s do you bring in each ${tf === "weekly" ? "week" : "month"}?"`);
      }
      if (i.new_cust_per_period != null && i.star_rating == null) {
        need.push(`"What's your current average rating?"`);
      }
      if (i.star_rating != null && i.review_count == null) {
        need.push(`"Roughly how many reviews do you have?"`);
      }
      if (i.review_count != null && i.has_review_system == null) {
        const reviewLine = googleRating
          ? `And finally ${fn}, I see you have ${googleRating} stars from ${googleReviews} reviews. Do you have any kind of system that asks new ${ct}s for a review after you've delighted them with your service?`
          : `Do you have any kind of system that asks new ${ct}s for a review after you've delighted them with your service?`;
        need.push(`"${reviewLine}"`);
      }
      // ALL INPUTS CAPTURED → DELIVER ROI (only if no review system)
      if (!need.length) {
        const jamesCalc = calcAgentROI("James", i);
        if (jamesCalc && jamesCalc.weekly > 0) {
          return `REVIEWS — James — DELIVER ROI NOW
<DELIVER_THIS>With your current ${ct} flow, even a modest lift in review volume and response consistency can materially improve trust and conversion. Conservatively, James could create around ${jamesCalc.weekly.toLocaleString()} dollars per week in additional value by increasing review momentum and protecting your reputation. Does that seem realistic?</DELIVER_THIS>
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
        if (i.has_review_system === true) {
          return `REVIEWS — James — HAS REVIEW SYSTEM. Skip James, acknowledge and advance to roi_delivery.
SAY: "Great, sounds like you've already got that covered. Let me summarise the opportunity..."`;
        }
        return `REVIEWS — James — inputs captured but need data for calc. Acknowledge and advance.`;
      }
      return `REVIEWS — James
${i.new_cust_per_period != null ? `New ${ct}s: ${i.new_cust_per_period} ${tf}. ` : ""}${i.star_rating != null ? `Rating: ${i.star_rating}. ` : ""}${i.review_count != null ? `Reviews: ${i.review_count}. ` : ""}${i.has_review_system != null ? `Review system: ${i.has_review_system}. ` : ""}
SAY THIS:
${need[0]}
ONE question. STOP.`;
    }

    case "roi_delivery": {
      // TOTAL SUMMARY — clean format per Perplexity: agent-by-agent + combined total, NO annual, NO trial re-pitch
      const period = tf === "weekly" ? "week" : "month";
      if (top3.length) {
        const agentLines = top3.map(c => `${c.agent} at about ${c.weekly.toLocaleString()} dollars per ${period}`).join(", and ");
        return `ROI TOTAL — ADD THEM ALL UP
<DELIVER_THIS>So ${fn}, let me add that up for you. We've got ${agentLines}. That's a combined total of approximately ${total.toLocaleString()} dollars per ${period} in additional revenue across your selected agents — and those are conservative numbers. Does that all make sense?</DELIVER_THIS>
Then STOP and wait for their response. Let the total land. NO annual projection. NO trial pitch here.`;
      }
      return `ROI DELIVERY
Not enough inputs for precise ROI.
SAY: "I can see the opportunity clearly ${fn}, but I want to give you real numbers not guesses. Can I just confirm — what would you say is the average value of a new ${ct} to your business?"
Then STOP and wait.`;
    }

    case "close":
      return `CLOSE
<DELIVER_THIS>Perfect. Would you like to go ahead and activate your free trial? It takes about ten minutes to set up, there's no credit card required, and you could start seeing results this week.</DELIVER_THIS>`;

    default:
      return `${(s.stage as string).toUpperCase()} — continue naturally.`;
  }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getLid(messages: Msg[]): string {
  // Pattern: matches "lead_id:", "LEAD_ID =", "lead id:" etc.
  // CHARACTER FIX: original regex required [a-z] start — UUIDs start with hex digits.
  // New pattern: [a-z0-9] start, allows anon_, UUID, and any alphanumeric LID format.
  const LID_PATTERN = /lead[\s_]id\b[\s\w]*?[:=]\s*([a-z0-9][a-z0-9_-]{3,})/i;

  // Pass 1: system message (primary — Voice Agent injects LID here)
  const sys = messages.find(m => m.role === "system")?.content ?? "";
  const m1 = typeof sys === "string" ? sys.match(LID_PATTERN) : null;
  if (m1?.[1]) return m1[1];

  // Pass 2: scan ALL messages — catches Turn-2+ continuity hole where system
  // message may no longer be present in the trimmed history window.
  for (const msg of messages) {
    const content = typeof msg.content === "string" ? msg.content : "";
    const m2 = content.match(LID_PATTERN);
    if (m2?.[1]) return m2[1];
  }

  return "";
}

function lastUser(messages: Msg[]): string {
  const u = messages.filter(m => m.role === "user");
  const l = u[u.length - 1];
  return typeof l?.content === "string" ? l.content : "";
}

// ─── GEMINI STREAMING → DEEPGRAM ─────────────────────────────────────────────

async function streamToDeepgram(
  messages: Msg[],
  env: Env,
  doReplyCallback?: (spokenText: string) => Promise<void> | void,
  doFailureCallback?: (errorCode: string) => Promise<void> | void,
  ctx?: ExecutionContext,
): Promise<Response> {
  const t0 = Date.now();

  // Workers AI call (switched from Gemini 2026-04-08)
  let responseText = "";
  try {
    const systemMsg = messages.find(m => m.role === "system")?.content ?? "";
    const userMsgs = messages.filter(m => m.role === "user" || m.role === "assistant");

    log("WORKERS_AI_PROMPT", `sys_chars=${systemMsg.length} user_msgs=${userMsgs.length}`);

    function extractAIText(result: any): string {
      if (!result) return '';
      let text = '';
      if (typeof result === 'string') text = result;
      else if (typeof result?.response === 'string') text = result.response;
      else if (typeof result?.result?.response === 'string') text = result.result.response;
      else if (Array.isArray(result?.result)) text = (result.result as any[]).map((r: any) => r?.response || '').join('');
      // Strip Qwen3 thinking blocks — reasoning model emits <think>...</think> before answering
      return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    }

    // Call Workers AI — must use messages array format, not prompt string
    const result = await env.AI.run("@cf/qwen/qwen3-30b-a3b-fp8", {
      messages: [
        { role: "system", content: systemMsg },
        ...userMsgs
      ],
      max_tokens: 3000,
    }) as any;

    log("WORKERS_AI_RAW", `shape=${JSON.stringify(result).slice(0, 400)}`);
    responseText = extractAIText(result) || "Give me one moment.";
    const ttfb = Date.now() - t0;
    log("WORKERS_AI_TTFB", `${ttfb}ms success chars=${responseText.length}`);
  } catch (e: any) {
    const ttfb = Date.now() - t0;
    log("WORKERS_AI_ERR", `${ttfb}ms: ${e.message}`);
    log("BELLA_SILENT", `reason=workers_ai_error utterance="Give me one moment."`);
    if (doFailureCallback) {
      try { await doFailureCallback(`workers_ai_error`); } catch { }
    }
    const fallback = [
      `data: {"id":"f","object":"chat.completion.chunk","model":"${MODEL}","choices":[{"index":0,"delta":{"content":"Give me one moment."},"finish_reason":null}]}`,
      `data: {"id":"f","object":"chat.completion.chunk","model":"${MODEL}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
      "data: [DONE]\n",
    ].join("\n");
    return new Response(fallback, { headers: { "Content-Type": "text/event-stream" } });
  }

  // Create SSE stream with chunked response
  const gemRes = new Response(
    responseText.split(" ").reduce((acc, word) => {
      return acc + `data: {"id":"f","object":"chat.completion.chunk","model":"${MODEL}","choices":[{"index":0,"delta":{"content":"${word} "},"finish_reason":null}]}\n\n`;
    }, "") + `data: {"id":"f","object":"chat.completion.chunk","model":"${MODEL}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\ndata: [DONE]\n`,
    { headers: { "Content-Type": "text/event-stream" } }
  );

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const streamPromise = (async () => {
    const reader = gemRes.body!.getReader();
    let firstContentAt = 0;
    let chunkCount = 0;
    let sseBuffer = "";
    let responseText = "";
    // Stream-instance-local guards — prevent duplicate callbacks
    let replySent = false;
    let failureSent = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount++;
        if (chunkCount === 1) {
          firstContentAt = Date.now() - t0;
          log("GEMINI_FIRST_CHUNK", `${firstContentAt}ms`);
        }

        // Parse SSE chunks, filter apology phrases from content, then write
        sseBuffer += dec.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";  // keep incomplete line in buffer
        let modified = false;
        const outputLines: string[] = [];
        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") {
            outputLines.push(line);
            continue;
          }
          try {
            const chunk = JSON.parse(line.slice(6));
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) {
              // P1-T2: Strip apology phrases before TTS
              const cleaned = stripApologies(delta);
              if (cleaned !== delta) {
                modified = true;
                chunk.choices[0].delta.content = cleaned;
                outputLines.push("data: " + JSON.stringify(chunk));
              } else {
                outputLines.push(line);
              }
              responseText += cleaned;
            } else {
              outputLines.push(line);
            }
            // Usage info appears in the final chunk
            if (chunk.usage) {
              const u = chunk.usage;
              const cached = u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? 0;
              log("GEMINI_USAGE", `prompt=${u.prompt_tokens ?? "?"} cached=${cached} completion=${u.completion_tokens ?? "?"} total=${u.total_tokens ?? "?"}`);
            }
          } catch {
            outputLines.push(line);
          }
        }
        await writer.write(enc.encode(outputLines.join("\n") + "\n"));
        if (modified) log("APOLOGY_FILTER", "Stripped apology phrase from response chunk");
      }
      const totalMs = Date.now() - t0;
      // Full-response sanitization pass: catches chunk-split artifacts that per-chunk filtering missed
      const hadArtifacts = hasPromptArtifacts(responseText);
      const sanitizedResponse = stripApologies(responseText);
      if (hadArtifacts) log("OUTPUT_SANITIZED", "reason=prompt_artifact");
      log("BELLA_SAID", sanitizedResponse.slice(0, 2000));
      log("GEMINI_DONE", `total=${totalMs}ms chunks=${chunkCount} first_chunk=${firstContentAt}ms`);
      await writer.write(enc.encode("data: [DONE]\n\n"));
      // P0 FIX: close writer IMMEDIATELY after [DONE] — never block on callback
      // Old code awaited doReplyCallback here, which fetches brain DO.
      // If DO stalled, writer.close() never ran → CF detected hung worker → call death.
      writer.close().catch(() => { });
      // Fire callback fire-and-forget — ctx.waitUntil keeps worker alive
      if (doReplyCallback && !replySent) {
        replySent = true;
        if (ctx) {
          ctx.waitUntil(Promise.resolve().then(() => doReplyCallback(sanitizedResponse)).catch(() => {}));
        } else {
          try { await doReplyCallback(sanitizedResponse); } catch { }
        }
      }
    } catch (e) {
      const errStr = String(e);
      const isCancel = errStr.includes('undefined') || errStr.includes('abort') || errStr.includes('cancel') || errStr.includes('network');

      if (isCancel && responseText.length > 0) {
        // Deepgram cancelled but we got partial response — treat as soft success
        log("GEMINI_STREAM_CANCELLED", `partial=${responseText.length}chars chunks=${chunkCount}`);
        const sanitizedResponse = stripApologies(responseText);
        log("BELLA_SAID", sanitizedResponse.slice(0, 2000)); // Log partial response (Bug 3 fix)
        if (doReplyCallback && !replySent) {
          replySent = true;
          if (ctx) {
            ctx.waitUntil(Promise.resolve().then(() => doReplyCallback(sanitizedResponse)).catch(() => {}));
          } else {
            try { await doReplyCallback(sanitizedResponse); } catch { }
          }
        }
      } else {
        // True failure — no response at all or genuine Gemini error
        log("GEMINI_STREAM_ERR", `${errStr}`);
        log("BELLA_SILENT", `reason=stream_error utterance="Give me one moment"`); // Fallback spoken
        if (doFailureCallback && !failureSent) {
          failureSent = true;
          try { await doFailureCallback(`stream_error:${errStr.slice(0, 200)}`); } catch { }
        }
      }
    }
    finally { writer.close().catch(() => { }); }
  })();

  // FIX1: protect callback delivery against client disconnect.
  // ctx.waitUntil ensures the CF runtime keeps this worker alive until
  // streamPromise resolves — even if the client (Deepgram/voice-agent)
  // closes the HTTP connection before the IIFE finishes.
  if (ctx) ctx.waitUntil(streamPromise);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache", "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ─── DETERMINISTIC DELIVERY (Sprint E2A) ─────────────────────────────────────
// Returns pre-built text as Chat Completions SSE — no Gemini call, no hallucination.
// Voice Agent doesn't care whether the response came from a real LLM.

function streamDeterministicResponse(
  text: string,
  doReplyCallback?: (spokenText: string) => Promise<void> | void,
  ctx?: ExecutionContext,
): Response {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  const detPromise = (async () => {
    try {
      const id = `det-${Date.now()}`;
      // Content chunk
      const chunk = {
        id,
        object: "chat.completion.chunk",
        model: MODEL,
        choices: [{
          index: 0,
          delta: { role: "assistant", content: text },
          finish_reason: null,
        }],
      };
      await writer.write(enc.encode(`data: ${JSON.stringify(chunk)}\n\n`));

      // Finish chunk
      const finishChunk = {
        id,
        object: "chat.completion.chunk",
        model: MODEL,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: "stop",
        }],
      };
      await writer.write(enc.encode(`data: ${JSON.stringify(finishChunk)}\n\n`));
      await writer.write(enc.encode("data: [DONE]\n\n"));

      log("DETERMINISTIC_DELIVERY", `streamed ${text.length} chars`);
      log("BELLA_SAID", text.slice(0, 2000));

      // P0 FIX: close writer IMMEDIATELY — never block on callback
      writer.close().catch(() => {});
      // Fire reply callback fire-and-forget
      if (doReplyCallback) {
        if (ctx) {
          ctx.waitUntil(Promise.resolve().then(() => doReplyCallback(text)).catch(() => {}));
        } else {
          try { await doReplyCallback(text); } catch { }
        }
      }
    } finally {
      writer.close().catch(() => {});
    }
  })();

  // FIX1: protect deterministic callback against client disconnect
  if (ctx) ctx.waitUntil(detPromise);

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ─── DO BRAIN INTEGRATION (Phase C) ──────────────────────────────────────────

// NextTurnPacket shape (mirrors call-brain-do/src/types.ts)
interface DONextTurnPacket {
  stage: string;
  wowStall: number | null;
  objective: string;
  chosenMove: { id: string; kind: string; text: string };
  criticalFacts: string[];
  contextNotes?: string[];
  extractTargets: string[];
  validation: { mustCaptureAny: string[]; advanceOnlyIf: string[]; doNotAdvanceIf: string[] };
  style: { tone: string; industryTerms: string[]; maxSentences: number; noApology: boolean };
  roi?: { agentValues: Record<string, number>; totalValue: number };
  activeMemory?: string[];
  complianceChecks?: { mustContainPhrases: string[] };
  mandatory?: boolean;  // true = bridge must deliver text exactly, no LLM paraphrase
}

interface DOTurnResponse {
  packet: DONextTurnPacket;
  extraction: { applied: string[]; confidence: number; normalized: Record<string, string> };
  extractedState?: Record<string, any>;
  advanced: boolean;
  stage: string;
  wowStall: number;
}

/**
 * buildDOTurnPrompt — V9.19.0
 * Rich directive from DO packet. Includes MANDATORY SCRIPT, DELIVER_THIS tags,
 * CONFIRMED THIS CALL, LIVE ROI, CONTEXT, and OUTPUT RULES (V2).
 * Target: ~1.5K chars.
 */
function buildDOTurnPrompt(doResult: DOTurnResponse, rawBizName?: string): string {
  const packet = doResult.packet;
  const extracted = doResult.extractedState ?? {};

  // Apply TTS acronym formatting to DO speak text (DO stores raw name in state)
  let speakText = packet.chosenMove.text;
  if (rawBizName) {
    const ttsBiz = ttsAcronym(rawBizName);
    if (ttsBiz !== rawBizName) {
      speakText = speakText.replaceAll(rawBizName, ttsBiz);
    }
  }

  // ── MANDATORY SCRIPT with DELIVER_THIS tags ──
  const scriptBlock = `====================================
MANDATORY SCRIPT — FOLLOW EXACTLY
====================================
OBJECTIVE: ${packet.objective}
STAGE: ${packet.stage.toUpperCase()} ${packet.wowStall != null ? `| STALL: ${packet.wowStall}` : ''}

<DELIVER_THIS>${speakText}</DELIVER_THIS>
====================================`;

  // ── CONFIRMED THIS CALL — prevent re-asking captured data ──
  const confirmedEntries = Object.entries(extracted).filter(([_, v]) => v != null && v !== '' && v !== false);
  const confirmedSection = confirmedEntries.length > 0
    ? `\nCONFIRMED THIS CALL (DO NOT re-ask ANY of these — the prospect already told you):\n${confirmedEntries.map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`
    : '';

  // ── LIVE ROI — for channel stages ──
  const roiSection = packet.roi
    ? `\nLIVE ROI:\n${Object.entries(packet.roi.agentValues).map(([agent, val]) => `- ${agent}: $${val.toLocaleString()}/week`).join('\n')}\n- TOTAL: $${packet.roi.totalValue.toLocaleString()}/week\n`
    : '';

  // ── CRITICAL FACTS — stable truths about the business (whole call) ──
  const criticalFactsSection = packet.criticalFacts.length > 0
    ? `\nCRITICAL FACTS (stable truths about this business — always valid, never change mid-call):\n${packet.criticalFacts.slice(0, 6).map(f => `- ${f}`).join('\n')}\n`
    : '';

  // ── CONTEXT — stage-specific dynamic grounding (changes each turn) ──
  const contextNotes = packet.contextNotes ?? [];
  const contextSection = contextNotes.length > 0
    ? `\nCONTEXT (stage-specific grounding — relevant right now):\n${contextNotes.slice(0, 6).map(f => `- ${f}`).join('\n')}\n`
    : '';

  // ── ACTIVE MEMORY — things the prospect or Bella have said that matter ──
  const memoryLines = packet.activeMemory ?? [];
  const memorySection = memoryLines.length > 0
    ? `\nACTIVE MEMORY (use naturally — do not read aloud or reference directly):\n${memoryLines.map(m => `- ${m}`).join('\n')}\n`
    : '';

  // ── OUTPUT RULES (V2) ──
  const outputRules = `OUTPUT RULES (V2)
1. ONLY SPOKEN WORDS. No labels, headers, XML tags, markdown, code formatting, or symbols in the output.
2. Use up to 3 statements and one question per turn, 4 sentences maximum.
3. Say numbers naturally in spoken form. Say dollar amounts as "[number] dollars".
4. NEVER APOLOGISE, NEVER BACKTRACK, NEVER DEFLECT. If the prospect challenges a number, say "That's the conservative estimate from our model" and move to the current directive. Never say sorry, my mistake, good catch, I misspoke, you're right to pull me up, I missed the mark, I got ahead of myself, or any synonym of apology. Never say "thanks for the feedback", "that's fair", "that's a valid point", "I appreciate the feedback", "I hear you", or any hedging deflection. Hold frame — acknowledge briefly then redirect to the directive.
5. SCRIPT COMPLIANCE: Deliver the scripted instruction from the MANDATORY SCRIPT section exactly as written. You may add ONE brief natural sentence before it, but the scripted line must remain WORD-FOR-WORD unchanged. Do not recalculate, paraphrase, or break the scripted numbers into sub-calculations.
6. QUESTION COMPLIANCE: If the prospect gives filler instead of answering a question, briefly acknowledge and re-ask. Do not pretend the question was answered.
7. Do not mention missing data, internal systems, routing logic, controllers, calculators, or enrichment pipelines.
8. Do not improvise ROI formulas or benchmark claims. Use ONLY the exact dollar figures from the LIVE ROI section and the DELIVER_THIS text. Never multiply, divide, or restate the math yourself.
9. NO PHANTOM ROI: If the LIVE ROI section is empty or absent, do NOT reference any dollar uplift, weekly/monthly value, or "conservative estimate". You have NO calculated numbers to cite — talk about the methodology and what the agents CAN do, not fabricated dollar amounts.`;

  return `${scriptBlock}
${confirmedSection}${roiSection}${criticalFactsSection}${contextSection}${memorySection}
STYLE: tone=${packet.style.tone}; terms=${packet.style.industryTerms.join(', ')}; max ${packet.style.maxSentences} sentences

${outputRules}`;
}

/**
 * callDOTurn — POST /turn to Call Brain DO via service binding.
 * Returns the parsed DOTurnResponse or null on failure.
 */
async function callDOTurn(
  lid: string,
  transcript: string,
  turnId: string,
  env: Env,
  identity?: { firstName?: string; businessName?: string; industry?: string },
): Promise<DOTurnResponse | null> {
  try {
    const res = await env.CALL_BRAIN.fetch(
      new Request(`https://do-internal/turn-v2-compat?callId=${encodeURIComponent(lid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-call-id': lid },
        body: JSON.stringify({ leadId: lid, transcript, turnId, identity }),
        signal: AbortSignal.timeout(8000),
      }),
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => 'no-body');
      log('DO_ERR', `turn failed: status=${res.status} body=${errText}`);
      return null;
    }
    return await res.json() as DOTurnResponse;
  } catch (e: any) {
    log('DO_ERR', `turn exception: ${e.message}`);
    return null;
  }
}

/**
 * retryFetch — fire-and-retry with short backoff for DO callbacks.
 * Idempotent by deliveryId on the DO side.
 */
async function retryFetch(
  request: Request,
  fetcher: Fetcher,
  tag: string,
  maxAttempts: number = 3,
  backoffMs: number = 200,
): Promise<Response | null> {
  const bodyText = request.body ? await new Response(request.body).text() : undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetcher.fetch(new Request(request.url, { method: request.method, headers: request.headers, body: bodyText, signal: AbortSignal.timeout(8000) }));
      if (res.ok) {
        log(tag, `attempt=${attempt} status=${res.status}`);
        return res;
      }
      log(tag, `attempt=${attempt} non-ok status=${res.status}`);
    } catch (e: any) {
      log(`${tag}_ERR`, `attempt=${attempt} ${e.message}`);
    }
    if (attempt < maxAttempts) {
      await new Promise(r => setTimeout(r, backoffMs * attempt));
    }
  }
  log(`${tag}_EXHAUSTED`, `all ${maxAttempts} attempts failed`);
  return null;
}

/**
 * callDOLlmReplyDone — After Gemini finishes streaming, notify DO.
 * Includes deliveryId for flow harness correlation.
 * Retries 3x with backoff (DO callbacks are idempotent by deliveryId).
 */
async function callDOLlmReplyDone(
  lid: string,
  moveId: string,
  deliveryId: string,
  spokenText: string,
  env: Env,
  compliance?: { compliance_status: 'pass' | 'drift'; compliance_score: number; missed_phrases: string[] },
): Promise<void> {
  const request = new Request(`https://do-internal/event?callId=${encodeURIComponent(lid)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-call-id': lid },
    body: JSON.stringify({
      type: 'llm_reply_done',
      spokenText: spokenText.slice(0, 2000),
      moveId,
      deliveryId: deliveryId || undefined,
      ts: new Date().toISOString(),
      ...(compliance ?? {}),
    }),
  });
  await retryFetch(request, env.CALL_BRAIN, 'DO_REPLY');
}

/**
 * callDODeliveryFailed — notify DO that Gemini stream errored.
 * Fires on definite generation failure — Gemini 4xx/5xx or stream exception.
 * Retries 3x. DO decides whether failure is retryable.
 */
async function callDODeliveryFailed(
  lid: string,
  moveId: string,
  deliveryId: string,
  errorCode: string,
  env: Env,
): Promise<void> {
  const request = new Request(`https://do-internal/event?callId=${encodeURIComponent(lid)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-call-id': lid },
    body: JSON.stringify({
      type: 'delivery_failed',
      deliveryId: deliveryId || undefined,
      moveId,
      errorCode: String(errorCode).slice(0, 500),
      ts: new Date().toISOString(),
    }),
  });
  await retryFetch(request, env.CALL_BRAIN, 'DO_FAIL');
}

// callDOSessionInit REMOVED (v9.21.0) — identity now forwarded via /turn payload on every call.
// DO self-heals via ensureSession; bridge passes identity inline.

/**
 * shadowDOCall — T015: Background DO call for shadow mode comparison.
 * Fires via ctx.waitUntil when USE_DO_BRAIN=false.
 */
async function shadowDOCall(
  lid: string,
  transcript: string,
  turnId: string,
  turnNum: number,
  oldStage: string,
  oldStall: number,
  intel: Record<string, any>,
  env: Env,
): Promise<void> {
  try {
    // DO self-heals via ensureSession — no separate init needed
    const doResult = await callDOTurn(lid, transcript, turnId, env);
    if (doResult) {
      const doMoveId = doResult.packet?.chosenMove?.id ?? 'unknown';
      const stageMatch = oldStage === doResult.stage ? 'MATCH' : 'DIFF';
      log('SHADOW_DIFF', `${stageMatch} old_stage=${oldStage} do_stage=${doResult.stage} old_stall=${oldStall} do_stall=${doResult.wowStall} do_move=${doMoveId} extracted=[${doResult.extraction?.applied?.join(',') ?? ''}]`);
    }
  } catch (e: any) {
    log('SHADOW_ERR', `${e.message}`);
  }
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, {
      status: 204, headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      }
    });


    if (url.pathname.startsWith("/v9/debug/")) {
      const dbgLid = url.pathname.split("/").pop();
      try {
        // SCHEMA v4: Return merged intel from all 3 sources
        const intel = await loadMergedIntel(dbgLid!, env);
        return new Response(JSON.stringify(intel, null, 2), { headers: { "content-type": "application/json" } });
      } catch (e: any) {
        return new Response(e.message, { status: 500 });
      }
    }

    if (url.pathname === "/health") return new Response(
      JSON.stringify({
        status: "ok", version: VERSION, model: MODEL,
        arch: "rich-orchestrator: full prompt, awaited extraction, history distillation"
      }),
      { headers: { "Content-Type": "application/json" } }
    );

    if (url.pathname !== "/v9/chat/completions" || req.method !== "POST")
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });

    let body: any;
    try { body = await req.json(); }
    catch { return new Response(JSON.stringify({ error: "Bad JSON" }), { status: 400 }); }

    const messages: Msg[] = body.messages ?? [];
    let lid = getLid(messages);
    const sysMsg = messages.find(m => m.role === "system")?.content ?? "";

    // Fallback: if lid not in messages, check URL query params (from v11 voice agent)
    if (!lid) {
      const urlParams = new URLSearchParams(url.search);
      lid = urlParams.get('lid') || '';
    }

    log("REQ", `lid=${lid} msgs=${messages.length} sys_has_lid=${sysMsg.includes('lead_id')} sys_chars=${sysMsg.length}`);
    log("SCRIBE_CONFIG", `enabled=true do_path=${env.USE_DO_BRAIN === 'true'} brain=${!!env.CALL_BRAIN} llm=workers-ai`);

    // ── DIAGNOSTIC: log first-turn system message so we can see what Deepgram sends us
    if (messages.length <= 2) {
      const sys = messages.find(m => m.role === "system");
      const sysContent = typeof sys?.content === "string" ? sys.content : "";
      log("DIAG", `turn=${messages.length} sys_chars=${sysContent.length} lid_found=${!!lid} sys_preview="${sysContent.slice(0, 120)}"`);
    }

    // ── PARALLEL KV LOAD: call_brief (SUPERGOD) OR merged keys (fallback) ──
    // SUPERGOD v8: Try single call_brief key first, fall back to merged keys
    let intel: Record<string, any> = {};
    let loadedState: State | null = null;
    let convMemory = "";
    let intelSource = "none";
    if (lid) {
      // Try SUPERGOD call_brief first
      const callBrief = await loadCallBrief(lid, env);
      if (callBrief && callBrief.status) {
        // SUPERGOD path: single unified call_brief
        intel = callBrief;
        intelSource = `call_brief:${callBrief.status}`;
        log("SUPERGOD", `lid=${lid} using call_brief (status=${callBrief.status})`);
      } else {
        // Fallback: merged keys (v6/v9 compat)
        intel = await loadMergedIntel(lid, env);
        intelSource = "merged_keys";
      }

      // Load state + memory in parallel
      const [rawState, rawMemory] = await Promise.all([
        env.LEADS_KV.get(`lead:${lid}:script_state`),
        env.LEADS_KV.get(`lead:${lid}:conv_memory`),
      ]);
      try { if (rawState) loadedState = JSON.parse(rawState); } catch { }
      convMemory = rawMemory ?? "";
    }

    // FALLBACK: extract identity from voice agent system prompt when KV intel is empty.
    // V9 format: "prospect_first_name: X. prospect_business: Y."
    // V11 format: "FIRST NAME: X\nBUSINESS: Y"
    if (!intel.first_name || !intel.business_name) {
      const sys = messages.find(m => m.role === "system")?.content ?? "";
      if (typeof sys === "string") {
        // V9 patterns
        const fnMatch = sys.match(/prospect_first_name:\s*([^.]+)/) ?? sys.match(/FIRST NAME:\s*(.+)/);
        const bizMatch = sys.match(/prospect_business:\s*([^.]+)/) ?? sys.match(/BUSINESS:\s*(.+)/);
        if (fnMatch?.[1] && fnMatch[1].trim() !== "unknown" && fnMatch[1].trim() !== "" && !intel.first_name) {
          intel.first_name = fnMatch[1].trim();
          intel.firstName = fnMatch[1].trim();
          log("FALLBACK", `first_name="${intel.first_name}" from system prompt`);
        }
        if (bizMatch?.[1] && bizMatch[1].trim() !== "unknown" && bizMatch[1].trim() !== "your business" && !intel.business_name) {
          intel.business_name = bizMatch[1].trim();
          log("FALLBACK", `business_name="${intel.business_name}" from system prompt`);
        }
      }
    }

    // ── SCHEMA v3: Backward compat for old KV data (30-day TTL migration) ──
    // Old data has intel.intel.deep, new data has intel.deep at root
    if (!intel.deep && intel.intel?.deep) {
      intel.deep = intel.intel.deep;
    }
    // Old data has phase A marketing_intelligence nested
    if (!intel.consultant && intel.intel?.phaseA?.marketing_intelligence) {
      intel.consultant = intel.intel.phaseA.marketing_intelligence;
    }

    // ── Enrich flags with review data from deep-scrape ──
    // SCHEMA v3: Read directly from intel.deep.googleMaps (no website_health indirection)
    {
      const f = intel.flags ?? {};
      const deep = (intel as any).intel?.deep ?? intel.deep ?? {}; // Check intel.intel.deep (big scraper) then root deep
      const rc = deep.googleMaps?.review_count ?? intel.star_rating ?? 0;
      const reviewCount = typeof rc === 'string' ? parseInt(rc, 10) || 0 : rc;
      if (!f.review_signals && reviewCount > 0) {
        f.review_signals = true;
        log("ENRICH", `review_signals=true (${reviewCount} reviews from deep-scrape)`);
      }
      intel.flags = f;
    }

    // FIX 3: intel.top_fix — synthesised from consultant.mostImpressive[0]
    if (!intel.top_fix && intel.consultant?.mostImpressive?.length) {
      const top = intel.consultant.mostImpressive[0];
      intel.top_fix = {
        copyHeadline: top.finding ?? "",
        copyBody: top.bellaLine ?? top.source ?? "",
      };
    }

    // FIX 4: intel.pitch_hook — use consultant.websiteCompliments[0].bellaLine
    if (!intel.pitch_hook && intel.consultant?.websiteCompliments?.length) {
      intel.pitch_hook = intel.consultant.websiteCompliments[0]?.bellaLine ?? "";
    }

    // FIX 5: intel.close_strategies — map from consultant.conversationHooks
    if (!intel.close_strategies && intel.consultant?.conversationHooks?.length) {
      intel.close_strategies = intel.consultant.conversationHooks
        .map((h: any) => h.how ?? h.topic ?? "")
        .filter(Boolean)
        .slice(0, 3);
    }

    // FIX 6: intel.recent_reviews — hoist Apify Google Maps reviews to root
    // These are used in the reviews intel section (capped at 25 words each)
    if (!intel.recent_reviews && intel.deep?.googleMaps?.recent_reviews?.length) {
      intel.recent_reviews = intel.deep.googleMaps.recent_reviews;
    }

    // ── DO BRAIN PATH (Phase C — V9.17.0) ──────────────────────────────────
    // DO owns state, extraction, gating. Bridge builds rich directive from
    // NextTurnPacket + full reference data from buildFullSystemContext.
    // Bridge passes identity on every /turn so DO always has business name.
    const useDoPath = env.USE_DO_BRAIN === 'true' && !!lid;
    if (useDoPath) {
      const utt = lastUser(messages);
      // FIX (2026-04-08): count user messages only, not total messages (system msg doesn't count as turn)
      // First user message = turn 0, second = turn 1, etc.
      const userMsgCount = messages.filter(m => m.role === 'user').length;
      const turnNum = Math.max(0, userMsgCount - 1);
      // P2 FIX: SHA-256 content-hash turnId — same utterance = same hash = stable dedup
      // Old code used plain turnNum which caused false dedup hits on retransmits with different content
      const turnIdHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${turnNum}:${utt}`));
      const turnId = `${turnNum}_${[...new Uint8Array(turnIdHash.slice(0, 8))].map(b => b.toString(16).padStart(2, '0')).join('')}`;
      log('DO_PATH', `lid=${lid} turn=${turnNum} turnId=${turnId} utt_chars=${utt.length}`);

      // Extract identity from loaded intel for DO (bridge always has KV data)
      const ci = intel.core_identity ?? {};
      // Build supplement: bridge has merged KV data that the DO may not have received via events
      const _suppRating = parseFloat(intel.star_rating ?? intel.places?.rating) || null;
      const _suppReviews = parseInt(intel.review_count ?? intel.places?.review_count) || 0;
      const _suppConsultant = intel.consultant ?? null;
      // Deep intel supplement — forward if KV has deep data with status=done
      const _suppDeep = (intel.deep?.status === 'done') ? intel.deep : null;
      // Fast intel core fields — forward if KV has fast-intel data
      const _suppFast = intel.core_identity ? {
        core_identity: intel.core_identity,
        flags: intel.flags ?? null,
        tech_stack: intel.tech_stack ?? null,
        bella_opener: intel.bella_opener ?? null,
      } : null;
      const doIdentity = {
        firstName: intel.first_name ?? intel.firstName ?? ci.first_name ?? '',
        businessName: intel.business_name ?? ci.business_name ?? '',
        industry: ci.industry ?? ci.industry_key ?? intel.industry ?? '',
        supplement: {
          rating: _suppRating,
          reviewCount: _suppReviews,
          consultant: _suppConsultant,
          deep: _suppDeep,
          fast: _suppFast,
        },
      };
      log('DO_IDENTITY', `fn="${doIdentity.firstName}" biz="${doIdentity.businessName}" ind="${doIdentity.industry}" supp_rating=${_suppRating ?? 'none'} supp_consultant=${!!_suppConsultant} supp_deep=${!!_suppDeep} supp_fast=${!!_suppFast}`);

      const doResult = await callDOTurn(lid, utt, turnId, env, doIdentity);
      if (!doResult) {
        // DO failed — fall through to old path
        log('DO_FALLBACK', `DO call failed for lid=${lid} — falling back to old path`);
      } else {
        // P0-D: dedup skip — if DO returns cached turn, no-op replay (DO advances via its own alarm)
        // Do NOT send llm_reply_done — cached deliveryId may be stale, causing DO to reject and get stuck
        if ((doResult as any).dedup === true) {
          log('DEDUP_SKIP', `lid=${lid} moveId=${doResult.packet?.chosenMove?.id ?? 'unknown'} — no-op replay, DO advances via alarm`);
          return new Response('data: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
        }

        // KV export: write captured_inputs, conv_memory, script_state from DO path
        if (lid && doResult && doResult.extraction) {
          const extractedState = doResult.extractedState as Record<string, any>;

          // 1. captured_inputs
          const capturedPayload = JSON.stringify({
            ...doResult.extraction.normalized,
            updated_at: new Date().toISOString(),
            stage: doResult.stage,
            lid,
          });
          ctx.waitUntil(env.LEADS_KV.put(`lead:${lid}:captured_inputs`, capturedPayload).catch(e => {
            log("KV_WRITE_ERR", `DO path captured_inputs error=${e?.message || e}`);
          }));

          // 2. script_state
          if (extractedState) {
            ctx.waitUntil(env.LEADS_KV.put(`lead:${lid}:script_state`, JSON.stringify(extractedState)).catch(e => {
              log("KV_WRITE_ERR", `DO path script_state error=${e?.message || e}`);
            }));
          }

          // 3. conv_memory
          if (extractedState && extractedState.memoryNotes && Array.isArray(extractedState.memoryNotes)) {
            const memLines = extractedState.memoryNotes
              .filter((n: any) => n.status === 'active')
              .map((n: any) => `[${n.category}] ${n.text}`)
              .join('\n');
            if (memLines) {
              ctx.waitUntil(env.LEADS_KV.put(`lead:${lid}:conv_memory`, memLines).catch(e => {
                log("KV_WRITE_ERR", `DO path conv_memory error=${e?.message || e}`);
              }));
            }
          }

          log("KV_EXPORT", `DO path lid=${lid} stage=${doResult.stage} captured=${Object.keys(doResult.extraction.normalized || {}).length} mem=${extractedState?.memoryNotes?.length ?? 0}`);
        }

        try {
        // Build rich directive from DO packet (~1.5K)
        // Pass raw biz name so TTS acronym formatting can be applied to speak text
        const doSpokenName = intel.consultant?.businessIdentity?.spokenName;
        const doRawBiz = doSpokenName || intel.business_name || (intel.core_identity as any)?.business_name || '';
        const doTurnPrompt = buildDOTurnPrompt(doResult, doRawBiz);
        const memoryLineCount = (doResult.packet.activeMemory ?? []).length;
        log('DO_PROMPT', `stage=${doResult.stage} stall=${doResult.wowStall} move=${doResult.packet.chosenMove.id} chars=${doTurnPrompt.length} memory_lines=${memoryLineCount}`);

        // Build reference data (V2 execution block + business intel) (~1.5K)
        const deepStatus = (intel as any).intel?.deep?.status ?? intel.deep?.status;
        const apifyDone = deepStatus === 'done';
        const bridgeSystem = buildFullSystemContext(intel, apifyDone);

        // Assemble system message: directive FIRST, reference LAST
        const systemContent = `lead_id: ${lid}\n\n${doTurnPrompt}\n\n--- REFERENCE DATA (use to inform your response, do not read aloud) ---\n${bridgeSystem}`;
        log("PROMPT", `DO path system_chars=${systemContent.length}`);

        // Assemble messages for Gemini
        const trimmed = trimHistory(messages);
        let conversation = trimmed;
        if (conversation.length > 0 && conversation[0].role === "assistant") {
          conversation = conversation.slice(1);
        }
        const finalMessages: Msg[] = [
          { role: "system", content: systemContent },
          ...conversation,
        ];

        // ── Scribe: background note extraction (best-effort, non-blocking) ──
        if (utt.trim().length > 0 && lid && env.CALL_BRAIN) {
          const scribeRecentTurns = messages
            .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
            .slice(-4)
            .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));

          const scribeMemTitles = (doResult.packet?.activeMemory ?? [])
            .filter((line: unknown): line is string => typeof line === 'string')
            .map((line: string) => line.replace(/^\[.*?\]\s*/, '').slice(0, 60));

          const scribeTurnIndex = doResult.extractedState?.transcriptLog?.length ?? messages.filter(m => m.role === 'user').length;

          log('SCRIBE_LAUNCH', `path=do callId=${lid} stage=${doResult.stage ?? 'unknown'} turn=${scribeTurnIndex}`);
          ctx.waitUntil(
            runScribe(
              utt,
              scribeRecentTurns,
              doResult.stage ?? 'unknown',
              scribeMemTitles,
              lid,
              scribeTurnIndex,
              env,
              env.CALL_BRAIN,
            )
          );
        }

        // Closure-scope the IDs — NEVER use mutable module-scope variables
        const doMoveId = doResult.packet.chosenMove.id;
        const doDeliveryId = (doResult.extractedState as any)?.pendingDelivery?.deliveryId ?? '';
        log('DO_DELIVERY_ID', `lid=${lid} moveId=${doMoveId} deliveryId=${doDeliveryId || 'none'}`);
        if (!doDeliveryId) log('WARN', `lid=${lid} doDeliveryId is empty — DO compat path will be used`);

        // ── DETERMINISTIC DELIVERY: bypass Gemini for mandatory text ──
        // When the DO flags a move as mandatory (ROI numbers, calculated figures),
        // return the pre-built text directly. No Gemini = no hallucination.
        const packet = doResult.packet;
        const isMandatoryDelivery = !!(
          packet.mandatory ||
          packet.chosenMove.kind === 'roi' ||
          packet.stage === 'roi_delivery'
        );

        if (isMandatoryDelivery && packet.chosenMove.text.length > 0) {
          log("DETERMINISTIC_DELIVERY", `stage=${packet.stage} move=${doMoveId} kind=${packet.chosenMove.kind} text_len=${packet.chosenMove.text.length}`);

          // Apply TTS acronym formatting (same as buildDOTurnPrompt)
          const doSpokenName2 = intel.consultant?.businessIdentity?.spokenName;
          const doRawBiz2 = doSpokenName2 || intel.business_name || (intel.core_identity as any)?.business_name || '';
          let deterministicText = packet.chosenMove.text;
          if (doRawBiz2) {
            const ttsBiz = ttsAcronym(doRawBiz2);
            if (ttsBiz !== doRawBiz2) {
              deterministicText = deterministicText.replaceAll(doRawBiz2, ttsBiz);
            }
          }

          return streamDeterministicResponse(
            deterministicText,
            async (spokenText) => {
              // Compliance is guaranteed pass — text is delivered verbatim
              const compliancePayload = {
                compliance_status: 'pass' as const,
                compliance_score: 1.0,
                missed_phrases: [],
              };
              await callDOLlmReplyDone(lid!, doMoveId, doDeliveryId, spokenText, env, compliancePayload);
            },
            ctx,
          );
        }

        log('STREAM', `DO path stage=${doResult.stage} history=${conversation.length} turns → streaming`);

        return streamToDeepgram(finalMessages, env,
          // Success callback — Gemini stream completed
          async (spokenText) => {
            // Compliance check: lightweight word-overlap before notifying DO
            let compliancePayload: { compliance_status: 'pass' | 'drift'; compliance_score: number; missed_phrases: string[] } | undefined;
            try {
              const checks = doResult.packet?.complianceChecks;
              const phrases: string[] = checks?.mustContainPhrases ?? [];
              if (phrases.length > 0 && spokenText.length >= 20) {
                const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
                const normSpoken = norm(spokenText);
                const spokenWords = normSpoken.split(/\s+/);

                let totalScore = 0;
                const missed: string[] = [];

                for (const phrase of phrases) {
                  const phraseWords = norm(phrase).split(/\s+/);
                  if (phraseWords.length === 0) { totalScore += 1; continue; }
                  let matchCount = 0;
                  for (const pw of phraseWords) {
                    if (spokenWords.includes(pw)) matchCount++;
                  }
                  const phraseScore = matchCount / phraseWords.length;
                  totalScore += phraseScore;
                  if (phraseScore < 0.5) missed.push(phrase);
                }

                const score = totalScore / phrases.length;
                const status: 'pass' | 'drift' = score >= 0.6 ? 'pass' : 'drift';
                compliancePayload = { compliance_status: status, compliance_score: score, missed_phrases: missed };

                if (status === 'pass') {
                  log('COMPLIANCE_PASS', `lid=${lid} moveId=${doMoveId} score=${score.toFixed(2)} matched=${phrases.length - missed.length}/${phrases.length}`);
                } else {
                  log('COMPLIANCE_DRIFT', `lid=${lid} moveId=${doMoveId} score=${score.toFixed(2)} missed=${JSON.stringify(missed.slice(0, 3))}`);
                }
              }
            } catch (_complianceErr) {
              // Compliance must never fail the delivery
            }

            await callDOLlmReplyDone(lid!, doMoveId, doDeliveryId, spokenText, env, compliancePayload);
          },
          // Failure callback — Gemini errored
          async (errorCode) => {
            await callDODeliveryFailed(lid!, doMoveId, doDeliveryId, errorCode, env);
          },
          ctx,
        );
        } catch (e) {
          // DO path threw before streaming — ensure DO is unblocked so pendingDelivery
          // doesn't time out → call_degraded → Bella goes silent (BUG 1 fix)
          log('DO_PATH_ERR', `lid=${lid} err=${String(e).slice(0, 200)} — falling back to old path`);
          // doMoveId / doDeliveryId may not be in scope if throw was early — use safe fallbacks
          const _fbMoveId = (() => { try { return (doResult as any)?.packet?.chosenMove?.id ?? 'unknown'; } catch { return 'unknown'; } })();
          const _fbDeliveryId = (() => { try { return (doResult as any)?.extractedState?.pendingDelivery?.deliveryId ?? ''; } catch { return ''; } })();
          ctx.waitUntil(
            callDODeliveryFailed(lid!, _fbMoveId, _fbDeliveryId, `bridge_error:${String(e).slice(0, 200)}`, env)
              .catch((notifyErr: unknown) => log('DO_PATH_ERR_NOTIFY_FAIL', `${String(notifyErr).slice(0, 100)}`))
          );
          // Fall through to old path (doResult is non-null but we caught — old path below handles it)
        }
      }
    }

    // ── SHADOW MODE (Phase C — T015) ──────────────────────────────────────
    // When USE_DO_BRAIN=false, fire DO call in background for comparison.
    const shadowMode = env.USE_DO_BRAIN !== 'true' && !!lid;

    // ── Load or init state (using pre-loaded state from parallel KV read) ──
    // Guard: only call initState on early turns (≤3 messages). On later turns,
    // missing state indicates KV consistency lag — use safe default instead of
    // reinitializing (which resets stage + queue mid-conversation).
    let s: State;
    if (lid) {
      if (loadedState) {
        s = loadedState;
      } else if (messages.length <= 3) {
        s = await initState(lid, env, intel);
      } else {
        log("WARN", `state missing at turn=${messages.length} for lid=${lid} — using safe default (NOT reinitializing queue)`);
        s = {
          stage: "wow", queue: ["ch_website"], done: [], inputs: { ...BLANK },
          maddie_skip: false, wants_numbers: false, just_demo: false, apify_done: false, calc_ready: false,
          trial_reviews_done: false, stall: 0, init: new Date().toISOString(), _lastTurn: 0, _lastUttHash: ""
        };
      }
    } else {
      s = {
        stage: "wow", queue: ["ch_website"], done: [], inputs: { ...BLANK },
              maddie_skip: false, wants_numbers: false, just_demo: false, apify_done: false, calc_ready: false,
        trial_reviews_done: false, stall: 0, init: new Date().toISOString(), _lastTurn: 0, _lastUttHash: ""
      };
    }
    // ── Check if Apify data has landed this turn ────────────────────────────
    // intel.deep is written by deep-scrape-workflow once all 5 actors complete (~30-45s).
    // We set apify_done=true on state so the deep_dive gate can open.
    // SCHEMA FIX: Check both intel.intel.deep (big scraper) and intel.deep (deep-scrape)
    const deepStatus = (intel as any).intel?.deep?.status ?? intel.deep?.status;
    const deepJustArrived = !s.apify_done && deepStatus === "done";
    if (deepJustArrived) {
      s.apify_done = true;
      log("APIFY", `deep intel landed for lid=${lid} — gate will open next advance`);
    }

    // ── Rebuild future queue when deep data arrives (one-shot) ──────────
    if (lid && deepJustArrived) {
      try {
        const flags = intel.flags ?? intel.fast_context?.flags ?? {};
        s = rebuildFutureQueueOnLateLoad(s, flags, intel);
        log("LATE_REBUILD", `deep data arrived for lid=${lid} — future queue rebuilt`);
      } catch (e) {
        log("WARN", `Failed to rebuild queue on late data: ${e}`);
      }
    }

    // ── DATA LAYER STATUS LOG — visible every turn so we can see what Gemini has ──
    const fastLoaded = !!(intel.fast_intel || intel.core_identity?.business_name);
    const apifyLoaded = deepStatus === "done";
    const fullLoaded = intel.full_scrape?.status === "done";
    log("KV_STATUS", `lid=${lid} turn=${messages.length} fast=${fastLoaded} apify=${apifyLoaded} full=${fullLoaded} kv_bytes=${JSON.stringify(intel).length}`);
    const _sf = intel.consultant?.scriptFills ?? {};
    const _sfKeys = Object.keys(_sf).filter(k => _sf[k]);
    log("SCRIPTFILLS", `lid=${lid} present=${_sfKeys.length > 0} keys=[${_sfKeys.join(',')}] bella_opener=${!!(intel.bella_opener)} hero_h2=${!!(intel.hero?.h2 || (intel as any).fast_intel?.hero?.h2)}`);

    // ── DEDUP CHECK (BEFORE extraction to prevent stale utterance leaking into new stages) ──
    const utt = lastUser(messages);
    const stageAtUtterance = s.stage;
    const extractIndustry = intel.core_identity?.industry ?? intel.core_identity?.industry_key ?? "";
    log("UTT", `lid=${lid} stage=${stageAtUtterance} utt_chars=${utt.length} utt_preview="${utt.slice(0, 80)}"`);

    // FIX (2026-04-08): count user messages only, not total messages
    const userMsgCount = messages.filter(m => m.role === 'user').length;
    const turnNum = Math.max(0, userMsgCount - 1);
    const uttHash = utt.trim().toLowerCase().slice(0, 200);
    const prevHash = s._lastUttHash ?? "";
    const isNewTurn = turnNum > (s._lastTurn ?? 0);

    // Cross-turn: only exact match = duplicate (user may say "yeah" in multiple turns — that's legit)
    // Same-turn: prefix check catches Deepgram incremental transcripts ("yeah" → "yeah sounds good")
    const isNewContent = uttHash.length > 0 && (
      prevHash.length === 0
      || (isNewTurn
        ? uttHash !== prevHash                                                    // new turn: only block exact same utterance
        : (!uttHash.startsWith(prevHash) && !prevHash.startsWith(uttHash)))       // same turn: block prefix expansions
    );

    // ── EXTRACTION: only on genuinely new content — prevents stale utterance
    // from previous stage leaking numbers into newly-advanced stage ────────────
    if (utt && lid && (isNewTurn || isNewContent)) {
      s = await extractAndApply(utt, s, lid, env, stageAtUtterance, extractIndustry, ctx);
    } else if (utt && lid && !isNewTurn) {
      log("EXTRACT_SKIP", `lid=${lid} same-turn duplicate — skipping extraction to prevent cross-stage pollution`);
    }

    // ── Advance stage if gate opens ─────────────────────────────────────────
    if (isNewTurn && isNewContent) {
      s.stall++;
      s._lastTurn = turnNum;
      s._lastUttHash = uttHash;
    } else if (!isNewTurn) {
      // Same turn, duplicate or prefix expansion — DO NOT return early.
      // Deepgram sends interim transcript updates as separate HTTP requests.
      // If we return 204 or empty SSE, Deepgram cancels the active Gemini stream.
      // Instead: log it, don't increment stall, and let it fall through to Gemini.
      // Costs an extra Gemini call but keeps the conversation alive.
      s._lastTurn = Math.max(s._lastTurn ?? 0, turnNum);
      log("DEDUP", `lid=${lid} turn=${turnNum} same-turn duplicate — stall=${s.stall} — PASSTHROUGH`);
    } else {
      // New turn but exact same content — still process (user confirming)
      s.stall++;
      s._lastTurn = turnNum;
      s._lastUttHash = uttHash;
      log("DEDUP", `lid=${lid} turn=${turnNum} new turn, same content — treating as new (stall=${s.stall})`);
    }
    if (gateOpen(s)) {
      s.calc_ready = isCalcReady(s.inputs, s.maddie_skip);
      s = advance(s);
    }
    // Escape hatch: if stuck on a channel stage for 4+ turns with no new data,
    // force-advance to avoid frustrating re-ask loops ("You just asked me that")
    if (s.stall >= 4 && s.stage.startsWith("ch_")) {
      log("ESCAPE", `force-advancing from ${s.stage} after ${s.stall} stalls — extraction likely failing`);
      s.calc_ready = isCalcReady(s.inputs, s.maddie_skip);
      s = advance(s);
    } else if (s.stall > 5 && s.stage !== "roi_delivery" && s.stage !== "close" && s.stage !== "wow") {
      // Non-channel stages: force-advance at 6 stalls
      log("ESCAPE", `force-advancing from ${s.stage} after ${s.stall} stalls`);
      s.calc_ready = isCalcReady(s.inputs, s.maddie_skip);
      s = advance(s);
    }

    // ── Trim history ──────────────────────────────────────────────────────
    const trimmed = trimHistory(messages);

    // ── Qualitative memory: regex-based, sync — append signals to convMemory ──
    if (utt && lid && utt.length > 10) {
      const signals = extractQualitativeSignals(utt);
      if (signals) {
        const updated = convMemory ? `${convMemory}\n${signals}` : signals;
        convMemory = updated.length > 2000 ? updated.slice(-2000) : updated;
        // Ensure KV write completes (use ctx.waitUntil when available)
        log("KV_WRITE", `lid=${lid} key=conv_memory ctx=${!!ctx}`);
        if (ctx) {
          ctx.waitUntil(env.LEADS_KV.put(`lead:${lid}:conv_memory`, convMemory).catch(e => {
            log("KV_WRITE_ERR", `lid=${lid} key=conv_memory error=${e?.message || e}`);
          }));
        } else {
          env.LEADS_KV.put(`lead:${lid}:conv_memory`, convMemory).catch(e => {
            log("KV_WRITE_ERR", `lid=${lid} key=conv_memory no_ctx error=${e?.message || e}`);
          });
        }
        log("MEMORY", `regex signals: ${signals.replace(/\n/g, " | ")}`);
      }
    }

    // ── Chunk C+: Vector retrieval for ALL stages (gated, async) ───────────
    if (lid && stageQueryMap[s.stage]) {
      const snippet = await retrieveFromVector(lid, stageQueryMap[s.stage], env, log);
      if (snippet) {
        (intel as any)._retrievedSnippet = snippet;
      }
    }

    // ── Build system context fresh every turn (uses latest KV intel) ──────
    // String concatenation is <1ms — no need to cache in KV.
    // Building fresh every turn ensures big scraper data is used immediately.
    const bridgeSystem = buildFullSystemContext(intel, s.apify_done);

    // ── Build lean per-turn prompt (~800 chars) ──────────────────────────────
    // NOTE: buildTurnPrompt → buildStageDirective may mutate s (stall skip, trial_reviews_done)
    // so saveState MUST come AFTER this call to capture those mutations.
    log("WOW_STALL", `lid=${lid} stage=${s.stage} stall=${s.stall}`);
    const turnPrompt = buildTurnPrompt(s, intel, convMemory);

    // Fire-and-forget: state save AFTER buildTurnPrompt so mutations (stall skip, trial flag) are captured.
    if (lid) ctx.waitUntil(saveState(lid, s, env));

    // ── SHADOW MODE: fire DO call in background for comparison (T015) ─────
    if (shadowMode) {
      const shadowUtt = lastUser(messages);
      const shadowTurnNum = messages.length;
      // P2 FIX: SHA-256 content-hash for shadow path too
      const shadowHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${shadowTurnNum}:${shadowUtt}`));
      const shadowTurnId = `shadow_${shadowTurnNum}_${[...new Uint8Array(shadowHash.slice(0, 8))].map(b => b.toString(16).padStart(2, '0')).join('')}`;
      ctx.waitUntil(shadowDOCall(lid!, shadowUtt, shadowTurnId, shadowTurnNum, s.stage, s.stall, intel, env));
    }

    // ── System message: DIRECTIVE FIRST, then reference data ─────
    // Gemini reads top-down — stage directive must be first so it follows the script
    const systemContent = lid
      ? `lead_id: ${lid}\n\n${turnPrompt}\n\n--- REFERENCE DATA (use to inform your response, do not read aloud) ---\n${bridgeSystem}`
      : `${turnPrompt}\n\n--- REFERENCE DATA (use to inform your response, do not read aloud) ---\n${bridgeSystem}`;
    log("PROMPT", `stage=${s.stage} stall=${s.stall} system_chars=${systemContent.length}`);

    // ── Assemble final messages ──────────────────────────────────────────────
    let conversation = trimmed;
    if (conversation.length > 0 && conversation[0].role === "assistant") {
      conversation = conversation.slice(1);
    }

    const finalMessages: Msg[] = [
      { role: "system", content: systemContent },
      ...conversation,
    ];

    log("STREAM", `stage=${s.stage} history=${conversation.length} turns → streaming`);

    // ── Scribe: background note extraction — old path (best-effort, non-blocking) ──
    if (utt.trim().length > 0 && lid && env.CALL_BRAIN) {
      const scribeRecentTurns = messages
        .filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim().length > 0)
        .slice(-4)
        .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : '' }));

      const scribeTurnIndex = messages.filter(m => m.role === 'user' && typeof m.content === 'string').length;

      log('SCRIBE_LAUNCH', `path=old callId=${lid} stage=${s.stage ?? 'unknown'} turn=${scribeTurnIndex}`);
      ctx.waitUntil(
        runScribe(
          utt,
          scribeRecentTurns,
          s.stage ?? 'unknown',
          [],
          lid,
          scribeTurnIndex,
          env,
          env.CALL_BRAIN,
        )
      );
    }

    // Phase D — T014: fire llm_reply_done in shadow mode to keep DO state in sync
    if (shadowMode) {
      return streamToDeepgram(finalMessages, env, async (spokenText) => {
        await callDOLlmReplyDone(lid!, 'old_path_unknown', '', spokenText, env);
      }, undefined, ctx);
    }
    return streamToDeepgram(finalMessages, env, undefined, undefined, ctx);
  },
};
