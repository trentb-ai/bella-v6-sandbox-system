// consultant-v6/worker.js
// Bella's Intel Analyst — receives scraped data, returns script-ready analysis
// Separate atomic worker, called via service binding from scraper Phase B

const VERSION = '6.12.0-pass2';

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

      // ── /pass2 endpoint — deep data enrichment after scrape completes ──
      if (url.pathname === "/pass2") {
        const t0 = Date.now();
        if (!payload.pass1 || !payload.deepFlags) {
          return new Response(JSON.stringify({ error: "Missing pass1 or deepFlags" }), { status: 400, headers: CORS });
        }
        const result = await runPass2Consultant(payload, env);
        console.log(`[Consultant] /pass2 done in ${Date.now() - t0}ms biz=${payload.businessName}`);
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
    name:     "gemini-2.5-pro",
    endpoint: OPENAI_ENDPOINT,
    temp:     0.7,
    maxTokens: 16000,
  },
  {
    name:     "gemini-2.5-flash",
    endpoint: OPENAI_ENDPOINT,
    temp:     0.7,
    maxTokens: 16000,
  },
];

async function callMicro(name, prompt, apiKey) {
  for (const model of MODELS) {
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

      if (!resp.ok) {
        console.log(`[Micro:${name}] ${model.name} HTTP ${resp.status} ${elapsed}ms — trying next`);
        continue;
      }

      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (!text) {
        console.log(`[Micro:${name}] ${model.name} empty content — trying next`);
        continue;
      }

      let result;
      try {
        result = JSON.parse(text);
      } catch (e) {
        // Repair 1: extract outermost {} and fix trailing commas
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            result = JSON.parse(match[0].replace(/,\s*([\]}])/g, '$1'));
            console.log(`[Micro:${name}] ${model.name} JSON repair 1 OK`);
          } catch (_) {}
        }
        // Repair 2: close unclosed brackets (string-aware)
        if (!result) {
          try {
            let s = text.substring(text.indexOf("{")).replace(/,\s*([\]}])/g, '$1');
            let depth = 0, bd = 0, inStr = false, esc = false;
            for (let i = 0; i < s.length; i++) {
              const c = s[i];
              if (esc) { esc = false; continue; }
              if (c === "\\") { esc = true; continue; }
              if (c === '"') { inStr = !inStr; continue; }
              if (inStr) continue;
              if (c === "{") depth++;
              else if (c === "}") depth--;
              if (c === "[") bd++;
              else if (c === "]") bd--;
            }
            s += "]".repeat(Math.max(0, bd)) + "}".repeat(Math.max(0, depth));
            result = JSON.parse(s);
            console.log(`[Micro:${name}] ${model.name} JSON repair 2 OK`);
          } catch (_) {}
        }
      }

      if (result) {
        console.log(`[Micro:${name}] ${model.name} OK elapsed=${elapsed}ms keys=${Object.keys(result).length}`);
        return result;
      }

      console.log(`[Micro:${name}] ${model.name} parse failed after repair — trying next`);
    } catch (e) {
      console.log(`[Micro:${name}] ${model.name} exception: ${e.message} — trying next`);
    }
  }
  console.warn(`[Micro:${name}] ALL models failed — returning empty slice`);
  return {};
}

