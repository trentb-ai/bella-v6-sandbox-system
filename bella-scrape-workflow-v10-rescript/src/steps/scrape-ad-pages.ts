// Step 13b: Scrape ad landing pages — collect unique landing_url from FB ads,
// scrape with Firecrawl, extract offers/CTAs/forms/pricing
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function scrapeAdPages(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-scrape-ad-pages:nodeName:scrape-ad-pages:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_scrape_ad_pages_13b = await step.do("step_scrape_ad_pages_13b", async () => {
      const extracted = results.step_transform_13;
      if (!extracted) {
        console.log("[SCRAPE_AD_PAGES] No extracted data — skipping");
        return { ad_landing_pages: [], skipped: "no_extracted_data" };
      }

      // Collect unique landing URLs from fb_ads_sample
      const fbSample: any[] = extracted.fb_ads_sample ?? [];
      const mainSiteHost = new URL(payload.url).hostname.replace(/^www\./, "");
      const seen = new Set<string>();
      const landingUrls: string[] = [];

      for (const ad of fbSample) {
        const url = ad.landing_url;
        if (!url || typeof url !== "string") continue;
        try {
          const parsed = new URL(url);
          const host = parsed.hostname.replace(/^www\./, "");
          // Skip main site (already scraped by Firecrawl in Step 2)
          if (host === mainSiteHost) continue;
          // Skip duplicates
          if (seen.has(host)) continue;
          seen.add(host);
          landingUrls.push(url);
        } catch { /* invalid URL — skip */ }
      }

      // Limit to max 3 pages
      const toScrape = landingUrls.slice(0, 3);
      console.log("[SCRAPE_AD_PAGES] Found " + landingUrls.length + " unique landing URLs, scraping " + toScrape.length);

      if (toScrape.length === 0) {
        return { ad_landing_pages: [], skipped: "no_unique_landing_urls" };
      }

      const firecrawlKey = env.FIRECRAWL_KEY;
      if (!firecrawlKey) {
        console.log("[SCRAPE_AD_PAGES] No FIRECRAWL_KEY — skipping");
        return { ad_landing_pages: [], skipped: "no_firecrawl_key" };
      }

      // Scrape each landing page with Firecrawl
      const pages: any[] = [];
      for (const url of toScrape) {
        try {
          console.log("[SCRAPE_AD_PAGES] Scraping: " + url);
          const resp = await fetch("https://api.firecrawl.dev/v1/scrape", {
            method: "POST",
            headers: {
              "Authorization": "Bearer " + firecrawlKey,
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              url,
              formats: ["markdown"],
              onlyMainContent: true
            }),
            signal: AbortSignal.timeout(30000)
          });

          if (!resp.ok) {
            console.log("[SCRAPE_AD_PAGES] Firecrawl error for " + url + ": " + resp.status);
            pages.push({ url, error: "http_" + resp.status });
            continue;
          }

          const body: any = await resp.json();
          const markdown: string = body?.data?.markdown ?? "";
          const meta = body?.data?.metadata ?? {};

          // Extract key signals from the landing page content
          const lower = markdown.toLowerCase();
          const hasForm = /form|submit|sign.?up|register|get.?started|book.?now|schedule|apply/i.test(lower);
          const hasPricing = /\$\d|price|pricing|cost|plan|package|per.?month|\/mo/i.test(lower);
          const hasOffer = /free|discount|off|limited.?time|special.?offer|deal|bonus|save/i.test(lower);

          // Extract CTAs (first 5 action-oriented phrases)
          const ctaMatches = markdown.match(/(?:Get|Start|Book|Schedule|Apply|Sign|Download|Try|Claim|Request|Learn|Contact|Call).{1,40}(?:\.|!|\n|$)/gi) ?? [];
          const ctas = ctaMatches.slice(0, 5).map(c => c.trim().replace(/\n.*/, ""));

          pages.push({
            url,
            title: meta.title ?? "",
            description: (meta.description ?? "").slice(0, 200),
            has_form: hasForm,
            has_pricing: hasPricing,
            has_offer: hasOffer,
            ctas,
            content_preview: markdown.slice(0, 500),
          });
          console.log("[SCRAPE_AD_PAGES] OK: " + url + " form=" + hasForm + " pricing=" + hasPricing + " offer=" + hasOffer);
        } catch (e: any) {
          console.log("[SCRAPE_AD_PAGES] Error scraping " + url + ": " + e.message);
          pages.push({ url, error: e.message });
        }
      }

      return { ad_landing_pages: pages };
    });

    // Store in state for downstream (write-deep-flags will merge this)
    state["node-scrape-ad-pages"] = { output: results.step_scrape_ad_pages_13b };
    console.log("type:WF_NODE_END:nodeId:node-scrape-ad-pages:nodeName:scrape-ad-pages:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify({ pages: results.step_scrape_ad_pages_13b?.ad_landing_pages?.length ?? 0 }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-scrape-ad-pages:nodeName:scrape-ad-pages:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    // Non-fatal — don't throw, just log. Landing pages are supplementary data.
    results.step_scrape_ad_pages_13b = { ad_landing_pages: [], error: errorMessage };
    state["node-scrape-ad-pages"] = { output: results.step_scrape_ad_pages_13b };
  }
}
