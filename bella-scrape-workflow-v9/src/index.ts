/**
 * BELLA SCRAPE WORKFLOW V8 — SUPERGOD MODE
 *
 * Single writer for lead:{lid}:call_brief
 * Combines fast-intel + deep-scrape into unified pipeline
 *
 * Timeline:
 *   T=0s    POST /run received
 *   T=1s    STEP 0: Write stub (pending)
 *   T=10s   STEP 2: Write phase_a (bella_opener ready)
 *   T=?     STEP 3: waitForEvent("call-connected") — pause until DO signals
 *   T=60s   STEP 6: Write ready (full brief with stages)
 *   T=60s+  STEP 7: Signal DO "brief-ready" → triggers UpdateThink
 */

import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import {
  CallBrief,
  CallBriefFlags,
  TechStack,
  DeepIntel,
  ConsultantOutput,
  StageScripts,
  Stage,
  FluxConfig,
  ScrapeParams,
  Env,
  FastIntelResult,
  ApifyHighlights,
  AgentSlot,
} from "./types";

const VERSION = "8.0.0-SUPERGOD";
const MODEL = "gemini-2.5-flash"; // NEVER gemini-3-flash-preview — too slow

const log = (tag: string, lid: string, msg: string) =>
  console.log(`[workflow ${VERSION}] [${tag}] lid=${lid} ${msg}`);

// ─── Apify Actor Runner ────────────────────────────────────────────────────────

async function runApifyActor(
  apiKey: string,
  actorId: string,
  input: Record<string, unknown>,
  onData?: (items: unknown[]) => void,
  maxPolls = 30,
  pollIntervalMs = 5000
): Promise<unknown[] | null> {
  if (!apiKey) return null;
  try {
    const startResp = await fetch(
      `https://api.apify.com/v9/acts/${actorId}/runs?token=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
    );
    if (!startResp.ok) return null;
    const startData = (await startResp.json()) as { data?: { id?: string, defaultDatasetId?: string } };
    const runId = startData?.data?.id;
    const datasetId = startData?.data?.defaultDatasetId;
    if (!runId || !datasetId) return null;

    let lastItemCount = 0;

    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      
      // Check status AND items in parallel (optimistic)
      const [statusResp, itemsResp] = await Promise.all([
        fetch(`https://api.apify.com/v9/actor-runs/${runId}?token=${apiKey}`),
        fetch(`https://api.apify.com/v9/datasets/${datasetId}/items?token=${apiKey}&limit=10`)
      ]);

      let items: unknown[] | null = null;
      if (itemsResp.ok) {
        items = (await itemsResp.json()) as unknown[];
        if (items.length > lastItemCount) {
          lastItemCount = items.length;
          if (onData) onData(items);
        }
      }

      if (statusResp.ok) {
        const statusData = (await statusResp.json()) as { data?: { status?: string } };
        const status = statusData?.data?.status;
        if (status === "SUCCEEDED") return items;
        if (["FAILED", "ABORTED", "TIMED-OUT"].includes(status || "")) return items;
      }
    }
    return null;
  } catch (err) {
    return null;
  }
}

