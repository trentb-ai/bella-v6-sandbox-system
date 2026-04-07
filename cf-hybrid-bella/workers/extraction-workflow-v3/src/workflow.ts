/**
 * extraction-workflow-v3/src/workflow.ts
 * ExtractionWorkflow — Cloudflare Workflow class.
 * Durable, retried extraction pipeline. Fixes V2 Bug 5 (fire-and-forget ctx.waitUntil).
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { ExtractionPayload } from '@bella/contracts';
import type { StageId } from './types';
import { normaliseUtterance } from './normalise';
import { deterministicExtract } from './deterministic-extract';
import { geminiExtract } from './gemini-extract';

interface Env {
  EXTRACTION_WORKFLOW: Workflow;
  BRAIN: Fetcher;
  GEMINI_API_KEY: string;
  VERSION?: string;
}

export class ExtractionWorkflow extends WorkflowEntrypoint<Env, ExtractionPayload> {
  async run(event: WorkflowEvent<ExtractionPayload>, step: WorkflowStep) {
    const payload = event.payload;

    console.log(
      `[EXTRACT] workflow started callId=${payload.callId} turnId=${payload.turnId} stage=${payload.stage} targets=[${payload.targets.join(',')}]`
    );

    // Step 1: Normalise utterance — spoken words → digits (root fix for V2 zero-extraction)
    const normalised = await step.do('normalise-utterance', async () => {
      const result = normaliseUtterance(payload.utterance);
      console.log(`[EXTRACT] normalised: "${payload.utterance}" → "${result}"`);
      return result;
    });

    // Step 2: Extract facts — deterministic first, Gemini gap-fill for misses
    const extracted = await step.do(
      'extract-facts',
      { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } },
      async () => {
        // Map wow_1..wow_8 → 'wow' for V2 deterministicExtract compatibility
        const extractStage = (payload.stage as string).startsWith('wow')
          ? ('wow' as StageId)
          : (payload.stage as StageId);

        const deterministic = deterministicExtract(normalised, extractStage);

        // Which targets did deterministic miss?
        const missed = payload.targets.filter((t) => deterministic[t] == null);

        let gemini: Record<string, any> = {};
        if (missed.length > 0 && this.env.GEMINI_API_KEY) {
          gemini = await geminiExtract(normalised, payload.stage, missed, this.env);
        }

        // Deterministic wins — spread Gemini first, then overwrite with deterministic
        const merged: Record<string, any> = { ...gemini, ...deterministic };

        // Filter to requested targets only
        const result: Record<string, any> = {};
        for (const t of payload.targets) {
          if (merged[t] != null) result[t] = merged[t];
        }

        console.log(
          `[EXTRACT] deterministic=${Object.keys(deterministic).length} gemini=${Object.keys(gemini).length} merged=${Object.keys(result).length}`
        );
        return result;
      }
    );

    // Step 3: POST result to Brain DO — skip if nothing extracted
    if (Object.keys(extracted).length > 0) {
      await step.do(
        'merge-to-brain',
        { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' } },
        async () => {
          const result = {
            version: 1 as const,
            callId: payload.callId,
            turnId: payload.turnId,
            extracted,
          };

          const response = await this.env.BRAIN.fetch(
            new Request(`https://brain/extraction-result?callId=${payload.callId}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result),
            })
          );

          if (!response.ok) {
            throw new Error(`Brain merge failed: ${response.status}`);
          }

          console.log(`[EXTRACT] merged ${Object.keys(extracted).length} fields to Brain`);
        }
      );
    } else {
      console.log(`[EXTRACT] no fields extracted — skipping merge`);
    }
  }
}
