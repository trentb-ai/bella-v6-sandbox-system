// Step P: Poll Wave 1, then fire+poll remaining waves sequentially
// Uses Smart Wave Scheduler — waves are dynamically packed under 8GB memory cap
// Checks available Apify memory before each wave, retries if insufficient
import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';
import { withTimeout, pollRun, fireAndPollWave, waitForMemory } from '../lib/apify-client';
import { APIFY_ACTORS, buildWaves, buildActorContext } from '../lib/apify-actors';
import type { ActorWithPayload } from '../lib/apify-actors';

export async function pollApifyDeep(
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
    console.log("type:WF_NODE_START:nodeId:node-poll-apify-deep:nodeName:parallel:nodeType:parallel:timestamp:" + Date.now() + ":instanceId:" + instanceId);
    const _parallelResult = await step.do("step_parallel_7", async () => {
      const wave1Runs = state["node-fire-apify"]?.output || {};
      const remainingWaves: ActorWithPayload[][] = state["node-fire-apify-waves"]?.output || [];
      const apifyTk = env.APIFY_TOKEN || env.APIFY_API_KEY || "";
      const lid = results.step_entry_0?.lid || "";
      const ACTOR_TIMEOUT_MS = 90000;  // 90s base — per-actor overrides in apify-client.ts (FB/Google ads = 120s)
      const allItems: Record<string, any[]> = {};
      const waveDebug: Record<string, any> = { ts_start: Date.now(), lid };

      // ── PHASE 1: Poll Wave 1 (already running from fire-apify) ──
      const wave1Keys = Object.keys(wave1Runs);
      console.log("[POLL_APIFY] Phase 1: Polling Wave 1 (" + wave1Keys.length + " actors: " + wave1Keys.join(", ") + ")");
      const wave1Results = await Promise.all(
        Object.entries(wave1Runs).map(([key, run]: [string, any]) =>
          withTimeout(pollRun(key, run?.runId, apifyTk), ACTOR_TIMEOUT_MS)
            .then(r => r || { key, items: [], status: "timeout_race" })
        )
      );
      const wave1Debug: any[] = [];
      wave1Results.forEach((r: any) => {
        allItems[r.key] = r.items || [];
        wave1Debug.push({
          key: r.key,
          runId: wave1Runs[r.key]?.runId || null,
          pollStatus: r.status,
          itemCount: r.items?.length || 0,
          error: r.error
        });
        if (r.status !== "done") console.log("[POLL_APIFY] Wave 1 " + r.key + " status=" + r.status);
      });
      waveDebug.wave1 = { ts: Date.now(), actors: wave1Debug };
      console.log("[POLL_APIFY] Wave 1 complete: " + wave1Results.map((r: any) => r.key + ":" + (r.items?.length || 0)).join(", "));

      // ── PHASE 2+: Fire + Poll remaining waves sequentially ──
      for (let i = 0; i < remainingWaves.length; i++) {
        const wave = remainingWaves[i];
        const waveNum = i + 2;
        const waveMem = wave.reduce((s: number, a: ActorWithPayload) => s + a.memory, 0);
        const waveLabel = "Wave " + waveNum + "/" + (remainingWaves.length + 1);

        console.log("[POLL_APIFY] " + waveLabel + ": " + wave.map((a: ActorWithPayload) => a.key + "(" + a.memory + ")").join(" + ") + " = " + waveMem + "MB");

        // Check available memory before firing (max 3 retries × 5s)
        const memCheck = await waitForMemory(waveMem, apifyTk);
        if (!memCheck.ok) {
          console.log("[POLL_APIFY] " + waveLabel + " WARN: Firing despite insufficient memory (available=" + memCheck.available + "MB needed=" + waveMem + "MB)");
        }

        // Fire + poll all actors in this wave
        const waveResult = await fireAndPollWave(wave, apifyTk, ACTOR_TIMEOUT_MS);
        Object.assign(allItems, waveResult.items);
        waveDebug["wave" + waveNum] = { ts: Date.now(), memCheck, actors: waveResult.debug };
        console.log("[POLL_APIFY] " + waveLabel + " complete: " + Object.entries(waveResult.items).map(([k, v]) => k + ":" + v.length).join(", "));

        // 5s deallocation delay before next wave (except after last wave)
        if (i < remainingWaves.length - 1) {
          console.log("[POLL_APIFY] Waiting 5s for memory deallocation...");
          await new Promise(resolve => setTimeout(resolve, 5000));
        }
      }

      // ── CATCH-UP: Fire conditional actors missed at T=0 (e.g. Seek when location was unknown) ──
      const allFiredKeys = new Set(Object.keys(allItems));
      if (lid) {
        try {
          const fiRaw: any = await env.WORKFLOWS_KV.get("lead:" + lid + ":fast-intel", { type: "json" });
          if (fiRaw) {
            const freshCtx = buildActorContext({
              bizName: fiRaw.business_name || fiRaw.core_identity?.business_name || "",
              bizLocation: fiRaw.core_identity?.location || "",
              siteUrl: results.step_entry_0?.url || "",
              intel: fiRaw,
            });
            const freshWaves = buildWaves(APIFY_ACTORS, freshCtx);
            const missed: ActorWithPayload[] = [];
            for (const wave of freshWaves) {
              for (const actor of wave) {
                if (!allFiredKeys.has(actor.key)) {
                  missed.push(actor);
                }
              }
            }
            if (missed.length > 0) {
              console.log("[POLL_APIFY] Catch-up: " + missed.length + " actors missed at T=0: " + missed.map(a => a.key).join(", "));
              const catchupResult = await fireAndPollWave(missed, apifyTk, ACTOR_TIMEOUT_MS);
              Object.assign(allItems, catchupResult.items);
              waveDebug.catchup = { ts: Date.now(), actors: catchupResult.debug };
            }
          }
        } catch (e: any) {
          console.log("[POLL_APIFY] Catch-up KV read failed: " + e.message);
        }
      }

      // ── Debug summary ──
      waveDebug.ts_end = Date.now();
      waveDebug.duration_ms = waveDebug.ts_end - waveDebug.ts_start;
      waveDebug.total_waves = remainingWaves.length + 1;
      waveDebug.total_keys = Object.keys(allItems);
      waveDebug.total_items = Object.fromEntries(Object.entries(allItems).map(([k, v]) => [k, v.length]));

      // Write debug breadcrumbs to KV
      if (lid) {
        try {
          await env.WORKFLOWS_KV.put("lead:" + lid + ":wave_debug", JSON.stringify(waveDebug), { expirationTtl: 3600 });
        } catch (e) { /* non-critical */ }
      }

      console.log("[POLL_APIFY] All " + (remainingWaves.length + 1) + " waves done, keys=" + Object.keys(allItems).join(",") +
        " duration=" + waveDebug.duration_ms + "ms");
      return allItems;
    });

    // Populate _workflowResults for downstream steps (13+)
    results.step_transform_12 = _parallelResult;

    // Populate _workflowState for downstream steps
    state["node-collect-apify"] = { output: results.step_transform_12 };

    console.log("type:WF_NODE_END:nodeId:node-poll-apify-deep:nodeName:parallel:nodeType:parallel:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:true:output:" + JSON.stringify({ apify_keys: Object.keys(_parallelResult || {}).length }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-poll-apify-deep:nodeName:parallel:nodeType:parallel:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":success:false:error:" + errorMessage);
    throw error;
  }
}
