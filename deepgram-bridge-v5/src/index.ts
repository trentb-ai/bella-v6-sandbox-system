/**
 * deepgram-bridge-v5 — LEAN ORCHESTRATOR v5.3.0
 *
 * ARCHITECTURE PRINCIPLE:
 *   The bridge IS the brain. Gemini IS the voice.
 *   Gemini receives ~150 tokens max per turn.
 *   Zero script. Zero calc rules. Zero full prompt.
 *   Just: persona (5 lines) + 3 lines of intel + ONE job directive.
 *
 *   State machine, trigger matrix, calc engine = pure TypeScript in bridge.
 *   Gemini never sees them. Gemini can't break them.
 */

export interface Env {
  LEADS_KV:       KVNamespace;
  TOOLS:          Fetcher;
  GEMINI_API_KEY: string;
  TOOLS_BEARER:   string;
}

const VERSION    = "5.3.0";
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODEL      = "gemini-2.5-flash";

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
  | "wow" | "anchor_acv" | "anchor_timeframe"
  | "ch_ads" | "ch_website" | "ch_phone" | "ch_old_leads" | "ch_reviews"
  | "roi_delivery" | "close";

interface Inputs {
  acv: number | null;
  timeframe: "weekly" | "monthly" | null;
  ads_leads: number | null;
  ads_conversions: number | null;
  ads_followup: string | null;   // ">24h" | "3h_to_24h" | "30m_to_3h" | "<30m"
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
  calc_ready: boolean;
  stall: number;   // turns without advancing
  init: string;    // ISO timestamp
}

// ─── EMPTY INPUTS ─────────────────────────────────────────────────────────────

const BLANK: Inputs = {
  acv: null, timeframe: null,
  ads_leads: null, ads_conversions: null, ads_followup: null, ad_spend: null,
  web_leads: null, web_conversions: null,
  phone_volume: null, phone_conversion: null, after_hours: null, missed_calls: null,
  old_leads: null,
  star_rating: null, review_count: null, has_review_system: null, new_cust_per_period: null,
};

// ─── CHANNEL QUEUE BUILDER (from intel flags) ─────────────────────────────────

function buildQueue(flags: Record<string, any>, intel: Record<string, any>): Stage[] {
  const q: Stage[] = [];
  const ci = intel.core_identity ?? {};

  if (flags.is_running_ads ?? intel.fast_context?.ads?.is_running_ads)
    q.push("ch_ads");

  q.push("ch_website"); // always

  if (flags.speed_to_lead_needed || flags.call_handling_needed || ci.phone)
    q.push("ch_phone");

  if (flags.database_reactivation || flags.business_age_established)
    q.push("ch_old_leads");

  if ((intel.website_health?.review_count ?? 0) > 0 || flags.review_signals)
    q.push("ch_reviews");

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
  } catch {}

  const flags = intel.flags ?? intel.fast_context?.flags ?? {};
  const queue = buildQueue(flags, intel);

  const s: State = {
    stage: "wow", queue, done: [], inputs: { ...BLANK },
    maddie_skip: false, wants_numbers: false, calc_ready: false,
    stall: 0, init: new Date().toISOString(),
  };
  await saveState(lid, s, env);
  log("INIT", `lid=${lid} queue=[${queue.join(",")}]`);
  return s;
}

// ─── STAGE GATE: is current stage complete? ───────────────────────────────────

function gateOpen(s: State): boolean {
  const { stage: st, inputs: i } = s;
  switch (st) {
    case "wow":             return s.wants_numbers;
    case "anchor_acv":      return i.acv !== null;
    case "anchor_timeframe":return i.timeframe !== null;
    case "ch_ads":          return i.ads_leads !== null && i.ads_conversions !== null;
    case "ch_website":      return i.web_leads !== null && i.web_conversions !== null;
    case "ch_phone":        return i.after_hours !== null && i.phone_volume !== null;
    case "ch_old_leads":    return i.old_leads !== null;
    case "ch_reviews":      return i.star_rating !== null && i.has_review_system !== null;
    case "roi_delivery":    return true;
    case "close":           return true;
  }
}

