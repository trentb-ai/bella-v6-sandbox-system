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

export interface Env {
  LEADS_KV: KVNamespace;
  TOOLS: Fetcher;
  GEMINI_API_KEY: string;
  TOOLS_BEARER: string;
  ENABLE_EMBEDDING?: string;
}

const VERSION = "8.11.0-DEEPFIX"; // Fix: read :deep_flags from workflow, normalize google_maps → googleMaps

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
  const [stubRaw, fastRaw, deepRaw, deepFlagsRaw, oldIntelRaw] = await Promise.all([
    env.LEADS_KV.get(`lead:${lid}:stub`),        // big-scraper fallback (v8)
    env.LEADS_KV.get(`lead:${lid}:fast-intel`),  // fast-intel enriched data (v8)
    env.LEADS_KV.get(`lead:${lid}:deepIntel`),   // deep-scrape Apify data (old pipeline)
    env.LEADS_KV.get(`lead:${lid}:deep_flags`),  // workflow Apify data (bella-scrape-workflow)
    env.LEADS_KV.get(`lead:${lid}:intel`),       // OLD: backwards compat with sandbox workers
  ]);

  let stub: Record<string, any> = {};
  let fast: Record<string, any> = {};
  let deep: Record<string, any> = {};
  let deepFlags: Record<string, any> = {};
  let oldIntel: Record<string, any> = {};

  try { if (stubRaw) stub = JSON.parse(stubRaw); } catch {}
  try { if (fastRaw) fast = JSON.parse(fastRaw); } catch {}
  try { if (deepRaw) deep = JSON.parse(deepRaw); } catch {}
  try { if (deepFlagsRaw) deepFlags = JSON.parse(deepFlagsRaw); } catch {}
  try { if (oldIntelRaw) oldIntel = JSON.parse(oldIntelRaw); } catch {}

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

  // Inject deep-scrape data at intel.deep if present (from either pipeline)
  // Workflow writes snake_case (google_maps, fb_ads_count, indeed_count)
  // Bridge expects camelCase (googleMaps { rating, review_count, recent_reviews }, hiring { is_hiring })
  if (deepFlags.google_maps || deepFlags.linkedin || deepFlags.indeed_count) {
    const gm = deepFlags.google_maps ?? {};
    intel.deep = {
      status: "done",
      googleMaps: {
        rating: gm.totalScore ?? null,
        review_count: gm.reviewsCount ?? 0,
        title: gm.title ?? "",
        address: gm.address ?? "",
        recent_reviews: gm.text ? [{ text: gm.text, stars: gm.stars, publishAt: gm.publishAt }] : [],
      },
      ads: {
        fb_ads_count: deepFlags.fb_ads_count ?? 0,
        google_ads_count: deepFlags.google_ads_count ?? 0,
      },
      hiring: {
        is_hiring: (deepFlags.indeed_count ?? 0) > 0,
        indeed_count: deepFlags.indeed_count ?? 0,
      },
      linkedin: deepFlags.linkedin ?? {},
    };
  } else if (deep.googleMaps || deep.linkedin || deep.hiring) {
    intel.deep = { status: "done", ...deep };
  }

  const sources = [
    stubRaw ? 'stub' : null,
    oldIntelRaw ? 'old-intel' : null,
    fastRaw ? 'fast-intel' : null,
    deepRaw ? 'deep-intel' : null,
    deepFlagsRaw ? 'deep-flags' : null,
  ].filter(Boolean);

  log("KV_MERGE", `lid=${lid} sources=[${sources.join(',')}] merged_keys=${Object.keys(intel).length}`);

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

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODEL = "gemini-2.5-flash";

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

interface Inputs {
  acv: number | null;
  timeframe: "weekly" | "monthly" | null;
  ads_leads: number | null;
  ads_conversions: number | null;
  ads_followup: string | null;
  ad_spend: number | null;
  web_leads: number | null;
  web_conversions: number | null;
  phone_volume: number | null;
  phone_conversion: number | null;
  after_hours: string | null;
  missed_calls: number | null;
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
  scriptStages?: Record<string, any>;  // consultant-generated stage scripts
  // V8 stage tracking — set by the main loop when call_brief.stages is active
  v8StageKey?: string;       // e.g. "alex_intro", "agent2_roi" — current V8 Stage.key
  v8CaptureKey?: string;     // e.g. "follow_up_speed_hours" — current stage's capture field
  v8StageIndex?: number;     // index into stages[] for advance tracking
  // T007: Just Demo branch — prospect says "just show me" at demo_value_bridge
  just_demo: boolean;        // true = skip all number capture stages, go to just_demo_pivot
}

// ─── BLANK INPUTS ─────────────────────────────────────────────────────────────

const BLANK: Inputs = {
  acv: null, timeframe: null,
  ads_leads: null, ads_conversions: null, ads_followup: null, ad_spend: null,
  web_leads: null, web_conversions: null,
  phone_volume: null, phone_conversion: null, after_hours: null, missed_calls: null,
  old_leads: null,
  star_rating: null, review_count: null, has_review_system: null, new_cust_per_period: null,
};

// ─── CHANNEL QUEUE BUILDER ────────────────────────────────────────────────────

function buildQueue(flags: Record<string, any>, intel: Record<string, any>): Stage[] {
  const q: Stage[] = [];
  const ci = intel.core_identity ?? {};
  const deep = (intel as any).intel?.deep ?? intel.deep ?? {}; // Check intel.intel.deep (big scraper) then root deep
  const ts = intel.tech_stack ?? {};

  // SCHEMA v3: Read ads signals from canonical sources (no website_health indirection)
  // Priority: flags (fast-intel) → deep (Apify) → tech_stack → big scraper root fields
  const adsRunning = flags.is_running_ads
    ?? flags.has_fb_pixel
    ?? flags.has_google_ads
    ?? (deep.ads?.fb?.running || deep.ads?.google?.running)
    ?? ts.is_running_ads
    ?? intel.google_ads_running                     // big scraper root field
    ?? intel.facebook_ads_running                   // big scraper root field
    ?? false;

  const socialOrEmailTraffic = !!(
    ts.social_channels?.length > 0
    || ts.has_email_marketing
    || flags.database_likely
  );

  if (adsRunning || socialOrEmailTraffic) q.push("ch_ads");
  q.push("ch_website");

  // Phone: Phase B flags, or if business has a phone number from any source
  if (flags.speed_to_lead_needed || flags.call_handling_needed || ci.phone) q.push("ch_phone");

  // Old leads/DBR: email marketing tool or ecommerce = database exists; or Apify hiring signals
  if (flags.database_reactivation || flags.database_likely || flags.business_age_established
    || deep.hiring?.is_hiring || ts.database_likely) q.push("ch_old_leads");

  // SCHEMA v3: Reviews from deep.googleMaps (canonical source)
  const rawReviewCount = deep.googleMaps?.review_count ?? intel.review_count ?? 0;
  const reviewCount = typeof rawReviewCount === 'string' ? parseInt(rawReviewCount, 10) || 0 : rawReviewCount;
  if (reviewCount > 0 || flags.review_signals) q.push("ch_reviews");

  return q;
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
  let scriptStages: Record<string, any> | undefined;

  if (!preloadedIntel) {
    // SUPERGOD: Try call_brief first, fall back to merged keys
    const callBrief = await loadCallBrief(lid, env);
    if (callBrief && callBrief.status) {
      intel = callBrief;
      // call_brief has stages embedded
      if (callBrief.stages) scriptStages = callBrief.stages;
    } else {
      // Fallback: SCHEMA v9 merged intel + script_stages
      const [mergedIntel, stagesRaw] = await Promise.all([
        loadMergedIntel(lid, env),
        env.LEADS_KV.get(`lead:${lid}:script_stages`),
      ]);
      intel = mergedIntel;
      try { if (stagesRaw) scriptStages = JSON.parse(stagesRaw); } catch (e) { console.warn('[bridge] Failed to parse script_stages:', e); }
    }
  }

  const flags = intel.flags ?? intel.fast_context?.flags ?? {};
  const queue = buildQueue(flags, intel);
  let s: State = {
    stage: "wow", queue, done: [], inputs: { ...BLANK },
          maddie_skip: false, wants_numbers: false, just_demo: false, apify_done: false, calc_ready: false,
    stall: 0, init: new Date().toISOString(), _lastTurn: 0, _lastUttHash: "",
    scriptStages,
  };
  // V8: seed v8StageKey/v8CaptureKey/v8StageIndex from Stage[] if call_brief has stages
  if (scriptStages?.stages) s = seedV8State(s);
  
  // Tag source for Hot-Swap logic
  if (s.scriptStages) {
    (s.scriptStages as any).source = (intel.consultant?.scriptFills || intel.stages?.source === 'consultant') ? 'consultant' : 'heuristic';
  }

  await saveState(lid, s, env);
  log("INIT", `lid=${lid} queue=[${queue.join(",")}] scriptStages=${!!scriptStages} source=${(s.scriptStages as any)?.source} v8Stage=${s.v8StageKey ?? 'none'}`);
  return s;
}

