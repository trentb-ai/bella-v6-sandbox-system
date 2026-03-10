/**
 * deepgram-bridge-v6 — RICH ORCHESTRATOR v6.2.0
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
}

const VERSION = "6.2.0-D";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODEL = "gemini-3.1-flash-lite-preview";

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
  const deep = intel.deep ?? {};

  // Ads: pixel detection (immediate) → Apify deep → fast_context fallback
  // Also triggers ch_ads if social media or email marketing detected —
  // they're sending traffic to a landing page either way, same conversion problem
  const adsRunning = flags.is_running_ads
    ?? flags.has_fb_pixel
    ?? flags.has_google_ads
    ?? (deep.ads?.fb?.running || deep.ads?.google?.running)
    ?? intel.fast_context?.ads?.is_running_ads
    ?? intel.tech_stack?.is_running_ads
    ?? false;

  const socialOrEmailTraffic = !!(
    intel.tech_stack?.social_channels?.length > 0
    || intel.tech_stack?.has_email_marketing
    || flags.database_likely
  );

  if (adsRunning || socialOrEmailTraffic) q.push("ch_ads");
  q.push("ch_website");

  // Phone: Phase B flags, or if business has a phone number from any source
  if (flags.speed_to_lead_needed || flags.call_handling_needed || ci.phone) q.push("ch_phone");

  // Old leads/DBR: email marketing tool or ecommerce = database exists; or Apify hiring signals
  if (flags.database_reactivation || flags.database_likely || flags.business_age_established
    || deep.hiring?.is_hiring || intel.tech_stack?.database_likely) q.push("ch_old_leads");

  // Reviews: Phase B website_health, or Google Maps data from Apify deep track
  const reviewCount = intel.website_health?.review_count ?? deep.googleMaps?.review_count ?? 0;
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
  await env.LEADS_KV.put(`lead:${lid}:script_state`, JSON.stringify(s), { expirationTtl: 7200 });
}

async function initState(lid: string, env: Env): Promise<State> {
  let intel: Record<string, any> = {};
  try {
    const raw = await env.LEADS_KV.get(`lead:${lid}:intel`);
    if (raw) intel = JSON.parse(raw);
  } catch { }
  const flags = intel.flags ?? intel.fast_context?.flags ?? {};
  const queue = buildQueue(flags, intel);
  const s: State = {
    stage: "wow", queue, done: [], inputs: { ...BLANK },
    maddie_skip: false, wants_numbers: false, apify_done: false, calc_ready: false,
    stall: 0, init: new Date().toISOString(),
  };
  await saveState(lid, s, env);
  log("INIT", `lid=${lid} queue=[${queue.join(",")}]`);
  return s;
}

// ─── STAGE GATE ───────────────────────────────────────────────────────────────

function gateOpen(s: State): boolean {
  const { stage: st, inputs: i } = s;
  switch (st) {
    case "wow": return s.wants_numbers;
    // deep_dive gate: open when apify data has landed (intel.deep.status=done)
    case "deep_dive": return !!(s.apify_done);
    case "anchor_acv": return i.acv !== null;
    case "anchor_timeframe": return i.timeframe !== null;
    case "ch_ads": return i.ads_leads !== null && i.ads_conversions !== null;
    case "ch_website": return i.web_leads !== null && i.web_conversions !== null;
    case "ch_phone": return i.after_hours !== null && i.phone_volume !== null;
    case "ch_old_leads": return i.old_leads !== null;
    case "ch_reviews": return i.star_rating !== null && i.has_review_system !== null;
    case "roi_delivery": return true;
    case "close": return true;
  }
}

// ─── ADVANCE STAGE ────────────────────────────────────────────────────────────

function advance(s: State): State {
  s.done.push(s.stage);
  s.stall = 0;
  if (s.stage === "wow") s.stage = "deep_dive";
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

function runCalcs(i: Inputs): Calc[] {
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
  if (i.phone_volume !== null && i.after_hours && !i.maddie_skip) {
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
    const base = i.new_cust_per_period ?? 10;
    const weekly = Math.round(base * (i.timeframe === "monthly" ? wf : 1) * i.acv * 0.09 / 52);
    out.push({
      agent: "James", weekly, precise: false,
      why: `1-star improvement → 9% revenue uplift (directional)`
    });
  }
  return out.sort((a, b) => b.weekly - a.weekly);
}

function isCalcReady(i: Inputs): boolean {
  const results = runCalcs(i);
  return results.length >= 2 && results.some(r => r.precise);
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

// ─── EXTRACTION ──────────────────────────────────────────────────────────────

interface Extracted { field: string; value: any; }

function extractTask(stage: Stage): string {
  const tasks: Record<Stage, string> = {
    wow: `Return [{field:"wants_numbers",value:true}] if person agrees to run numbers or ROI, else []`,
    deep_dive: `null`,  // observation stage — no extraction needed, Bella leads with data
    anchor_acv: `Extract annual customer value in AUD. Return [{field:"acv",value:NUMBER}] or []`,
    anchor_timeframe: `Return [{field:"timeframe",value:"weekly"}] or [{field:"timeframe",value:"monthly"}] else []`,
    ch_ads: `Extract any: ads_leads(number), ads_conversions(number), ads_followup(">24h"|"3h_to_24h"|"30m_to_3h"|"<30m"), ad_spend(number). Return array.`,
    ch_website: `Extract any: web_leads(number), web_conversions(number). Return array.`,
    ch_phone: `Extract any: phone_volume(number), missed_calls(number), phone_conversion(decimal), after_hours(string). Return array.`,
    ch_old_leads: `Return [{field:"old_leads",value:NUMBER}] or []`,
    ch_reviews: `Extract any: star_rating(number), review_count(number), has_review_system(boolean). Return array.`,
    roi_delivery: `null`,
    close: `null`,
  };
  return tasks[stage] ?? "null";
}

// ─── FIX 1: EXTRACTION IS NOW AWAITED (was fire-and-forget — race condition) ──

async function extractAndApply(utterance: string, s: State, lid: string, env: Env, stageOverride?: Stage): Promise<State> {
  const task = extractTask(stageOverride ?? s.stage);
  if (!task || task === "null" || !utterance) return s;

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      signal: AbortSignal.timeout(2500),
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.GEMINI_API_KEY}`,
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: MODEL, stream: false, temperature: 0,
        messages: [{
          role: "user",
          content: `Prospect said: "${utterance}"\nTask: ${task}\nReturn ONLY valid JSON array. No markdown. No explanation.`,
        }],
      }),
    });
    if (!res.ok) return s;
    const data: any = await res.json();
    const txt = data.choices?.[0]?.message?.content ?? "[]";
    const items: Extracted[] = JSON.parse(txt.replace(/```json|```/g, "").trim());
    if (!items?.length) return s;

    for (const { field, value } of items) {
      if (value == null) continue;
      if (field in BLANK) (s.inputs as any)[field] = value;
      if (field === "wants_numbers" && value === true) s.wants_numbers = true;
      if (field === "after_hours" && typeof value === "string") {
        if (["24/7", "24-7", "always", "call centre", "call center"].some(x => value.toLowerCase().includes(x))) {
          s.maddie_skip = true;
          log("FLAG", "maddie_skip=true");
        }
      }
      log("CAPTURED", `${field}=${JSON.stringify(value)}`);
    }

    // Persist to tools worker (fire-and-forget — KV side-effect only)
    const { inputs: i } = s;
    if (i.acv) {
      env.TOOLS.fetch(new Request("https://tools-internal/capture_acv", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.TOOLS_BEARER}` },
        body: JSON.stringify({ lid, acv: i.acv }),
      })).catch(() => { });
    }
    const convData: Record<string, any> = {};
    if (i.web_leads) convData.website_leads = i.web_leads;
    if (i.ads_leads) convData.ad_leads = i.ads_leads;
    if (i.phone_volume) convData.phone_leads = i.phone_volume;
    if (i.old_leads) convData.old_crm = i.old_leads;
    if (i.phone_conversion) convData.followup_rate = i.phone_conversion;
    if (Object.keys(convData).length) {
      env.TOOLS.fetch(new Request("https://tools-internal/save_conversation_data", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.TOOLS_BEARER}` },
        body: JSON.stringify({ lid, data: convData }),
      })).catch(() => { });
    }
  } catch (e) {
    log("EXTRACT_ERR", String(e));
  }
  return s;
}

// ─── FIX 3: HISTORY DISTILLATION ─────────────────────────────────────────────
//
// Problem: Deepgram sends FULL conversation history every turn.
// After ~20 turns the payload bloats → latency spikes → Deepgram drops connection.
//
// Solution: Keep last 6 raw turns for natural conversational flow.
// Compress everything older into a structured "conv_memory" string via Gemini.
// conv_memory captures: objections, named details, tone signals, commitments.
// Numeric inputs are already in s.inputs — distillation captures the QUALITATIVE layer.
//
// conv_memory is injected as an early user/assistant exchange so Gemini sees it
// as "remembered context" not as a system directive.

const DISTIL_THRESHOLD = 6; // start distilling when history exceeds this many turns
const KEEP_RAW = 6; // always keep this many recent raw turns

async function distilHistory(
  messages: Msg[],
  lid: string,
  env: Env,
): Promise<{ trimmed: Msg[]; memoryInjection: Msg[] }> {
  const history = messages.filter(m => m.role !== "system");

  // Not enough history to need distillation yet
  if (history.length <= DISTIL_THRESHOLD) {
    return { trimmed: history, memoryInjection: [] };
  }

  const old = history.slice(0, history.length - KEEP_RAW);
  const fresh = history.slice(history.length - KEEP_RAW);

  // Load existing memory from KV
  let existing = "";
  try {
    existing = (await env.LEADS_KV.get(`lead:${lid}:conv_memory`)) ?? "";
  } catch { }

  // Build distillation prompt — focus on QUALITATIVE signals only
  // (numerics are already in s.inputs)
  const oldText = old.map(m => `${m.role}: ${m.content}`).join("\n");
  const distilPrompt = `You are summarising a sales call transcript for memory compression.

${existing ? `EXISTING MEMORY:\n${existing}\n\n` : ""}NEW TURNS TO COMPRESS:
${oldText}

Extract ONLY qualitative signals not already in structured data:
- Objections raised (e.g. "they said they already have a CRM")
- Named details volunteered (staff names, specific products, pain points in their words)
- Tone/engagement signals (e.g. "sounded skeptical about ads ROI", "very engaged on reviews")
- Commitments or strong statements (e.g. "said they'd definitely try the free trial")
- Things to avoid (e.g. "don't mention price again, they pushed back hard")

Write as 3-6 concise bullet points. Be specific. Do NOT repeat numeric inputs.
Return ONLY the bullet points, no preamble.`;

  let memory = existing;
  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.GEMINI_API_KEY}`,
        "x-goog-api-key": env.GEMINI_API_KEY
      },
      body: JSON.stringify({
        model: MODEL, stream: false, temperature: 0,
        messages: [{ role: "user", content: distilPrompt }],
      }),
    });
    if (res.ok) {
      const d: any = await res.json();
      memory = d.choices?.[0]?.message?.content ?? existing;
      // Persist updated memory to KV (fire-and-forget)
      env.LEADS_KV.put(`lead:${lid}:conv_memory`, memory, { expirationTtl: 7200 }).catch(() => { });
      log("DISTIL", `compressed ${old.length} turns → ${memory.length} chars`);
    }
  } catch (e) {
    log("DISTIL_ERR", String(e));
  }

  const finalTrimmed = fresh[0]?.role === "assistant" ? fresh.slice(1) : fresh;
  return { trimmed: finalTrimmed, memoryInjection: [] };
}

// ─── FIX 2: RICH FULL PROMPT ─────────────────────────────────────────────────
//
// Replaces the 150-token "one directive" straitjacket.
// Gemini 2.5 Flash has 1M token context — there is zero reason to be stingy.
//
// Gemini now receives:
//   - Complete Bella persona + tone rules
//   - Full scraped business intel
//   - Full conversation script (all stages, canonical phrasing)
//   - YOU ARE HERE marker (current stage highlighted)
//   - Captured inputs so far (what we know numerically)
//   - Distilled conversation memory (qualitative signals)
//
// The state machine still runs in TypeScript as a safety net.
// But Gemini is no longer a voice box reading one line at a time —
// it has everything it needs to sound natural, fluid, and human.

function buildRichPrompt(s: State, intel: Record<string, any>, convMemory: string): string {
  const ci = intel.core_identity ?? {};
  const sf = intel.consultant?.scriptFills ?? {};
  const cons = intel.consultant ?? {};
  const wh = intel.website_health ?? {};
  const ts = intel.tech_stack ?? {};
  const flags = intel.flags ?? {};
  const deep = intel.deep ?? {};
  const hero = (intel as any).hero ?? (intel as any).fast_intel?.hero ?? {};
  const fn = intel.first_name ?? ci.first_name ?? "";
  const biz = ci.business_name ?? intel.fast_context?.business?.name ?? "your business";
  const ind = ci.industry ?? ci.industry_key ?? "";
  const loc = ci.location ?? "";
  const ct = custTerm(ind);
  const tf = s.inputs.timeframe ?? "weekly";

  // Ads: Phase B flags → Apify deep → Firecrawl fast context
  // adsOn: pixel detection (tech_stack/wh) wins → Apify deep → flags → fast_context
  // NEVER say "no ads" just because Apify hasn't landed yet — pixel data is authoritative
  const adsOn = !!(
    wh.is_running_ads                          // from tech_stack pixel scan (T=0)
    ?? wh.ads_pixels?.length > 0              // belt and suspenders
    ?? intel.tech_stack?.is_running_ads       // direct from fast-intel
    ?? flags.is_running_ads                   // from flags object
    ?? flags.has_fb_pixel                     // individual pixel flags
    ?? flags.has_google_ads
    ?? deep.ads?.fb?.running                  // Apify (lands ~30s)
    ?? deep.ads?.google?.running
    ?? intel.fast_context?.ads?.is_running_ads
  );

  // Google Maps: Phase B website_health → Apify deep track
  const googleRating = wh.google_rating ?? deep.googleMaps?.rating ?? null;
  const googleReviews = wh.review_count ?? deep.googleMaps?.review_count ?? 0;

  const calcs = runCalcs(s.inputs);
  const top3 = calcs.slice(0, 3);
  const total = top3.reduce((sum, c) => sum + c.weekly, 0);

  // ── SECTION 1: MASTER PERSONA ────────────────────────────────────────────
  const persona = `You are Bella — Strategic Intelligence Director at Pillar and Post.

WHO YOU ARE:
You're the kind of person who actually did the homework before the meeting. You've looked through the business, noticed things most people miss, and you're genuinely curious about what's going on behind the scenes. You're not here to sell — you're here to show someone what's possible, and let the numbers do the talking.

You're warm, sharp, and a little bit direct — in the way that earns respect. You laugh easily. You don't pad sentences with filler. When something genuinely impresses you, you say so. When something's a missed opportunity, you name it honestly, not harshly.

Think: smart colleague who happens to know a lot about revenue, AI, and digital systems. Not a sales rep. Not a consultant who charges by the hour. Someone who's done the pre-work and is now genuinely interested in what's happening inside this business.

YOUR VOICE IN CONVERSATION:
You speak the way smart people actually talk — not the way corporate presentations are written.
- Short sentences. Real words. No buzzwords.
- You acknowledge before you advance. Always.
- When you're curious, you sound curious. When something surprises you, you say so.
- You don't robotically collect data — you're having a conversation that happens to surface useful information.
- If they go off-topic, you go with them briefly, then bring it back naturally.
- If they're uncertain about a number, you make it easy: "Ballpark is totally fine — even a rough sense helps."
- If they push back on something, you don't deflect — you engage. "That's fair, yeah. Here's why I still think it's worth looking at..."
- You notice things and name them: "That's actually interesting — most businesses in that space don't track that."
- You have a light touch with humour when it fits. You're not performing warmth — you have it.

WHAT YOU NEVER DO:
- Sound like a script. Even when you're following one.
- Dump a list of facts on someone. One observation at a time, naturally woven in.
- Say "As an AI..." — you are Bella, full stop.
- Use dollar signs, asterisks, bullet points, or any text formatting in speech. Say "five thousand dollars", not "$5,000".
- Ask two questions in a row. One question, then stop and actually listen.
- Hallucinate numbers. If you don't have the data, don't estimate.
- Combine revenue channels. Each one is tracked and discussed separately.
- Over-explain what the demo is. They'll see it. Show, don't tell.

CONVERSATION RHYTHM:
Every response is maximum 2 sentences. Then you stop and let them respond.
You're not a monologue — you're the best kind of two-way conversation.
Acknowledge what they just said. Then advance.
One question per turn. At the end. Then silence.

NUMBERS AND CALCULATIONS:
You only use real inputs — things the prospect tells you, or things scraped from their actual site.
You never invent benchmarks. The approved ones are:
  Alex: "Responding in under a minute can increase conversions by 391 percent versus slower response times."
  Chris: "Websites with AI chat see around 23 percent higher conversion rates."
  Maddie: "78 percent of customers go with the first business that responds."
  Sarah: "Database reactivation typically sees around a 5 percent conversion from dormant leads."
  James: "A one-star rating increase typically drives about a 9 percent revenue lift."

Calculation rules (use exactly, never invent):
  Alex: baseline = conversions/leads. Uplift: >24h=391%, 3-24h=200%, 30min-3h=100%, <30min=50%. Revenue = conversions × uplift × ACV.
  Chris: incremental = web_conversions × 0.23. Revenue = incremental × ACV.
  Maddie: Revenue = missed_calls × conversion_rate × ACV.
  Sarah: reactivated = old_leads × 0.05. Revenue = reactivated × ACV / 52 weekly.
  James: directional only. 9% of (customers × ACV).
If a required input is missing — ask for it. If they don't know — ballpark is fine. If no trustworthy number exists — don't calculate.

WHICH AGENTS TO RECOMMEND:
You recommend 2-3 max, always the highest calculated ROI.
  Ads or social traffic → Alex + Chris first, almost always
  Email marketing tool detected → Alex + Chris (they're mailing to landing pages, same problem)
  Non-AI chatbot on site → Chris is an easy win — they already believe in chat, just upgrade it
  Strong phone volume + gaps in coverage → Maddie + Chris
  Slow lead follow-up → Alex
  Email list or ecommerce → Sarah
  Weak or no review process → James

CHANNELS — ALWAYS SEPARATE:
Website leads, ad leads, phone volume, old leads, reviews — each is its own conversation. Never merge them.

INDUSTRY LANGUAGE:
Mirror their world naturally. Legal = clients, matters. Medical = patients, appointments. Trades = jobs, quotes. Agency = clients, retainers. Real estate = listings, appraisals. Finance = policies, applications. Hospitality = bookings, reservations. Education = students, enrolments.

TIMEFRAME:
Let them choose weekly or monthly once, early. Mirror it every time after.

FREE TRIAL CLOSE (use this phrasing):
"We start it at 7 days — usually that's more than enough to see real movement. If you want more certainty we can push to 14. No card needed. Honestly, set and forget."

THE AGENTS:
  Alex — speed-to-lead. Jumps on paid and inbound leads in under a minute.
  Chris — website and inbound conversion. The voice on the landing page.
  Maddie — missed calls, after-hours, first response.
  Sarah — dormant database reactivation.
  James — reviews and reputation.`;

  // ── SECTION 2: BUSINESS INTEL ─────────────────────────────────────────────
  const intelLines: string[] = [
    `BUSINESS INTEL FOR ${biz.toUpperCase()}`,
    `Business: ${biz}${loc ? ` | Location: ${loc}` : ""} | Industry: ${ind}`,
  ];
  if (ci.tagline) intelLines.push(`Tagline: "${ci.tagline}"`);
  if (ci.model) intelLines.push(`Business model: ${ci.model}`);
  if (ci.phone) intelLines.push(`Phone: ${ci.phone}`);
  if (ci.business_hours) intelLines.push(`Hours: ${ci.business_hours}`);
  if (wh.google_rating) intelLines.push(`Google: ${wh.google_rating}/5 (${wh.review_count ?? "?"} reviews)`);

  // Tech stack — rich xray data from HTML pixel/script scanning
  const techLines: string[] = [];
  if (wh.crm_name) techLines.push(`CRM: ${wh.crm_name}`);
  if (wh.booking_tool) techLines.push(`Booking: ${wh.booking_tool}`);
  if (wh.chat_tool) {
    techLines.push(`Chat: ${wh.chat_tool}${wh.is_non_ai_chat ? " (NON-AI — legacy chatbot)" : wh.chat_likely_basic ? " (AI-capable, likely basic mode)" : ""}`);
  } else if (wh.has_chat) techLines.push(`Chat: yes (tool unknown)`);
  if (wh.email_tool) techLines.push(`Email marketing: ${wh.email_tool}`);
  if (wh.payment_tool) techLines.push(`Payment: ${wh.payment_tool}`);
  if (wh.ecommerce_platform) techLines.push(`Ecommerce: ${wh.ecommerce_platform}`);
  if (wh.site_platform) techLines.push(`Built with: ${wh.site_platform}`);
  if (techLines.length) intelLines.push(`Tech stack: ${techLines.join(" | ")}`);

  // Ad pixels — the money signals
  // Source: HTML pixel/script scan (Firecrawl) — available at T=0, no Apify wait
  // Apify may later confirm specific ad creative/spend — but pixels are ground truth for "are they running ads"
  if (wh.ads_pixels?.length) {
    intelLines.push(`Ad pixels detected on site: ${wh.ads_pixels.join(", ")}`);
    intelLines.push(`CONFIRMED: They have active ad tracking — almost certainly running paid campaigns on these platforms`);
    intelLines.push(`Bella framing: "I can see you've got ${wh.ads_pixels.slice(0, 2).join(" and ")} pixels firing on your site — are those campaigns still active?" — DO NOT say they are or aren't running ads, CHECK with them`);
    if (wh.is_retargeting) intelLines.push(`Retargeting pixels active (multi-platform) — they are re-engaging a warm audience`);
  } else {
    // No pixels — but be cautious. Could be server-side tracking, GTM, or just no paid ads.
    intelLines.push(`No client-side ad pixels detected — may not be running paid traffic, OR using server-side/GTM tracking`);
    intelLines.push(`Bella: Do NOT claim they're not running ads. Ask: "Are you currently running any paid advertising?"`);
  }

  // Social media presence
  if (wh.social_channels?.length) {
    intelLines.push(`Social presence: ${wh.social_channels.join(", ")}`);
  }

  // Agent priority signals derived from tech stack
  const techFlags: string[] = [];
  if (wh.is_running_ads && !wh.has_crm) techFlags.push("running ads with NO CRM — likely losing leads");
  if (!wh.has_chat && !wh.has_booking) techFlags.push("no chat or booking tool — all enquiries via phone/form");
  if (!wh.has_crm && wh.email_tool) techFlags.push(`has ${wh.email_tool} (email marketing) but no CRM — warm database exists, Sarah reactivation opportunity`);
  if (wh.is_running_ads && !wh.chat_tool) techFlags.push("paid traffic landing on page with no chat — Chris + Alex priority");
  if (wh.social_channels?.length && !wh.is_running_ads) techFlags.push(`active on social (${(wh.social_channels as string[]).join(", ")}) without paid ads — organic traffic to site, same Alex + Chris conversion opportunity`);
  if (wh.email_tool && !wh.is_running_ads) techFlags.push(`running ${wh.email_tool} email campaigns — Alex + Chris apply for speed-to-lead on email click traffic`);
  // Non-AI chatbot = easy Chris win — already believes in chat, just using inferior tech
  if (wh.is_non_ai_chat) techFlags.push(`has ${wh.chat_tool} (non-AI legacy chatbot) — EASY UPGRADE: already values chat, Chris pitch: "you're already using chat which is great — AI chat converts 23% better"`);
  else if (wh.chat_likely_basic) techFlags.push(`has ${wh.chat_tool} — likely basic mode, AI upgrade opportunity`);
  if (techFlags.length) intelLines.push(`Tech gap signals: ${techFlags.join(" | ")}`);

  intelLines.push(`Ads running: ${adsOn ? "YES" : "NO"}`);

  if (sf.hero_header_quote) intelLines.push(`Hero message: "${sf.hero_header_quote}"`);
  if (sf.website_positive_comment) intelLines.push(`Website strength: ${sf.website_positive_comment}`);
  if (sf.icp_guess) intelLines.push(`ICP: ${sf.icp_guess}`);
  if (sf.reference_offer) intelLines.push(`Key offer/CTA: ${sf.reference_offer}`);
  if (sf.campaign_summary && adsOn) intelLines.push(`Ad campaigns: ${sf.campaign_summary}`);
  // Reviews: cap to short fragments only — Bella reads these aloud, long quotes = dead air.
  // Keep to ONE punchy phrase per review, 8 words max each.
  if (sf.recent_review_snippet) {
    const snippet = sf.recent_review_snippet;
    // Trim to first sentence or 25 words — Bella reads this aloud
    const words = snippet.split(/\s+/).slice(0, 25).join(" ");
    const trimmed = (words.split(/[.!?]/)[0] ?? words).trim();
    intelLines.push(`Review highlight (fast-intel): "${trimmed}"`);
  }
  if (sf.rep_quality_assessment) intelLines.push(`Rep quality: ${sf.rep_quality_assessment}`);

  // Apify Google Maps reviews — 2 snippets max, 25 words each
  // These only appear after apify_done, so Bella gets richer data mid-call
  if (intel.recent_reviews?.length) {
    const snippets = (intel.recent_reviews as string[])
      .slice(0, 2)
      .map((r: string) => {
        const words = r.split(/\s+/).slice(0, 25).join(" ");
        return (words.split(/[.!?]/)[0] ?? words).trim();
      })
      .filter((r: string) => r.length > 10);
    if (snippets.length) {
      intelLines.push(`Google review snippets (say ONE max): ${snippets.map(s => `"${s}"`).join(" | ")}`);
    }
  }
  if (sf.top_2_website_ctas) intelLines.push(`Top CTAs: ${sf.top_2_website_ctas}`);

  if (intel.top_fix?.copyHeadline) intelLines.push(`Top opportunity: ${intel.top_fix.copyHeadline}`);
  if (intel.top_fix?.copyBody) intelLines.push(`Opportunity detail: ${intel.top_fix.copyBody}`);
  if (intel.bella_opener) intelLines.push(`Opener hook: ${intel.bella_opener}`);
  if (intel.pitch_hook) intelLines.push(`Pitch hook: ${intel.pitch_hook}`);

  if (cons.landingPageVerdict?.verdictLine) intelLines.push(`Landing page verdict: ${cons.landingPageVerdict.verdictLine}`);
  if (cons.landingPageVerdict?.verdictLine2) intelLines.push(`${cons.landingPageVerdict.verdictLine2}`);
  if (cons.routing?.reasoning) intelLines.push(`Routing rationale: ${cons.routing.reasoning}`);

  // ── NEW: Copy, ICP, Value Props, Conversion Event (for intro WOW moment) ──
  if (cons.copyAnalysis?.strongestLine)
    intelLines.push(`Strongest copy line: "${cons.copyAnalysis.strongestLine}"`);
  if (cons.copyAnalysis?.messagingStrength)
    intelLines.push(`Copy strength: ${cons.copyAnalysis.messagingStrength}`);
  if (cons.copyAnalysis?.bellaLine)
    intelLines.push(`Copy observation for Bella: ${cons.copyAnalysis.bellaLine}`);

  if (cons.icpAnalysis?.whoTheyTarget)
    intelLines.push(`ICP (to CHECK with prospect): ${cons.icpAnalysis.whoTheyTarget}`);
  if (cons.icpAnalysis?.bellaCheckLine)
    intelLines.push(`ICP check question: "${cons.icpAnalysis.bellaCheckLine}"`);

  if (cons.valuePropAnalysis?.statedBenefits?.length)
    intelLines.push(`Stated benefits: ${cons.valuePropAnalysis.statedBenefits.slice(0, 3).join(" | ")}`);
  if (cons.valuePropAnalysis?.strongestBenefit)
    intelLines.push(`Strongest benefit claim: ${cons.valuePropAnalysis.strongestBenefit}`);
  if (cons.valuePropAnalysis?.bellaLine)
    intelLines.push(`Benefit observation for Bella: ${cons.valuePropAnalysis.bellaLine}`);

  if (cons.conversionEventAnalysis?.primaryCTA)
    intelLines.push(`Primary CTA: "${cons.conversionEventAnalysis.primaryCTA}" (type: ${cons.conversionEventAnalysis.ctaType ?? "unknown"})`);
  if (cons.conversionEventAnalysis?.conversionStrength)
    intelLines.push(`Conversion strength: ${cons.conversionEventAnalysis.conversionStrength}`);
  if (cons.conversionEventAnalysis?.bellaLine)
    intelLines.push(`CTA observation for Bella: ${cons.conversionEventAnalysis.bellaLine}`);

  if (cons.conversationHooks?.length) {
    intelLines.push(`Conversation hooks: ${cons.conversationHooks.slice(0, 3).join(" | ")}`);
  }
  if (cons.redFlags?.length) {
    intelLines.push(`Red flags (handle carefully): ${cons.redFlags.slice(0, 2).join(" | ")}`);
  }
  if (intel.close_strategies?.length) {
    intelLines.push(`Close strategies: ${intel.close_strategies.slice(0, 2).join(" | ")}`);
  }

  const intelSection = intelLines.join("\n");

  // ── SECTION 3: WHAT WE KNOW SO FAR ───────────────────────────────────────
  const knownLines: string[] = ["WHAT WE HAVE CONFIRMED THIS CALL"];
  const { inputs: i } = s;
  if (i.acv) knownLines.push(`- ACV: ${i.acv.toLocaleString()} AUD per year`);
  if (i.timeframe) knownLines.push(`- Timeframe preference: ${i.timeframe}`);
  if (i.ads_leads) knownLines.push(`- Ad leads: ${i.ads_leads} ${tf}`);
  if (i.ads_conversions) knownLines.push(`- Ad conversions: ${i.ads_conversions} ${tf}`);
  if (i.ads_followup) knownLines.push(`- Followup speed: ${i.ads_followup}`);
  if (i.ad_spend) knownLines.push(`- Ad spend: ${i.ad_spend} per month`);
  if (i.web_leads) knownLines.push(`- Web leads: ${i.web_leads} ${tf}`);
  if (i.web_conversions) knownLines.push(`- Web conversions: ${i.web_conversions} ${tf}`);
  if (i.phone_volume) knownLines.push(`- Phone volume: ${i.phone_volume} ${tf}`);
  if (i.after_hours) knownLines.push(`- After hours: ${i.after_hours}`);
  if (i.missed_calls) knownLines.push(`- Missed calls: ${i.missed_calls} ${tf}`);
  if (i.old_leads) knownLines.push(`- Old leads: ${i.old_leads}`);
  if (i.star_rating) knownLines.push(`- Star rating: ${i.star_rating}`);
  if (i.has_review_system != null) knownLines.push(`- Review system: ${i.has_review_system}`);
  if (s.done.length) knownLines.push(`- Stages completed: ${s.done.join(", ")}`);
  if (knownLines.length === 1) knownLines.push("(Nothing confirmed yet — this is early in the call)");
  const knownSection = knownLines.join("\n");

  // ── SECTION 4: LIVE ROI (if we have calc data) ────────────────────────────
  let roiSection = "";
  if (top3.length) {
    const lines = top3.map(c =>
      `  - ${c.agent}: approx ${c.weekly.toLocaleString()} dollars per week ${c.precise ? "(precise)" : "(directional)"} — ${c.why}`
    );
    roiSection = `\nLIVE ROI CALCULATIONS (use EXACTLY these numbers — say them as words, never symbols)\n${lines.join("\n")}\nTotal upside: approx ${total.toLocaleString()} dollars per week conservatively`;
  }

  // ── SECTION 5: CONVERSATION MEMORY (distilled qualitative signals) ────────
  const memSection = convMemory
    ? `\nCONVERSATION MEMORY (what we know beyond the numbers)\n${convMemory}`
    : "";

  // ── SECTION 5b: LIVE INTEL STATUS — PRUNED FOR LATENCY ──
  // Only show the specific layer relevant to the current conversation state
  let liveIntelData = "";

  const sc = (intel.consultant?.scriptFills ?? {});
  const flg = (intel.flags ?? {});
  const pg = (intel.fast_intel?.page_content ?? {});

  if (s.stage === "wow" || s.stage === "deep_dive") {
    liveIntelData = `
  Business:    "${ci.business_name ?? ""}"
  Industry:    "${ci.industry ?? ""}"
  Services:    ${JSON.stringify(pg.services ?? [])}
  Tagline:     "${ci.tagline ?? ""}"
  ICP:         "${sc.icp_guess ?? ""}"
  Hook:        "${intel.bella_opener ?? ""}"`;
  } else if (s.stage.startsWith("ch_") || s.stage === "anchor_acv") {
    liveIntelData = `
  Tech Stack:  Ads: ${ts.is_running_ads ?? false} | CRM: ${ts.crm_name ?? "none"}
  Google:      ${wh.google_rating ?? "?"} stars (${wh.review_count ?? "?"} reviews)
  Rep Snip:    "${sc.recent_review_snippet ?? ""}"`;
  } else if (s.stage === "roi_delivery" || s.stage === "close") {
    liveIntelData = `
  ROI Ready:   ${s.calc_ready ? "YES" : "NO"}
  Calcs:       ${JSON.stringify(top3.map(c => ({ agent: c.agent, weekly: c.weekly })))}`;
  }

  const liveIntelStatus = `
══════════════════════════════════════════════════════
LIVE KV INTEL (STAGE: ${s.stage.toUpperCase()})
══════════════════════════════════════════════════════
${liveIntelData}
══════════════════════════════════════════════════════
`;

  // ── SECTION 6: FULL SCRIPT ────────────────────────────────────────────────
  const script = buildScript(s, intel, ct, tf, fn, biz, adsOn);

  // ── SECTION 7: OUTPUT CONTRACT ────────────────────────────────────────────
  const outputContract = `
══════════════════════════════════════════════════════
YOUR OUTPUT RULES
══════════════════════════════════════════════════════
Bella must be natural, fast, and human.
1. ONLY SPOKEN WORDS. No labels, no headers.
2. Max 2 sentences. 
3. No symbols, no markdown. 
4. Say numbers as words.
5. Max one question at the end.
══════════════════════════════════════════════════════`;

  return `${persona}\n\nBUSINESS: ${biz}\n\n${knownSection}${roiSection}${memSection}\n\n${liveIntelStatus}\n\n${script}\n\n${outputContract}`;
}

// ─── FULL SCRIPT BUILDER — all stages, canonical phrasing ────────────────────
// State machine is the safety net. Gemini has the full script.
// "YOU ARE HERE" marks the current stage — Gemini flows naturally from there.

function buildScript(
  s: State,
  intel: Record<string, any>,
  ct: string,
  tf: string,
  fn: string,
  biz: string,
  adsOn: boolean,
): string {
  const sf = intel.consultant?.scriptFills ?? {};
  const cons = intel.consultant ?? {};
  const wh = intel.website_health ?? {};
  const calcs = runCalcs(s.inputs);
  const top3 = calcs.slice(0, 3);
  const total = top3.reduce((sum, c) => sum + c.weekly, 0);

  const lines: string[] = [
    "THE CONVERSATION FLOW",
    "",
    "To ensure low latency, you are only shown the strict rules for the CURRENT stage and immediate next stage.",
    "Completed stages are captured in the 'CONFIRMED' section — do not revisit them.",
    "",
    "---",
    "",
  ];

  if (s.stage === "wow" || s.stage === "deep_dive" || s.queue[0] === "wow") {
    lines.push(
      `STAGE 1: THE WOW MOMENT << YOU ARE HERE`,
      ``,
      `This isn't a pitch — it's a demonstration. Bella has done real homework on this business before the call.`,
      `The goal is a genuine "how do they know all this?" reaction, built from 3-4 stacked, natural observations.`,
      `Each one is 1-2 sentences. They flow into each other like a real conversation, not a fact-dump.`,
      ``,
      `Open warmly — one sentence, by name, referencing ${biz} specifically:`,
      `e.g. "Hey ${fn ? fn : "there"} — I've had a proper look through ${biz} ahead of this, so I'm already across quite a bit."`,
      ``,
      `Then make a specific observation about WHO they serve and WHAT they do:`,
      `Anchor it to something real from their site. ICP or market position. Then CHECK it — one question, stop.`,
      `Source: ${cons.icpAnalysis?.whoTheyTarget ?? sf.icp_guess ?? "their apparent target customer"}`,
      sf.hero_header_quote ? `Their hero headline: "${sf.hero_header_quote}"` : `(No headline captured — use their business model or positioning)`,
      ``,
      `Then notice something they're doing well — specific, genuine, not flattery:`,
      `A strong copy line, a clear offer, a smart differentiator. Something that earns trust by being real.`,
      `Source: ${cons.copyAnalysis?.bellaLine ?? cons.valuePropAnalysis?.bellaLine ?? sf.website_positive_comment ?? "something specific from their site"}`,
      cons.copyAnalysis?.strongestLine ? `Strongest line: "${cons.copyAnalysis.strongestLine}"` : "",
      ``,
      `Then name the opportunity — what you can see that they might not realise:`,
      adsOn
        ? `Ads confirmed via pixels. Natural line: "I can see you've got ${(wh.ads_pixels as string[] ?? []).slice(0, 2).join(" and ")} pixels running — so you're clearly sending traffic somewhere. The thing I always wonder with that is what's happening to it once it lands."`
        : wh.social_channels?.length
          ? `Active social presence. Natural line: "You've got a decent social footprint — so people are finding you. The question is usually what happens when they hit the site."`
          : `Source: ${cons.conversionEventAnalysis?.bellaLine ?? `Main CTA: ${sf.top_2_website_ctas ?? "unclear"}`}`,
      wh.is_non_ai_chat
        ? `Chat widget detected (${wh.chat_tool} — non-AI). Easy, natural mention: "I also noticed you've already got a chat widget on there — which I find interesting, because it tells me you already know chat matters."` : "",
      ``,
      `Bridge naturally into the numbers — keep it light, no pressure:`,
      `"Look, I've already loaded up what I know about ${biz} into the team here. They're across your business, your offers, your customers."`,
      `"I've got a rough sense of where the biggest opportunities might be — if you want, I can walk you through the actual numbers. Takes about ten minutes."`,
      `"To make it specific to you though — what's the annual value of a typical new ${ct} when they come on board?"`,
      `ONE question. Full stop. Wait.`,
      ``,
      `THE FLOW MATTERS: Don't recite observations — connect them. "You're going after [ICP], right? ... What stood out to me was [specific thing]. And then when I looked at [traffic/tech], I could see [opportunity]."`,
      ``,
      `---`,
    );
  }

  if (s.stage === "anchor_acv" || s.queue[0] === "anchor_acv") {
    lines.push(
      ``,
      `STAGE 2: ACV ANCHOR << YOU ARE HERE`,
      `Collect the annual ${ct} value. Keep it breezy.`,
      `"What's the annual value of a typical new ${ct}? Rough ballpark is totally fine."`,
      `ONE question. Stop. Don't ask timeframe yet.`,
      ``,
      `---`,
    );
  }

  if (s.stage === "anchor_timeframe" || s.queue[0] === "anchor_timeframe") {
    lines.push(
      ``,
      `STAGE 3: TIMEFRAME ANCHOR << YOU ARE HERE`,
      `ACV confirmed: ${s.inputs.acv ? `${s.inputs.acv.toLocaleString()} dollars` : "(pending)"}.`,
      `"Do you tend to think about lead flow weekly or monthly? Ballpark is fine."`,
      `ONE question. Stop.`,
      ``,
      `---`,
    );
  }

  if (s.stage === "ch_ads" || s.queue[0] === "ch_ads") {
    lines.push(
      ``,
      `STAGE 4: ADS CHANNEL — Alex << YOU ARE HERE`,
      `Collect: ads_leads → ads_conversions → ads_followup speed.`,
      `"How many leads are your ads bringing in ${tf}?"`,
      `Then: "Out of those, roughly how many become ${ct}s?"`,
      `Then: "How quickly does someone usually follow up with those ad leads?"`,
      `ONE question at a time. Acknowledge each answer before asking the next.`,
      ``,
      `---`,
    );
  }

  if (s.stage === "ch_website" || s.queue[0] === "ch_website") {
    lines.push(
      ``,
      `STAGE 5: WEBSITE CHANNEL — Chris << YOU ARE HERE`,
      `Collect: web_leads → web_conversions.`,
      `"How many website enquiries or leads do you get ${tf}?"`,
      `Then: "Out of those, roughly how many become ${ct}s?"`,
      `ONE question at a time.`,
      ``,
      `---`,
    );
  }

  if (s.stage === "ch_phone" || s.queue[0] === "ch_phone") {
    lines.push(
      ``,
      `STAGE 6: PHONE CHANNEL — Maddie << YOU ARE HERE`,
      `Collect: phone_volume → after_hours → missed_calls.`,
      `"Roughly how many inbound calls do you get ${tf}?"`,
      `Then: "What happens to calls after hours or when the team is busy?"`,
      `If they confirm 24/7 or a call centre — acknowledge it and move on (skip Maddie calc).`,
      `Otherwise: "Roughly how many calls go unanswered ${tf}?"`,
      `ONE question at a time.`,
      ``,
      `---`,
    );
  }

  if (s.stage === "ch_old_leads" || s.queue[0] === "ch_old_leads") {
    lines.push(
      ``,
      `STAGE 7: OLD LEADS — Sarah << YOU ARE HERE`,
      `"Roughly how many older leads do you have from the last 12 months?"`,
      `ONE question. Stop.`,
      ``,
      `---`,
    );
  }

  if (s.stage === "ch_reviews" || s.queue[0] === "ch_reviews") {
    lines.push(
      ``,
      `STAGE 8: REVIEWS — James << YOU ARE HERE`,
      `Collect: star_rating → review_count → has_review_system.`,
      `"What's your current average rating?"`,
      `Then: "Roughly how many reviews do you have?"`,
      `Then: "Do you have any system for consistently asking happy ${ct}s for reviews?"`,
      `ONE question at a time.`,
      ``,
      `---`,
    );
  }

  if (s.stage === "roi_delivery" || s.queue[0] === "roi_delivery" || s.stage === "close") {
    lines.push(
      ``,
      `STAGE 9: ROI DELIVERY << YOU ARE HERE`,
    );
    if (top3.length) {
      lines.push(
        `DELIVER THESE EXACT FIGURES — say all numbers as words, no symbols:`,
        `"Thanks ${fn ? fn : "for that"}, that gives me a pretty clear picture."`,
      );
      top3.forEach((c, i) => {
        const label = i === 0 ? "The strongest opportunity" : i === 1 ? "After that" : "And the third lever";
        const caveat = c.precise ? "" : " — treat that as directional until we confirm more data";
        lines.push(`"${label} is ${c.agent}: ${c.why}. Conservatively about ${c.weekly.toLocaleString()} dollars a week in additional revenue${caveat}."`);
      });
      lines.push(
        `"So across those, you're looking at roughly ${total.toLocaleString()} dollars a week in upside, conservatively."`,
        `Then: "To see that in action, you can go straight into demoing the highest-ROI agent yourself."`,
        `STOP. Wait for their response.`,
      );
    } else {
      lines.push(
        `Not enough confirmed inputs yet for precise ROI.`,
        `Say: "I can see the opportunity clearly, but I'd keep those estimates directional until we confirm one or two more numbers."`,
        `Then ask the single most important missing input.`,
      );
    }
    lines.push(
      ``,
      `---`,
    );
  }

  if (s.stage === "close") {
    lines.push(
      ``,
      `STAGE 10: CLOSE << YOU ARE HERE`,
      `"To see that in action, you can go straight into demoing the highest-ROI agent yourself."`,
      `"Or, if you'd prefer — now that you know the likely value — we can jump straight into your 7-day free trial. No card required. Set and forget, do nothing differently, watch the results grow."`,
      `"What would you prefer?"`,
      `If they ask about trial length: "We start at 7 days — usually that's plenty to see huge value. If you haven't seen strong additional revenue, we can extend to 14 days."`,
    );
  }

  return lines.filter(l => l !== undefined).join("\n");
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getLid(messages: Msg[]): string {
  const sys = messages.find(m => m.role === "system")?.content ?? "";
  const m = typeof sys === "string" ? sys.match(/lead[\s_]id\b[\s\w]*?[:=]\s*([a-z][a-z0-9_-]{3,})/i) : null;
  return m?.[1] ?? "";
}

function lastUser(messages: Msg[]): string {
  const u = messages.filter(m => m.role === "user");
  const l = u[u.length - 1];
  return typeof l?.content === "string" ? l.content : "";
}

// ─── GEMINI STREAMING → DEEPGRAM ─────────────────────────────────────────────

async function streamToDeepgram(messages: Msg[], env: Env): Promise<Response> {
  const gemRes = await fetch(GEMINI_URL, {
    method: "POST",
    signal: AbortSignal.timeout(5000),
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${env.GEMINI_API_KEY}`,
      "x-goog-api-key": env.GEMINI_API_KEY
    },
    body: JSON.stringify({ model: MODEL, messages, stream: true, temperature: 0.95 }),
  });

  if (!gemRes.ok || !gemRes.body) {
    const errBody = await gemRes.text().catch(() => "no-body");
    console.log(`[bridge ${VERSION}] [GEMINI_ERR] status=${gemRes.status} body=${errBody}`);
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
  (async () => {
    const reader = gemRes.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.write(enc.encode("data: [DONE]\n\n"));
    } catch { }
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
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, {
      status: 204, headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
      }
    });


    if (url.pathname.startsWith("/v1/debug/")) {
      const dbgLid = url.pathname.split("/").pop();
      try {
        const raw = await env.LEADS_KV.get(`lead:${dbgLid}:intel`);
        return new Response(raw || '{"error":"not found"}', { headers: { "content-type": "application/json" } });
      } catch (e) {
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

    if (url.pathname !== "/v1/chat/completions" || req.method !== "POST")
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

    // ── Load intel + normalise KV shape ────────────────────────────────────
    // The KV envelope written by fast-intel has a specific shape. Several fields
    // the bridge expects at intel.X are stored differently. Normalise here so
    // every downstream function can read intel.X without worrying about the envelope.
    let intel: Record<string, any> = {};
    if (lid) {
      try {
        const raw = await env.LEADS_KV.get(`lead:${lid}:intel`);
        if (raw) intel = JSON.parse(raw);
      } catch { }
    }

    // FIX 1: intel.deep — apify-intel writes to envelope.intel.deep but bridge reads intel.deep
    // Hoist it up to the root so intel.deep works correctly.
    if (!intel.deep && intel.intel?.deep) {
      intel.deep = intel.intel.deep;
    }
    // FIX 1b: Hoist Phase A / Consultant Data for Script Fills
    if (!intel.consultant && intel.intel?.phaseA?.marketing_intelligence) {
      intel.consultant = intel.intel.phaseA.marketing_intelligence;
    }

    // FIX 2: intel.website_health — synthesise from tech_stack + googlePresence + fast_context + Phase A root fields
    if (!intel.website_health) {
      const ts = intel.tech_stack ?? {};
      const biz = intel.fast_context?.business ?? {};
      const deep = intel.deep ?? {};
      // Phase A root fields — big scraper writes star_rating, review_count, location, logo_url at envelope root
      const rootRating = typeof intel.star_rating === 'number' && intel.star_rating > 0 ? intel.star_rating : null;
      const rootReviews = typeof intel.review_count === 'number' && intel.review_count > 0 ? intel.review_count : null;
      const bizRating = typeof biz.rating === 'number' && biz.rating > 0 ? biz.rating : null;
      const bizReviews = typeof biz.review_count === 'number' && biz.review_count > 0 ? biz.review_count : null;
      intel.website_health = {
        // Reviews — check root (Phase A) → fast_context → deep (Apify)
        google_rating: rootRating ?? bizRating ?? deep.googleMaps?.rating ?? null,
        review_count: rootReviews ?? bizReviews ?? deep.googleMaps?.review_count ?? null,
        // Location — root (Phase A) → core_identity (Layer 1)
        location: intel.location ?? intel.core_identity?.location ?? null,
        // Logo — root (Phase A) → fast_context.business
        logo_url: intel.logo_url ?? biz.logo_url ?? null,
        // Normalised business name from big scraper
        business_name_normalised: intel.business_name ?? intel.core_identity?.business_name ?? null,
        // Ads — root (Phase A) provides per-platform breakdown
        facebook_ads_running: intel.facebook_ads_running ?? false,
        google_ads_running: intel.google_ads_running ?? false,
        // Existing fields
        landing_page_score: null,
        tech_grade: null,
        overall_grade: null,
        has_chat: ts.has_chat ?? intel.fast_intel?.page_content?.has_chat ?? null,
        has_booking: ts.has_booking ?? intel.fast_intel?.page_content?.has_booking ?? null,
        has_crm: ts.has_crm ?? null,
        crm_name: ts.crm_name ?? null,
        booking_tool: ts.booking_tool ?? null,
        chat_tool: ts.chat_tool ?? null,
        is_non_ai_chat: ts.is_non_ai_chat ?? false,
        chat_likely_basic: ts.chat_likely_basic ?? false,
        email_tool: ts.email_tool ?? null,
        payment_tool: ts.payment_tool ?? null,
        ecommerce_platform: ts.ecommerce_platform ?? null,
        site_platform: ts.site_platform ?? null,
        ads_pixels: ts.ads_pixels ?? [],
        social_channels: ts.social_channels ?? [],
        is_running_ads: intel.is_running_ads ?? ts.is_running_ads ?? false,
        is_retargeting: ts.is_retargeting ?? false,
      };
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

    // ── Load or init state ──────────────────────────────────────────────────
    let s: State = lid
      ? (await loadState(lid, env)) ?? (await initState(lid, env))
      : {
        stage: "wow", queue: ["ch_website"], done: [], inputs: { ...BLANK },
        maddie_skip: false, wants_numbers: false, apify_done: false, calc_ready: false,
        stall: 0, init: new Date().toISOString()
      };

    // ── Check if Apify data has landed this turn ────────────────────────────
    // intel.deep is written by deep-scrape-workflow once all 5 actors complete (~30-45s).
    // We set apify_done=true on state so the deep_dive gate can open.
    if (!s.apify_done && intel.deep?.status === "done") {
      s.apify_done = true;
      log("APIFY", `deep intel landed for lid=${lid} — gate will open next advance`);
    }

    // ── DATA LAYER STATUS LOG — visible every turn so we can see what Gemini has ──
    const fastLoaded = !!(intel.fast_intel || intel.core_identity?.business_name);
    const apifyLoaded = intel.deep?.status === "done";
    const fullLoaded = intel.full_scrape?.status === "done";
    log("KV_STATUS", `lid=${lid} turn=${messages.length} fast=${fastLoaded} apify=${apifyLoaded} full=${fullLoaded} kv_bytes=${JSON.stringify(intel).length}`);

    // ── LATENCY FIX: Run extraction FIRE-AND-FORGET ──────────────────────────
    // extractAndApply makes a full Gemini call to pull numbers from the utterance.
    // Awaiting it before streaming adds 3-5s of dead air on every turn.
    // Fix: detach it. The extracted state writes to KV and is picked up NEXT turn.
    // Gemini already has full conversation history so it never loses context.
    // IMPORTANT: capture stageAtUtterance BEFORE advancing.
    const utt = lastUser(messages);
    const stageAtUtterance = s.stage;
    if (utt && lid) {
      // Detached — do NOT await. Saves 3-5s per turn.
      extractAndApply(utt, s, lid, env, stageAtUtterance).catch(() => { });
    }

    // ── Advance stage if gate opens ─────────────────────────────────────────
    s.stall++;
    if (gateOpen(s)) {
      s.calc_ready = isCalcReady(s.inputs);
      s = advance(s);
    }
    // Safety: removed stall force-advance to ensure Bella waits for scraper data
    if (s.stall > 5 && s.stage !== "roi_delivery" && s.stage !== "close") {
      log("STALL", `waiting for data at ${s.stage} (${s.stall} turns)`);
    }

    if (lid) await saveState(lid, s, env);

    // ── FIX 3: Distil history ────────────────────────────────────────────────
    const { trimmed, memoryInjection } = lid
      ? await distilHistory(messages, lid, env)
      : { trimmed: messages.filter(m => m.role !== "system"), memoryInjection: [] };

    // ── Load conversation memory (may have been written by distilHistory) ────
    let convMemory = "";
    if (lid) {
      try { convMemory = (await env.LEADS_KV.get(`lead:${lid}:conv_memory`)) ?? ""; } catch { }
    }

    // ── FIX 2: Build RICH full prompt ────────────────────────────────────────
    const richPrompt = buildRichPrompt(s, intel, convMemory);
    log("PROMPT", `stage=${s.stage} chars=${richPrompt.length}`);

    // ── Assemble final messages: system + recent turns ──────────────────────
    // Ensure history starts with 'user' role to maintain U-A-U-A sequence after system prompt
    let conversation = trimmed;
    if (conversation.length > 0 && conversation[0].role === "assistant") {
      conversation = conversation.slice(1);
    }

    const finalMessages: Msg[] = [
      { role: "system", content: richPrompt },
      ...conversation,
    ];

    log("STREAM", `stage=${s.stage} history=${conversation.length} turns → streaming`);
    return streamToDeepgram(finalMessages, env);
  },
};
