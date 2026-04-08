/**
 * realtime-agent-v3/src/index.ts — Worker fetch handler + DO export
 * Chunk 3 — V3
 *
 * Routes WebSocket upgrades to RealtimeAgent DO by callId.
 * callId in query param → DO name → one DO instance per active call.
 */

import type { Env } from './types';
export { RealtimeAgent } from './realtime-do';

const VERSION = '1.3.0';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: VERSION, worker: 'realtime-agent-v3' });
    }

    if (url.pathname === '/ws') {
      const callId = url.searchParams.get('callId');
      if (!callId) {
        return new Response('Missing callId', { status: 400 });
      }

      // Route to DO instance — one per active call
      const id = env.REALTIME_AGENT.idFromName(callId);
      const stub = env.REALTIME_AGENT.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
