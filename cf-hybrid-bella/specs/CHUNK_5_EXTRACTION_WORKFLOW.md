# CHUNK 5 SPEC — Extraction Workflow
### bella-extraction-workflow-v3 (Cloudflare Workflow)
### Author: T2 Code Lead | Date: 2026-04-07
### Status: DRAFT v1 — awaiting T3 spec gate

---

## 1. SCOPE

Build `bella-extraction-workflow-v3` as a Cloudflare Workflow that:
1. Receives `ExtractionPayloadV1` from Brain DO (via service binding POST)
2. Normalises spoken numbers in the utterance (words → digits) — mandatory prereq
3. Runs deterministic extraction first (< 1ms, no LLM) — ported verbatim from V2
4. Falls back to Gemini extraction for fields deterministic missed
5. Merges deterministic (highest priority) + Gemini (gap-fill) into `ExtractionResultV1`
6. POSTs `ExtractionResultV1` back to Brain DO `/extraction-result?callId=X`
7. Every extracted fact tagged `data_source: 'prospect'` (speaker isolation guaranteed by Realtime Agent)
8. Durable execution with max 3 retries per step (Cloudflare Workflow guarantee)

**Not ctx.waitUntil** — this is a Cloudflare Workflow. Steps are durable, retried on failure, and survive worker restarts. This fixes V2 Bug 5 (fire-and-forget extraction with no retry).

**Out of scope for Chunk 5:** Compliance Workflow (Chunk 6), Telemetry (Chunk 4), Admin Dashboard (Chunk 12). Brain DO dispatch and result handling already implemented in Chunk 1.

**Separation of concerns:** Brain decides WHAT to extract (extractionTargets in TurnPlan). Extraction Workflow decides HOW to extract (deterministic + Gemini layers). Brain merges results into hotMemory.

---

## 2. FILE STRUCTURE

```
workers/extraction-workflow-v3/src/
  index.ts                  — Worker handler + Workflow class export
  workflow.ts               — ExtractionWorkflow class (step definitions)
  normalise.ts              — normaliseUtterance() — spoken words → digits
  deterministic-extract.ts  — Verbatim port from V2: parseSpokenNumber, parseDuration, mapDurationToBand, deterministicExtract
  gemini-extract.ts         — geminiExtract() — Gemini 2.5 Flash fallback for fields deterministic missed
  types.ts                  — Internal types (ExtractionStepResult, GeminiExtractionResponse, etc.)
```

---

## 3. WORKFLOW STEPS

### 3.1 Step Overview

```
ExtractionPayload arrives via POST /trigger
  ↓
step.do("normalise-utterance")   — words → digits, < 5ms
  ↓
step.do("extract-facts")         — deterministic (< 1ms) + Gemini fallback (< 2s)
  ↓
step.do("merge-to-brain")        — POST ExtractionResult to Brain DO /extraction-result
```

### 3.2 step.do("normalise-utterance")

Converts spoken number words to digits BEFORE any extraction runs. This is the root fix for V2's zero-extraction problem where "fifty leads" didn't match `\d+` regex.

```typescript
async normaliseUtterance(payload: ExtractionPayload): Promise<string> {
  const normalised = normaliseUtterance(payload.utterance);
  console.log(`[EXTRACT] normalised: "${payload.utterance}" → "${normalised}"`);
  return normalised;
}
```

Retries: max 3 (Workflow default). This step is pure computation — should never fail.

### 3.3 step.do("extract-facts")

Two-layer extraction with merge priority:

