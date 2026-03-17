// Steps 19-20: Signal update-kv + Return result
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function signalReturn(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  // Step 19: Signal
  try {
    console.log("type:WF_NODE_START:nodeId:node-signal-update-kv:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_transform_19 = await step.do("step_transform_19", async () => {
      const inputData = state["node-kv-write-intel"]?.output || payload;
      const result = await (async () => {
        return { signal: "update-kv", status: "intel-ready" };
      })();
      state["node-signal-update-kv"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-signal-update-kv"] = state["node-signal-update-kv"] || { output: results.step_transform_19 };
    console.log("type:WF_NODE_END:nodeId:node-signal-update-kv:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-signal-update-kv"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-signal-update-kv:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }

  // Step 20: Return
  try {
    console.log("type:WF_NODE_START:nodeId:node-return:nodeName:return:nodeType:return:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_return_20 = await step.do("step_return_20", async () => {
      const result = { status: "complete", lid: results.step_entry_0.lid, intel: results.step_workers_ai_16!.text };
      state["node-return"] = {
        input: state["node-signal-update-kv"]?.output || payload,
        output: result
      };
      return result;
    });
    state["node-return"] = state["node-return"] || { output: results.step_return_20 };
    console.log("type:WF_NODE_END:nodeId:node-return:nodeName:return:nodeType:return:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-return"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-return:nodeName:return:nodeType:return:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
