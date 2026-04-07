/**
 * compliance-workflow-v3/src/ring2.ts
 * Ring 2 — Gemini LLM judge (async Cloudflare Workflow).
 * Fires post-turn, non-blocking. Writes D1 quality_scores + R2 audit log.
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { CompliancePayload, ComplianceResult } from '@bella/contracts';
import { ComplianceResultV1 } from '@bella/contracts';

interface Env {
  DB: D1Database;
  AUDIT_BUCKET: R2Bucket;
  GEMINI_API_KEY: string;
  VERSION?: string;
}

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export class ComplianceWorkflow extends WorkflowEntrypoint<Env, CompliancePayload> {
  async run(event: WorkflowEvent<CompliancePayload>, step: WorkflowStep) {
    const payload = event.payload;

    // Step 1: LLM judge
    const result = await step.do(
      'llm-judge',
      { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' } },
      async () => {
        if (!this.env.GEMINI_API_KEY) {
          return {
            version: 1 as const,
            callId: payload.callId,
            turnId: payload.turnId,
            score: 0.5,
            driftType: 'omission' as const,
            details: 'GEMINI_API_KEY not configured',
          };
        }
        const raw = await this.runGeminiJudge(payload);
        const parsed = ComplianceResultV1.safeParse({
          ...raw,
          version: 1,
          callId: payload.callId,
          turnId: payload.turnId,
        });
        if (!parsed.success) {
          return {
            version: 1 as const,
            callId: payload.callId,
            turnId: payload.turnId,
            score: 0.5,
            driftType: 'omission' as const,
            details: 'Parse failed',
          };
        }
        return parsed.data;
      }
    );

    // Step 2: Write D1
    await step.do(
      'write-d1',
      { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } },
      async () => {
        await this.env.DB.prepare(
          `INSERT OR IGNORE INTO quality_scores (call_id, turn_id, compliance_score, drift_type, details) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(result.callId, result.turnId, result.score, result.driftType, result.details ?? null)
          .run();
        console.log(
          `[COMPLIANCE] D1 written callId=${result.callId} score=${result.score} drift=${result.driftType}`
        );
      }
    );

    // Step 3: Write R2 audit log
    await step.do(
      'write-r2',
      { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } },
      async () => {
        const key = `audit/${result.callId}/${result.turnId}.json`;
        await this.env.AUDIT_BUCKET.put(
          key,
          JSON.stringify({ ...result, payload, ts: new Date().toISOString() }),
          { httpMetadata: { contentType: 'application/json' } }
        );
        console.log(`[COMPLIANCE] R2 written key=${key}`);
      }
    );
  }

  private async runGeminiJudge(payload: CompliancePayload): Promise<Partial<ComplianceResult>> {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.env.GEMINI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `You are a compliance judge for Bella, an INBOUND voice AI agent. The prospect CHOSE to be there. Score: 0.0=severe 0.5=minor 1.0=clean. driftType: none|omission|substitution|hallucination|false_claim. Return JSON only: { score, driftType, details? }`,
          },
          {
            role: 'user',
            content: `Stage: ${payload.stage}\nDirective: ${payload.directive}\nBella said: "${payload.bellaResponse}"\nProspect said: "${payload.prospectUtterance}"\nEvaluate compliance.`,
          },
        ],
        temperature: 0,
        max_tokens: 150,
        reasoning_effort: 'none',
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return { score: 0.5, driftType: 'omission' };
    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return { score: 0.5, driftType: 'omission' };
    try {
      return JSON.parse(content);
    } catch {
      return { score: 0.5, driftType: 'omission' };
    }
  }
}
