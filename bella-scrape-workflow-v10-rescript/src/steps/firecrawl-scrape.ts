// Step 2: Firecrawl scrape — HTTP POST to firecrawl.dev
// P2-T6: Skip if fast-intel already scraped this page (avoids double Firecrawl cost)
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function firecrawlScrape(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-firecrawl:nodeName:http-request:nodeType:http-request:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_http_request_2 = await step.do("step_http_request_2", async () => {
      const inputData = state["node-kv-stub"]?.output || payload;

      // P2-T6: Check if fast-intel already scraped — skip Firecrawl to avoid double cost
      const lid = payload.lid;
      if (lid) {
        const existing = await env.WORKFLOWS_KV.get(`lead:${lid}:fast-intel`);
        if (existing) {
          console.log("[FIRECRAWL] SKIP — fast-intel already scraped lid=" + lid + " (" + existing.length + " bytes in KV)");
          // Return a synthetic result so downstream steps (truncate-content) still work
          const parsed = JSON.parse(existing);
          const syntheticBody = {
            success: true,
            data: {
              markdown: parsed.fast_intel?.page_content?.markdown ?? parsed.site_content_blob ?? "",
              metadata: { title: parsed.business_name ?? "", sourceURL: payload.url },
            },
          };
          const result = {
            status: 200,
            headers: {} as Record<string, string>,
            body: syntheticBody,
            message: "Skipped — using fast-intel cached scrape",
          };
          state["node-firecrawl"] = { input: inputData, output: result };
          return result;
        }
      }

      const response = await fetch("https://api.firecrawl.dev/v1/scrape", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.FIRECRAWL_KEY}`,
          "Content-Type": "application/json"
        },
        body: `{"url": "${results.step_entry_0.url}", "formats": ["markdown"], "onlyMainContent": true}`,
        signal: AbortSignal.timeout(15e4)
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const body = await response.json();
      const result = {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body,
        message: "HTTP request completed successfully"
      };
      state["node-firecrawl"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-firecrawl"] = state["node-firecrawl"] || { output: results.step_http_request_2 };
    console.log("type:WF_NODE_END:nodeId:node-firecrawl:nodeName:http-request:nodeType:http-request:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-firecrawl"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-firecrawl:nodeName:http-request:nodeType:http-request:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
