// consultant-v6/worker.js
// Bella's Intel Analyst — receives scraped data, returns script-ready analysis
// Separate atomic worker, called via service binding from scraper Phase B

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

// KV key constants — must match shared/kv-schema.ts
const kvKey = {
  intel:        (lid) => `lead:${lid}:intel`,
  scriptStages: (lid) => `lead:${lid}:script_stages`,
  stagePlan:    (lid) => `lead:${lid}:stage_plan`,
  bellaPlan:    (lid) => `lead:${lid}:bella:plan`,
};
const KV_TTL_INTEL = 86400;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: CORS });

    const url = new URL(request.url);

    try {
      const payload = await request.json();
      if (!payload.businessName) return new Response(JSON.stringify({ error: "Missing businessName" }), { status: 400, headers: CORS });

      // ── /fast endpoint — stripped-down 3-5s analysis for conversation starters ──
      if (url.pathname === "/fast") {
        const t0 = Date.now();
        const result = await runFastConsultant(payload, env);
        console.log(`[Consultant] /fast done in ${Date.now() - t0}ms biz=${result?.correctedName ?? "?"}`);
        return new Response(JSON.stringify(result), { headers: CORS });
      }

      const result = await runConsultant(payload, env);

      const lid = payload.lid ?? payload.leadId ?? null;
      if (lid && env.LEADS_KV && result && !result.error && !result._fallback) {
        try {
          const stagePlan = await writeStagePlan(lid, payload, result, env);
          result.stagePlan = stagePlan;
        } catch (e) {
          console.error("[Consultant] stage_plan write failed:", e);
        }
      }

      return new Response(JSON.stringify(result), { headers: CORS });
    } catch (e) {
      console.error("[Consultant] Fatal:", e);
      return new Response(JSON.stringify({ error: e.message, fallback: buildFallback(null) }), { status: 500, headers: CORS });
    }
  }
};


// ── Write stage_plan to KV — StagePlanV2 shape for bridge's buildQueueV2 ─────

const AGENT_TO_CHANNEL = {
  chris: "ch_website", alex: "ch_ads", maddie: "ch_phone",
  sarah: "ch_old_leads", james: "ch_reviews",
};

async function writeStagePlan(lid, payload, consultantResult, env) {
  const routing = consultantResult?.routing ?? {};
  const priorityAgents = (routing.priority_agents ?? []).map(a => a.toLowerCase());
  const skipAgents = (routing.skip_agents ?? []).map(a => a.toLowerCase());

  // Map agents → channel stages in priority order
  const stages = [];
  for (let i = 0; i < priorityAgents.length; i++) {
    const ch = AGENT_TO_CHANNEL[priorityAgents[i]];
    if (!ch) continue;
    stages.push({
      key: ch,
      active: true,
      priority: i,
      source: "fast",
    });
  }

  // Mark skipped agents as inactive
  for (const agent of skipAgents) {
    const ch = AGENT_TO_CHANNEL[agent];
    if (!ch) continue;
    // Only add if not already in stages
    if (!stages.find(s => s.key === ch)) {
      stages.push({
        key: ch,
        active: false,
        priority: 99,
        source: "fast",
      });
    }
  }

  // Determine tease_stage: 3rd channel in priority order (if exists)
  const activeChannels = stages.filter(s => s.active).sort((a, b) => a.priority - b.priority);
  const teaseStage = activeChannels.length >= 3 ? activeChannels[2].key : null;

  const stagePlan = {
    version: 2,
    tease_stage: teaseStage,
    stages,
  };

  await env.LEADS_KV.put(
    kvKey.stagePlan(lid),
    JSON.stringify(stagePlan),
    { expirationTtl: 86400 }
  );

  console.log(`[Consultant] stage_plan written lid=${lid} stages=${stages.length} tease=${teaseStage ?? "none"} priority=[${priorityAgents.join(",")}]`);
  return stagePlan;
}

// ── Fallback: if Gemini fails, produce deterministic fills from raw data ──
function buildFallback(p) {
  if (!p) return {};
  return {
    scriptFills: {
      website_positive_comment: null,
      hero_header_quote: p.branding?.heroH1 || "",
      reference_offer: p.scraped?.services?.[0] || "your services",
      icp_guess: p.targetAudience || "your clients",
      campaign_summary: p.facebookAds?.isRunning ? `${p.facebookAds.adCount} Facebook ads` : (p.googleAds?.isRunning ? "Google ads" : null),
      rep_commentary: p.google?.rating ? `${p.google.rating} stars from ${p.google.reviewCount} reviews` : null,
      recent_review_snippet: p.reviews?.[0]?.text?.substring(0, 100) || null,
      rep_quality_assessment: null,
      top_2_website_ctas: p.scraped?.ctas?.slice(0, 2)?.join(" and ") || null,
    },
    routing: {
      priority_agents: ["Chris", "Alex", "Maddie", "Sarah", "James"],
      lower_priority_agents: [],
      skip_agents: [],
      reasoning: {}
    },
    secondaryRecommendations: [
      { agent: "Alex", whySecond: "Default follow-up agent" },
      { agent: "Maddie", whyNotFirst: "Default — assess phone needs on call" }
    ],
    landingPageVerdict: { verdictLine: null, verdictLine2: null },
    websiteCompliments: [],
    mostImpressive: [],
    googlePresence: [],
    competitiveEdge: [],
    conversationHooks: [],
    redFlags: [],
    socialMediaPresence: { channels: [], insight: null },
    _fallback: true
  };
}



// ── Model config ─────────────────────────────────────────────────────────────
// Switched to OpenAI-compatible endpoint for faster responses + clean JSON
// reasoning_effort: 'low' gives bounded thinking for strategic insight
// Dead gemini-2.0-flash fallback removed (returns 404 since Jan 2026)
const OPENAI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const MODELS = [
  {
    name:     "gemini-2.5-flash",
    endpoint: OPENAI_ENDPOINT,
    temp:     0.7,
    maxTokens: 8000,
  },
];

