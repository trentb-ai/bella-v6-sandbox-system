// Step 1: Write stub to KV — lead:{lid}:stub TTL 3600
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function writeStub(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-kv-stub:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_kv_put_1 = await step.do("step_kv_put_1", async () => {
      const inputData = state["node-entry"]?.output || payload;
      const key = `lead:${results.step_entry_0.lid}:stub`;
      const value = `{"status": "pending", "basics": {"name": "${results.step_entry_0.name}", "url": "${results.step_entry_0.url}", "firstName": "${results.step_entry_0.firstName}"}}`;
      await env.WORKFLOWS_KV.put(key, value, {
        expirationTtl: 3600
      });
      const result = { success: true, key };
      state["node-kv-stub"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-kv-stub"] = state["node-kv-stub"] || { output: results.step_kv_put_1 };
    console.log("type:WF_NODE_END:nodeId:node-kv-stub:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-kv-stub"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-kv-stub:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
