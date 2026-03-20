/**
 * fast-intel-sandbox  v9.0.0
 *
 * NAMING CONVENTION (use these everywhere in logs/comments):
 *   fast-intel     = This worker. Firecrawl full-page scrape + Consultant Gemini. ~8-12s.
 *   apify-intel    = deep-scrape-workflow-sandbox. 5 Apify actors concurrent. ~30-45s.
 *   full-scrape    = personalisedaidemofinal-sandbox. 110-point pipeline. ~60-120s.
 *
 * PURPOSE:
 *   Gives Bella everything she needs for the WARM WOW before she opens her mouth.
 *   Must complete during the 8s loading animation so Bella has real data at T=0.
 *
 * FLOW:
 *   capture.html form submit
 *     → POST /fast-intel  (this worker, fires immediately)
 *     → POST /trigger on deep-scrape-workflow-sandbox (Apify intel, 30-45s)
 *     → Redirect to loading page (8s animation)
 *   loading-v95.html
 *     → polls GET /status?lid=xxx until fast_intel_done=true OR 10s timeout
 *     → redirects to demo page
 *   demo page opens + guided tour (~15s)
 *   Bella connects (~23s) — fast-intel + apify-intel both done by now
 *   full-scrape continues in background, enriches Bella mid-call
 *
 * ENDPOINTS:
 *   POST /fast-intel   { lid, websiteUrl, firstName, email? }
 *     → Firecrawl scrape + Consultant Gemini call
 *     → Writes to lead:{lid}:intel under fast_intel key
 *     → Returns full intel object
 *
 *   GET  /status?lid=xxx
 *     → Returns { fast_intel_done, apify_done, full_scrape_done, intel_summary }
 */

import { Env, FastIntelResult, ConsultantPayload } from "./types";

export { Env };

const VERSION = "1.10.0"; // Phase D: DO brain event delivery (session_init + fast_intel_ready + consultant_ready)
// KV_TTL removed — data persists permanently

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type":                 "application/json",
};

const log = (tag: string, msg: string) =>
  console.log(`[fast-intel ${VERSION}] [${tag}] ${msg}`);

// ─── Normalise first name (title-case, handle ALL-CAPS) ──────────────────────
function normaliseName(raw: string): string {
  if (!raw?.trim()) return "";
  return raw.trim().toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ─── Normalise URL ────────────────────────────────────────────────────────────
function normaliseUrl(raw: string): string {
  let u = raw.trim();
  if (!u.startsWith("http")) u = "https://" + u;
  return u;
}

// ─── Clean website content for consultant — strip nav/menu/footer boilerplate ─
// The raw markdown from Firecrawl often starts with 2-3k chars of navigation links.
// The consultant needs BODY content: services, about, value props, copy.
function cleanWebsiteContent(raw: string): string {
  let text = raw;

  // If it's HTML, strip tags first
  if (text.includes("<nav") || text.includes("<header")) {
    text = text.replace(/<nav[\s\S]*?<\/nav>/gi, " ");
    text = text.replace(/<header[\s\S]*?<\/header>/gi, " ");
    text = text.replace(/<footer[\s\S]*?<\/footer>/gi, " ");
    text = text.replace(/<script[\s\S]*?<\/script>/gi, " ");
    text = text.replace(/<style[\s\S]*?<\/style>/gi, " ");
    text = text.replace(/<[^>]+>/g, " ");
  }

  // For markdown: strip repeated short lines that look like nav links
  // Nav links in markdown are typically many consecutive short lines (< 60 chars)
  const lines = text.split("\n");
  const cleaned: string[] = [];
  let navStreak = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 60 && trimmed.length > 0 && !trimmed.includes(". ")) {
      navStreak++;
      if (navStreak > 5) continue; // skip after 5+ consecutive short lines (likely nav)
    } else {
      navStreak = 0;
      cleaned.push(line);
    }
  }

  text = cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  // Send up to 40k chars — enough for a full homepage analysis
  return text.substring(0, 40000);
}

// ─── Extract domain ───────────────────────────────────────────────────────────
function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return url; }
}


// ─── Firecrawl: full page scrape ─────────────────────────────────────────────
// Returns rich markdown of the entire homepage — not just h1/meta.
// This is the "Firecrawl intel" layer. ~3-6s.

async function firecrawlScrape(websiteUrl: string, apiKey: string): Promise<{
  markdown: string;
  html: string;
  title: string;
  h1: string;
  h2: string;
  description: string;
  ogTitle: string;
  ogDescription: string;
  ogImage: string;
  links: string[];
  raw_text: string;
} | null> {
  if (!apiKey) { log("FIRECRAWL", "No API key — skipping"); return null; }

  try {
    const t0 = Date.now();
    const abortCtrl = new AbortController();
    const abortTimer = setTimeout(() => abortCtrl.abort(), 12000); // hard kill at 12s
    const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
      method: "POST",
      signal: abortCtrl.signal,
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: websiteUrl,
        formats: ["markdown", "html", "extract", "links"],
        onlyMainContent: false,  // full page, not just article content
        waitFor: 500,
        timeout: 10000,
        extract: {
          schema: {
            type: "object",
            properties: {
              title:          { type: "string" },
              h1:             { type: "string" },
              h2:             { type: "string" },
              description:    { type: "string" },
              phone:          { type: "string" },
              email:          { type: "string" },
              address:        { type: "string" },
              ctas:           { type: "array", items: { type: "string" } },
              services:       { type: "array", items: { type: "string" } },
              key_benefits:   { type: "array", items: { type: "string" } },
              tagline:        { type: "string" },
              target_audience:{ type: "string" },
              has_chat:         { type: "boolean" },
              has_booking:      { type: "boolean" },
              // Tech stack signals — LLM extracts from page copy/scripts/embeds
              crm_name:         { type: "string" },   // e.g. "HubSpot", "Salesforce", "Keap"
              booking_tool:     { type: "string" },   // e.g. "Calendly", "Acuity", "Mindbody"
              chat_tool:        { type: "string" },   // e.g. "Intercom", "Drift", "Tawk.to"
              has_ecommerce:    { type: "boolean" },  // Shopify/WooCommerce/etc
              payment_tool:     { type: "string" },   // e.g. "Stripe", "Square", "PayPal"
              email_tool:       { type: "string" },   // e.g. "Mailchimp", "ActiveCampaign", "Klaviyo"
              has_membership:   { type: "boolean" },  // membership portals, login areas
              has_job_listings: { type: "boolean" },  // hiring signals
            }
          }
        }
      }),
    });

    clearTimeout(abortTimer);
    if (!resp.ok) {
      log("FIRECRAWL", `HTTP ${resp.status} — falling back to null`);
      return null;
    }

    const data = await resp.json() as Record<string, any>;
    const fc = data?.data ?? data;
    const md = fc?.markdown ?? "";
    const html = fc?.html ?? "";
    const meta = fc?.metadata ?? {};
    const extracted = fc?.extract ?? {};

    log("FIRECRAWL", `Done in ${Date.now() - t0}ms — markdown ${md.length} chars, html ${html.length} chars`);

    return {
      markdown:      md,
      html:          html,
      title:         extracted.title   || meta.title        || "",
      h1:            extracted.h1      || meta.ogTitle      || "",
      h2:            extracted.h2      || "",
      description:   extracted.description || meta.description || meta.ogDescription || "",
      ogTitle:       meta.ogTitle      || "",
      ogDescription: meta.ogDescription || "",
      ogImage:       meta.ogImage      || "",
      links:         (fc?.links ?? []).slice(0, 20),
      raw_text:      md || html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 8000),
      // Extracted structured fields merged in
      ...(extracted.phone   ? { phone:           extracted.phone }           : {}),
      ...(extracted.email   ? { email_contact:   extracted.email }           : {}),
      ...(extracted.address ? { address:         extracted.address }         : {}),
      ...(extracted.ctas    ? { ctas:            extracted.ctas }            : {}),
      ...(extracted.services ? { services:       extracted.services }        : {}),
      ...(extracted.key_benefits ? { key_benefits: extracted.key_benefits }  : {}),
      ...(extracted.tagline ? { tagline:         extracted.tagline }         : {}),
      ...(extracted.target_audience ? { target_audience: extracted.target_audience } : {}),
      ...(extracted.has_chat    != null ? { has_chat:    extracted.has_chat }    : {}),
      ...(extracted.has_booking != null ? { has_booking: extracted.has_booking } : {}),
      // Full tech stack xray — scanned from raw HTML + LLM extract
      tech_stack: detectTechStack(html, extracted),
    } as any;

  } catch (err: any) {
    if (err?.name === "AbortError") {
      log("FIRECRAWL", "Timed out after 12s — falling back to null");
    } else {
      log("FIRECRAWL", `Exception: ${err}`);
    }
    return null;
  }
}

