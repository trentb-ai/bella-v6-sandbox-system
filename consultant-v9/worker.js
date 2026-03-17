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
  bellaPlan:    (lid) => `lead:${lid}:bella:plan`,
};
const KV_TTL_INTEL = 86400;

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: CORS });

    try {
      const payload = await request.json();
      if (!payload.businessName) return new Response(JSON.stringify({ error: "Missing businessName" }), { status: 400, headers: CORS });

      const result = await runConsultant(payload, env);

      const lid = payload.lid ?? payload.leadId ?? null;
      if (lid && env.LEADS_KV && result && !result.error && !result._fallback) {
        try {
          const stages = await writeScriptStages(lid, payload, result, env);
          result.stages = stages;
        } catch (e) {
          console.error("[Consultant] script_stages write failed:", e);
        }
      }

      return new Response(JSON.stringify(result), { headers: CORS });
    } catch (e) {
      console.error("[Consultant] Fatal:", e);
      return new Response(JSON.stringify({ error: e.message, fallback: buildFallback(null) }), { status: 500, headers: CORS });
    }
  }
};


// ── V5: Write script_stages to KV for Bella's fetch_script_stage tool ────────
async function writeScriptStages(lid, payload, consultantResult, env) {
  const biz = payload.businessName || "your business";
  const icp = consultantResult?.scriptFills?.icp_guess || "your ideal clients";
  const offer = consultantResult?.scriptFills?.reference_offer || "your services";
  const repLine = consultantResult?.scriptFills?.rep_commentary || "";
  const bestReview = consultantResult?.scriptFills?.recent_review_snippet || "";
  const compliment = consultantResult?.scriptFills?.website_positive_comment || "";
  const hooks = (consultantResult?.conversationHooks || []).map(h => h.how || h.topic).filter(Boolean);
  const priorityAgents = consultantResult?.routing?.priority_agents || [];
  const verdictLine = consultantResult?.landingPageVerdict?.verdictLine || "";

  const stages = [
    {
      id: 1,
      key: "wow",
      agent: "Bella",
      active: true,
      script: `WOW — HOOK IN 30 SECONDS\n\nSAY: "${biz} audit complete."\n\nCompliment: "${compliment}"\n\nObservation: "${verdictLine}"\n\nAsk: "Before I walk you through the numbers, who typically handles your marketing over there?"`
    },
    {
      id: 2,
      key: "demo_value_bridge",
      agent: "Bella",
      active: true,
      script: `VALUE BRIDGE\n\nSAY: "The reason I'm calling is we've benchmarked ${biz} against our AI performance standards. I've got some ROI projections I want to show you."\n\nAsk: "Takes about 90 seconds. Sound fair?"`
    },
    {
      id: 3,
      key: "anchor_acv",
      agent: "Bella",
      active: true,
      capture: "average_customer_value",
      script: `ANCHOR — ACV\n\nAsk: "What's a typical ${icp} worth to ${biz} on average? Just a ballpark."`
    },
    {
      id: 4,
      key: "anchor_volume",
      agent: "Bella",
      active: true,
      capture: "leads_per_week",
      script: `ANCHOR — Volume\n\nAsk: "Roughly how many enquiries are you seeing per week?"`
    }
  ];

  await env.LEADS_KV.put(
    `lead:${lid}:script_stages`,
    JSON.stringify({ stages }), // V8 Bridge expects { stages: [] }
    { expirationTtl: 86400 }
  );
  console.log(JSON.stringify({ event: "script_stages_written", lid, count: stages.length }));
  return stages;

  await env.LEADS_KV.put(
    `lead:${lid}:script_stages`,
    JSON.stringify(stages),
    { expirationTtl: 86400 } // 24h TTL — refreshed each pipeline run
  );
  console.log(JSON.stringify({ event: "script_stages_written", lid, stages: Object.keys(stages) }));
}

