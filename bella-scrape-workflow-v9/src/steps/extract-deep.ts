// Step 13: Extract deep data from Apify results
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function extractDeep(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-extract-deep:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_transform_13 = await step.do("step_transform_13", async () => {
      const inputData = state["node-collect-apify"]?.output || payload;
      const result = await (async () => {
        const scrape = state["node-collect-apify"]?.output || {};
        const place: any = (Array.isArray(scrape.google_maps) ? scrape.google_maps[0] : scrape.google_maps) || {};
        const reviews = (place.reviews || []).slice(0, 5).map((r: any) => ({ text: (r?.text || "").slice(0, 200), stars: r?.stars, name: r?.name }));
        const fbAds = Array.isArray(scrape.facebook_ads) ? scrape.facebook_ads : [];
        const googleAds = Array.isArray(scrape.google_ads) ? scrape.google_ads : [];
        const indeedJobs = Array.isArray(scrape.indeed) ? scrape.indeed : [];
        const linkedinInfo: any = (Array.isArray(scrape.linkedin) ? scrape.linkedin[0] : scrape.linkedin) || {};
        return { google_rating: place.totalScore || place.rating || null, review_count: place.reviewsCount || 0, address: place.address || null, categories: place.categories || [], reviews_sample: reviews, is_running_fb_ads: fbAds.length > 0, fb_ads_count: fbAds.length, fb_ads_sample: fbAds.slice(0, 3).map((a: any) => ({ text: (a?.bodyText || a?.caption || "").slice(0, 200), cta: a?.callToActionType || "" })), is_running_google_ads: googleAds.length > 0, google_ads_count: googleAds.length, is_hiring: indeedJobs.length > 0, job_count: indeedJobs.length, jobs_sample: indeedJobs.slice(0, 3).map((j: any) => ({ title: j?.title || j?.positionName || "", salary: j?.salary || "" })), linkedin_employees: linkedinInfo?.employeeCount || linkedinInfo?.staffCount || null, linkedin_industry: linkedinInfo?.industryName || linkedinInfo?.industry || null, linkedin_description: (linkedinInfo?.description || "").slice(0, 300), raw_json: JSON.stringify({ google_maps: place, fb_ads_count: fbAds.length, google_ads_count: googleAds.length, indeed_count: indeedJobs.length, linkedin: linkedinInfo }) };
      })();
      state["node-extract-deep"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-extract-deep"] = state["node-extract-deep"] || { output: results.step_transform_13 };
    console.log("type:WF_NODE_END:nodeId:node-extract-deep:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-extract-deep"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-extract-deep:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