// ── FAST Consultant — 3-5s, 6 fields, conversation starters only ─────────────
// This powers stalls 1-4 while the full consultant is still running.
// The output MUST demonstrate genuine understanding of the business.

async function runFastConsultant(payload, env) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return { error: "No GEMINI_API_KEY", correctedName: payload.businessName, industry: "business" };

  const prompt = `You are a senior business analyst. Read this website content carefully. Your job is to demonstrate that you DEEPLY understand this business — their market, their positioning, and their strategy.

CRITICAL: Generic observations are WORTHLESS. "Your tagline really captures what you do" is GARBAGE. We need insights that make a business owner think "wow, they actually get what we do."

PROSPECT DATA:
businessName: ${payload.businessName}
domain: ${payload.domain}
pageTitle: ${payload.pageTitle || ""}
ogTitle: ${payload.ogTitle || ""}
${payload.nameSignals ? `NAME CROSS-REFERENCE SIGNALS:
og:site_name: ${payload.nameSignals.ogSiteName || ""}
JSON-LD org name: ${payload.nameSignals.jsonLdOrgName || ""}
Footer copyright: ${payload.nameSignals.footerCopyright || ""}
` : ""}
WEBSITE CONTENT:
${payload.websiteContent || ""}

INSTRUCTIONS:
1. Read the content. Understand what this business ACTUALLY does, who they serve, and how they position themselves.
2. Cross-reference ALL name signals (og:site_name, JSON-LD, footer, page title, domain, and the ACTUAL COPY) to confirm the real business name.
3. Return ONLY the JSON below. Nothing else. No markdown. No preamble.

{
  "correctedName": "The REAL business name — natural, conversational. Cross-reference page copy, og:site_name, JSON-LD, footer copyright, domain. Strip Pty Ltd, city names. e.g. 'Pitcher Partners' not 'Pitcher Partners Sydney Pty Ltd'.",
  "industry": "Specific industry from reading the actual content. Not from the domain name. e.g. 'accounting and advisory' not 'business'.",
  "icp_guess": "WHO they sell to — be specific, use THEIR language from the copy. Frame as something to CHECK: 'you mainly work with X' not 'businesses seeking services'. If they serve mid-market, say mid-market. If they target trades, say trades. Read the copy.",
  "reference_offer": "Their PRIMARY services — list them specifically from the copy. Not one generic word. e.g. 'tax compliance, audit, business advisory and wealth management' not 'Advisory'.",
  "market_positioning": "How they position themselves vs competitors. What makes them DIFFERENT. This must show you READ the copy. e.g. 'partner-led, relationship-driven alternative to Big Four for mid-market businesses' — not generic waffle.",
  "website_insight": "One specific STRATEGIC observation about their business that shows genuine understanding. NOT a compliment. An INSIGHT about their approach, their market strategy, or something specific from their copy that reveals how they think about their business. This must make the owner think 'they actually get us'."
}`;

  try {
    const t0 = Date.now();

    const resp = await fetch(OPENAI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 800,
        temperature: 0.5,
        reasoning_effort: "none",
      }),
    });

    const elapsed = Date.now() - t0;
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.error(`[Consultant /fast] HTTP ${resp.status} (${elapsed}ms) ${body.substring(0, 200)}`);
      return { correctedName: payload.businessName, industry: "business", error: `HTTP ${resp.status}` };
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content || "";
    if (!text) {
      console.error(`[Consultant /fast] empty content (${elapsed}ms)`);
      return { correctedName: payload.businessName, industry: "business", error: "empty" };
    }
    let result;
    try {
      result = JSON.parse(text);
    } catch (parseErr) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[Consultant /fast] no JSON (${text.length} chars, ${elapsed}ms)`);
        return { correctedName: payload.businessName, industry: "business", error: "no JSON" };
      }
      result = JSON.parse(jsonMatch[0]);
    }
    result._model = "gemini-2.5-flash";
    result._fast = true;
    result._latency = elapsed;
    console.log(`[Consultant /fast] done in ${elapsed}ms`);
    return result;
  } catch (e) {
    console.error(`[Consultant /fast] error: ${e.message}`);
    return { correctedName: payload.businessName, industry: "business", error: e.message };
  }
}

// ── Main Consultant logic ────────────────────────────────────────────────────
async function runConsultant(payload, env) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return { error: "No GEMINI_API_KEY", ...buildFallback(payload) };

  const p = payload;
  const prompt = buildPrompt(p);

  for (const model of MODELS) {
    const result = await tryModel(model, prompt, apiKey, p);
    if (result) return result;
    console.log(`[Consultant] ${model.name} failed — falling back to next model`);
  }

  console.error("[Consultant] All models failed");
  return { error: "All models failed", ...buildFallback(p) };
}

async function tryModel(model, prompt, apiKey, p) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const t0 = Date.now();

      const resp = await fetch(model.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model.name,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
          max_tokens: model.maxTokens,
          temperature: model.temp,
          reasoning_effort: "none",
        }),
      });

      const elapsed = Date.now() - t0;

      if (resp.status === 503 && attempt < 1) {
        console.log(`[Consultant] ${model.name} 503 (${elapsed}ms), retry ${attempt + 1}`);
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      if (resp.status === 429 || resp.status === 404) {
        console.log(`[Consultant] ${model.name} HTTP ${resp.status} (${elapsed}ms) — skipping`);
        return null;
      }

      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        console.error(`[Consultant] ${model.name} HTTP ${resp.status} (${elapsed}ms) ${body.substring(0, 200)}`);
        return null;
      }

      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content || "";

      if (!text) {
        console.error(`[Consultant] ${model.name} empty content (${elapsed}ms)`);
        return null;
      }

      let result;
      try {
        result = JSON.parse(text);
      } catch (parseErr) {
        // response_format should ensure clean JSON, but Gemini 2.5 Flash can produce
        // malformed output on large prompts. Try multiple repair strategies.
        console.warn(`[Consultant] ${model.name} JSON parse failed (${parseErr.message}, ${text.length} chars, ${elapsed}ms) — repairing`);

        // Strategy 1: extract outermost { ... } and fix trailing commas
        const outerMatch = text.match(/\{[\s\S]*\}/);
        if (outerMatch) {
          try {
            const cleaned = outerMatch[0].replace(/,\s*([\]}])/g, '$1');
            result = JSON.parse(cleaned);
            console.log(`[Consultant] ${model.name} JSON repair strategy 1 OK (trailing comma fix)`);
          } catch (_) { /* try next */ }
        }

        // Strategy 2: truncation recovery — close unclosed brackets (string-aware counting)
        if (!result) {
          try {
            let s = text.substring(text.indexOf("{"));
            // Remove trailing commas
            s = s.replace(/,\s*([\]}])/g, '$1');
            // Strip trailing partial key:value
            s = s.replace(/,\s*"[^"]*"?\s*:?\s*"?[^"]*$/, "");
            s = s.replace(/,\s*$/, "");
            // String-aware bracket counting: skip chars inside "..."
            let depth = 0, bracketDepth = 0, inString = false, escaped = false;
            for (let i = 0; i < s.length; i++) {
              const c = s[i];
              if (escaped) { escaped = false; continue; }
              if (c === "\\") { escaped = true; continue; }
              if (c === '"') { inString = !inString; continue; }
              if (inString) continue;
              if (c === "{") depth++;
              else if (c === "}") depth--;
              else if (c === "[") bracketDepth++;
              else if (c === "]") bracketDepth--;
            }
            s += "]".repeat(Math.max(0, bracketDepth));
            s += "}".repeat(Math.max(0, depth));
            console.log(`[Consultant] ${model.name} JSON repair strategy 2 (close brackets: {${depth} [${bracketDepth})`);
            result = JSON.parse(s);
          } catch (_) { /* try next */ }
        }

        // Strategy 3: truncate at error position — salvage everything before the corruption
        if (!result) {
          const posMatch = parseErr.message.match(/position (\d+)/);
          if (posMatch) {
            try {
              const errorPos = parseInt(posMatch[1]);
              let truncated = text.substring(text.indexOf("{"), errorPos);
              truncated = truncated.replace(/,?\s*"[^"]*"?\s*$/, "");  // strip partial key/value
              truncated = truncated.replace(/,\s*$/, "");
              // String-aware bracket closing
              let depth = 0, bd = 0, inStr = false, esc = false;
              for (let i = 0; i < truncated.length; i++) {
                const c = truncated[i];
                if (esc) { esc = false; continue; }
                if (c === "\\") { esc = true; continue; }
                if (c === '"') { inStr = !inStr; continue; }
                if (inStr) continue;
                if (c === "{") depth++; else if (c === "}") depth--;
                if (c === "[") bd++; else if (c === "]") bd--;
              }
              truncated += "]".repeat(Math.max(0, bd));
              truncated += "}".repeat(Math.max(0, depth));
              result = JSON.parse(truncated);
              result._partial = true;
              console.log(`[Consultant] ${model.name} JSON repair strategy 3 OK (truncated at pos ${errorPos}/${text.length}, saved ${Math.round(errorPos/text.length*100)}%)`);
            } catch (_) { /* fall through to retry */ }
          }
        }

        // All repair strategies failed — retry if attempts remain
        if (!result) {
          console.warn(`[Consultant] ${model.name} JSON repair FAILED (${text.length} chars, ${elapsed}ms) — ${attempt < 1 ? "retrying" : "giving up"}`);
          if (attempt < 1) { await new Promise(r => setTimeout(r, 1000)); continue; }
          return null;
        }
      }

      result._model = model.name;
      result._attempt = attempt;
      result._latency = elapsed;
      console.log(`[Consultant] Success with ${model.name} in ${elapsed}ms attempt=${attempt}`);
      return result;
    } catch (e) {
      if (attempt < 1) { await new Promise(r => setTimeout(r, 1000)); continue; }
      console.error(`[Consultant] ${model.name} exception:`, e);
      return null;
    }
  }
  return null;
}



// ── The Consultant Prompt ────────────────────────────────────────────────────
function buildPrompt(p) {
  return `You are Bella's SALES INTELLIGENCE ANALYST at Pillar and Post AI. Your job is to find every possible angle where our AI agents can add value for this business. You deeply analyse scraped website content and produce specific, opportunity-focused intelligence that makes Bella sound like she spent 3 hours researching this business before calling.

You are an OPPORTUNITY FINDER. Every data point is a potential sales angle. Every gap is a problem we can solve. Your default position for every agent is YES — they can help — unless you have strong evidence otherwise.

CRITICAL RULES:
- Use the business's own language from their website copy — their words, their phrases
- Focus heavily on websiteContent — that is the raw scraped page text. Mine it carefully.
- Keep all outputs concise — Bella speaks these on a live voice call, not reads an essay
- Australian English throughout
- Every insight must be evidence-backed with a quote or specific reference from the content
- For scriptFills: if a field genuinely has no data at all, output null. But for routing and opportunity analysis, missing data is a DISCOVERY OPPORTUNITY, never a disqualifier.

## HANDLING MISSING OR NULL DATA — THIS IS CRITICAL
Your payload may have null/empty fields. This does NOT mean negative evidence. It means data hasn't been collected yet.
- google.rating = null → DO NOT say "no reviews" or "reviewCount is 0". Say "Google data not yet loaded — Bella should ask about their online reputation. James opportunity to explore."
- facebookAds/googleAds = null or false → DO NOT say "not running ads". Say "No ad pixels detected on-site — Bella should ask about their lead sources and any paid campaigns. Potential Alex opportunity."
- No phone number visible → DO NOT say "no phone channel". Say "Phone not prominent on site — Bella should ask about inbound call volume. Potential Maddie opportunity."
- Phone number visible ANYWHERE on the site (header, footer, contact page, click-to-call button) → This IS a CTA. It MUST appear in ctaBreakdown with type "call" and agent "Maddie". Maddie MUST appear in priority_agents top 3. Set ctaType to "call" if the phone number is the primary conversion action. Phone numbers on service business sites (trades, medical, legal, accounting, real estate) are almost always the #1 conversion channel even if there's also a form.
- No CRM detected → DO NOT say "no database". Say "No CRM detected — they may have customer records in spreadsheets, email, or accounting software. Sarah opportunity to explore."
- The ONLY time you say an agent is NOT relevant is when you have POSITIVE EVIDENCE they're unneeded (e.g. confirmed sophisticated AI chat already deployed for Chris, confirmed 24/7 call centre for Maddie).

## PROSPECT DATA
${JSON.stringify(p, null, 2)}

## YOUR ANALYSIS TASKS

Read websiteContent carefully. Extract four specific lenses:

### LENS 1 — COPY QUALITY & MESSAGING
What does their website copy actually say? Is it clear, compelling, benefit-led? Does it speak directly to pain or outcome? Quote specific phrases that are strong. Identify where the copy sells well vs where it could be stronger. Frame weaknesses as opportunities ("their copy doesn't highlight X outcome — Bella can ask about that").

### LENS 2 — MARKET & ICP (BE SPECIFIC — NO GENERIC FILLER)
Who is this business actually selling to? Look for signals: language used, problems referenced, outcomes promised, case studies, testimonials, location specificity. What segment of the market are they targeting? Is the ICP clearly defined on the site or implied?

CRITICAL for icpProblems and icpSolutions: These MUST be specific to what you READ on the site, not generic industry assumptions.
BAD: "Feeling overwhelmed by tax complexities" (generic — could apply to any accounting firm)
GOOD: "Business owners who need proactive tax planning to minimise their tax position, not just year-end compliance" (specific to THIS firm's positioning)
BAD: "Needing professional services" (useless)
GOOD: "Growing businesses that have outgrown their bookkeeper and need advisory-level support to scale" (specific from their copy)

Quote or closely paraphrase THEIR actual language. If the site says "we help tradies stop leaving money on the table", use THAT language — don't sanitise it into corporate speak.

### LENS 3 — SURFACED BENEFITS & VALUE PROPS
What specific benefits does this business claim to deliver? Not services — outcomes and transformations. What do customers get? Look for phrases like "so you can", "without", "results", "guaranteed", "faster", "more", "less". Extract their actual stated value propositions.

### LENS 4 — HOW THEY SELL / CONVERSION EVENTS & CTAs (CRITICAL FOR AGENT TRAINING PITCH)
This is KEY: Bella needs to demonstrate she understands HOW this business converts visitors into customers.
What action does this website want visitors to take? List EVERY conversion event — book a call, fill a form, call a number, buy online, get a quote, download something, request a callback, sign up, etc. Don't just find the primary CTA — find ALL of them. If there's a "Book a consultation" button AND a "Download our guide" AND a phone number, list all three.

CRITICAL: Don't just list the CTA text — explain what each conversion event MEANS commercially for this business using their industry language:
- For an accounting firm: "book a free initial consultation" = their primary new client acquisition channel
- For a dentist: "book an appointment" = bread and butter recurring revenue
- For a tradie: "request a quote" = the start of every new job
- For a law firm: "schedule a consultation" = how they win new matters
- For SaaS: "start free trial" / "book a demo" = their pipeline
- Downloads (guides, whitepapers, checklists) = pipeline builders, lead magnets that need follow-up
- Phone numbers / click-to-call = high-intent prospects who want to talk NOW → agent: Maddie, type: "call"
- Contact forms / "get in touch" = warm leads that need FAST follow-up before they go cold → agent: Alex, type: "form"

MADDIE RULE: If you find ANY phone number on the site (even in the footer or contact page), it MUST appear in ctaBreakdown as type "call" with agent "Maddie". For service businesses (trades, medical, legal, accounting, real estate, agencies), phone is almost always a primary conversion channel. Maddie handles inbound calls, after-hours calls, and missed call follow-up. Do NOT omit phone numbers just because they're not styled as a button.

The more specific you are about their conversion events and what they mean commercially, the more powerful Bella's pitch becomes when she says "we've trained your agents to drive more of THESE exact actions."

You MUST provide a conversionNarrative — a 2-3 sentence spoken summary that explains the full conversion funnel in the prospect's industry language. This is what Bella will say to demonstrate deep understanding before pitching agents.

### LENS 6 — HIRING SIGNALS → AGENT REPLACEMENT WEDGE (HIGHEST PRIORITY)
If the payload includes hiring data (jobs_sample, seek_sample, is_hiring), this is your MOST POWERFUL commercial wedge.
Every open role is money they're about to spend that our agents can replace or augment.

ROLE → AGENT MAPPING:
| Hiring Role | Our Agent | Wedge |
|-------------|-----------|-------|
| Receptionist/Admin/Front Desk | Maddie | "You're hiring a receptionist — Maddie covers you TODAY for a fraction of the cost" |
| SDR/BDR/Sales Development | Alex | "You're hiring an SDR — Alex follows up every lead in under 60 seconds, 24/7" |
| Customer Service/Support | Chris + Maddie | "Hiring support staff? Chris and Maddie handle enquiries instantly, no hold time" |
| Marketing/Digital Marketing | Chris + Alex | "Hiring marketing people tells me you're investing in traffic — Chris and Alex make sure it converts" |
| Sales/Closer/Account Executive | Alex + Sarah | "Hiring salespeople means follow-up matters — Alex and Sarah do it at scale" |
| Social Media Manager | Alex + James | "Hiring for social? Alex turns social engagement into booked meetings" |
| Office Manager/Operations | Maddie | "Hiring an office manager? Maddie handles calls and admin 24/7" |

When a hiring match exists, it MUST be your LEAD insight and influence your agent routing. Nothing is more powerful than:
"You're literally paying $X/year to solve a problem we solve for pennies."

Frame the ROI against the hiring cost:
"That {role} costs {salary} a year plus super plus training plus ramp time. {Agent} delivers the same outcome starting today for a fraction."

If NO hiring data is present, skip this lens entirely.

### LENS 5 — BUSINESS IDENTITY CORRECTION (CRITICAL — CROSS-REFERENCE ALL SOURCES)
The businessName field in the payload may be WRONG. Your job is to determine the REAL business name by cross-referencing MULTIPLE sources.

**CROSS-REFERENCE THESE SOURCES (do NOT trust any single one):**
1. \`domain\` — the website domain (e.g. "andersen.com" could be Andersen Consulting OR Andersen Windows — domain alone is AMBIGUOUS)
2. \`ogTitle\` — the Open Graph title meta tag
3. \`pageTitle\` — the HTML <title> tag (strip "Home -" prefix)
4. \`pageContent\` — the ACTUAL BODY COPY of the website. This is the MOST RELIABLE source. Read the services described, the about section, headings, and footer to determine what the business actually does.

**CRITICAL:** Many domain names are ambiguous (andersen.com, mercury.com, atlas.com). When a name could refer to multiple businesses, the PAGE CONTENT is the authority. If the content mentions "tax", "advisory", "consulting", that overrides any assumption about windows, cars, or other industries. NEVER guess based on brand familiarity.

**Output format:** Natural, conversational — e.g. "Pitcher Partners" not "Pitcher Partners Sydney Pty Ltd" or "Home". Strip city names, Pty Ltd, legal suffixes. Just the brand name as you'd say it in conversation.

**NEVER output "Business Name Pending" or similar placeholder text.** If you truly cannot determine the name, use the domain name cleaned up (e.g. "pitcher.com.au" → "Pitcher").

## AGENT ROUTING — THINK LIKE AN ELITE SALES STRATEGIST

You are NOT an analyst ticking boxes. You are an elite sales strategist choosing the best commercial wedge for a live discovery call. Your job is to identify what is costing this prospect money or conversions RIGHT NOW and recommend the agents that fix that first.

### THE AGENTS — KNOW THEIR ROLES

CORE REVENUE AGENTS (address active revenue leaks — prefer these):
- Chris: AI voice agent on the WEBSITE and LANDING PAGES. First contact. Engages visitors the moment they land. Converts them live on the page. Every website without an AI agent on it is leaking conversions.
- Alex: Speed-to-lead FOLLOW-UP. Leads that Chris didn't close — form fills, bounced visitors, enquiries — Alex follows up in under 60 seconds. Speed-to-lead is Alex's strategy.
- Maddie: AI receptionist. Missed calls, after-hours, overflow. Every call that goes to voicemail is a lost opportunity.

ENHANCEMENT AGENTS (address latent/future opportunity — valuable but never lead with these over active leaks):
- Sarah: Database reactivation. Wakes up old/dormant leads. Valuable for established businesses but this is LATENT opportunity, not active bleeding.
- James: Reputation/reviews. Automated review collection and management. Important for long-term growth but not an urgent revenue leak.

### URGENCY HIERARCHY — HARD RULES

1. Active revenue leakage FIRST: ads running, website traffic with no AI engagement, live inbound going cold, calls going to voicemail. These are costing money TODAY.
2. High-confidence friction SECOND: weak conversion path, slow follow-up, poor call handling. Evidence of lost revenue even if not from active spend.
3. Latent monetisation THIRD: old lead reactivation, reputation compounding, future nurture. Valuable but NEVER lead with these over active leaks.

NEVER rank an enhancement agent (Sarah, James) above a core revenue agent (Chris, Alex, Maddie) UNLESS:
- There is strong POSITIVE EVIDENCE the core agents are irrelevant (e.g., confirmed 24/7 AI chat already deployed = Chris less relevant)
- The active leak evidence is genuinely weak

### THE KEY INSIGHT: ADS = CHRIS AND ALEX TOGETHER

When a business is paying for traffic (ad pixels, social media campaigns, email marketing driving to landing pages), those clicks land on their website/landing pages. Chris engages them live on arrival. Alex follows up the ones Chris doesn't close. They are a PAIR. If ads or inbound traffic are detected, Chris and Alex should almost always be your #1 and #2.

### WHAT TO DO WITH MISSING DATA

Missing data does NOT mean the opportunity doesn't exist. It means Bella needs to ASK.
- No ad pixels detected → "No ad pixels found on-site — Bella should ask about their lead sources and any paid campaigns"
- No phone visible → "Phone not prominent — Bella should ask about inbound call volume"
- No CRM detected → Don't even mention this. We're selling AI agents, not auditing their tech stack.

### RANKING RUBRIC — Score each agent on these criteria (1-10):

- urgency_now: Is this costing them money TODAY? Active spend, active traffic, active calls?
- evidence_confidence: How strong is the evidence from the scrape? Confirmed vs inferred?
- speed_to_roi: How fast would this agent show obvious results? Days vs months?
- ease_of_explaining: Can Bella explain the value in 20 seconds on a live call?
- strategic_wedge_strength: Is this a compelling opener that makes the prospect say "tell me more"?

### FORCED TRADE-OFF RULES

- Active spend beats latent opportunity. ALWAYS.
- Active inbound leakage beats future nurture value. ALWAYS.
- Strong evidence beats broad inference.
- If they're running ads → Chris #1, Alex #2. Period.
- If no ads but phone-heavy business → Chris #1, Maddie #2.
- If no ads, form-based CTA → Chris #1, Alex #2.
- Sarah and James get mentioned AFTER the core agents, not before.

## OUTPUT — VALID JSON ONLY

{
  "businessIdentity": {
    "correctedName": "The REAL business name — natural, conversational. Use ogTitle and domain as primary hints, verify in page content. Strip city names and legal suffixes (Pty Ltd, Inc). e.g. 'Pitcher Partners' not 'Pitcher Partners Sydney Pty Ltd'. NEVER output placeholders like 'Business Name Pending' — if unsure, clean up the domain name.",
    "spokenName": "REQUIRED. The SHORT name a person would naturally say in conversation. This is what Bella says on the call — it must sound natural when spoken aloud. Rules: 1) Strip city/country/legal suffixes. 2) If the brand has a well-known short form, use it. 3) Max 2-3 words. Examples: 'Penguin Random House Australia' → 'Penguin', 'Pitcher Partners Melbourne' → 'Pitcher Partners', 'KPMG' → 'KPMG', 'Commonwealth Bank of Australia' → 'CommBank', 'McDonald's Australia Pty Ltd' → 'Macca's' or 'McDonald's', 'The Smith Family Foundation' → 'The Smith Family'. If unsure, use the first distinctive word(s) of the brand.",
    "industry": "The CORRECT industry based on what the business actually does — read their services, about page, and copy. e.g. 'accounting and advisory', 'plumbing', 'dental', 'legal'. Be specific. Do NOT guess from the <title> tag.",
    "businessModel": "B2B or B2C or Both — based on who their customers are from the copy",
    "serviceArea": "Where they operate — national, state-wide, or local. Infer from copy, office locations, service area mentions."
  },
  "scriptFills": {
    "website_positive_comment": "A specific STRATEGIC observation about their business positioning, copy, or approach that shows genuine understanding. NOT a generic compliment. NOT 'your tagline captures what you do'. An INSIGHT that would make the owner think 'they actually understand our business'. Reference specific copy, positioning decisions, or market strategy from the content.",
    "hero_header_quote": "Their actual H1/hero headline, verbatim from the content",
    "reference_offer": "Their primary service or offer as named on the site",
    "icp_guess": "Who their ideal customer appears to be — use their language. Frame as something Bella can CHECK with the prospect e.g. 'it looks like you mainly work with X, is that right?'",
    "campaign_summary": "What ads they're running or null if no ad data available",
    "rep_commentary": "Qualitative assessment of their Google reputation if data available — warm, specific, cite numbers. If no Google data: null (do NOT invent or say zero)",
    "recent_review_snippet": "Best customer quote from their reviews (verbatim), or null if no reviews in payload",
    "rep_quality_assessment": "Brief assessment of review quality if data exists — themes, sentiment. null if no review data in payload.",
    "top_2_website_ctas": "Their top 2 CTAs from the website, natural language"
  },
  "copyAnalysis": {
    "messagingStrength": "What the copy does well — cite specific phrases or sections",
    "messagingWeakness": "Where the copy could be stronger — frame as opportunity, not criticism",
    "strongestLine": "The single most compelling line on the entire site — verbatim quote",
    "toneAndVoice": "How would you describe the brand voice? e.g. professional, warm, authoritative, clinical, casual",
    "bellaLine": "A single sentence Bella can say that compliments the copy specifically — e.g. 'I noticed your website leads with X outcome rather than just listing services — that's actually quite rare and it works really well'"
  },
  "icpAnalysis": {
    "whoTheyTarget": "Specific description of apparent ICP drawn from the copy",
    "howTheyKnow": "Evidence from the copy — specific phrases, problems referenced, language used",
    "icpConfidenceLevel": "high / medium / low — how clearly defined is the ICP on the site?",
    "icpProblems": ["REQUIRED — MUST provide at least 2. SPECIFIC problem from the copy using THEIR language — NOT generic industry filler. Quote or closely paraphrase what the site actually says.", "REQUIRED — Problem 2, specific to THIS site's copy"],
    "icpSolutions": ["REQUIRED — MUST provide at least 2. SPECIFIC solution from the copy — how THIS business addresses the problem, in THEIR words. e.g. 'partner-led advisory that goes beyond compliance' not 'providing professional services'", "REQUIRED — Solution 2, in THEIR words"],
    "problemSolutionMapping": "Brief statement connecting problems to solutions — e.g. 'They help business owners who struggle with X by providing Y'",
    "bellaCheckLine": "The exact question Bella asks to CONFIRM this with the prospect — e.g. 'We noticed your site speaks very directly to trade business owners — is that mainly who you're working with?'",
    "marketPositionNarrative": "REQUIRED — MUST NOT be null or empty. A 1-2 sentence spoken summary of how this business positions itself in the market — their differentiator, their angle, what makes them different from competitors. Use THEIR language from the site. Bella will say this verbatim. Example for accounting: 'You've positioned Pitcher Partners as the advisory firm that goes beyond just compliance — you're really speaking to business owners who've outgrown their bookkeeper and need strategic-level support to scale.' Example for trades: 'You've positioned yourself as the go-to emergency plumber in the eastern suburbs — fast response, upfront pricing, no call-out fee. That's a strong market position.'",
    "icpNarrative": "REQUIRED — MUST NOT be null or empty. A 2-3 sentence spoken summary that weaves together who they target, their 2 key client problems, and how they solve them. Bella will say this verbatim at a critical moment in the call. Use the prospect's industry language, not corporate speak. Must end with a confirmation question. Example for accounting: 'It looks like you mainly work with growing businesses that have outgrown their bookkeeper and need proper advisory support, and business owners who are spending too much time on compliance when they should be focused on growth. You solve that through partner-led advisory and proactive tax planning. Does that sound about right?' Example for trades: 'It looks like your main customers are homeowners dealing with ageing hot water systems and businesses that cant afford downtime when their plumbing fails. You solve that with same-day emergency callouts and upfront fixed pricing. Is that a fair summary?'"
  },
  "valuePropAnalysis": {
    "statedBenefits": ["List of specific outcome/benefit claims from the copy — not service names, real outcomes"],
    "strongestBenefit": "The most compelling, specific benefit claim on the site",
    "missingBenefits": "What outcomes do they deliver that they DON'T clearly claim on the site (based on context)?",
    "bellaLine": "One sentence Bella can say referencing a specific benefit — e.g. 'I saw you specifically mention X result for your clients — that's a really strong proof point'"
  },
  "conversionEventAnalysis": {
    "primaryCTA": "The main conversion action the site is driving — exact CTA text if visible",
    "ctaType": "book_call / fill_form / call / buy_online / get_quote / download / other (USE 'call' for any phone number, click-to-call, or call-oriented CTA)",
    "ctaClarity": "Is it obvious what to do next? Single CTA or multiple competing?",
    "frictionPoints": ["Specific things that could reduce conversions — frame each as an opportunity for our agents"],
    "conversionStrength": "strong / moderate / weak — overall assessment with brief reason",
    "bellaLine": "One sentence Bella can say about the conversion setup — e.g. 'I noticed your main CTA is a booking form — we can actually train your AI agents to guide people through that step by step'",
    "allConversionEvents": ["List EVERY conversion action/CTA on the site — e.g. 'book a free consultation', 'download the tax planning guide', 'call us on 1300 xxx xxx', 'request a quote'. Include ALL of them, not just the primary. Use their exact CTA wording from the site."],
    "ctaBreakdown": [
      {
        "cta": "The exact CTA text from the site",
        "type": "form | call | booking | download | chat | buy | other",
        "commercialMeaning": "What this CTA means commercially in their industry — e.g. 'This is their primary new client acquisition channel' or 'Pipeline builder — these leads need fast follow-up' or 'High-intent prospects wanting to talk NOW'",
        "industryTerm": "How to describe this conversion in their language — e.g. 'new patient bookings', 'quote requests', 'initial consultations', 'demo requests'",
        "agent": "Which agent handles this: Chris (website engagement/chat), Alex (form follow-up/lead response), Maddie (phone calls/click-to-call), Sarah (reactivation), James (reviews)",
        "reason": "Brief explanation — e.g. 'Contact form submissions need fast follow-up → Alex'"
      }
    ],
    "conversionNarrative": "REQUIRED — MUST NOT be null or empty. A 2-3 sentence spoken summary explaining the full conversion funnel in the prospect's industry language. Bella will say this verbatim. Example for accounting: 'Your site is driving people to book a free initial consultation — that's your primary new client acquisition channel. You've also got a tax planning guide download which builds your pipeline, and a phone number for prospects who want to talk now. Those are exactly the kind of conversion events we've trained your AI agents to focus on.' Example for trades: 'Your site is set up to drive quote requests — that's the start of every new job. You've also got a phone number for urgent callouts. We've trained your agents to convert more of both, on autopilot.'",
    "agentTrainingLine": "REQUIRED — MUST NOT be null or empty. A single sentence Bella can say that references ALL the conversion events and connects them to agent training. Format: 'I can see your main call to action is [PRIMARY CTA], and you're also driving [SECONDARY, TERTIARY] — those are exactly the kind of conversion events we've trained your AI agents to focus on driving more of, on autopilot.' MUST mention ALL events found. Use natural spoken language. If only one CTA, say: 'I can see your main call to action is [CTA] — that's exactly the kind of conversion we train our AI agents to drive more of, on autopilot.'",
    "ctaAgentMapping": "REQUIRED — MUST NOT be null or empty. A single sentence mapping CTAs to agents for Bella to say. E.g. 'I'd say Chris to maximise those booking conversions on your site, Alex to follow up the form submissions, and Maddie to handle the inbound calls'. Only include agents that map to actual CTAs found. If all CTAs are the same type, recommend 2 agents. If mixed types (forms + calls + website), recommend 3."
  },
  "routing": {
    "priority_agents": ["Rank agents by URGENCY and ACTIVE REVENUE LEAK, not theoretical opportunity. Core revenue agents (Chris, Alex, Maddie) should almost always be top 3 unless strong evidence says otherwise. Format: ordered array of agent names."],
    "lower_priority_agents": ["Enhancement agents or agents where the evidence is genuinely weak for THIS specific business"],
    "skip_agents": ["Only agents with strong POSITIVE evidence they're irrelevant — e.g., confirmed 24/7 AI chat for Chris, confirmed call centre for Maddie"],
    "reasoning": {
      "chris": "COMMERCIAL ASSESSMENT — not feature-checking. What's the active revenue leak Chris fixes? Evidence from scrape. Why now?",
      "alex": "COMMERCIAL ASSESSMENT — what leads are going cold? What's the follow-up gap? Evidence. Why now?",
      "maddie": "COMMERCIAL ASSESSMENT — is there a phone number on the site? Is this a service business where phone is a meaningful channel (trades, medical, legal, accounting, real estate, agencies)? If yes, Maddie is relevant — inbound calls need answering, after-hours calls get missed, and every missed call is lost revenue. Evidence of phone reliance. Why now?",
      "sarah": "HONEST ASSESSMENT — is there real database opportunity or are we just assuming? If latent, say so. Don't inflate.",
      "james": "HONEST ASSESSMENT — is review management a real wedge or a nice-to-have? If latent, say so."
    },
    "questions_to_prioritise": ["Which 2-3 questions Bella should ask to CONFIRM the lead recommendation — not generic discovery, targeted confirmation"],
    "questions_to_brush_over": ["Which topics to mention briefly — usually Sarah and James value-adds"]
  },
  "secondaryRecommendations": [
    {
      "agent": "The #2 agent",
      "whySecond": "One sentence: why this agent complements the lead, and why it's #2 not #1"
    },
    {
      "agent": "The #3 agent (or enhancement agent)",
      "whyNotFirst": "One sentence: why this is valuable but not the lead — explicitly state what makes it less urgent"
    }
  ],
  "hiringAnalysis": {
    "matchedRoles": [
      { "jobTitle": "The exact job title from the payload", "ourAgent": "Which agent replaces this role", "salary": "Salary if available from payload", "wedge": "One-sentence replacement pitch for Bella to say on the call", "urgency": "high/medium — how directly does our agent replace this?" }
    ],
    "topHiringWedge": "The single most powerful hiring replacement line for Bella — e.g. 'You're hiring a receptionist for sixty K — Maddie does the same job starting today for pennies'. Say salary as words. null if no hiring data."
  },
  "websiteCompliments": [
    { "what": "Something genuinely specific and impressive from the COPY", "evidence": "Verbatim quote or specific data point", "bellaLine": "Natural sentence Bella can say" },
    { "what": "A second different impressive thing", "evidence": "Specific evidence", "bellaLine": "Natural sentence" }
  ],
  "mostImpressive": [
    { "finding": "The single most notable thing from ALL the data", "source": "Where you found it", "bellaLine": "How Bella references it naturally" },
    { "finding": "Second most impressive — different category", "source": "Data source", "bellaLine": "Natural reference" }
  ],
  "googlePresence": [
    { "insight": "Their rating/review standing if data available. If no Google data in payload, say 'Google data not yet available — Bella should ask about their online reputation'", "data": "Exact numbers if available, otherwise 'pending'", "bellaLine": "How Bella references this naturally" },
    { "insight": "What their reviews reveal — theme, sentiment. Or if no reviews in payload: 'Review data pending — discovery opportunity'", "bestQuote": "Direct quote from best review, or null", "bellaLine": "How Bella references review sentiment or asks about it" }
  ],
  "conversationHooks": [
    { "topic": "A specific copy or ICP insight Bella can raise naturally", "data": "Evidence from the site", "how": "How to bring it up" },
    { "topic": "A benefit or value prop observation", "data": "Evidence", "how": "Conversation approach" },
    { "topic": "The conversion event observation", "data": "Evidence", "how": "Approach" }
  ],
  "redFlags": [
    "Frame each gap as an OPPORTUNITY, not a criticism. e.g. 'No chat widget on site — every website visitor currently leaves without a conversation. Strong Chris opportunity.' or 'No visible review generation process — James can automate this and grow their Google presence.'",
    "Second opportunity — different category. Always tie back to which agent solves it."
  ],
  "landingPageVerdict": {
    "heroEffectiveness": "Is their H1/hero compelling? Quote it, assess honestly",
    "ctaClarity": "Are the CTAs clear? Single clear next step or confusion?",
    "conversionBarriers": ["Specific friction points — frame each as solvable by our agents"],
    "trustSignals": "What builds credibility? What's missing that we could help with?",
    "verdictLine": "One punchy sentence summarising landing page quality — lead with what's working",
    "verdictLine2": "The biggest opportunity for improvement — frame as what our agents can fix"
  }
}

MANDATORY FIELDS CHECKLIST — Before returning your response, verify EVERY field below is populated (not null, not empty string, not empty array). If any are missing, go back and fill them in:
1. icpAnalysis.icpProblems — array with at least 2 SPECIFIC problems from the site copy
2. icpAnalysis.icpSolutions — array with at least 2 SPECIFIC solutions from the site copy
3. conversionEventAnalysis.conversionNarrative — 2-3 sentence spoken summary of conversion funnel
4. conversionEventAnalysis.agentTrainingLine — single sentence connecting ALL CTAs to agent training
5. conversionEventAnalysis.ctaAgentMapping — single sentence mapping CTAs to agents
6. conversionEventAnalysis.allConversionEvents — array of EVERY CTA found on the site
7. conversionEventAnalysis.ctaBreakdown — array with breakdown of each CTA
8. hiringAnalysis.matchedRoles — array (use payload hiring data if available, otherwise empty array)
9. icpAnalysis.marketPositionNarrative — 1-2 sentence spoken summary of market positioning
10. icpAnalysis.icpNarrative — 2-3 sentence spoken summary weaving ICP + problems + solutions, ending with confirmation question
These fields are CRITICAL to Bella's call performance. Omitting them degrades the live sales call.

REPETITION REVIEW — MANDATORY FINAL PASS (DO THIS LAST, BEFORE RETURNING)
Bella speaks these fields SEQUENTIALLY on a live voice call. If two fields say the same thing in different words, the prospect hears a broken record and loses trust. You MUST review and rewrite for variety.

Review these groups together — each field within a group MUST make a DIFFERENT point using DIFFERENT phrasing and a DIFFERENT angle:

GROUP A (ICP-adjacent — highest repetition risk):
- scriptFills.icp_guess
- icpAnalysis.bellaCheckLine
- icpAnalysis.icpNarrative
- icpAnalysis.marketPositionNarrative
- copyAnalysis.bellaLine
- scriptFills.website_positive_comment
Rule: icp_guess states WHO they serve. bellaCheckLine CONFIRMS it as a question. icpNarrative weaves in their PROBLEMS and SOLUTIONS (not who they serve again). marketPositionNarrative covers their DIFFERENTIATOR vs competitors. copyAnalysis.bellaLine compliments a specific PHRASE or DESIGN CHOICE. website_positive_comment makes a STRATEGIC observation about their approach. Six different angles — never the same sentence reworded.

GROUP B (CTA/conversion-adjacent):
- conversionEventAnalysis.bellaLine
- conversionEventAnalysis.agentTrainingLine
- conversionEventAnalysis.ctaAgentMapping
- conversionEventAnalysis.conversionNarrative
Rule: bellaLine observes the conversion SETUP. agentTrainingLine connects CTAs to agent TRAINING. ctaAgentMapping maps SPECIFIC CTAs to SPECIFIC agents by name. conversionNarrative explains the full FUNNEL in industry language. Four different angles — no overlap.

GROUP C (Compliments/observations):
- websiteCompliments[0].bellaLine
- websiteCompliments[1].bellaLine
- mostImpressive[0].bellaLine
- mostImpressive[1].bellaLine
- valuePropAnalysis.bellaLine
Rule: Each must reference a DIFFERENT finding. No two should mention the same service, feature, or positioning point.

If you find repetition in ANY group: REWRITE the repeated field to contribute something genuinely new. Use a different data point from the website content, a different angle, or a different insight entirely. Variety is more important than comprehensiveness — one fresh insight beats three reworded versions of the same observation.`;
}