// ── Fallback: if Gemini fails, produce deterministic fills from raw data ──
function buildFallback(p) {
  if (!p) return {};
  return {
    scriptFills: {
      website_positive_comment: p.branding?.tagline ? `Your tagline "${p.branding.tagline}" really captures what you do` : "Your site presents really well",
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
const MODELS = [
  {
    name:     "gemini-2.0-flash-exp",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent",
    temp:     0.7,
    maxTokens: 4000,
  },
  {
    name:     "gemini-1.5-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    temp:     0.6,
    maxTokens: 4000,
  },
];

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
      const resp = await fetch(
        `${model.endpoint}?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: model.temp, maxOutputTokens: model.maxTokens }
          })
        }
      );

      if (resp.status === 503 && attempt < 1) {
        console.log(`[Consultant] ${model.name} 503, retry ${attempt + 1}`);
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      // 429 rate limit or 404 model not found — skip to fallback model immediately
      if (resp.status === 429 || resp.status === 404) {
        console.log(`[Consultant] ${model.name} HTTP ${resp.status} — skipping model`);
        return null;
      }

      if (!resp.ok) {
        console.error(`[Consultant] ${model.name} HTTP ${resp.status}`);
        return null;
      }

      const data = await resp.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error(`[Consultant] ${model.name} no JSON in response`);
        return null;
      }

      const result = JSON.parse(jsonMatch[0]);
      result._model = model.name;
      result._attempt = attempt;
      console.log(`[Consultant] Success with ${model.name}`);
      return result;
    } catch (e) {
      if (attempt < 1) { await new Promise(r => setTimeout(r, 2000)); continue; }
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
- No CRM detected → DO NOT say "no database". Say "No CRM detected — they may have customer records in spreadsheets, email, or accounting software. Sarah opportunity to explore."
- The ONLY time you say an agent is NOT relevant is when you have POSITIVE EVIDENCE they're unneeded (e.g. confirmed sophisticated AI chat already deployed for Chris, confirmed 24/7 call centre for Maddie).

## PROSPECT DATA
${JSON.stringify(p, null, 2)}

## YOUR ANALYSIS TASKS

Read websiteContent carefully. Extract four specific lenses:

### LENS 1 — COPY QUALITY & MESSAGING
What does their website copy actually say? Is it clear, compelling, benefit-led? Does it speak directly to pain or outcome? Quote specific phrases that are strong. Identify where the copy sells well vs where it could be stronger. Frame weaknesses as opportunities ("their copy doesn't highlight X outcome — Bella can ask about that").

### LENS 2 — MARKET & ICP
Who is this business actually selling to? Look for signals: language used, problems referenced, outcomes promised, case studies, testimonials, location specificity. What segment of the market are they targeting? Is the ICP clearly defined on the site or implied? Note: Bella will CHECK this with the prospect — so frame it as "we noticed you seem to be targeting X, is that right?"

### LENS 3 — SURFACED BENEFITS & VALUE PROPS
What specific benefits does this business claim to deliver? Not services — outcomes and transformations. What do customers get? Look for phrases like "so you can", "without", "results", "guaranteed", "faster", "more", "less". Extract their actual stated value propositions.

### LENS 4 — CONVERSION EVENT & CTA
What action does this website want visitors to take? Is there a single clear primary CTA or multiple competing ones? What is the conversion event — book a call, fill a form, call a number, buy online, get a quote, download something? How prominent and compelling is that CTA? Any friction = opportunity for our agents to help.

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

## OUTPUT — VALID JSON ONLY

{
  "businessIdentity": {
    "correctedName": "The REAL business name — natural, conversational. Use ogTitle and domain as primary hints, verify in page content. Strip city names and legal suffixes (Pty Ltd, Inc). e.g. 'Pitcher Partners' not 'Pitcher Partners Sydney Pty Ltd'. NEVER output placeholders like 'Business Name Pending' — if unsure, clean up the domain name.",
    "industry": "The CORRECT industry based on what the business actually does — read their services, about page, and copy. e.g. 'accounting and advisory', 'plumbing', 'dental', 'legal'. Be specific. Do NOT guess from the <title> tag.",
    "businessModel": "B2B or B2C or Both — based on who their customers are from the copy",
    "serviceArea": "Where they operate — national, state-wide, or local. Infer from copy, office locations, service area mentions."
  },
  "scriptFills": {
    "website_positive_comment": "One genuine compliment about something specific in the website COPY — quote a strong phrase, reference a compelling benefit statement, or note a clear ICP focus. NOT about design. Must cite the actual copy.",
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
    "icpProblems": ["Problem 1 their ICP typically faces (from the copy)", "Problem 2", "Problem 3"],
    "icpSolutions": ["Solution 1 the business offers that addresses a specific problem", "Solution 2", "Solution 3"],
    "problemSolutionMapping": "Brief statement connecting problems to solutions — e.g. 'They help business owners who struggle with X by providing Y'",
    "bellaCheckLine": "The exact question Bella asks to CONFIRM this with the prospect — e.g. 'We noticed your site speaks very directly to trade business owners — is that mainly who you're working with?'"
  },
  "valuePropAnalysis": {
    "statedBenefits": ["List of specific outcome/benefit claims from the copy — not service names, real outcomes"],
    "strongestBenefit": "The most compelling, specific benefit claim on the site",
    "missingBenefits": "What outcomes do they deliver that they DON'T clearly claim on the site (based on context)?",
    "bellaLine": "One sentence Bella can say referencing a specific benefit — e.g. 'I saw you specifically mention X result for your clients — that's a really strong proof point'"
  },
  "conversionEventAnalysis": {
    "primaryCTA": "The main conversion action the site is driving — exact CTA text if visible",
    "ctaType": "book_call / fill_form / call_number / buy_online / get_quote / download / other",
    "ctaClarity": "Is it obvious what to do next? Single CTA or multiple competing?",
    "frictionPoints": ["Specific things that could reduce conversions — frame each as an opportunity for our agents"],
    "conversionStrength": "strong / moderate / weak — overall assessment with brief reason",
    "bellaLine": "One sentence Bella can say about the conversion setup — e.g. 'I noticed your main CTA is a booking form — we can actually train your AI agents to guide people through that step by step'"
  },
  "routing": {
    "priority_agents": ["Rank ALL 5 agents from strongest to weakest opportunity. Most businesses benefit from at least 3. Only exclude an agent if you have STRONG positive evidence they're irrelevant."],
    "lower_priority_agents": ["Agents where evidence is genuinely weak — NOT because data is missing, but because you can see they're covered. e.g. they already have sophisticated AI chat = Chris lower priority."],
    "reasoning": {
      "chris": "OPPORTUNITY ASSESSMENT for Chris (website/inbound conversion AI). Look for: no chat widget = visitors leave without engaging (strong case). Basic/non-AI chat = easy upgrade. Form-heavy site = Chris guides visitors through. Multiple CTAs = Chris directs traffic. Even if chat exists, is it AI-powered? If not, upgrade opportunity. Only deprioritise if they have a confirmed sophisticated AI chat solution already.",
      "maddie": "OPPORTUNITY ASSESSMENT for Maddie (missed calls/after-hours AI). Look for: phone number visible = inbound calls happening, likely some go unanswered. No after-hours info = callers hitting voicemail. Service business = phone enquiries are high-value. Even without phone data in payload, most businesses miss 20-30% of calls. Only deprioritise if you see evidence of a 24/7 call centre or dedicated reception team.",
      "alex": "OPPORTUNITY ASSESSMENT for Alex (speed-to-lead AI). Look for: ANY traffic source — ads, social media, email marketing, organic SEO = leads arriving that need fast follow-up. Ad pixels detected = definitely getting leads. Social presence = driving traffic. Email tool detected = sending campaigns that generate clicks. No ads doesn't mean no leads — website exists so enquiries are coming from somewhere. Only deprioritise if business appears genuinely pre-launch with zero online presence.",
      "sarah": "OPPORTUNITY ASSESSMENT for Sarah (database reactivation AI). Look for: ANY CRM, email marketing tool, ecommerce platform, or years in business = customer records exist somewhere. Even without a CRM, established businesses have past customers in spreadsheets, email threads, accounting software. Email tool like Mailchimp/Klaviyo = warm list exists. Only deprioritise if business is brand new (<6 months) with no customer history.",
      "james": "OPPORTUNITY ASSESSMENT for James (reviews/reputation AI). Look for: any Google reviews = reputation to grow and leverage. High rating = protect and amplify. Low rating = urgent improvement opportunity. Few reviews = growth opportunity (most customers don't leave reviews without being asked). No review data in payload does NOT mean no reviews — it means we haven't checked yet, Bella should ask. Only deprioritise if industry genuinely doesn't rely on reviews (very rare)."
    },
    "questions_to_prioritise": ["Which 2-3 audit questions Bella should ask in depth — focus on highest-value discovery"],
    "questions_to_brush_over": ["Which questions Bella can mention briefly and move on"]
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
}`;
}