// ─── ADVANCE STAGE ────────────────────────────────────────────────────────────

function advance(s: State): State {
  s.done.push(s.stage);
  s.stall = 0;
  if (s.stage === "wow")                         s.stage = "anchor_acv";
  else if (s.stage === "anchor_acv")             s.stage = "anchor_timeframe";
  else if (s.stage === "anchor_timeframe" || s.stage.startsWith("ch_")) {
    s.stage = s.queue.shift() ?? "roi_delivery";
  } else if (s.stage === "roi_delivery")         s.stage = "close";
  log("ADVANCE", `→ ${s.stage}`);
  return s;
}

// ─── CALC ENGINE ─────────────────────────────────────────────────────────────

interface Calc { agent: string; weekly: number; precise: boolean; why: string; }

function runCalcs(i: Inputs): Calc[] {
  if (!i.acv) return [];
  const wf = i.timeframe === "monthly" ? 1 / 4.3 : 1;
  const out: Calc[] = [];

  // Alex — speed to lead
  if (i.ads_leads !== null && i.ads_conversions !== null) {
    const tiers: Record<string, number> = { ">24h": 3.91, "3h_to_24h": 2.0, "30m_to_3h": 1.0, "<30m": 0.5 };
    const rate   = tiers[i.ads_followup ?? ">24h"] ?? 3.91;
    const weekly = Math.round(i.ads_conversions * wf * rate * i.acv / 52);
    out.push({ agent: "Alex", weekly, precise: true,
      why: `${i.ads_leads} ad leads, ${i.ads_conversions} conversions, ${(rate*100).toFixed(0)}% uplift from speed-to-lead` });
  }

  // Chris — website conversion
  if (i.web_leads !== null && i.web_conversions !== null) {
    const extra  = i.web_conversions * wf * 0.23;
    const weekly = Math.round(extra * i.acv / 52);
    out.push({ agent: "Chris", weekly, precise: true,
      why: `${i.web_leads} web enquiries, 23% conversion uplift` });
  }

  // Maddie — missed calls
  if (i.phone_volume !== null && i.after_hours && !i.maddie_skip) {
    const has247 = ["24/7","24-7","always","call centre","call center"]
      .some(s => i.after_hours!.toLowerCase().includes(s));
    if (!has247) {
      const missed = i.missed_calls ?? Math.round(i.phone_volume * 0.3);
      const rate   = i.phone_conversion ?? 0.3;
      const weekly = Math.round(missed * wf * rate * i.acv / 52);
      out.push({ agent: "Maddie", weekly, precise: !!i.missed_calls,
        why: `~${missed} missed calls, ${(rate*100).toFixed(0)}% conversion, 78% buy from first responder` });
    }
  }

  // Sarah — dormant leads
  if (i.old_leads !== null) {
    const weekly = Math.round(i.old_leads * 0.05 * i.acv / 52);
    out.push({ agent: "Sarah", weekly, precise: true,
      why: `${i.old_leads} dormant leads × 5% reactivation` });
  }

  // James — reviews
  if (i.star_rating !== null && i.has_review_system === false) {
    const base   = i.new_cust_per_period ?? 10;
    const weekly = Math.round(base * (i.timeframe === "monthly" ? wf : 1) * i.acv * 0.09 / 52);
    out.push({ agent: "James", weekly, precise: false,
      why: `1-star improvement → 9% revenue uplift (directional)` });
  }

  return out.sort((a, b) => b.weekly - a.weekly);
}

function isCalcReady(i: Inputs): boolean {
  const results = runCalcs(i);
  return results.length >= 2 && results.some(r => r.precise);
}

// ─── EXTRACTION — pull structured data from prospect utterance ────────────────

interface Extracted { field: string; value: any; }

