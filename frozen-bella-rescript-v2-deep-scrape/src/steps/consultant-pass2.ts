// Step 14b: Consultant Pass 2 — enriches consultant output with deep flags data
// Reads pass1 from KV (lead:{lid}:consultant:pass1:v2), combines with deep flags,
// calls consultant /pass2, writes result to lead:{lid}:consultant:pass2:v2
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

export async function consultantPass2(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-consultant-pass2:nodeName:consultant-pass2:nodeType:service-call:timestamp:" + Date.now() + ":instanceId:" + instanceId);

    await step.do("step_consultant_pass2_14b", async () => {
      const lid = results.step_entry_0.lid;

      // Read pass1 consultant data from v2 key
      const pass1Raw = await env.WORKFLOWS_KV.get(`lead:${lid}:consultant:pass1:v2`, 'text');
      if (!pass1Raw) {
        console.log(`[CONSULTANT_PASS2] lid=${lid} pass1 not found — skipping pass 2`);
        return { skipped: true, reason: 'no_pass1' };
      }
      const pass1 = JSON.parse(pass1Raw);

      // Read deep flags (just written in step 14)
      const deepFlagsRaw = await env.WORKFLOWS_KV.get(`lead:${lid}:deep-flags:v2`, 'text');
      if (!deepFlagsRaw) {
        console.log(`[CONSULTANT_PASS2] lid=${lid} deep-flags:v2 not found — skipping pass 2`);
        return { skipped: true, reason: 'no_deep_flags' };
      }
      const deepFlags = JSON.parse(deepFlagsRaw);

      // Get business name from pass1 or fast-intel
      const businessName = pass1.businessIdentity?.correctedName
        ?? pass1.businessIdentity?.spokenName
        ?? payload.businessName
        ?? 'the business';

      // Call consultant /pass2 via service binding
      const t0 = Date.now();
      const resp = await env.CONSULTANT.fetch(new Request('https://consultant/pass2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, pass1, deepFlags }),
      }));

      const elapsed = Date.now() - t0;

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        console.log(`[CONSULTANT_PASS2] lid=${lid} HTTP ${resp.status} elapsed=${elapsed}ms err=${errText.slice(0, 200)}`);
        return { skipped: true, reason: `http_${resp.status}` };
      }

      const pass2Result = await resp.json() as any;
      console.log(`[CONSULTANT_PASS2] lid=${lid} elapsed=${elapsed}ms insights=${pass2Result.deepInsights?.length ?? 0} fallback=${!!pass2Result._fallback}`);

      // Write pass2 result to its own v2 key
      await env.WORKFLOWS_KV.put(
        `lead:${lid}:consultant:pass2:v2`,
        JSON.stringify(pass2Result),
        { expirationTtl: 86400 }
      );

      console.log(`[CONSULTANT_PASS2_KV] lid=${lid} key=consultant:pass2:v2 written`);

      state["node-consultant-pass2"] = { output: { success: true, elapsed, insights: pass2Result.deepInsights?.length ?? 0 } };
      return { success: true, elapsed };
    });

    console.log("type:WF_NODE_END:nodeId:node-consultant-pass2:nodeName:consultant-pass2:nodeType:service-call:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-consultant-pass2:nodeName:consultant-pass2:nodeType:service-call:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    // Non-fatal: pass 2 failure should not abort the workflow
    // Brain falls back to pass 1 data if pass 2 is missing
    console.log(`[CONSULTANT_PASS2] lid=${results.step_entry_0.lid} FAILED (non-fatal): ${errorMessage}`);
  }
}