function buildPromptICP(p) {
  return `You are Bella's ICP and Market Intelligence Analyst at Pillar and Post AI.
Your ONLY job is to deeply understand who this business sells to, what problems they solve, and how they position themselves in the market.

CRITICAL RULES:
⚠️ VOICE PERSPECTIVE — HARD RULE — CHECK EVERY FIELD BEFORE RETURNING:
You are writing words that Bella speaks DIRECTLY TO the business owner on a live phone call. The owner is listening. Every field must sound like Bella is talking TO them, not describing them to someone else.
- "you" and "your" = the business and its owner. Always.
- "they" and "their" = the prospect's CUSTOMERS only. Never the business.
WRONG: "They offer accounting services" → RIGHT: "You offer accounting services"
WRONG: "Their main CTA is a booking form" → RIGHT: "Your main CTA is a booking form"
CORRECT: "The problems they bring to you" (they = customers, correct)
If you write "they" or "their" referring to the business, you have broken the call. The owner will hear Bella describe them in third person and lose trust immediately.

- Use the business's own language from their website copy
- Australian English throughout
- Keep all spoken lines under 20 words per sentence
- icpProblems and icpSolutions MUST be specific to THIS site's copy — NOT generic industry filler
- BAD: "Feeling overwhelmed by tax complexities" — generic
- GOOD: "Business owners who need proactive tax planning not just year-end compliance" — specific to their copy
- marketPositionNarrative and icpNarrative MUST NOT be null or empty

ANALYSIS FRAMEWORK — HOW TO READ THE SITE:
Focus heavily on websiteContent — that is the raw scraped page text. Mine it carefully. This is your primary source of truth.

To identify the ICP, look for: the exact language they use to describe their customers, problems they reference explicitly, outcomes they promise, any case studies or testimonials, location specificity, phrases like "we work with", "our clients", "designed for", "perfect for".

For icpProblems and icpSolutions — these MUST come from what the site actually says. Not from generic industry assumptions. If the site says "we help business owners stop leaving money on the table" — use THAT language. Do not sanitise it into corporate speak. Quote or closely paraphrase their actual words.

For marketPositionNarrative — find how they differentiate from competitors. Look for words like "unlike", "instead of", "beyond", "not just", "more than". This is how they think about their market position. Use their language.

MISSING DATA RULES:
If websiteContent is thin or signals are weak — state low confidence but still provide your best analysis. Never return null for icpNarrative or marketPositionNarrative. Work with what you have.

PROSPECT DATA:
${JSON.stringify(p, null, 2)}

Read websiteContent carefully. Focus on: who they target, problems they reference, outcomes they promise, how they differentiate from competitors.

⚠️ CRITICAL: Generate ORIGINAL content from ACTUAL website data. Do NOT echo, copy, or reference any example text. If you cannot generate content from the actual site, return an empty string "" — NEVER return example text or template placeholders.

Return ONLY this JSON. Nothing else. No markdown. No preamble.

{
  "positioning": {
    "summary": "REQUIRED. 1-2 sentences: market category + who they are for + main differentiator. Use THEIR language. Spoken-ready, under 20 words per sentence.",
    "confidence": "high|medium|low"
  },
  "icpAnalysis": {
    "whoTheyTarget": "Specific description of apparent ICP drawn from the copy",
    "howTheyKnow": "Evidence from the copy — specific phrases, problems referenced, language used",
    "icpConfidenceLevel": "high|medium|low — how clearly defined is the ICP on the site?",
    "icpProblems": ["REQUIRED — at least 2. SPECIFIC problem from THEIR copy using THEIR language. Quote or closely paraphrase what the site actually says.", "REQUIRED — Problem 2, specific to THIS site"],
    "icpSolutions": ["REQUIRED — at least 2. SPECIFIC solution from THEIR copy — how THIS business addresses the problem in THEIR words.", "REQUIRED — Solution 2 in THEIR words"],
    "problemSolutionMapping": "Brief statement connecting problems to solutions in their language",
    "bellaCheckLine": "The exact question Bella asks to CONFIRM this with the prospect — e.g. 'We noticed your site speaks very directly to trade business owners — is that mainly who you're working with?'",
    "marketPositionNarrative": "REQUIRED — MUST NOT be null. 1-2 sentence spoken summary of how this business positions itself — their differentiator, what makes them different from competitors. Use THEIR language. Bella says this verbatim. Generate ORIGINAL content based on actual website signals — do NOT copy example text.",
    "icpNarrative": "REQUIRED — MUST NOT be null. 2-3 sentence spoken summary weaving together: who they target + their 2 key client problems + how they solve them. End with a confirmation question. Bella says this verbatim. Use prospect's industry language. Generate ORIGINAL content — do NOT copy example text."
  },
  "trainingBridge": {
    "line": "REQUIRED — MUST NOT be null. 1-2 sentences explicitly tying together: who they serve + the problems they bring + how they solve them + the exact CTAs on their site — framed as what the AI agents are being trained on. Bella says this verbatim. Must be spoken-friendly, under 20 words per sentence. Generate ORIGINAL content — do NOT copy example text."
  }
}

FINAL CHECK — Before returning, scan every string value in your response for "they" or "their" referring to the business or owner. Replace with "you" or "your". This is non-negotiable.`;
}

