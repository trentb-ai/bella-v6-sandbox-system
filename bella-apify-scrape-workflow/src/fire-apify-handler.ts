// /fire-apify HTTP handler — T=0 Apify actor pre-fire from capture.html
// Uses Smart Wave Scheduler to pack actors into waves under 8GB memory cap
// Fires Wave 1 at T=0, stores remaining waves in KV for workflow to fire later
import type { Env } from './lib/types';
import { fireActor } from './lib/apify-client';
import { APIFY_ACTORS, buildWaves, buildActorContext } from './lib/apify-actors';

export async function handleFireApify(req: Request, env: Env, cors: Record<string, string>): Promise<Response> {
  try {
    const body: any = await req.json();
    const lid = body.lid;
    const siteUrl = body.url || body.websiteUrl || "";
    const fallbackName = body.name || body.businessName || "";
    const apifyTk = env.APIFY_TOKEN || env.APIFY_API_KEY;

    if (!lid || !apifyTk) {
      return Response.json({ error: "Missing lid or APIFY_TOKEN" }, { status: 400, headers: cors });
    }

    // ── Resolve business name (HTML + KV) ──
    const htmlNamePromise = (async () => {
      if (!siteUrl) return { candidates: [] as any[], best: "" };
      try {
        const pageResp = await fetch(siteUrl, { headers: { "User-Agent": "Mozilla/5.0 (compatible; BellaBot/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(4000) });
        const html = await pageResp.text();
        const candidates: { src: string; val: string }[] = [];
        const ogSiteName = html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i);
        if (ogSiteName) candidates.push({ src: "og:site_name", val: ogSiteName[1].trim() });
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
        const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
          || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
        if (ogTitle) candidates.push({ src: "og:title", val: ogTitle[1].trim() });
        const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        if (titleTag) {
          const cleaned = titleTag[1].trim()
            .replace(/^(home|welcome|about|main)\s*[\|\-\u2013\u2014:]\s*/i, "")
            .replace(/\s*[\|\-\u2013\u2014:]\s*(home|welcome|official|about|main|site|page|australia|au).*$/i, "")
            .replace(/\s*[\|\-\u2013\u2014:]\s*$/, "")
            .trim();
          if (cleaned) candidates.push({ src: "title", val: cleaned });
        }
        const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
        if (h1Match) candidates.push({ src: "h1", val: h1Match[1].trim() });
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

    let bizName = "";
    let bizLocation = "";
    let intel: any = null;
    let nameSource = "";
    try {
      const fiRaw: any = await env.WORKFLOWS_KV.get("lead:" + lid + ":fast-intel", { type: "json" });
      if (fiRaw) {
        intel = fiRaw;
        bizName = fiRaw.business_name || fiRaw.core_identity?.business_name || "";
        bizLocation = fiRaw.core_identity?.location || "";
        if (bizName) {
          nameSource = "consultant";
          console.log("[fire-apify] Consultant name from KV: " + bizName + " location: " + bizLocation);
        }
      }
    } catch (e) { /* KV not ready yet */ }

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
      bizName = fallbackName || (siteUrl ? new URL(siteUrl).hostname.replace("www.", "") : "");
      nameSource = "domain";
      console.log("[fire-apify] WARN: No name from Consultant or HTML, falling back to: " + bizName);
    }

    // ── Build actor context + waves using Smart Wave Scheduler ──
    const ctx = buildActorContext({ bizName, bizLocation, siteUrl, intel });
    const waves = buildWaves(APIFY_ACTORS, ctx);

    if (waves.length === 0) {
      return Response.json({ success: true, lid, bizName, wave: 0, runs: {}, message: "No eligible actors" }, { headers: cors });
    }

    // ── Fire Wave 1 only (highest priority actors that fit under 8GB) ──
    const wave1 = waves[0];
    const startResults = await Promise.all(
      wave1.map(a => fireActor(a.key, a.actor, a.payload, apifyTk!))
    );
    const runs: Record<string, any> = {};
    startResults.forEach(r => { runs[r.key] = r; });

    // Write Wave 1 runs to KV
    await env.WORKFLOWS_KV.put(`lead:${lid}:apify_runs`, JSON.stringify(runs), { expirationTtl: 3600 });

    // Write remaining waves (2+) to KV for workflow to fire later
    const remainingWaves = waves.slice(1);
    await env.WORKFLOWS_KV.put(`lead:${lid}:apify_remaining_waves`, JSON.stringify(remainingWaves), { expirationTtl: 3600 });

    console.log("[fire-apify] lid=" + lid + " biz=" + bizName + " src=" + nameSource +
      " wave1=" + Object.keys(runs).map(k => k + ":" + (runs[k].runId ? "ok" : "fail")).join(",") +
      " remaining_waves=" + remainingWaves.length);

    return Response.json({
      success: true, lid, bizName, nameSource,
      wave1_actors: wave1.map(a => a.key),
      total_waves: waves.length,
      runs
    }, { headers: cors });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500, headers: cors });
  }
}