// ─── ScrapingAnt: fallback scraper when Firecrawl 408s/fails ─────────────────
// Simple HTML fetch — no LLM extraction, but gives us raw page HTML for
// detectTechStack() and basic meta extraction. Better than a stub.
async function scrapingAntFetch(websiteUrl: string, apiKey: string): Promise<string | null> {
  if (!apiKey) { log("SCRAPINGANT", "No key — skipping"); return null; }
  try {
    const t0 = Date.now();
    const antUrl = `https://api.scrapingant.com/v2/general?url=${encodeURIComponent(websiteUrl)}&x-api-key=${apiKey}&render_js=false`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const resp = await fetch(antUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!resp.ok) { log("SCRAPINGANT", `HTTP ${resp.status}`); return null; }
    const html = await resp.text();
    log("SCRAPINGANT", `Done in ${Date.now()-t0}ms — ${html.length} chars`);
    return html.length > 500 ? html : null;
  } catch (err: any) {
    log("SCRAPINGANT", err?.name === "AbortError" ? "Timed out after 20s" : `Error: ${err}`);
    return null;
  }
}

// ─── Direct fetch: bare HTTP GET as last resort before stub ──────────────────
async function directFetch(websiteUrl: string): Promise<string | null> {
  try {
    const t0 = Date.now();
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(websiteUrl, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; Bella/1.0)" },
      redirect: "follow",
    });
    clearTimeout(timer);
    if (!resp.ok) { log("DIRECT", `HTTP ${resp.status}`); return null; }
    const html = await resp.text();
    log("DIRECT", `Done in ${Date.now()-t0}ms — ${html.length} chars`);
    return html.length > 500 ? html : null;
  } catch (err: any) {
    log("DIRECT", err?.name === "AbortError" ? "Timed out after 15s" : `Error: ${err}`);
    return null;
  }
}

// ─── Extract basic meta from raw HTML (used when Firecrawl fails) ────────────
function extractMetaFromHtml(html: string, websiteUrl: string): Record<string, any> {
  const get = (pattern: RegExp) => (html.match(pattern)?.[1] ?? "").replace(/&amp;/g, "&").replace(/&#039;/g, "'").trim();
  return {
    title:          get(/<title[^>]*>([^<]{1,200})<\/title>/i),
    h1:             get(/<h1[^>]*>([^<]{1,200})<\/h1>/i),
    description:    get(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i)
                 || get(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i),
    ogTitle:        get(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i),
    ogDescription:  get(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,300})["']/i),
    ogSiteName:     get(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,200})["']/i),
  };
}

// ─── Extract nav items from HTML/markdown ────────────────────────────────────
function extractNavItems(content: string): string {
  // Try HTML nav extraction first
  const navMatch = content.match(/<nav[\s\S]*?<\/nav>/i);
  if (navMatch) {
    const links = [...navMatch[0].matchAll(/>([^<]{2,40})</g)].map(m => m[1].trim()).filter(Boolean);
    return links.length > 0 ? links.slice(0, 20).join(", ") : "";
  }
  // Markdown: first consecutive short lines are usually nav
  const lines = content.split("\n").map(l => l.trim()).filter(Boolean);
  const navLines: string[] = [];
  for (const line of lines) {
    if (line.length < 50 && !line.includes(". ")) navLines.push(line.replace(/^\[|\].*$/g, ""));
    else break;
    if (navLines.length >= 15) break;
  }
  return navLines.join(", ");
}

// ─── Extract post-H1 content slice for fast consultant read ──────────────────
function extractPostH1Slice(content: string, maxChars: number = 4000): string {
  // Find the H1 position in markdown or HTML
  let h1Pos = -1;
  // Markdown H1: line starting with "# "
  const mdH1 = content.match(/^#\s+.+$/m);
  if (mdH1?.index !== undefined) h1Pos = mdH1.index;
  // HTML H1
  if (h1Pos < 0) {
    const htmlH1 = content.match(/<h1[^>]*>/i);
    if (htmlH1?.index !== undefined) h1Pos = htmlH1.index;
  }
  // Fallback: skip first 500 chars (likely nav junk) and start from there
  if (h1Pos < 0) h1Pos = Math.min(500, content.length);
  return content.slice(h1Pos, h1Pos + maxChars);
}

// ─── Extract JSON-LD org name + footer copyright ─────────────────────────────
function extractBizNameSignals(html: string): { jsonLdName: string; footerCopyright: string; ogSiteName: string } {
  let jsonLdName = "";
  try {
    const ldBlocks = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
    for (const block of ldBlocks) {
      const parsed = JSON.parse(block[1]);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        if ((item["@type"] === "Organization" || item["@type"] === "LocalBusiness") && item.name) {
          jsonLdName = item.name;
          break;
        }
      }
      if (jsonLdName) break;
    }
  } catch {}
  let footerCopyright = "";
  const copyrightMatch = html.match(/(?:©|&copy;|copyright)\s*\d{4}\s+([^<\n]{3,60})/i);
  if (copyrightMatch) footerCopyright = copyrightMatch[1].replace(/[.|,]\s*all rights.*/i, "").trim();
  const ogSiteMatch = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,200})["']/i);
  const ogSiteName = ogSiteMatch?.[1]?.trim() ?? "";
  return { jsonLdName, footerCopyright, ogSiteName };
}

// ─── Fire Apify early — called from fast consultant callback ─────────────────
function fireApifyEarly(lid: string, websiteUrl: string, businessName: string, env: Env) {
  log("APIFY_EARLY", `lid=${lid} biz="${businessName}" — firing Apify from fast consultant`);
  try {
    env.DEEP_SCRAPE.fetch(
      new Request("https://deep-scrape/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lid, websiteUrl, businessName }),
      })
    )
    .then(r => r.json())
    .then(d => log("APIFY_EARLY_OK", `lid=${lid} ${JSON.stringify(d)}`))
    .catch(e => log("APIFY_EARLY_ERR", `lid=${lid} ${e.message}`));
  } catch (e: any) {
    log("APIFY_EARLY_ERR", `lid=${lid} ${e.message}`);
  }
}

// ─── Fast Consultant: stripped-down 3-5s call for conversation starters ──────
async function callFastConsultant(
  payload: Record<string, any>,
  env: Env
): Promise<Record<string, any> | null> {
  try {
    const t0 = Date.now();
    if (!env.CONSULTANT) { log("CONSULTANT_FAST", "No service binding"); return null; }
    const resp = await env.CONSULTANT.fetch(
      new Request("https://consultant/fast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
    );
    if (!resp.ok) { log("CONSULTANT_FAST", `HTTP ${resp.status}`); return null; }
    const result = await resp.json() as Record<string, any>;
    log("CONSULTANT_FAST", `Done in ${Date.now() - t0}ms name=${result.correctedName ?? "?"}`);
    return result;
  } catch (err: any) {
    log("CONSULTANT_FAST", `Exception: ${err}`);
    return null;
  }
}

// ─── Consultant: call consultant-v9 with Firecrawl data ──────────────────────
// Returns scriptFills, routing, conversationHooks, bella_opener etc.
// This is "Consultant Gemini" — decoupled from full-scrape. ~4-8s.

async function callConsultant(
  payload: ConsultantPayload,
  env: Env
): Promise<Record<string, any> | null> {
  try {
    const t0 = Date.now();

    if (!env.CONSULTANT) {
      log("CONSULTANT", "No service binding — skipping");
      return null;
    }

    const resp = await env.CONSULTANT.fetch(
      new Request("https://consultant/", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(payload),
      })
    );

    if (!resp.ok) {
      log("CONSULTANT", `HTTP ${resp.status}`);
      return null;
    }

    const result = await resp.json() as Record<string, any>;
    log("CONSULTANT", `Done in ${Date.now() - t0}ms fallback=${result._fallback ?? false}`);
    return result;

  } catch (err) {
    log("CONSULTANT", `Exception: ${err}`);
    return null;
  }
}

// ─── Build Consultant payload from Firecrawl data ────────────────────────────

