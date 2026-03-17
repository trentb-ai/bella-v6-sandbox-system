// Step 6: Write phase_a to KV — lead:{lid}:phase_a TTL 3600
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function writePhaseA(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-kv-phase-a:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_kv_put_6 = await step.do("step_kv_put_6", async () => {
      const inputData = state["node-consultant-ai"]?.output || payload;
      const key = `lead:${results.step_entry_0.lid}:phase_a`;
      const value = `${results.step_workers_ai_5!.text}`;
      await env.WORKFLOWS_KV.put(key, value, {
        expirationTtl: 3600
      });
      const result = { success: true, key };
      state["node-kv-phase-a"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-kv-phase-a"] = state["node-kv-phase-a"] || { output: results.step_kv_put_6 };
    console.log("type:WF_NODE_END:nodeId:node-kv-phase-a:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-kv-phase-a"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-kv-phase-a:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
