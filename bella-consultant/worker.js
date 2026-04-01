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
- Use the business's own language from their website copy
- Australian English throughout
- All outputs are spoken DIRECTLY TO the prospect on a live voice call — use "you/your" for the business, "they/their" only for the prospect's customers
- Keep all spoken lines under 20 words per sentence
- icpProblems and icpSolutions MUST be specific to THIS site's copy — NOT generic industry filler
- BAD: "Feeling overwhelmed by tax complexities" — generic
- GOOD: "Business owners who need proactive tax planning not just year-end compliance" — specific to their copy
- marketPositionNarrative and icpNarrative MUST NOT be null or empty

PROSPECT DATA:
${JSON.stringify(p, null, 2)}

Read websiteContent carefully. Focus on: who they target, problems they reference, outcomes they promise, how they differentiate from competitors.

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
    "marketPositionNarrative": "REQUIRED — MUST NOT be null. 1-2 sentence spoken summary of how this business positions itself — their differentiator, what makes them different from competitors. Use THEIR language. Bella says this verbatim. Example: 'You have positioned Pitcher Partners as the advisory firm that goes beyond compliance — speaking to business owners who have outgrown their bookkeeper and need strategic-level support to scale.'",
    "icpNarrative": "REQUIRED — MUST NOT be null. 2-3 sentence spoken summary weaving together: who they target + their 2 key client problems + how they solve them. End with a confirmation question. Bella says this verbatim at a critical moment in the call. Use the prospect's industry language. Example: 'It looks like you mainly work with growing businesses that have outgrown their bookkeeper and need proper advisory support, and business owners spending too much time on compliance when they should be focused on growth. You solve that through partner-led advisory and proactive tax planning. Does that sound about right?'"
  },
  "trainingBridge": {
    "line": "REQUIRED — MUST NOT be null. 1-2 sentences explicitly tying together: who they serve + the problems they bring + how they solve them + the exact CTAs on their site — framed as what the AI agents are being trained on. Bella says this verbatim. Must be spoken-friendly, under 20 words per sentence. Example: 'Everything I have just described — who you serve, the problems they bring, how you solve them, and the specific calls to action — is what your demo agent team has already been trained on in the background.'"
  }
}`;
}

function buildPromptConversion(p) {
  return `You are Bella's Conversion Intelligence Analyst at Pillar and Post AI.
Your ONLY job is to identify every single conversion event on this website and understand exactly what each one means commercially — then map each to the AI agent that handles it.

This data is CRITICAL. Bella uses it to say: "I can see your main call to action is X, and you're also driving Y and Z — those are exactly the conversion events your agents are trained on." Every CTA must be found. Every agent mapping must be precise.

CRITICAL RULES:
- Find EVERY conversion event — not just the primary CTA. Every button, form, phone number, download, booking link
- MADDIE RULE: If ANY phone number exists on the site (even in the footer or contact page), it MUST appear in ctaBreakdown as type "call" with agent "Maddie". For service businesses (trades, medical, legal, accounting, real estate, agencies), phone is almost always a primary channel
- Use "you/your" for the business, "they/their" only for the prospect's customers
- conversionNarrative, agentTrainingLine, and ctaAgentMapping MUST NOT be null
- Australian English throughout
- All spoken lines under 20 words per sentence

AGENT ROLES:
- Chris: AI agent on website/landing pages — engages visitors live on arrival, converts them on the page
- Alex: Speed-to-lead follow-up — form fills, bounced visitors, enquiries followed up in under 60 seconds
- Maddie: AI receptionist — answers every inbound call, after-hours, overflow. Every missed call is lost revenue
- Sarah: Database reactivation — wakes up dormant leads
- James: Reputation/reviews — automated review collection

WHEN ADS ARE RUNNING: clicks land on the site → Chris engages them live → Alex follows up those Chris doesn't close. They are a pair.
PHONE NUMBER ON SITE: Maddie is relevant. Service businesses (trades, medical, legal, accounting) rely on phone. Do NOT omit.

PROSPECT DATA:
${JSON.stringify(p, null, 2)}

Read websiteContent carefully. Find every CTA, button, form, phone number, download, booking link.

