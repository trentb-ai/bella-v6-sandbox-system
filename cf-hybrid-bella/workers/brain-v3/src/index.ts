/**
 * brain-v3/src/index.ts — Worker fetch handler + DO routing
 * Chunk 1 — V3 | Chunk 8: /event/* routes added
 */

export { BrainDO } from './brain-do';

import { IntelReadyEventV1 } from '@bella/contracts';

interface Env {
  DB: D1Database;
  BRAIN_DO: DurableObjectNamespace;
  EXTRACTION_WORKFLOW?: Fetcher;
}

const VERSION = '1.2.0';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: VERSION, worker: 'brain-v3' });
    }

    // ── /event/* — routed by lid in body, no callId query param required ─────

    if (url.pathname === '/event/fast-intel' && request.method === 'POST') {
      const raw = await request.json().catch(() => null);
      if (!raw) return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      const parsed = IntelReadyEventV1.safeParse(raw);
      if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
      const doId = env.BRAIN_DO.idFromName(parsed.data.lid);
      const stub = env.BRAIN_DO.get(doId);
      return stub.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(parsed.data), headers: { 'Content-Type': 'application/json' } }));
    }

    if (url.pathname === '/event/consultant-ready' && request.method === 'POST') {
      const raw = await request.json().catch(() => null);
      if (!raw) return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      const parsed = IntelReadyEventV1.safeParse(raw);
      if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
      const doId = env.BRAIN_DO.idFromName(parsed.data.lid);
      const stub = env.BRAIN_DO.get(doId);
      return stub.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(parsed.data), headers: { 'Content-Type': 'application/json' } }));
    }

    if (url.pathname === '/event/deep-scrape' && request.method === 'POST') {
      const raw = await request.json().catch(() => null);
      if (!raw) return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      const parsed = IntelReadyEventV1.safeParse(raw);
      if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
      const doId = env.BRAIN_DO.idFromName(parsed.data.lid);
      const stub = env.BRAIN_DO.get(doId);
      return stub.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(parsed.data), headers: { 'Content-Type': 'application/json' } }));
    }

    // ── Standard routes — routed by callId query param ────────────────────────

    // callId MUST be in query param — never read body at worker layer
    // (Request.body is a readable stream — consumed once, gone forever)
    const callId = url.searchParams.get('callId');
    if (!callId) {
      return new Response('Missing ?callId= query parameter', { status: 400 });
    }

    // Route to DO instance — body passes through untouched
    const doId = env.BRAIN_DO.idFromName(callId);
    const stub = env.BRAIN_DO.get(doId);
    return stub.fetch(request);
  },
};