// ─── STAGE GATE ───────────────────────────────────────────────────────────────

function gateOpen(s: State): boolean {
  const { stage: st, inputs: i } = s;
  switch (st) {
    // WOW: at least 6 exchanges before advancing (welcome → positioning → ICP/problems → solutions → trained AI → ads/rep → bridge)
    // User can fast-track by saying "let's see the numbers" at any point
    case "wow": return s.stall >= 6;
    // deep_dive: no longer a blocking stage — auto-advance
    case "deep_dive": return true;
    case "anchor_acv": return i.acv !== null;
    case "anchor_timeframe": return i.timeframe !== null;
    case "ch_ads": return i.ads_leads !== null && i.ads_conversions !== null;
    case "ch_website": return i.web_leads !== null && i.web_conversions !== null;
    case "ch_phone": return i.after_hours !== null && i.phone_volume !== null;
    case "ch_old_leads": return i.old_leads !== null;
    case "ch_reviews": return i.new_cust_per_period !== null && i.star_rating !== null && i.review_count !== null && i.has_review_system !== null;
    case "roi_delivery": return true;
    case "close": return true;
  }
}

// ─── ADVANCE STAGE ────────────────────────────────────────────────────────────

function advance(s: State): State {
  s.done.push(s.stage);
  s.stall = 0;
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

// ─── V8 STAGE ADVANCE ─────────────────────────────────────────────────────────
// Walks the Stage[] from call_brief, skipping inactive stages.
// Updates v8StageKey, v8CaptureKey, v8StageIndex on state.
// Also maps the current V8 stage key to the legacy Stage enum so gateOpen() remains valid.

function getV8Stage(scriptStages: Record<string, any> | undefined, idx: number): any | null {
  if (!scriptStages?.stages || !Array.isArray(scriptStages.stages)) return null;
  return scriptStages.stages[idx] ?? null;
}

function advanceV8Stage(s: State): State {
  if (!s.scriptStages?.stages || !Array.isArray(s.scriptStages.stages)) return advance(s);

  const stages: any[] = s.scriptStages.stages;
  let next = (s.v8StageIndex ?? 0) + 1;

  // T007: Just Demo branch — jump directly to just_demo_pivot, skipping all number stages
  if (s.just_demo) {
    const demoIdx = stages.findIndex((st: any) => st?.key === "just_demo_pivot" && st?.active !== false);
    if (demoIdx >= 0) {
      const demo = stages[demoIdx];
      s.v8StageIndex = demoIdx;
      s.v8StageKey = demo.key;
      s.v8CaptureKey = demo.capture ?? undefined;
      s.stage = v8StageAlias(demo.key);
      s.stall = 0;
      log("JUST_DEMO", `→ jumping to just_demo_pivot at idx=${demoIdx}`);
      return s;
    }
  }

  // Skip inactive stages
  while (next < stages.length && !stages[next]?.active) next++;

  if (next >= stages.length) {
    // End of V8 stages — fall through to legacy close
    s.stage = "close";
    s.v8StageKey = "close";
    s.v8CaptureKey = undefined;
    s.stall = 0;
  } else {
    const nxt = stages[next];
    s.v8StageIndex = next;
    s.v8StageKey = nxt.key;
    s.v8CaptureKey = nxt.capture ?? undefined;
    // Map to legacy stage so gateOpen() doesn't break
    s.stage = v8StageAlias(nxt.key);
    s.stall = 0;
    log("V8_ADVANCE", `→ [${next}] key=${nxt.key} agent=${nxt.agent} capture=${nxt.capture ?? "none"}`);
  }

  return s;
}

// Auto-detect first active V8 stage from scriptStages and seed state
function seedV8State(s: State): State {
  if (!s.scriptStages?.stages || !Array.isArray(s.scriptStages.stages)) return s;
  const stages: any[] = s.scriptStages.stages;
  // Find first active stage
  const firstIdx = stages.findIndex((st: any) => st?.active !== false);
  if (firstIdx < 0) return s;
  const first = stages[firstIdx];
  s.v8StageIndex = firstIdx;
  s.v8StageKey = first.key;
  s.v8CaptureKey = first.capture ?? undefined;
  s.stage = v8StageAlias(first.key);
  log("V8_SEED", `firstStage=${first.key} idx=${firstIdx}`);
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

// ── Stage-aware regex extraction: returns fields relevant to the current stage
function regexExtract(utt: string, stage: Stage, industry?: string): Partial<Inputs> & { wants_numbers?: boolean } {
  const s = utt.toLowerCase();
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

// ─── V8 STAGE ALIAS ──────────────────────────────────────────────────────────
// Maps V8 Stage keys (Stage[].key from buildStageScripts) to the closest legacy
// Stage bucket so regexExtract() fires the right pattern group.

function v8StageAlias(v8Key: string): Stage {
  const map: Record<string, Stage> = {
    // Bella opening stages
    wow:                   "wow",
    demo_value_bridge:     "wow",
    anchor_acv:            "anchor_acv",
    anchor_volume:         "ch_ads",        // leads per week → ads_leads (reused field)

    // Alex stages → ads channel
    alex_intro:            "ch_ads",
    alex_ads_volume:       "ch_ads",
    alex_roi:              "roi_delivery",  // ROI stage — no extraction needed

    // Agent 2 stages → website or phone channel
    agent2_intro:          "ch_website",
    agent2_discovery:      "ch_website",
    agent2_roi:            "roi_delivery",

    // Agent 3 stages → old_leads / reviews
    agent3_descriptor:     "ch_old_leads",
    agent3_crunch:         "ch_old_leads",

    // Closing stages
    transition_to_close:   "roi_delivery",
    just_demo_pivot:       "roi_delivery",
    trial_offer:           "close",
  };
  return map[v8Key] ?? "wow";
}

// ─── V8 CAPTURE → INPUTS MAPPER ──────────────────────────────────────────────
// After regexExtract fires, also apply knowledge of the V8 Stage.capture field
// to guide which Inputs bucket the extracted number should fill.
// Called with the raw utterance + current V8 stage key + current inputs.

function captureToInputs(utt: string, captureKey: string, inputs: Inputs): Partial<Inputs> {
  const n = parseNumber(utt.replace(/[^0-9a-zA-Z\s.,kmKM]/g, " ").trim());
  const pct = parsePercent(utt);
  const out: Partial<Inputs> = {};
  if (!n && !pct) return out;

  switch (captureKey) {
    // Anchors
    case "average_customer_value":
      if (n && n >= 100) out.acv = n;
      break;
    case "leads_per_week":
      if (n && n > 0) { out.ads_leads = n; out.web_leads = n; }
      break;

    // Alex
    case "follow_up_speed_hours": {
      if (n == null) break;
      if (n <= 0.5)  out.ads_followup = "<30m";
      else if (n <= 3) out.ads_followup = "30m_to_3h";
      else if (n <= 24) out.ads_followup = "3h_to_24h";
      else out.ads_followup = ">24h";
      // Also default conversions if not yet set
      if (!inputs.ads_conversions && inputs.ads_leads) {
        out.ads_conversions = Math.round(inputs.ads_leads * 0.1); // conservative 10%
      }
      break;
    }
    case "ads_leads_per_week":
      if (n && n > 0) out.ads_leads = n;
      break;

    // Agent 2 — Chris
    case "website_conversion_rate":
      if (pct) { out.web_leads = inputs.ads_leads ?? 100; out.web_conversions = Math.round((inputs.ads_leads ?? 100) * pct); }
      else if (n && n <= 100) { out.web_leads = inputs.ads_leads ?? 100; out.web_conversions = Math.round((inputs.ads_leads ?? 100) * n / 100); }
      break;
    case "monthly_ad_spend":
      if (n && n > 0) out.ad_spend = n;
      break;

    // Agent 2 — Maddie
    case "missed_call_percentage":
      if (pct) out.missed_calls = Math.round((inputs.phone_volume ?? 20) * pct);
      else if (n) out.missed_calls = n;
      if (!inputs.phone_volume) out.phone_volume = inputs.ads_leads ?? 20;
      if (!inputs.after_hours) out.after_hours = "voicemail/unanswered"; // implied by asking
      break;
    case "missed_calls_per_10":
      if (n && n > 0 && n <= 10) {
        out.missed_calls = Math.round((inputs.phone_volume ?? 20) * n / 10);
        if (!inputs.after_hours) out.after_hours = "voicemail/unanswered";
      }
      break;

    // Agent 3 — Maddie crunch
    case "missed_calls_per_day":
      if (n && n > 0) { out.missed_calls = n * 5; out.phone_volume = n * 5 * 2; out.after_hours = "voicemail/unanswered"; }
      break;

    // Agent 3 — Sarah crunch
    case "old_lead_database_size":
      if (n && n > 0) out.old_leads = n;
      break;

    // Agent 3 — James crunch
    case "google_rating_confirmed":
      if (n && n >= 1 && n <= 5) { out.star_rating = n; out.has_review_system = false; }
      break;
  }

  return out;
}

// ─── APPLY EXTRACTION + KV WRITES (sync extraction, async KV only) ──────────

async function extractAndApply(utterance: string, s: State, lid: string, env: Env, stageOverride?: Stage, industry?: string): Promise<State> {
  if (!utterance) return s;

  const stage = stageOverride ?? s.stage;
  // Determine effective extraction stage — prefer V8 alias when we have a V8 key
  const effectiveStage = s.v8StageKey ? v8StageAlias(s.v8StageKey) : stage;
  const extracted = regexExtract(utterance, effectiveStage, industry);
  const fields = Object.keys(extracted);

  // V8 secondary pass — additional capture field guidance
  let v8Captured: Partial<Inputs> = {};
  if (s.v8CaptureKey) {
    v8Captured = captureToInputs(utterance, s.v8CaptureKey, s.inputs);
    if (Object.keys(v8Captured).length > 0) {
      log("V8_CAPTURE", `captureKey=${s.v8CaptureKey} fields=${Object.keys(v8Captured).join(",")}`);
    }
  }

  if (fields.length === 0 && Object.keys(v8Captured).length === 0) {
    log("EXTRACT", `lid=${lid} stage=${stage} extractions=0`);
    return s;
  }

  // Apply to state — V8 captured fields take lower priority than regex (regex is more specific)
  for (const [field, value] of Object.entries(v8Captured)) {
    if (value == null) continue;
    if (field in BLANK && (s.inputs as any)[field] == null) {
      (s.inputs as any)[field] = value;
      log("V8_APPLIED", `${field}=${JSON.stringify(value)}`);
    }
  }
  // Standard regex extraction (higher priority — overwrites V8 if both fire)
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
    env.LEADS_KV.put(`lead:${lid}:captured_inputs`, capturedPayload).catch(() => {});

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
  if (history.length <= KEEP_RAW) return history;

  const fresh = history.slice(history.length - KEEP_RAW);
  // Ensure starts with user role for U-A-U-A sequence
  return fresh[0]?.role === "assistant" ? fresh.slice(1) : fresh;
}

// ─── LEAN SYSTEM CONTEXT — ~1.5K chars, rebuilt every turn ───────────────────
//
// Contains ONLY: lean persona preamble + business intel summary.
// The per-stage directive, confirmed inputs, ROI calcs, and memory are in buildTurnPrompt().
// This replaced the 13K+ full persona + flow framework that was killing latency.

function buildFullSystemContext(intel: Record<string, any>, apifyDone: boolean): string {
  const ci = intel.core_identity ?? {};
  const sf = intel.consultant?.scriptFills ?? {};
  const cons = intel.consultant ?? {};
  const ts = intel.tech_stack ?? {};
  const flags = intel.flags ?? {};
  const deep = (intel as any).intel?.deep ?? intel.deep ?? {}; // Check intel.intel.deep (big scraper) then root deep
  const hero = (intel as any).hero ?? (intel as any).fast_intel?.hero ?? {};
  const fn = intel.first_name ?? ci.first_name ?? "";
  const bizRaw = intel.business_name ?? ci.business_name ?? intel.fast_context?.business?.name ?? "your business";
  const biz = normaliseBizName(bizRaw);
  const ind = ci.industry ?? ci.industry_key ?? "";
  const loc = ci.location ?? "";
  const ct = custTerm(ind);

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
    || deep.ads?.fb?.running
    || deep.ads?.google?.running
    || intel.google_ads_running
    || intel.facebook_ads_running
  );

  // SCHEMA v3: Google reviews from deep.googleMaps (canonical) or big scraper root fields
  const googleRating = deep.googleMaps?.rating
    ?? (typeof intel.star_rating === 'number' ? intel.star_rating : (typeof intel.star_rating === 'string' ? parseFloat(intel.star_rating) || null : null));
  const googleReviews = deep.googleMaps?.review_count
    ?? (typeof intel.review_count === 'number' ? intel.review_count : (typeof intel.review_count === 'string' ? parseInt(intel.review_count, 10) || 0 : 0));

  // ── LEAN PERSONA (~500 chars — replaces 5K full persona to cut latency) ─────
  // NOTE: No titles or self-promotion. Focus on the CLIENT.
  const fullPersona = `You are Bella from Pillar and Post AI. Live voice call.
Warm, sharp, Australian. Trusted advisor who has done deep homework on the prospect's business.
IMPORTANT: NEVER introduce yourself with a title. NEVER say "I'm Bella, [title]". Just be Bella.
RULES: Up to 3 statements and a question per turn (4 sentences max, fewer is fine). Then STOP. No markdown/symbols/lists.
Say dollar amounts as words. Mirror their industry language naturally.
Never hallucinate numbers. Never combine revenue channels. Keep each channel separate.
React to what they JUST SAID first, then advance. Be curious, not scripted.

QUESTION SELECTION RULE:
The question order is a prioritization framework, not a requirement to ask every question.
Bella must not run through all channels mechanically.
Instead, she should:
1. use scraped data to identify the most promising likely opportunities,
2. confirm those opportunities briefly with the prospect where needed,
3. ask only the minimum calculation questions required to estimate the ROI of the top 2-3 most relevant agents,
4. stop asking further questions once she has enough data to make strong recommendations.
Bella should prioritize questions that help her validate the highest-value likely agents first.

CONVERSATION RHYTHM:
Every response is maximum 2 sentences. Then you stop and let them respond.
You're not a monologue — you're the best kind of two-way conversation.
Acknowledge what they just said. Then advance.
One question per turn. At the end. Then silence.

WHAT YOU NEVER DO:
- Sound like a script.
- Dump a list of facts on someone.
- Say "As an AI..."
- Use dollar signs, asterisks, bullet points, or any text formatting in speech. Say "five thousand dollars", not "$5,000".
- Ask two questions in a row.
- Hallucinate numbers.
- Combine revenue channels.
- Over-explain what the demo is.

NUMBERS AND CALCULATIONS:
You only use real inputs — things the prospect tells you, or things scraped from their actual site.
You never invent benchmarks. The approved ones are:
  Alex: "Responding in under a minute can increase conversions by 391 percent versus slower response times."
  Chris: "Websites with AI chat see around 23 percent higher conversion rates."
  Maddie: "78 percent of customers go with the first business that responds."
  Sarah: "Database reactivation typically sees around a 5 percent conversion from dormant leads."
  James: "A one-star rating increase typically drives about a 9 percent revenue lift."

Calculation rules (use exactly, never invent):
  Alex: baseline = conversions/leads. Uplift tiers based on current follow-up speed: >24h=391%, 3-24h=200%, 30min-3h=100%, <30min=50%. Revenue = conversions x uplift_rate x ACV / 52 weekly.
  Chris: incremental = web_conversions x 0.23. Revenue = incremental x ACV / 52 weekly.
  Maddie: Revenue = missed_calls x conversion_rate x ACV / 52 weekly.
  Sarah: reactivated = old_leads x 0.05. Revenue = reactivated x ACV / 52 weekly.
  James: Requires 4 inputs: new_customers_per_period, star_rating, review_count, has_review_system. Revenue base = new_customers_per_period x periods_per_year x ACV. Revenue uplift = revenue_base x 0.09 / 52 weekly.
If a required input is missing — ask for it. If they don't know — ballpark is fine. If no trustworthy number exists — don't calculate.

WHICH AGENTS TO RECOMMEND:
You recommend 2-3 max, always the highest calculated ROI.
  Ads or social traffic -> Alex + Chris first, almost always
  Email marketing tool detected -> Alex + Chris (they're mailing to landing pages, same problem)
  Non-AI chatbot on site -> Chris is an easy win — they already believe in chat, just upgrade it
  Strong phone volume + gaps in coverage -> Maddie + Chris
  Slow lead follow-up -> Alex
  Email list or ecommerce -> Sarah
  Weak or no review process -> James

CHANNELS — ALWAYS SEPARATE:
Website leads, ad leads, phone volume, old leads, reviews — each is its own conversation. Never merge them.

INDUSTRY MIRRORING:
Mirror the prospect's industry, commercial model, language, and decision context throughout.
This is not just swapping customer/client/patient — adapt wording, examples, framing, metrics, and logic.

Examples by industry:
  Legal: clients, matters, cases, consultations, retainers
  Medical/Health: patients, appointments, treatments, bookings
  Trades/Home services: jobs, callouts, quotes, booked work
  Agencies/Services: clients, retainers, projects, strategy calls
  Real estate: buyers, sellers, appraisals, listings, enquiries
  Finance/Insurance: policyholders, applications, quotes, claims
  Education/Coaching: students, enrolments, discovery calls, programs
  Hospitality: bookings, reservations, covers, guests

Mirror in ALL areas: greeting, website commentary, offer description, ICP summary, qualification questions, ROI explanations, agent recommendations, free-trial close.

INDUSTRY KPIs: Use native terminology — average client value, patient value, case value, job value, booking value, policy value.
INDUSTRY PAIN: Frame missed opportunities natively — missed consults, missed bookings, missed jobs, lost enquiries.
INDUSTRY TONE: Adapt subtly — professional/formal for legal, finance, medical; practical/direct for trades; polished/strategic for agencies; warm/reassuring for care-oriented.

TIMEFRAME:
Let them choose weekly or monthly once, early. Mirror it every time after.

FREE TRIAL CLOSE (use this phrasing):
"We start it at 7 days — usually that's more than enough to see real movement. If you want more certainty we can push to 14. No card required. Honestly, set and forget."

THE AGENTS:
  Alex — speed-to-lead. Jumps on paid and inbound leads in under a minute.
  Chris — website and inbound conversion. The voice on the landing page.
  Maddie — missed calls, after-hours, first response.
  Sarah — dormant database reactivation.
  James — reviews and reputation.

GUARDRAILS:
- Keep the stage flow strict — do not drift into random questions or premature recommendations.
- Use the buyer's own numbers whenever possible; if missing, mark estimates as directional rather than exact.
- Separate channels rigorously: website, ads, phone, old leads, reviews.
- If ads are present, prioritize Alex + Chris discovery before lower-value branches unless another signal is clearly stronger.
- Mirror the prospect's industry language, conversion event, and commercial logic throughout the conversation.`;

  // ── BUSINESS INTEL ──
  const intelLines: string[] = [
    `BUSINESS INTEL FOR ${biz.toUpperCase()}`,
    `Business: ${biz}${loc ? ` | Location: ${loc}` : ""} | Industry: ${ind}`,
  ];
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

  if (cons.icpAnalysis?.whoTheyTarget) intelLines.push(`ICP: ${cons.icpAnalysis.whoTheyTarget}`);
  if (cons.copyAnalysis?.bellaLine || cons.valuePropAnalysis?.bellaLine) intelLines.push(`Site observation: ${cons.copyAnalysis?.bellaLine ?? cons.valuePropAnalysis?.bellaLine}`);
  if (cons.conversationHooks?.length) intelLines.push(`Conversation hooks: ${cons.conversationHooks.slice(0, 3).join(" | ")}`);

  // ── BENCHMARK STATS (lean — only what Bella needs for ROI calculations) ──
  const benchmarks = `APPROVED BENCHMARKS (use exactly, never invent):
Alex: Speed-to-lead. Uplift tiers: >24h=391%, 3-24h=200%, 30m-3h=100%, <30m=50%.
Chris: Website AI chat. 23% conversion uplift.
Maddie: Missed calls. 78% of customers go with the first responder.
Sarah: Database reactivation. 5% conversion from dormant leads.
James: Reviews. 1-star improvement drives 9% revenue lift.
Free trial: "7 days, no card required, set and forget."`;

  const marker = apifyDone ? "\n[APIFY_ENRICHED]" : "";

  return `${fullPersona}\n${intelLines.join("\n")}\n${benchmarks}${marker}`;
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
  const bizRaw = intel.business_name ?? ci.business_name ?? intel.fast_context?.business?.name ?? "your business";
  const biz = normaliseBizName(bizRaw);
  const ind = ci.industry ?? ci.industry_key ?? "";
  const ct = custTerm(ind);
  const tf = s.inputs.timeframe ?? "weekly";

  // FIX Bug 2: opener must be in scope for buildStageDirective()
  const rawOpener = intel.bella_opener ?? "";
  const opener = rawOpener && biz !== "your business"
    ? rawOpener.replace(/\bHome\b/g, biz)
    : rawOpener;

  const calcs = runCalcs(s.inputs, s.maddie_skip);
  const top3 = calcs.slice(0, 3);
  const total = top3.reduce((sum, c) => sum + c.weekly, 0);

  // ── CONFIRMED INPUTS ──
  const knownLines: string[] = [];
  const { inputs: i } = s;
  if (i.acv) knownLines.push(`- ACV: ${i.acv.toLocaleString()} AUD`);
  if (i.timeframe) knownLines.push(`- Timeframe: ${i.timeframe}`);
  if (i.ads_leads) knownLines.push(`- Ad leads: ${i.ads_leads} ${tf}`);
  if (i.ads_conversions) knownLines.push(`- Ad conversions: ${i.ads_conversions} ${tf}`);
  if (i.ads_followup) knownLines.push(`- Followup speed: ${i.ads_followup}`);
  if (i.ad_spend) knownLines.push(`- Ad spend: ${i.ad_spend}/mo`);
  if (i.web_leads) knownLines.push(`- Web leads: ${i.web_leads} ${tf}`);
  if (i.web_conversions) knownLines.push(`- Web conversions: ${i.web_conversions} ${tf}`);
  if (i.phone_volume) knownLines.push(`- Phone volume: ${i.phone_volume} ${tf}`);
  if (i.after_hours) knownLines.push(`- After hours: ${i.after_hours}`);
  if (i.missed_calls) knownLines.push(`- Missed calls: ${i.missed_calls} ${tf}`);
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

  // ── OUTPUT RULES ──
  const outputRules = `OUTPUT RULES
1. ONLY SPOKEN WORDS. No labels, no headers.
2. Up to 3 statements and a question per turn (4 sentences max, fewer is fine).
3. No symbols, no markdown.
4. Say numbers as words.
5. Max one question at the end.`;

  return `BUSINESS: ${biz} | STAGE: ${s.stage.toUpperCase()}\n\n${knownSection}${roiSection}${memSection}\n\nCURRENT STAGE: ${stageDirective}${vecSection}\n\n${outputRules}`;
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

  // Ads running flag
  const adsOn = !!(
    ts.is_running_ads ?? flags.is_running_ads ?? flags.has_fb_pixel ?? flags.has_google_ads
    ?? deep.ads?.fb?.running ?? deep.ads?.google?.running
  );

  // Script fills from consultant
  const heroQuote = sf.hero_header_quote ?? "";

  // ICP analysis from consultant (new in v9.5)
  const icpAnalysis = intel.consultant?.icpAnalysis ?? {};
  const icpProblems = icpAnalysis.icpProblems ?? [];
  const icpSolutions = icpAnalysis.icpSolutions ?? [];
  const websitePositive = sf.website_positive_comment ?? "";
  const icpGuess = sf.icp_guess ?? "";
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

  // Industry benchmark for ACV (sensible defaults)
  const acvBenchmarks: Record<string, string> = {
    "legal": "around thirty thousand dollars",
    "law": "around thirty thousand dollars",
    "accounting": "around fifteen thousand dollars",
    "medical": "around five thousand dollars",
    "dental": "around three thousand dollars",
    "real_estate": "around ten thousand dollars",
    "trade": "around five thousand dollars",
    "agency": "around twenty thousand dollars",
    "consulting": "around twenty five thousand dollars",
  };
  const acvBenchmark = acvBenchmarks[ind.toLowerCase()] ?? "varies by industry";

  switch (s.stage) {
    case "wow": {
      // Multi-turn WOW using consultant intel — NOTE: Deepgram already said "Hi I'm Bella"
      // so we skip self-intro and go straight to welcoming them to their demo
      // IMPORTANT: stall is already incremented BEFORE this function runs, so stall=1 is first turn

      if (s.stall === 1) {
        // ── CONVERSATIONAL WOW OPENING ──
        // 2 evidence statements + 1 confirmation question. Keep it tight, earn the next turn.
        const shortBiz = biz.includes(" ") ? biz.split(/\s+/)[0] : biz;

        // Pick best 2 insights — ordered by impact
        const cleanIcp = icpGuess
          ? icpGuess
              .replace(/^it\s+(looks|seems)\s+like\s+/i, "")
              .replace(/[,;—–-]+\s*(is that right|right|yeah)\??\s*$/i, "")
              .replace(/\?+$/, "").trim()
          : "";

        // Statement 1: always the same confident opener
        const s1 = `Hi ${fn}, welcome to your personalised demo. We've taken a proper look at ${biz}, and a few things stood out straight away.`;

        // Statement 2: best evidence (ICP > reviews > offer > ads > hero)
        let s2 = "";
        if (cleanIcp) {
          s2 = `It's clear ${cleanIcp}`;
        } else if (googleRating) {
          s2 = `${googleRating} stars from ${googleReviews} reviews shows your reputation is a real strength`;
        } else if (referenceOffer) {
          s2 = `Your core offering around ${referenceOffer} comes through strongly on the site`;
        } else if (adsOn) {
          s2 = `We can see you're investing in paid channels, which tells us you're serious about growth`;
        } else if (websitePositiveFinal) {
          s2 = websitePositiveFinal;
        } else {
          s2 = `The site does a strong job of positioning what ${shortBiz} does`;
        }

        // Confirmation question
        const q = cleanIcp
          ? `Is that a fair read of where ${shortBiz} sits?`
          : `Does that match how you see ${shortBiz}?`;

        // Chunk C: inject retrieved vector snippet if available
        const vecSnippet1 = (intel as any)._retrievedSnippet ?? "";
        const vecCite1 = vecSnippet1
          ? `\nCite verbatim from this retrieved data: "${vecSnippet1}"`
          : "";

        return `WOW — OPENING
IMPORTANT: Do NOT pull phrasing from the BUSINESS INTEL section. Use ONLY the script below.${vecCite1}
SAY EXACTLY THIS:
"${s1} ${s2}. ${q}"
RULES:
- Exactly 2 statements then 1 confirmation question. Nothing more.
- NO "I like" or "I really like" — evidence language only.
- Business name: "${biz}" first mention, then "${shortBiz}" after.
- Then STOP and wait for their response.`;
      }

      if (s.stall === 2) {
        // After they confirm → deliver next best insight they haven't heard yet
        const shortBiz = biz.includes(" ") ? biz.split(/\s+/)[0] : biz;

        // Pick the NEXT best evidence (skip whatever stall=1 already used)
        const usedIcp = !!icpGuess; // stall=1 used ICP if available
        let nextInsight = "";
        if (usedIcp && googleRating) {
          nextInsight = `${googleRating} stars from ${googleReviews} reviews — your reputation is clearly a strength for ${shortBiz}`;
        } else if (usedIcp && referenceOffer) {
          nextInsight = `Your core offering around ${referenceOffer} comes through really clearly on the site`;
        } else if (!usedIcp && referenceOffer) {
          nextInsight = `Your positioning around ${referenceOffer} comes through strongly`;
        } else if (adsOn) {
          nextInsight = `We can see you're investing in paid channels, which tells us you're serious about growth`;
        } else if (heroQuoteFinal) {
          nextInsight = `The messaging around "${heroQuoteFinal}" does a good job of tying your positioning together`;
        }

        // Chunk C: inject retrieved vector snippet if available
        const vecSnippet2 = (intel as any)._retrievedSnippet ?? "";
        const vecCite2 = vecSnippet2
          ? `\nCite verbatim from this retrieved data: "${vecSnippet2}"`
          : "";

        if (nextInsight) {
          return `WOW — SECOND INSIGHT${vecCite2}
SAY APPROXIMATELY THIS:
"${nextInsight}. Tell me ${fn}, how are you currently handling inbound enquiries at ${shortBiz}?"
One statement, one question. Then STOP and wait.`;
        }
        // Fallback: ask about their situation
        return `WOW — SITUATION PROBE
SAY APPROXIMATELY THIS:
"So ${fn}, how are you currently handling your inbound enquiries at ${shortBiz}? Referrals, online, ads, or a mix?"
One question only. Then STOP and wait.`;
      }

      if (s.stall === 3) {
        // ICP + PROBLEMS — Who they serve and what problems those people face
        // GUARD: If consultant data hasn't arrived yet, ask a probing question instead of making vague claims
        const hasIcpData = icpGuess || icpProblems.length >= 1;
        if (!hasIcpData) {
          return `WOW — ICP QUESTION (waiting for intel)
SAY APPROXIMATELY THIS:
"${fn}, tell me — what kind of clients does ${biz} really thrive with? Who are you best positioned to help?"
ALWAYS end with a question. Then STOP and wait. (Scraper is still gathering intel — stall for more data.)`;
        }
        const icpLine = icpGuess
          ? `It looks like you're mainly working with ${icpGuess}.`
          : `Looking at your site, I can see who you're targeting.`;
        const problemsLine = icpProblems.length >= 2
          ? ` And from what I can see, the typical challenges your clients face are things like ${icpProblems.slice(0, 2).join(" and ")}.`
          : "";
        return `WOW — ICP + PROBLEMS
SAY APPROXIMATELY THIS:
"${icpLine}${problemsLine} Is that right?"
ALWAYS end with a confirmation question. Then STOP and wait.`;
      }

      if (s.stall === 4) {
        // SOLUTIONS — How they address those problems
        // GUARD: If solutions data hasn't arrived yet, ask what sets them apart
        const hasSolutionsData = icpSolutions.length >= 1 || referenceOffer;
        if (!hasSolutionsData) {
          return `WOW — SOLUTIONS QUESTION (waiting for intel)
SAY APPROXIMATELY THIS:
"And what would you say sets ${biz} apart from the competition? What do your best clients say about working with you?"
ALWAYS end with a question. Then STOP and wait. (Scraper is still gathering intel — stall for more data.)`;
        }
        const solutionsLine = icpSolutions.length >= 2
          ? `And I can see you address those challenges by offering ${icpSolutions.slice(0, 2).join(" and ")}.`
          : referenceOffer
            ? `And I can see you help them with ${referenceOffer}.`
            : `And you've got some great solutions for them.`;
        return `WOW — SOLUTIONS
SAY APPROXIMATELY THIS:
"${solutionsLine} That's a really strong positioning. Does that capture what ${biz} does?"
ALWAYS end with a confirmation question. Then STOP and wait.`;
      }

      if (s.stall === 5) {
        // SOLUTIONS CONFIRMATION — Keep momentum, don't drop the pre-training line yet
        // Pre-training connect moves to bridge-to-numbers (after Apify deep intel has wowed them)
        return `WOW — CONFIRMATION
SAY APPROXIMATELY THIS:
"That's a really strong foundation, ${fn}. And we've only scratched the surface of what we've found."
Then STOP and wait for their response.`;
      }

      if (s.stall === 6) {
        // ADS + REPUTATION (if Apify ready) or lead gen question (if not)
        if (!s.apify_done && !googleRating) {
          return `WOW — LEAD GEN QUESTION (Apify still loading)
SAY APPROXIMATELY THIS:
"Now ${fn}, I'm curious — what's your main source of new business at the moment? Is it mostly referrals, online ads, organic traffic, or something else?"
ALWAYS end with a question. Then STOP and wait.`;
        }
        const adsLine = adsOn
          ? "I noticed you're running ads — how's that performing for you?"
          : "I didn't see any big campaigns on Facebook or Google — are you running any ads we might have missed?";
        const repLine = googleRating
          ? ` And we've checked out your online rep — ${googleRating} stars from ${googleReviews} reviews.${recentReviewSnippet ? ` One recent review mentioned: "${recentReviewSnippet}"` : ""} Does that match your experience?`
          : "";
        return `WOW — ADS + REPUTATION
SAY APPROXIMATELY THIS:
"${adsLine}${repLine}"
ALWAYS end with a question or confirmation request. Then STOP and wait.`;
      }

      if (s.stall === 7) {
        // If Apify just arrived (wasn't ready at stall=6), deliver the reputation intel now
        if (s.apify_done && googleRating) {
          return `WOW — REPUTATION (Apify just landed)
SAY APPROXIMATELY THIS:
"We've also checked out your online rep — ${googleRating} stars from ${googleReviews} reviews.${recentReviewSnippet ? ` One recent review mentioned: "${recentReviewSnippet}"` : ""} Does that match your experience?"
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
      }

      // stall >= 8 (or earlier if skipping): BRIDGE TO NUMBERS — pre-training connect goes HERE
      {
        const shortBiz = biz.includes(" ") ? biz.split(/\s+/)[0] : biz;
        return `WOW — BRIDGE TO NUMBERS
SAY APPROXIMATELY THIS:
"This is exactly the kind of business intelligence we've used to pre-train your AI team — so they feel like they've been inside ${shortBiz} for years. Not generic bots, they know your positioning, your clients, your reputation. Now ${fn}, based on all this research I can already see some high-value gaps. Would you like me to work out where the biggest opportunities are and what they could be worth?"
Then STOP and wait for their response. Do NOT ask for ACV yet — that comes next if they want the numbers.`;
      }
    }

    case "deep_dive":
      // Auto-advances — shouldn't normally be seen
      return `Continue the WOW naturally. Bridge to numbers.`;

    case "anchor_acv":
      if (i.acv) return `ACV CONFIRMED: ${i.acv.toLocaleString()} dollars.
SAY: "Got it, thanks. Do you tend to think about lead flow weekly or monthly?"
ONE question. STOP.`;
      // stage_before_you_go_acv_setup
      return `ACV SETUP
SAY APPROXIMATELY THIS:
"OK great. The key number for this process is Annual Client Value or ACV — we've got the average ACV for ${ind} as ${acvBenchmark}, but to be spot on with calculating the likely revenue for ${biz}, what's the annual value of a new ${ct}? A ballpark is totally fine."
ONE question. STOP.`;

    case "anchor_timeframe":
      if (i.timeframe) return `TIMEFRAME CONFIRMED: ${i.timeframe}.
Acknowledge briefly and advance to the first channel question.`;
      // stage_acv_ack
      return `TIMEFRAME
ACV confirmed: ${i.acv ? i.acv.toLocaleString() + " dollars" : "(pending)"}.
SAY: "Got it, thanks. Do you tend to think about lead flow weekly or monthly?"
ONE question. STOP.`;

    case "ch_ads": {
      // stage_running_ads_leads_question OR stage_not_running_ads_question
      const need: string[] = [];
      if (i.ads_leads == null) {
        if (adsOn) {
          need.push(`"Now ${fn}, I noticed you're running ads. How many leads are you getting from those ads each ${tf === "weekly" ? "week" : "month"}? Just a rough figure is fine."`);
        } else {
          need.push(`"I didn't see any Google or Facebook ads campaigns — is that right? Are you running any other online campaigns?"`);
        }
      }
      if (i.ads_leads != null && i.ads_conversions == null) {
        need.push(`"Out of those ${i.ads_leads} leads, roughly how many become ${ct}s?"`);
      }
      if (i.ads_conversions != null && i.ads_followup == null) {
        need.push(`"And can I ask, how long does it usually take someone to follow up with those new leads?"`);
      }
      // ALL INPUTS CAPTURED → DELIVER ROI IMMEDIATELY
      if (!need.length) {
        const alexCalc = calcAgentROI("Alex", i);
        if (alexCalc) {
          const tiers: Record<string, string> = { ">24h": "same day or next day", "3h_to_24h": "within a few hours", "30m_to_3h": "within an hour or two", "<30m": "pretty quickly" };
          const speedDesc = tiers[i.ads_followup ?? ">24h"] ?? "same day";
          const upliftPct = { ">24h": "up to 391%", "3h_to_24h": "up to 200%", "30m_to_3h": "around 100%", "<30m": "around 50%" }[i.ads_followup ?? ">24h"];
          return `ADS — Alex — DELIVER ROI NOW
SAY THIS (start with acknowledgment, then spell out the math):
"Perfect, let me just crunch those numbers for you quickly. So your average ${ct} is worth ${i.acv!.toLocaleString()} dollars, and you're currently converting ${i.ads_conversions} from ${i.ads_leads} leads ${tf}. Now, you said you're following up ${speedDesc} — the statistics show that responding in under 30 seconds while the prospect is actively looking raises conversion by ${upliftPct}. So conservatively, Alex could add around ${alexCalc.weekly.toLocaleString()} dollars per week just from speed to lead. Does that make sense?"
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
        return `ADS — Alex — inputs captured but missing ACV for calc. Acknowledge and advance.`;
      }
      return `ADS CHANNEL — Alex
${i.ads_leads != null ? `Leads: ${i.ads_leads} ${tf}. ` : ""}${i.ads_conversions != null ? `Conversions: ${i.ads_conversions}. ` : ""}${i.ads_followup != null ? `Follow-up: ${i.ads_followup}. ` : ""}
SAY THIS:
${need[0]}
ONE question. STOP.`;
    }

    case "ch_website": {
      // stage_website_leads_question + stage_site_followup_rate_question
      const need: string[] = [];
      if (i.web_leads == null) {
        need.push(`"Got it. How many leads are you getting from the website each ${tf === "weekly" ? "week" : "month"}? Again, just a rough figure is fine."`);
      }
      if (i.web_leads != null && i.web_conversions == null) {
        need.push(`"And out of those ${i.web_leads} website leads, roughly how many become ${ct}s?"`);
      }
      // ALL INPUTS CAPTURED → DELIVER ROI IMMEDIATELY
      if (!need.length) {
        const chrisCalc = calcAgentROI("Chris", i);
        if (chrisCalc) {
          return `WEBSITE — Chris — DELIVER ROI NOW
SAY THIS (start with acknowledgment, then spell out the math):
"Great, let me crunch those website numbers. You're getting ${i.web_leads} leads ${tf} and converting ${i.web_conversions} into ${ct}s. Chris our Website Concierge typically lifts conversion by around 23% by engaging visitors in real-time before they bounce. At your ACV of ${i.acv!.toLocaleString()} dollars, Chris could add roughly ${chrisCalc.weekly.toLocaleString()} dollars per week from better website engagement. Sound reasonable?"
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
        return `WEBSITE — Chris — inputs captured but missing ACV for calc. Acknowledge and advance.`;
      }
      return `WEBSITE CHANNEL — Chris
${i.web_leads != null ? `Web leads: ${i.web_leads} ${tf}. ` : ""}${i.web_conversions != null ? `Conversions: ${i.web_conversions}. ` : ""}
SAY THIS:
${need[0]}
ONE question. STOP.`;
    }

    case "ch_phone": {
      // stage_inbound_calls_question + stage_after_hours_question
      const need: string[] = [];
      if (i.phone_volume == null) {
        const phoneLine = loc
          ? `Obviously you have a team taking calls — presumably at the ${loc} office — can I ask, do you know how many appointments you're booking from those inbound calls each ${tf === "weekly" ? "week" : "month"}?`
          : `Obviously you have a team taking calls — can I ask, do you know how many appointments you're booking from those inbound calls each ${tf === "weekly" ? "week" : "month"}?`;
        need.push(`"${phoneLine}"`);
      }
      if (i.phone_volume != null && i.after_hours == null) {
        need.push(`"And I didn't see any mention of a 24/7 phone number on the site, so can I ask what happens to calls that come in after hours or weekends, or just during the day if the reception team is too busy to answer?"`);
      }
      if (i.after_hours && !["24/7 coverage"].includes(i.after_hours) && i.missed_calls == null) {
        need.push(`"Roughly how many calls do you think go unanswered each ${tf === "weekly" ? "week" : "month"}?"`);
      }
      // 24/7 coverage → skip Maddie entirely
      if (i.after_hours === "24/7 coverage") return `PHONE — Maddie — 24/7 coverage confirmed. Skip Maddie, acknowledge and advance.`;
      // ALL INPUTS CAPTURED → DELIVER ROI IMMEDIATELY
      if (!need.length) {
        const maddieCalc = calcAgentROI("Maddie", i);
        if (maddieCalc) {
          const missedEst = i.missed_calls ?? Math.round(i.phone_volume! * 0.3);
          return `PHONE — Maddie — DELIVER ROI NOW
SAY THIS (start with acknowledgment, then spell out the math):
"OK let me work out the phone opportunity. You're getting around ${i.phone_volume} calls ${tf}, and after hours ${i.after_hours}. Typically, businesses miss around 30% of calls — so roughly ${missedEst} missed calls ${tf}. At a 30% conversion rate and your ACV of ${i.acv!.toLocaleString()} dollars, Maddie answering those missed calls could add around ${maddieCalc.weekly.toLocaleString()} dollars per week. Does that track with what you'd expect?"
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
        return `PHONE — Maddie — inputs captured but missing ACV for calc. Acknowledge and advance.`;
      }
      return `PHONE CHANNEL — Maddie
${i.phone_volume != null ? `Phone volume: ${i.phone_volume} ${tf}. ` : ""}${i.after_hours != null ? `After hours: ${i.after_hours}. ` : ""}${i.missed_calls != null ? `Missed calls: ${i.missed_calls}. ` : ""}
SAY THIS:
${need[0]}
ONE question. STOP.`;
    }

    case "ch_old_leads": {
      // stage_old_leads_question
      if (i.old_leads != null) {
        const sarahCalc = calcAgentROI("Sarah", i);
        if (sarahCalc) {
          return `OLD LEADS — Sarah — DELIVER ROI NOW
SAY THIS (start with acknowledgment, then spell out the math):
"OK let me calculate the database opportunity. So ${i.old_leads} old leads — typically about 5% of dormant leads can be reactivated with the right follow-up sequence. At your ACV of ${i.acv!.toLocaleString()} dollars, that's roughly ${Math.round(i.old_leads * 0.05)} potential ${ct}s. Sarah running a database reactivation campaign could add around ${sarahCalc.weekly.toLocaleString()} dollars per week. Sound about right?"
ALWAYS end with a confirmation question. Then STOP and wait.`;
        }
        return `OLD LEADS — Sarah — CONFIRMED: ${i.old_leads} leads but missing ACV. Acknowledge and advance.`;
      }
      return `OLD LEADS — Sarah
SAY THIS:
"OK so I see that your business has been around a while — so I'm guessing you must have a pretty sizeable database of old leads. Can you tell me how many old leads you have, say from the last 12 months?"
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
          const annualCust = i.new_cust_per_period! * (i.timeframe === "monthly" ? 12 : 52);
          return `REVIEWS — James — DELIVER ROI NOW
SAY THIS (start with acknowledgment, then spell out the math):
"OK let me work out the reputation opportunity. You're bringing in ${i.new_cust_per_period} new ${ct}s ${tf}, and you don't have an automated review system. Research shows that a one-star improvement in rating can lift revenue by up to 9%. With ${annualCust} ${ct}s a year at ${i.acv!.toLocaleString()} dollars each, James running automated review requests could add around ${jamesCalc.weekly.toLocaleString()} dollars per week from better reputation. Does that resonate?"
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

    case "roi_delivery":
      // SUMMARY — individual calculations were already delivered per-channel
      if (top3.length) {
        const agentList = top3.map(a => `${a.agent} at ${a.weekly.toLocaleString()} dollars`).join(", ");
        return `ROI SUMMARY
SAY APPROXIMATELY THIS:
"So just to recap ${fn} — I've calculated each agent's value as we went. ${agentList}. That's a combined total of around ${total.toLocaleString()} dollars per week across your ${top3.length} recommended agents. Does that all make sense?"
Then STOP and wait for their response. Keep it brief — the detailed math was already delivered.`;
      }
      return `ROI DELIVERY
Not enough inputs for precise ROI.
SAY: "I can see the opportunity clearly, but I'd keep those estimates directional until we confirm one or two more numbers."
Then ask the single most important missing input.`;

    case "close":
      // stage_trial_close_and_exit
      return `CLOSE
SAY APPROXIMATELY THIS:
"I'll leave you to enjoy your demo. And just to make sure you see that these numbers are real, we're currently offering a free trial of the entire team for 7 days — I'd suggest you take advantage of that. I'll get you onboarded myself, no card required. Based on these numbers you're looking at a bump of at least ${total > 0 ? total.toLocaleString() + " dollars" : "solid revenue"} just during your first free week.

Anyway, I'll leave you to explore. If you have any questions or need any more help just click my button and I'll be here to help. Enjoy!"`;

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

async function streamToDeepgram(messages: Msg[], env: Env): Promise<Response> {
  const t0 = Date.now();
  const gemRes = await fetch(GEMINI_URL, {
    method: "POST",
    signal: AbortSignal.timeout(30000),
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.GEMINI_API_KEY}`,
      "x-goog-api-key": env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      model: MODEL, messages, stream: true, temperature: 0.95,
      max_tokens: 500,
      stream_options: { include_usage: true },
    }),
  });

  const ttfb = Date.now() - t0;
  log("GEMINI_TTFB", `${ttfb}ms (status=${gemRes.status})`);

  if (!gemRes.ok || !gemRes.body) {
    const errBody = await gemRes.text().catch(() => "no-body");
    log("GEMINI_ERR", `status=${gemRes.status} body=${errBody}`);
    const fallback = [
      `data: {"id":"f","object":"chat.completion.chunk","model":"${MODEL}","choices":[{"index":0,"delta":{"content":"Give me one moment."},"finish_reason":null}]}`,
      `data: {"id":"f","object":"chat.completion.chunk","model":"${MODEL}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
      "data: [DONE]\n",
    ].join("\n");
    return new Response(fallback, { headers: { "Content-Type": "text/event-stream" } });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  (async () => {
    const reader = gemRes.body!.getReader();
    let firstContentAt = 0;
    let chunkCount = 0;
    let sseBuffer = "";
    let responseText = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunkCount++;
        if (chunkCount === 1) {
          firstContentAt = Date.now() - t0;
          log("GEMINI_FIRST_CHUNK", `${firstContentAt}ms`);
        }
        await writer.write(value);

        // Parse SSE chunks to extract usage + response content
        sseBuffer += dec.decode(value, { stream: true });
        const lines = sseBuffer.split("\n");
        sseBuffer = lines.pop() ?? "";  // keep incomplete line in buffer
        for (const line of lines) {
          if (!line.startsWith("data: ") || line === "data: [DONE]") continue;
          try {
            const chunk = JSON.parse(line.slice(6));
            // Accumulate response text
            const delta = chunk.choices?.[0]?.delta?.content;
            if (delta) responseText += delta;
            // Usage info appears in the final chunk
            if (chunk.usage) {
              const u = chunk.usage;
              const cached = u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? 0;
              log("GEMINI_USAGE", `prompt=${u.prompt_tokens ?? "?"} cached=${cached} completion=${u.completion_tokens ?? "?"} total=${u.total_tokens ?? "?"}`);
            }
          } catch { }
        }
      }
      const totalMs = Date.now() - t0;
      log("BELLA_SAID", responseText.slice(0, 300));
      log("GEMINI_DONE", `total=${totalMs}ms chunks=${chunkCount} first_chunk=${firstContentAt}ms`);
      await writer.write(enc.encode("data: [DONE]\n\n"));
    } catch (e) {
      log("GEMINI_STREAM_ERR", `${e}`);
    }
    finally { writer.close().catch(() => { }); }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache", "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
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
    const lid = getLid(messages);
    log("REQ", `lid=${lid} msgs=${messages.length}`);

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

    // FALLBACK: extract prospect_first_name and prospect_business from DG system prompt
    // when KV intel is empty (fast-intel still running). Voice agent embeds these from URL params.
    if (!intel.first_name || !intel.business_name) {
      const sys = messages.find(m => m.role === "system")?.content ?? "";
      if (typeof sys === "string") {
        const fnMatch = sys.match(/prospect_first_name:\s*([^.]+)/);
        const bizMatch = sys.match(/prospect_business:\s*([^.]+)/);
        if (fnMatch?.[1] && fnMatch[1].trim() !== "unknown" && !intel.first_name) {
          intel.first_name = fnMatch[1].trim();
          intel.firstName = fnMatch[1].trim();
          log("FALLBACK", `first_name="${intel.first_name}" from DG system prompt`);
        }
        if (bizMatch?.[1] && bizMatch[1].trim() !== "unknown" && !intel.business_name) {
          intel.business_name = bizMatch[1].trim();
          log("FALLBACK", `business_name="${intel.business_name}" from DG system prompt`);
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
          stall: 0, init: new Date().toISOString(), _lastTurn: 0, _lastUttHash: ""
        };
      }
    } else {
      s = {
        stage: "wow", queue: ["ch_website"], done: [], inputs: { ...BLANK },
              maddie_skip: false, wants_numbers: false, just_demo: false, apify_done: false, calc_ready: false,
        stall: 0, init: new Date().toISOString(), _lastTurn: 0, _lastUttHash: ""
      };
    }
    // ── V8 LATE-LOAD: Pick up script_stages that arrived after turn 1 init ────
    // Workflow writes lead:{lid}:script_stages AFTER Apify completes (~30-60s).
    // If initState ran before that, s.scriptStages is undefined → legacy mode.
    // This re-checks KV each turn (while still in wow) until stages arrive.
    if (lid && !s.scriptStages) {
      try {
        const lateRaw = await env.LEADS_KV.get(`lead:${lid}:script_stages`);
        if (lateRaw) {
          const lateStages = JSON.parse(lateRaw);
          if (lateStages?.stages) {
            s.scriptStages = lateStages;
            s = seedV8State(s);
            log("LATE_LOAD", `script_stages arrived after init for lid=${lid} — V8 mode activated`);
          }
        }
      } catch (e) {
        log("WARN", `Failed to late-load script_stages: ${e}`);
      }
    }

    // ── V8 HOT-SWAP: Refresh script stages mid-conversation ───────────────────
    if (lid && s.stage === "wow") {
      const arrivedStages = intel.stages;
      const currentSource = (s.scriptStages as any)?.source || 'heuristic';
      const arrivedSource = (arrivedStages as any)?.source || 'heuristic';

      // Only swap "up" (from heuristic to consultant)
      if (arrivedStages && currentSource === 'heuristic' && arrivedSource === 'consultant') {
        log("HOT_SWAP", `high-fidelity script arrived for lid=${lid} — swapping now`);
        s.scriptStages = arrivedStages;
        (s.scriptStages as any).source = 'consultant';
        if (s.scriptStages.stages?.[s.v8StageIndex || 0]) {
           s.v8StageKey = s.scriptStages.stages[s.v8StageIndex || 0].key;
           s.v8CaptureKey = s.scriptStages.stages[s.v8StageIndex || 0].capture;
           log("HOT_SWAP", `re-indexed to key=${s.v8StageKey} idx=${s.v8StageIndex}`);
        }
      }
    }

    // ── Check if Apify data has landed this turn ────────────────────────────
    // intel.deep is written by deep-scrape-workflow once all 5 actors complete (~30-45s).
    // We set apify_done=true on state so the deep_dive gate can open.
    // SCHEMA FIX: Check both intel.intel.deep (big scraper) and intel.deep (deep-scrape)
    const deepStatus = (intel as any).intel?.deep?.status ?? intel.deep?.status;
    if (!s.apify_done && deepStatus === "done") {
      s.apify_done = true;
      log("APIFY", `deep intel landed for lid=${lid} — gate will open next advance`);
    }

    // ── DATA LAYER STATUS LOG — visible every turn so we can see what Gemini has ──
    const fastLoaded = !!(intel.fast_intel || intel.core_identity?.business_name);
    const apifyLoaded = deepStatus === "done";
    const fullLoaded = intel.full_scrape?.status === "done";
    log("KV_STATUS", `lid=${lid} turn=${messages.length} fast=${fastLoaded} apify=${apifyLoaded} full=${fullLoaded} kv_bytes=${JSON.stringify(intel).length}`);
    const _sf = intel.consultant?.scriptFills ?? {};
    const _sfKeys = Object.keys(_sf).filter(k => _sf[k]);
    log("SCRIPTFILLS", `lid=${lid} present=${_sfKeys.length > 0} keys=[${_sfKeys.join(',')}] bella_opener=${!!(intel.bella_opener)} hero_h2=${!!(intel.hero?.h2 || (intel as any).fast_intel?.hero?.h2)}`);

    // ── EXTRACTION: inline regex — instant, no LLM call ────────────────────────
    const utt = lastUser(messages);
    const stageAtUtterance = s.stage;
    const extractIndustry = intel.core_identity?.industry ?? intel.core_identity?.industry_key ?? "";
    log("UTT", `lid=${lid} stage=${stageAtUtterance} utt_chars=${utt.length} utt_preview="${utt.slice(0, 80)}"`);
    if (utt && lid) {
      s = await extractAndApply(utt, s, lid, env, stageAtUtterance, extractIndustry);
    }

    // ── Advance stage if gate opens ─────────────────────────────────────────
    // Defense-in-depth: DG can send multiple requests for one utterance (micro-pauses,
    // interim transcripts, or prefix → full transcript). We use BOTH message count AND
    // content hashing to ensure stall only increments on genuinely new user exchanges.
    const turnNum = messages.length;
    const uttHash = utt.trim().toLowerCase().slice(0, 200);
    const prevHash = s._lastUttHash ?? "";
    const isNewTurn = turnNum > (s._lastTurn ?? 0);
    const isNewContent = uttHash.length > 0
      && (prevHash.length === 0 || (
        !uttHash.startsWith(prevHash) && !prevHash.startsWith(uttHash)
      ));

    if (isNewTurn && isNewContent) {
      s.stall++;
      s._lastTurn = turnNum;
      s._lastUttHash = uttHash;
    } else {
      s._lastTurn = Math.max(s._lastTurn ?? 0, turnNum);
      log("DEDUP", `lid=${lid} turn=${turnNum} duplicate content — stall=${s.stall}`);
    }
    if (gateOpen(s)) {
      s.calc_ready = isCalcReady(s.inputs, s.maddie_skip);
      // V8: use V8 stage advance if we have Stage[] from call_brief
      s = s.scriptStages?.stages ? advanceV8Stage(s) : advance(s);
    }
    // Safety: removed stall force-advance to ensure Bella waits for scraper data
    if (s.stall > 5 && s.stage !== "roi_delivery" && s.stage !== "close") {
      log("STALL", `waiting for data at ${s.stage} (${s.stall} turns)`);
    }

    // Fire-and-forget: state is needed for NEXT turn, not this one.
    // ctx.waitUntil ensures it completes before Worker terminates.
    if (lid) ctx.waitUntil(saveState(lid, s, env));

    // ── Trim history ──────────────────────────────────────────────────────
    const trimmed = trimHistory(messages);

    // ── Qualitative memory: regex-based, sync — append signals to convMemory ──
    if (utt && lid && utt.length > 10) {
      const signals = extractQualitativeSignals(utt);
      if (signals) {
        const updated = convMemory ? `${convMemory}\n${signals}` : signals;
        convMemory = updated.length > 2000 ? updated.slice(-2000) : updated;
        // Fire-and-forget KV write — don't block the stream
        env.LEADS_KV.put(`lead:${lid}:conv_memory`, convMemory).catch(() => {});
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
    log("WOW_STALL", `lid=${lid} stage=${s.stage} stall=${s.stall}`);
    const turnPrompt = buildTurnPrompt(s, intel, convMemory);

    // ── System message: lean persona + intel + turn context (all in one) ─────
    const systemContent = lid
      ? `lead_id: ${lid}\n\n${bridgeSystem}\n\n${turnPrompt}`
      : `${bridgeSystem}\n\n${turnPrompt}`;
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
    return streamToDeepgram(finalMessages, env);
  },
};