function settle<T>(result: PromiseSettledResult<T | null>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

// ─── Summary Builders (from deep-scrape) ───────────────────────────────────────

function buildAdsSummary(fb: unknown[] | null, google: unknown[] | null) {
  type Item = Record<string, unknown>;
  const fbRunning = fb && fb.length > 0;
  const gRunning = google && google.length > 0;
  return {
    fb: fbRunning
      ? {
          running: true,
          count: fb!.length,
          ctas: [...new Set((fb as Item[]).map((a) => String(a.callToActionType || a.cta_type || "")).filter(Boolean).map((c) => c.replace(/_/g, " ").toLowerCase()))],
          creatives_sample: (fb as Item[]).slice(0, 3).map((a) => String(a.bodyText || a.caption || a.body || "")).filter((c) => c.length > 10),
        }
      : { running: false, count: 0 },
    google: gRunning
      ? {
          running: true,
          count: google!.length,
          headlines_sample: (google as Item[]).slice(0, 3).map((a) => String(a.headline || a.title || "")).filter((h) => h.length > 5),
        }
      : { running: false, count: 0 },
  };
}

function buildHiringSummary(indeed: unknown[] | null) {
  if (!indeed || indeed.length === 0) return { is_hiring: false, roles: [], count: 0 };
  type Job = Record<string, unknown>;
  const roles = (indeed as Job[]).slice(0, 5).map((j) => String(j.positionName || j.title || j.jobTitle || "")).filter(Boolean);
  return { is_hiring: true, roles, count: indeed.length };
}

function buildGoogleMapsSummary(items: unknown[] | null) {
  if (!items || items.length === 0) return null;
  type Place = Record<string, unknown>;
  const place = items[0] as Place;
  const reviews = (items as Place[]).slice(1, 6).map((r) => String(r.text || r.reviewText || "")).filter((t) => t.length > 20);
  return {
    rating: Number(place.rating || place.totalScore || 0) || null,
    review_count: Number(place.reviewsCount || place.userRatingsTotal || 0) || 0,
    address: String(place.address || place.formatted_address || ""),
    recent_reviews: reviews,
  };
}

function buildLinkedInSummary(items: unknown[] | null) {
  if (!items || items.length === 0) return null;
  type Co = Record<string, unknown>;
  const co = items[0] as Co;
  return {
    employee_count: Number(co.employeeCount || co.staffCount || 0) || null,
    industry: String(co.industryName || co.industry || ""),
    description_snippet: String(co.description || "").slice(0, 200),
  };
}

// ─── Use Case Trigger Engine ───────────────────────────────────────────────────

/**
 * Derives the 5 trigger booleans from tech stack flags + deep intel.
 * These drive agent_ranking order and which discovery stages are active.
 */
function calculateTriggers(
  flags: Omit<CallBriefFlags, 'trigger_alex' | 'trigger_chris' | 'trigger_maddie' | 'trigger_sarah' | 'trigger_james'>,
  deepIntel: DeepIntel | null
): Pick<CallBriefFlags, 'trigger_alex' | 'trigger_chris' | 'trigger_maddie' | 'trigger_sarah' | 'trigger_james'> {
  const hiringRoles = deepIntel?.hiring?.roles ?? [];
  const hiringForReceptionist = hiringRoles.some((r) =>
    /(receptionist|admin|front.?desk|office.?manager|customer.?service)/i.test(r)
  );
  const hiringForSales = hiringRoles.some((r) =>
    /(sales|bdr|sdr|account.?exec|business.?dev|marketing|growth)/i.test(r)
  );

  const googleRating = deepIntel?.googleMaps?.rating ?? null;
  const reviewCount = deepIntel?.googleMaps?.review_count ?? 0;

  return {
    // Alex: Any ads signal. Ads running = speed-to-lead is the #1 problem.
    trigger_alex: flags.is_running_ads || flags.speed_to_lead_needed || hiringForSales,
    // Chris: Ads running but weak landing page conversion infra (no chat or no booking)
    trigger_chris: (flags.is_running_ads || flags.speed_to_lead_needed) &&
      (flags.no_chat || flags.no_booking),
    // Maddie: Call handling risk. Elevated if actively hiring receptionist.
    trigger_maddie: flags.call_handling_needed || hiringForReceptionist ||
      (!flags.no_chat && !flags.no_booking ? false : !flags.is_running_ads),
    // Sarah: Old database or established business with stale leads
    trigger_sarah: flags.database_reactivation || flags.business_age_established,
    // James: Review gap — low rating or low count
    trigger_james: flags.review_signals &&
      ((googleRating !== null && googleRating < 4.5) || reviewCount < 20),
  };
}

/**
 * Extracts Apify proof points that Bella can quote directly in conversation.
 * Makes the pitch feel researched and specific rather than generic.
 */
function buildApifyHighlights(deepIntel: DeepIntel | null): ApifyHighlights {
  const hiringRoles = deepIntel?.hiring?.roles ?? [];
  const hiringRole = hiringRoles[0] ?? null;

  let hiringRoleCategory: ApifyHighlights['hiring_role_category'] = null;
  if (hiringRole) {
    if (/(receptionist|admin|front.?desk|office)/i.test(hiringRole)) hiringRoleCategory = 'receptionist';
    else if (/(sales|bdr|sdr|account.?exec|business.?dev)/i.test(hiringRole)) hiringRoleCategory = 'sales';
    else if (/(marketing|growth|seo|content|social)/i.test(hiringRole)) hiringRoleCategory = 'marketing';
    else hiringRoleCategory = 'other';
  }

  // Build ad campaign names from FB creatives and CTAs
  const fbAds = deepIntel?.ads?.fb;
  const adCampaigns: string[] = [];
  if (fbAds?.running) {
    if (fbAds.ctas && fbAds.ctas.length > 0) {
      // e.g. "get a free quote" CTA → "your Free Quote campaign on Facebook"
      fbAds.ctas.slice(0, 2).forEach((cta) => {
        adCampaigns.push(`your "${cta.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}" campaign on Facebook`);
      });
    } else {
      adCampaigns.push(`${fbAds.count} active ad${fbAds.count > 1 ? 's' : ''} running on Facebook`);
    }
  }
  if (deepIntel?.ads?.google?.running) {
    const gAds = deepIntel.ads.google;
    adCampaigns.push(gAds.headlines_sample?.[0]
      ? `a Google campaign with headline: "${gAds.headlines_sample[0]}"`
      : `${gAds.count} active Google ad${gAds.count > 1 ? 's' : ''}`);
  }

  const recentReviews = deepIntel?.googleMaps?.recent_reviews ?? [];
  const recentReviewSnippet = recentReviews
    .find((r) => r.length > 30 && r.length < 200) ?? null;

  return {
    ad_campaigns: adCampaigns,
    hiring_role: hiringRole,
    hiring_role_category: hiringRoleCategory,
    google_rating: deepIntel?.googleMaps?.rating ?? null,
    google_review_count: deepIntel?.googleMaps?.review_count ?? 0,
    recent_review_snippet: recentReviewSnippet,
    social_profiles: [], // Phase 2: populated when social profile analysis is added
  };
}

// Agent power descriptors — what Bella says when she introduces each agent
const AGENT_DESCRIPTORS: Record<string, string> = {
  Alex: "Alex ensures every lead gets a response within 60 seconds — so you never lose another hot prospect to a competitor who picks up the phone first",
  Chris: "Chris turns every hot website visitor into an immediate sales call, guiding all visitors straight to your conversion event — think of it as having a world-class closer available on your website 24/7",
  Maddie: "Maddie answers every missed call around the clock — so if your team is unavailable, you never lose that booking or inquiry again",
  Sarah: "Sarah reactivates your sleeping database — turning old leads and past customers who went cold into booked appointments with zero extra ad spend",
  James: "James automatically follows up with every happy client and posts their 5-star review to Google within 60 seconds of their appointment — it's like having a reputation manager who never sleeps",
};

/**
 * Builds the ordered AgentSlot array.
 * - Slots 1 & 2: full_crunch (Alex + Chris by default, Maddie to #2 if receptionist hiring)
 * - Slot 3: descriptor_only (offered to prospect: "want me to run the numbers on this one too?")
 * - Slots 4 & 5: not presented in this call
 */
function buildAgentSlots(
  triggers: Pick<CallBriefFlags, 'trigger_alex' | 'trigger_chris' | 'trigger_maddie' | 'trigger_sarah' | 'trigger_james'>,
  highlights: ApifyHighlights
): AgentSlot[] {
  type AgentName = "Alex" | "Chris" | "Maddie" | "Sarah" | "James";

  // Priority order — Alex and Chris are always 1-2
  // Exception: hiring for receptionist elevates Maddie to position #2
  const maddieElevated = highlights.hiring_role_category === 'receptionist';

  const orderedNames: AgentName[] = maddieElevated
    ? ["Alex", "Maddie", "Chris", "Sarah", "James"]
    : ["Alex", "Chris", "Maddie", "Sarah", "James"];

  // Build proof points per agent from Apify data
  const proofPoints: Partial<Record<AgentName, string | null>> = {
    Alex: highlights.ad_campaigns.length > 0
      ? `I can see ${highlights.ad_campaigns[0]} — that's exactly the scenario where Alex pays for itself`
      : null,
    Chris: highlights.ad_campaigns.length > 0
      ? `With ${highlights.ad_campaigns.length} campaign${highlights.ad_campaigns.length > 1 ? 's' : ''} running, every visitor who clicks your ad is a live sales opportunity — and Chris captures them all`
      : null,
    Maddie: highlights.hiring_role
      ? `I actually noticed you're hiring for a ${highlights.hiring_role} — that tells me your team is stretched and there's real risk of missed calls`
      : null,
    Sarah: null,
    James: highlights.google_rating !== null
      ? `You're sitting at ${highlights.google_rating} stars with ${highlights.google_review_count} reviews — James can accelerate that significantly`
      : null,
  };

  const triggerMap: Partial<Record<AgentName, keyof CallBriefFlags>> = {
    Alex: 'trigger_alex',
    Chris: 'trigger_chris',
    Maddie: 'trigger_maddie',
    Sarah: 'trigger_sarah',
    James: 'trigger_james',
  };

  return orderedNames.map((name, idx) => ({
    name,
    rank: (idx + 1) as 1 | 2 | 3 | 4 | 5,
    presentation: idx < 2 ? 'full_crunch' : 'descriptor_only',
    descriptor: AGENT_DESCRIPTORS[name],
    trigger: triggerMap[name] ?? null,
    proof_point: proofPoints[name] ?? null,
  }));
}

// ─── Firecrawl Scraper ─────────────────────────────────────────────────────────

async function firecrawlScrape(websiteUrl: string, apiKey: string): Promise<Record<string, any> | null> {
  if (!apiKey) { log("FIRECRAWL", "", "No API key — skipping"); return null; }

  try {
    const t0 = Date.now();
    const abortCtrl = new AbortController();
    const abortTimer = setTimeout(() => abortCtrl.abort(), 12000);

    const resp = await fetch("https://api.firecrawl.dev/v9/scrape", {
      method: "POST",
      signal: abortCtrl.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url: websiteUrl,
        formats: ["markdown", "html", "extract", "links"],
        onlyMainContent: false,
        waitFor: 500,
        timeout: 10000,
        extract: {
          schema: {
            type: "object",
            properties: {
              title: { type: "string" },
              h1: { type: "string" },
              h2: { type: "string" },
              description: { type: "string" },
              phone: { type: "string" },
              email: { type: "string" },
              address: { type: "string" },
              ctas: { type: "array", items: { type: "string" } },
              services: { type: "array", items: { type: "string" } },
              key_benefits: { type: "array", items: { type: "string" } },
              tagline: { type: "string" },
              target_audience: { type: "string" },
              has_chat: { type: "boolean" },
              has_booking: { type: "boolean" },
              crm_name: { type: "string" },
              booking_tool: { type: "string" },
              chat_tool: { type: "string" },
              review_rating_claim: { type: "string", description: "Any mention of a star rating, e.g. 4.9 stars" },
              review_count_claim: { type: "string", description: "Any mention of the number of reviews, e.g. Over 500 reviews" },
              ad_mention_claim: { type: "string", description: "Any mention of being featured in ads or specific platforms" },
              hiring_mention_claim: { type: "string", description: "Any mention of active hiring or career opportunities" }
            }
          }
        }
      }),
    });

    clearTimeout(abortTimer);
    if (!resp.ok) {
      log("FIRECRAWL", "", `HTTP ${resp.status}`);
      return null;
    }

    const data = await resp.json() as Record<string, any>;
    const fc = data?.data ?? data;
    log("FIRECRAWL", "", `Done in ${Date.now() - t0}ms — ${(fc?.markdown ?? "").length} chars`);

    return {
      markdown: fc?.markdown ?? "",
      html: fc?.html ?? "",
      title: fc?.extract?.title || fc?.metadata?.title || "",
      h1: fc?.extract?.h1 || fc?.metadata?.ogTitle || "",
      h2: fc?.extract?.h2 || "",
      description: fc?.extract?.description || fc?.metadata?.description || "",
      ogTitle: fc?.metadata?.ogTitle || "",
      ogDescription: fc?.metadata?.ogDescription || "",
      links: (fc?.links ?? []).slice(0, 20),
      extract: fc?.extract ?? {},
    };
  } catch (err: any) {
    log("FIRECRAWL", "", err?.name === "AbortError" ? "Timed out" : `Error: ${err}`);
    return null;
  }
}

