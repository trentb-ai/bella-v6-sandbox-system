/**
 * deep-scrape-workflow-sandbox v9.3.0-progressive-intel
 *
 * Progressive DO delivery: each Apify actor sends its result to the Call Brain
 * DO the moment it finishes, instead of waiting for all 5 to complete.
 * Google Maps data reaches the DO ~15s in, hiring ~20s, ads ~30s.
 * Final event (version 99) carries the complete dataset as a safety net.
 *
 * Per-actor error isolation via Promise.allSettled.
 * I/O wait (Apify polling, setTimeout) = zero CPU cost.
 * All 5 actors start simultaneously, wall time = slowest actor (~30-60s).
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from "cloudflare:workers";

// ─── Env / Params ─────────────────────────────────────────────────────────────

interface Env {
  LEADS_KV: KVNamespace;
  DEEP_SCRAPE_WORKFLOW: Workflow;
  CALL_BRAIN: Fetcher;             // service binding → call-brain-do (Phase D)
  APIFY_API_KEY: string;
}

interface DeepScrapeParams {
  lid: string;
  websiteUrl: string;
  businessName: string;
}

// KV_TTL removed — data persists permanently

// ─── Apify runner (per-actor, isolated) ──────────────────────────────────────

async function runApifyActor(
  apiKey: string,
  actorId: string,
  input: Record<string, unknown>,
  maxPolls = 20,
  pollIntervalMs = 4000
): Promise<unknown[] | null> {
  if (!apiKey) return null;
  // Apify API uses ~ as namespace separator, not / (slash → 404)
  const apiActorId = actorId.replace("/", "~");
  try {
    const startResp = await fetch(
      `https://api.apify.com/v2/acts/${apiActorId}/runs?token=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
    );
    if (!startResp.ok) {
      console.warn(`[Apify] Start failed ${actorId}: HTTP ${startResp.status}`);
      return null;
    }
    const startData = (await startResp.json()) as { data?: { id?: string } };
    const runId = startData?.data?.id;
    if (!runId) { console.warn(`[Apify] No runId for ${actorId}`); return null; }

    for (let i = 0; i < maxPolls; i++) {
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      const statusResp = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiKey}`);
      if (!statusResp.ok) break;
      const statusData = (await statusResp.json()) as { data?: { status?: string; defaultDatasetId?: string } };
      const status = statusData?.data?.status;
      if (status === "SUCCEEDED") {
        const datasetId = statusData?.data?.defaultDatasetId;
        if (!datasetId) return null;
        const itemsResp = await fetch(
          `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}&limit=15`
        );
        if (!itemsResp.ok) return null;
        return (await itemsResp.json()) as unknown[];
      }
      if (status === "FAILED" || status === "ABORTED" || status === "TIMED-OUT") {
        console.warn(`[Apify] ${actorId} ended: ${status}`);
        return null;
      }
    }
    console.warn(`[Apify] Poll timeout: ${actorId}`);
    return null;
  } catch (err) {
    console.error(`[Apify] Exception in ${actorId}:`, err);
    return null;
  }
}

// ─── Summary builders ─────────────────────────────────────────────────────────

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

// Safely unwrap a PromiseSettledResult — returns null on rejection
function settle<T>(result: PromiseSettledResult<T | null>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

// ─── Progressive DO delivery ──────────────────────────────────────────────────
// Sends a partial deep_ready event to the Call Brain DO the moment an actor
// finishes. Non-throwing: failures are logged but never fatal because the
// final event (version 99) carries the complete dataset as a safety net.

async function deliverToDoPartial(
  callBrain: Fetcher,
  lid: string,
  partialPayload: Record<string, unknown>,
  version: number,
  sourceLabel: string,
): Promise<void> {
  try {
    const eventId = crypto.randomUUID();
    console.log(`[DEEP_PARTIAL] source=${sourceLabel} lid=${lid} version=${version} eventId=${eventId}`);
    const res = await callBrain.fetch(
      new Request(`https://do-internal/event?callId=${encodeURIComponent(lid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-call-id': lid },
        body: JSON.stringify({
          type: 'deep_ready',
          payload: partialPayload,
          version,
          eventId,
          sentAt: new Date().toISOString(),
          source: `deep-scrape-workflow/${sourceLabel}`,
        }),
      }),
    );
    console.log(`[DEEP_PARTIAL] delivered source=${sourceLabel} lid=${lid} status=${res.status}`);
  } catch (e: any) {
    console.warn(`[DEEP_PARTIAL] FAILED source=${sourceLabel} lid=${lid}: ${e.message}`);
  }
}

// ─── Workflow ─────────────────────────────────────────────────────────────────

export class DeepScrapeWorkflow extends WorkflowEntrypoint<Env, DeepScrapeParams> {
  async run(event: WorkflowEvent<DeepScrapeParams>, step: WorkflowStep) {
    const { lid, websiteUrl, businessName } = event.payload;
    const apiKey = this.env.APIFY_API_KEY;
    const t0 = Date.now();

    let domain = "";
    try { domain = new URL(websiteUrl).hostname.replace("www.", ""); } catch (_) { domain = businessName; }
    const companySlug = businessName.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");

    console.log(`[DeepScrape v9.3.0-progressive-intel] Starting all actors concurrently lid=${lid}`);

    // ── Step 0: Fetch website HTML blob and write to KV immediately ──────────
    // This gives the bridge real website content within ~15s for Gemini context.
    // Uses the big scraper's proxy endpoint (separate worker, no 1042 self-call issue).
    // Mockup path is completely untouched — this is a READ from the proxy endpoint.
    await step.do(
      "fetch-site-blob",
      { retries: { limit: 1, delay: "5 seconds" }, timeout: "45 seconds" },
      async () => {
        const proxyUrl = `https://personalisedaidemofinal-sandbox.trentbelasco.workers.dev/?proxy=${encodeURIComponent(websiteUrl)}`;
        console.log(`[DeepScrape] Fetching site blob for lid=${lid} url=${websiteUrl}`);
        
        const htmlResp = await fetch(proxyUrl);
        if (!htmlResp.ok) {
          console.warn(`[DeepScrape] Proxy fetch failed: HTTP ${htmlResp.status}`);
          return; // Non-fatal — Apify steps still run
        }
        const html = await htmlResp.text();
        console.log(`[DeepScrape] Got ${html.length} chars HTML`);

        // Strip to clean text for Gemini context
        const cleanText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 20000);

        // Extract meta fields from raw HTML
        const gm = (p: RegExp) => (html.match(p)?.[1] || '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim();
        const title    = gm(/<title[^>]*>([^<]{1,200})<\/title>/i);
        const h1       = gm(/<h1[^>]*>([^<]{1,200})<\/h1>/i);
        const h2       = gm(/<h2[^>]*>([^<]{1,200})<\/h2>/i);
        const metaDesc = gm(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{1,300})["']/i)
                      || gm(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+name=["']description["']/i);
        const ogTitle  = gm(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,200})["']/i);
        const ogDesc   = gm(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{1,300})["']/i);
        const ogSite   = gm(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']{1,200})["']/i);
        const bizName  = ogSite || title.split(/[-|–—:]/)[0].trim() || domain;

        // Merge into existing KV — preserve fast-intel data, add site content
        const existingRaw = await this.env.LEADS_KV.get(`lead:${lid}:intel`);
        const existing = existingRaw ? JSON.parse(existingRaw) as Record<string, any> : {};

        const enriched = {
          ...existing,
          business_name: bizName || existing.business_name,
          scrapeStatus: 'phase_a',
          phase_a_ts: new Date().toISOString(),
          site_content_blob: cleanText,
          hero: {
            ...(existing.hero || {}),
            h1: h1 || existing.hero?.h1 || '',
            h2: h2 || existing.hero?.h2 || '',
            title: title || existing.hero?.title || '',
            meta_description: metaDesc || existing.hero?.meta_description || '',
            og_title: ogTitle || existing.hero?.og_title || '',
            og_description: ogDesc || existing.hero?.og_description || '',
          },
          core_identity: {
            ...(existing.core_identity || {}),
            business_name: bizName || existing.core_identity?.business_name || domain,
          },
        };

        const enrichedStr = JSON.stringify(enriched);
        await this.env.LEADS_KV.put(`lead:${lid}:intel`, enrichedStr);

        console.log(`[DeepScrape] Site blob written to KV lid=${lid} biz="${bizName}" h1="${h1}" blob=${cleanText.length}chars`);
      }
    );

    // ── Step 1: Scrape all actors + deliver partial results to DO as each finishes
    // Same Promise.allSettled concurrency pattern, but each actor sends its result
    // to the DO the moment it's ready via deliverToDoPartial(). Google Maps data
    // reaches the DO ~15s in instead of waiting ~45s for all actors.
    // Version counter: shared in run() scope. Single-threaded JS = atomic increment.
    let nextVersion = 1;
    const getVersion = () => nextVersion++;

    const scraped = await step.do(
      "scrape-and-deliver",
      { retries: { limit: 1, delay: "10 seconds" }, timeout: "4 minutes" },
      async () => {
        // Ads coordination: FB + Google Ads must combine before delivery
        let fbResult: unknown[] | null | undefined = undefined;   // undefined = not yet done
        let gadsResult: unknown[] | null | undefined = undefined;
        let adsDelivered = false;

        const maybeSendAds = async () => {
          if (fbResult === undefined || gadsResult === undefined || adsDelivered) return;
          adsDelivered = true;
          const adsSummary = buildAdsSummary(
            fbResult === null ? null : fbResult,
            gadsResult === null ? null : gadsResult,
          );
          await deliverToDoPartial(this.env.CALL_BRAIN, lid, { ads: adsSummary }, getVersion(), 'ads');
        };

        const [fbR, googleR, indeedR, mapsR, linkedInR] = await Promise.allSettled([

          // FB Ads Library — coordinated with Google Ads
          (async () => {
            const result = await runApifyActor(apiKey, "apify/facebook-ads-scraper", {
              startUrls: [{ url: `https://www.facebook.com/ads/library/?search_term=${domain}` }],
              maxAds: 10,
            });
            fbResult = result;
            await maybeSendAds();
            return result;
          })(),

          // Google Ads signals — coordinated with FB Ads
          (async () => {
            const result = await runApifyActor(apiKey, "apify/google-search-scraper", {
              queries: [`site:google.com/aclk ${domain}`],
              maxPagesPerQuery: 1,
            });
            gadsResult = result;
            await maybeSendAds();
            return result;
          })(),

          // Indeed jobs (AU) — delivers immediately
          (async () => {
            const result = await runApifyActor(apiKey, "misceres/indeed-scraper", {
              position: "",
              company: businessName,
              country: "AU",
              maxItems: 5,
            });
            const hiringSummary = buildHiringSummary(result);
            await deliverToDoPartial(this.env.CALL_BRAIN, lid, { hiring: hiringSummary }, getVersion(), 'indeed');
            return result;
          })(),

          // Google Maps reviews — delivers immediately (fastest actor, ~12s)
          (async () => {
            const result = await runApifyActor(apiKey, "compass/google-maps-reviews-scraper", {
              searchStringsArray: [businessName],
              maxCrawledPlacesPerSearch: 1,
              language: "en",
              maxReviews: 8,
            });
            const mapsSummary = buildGoogleMapsSummary(result);
            if (mapsSummary) {
              await deliverToDoPartial(this.env.CALL_BRAIN, lid, { googleMaps: mapsSummary }, getVersion(), 'googleMaps');
            }
            return result;
          })(),

          // LinkedIn company — delivers immediately (slowest actor)
          companySlug.length > 2
            ? (async () => {
                const result = await runApifyActor(apiKey, "anchor/linkedin-company-scraper", {
                  searchUrls: [`https://www.linkedin.com/company/${companySlug}`],
                  proxy: { useApifyProxy: true },
                });
                const linkedInSummary = buildLinkedInSummary(result);
                if (linkedInSummary) {
                  await deliverToDoPartial(this.env.CALL_BRAIN, lid, { linkedin: linkedInSummary }, getVersion(), 'linkedin');
                }
                return result;
              })()
            : Promise.resolve(null),
        ]);

        const fb       = settle(fbR);
        const google   = settle(googleR);
        const indeed   = settle(indeedR);
        const maps     = settle(mapsR);
        const linkedin = settle(linkedInR);

        console.log(`[DeepScrape] Actors done in ${Date.now() - t0}ms`, {
          fb: fb?.length ?? "null",
          google: google?.length ?? "null",
          indeed: indeed?.length ?? "null",
          maps: maps?.length ?? "null",
          linkedin: linkedin?.length ?? "null",
          partialVersionsUsed: nextVersion - 1,
        });

        return {
          ads:        buildAdsSummary(fb, google),
          hiring:     buildHiringSummary(indeed),
          googleMaps: buildGoogleMapsSummary(maps),
          linkedin:   buildLinkedInSummary(linkedin),
        };
      }
    );

    // ── Step 2: KV cold backup + final DO delivery (version 99) ────────────
    // KV write is unchanged (cold backup). Final deep_ready at version 99
    // guarantees the DO has the complete dataset even if all partials failed.
    // Version 99 always passes shouldApplyVersion() regardless of replay state.
    await step.do(
      "finalize-deep",
      { retries: { limit: 3, delay: "3 seconds" }, timeout: "30 seconds" },
      async () => {
        const deepSummary = {
          status: "done" as const,
          ts_done: new Date().toISOString(),
          duration_ms: Date.now() - t0,
          ...scraped,
        };

        // KV cold backup — additive merge (never overwrites Phase B or Firecrawl data)
        const existing = await this.env.LEADS_KV.get(`lead:${lid}:intel`);
        const envelope = existing
          ? (JSON.parse(existing) as Record<string, unknown>)
          : { v: 1, lid, ts: new Date().toISOString() };
        envelope.deep = deepSummary;
        await this.env.LEADS_KV.put(`lead:${lid}:intel`, JSON.stringify(envelope));

        console.log(`[DeepScrape] KV written lid=${lid} total=${deepSummary.duration_ms}ms ads_fb_running=${scraped.ads.fb.running} google_rating=${scraped.googleMaps?.rating ?? "n/a"} hiring=${scraped.hiring.is_hiring}`);

        // Final DO delivery — version 99 is the safety net
        try {
          const eventId = crypto.randomUUID();
          console.log(`[DEEP_FINAL] lid=${lid} version=99 eventId=${eventId}`);
          const res = await this.env.CALL_BRAIN.fetch(
            new Request(`https://do-internal/event?callId=${encodeURIComponent(lid)}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-call-id': lid },
              body: JSON.stringify({
                type: 'deep_ready',
                payload: deepSummary,
                version: 99,
                eventId,
                sentAt: new Date().toISOString(),
                source: 'deep-scrape-workflow/final',
              }),
            }),
          );
          console.log(`[DEEP_FINAL] delivered lid=${lid} status=${res.status}`);
        } catch (e: any) {
          console.warn(`[DEEP_FINAL] FAILED lid=${lid}: ${e.message}`);
        }
      }
    );

    console.log(`[DeepScrape v9.3.0-progressive-intel] Complete lid=${lid} wall=${Date.now() - t0}ms`);
  }
}

// ─── HTTP handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { ...cors, "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    }

    // POST /trigger — kick off workflow
    if (url.pathname === "/trigger" && request.method === "POST") {
      let body: { lid?: string; websiteUrl?: string; businessName?: string };
      try { body = await request.json() as typeof body; }
      catch { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: cors }); }

      const { lid, websiteUrl, businessName } = body;
      if (!lid || !websiteUrl) {
        return new Response(JSON.stringify({ error: "Missing lid or websiteUrl" }), { status: 400, headers: cors });
      }

      let bn = businessName;
      if (!bn) { try { bn = new URL(websiteUrl).hostname.replace("www.", ""); } catch { bn = lid; } }

      let instance;
      try {
        instance = await env.DEEP_SCRAPE_WORKFLOW.create({
          id: `deep-${lid}`,
          params: { lid, websiteUrl, businessName: bn! },
        });
      } catch (e: any) {
        if (e.message?.includes("already") || e.message?.includes("409")) {
          try {
            const existing = await env.DEEP_SCRAPE_WORKFLOW.get(`deep-${lid}`);
            const status = await existing.status();
            console.log(`[DeepScrape] already_exists lid=${lid} status=${status.status}`);
            return new Response(JSON.stringify({ ok: true, lid, status: status.status, note: "already_exists" }), { headers: cors });
          } catch {
            return new Response(JSON.stringify({ ok: true, lid, status: "unknown", note: "already_exists" }), { headers: cors });
          }
        }
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: cors });
      }

      console.log(`[DeepScrape] Triggered lid=${lid} instanceId=${instance.id}`);
      return new Response(JSON.stringify({ ok: true, lid, instanceId: instance.id, status: "queued" }), { status: 202, headers: cors });
    }

    // GET /status?lid=xxx
    if (url.pathname === "/status" && request.method === "GET") {
      const lid = url.searchParams.get("lid");
      if (!lid) return new Response(JSON.stringify({ error: "Missing lid" }), { status: 400, headers: cors });
      try {
        const instance = await env.DEEP_SCRAPE_WORKFLOW.get(`deep-${lid}`);
        const status = await instance.status();
        return new Response(JSON.stringify({ lid, ...status }), { headers: cors });
      } catch {
        return new Response(JSON.stringify({ lid, status: "not_found" }), { headers: cors });
      }
    }

    return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: cors });
  },
};
