// consultant-v6/worker.js
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

      // V5: write script_stages to KV so Bella's fetch_script_stage tool works
      const lid = payload.lid ?? payload.leadId ?? null;
      if (lid && env.LEADS_KV && result && !result.error && !result._fallback) {
        try {
          await writeScriptStages(lid, payload, result, env);
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

  const stages = {
    opening: {
      text: `You've just been introduced. Open warmly and reference ${biz} specifically. Your website compliment: "${compliment}". Ask: "Before I walk you through what we found, can I ask — who typically handles your marketing and lead follow-up over there?"`,
      fallbacks: [
        `Hey, great to connect. We've done a full audit of ${biz} and I have to say, the numbers are really interesting.`,
        `Hi! I'm Bella from Pillar and Post AI — we've just finished analysing ${biz} and there are some genuine opportunities I want to walk you through.`
      ]
    },
    audit: {
      text: `You're in the discovery/audit stage. Focus questions on ${icp}. Key hooks to use: ${hooks.slice(0, 2).join("; ")}. Explore: how many leads per week, response time, conversion rate, current ACV. Keep each question short — one at a time.`,
      fallbacks: [
        `Tell me — when a new lead comes in for ${offer}, what does your follow-up process look like right now?`,
        `How quickly does your team typically respond when someone enquires about ${offer}?`
      ]
    },
    reputation: {
      text: `Reference their Google reputation naturally. ${repLine}${bestReview ? ` Best review to reference: "${bestReview}"` : ""} Ask how they feel about their online reputation and whether reviews are a focus for them.`,
      fallbacks: [
        `Your Google presence is actually pretty solid — how much of your new business comes through online search versus referrals?`,
        `Reviews are really important in your space. Is growing your Google profile something you've been actively working on?`
      ]
    },
    roi_reveal: {
      text: `You have ROI data ready. Prioritise agents: ${priorityAgents.join(", ")}. Reveal the total monthly opportunity figure first, then break down the top 2 agents. Ask: "Does that kind of number make sense for a business like yours?" Then pivot to ACV if not already captured.`,
      fallbacks: [
        `Based on what you've told me, the combined opportunity across your top two areas is significant. Let me break that down.`,
        `The numbers we've run are actually really exciting for ${biz}. Your biggest opportunity right now is...`
      ]
    },
    close: {
      text: `You're moving toward a close. The next step is booking a full strategy session. Landing page verdict: "${verdictLine}". Ask: "Would it make sense to jump on a 30-minute strategy session so we can map out exactly where to start?" Handle any hesitation by reinforcing the ROI numbers.`,
      fallbacks: [
        `The logical next step is a 30-minute session where we map out exactly which of these we'd tackle first for ${biz}. Does next week work?`,
        `I'd love to put together a proper plan for you. Can we lock in a time this week to go through the strategy in detail?`
      ]
    },
    objection_price: {
      text: `Price objection raised. Reframe around ROI: if the monthly opportunity is $X, the investment is a fraction of that. Ask: "If we could recover even 20% of that, what would that mean for ${biz} over 12 months?" Don't discount — anchor on value.`,
      fallbacks: [
        `I completely understand. The way I'd look at it — if the opportunity is $X a month, even a conservative win means the investment pays for itself in the first week.`,
        `That's fair. Let me reframe it — what would an extra $X a month do for ${biz}?`
      ]
    },
    objection_timing: {
      text: `Timing objection raised. Acknowledge it, then ask what's driving the timing concern. If it's seasonal or resource-based, validate it. Then plant a seed: "The reason I'd push back gently is that your competitors aren't waiting." Set a follow-up date.`,
      fallbacks: [
        `That's completely fair — when do you think would be a better time to revisit this?`,
        `I hear you. Can we at least lock in a call for [X weeks] so we're ready to move when the timing's right?`
      ]
    },
    booking: {
      text: `You're booking the next step. Confirm: name, best email, preferred time. Say: "I'll send you a calendar link right now — what email should I use?" Keep it simple and fast. Don't over-explain.`,
      fallbacks: [
        `Perfect. What's the best email to send the calendar invite to?`,
        `Great — and is morning or afternoon better for you generally?`
      ]
    }
  };

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
  return `You are Bella's intelligence analyst at Pillar and Post AI. Your job is to deeply analyse the scraped website content and produce specific, evidence-based intelligence that makes Bella sound like she spent 3 hours researching this business before calling.

You are a DATA ANALYST, not a salesperson. Find the most interesting, genuine, specific things so Bella can open with real credibility.

CRITICAL RULES:
- ONLY reference data visible in the payload below. If a field is null/empty, output null. Do NOT invent.
- Use the business's own language from their website copy — their words, their phrases
- Focus heavily on websiteContent — that is the raw scraped page text. Mine it carefully.
- Keep all outputs concise — Bella speaks these on a live voice call, not reads an essay
- Australian English throughout
- Every insight must be evidence-backed with a quote or specific reference from the content

## PROSPECT DATA
${JSON.stringify(p, null, 2)}

## YOUR ANALYSIS TASKS

Read websiteContent carefully. Extract four specific lenses:

### LENS 1 — COPY QUALITY & MESSAGING
What does their website copy actually say? Is it clear, compelling, benefit-led? Does it speak directly to pain or outcome? Quote specific phrases that are strong. Identify where the copy sells well vs where it's vague or generic.

### LENS 2 — MARKET & ICP
Who is this business actually selling to? Look for signals: language used, problems referenced, outcomes promised, case studies, testimonials, location specificity. What segment of the market are they targeting? Is the ICP clearly defined on the site or implied? Note: Bella will CHECK this with the prospect — so frame it as "we noticed you seem to be targeting X, is that right?"

### LENS 3 — SURFACED BENEFITS & VALUE PROPS
What specific benefits does this business claim to deliver? Not services — outcomes and transformations. What do customers get? Look for phrases like "so you can", "without", "results", "guaranteed", "faster", "more", "less". Extract their actual stated value propositions.

### LENS 4 — CONVERSION EVENT & CTA
What action does this website want visitors to take? Is there a single clear primary CTA or multiple competing ones? What is the conversion event — book a call, fill a form, call a number, buy online, get a quote, download something? How prominent and compelling is that CTA? Is there friction (too many fields, unclear next step)?

## OUTPUT — VALID JSON ONLY

{
  "scriptFills": {
    "website_positive_comment": "One genuine compliment about something specific in the website COPY — quote a strong phrase, reference a compelling benefit statement, or note a clear ICP focus. NOT about design. Must cite the actual copy.",
    "hero_header_quote": "Their actual H1/hero headline, verbatim from the content",
    "reference_offer": "Their primary service or offer as named on the site",
    "icp_guess": "Who their ideal customer appears to be — use their language. Frame as something Bella can CHECK with the prospect e.g. 'it looks like you mainly work with X, is that right?'",
    "campaign_summary": "What ads they're running or null if none",
    "rep_commentary": "Qualitative assessment of their Google reputation — warm, specific, cite numbers",
    "recent_review_snippet": "Best customer quote from their reviews (verbatim), or null",
    "rep_quality_assessment": "Brief honest assessment of review quality — themes, sentiment",
    "top_2_website_ctas": "Their top 2 CTAs from the website, natural language"
  },
  "copyAnalysis": {
    "messagingStrength": "What the copy does well — cite specific phrases or sections",
    "messagingWeakness": "Where the copy is vague, generic, or missing — be specific",
    "strongestLine": "The single most compelling line on the entire site — verbatim quote",
    "toneAndVoice": "How would you describe the brand voice? e.g. professional, warm, authoritative, clinical, casual",
    "bellaLine": "A single sentence Bella can say that compliments the copy specifically — e.g. 'I noticed your website leads with X outcome rather than just listing services — that's actually quite rare and it works really well'"
  },
  "icpAnalysis": {
    "whoTheyTarget": "Specific description of apparent ICP drawn from the copy",
    "howTheyKnow": "Evidence from the copy — specific phrases, problems referenced, language used",
    "icpConfidenceLevel": "high / medium / low — how clearly defined is the ICP on the site?",
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
    "frictionPoints": ["Specific things that could reduce conversions — too many steps, unclear value, form fields, etc."],
    "conversionStrength": "strong / moderate / weak — overall assessment with brief reason",
    "bellaLine": "One sentence Bella can say about the conversion setup — e.g. 'I noticed your main CTA is a booking form — we can actually train your AI agents to guide people through that step by step'"
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
    { "what": "Something genuinely specific and impressive from the COPY", "evidence": "Verbatim quote or specific data point", "bellaLine": "Natural sentence Bella can say" },
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
  "conversationHooks": [
    { "topic": "A specific copy or ICP insight Bella can raise naturally", "data": "Evidence from the site", "how": "How to bring it up" },
    { "topic": "A benefit or value prop observation", "data": "Evidence", "how": "Conversation approach" },
    { "topic": "The conversion event observation", "data": "Evidence", "how": "Approach" }
  ],
  "redFlags": [
    "Specific problem #1 with evidence",
    "Specific problem #2"
  ],
  "landingPageVerdict": {
    "heroEffectiveness": "Is their H1/hero compelling? Quote it, assess honestly",
    "ctaClarity": "Are the CTAs clear? Single clear next step or confusion?",
    "conversionBarriers": ["Specific friction points — cite data"],
    "trustSignals": "What builds credibility? What's missing?",
    "verdictLine": "One punchy sentence summarising landing page quality",
    "verdictLine2": "A second angle — different from the first"
  }
}`;
}
