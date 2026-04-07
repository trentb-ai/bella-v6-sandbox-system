// Smart Wave Scheduler — single source of truth for Apify actor config
// See DATA_ENRICHMENT_MASTER_PLAN.md "APIFY QUOTA MANAGEMENT — HARD RULES"

// ── TYPES ──

export interface ActorConfig {
  key: string;
  actor: string;
  memory: number;       // MB default allocation on Apify
  priority: number;     // 1 = highest
  condition: (ctx: ActorContext) => boolean;
}

export interface ActorContext {
  bizName: string;
  domainName: string;
  mapsSearch: string;
  linkedinSlug: string;
  countryCode: string;
  bizLocation: string;
  instagramUrl: string;
  intel: any;            // raw fast-intel (may be null at T=0)
}

export interface ActorWithPayload {
  key: string;
  actor: string;
  memory: number;
  priority: number;
  payload: any;
}

// ── ACTOR REGISTRY ──
// Priority order matches DATA_ENRICHMENT_MASTER_PLAN.md actor priority table

export const APIFY_ACTORS: ActorConfig[] = [
  { key: "google_maps",             actor: "compass~google-maps-reviews-scraper",               memory: 1024, priority: 1, condition: () => false },  // DISABLED — all actors off until script rewrite complete
  { key: "indeed",                  actor: "misceres~indeed-scraper",                           memory: 4096, priority: 2, condition: () => false },  // DISABLED — all actors off until script rewrite complete
  { key: "facebook_ads",            actor: "apify~facebook-ads-scraper",                        memory: 1024, priority: 3, condition: () => false },  // DISABLED — all actors off until script rewrite complete
  { key: "google_ads_transparency", actor: "alkausari_mujahid~google-ads-transparency-scraper", memory: 4096, priority: 4, condition: () => false },  // DISABLED — all actors off until script rewrite complete
  { key: "google_search",           actor: "apify~google-search-scraper",                       memory: 1024, priority: 5, condition: () => false },  // DISABLED — low value, saving credits
  { key: "seek_jobs",               actor: "websift~seek-job-scraper-pay-per-row",              memory: 256,  priority: 6, condition: () => false },  // DISABLED — all actors off until script rewrite complete
  { key: "instagram",               actor: "apify~instagram-post-scraper",                      memory: 1024, priority: 7, condition: () => false },  // DISABLED — low value, saving credits
  { key: "linkedin",                actor: "curious_coder~linkedin-company-scraper",            memory: 512,  priority: 8, condition: () => false },  // DISABLED — trial expired
];

// ── CONDITION HELPERS ──

export function isAustralianBusiness(ctx: ActorContext): boolean {
  const loc = ctx.bizLocation || ctx.intel?.core_identity?.location || "";
  return /australia|sydney|melbourne|brisbane|perth|adelaide|canberra|hobart|darwin|queensland|nsw|vic|qld|wa|sa|tas|nt|act/i.test(loc);
}

export function hasInstagramLink(ctx: ActorContext): boolean {
  if (ctx.instagramUrl) return true;
  const social: string[] = ctx.intel?.tech_stack?.social_channels || [];
  return social.some((s: string) => /instagram/i.test(s));
}

// ── PAYLOAD BUILDER ──

