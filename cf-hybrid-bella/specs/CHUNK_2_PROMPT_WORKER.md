# CHUNK 2 SPEC — Prompt Worker
### bella-prompt-v3 Worker
### Author: T2 Code Lead | Date: 2026-04-07
### Status: REWORK v2 — T3 P1-P2 fixes + NB1-NB3 applied

---

## 1. SCOPE

Build `bella-prompt-v3` Worker that:
1. Receives `TurnPlanV1` from Brain (via service binding or HTTP)
2. Assembles a bounded prompt from TurnPlan fields + Bella persona
3. Calls Gemini 2.5 Flash via OpenAI-compatible streaming endpoint
4. Returns SSE stream to the caller (Realtime Agent) for TTS
5. Deterministic bypass: when `speakText` is set + `mandatory: true`, returns pre-built SSE (no Gemini call)
6. Fires `CompliancePayloadV1` to Compliance Workflow after response completes

**Out of scope for Chunk 2:** Realtime Agent (Chunk 3), Extraction Workflow (Chunk 5), Compliance Workflow internals (Chunk 6), telemetry emission (Chunk 4). Compliance dispatch is fire-and-forget to a stub.

**Separation of concerns:** Brain decides WHAT to say (TurnPlan). Prompt Worker decides HOW to say it (Gemini prompt + streaming). Brain never calls Gemini. Prompt Worker never advances stages.

---

## 2. FILE STRUCTURE

```
workers/prompt-worker-v3/src/
  index.ts          — Worker fetch handler, routes
  prompt-builder.ts — buildPrompt() — assembles system + user messages from TurnPlan
  persona.ts        — Bella persona text (lean, bounded)
  gemini.ts         — streamGemini() — OpenAI-compatible streaming call to Gemini 2.5 Flash
  sse.ts            — SSE helpers: buildDeterministicSSE(), parseSSEChunk()
  compliance.ts     — fireComplianceCheck() — dispatches to Compliance Workflow
  types.ts          — Internal types (GeminiMessage, SSEChunk, etc.)
```

---

## 3. PROMPT ASSEMBLY — buildPrompt()

### 3.1 Message Structure

Gemini receives an OpenAI-compatible `messages` array:

```typescript
interface GeminiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

function buildPrompt(plan: TurnPlan): GeminiMessage[] {
  return [
    { role: 'system', content: buildSystemMessage(plan) },
    { role: 'user', content: buildUserMessage(plan) },
  ];
}
```

### 3.2 System Message (Persona + Reference Data)

Bounded to ~1.5K chars. Three sections:

```
==== BELLA PERSONA ====
{persona text — inbound agent, never cold-call framing, never criticise website}

==== REFERENCE DATA (do not read aloud) ====
Confirmed facts:
{plan.confirmedFacts as bullet list}

Context notes:
{plan.contextNotes as bullet list}

Active memory:
{plan.activeMemory as bullet list}
```

The persona is STATIC — loaded from `persona.ts`. Reference data is DYNAMIC — populated from TurnPlan fields.

### 3.3 User Message (Directive + Output Contract)

The directive comes FIRST — this is what Gemini must follow:

```
==== MANDATORY DIRECTIVE ====
Stage: {plan.stage}
Objective: {plan.directive}

{speakSection}  // see below

==== OUTPUT CONTRACT ====
- Respond in 1-3 sentences maximum ({plan.maxTokens} token budget)
- DO NOT re-ask anything listed in CONFIRMED FACTS above
- DO NOT do math, calculations, or estimate dollar values — all numbers come from the plan
- {plan.mandatory ? "You MUST deliver the speak text verbatim — do not paraphrase" : "Paraphrase naturally while keeping the objective"}

**speakSection conditional logic:**
```typescript
const speakSection = plan.speakText
  ? plan.mandatory
    ? `SPEAK THIS EXACTLY: ${plan.speakText}`
    : `SUGGESTED WORDING (paraphrase naturally): ${plan.speakText}`
  : '';
