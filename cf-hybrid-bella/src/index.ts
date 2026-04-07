// CF Hybrid Bella — Edge-native call brain
// Phase 0 scaffold — awaiting implementation specs

interface Env {
  BRAIN_D1: D1Database;
  LEADS_KV: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response('CF Hybrid Bella — ready for specs', { status: 200 });
  },
};