```typescript
async extractFacts(
  normalisedUtterance: string,
  payload: ExtractionPayload,
): Promise<Record<string, any>> {
  // Layer 1: Deterministic (< 1ms, no LLM)
  const extractStage = (payload.stage as string).startsWith('wow') ? 'wow' : payload.stage as StageId;
  const deterministic = deterministicExtract(normalisedUtterance, extractStage);

  // Check: which targets did deterministic miss?
  const missed = payload.targets.filter(t => deterministic[t] == null);

  // Layer 2: Gemini fallback (only for missed fields)
  let gemini: Record<string, any> = {};
  if (missed.length > 0) {
    gemini = await geminiExtract(normalisedUtterance, payload.stage, missed, env);
  }

  // Merge: deterministic wins over Gemini
  const merged: Record<string, any> = { ...gemini, ...deterministic };

  // Filter to only requested targets
  const result: Record<string, any> = {};
  for (const target of payload.targets) {
    if (merged[target] != null) {
      result[target] = merged[target];
    }
  }

  return result;
}
```

Retries: max 3. Deterministic part never fails. Gemini may timeout — retry covers this.

### 3.4 step.do("merge-to-brain")

POST `ExtractionResultV1` back to Brain DO:

```typescript
async mergeToBrain(
  callId: string,
  turnId: string,
  extracted: Record<string, any>,
  env: Env,
): Promise<void> {
  const result: ExtractionResult = {
    version: 1,
    callId,
    turnId,
    extracted,
  };

  const response = await env.BRAIN.fetch(
    new Request(`https://brain/extraction-result?callId=${callId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    })
  );

  if (!response.ok) {
    throw new Error(`Brain merge failed: ${response.status}`);
  }

  console.log(`[EXTRACT] merged ${Object.keys(extracted).length} fields to Brain callId=${callId}`);
}
```

Retries: max 3. If Brain DO is temporarily unreachable, Workflow retries. This is the V2 Bug 5 fix.

---

## 4. NORMALISATION — normaliseUtterance()

### 4.1 Strategy

Use the inline pure TS normaliser (not `words-to-numbers` npm — bundling issues with ohm-js). Apply `parseSpokenNumber()` from the deterministic-extract module to replace number words in the utterance string with digits.

```typescript
export function normaliseUtterance(utterance: string): string {
  if (!utterance) return '';
  let s = utterance;

  // Replace compound number phrases with digits
  // Order matters: longer phrases first to avoid partial matches

  // Hundreds of thousands: "two hundred thousand" → "200000"
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine)\s+hundred\s+(?:and\s+)?(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)?[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\s*(?:thousand|grand|k)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Tens-ones thousand: "twenty five thousand" → "25000"
  s = s.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\s*(?:thousand|grand|k)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Single word × thousand: "fifty thousand" → "50000"
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s*(?:thousand|grand|k)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Compound phrases: "half a mill", "quarter mill", "a hundred thousand"
  s = s.replace(
    /\b(?:quarter|half|a|one|couple|few)\s+(?:of\s+)?(?:a\s+)?(?:mill(?:ion)?|hundred\s+thousand|thousand|grand|hundred)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Hundreds: "three hundred" → "300"
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine)\s+hundred\s*(?:and\s*)?(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)?[\s-]*(one|two|three|four|five|six|seven|eight|nine)?\b/gi,
    (match) => {
      const val = parseSpokenNumber(match);
      return val !== null ? String(val) : match;
    }
  );

  // Tens-ones: "twenty five" → "25"
  s = s.replace(
    /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-]+(one|two|three|four|five|six|seven|eight|nine)\b/gi,
    (match) => String(parseSpokenNumber(match) ?? match)
  );

  // Standalone tens/teens/ones: "fifty" → "50", "fifteen" → "15"
  s = s.replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b/gi,
    (match) => {
      const val = parseSpokenNumber(match);
      return val !== null ? String(val) : match;
    }
  );

  return s;
}
```

### 4.2 Key Rules

- Longer phrases replaced FIRST (e.g., "two hundred thousand" before "two hundred" before "two")
- `parseSpokenNumber()` is the single source of truth for word→digit conversion
- Original utterance structure preserved (only number words replaced, not surrounding text)
- Empty/null utterance returns empty string

---

## 5. DETERMINISTIC EXTRACTION — deterministicExtract()

### 5.1 Port Verbatim from V2

The entire `deterministic-extract.ts` from `cleanest-bella-brain-DO-FROZEN/src/deterministic-extract.ts` (475 lines) is ported verbatim. No modifications except:
- Import path for `StageId` and `ResponseSpeedBand` types (adjusted to V3 types file)
- V3 StageId type includes all V3 stage names (same as V2 — greeting, wow, anchor_acv, ch_alex, ch_chris, ch_maddie, ch_sarah, ch_james, recommendation, roi_delivery, close)

### 5.2 Exports

| Function | Purpose | Latency |
|---|---|---|
| `parseSpokenNumber(text)` | Words → digits | < 0.1ms |
| `parseDuration(text)` | Spoken time → `{ value, unit }` | < 0.1ms |
| `mapDurationToBand(duration)` | Duration → ResponseSpeedBand | < 0.1ms |
| `deterministicExtract(transcript, stage)` | Main entry: transcript + stage → extracted fields | < 1ms |

### 5.3 Stage-Field Mapping

| Stage | Fields Extracted |
|---|---|
| `anchor_acv` | acv |
| `ch_alex` | inboundLeads, inboundConversions, inboundConversionRate, responseSpeedBand, inboundLeads_unit |
| `ch_chris` | webLeads, webConversions, webConversionRate, webLeads_unit |
| `ch_maddie` | phoneVolume, missedCalls, missedCallRate, phoneVolume_unit |
| `ch_sarah` | oldLeads |
| `ch_james` | newCustomersPerWeek, currentStars |
| `wow`, `greeting`, `recommendation` | responseSpeedBand (duration parsing only) |

---

## 6. GEMINI FALLBACK — geminiExtract()

### 6.1 When It Fires

Only for fields that deterministic missed. If deterministic captured everything in `targets`, Gemini is NOT called (saves latency + tokens).

### 6.2 API Call

```typescript
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL = 'gemini-2.5-flash';