```
- `mandatory=true + speakText`: "SPEAK THIS EXACTLY" (but deterministic bypass fires first — this rarely reaches Gemini)
- `mandatory=false + speakText`: "SUGGESTED WORDING" (guidance, not command — no contradiction with paraphrase contract)
- No speakText: empty string
- Never apologise
- Never criticise the prospect's website or business
- This is an INBOUND demo — the prospect submitted their details on your website
```

### 3.4 Prompt Size Budget

| Section | Target | Max |
|---|---|---|
| Persona | 400 chars | 600 chars |
| Reference data | 200-800 chars | 1200 chars |
| Directive + contract | 200-500 chars | 800 chars |
| **Total system + user** | **800-1700 chars** | **2600 chars** |

SLO: prompt-to-first-token < 500ms. Keeping prompts small is critical for latency.

---

## 4. GEMINI STREAMING — streamGemini()

### 4.1 API Call

```typescript
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const GEMINI_MODEL = 'gemini-2.5-flash';

async function streamGemini(
  messages: GeminiMessage[],
  apiKey: string,
  maxTokens: number,
): Promise<Response> {
  const response = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: GEMINI_MODEL,
      messages,
      stream: true,
      temperature: 0.3,
      max_tokens: maxTokens,
      reasoning_effort: 'none',  // Disable thinking — saves tokens + latency
      stream_options: { include_usage: true },
    }),
    signal: AbortSignal.timeout(15_000),  // 15s hard timeout
  });

  if (!response.ok || !response.body) {
    console.error(`[PROMPT] Gemini ${response.status}: ${await response.text()}`);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  return response;
}
```

### 4.2 SSE Passthrough

Prompt Worker does NOT parse/reassemble the SSE stream. It passes Gemini's SSE response body directly through to the caller with appropriate headers:

```typescript
return new Response(geminiResponse.body, {
  headers: {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Bella-Stage': plan.stage,
    'X-Bella-Move': plan.moveId,
  },
});
```

### 4.3 Bella Response Capture

To fire compliance and log what Bella said, we need the full response text. Use a `TransformStream` tee:

```typescript
function teeSSEStream(body: ReadableStream): {
  passthrough: ReadableStream;
  capture: Promise<string>;
} {
  const [stream1, stream2] = body.tee();
  const capture = collectSSEText(stream2); // reads all chunks, extracts content deltas
  return { passthrough: stream1, capture };
}
```

The `capture` promise resolves after stream completes. Used by `ctx.waitUntil()` to fire compliance asynchronously.

---

## 5. DETERMINISTIC BYPASS

When `plan.speakText` is set and `plan.mandatory === true`, Prompt Worker MUST return the exact text without calling Gemini. This ensures:
- ROI numbers are delivered verbatim (no Gemini math hallucination — V2 Bug 6)
- Greeting text is exact
- Any brain-computed speech is deterministic

```typescript
function buildDeterministicSSE(text: string, plan: TurnPlan): Response {
  const chunks = splitIntoSSEChunks(text);
  const body = chunks.map(chunk =>
    `data: ${JSON.stringify({
      id: plan.turnId,
      object: 'chat.completion.chunk',
      choices: [{ delta: { content: chunk }, index: 0, finish_reason: null }],
    })}\n\n`
  ).join('') + 'data: [DONE]\n\n';

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Bella-Stage': plan.stage,
      'X-Bella-Move': plan.moveId,
      'X-Bella-Deterministic': 'true',
    },
  });
}
```

`splitIntoSSEChunks()` breaks text into ~3-5 word chunks to simulate natural streaming cadence for TTS:

```typescript
function splitIntoSSEChunks(text: string): string[] {
  const words = text.split(/\s+/);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += 4) {
    const chunk = words.slice(i, i + 4).join(' ');
    // Include trailing space unless last chunk
    chunks.push(i + 4 < words.length ? chunk + ' ' : chunk);
  }
  return chunks;
}
```

Rules: split on word boundaries, 4 words per chunk, trailing space in each non-final chunk, punctuation stays with preceding word.

---

## 6. COMPLIANCE DISPATCH

After Bella's response is captured (from SSE tee or deterministic text), fire compliance check:

