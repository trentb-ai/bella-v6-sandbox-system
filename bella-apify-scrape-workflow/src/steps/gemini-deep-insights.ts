import type { Env, WorkflowResults, WorkflowState, StepFn, WorkflowPayload } from '../lib/types';

const GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

interface DeepInsight {
  source: string;
  bellaLine: string;
  agentTie: string;
}

interface DeepScriptFills {
  deepInsights: DeepInsight[];
  heroReview: {
    summary: string | null;
    available: boolean;
  };
  generatedAt: string;
}

async function callGeminiMicro(
  source: string,
  rawData: Record<string, any>,
  businessName: string,
  icpGuess: string,
  apiKey: string
): Promise<{ deepInsights: DeepInsight[]; heroReview?: { summary: string | null; available: boolean } } | null> {
  const prompt = `You are Bella Deep-Insight Micro-Analyst.
You receive one source of async enrichment about a prospect business.
Return strict JSON only. No markdown. No preamble.

Your job is to produce 1-2 spoken-ready insight lines Bella can say in under 20 words each.
Each line must connect the data to commercial impact or recommended agent fit.
Do not repeat raw data mechanically.
Do not mention uncertainty unless the data is weak.
If the source is weak or empty, return an empty deepInsights array.

Rules:
- Keep each bellaLine under 20 words.
- Make each line sound natural when spoken aloud.
- Prefer urgency, leverage, conversion risk, staffing burden, or trust signals.
- If source is google_maps, optionally produce heroReview.summary as a one-sentence paraphrase of the strongest aligned review.
- If no useful insight exists, return empty arrays and heroReview.available=false.

Source type guidance:
- google_maps: emphasise trust, review volume, review themes, missed-opportunity cost. AgentTie: james or chris.
- fb_ads: emphasise paid traffic leakage, speed-to-lead, every click costing money. AgentTie: alex or chris.
- google_ads: emphasise landing-page conversion risk, paid traffic walking out the door. AgentTie: alex or chris.
- jobs: emphasise staffing burden, role replacement, immediate capacity. AgentTie: maddie or alex.

INPUT:
source: ${source}
business_name: ${businessName}
icp_guess: ${icpGuess}
raw_data: ${JSON.stringify(rawData).slice(0, 3000)}

Return ONLY this JSON:
{
  "deepInsights": [
    {
      "source": "${source}",
      "bellaLine": "spoken-ready sentence under 20 words",
      "agentTie": "alex|chris|maddie|sarah|james"
    }
  ],
  "heroReview": {
    "summary": "one sentence paraphrase of strongest review, or null",
    "available": true
  }
}`;

  try {
    const resp = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 400,
        temperature: 0.4,
        reasoning_effort: 'none',
      }),
    });

    if (!resp.ok) {
      console.log(`[DEEP_INSIGHTS] Gemini ${source} HTTP ${resp.status} — skipping`);
      return null;
    }

    const data = await resp.json() as any;
    const text = data?.choices?.[0]?.message?.content || '';
    if (!text) return null;

    let result: any;
    try {
      result = JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try { result = JSON.parse(match[0]); } catch { return null; }
    }
    return result;
  } catch (e: any) {
    console.log(`[DEEP_INSIGHTS] Gemini ${source} error: ${e.message} — skipping`);
    return null;
  }
}

