// Step 15: Read deep_flags from KV — lead:{lid}:deep_flags
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function readDeepFlags(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-kv-get-deep:nodeName:kv-get:nodeType:kv-get:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_kv_get_15 = await step.do("step_kv_get_15", async () => {
      const inputData = state["node-kv-deep-flags"]?.output || payload;
      const key = `lead:${results.step_entry_0.lid}:deep_flags`;
      const value = await env.WORKFLOWS_KV.get(key, { type: "json" });
      const result = {
        value,
        exists: value !== null,
        metadata: value ? { key } : null
      };
      state["node-kv-get-deep"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-kv-get-deep"] = state["node-kv-get-deep"] || { output: results.step_kv_get_15 };
    console.log("type:WF_NODE_END:nodeId:node-kv-get-deep:nodeName:kv-get:nodeType:kv-get:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-kv-get-deep"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-kv-get-deep:nodeName:kv-get:nodeType:kv-get:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
