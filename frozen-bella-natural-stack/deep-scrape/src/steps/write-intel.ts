// Step 18: Write intel to KV — lead:{lid}:intel TTL 3600
// VERSION: v1.5.0-no-merge-own-key-only
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
      const lid = results.step_entry_0.lid;
      const key = `lead:${lid}:intel`;
      // Write ONLY deep data — no merge. Brain reads fast-intel separately (highest priority).
      // Each writer owns its own KV key. No clobbering possible.
      const value = `${results.step_transform_17!.json}`;
      await env.WORKFLOWS_KV.put(key, value, {
        expirationTtl: 3600
      });
      const result = { success: true, key };
      state["node-kv-write-intel"] = {
        input: inputData,
        output: result
      };
      console.log(`[WRITE_INTEL] lid=${lid} key=${key} written`);
      return result;
    });
    state["node-kv-write-intel"] = state["node-kv-write-intel"] || { output: results.step_kv_put_18 };
    console.log("type:WF_NODE_END:nodeId:node-kv-write-intel:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-kv-write-intel"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-kv-write-intel:nodeName:kv-put:nodeType:kv-put:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    // Non-fatal: allow steps 18b/18c (deep.status stamps) to still run
    console.log(`[WRITE_INTEL_ERR] lid=${results.step_entry_0.lid} write-intel failed (non-fatal): ${errorMessage}`);
  }

  // Step 18b: Stamp fast-intel envelope deep.status = "done"
  // Bridge checks fast-intel deep.status === "done" before reading deep_flags / deep_scriptFills.
  // deep_flags (step 14) and deep_scriptFills (step 13c) are both written before this point,
  // so we stamp here — the last substantive KV write — to signal bridge that deep data is ready.
  try {
    await step.do("step_kv_stamp_deep_status_18b", async () => {
      const lid = results.step_entry_0.lid;
      const fiKey = `lead:${lid}:fast-intel`;
      const fiRaw = await env.WORKFLOWS_KV.get(fiKey, 'text');
      if (fiRaw) {
        const fi = JSON.parse(fiRaw);
        if (fi.deep) {
          fi.deep.status = 'done';
          fi.deep.ts_done = new Date().toISOString();
        }
        await env.WORKFLOWS_KV.put(fiKey, JSON.stringify(fi));
        console.log(`[DEEP_STATUS_STAMP] lid=${lid} fast-intel deep.status stamped done`);
      } else {
        console.log(`[DEEP_STATUS_STAMP] lid=${lid} fast-intel key not found — skip stamp`);
      }
      return { stamped: !!fiRaw };
    });
  } catch (error) {
    // Non-fatal: log and continue — deep data still exists in KV, stamp failure shouldn't abort workflow
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`[DEEP_STATUS_STAMP] lid=${results.step_entry_0.lid} stamp failed (non-fatal): ${errorMessage}`);
  }

  // Step 18c: Stamp lead:{lid}:intel deep.status = "done"
  // Bridge checks: (intel as any).intel?.deep?.status ?? intel.deep?.status
  // The :intel KV value schema is {summary, deep_data} — no intel.deep or intel.intel.deep by default.
  // UNCONDITIONAL stamp: create deep.status path if missing.
  try {
    await step.do("step_kv_stamp_deep_status_18c", async () => {
      const lid = results.step_entry_0.lid;
      const intelKey = `lead:${lid}:intel`;
      const intelRaw = await env.WORKFLOWS_KV.get(intelKey, 'text');
      if (!intelRaw) {
        console.log(`[DEEP_STATUS_STAMP_INTEL] lid=${lid} intel key not found — CANNOT stamp`);
        throw new Error(`lead:${lid}:intel not found — cannot stamp deep.status`);
      }
      const intel = JSON.parse(intelRaw);
      const ts = new Date().toISOString();
      // UNCONDITIONAL: create/merge deep at root level (bridge fallback path)
      intel.deep = { ...(intel.deep || {}), status: 'done', ts_done: ts };
      // UNCONDITIONAL: create/merge intel.deep at nested level (bridge primary path)
      if (!intel.intel) intel.intel = {};
      intel.intel.deep = { ...(intel.intel.deep || {}), status: 'done', ts_done: ts };
      await env.WORKFLOWS_KV.put(intelKey, JSON.stringify(intel), { expirationTtl: 3600 });
      // Dual-write: deep-status:v2 standalone key
      const deepStatusV2Key = `lead:${lid}:deep-status:v2`;
      const deepStatusV2Value = JSON.stringify({ status: 'done', ts_done: ts });
      await env.WORKFLOWS_KV.put(deepStatusV2Key, deepStatusV2Value, { expirationTtl: 3600 });
      console.log(`[DEEP_STATUS_V2] lid=${lid} key=deep-status:v2 written, ts_done=${ts}`);
      console.log(`[DEEP_STATUS_STAMP_INTEL] lid=${lid} intel key deep.status stamped done (both paths)`);
      return { stamped: true };
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log(`[DEEP_STATUS_STAMP_INTEL_ERR] lid=${results.step_entry_0.lid} stamp failed: ${errorMessage}`);
    // P0 failure logged but non-fatal — workflow should not abort over stamp failure
    // Deep data is still in KV via deep_flags/deep_scriptFills keys
  }
}
