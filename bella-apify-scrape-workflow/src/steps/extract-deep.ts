// Step 13: Extract deep data from Apify results
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

// ── Hiring → Agent Replacement Classifier ──
function classifyJobToAgent(title: string): { role: string; agents: string[]; wedge: string } | null {
  const t = (title || "").toLowerCase();
  if (/receptionist|admin|front.desk|office.assistant/i.test(t))
    return { role: "receptionist", agents: ["Maddie"], wedge: "handles overflow immediately while you find the right person" };
  if (/\bsdr\b|\bbdr\b|sales.develop|lead.gen/i.test(t))
    return { role: "SDR", agents: ["Alex"], wedge: "follows up every lead in under 60 seconds, 24/7" };
  if (/customer.service|customer.support|support.agent|call.centre|call.center/i.test(t))
    return { role: "customer support", agents: ["Chris", "Maddie"], wedge: "handles enquiries instantly, no hold time" };
  if (/marketing|digital.market/i.test(t))
    return { role: "marketing", agents: ["Chris", "Alex"], wedge: "makes sure that traffic converts" };
  if (/\bsales\b|closer|account.exec|business.develop/i.test(t))
    return { role: "sales", agents: ["Alex", "Sarah"], wedge: "follows up and reactivates at scale" };
  if (/social.media/i.test(t))
    return { role: "social media", agents: ["Alex", "James"], wedge: "turns social engagement into booked meetings" };
  if (/office.manager|operations.manager/i.test(t))
    return { role: "office manager", agents: ["Maddie"], wedge: "handles calls and admin tasks 24/7" };
  return null;
}

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

        // ── Google Maps ──
        // compass scraper returns each dataset item as a flattened review+place combo
        // (NOT place with nested reviews[]), so iterate the array directly for reviews
        const gmItems = Array.isArray(scrape.google_maps) ? scrape.google_maps : [];
        const place: any = gmItems[0] || {};
        const reviews_sample = gmItems.slice(0, 5).map((r: any) => ({
          text: (r?.text || "").slice(0, 200), stars: r?.stars, name: r?.name,
          publishAt: r?.publishAt || r?.publishedAtDate || "",
          owner_response: r?.responseFromOwnerText ? (r.responseFromOwnerText).slice(0, 150) : "",
        })).filter((r: any) => r.text || r.stars);

        // ── Facebook Ads ──
        const fbAds = Array.isArray(scrape.facebook_ads) ? scrape.facebook_ads : [];
        const fb_ads_sample = fbAds.slice(0, 3).map((a: any) => ({
          text: (a?.bodyText || a?.caption || "").slice(0, 300), cta: a?.callToActionType || "",
          headline: a?.title || "", description: (a?.description || "").slice(0, 200),
          landing_url: a?.link || a?.linkUrl || "", format: a?.displayFormat || "",
          start_date: a?.startDate || a?.creationTime || "", page_name: a?.pageName || "",
        }));

        // ── Google Search (news/awards/SERP) ──
        // apify~google-search-scraper returns search PAGE objects with nested organicResults[]
        const googleSearchPages = Array.isArray(scrape.google_search) ? scrape.google_search : [];
        const organicResults = googleSearchPages.flatMap((page: any) => page?.organicResults || []);
        const google_search_results = organicResults.slice(0, 5).map((r: any) => ({
          title: r?.title || "", url: r?.url || r?.displayedUrl || "",
          description: (r?.description || r?.snippet || "").slice(0, 200),
        }));

        // ── Google Ads Transparency ──
        // alkausari_mujahid actor returns: domain, ads_ever (Yes/No), date_of_last_running, type_of_ad, ads_link
        const gadsTransparency = Array.isArray(scrape.google_ads_transparency) ? scrape.google_ads_transparency : [];
        const google_ads_sample = gadsTransparency.slice(0, 5).map((a: any) => ({
          domain: a?.domain || "",
          ads_ever: a?.ads_ever || "",
          date_of_last_running: a?.date_of_last_running || "",
          type_of_ad: a?.type_of_ad || "",
          ads_link: a?.ads_link || "",
        }));

        // ── Indeed ──
        // misceres actor returns job objects; filter out error objects (no title = not a real job)
        const indeedRaw = Array.isArray(scrape.indeed) ? scrape.indeed : [];
        const indeedJobs = indeedRaw.filter((j: any) => j?.title || j?.positionName);
        const jobs_sample = indeedJobs.slice(0, 5).map((j: any) => ({
          title: j?.title || j?.positionName || "", salary: j?.salary || "",
          location: j?.location || "", date: j?.datePosted || j?.date || "",
          type: j?.type || j?.contractType || "",
          description: (j?.description || j?.snippet || "").slice(0, 200),
        }));

        // ── Seek (AU only) ──
        // websift actor returns: title, salary, companyName, jobLocation[], listingDate, workType, teaser
        const seekJobs = Array.isArray(scrape.seek_jobs) ? scrape.seek_jobs : [];
        const seek_sample = seekJobs.slice(0, 5).map((j: any) => ({
          title: j?.title || "",
          salary: j?.salary || "",
          location: (j?.jobLocation?.[0]?.label) || "",
          company: j?.companyName || "",
          date: j?.listingDate || "",
          type: j?.workType || "",
        }));

        // ── LinkedIn ──
        const linkedinInfo: any = (Array.isArray(scrape.linkedin) ? scrape.linkedin[0] : scrape.linkedin) || {};

        // ── Hiring Agent Matches — classify each job into agent replacement wedge ──
        const allJobs = [
          ...indeedJobs.map((j: any) => ({ title: j?.title || j?.positionName || "", salary: j?.salary || "", source: "indeed" })),
          ...seekJobs.map((j: any) => ({ title: j?.title || "", salary: j?.salary || "", source: "seek" })),
        ];
        const hiring_agent_matches = allJobs
          .map((j: any) => {
            const match = classifyJobToAgent(j.title);
            return match ? { title: j.title, salary: j.salary, source: j.source, ...match } : null;
          })
          .filter(Boolean);

        return {
          // Google Maps
          google_rating: place.totalScore || place.rating || null,
          review_count: place.reviewsCount || 0,
          address: place.address || null,
          categories: place.categories || [],
          reviews_sample,
          opening_hours: place.openingHours || null,
          phone: place.phone || null,
          listed_website: place.website || null,
          photos_count: place.imageUrls?.length || place.photosCount || 0,
          // Facebook Ads
          is_running_fb_ads: fbAds.length > 0,
          fb_ads_count: fbAds.length,
          fb_ads_sample,
          // Google Search (SERP)
          google_search_count: organicResults.length,
          google_search_results,
          // Google Ads Transparency
          is_running_google_ads: gadsTransparency.some((a: any) => a?.ads_ever === "Yes"),
          google_ads_transparency_count: gadsTransparency.length,
          google_ads_sample,
          // Indeed
          is_hiring: indeedJobs.length > 0 || seekJobs.length > 0,
          job_count: indeedJobs.length,
          jobs_sample,
          // Seek
          seek_count: seekJobs.length,
          seek_sample,
          // Hiring → Agent Replacement Matches
          hiring_agent_matches,
          top_hiring_wedge: (hiring_agent_matches[0] as any) || null,
          // LinkedIn
          linkedin_employees: linkedinInfo?.employeeCount || linkedinInfo?.staffCount || null,
          linkedin_industry: linkedinInfo?.industryName || linkedinInfo?.industry || null,
          linkedin_description: (linkedinInfo?.description || "").slice(0, 300),
          // Raw JSON (for backwards compat)
          raw_json: JSON.stringify({ google_maps: place, fb_ads_count: fbAds.length, google_search_count: organicResults.length, google_ads_transparency_count: gadsTransparency.length, indeed_count: indeedJobs.length, seek_count: seekJobs.length, linkedin: linkedinInfo }),
        };
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