function buildPromptConversion(p) {
  return `You are Bella's Conversion Intelligence Analyst at Pillar and Post AI.
Your ONLY job is to identify every single conversion event on this website and understand exactly what each one means commercially — then map each to the AI agent that handles it.

This data is CRITICAL. Bella uses it to say: "I can see your main call to action is X, and you're also driving Y and Z — those are exactly the conversion events your agents are trained on." Every CTA must be found. Every agent mapping must be precise.

CRITICAL RULES:
⚠️ VOICE PERSPECTIVE — HARD RULE — CHECK EVERY FIELD BEFORE RETURNING:
You are writing words that Bella speaks DIRECTLY TO the business owner on a live phone call. The owner is listening. Every field must sound like Bella is talking TO them, not describing them to someone else.
- "you" and "your" = the business and its owner. Always.
- "they" and "their" = the prospect's CUSTOMERS only. Never the business.
WRONG: "They offer accounting services" → RIGHT: "You offer accounting services"
WRONG: "Their main CTA is a booking form" → RIGHT: "Your main CTA is a booking form"
CORRECT: "The problems they bring to you" (they = customers, correct)
If you write "they" or "their" referring to the business, you have broken the call. The owner will hear Bella describe them in third person and lose trust immediately.

- Find EVERY conversion event — not just the primary CTA. Every button, form, phone number, download, booking link
- MADDIE RULE: If ANY phone number exists on the site (even in the footer or contact page), it MUST appear in ctaBreakdown as type "call" with agent "Maddie". For service businesses (trades, medical, legal, accounting, real estate, agencies), phone is almost always a primary channel
- conversionNarrative, agentTrainingLine, and ctaAgentMapping MUST NOT be null
- Australian English throughout
- All spoken lines under 20 words per sentence

AGENT ROLES:
- Chris: AI agent on website/landing pages — engages visitors live on arrival, converts them on the page
- Alex: Speed-to-lead follow-up — form fills, bounced visitors, enquiries followed up in under 60 seconds
- Maddie: AI receptionist — answers every inbound call, after-hours, overflow. Every missed call is lost revenue
- Sarah: Database reactivation — wakes up dormant leads
- James: Reputation/reviews — automated review collection

ANALYSIS FRAMEWORK — HOW TO READ CONVERSION EVENTS:
Every conversion event needs commercial translation — not just what the button says, but what it means for this specific business in their industry.

Translation examples:
- Accounting firm "book a free initial consultation" = their primary new client acquisition channel. Every consultation booked is a potential long-term client.
- Dental "book an appointment" = bread and butter recurring revenue.
- Tradie "request a quote" = the start of every new job.
- Law firm "schedule a consultation" = how they win new matters.
- SaaS "start free trial" or "book a demo" = their entire pipeline.
- Download (guide, whitepaper, checklist) = pipeline builder, lead magnet that needs follow-up → Alex.
- Phone number or click-to-call anywhere on the site = high-intent prospects who want to talk NOW → Maddie. ALWAYS include in ctaBreakdown.
- Contact form or "get in touch" = warm leads that go cold fast → Alex.

KEY INSIGHT — WHEN ADS ARE RUNNING:
When a business is paying for traffic (ad pixels detected, social campaigns, paid search), those clicks land on their website and landing pages. Chris engages them live on arrival. Alex follows up the ones Chris doesn't close. They are always a pair. If any ad signals exist, Chris and Alex should be your top 2 priority agents.

URGENCY HIERARCHY — rank agents by this order, never deviate:
1. Active revenue leakage RIGHT NOW: ads running with no AI on-site, website traffic with no engagement, live inbound going cold, calls going to voicemail.
2. High-confidence friction: weak conversion path, slow follow-up, poor call handling. Evidence of lost revenue.
3. Latent opportunity: old lead reactivation (Sarah), reputation (James). Valuable but NEVER rank these above active leaks.

DEFAULT: ALWAYS RECOMMEND ALL 3 CORE AGENTS (Alex, Chris, Maddie):
Alex has priority — speed-to-lead delivers up to 40% value add. Chris converts on-site. Maddie catches every call.
Only EXCLUDE a core agent if there is STRONG POSITIVE EVIDENCE they are already covered (e.g. confirmed 24/7 AI chat = no Chris, confirmed 24/7 phone service = no Maddie).
Absence of data is NEVER a reason to exclude. If you can't find strong evidence FOR an agent, use fallback justifications:
- Alex fallback: "Any form, enquiry, or CTA on the site needs fast follow-up — Alex responds in under 30 seconds."
- Chris fallback: "Every website visitor is a potential customer — Chris engages them before they bounce."
- Maddie fallback: "If there's a phone number anywhere on the site, calls are happening — Maddie answers every one."

RANKING RULES (within the default "all 3"):
- Alex is always number 1 unless there is overwhelming evidence another agent is more urgent.
- If ads running → Chris number 2 (engages paid clicks), Maddie number 3.
- If phone-heavy business → Maddie number 2, Chris number 3.
- If form-based CTA → Alex number 1, Chris number 2, Maddie number 3.
- Sarah and James always come AFTER the 3 core agents.

MISSING DATA RULES:
- No ad pixels detected → do NOT say "not running ads". Say "No ad pixels found on-site — Bella should ask about their paid campaigns. Alex opportunity."
- No phone visible → do NOT say "no phone channel". Say "Phone not prominent — Bella should ask about inbound call volume. Maddie opportunity."
- Phone number visible ANYWHERE on the site (even footer) → Maddie is relevant, always include in ctaBreakdown as type "call".
- The ONLY time you exclude an agent is when you have strong POSITIVE EVIDENCE they are already covered (e.g. confirmed 24/7 AI chat already deployed).

PROSPECT DATA:
${JSON.stringify(p, null, 2)}

Read websiteContent carefully. Find every CTA, button, form, phone number, download, booking link.

⚠️ CTA NAMING RULE — NON-NEGOTIABLE:
Use the EXACT text from every button, link, and CTA as it appears on the site. NEVER rename, paraphrase, or summarise. If the button says "Get in touch", write "Get in touch" — NOT "Contact Us". If the link says "Discover more", write "Discover more". Bella will say these words on a live call and the prospect will notice if they don't match their own site.

⚠️ CTA RANKING RULE — RANK BY COMMERCIAL INTENT, NOT PROMINENCE:
primaryCTA must be the highest COMMERCIAL INTENT action, not the most visually prominent button. Ranking: form submissions (Contact, Enquiry, Get in touch) > phone/call > booking > quote request > download > explore/learn more/other. A contact form buried in the footer outranks a "Discover more" hero button. Exploration CTAs (Learn more, Discover, Read more) are NEVER the primaryCTA when any form, phone, or booking CTA exists.

⚠️ CRITICAL: Generate ORIGINAL content from ACTUAL website data. Do NOT echo, copy, or reference any example text. If you cannot generate content from the actual site, return an empty string "" — NEVER return example text or template placeholders.

Return ONLY this JSON. Nothing else. No markdown. No preamble.

{
  "conversionEventAnalysis": {
    "primaryCTA": "The HIGHEST COMMERCIAL INTENT conversion action — use VERBATIM button/link text from the site, never paraphrase. Rank by commercial intent: form/call/booking > quote > download > explore/other. A 'Contact Us' form ALWAYS outranks a 'Discover more' button.",
    "ctaType": "book_call|fill_form|call|buy_online|get_quote|download|other — use 'call' for any phone number or call-oriented CTA",
    "ctaClarity": "Is it obvious what to do next? Single CTA or multiple competing?",
    "frictionPoints": ["Specific things that could reduce conversions — frame each as an opportunity for our agents"],
    "conversionStrength": "strong|moderate|weak — brief reason",
    "bellaLine": "One sentence Bella can say about the conversion setup — e.g. 'I noticed your main CTA is a booking form — we can train your AI agents to guide people through that step by step'",
    "allConversionEvents": ["List EVERY conversion action on the site — use their exact CTA wording. Include ALL of them."],
    "ctaBreakdown": [
      {
        "cta": "VERBATIM button/link text exactly as it appears on the site — never rename or paraphrase. If button says 'Get in touch' write 'Get in touch', NOT 'Contact Us'.",
        "type": "form|call|booking|download|chat|buy|other",
        "commercialMeaning": "What this CTA means commercially in their industry — e.g. 'Their primary new client acquisition channel' or 'High-intent prospects wanting to talk NOW' or 'Pipeline builder — these leads need fast follow-up'",
        "industryTerm": "How to describe this in their language — e.g. 'new patient bookings', 'quote requests', 'initial consultations'",
        "agent": "Which agent handles this: Chris (website engagement), Alex (form follow-up), Maddie (phone/call), Sarah (reactivation), James (reviews)",
        "reason": "Brief explanation — e.g. 'Contact form submissions need fast follow-up → Alex'"
      }
    ],
    "secondaryCTAs": [
      {
        "channel": "booking|phone|form|quote|purchase|download|chat|other",
        "label": "Exact button text or CTA label from the page",
        "assetTitle": "Name of asset if applicable — empty string if none",
        "location": "hero|nav|footer|body|popup|unknown"
      }
    ],
    "conversionNarrative": "REQUIRED — MUST NOT be null. 2-3 sentence spoken summary of the full conversion funnel in the prospect's industry language. Bella says this verbatim. Reference specific CTAs found on THEIR site, not generic examples. Generate ORIGINAL content — do NOT copy example text.",
    "agentTrainingLine": "REQUIRED — MUST NOT be null. Single sentence connecting ALL CTAs found to agent training. Reference the actual CTAs from THEIR site. Generate ORIGINAL content — do NOT copy example text.",
    "ctaAgentMapping": "REQUIRED — MUST NOT be null. Single sentence mapping THEIR actual CTAs to specific agents based on conversion events found. Only include agents that map to actual CTAs found. Generate ORIGINAL content — do NOT copy example text."
  },
  "routing": {
    "priority_agents": ["DEFAULT: ALL 3 core agents — Alex, Chris, Maddie — MUST be in this array. Alex always first. Add Sarah/James after if evidence supports. Only omit a core agent if you have STRONG POSITIVE evidence they are already covered (e.g. confirmed 24/7 AI chat = omit Chris). For each agent, find a data-backed reason from the site (CTAs, phone number, ad pixels, hiring signals, form submissions). If no strong signal, use CTA-based fallback justification."],
    "lower_priority_agents": ["Enhancement agents — Sarah (reactivation) and James (reviews) — only if evidence supports"],
    "skip_agents": ["Only agents with STRONG POSITIVE evidence they are ALREADY COVERED — e.g. 'confirmed 24/7 AI chat deployed' for Chris. Absence of data is NEVER a reason to skip."],
    "reasoning": {
      "alex": "REQUIRED. Reference SPECIFIC conversion events from the site that need fast follow-up — e.g. 'Your Contact Us form and Download Guide CTA both generate leads that need immediate response — Alex follows up in under 30 seconds.' Use verbatim CTA text. If ads detected, reference those too.",
      "chris": "REQUIRED. Reference SPECIFIC website funnel elements — e.g. 'Your site has a Book Appointment form, a Get a Quote page, and a downloadable price guide — Chris engages every visitor and guides them toward those actions.' Use verbatim CTA/page names from the site.",
      "maddie": "REQUIRED. Reference phone signals — e.g. 'Your site shows a phone number in the header and footer and you have a Call Now button — Maddie answers every call instantly, qualifies, and books.' If no phone visible, say 'Phone not prominent but service businesses get calls — Maddie catches every one.'",
      "sarah": "Honest assessment — is there real database opportunity or are we assuming?",
      "james": "Honest assessment — is review management a real wedge for this business?"
    },
    "questions_to_prioritise": ["2-3 targeted confirmation questions Bella should ask"],
    "questions_to_brush_over": ["Topics to mention briefly — usually Sarah and James"]
  },
  "secondaryRecommendations": [
    {
      "agent": "The number 2 agent",
      "whySecond": "One sentence: why this agent complements the lead, and why it is number 2 not number 1"
    },
    {
      "agent": "The number 3 agent",
      "whyNotFirst": "One sentence: why this is valuable but less urgent"
    }
  ]
}

FINAL CHECK — Before returning, scan every string value in your response for "they" or "their" referring to the business or owner. Replace with "you" or "your". This is non-negotiable.`;
}