Return ONLY this JSON. Nothing else. No markdown. No preamble.

{
  "conversionEventAnalysis": {
    "primaryCTA": "The main conversion action the site drives — exact CTA text if visible",
    "ctaType": "book_call|fill_form|call|buy_online|get_quote|download|other — use 'call' for any phone number or call-oriented CTA",
    "ctaClarity": "Is it obvious what to do next? Single CTA or multiple competing?",
    "frictionPoints": ["Specific things that could reduce conversions — frame each as an opportunity for our agents"],
    "conversionStrength": "strong|moderate|weak — brief reason",
    "bellaLine": "One sentence Bella can say about the conversion setup — e.g. 'I noticed your main CTA is a booking form — we can train your AI agents to guide people through that step by step'",
    "allConversionEvents": ["List EVERY conversion action on the site — use their exact CTA wording. Include ALL of them."],
    "ctaBreakdown": [
      {
        "cta": "Exact CTA text from the site",
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
    "conversionNarrative": "REQUIRED — MUST NOT be null. 2-3 sentence spoken summary of the full conversion funnel in the prospect's industry language. Bella says this verbatim. Example for accounting: 'Your site is driving people to book a free initial consultation — that is your primary new client acquisition channel. You have also got a tax planning guide download which builds your pipeline, and a phone number for prospects who want to talk now. Those are exactly the kind of conversion events your AI agents have been trained to focus on.' Example for trades: 'Your site is set up to drive quote requests — that is the start of every new job. You have also got a phone number for urgent callouts. Your agents have been trained to convert more of both, on autopilot.'",
    "agentTrainingLine": "REQUIRED — MUST NOT be null. Single sentence connecting ALL CTAs to agent training. Format: 'I can see your main call to action is [PRIMARY CTA], and you are also driving [SECONDARY, TERTIARY] — those are exactly the kind of conversion events your AI agents have been trained to focus on driving more of, on autopilot.' MUST mention ALL events found.",
    "ctaAgentMapping": "REQUIRED — MUST NOT be null. Single sentence mapping CTAs to specific agents. e.g. 'I would say Chris to maximise those booking conversions on your site, Alex to follow up the form submissions, and Maddie to handle the inbound calls.' Only include agents that map to actual CTAs found."
  },
  "routing": {
    "priority_agents": ["Rank by URGENCY and ACTIVE REVENUE LEAK. Core agents (Chris, Alex, Maddie) should almost always be top 3. Ordered array of agent names."],
    "lower_priority_agents": ["Enhancement agents or weak evidence agents"],
    "skip_agents": ["Only agents with STRONG POSITIVE evidence they are irrelevant"],
    "reasoning": {
      "chris": "Commercial assessment — what is the active revenue leak Chris fixes? Evidence. Why now?",
      "alex": "Commercial assessment — what leads are going cold? What is the follow-up gap? Evidence.",
      "maddie": "Commercial assessment — is there a phone number on the site? Is this a service business? Every missed call is lost revenue.",
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
}`;
}

function buildPromptCopy(p) {
  return `You are Bella's Copy and Identity Analyst at Pillar and Post AI.
Your job is to extract the business identity, analyse the website copy quality, and fill the script fields Bella needs to sound like she spent 3 hours researching this business.

CRITICAL RULES:
- Cross-reference ALL name signals (og:site_name, JSON-LD, pageTitle, domain, body copy) to confirm the real business name. PAGE CONTENT is the authority — domains are ambiguous
- Use the business's own language from their copy — their words, their phrases
- All outputs spoken DIRECTLY TO the prospect — use "you/your" for the business, "they/their" only for the prospect's customers
- All spoken lines under 20 words per sentence
- Australian English throughout
- NEVER output placeholder text like "Business Name Pending" — if unsure, clean up the domain name
- website_positive_comment must be a STRATEGIC INSIGHT not a compliment — something that makes the owner think "they actually get us"

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
    "scrapedDataSummary": "Single spoken observation max 25 words. SPECIFIC data point from Google reviews, ads, or hiring signals in the payload. NOT a website compliment. Actual data only. null if no scraped data available.",
    "bella_opener": "A natural spoken opening line Bella can say that references something specific from the research — e.g. 'Hi [name], so we have had a proper look at [business] before this call and I have to say there are some really interesting things happening there.'"
  },
  "copyAnalysis": {
    "messagingStrength": "What the copy does well — cite specific phrases or sections",
    "messagingWeakness": "Where the copy could be stronger — frame as opportunity not criticism",
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
}`;
}

function buildPromptResearch(p) {
  return `You are Bella's Research and Opportunity Analyst at Pillar and Post AI.
Your job is to find every commercial opportunity hidden in the scraped data — hiring signals, Google presence, conversation hooks, and the biggest impression-making findings.

CRITICAL RULES:
- HIRING IS YOUR MOST POWERFUL WEDGE: Every open role is money they are about to spend that our agents can replace or augment. If hiring data exists, lead with it
- Frame ALL gaps as OPPORTUNITIES not criticisms — "No chat widget = every visitor leaves without a conversation. Strong Chris opportunity"
- Use "you/your" for the business, "they/their" only for the prospect's customers
- Australian English throughout
- All spoken lines under 20 words per sentence
- If no hiring data in payload, return matchedRoles as empty array and topHiringWedge as null
- If no Google data in payload, say "Google data not yet available — Bella should ask about their online reputation"

HIRING → AGENT MAPPING:
- Receptionist/Admin/Front Desk → Maddie ("You are hiring a receptionist — Maddie covers you TODAY for a fraction of the cost")
- SDR/BDR/Sales Development → Alex ("You are hiring an SDR — Alex follows up every lead in under 60 seconds, 24/7")
- Customer Service/Support → Chris + Maddie
- Marketing/Digital Marketing → Chris + Alex ("Hiring marketing tells me you are investing in traffic — Chris and Alex make sure it converts")
- Sales/Closer/Account Executive → Alex + Sarah
- Office Manager/Operations → Maddie

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
    "topHiringWedge": "The single most powerful hiring replacement line for Bella — e.g. 'You are hiring a receptionist for sixty K — Maddie does the same job starting today for pennies.' null if no hiring data."
  },
  "googlePresence": [
    {
      "insight": "Their rating/review standing if data available. If no Google data: 'Google data not yet available — Bella should ask about their online reputation'",
      "data": "Exact numbers if available, otherwise 'pending'",
      "bellaLine": "How Bella references this naturally on the call"
    },
    {
      "insight": "What their reviews reveal — theme, sentiment. If no reviews: 'Review data pending — discovery opportunity'",
      "bestQuote": "Direct quote from best review, or null",
      "bellaLine": "How Bella references review sentiment or asks about it"
    }
  ],
  "conversationHooks": [
    { "topic": "A specific copy or ICP insight Bella can raise naturally", "data": "Evidence from the site", "how": "How to bring it up in conversation" },
    { "topic": "A benefit or value prop observation", "data": "Evidence", "how": "Conversation approach" },
    { "topic": "The conversion event observation", "data": "Evidence", "how": "Natural approach" }
  ],
  "mostImpressive": [
    { "finding": "The single most notable thing from ALL the data", "source": "Where you found it", "bellaLine": "How Bella references it naturally" },
    { "finding": "Second most impressive — different category", "source": "Data source", "bellaLine": "Natural reference" }
  ],
  "redFlags": [
    "Frame as OPPORTUNITY tied to a specific agent — e.g. 'No chat widget on site — every visitor currently leaves without a conversation. Strong Chris opportunity.'",
    "Second opportunity — different category, different agent."
  ],
  "landingPageVerdict": {
    "heroEffectiveness": "Is their H1/hero compelling? Quote it, assess honestly",
    "ctaClarity": "Are the CTAs clear? Single clear next step or confusion?",
    "conversionBarriers": ["Specific friction points — frame each as solvable by our agents"],
    "trustSignals": "What builds credibility? What is missing?",
    "verdictLine": "One punchy sentence summarising landing page quality — lead with what is working",
    "verdictLine2": "The biggest opportunity for improvement — framed as what our agents can fix"
  }
}`;
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