async function extract(utterance: string, stage: Stage, env: Env): Promise<Extracted[]> {
  const tasks: Record<Stage, string> = {
    wow:             `Return [{field:"wants_numbers",value:true}] if person agrees to run numbers/ROI, else []`,
    anchor_acv:      `Extract annual customer value in AUD dollars. Return [{field:"acv",value:NUMBER}] or []`,
    anchor_timeframe:`Return [{field:"timeframe",value:"weekly"}] or [{field:"timeframe",value:"monthly"}] based on preference, else []`,
    ch_ads:          `Extract any present: ads_leads(number), ads_conversions(number), ads_followup(one of:">24h","3h_to_24h","30m_to_3h","<30m"), ad_spend(number). Return array.`,
    ch_website:      `Extract any present: web_leads(number), web_conversions(number). Return array.`,
    ch_phone:        `Extract any present: phone_volume(number of calls/bookings), missed_calls(number), phone_conversion(decimal 0-1), after_hours(string describing after-hours handling). Return array.`,
    ch_old_leads:    `Extract: old_leads(number). Return [{field:"old_leads",value:NUMBER}] or []`,
    ch_reviews:      `Extract any present: star_rating(number), review_count(number), has_review_system(boolean). Return array.`,
    roi_delivery:    `null`,
    close:           `null`,
  };

  const task = tasks[stage];
  if (!task || task === "null") return [];

  try {
    const res = await fetch(GEMINI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.GEMINI_API_KEY}` },
      body: JSON.stringify({
        model: MODEL, stream: false, temperature: 0,
        messages: [{
          role: "user",
          content: `Prospect said: "${utterance}"\nTask: ${task}\nReturn ONLY valid JSON array. No markdown.`,
        }],
      }),
    });
    if (!res.ok) return [];
    const data: any = await res.json();
    const txt = data.choices?.[0]?.message?.content ?? "[]";
    return JSON.parse(txt.replace(/```json|```/g, "").trim());
  } catch { return []; }
}

// ─── APPLY EXTRACTED INPUTS → STATE + KV ─────────────────────────────────────

async function applyExtracted(items: Extracted[], s: State, lid: string, env: Env): Promise<State> {
  if (!items.length) return s;

  for (const { field, value } of items) {
    if (value == null) continue;

    // Map to state inputs
    if (field in BLANK) (s.inputs as any)[field] = value;

    // Special flags
    if (field === "wants_numbers" && value === true) s.wants_numbers = true;
    if (field === "after_hours" && typeof value === "string") {
      if (["24/7","24-7","always","call centre","call center"].some(x => value.toLowerCase().includes(x))) {
        s.maddie_skip = true;
        log("FLAG", "maddie_skip=true");
      }
    }

    log("CAPTURED", `${field}=${JSON.stringify(value)}`);
  }

  // Persist to tools worker KV schema (fire-and-forget)
  const { inputs: i } = s;
  if (i.acv) {
    env.TOOLS.fetch(new Request("https://tools-internal/capture_acv", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.TOOLS_BEARER}` },
      body: JSON.stringify({ lid, acv: i.acv }),
    })).catch(() => {});
  }

  const convData: Record<string, any> = {};
  if (i.web_leads)        convData.website_leads = i.web_leads;
  if (i.ads_leads)        convData.ad_leads      = i.ads_leads;
  if (i.phone_volume)     convData.phone_leads   = i.phone_volume;
  if (i.old_leads)        convData.old_crm       = i.old_leads;
  if (i.phone_conversion) convData.followup_rate = i.phone_conversion;

  if (Object.keys(convData).length) {
    env.TOOLS.fetch(new Request("https://tools-internal/save_conversation_data", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.TOOLS_BEARER}` },
      body: JSON.stringify({ lid, data: convData }),
    })).catch(() => {});
  }

  return s;
}

// ─── CUSTOMER TERM (industry-aware) ──────────────────────────────────────────

function custTerm(industry: string): string {
  const map: Record<string, string> = {
    dental:"patient", medical:"patient", health:"patient", physio:"patient",
    legal:"client", law:"client", solicitor:"client",
    real_estate:"listing", property:"listing",
    trade:"job", plumb:"job", electric:"job", build:"job", construct:"job",
    agency:"client", marketing:"client", consult:"client",
    gym:"member", fitness:"member",
    education:"student", coach:"client",
    insurance:"policy", finance:"client",
    hospitality:"booking", restaurant:"reservation", cafe:"booking",
  };
  const key = industry.toLowerCase();
  return Object.entries(map).find(([k]) => key.includes(k))?.[1] ?? "customer";
}

// ─── LEAN PROMPT BUILDER — CANONICALLY ALIGNED ───────────────────────────────
//
// SOURCE OF TRUTH: FINAL BELLA PROMPT + CANONICAL BELLA PROMPT PACK
//
// Gemini receives ONLY:
//   - 5-line persona (fixed)
//   - 3-5 lines of stage-relevant intel (from scraped data)
//   - ONE directive using EXACT canonical approved phrasing
//
// State machine | calc engine | trigger matrix | KV writes = TypeScript only.
// Gemini NEVER sees them. Gemini CANNOT break them.

function buildLeanPrompt(s: State, intel: Record<string, any>): string {
  const ci   = intel.core_identity ?? {};
  const sf   = intel.consultant?.scriptFills ?? {};
  const fn   = intel.first_name ?? ci.first_name ?? "";
  const biz  = ci.business_name ?? intel.fast_context?.business?.name ?? "your business";
  const ind  = ci.industry ?? ci.industry_key ?? "";
  const loc  = ci.location ?? "";
  const ct   = custTerm(ind);
  const tf   = s.inputs.timeframe ?? "weekly";
  const adsOn = !!(intel.flags?.is_running_ads ?? intel.fast_context?.ads?.is_running_ads);
  const rating  = intel.website_health?.google_rating ?? "";
  const reviews = intel.website_health?.review_count ?? "";

  // ── CANONICAL PERSONA (5 lines, fixed) ─────────────────────────────────────
  const persona =
`You are Bella, Strategic Intel Director at Pillar and Post.
You are warm, professional, consultative, insightful, and helpful. Not aggressive, pushy, or robotic.
You sound like a trusted strategic advisor who has done deep homework on this business.
Short sentences. Commercial clarity. No waffle. No "As an AI". No benchmark dumping.
Mirror the prospect's industry language, conversion terminology, and tone naturally.`;

  // ── INTEL CONTEXT (stage-relevant, minimal) ─────────────────────────────────
  const ctx: string[] = [
    `Business: ${biz}${loc ? ` (${loc})` : ""} | Industry: ${ind} | Ads running: ${adsOn ? "YES" : "NO"}`,
  ];
  if (rating) ctx.push(`Google: ${rating}/5 (${reviews} reviews)`);

  if (s.stage === "wow") {
    if (sf.hero_header_quote)        ctx.push(`Hero: "${sf.hero_header_quote}"`);
    if (sf.website_positive_comment) ctx.push(`Website strength: ${sf.website_positive_comment}`);
    if (sf.icp_guess)                ctx.push(`ICP: ${sf.icp_guess}`);
    if (sf.reference_offer)          ctx.push(`Offer/CTA: ${sf.reference_offer}`);
    if (sf.campaign_summary && adsOn) ctx.push(`Ad campaigns: ${sf.campaign_summary}`);
    if (sf.recent_review_snippet)    ctx.push(`Review signal: ${sf.recent_review_snippet}`);
  } else {
    if (s.inputs.acv)   ctx.push(`ACV: $${s.inputs.acv.toLocaleString()}/year | Timeframe: ${tf}`);
    const already = Object.entries(s.inputs)
      .filter(([k, v]) => v !== null && k !== "acv" && k !== "timeframe")
      .map(([k, v]) => `${k}=${v}`).join(", ");
    if (already) ctx.push(`Already captured: ${already}`);
  }

  const context = ctx.join("\n");

  // ── CANONICAL FALLBACKS (always appended — use naturally) ───────────────────
  const fallbacks =
`FALLBACKS — use naturally when needed:
- Missing number: "Ballpark is perfectly fine." / "A rough range is enough."
- Uncertain ROI: "I can see the opportunity clearly, but I'd keep that estimate directional until we confirm one or two numbers."
- Benchmark pushback: "I'd treat that as industry guidance, not a guarantee."
- Transition: "Got it." / "Makes sense." / "Perfect." / "And on the phone side?"
- Interruption: "Of course — the one thing I still need is..."`;

  // ── DIRECTIVE — ONE job, canonical approved phrasing ────────────────────────
  let directive = "";

  switch (s.stage) {

    // ── 1. WARM WOW → DEMO FRAMING → COLLABORATIVE NUMBERS INVITE ──
    case "wow":
      directive =
`YOUR TASK: Deliver all three parts naturally, then stop and wait for their response.

PART 1 — WARM WOW (25-40 seconds):
Greet ${fn ? fn : "them"} by first name. Welcome them. Then:
"We've taken a proper look at ${biz}, and a few things stood out straight away."
Use the intel above to make 1-2 specific commercially sharp observations — hero message, offer, CTA, ICP, social proof.
End: "This is exactly the kind of business intelligence we've already used to pre-train your AI team, so they feel like they've been inside ${biz} for years."

PART 2 — DEMO FRAMING (10-20 seconds):
"The way this works is simple: you choose an agent, they're all pre-trained for ${biz}, so they'll roleplay as part of your team, and you play a normal prospect. They'll handle the conversation the way a great employee should — answering questions, guiding the buyer, and moving toward your key conversion point. Then we can quickly work out what that kind of performance could add to your revenue."

PART 3 — COLLABORATIVE NUMBERS INVITE + ACV QUESTION:
"Based on what I can already see, I've got a good sense of where the quickest wins are. If you'd like, I can quickly crunch the numbers with you, show you which agents have the highest likely ROI, and then you can either go straight into demoing the highest-value one yourself — or, if you prefer, once you know the value we can jump straight into launching your free trial and I can get you set up on this call. Takes 10 mins. No credit card. Set and forget, do nothing differently, and watch the results grow."
Then: "To help me calculate the value for you, what's the annual value of a typical new ${ct} for ${biz}?"

STOP. Wait for their answer. Do NOT ask timeframe yet.`;
      break;

    // ── 2. ACV ANCHOR ──
    case "anchor_acv":
      directive =
`YOUR ONLY TASK: Collect ACV.
They have NOT given their annual ${ct} value yet.
Ask exactly: "What's the annual value of a typical new ${ct} for ${biz}? Ballpark is perfectly fine."
ONE question. Stop. Do NOT ask timeframe in this same turn.`;
      break;

    // ── 3. TIMEFRAME ANCHOR ──
    case "anchor_timeframe":
      directive =
`YOUR ONLY TASK: Collect timeframe preference.
ACV confirmed: $${s.inputs.acv?.toLocaleString()}.
Ask exactly: "Ballpark numbers are perfectly fine — do you tend to think about lead flow weekly or monthly?"
ONE question. Stop. Do NOT move to channel questions yet.`;
      break;

    // ── 4. ADS CHANNEL (Alex + Chris) ──
    case "ch_ads": {
      let q = "";
      let note = "";
      if (!s.inputs.ads_leads) {
        q = `"How many leads are your ads bringing in ${tf}?"`;
      } else if (!s.inputs.ads_conversions) {
        note = `They said ads bring in ${s.inputs.ads_leads} leads ${tf}. `;
        q = `"Out of those, roughly how many become ${ct}s?"`;
      } else if (!s.inputs.ads_followup) {
        note = `${s.inputs.ads_leads} ad leads, ${s.inputs.ads_conversions} conversions. `;
        q = `"How quickly does someone usually follow up with those ad leads?"`;
      }
      directive = q
        ? `YOUR ONLY TASK: ${note}Acknowledge their last answer briefly ("Got it" / "Makes sense" / "Perfect"), then ask: ${q}\nONE question only. Stop.`
        : `YOUR ONLY TASK: Ads data complete. Acknowledge briefly and transition: "And on the website side..." then move to website enquiries.`;
      break;
    }

    // ── 5. WEBSITE CHANNEL (Chris) ──
    case "ch_website": {
      let q = "";
      let note = "";
      if (!s.inputs.web_leads) {
        q = `"How many website enquiries or leads do you get ${tf}?"`;
      } else if (!s.inputs.web_conversions) {
        note = `They get ${s.inputs.web_leads} website enquiries ${tf}. `;
        q = `"Out of those, roughly how many become ${ct}s?"`;
      }
      directive = q
        ? `YOUR ONLY TASK: ${note}Acknowledge briefly, then ask: ${q}\nONE question. Stop.`
        : `YOUR ONLY TASK: Website data complete. Transition naturally to the next channel.`;
      break;
    }

    // ── 6. PHONE CHANNEL (Chris + Maddie) ──
    case "ch_phone": {
      let q = "";
      let note = "";
      if (!s.inputs.phone_volume) {
        q = `"Roughly how many inbound calls or call-generated appointments do you get ${tf}?"`;
      } else if (!s.inputs.after_hours) {
        note = `They get ${s.inputs.phone_volume} inbound calls ${tf}. `;
        q = `"What happens to calls after hours or when the team is busy?"`;
      } else if (!s.inputs.missed_calls) {
        note = `After-hours: "${s.inputs.after_hours}". `;
        q = `"Roughly how many calls do you think go unanswered ${tf}?"`;
      }
      directive = q
        ? `YOUR ONLY TASK: ${note}Acknowledge briefly, then ask: ${q}\nONE question. If they confirm 24/7 coverage or a call centre — note it, set maddie_skip mentally, move on.`
        : `YOUR ONLY TASK: Phone data complete. Acknowledge and transition naturally.`;
      break;
    }

    // ── 7. OLD LEADS — Sarah ──
    case "ch_old_leads":
      directive =
`YOUR ONLY TASK: Ask exactly: "Roughly how many older leads do you have from the last 12 months?"
ONE question. Stop. Do NOT explain what Sarah does yet.`;
      break;

    // ── 8. REVIEWS — James ──
    case "ch_reviews": {
      let q = "";
      if (!s.inputs.star_rating) {
        q = `"What's your current average rating?"`;
      } else if (!s.inputs.review_count) {
        q = `"Roughly how many reviews do you have?"`;
      } else if (s.inputs.has_review_system === null) {
        q = `"Do you have any system for consistently asking happy ${ct}s for reviews?"`;
      }
      directive = q
        ? `YOUR ONLY TASK: Acknowledge briefly, then ask: ${q}\nONE question. Stop.`
        : `YOUR ONLY TASK: Reviews data complete. Transition to recommendations.`;
      break;
    }

    // ── 9. ROI DELIVERY — canonical recommendation template ──
    case "roi_delivery": {
      const calcs = runCalcs(s.inputs);
      const top3  = calcs.slice(0, 3);
      const total = top3.reduce((sum, c) => sum + c.weekly, 0);

      if (!top3.length) {
        directive =
`YOUR ONLY TASK: You don't have enough confirmed inputs for precise ROI yet.
Say: "I can see the opportunity clearly, but I'd keep those estimates directional until we confirm one or two numbers."
Then ask the single most important missing input naturally.`;
        break;
      }

      const agentLines = top3.map((c, i) => {
        const label  = i === 0 ? "the strongest opportunity" : i === 1 ? "after that" : "and the third lever";
        const caveat = c.precise ? "" : " — I'd treat that as directional rather than exact until we've got a little more data";
        return `${label} is ${c.agent}: ${c.why}. Conservatively about $${c.weekly.toLocaleString()} a week in additional revenue${caveat}.`;
      }).join(" ");

      const adSpendAsk = adsOn && !s.inputs.ad_spend && top3.some(c => ["Alex","Chris"].includes(c.agent))
        ? `\nAfter delivering, ask: "And just so we can frame that against what you're already investing — what are you roughly spending on ads each month?"`
        : "";

      directive =
`YOUR ONLY TASK: Deliver recommendations using THESE EXACT calculated figures — do NOT invent or adjust numbers.

CANONICAL DELIVERY STRUCTURE:
Start: "Thanks ${fn ? fn : "for that"}, that gives me a pretty clear picture."
Then: "Based on the gaps and the low-hanging fruit, ${agentLines}"
End: "So across those, you're looking at roughly $${total.toLocaleString()} a week in upside, conservatively."${adSpendAsk}

Then say: "To see that in action, you can go straight into demoing the highest-ROI agent yourself." — then STOP. Wait for their response before closing.`;
      break;
    }

    // ── 10. CLOSE — canonical ──
    case "close":
      directive =
`YOUR ONLY TASK: Guide them to next step.
Say exactly: "To see that in action, you can go straight into demoing the highest-ROI agent yourself. Or, if you'd prefer, now that you know the likely value, we can jump straight into your 7-day free trial and I can get you set up on this call. No card required. Set and forget, do nothing differently, and watch the results grow."
Then ask: "What would you prefer?"
If they ask trial length: "We start at 7 days — usually that's plenty to see huge value. If you haven't seen strong additional revenue yet, we can extend to 14 days to be sure."`;
      break;
  }

  return `${persona}\n\n${context}\n\n${directive}\n\n${fallbacks}`;
}

// ─── GEMINI CALL: NON-STREAMING (extraction) ──────────────────────────────────

async function geminiJSON(prompt: string, env: Env): Promise<string> {
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.GEMINI_API_KEY}` },
    body: JSON.stringify({
      model: MODEL, stream: false, temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!res.ok) return "[]";
  const d: any = await res.json();
  return d.choices?.[0]?.message?.content ?? "[]";
}

// ─── GEMINI CALL: STREAMING (final response to Deepgram) ─────────────────────

async function streamToDeepgram(messages: Msg[], env: Env): Promise<Response> {
  const gemRes = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.GEMINI_API_KEY}` },
    body: JSON.stringify({ model: MODEL, messages, stream: true, temperature: 0.85 }),
  });

  if (!gemRes.ok || !gemRes.body) {
    const fallback = [
      `data: {"id":"f","object":"chat.completion.chunk","model":"${MODEL}","choices":[{"index":0,"delta":{"content":"Give me one moment."},"finish_reason":null}]}`,
      `data: {"id":"f","object":"chat.completion.chunk","model":"${MODEL}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
      "data: [DONE]\n",
    ].join("\n");
    return new Response(fallback, { headers: { "Content-Type": "text/event-stream" } });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc    = new TextEncoder();
  (async () => {
    const reader = gemRes.body!.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        await writer.write(value);
      }
      await writer.write(enc.encode("data: [DONE]\n\n"));
    } catch {}
    finally { writer.close().catch(() => {}); }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache", "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function getLid(messages: Msg[]): string {
  const sys = messages.find(m => m.role === "system")?.content ?? "";
  const m   = typeof sys === "string" ? sys.match(/lead[_ ]id[^\w]*[:=]\s*([a-z0-9_-]+)/i) : null;
  return m?.[1] ?? "";
}

function lastUser(messages: Msg[]): string {
  const u = messages.filter(m => m.role === "user");
  const l = u[u.length - 1];
  return typeof l?.content === "string" ? l.content : "";
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization",
    }});

    if (url.pathname === "/health") return new Response(
      JSON.stringify({ status: "ok", version: VERSION, model: MODEL,
        arch: "lean-orchestrator: ~150 token prompts, bridge owns state machine" }),
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

    // ── Load intel ──────────────────────────────────────────────────────────
    let intel: Record<string, any> = {};
    if (lid) {
      try {
        const raw = await env.LEADS_KV.get(`lead:${lid}:intel`);
        if (raw) intel = JSON.parse(raw);
      } catch {}
    }

    // ── Load or init script state ───────────────────────────────────────────
    let s: State = lid
      ? (await loadState(lid, env)) ?? (await initState(lid, env))
      : { stage: "wow", queue: ["ch_website"], done: [], inputs: { ...BLANK },
          maddie_skip: false, wants_numbers: false, calc_ready: false, stall: 0, init: new Date().toISOString() };

        // ── Extract inputs (FIRE AND FORGET — do not await) ────────────────────
    // Extraction runs async. Results written to KV, available next turn.
    // Eliminates ~1-2s TTFT latency that was causing Deepgram to drop connection.
    const utt = lastUser(messages);
    const _extractTask = extractTask(s.stage);
    if (utt && lid && _extractTask !== 'null') {
      geminiJSON(
        `Prospect said: "${utt}"\nTask: ${_extractTask}\nReturn ONLY valid JSON array. No markdown. No explanation.`,
        env
      ).then(raw => {
        try {
          const items: Extracted[] = JSON.parse(raw.replace(/```json|```/g, '').trim());
          if (items?.length) applyExtracted(items, s, lid, env).catch(() => {});
        } catch {}
      }).catch(() => {});
    }

    // ── Advance stage if gate is open ───────────────────────────────────────
    s.stall++;
    if (gateOpen(s)) {
      s.calc_ready = isCalcReady(s.inputs);
      // Jump straight to roi_delivery if calc_ready and queue is empty
      if (s.stage.startsWith("ch_") && s.queue.length === 0 && s.calc_ready) {
        s.queue = []; // clear
      }
      s = advance(s);
    }
    // Safety: 5 turns stuck on same stage → force advance
    if (s.stall > 5 && s.stage !== "roi_delivery" && s.stage !== "close") {
      log("STALL", `forced advance from ${s.stage} after ${s.stall} turns`);
      s = advance(s);
    }

    if (lid) await saveState(lid, s, env);

    // ── Build lean prompt — replaces the entire system prompt ───────────────
    const leanPrompt = buildLeanPrompt(s, intel);
    log("PROMPT", `stage=${s.stage} chars=${leanPrompt.length}`);

    // Replace system message with lean prompt
    // Keep conversation history (user/assistant turns) intact for context
    const sysIdx = messages.findIndex(m => m.role === "system");
    const history = messages.filter(m => m.role !== "system");
    const finalMessages: Msg[] = [
      { role: "system", content: leanPrompt },
      ...history,
    ];

    log("STREAM", `stage=${s.stage} → streaming to Deepgram`);
    return streamToDeepgram(finalMessages, env);
  },
};

// ─── EXTRACT TASK MAP (referenced in main handler) ───────────────────────────

function extractTask(stage: Stage): string {
  const tasks: Record<Stage, string> = {
    wow:             `Return [{field:"wants_numbers",value:true}] if person agrees to run numbers or ROI, else []`,
    anchor_acv:      `Extract annual customer value in AUD. Return [{field:"acv",value:NUMBER}] or []`,
    anchor_timeframe:`Return [{field:"timeframe",value:"weekly"}] or [{field:"timeframe",value:"monthly"}] else []`,
    ch_ads:          `Extract any: ads_leads(number), ads_conversions(number), ads_followup(">24h"|"3h_to_24h"|"30m_to_3h"|"<30m"), ad_spend(number). Return array.`,
    ch_website:      `Extract any: web_leads(number), web_conversions(number). Return array.`,
    ch_phone:        `Extract any: phone_volume(number), missed_calls(number), phone_conversion(decimal), after_hours(string). Return array.`,
    ch_old_leads:    `Return [{field:"old_leads",value:NUMBER}] or []`,
    ch_reviews:      `Extract any: star_rating(number), review_count(number), has_review_system(boolean). Return array.`,
    roi_delivery:    `null`,
    close:           `null`,
  };
  return tasks[stage] ?? "null";
}