function buildPromptCopy(p) {
  return `You are Bella's Copy and Identity Analyst at Pillar and Post AI.
Your job is to extract the business identity, analyse the website copy quality, and fill the script fields Bella needs to sound like she spent 3 hours researching this business.

CRITICAL RULES:
⚠️ VOICE PERSPECTIVE — HARD RULE — CHECK EVERY FIELD BEFORE RETURNING:
You are writing words that Bella speaks DIRECTLY TO the business owner on a live phone call. The owner is listening. Every field must sound like Bella is talking TO them, not describing them to someone else.
- "you" and "your" = the business and its owner. Always.
- "they" and "their" = the prospect's CUSTOMERS only. Never the business.
WRONG: "They offer accounting services" → RIGHT: "You offer accounting services"
WRONG: "Their main CTA is a booking form" → RIGHT: "Your main CTA is a booking form"
CORRECT: "The problems they bring to you" (they = customers, correct)
If you write "they" or "their" referring to the business, you have broken the call. The owner will hear Bella describe them in third person and lose trust immediately.

- Cross-reference ALL name signals (og:site_name, JSON-LD, pageTitle, domain, body copy) to confirm the real business name. PAGE CONTENT is the authority — domains are ambiguous
- Use the business's own language from their copy — their words, their phrases
- All spoken lines under 20 words per sentence
- Australian English throughout
- NEVER output placeholder text like "Business Name Pending" — if unsure, clean up the domain name
- website_positive_comment must be a STRATEGIC INSIGHT not a compliment — something that makes the owner think "they actually get us"

ANALYSIS FRAMEWORK — HOW TO READ THE COPY:

COPY QUALITY (for copyAnalysis):
Read what their website copy actually says. Identify the key messaging, value propositions, and brand voice. Quote specific phrases that are strong and reveal how the business thinks about their market and competitive position.

SURFACED BENEFITS (for valuePropAnalysis):
Look for the actual outcomes and transformations they promise — not services, results. Look for phrases like "so you can", "without", "results", "guaranteed", "faster", "more", "less". Extract their stated value propositions as outcomes not service names.

BUSINESS IDENTITY (for businessIdentity):
Domain names are ambiguous. "andersen.com" could be Andersen Consulting or Andersen Windows. Never guess based on brand familiarity or domain alone. The page content is always the authority. Read the services described, the about section, headings, and footer. Cross-reference og:site_name, JSON-LD org name, footer copyright, and the actual body copy. When in doubt, the body copy wins.

WEBSITE POSITIVE COMMENT (for scriptFills.website_positive_comment):
This must be a STRATEGIC INSIGHT, not a compliment. Not "your tagline really captures what you do" — that is garbage. An insight that makes the owner think "they actually get our business". Reference a specific positioning decision, market strategy choice, or something from the copy that reveals how they think about winning business.

PROSPECT DATA:
${JSON.stringify(p, null, 2)}

Read websiteContent carefully. Focus on: messaging quality, specific copy lines, stated benefits, brand voice, and how the business describes itself.

Return ONLY this JSON. Nothing else. No markdown. No preamble.

{
  "businessIdentity": {
    "correctedName": "The REAL business name — natural, conversational. Cross-reference page copy, og:site_name, JSON-LD, footer copyright, domain. Strip Pty Ltd, city names. e.g. 'Pitcher Partners' not 'Pitcher Partners Sydney Pty Ltd'.",
    "spokenName": "REQUIRED. Short name a person would naturally say in conversation — what Bella says on the call. Strip city/country/legal suffixes. Max 2-3 words. e.g. 'Penguin Random House Australia' → 'Penguin', 'KPMG' → 'KPMG', 'Commonwealth Bank of Australia' → 'CommBank'.",
    "industry": "The CORRECT industry based on what the business actually does — read their services, about page, copy. Be specific. e.g. 'accounting and advisory', 'plumbing', 'dental', 'legal'.",
    "businessModel": "B2B or B2C or Both — based on who their customers are from the copy",
    "serviceArea": "Where they operate — national, state-wide, or local. Infer from copy, office locations, service mentions."
  },
  "scriptFills": {
    "website_positive_comment": "A specific STRATEGIC observation about their positioning, copy, or approach that shows genuine understanding. NOT a generic compliment. An INSIGHT that would make the owner think 'they actually understand our business'. Reference specific copy, positioning decisions, or market strategy from the content.",
    "hero_header_quote": "Their actual H1/hero headline verbatim from the content — or null if not found",
    "reference_offer": "Their primary service or offer as named on the site",
    "icp_guess": "Who their ideal customer appears to be — use their language. Frame as something Bella can CHECK: 'it looks like you mainly work with X, is that right?'",
    "campaign_summary": "What ads they are running — or null if no ad data available",
    "rep_commentary": "Qualitative assessment of their Google reputation if data available — warm, specific, cite numbers. null if no Google data in payload.",
    "recent_review_snippet": "Best customer quote from their reviews verbatim — or null if no reviews in payload",
    "rep_quality_assessment": "Brief assessment of review quality if data exists — themes, sentiment. null if no review data in payload.",
    "top_2_website_ctas": "Their top 2 CTAs from the website in natural language",
    "scrapedDataSummary": "Single spoken observation max 25 words. SPECIFIC data point from Google reviews, ads, or hiring signals in the payload. NOT a website compliment. Actual data only. MUST END with which agent (Alex/Chris/Maddie) would address this and HOW. E.g., 'you're running Google Ads — Chris can engage every visitor landing from those campaigns'. null if no scraped data available.",
    "bella_opener": "A natural spoken opening line Bella can say that references something specific from the research — e.g. 'Hi [name], so we have had a proper look at [business] before this call and I have to say there are some really interesting things happening there.'"
  },
  "copyAnalysis": {
    "messagingStrength": "What the copy does well — cite specific phrases or sections",
    "strongestLine": "The single most compelling line on the entire site — verbatim quote",
    "toneAndVoice": "Brand voice description — e.g. professional, warm, authoritative, clinical, casual",
    "bellaLine": "Single sentence Bella can say that compliments the copy specifically — must reference something precise from the copy, not a generic observation"
  },
  "valuePropAnalysis": {
    "statedBenefits": ["List of specific outcome/benefit claims from the copy — not service names, real outcomes"],
    "strongestBenefit": "The most compelling specific benefit claim on the site",
    "missingBenefits": "What outcomes do they deliver that they do NOT clearly claim on the site?",
    "bellaLine": "One sentence Bella can say referencing a specific benefit from the copy"
  },
  "websiteCompliments": [
    { "what": "Something genuinely specific and impressive from the COPY", "evidence": "Verbatim quote or specific data point", "bellaLine": "Natural sentence Bella can say" },
    { "what": "A second different impressive thing — different category from first", "evidence": "Specific evidence", "bellaLine": "Natural sentence" }
  ]
}

FINAL CHECK — Before returning, scan every string value in your response for "they" or "their" referring to the business or owner. Replace with "you" or "your". This is non-negotiable.`;
}