function buildConsultantPayload(
  fc: Record<string, any>,
  opts: { businessName: string; domain: string; websiteUrl: string; firstName: string }
): ConsultantPayload {
  // Infer industry from page content (fallback only — consultant is the authority)
  // Order matters: more specific terms first to avoid false positives
  // e.g. "property transactions" in an accounting firm should NOT trigger "real estate"
  const rawText = ((fc.raw_text ?? fc.markdown ?? "") as string).toLowerCase();
  const industryGuess =
    rawText.includes("dental") || rawText.includes("dentist") ? "dental" :
    rawText.includes("physio") ? "physiotherapy" :
    rawText.includes("legal") || rawText.includes("lawyer") || rawText.includes("solicitor") ? "legal" :
    rawText.includes("accountant") || rawText.includes("bookkeep") || rawText.includes("audit") || rawText.includes("tax compliance") ? "accounting" :
    rawText.includes("plumb") || rawText.includes("electric") || rawText.includes("hvac") ? "trades" :
    rawText.includes("marketing agency") || (rawText.includes("marketing") && rawText.includes("agency")) ? "marketing agency" :
    rawText.includes("restaurant") || rawText.includes("cafe") || rawText.includes("hospitality") ? "hospitality" :
    rawText.includes("insur") ? "insurance" :
    rawText.includes("finance") || rawText.includes("mortgage") || rawText.includes("lending") ? "finance" :
    rawText.includes("real estate agent") || rawText.includes("property management") ? "real estate" :
    "business";

  return {
    businessName:    opts.businessName,
    domain:          opts.domain,
    pageTitle:       fc.title ?? "",
    ogTitle:         fc.ogTitle ?? "",
    industry:        industryGuess,
    industryNiche:   null,
    location:        (fc.address ?? "Australia").replace(/\d{4}.*/, "").trim() || "Australia",
    yearsInBusiness: null,
    targetAudience:  fc.target_audience ?? "clients",
    salesTerm:       "appointments",
    businessModel:   "B2C",
    description:     (fc.markdown ?? "").slice(0, 1000),
    google:          { rating: null, reviewCount: 0, ownerResponseRate: null, openingHours: [] },
    competitors:     [],
    reviews:         [],
    facebookAds:     { isRunning: false, adCount: 0, ctas: [], creatives: [] },
    googleAds:       { isRunning: false, adCount: 0, headlines: [] },
    campaignAnalysis: null,
    techStack: {
      hasCRM:          false,
      hasChatWidget:   fc.has_chat    ?? false,
      hasBookingSystem: fc.has_booking ?? false,
      hasVoiceAI:      false,
      techCount:       0,
      missingTech:     [],
    },
    landingPage: {
      hasAboveFoldCTA:  (fc.ctas ?? []).length > 0,
      formFieldCount:   0,
      mobileOptimized:  true,
      testimonialCount: (fc.raw_text ?? "").toLowerCase().includes("testimonial") ? 1 : 0,
      trustBadgeCount:  0,
      hasVideo:         false,
      hasLiveChat:      fc.has_chat ?? false,
      hasClickToCall:   (fc.phone ?? "").length > 0,
      score:            50,
    },
    aiExtracted: {
      headline: fc.h1 ?? "",
      subheadline: fc.h2 ?? "",
      mainCTA: (fc.ctas ?? [])[0] ?? null,
      services: fc.services ?? [],
      targetAudience: fc.target_audience ?? null,
    },
    scraped: {
      services:          fc.services        ?? [],
      ctas:              fc.ctas            ?? [],
      testimonials:      [],
      certifications:    [],
      socialMedia:       {},
      valuePropositions: fc.key_benefits   ?? [],
    },
    branding: {
      tagline:      fc.tagline  ?? fc.h2 ?? "",
      heroH1:       fc.h1       ?? fc.ogTitle ?? "",
      primaryColor: null,
    },
    websiteContent: cleanWebsiteContent(fc.markdown ?? fc.raw_text ?? fc.html ?? ""),
    grades: {},
  };
}


// ─── Main fast-intel pipeline ─────────────────────────────────────────────────
// Firecrawl + Consultant run sequentially (Consultant needs Firecrawl output).
// Total wall time target: 8-12s.

