// Step 5: Consultant AI — Llama 3.1 8B flattery paragraph from website content
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function consultantAi(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-consultant-ai:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_workers_ai_5 = await step.do("step_workers_ai_5", async () => {
      const inputData = state["node-fire-apify"]?.output || payload;
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        prompt: `The business name is ${JSON.stringify(state["node-entry"]!.output.name)}. Using content from ${JSON.stringify(results.step_transform_3!.content)}, output one polished paragraph only. Flattery + sophisticated insight on market positioning, who they help, how they help. Always use the business name naturally the way a human would say it in conversation \u2014 e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Absolutely no criticism, no fixes, no tone analysis, no bullets.`,
        temperature: 0.7
      });
      const result = {
        response,
        text: response.response || response.text || JSON.stringify(response),
        usage: response.usage || {}
      };
      state["node-consultant-ai"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-consultant-ai"] = state["node-consultant-ai"] || { output: results.step_workers_ai_5 };
    console.log("type:WF_NODE_END:nodeId:node-consultant-ai:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-consultant-ai"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-consultant-ai:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