```typescript
async function fireComplianceCheck(
  plan: TurnPlan,
  bellaResponse: string,
  prospectUtterance: string,
  env: Env,
): Promise<void> {
  const payload: CompliancePayload = {
    version: 1,
    callId: plan.callId,
    turnId: plan.turnId,
    stage: plan.stage,
    directive: plan.directive,
    bellaResponse,
    prospectUtterance,
  };

  // Fire-and-forget to Compliance Workflow (Chunk 6 stub)
  if (env.COMPLIANCE_WORKFLOW) {
    await env.COMPLIANCE_WORKFLOW.fetch(
      new Request('https://compliance/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
    ).catch(err => console.error('[PROMPT] compliance dispatch failed:', err));
  }
}
```

Compliance is non-blocking. Prompt Worker does not wait for compliance results.

---

## 7. PERSONA — persona.ts

Lean, bounded persona text. Static — does not change per turn.

```typescript
export const BELLA_PERSONA = `You are Bella, an AI sales receptionist on a website demo.
The prospect just submitted their details — they gave you their name and business URL.
Your system scraped their site in real time, so you already know about their business.
They chose to be here. This is an inbound demo, not a cold call.
Never introduce yourself as if you are calling them.
Never apologise. Never criticise their website or business.
Be warm, professional, and concise. Speak in 1-3 sentences.
Do not do math or estimate dollar values — all numbers come from the plan.`;
```

---

## 8. WORKER API

### 8.1 Routes

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| POST | `/generate` | `GenerateRequestBody` | SSE stream | Generate Bella's response |
| GET | `/health` | — | `{ version, worker }` | Health check |

### 8.2 GenerateRequestBody

`POST /generate` body is NOT raw `TurnPlanV1`. It wraps the plan with the prospect utterance (needed for compliance):

```typescript
interface GenerateRequestBody {
  plan: TurnPlan;       // Validated against TurnPlanV1
  utterance: string;    // Prospect's utterance — passed through to compliance
}
```

Brain sends both when calling Prompt Worker. Prompt Worker validates `body.plan` with `TurnPlanV1.safeParse()` and carries `body.utterance` through to `fireComplianceCheck()`.

### 8.3 Worker Handler

```typescript
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: '1.0.0', worker: 'prompt-worker-v3' });
    }

    if (url.pathname === '/generate' && request.method === 'POST') {
      return handleGenerate(request, env, ctx);
    }

    return new Response('Not found', { status: 404 });
  },
};
```

### 8.4 handleGenerate() Control Flow

Numbered steps — T4 must implement in this exact order:

1. Parse request body as `GenerateRequestBody`
2. Validate `body.plan` against `TurnPlanV1.safeParse()` — return 400 on failure
3. **Deterministic bypass check:** if `plan.mandatory === true && plan.speakText` → `buildDeterministicSSE()`, fire compliance with speakText as bellaResponse, return SSE
4. Build prompt via `buildPrompt(plan)`
5. Call `streamGemini(messages, env.GEMINI_API_KEY, plan.maxTokens)`
6. Tee the SSE stream: `passthrough` for response, `capture` for compliance
7. `ctx.waitUntil(capture.then(text => fireComplianceCheck(plan, text, body.utterance, env)))`
8. Return `passthrough` stream as SSE Response with stage/move headers

---

## 9. Env BINDINGS

```typescript
interface Env {
  GEMINI_API_KEY: string;
  COMPLIANCE_WORKFLOW?: Fetcher;  // Service binding to compliance-workflow-v3 (Chunk 6 stub)
}
```

---

## 10. WRANGLER CONFIG

```toml
name = "bella-prompt-v3"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[vars]
VERSION = "1.0.0"
```

Secrets: `GEMINI_API_KEY` (set via `wrangler secret put`).

No Durable Objects, no D1. Prompt Worker is stateless.

---

## 11. ASSERTIONS

Test file: `workers/prompt-worker-v3/src/__tests__/chunk2.test.ts`

### C2-01: buildPrompt returns system + user messages
```
Given a TurnPlan with stage='ch_alex' and directive='Capture leads'
When buildPrompt() is called
Then result has exactly 2 messages: system (persona + reference) and user (directive + contract)
```

