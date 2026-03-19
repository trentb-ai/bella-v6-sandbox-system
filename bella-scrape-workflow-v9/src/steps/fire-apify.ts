// Step 4: Fire Wave 1 Apify actors (check pre-fired first, fallback: fire now)
// Uses Smart Wave Scheduler — remaining waves are fired by poll-apify-deep.ts
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';
import { fireActor } from '../lib/apify-client';
import { APIFY_ACTORS, buildWaves, buildActorContext } from '../lib/apify-actors';

export async function fireApify(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-fire-apify:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    results.step_transform_4 = await step.do("step_transform_4", async () => {
      const inputData = state["node-truncate-content"]?.output || payload;
      const result = await (async () => {
        const entry = state["node-entry"]?.output || {};
        const lid = entry.lid || "";

        // CHECK FOR PRE-FIRED RUNS from /fire-apify endpoint (T=0 optimization)
        if (lid) {
          try {
            const prefiredRaw = await env.WORKFLOWS_KV.get("lead:" + lid + ":apify_runs");
            if (prefiredRaw) {
              const prefired = JSON.parse(prefiredRaw);
              const hasRuns = Object.values(prefired).some((r: any) => r && r.runId);
              if (hasRuns) {
                console.log("[fire-apify] REUSING pre-fired Wave 1 runs for lid=" + lid);
                // Read remaining wave definitions from KV
                try {
                  const wavesRaw = await env.WORKFLOWS_KV.get("lead:" + lid + ":apify_remaining_waves");
                  if (wavesRaw) {
                    const remainingWaves = JSON.parse(wavesRaw);
                    state["node-fire-apify-waves"] = { output: remainingWaves };
                    console.log("[fire-apify] Remaining waves loaded from KV: " + remainingWaves.length + " waves");
                  }
                } catch (e) { /* remaining waves not in KV */ }
                return prefired;
              }
            }
          } catch (e: any) {
            console.log("[fire-apify] Failed to read pre-fired runs: " + e.message);
          }
        }

        // FALLBACK: fire Wave 1 now (no pre-fired runs found)
        const siteUrl = entry.url || "";
        const fallbackName = entry.name || "";
        let bizName = "";
        let bizLocation = "";
        let intel: any = null;
        try {
          const fiRaw: any = await env.WORKFLOWS_KV.get("lead:" + lid + ":fast-intel", { type: "json" });
          if (fiRaw) {
            intel = fiRaw;
            bizName = fiRaw.business_name || (fiRaw.core_identity && fiRaw.core_identity.business_name) || "";
            bizLocation = (fiRaw.core_identity && fiRaw.core_identity.location) || "";
            if (bizName) console.log("[fire-apify-fallback] Got bizName from Consultant KV: " + bizName + " location: " + bizLocation);
          }
        } catch (e) { /* ignore */ }
        if (!bizName && siteUrl) {
          try {
            const pageResp = await fetch(siteUrl, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow", signal: AbortSignal.timeout(3000) });
            const html = await pageResp.text();
            const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
            if (titleMatch) {
              bizName = titleMatch[1].trim()
                .replace(/^(home|welcome|about|main)\s*[\|\-\u2013\u2014:]\s*/i, "")
                .replace(/\s*[\|\-\u2013\u2014:]\s*(home|welcome|official|about|main|site|page|australia|au).*$/i, "")
                .replace(/\s*[\|\-\u2013\u2014:]\s*$/, "")
                .trim();
              console.log("[fire-apify-fallback] Got bizName from page title: " + bizName);
            }
          } catch (e: any) {
            console.log("[fire-apify-fallback] Title fetch failed: " + e.message);
          }
        }
        if (!bizName) {
          bizName = fallbackName || (siteUrl ? new URL(siteUrl).hostname.replace("www.", "") : "");
          console.log("[fire-apify-fallback] WARN: falling back to: " + bizName);
        }

        // Build waves using Smart Wave Scheduler
        const ctx = buildActorContext({ bizName, bizLocation, siteUrl, intel });
        const waves = buildWaves(APIFY_ACTORS, ctx);
        const apifyTk = env.APIFY_TOKEN || env.APIFY_API_KEY;

        if (waves.length === 0) {
          console.log("[fire-apify-fallback] No eligible actors");
          return {};
        }

        // Store remaining waves in state for poll-apify-deep
        const remainingWaves = waves.slice(1);
        state["node-fire-apify-waves"] = { output: remainingWaves };

        // Fire Wave 1 only
        const wave1 = waves[0];
        const startResults = await Promise.all(
          wave1.map(a => fireActor(a.key, a.actor, a.payload, apifyTk!))
        );
        const runs: Record<string, any> = {};
        startResults.forEach(r => { runs[r.key] = r; });

        console.log("[fire-apify] FALLBACK Wave 1 fired: " + Object.keys(runs).map(k => k + ":" + (runs[k].runId ? "ok" : "fail")).join(",") +
          " remaining_waves=" + remainingWaves.length);
        return runs;
      })();
      state["node-fire-apify"] = {
        input: inputData,
        output: result
      };
      return result;
    });
    state["node-fire-apify"] = state["node-fire-apify"] || { output: results.step_transform_4 };
    console.log("type:WF_NODE_END:nodeId:node-fire-apify:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify(state["node-fire-apify"]?.output));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-fire-apify:nodeName:transform:nodeType:transform:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
