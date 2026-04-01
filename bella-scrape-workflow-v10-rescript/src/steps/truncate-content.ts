// Step 3: Truncate Firecrawl content — extract markdown, limit 4000 chars
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function truncateContent(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-truncate-content:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_transform_3 = await step.do("step_transform_3", async () => {
      const inputData = state["node-firecrawl"]?.output || payload;
      const result = await (async () => {
        const fcResp = state["node-firecrawl"]?.output?.body || {};
        const entries = Object.entries(fcResp);
        const mainEntry = entries.find(([k]) => k !== "success");
        const scrapeObj: any = mainEntry ? mainEntry[1] : {};
        const md = (scrapeObj?.markdown || "").slice(0, 4e3);
        return { content: md };
      })();
      state["node-truncate-content"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-truncate-content"] = state["node-truncate-content"] || { output: results.step_transform_3 };
    console.log("type:WF_NODE_END:nodeId:node-truncate-content:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-truncate-content"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-truncate-content:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
