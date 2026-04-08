interface Env {
  BRAIN: D1Database;
  READER_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Auth
    const auth = request.headers.get('Authorization') ?? '';
    if (auth !== `Bearer ${env.READER_TOKEN}`) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (request.method !== 'POST') {
      return new Response('POST only', { status: 405 });
    }

    const { sql } = await request.json() as { sql: string };

    // Read-only guard — block any mutating statements
    const upper = sql.trim().toUpperCase();
    if (!upper.startsWith('SELECT')) {
      return new Response('Read-only. SELECT queries only.', { status: 403 });
    }

    const result = await env.BRAIN.prepare(sql).all();
    return Response.json(result.results);
  }
};