// ─── Tech Stack Detection ──────────────────────────────────────────────────────

function detectTechStack(html: string, extracted: Record<string, any>): TechStack {
  const h = html.toLowerCase();
  const ex = (s: string) => extracted[s] ?? "";

  // CRM detection
  const crm_hubspot = h.includes("hubspot") || h.includes("hs-scripts");
  const crm_salesforce = h.includes("salesforce") || h.includes("pardot");
  const crm_keap = h.includes("infusionsoft") || h.includes("keap");
  const crm_ghl = h.includes("msgsndr") || h.includes("highlevel") || h.includes("leadconnector");
  const crm_name = crm_hubspot ? "HubSpot" : crm_salesforce ? "Salesforce" : crm_keap ? "Keap" : crm_ghl ? "GoHighLevel" : (ex("crm_name") as string) || undefined;
  const has_crm = !!crm_name;

  // Chat detection
  const chat_intercom = h.includes("intercom.io");
  const chat_drift = h.includes("drift.com");
  const chat_tawk = h.includes("tawk.to");
  const chat_crisp = h.includes("crisp.chat");
  const chat_tidio = h.includes("tidio.com");
  const chat_tool = chat_intercom ? "Intercom" : chat_drift ? "Drift" : chat_tawk ? "Tawk.to" : chat_crisp ? "Crisp" : chat_tidio ? "Tidio" : (ex("chat_tool") as string) || undefined;
  const has_chat = !!(chat_tool || ex("has_chat"));

  // Booking detection
  const book_calendly = h.includes("calendly.com");
  const book_acuity = h.includes("acuityscheduling");
  const book_mindbody = h.includes("mindbodyonline");
  const booking_tool = book_calendly ? "Calendly" : book_acuity ? "Acuity" : book_mindbody ? "Mindbody" : (ex("booking_tool") as string) || undefined;
  const has_booking = !!(booking_tool || ex("has_booking"));

  // Ad pixels
  const pixel_fb = h.includes("connect.facebook.net") || h.includes("fbevents.js");
  const pixel_google = h.includes("googleadservices.com") || h.includes("gtag");
  const pixel_tiktok = h.includes("analytics.tiktok.com");
  const pixel_linkedin = h.includes("snap.licdn.com");

  const ads_pixels: string[] = [
    pixel_fb && "Meta/Facebook",
    pixel_google && "Google Ads",
    pixel_tiktok && "TikTok",
    pixel_linkedin && "LinkedIn",
  ].filter(Boolean) as string[];

  const is_running_ads = ads_pixels.length > 0;
  const is_retargeting = pixel_fb && pixel_google;

  // Social
  const social_fb = h.includes("facebook.com/") && !h.includes("connect.facebook");
  const social_instagram = h.includes("instagram.com/");
  const social_linkedin = h.includes("linkedin.com/company");
  const social_channels: string[] = [
    social_fb && "Facebook",
    social_instagram && "Instagram",
    social_linkedin && "LinkedIn",
  ].filter(Boolean) as string[];

  return {
    has_crm,
    has_chat,
    has_booking,
    crm_name,
    chat_tool,
    booking_tool,
    is_running_ads,
    is_retargeting,
    ads_pixels,
    social_channels,
    flags_tech: {
      has_fb_pixel: pixel_fb,
      has_google_ads: pixel_google,
      has_tiktok_ads: pixel_tiktok,
      has_multi_platform_ads: ads_pixels.length > 1,
      speed_to_lead_needed: is_running_ads && !has_crm,
      call_handling_needed: !has_chat && !has_booking,
    },
  };
}

// ─── Industry Inference ────────────────────────────────────────────────────────

function inferIndustry(text: string): { industry: string; industry_key: string; customer_term: string } {
  const t = text.toLowerCase();
  if (t.includes("consulting") || t.includes("consultancy") || t.includes("management advisory") || t.includes("nous group")) return { industry: "Consulting", industry_key: "consulting", customer_term: "client" };
  if (t.includes("artificial intelligence") || t.includes(" ai ") || t.includes("generative ai") || t.includes("machine learning")) return { industry: "Artificial Intelligence", industry_key: "ai", customer_term: "client" };
  if (t.includes("dental") || t.includes("dentist")) return { industry: "Dental", industry_key: "dental", customer_term: "patient" };
  if (t.includes("physio")) return { industry: "Physiotherapy", industry_key: "physio", customer_term: "patient" };
  if (t.includes("legal") || t.includes("lawyer") || t.includes("solicitor")) return { industry: "Legal", industry_key: "legal", customer_term: "client" };
  if (t.includes("accountant") || t.includes("bookkeep") || t.includes("audit")) return { industry: "Accounting", industry_key: "accounting", customer_term: "client" };
  if (t.includes("plumb") || t.includes("electric") || t.includes("hvac")) return { industry: "Trades", industry_key: "trades", customer_term: "customer" };
  if (t.includes("real estate") || t.includes("property")) return { industry: "Real Estate", industry_key: "realestate", customer_term: "client" };
  if (t.includes("restaurant") || t.includes("cafe")) return { industry: "Hospitality", industry_key: "hospitality", customer_term: "customer" };
  if (t.includes("insur")) return { industry: "Insurance", industry_key: "insurance", customer_term: "policyholder" };
  if (t.includes("marketing") && t.includes("agency")) return { industry: "Marketing Agency", industry_key: "agency", customer_term: "client" };
  return { industry: "Business", industry_key: "business", customer_term: "customer" };
}

// ─── Build Stage Scripts ───────────────────────────────────────────────────────

