/**
 * compliance-workflow-v3/src/index.ts
 * Worker handler + workflow class exports.
 * Routes: /health, /check-inline, /audit-turn, /audit-nightly
 */

import { CompliancePayloadV1 } from '@bella/contracts';
import { inlineCheck } from './ring1';
import { emit } from '@bella/telemetry';

const VERSION = '0.2.0';
export { ComplianceWorkflow } from './ring2';
export { NightlyReplayWorkflow } from './ring3';

interface Env {
  DB: D1Database;
  AUDIT_BUCKET: R2Bucket;
  COMPLIANCE_WORKFLOW: Workflow;
  NIGHTLY_WORKFLOW: Workflow;
  GEMINI_API_KEY: string;
  VERSION?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: VERSION, worker: 'compliance-workflow-v3' });
    }

    if (url.pathname === '/check-inline' && request.method === 'POST') {
      const body = await request.json();
      const parsed = CompliancePayloadV1.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: 'Invalid payload', details: parsed.error.issues }, { status: 400 });
      }
      const result = inlineCheck(parsed.data);
      emit({
        family: 'compliance.gate',
        callId: result.callId,
        ts: Date.now(),
        ring: 1,
        score: result.score,
        driftType: result.driftType,
        stage: parsed.data.stage,
      });
      return Response.json(result);
    }

    if (url.pathname === '/audit-turn' && request.method === 'POST') {
      const body = await request.json();
      const parsed = CompliancePayloadV1.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: 'Invalid payload', details: parsed.error.issues }, { status: 400 });
      }
      const instance = await env.COMPLIANCE_WORKFLOW.create({ params: parsed.data });
      return Response.json({ ok: true, instanceId: instance.id });
    }

    if (url.pathname === '/audit-nightly' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const instance = await env.NIGHTLY_WORKFLOW.create({ params: body });
      return Response.json({ ok: true, instanceId: instance.id });
    }

    return new Response('Not found', { status: 404 });
  },
};
