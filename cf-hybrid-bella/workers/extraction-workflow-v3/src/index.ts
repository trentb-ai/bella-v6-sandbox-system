/**
 * extraction-workflow-v3/src/index.ts
 * Worker handler + ExtractionWorkflow export.
 * Routes: POST /trigger → trigger extraction workflow, GET /health
 */

import { ExtractionPayloadV1 } from '@bella/contracts';
export { ExtractionWorkflow } from './workflow';

interface Env {
  EXTRACTION_WORKFLOW: Workflow;
  BRAIN: Fetcher;
  GEMINI_API_KEY: string;
  VERSION?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: env.VERSION ?? '1.0.0', worker: 'extraction-workflow-v3' });
    }

    if (url.pathname === '/trigger' && request.method === 'POST') {
      const body = await request.json();
      const parsed = ExtractionPayloadV1.safeParse(body);
      if (!parsed.success) {
        return Response.json(
          { error: 'Invalid ExtractionPayload', details: parsed.error.issues },
          { status: 400 }
        );
      }

      const instance = await env.EXTRACTION_WORKFLOW.create({
        params: parsed.data,
      });

      return Response.json({ ok: true, instanceId: instance.id });
    }

    return new Response('Not found', { status: 404 });
  },
};
