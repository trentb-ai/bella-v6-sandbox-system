// Step 18: Write intel to KV — lead:{lid}:intel TTL 3600
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function writeIntel(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-kv-write-intel:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_kv_put_18 = await step.do("step_kv_put_18", async () => {
      const inputData = state["node-build-intel-json"]?.output || payload;
      const key = `lead:${results.step_entry_0.lid}:intel`;
      const value = `${results.step_transform_17!.json}`;
      await env.WORKFLOWS_KV.put(key, value, {
        expirationTtl: 3600
      });
      const result = { success: true, key };
      state["node-kv-write-intel"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-kv-write-intel"] = state["node-kv-write-intel"] || { output: results.step_kv_put_18 };
    console.log("type:WF_NODE_END:nodeId:node-kv-write-intel:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-kv-write-intel"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-kv-write-intel:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
