// Step P: Parallel WOW chain + Apify poll (was steps 8-12)
// Chain A: Read phase_a → AI refine WOW (Llama 70B) → Gemini polish → Write snippet
// Chain B: Poll all 5 Apify actor runs
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';
import { withTimeout, pollRun } from '../lib/apify-client';

export async function parallelWowApify(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  // waitForEvent removed — event can never arrive (4 mismatches), was a 5-min dead wait
  console.log("type:WF_NODE_START:nodeId:node-wait-call-connected:nodeName:wait-event:nodeType:wait-event:timestamp:" + Date.now() + ":instanceId:" + instanceId);
  results.step_wait_event_7 = { event: null, timedOut: true };
  state["node-wait-call-connected"] = state["node-wait-call-connected"] || { output: results.step_wait_event_7 };
  console.log("type:WF_NODE_END:nodeId:node-wait-call-connected:nodeName:wait-event:nodeType:wait-event:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-wait-call-connected"]?.output));

  try {
    console.log("type:WF_NODE_START:nodeId:node-parallel-wow-apify:nodeName:parallel:nodeType:parallel:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    const _parallelResult = await step.do("step_parallel_7", async () => {
      const lid = results.step_entry_0.lid;
      const firstName = state["node-entry"]!.output.firstName;
      const bizName = state["node-entry"]!.output.name;

      const [wowResult, apifyResult] = await Promise.all([
        // ── Chain A: WOW refinement (was steps 8-11) ──
        (async () => {
          // step_8: Read phase_a
          const phaseAKey = `lead:${lid}:phase_a`;
          const phaseAValue = await env.WORKFLOWS_KV.get(phaseAKey, { type: "text" });
          console.log("[PARALLEL] Chain A: phase_a read, chars=" + (phaseAValue?.length || 0));

          // step_9: AI refine WOW
          const aiResp = await env.AI.run("@cf/meta/llama-3.1-70b-instruct", {
            prompt: `You are writing the opening 25-40 second WOW script for Bella, Strategic Intel Director at Pillar and Post. The prospect's first name is ${JSON.stringify(firstName)}. Their business name is ${JSON.stringify(bizName)}. They just connected to a personalized demo call. Using this background on their business:

        ${JSON.stringify(phaseAValue)}

        Write Bella's opening that: 1) Greets ${JSON.stringify(firstName)} warmly by first name and welcomes them to their personalized demo, 2) References one strong specific observation about their website \u2014 hero message, positioning, or value proposition, 3) Mentions their offer, CTA, ICP, or social proof with genuine appreciation, 4) Connects this intelligence to how the AI team has been pre-trained: 'This is exactly the kind of business intelligence we've already used to pre-train your AI team, so they feel like they've been inside [business] for years.'

        Rules: 3-5 sentences max. Use the business name naturally the way a human would say it in conversation \u2014 e.g. 'KPMG Australia' becomes 'KPMG', 'Smith & Sons Plumbing' becomes 'Smith and Sons'. Never say 'your organization' or 'your firm'. Consultative, warm, confident \u2014 like a trusted strategic advisor who has done deep homework. No criticism, no implied gaps, no fixes \u2014 pure positive. Never say 'As an AI' or '100 data points'. Do NOT ask for numbers or mention ROI yet. Write as spoken dialogue only, no labels or stage directions.`,
            temperature: 0.7,
            max_tokens: 512
          });
          const rawSnippet = aiResp.response || aiResp.text || JSON.stringify(aiResp);
          console.log("[PARALLEL] Chain A: AI refine done, chars=" + rawSnippet.length);

          // step_10: Gemini polish
          let polished = rawSnippet;
          let geminiStatus = "skipped";
          const geminiKey = env.GEMINI_API_KEY;
          if (geminiKey && rawSnippet.length >= 10) {
            try {
              const gResp = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + geminiKey, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: `You are Bella, a confident, warm female strategic advisor. Polish this script so every single word sounds like natural spoken conversation. Contractions always (it is \u2192 it's, we have \u2192 we've, they are \u2192 they're). Natural rhythm and flow. Shorten any business name to how a human would actually say it aloud (KPMG Australia \u2192 KPMG, Smith & Sons Plumbing \u2192 Smith and Sons). Remove any stiff corporate language \u2014 no "your organization", "your firm", "leverage", "utilize". Keep the meaning and structure identical. Do not shorten or remove any sentences. Output ONLY the polished dialogue, nothing else:\n\n` + rawSnippet }] }], generationConfig: { temperature: 0.8, maxOutputTokens: 2048 } }) });
              const gJson: any = await gResp.json();
              polished = gJson?.candidates?.[0]?.content?.parts?.[0]?.text || rawSnippet;
              geminiStatus = "" + gResp.status;
            } catch (e: any) {
              console.log("[PARALLEL] Chain A: Gemini error: " + e.message);
              geminiStatus = "error";
            }
          }
          console.log("[PARALLEL] Chain A: Gemini done, status=" + geminiStatus);

          // step_11: Write snippet
          const snippetKey = `lead:${lid}:stage1_snippet`;
          await env.WORKFLOWS_KV.put(snippetKey, polished, { expirationTtl: 3600 });
          console.log("[PARALLEL] Chain A: snippet written");

          return { phaseA: phaseAValue, rawSnippet, polished, geminiStatus, aiUsage: aiResp.usage || {} };
        })(),

        // ── Chain B: Apify poll (was step 12) ──
        (async () => {
          const runs = state["node-fire-apify"]?.output || {};
          const apifyTk = env.APIFY_TOKEN || env.APIFY_API_KEY || "";
          const ACTOR_TIMEOUT_MS = 45000;
          const results = await Promise.all(
            Object.entries(runs).map(([key, run]: [string, any]) =>
              withTimeout(pollRun(key, run?.runId, apifyTk), ACTOR_TIMEOUT_MS)
                .then(r => r || { key, items: [], status: "timeout_race" })
            )
          );
          const out: Record<string, any> = {};
          results.forEach((r: any) => {
            out[r.key] = r.items;
            if (r.status !== "done") out[r.key + "_status"] = r.status;
          });
          console.log("[PARALLEL] Chain B: Apify poll done, keys=" + Object.keys(out).join(","));
          return out;
        })()
      ]);

      return { wow: wowResult, apify: apifyResult };
    });

    // Populate _workflowResults for downstream steps (13+)
    results.step_kv_get_8 = { value: _parallelResult.wow.phaseA, exists: true, metadata: { key: `lead:${results.step_entry_0.lid}:phase_a` } };
    results.step_workers_ai_9 = { text: _parallelResult.wow.rawSnippet, usage: _parallelResult.wow.aiUsage };
    results.step_transform_10 = { text: _parallelResult.wow.polished, raw: _parallelResult.wow.rawSnippet, gemini_status: _parallelResult.wow.geminiStatus };
    results.step_kv_put_11 = { success: true, key: `lead:${results.step_entry_0.lid}:stage1_snippet` };
    results.step_transform_12 = _parallelResult.apify;

    // Populate _workflowState for downstream steps
    state["node-kv-get-fast"] = { output: results.step_kv_get_8 };
    state["node-ai-refine-wow"] = { output: results.step_workers_ai_9 };
    state["node-gemini-polish"] = { output: results.step_transform_10 };
    state["node-kv-write-snippet"] = { output: results.step_kv_put_11 };
    state["node-collect-apify"] = { output: results.step_transform_12 };

    console.log("type:WF_NODE_END:nodeId:node-parallel-wow-apify:nodeName:parallel:nodeType:parallel:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify({ wow_chars: (_parallelResult.wow?.polished?.length || 0), apify_keys: Object.keys(_parallelResult.apify || {}).length }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-parallel-wow-apify:nodeName:parallel:nodeType:parallel:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
