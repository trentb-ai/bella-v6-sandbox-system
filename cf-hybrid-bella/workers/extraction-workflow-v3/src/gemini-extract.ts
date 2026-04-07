/**
 * extraction-workflow-v3/src/gemini-extract.ts
 * Gemini 2.5 Flash fallback extraction for fields deterministic missed.
 * Only called when deterministic layer returns empty for one or more targets.
 */

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL = 'gemini-2.5-flash';

interface GeminiEnv {
  GEMINI_API_KEY: string;
}

export async function geminiExtract(
  utterance: string,
  stage: string,
  missedTargets: string[],
  env: GeminiEnv,
): Promise<Record<string, any>> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${env.GEMINI_API_KEY}`,
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      messages: [
        {
          role: 'system',
          content: 'You are a data extraction assistant. Extract ONLY the requested fields from the prospect utterance. Return JSON only. If a field cannot be determined, omit it.',
        },
        {
          role: 'user',
          content: `Stage: ${stage}\nExtract these fields: ${missedTargets.join(', ')}\nUtterance: "${utterance}"`,
        },
      ],
      temperature: 0,
      max_tokens: 200,
      reasoning_effort: 'none',
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.error(`[EXTRACT] Gemini error: ${response.status}`);
    return {};
  }

  const data = await response.json() as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return {};

  try {
    return JSON.parse(content);
  } catch {
    console.error('[EXTRACT] Gemini returned non-JSON:', content);
    return {};
  }
}