export function buildPayload(key: string, ctx: ActorContext): any {
  switch (key) {
    case "google_maps": {
      const placeId = (ctx.intel as any)?.places?.place_id ?? '';
      if (placeId) {
        console.log("[APIFY_MAPS] Using place_id for precise lookup: " + placeId);
        return { placeIds: [placeId], maxCrawledPlacesPerSearch: 1, language: "en", maxReviews: 5 };
      }
      console.log("[APIFY_MAPS] No place_id — using text search: " + ctx.mapsSearch);
      return { searchStringsArray: [ctx.mapsSearch], maxCrawledPlacesPerSearch: 1, language: "en", maxReviews: 5 };
    }
    case "facebook_ads":
      return { startUrls: [{ url: "https://www.facebook.com/ads/library/?search_term=" + encodeURIComponent(ctx.bizName) }], maxAds: 3 };
    case "google_ads_transparency":
      return { domains: [ctx.domainName || ctx.bizName] };
    case "google_search":
      return { queries: ctx.bizName, maxPagesPerQuery: 1 };
    case "indeed":
      return { position: "", company: ctx.bizName, country: ctx.countryCode, maxItems: 5 };
    case "seek_jobs":
      return { keyword: ctx.bizName, maxItems: 5 };
    case "instagram": {
      const social: string[] = ctx.intel?.tech_stack?.social_channels || [];
      const igUrl = ctx.instagramUrl || social.find((s: string) => /instagram\.com/i.test(s)) || "";
      return { directUrls: [igUrl], resultsLimit: 5, resultsType: "posts" };
    }
    case "linkedin":
      return { urls: ["https://www.linkedin.com/company/" + ctx.linkedinSlug], proxy: { useApifyProxy: true } };
    default:
      return {};
  }
}

// ── SMART WAVE SCHEDULER ──

const MEMORY_CAP = 8192;

export function buildWaves(actors: ActorConfig[], ctx: ActorContext): ActorWithPayload[][] {
  const eligible = actors
    .filter(a => a.condition(ctx))
    .sort((a, b) => a.priority - b.priority);

  const skipped = actors.filter(a => !a.condition(ctx));
  if (skipped.length > 0) {
    console.log("[APIFY_QUOTA] Skipped: " + skipped.map(a => a.key + "(condition=false)").join(", "));
  }

  const waves: ActorWithPayload[][] = [];
  let currentWave: ActorWithPayload[] = [];
  let budget = MEMORY_CAP;

  for (const actor of eligible) {
    const withPayload: ActorWithPayload = {
      key: actor.key,
      actor: actor.actor,
      memory: actor.memory,
      priority: actor.priority,
      payload: buildPayload(actor.key, ctx)
    };
    if (actor.memory <= budget) {
      currentWave.push(withPayload);
      budget -= actor.memory;
    } else {
      if (currentWave.length > 0) waves.push(currentWave);
      currentWave = [withPayload];
      budget = MEMORY_CAP - actor.memory;
    }
  }
  if (currentWave.length > 0) waves.push(currentWave);

  waves.forEach((w, i) => {
    const mem = w.reduce((s, a) => s + a.memory, 0);
    console.log("[APIFY_QUOTA] Wave " + (i + 1) + "/" + waves.length + ": " +
      w.map(a => a.key + "(" + a.memory + ")").join(" + ") + " = " + mem + "MB");
  });

  return waves;
}

// ── CONTEXT BUILDER ──

export function buildActorContext(opts: {
  bizName: string;
  bizLocation: string;
  siteUrl: string;
  intel?: any;
}): ActorContext {
  const { bizName, bizLocation, siteUrl, intel } = opts;
  const domainName = siteUrl ? new URL(siteUrl).hostname.replace("www.", "") : "";
  const linkedinSlug = bizName.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-").replace(/^-|-$/g, "");
  const mapsSearch = bizLocation ? bizName + " " + bizLocation : bizName;
  const countryCode = countryFromLocation(bizLocation);
  const social: string[] = intel?.tech_stack?.social_channels || [];
  const instagramUrl = social.find((s: string) => /instagram\.com/i.test(s)) || "";

  return { bizName, domainName, mapsSearch, linkedinSlug, countryCode, bizLocation, instagramUrl, intel };
}

export function countryFromLocation(loc: string): string {
  if (!loc) return "US";
  const l = loc.toLowerCase();
  if (/australia|sydney|melbourne|brisbane|perth|adelaide|queensland|nsw|vic|qld|wa|sa|tas|nt|act/i.test(l)) return "AU";
  if (/new zealand|auckland|wellington|christchurch/i.test(l)) return "NZ";
  if (/united kingdom|london|manchester|birmingham|england|scotland|wales/i.test(l)) return "GB";
  if (/canada|toronto|vancouver|montreal|ottawa/i.test(l)) return "CA";
  return "US";
}
