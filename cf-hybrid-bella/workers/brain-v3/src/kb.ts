/**
 * brain-v3/src/kb.ts — Three-Tier Knowledge Base (Vectorize)
 * Chunk 7 — Layer 10 (Intelligence Layers)
 *
 * Stub-safe: returns [] if BRAIN_VECTORS binding unavailable.
 * Chunk 10 wires real embedding via Workers AI text embedding model.
 */

interface Env {
  BRAIN_VECTORS: VectorizeIndex;
}

export interface KBResult {
  tier: 1 | 2 | 3;
  content: string;
  score: number;
}

export async function queryKB(
  query: string,
  env: { BRAIN_VECTORS?: unknown },
  opts: { topK?: number; scoreThreshold?: number } = {},
): Promise<KBResult[]> {
  if (!env.BRAIN_VECTORS) return [];

  const { topK = 3, scoreThreshold = 0.75 } = opts;

  try {
    const vectorize = env.BRAIN_VECTORS as Env['BRAIN_VECTORS'];
    // Chunk 10: replace zero-vector with real Workers AI embedding
    const results = await vectorize.query(new Float32Array(768).fill(0), {
      topK,
      returnValues: true,
      returnMetadata: 'all',
    });
    return results.matches
      .filter(m => m.score >= scoreThreshold)
      .map(m => ({
        tier: (m.metadata?.tier as 1 | 2 | 3) ?? 1,
        content: (m.metadata?.content as string) ?? '',
        score: m.score,
      }));
  } catch {
    return [];
  }
}