async function geminiExtract(
  utterance: string,
  stage: string,
  missedTargets: string[],
  env: Env,
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

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) return {};

  try {
    return JSON.parse(content);
  } catch {
    console.error('[EXTRACT] Gemini returned non-JSON:', content);
    return {};
  }
}
```

### 6.3 Gemini Config Rationale

- `temperature: 0` — deterministic extraction, no creativity
- `reasoning_effort: 'none'` — no thinking tokens (same as Prompt Worker)
- `response_format: { type: 'json_object' }` — structured output (per memory: works reliably on OpenAI-compatible endpoint)
- `max_tokens: 200` — extraction output is tiny (a few key-value pairs)
- `AbortSignal.timeout(10_000)` — 10s hard timeout (extraction is background, not blocking TTS)

---

## 7. D1 PERSISTENCE — Source-Aware Upsert

### 7.1 How It Works

Brain DO handles D1 persistence on receiving ExtractionResult (already in Chunk 1 code). The key rule: every extracted fact is tagged `data_source: 'prospect'` because Realtime Agent guarantees only prospect speech reaches extraction (speakerFlag filter).

```sql
INSERT INTO lead_facts (lead_id, fact_key, fact_value, data_source, confidence, updated_at)
VALUES (?, ?, ?, 'prospect', 1.0, datetime('now'))
ON CONFLICT (lead_id, fact_key, data_source) DO UPDATE SET
  fact_value = excluded.fact_value,
  confidence = excluded.confidence,
  updated_at = excluded.updated_at
```

### 7.2 Source Isolation Invariants

- Upserting `(lead_id, 'acv', 'prospect')` updates the prospect-sourced ACV value
- Upserting `(lead_id, 'acv', 'prospect')` does NOT touch `(lead_id, 'acv', 'consultant')` — different data_source = different row
- getFact() waterfall (Chunk 1) resolves: prospect > consultant > scrape > industry_default
- Once prospect states their ACV, it wins over consultant's estimate forever

---

## 8. WORKFLOW CLASS

```typescript
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

