// bella-scrape-workflow-v9 — Modular rewrite of deployed.js
// Class name: BellaV9Orchestrator (MUST stay identical)
// All business logic extracted VERBATIM into step modules
import { WorkflowEntrypoint } from "cloudflare:workers";
import type { Env, WorkflowResults, WorkflowState, WorkflowPayload } from './lib/types';

// Step imports
import { writeStub } from './steps/write-stub';
import { firecrawlScrape } from './steps/firecrawl-scrape';
import { truncateContent } from './steps/truncate-content';
import { fireApify } from './steps/fire-apify';
import { consultantAi } from './steps/consultant-ai';
import { writePhaseA } from './steps/write-phase-a';
import { writeEarlyStages } from './steps/write-early-stages';
import { parallelWowApify } from './steps/parallel-wow-apify';
import { extractDeep } from './steps/extract-deep';
import { writeDeepFlags } from './steps/write-deep-flags';
import { readDeepFlags } from './steps/read-deep-flags';
import { consultantAiV2 } from './steps/consultant-ai-v2';
import { buildIntel } from './steps/build-intel';
import { writeIntel } from './steps/write-intel';
import { writeStagesLate } from './steps/write-stages-late';
import { signalReturn } from './steps/signal-return';

// HTTP handler import
import { handleFireApify } from './fire-apify-handler';

export class BellaV9Orchestrator extends WorkflowEntrypoint<Env, WorkflowPayload> {
  async run(event: { instanceId: string; timestamp: number; payload: WorkflowPayload }, step: any) {
    console.log("type:WF_START:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":eventTimestamp:" + event.timestamp + ":payload:" + JSON.stringify(event.payload));
    const _workflowResults: WorkflowResults = {} as WorkflowResults;
    const _workflowState: WorkflowState = {};

    // ── Entry node ──
    try {
      console.log("type:WF_NODE_START:nodeId:node-entry:nodeName:entry:nodeType:entry:timestamp:" + Date.now() + ":instanceId:" + event.instanceId);
      _workflowResults.step_entry_0 = event.payload || {} as WorkflowPayload;
      _workflowState["node-entry"] = {
        input: event.payload,
        output: _workflowResults.step_entry_0
      };
      _workflowState["node-entry"] = _workflowState["node-entry"] || { output: _workflowResults.step_entry_0 };
      console.log("type:WF_NODE_END:nodeId:node-entry:nodeName:entry:nodeType:entry:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:true:output:" + JSON.stringify(_workflowState["node-entry"]?.output));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.log("type:WF_NODE_ERROR:nodeId:node-entry:nodeName:entry:nodeType:entry:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":success:false:error:" + errorMessage);
      throw error;
    }

    const env = this.env;
    const instanceId = event.instanceId;
    const payload = event.payload;

    // ── Step 1: Write stub ──
    await writeStub(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 2: Firecrawl scrape ──
    await firecrawlScrape(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 3: Truncate content ──
    await truncateContent(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 4: Fire Apify actors ──
    await fireApify(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 5: Consultant AI ──
    await consultantAi(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 6: Write phase_a ──
    await writePhaseA(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step E: Write early stages ──
    await writeEarlyStages(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step P: Parallel WOW chain + Apify poll ──
    await parallelWowApify(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 13: Extract deep data ──
    await extractDeep(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 14: Write deep_flags ──
    await writeDeepFlags(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 15: Read deep_flags ──
    await readDeepFlags(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 16: Consultant AI v2 ──
    await consultantAiV2(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 17: Build intel JSON ──
    await buildIntel(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 18: Write intel ──
    await writeIntel(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Step 19s: Write stages (late) ──
    await writeStagesLate(step, env, _workflowResults, _workflowState, instanceId, payload);

    // ── Steps 19-20: Signal + Return ──
    await signalReturn(step, env, _workflowResults, _workflowState, instanceId, payload);

    console.log("type:WF_END:timestamp:" + Date.now() + ":instanceId:" + event.instanceId + ":results:" + JSON.stringify(_workflowResults));
    return _workflowResults;
  }
}

// ── Fetch handler (HTTP routes) ──
export default {
  async fetch(req: Request, env: Env) {
    const _cors: Record<string, string> = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: _cors });
    }
    const url = new URL(req.url);
    const path = url.pathname;

    // ── /status/:instanceId ──
    if (path.startsWith("/status/")) {
      const instanceId = path.split("/status/")[1];
      if (!instanceId) return Response.json({ error: "Missing instanceId" }, { status: 400 });
      try {
        const instance = await env.BELLAV9ORCHESTRATOR_WORKFLOW.get(instanceId);
        return Response.json({ id: instanceId, details: await instance.status() });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 404 });
      }
    }

    // ── /fire-apify ──
    if (req.method === "POST" && path === "/fire-apify") {
      return handleFireApify(req, env, _cors);
    }

    // ── /event/:instanceId ──
    if (req.method === "POST" && path.startsWith("/event/")) {
      const instanceId = path.split("/event/")[1];
      if (!instanceId) return Response.json({ error: "Missing instanceId" }, { status: 400 });
      try {
        const body = await req.json();
        const instance = await env.BELLAV9ORCHESTRATOR_WORKFLOW.get(instanceId);
        await instance.sendEvent(body);
        return Response.json({ ok: true, instanceId, event: body });
      } catch (e: any) {
        return Response.json({ error: e.message }, { status: 500 });
      }
    }

    // ── Default: create workflow instance ──
    const params = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const newId = crypto.randomUUID();
    let instance = await env.BELLAV9ORCHESTRATOR_WORKFLOW.create({
      id: newId,
      params
    });
    return Response.json({
      id: instance.id,
      details: await instance.status()
    }, { headers: _cors });
  }
};
