// Step E: Write early script_stages to KV — lead:{lid}:script_stages TTL 86400
// NOTE: This step does NOT rethrow errors (intentional — non-fatal)
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function writeEarlyStages(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-early-stages:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_early_stages = await step.do("step_early_stages", async () => {
      const lid = results.step_entry_0.lid;
      const bizName = results.step_entry_0.name || "your business";
      const stages = [
        { id: 1, key: "wow", agent: "Bella", active: true, script: "WOW \u2014 HOOK IN 30 SECONDS\n\nSAY: \"" + bizName + " audit complete.\"\n\nAsk: \"Before I walk you through the numbers, who typically handles your marketing over there?\"" },
        { id: 2, key: "demo_value_bridge", agent: "Bella", active: true, script: "VALUE BRIDGE\n\nSAY: \"The reason I'm calling is we've benchmarked " + bizName + " against our AI performance standards. I've got some ROI projections I want to show you.\"\n\nAsk: \"Takes about 90 seconds. Sound fair?\"" },
        { id: 3, key: "anchor_acv", agent: "Bella", active: true, capture: "average_customer_value", script: "ANCHOR \u2014 ACV\n\nAsk: \"What's a typical customer worth to " + bizName + " on average? Just a ballpark.\"" },
        { id: 4, key: "anchor_volume", agent: "Bella", active: true, capture: "leads_per_week", script: "ANCHOR \u2014 Volume\n\nAsk: \"Roughly how many enquiries are you seeing per week?\"" }
      ];
      var key = "lead:" + lid + ":script_stages";
      var value = JSON.stringify({ stages: stages });
      await env.WORKFLOWS_KV.put(key, value, { expirationTtl: 86400 });
      return { success: true, key: key, count: stages.length };
    });
    console.log("type:WF_NODE_END:nodeId:node-early-stages:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(results.step_early_stages));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-early-stages:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    // NOTE: intentionally does NOT rethrow — matches deployed.js behavior
  }
}
