// Step 4: Fire Apify actors (check pre-fired first, fallback: fire now)
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function fireApify(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-fire-apify:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_transform_4 = await step.do("step_transform_4", async () => {
      const inputData = state["node-truncate-content"]?.output || payload;
      const result = await (async () => {
        const entry = state["node-entry"]?.output || {};
        const lid = entry.lid || "";

        // CHECK FOR PRE-FIRED RUNS from /fire-apify endpoint (T=0 optimization)
        if (lid) {
          try {
            const prefiredRaw = await env.WORKFLOWS_KV.get("lead:" + lid + ":apify_runs");
            if (prefiredRaw) {
              const prefired = JSON.parse(prefiredRaw);
              const hasRuns = Object.values(prefired).some((r: any) => r && r.runId);
              if (hasRuns) {
                console.log("[fire-apify] REUSING pre-fired runs for lid=" + lid);
                return prefired;
              }
            }
          } catch (e: any) {
            console.log("[fire-apify] Failed to read pre-fired runs: " + e.message);
          }
        }

        // FALLBACK: fire actors now (no pre-fired runs found)
        // Workflow runs AFTER fast-intel, so Consultant name should be in KV already
        const siteUrl = entry.url || "";
        const fallbackName = entry.name || "";
        let bizName = "";
        let bizLocation = "";
        // PRIMARY: Consultant's corrected name + location from KV (should already exist)
        try {
          const fiRaw: any = await env.WORKFLOWS_KV.get("lead:" + lid + ":fast-intel", { type: "json" });
          if (fiRaw) {
            bizName = fiRaw.business_name || (fiRaw.core_identity && fiRaw.core_identity.business_name) || "";
            bizLocation = (fiRaw.core_identity && fiRaw.core_identity.location) || "";
            if (bizName) console.log("[fire-apify-fallback] Got bizName from Consultant KV: " + bizName + " location: " + bizLocation);
          }
        } catch (e) { /* ignore */ }
        // FALLBACK: HTML title extraction if Consultant name missing
        if (!bizName && siteUrl) {
          try {
            const pageResp = await fetch(siteUrl, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow", signal: AbortSignal.timeout(3000) });
            const html = await pageResp.text();
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
              bizName = titleMatch[1].trim()
                .replace(/^(home|welcome|about|main)\s*[\|\-\u2013\u2014:]\s*/i, "")
                .replace(/\s*[\|\-\u2013\u2014:]\s*(home|welcome|official|about|main|site|page|australia|au).*$/i, "")
                .replace(/\s*[\|\-\u2013\u2014:]\s*$/, "")
                .trim();
              console.log("[fire-apify-fallback] Got bizName from page title: " + bizName);
            }
          } catch (e: any) {
            console.log("[fire-apify-fallback] Title fetch failed: " + e.message);
          }
        }
        if (!bizName) {
          bizName = fallbackName || (siteUrl ? new URL(siteUrl).hostname.replace("www.", "") : "");
          console.log("[fire-apify-fallback] WARN: falling back to: " + bizName);
        }
        const linkedinSlug = bizName.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, "-").replace(/^-|-$/g, "");
        const mapsSearch = bizLocation ? bizName + " " + bizLocation : bizName;
        const apifyTk = env.APIFY_TOKEN || env.APIFY_API_KEY;
        const actors = [
          { key: "facebook_ads", actor: "apify~facebook-ads-scraper", payload: { startUrls: [{ url: "https://www.facebook.com/ads/library/?search_term=" + encodeURIComponent(bizName) }], maxAds: 5 } },
          { key: "google_ads", actor: "apify~google-search-scraper", payload: { queries: bizName + " ads", maxPagesPerQuery: 1 } },
          { key: "indeed", actor: "misceres~indeed-scraper", payload: { position: "", company: bizName, country: "AU", maxItems: 5 } },
          { key: "google_maps", actor: "compass~google-maps-reviews-scraper", payload: { searchStringsArray: [mapsSearch], maxCrawledPlacesPerSearch: 1, language: "en", maxReviews: 5 } },
          { key: "linkedin", actor: "curious_coder~linkedin-company-scraper", payload: { urls: ["https://www.linkedin.com/company/" + linkedinSlug], proxy: { useApifyProxy: true } } }
        ];
        const startResults = await Promise.all(
          actors.map(
            (a) => fetch("https://api.apify.com/v2/acts/" + a.actor + "/runs?token=" + apifyTk, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(a.payload)
            }).then((r) => r.json()).then((j: any) => {
              const dObj: any = Object.values(j || {}).find((v: any) => v && typeof v === "object") || {};
              return { key: a.key, runId: dObj.id || null, status: "started" };
            }).catch((e: any) => ({ key: a.key, runId: null, status: "failed", error: e.message }))
          )
        );
        const runs: Record<string, any> = {};
        startResults.forEach((r) => {
          runs[r.key] = r;
        });
        return runs;
      })();
      state["node-fire-apify"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-fire-apify"] = state["node-fire-apify"] || { output: results.step_transform_4 };
    console.log("type:WF_NODE_END:nodeId:node-fire-apify:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-fire-apify"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-fire-apify:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
