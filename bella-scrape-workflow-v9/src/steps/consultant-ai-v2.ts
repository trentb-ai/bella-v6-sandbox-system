// Step 16: Consultant AI v2 — Llama 3.1 8B deep intel paragraph
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function consultantAiV2(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-consultant-ai-v2:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_workers_ai_16 = await step.do("step_workers_ai_16", async () => {
      const inputData = state["node-kv-get-deep"]?.output || payload;
      const response = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
        prompt: `The business name is ${JSON.stringify(state["node-entry"]!.output.name)}. Using this deep intelligence about the prospect's business (Google Maps reviews, ads activity, hiring signals, LinkedIn profile):

        ${JSON.stringify(results.step_kv_get_15!.value)}

        Output one polished paragraph of flattery and insight. Reference their Google rating, reviews, ad campaigns, hiring growth, or LinkedIn presence where available. Focus on their reputation, market activity, and growth trajectory. Always use the business name naturally the way a human would say it in conversation \u2014 e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Absolutely no criticism, no fixes, no negativity. Pure positive positioning. One paragraph only, written as natural speech.`,
        temperature: 0.7
      });
      const result = {
        response,
        text: response.response || response.text || JSON.stringify(response),
        usage: response.usage || {}
      };
      state["node-consultant-ai-v2"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-consultant-ai-v2"] = state["node-consultant-ai-v2"] || { output: results.step_workers_ai_16 };
    console.log("type:WF_NODE_END:nodeId:node-consultant-ai-v2:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-consultant-ai-v2"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-consultant-ai-v2:nodeName:workers-ai:nodeType:workers-ai:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