function buildStageScripts(
  brief: Partial<CallBrief>,
  deepIntel: DeepIntel | undefined,
  consultant: ConsultantOutput | undefined,
  fc_extract?: Record<string, any>
): StageScripts {
  const fn = brief.firstName || "there";
  const biz = brief.business_name || "your business";
  const ct = brief.customer_term || "customer";
  const opener = brief.bella_opener || `Hi ${fn}! I've been looking at ${biz}.`;

  const sf = consultant?.scriptFills ?? {};
  const flags = brief.flags;
  const highlights = brief.apify_highlights;
  const slots = brief.agent_slots ?? [];

  // Agent slots
  const slot1 = (slots[0]?.name ?? "Alex") as Stage["agent"];
  const slot2 = (slots[1]?.name ?? "Chris") as Stage["agent"];
  const slot3 = (slots[2]?.name ?? "Maddie") as Stage["agent"];
  const slot2Descriptor = slots[1]?.descriptor ?? "";
  const slot3Descriptor = slots[2]?.descriptor ?? "";

  // Apify proof points
  const adCampaigns = highlights?.ad_campaigns ?? [];
  const adProof = adCampaigns[0] ? `I can see ${adCampaigns[0]} — ` 
    : (fc_extract?.ad_mention_claim ? `I noticed ${fc_extract.ad_mention_claim} — ` : "");

  const hiringProof = highlights?.hiring_role
    ? `I noticed you're actively hiring for a ${highlights.hiring_role} — `
    : (fc_extract?.hiring_mention_claim ? `I see you've got some open positions listed on the site — ` : "");

  const ratingProof = highlights?.google_rating
    ? `You're sitting at ${highlights.google_rating} stars with ${highlights.google_review_count} reviews — `
    : (fc_extract?.review_rating_claim ? `I can see you've got a ${fc_extract.review_rating_claim} rating on the site — ` : "");

  // Active flags
  const alexActive = true; // Alex always #1
  const chrisActive = flags?.trigger_chris ?? (flags?.is_running_ads && flags?.no_booking) ?? true;
  const maddieActive = flags?.trigger_maddie ?? flags?.call_handling_needed ?? true;
  const sarahActive = flags?.trigger_sarah ?? flags?.database_reactivation ?? false;
  const jamesActive = flags?.trigger_james ?? flags?.review_signals ?? false;
  const slot3Active = maddieActive || sarahActive || jamesActive;

  const stages: Stage[] = [
    // ── OPENING ───────────────────────────────────────────────────────────────
    {
      id: 1,
      key: "wow",
      agent: "Bella",
      active: true,
      script: `WOW — HOOK IN 30 SECONDS\n\nSAY: "${opener}"\n${sf.website_positive_comment ? `\nThen: "${sf.website_positive_comment}"` : ""}\n${adProof ? `\nThen (naturally): "I actually noticed ${adProof}that's exactly why I wanted to reach out."` : ""}\n${hiringProof ? `\nAlternatively: "${hiringProof}that's a telling sign of a business that's growing."` : ""}\n\nONE or TWO sentences max. WAIT.`,
    },
    {
      id: 2,
      key: "demo_value_bridge",
      agent: "Bella",
      active: true,
      advance_on: "yes|sure|ok|go ahead|sounds good|absolutely",
      script: `VALUE BRIDGE — Set the Frame\n\nSAY: "The reason I'm calling is we've built AI agents that work specifically for businesses like yours. Instead of just telling you about them, I'd love to show you what they could actually mean for ${biz} in dollar terms."\n\n"To do that I just need a couple of quick numbers from you — takes about 90 seconds. Sound fair?"\n\nWAIT for agreement.`,
    },
    {
      id: 3,
      key: "anchor_acv",
      agent: "Bella",
      active: true,
      capture: "average_customer_value",
      script: `ANCHOR — Average Customer Value\n\nASK: "What's a typical ${ct} worth to ${biz} on average? Just a rough number."\n\nCapture the figure. Confirm it back: "Got it — so around $X per ${ct}. Perfect."\n\nONE question. WAIT.`,
    },
    {
      id: 4,
      key: "anchor_volume",
      agent: "Bella",
      active: true,
      capture: "leads_per_week",
      script: `ANCHOR — Lead Volume\n\nASK: "And roughly how many new ${ct}s or enquiries are you getting per week?"\n\nConfirm: "Great — so about X new leads per week."\n\nONE question. WAIT.`,
    },

    // ── AGENT 1 (ALWAYS ALEX) — FULL CRUNCH ──────────────────────────────────
    {
      id: 5,
      key: "alex_intro",
      agent: "Alex",
      active: alexActive,
      capture: "follow_up_speed_hours",
      script: `ALEX — Speed to Lead\n\nSAY: "OK — let me introduce you to our first agent. Alex ensures every lead gets a response within 60 seconds — so you never lose a hot prospect to a competitor who picks up the phone first."\n\n${adProof ? `"And what makes this especially relevant for you — ${adProof}every second between that ad click and the callback costs you money."` : ""}\n\nASK: "When a new lead comes in right now — how quickly does someone actually follow up?"\n\nCAPTURE: follow_up_speed_hours. WAIT.`,
    },
    {
      id: 6,
      key: "alex_ads_volume",
      agent: "Alex",
      active: flags?.trigger_alex ?? true,
      capture: "ads_leads_per_week",
      script: `ALEX — Ads Lead Volume\n\n${adCampaigns.length > 0 ? `"I can see ${adCampaigns.slice(0, 2).join(" and ")} running right now. "` : ""}\n\nASK: "How many leads per week would you say are coming specifically through your ads?"\n\nCAPTURE: ads_leads_per_week. WAIT.`,
    },
    {
      id: 7,
      key: "alex_roi",
      agent: "Alex",
      active: alexActive,
      script: `ALEX — ROI DELIVER (IMMEDIATE)\n\nCalculate based on captured data:\n  - follow_up_speed > 24h → 391% uplift\n  - 2–24h → 200% uplift\n  - <2h → 100% uplift\n  - <30min → 50% uplift (still valuable, pivot emphasis to Chris)\n\nSAY: "Here's what the numbers look like for ${biz}:\n\nYou've got [leads_per_week] new leads per week, worth $[acv] each.\nRight now your response time is [follow_up_speed]. Research shows that leads contacted in under 60 seconds are [X]% more likely to convert.\n\nWith Alex, that's an extra [calculated_leads] ${ct}s per month — at $[acv] that's roughly $[calculated_monthly] per month in revenue you're currently leaving on the table."\n\n"Does that math track for you?"\n\nWAIT. If excited → agent2_intro. If skeptical → address objection.`,
    },

    // ── AGENT 2 — FULL CRUNCH ─────────────────────────────────────────────────
    {
      id: 8,
      key: "agent2_intro",
      agent: slot2,
      active: true, // Always shown
      script: `${String(slot2).toUpperCase()} — INTRO\n\nSAY: "And the second one I want to show you is ${String(slot2)}. ${slot2Descriptor}"\n\n${slot2 === "Chris" && adProof ? `"You're paying for traffic — if the landing page isn't converting visitors instantly, you're losing a percentage every single day."` : ""}\n${slot2 === "Maddie" && hiringProof ? `"${hiringProof}that's exactly why Maddie becomes critical for a business like yours."` : ""}\n\nASK: "${slot2 === "Chris" ? `Out of 100 website visitors, roughly how many actually become enquiries?` : `What happens when someone calls and your team can't answer?`}"\n\nCAPTURE: ${slot2 === "Chris" ? "website_conversion_rate" : "missed_call_percentage"}. WAIT.`,
      capture: slot2 === "Chris" ? "website_conversion_rate" : "missed_call_percentage",
    },
    {
      id: 9,
      key: "agent2_discovery",
      agent: slot2,
      active: chrisActive || maddieActive,
      script: `${String(slot2).toUpperCase()} — DISCOVERY\n\n${slot2 === "Chris"
        ? `ASK: "Roughly how much are you spending per month on ads — Facebook, Google, combined?"
CAPTURE: monthly_ad_spend`
        : `ASK: "Out of 10 calls that come in when you're busy — how many would you say get missed?"
CAPTURE: missed_calls_per_10`}\n\nWAIT.`,
      capture: slot2 === "Chris" ? "monthly_ad_spend" : "missed_calls_per_10",
    },
    {
      id: 10,
      key: "agent2_roi",
      agent: slot2,
      active: true,
      script: `${String(slot2).toUpperCase()} — ROI DELIVER (IMMEDIATE)\n\n${slot2 === "Chris"
        ? `Calculate: +15-25% conversion lift on current ad traffic\nSAY: "So you're spending $[monthly_ad_spend]/month on ads, converting at [X]%.\nWith Chris, that goes up by 15–25% — that's [N] extra leads per month.\nAt $[acv] each, that's roughly $[calculated_monthly] per month."`
        : `Calculate: missed_call% × leads_per_week × 4 × acv\nSAY: "If you're missing [X]% of calls and getting [leads_per_week] leads per week — that's [N] missed enquiries per month.\nAt $[acv] each, Maddie recovers roughly $[calculated_monthly] per month."` }\n\n"Does that track?"\n\nWAIT. → advance to agent3_descriptor`,
    },

    // ── AGENT 3 — DESCRIPTOR ONLY + OPTIONAL CRUNCH ──────────────────────────
    {
      id: 11,
      key: "agent3_descriptor",
      agent: slot3,
      active: slot3Active,
      advance_on: "yes|sure|run the numbers|let's see|go ahead",
      script: `${String(slot3).toUpperCase()} — DESCRIPTOR PITCH\n\nSAY: "There's one more I want to quickly flag — ${String(slot3)}. ${slot3Descriptor}"\n\n${slot3 === "Maddie" && hiringProof ? `\n"${hiringProof}— Maddie is an obvious fit for where you're at right now."` : ""}\n${slot3 === "James" && ratingProof ? `\n"${ratingProof}James would have a very clear impact for ${biz}."` : ""}\n${slot3 === "Sarah" ? `\n"If you've got a database of past leads or enquiries that never converted, Sarah is built for exactly that."` : ""}\n\nASK: "Want me to run the numbers on ${String(slot3)} as well, or are you happy to move forward with ${String(slot1)} and ${String(slot2)}?"\n\nIf YES → agent3_crunch\nIf NO → transition_to_close`,
    },
    {
      id: 12,
      key: "agent3_crunch",
      agent: slot3,
      active: false, // Activated only if prospect says yes at stage 11
      script: `${String(slot3).toUpperCase()} — OPTIONAL CRUNCH\n\n${slot3 === "Maddie"
        ? `ASK: "Roughly how many calls per day would you say go unanswered?"
CAPTURE: missed_calls_per_day`
        : slot3 === "Sarah"
        ? `ASK: "How big is your existing database — past leads or enquiries that never converted?"
CAPTURE: old_lead_database_size`
        : `ASK: "What's your current Google star rating and how many reviews do you have?"
CAPTURE: google_rating_confirmed`}\n\nCalculate ROI using same model.\nDeliver immediately: "With ${String(slot3)}, that's roughly $[calculated_monthly] more per month."\n\n→ Advance to transition_to_close`,
      capture: slot3 === "Maddie" ? "missed_calls_per_day" : slot3 === "Sarah" ? "old_lead_database_size" : "google_rating_confirmed",
    },

    // ── TRANSITION + CLOSE ────────────────────────────────────────────────────
    {
      id: 13,
      key: "transition_to_close",
      agent: "Bella",
      active: true,
      script: `TRANSITION TO CLOSE\n\nSAY: "So ${fn}, based on everything you've shared today:\n\n${String(slot1)}: ~$[alex_monthly]/month\n${String(slot2)}: ~$[agent2_monthly]/month\n${slot3Active ? `${String(slot3)}: ~$[agent3_monthly]/month` : ""}\n\nCombined, that's roughly $[total_monthly]/month in additional revenue for ${biz}.\n\nThe next step is a quick 15-minute chat with our team to map out which agent to start with and get you set up."\n\n→ Advance to trial_offer`,
    },
    {
      id: 14,
      key: "just_demo_pivot",
      agent: "Bella",
      active: true, // Always available as a branch
      script: `JUST DEMO PIVOT (triggered if prospect says "just show me" / "skip the numbers")\n\nSAY: "Sure! Let me just show you what this looks like for a business like yours.\n\n${String(slot1)} is typically the starting point — it's the one with the fastest visible ROI. It works by automatically responding to every new lead within 60 seconds, 24/7.\n\n${String(slot2)} works alongside it — ${slot2Descriptor}\n\nMost clients start with one and add the second once they see the numbers. The next step is a 15-minute setup call — they'll walk you through exactly how it would look for ${biz}."\n\n→ Advance to trial_offer`,
    {
      id: 15,
      key: "trial_offer",
      agent: "Bella",
      active: true,
      advance_on: "yes|set me up|let's do it|get started|do it now",
      script: `TRIAL OFFER / CLOSE\n\nSAY: "We have a trial option — so you can see it working for ${biz} before any long-term commitment. I can actually get you set up right now if you've got 10 minutes."\n\n"Want to do that, or would a call with one of our specialists make more sense?"\n\nIf yes → warm_handoff\nIf call → booking_cta`,
    },
  ];

  // ── CONSULTANT AUTHORITY: Merge specialized scripts if they exist ──────────
  // If the Consultant worker returned specific stages (V8 format), they override
  // the heuristic templates below. This prevents data regression during updates.
  if (consultant?.stages && Array.isArray(consultant.stages)) {
    log("BUILD", brief.lid || "unknown", `merging ${consultant.stages.length} consultant stages into template`);
    stages.forEach(s => {
      const match = consultant.stages!.find((cs: any) => cs.key === s.key);
      if (match) {
        s.script = match.script;
        if (match.agent) s.agent = match.agent;
      }
    });
  }

  return {
    source: consultant?.stages ? 'consultant' : 'heuristic',
    stages,
    objection_price: `OBJECTION: PRICE\n\nACKNOWLEDGE: "I totally get that — budget is always a consideration."\n\nREFRAME: "Let me ask you this — if ${String(slot1)} brought in just one extra ${ct} per week at $[acv], that's $[acv_times_4]/month. Our agents cost a fraction of that."\n\n"The question isn't whether you can afford it — it's whether you can afford to keep losing those leads."`,
    objection_timing: `OBJECTION: TIMING\n\nACKNOWLEDGE: "I hear you."\n\nREFRAME: "Every day without ${String(slot1)} is another day of leads going cold. Let's at least get the call booked so you have the option. What's better — tomorrow or end of week?"`,
    objection_not_interested: `OBJECTION: NOT INTERESTED\n\nSOFT CHALLENGE: "Fair enough. Out of curiosity — what would need to be true for something like this to make sense for ${biz}?"\n\nLISTEN. If firm: "No problem at all — enjoy the rest of your day ${fn}."`,
    objection_competitor: `OBJECTION: COMPETITOR\n\nASK: "Oh interesting — who are you using?"\n\nLISTEN. Then: "How's that working? Hitting your lead response targets?"\n\nIf friction → lean in. If happy → graceful exit.`,
    objection_need_to_think: `OBJECTION: NEED TO THINK\n\nSAY: "Totally understand."\n\n"I'll send a quick summary of the numbers we went through. When would be a good time for a 10-minute follow-up?"`,
    fallback_no_data: `FALLBACK — NO DATA\n\nSAY: "Tell me about ${biz} — what's the main service and who's your typical ${ct}?"\nBUILD RAPPORT. Find the angle.`,
    fallback_confused: `FALLBACK — CONFUSED\n\nSAY: "Let me take a step back. Our AI agents each handle a specific revenue gap — lead response, booking, reviews, old leads. Each one is built to bring in more revenue with zero extra headcount."\n\n"What part of ${biz} would benefit most from automation right now?"`,
    fallback_off_topic: `FALLBACK — OFF TOPIC\n\nBring it back: "That's interesting! So back to ${biz} — what's the biggest bottleneck with new enquiries right now?"`,
    warm_handoff: `WARM HANDOFF\n\nSAY: "I'm going to bring in one of our specialists right now. Give me just one second."\n\nTrigger handoff. Confirm specialist name.`,
    booking_cta: `BOOKING CTA\n\nSAY: "Perfect. I've got tomorrow and Thursday — which works better?"\n\nConfirm time. Repeat back. "You'll get a calendar invite within the next few minutes. Looking forward to it ${fn}!"`,
    goodbye: `GOODBYE\n\nSAY: "Thanks so much ${fn} — really enjoyed chatting about ${biz}. You'll get a summary email shortly with the numbers we went through. Have a great day!"`,
  };
}


// ─── Build Flux Configs per Stage ──────────────────────────────────────────────


/**
 * Build Flux Configure configs per stage
 *
 * Flux model: flux-general-en
 * Configure message format:
 * {
 *   type: "Configure",
 *   thresholds: { eot_threshold, eot_timeout_ms },
 *   keyterms?: string[]  // REPLACES existing, not merges
 * }
 */
function buildFluxConfigs(brief: Partial<CallBrief>): Record<string, FluxConfig> {
  const biz = brief.business_name || "";
  const fn = brief.firstName || "";
  const agents = brief.agent_ranking ?? ["Alex", "Chris", "Maddie", "Sarah", "James"];

  return {
    wow: {
      eot_timeout_ms: 2000,   // Relaxed — let them talk
      eot_threshold: 0.6,
      keyterms: [biz, fn].filter(Boolean),
    },
    anchor_acv: {
      eot_timeout_ms: 3000,   // Give time for number response
      eot_threshold: 0.8,     // Tight — capturing numbers
      keyterms: ["thousand", "hundred", "million", "dollars", "weekly", "monthly", "grand", "k"],
    },
    anchor_timeframe: {
      eot_timeout_ms: 2500,
      eot_threshold: 0.8,
      keyterms: ["weekly", "monthly", "per week", "per month"],
    },
    ch_website: {
      eot_timeout_ms: 2000,
      eot_threshold: 0.7,
      keyterms: ["chat", "website", "visitors", "enquiries", "Chris"],
    },
    ch_ads: {
      eot_timeout_ms: 2000,
      eot_threshold: 0.7,
      keyterms: ["leads", "conversions", "spend", "budget", "Facebook", "Google"],
    },
    roi_delivery: {
      eot_timeout_ms: 2500,   // They're processing numbers — don't rush
      eot_threshold: 0.6,
      keyterms: [...agents, "total", "weekly", "monthly", "revenue"],
    },
    close: {
      eot_timeout_ms: 3000,   // Give them time to think/respond
      eot_threshold: 0.65,
      keyterms: ["tomorrow", "Thursday", "morning", "afternoon", "call", "time"],
    },
  };
}

// ─── Workflow Class ────────────────────────────────────────────────────────────

export class ScrapePipeline extends WorkflowEntrypoint<Env, ScrapeParams> {
  async run(event: WorkflowEvent<ScrapeParams>, step: WorkflowStep) {
    const { lid, websiteUrl, firstName, email } = event.payload;
    const t0 = Date.now();
    const domain = new URL(websiteUrl).hostname.replace("www.", "");
    const kvKey = {
      callBrief: (lid: string) => `lead:${lid}:call_brief`,
    };

    log("START", lid, `url=${websiteUrl} firstName=${firstName}`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 0: Write stub immediately (T=1s)
    // ═══════════════════════════════════════════════════════════════════════════
    await step.do("write-stub", async () => {
      log("STEP0", lid, "writing stub");
      const stub: Partial<CallBrief> = {
        lid,
        ts: new Date().toISOString(),
        status: "pending",
        firstName,
        websiteUrl,
        email,
        business_name: domain,
        industry: "",
        industry_key: "",
        customer_term: "customer",
        timeframe: "weekly",
        flags: {
          no_crm: true,
          no_chat: true,
          no_booking: true,
          is_running_ads: false,
          is_retargeting: false,
          has_fb_pixel: false,
          has_google_ads: false,
          has_tiktok_ads: false,
          has_multi_platform_ads: false,
          speed_to_lead_needed: false,
          call_handling_needed: false,
          database_reactivation: false,
          review_signals: false,
          business_age_established: false,
          trigger_alex: true, // Default to true in stub to engage V8 logic
          trigger_chris: true,
          trigger_maddie: false,
          trigger_sarah: false,
          trigger_james: false,
        },
        tech_stack: {
          has_crm: false,
          has_chat: false,
          has_booking: false,
          is_running_ads: false,
          ads_pixels: [],
          social_channels: [],
        },
        agent_ranking: ["Alex", "Chris", "Maddie", "Sarah", "James"],
        agent_slots: [
          { name: "Alex", rank: 1, trigger: "ads", descriptor: "Alex handles speed-to-lead and ad attribution.", presentation: "full_crunch" },
          { name: "Chris", rank: 2, trigger: "website", descriptor: "Chris optimizes conversion of existing website traffic.", presentation: "full_crunch" },
          { name: "Maddie", rank: 3, trigger: "phone", descriptor: "Maddie handles missed calls and after-hours booking.", presentation: "descriptor_only" }
        ],
        bella_opener: `Hi ${firstName}! I've been looking at ${domain}.`,
        pitch_hook: "",
      };

      // PROGRESSIVE V8: Seed stub stages so Bridge recognizes V8 mode immediately
      (stub as any).stages = buildStageScripts(stub, undefined, undefined, fc?.extract);

      await this.env.LEADS_KV.put(
        kvKey.callBrief(lid),
        JSON.stringify(stub),
        { expirationTtl: 86400 }
      );
      return { success: true, ms: Date.now() - t0 };
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 1: Discovery Phase — Parallel Firecrawl + Maps Verified Name (T=8-10s)
    // ═══════════════════════════════════════════════════════════════════════════
    const discovery = await step.do(
      "discovery-phase",
      { retries: { limit: 2, delay: "5 seconds" } },
      async () => {
        log("STEP1", lid, `Parallel discovery: firecrawl + maps for ${websiteUrl}`);
        
        // Run Firecrawl and a quick Maps search in parallel to get the VERIFIED name immediately
        const [fc, maps] = await Promise.all([
          firecrawlScrape(websiteUrl, this.env.FIRECRAWL_API_KEY),
          runApifyActor(this.env.APIFY_API_KEY, "compass/google-maps-reviews-scraper", 
            { searchStringsArray: [domain], maxCrawledPlacesPerSearch: 1, language: "en", maxReviews: 0 }, 
            () => {} // No callback during discovery phase
          ).catch(e => { log("STEP1", lid, `Maps discovery failed: ${e.message}`); return null; })
        ]);

        const verifiedName = maps && maps.length > 0 ? maps[0].title : null;
        log("STEP1", lid, `Scraped: ${(fc?.markdown ?? "").length} chars | Verified Name: ${verifiedName || "none"}`);
        
        return { fc, verifiedName };
      }
    );

    const fc = discovery.fc;
    const verifiedName = discovery.verifiedName;

    // Extract identity
    const rawText = fc?.markdown || fc?.html || "";
    const { industry, industry_key, customer_term } = inferIndustry(rawText);
    const tech_stack = detectTechStack(fc?.html || "", fc?.extract || {});

    // Extract business name from title/og
    const rawTitle = (fc?.ogTitle || fc?.title || domain);
    const titleParts = rawTitle.split(/[-|–—:|]/);
    
    // Logic: filter out generic words, then find the part that best matches the domain or is the first part
    const genericTerms = /^(home|welcome|about|page|website|global|management|consulting|services|contact|solutions|official)$/i;
    const filteredParts = titleParts.map(p => p.trim()).filter(p => p.length > 2 && !genericTerms.test(p));
    
    // Authority: Maps verifiedName > Title logic > Domain
    let business_name = verifiedName || domain.split(".")[0]; 
    if (!verifiedName && filteredParts.length > 0) {
      // Find part that contains domain name (e.g. "nous" in "nousgroup")
      const domName = domain.split(".")[0].toLowerCase();
      const matchPart = filteredParts.find(p => p.toLowerCase().includes(domName));
      business_name = matchPart || filteredParts[0];
    }
    
    // Safety check for multi-word full names
    if (!verifiedName && business_name.toLowerCase() === domain.split(".")[0].toLowerCase() && filteredParts[0]) {
       business_name = filteredParts[0];
    }

    // Build bella opener
    const sitePraise = fc?.extract?.description || fc?.h1 || "";
    const bella_opener = `Hi ${firstName}! I've been having a look at ${business_name}. ${sitePraise ? sitePraise.slice(0, 100) + "." : ""} It looks like you're in ${industry.toLowerCase()} — is that right?`;

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 2: Consultant Analysis (T=10-12s)
    // ═══════════════════════════════════════════════════════════════════════════
    const consultantResult = await step.do(
      "consultant",
      { retries: { limit: 1, delay: "5 seconds" }, timeout: "30 seconds" },
      async () => {
        log("STEP2", lid, "calling consultant (Phase A)");
        try {
          const resp = await this.env.CONSULTANT.fetch(
            new Request("https://consultant/", {
              method: "POST",
              body: JSON.stringify({
                lid,
                businessName: business_name,
                domain,
                websiteUrl,
                firstName,
                email,
                websiteContent: fc.markdown,
                ogTitle: fc.ogTitle,
                pageTitle: fc.title,
                extract: fc.extract,
              })
            })
          );
          if (!resp.ok) throw new Error(`Consultant HTTP ${resp.status}`);
          return await resp.json();
        } catch (e) {
          log("STEP2", lid, `consultant failed: ${e.message}`);
          return { error: e.message };
        }
      }
    );

    // Update business_name with corrected name from Consultant authority
    const finalBizName = consultantResult?.businessIdentity?.correctedName || business_name;
    const finalIndustry = consultantResult?.businessIdentity?.industry || industry;
    log("STEP2", lid, `Identity established: biz="${finalBizName}" (${finalIndustry})`);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: WRITE #1 — Phase A + Consultant Insight (T=12s)
    // ═══════════════════════════════════════════════════════════════════════════
    const brief1 = await step.do("build-brief-v9", async () => {
      log("STEP3", lid, "building brief v9 with consultant insight");
      
      const triggers = calculateTriggers(tech_stack.flags_tech, null);
      
      const b: CallBrief = {
        lid,
        ts: new Date().toISOString(),
        status: "pending",
        firstName,
        websiteUrl,
        email,
        business_name: finalBizName,
        industry: finalIndustry,
        industry_key,
        customer_term,
        timeframe: "weekly",
        flags: {
          ...tech_stack.flags_tech,
          ...triggers,
          database_reactivation: false,
          review_signals: false,
          business_age_established: false,
        },
        tech_stack: {
          has_crm: tech_stack.has_crm,
          has_chat: tech_stack.has_chat,
          has_booking: tech_stack.has_booking,
          crm_name: tech_stack.crm_name,
          chat_tool: tech_stack.chat_tool,
          booking_tool: tech_stack.booking_tool,
          is_running_ads: tech_stack.is_running_ads,
          is_retargeting: tech_stack.is_retargeting,
          ads_pixels: tech_stack.ads_pixels,
          social_channels: tech_stack.social_channels,
        },
        agent_ranking: ["Alex", "Chris", "Maddie", "Sarah", "James"],
        agent_slots: buildAgentSlots(triggers, undefined),
        bella_opener,
        pitch_hook: "",
      };
      
      // Update global identity for the search anchor used in Phase B/C
      business_name = finalBizName; 
      
      // AUTHORITY AT THE OUTSET: Use Consultant's stages if available
      if (consultantResult?.stages) {
        log("STEP3", lid, "using consultant-generated script stages");
        b.stages = consultantResult.stages;
      } else {
        log("STEP3", lid, "consultant stages missing, falling back to heuristic stages");
        b.stages = buildStageScripts(b, undefined, undefined, fc.extract);
      }
      
      log("STEP3", lid, `writing phase_a brief: biz="${finalBizName}" stages=${(b as any).stages?.length || "ready"}`);
      await this.env.LEADS_KV.put(
        kvKey.callBrief(lid),
        JSON.stringify(b),
        { expirationTtl: 14400 }
      );
      
      return b;
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 3: waitForEvent("call-connected") — pause until DO signals
    // ═══════════════════════════════════════════════════════════════════════════
    // This prevents burning Apify credits on leads that never connect
    // TEMPORARILY BYPASSED FOR TESTING - uncomment for production
    // const callConnected = await step.waitForEvent<{ lid: string }>("call-connected", {
    //   timeout: "5 minutes",
    // });
    // if (!callConnected) {
    //   log("TIMEOUT", lid, "call never connected, skipping deep scrape");
    //   return { success: false, lid, reason: "no_call" };
    // }
    log("EVENT", lid, "BYPASSED waitForEvent for testing — proceeding with deep scrape");

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 4: Deep Scrape (Progressive Feed)
    // ═══════════════════════════════════════════════════════════════════════════
    let sharedDeepIntel: DeepIntel = { 
      ads: { fb: { running: false, count: 0 }, google: { running: false, count: 0 } },
      hiring: { is_hiring: false, roles: [], count: 0 }
    };

    const pushUpdate = async () => {
      // Regenerate stages using current partial data + consultant result
      const currentStages = buildStageScripts(brief1, sharedDeepIntel, consultantResult ?? undefined, fc?.extract);
      const highlights = buildApifyHighlights(sharedDeepIntel);
      const b = { 
        ...brief1, 
        stages: currentStages, 
        apify_highlights: highlights,
        consultant: consultantResult ?? undefined,
        deep_intel: sharedDeepIntel
      };
      await this.env.LEADS_KV.put(kvKey.callBrief(lid), JSON.stringify(b), { expirationTtl: 14400 });
      log("FEED", lid, `progressive update: ads=${sharedDeepIntel.ads.fb.running || sharedDeepIntel.ads.google.running} rating=${sharedDeepIntel.googleMaps?.rating ?? '?'}`);
    };

    const deepIntelFinal = await step.do(
      "deep-scrape",
      { timeout: "4 minutes" },
      async () => {
        log("STEP4", lid, "starting progressive 5-actor feed");
        const apiKey = this.env.APIFY_API_KEY;
        const searchAnchor = `${finalBizName} ${domain}`; 
        log("STEP4", lid, `Starting deep scrape with anchor: "${searchAnchor}"`);

        await Promise.allSettled([
          runApifyActor(apiKey, "apify/facebook-ads-scraper", 
            { startUrls: [{ url: `https://www.facebook.com/ads/library/?search_term=${domain}` }], maxAds: 10 },
            (items) => { sharedDeepIntel.ads = { ...sharedDeepIntel.ads, fb: buildAdsSummary(items, null).fb }; pushUpdate(); }),
          
          runApifyActor(apiKey, "apify/google-search-scraper",
            { queries: [`site:google.com/aclk ${domain}`], maxPagesPerQuery: 1 },
            (items) => { sharedDeepIntel.ads = { ...sharedDeepIntel.ads, google: buildAdsSummary(null, items).google }; pushUpdate(); }),

          runApifyActor(apiKey, "misceres/indeed-scraper",
            { position: "", company: searchAnchor, country: "AU", maxItems: 5 },
            (items) => { sharedDeepIntel.hiring = buildHiringSummary(items); pushUpdate(); }),

          runApifyActor(apiKey, "compass/google-maps-reviews-scraper",
            { searchStringsArray: [searchAnchor], maxCrawledPlacesPerSearch: 1, language: "en", maxReviews: 8 },
            (items) => { sharedDeepIntel.googleMaps = buildGoogleMapsSummary(items) ?? undefined; pushUpdate(); }),

          (brief1 as any).linkedinUrl || (brief1 as any).linkedin_url
            ? runApifyActor(apiKey, "anchor/linkedin-company-scraper",
                { searchUrls: [ (brief1 as any).linkedinUrl || (brief1 as any).linkedin_url ], proxy: { useApifyProxy: true } },
                (items) => { sharedDeepIntel.linkedin = buildLinkedInSummary(items) ?? undefined; pushUpdate(); })
            : Promise.resolve(null),
        ]);

        return sharedDeepIntel;
      }
    );


    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 6: Build Stages + Flux Configs
    // ═══════════════════════════════════════════════════════════════════════════
    log("STEP6", lid, "final data review");
    const stages = buildStageScripts(brief1, deepIntelFinal, consultantResult ?? undefined, fc?.extract);

    const flux_configs = buildFluxConfigs(brief1);

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 7: WRITE #2 — Ready (T=60s)
    // ═══════════════════════════════════════════════════════════════════════════
    await step.do("write-call-brief-2", async () => {
      log("STEP7", lid, "writing call_brief ready");

      // Enrich flags from deep intel — including trigger flags
      const rawTriggers = calculateTriggers(flags, deepIntelFinal);
      const enrichedFlags: CallBriefFlags = {
        ...flags,
        database_reactivation: (deepIntelFinal?.googleMaps?.review_count ?? 0) > 50,
        review_signals: (deepIntelFinal?.googleMaps?.review_count ?? 0) > 0,
        ...rawTriggers,
      };

      // Build Apify highlights for Bella to quote verbatim
      const apify_highlights = buildApifyHighlights(deepIntelFinal);

      // Build ordered agent slots (rank 1-2: full crunch, rank 3: descriptor pitch)
      const agent_slots = buildAgentSlots(rawTriggers, apify_highlights);
      const agent_ranking = agent_slots.map((s) => s.name);

      const brief2: CallBrief = {
        ...(brief1 as CallBrief),
        ts: new Date().toISOString(),
        status: "ready",
        flags: enrichedFlags,
        agent_slots,
        agent_ranking,
        apify_highlights,
        deep_intel: deepIntelFinal,
        consultant: consultantResult ?? undefined,
        stages,
        flux_configs,
      };

      await this.env.LEADS_KV.put(
        `lead:${lid}:call_brief`,
        JSON.stringify(brief2),
        { expirationTtl: 86400 }
      );

      const totalMs = Date.now() - t0;
      log("DONE", lid, `workflow complete in ${totalMs}ms`);
      return { success: true, ms: totalMs };
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // STEP 8: Signal DO "brief-ready" → triggers UpdateThink
    // ═══════════════════════════════════════════════════════════════════════════
    await step.do("signal-do", async () => {
      log("STEP8", lid, "signaling DO brief-ready");
      // The DO will be listening for this event and fire UpdateThink
      // For now, we'll use a KV flag that the DO polls (fallback)
      // Full waitForEvent DO-side will be implemented in voice-agent update
      return { signaled: true };
    });

    return { success: true, lid, status: "ready" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Health check
    if (url.pathname === "/health") {
      return Response.json({ status: "ok", version: VERSION, model: MODEL }, { headers: cors });
    }

    // Trigger workflow (browser-safe — /run is intercepted by Workflow framework without CORS)
    if ((url.pathname === "/run" || url.pathname === "/trigger") && req.method === "POST") {
      try {
        const params = (await req.json()) as ScrapeParams;
        const { lid, websiteUrl, firstName, email } = params;

        if (!lid || !websiteUrl) {
          return Response.json({ error: "Missing lid or websiteUrl" }, { status: 400, headers: cors });
        }

        const instance = await env.SCRAPE_PIPELINE.create({
          id: `scrape-${lid}-${Date.now()}`,
          params: { lid, websiteUrl, firstName: firstName ?? "", email },
        });

        log("TRIGGER", lid, `workflow started: ${instance.id}`);
        return Response.json({ success: true, workflowId: instance.id, lid }, { headers: cors });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500, headers: cors });
      }
    }

    // Send event to workflow (for DO to signal call-connected)
    if (url.pathname.startsWith("/events/") && req.method === "POST") {
      const parts = url.pathname.split("/");
      const instanceId = parts[2];
      const eventName = parts[3];

      if (!instanceId || !eventName) {
        return Response.json({ error: "Missing instanceId or eventName" }, { status: 400, headers: cors });
      }

      try {
        const body = await req.json();
        const instance = await env.SCRAPE_PIPELINE.get(instanceId);
        await (instance as any).sendEvent(eventName, body);

        log("EVENT", instanceId, `sent ${eventName}`);
        return Response.json({ success: true, event: eventName }, { headers: cors });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500, headers: cors });
      }
    }

    // Test Firecrawl RAW response
    if (url.pathname === "/test-firecrawl") {
      const testUrl = url.searchParams.get("url") || "https://www.smilefocus.com.au";
      try {
        const resp = await fetch("https://api.firecrawl.dev/v9/scrape", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${env.FIRECRAWL_API_KEY}`,
          },
          body: JSON.stringify({
            url: testUrl,
            formats: ["markdown", "html"],
            onlyMainContent: false,
            timeout: 15000,
          }),
        });
        const data = await resp.json();
        return Response.json({
          httpStatus: resp.status,
          ok: resp.ok,
          data: data,
        }, { headers: cors });
      } catch (e) {
        return Response.json({ error: String(e) }, { status: 500, headers: cors });
      }
    }

    // Status check
    if (url.pathname === "/status") {
      const lid = url.searchParams.get("lid");
      if (!lid) {
        return Response.json({ error: "Missing lid" }, { status: 400, headers: cors });
      }
      const briefRaw = await env.LEADS_KV.get(`lead:${lid}:call_brief`);
      if (!briefRaw) {
        return Response.json({ lid, status: "not_found", brief: null }, { headers: cors });
      }
      const brief = JSON.parse(briefRaw);
      return Response.json({ lid, status: brief.status, brief }, { headers: cors });
    }

    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  },
};