async function runFastIntel(
  lid: string,
  websiteUrl: string,
  firstName: string,
  env: Env
): Promise<FastIntelResult> {
  const t0 = Date.now();
  const domain = extractDomain(websiteUrl);
  const bizName = domain.split(".")[0];
  const bizNameTitle = bizName.charAt(0).toUpperCase() + bizName.slice(1);
  const fn = normaliseName(firstName);

  log("START", `lid=${lid} url=${websiteUrl} firstName=${fn}`);

  // ── Step 1: Parallel scrape — Firecrawl + direct fetch race ──────────────
  // Firecrawl gives rich markdown but times out often (HTTP 408).
  // Direct fetch is instant but gives raw HTML only.
  // Fire both in parallel, use Firecrawl if it succeeds, else use direct fetch.
  const [firecrawlResult, directHtml] = await Promise.all([
    firecrawlScrape(websiteUrl, env.FIRECRAWL_API_KEY ?? "").catch(() => null),
    directFetch(websiteUrl).catch(() => null),
  ]);

  let fc = firecrawlResult;
  if (!fc && directHtml) {
    log("FALLBACK", `Firecrawl failed, using direct fetch (${directHtml.length} chars)`);
    const meta = extractMetaFromHtml(directHtml, websiteUrl);
    fc = {
      markdown:       "",
      html:           directHtml,
      title:          meta.title,
      h1:             meta.h1,
      h2:             "",
      description:    meta.description,
      ogTitle:        meta.ogTitle,
      ogDescription:  meta.ogDescription,
      ogImage:        "",
      links:          [],
      raw_text:       directHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 8000),
      tech_stack:     detectTechStack(directHtml, {}),
    } as any;
  } else if (!fc) {
    // Both failed — try ScrapingAnt as last resort
    log("FALLBACK", "Firecrawl + direct both failed — trying ScrapingAnt");
    const antHtml = await scrapingAntFetch(websiteUrl, env.SCRAPINGANT_KEY ?? "").catch(() => null);
    if (antHtml) {
      const meta = extractMetaFromHtml(antHtml, websiteUrl);
      fc = {
        markdown:       "",
        html:           antHtml,
        title:          meta.title,
        h1:             meta.h1,
        h2:             "",
        description:    meta.description,
        ogTitle:        meta.ogTitle,
        ogDescription:  meta.ogDescription,
        ogImage:        "",
        links:          [],
        raw_text:       antHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 8000),
        tech_stack:     detectTechStack(antHtml, {}),
      } as any;
      log("FALLBACK", `ScrapingAnt HTML → fc stub (${antHtml.length} chars)`);
    } else {
      log("FALLBACK", "All scrapers failed — proceeding with pure stub");
    }
  }

  // Extract business name from Firecrawl data (better than raw domain)
  // Title/ogTitle patterns: "Home - Pitcher Partners", "Pitcher Partners | Sydney"
  // Strategy: split on separators, discard generic page labels like "Home", "Welcome", "About"
  const GENERIC_PAGE_LABELS = /^(home|welcome|about|contact|services|blog|news|main|index|our\s+\w+)$/i;
  function extractBizFromTitle(raw: string | undefined): string {
    if (!raw) return "";
    // Split on common title separators
    const parts = raw.split(/\s*[-|–—]\s*/).map(s => s.trim()).filter(Boolean);
    // Filter out generic page labels — business name is never "Home"
    const meaningful = parts.filter(p => !GENERIC_PAGE_LABELS.test(p));
    // Prefer the longest meaningful segment (brand names are usually longer than page labels)
    if (meaningful.length > 0) {
      return meaningful.sort((a, b) => b.length - a.length)[0];
    }
    return parts[parts.length - 1] || raw.trim();
  }
  const scrapedBizName = extractBizFromTitle(fc?.ogTitle)
    || extractBizFromTitle(fc?.title)
    || fc?.h1?.slice(0, 40)?.trim()
    || bizNameTitle;

  // ── Step 2: TWO parallel consultant calls ────────────────────────────────
  // Fast read: nav + first 3-4K post-H1 → confirmed biz name + starter scriptFills
  // Full read: entire page (unchanged) → complete analysis
  let consultant: Record<string, any> | null = null;
  if (fc) {
    const rawContent = fc.markdown ?? fc.raw_text ?? fc.html ?? "";
    const htmlContent = fc.html ?? "";

    // Extract name signals for cross-referencing
    const nameSignals = extractBizNameSignals(htmlContent);
    const navItems = extractNavItems(rawContent);
    const postH1Slice = extractPostH1Slice(rawContent, 4000);

    // Build fast consultant payload — small slice of content + name signals
    const fastPayload = buildConsultantPayload(fc, {
      businessName: scrapedBizName,
      domain,
      websiteUrl,
      firstName: fn,
    });
    // Override websiteContent with the small slice + name cross-ref signals
    (fastPayload as any).websiteContent = `NAV ITEMS: ${navItems}\n\n--- WEBSITE COPY (first sections after H1) ---\n${postH1Slice}`;
    (fastPayload as any).nameSignals = {
      ogSiteName: nameSignals.ogSiteName || fc.ogTitle || "",
      jsonLdOrgName: nameSignals.jsonLdName,
      footerCopyright: nameSignals.footerCopyright,
      pageTitle: fc.title || "",
      ogTitle: fc.ogTitle || "",
      h1: fc.h1 || "",
      domain,
    };
    (fastPayload as any).lid = lid;
    (fastPayload as any)._fastRead = true;

    // Build full consultant payload — entire page (unchanged from before)
    const fullPayload = buildConsultantPayload(fc, {
      businessName: scrapedBizName,
      domain,
      websiteUrl,
      firstName: fn,
    });
    (fullPayload as any).lid = lid;

    // Fire both in parallel — fast uses /fast endpoint (tiny prompt, 3-5s)
    const t2 = Date.now();
    const [fastResult, fullResult] = await Promise.all([
      callFastConsultant(fastPayload, env).then(r => {
        if (!r) return r;
        log("CONSULTANT_FAST", `Done in ${Date.now() - t2}ms name=${r.correctedName ?? "?"}`);
        // Fire Apify immediately with confirmed name
        const confirmedName = r.correctedName || scrapedBizName;
        fireApifyEarly(lid, websiteUrl, confirmedName, env);
        // Write starter scriptFills to KV so bridge has data when call connects
        const starterFills: Record<string, any> = {
          business_name: confirmedName,
          first_name: fn,
          source: "fast_consultant",
          consultant: {
            scriptFills: {
              icp_guess: r.icp_guess ?? null,
              reference_offer: r.reference_offer ?? null,
              website_positive_comment: r.website_insight ?? null,
            },
            businessIdentity: { correctedName: confirmedName, industry: r.industry ?? "business" },
            routing: { priority_agents: [] },
          },
          market_positioning: r.market_positioning ?? null,
          fast_context: { v: 1, lid, ts: new Date().toISOString() },
        };
        env.LEADS_KV.put(`lead:${lid}:fast-intel`, JSON.stringify(starterFills), { expirationTtl: 86400 })
          .then(() => log("KV_STARTER", `Written lid=${lid}:fast-intel starter (${JSON.stringify(starterFills).length} bytes)`))
          .catch(e => log("KV_STARTER_ERR", `${e}`));
        return r;
      }),
      callConsultant(fullPayload, env).then(r => {
        log("CONSULTANT_FULL", `Done in ${Date.now() - t2}ms name=${r?.businessIdentity?.correctedName ?? "?"}`);
        return r;
      }),
    ]);

    // Full consultant is the authority on analysis (ICP, routing, hooks, stage plan).
    // Fast consultant is the authority on BUSINESS NAME (purpose-built for brand
    // identification: reads header area + cross-references og:site_name, JSON-LD,
    // footer copyright, domain). Full consultant can hallucinate names from generic
    // page content (e.g. "Trusted Financial Advisors" instead of "Leading Advice").
    consultant = fullResult ?? fastResult;

    // Preserve fast consultant's correctedName — it has dedicated name signals
    if (fastResult?.correctedName && consultant?.businessIdentity) {
      const fastName = fastResult.correctedName;
      const fullName = consultant.businessIdentity.correctedName ?? "";
      if (fastName.toLowerCase() !== fullName.toLowerCase()) {
        log("CONSULTANT_MERGE", `Name mismatch: fast="${fastName}" full="${fullName}" — using fast`);
      }
      consultant.businessIdentity.correctedName = fastName;
    }
  }

  // Fast consultant is the authority on name, full consultant for everything else
  const bi = consultant?.businessIdentity ?? {};
  const resolvedBizName = bi.correctedName || scrapedBizName;

  const sf = consultant?.scriptFills ?? {};

  // ── Build the canonical bella_opener from real data ───────────────────
  const heroQuote  = sf.hero_header_quote || fc?.h1 || fc?.ogTitle || "";
  const sitePraise = sf.website_positive_comment || "";
  const icpGuess   = sf.icp_guess || fc?.target_audience || "your clients";
  const offerRef   = sf.reference_offer || (fc?.services ?? [])[0] || "your services";

  // Clean sitePraise: strip trailing punctuation so we control sentence endings
  const cleanPraise = sitePraise.replace(/[.\s]+$/, "");
  // Clean icpGuess: strip leading "It looks like" and trailing "is that right?" since we control framing
  const cleanIcp = icpGuess
    .replace(/^it looks like\s+/i, "")
    .replace(/,?\s*is that (?:right|correct)\??$/i, "")
    .replace(/[.\s]+$/, "");

  const bellaOpener = heroQuote
    ? `Hi ${fn}! We've taken a proper look at ${resolvedBizName}, and a few things stood out straight away. ${cleanPraise ? cleanPraise + ". " : ""}It looks like you're mainly targeting ${cleanIcp} — is that right?`
    : `Hi ${fn}! We've taken a proper look at ${resolvedBizName} — great to have you here. ${cleanPraise || "Your site is looking sharp"}.`;

  // ── Tech stack shorthand for flags (v1.1.0 fix) ─────────────────────────
  const ts = (fc as any)?.tech_stack;
  const ft = ts?.flags_tech ?? {};

  // ── Assemble the fast_intel envelope ─────────────────────────────────────
  const fastIntel: FastIntelResult = {
    status:       "done",
    ts_done:      new Date().toISOString(),
    duration_ms:  Date.now() - t0,
    source:       fc ? "firecrawl" : "stub",

    // Tech stack — stored at root so writeFastIntelToKV can access it
    tech_stack:   (fc as any)?.tech_stack ?? {},

    // Core identity — what the bridge reads for WARM WOW
    // Consultant is the authority on name, industry, model (reads full page, not just <title>)
    core_identity: {
      first_name:    fn,
      business_name: resolvedBizName,
      domain,
      website_url:   websiteUrl,
      industry:      bi.industry ?? (fc ? inferIndustry(fc) : ""),
      location:      bi.serviceArea ?? (fc?.address?.replace(/\d{4}.*/, "").trim() || ""),
      phone:         (fc as any)?.phone   || "",
      tagline:       fc?.tagline || fc?.h2 || "",
      model:         bi.businessModel ?? "B2C",
    },

    // Hero data — raw from Firecrawl
    hero: {
      h1:              fc?.h1              || "",
      h2:              fc?.h2              || "",
      title:           fc?.title           || "",
      meta_description: fc?.description   || "",
      og_title:        fc?.ogTitle         || "",
      og_description:  fc?.ogDescription  || "",
      og_image:        fc?.ogImage         || "",
      tagline:         fc?.tagline         || "",
    },

    // Rich page content — full markdown for Gemini context
    page_content: {
      markdown:  (fc?.markdown ?? "").slice(0, 20000),
      services:  fc?.services  ?? [],
      ctas:      fc?.ctas      ?? [],
      key_benefits: (fc as any)?.key_benefits ?? [],
      has_chat:  (fc as any)?.has_chat    ?? false,
      has_booking: (fc as any)?.has_booking ?? false,
      links:     fc?.links ?? [],
    },

    // Consultant Gemini analysis
    consultant: consultant ?? {},

    // Script fills — what Bella's buildRichPrompt reads directly
    script_fills: {
      hero_header_quote:        heroQuote,
      website_positive_comment: sitePraise,
      icp_guess:                icpGuess,
      reference_offer:          offerRef,
      campaign_summary:         sf.campaign_summary    || null,
      rep_commentary:           sf.rep_commentary      || null,
      recent_review_snippet:    sf.recent_review_snippet || null,
      rep_quality_assessment:   sf.rep_quality_assessment || null,
      top_2_website_ctas:       sf.top_2_website_ctas  || null,
    },

    // Routing — which agents are likely strongest
    routing: consultant?.routing ?? { priority_agents: [], skip_agents: [], reasoning: {} },

    // Conversation hooks for Bella
    conversation_hooks: consultant?.conversationHooks ?? [],
    most_impressive:    consultant?.mostImpressive    ?? [],
    red_flags:          consultant?.redFlags          ?? [],

    // Ready-made opener for Bella
    bella_opener: bellaOpener,

    // Flags for bridge buildQueue
    // FIXED v9.1.0: Read from correct tech_stack paths.
    // Top-level has: has_crm, has_chat, has_booking, is_running_ads, is_retargeting
    // Pixel/priority flags in: flags_tech.has_fb_pixel, flags_tech.database_likely etc.
    flags: {
      // Pixel-detected ads signals — available immediately, no Apify needed
      is_running_ads:             ts?.is_running_ads   ?? false,
      is_retargeting:             ts?.is_retargeting   ?? false,
      has_fb_pixel:               ft.has_fb_pixel      ?? false,
      has_google_ads:             ft.has_google_ads    ?? false,
      has_tiktok_ads:             ft.has_tiktok_ads    ?? false,
      has_multi_platform_ads:     ft.has_multi_platform_ads ?? false,
      // Lead handling — derive no_* from top-level has_* booleans
      speed_to_lead_needed:       ft.speed_to_lead_needed ?? false,
      call_handling_needed:       ft.call_handling_risk ?? false,
      no_chat:                    !(ts?.has_chat    ?? false),
      no_crm:                     !(ts?.has_crm     ?? false),
      no_booking_tool:            !(ts?.has_booking  ?? false),
      // Database signals — if they have email tool or ecommerce, they have a database
      database_reactivation:      ft.database_likely  ?? false,
      // These still need Apify to confirm
      business_age_established:   false,
      review_signals:             false,
    },

    // firstName at root level (belt and suspenders)
    firstName: fn,
    first_name: fn,
  };

  return fastIntel;
}

