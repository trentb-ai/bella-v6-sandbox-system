// /fire-apify HTTP handler — T=0 Apify actor pre-fire from capture.html
// Extracted verbatim from deployed.js lines 2316-2463
import type { Env } from './lib/types';

export async function handleFireApify(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  try {
    const body: any = await req.json();
    const lid = body.lid;
    const siteUrl = body.url || body.websiteUrl || "";
    const fallbackName = body.name || body.businessName || "";
    const domainName = siteUrl ? new URL(siteUrl).hostname.replace("www.", "") : "";
    const apifyTk = env.APIFY_TOKEN || env.APIFY_API_KEY;

    if (!lid || !apifyTk) {
      return Response.json({ error: "Missing lid or APIFY_TOKEN" }, { status: 400, headers: cors });
    }

    // ── PARALLEL: HTML cross-reference (T=0, ~1-2s) + KV poll for Consultant name (~8-12s) ──
    // Consultant is PRIMARY (reads full homepage copy via Firecrawl+Gemini)
    // HTML signals are CROSS-REFERENCE / FALLBACK

    // 1. Fire HTML fetch immediately (non-blocking) — extracts og:site_name, JSON-LD, title, h1
    const htmlNamePromise = (async () => {
      if (!siteUrl) return { candidates: [] as any[], best: "" };
      try {
        const pageResp = await fetch(siteUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BellaBot/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(4000) });
        const html = await pageResp.text();
        const candidates: { src: string; val: string }[] = [];
        // og:site_name
        const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
        if (ogSiteName) candidates.push({ src: "og:site_name", val: ogSiteName[1].trim() });
        // Schema.org JSON-LD
        const ldMatches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
        for (const m of ldMatches) {
          try {
            const ld = JSON.parse(m[1]);
            const items = Array.isArray(ld) ? ld : [ld];
            for (const item of items) {
              if (item && item.name && typeof item.name === "string" && ["Organization","LocalBusiness","Corporation","WebSite","ProfessionalService"].includes(item["@type"])) {
                candidates.push({ src: "jsonld:" + item["@type"], val: item.name.trim() });
              }
            }
          } catch (e) { /* bad JSON-LD */ }
        }
        // og:title
        const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        if (ogTitle) candidates.push({ src: "og:title", val: ogTitle[1].trim() });
        // <title> (cleaned)
        const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleTag) {
          const cleaned = titleTag[1].trim()
            .replace(/^(home|welcome|about|main)\s*[\|\-\u2013\u2014:]\s*/i, "")
            .replace(/\s*[\|\-\u2013\u2014:]\s*(home|welcome|official|about|main|site|page|australia|au).*$/i, "")
            .replace(/\s*[\|\-\u2013\u2014:]\s*$/, "")
            .trim();
          if (cleaned) candidates.push({ src: "title", val: cleaned });
        }
        // <h1>
        const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (h1Match) candidates.push({ src: "h1", val: h1Match[1].trim() });
        // Pick best HTML signal
        const ogSite = candidates.find(c => c.src === "og:site_name");
        const jsonLd = candidates.find(c => c.src.startsWith("jsonld:"));
        const best = (ogSite || jsonLd || candidates[0])?.val || "";
        const cleanBest = best
          .replace(/\s*(Pty\.?\s*Ltd\.?|Ltd\.?|Inc\.?|LLC|P\/L|ABN\s*\d+).*$/i, "")
          .replace(/\s*(Australia|AU|NZ|USA|UK)\s*$/i, "")
          .trim();
        console.log("[fire-apify] HTML signals: " + candidates.map(c => c.src + ":" + c.val).join(" | "));
        return { candidates, best: cleanBest };
      } catch (e: any) {
        console.log("[fire-apify] HTML fetch failed: " + e.message);
        return { candidates: [] as any[], best: "" };
      }
    })();

    // 2. Single non-blocking KV check for Consultant name (if fast-intel already finished)
    let bizName = "";
    let bizLocation = "";
    let nameSource = "";
    try {
      const fiRaw: any = await env.WORKFLOWS_KV.get("lead:" + lid + ":fast-intel", { type: "json" });
      if (fiRaw) {
        bizName = fiRaw.business_name || fiRaw.core_identity?.business_name || "";
        bizLocation = fiRaw.core_identity?.location || "";
        if (bizName) {
          nameSource = "consultant";
          console.log("[fire-apify] Consultant name from KV: " + bizName + " location: " + bizLocation);
        }
      }
    } catch (e) { /* KV not ready yet */ }

    // 3. HTML extraction result (fires at T=0, ready by ~1-2s)
    const htmlResult = await htmlNamePromise;
    if (bizName && htmlResult.best) {
      const match = bizName.toLowerCase().includes(htmlResult.best.toLowerCase()) || htmlResult.best.toLowerCase().includes(bizName.toLowerCase());
      console.log("[fire-apify] XREF consultant=" + bizName + " html=" + htmlResult.best + " match=" + match);
    } else if (!bizName && htmlResult.best) {
      bizName = htmlResult.best;
      nameSource = "html";
      console.log("[fire-apify] Using HTML name: " + bizName);
    }
    if (!bizName) {
      bizName = fallbackName || domainName;
      nameSource = "domain";
      console.log("[fire-apify] WARN: No name from Consultant or HTML, falling back to: " + bizName);
    }

    // LinkedIn slug from real business name (lowercase, spaces to hyphens, no special chars)
    const linkedinSlug = bizName.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-").replace(/^-|-$/g, "");

    // Google Maps gets location-qualified search to find the right branch
    const mapsSearch = bizLocation ? bizName + " " + bizLocation : bizName;
    const actors = [
      { key: "facebook_ads", actor: "apify~facebook-ads-scraper", payload: { startUrls: [{ url: "https://www.facebook.com/ads/library/?search_term=" + encodeURIComponent(bizName) }], maxAds: 5 } },
      { key: "google_ads", actor: "apify~google-search-scraper", payload: { queries: bizName + " ads", maxPagesPerQuery: 1 } },
      { key: "indeed", actor: "misceres~indeed-scraper", payload: { position: "", company: bizName, country: "AU", maxItems: 5 } },
      { key: "google_maps", actor: "compass~google-maps-reviews-scraper", payload: { searchStringsArray: [mapsSearch], maxCrawledPlacesPerSearch: 1, language: "en", maxReviews: 5 } },
      { key: "linkedin", actor: "curious_coder~linkedin-company-scraper", payload: { urls: ["https://www.linkedin.com/company/" + linkedinSlug], proxy: { useApifyProxy: true } } }
    ];

    const startResults = await Promise.all(
      actors.map(a =>
        fetch("https://api.apify.com/v2/acts/" + a.actor + "/runs?token=" + apifyTk, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(a.payload)
        }).then(r => r.json()).then((j: any) => {
          const dObj = (j && j.data) || Object.values(j || {}).find((v: any) => v && typeof v === "object" && v.id) || {};
          if (!dObj.id) console.log("[fire-apify] WARN: No runId for " + a.key + " response=" + JSON.stringify(j).slice(0, 300));
          return { key: a.key, runId: dObj.id || null, status: dObj.id ? "started" : "no_id" };
        }).catch((e: any) => { console.log("[fire-apify] ERROR: " + a.key + " " + e.message); return { key: a.key, runId: null, status: "failed", error: e.message }; })
      )
    );

    const runs: Record<string, any> = {};
    startResults.forEach(r => { runs[r.key] = r; });

    // Write run IDs to KV so the workflow can reuse them
    await env.WORKFLOWS_KV.put(`lead:${lid}:apify_runs`, JSON.stringify(runs), { expirationTtl: 3600 });

    console.log("[fire-apify] lid=" + lid + " biz=" + bizName + " slug=" + linkedinSlug + " runs=" + Object.keys(runs).map(k => k + ":" + (runs[k].runId ? "ok" : "fail")).join(","));

    return Response.json({ success: true, lid, bizName, runs }, { headers: cors });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500, headers: cors });
  }
}
