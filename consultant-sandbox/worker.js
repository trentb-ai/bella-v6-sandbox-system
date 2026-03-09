// consultant-sandbox/worker.js
// Bella's Intel Analyst — receives scraped data, returns script-ready analysis
// Separate atomic worker, called via service binding from scraper Phase B

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: CORS });

    try {
      const payload = await request.json();
      if (!payload.businessName) return new Response(JSON.stringify({ error: "Missing businessName" }), { status: 400, headers: CORS });

      const result = await runConsultant(payload, env);
      return new Response(JSON.stringify(result), { headers: CORS });
    } catch (e) {
      console.error("[Consultant] Fatal:", e);
      return new Response(JSON.stringify({ error: e.message, fallback: buildFallback(null) }), { status: 500, headers: CORS });
    }
  }
};


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
      priority_agents: [],
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
    name:     "gemini-3-flash-preview",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent",
    temp:     0.7,
    maxTokens: 4000,
  },
  {
    name:     "gemini-2.5-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
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
  return `You are Bella's intelligence analyst at Pillar and Post AI. Your job is to analyze REAL DATA and give Bella specific, evidence-based talking points for her sales conversation.

You are NOT selling agents. You are a DATA ANALYST who finds the most interesting, specific, impressive things about this business so Bella sounds like she's done 3 hours of genuine research.

CRITICAL RULES:
- ONLY reference data you can see in the payload below. If a field is null/empty/0, output null. Do NOT invent data.
- Use the business's own language — their targetAudience word, their salesTerm, their industry terms
- Name REAL competitors from the data only. Do NOT fabricate competitor names.
- Every insight must be specific and cite its data source
- Think through a conversion-effectiveness lens: clear offers, single CTAs, low friction, trust signals, urgency
- Keep all outputs concise — Bella speaks these on a voice call, not reads an essay
- Australian English throughout

## PROSPECT DATA
${JSON.stringify(p, null, 2)}

## OUTPUT — VALID JSON ONLY

{
  "scriptFills": {
    "website_positive_comment": "A genuine, specific compliment about their website — reference something real you found (case studies, design, content quality, network). NOT just 'nice site'. Must cite evidence.",
    "hero_header_quote": "Their actual H1/hero text, quoted",
    "reference_offer": "Their main offer or service to reference",
    "icp_guess": "Who their ideal customer is based on the data — specific language",
    "campaign_summary": "What ads they're running or null if none",
    "rep_commentary": "Qualitative assessment of their Google reputation — warm, specific, cite numbers",
    "recent_review_snippet": "Best customer quote from their reviews (verbatim), or null",
    "rep_quality_assessment": "Brief honest assessment of review quality — themes, sentiment",
    "top_2_website_ctas": "Their top 2 CTAs from the website, natural language"
  },
  "routing": {
    "priority_agents": ["Top 2-3 agents with strongest EVIDENCE only"],
    "skip_agents": ["Agents where evidence is weak or irrelevant"],
    "reasoning": {
      "chris": "Evidence for/against Chris — cite: chat widget, form count, CTA quality. null if no data.",
      "maddie": "Evidence for/against Maddie — cite: opening hours, phone visibility, after-hours. null if no data.",
      "alex": "Evidence for/against Alex — cite: running ads yes/no, ad count, scheduler. null if no data.",
      "sarah": "Evidence for/against Sarah — cite: years in business, review count as proxy. null if no data.",
      "james": "Evidence for/against James — cite: star rating, review count, owner response rate. null if no data."
    },
    "questions_to_prioritise": ["Which 2-3 audit questions Bella should ask in depth"],
    "questions_to_brush_over": ["Which questions Bella can mention briefly and move on"]
  },
  "websiteCompliments": [
    { "what": "Something genuinely specific and impressive", "evidence": "Exact data point", "bellaLine": "Natural sentence Bella can say" },
    { "what": "A second different impressive thing", "evidence": "Specific evidence", "bellaLine": "Natural sentence" }
  ],
  "mostImpressive": [
    { "finding": "The single most notable thing from ALL the data", "source": "Where you found it", "bellaLine": "How Bella references it naturally" },
    { "finding": "Second most impressive — different category", "source": "Data source", "bellaLine": "Natural reference" }
  ],
  "googlePresence": [
    { "insight": "Their rating/review standing vs named competitors if available", "data": "Exact numbers", "bellaLine": "How Bella references this" },
    { "insight": "What their reviews reveal — theme, sentiment", "bestQuote": "Direct quote from best review, or null", "bellaLine": "How Bella references review sentiment" }
  ],
  "competitiveEdge": [
    { "angle": "Where this business beats named competitors — real names, real data only", "evidence": "Specific comparison", "bellaLine": "Positive framing for Bella" },
    { "angle": "Where named competitors have an advantage", "evidence": "Specific data", "bellaLine": "How Bella probes this diplomatically" }
  ],
  "conversationHooks": [
    { "topic": "A specific data-backed thing Bella can raise naturally", "data": "Supporting evidence", "how": "How to bring it up" },
    { "topic": "Second hook — different from the first", "data": "Evidence", "how": "Conversation approach" },
    { "topic": "Third hook", "data": "Evidence", "how": "Approach" }
  ],
  "redFlags": [
    "Specific problem #1 with evidence",
    "Specific problem #2"
  ],
  "socialMediaPresence": {
    "channels": ["List of platforms found"],
    "insight": "What their social presence says about them"
  },
  "landingPageVerdict": {
    "heroEffectiveness": "Is their H1/hero compelling? Quote it, assess honestly",
    "ctaClarity": "Are the CTAs clear? Single clear next step or confusion?",
    "conversionBarriers": ["Specific friction points — cite data"],
    "trustSignals": "What builds credibility? What's missing?",
    "mobileExperience": "Mobile optimised? Based on audit data",
    "verdictLine": "One punchy sentence summarising landing page quality",
    "verdictLine2": "A second angle — different from the first"
  }
}`;
}
