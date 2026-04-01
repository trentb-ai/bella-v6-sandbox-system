// Step 14: Write deep_flags to KV — lead:{lid}:deep_flags TTL 86400
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function writeDeepFlags(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-kv-deep-flags:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_kv_put_14 = await step.do("step_kv_put_14", async () => {
      const inputData = state["node-extract-deep"]?.output || payload;
      const key = `lead:${results.step_entry_0.lid}:deep_flags`;
      // Merge raw_json contents (google_maps, linkedin at top level for bridge)
      // with ALL rich extracted fields (fb_ads_sample, reviews_sample, jobs_sample, etc.)
      const extracted = results.step_transform_13;
      let rawParsed: Record<string, any> = {};
      try { rawParsed = JSON.parse(extracted.raw_json || "{}"); } catch (_) {}
      const { raw_json: _discard, ...richFields } = extracted;
      // Include ad landing pages from step 13b (if available)
      const adPages = state["node-scrape-ad-pages"]?.output?.ad_landing_pages ?? [];
      const merged = { ...rawParsed, ...richFields, ...(adPages.length > 0 ? { ad_landing_pages: adPages } : {}) };
      const value = JSON.stringify(merged);
      await env.WORKFLOWS_KV.put(key, value, {
        expirationTtl: 86400
      });
      const result = { success: true, key };
      state["node-kv-deep-flags"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-kv-deep-flags"] = state["node-kv-deep-flags"] || { output: results.step_kv_put_14 };
    console.log("type:WF_NODE_END:nodeId:node-kv-deep-flags:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-kv-deep-flags"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-kv-deep-flags:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