function buildPromptResearch(p) {
  return `You are Bella's Research and Opportunity Analyst at Pillar and Post AI.
Your job is to find every commercial opportunity hidden in the scraped data — hiring signals, Google presence, conversation hooks, and the biggest impression-making findings.

CRITICAL RULES:
⚠️ VOICE PERSPECTIVE — HARD RULE — CHECK EVERY FIELD BEFORE RETURNING:
You are writing words that Bella speaks DIRECTLY TO the business owner on a live phone call. The owner is listening. Every field must sound like Bella is talking TO them, not describing them to someone else.
- "you" and "your" = the business and its owner. Always.
- "they" and "their" = the prospect's CUSTOMERS only. Never the business.
WRONG: "They offer accounting services" → RIGHT: "You offer accounting services"
WRONG: "Their main CTA is a booking form" → RIGHT: "Your main CTA is a booking form"
CORRECT: "The problems they bring to you" (they = customers, correct)
If you write "they" or "their" referring to the business, you have broken the call. The owner will hear Bella describe them in third person and lose trust immediately.

- HIRING IS YOUR MOST POWERFUL WEDGE: Every open role is money they are about to spend that our agents can replace or augment. If hiring data exists, lead with it
- Frame ALL gaps as OPPORTUNITIES not criticisms — "No chat widget = every visitor leaves without a conversation. Strong Chris opportunity"
- Australian English throughout
- All spoken lines under 20 words per sentence
- If no hiring data in payload, return matchedRoles as empty array and topHiringWedge as null
- If no Google data in payload, say "Google data not yet available — Bella should ask about their online reputation"

ANALYSIS FRAMEWORK — HIRING AND OPPORTUNITIES:

HIRING (highest priority if data exists):
Every open role is money they are about to spend that our agents replace. This is your most powerful commercial wedge when hiring data is present.

Role to agent mapping with exact spoken wedge framing:
- Receptionist, Admin, Front Desk → Maddie.
  Wedge: "You are hiring a receptionist — Maddie covers you today for a fraction of the cost. No super, no sick leave, no ramp time."
- SDR, BDR, Sales Development Rep → Alex.
  Wedge: "You are hiring an SDR — Alex follows up every lead in under sixty seconds, twenty-four seven."
- Customer Service, Support → Chris and Maddie.
  Wedge: "Hiring support staff? Chris and Maddie handle every enquiry instantly with zero hold time."
- Marketing, Digital Marketing → Chris and Alex.
  Wedge: "Hiring marketing people tells me you are investing in traffic — Chris and Alex make sure every click converts."
- Sales, Closer, Account Executive → Alex and Sarah.
  Wedge: "Hiring salespeople means follow-up matters — Alex and Sarah do it at scale."
- Office Manager, Operations → Maddie.
  Wedge: "Hiring an office manager? Maddie handles calls and admin twenty-four seven."

Always frame the ROI against the hiring cost. Say salaries as words not numbers — "sixty thousand" not "$60,000". Lead with the role cost, then show how the agent delivers the same outcome starting today.

MISSING DATA RULES:
- google.rating is null → do NOT say "no reviews" or "zero reviews". Say "Google data not yet loaded — Bella should ask about their online reputation. James opportunity to explore."
- facebookAds or googleAds null or false → do NOT say "not running ads". Say "No ad pixels found on-site — Bella should ask about their lead sources and any paid campaigns. Potential Alex opportunity."
- No phone number visible → do NOT say "no phone channel". Say "Phone not prominent on site — Bella should ask about inbound call volume. Potential Maddie opportunity."
- No CRM detected → do not mention this at all. We are selling AI agents, not auditing their tech stack.
- The ONLY time you mark an agent as not relevant is when you have STRONG POSITIVE EVIDENCE they are already covered — for example, confirmed twenty-four-seven AI chat already deployed means Chris is less urgent. Never assume an agent is irrelevant from absence of data alone.

PROSPECT DATA:
${JSON.stringify(p, null, 2)}

Return ONLY this JSON. Nothing else. No markdown. No preamble.

{
  "hiringAnalysis": {
    "matchedRoles": [
      {
        "jobTitle": "Exact job title from the payload",
        "ourAgent": "Which agent replaces this role",
        "salary": "Salary if available from payload — or null",
        "wedge": "One-sentence replacement pitch for Bella to say on the call. Say salary as words.",
        "urgency": "high|medium"
      }
    ],
    "topHiringWedge": "The single most powerful hiring replacement line for Bella — e.g. 'You are hiring a receptionist for sixty K — Maddie does the same job starting today for pennies.' MUST include: (1) the job title they're hiring for, (2) which agent (Maddie/Alex) replaces that role, (3) how. null if no hiring data."
  },
  "googlePresence": [
    {
      "insight": "Their rating/review standing if data available. If no Google data: 'Google data not yet available — Bella should ask about their online reputation'",
      "data": "Exact numbers if available, otherwise 'pending'",
      "bellaLine": "How Bella references this naturally on the call. Include agent tieback: how Chris can use reviews to build trust with website visitors, or how reputation uplift helps. E.g., 'Your 4.8 rating is a strong foundation — Chris can reference those reviews in real-time conversations to build trust.'"
    },
    {
      "insight": "What their reviews reveal — theme, sentiment. If no reviews: 'Review data pending — discovery opportunity'",
      "bestQuote": "Direct quote from best review, or null",
      "bellaLine": "How Bella references review sentiment or asks about it. Include agent tieback if reviews are strong. E.g., 'Your reviews consistently mention {theme} — Chris can amplify that in conversations with new visitors.'"
    }
  ],
  "conversationHooks": [
    { "topic": "A specific copy or ICP insight Bella can raise naturally", "data": "Evidence from the site", "how": "How to bring it up in conversation. MUST include which agent (Alex/Chris/Maddie) addresses this and HOW. E.g., 'they say they focus on fast turnarounds — Alex can respond to every lead in under 30 seconds.'" },
    { "topic": "A benefit or value prop observation", "data": "Evidence", "how": "Conversation approach. MUST include agent tieback showing which agent delivers this benefit." },
    { "topic": "The conversion event observation", "data": "Evidence", "how": "Natural approach. MUST include which agent (Chris for on-site, Alex for follow-up, Maddie for calls) would drive more conversions." }
  ],
  "mostImpressive": [
    { "finding": "The single most notable thing from ALL the data", "source": "Where you found it", "bellaLine": "How Bella references it naturally. MUST include which agent (Alex/Chris/Maddie) would leverage this insight and HOW. E.g., 'your landing page is high-traffic — Chris can engage every visitor landing there.'" },
    { "finding": "Second most impressive — different category", "source": "Data source", "bellaLine": "Natural reference. MUST include agent tieback showing which agent addresses this opportunity." }
  ],
  "redFlags": [
    "Frame as OPPORTUNITY tied to a specific agent — e.g. 'No chat widget on site — every visitor currently leaves without a conversation. Strong Chris opportunity.'",
    "Second opportunity — different category, different agent."
  ],
  "landingPageVerdict": {
    "heroEffectiveness": "Is their H1/hero compelling? Quote it, assess honestly",
    "ctaClarity": "Are the CTAs clear? Single clear next step or confusion?",
    "conversionOpportunities": ["Specific friction points and conversion events — frame each as an agent opportunity (e.g. 'Live chat widget opportunity — Chris can engage there')"],
    "trustSignals": "What builds credibility? What trust signals reinforce their market position?",
    "verdictLine": "One punchy sentence summarising landing page quality — lead with what is working"
  }
}

FINAL CHECK — Before returning, scan every string value in your response for "they" or "their" referring to the business or owner. Replace with "you" or "your". This is non-negotiable.`;
}

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

  const t0 = Date.now();
  const p = payload;

  // Fire all 4 micro-calls in parallel — each owns an exclusive schema slice
  // No key overlap = no overwrite. Non-fatal individually.
  const [rICP, rConversion, rCopy, rResearch] = await Promise.all([
    callMicro('icp', buildPromptICP(p), apiKey),
    callMicro('conversion', buildPromptConversion(p), apiKey),
    callMicro('copy', buildPromptCopy(p), apiKey),
    callMicro('research', buildPromptResearch(p), apiKey),
  ]);

  const elapsed = Date.now() - t0;

  // Merge — flat spread, zero key collision by design
  const result = {
    ...rCopy,        // businessIdentity, scriptFills, copyAnalysis, valuePropAnalysis, websiteCompliments
    ...rICP,         // positioning, icpAnalysis, trainingBridge
    ...rConversion,  // conversionEventAnalysis, routing, secondaryRecommendations
    ...rResearch,    // hiringAnalysis, googlePresence, conversationHooks, mostImpressive, redFlags, landingPageVerdict
  };

  // Check if all slices failed (total fallback)
  const allFailed = !rICP.icpAnalysis && !rConversion.conversionEventAnalysis
    && !rCopy.businessIdentity && !rResearch.hiringAnalysis;

  if (allFailed) {
    console.error(`[Consultant] ALL micro-calls failed in ${elapsed}ms — returning fallback`);
    return { error: "All micro-calls failed", ...buildFallback(p) };
  }

  // Log which slices succeeded
  const sliceStatus = [
    `icp=${!!rICP.icpAnalysis}`,
    `conversion=${!!rConversion.conversionEventAnalysis}`,
    `copy=${!!rCopy.businessIdentity}`,
    `research=${!!rResearch.hiringAnalysis}`,
  ].join(' ');

  console.log(`[Consultant] micro-calls complete elapsed=${elapsed}ms ${sliceStatus}`);
  return result;
}