// ─── Industry inference (lightweight, from page text) ────────────────────────
// ─── FULL TECH STACK XRAY ────────────────────────────────────────────────────
// Scans raw HTML for script tags, pixels, iframes, and inline JS signatures.
// Returns a rich tech_stack object used by the bridge to:
//   1. Populate website_health fields (has_crm, has_booking etc.)
//   2. Strengthen agent priority flags
//   3. Give Bella specific WOW lines ("I noticed you're running HubSpot...")
function detectTechStack(html: string, extracted: Record<string, any>): TechStack {
  const h = html.toLowerCase();
  const ex = (s: string) => extracted[s] ?? "";

  // ── CRM ──────────────────────────────────────────────────────────────────
  const crm_hint = (ex("crm_name") as string).toLowerCase();
  const crm_hubspot      = crm_hint.includes("hubspot")      || h.includes("hubspot")      || h.includes("hs-scripts")    || h.includes("hsforms")       || h.includes("js.hs-scripts");
  const crm_salesforce   = crm_hint.includes("salesforce")   || h.includes("salesforce")   || h.includes("pardot")        || h.includes("krux.com");
  const crm_keap         = crm_hint.includes("keap")         || crm_hint.includes("infusion")|| h.includes("infusionsoft") || h.includes("app.keap")      || h.includes("infusion");
  const crm_activecampaign = crm_hint.includes("activecampaign") || h.includes("activecampaign") || h.includes("trackcmp.net");
  const crm_ghl          = h.includes("msgsndr")             || h.includes("highlevel")    || h.includes("leadconnector") || h.includes("gohighlevel");
  const crm_zoho         = crm_hint.includes("zoho")         || h.includes("salesiq.zohopublic") || h.includes("zoho.com/crm");
  const crm_pipedrive    = crm_hint.includes("pipedrive")    || h.includes("pipedrive");
  const crm_monday       = crm_hint.includes("monday")       || h.includes("monday.com");
  const crm_close        = crm_hint.includes("close")        || h.includes("closeio")      || h.includes("close.io");
  const crm_name         = crm_hubspot ? "HubSpot" : crm_salesforce ? "Salesforce/Pardot"
    : crm_keap ? "Keap/Infusionsoft" : crm_activecampaign ? "ActiveCampaign"
    : crm_ghl ? "GoHighLevel" : crm_zoho ? "Zoho CRM" : crm_pipedrive ? "Pipedrive"
    : crm_monday ? "Monday.com" : crm_close ? "Close CRM"
    : (ex("crm_name") as string) || null;
  const has_crm = !!crm_name;

  // ── BOOKING / SCHEDULING ─────────────────────────────────────────────────
  const book_hint = (ex("booking_tool") as string).toLowerCase();
  const book_calendly    = book_hint.includes("calendly")    || h.includes("calendly.com") || h.includes("assets.calendly");
  const book_acuity      = book_hint.includes("acuity")      || h.includes("acuityscheduling") || h.includes("acuity.com");
  const book_mindbody    = book_hint.includes("mindbody")    || h.includes("mindbodyonline") || h.includes("booker.com");
  const book_cliniko     = book_hint.includes("cliniko")     || h.includes("cliniko.com");
  const book_servicem8   = book_hint.includes("servicem8")   || h.includes("servicem8.com");
  const book_simpro      = book_hint.includes("simpro")      || h.includes("simpro.com");
  const book_jobber      = book_hint.includes("jobber")      || h.includes("getjobber.com");
  const book_square      = book_hint.includes("square")      || h.includes("squareup.com/appointments");
  const book_timely      = book_hint.includes("timely")      || h.includes("gettimely.com");
  const book_fresha      = book_hint.includes("fresha")      || h.includes("fresha.com");
  const book_typeform    = h.includes("typeform.com")        || h.includes("embed.typeform");
  const book_jotform     = h.includes("jotform.com")         || h.includes("jotform.net");
  const booking_tool     = book_calendly ? "Calendly" : book_acuity ? "Acuity Scheduling"
    : book_mindbody ? "Mindbody" : book_cliniko ? "Cliniko" : book_servicem8 ? "ServiceM8"
    : book_simpro ? "SimPro" : book_jobber ? "Jobber" : book_square ? "Square Appointments"
    : book_timely ? "Timely" : book_fresha ? "Fresha" : book_typeform ? "Typeform"
    : book_jotform ? "JotForm" : (ex("booking_tool") as string) || null;
  const has_booking      = !!(booking_tool || ex("has_booking"));

  // ── LIVE CHAT / SUPPORT ──────────────────────────────────────────────────
  const chat_hint = (ex("chat_tool") as string).toLowerCase();
  const chat_intercom    = chat_hint.includes("intercom")    || h.includes("intercom.io")  || h.includes("widget.intercom");
  const chat_drift       = chat_hint.includes("drift")       || h.includes("drift.com")    || h.includes("js.driftt.com");
  const chat_tawk        = chat_hint.includes("tawk")        || h.includes("tawk.to")      || h.includes("embed.tawk.to");
  const chat_crisp       = chat_hint.includes("crisp")       || h.includes("crisp.chat")   || h.includes("client.crisp.chat");
  const chat_tidio       = chat_hint.includes("tidio")       || h.includes("tidio.com")    || h.includes("code.tidio.co");
  const chat_freshdesk   = chat_hint.includes("freshdesk")   || h.includes("freshdesk.com")|| h.includes("freshchat");
  const chat_zendesk     = chat_hint.includes("zendesk")     || h.includes("zdassets.com") || h.includes("zendesk.com/embeddable");
  const chat_livechat    = chat_hint.includes("livechat")    || h.includes("livechatinc.com");
  const chat_olark       = h.includes("olark.com");
  const chat_gorgias     = h.includes("gorgias.com");
  const chat_tool        = chat_intercom ? "Intercom" : chat_drift ? "Drift" : chat_tawk ? "Tawk.to"
    : chat_crisp ? "Crisp" : chat_tidio ? "Tidio" : chat_freshdesk ? "Freshchat"
    : chat_zendesk ? "Zendesk Chat" : chat_livechat ? "LiveChat" : chat_olark ? "Olark"
    : chat_gorgias ? "Gorgias" : (ex("chat_tool") as string) || null;
  const has_chat         = !!(chat_tool || ex("has_chat"));

  // ── NON-AI CHATBOT CLASSIFICATION ────────────────────────────────────────
  // These are legacy rule-based/human-staffed chat tools — NOT AI.
  // A business with one of these already values chat but is using inferior tech.
  // This is the easiest Chris pitch: "you already know chat works, let's make it 10x smarter"
  const NON_AI_CHAT_TOOLS = ["Tawk.to", "Olark", "LiveChat", "Zendesk Chat", "Freshchat", "Gorgias", "Crisp"];
  const AI_CAPABLE_CHAT_TOOLS = ["Intercom", "Drift", "Tidio"]; // these have AI modes but often not enabled
  const is_non_ai_chat   = !!(chat_tool && NON_AI_CHAT_TOOLS.includes(chat_tool));
  const is_legacy_chat   = is_non_ai_chat; // alias for clarity
  const chat_is_ai_capable = !!(chat_tool && AI_CAPABLE_CHAT_TOOLS.includes(chat_tool));
  // Even "AI-capable" tools are usually running in basic mode — flag for Bella to probe
  const chat_likely_basic = has_chat && !chat_is_ai_capable || is_non_ai_chat;

  // ── AD PIXELS — the money signals ───────────────────────────────────────
  // Facebook/Meta
  const pixel_fb         = h.includes("connect.facebook.net") || h.includes("fbevents.js") || h.includes("facebook pixel") || h.includes("fbq(") || h.includes("_fbq");
  // Google Ads
  const pixel_google_ads = h.includes("googleadservices.com") || h.includes("google_conversion") || h.includes("gtag") && (h.includes("aw-") || h.includes("/conversion")) || h.includes("googletag.js");
  // Google Analytics (not ads but useful — tells us they track)
  const has_ga4          = h.includes("gtag/js?id=g-") || h.includes("google-analytics.com/g/") || h.includes("googletagmanager.com");
  const has_gtm          = h.includes("googletagmanager.com/gtm.js") || h.includes("gtm.js?id=gtm-");
  // TikTok
  const pixel_tiktok     = h.includes("analytics.tiktok.com") || h.includes("tiktok pixel") || h.includes("ttq.load") || h.includes("tiktok-pixel");
  // LinkedIn
  const pixel_linkedin   = h.includes("snap.licdn.com") || h.includes("linkedin insight") || h.includes("_linkedin_partner_id") || h.includes("dc.ads.linkedin.com");
  // Pinterest
  const pixel_pinterest  = h.includes("pintrk(") || h.includes("ct.pinterest.com") || h.includes("pinterest pixel");
  // Snapchat
  const pixel_snapchat   = h.includes("sc-static.net/scevent.min.js") || h.includes("snapchat pixel") || h.includes("snaptr(");
  // Twitter/X
  const pixel_twitter    = h.includes("static.ads-twitter.com") || h.includes("twq(") || h.includes("twitter pixel");
  // Microsoft/Bing
  const pixel_bing       = h.includes("bat.bing.com") || h.includes("uetq") || h.includes("bing ads");
  // Taboola / Outbrain (native ads)
  const pixel_taboola    = h.includes("cdn.taboola.com") || h.includes("tfa.taboola");
  const pixel_outbrain   = h.includes("amplify.outbrain.com");
  // Retargeting
  const pixel_adroll     = h.includes("adroll.com") || h.includes("__adroll");
  const pixel_criteo     = h.includes("static.criteo.net") || h.includes("criteo");

  const ads_pixels: string[] = [
    pixel_fb        && "Meta/Facebook",
    pixel_google_ads && "Google Ads",
    pixel_tiktok    && "TikTok",
    pixel_linkedin  && "LinkedIn",
    pixel_pinterest && "Pinterest",
    pixel_snapchat  && "Snapchat",
    pixel_twitter   && "Twitter/X",
    pixel_bing      && "Microsoft/Bing",
    pixel_taboola   && "Taboola",
    pixel_outbrain  && "Outbrain",
    pixel_adroll    && "AdRoll",
    pixel_criteo    && "Criteo",
  ].filter(Boolean) as string[];

  const is_running_ads   = ads_pixels.length > 0;
  const is_retargeting   = pixel_adroll || pixel_criteo || (pixel_fb && (pixel_google_ads || pixel_tiktok));

  // ── EMAIL MARKETING ──────────────────────────────────────────────────────
  const email_hint = (ex("email_tool") as string).toLowerCase();
  const email_mailchimp  = email_hint.includes("mailchimp")  || h.includes("mailchimp.com") || h.includes("chimpstatic.com") || h.includes("list-manage.com");
  const email_klaviyo    = email_hint.includes("klaviyo")    || h.includes("klaviyo.com")   || h.includes("static.klaviyo");
  const email_ac         = email_hint.includes("activecampaign") || h.includes("activecampaign") || h.includes("trackcmp");
  const email_drip       = h.includes("getdrip.com")         || h.includes("js.getdrip");
  const email_convertkit = email_hint.includes("convertkit") || h.includes("convertkit.com");
  const email_brevo      = email_hint.includes("brevo")      || h.includes("brevo.com")     || h.includes("sibforms.com") || h.includes("sendinblue");
  const email_omnisend   = h.includes("omnisend.com");
  const email_dotdigital = h.includes("dotdigital.com")      || h.includes("dmtrk.com");
  const email_tool       = email_mailchimp ? "Mailchimp" : email_klaviyo ? "Klaviyo"
    : email_ac ? "ActiveCampaign" : email_drip ? "Drip" : email_convertkit ? "ConvertKit"
    : email_brevo ? "Brevo/Sendinblue" : email_omnisend ? "Omnisend"
    : email_dotdigital ? "Dotdigital" : (ex("email_tool") as string) || null;
  const has_email_marketing = !!email_tool;

  // ── ECOMMERCE ────────────────────────────────────────────────────────────
  const has_shopify      = h.includes("cdn.shopify.com")     || h.includes("shopifycloud.com") || h.includes("myshopify.com");
  const has_woocommerce  = h.includes("woocommerce")         || h.includes("wc-block");
  const has_bigcommerce  = h.includes("bigcommerce.com")     || h.includes("bigcommerce");
  const has_squarespace_ecomm = h.includes("squarespace.com") && (h.includes("cart") || h.includes("shop"));
  const has_ecommerce    = !!(ex("has_ecommerce") || has_shopify || has_woocommerce || has_bigcommerce || has_squarespace_ecomm);
  const ecommerce_platform = has_shopify ? "Shopify" : has_woocommerce ? "WooCommerce"
    : has_bigcommerce ? "BigCommerce" : has_ecommerce ? "eCommerce" : null;

  // ── PAYMENT STACK ────────────────────────────────────────────────────────
  const pay_hint = (ex("payment_tool") as string).toLowerCase();
  const pay_stripe       = pay_hint.includes("stripe")       || h.includes("js.stripe.com") || h.includes("stripe.network");
  const pay_square_pay   = pay_hint.includes("square")       || h.includes("squareup.com")  || h.includes("square payment");
  const pay_paypal       = pay_hint.includes("paypal")       || h.includes("paypal.com/sdk") || h.includes("paypalobjects.com");
  const pay_afterpay     = h.includes("afterpay.com")        || h.includes("afterpay");
  const pay_zip          = h.includes("zipmoney.com.au")     || h.includes("zip.co");
  const payment_tool     = pay_stripe ? "Stripe" : pay_square_pay ? "Square" : pay_paypal ? "PayPal"
    : pay_afterpay ? "Afterpay" : pay_zip ? "Zip/ZipMoney" : (ex("payment_tool") as string) || null;

  // ── SOCIAL MEDIA PRESENCE ────────────────────────────────────────────────
  const links_str = JSON.stringify((extracted.links ?? [])).toLowerCase();
  const social_fb        = h.includes("facebook.com/") && !h.includes("connect.facebook.net");
  const social_instagram = h.includes("instagram.com/");
  const social_linkedin  = h.includes("linkedin.com/company") || h.includes("linkedin.com/in/");
  const social_youtube   = h.includes("youtube.com/") || h.includes("youtu.be/");
  const social_tiktok    = h.includes("tiktok.com/@");
  const social_twitter   = h.includes("twitter.com/") || h.includes("x.com/");
  const social_pinterest = h.includes("pinterest.com.au/") || h.includes("pinterest.com/");
  const social_channels: string[] = [
    social_fb        && "Facebook",
    social_instagram && "Instagram",
    social_linkedin  && "LinkedIn",
    social_youtube   && "YouTube",
    social_tiktok    && "TikTok",
    social_twitter   && "Twitter/X",
    social_pinterest && "Pinterest",
  ].filter(Boolean) as string[];

  // ── MEMBERSHIP / PORTAL ──────────────────────────────────────────────────
  const has_membership   = !!(ex("has_membership") || h.includes("memberful.com") || h.includes("memberpress") || h.includes("kajabi.com") || h.includes("teachable.com") || h.includes("thinkific.com") || h.includes("podia.com") || (h.includes("login") && h.includes("portal")));

  // ── WEBSITE TECH ─────────────────────────────────────────────────────────
  const built_with_wordpress = h.includes("wp-content") || h.includes("wp-includes") || h.includes("xmlrpc.php");
  const built_with_squarespace = h.includes("squarespace.com") || h.includes("static.squarespace");
  const built_with_wix      = h.includes("wix.com") || h.includes("wixstatic.com");
  const built_with_webflow  = h.includes("webflow.com") || h.includes("assets.website-files");
  const built_with_framer   = h.includes("framer.com") || h.includes("framerusercontent");
  const site_platform       = has_shopify ? "Shopify" : built_with_wordpress ? "WordPress"
    : built_with_squarespace ? "Squarespace" : built_with_wix ? "Wix"
    : built_with_webflow ? "Webflow" : built_with_framer ? "Framer" : null;

  // ── AGENT PRIORITY FLAGS (Bella uses these) ───────────────────────────────
  // is_running_ads → Alex + Chris priority
  // has_booking without CRM → Maddie priority (calls may be unmanaged)
  // has_email_marketing without CRM → Sarah priority (database likely)
  // low/no chat + has phone → Maddie priority
  // no booking tool → Chris opportunity
  const flags_tech: Record<string, boolean> = {
    is_running_ads,
    is_retargeting,
    has_fb_pixel:           pixel_fb,
    has_google_ads:         pixel_google_ads,
    has_tiktok_ads:         pixel_tiktok,
    has_linkedin_ads:       pixel_linkedin,
    has_multi_platform_ads: ads_pixels.length > 1,
    has_crm,
    has_booking,
    has_chat,
    has_email_marketing,
    has_ecommerce,
    has_membership,
    has_payment_tool:       !!payment_tool,
    has_social_presence:    social_channels.length > 0,
    no_booking_tool:        !has_booking,
    no_crm:                 !has_crm,
    no_chat:                !has_chat,
    // Chat quality signals — key for Chris pitch
    has_non_ai_chat:        is_non_ai_chat,      // easy upgrade target — already values chat
    has_legacy_chat:        is_legacy_chat,
    chat_likely_basic,                           // non-AI or AI-capable but probably basic mode
    // Priority flags
    speed_to_lead_needed:   is_running_ads && !has_crm,
    database_likely:        has_email_marketing || (has_ecommerce && !!payment_tool),
    call_handling_risk:     !has_chat && !has_booking,
    chris_easy_win:         is_non_ai_chat,      // already has chat widget — just upgrade it
  };

  return {
    // Named tools
    crm_name:           crm_name ?? undefined,
    booking_tool:       booking_tool ?? undefined,
    chat_tool:          chat_tool ?? undefined,
    email_tool:         email_tool ?? undefined,
    payment_tool:       payment_tool ?? undefined,
    ecommerce_platform: ecommerce_platform ?? undefined,
    site_platform:      site_platform ?? undefined,
    // Ad pixels
    ads_pixels,
    is_running_ads,
    is_retargeting,
    // Social
    social_channels,
    // Boolean flags
    has_crm,
    has_booking,
    has_chat,
    has_email_marketing,
    has_ecommerce,
    has_membership,
    has_ga4,
    has_gtm,
    // Chat quality
    is_non_ai_chat,
    is_legacy_chat,
    chat_likely_basic,
    // Agent priority flags
    flags_tech,
  };
}

