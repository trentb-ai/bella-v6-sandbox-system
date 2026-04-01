// Step 17: Build intel JSON — combine consultant summary + deep data
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function buildIntel(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-build-intel-json:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_transform_17 = await step.do("step_transform_17", async () => {
      const inputData = state["node-kv-get-deep"]?.output || payload;
      const result = await (async () => {
        const summary = inputData.text || "";
        const deepVal = results.step_kv_get_15!.value || {};
        return { json: JSON.stringify({ summary, deep_data: deepVal }) };
      })();
      state["node-build-intel-json"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-build-intel-json"] = state["node-build-intel-json"] || { output: results.step_transform_17 };
    console.log("type:WF_NODE_END:nodeId:node-build-intel-json:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-build-intel-json"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-build-intel-json:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