export class ExtractionWorkflow extends WorkflowEntrypoint<Env, ExtractionPayload> {
  async run(event: WorkflowEvent<ExtractionPayload>, step: WorkflowStep) {
    const payload = event.payload;

    console.log(`[EXTRACT] workflow started callId=${payload.callId} turnId=${payload.turnId} stage=${payload.stage} targets=[${payload.targets.join(',')}]`);

    // Step 1: Normalise utterance (words → digits)
    const normalised = await step.do('normalise-utterance', async () => {
      return normaliseUtterance(payload.utterance);
    });

    // Step 2: Extract facts (deterministic + Gemini fallback)
    const extracted = await step.do('extract-facts', {
      retries: { limit: 3, delay: '1 second', backoff: 'exponential' },
    }, async () => {
      const extractStage = (payload.stage as string).startsWith('wow') ? 'wow' : payload.stage as StageId;
      const deterministic = deterministicExtract(normalised, extractStage);
      const missed = payload.targets.filter(t => deterministic[t] == null);

      let gemini: Record<string, any> = {};
      if (missed.length > 0 && this.env.GEMINI_API_KEY) {
        gemini = await geminiExtract(normalised, payload.stage, missed, this.env);
      }

      // Deterministic wins
      const merged = { ...gemini, ...deterministic };

      // Filter to requested targets only
      const result: Record<string, any> = {};
      for (const t of payload.targets) {
        if (merged[t] != null) result[t] = merged[t];
      }

      console.log(`[EXTRACT] deterministic=${Object.keys(deterministic).length} gemini=${Object.keys(gemini).length} merged=${Object.keys(result).length}`);
      return result;
    });

    // Step 3: POST result to Brain DO
    if (Object.keys(extracted).length > 0) {
      await step.do('merge-to-brain', {
        retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' },
      }, async () => {
        const result = {
          version: 1,
          callId: payload.callId,
          turnId: payload.turnId,
          extracted,
        };

        const response = await this.env.BRAIN.fetch(
          new Request(`https://brain/extraction-result?callId=${payload.callId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result),
          })
        );

        if (!response.ok) {
          throw new Error(`Brain merge failed: ${response.status}`);
        }

        console.log(`[EXTRACT] merged ${Object.keys(extracted).length} fields to Brain`);
      });
    } else {
      console.log(`[EXTRACT] no fields extracted — skipping merge`);
    }
  }
}
```

---

## 9. WORKER API

### 9.1 Routes

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| POST | `/trigger` | `ExtractionPayloadV1` | `{ ok: true, instanceId }` | Trigger extraction workflow |
| GET | `/health` | — | `{ version, worker }` | Health check |

### 9.2 Worker Handler

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: '1.0.0', worker: 'extraction-workflow-v3' });
    }

    if (url.pathname === '/trigger' && request.method === 'POST') {
      const body = await request.json();
      const parsed = ExtractionPayloadV1.safeParse(body);
      if (!parsed.success) {
        return Response.json({ error: 'Invalid ExtractionPayload', details: parsed.error.issues }, { status: 400 });
      }

      const instance = await env.EXTRACTION_WORKFLOW.create({
        params: parsed.data,
      });

      return Response.json({ ok: true, instanceId: instance.id });
    }

    return new Response('Not found', { status: 404 });
  },
};
```

---

## 10. ENV BINDINGS

```typescript
interface Env {
  EXTRACTION_WORKFLOW: Workflow;   // Cloudflare Workflow binding
  BRAIN: Fetcher;                  // Service binding to brain-v3
  GEMINI_API_KEY: string;          // Secret
  VERSION?: string;
}
```

---

## 11. WRANGLER CONFIG

```toml
name = "bella-extraction-workflow-v3"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[vars]
VERSION = "1.0.0"

[[workflows]]
name = "extraction-workflow"
binding = "EXTRACTION_WORKFLOW"
class_name = "ExtractionWorkflow"

[[services]]
binding = "BRAIN"
service = "bella-brain-v3"
```

Secrets: `GEMINI_API_KEY` (set via `wrangler secret put`).

---

## 12. ASSERTIONS

Test file: `workers/extraction-workflow-v3/src/__tests__/chunk5.test.ts`

### C5-01: normaliseUtterance converts spoken numbers
```
Given utterance "we get about fifty leads a week"
When normaliseUtterance() is called
Then result contains "50" (not "fifty")
```

### C5-02: normaliseUtterance preserves surrounding text
```
Given utterance "fifty leads a week"
When normaliseUtterance() is called
Then result is "50 leads a week" (structure preserved, only number replaced)
```

### C5-03: deterministicExtract captures ACV at anchor_acv stage
```
Given transcript "about five thousand dollars" and stage='anchor_acv'
When deterministicExtract() is called
Then result.acv === 5000
```

### C5-04: deterministicExtract captures leads at ch_alex stage
```
Given transcript "we get about 50 leads a week" and stage='ch_alex'
When deterministicExtract() is called
Then result.inboundLeads === 50
```

### C5-05: deterministicExtract captures responseSpeedBand
```
Given transcript "usually within half an hour" and stage='ch_alex'
When deterministicExtract() is called
Then result.responseSpeedBand === '5_to_30_minutes'
```

### C5-06: deterministicExtract returns {} for unrecognised input
```
Given transcript "I'm not sure" and stage='ch_alex'
When deterministicExtract() is called
Then result is {}
```

### C5-07: Merge priority — deterministic wins over Gemini
```
Given deterministic returns { acv: 5000 } and Gemini returns { acv: 4500 }
When merged
Then result.acv === 5000 (deterministic wins)
```

### C5-08: parseSpokenNumber handles compound phrases
```
parseSpokenNumber("two hundred thousand") === 200000
parseSpokenNumber("quarter mill") === 250000
parseSpokenNumber("fifty k") === 50000
parseSpokenNumber("$1.5m") === 1500000
```

### C5-09: parseDuration handles time expressions
```
parseDuration("half an hour") → { value: 30, unit: 'minutes' }
parseDuration("couple of days") → { value: 2, unit: 'days' }
parseDuration("instantly") → { value: 0, unit: 'seconds' }
```

### C5-10: mapDurationToBand maps correctly
```
mapDurationToBand({ value: 30, unit: 'minutes' }) === '5_to_30_minutes'
mapDurationToBand({ value: 2, unit: 'days' }) === 'next_day_plus'
mapDurationToBand({ value: 0, unit: 'seconds' }) === 'under_30_seconds'
```

### C5-11: ExtractionResult matches ExtractionResultV1 contract — no data_source field (MANDATORY)
```
Given extraction produces { acv: 5000 }
When ExtractionResultV1.safeParse() is called on the POSTed result
Then parse succeeds AND result.extracted has no data_source field
Note: data_source='prospect' tagging is Brain DO's job on D1 write, not extraction workflow
```

### C5-12: data_source='prospect' upsert semantics — verified in chunk1.test.ts (MANDATORY)
```
Moved to chunk1.test.ts — C1-SOURCE-UPSERT-01
Brain DO tests own D1 persistence behavior. Out of scope for extraction workflow.
```

### C5-13: Upsert source isolation — verified in chunk1.test.ts (MANDATORY)
```
Moved to chunk1.test.ts — C1-SOURCE-UPSERT-02
Brain DO tests own D1 persistence behavior. Out of scope for extraction workflow.
```

### C5-14: normaliseUtterance("fifty leads") contains "50" (MANDATORY)
```
normaliseUtterance("fifty leads") returns string containing "50"
```

### C5-15: normaliseUtterance("two hundred thousand") contains "200000" (MANDATORY)
```
normaliseUtterance("two hundred thousand") returns string containing "200000"
```

---

## 13. SLO TARGETS

| Metric | Target | Measurement |
|---|---|---|
| Normalisation | < 5ms | Pure string replacement |
| Deterministic extraction | < 1ms | Regex + word maps, no LLM |
| Gemini extraction (when needed) | < 3s | Only for missed fields |
| Total workflow (deterministic only) | < 100ms | Most common path |
| Total workflow (with Gemini) | < 5s | Fallback path |
| Brain merge POST | < 200ms | Service binding |

---

## 14. IMPLEMENTATION NOTES FOR T4

1. **Port `deterministic-extract.ts` VERBATIM** from `cleanest-bella-brain-DO-FROZEN/src/deterministic-extract.ts`. Do not re-engineer. 475 lines, battle-tested. Only change import paths for types.

2. **StageId type** — define locally in types.ts matching V3 stages: `'greeting' | 'wow_1' | ... | 'anchor_acv' | 'ch_alex' | 'ch_chris' | 'ch_maddie' | 'ch_sarah' | 'ch_james' | 'recommendation' | 'roi_delivery' | 'optional_side_agents' | 'close'`. The V2 file uses `'wow'` for all wow stages — map V3 `'wow_*'` to `'wow'` before calling deterministicExtract.

3. **WOW stage mapping** — V2 deterministicExtract checks `stage === 'wow'`. V3 has `wow_1` through `wow_8`. Before calling deterministicExtract, map any `wow_*` stage to `'wow'`: `const extractStage = stage.startsWith('wow') ? 'wow' : stage;`

4. **Normalisation runs BEFORE deterministic** — this is the whole point. "fifty leads" → "50 leads" → regex catches `\d+`. Without normalisation, deterministic misses word-only numbers (V2 root cause).

5. **Gemini is gap-fill ONLY** — if deterministic captured all targets, skip Gemini entirely. Most turns should be deterministic-only (< 100ms).

6. **`response_format: { type: 'json_object' }`** on Gemini OpenAI endpoint — per memory, this works reliably. Combined with `reasoning_effort: 'none'` for fast, clean JSON.

7. **Skip merge if nothing extracted** — if both deterministic and Gemini return empty, don't POST to Brain. No-op turns are common (e.g., "interesting" has no extractable data).

8. **Cloudflare Workflow class** — extends `WorkflowEntrypoint<Env, ExtractionPayload>`, uses `step.do()` for durable steps. Each step can have `retries: { limit: 3 }`.

9. **ResponseSpeedBand type** — define as string union matching V2: `'under_30_seconds' | 'under_5_minutes' | '5_to_30_minutes' | '30_minutes_to_2_hours' | '2_to_24_hours' | 'next_day_plus'`.

10. **Brain binding** — Brain DO already has `/extraction-result` handler (Chunk 1). ExtractionWorkflow POSTs to it via service binding. Uses `?callId=X` query param (same pattern as Brain's other routes).

11. **Replace wrangler.toml stub entirely** — the existing workers/extraction-workflow-v3/wrangler.toml has a [[d1_databases]] binding that is WRONG (extraction workflow does not write to D1 directly — Brain DO does). Replace the entire file with the config in §11 of this spec. Do not merge — full replacement.

---

## 15. CONTRACT DEPENDENCIES

| Contract | Direction | Notes |
|---|---|---|
| `ExtractionPayloadV1` | IN (from Brain) | Defined in Chunk 0 |
| `ExtractionResultV1` | OUT (to Brain) | Defined in Chunk 0 |

No new contracts needed.

---

## 16. DEPENDENCY GRAPH

```
Chunk 0 (contracts) ← DONE
Chunk 1 (Brain DO) ← DONE, deployed — has /extraction-result handler
  ↓
Chunk 5 (Extraction Workflow) ← THIS SPEC
  ↓
Chunk 12 (Admin Dashboard) — blocked on Chunk 5 deploy
```

---

END OF SPEC v1 — AWAITING T3 SPEC GATE