type TechStack = ReturnType<typeof detectTechStack>;

function inferIndustry(fc: Record<string, any>): string {
  const text = ((fc.raw_text ?? fc.markdown ?? "") as string).toLowerCase();
  if (text.includes("dental") || text.includes("dentist"))   return "dental";
  if (text.includes("physio"))                               return "physiotherapy";
  if (text.includes("legal") || text.includes("lawyer"))     return "legal";
  if (text.includes("real estate") || text.includes("property")) return "real estate";
  if (text.includes("plumb") || text.includes("electric"))   return "trades";
  if (text.includes("accounting") || text.includes("bookkeep")) return "accounting";
  if (text.includes("marketing") || text.includes("agency")) return "marketing agency";
  if (text.includes("restaurant") || text.includes("cafe"))  return "hospitality";
  if (text.includes("insur"))                                return "insurance";
  if (text.includes("finance") || text.includes("mortgage")) return "finance";
  return "business";
}


// ─── Google Places Text Search cross-ref (P2-T1) ────────────────────────────
// Calls Places API to verify business name and grab rating + review count.
// Returns { name, rating, reviewCount, placeId, verified } or null on failure.
// Non-fatal — if Places fails, we keep the consultant name.

interface PlacesResult {
  name: string;
  rating: number;
  reviewCount: number;
  placeId: string;
  verified: boolean;
  formattedAddress?: string;
}

