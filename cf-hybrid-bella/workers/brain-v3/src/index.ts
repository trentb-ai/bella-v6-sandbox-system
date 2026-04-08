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
  BRAIN_VECTORS?: VectorizeIndex;
  AI?: Ai;
}

const VERSION = '1.19.9';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: VERSION, worker: 'brain-v3' });
    }

    // ── /event/* — routed by lid in body, no callId query param required ─────

    if (url.pathname === '/event/kb-ingest' && request.method === 'POST') {
      if (!env.BRAIN_VECTORS || !env.AI) {
        console.error('[BRAIN] kb-ingest: BRAIN_VECTORS/AI binding missing — check wrangler.toml');
        return Response.json({ error: 'BRAIN_VECTORS/AI binding missing' }, { status: 500 });
      }
      const raw = await request.json().catch(() => null);
      const { lid, doc } = (raw ?? {}) as { lid?: string; doc?: { content?: string } };
      if (!lid || !doc?.content) return Response.json({ error: 'Missing lid or doc.content' }, { status: 400 });
      const embResult = await env.AI.run('@cf/baai/bge-base-en-v1.5', { text: [doc.content] });
      if (!embResult?.data?.[0]) return Response.json({ error: 'embedding failed' }, { status: 500 });
      const vector = new Float32Array(embResult.data[0] as number[]);
      await env.BRAIN_VECTORS.upsert([{
        id: `kb-${lid}`,
        values: Array.from(vector),
        metadata: { tier: 3, client_id: lid, content: doc.content },
      }]);
      return Response.json({ ok: true });
    }

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
      if (!raw || typeof (raw as Record<string, unknown>).lid !== 'string' || !(raw as { lid: string }).lid) {
        return Response.json({ error: 'Missing required field: lid' }, { status: 400 });
      }
      const doId = env.BRAIN_DO.idFromName((raw as { lid: string }).lid);
      const stub = env.BRAIN_DO.get(doId);
      return stub.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(raw), headers: { 'Content-Type': 'application/json' } }));
    }

    if (url.pathname === '/event/deep-scrape' && request.method === 'POST') {
      const raw = await request.json().catch(() => null);
      if (!raw || typeof (raw as Record<string, unknown>).lid !== 'string' || !(raw as { lid: string }).lid) {
        return Response.json({ error: 'Missing required field: lid' }, { status: 400 });
      }
      const doId = env.BRAIN_DO.idFromName((raw as { lid: string }).lid);
      const stub = env.BRAIN_DO.get(doId);
      return stub.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(raw), headers: { 'Content-Type': 'application/json' } }));
    }

    // ── /turn-v2-compat — V2 TurnRequest translator ──────────────────────────

    if (url.pathname === '/turn-v2-compat' && request.method === 'POST') {
      const body = await request.json().catch(() => null);
      if (!body) {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }

      const { leadId, transcript, turnId } = body as Record<string, unknown>;
      if (!leadId || !transcript) {
        return Response.json(
          { error: 'Missing required fields: leadId, transcript' },
          { status: 400 }
        );
      }

      // Parse turnId to numeric turnIndex
      let turnIndex = 0;
      if (turnId && typeof turnId === 'string') {
        const match = (turnId as string).match(/(\d+)/);
        if (match) turnIndex = parseInt(match[1], 10);
      }

      // Build V3 TurnRequestV1 format
      const v3Request = {
        version: 1,
        callId: leadId,
        turnId: String(turnId) || `turn_${turnIndex}`,
        utterance: transcript,
        speakerFlag: 'prospect',
        turnIndex,
      };

      // Forward to /turn handler via DO
      const doId = env.BRAIN_DO.idFromName(String(leadId));
      const stub = env.BRAIN_DO.get(doId);
      return stub.fetch(
        new Request(new URL('/turn?callId=' + encodeURIComponent(String(leadId)), request.url), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(v3Request),
        })
      );
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