### C2-02: System message includes confirmed facts
```
Given a TurnPlan with confirmedFacts=['ACV: 5000', 'Leads: 50']
When buildPrompt() is called
Then system message contains 'ACV: 5000' and 'Leads: 50'
```

### C2-03: User message contains directive verbatim
```
Given a TurnPlan with directive='Deliver Alex speed-to-lead ROI'
When buildPrompt() is called
Then user message contains 'Deliver Alex speed-to-lead ROI'
```

### C2-04: Deterministic bypass when mandatory + speakText
```
Given a TurnPlan with mandatory=true, speakText='Alex adds $5,000 a week'
When handleGenerate() is called
Then response has header X-Bella-Deterministic: true
And response body contains the exact speakText in SSE format
And Gemini is NOT called
```

### C2-05: Gemini called when not mandatory or no speakText
```
Given a TurnPlan with mandatory=false, speakText=undefined
When handleGenerate() is called
Then Gemini API is called with stream=true
```

### C2-06: Prompt size under budget
```
Given a TurnPlan with maximum-length confirmedFacts and contextNotes
When buildPrompt() is called
Then total prompt chars < 2600
```

### C2-07: SSE response has correct headers
```
When any response is returned
Then Content-Type is 'text/event-stream; charset=utf-8'
And X-Bella-Stage matches the plan stage
```

### C2-08: Compliance payload fired after response
```
Given a successful generate call
When response stream completes
Then CompliancePayloadV1 is dispatched with correct callId, turnId, stage, bellaResponse
```

### C2-09: Gemini timeout produces fallback (not crash)
```
Given Gemini does not respond within 15s
When streamGemini() times out
Then a graceful error response is returned (not a worker crash)
```

### C2-10: User message includes "DO NOT re-ask" contract
```
Given any TurnPlan
When buildPrompt() is called
Then user message contains 'DO NOT re-ask'
```

---

## 12. SLO TARGETS

| Metric | Target | Measurement |
|---|---|---|
| Prompt-to-first-token | < 500ms | Time from TurnPlan received to first SSE chunk returned |
| Deterministic bypass | < 10ms | No network call — pure string formatting |
| Total prompt size | < 2600 chars | system + user messages combined |

---

## 13. IMPLEMENTATION NOTES FOR T4

1. **Use OpenAI-compatible endpoint** — NOT native Gemini `generateContent`. The OpenAI endpoint supports `stream: true` natively and returns ChatGPT-compatible SSE chunks.

2. **`reasoning_effort: 'none'`** is critical — without it, thinking tokens consume the `max_tokens` budget, truncating output at ~600 chars and inflating latency to 8s+.

3. **`temperature: 0.3`** — low enough for consistent directive following, high enough for natural speech variation.

4. **SSE passthrough** — do NOT parse and re-serialize the SSE stream from Gemini. Pass the response body through directly. Only tee it for compliance capture.

5. **Deterministic bypass** — split text into word-groups for natural TTS cadence. Do NOT send the entire text as one SSE chunk (TTS needs progressive delivery).

6. **No state, no D1, no DO** — Prompt Worker is pure stateless request/response. All state lives in Brain DO.

7. **Prompt Worker never reads lead_facts or KV** — everything it needs comes from TurnPlan. This is a hard boundary.

---

## 14. CONTRACT DEPENDENCIES

| Contract | Direction | Notes |
|---|---|---|
| `TurnPlanV1` | IN (from Brain) | Already defined in Chunk 0 |
| `CompliancePayloadV1` | OUT (to Compliance Workflow) | Already defined in Chunk 0 |

No new contracts needed.

---

## 15. DEPENDENCY GRAPH

```
Chunk 0 (contracts) ← DONE
Chunk 1 (Brain) ← DONE, T3 PASS
  ↓
Chunk 2 (Prompt Worker) ← THIS SPEC
  ↓
Chunk 3 (Realtime Transport) — calls Prompt Worker
Chunk 6 (Compliance Workflow) — receives CompliancePayload from Prompt Worker
```

---

END OF SPEC v2 — T3 P1-P2 + NB1-NB3 FIXED — AWAITING T3 RE-REVIEW