async function crossRefGooglePlaces(
  consultantName: string,
  location: string,
  domain: string,
  apiKey: string
): Promise<PlacesResult | null> {
  const t0 = Date.now();
  const query = location
    ? `${consultantName} ${location}`
    : `${consultantName} ${domain}`;

  try {
    const resp = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.displayName,places.rating,places.userRatingCount,places.id,places.formattedAddress,places.websiteUri",
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 3 }),
      signal: AbortSignal.timeout(3000),
    });

    if (!resp.ok) {
      log("PLACES", `HTTP ${resp.status} for "${query}" (${Date.now() - t0}ms)`);
      return null;
    }

    const data: any = await resp.json();
    const places: any[] = data.places ?? [];

    if (places.length === 0) {
      log("PLACES", `No results for "${query}" (${Date.now() - t0}ms)`);
      return null;
    }

    // Score each result: prefer domain match, then name similarity
    const domainLower = domain.toLowerCase().replace("www.", "");
    let best: any = null;
    let bestScore = -1;

    for (const p of places) {
      let score = 0;
      const pName = (p.displayName?.text ?? "").toLowerCase();
      const pUri = (p.websiteUri ?? "").toLowerCase();
      const cName = consultantName.toLowerCase();

      // Domain match is strongest signal
      if (pUri && pUri.includes(domainLower)) score += 10;

      // Name containment (either direction)
      if (pName.includes(cName) || cName.includes(pName)) score += 5;
      else {
        // Partial word overlap
        const pWords = new Set(pName.split(/\s+/));
        const cWords = cName.split(/\s+/);
        const overlap = cWords.filter(w => pWords.has(w)).length;
        score += overlap;
      }

      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    if (!best || bestScore < 1) {
      log("PLACES", `No confident match for "${query}" bestScore=${bestScore} (${Date.now() - t0}ms)`);
      return null;
    }

    const result: PlacesResult = {
      name: best.displayName?.text ?? consultantName,
      rating: best.rating ?? 0,
      reviewCount: best.userRatingCount ?? 0,
      placeId: best.id ?? "",
      verified: bestScore >= 5,
      formattedAddress: best.formattedAddress ?? "",
    };

    log("PLACES", `MATCH "${result.name}" rating=${result.rating} reviews=${result.reviewCount} score=${bestScore} verified=${result.verified} (${Date.now() - t0}ms)`);
    return result;
  } catch (e: any) {
    log("PLACES", `Error: ${e.message} (${Date.now() - t0}ms)`);
    return null;
  }
}

// ─── KV writer — merges fast_intel into lead:{lid}:intel ─────────────────────

