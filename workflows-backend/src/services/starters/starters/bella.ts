import { WorkflowStarter } from "../../../core/types";
import { NodeType } from "../../../core/enums";

export const bellaV9OrchestratorStarter: WorkflowStarter = {
  id: "bella-v9-orchestrator",
  name: "Bella V9 Orchestrator",
  description: "Advanced lead generation agent orchestrator (Chunks 1-5 + SUPERGOD: Trigger, Scrape, Wait Gate, Stage 1 Wow, Stage 2 Findings & Clarify, Granular Apify Extraction + Landing Crawl + AI Classification)",
  category: "Business",
  icon: "Zap",
  difficulty: "advanced",
  tags: ["bella", "lead-gen", "scraping", "ai"],
  workflow: {
    nodes: [
      {
        id: "node-entry",
        type: NodeType.ENTRY,
        position: { x: 100, y: 300 },
        config: {}
      },
      {
        id: "node-kv-stub",
        type: NodeType.KV_PUT,
        position: { x: 300, y: 300 },
        config: {
          namespace: "WORKFLOWS_KV",
          key: "lead:{{node-entry.lid}}:stub",
          value: "{\"status\": \"pending\", \"basics\": {\"name\": \"{{node-entry.name}}\", \"url\": \"{{node-entry.url}}\", \"firstName\": \"{{node-entry.firstName}}\"}}",
          options: { expirationTtl: 3600 }
        }
      },
      // ═══════════════════════════════════════════════════════════════════════
      // FAST SCRAPE: Firecrawl website scrape (~5-10s)
      // ═══════════════════════════════════════════════════════════════════════
      {
        id: "node-firecrawl",
        type: NodeType.HTTP_REQUEST,
        position: { x: 500, y: 150 },
        config: {
          url: "https://api.firecrawl.dev/v1/scrape",
          method: "POST",
          headers: [
            { key: "Authorization", value: "Bearer {{env.FIRECRAWL_KEY}}" },
            { key: "Content-Type", value: "application/json" }
          ],
          body: {
            type: "json",
            content: "{\"url\": \"{{node-entry.url}}\", \"formats\": [\"markdown\"], \"onlyMainContent\": true}"
          }
        }
      },
      // ═══════════════════════════════════════════════════════════════════════
      // TRUNCATE: Extract + truncate firecrawl markdown for AI prompt
      // Avoids Workers AI context window overflow on large sites
      // ═══════════════════════════════════════════════════════════════════════
      {
        id: "node-truncate-content",
        type: NodeType.TRANSFORM,
        position: { x: 600, y: 150 },
        config: {
          code: "const fcResp = _workflowState['node-firecrawl']?.output?.body || {};\nconst entries = Object.entries(fcResp);\nconst mainEntry = entries.find(([k]) => k !== 'success');\nconst scrapeObj = mainEntry ? mainEntry[1] : {};\nconst md = (scrapeObj?.markdown || '').slice(0, 4000);\nreturn { content: md };"
        }
      },
      // ═══════════════════════════════════════════════════════════════════════
      // FIRE APIFY: Start all 5 actors immediately (~2s), collect later
      // To add a new actor: append an entry to the `actors` array below
      // ═══════════════════════════════════════════════════════════════════════
      {
        id: "node-fire-apify",
        type: NodeType.TRANSFORM,
        position: { x: 700, y: 300 },
        config: {
          code: "const entry = _workflowState['node-entry']?.output || {};\nconst bizName = entry.name || '';\nconst siteUrl = entry.url || '';\nconst domainName = siteUrl ? new URL(siteUrl).hostname.replace('www.', '') : '';\nconst slug = bizName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');\nconst apifyTk = this.env.APIFY_TOKEN || this.env.APIFY_API_KEY;\nconst actors = [\n  { key: 'facebook_ads', actor: 'apify~facebook-ads-scraper', payload: { startUrls: [{ url: 'https://www.facebook.com/ads/library/?search_term=' + domainName }], maxAds: 10 } },\n  { key: 'google_ads', actor: 'apify~google-search-scraper', payload: { queries: 'site:google.com/aclk ' + domainName, maxPagesPerQuery: 1 } },\n  { key: 'indeed', actor: 'misceres~indeed-scraper', payload: { position: '', company: bizName, country: 'AU', maxItems: 5 } },\n  { key: 'google_maps', actor: 'compass~google-maps-reviews-scraper', payload: { searchStringsArray: [bizName], maxCrawledPlacesPerSearch: 1, language: 'en', maxReviews: 8 } },\n  { key: 'linkedin', actor: 'bebity~linkedin-scraper', payload: { urls: ['https://www.linkedin.com/company/' + slug], proxy: { useApifyProxy: true } } }\n];\nconst startResults = await Promise.all(\n  actors.map(a =>\n    fetch('https://api.apify.com/v2/acts/' + a.actor + '/runs?token=' + apifyTk, {\n      method: 'POST',\n      headers: { 'Content-Type': 'application/json' },\n      body: JSON.stringify(a.payload)\n    }).then(r => r.json()).then(j => { const dObj = Object.values(j || {}).find(v => v && typeof v === 'object') || {}; return { key: a.key, runId: dObj.id || null, status: 'started' }; }).catch(e => ({ key: a.key, runId: null, status: 'failed', error: e.message }))\n  )\n);\nconst runs = {};\nstartResults.forEach(r => { runs[r.key] = r; });\nreturn runs;"
        }
      },
      {
        id: "node-consultant-ai",
        type: NodeType.WORKERS_AI,
        position: { x: 1050, y: 150 },
        config: {
          model: "@cf/meta/llama-3.1-8b-instruct",
          prompt: "The business name is {{node-entry.name}}. Using content from {{node-truncate-content.content}}, output one polished paragraph only. Flattery + sophisticated insight on market positioning, who they help, how they help. Always use the business name naturally the way a human would say it in conversation — e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Absolutely no criticism, no fixes, no tone analysis, no bullets.",
          temperature: 0.7
        }
      },
      {
        id: "node-kv-phase-a",
        type: NodeType.KV_PUT,
        position: { x: 1300, y: 150 },
        config: {
          namespace: "WORKFLOWS_KV",
          key: "lead:{{node-entry.lid}}:phase_a",
          value: "{{node-consultant-ai.text}}",
          options: { expirationTtl: 3600 }
        }
      },

      // ═══════════════════════════════════════════════════════════════════════
      // CHUNK A: Embed fast-intel vector (additive, gated by ENABLE_EMBEDDING)
      // Flow: node-kv-phase-a → node-embed-fast-intel → node-wait-call-connected
      // ═══════════════════════════════════════════════════════════════════════
      {
        id: "node-embed-fast-intel",
        type: NodeType.TRANSFORM,
        position: { x: 1425, y: 150 },
        config: {
          code: `
// ── Chunk A: Embed fast-intel text via Gemini text-embedding-004 ──
// Gated by ENABLE_EMBEDDING env var — skips silently if not set
if (!this.env.ENABLE_EMBEDDING || this.env.ENABLE_EMBEDDING !== 'true') {
  return { embedded: false, skipped: true };
}

try {
  // Read the fast-intel text written by node-kv-phase-a
  const rawText = _workflowState['node-kv-phase-a']?.output?.value
    || _workflowState['node-consultant-ai']?.output?.text
    || '';

  if (!rawText || rawText.length < 20) {
    return { embedded: false, error: 'insufficient_text', len: rawText.length };
  }

  // Truncate to ~2000 chars to stay within embedding model limits
  const text = rawText.slice(0, 2000);
  const lid = _workflowState['node-entry']?.output?.lid || 'unknown';

  // Call Gemini text-embedding-004
  const apiKey = this.env.GEMINI_API_KEY;
  const embeddingRes = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=' + apiKey,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'models/text-embedding-004',
        content: { parts: [{ text }] },
        taskType: 'RETRIEVAL_DOCUMENT'
      })
    }
  );

  if (!embeddingRes.ok) {
    const errText = await embeddingRes.text();
    return { embedded: false, error: 'gemini_' + embeddingRes.status, detail: errText.slice(0, 200) };
  }

  const embeddingData = await embeddingRes.json();
  const vector = embeddingData?.embedding?.values;

  if (!vector || !Array.isArray(vector) || vector.length === 0) {
    return { embedded: false, error: 'no_vector_in_response' };
  }

  // Store vector in LEADS_KV as lead:{lid}:fast_vector
  const kvPayload = JSON.stringify({ v: vector, dim: vector.length, ts: new Date().toISOString() });
  await this.env.LEADS_KV.put('lead:' + lid + ':fast_vector', kvPayload, { expirationTtl: 3600 });

  return { embedded: true, dimension: vector.length };

} catch (e) {
  // Never throw — fallback gracefully
  return { embedded: false, error: e.message || 'unknown_error' };
}
`
        }
      },

      // ═══════════════════════════════════════════════════════════════════════
      // CHUNK 4: Stage 1 — Wow + Demo Explain
      // Flow: wait-call-connected → read fast KV → AI refine (Llama 70B)
      //       → Gemini polish → write snippet to KV
      // ═══════════════════════════════════════════════════════════════════════

      // C4.1: Wait for voice agent DO to signal prospect connected
      {
        id: "node-wait-call-connected",
        type: NodeType.WAIT_EVENT,
        position: { x: 1550, y: 150 },
        config: {
          eventType: "call-connected",
          timeout: { value: 5, unit: "minutes" },
          timeoutBehavior: "continue"
        }
      },

      // C4.2: Read fast flattery from KV (written by node-kv-phase-a)
      {
        id: "node-kv-get-fast",
        type: NodeType.KV_GET,
        position: { x: 1800, y: 150 },
        config: {
          namespace: "WORKFLOWS_KV",
          key: "lead:{{node-entry.lid}}:phase_a",
          type: "text"
        }
      },

      // C4.3: Refine into Stage 1 WOW snippet (Llama 3.1 70B)
      // ALIGNED with FINAL BELLA PROMPT: Warm Wow = greet + website obs + offer/CTA/ICP + pre-training connection
      // No numbers/ROI yet (that's bridge stage 3). No "As an AI" or "100 data points".
      {
        id: "node-ai-refine-wow",
        type: NodeType.WORKERS_AI,
        position: { x: 2050, y: 150 },
        config: {
          model: "@cf/meta/llama-3.1-70b-instruct",
          prompt: "You are writing the opening 25-40 second WOW script for Bella, Strategic Intel Director at Pillar and Post. The prospect's first name is {{node-entry.firstName}}. Their business name is {{node-entry.name}}. They just connected to a personalized demo call. Using this background on their business:\n\n{{node-kv-get-fast.value}}\n\nWrite Bella's opening that: 1) Greets {{node-entry.firstName}} warmly by first name and welcomes them to their personalized demo, 2) References one strong specific observation about their website — hero message, positioning, or value proposition, 3) Mentions their offer, CTA, ICP, or social proof with genuine appreciation, 4) Connects this intelligence to how the AI team has been pre-trained: 'This is exactly the kind of business intelligence we've already used to pre-train your AI team, so they feel like they've been inside [business] for years.'\n\nRules: 3-5 sentences max. Use the business name naturally the way a human would say it in conversation — e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Never say 'your organization' or 'your firm'. Consultative, warm, confident — like a trusted strategic advisor who has done deep homework. No criticism, no implied gaps, no fixes — pure positive. Never say 'As an AI' or '100 data points'. Do NOT ask for numbers or mention ROI yet. Write as spoken dialogue only, no labels or stage directions.",
          temperature: 0.7,
          maxTokens: 512
        }
      },

      // C4.4: Polish with Gemini for natural voice warmth
      {
        id: "node-gemini-polish",
        type: NodeType.TRANSFORM,
        position: { x: 2300, y: 150 },
        config: {
          code: "const geminiKey = this.env.GEMINI_API_KEY;\nif (!geminiKey) { return { text: inputData.text || '', raw: inputData.text || '', gemini_status: 'no_key' }; }\nconst rawSnippet = inputData.text || '';\n\nif (!rawSnippet || rawSnippet.length < 10) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'skipped_empty' }; }\nconst resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'You are Bella, a confident, warm female strategic advisor. Polish this script so every single word sounds like natural spoken conversation. Contractions always (it is → it\\'s, we have → we\\'ve, they are → they\\'re). Natural rhythm and flow. Shorten any business name to how a human would actually say it aloud (KPMG Australia → KPMG, Smith & Sons Plumbing → Smith and Sons). Remove any stiff corporate language — no \"your organization\", \"your firm\", \"leverage\", \"utilize\". Keep the meaning and structure identical. Do not shorten or remove any sentences. Output ONLY the polished dialogue, nothing else:\\n\\n' + rawSnippet }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 2048 } }) });\nconst geminiJson = await resp.json();\nconst polished = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || rawSnippet;\n\nreturn { text: polished, raw: rawSnippet, gemini_status: resp.status };"
        }
      },

      // C4.5: Write polished snippet to KV — bridge reads this on next turn
      {
        id: "node-kv-write-snippet",
        type: NodeType.KV_PUT,
        position: { x: 2550, y: 150 },
        config: {
          namespace: "WORKFLOWS_KV",
          key: "lead:{{node-entry.lid}}:stage1_snippet",
          value: "{{node-gemini-polish.text}}",
          options: { expirationTtl: 3600 }
        }
      },

      // ═══════════════════════════════════════════════════════════════════════
      // COLLECT APIFY: Poll run IDs from fire-apify, get results
      // By now actors have had 30-60s+ head start (fast path + call wait + WOW)
      // ═══════════════════════════════════════════════════════════════════════
      {
        id: "node-collect-apify",
        type: NodeType.TRANSFORM,
        position: { x: 2700, y: 300 },
        config: {
          code: "const runs = _workflowState['node-fire-apify']?.output || {};\nconst apifyTk = this.env.APIFY_TOKEN || this.env.APIFY_API_KEY;\nconst pollRun = async (key, runId) => {\n  if (!runId) return { key, items: [], status: 'no_run' };\n  try {\n    for (let i = 0; i < 20; i++) {\n      const statusResp = await fetch('https://api.apify.com/v2/actor-runs/' + runId + '?token=' + apifyTk);\n      if (!statusResp.ok) return { key, items: [], status: 'api_error_' + statusResp.status };\n      const statusJson = await statusResp.json();\n      const dObj = Object.values(statusJson || {}).find(v => v && typeof v === 'object') || {};\n      const runStatus = dObj.status || '';\n      if (runStatus === 'SUCCEEDED') {\n        const dsId = dObj.defaultDatasetId;\n        if (!dsId) return { key, items: [], status: 'no_dataset' };\n        const itemsResp = await fetch('https://api.apify.com/v2/datasets/' + dsId + '/items?token=' + apifyTk + '&limit=15');\n        const items = await itemsResp.json();\n        return { key, items: items || [], status: 'done' };\n      }\n      if (runStatus === 'FAILED' || runStatus === 'ABORTED' || runStatus === 'TIMED-OUT') {\n        return { key, items: [], status: runStatus.toLowerCase() };\n      }\n      await new Promise(resolve => setTimeout(resolve, 4000));\n    }\n    return { key, items: [], status: 'poll_timeout' };\n  } catch (e) {\n    return { key, items: [], status: 'error', error: e.message };\n  }\n};\nconst results = await Promise.all(\n  Object.entries(runs).map(([key, run]) => pollRun(key, run?.runId))\n);\nconst out = {};\nresults.forEach(r => { out[r.key] = r.items; if (r.status !== 'done') out[r.key + '_status'] = r.status; });\nreturn out;"
        }
      },
      // ═══════════════════════════════════════════════════════════════════════
      // DEEP INTEL: Extract + process all 5 Apify results
      // ═══════════════════════════════════════════════════════════════════════
      {
        id: "node-extract-deep",
        type: NodeType.TRANSFORM,
        position: { x: 2900, y: 300 },
        config: {
          code: "const scrape = _workflowState['node-collect-apify']?.output || {};\nconst place = (Array.isArray(scrape.google_maps) ? scrape.google_maps[0] : scrape.google_maps) || {};\nconst reviews = (place.reviews || []).slice(0, 5).map(r => ({ text: (r?.text || '').slice(0, 200), stars: r?.stars, name: r?.name }));\nconst fbAds = Array.isArray(scrape.facebook_ads) ? scrape.facebook_ads : [];\nconst googleAds = Array.isArray(scrape.google_ads) ? scrape.google_ads : [];\nconst indeedJobs = Array.isArray(scrape.indeed) ? scrape.indeed : [];\nconst linkedinInfo = (Array.isArray(scrape.linkedin) ? scrape.linkedin[0] : scrape.linkedin) || {};\nreturn { google_rating: place.totalScore || place.rating || null, review_count: place.reviewsCount || 0, address: place.address || null, categories: place.categories || [], reviews_sample: reviews, is_running_fb_ads: fbAds.length > 0, fb_ads_count: fbAds.length, fb_ads_sample: fbAds.slice(0, 3).map(a => ({ text: ((a?.bodyText || a?.caption) || '').slice(0, 200), cta: a?.callToActionType || '' })), is_running_google_ads: googleAds.length > 0, google_ads_count: googleAds.length, is_hiring: indeedJobs.length > 0, job_count: indeedJobs.length, jobs_sample: indeedJobs.slice(0, 3).map(j => ({ title: j?.title || j?.positionName || '', salary: j?.salary || '' })), linkedin_employees: linkedinInfo?.employeeCount || linkedinInfo?.staffCount || null, linkedin_industry: linkedinInfo?.industryName || linkedinInfo?.industry || null, linkedin_description: (linkedinInfo?.description || '').slice(0, 300), raw_json: JSON.stringify({ google_maps: place, fb_ads_count: fbAds.length, google_ads_count: googleAds.length, indeed_count: indeedJobs.length, linkedin: linkedinInfo }) };"
        }
      },

      // ═══════════════════════════════════════════════════════════════════════
      // SUPERGOD: Granular Apify Extraction + Landing Crawl + AI Classification
      // All 5 nodes gated by ENABLE_DEEP_MAX env var. If disabled, pass-through.
      // ═══════════════════════════════════════════════════════════════════════

      // SG.1: Granular extraction from raw Apify data + JS classification
      {
        id: "node-enrich-extract",
        type: NodeType.TRANSFORM,
        position: { x: 3050, y: 300 },
        config: {
          code: "const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';\nconst extracted = inputData || {};\nif (!enableDeep) { return extracted; }\nconst raw = _workflowState['node-collect-apify']?.output || {};\nconst fbAds = Array.isArray(raw.facebook_ads) ? raw.facebook_ads : [];\nconst googleAds = Array.isArray(raw.google_ads) ? raw.google_ads : [];\nconst indeedJobs = Array.isArray(raw.indeed) ? raw.indeed : [];\nconst place = (Array.isArray(raw.google_maps) ? raw.google_maps[0] : raw.google_maps) || {};\nconst allReviews = place.reviews || [];\nconst li = (Array.isArray(raw.linkedin) ? raw.linkedin[0] : raw.linkedin) || {};\nconst offerRx = /(?:free|complimentary|\\d+%\\s*off|\\$\\d+|\\bsale\\b|\\bdiscount\\b|no\\s*obligation|limited\\s*time|special\\s*offer|quote|consultation|audit|assessment)/i;\nconst ad_campaigns = fbAds.slice(0, 5).map(a => { const body = a?.bodyText || a?.caption || ''; const headline = a?.title || ''; const combined = headline + ' ' + body; const offerMatch = combined.match(offerRx); return { platform: 'facebook', headline: headline.slice(0, 200), body: body.slice(0, 500), offer: offerMatch ? offerMatch[0] : null, cta: (a?.callToActionType || '').replace(/_/g, ' ').toLowerCase(), landing_url: a?.linkUrl || '' }; });\nconst gAds = googleAds.slice(0, 5).map(a => ({ platform: 'google', headline: (a?.title || '').slice(0, 200), body: (a?.description || '').slice(0, 300), offer: ((a?.title || '') + ' ' + (a?.description || '')).match(offerRx)?.[0] || null, cta: '', landing_url: a?.displayedUrl || a?.url || '' }));\nconst allAds = [...ad_campaigns, ...gAds];\nconst ad_offers = [...new Set(allAds.filter(a => a.offer).map(a => a.offer))];\nconst ad_ctas = [...new Set(allAds.map(a => a.cta).filter(Boolean))];\nconst landing_urls = [...new Set(allAds.map(a => a.landing_url).filter(u => u && u.startsWith('http')))].slice(0, 3);\nconst catMap = { receptionist: 'call_handling', 'front desk': 'call_handling', admin: 'call_handling', 'customer service': 'call_handling', sales: 'sales', 'business dev': 'sales', account: 'sales', marketing: 'marketing', digital: 'marketing', seo: 'marketing', social: 'marketing', developer: 'technical', engineer: 'technical' };\nconst catRole = t => { const l = (t || '').toLowerCase(); for (const [k, v] of Object.entries(catMap)) { if (l.includes(k)) return v; } return 'other'; };\nconst job_roles = indeedJobs.slice(0, 5).map(j => ({ title: j?.title || j?.positionName || '', company: j?.company || '', location: j?.location || '', description: (j?.description || j?.snippet || '').slice(0, 500), salary: j?.salary || '', type: j?.jobType || j?.type || '', category: catRole(j?.title || j?.positionName || '') }));\nconst hiring_categories = [...new Set(job_roles.map(j => j.category))];\nconst themeMap = { service_quality: ['excellent','outstanding','professional','thorough','knowledgeable','expert','amazing','fantastic','wonderful'], speed: ['fast','quick','prompt','efficient','timely','responsive','immediate'], value: ['value','worth','affordable','reasonable','fair price','competitive'], staff_friendly: ['friendly','welcoming','warm','helpful','kind','patient','caring','lovely','pleasant'], reliability: ['reliable','consistent','dependable','trustworthy'] };\nconst classifyThemes = text => { const l = (text || '').toLowerCase(); return Object.entries(themeMap).filter(([, kws]) => kws.some(k => l.includes(k))).map(([t]) => t); };\nconst reviews_detailed = allReviews.slice(0, 8).map(r => { const txt = (r?.text || '').slice(0, 500); const th = classifyThemes(txt); return { text: txt, stars: r?.stars || 0, author: r?.name || '', date: r?.publishedAtDate || '', themes: th, sentiment: (r?.stars || 0) >= 4 ? 'positive' : (r?.stars || 0) <= 2 ? 'negative' : 'neutral', owner_replied: !!(r?.responseFromOwnerText) }; });\nconst theme_summary = {};\nreviews_detailed.forEach(r => r.themes.forEach(t => { theme_summary[t] = (theme_summary[t] || 0) + 1; }));\nconst top_review_themes = Object.entries(theme_summary).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);\nconst linkedin_detail = { employees: li?.employeeCount || li?.staffCount || null, industry: li?.industryName || li?.industry || null, description: (li?.description || '').slice(0, 500), specialties: li?.specialities || li?.specialties || [], founded: li?.foundedOn || li?.founded || null };\nreturn { ...extracted, enriched: true, ad_campaigns: allAds, ad_offers, ad_ctas, landing_urls, job_roles, hiring_categories, reviews_detailed, review_theme_summary: theme_summary, top_review_themes, linkedin_detail };"
        }
      },

      // SG.2: Crawl top 3 ad landing pages for conversion events (forms, buttons, CTAs)
      {
        id: "node-crawl-landings",
        type: NodeType.TRANSFORM,
        position: { x: 3200, y: 300 },
        config: {
          code: "const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';\nif (!enableDeep) { return inputData || {}; }\nconst urls = inputData?.landing_urls || [];\nif (urls.length === 0) { return { ...inputData, conversion_events: [], crawl_status: 'skipped_no_urls', urls_crawled: 0 }; }\nconst ctaRx = /(?:book|call|quote|free|consult|demo|trial|start|get\\s*started|sign\\s*up|contact|schedule|request|enquir|apply|download)/i;\nconst crawlOne = async (url) => { try { const ctrl = new AbortController(); const tid = setTimeout(() => ctrl.abort(), 10000); const resp = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BellaBot/1.0)' }, redirect: 'follow' }); clearTimeout(tid); if (!resp.ok) return null; const html = (await resp.text()).slice(0, 50000); const forms = (html.match(/<form[^>]*>[\\s\\S]*?<\\/form>/gi) || []).map(f => { const fields = (f.match(/name\\s*=\\s*[\"']([^\"']+)/gi) || []).map(m => m.replace(/name\\s*=\\s*[\"']/i, '')); const hasContact = fields.some(fl => /email|phone|name|message/i.test(fl)); return hasContact ? 'contact form (' + fields.filter(fl => /email|phone|name|message/i.test(fl)).join(', ') + ')' : 'form (' + fields.slice(0, 3).join(', ') + ')'; }).slice(0, 3); const buttons = (html.match(/<(?:button|input[^>]*type\\s*=\\s*[\"']submit[\"'])[^>]*>([^<]*)/gi) || []).map(b => b.replace(/<[^>]+>/g, '').trim()).filter(b => b.length > 1 && b.length < 50).slice(0, 5); const links = (html.match(/<a[^>]*>([^<]{2,40})<\\/a>/gi) || []).map(l => l.replace(/<[^>]+>/g, '').trim()).filter(l => ctaRx.test(l)).slice(0, 5); const has_phone = /href\\s*=\\s*[\"']tel:/i.test(html); const has_chat = /livechat|intercom|drift|tawk|zendesk|hubspot|crisp|olark/i.test(html); return { url, forms, cta_buttons: buttons, cta_links: links, has_phone, has_chat }; } catch (e) { return null; } };\nconst results = (await Promise.all(urls.map(crawlOne))).filter(Boolean);\nreturn { ...inputData, conversion_events: results, crawl_status: results.length === urls.length ? 'done' : 'partial', urls_crawled: results.length };"
        }
      },

      // SG.3: Llama 3.1 8B classification — review themes + job demand signals
      {
        id: "node-classify-deep-ai",
        type: NodeType.TRANSFORM,
        position: { x: 3350, y: 300 },
        config: {
          code: "const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';\nif (!enableDeep) { return inputData || {}; }\nconst reviews = inputData?.reviews_detailed || [];\nconst jobs = inputData?.job_roles || [];\nif (reviews.length === 0 && jobs.length === 0) { return { ...inputData, review_analysis: null, job_analysis: null, business_maturity: null, ai_status: 'skipped_no_data' }; }\nconst reviewSnippets = reviews.slice(0, 5).map(r => r.text.slice(0, 150) + ' [' + r.stars + ' stars]').join('\\n');\nconst jobSnippets = jobs.slice(0, 5).map(j => j.title + (j.description ? ': ' + j.description.slice(0, 100) : '') + (j.salary ? ' (' + j.salary + ')' : '')).join('\\n');\nconst prompt = 'Analyze this business intelligence. Output JSON ONLY, no markdown, no explanation.\\n\\nREVIEWS:\\n' + (reviewSnippets || 'None') + '\\n\\nJOB LISTINGS:\\n' + (jobSnippets || 'None') + '\\n\\nOutput this exact JSON structure:\\n{\"review_analysis\":{\"dominant_theme\":\"string\",\"secondary_theme\":\"string\",\"sentiment_summary\":\"string\",\"notable_quote\":\"best review snippet\"},\"job_analysis\":{\"primary_category\":\"string\",\"demand_signal\":\"string\",\"key_requirements\":[\"string\"],\"is_growth_hiring\":true},\"business_maturity\":\"string\"}';\ntry {\n  const result = await this.env.AI.run('@cf/meta/llama-3.1-8b-instruct', { prompt: prompt, temperature: 0.3, max_tokens: 512 });\n  const text = result?.response || '';\n  const jsonMatch = text.match(/\\{[\\s\\S]*\\}/);\n  const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};\n  return { ...inputData, review_analysis: parsed.review_analysis || null, job_analysis: parsed.job_analysis || null, business_maturity: parsed.business_maturity || null, ai_status: 'success' };\n} catch (e) {\n  return { ...inputData, review_analysis: null, job_analysis: null, business_maturity: null, ai_status: 'failed', ai_error: (e?.message || 'unknown') };\n}"
        }
      },

      // SG.4: Merge all enrichment data into final deep_data JSON for KV
      {
        id: "node-supergod-merge",
        type: NodeType.TRANSFORM,
        position: { x: 3500, y: 300 },
        config: {
          code: "const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';\nif (!enableDeep) { return inputData || {}; }\nconst enrich = _workflowState['node-enrich-extract']?.output || {};\nconst crawl = _workflowState['node-crawl-landings']?.output || {};\nconst classify = _workflowState['node-classify-deep-ai']?.output || {};\nconst base = _workflowState['node-extract-deep']?.output || {};\nlet jobRoles = enrich.job_roles || [];\nif (jobRoles.length > 20) { const clientFacing = ['call_handling', 'sales', 'marketing']; const filtered = jobRoles.filter(j => clientFacing.includes(j.category)).slice(0, 5); jobRoles = filtered.length > 0 ? filtered : jobRoles.slice(0, 5); }\nconst merged = { ...base, enriched: true, ad_campaigns: enrich.ad_campaigns || [], ad_offers: enrich.ad_offers || [], ad_ctas: enrich.ad_ctas || [], conversion_events: crawl.conversion_events || [], job_roles: jobRoles, hiring_categories: enrich.hiring_categories || [], reviews_detailed: enrich.reviews_detailed || [], review_theme_summary: enrich.review_theme_summary || {}, top_review_themes: enrich.top_review_themes || [], review_analysis: classify.review_analysis || null, job_analysis: classify.job_analysis || null, business_maturity: classify.business_maturity || null, linkedin_detail: enrich.linkedin_detail || {}, crawl_status: crawl.crawl_status || 'none', ai_status: classify.ai_status || 'none' };\nconst baseJson = JSON.parse(base.raw_json || '{}');\nconst forKv = { ...baseJson };\n['enriched','ad_campaigns','ad_offers','ad_ctas','conversion_events','job_roles','hiring_categories','reviews_detailed','review_theme_summary','top_review_themes','review_analysis','job_analysis','business_maturity','linkedin_detail','crawl_status','ai_status'].forEach(k => { if (merged[k] !== undefined) forKv[k] = merged[k]; });\nmerged.raw_json = JSON.stringify(forKv);\nreturn merged;"
        }
      },

      // SG.5: Quality gate — validate enriched output, fallback to shallow if broken
      {
        id: "node-deep-quality-gate",
        type: NodeType.TRANSFORM,
        position: { x: 3650, y: 300 },
        config: {
          code: "const enableDeep = this.env.ENABLE_DEEP_MAX === 'true';\nif (!enableDeep) { return inputData || {}; }\nconst d = inputData || {};\nconst fields = { ad_campaigns: (d.ad_campaigns?.length || 0) > 0, ad_offers: (d.ad_offers?.length || 0) > 0, conversion_events: (d.conversion_events?.length || 0) > 0, job_roles: (d.job_roles?.length || 0) > 0, reviews_detailed: (d.reviews_detailed?.length || 0) > 0, review_analysis: !!d.review_analysis, job_analysis: !!d.job_analysis, linkedin_detail: !!(d.linkedin_detail?.employees || d.linkedin_detail?.founded) };\nconst populated = Object.values(fields).filter(Boolean).length;\nconst total = Object.keys(fields).length;\nconst score = Math.round((populated / total) * 100) / 100;\nconst missing = Object.entries(fields).filter(([, v]) => !v).map(([k]) => k);\nconsole.log('[SUPERGOD] score=' + score + ' ads=' + (d.ad_campaigns?.length || 0) + ' jobs=' + (d.job_roles?.length || 0) + ' reviews=' + (d.reviews_detailed?.length || 0) + ' landings=' + (d.conversion_events?.length || 0) + ' ai=' + (d.ai_status || 'none'));\nif (d.enriched !== true) { console.log('[SUPERGOD] FALLBACK - enriched flag missing'); const shallow = _workflowState['node-extract-deep']?.output || {}; return { ...shallow, supergod_quality: { score: 0, status: 'fallback', reason: 'enriched_flag_missing' } }; }\nreturn { ...d, supergod_quality: { score, fields_populated: populated, total_fields: total, missing_fields: missing } };"
        }
      },

      {
        id: "node-kv-deep-flags",
        type: NodeType.KV_PUT,
        position: { x: 3800, y: 300 },
        config: {
          namespace: "WORKFLOWS_KV",
          key: "lead:{{node-entry.lid}}:deep_flags",
          value: "{{node-deep-quality-gate.raw_json}}",
          options: { expirationTtl: 3600 }
        }
      },

      // ═══════════════════════════════════════════════════════════════════════
      // CHUNK B: Embed deep-intel vectors (additive, gated by ENABLE_EMBEDDING)
      // Flow: node-kv-deep-flags → node-embed-deep-intel → node-kv-get-deep
      // ═══════════════════════════════════════════════════════════════════════
      {
        id: "node-embed-deep-intel",
        type: NodeType.TRANSFORM,
        position: { x: 3900, y: 300 },
        config: {
          code: `
// ── Chunk B: Embed deep-intel flags via Gemini text-embedding-004 ──
// Gated by ENABLE_EMBEDDING env var — skips silently if not set
if (!this.env.ENABLE_EMBEDDING || this.env.ENABLE_EMBEDDING !== 'true') {
  return { embedded: false, skipped: true };
}

try {
  // Read deep_flags written by node-kv-deep-flags
  const rawVal = _workflowState['node-kv-deep-flags']?.output?.value
    || _workflowState['node-deep-quality-gate']?.output?.raw_json
    || '';

  const text = typeof rawVal === 'string' ? rawVal : JSON.stringify(rawVal);

  if (!text || text.length < 20) {
    return { embedded: false, error: 'insufficient_text', len: text.length };
  }

  // Chunk on sentence boundaries if >2000 chars
  const chunks = [];
  if (text.length <= 2000) {
    chunks.push(text);
  } else {
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= 2000) {
        chunks.push(remaining);
        break;
      }
      // Find last sentence boundary within 2000 chars
      const slice = remaining.slice(0, 2000);
      const lastDot = slice.lastIndexOf('. ');
      const lastComma = slice.lastIndexOf(', ');
      const boundary = lastDot > 500 ? lastDot + 2 : (lastComma > 500 ? lastComma + 2 : 2000);
      chunks.push(remaining.slice(0, boundary));
      remaining = remaining.slice(boundary);
    }
  }

  const lid = _workflowState['node-entry']?.output?.lid || 'unknown';
  const apiKey = this.env.GEMINI_API_KEY;
  const vectors = [];

  for (const chunk of chunks) {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/text-embedding-004',
          content: { parts: [{ text: chunk }] },
          taskType: 'RETRIEVAL_DOCUMENT'
        })
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      return { embedded: false, error: 'gemini_' + res.status, detail: errText.slice(0, 200), chunks_done: vectors.length };
    }

    const data = await res.json();
    const vec = data?.embedding?.values;
    if (!vec || !Array.isArray(vec) || vec.length === 0) {
      return { embedded: false, error: 'no_vector_chunk_' + vectors.length };
    }
    vectors.push(vec);
  }

  // Store all vectors in LEADS_KV as lead:{lid}:deep_vector
  const kvPayload = JSON.stringify({ v: vectors, chunks: vectors.length, dim: vectors[0].length, ts: new Date().toISOString() });
  await this.env.LEADS_KV.put('lead:' + lid + ':deep_vector', kvPayload, { expirationTtl: 3600 });

  return { embedded: true, chunks: vectors.length, dimension: vectors[0].length };

} catch (e) {
  // Never throw — fallback gracefully
  return { embedded: false, error: e.message || 'unknown_error' };
}
`
        }
      },

      {
        id: "node-kv-get-deep",
        type: NodeType.KV_GET,
        position: { x: 1800, y: 150 },
        config: {
          namespace: "WORKFLOWS_KV",
          key: "lead:{{node-entry.lid}}:deep_flags",
          type: "json"
        }
      },
      {
        id: "node-consultant-ai-v2",
        type: NodeType.WORKERS_AI,
        position: { x: 2050, y: 150 },
        config: {
          model: "@cf/meta/llama-3.1-8b-instruct",
          prompt: "The business name is {{node-entry.name}}. Using this deep intelligence about the prospect's business (Google Maps reviews, ads activity, hiring signals, LinkedIn profile):\n\n{{node-kv-get-deep.value}}\n\nOutput one polished paragraph of flattery and insight. Reference their Google rating, reviews, ad campaigns, hiring growth, or LinkedIn presence where available. Focus on their reputation, market activity, and growth trajectory. Always use the business name naturally the way a human would say it in conversation — e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Absolutely no criticism, no fixes, no negativity. Pure positive positioning. One paragraph only, written as natural speech.",
          temperature: 0.7
        }
      },
      // Build intel JSON safely (avoids broken JSON from unescaped AI text)
      {
        id: "node-build-intel-json",
        type: NodeType.TRANSFORM,
        position: { x: 2300, y: 150 },
        config: {
          code: "const summary = inputData.text || ''; const deepVal = {{node-kv-get-deep.value}} || {}; return { json: JSON.stringify({ summary, deep_data: deepVal }) };"
        }
      },
      {
        id: "node-kv-write-intel",
        type: NodeType.KV_PUT,
        position: { x: 2450, y: 150 },
        config: {
          namespace: "WORKFLOWS_KV",
          key: "lead:{{node-entry.lid}}:intel",
          value: "{{node-build-intel-json.json}}",
          options: { expirationTtl: 3600 }
        }
      },

      // ═══════════════════════════════════════════════════════════════════════
      // CHUNK 5: Stage 2 — Apify Findings & Clarify
      // Flow: wait-deep-ready → read deep_flags KV → AI flattery (Llama 70B)
      //       → AI clarify questions → build payload → write intel+conv_memory
      //       → Gemini polish → write stage2_snippet → signal stage-ready
      // ═══════════════════════════════════════════════════════════════════════

      // C5.1: Wait for Bridge DO to signal deep-ready (call progressed enough)
      {
        id: "node-s2-wait-deep-ready",
        type: NodeType.WAIT_EVENT,
        position: { x: 2700, y: 450 },
        config: {
          eventType: "deep-ready",
          timeout: { value: 3, unit: "minutes" },
          timeoutBehavior: "continue"
        }
      },

      // C5.2: Re-read deep_flags from KV (replay-safe after waitForEvent boundary)
      {
        id: "node-s2-kv-get-deep",
        type: NodeType.KV_GET,
        position: { x: 2950, y: 450 },
        config: {
          namespace: "WORKFLOWS_KV",
          key: "lead:{{node-entry.lid}}:deep_flags",
          type: "json"
        }
      },

      // C5.3: Flattery on deep_flags — industry-mirrored, pure positive (Llama 3.1 70B)
      {
        id: "node-s2-ai-flattery",
        type: NodeType.WORKERS_AI,
        position: { x: 3200, y: 450 },
        config: {
          model: "@cf/meta/llama-3.1-70b-instruct",
          prompt: "You are writing a findings paragraph for Bella, Strategic Intel Director at Pillar and Post. The prospect's business name is {{node-entry.name}}.\n\nUsing this deep intelligence data about the prospect's business:\n\n{{node-s2-kv-get-deep.value}}\n\nWrite one polished paragraph (4-6 sentences) of genuine flattery and market insight based ONLY on the data provided. Lead with 'a few things stood out straight away' from the data. Reference these signals where available:\n- Google Maps rating and review volume (e.g. 'Your 4.8 rating from over 200 reviews shows your reputation is a real strength'). When quoting or referencing a specific review snippet, ALWAYS include the reviewer\\'s FULL NAME (first and last) from the data (e.g., 'one reviewer, Michael Thompson, said [snippet]'). Never quote a review anonymously or with first name only.\n- Facebook/Google ad activity (e.g. 'I see you're running targeted ads on Facebook and Google, which tells me you're serious about growth')\n- LinkedIn profile and employee count (e.g. 'With a team of 50 on LinkedIn, it's clear you're scaling operations effectively')\n- Hiring signals from Indeed (e.g. 'The active job postings on Indeed suggest demand is surging ahead of capacity')\n\nSUPERGOD specifics — when these fields exist in the data, use them for MAXIMUM personalization:\n- If ad_campaigns with offers exist: name the SPECIFIC offer and CTA (e.g., 'your \"Free Audit\" campaign on Facebook with a \"Book Now\" call-to-action tells me you know how to drive targeted leads')\n- If job_roles exist: name the SPECIFIC role, department, and requirements (e.g., 'hiring for a Senior Accountant with CPA qualifications in tax advisory tells me client demand is surging ahead of capacity')\n- If review_analysis.dominant_theme exists: reference it (e.g., 'reviewers keep highlighting your responsiveness and personal attention — that reputation is gold')\n- If review_analysis.notable_quote exists: weave it in naturally and ALWAYS attribute by FULL NAME — first and last (e.g., 'one of your recent reviewers, Sarah Mitchell, said [quote] — that says everything'). The reviewer full name is in reviews_detailed[].author — never quote a review without the full name.\n- If linkedin_detail.founded exists: reference longevity (e.g., 'established since 2005 with a team of 50 specialising in tax advisory — that stability speaks volumes')\n- If conversion_events show forms/CTAs: reference them (e.g., 'your \"Get Your Free Quote\" landing page shows you understand conversion')\n- If reviews_detailed show owner_replied=true: mention engagement (e.g., 'I noticed you actively respond to reviews, which shows you genuinely care')\nFall back to generic signals gracefully if these fields are missing.\n\nIndustry mirroring — match the language to their sector (e.g., legal: clients/matters; medical: patients/appointments; trades: jobs/callouts; finance: policyholders/quotes).\n\nNaming rules: Use the full business name '{{node-entry.name}}' exactly on first reference. Shorten only if natural and accurate for subsequent mentions (e.g., 'McDonald Brothers' first, then 'McDonald\\'s' if common; never possessives like 'McDonald\\'s' unless original; avoid errors like 'Pitcher\\'s' for 'Pitcher Partners'—use 'Pitcher Partners' or 'Pitcher' if conversational).\n\nRules: Pure positive — highlight strengths only, no criticism/gaps/fixes. End by connecting to pre-training: 'This is exactly the kind of business intelligence we\\'ve already used to pre-train your AI team, so they feel like they\\'ve been inside [business_name] for years.' No 'As an AI'. Write as natural spoken dialogue only.",
          temperature: 0.7,
          maxTokens: 512
        }
      },

      // C5.4: Generate clarification questions based on channel trigger matrix (Llama 3.1 70B)
      {
        id: "node-s2-ai-clarify",
        type: NodeType.WORKERS_AI,
        position: { x: 3450, y: 450 },
        config: {
          model: "@cf/meta/llama-3.1-70b-instruct",
          prompt: "You are generating targeted clarification questions for Bella, Strategic Intel Director at Pillar and Post. The prospect's business name is {{node-entry.name}} and their first name is {{node-entry.firstName}}.\n\nHere is the deep intelligence data:\n{{node-s2-kv-get-deep.value}}\n\nAnd here are the flattery findings:\n{{node-s2-ai-flattery.text}}\n\nBased on the data, determine which channels are triggered:\n1. WEBSITE — always triggered\n2. PHONE — if the business has a visible phone number, Google listing, or contact page\n3. ADS — if facebook_ads count > 0 OR google_ads count > 0 (HIGHEST PRIORITY)\n4. OLD LEADS — if the business appears established (3+ years based on review history or LinkedIn)\n5. REVIEWS — if Google Maps reviews exist with a rating\n\nGenerate exactly 2-3 targeted questions that:\n- Ask about their CURRENT situation for the triggered channels\n- Mirror their industry language (legal=clients/matters, medical=patients/appointments, trades=jobs/callouts, etc.)\n- Are designed to uncover pain points without being negative\n- Reference specific data points from the intelligence where possible\n\nSUPERGOD specifics — when granular data exists, make questions hyper-targeted:\n- If ad_campaigns with specific offers exist: ask about THAT offer\\'s performance (e.g., 'I see you\\'re running a \"Free Audit\" campaign on Facebook — how many leads is that generating each week?')\n- If ad_ctas include 'book now' or 'call now': ask about conversion from those CTAs specifically\n- If job_roles with specific titles exist: reference the SPECIFIC role (e.g., 'I noticed you\\'re hiring for a Senior Accountant — is that because client demand is growing faster than your team can handle?')\n- If job_analysis.demand_signal exists: reference it\n- If top_review_themes show specific strengths: reference them with reviewer FULL NAMES (first and last) where available (e.g., 'Reviewers like Sarah Mitchell and Michael Chen keep mentioning how responsive your team is — are you finding it harder to maintain that as you grow?')\n- If conversion_events show multiple forms/CTAs: ask about which converts best\nFall back to generic channel questions if granular fields are missing.\n\nFormat: Output ONLY the questions as natural spoken dialogue, numbered 1-3. Each question should be 1-2 sentences. No preamble, no labels, no stage directions.",
          temperature: 0.7,
          maxTokens: 512
        }
      },

      // C5.5: Build combined payload — detect channels, assemble intel + conv_memory JSON
      {
        id: "node-s2-build-payload",
        type: NodeType.TRANSFORM,
        position: { x: 3700, y: 450 },
        config: {
          code: "const flattery = _workflowState['node-s2-ai-flattery']?.output?.text || '';\nconst questions = _workflowState['node-s2-ai-clarify']?.output?.text || '';\nconst deepData = _workflowState['node-s2-kv-get-deep']?.output?.value || {};\nconst channelsTriggered = ['website'];\nif (deepData.google_maps && (deepData.google_maps.totalScore || deepData.google_maps.reviewsCount)) channelsTriggered.push('reviews');\nif ((deepData.fb_ads_count || 0) > 0 || (deepData.google_ads_count || 0) > 0) channelsTriggered.push('ads');\nif (deepData.linkedin && (deepData.linkedin.employeeCount || 0) > 10) channelsTriggered.push('old_leads');\nchannelsTriggered.push('phone');\nconst intelPayload = JSON.stringify({ stage2_flattery: flattery, stage2_questions: questions, channels_triggered: channelsTriggered, deep_data: deepData });\nconst convMemoryPayload = JSON.stringify({ stage2_findings: flattery, stage2_clarify_questions: questions, channels: channelsTriggered });\nreturn { intel_json: intelPayload, conv_memory_json: convMemoryPayload, combined_snippet: flattery + '\\n\\n' + questions };"
        }
      },

      // C5.6: Scribe 'update-kv' — write intel + conv_memory to KV (dual write via TRANSFORM)
      {
        id: "node-s2-kv-write-stage2",
        type: NodeType.TRANSFORM,
        position: { x: 3950, y: 450 },
        config: {
          code: "const lid = _workflowState['node-entry']?.output?.lid || '';\nconst payload = _workflowState['node-s2-build-payload']?.output || {};\nawait this.env.WORKFLOWS_KV.put('lead:' + lid + ':intel', payload.intel_json, { expirationTtl: 3600 });\nawait this.env.WORKFLOWS_KV.put('lead:' + lid + ':conv_memory', payload.conv_memory_json, { expirationTtl: 3600 });\nreturn { success: true, keys_written: ['intel', 'conv_memory'] };"
        }
      },

      // C5.7: Gemini polish — natural voice warmth for Stage 2 snippet
      // NOTE: inputData is from node-s2-kv-write-stage2 (success/keys_written),
      //       so we read combined_snippet from _workflowState directly
      {
        id: "node-s2-gemini-polish",
        type: NodeType.TRANSFORM,
        position: { x: 4200, y: 450 },
        config: {
          code: "const geminiKey = this.env.GEMINI_API_KEY;\nconst rawSnippet = _workflowState['node-s2-build-payload']?.output?.combined_snippet || '';\nif (!geminiKey) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'no_key' }; }\nif (!rawSnippet || rawSnippet.length < 10) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'skipped_empty' }; }\nconst resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'You are Bella, a confident, warm female strategic advisor. This is a findings and questions script for a prospect call. Polish it so every word sounds like natural spoken conversation. Contractions always. Natural rhythm and flow. Shorten any business name to how a human would say it aloud only if accurate and natural—verify and correct any errors (e.g., fix \\'Pitcher\\'s\\' to \\'Pitcher Partners\\' or \\'Pitcher\\' if appropriate). Ensure facts from the data are accurate—no inaccuracies. The findings paragraph should flow directly into the questions — no awkward transitions. Keep meaning and structure identical. Do not remove any sentences. Output ONLY the polished dialogue:\\n\\n' + rawSnippet }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 4096 } }) });\nconst geminiJson = await resp.json();\nconst polished = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || rawSnippet;\nreturn { text: polished, raw: rawSnippet, gemini_status: resp.status };"
        }
      },

      // C5.8: Write Gemini-polished Stage 2 snippet to KV — Bridge reads this
      {
        id: "node-s2-kv-write-snippet",
        type: NodeType.KV_PUT,
        position: { x: 4450, y: 450 },
        config: {
          namespace: "WORKFLOWS_KV",
          key: "lead:{{node-entry.lid}}:stage2_snippet",
          value: "{{node-s2-gemini-polish.text}}",
          options: { expirationTtl: 3600 }
        }
      },

      // C5.9: Signal stage-ready — write stage2_ready flag to KV for Bridge DO
      {
        id: "node-signal-update-kv",
        type: NodeType.TRANSFORM,
        position: { x: 4700, y: 450 },
        config: {
          code: "const lid = _workflowState['node-entry']?.output?.lid || '';\nawait this.env.WORKFLOWS_KV.put('lead:' + lid + ':stage2_ready', JSON.stringify({ ready: true, ts: Date.now() }), { expirationTtl: 3600 });\nreturn { signal: 'stage-ready', status: 'stage2-complete', lid: lid };"
        }
      },
      // ═══════════════════════════════════════════════════════════════════════
      // CHUNK 6: Stage 3 — ROI Calculation & Numbers Presentation
      // Flow: wait-numbers-captured → read captured_inputs + deep_flags + conv_memory
      //       → calculate ROI → AI narrative (Llama 70B) → AI channel recs
      //       → build payload → write ROI to KV → Gemini polish
      //       → write stage3_snippet → write stage3_ready → signal complete
      // ═══════════════════════════════════════════════════════════════════════

      // C6.1: Wait for Bridge DO to signal numbers-captured (prospect shared revenue/calls/etc)
      {
        id: "node-s3-wait-numbers",
        type: NodeType.WAIT_EVENT,
        position: { x: 2700, y: 600 },
        config: {
          eventType: "numbers-captured",
          timeout: { value: 5, unit: "minutes" },
          timeoutBehavior: "continue"
        }
      },

      // C6.2: Read captured_inputs from KV (revenue, call volume, ad spend, etc)
      {
        id: "node-s3-kv-get-captured",
        type: NodeType.KV_GET,
        position: { x: 2950, y: 600 },
        config: {
          namespace: "LEADS_KV",
          key: "lead:{{node-entry.lid}}:captured_inputs",
          type: "json"
        }
      },

      // C6.3: Re-read deep_flags for channel data (replay-safe after waitForEvent)
      {
        id: "node-s3-kv-get-deep",
        type: NodeType.KV_GET,
        position: { x: 2950, y: 700 },
        config: {
          namespace: "LEADS_KV",
          key: "lead:{{node-entry.lid}}:deep_flags",
          type: "json"
        }
      },

      // C6.4: Read conv_memory for conversation context
      {
        id: "node-s3-kv-get-conv",
        type: NodeType.KV_GET,
        position: { x: 2950, y: 800 },
        config: {
          namespace: "LEADS_KV",
          key: "lead:{{node-entry.lid}}:conv_memory",
          type: "json"
        }
      },

      // C6.5: Calculate ROI from captured inputs — pure math, no AI
      {
        id: "node-s3-calc-roi",
        type: NodeType.TRANSFORM,
        position: { x: 3200, y: 600 },
        config: {
          code: "const captured = _workflowState['node-s3-kv-get-captured']?.output?.value || {};\nconst deep = _workflowState['node-s3-kv-get-deep']?.output?.value || {};\nconst rev = parseFloat(captured.monthly_revenue || captured.revenue || 0);\nconst calls = parseInt(captured.monthly_calls || captured.calls_per_week * 4.3 || 0);\nconst adSpend = parseFloat(captured.monthly_ad_spend || captured.ad_spend || 0);\nconst missedPct = parseFloat(captured.missed_call_pct || 30) / 100;\nconst closeRate = parseFloat(captured.close_rate || 25) / 100;\nconst avgJobVal = rev > 0 && calls > 0 ? rev / (calls * closeRate || 1) : parseFloat(captured.avg_job_value || 500);\nconst missedCalls = Math.round(calls * missedPct);\nconst recoverableCalls = Math.round(missedCalls * 0.7);\nconst recoveredRev = Math.round(recoverableCalls * closeRate * avgJobVal);\nconst adWaste = adSpend > 0 ? Math.round(adSpend * missedPct) : 0;\nconst speedToLeadLift = adSpend > 0 ? Math.round(adSpend * 0.15) : 0;\nconst totalAnnualROI = (recoveredRev + adWaste + speedToLeadLift) * 12;\nconst channels = deep.channels_triggered || [];\nconst hasAds = channels.includes('ads') || (deep.fb_ads_count || 0) > 0 || (deep.google_ads_count || 0) > 0;\nconst hasReviews = channels.includes('reviews') || (deep.review_count || 0) > 0;\nreturn { rev, calls, adSpend, missedCalls, recoverableCalls, recoveredRev, adWaste, speedToLeadLift, avgJobVal, totalAnnualROI, hasAds, hasReviews, channels, closeRate: Math.round(closeRate * 100), missedPct: Math.round(missedPct * 100) };"
        }
      },

      // C6.6: AI ROI narrative — weave numbers into compelling story (Llama 3.1 70B)
      {
        id: "node-s3-ai-roi-narrative",
        type: NodeType.WORKERS_AI,
        position: { x: 3450, y: 600 },
        config: {
          model: "@cf/meta/llama-3.1-70b-instruct",
          prompt: "You are writing the Stage 3 ROI presentation script for Bella, Strategic Intel Director at Pillar and Post. The prospect's first name is {{node-entry.firstName}}. Their business is {{node-entry.name}}.\n\nHere are the calculated ROI numbers:\n{{node-s3-calc-roi}}\n\nAnd here is the deep intelligence:\n{{node-s3-kv-get-deep.value}}\n\nConversation context so far:\n{{node-s3-kv-get-conv.value}}\n\nWrite Bella's ROI presentation (30-45 seconds spoken). Structure:\n1) Transition: 'So based on what you've shared with me, {{node-entry.firstName}}, let me show you exactly what we're looking at.'\n2) Mirror back THEIR numbers naturally — monthly calls, revenue, missed call percentage — so they feel heard.\n3) Present the recoverable revenue: missed calls x close rate x avg job value. Use their exact numbers. Say the dollar figure confidently.\n4) If they're running ads: mention the ad waste from missed calls on paid traffic. 'You're spending $X on ads but missing Y% of those calls — that's $Z going straight down the drain every month.'\n5) Total annual ROI figure — say it as a single powerful number.\n6) Close with: 'And that's a conservative estimate — we haven't even factored in speed-to-lead improvements or after-hours recovery.'\n\nRules: Use ONLY the numbers from the ROI data — never invent figures. If a number is 0 or missing, skip that line gracefully. Use the business name naturally (shorten if conversational). Confident, warm, consultative tone. No 'As an AI'. Write as spoken dialogue only, no labels or stage directions. 4-6 sentences max.",
          temperature: 0.6,
          maxTokens: 512
        }
      },

      // C6.7: AI channel-specific recommendations based on triggered channels (Llama 3.1 70B)
      {
        id: "node-s3-ai-channel-recs",
        type: NodeType.WORKERS_AI,
        position: { x: 3700, y: 600 },
        config: {
          model: "@cf/meta/llama-3.1-70b-instruct",
          prompt: "You are writing channel-specific AI team recommendations for Bella, Strategic Intel Director at Pillar and Post. The prospect's first name is {{node-entry.firstName}}. Their business is {{node-entry.name}}.\n\nROI data:\n{{node-s3-calc-roi}}\n\nDeep intelligence:\n{{node-s3-kv-get-deep.value}}\n\nBased on the triggered channels and data, write 2-3 sentences that connect the ROI to SPECIFIC AI team members. Use this mapping:\n- PHONE/missed calls: 'Your AI receptionist catches every call — even at 2am on a Sunday'\n- ADS/ad spend: 'Your AI speed-to-lead agent responds to ad enquiries in under 60 seconds — before they click on a competitor'\n- REVIEWS: 'Your AI reputation manager follows up every job with a review request, building on that rating'\n- OLD LEADS/database: 'Your AI reactivation agent re-engages every dormant lead in your database with personalised outreach'\n- WEBSITE: 'Your AI webchat agent captures enquiries 24/7 and books them straight into your calendar'\n\nOnly mention channels that have data. Mirror their industry language. Confident and specific. Write as natural spoken dialogue — no bullets, no labels. 2-3 sentences max.",
          temperature: 0.6,
          maxTokens: 256
        }
      },

      // C6.8: Build combined Stage 3 payload — ROI + recs + snippet
      {
        id: "node-s3-build-payload",
        type: NodeType.TRANSFORM,
        position: { x: 3950, y: 600 },
        config: {
          code: "const roi = _workflowState['node-s3-calc-roi']?.output || {};\nconst narrative = _workflowState['node-s3-ai-roi-narrative']?.output?.text || '';\nconst recs = _workflowState['node-s3-ai-channel-recs']?.output?.text || '';\nconst captured = _workflowState['node-s3-kv-get-captured']?.output?.value || {};\nconst roiPayload = JSON.stringify({ roi_numbers: roi, captured_inputs: captured, narrative, channel_recs: recs });\nconst combinedSnippet = narrative + '\\n\\n' + recs;\nreturn { roi_json: roiPayload, combined_snippet: combinedSnippet, narrative, recs };"
        }
      },

      // C6.9: Write ROI data to KV — bridge + tools can read this
      {
        id: "node-s3-kv-write-roi",
        type: NodeType.KV_PUT,
        position: { x: 4200, y: 600 },
        config: {
          namespace: "LEADS_KV",
          key: "lead:{{node-entry.lid}}:roi_data",
          value: "{{node-s3-build-payload.roi_json}}",
          options: { expirationTtl: 3600 }
        }
      },

      // C6.10: Gemini polish — natural voice warmth for Stage 3 ROI script
      {
        id: "node-s3-gemini-polish",
        type: NodeType.TRANSFORM,
        position: { x: 4450, y: 600 },
        config: {
          code: "const geminiKey = this.env.GEMINI_API_KEY;\nconst rawSnippet = _workflowState['node-s3-build-payload']?.output?.combined_snippet || '';\nif (!geminiKey) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'no_key' }; }\nif (!rawSnippet || rawSnippet.length < 10) { return { text: rawSnippet, raw: rawSnippet, gemini_status: 'skipped_empty' }; }\nconst resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + geminiKey, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'You are Bella, a confident, warm female strategic advisor presenting ROI numbers to a prospect. Polish this script so every word sounds like natural spoken conversation. Contractions always. The numbers must remain EXACTLY as written — do not round, change, or recalculate any figures. Natural rhythm — pause-worthy moments before big numbers. Shorten business names to how a human would say them aloud. Remove stiff language. Keep meaning and structure identical. Output ONLY the polished dialogue:\\n\\n' + rawSnippet }] }], generationConfig: { temperature: 0.7, maxOutputTokens: 4096 } }) });\nconst geminiJson = await resp.json();\nconst polished = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || rawSnippet;\nreturn { text: polished, raw: rawSnippet, gemini_status: resp.status };"
        }
      },

      // C6.11: Write polished Stage 3 snippet to KV — Bridge reads this
      {
        id: "node-s3-kv-write-snippet",
        type: NodeType.KV_PUT,
        position: { x: 4700, y: 600 },
        config: {
          namespace: "LEADS_KV",
          key: "lead:{{node-entry.lid}}:stage3_snippet",
          value: "{{node-s3-gemini-polish.text}}",
          options: { expirationTtl: 3600 }
        }
      },

      // C6.12: Write stage3_ready flag to KV for Bridge DO
      {
        id: "node-s3-kv-write-ready",
        type: NodeType.KV_PUT,
        position: { x: 4950, y: 600 },
        config: {
          namespace: "LEADS_KV",
          key: "lead:{{node-entry.lid}}:stage3_ready",
          value: "{\"ready\": true}",
          options: { expirationTtl: 3600 }
        }
      },

      // C6.13: Write stage3_complete signal to KV for orchestrator
      {
        id: "node-s3-signal-complete",
        type: NodeType.KV_PUT,
        position: { x: 5200, y: 600 },
        config: {
          namespace: "LEADS_KV",
          key: "lead:{{node-entry.lid}}:stage3_complete",
          value: "{\"complete\": true, \"status\": \"roi-delivered\"}",
          options: { expirationTtl: 3600 }
        }
      },

      {
        id: "node-return",
        type: NodeType.RETURN,
        position: { x: 5400, y: 300 },
        config: {
          value: "{\"status\": \"complete\", \"lid\": \"{{node-entry.lid}}\", \"intel\": \"{{node-consultant-ai-v2.text}}\"}"
        }
      }
    ],
    edges: [
      // ── Linear chain: entry → stub → firecrawl → truncate → fire-apify → consultant → phase_a ──
      { id: "e1", source: "node-entry", target: "node-kv-stub", sourceHandle: "output", targetHandle: "trigger" },
      { id: "e2", source: "node-kv-stub", target: "node-firecrawl", sourceHandle: "output", targetHandle: "trigger" },
      { id: "e3", source: "node-firecrawl", target: "node-truncate-content", sourceHandle: "body", targetHandle: "trigger" },
      { id: "e3b", source: "node-truncate-content", target: "node-fire-apify", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e4", source: "node-fire-apify", target: "node-consultant-ai", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e5", source: "node-consultant-ai", target: "node-kv-phase-a", sourceHandle: "text", targetHandle: "trigger" },
      // ── Chunk A: phase_a → embed → wait ──
      { id: "e6a", source: "node-kv-phase-a", target: "node-embed-fast-intel", sourceHandle: "output", targetHandle: "trigger" },
      { id: "e6b", source: "node-embed-fast-intel", target: "node-wait-call-connected", sourceHandle: "result", targetHandle: "trigger" },
      // ── Chunk 4: wait → fast KV → WOW → Gemini → write snippet ──
      { id: "e7", source: "node-wait-call-connected", target: "node-kv-get-fast", sourceHandle: "event", targetHandle: "trigger" },
      { id: "e8", source: "node-kv-get-fast", target: "node-ai-refine-wow", sourceHandle: "value", targetHandle: "trigger" },
      { id: "e9", source: "node-ai-refine-wow", target: "node-gemini-polish", sourceHandle: "text", targetHandle: "trigger" },
      { id: "e10", source: "node-gemini-polish", target: "node-kv-write-snippet", sourceHandle: "result", targetHandle: "trigger" },
      // ── Collect Apify (actors have had 30-60s+ head start) → extract → deep flags KV ──
      { id: "e11", source: "node-kv-write-snippet", target: "node-collect-apify", sourceHandle: "output", targetHandle: "trigger" },
      { id: "e12", source: "node-collect-apify", target: "node-extract-deep", sourceHandle: "result", targetHandle: "trigger" },
      // ── SUPERGOD chain: extract → enrich → crawl → classify → merge → gate → KV ──
      { id: "e13a", source: "node-extract-deep", target: "node-enrich-extract", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e13b", source: "node-enrich-extract", target: "node-crawl-landings", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e13c", source: "node-crawl-landings", target: "node-classify-deep-ai", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e13d", source: "node-classify-deep-ai", target: "node-supergod-merge", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e13e", source: "node-supergod-merge", target: "node-deep-quality-gate", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e13f", source: "node-deep-quality-gate", target: "node-kv-deep-flags", sourceHandle: "result", targetHandle: "trigger" },
      // ── Chunk B: deep-flags → embed → read-back ──
      { id: "e14a", source: "node-kv-deep-flags", target: "node-embed-deep-intel", sourceHandle: "output", targetHandle: "trigger" },
      { id: "e14b", source: "node-embed-deep-intel", target: "node-kv-get-deep", sourceHandle: "result", targetHandle: "trigger" },
      // ── Deep intel processing → write intel → signal → return ──
      { id: "e15", source: "node-kv-get-deep", target: "node-consultant-ai-v2", sourceHandle: "value", targetHandle: "trigger" },
      { id: "e16", source: "node-consultant-ai-v2", target: "node-build-intel-json", sourceHandle: "text", targetHandle: "trigger" },
      { id: "e17", source: "node-build-intel-json", target: "node-kv-write-intel", sourceHandle: "result", targetHandle: "trigger" },
      // ── CHUNK 5: Stage 2 (Apify Findings + Clarify) ──
      { id: "e20", source: "node-kv-write-intel", target: "node-s2-wait-deep-ready", sourceHandle: "output", targetHandle: "trigger" },
      { id: "e21", source: "node-s2-wait-deep-ready", target: "node-s2-kv-get-deep", sourceHandle: "event", targetHandle: "trigger" },
      { id: "e22", source: "node-s2-kv-get-deep", target: "node-s2-ai-flattery", sourceHandle: "value", targetHandle: "trigger" },
      { id: "e23", source: "node-s2-ai-flattery", target: "node-s2-ai-clarify", sourceHandle: "text", targetHandle: "trigger" },
      { id: "e24", source: "node-s2-ai-clarify", target: "node-s2-build-payload", sourceHandle: "text", targetHandle: "trigger" },
      { id: "e25", source: "node-s2-build-payload", target: "node-s2-kv-write-stage2", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e26", source: "node-s2-kv-write-stage2", target: "node-s2-gemini-polish", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e27", source: "node-s2-gemini-polish", target: "node-s2-kv-write-snippet", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e28", source: "node-s2-kv-write-snippet", target: "node-signal-update-kv", sourceHandle: "output", targetHandle: "trigger" },
      // ── CHUNK 6: Stage 3 (ROI Calculation & Numbers) ──
      { id: "e19", source: "node-signal-update-kv", target: "node-s3-wait-numbers", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e30", source: "node-s3-wait-numbers", target: "node-s3-kv-get-captured", sourceHandle: "event", targetHandle: "trigger" },
      { id: "e31", source: "node-s3-kv-get-captured", target: "node-s3-kv-get-deep", sourceHandle: "value", targetHandle: "trigger" },
      { id: "e32", source: "node-s3-kv-get-deep", target: "node-s3-kv-get-conv", sourceHandle: "value", targetHandle: "trigger" },
      { id: "e33", source: "node-s3-kv-get-conv", target: "node-s3-calc-roi", sourceHandle: "value", targetHandle: "trigger" },
      { id: "e34", source: "node-s3-calc-roi", target: "node-s3-ai-roi-narrative", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e35", source: "node-s3-ai-roi-narrative", target: "node-s3-ai-channel-recs", sourceHandle: "text", targetHandle: "trigger" },
      { id: "e36", source: "node-s3-ai-channel-recs", target: "node-s3-build-payload", sourceHandle: "text", targetHandle: "trigger" },
      { id: "e37", source: "node-s3-build-payload", target: "node-s3-kv-write-roi", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e38", source: "node-s3-kv-write-roi", target: "node-s3-gemini-polish", sourceHandle: "output", targetHandle: "trigger" },
      { id: "e39", source: "node-s3-gemini-polish", target: "node-s3-kv-write-snippet", sourceHandle: "result", targetHandle: "trigger" },
      { id: "e40", source: "node-s3-kv-write-snippet", target: "node-s3-kv-write-ready", sourceHandle: "output", targetHandle: "trigger" },
      { id: "e41", source: "node-s3-kv-write-ready", target: "node-s3-signal-complete", sourceHandle: "output", targetHandle: "trigger" },
      { id: "e42", source: "node-s3-signal-complete", target: "node-return", sourceHandle: "output", targetHandle: "trigger" },
    ]
  }
};