// ── PASS 2 — Deep data enrichment after scrape completes ────────────────────
// Called by scrape workflow after deep data lands. Takes pass1 consultant output
// + deep flags (Google Maps, ads, hiring, LinkedIn) and generates enriched
// narratives for WOW6+ and Recommendation stages.

async function runPass2Consultant(payload, env) {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) return { error: "No GEMINI_API_KEY", _pass2: true, _fallback: true };

  const t0 = Date.now();
  const prompt = buildPromptPass2(payload);

  const result = await callMicro('pass2', prompt, apiKey);
  const elapsed = Date.now() - t0;

  if (!result || !result.deepInsights) {
    console.error(`[Consultant /pass2] failed in ${elapsed}ms — returning pass2 fallback`);
    return { _pass2: true, _fallback: true, deepInsights: [], enrichedRouting: payload.pass1?.routing ?? {} };
  }

  result._pass2 = true;
  result._latency = elapsed;
  console.log(`[Consultant /pass2] done in ${elapsed}ms insights=${result.deepInsights?.length ?? 0}`);
  return result;
}

function buildPromptPass2(payload) {
  const { businessName, pass1, deepFlags } = payload;

  return `You are Bella's Deep Intelligence Analyst at Pillar and Post AI.
You have ALREADY analysed this business's website (pass 1). Now you have DEEP INTELLIGENCE data — Google Maps reviews, ad campaigns, hiring signals, and LinkedIn data. Your job is to produce enriched spoken narratives that Bella uses in the second half of the call (WOW6 onwards and Recommendation).

CRITICAL RULES:
⚠️ VOICE PERSPECTIVE — HARD RULE:
You are writing words that Bella speaks DIRECTLY TO the business owner. "you" and "your" = the business. "they" and "their" = the prospect's CUSTOMERS only.

- Every spoken line must be under 20 words per sentence
- Australian English throughout
- Reference SPECIFIC data points (exact review quotes, ad counts, hiring titles, ratings)
- NEVER say "from the scrape" or "we scraped" — say "we picked up" or "we noticed" or "looking at your digital footprint"
- Every insight MUST end with an agent tieback: which agent (Alex/Chris/Maddie) addresses this and HOW

AGENT ROLES:
- Chris: AI website agent — engages visitors live, converts on-page
- Alex: Speed-to-lead — follows up every lead in under 30 seconds, 24/7
- Maddie: AI receptionist — answers every call, qualifies, books appointments

HIRING SIGNAL MAPPING — CRITICAL:
Hiring signals justify recommending MAXIMUM agents (up to 3), not narrowing to one:
- Hiring receptionist/admin/front desk → Maddie (replaces this role)
- Hiring sales people/closers → Alex (speed-to-lead replaces outbound)
- Hiring SDRs/appointment setters → Chris + Alex (Chris engages on-site, Alex follows up)
- Hiring customer service/support → Chris (website concierge handles enquiries)
- Hiring marketing/digital → Chris + Alex (traffic needs conversion)
- ANY hiring = business is growing = MORE agents needed. Frame as: "you're scaling — Alex handles the speed-to-lead, Chris converts on your site, and Maddie covers every call so nothing slips through"

PASS 1 CONSULTANT OUTPUT (what we already told them about their website):
${JSON.stringify(pass1, null, 2)}

DEEP INTELLIGENCE DATA (Google Maps, ads, hiring, LinkedIn):
${JSON.stringify(deepFlags, null, 2)}

Generate enriched narratives using the deep data. Every field must be data-specific — reference exact numbers, quotes, titles.

⚠️ CRITICAL: Generate ORIGINAL content from the ACTUAL deep data provided above. Do NOT echo example text.

Return ONLY this JSON. Nothing else. No markdown. No preamble.

{
  "deepInsights": [
    {
      "bellaLine": "REQUIRED. A spoken insight from the deep data that Bella says on the call. Must reference a SPECIFIC data point (rating, review quote, ad count, hiring role). Must end with which agent addresses it and how. Max 2 sentences. E.g., 'your 4.8 star rating from 230 reviews is a real asset — Chris can reference those in real-time conversations to build instant trust with new visitors.'",
      "source": "google_maps|ads|hiring|linkedin",
      "dataPoint": "The specific data referenced — e.g., '4.8 stars, 230 reviews' or 'hiring 2 SDRs' or 'running 12 Google Ads'"
    },
    {
      "bellaLine": "Second insight — DIFFERENT category from first. Must reference different deep data source.",
      "source": "google_maps|ads|hiring|linkedin",
      "dataPoint": "Specific data"
    },
    {
      "bellaLine": "Third insight if data supports it — different category again. null if insufficient data.",
      "source": "google_maps|ads|hiring|linkedin|null",
      "dataPoint": "Specific data or null"
    }
  ],
  "enrichedGooglePresence": [
    {
      "insight": "What their Google rating and reviews reveal — specific numbers",
      "data": "Exact rating, review count, key themes",
      "bellaLine": "How Bella references this with agent tieback. E.g., 'Your 4.8 from 230 reviews is strong — Chris can highlight that social proof to every website visitor in real time.'"
    }
  ],
  "enrichedHiringAnalysis": {
    "matchedRoles": [
      {
        "jobTitle": "Exact title from deep data",
        "ourAgents": ["Array of ALL agents this maps to — not just one"],
        "wedge": "Spoken replacement pitch. Frame as scaling opportunity, not cost-cutting. Say salary as words if available.",
        "urgency": "high|medium"
      }
    ],
    "topHiringWedge": "The single most powerful hiring line. Must reference the specific role AND map to multiple agents where applicable. E.g., 'you're hiring two SDRs — Chris engages every website visitor on arrival and Alex follows up in under thirty seconds. That's your SDR function covered twenty-four seven.' null if no hiring data.",
    "scalingNarrative": "1-2 sentences about how hiring signals show the business is growing and agents scale with them. Must mention specific roles."
  },
  "enrichedRouting": {
    "priority_agents": ["Updated agent ranking incorporating deep signals — ads confirmed bumps Chris+Alex, hiring signals add relevant agents, review strength adds James consideration"],
    "reasoning": {
      "chris": "Updated reasoning with deep data evidence",
      "alex": "Updated reasoning with deep data evidence",
      "maddie": "Updated reasoning with deep data evidence"
    },
    "deepJustification": "1-2 sentences: what the deep data changed about the routing and why. Reference specific signals."
  },
  "enrichedConversationHooks": [
    {
      "topic": "A deep-data insight Bella can raise naturally",
      "data": "Specific evidence from deep data",
      "how": "How to bring it up — MUST include which agent addresses it. E.g., 'your reviews mention fast turnaround — Alex locks that in by responding to every lead instantly.'"
    }
  ],
  "enrichedMostImpressive": [
    {
      "finding": "The single most notable finding from ALL deep data",
      "source": "google_maps|ads|hiring|linkedin",
      "bellaLine": "How Bella says it — with agent tieback"
    }
  ],
  "adInsights": {
    "isRunningAds": true,
    "adSummary": "Specific: platform, count, type. E.g., '12 active Google Ads campaigns focused on commercial plumbing'",
    "bellaLine": "How Bella references ads with agent tieback. E.g., 'you're running 12 Google Ads — Chris engages every click the moment they land, and Alex follows up anyone who bounces without converting.'"
  }
}

FINAL CHECK — scan every string for "they"/"their" referring to the business. Replace with "you"/"your".`;
}