async function writeFastIntelToKV(
  lid: string,
  firstName: string,
  websiteUrl: string,
  fastIntel: FastIntelResult,
  env: Env
): Promise<void> {
  const fn = normaliseName(firstName);
  const domain = extractDomain(websiteUrl);

  // Build the full KV envelope — canonical shape for bridge + tools worker
  const envelope: Record<string, any> = {
    v:            2,
    lid,
    ts:           new Date().toISOString(),
    // Root-level fields (MCP worker + bridge compat)
    firstName:    fn,
    first_name:   fn,
    websiteUrl,
    business_name: fastIntel.core_identity.business_name,
    // fast_intel layer
    fast_intel:   fastIntel,
    // core_identity — bridge reads this directly
    core_identity: fastIntel.core_identity,
    // script_fills at top level — bridge reads intel.consultant?.scriptFills
    consultant: {
      scriptFills:       fastIntel.script_fills,
      routing:           fastIntel.routing,
      conversationHooks: fastIntel.conversation_hooks,
      mostImpressive:    fastIntel.most_impressive,
      redFlags:          fastIntel.red_flags,
      landingPageVerdict: fastIntel.consultant?.landingPageVerdict ?? {},
      ...(fastIntel.consultant ?? {}),
    },
    // flags for bridge buildQueue
    flags: fastIntel.flags,
    // tech_stack at root — bridge reads for website_health synthesis
    tech_stack: fastIntel.tech_stack ?? {},
    // bella_opener at root (legacy compat)
    bella_opener: fastIntel.bella_opener,
    // fast_context (loading page redirect compat + bridge legacy reads)
    fast_context: {
      v:   1,
      lid,
      ts:  new Date().toISOString(),
      business: {
        name:         fastIntel.core_identity.business_name,
        domain,
        location:     fastIntel.core_identity.location,
        rating:       (fastIntel as any).places?.rating ?? 0,
        review_count: (fastIntel as any).places?.review_count ?? 0,
      },
      hero: fastIntel.hero,
      person: {
        first_name: fn,
        source:     "fast_intel",
      },
      // ads — now pixel-detected, not a placeholder
      ads: {
        is_running_ads:  fastIntel.tech_stack?.is_running_ads ?? false,
        pixels:          fastIntel.tech_stack?.ads_pixels ?? [],
        estimated_monthly_spend_aud: 0,  // Apify fills this
      },
    },
    // Google Places cross-ref data (P2-T1) — if available
    ...((fastIntel as any).places ? { places: (fastIntel as any).places } : {}),
    // Deep intel placeholder — filled by deep-scrape workflow
    // SCHEMA v3: deep at ROOT, not nested in intel.deep
    deep: { status: "processing" },
  };

  const str = JSON.stringify(envelope);

  // SCHEMA v4: Write to SEPARATE key — bridge merges all sources
  // fast-intel → lead:{lid}:fast-intel
  // big-scraper → lead:{lid}:stub
  // deep-scrape → lead:{lid}:deepIntel
  // Bridge reads all 3 with priority: fast-intel > deep-intel > stub
  await env.LEADS_KV.put(`lead:${lid}:fast-intel`, str);

  log("KV", `Written lid=${lid}:fast-intel biz="${fastIntel.core_identity.business_name}" fn="${fn}" ${str.length} bytes`);
}


// ─── DO Brain event delivery (Phase D — T012) ───────────────────────────────

async function deliverDOEvents(
  lid: string,
  envelope: Record<string, any>,
  consultant: Record<string, any> | null,
  env: Env,
): Promise<void> {
  const doFetch = (path: string, body: Record<string, any>) =>
    env.CALL_BRAIN.fetch(
      new Request(`https://do-internal${path}?callId=${encodeURIComponent(lid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-call-id': lid },
        body: JSON.stringify(body),
      }),
    );

  try {
    // 1. fast_intel_ready — full fast-intel payload
    // NOTE: session_init REMOVED (v2.1.0). DO self-heals via ensureSession on /turn.
    // Sending session_init from here would wipe state if bridge already initialized.
    const fastRes = await doFetch('/event', {
      type: 'fast_intel_ready',
      payload: envelope,
      version: 1,
    });
    log('DO_FAST', `lid=${lid} fast_intel_ready status=${fastRes.status}`);

    // 3. consultant_ready — if consultant data available
    if (consultant) {
      const consultRes = await doFetch('/event', {
        type: 'consultant_ready',
        payload: consultant,
        version: 1,
      });
      log('DO_CONSULTANT', `lid=${lid} consultant_ready status=${consultRes.status}`);
    }
  } catch (e: any) {
    log('DO_ERR', `lid=${lid} event delivery failed: ${e.message}`);
  }
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // ── POST /fast-intel ─────────────────────────────────────────────────────
    // Main endpoint. Called by capture.html immediately on form submit.
    // Should complete in ~8-12s — within loading page animation window.

    if (url.pathname === "/fast-intel" && request.method === "POST") {
      let body: { lid?: string; websiteUrl?: string; website_url?: string; firstName?: string; first_name?: string; email?: string };
      try { body = await request.json() as typeof body; }
      catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS }); }

      const lid        = body.lid;
      const websiteUrl = normaliseUrl(body.websiteUrl ?? body.website_url ?? "");
      const firstName  = normaliseName(body.firstName ?? body.first_name ?? "");

      if (!lid || !websiteUrl) {
        return new Response(JSON.stringify({ error: "Missing lid or websiteUrl" }), { status: 400, headers: CORS });
      }

      log("REQUEST", `POST /fast-intel lid=${lid} url=${websiteUrl} fn=${firstName}`);

      // Run fast intel pipeline
      const fastIntel = await runFastIntel(lid, websiteUrl, firstName, env);

      // P2-T1: Google Places cross-ref — verify name, grab rating + reviews
      if (env.GOOGLE_PLACES_API_KEY) {
        const places = await crossRefGooglePlaces(
          fastIntel.core_identity.business_name,
          fastIntel.core_identity.location,
          extractDomain(websiteUrl),
          env.GOOGLE_PLACES_API_KEY
        );
        if (places) {
          // Use Places name as authority if verified (score >= 5)
          if (places.verified && places.name) {
            const oldName = fastIntel.core_identity.business_name;
            fastIntel.core_identity.business_name = places.name;
            log("PLACES_NAME", `"${oldName}" → "${places.name}" (verified)`);
          }
          // Always store rating + reviews if Places returned them
          if (places.rating > 0 || places.reviewCount > 0) {
            (fastIntel as any).places = {
              name: places.name,
              rating: places.rating,
              review_count: places.reviewCount,
              place_id: places.placeId,
              verified: places.verified,
              address: places.formattedAddress,
            };
            // Enrich flags with early review signals
            if (places.reviewCount > 0) {
              (fastIntel.flags as any).review_signals = true;
            }
          }
        }
      }

      // Write to KV
      await writeFastIntelToKV(lid, firstName, websiteUrl, fastIntel, env);

      // Phase D: Deliver events to Call Brain DO (non-blocking)
      ctx.waitUntil(
        deliverDOEvents(lid, {
          core_identity: fastIntel.core_identity,
          flags: fastIntel.flags,
          tech_stack: fastIntel.tech_stack,
          bella_opener: fastIntel.bella_opener,
          firstName: fastIntel.firstName,
          first_name: fastIntel.first_name,
        }, fastIntel.consultant ?? null, env)
      );

      // Apify deep scrape already fired from inside runFastIntel (fast consultant callback)
      // — do NOT fire again here. Only trigger the big scraper.

      // Also trigger big scraper for rich Phase B enrichment (Google reviews, AI extraction, marketing intel)
      // v9.1.0: Use service binding instead of public URL (error 1042 fix)
      ctx.waitUntil(
        env.BIG_SCRAPER.fetch(
          new Request("https://big-scraper/log-lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lid,
              websiteUrl,
              firstName,
              businessName: fastIntel.core_identity.business_name,
              _v9_leadId: lid,
            }),
          })
        )
        .then(r => r.json())
        .then(d => log("BIG_SCRAPER_TRIGGER", `lid=${lid} ${JSON.stringify(d)}`))
        .catch(e => log("BIG_SCRAPER_ERR", `lid=${lid} ${e.message}`))
      );

      return new Response(JSON.stringify({
        ok:          true,
        lid,
        duration_ms: fastIntel.duration_ms,
        source:      fastIntel.source,
        business_name: fastIntel.core_identity.business_name,
        bella_opener:  fastIntel.bella_opener,
        fast_intel:    fastIntel,
      }), { status: 200, headers: CORS });
    }

    // ── GET /status?lid=xxx ───────────────────────────────────────────────────
    // Polling endpoint for loading page. Returns what's done.

    if (url.pathname === "/status" && request.method === "GET") {
      const lid = url.searchParams.get("lid");
      if (!lid) return new Response(JSON.stringify({ error: "Missing lid" }), { status: 400, headers: CORS });

      const raw = await env.LEADS_KV.get(`lead:${lid}:fast-intel`);
      if (!raw) {
        return new Response(JSON.stringify({ lid, fast_intel_done: false, apify_done: false }), { headers: CORS });
      }

      let data: Record<string, any> = {};
      try { data = JSON.parse(raw); } catch { data = {}; }

      const fastIntelDone = !!data?.fast_intel;
      const apifyDone     = data.intel?.deep?.status === "done";

      return new Response(JSON.stringify({
        lid,
        fast_intel_done: fastIntelDone,
        apify_done:      apifyDone,
        business_name:   data.core_identity?.business_name ?? data.business_name ?? "",
        bella_opener:    data.bella_opener ?? "",
      }), { headers: CORS });
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: CORS });
  },
};