export async function geminiDeepInsights(
  step: StepFn,
  env: Env,
  results: WorkflowResults,
  state: WorkflowState,
  instanceId: string,
  payload: WorkflowPayload
): Promise<void> {
  try {
    console.log("type:WF_NODE_START:nodeId:node-gemini-deep-insights:timestamp:" + Date.now() + ":instanceId:" + instanceId);

    await step.do("step_gemini_deep_insights", async () => {
      const apiKey = env.GEMINI_API_KEY || '';
      if (!apiKey) {
        console.log('[DEEP_INSIGHTS] No GEMINI_API_KEY — skipping');
        return { skipped: true };
      }

      const lid = results.step_entry_0?.lid || '';
      if (!lid) {
        console.log('[DEEP_INSIGHTS] No lid — skipping');
        return { skipped: true };
      }

      // Idempotency check — skip if already generated
      const existing = await env.WORKFLOWS_KV.get(`lead:${lid}:deep_scriptFills`);
      if (existing) {
        console.log(`[DEEP_INSIGHTS] lid=${lid} already exists — skipping`);
        return { skipped: true, reason: 'already_exists' };
      }

      // Pull extracted deep data from previous step
      const extracted = results.step_transform_13 || {};

      // Pull business context from fast-intel KV for better prompting
      let businessName = payload.name || payload.firstName || 'this business';
      let icpGuess = '';
      try {
        const fiRaw = await env.WORKFLOWS_KV.get(`lead:${lid}:fast-intel`, { type: 'json' }) as any;
        if (fiRaw) {
          businessName = fiRaw?.core_identity?.business_name
            || fiRaw?.consultant?.businessIdentity?.correctedName
            || businessName;
          icpGuess = fiRaw?.consultant?.scriptFills?.icp_guess
            || fiRaw?.script_fills?.icp_guess
            || '';
        }
      } catch { /* non-fatal */ }

      // Build per-source payloads — only fire Gemini if source has real data
      const sourceCalls: Array<{ source: string; data: Record<string, any> }> = [];

      if (extracted.google_rating || (extracted.reviews_sample?.length > 0)) {
        sourceCalls.push({
          source: 'google_maps',
          data: {
            rating: extracted.google_rating,
            review_count: extracted.review_count,
            reviews_sample: extracted.reviews_sample?.slice(0, 3) || [],
          }
        });
      }

      if (extracted.is_running_fb_ads && extracted.fb_ads_count > 0) {
        sourceCalls.push({
          source: 'fb_ads',
          data: {
            ad_count: extracted.fb_ads_count,
            ads_sample: extracted.fb_ads_sample?.slice(0, 2) || [],
          }
        });
      }

      if (extracted.is_running_google_ads) {
        sourceCalls.push({
          source: 'google_ads',
          data: {
            ad_count: extracted.google_ads_transparency_count,
            ads_sample: extracted.google_ads_sample?.slice(0, 2) || [],
          }
        });
      }

      if (extracted.is_hiring && (extracted.jobs_sample?.length > 0 || extracted.seek_sample?.length > 0)) {
        sourceCalls.push({
          source: 'jobs',
          data: {
            jobs: [
              ...(extracted.jobs_sample?.slice(0, 3) || []),
              ...(extracted.seek_sample?.slice(0, 2) || []),
            ],
            hiring_agent_matches: extracted.hiring_agent_matches?.slice(0, 2) || [],
          }
        });
      }

      if (sourceCalls.length === 0) {
        console.log(`[DEEP_INSIGHTS] lid=${lid} no qualifying sources — skipping Gemini`);
        return { skipped: true, reason: 'no_qualifying_sources' };
      }

      // Fire all micro-calls in parallel — non-fatal individually
      const t0 = Date.now();
      const geminiResults = await Promise.all(
        sourceCalls.map(({ source, data }) =>
          callGeminiMicro(source, data, businessName, icpGuess, apiKey)
            .catch(() => null)
        )
      );

      // Merge all insights — dedupe, cap at 3 total
      const allInsights: DeepInsight[] = [];
      let heroReview: { summary: string | null; available: boolean } = { summary: null, available: false };

      geminiResults.forEach((result, i) => {
        if (!result) return;
        const source = sourceCalls[i].source;

        if (result.deepInsights?.length > 0) {
          const insight = result.deepInsights[0];
          if (insight?.bellaLine && insight.bellaLine.length > 5) {
            allInsights.push({ source, bellaLine: insight.bellaLine, agentTie: insight.agentTie || '' });
          }
        }

        if (source === 'google_maps' && result.heroReview?.available && result.heroReview?.summary) {
          heroReview = result.heroReview;
        }
      });

      const fills: DeepScriptFills = {
        deepInsights: allInsights.slice(0, 3),
        heroReview,
        generatedAt: new Date().toISOString(),
      };

      // Write to KV — non-fatal
      try {
        await env.WORKFLOWS_KV.put(
          `lead:${lid}:deep_scriptFills`,
          JSON.stringify(fills),
          { expirationTtl: 86400 }
        );
        console.log(`[DEEP_INSIGHTS] lid=${lid} written insights=${allInsights.length} heroReview=${heroReview.available} duration=${Date.now() - t0}ms`);
      } catch (e: any) {
        console.log(`[DEEP_INSIGHTS] lid=${lid} KV write failed: ${e.message}`);
      }

      return { success: true, insights: allInsights.length, heroReview: heroReview.available };
    });

    console.log("type:WF_NODE_END:nodeId:node-gemini-deep-insights:timestamp:" + Date.now() + ":instanceId:" + instanceId);
  } catch (error) {
    // ALWAYS non-fatal — log and continue, never throw
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log("type:WF_NODE_ERROR:nodeId:node-gemini-deep-insights:timestamp:" + Date.now() + ":instanceId:" + instanceId + ":error:" + errorMessage + " — non-fatal, continuing");
  }
}
