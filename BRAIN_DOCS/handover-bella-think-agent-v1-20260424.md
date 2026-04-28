# BELLA Think Agent V1 — Charlie Team Handover
**Date:** 2026-04-24 AEST  
**Outgoing:** T2 Code Lead (Sonnet)  
**Incoming:** Next Charlie Team Opus session  
**Brain doc ID:** `doc-bella-think-agent-v1-sprint-report-20260424`

---

## What This Project Is

A Cloudflare Workers + Durable Objects brain for the Bella Voice AI demo system, built on the `@cloudflare/think` framework. This is a **greenfield Think agent** — not a port of the V2-rescript bridge brain. It runs alongside the existing V2-rescript stack as the next-generation brain.

The Think agent replaces the old `deepgram-bridge-v2-rescript` brain logic. The bridge still handles WebSocket/STT/TTS transport. The Think agent handles all conversation logic, stage machine, ROI, and WOW personalisation.

---

## Location

```
/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/
```

**Deployed as:** `bella-think-agent-v1-brain`  
**Current version:** `v3.8.0-think`  
**Health:** `curl https://bella-think-agent-v1-brain.trentbelasco.workers.dev/health`

---

## Package Versions (Critical — do not downgrade)

```json
"@cloudflare/think": "^0.4.0"   ← was 0.1.2, caused 6 bugs
"agents": "^0.11.5"              ← was 0.9.0, caused 6 bugs
"ai": "^6.0.0"
"zod": "^4.0.0"
"@ai-sdk/openai": "^3.0.0"
```

The package upgrade from `agents@0.9.0` → `0.11.5` was the root cause fix for Sprint 3. **Do not downgrade.**

---

## Architecture

```
Bridge (WebSocket/STT/TTS)
    ↓ @callable processBridgeTurn(stream, userText)
BellaAgent (Think<Env, BellaConfig>)           ← bella-agent.ts
    ↓ subAgent()
    ├── ConsultantAgent (Agent<Env>)            ← consultant-agent.ts
    ├── DeepScrapeAgent (Agent<Env>)            ← deep-scrape-agent.ts
    ├── WowAgent (Agent<Env>)                   ← wow-agent.ts
    └── ROIAgent (Agent<Env>)                   ← roi-agent.ts

Intel pipeline → POST /intel → receiveIntel()
Pre-call research → BellaPreCallResearch        ← precall-workflow.ts

Flow controller (pure functions, no CF APIs):
    processFlow()    ← controller.ts
    buildStageDirective() ← moves.ts
    deterministicExtract() ← extraction/deterministic.ts
    tryRunCalculator() ← flow.ts
```

---

## Key Architecture Decisions (verified against CF docs)

### 1. `chatRecovery = true` — NOT `fibers = true`
`fibers = true` does NOT exist in agents@0.11.5 or @cloudflare/think@0.4.0. It was a dead no-op. Removed.  
`chatRecovery = true` is the correct Think property — wraps each chat turn in `runFiber` internally.

### 2. `runFiber` is public in agents@0.11.5
Was private `_runFiber` in agents@0.9.0. Now call `this.runFiber(name, fn)` directly — no cast needed.

### 3. `FiberRecoveryContext.name` — NOT `.methodName`
Field is `ctx.name` (the name passed to `runFiber()`). `ctx.methodName` does not exist. Prior code used wrong field.

### 4. Delivery fiber — correct architecture
`trackDelivery()` + `completeDelivery()` + `onFiberRecovered()` are correctly wired:
- `onChatResponse` → `void trackDelivery(deliveryId, moveId)` — starts 30s timeout fiber
- `beforeTurn` → `await completeDelivery(deliveryId)` — prospect spoke = delivery received
- `onFiberRecovered` → marks `"timeout"` if DO evicted during 30s window
- `processFlow()` owns `pendingDelivery` in the flow controller layer — delivery fiber is the SEPARATE silent-prospect timeout layer

### 5. `keepAliveWhile` is NOT needed inside `runFiber`
`runFiber` calls `keepAlive()` internally. Wrapping `runFiber` in `keepAliveWhile` is redundant. Removed.

### 6. `configureSession()` — correct Session builder API
```typescript
session
  .withContext("soul",   { provider: { get: async () => buildSoulContext() } })
  .withContext("intel",  { provider: { get: async () => buildIntelContext() } })
  .withContext("memory", { description: "...", maxTokens: 2000 })
  .withContext("script", { provider: { get: async () => buildStageDirectiveContext() } })
  .withCachedPrompt()
  .compactAfter(8000)
```
`refreshSystemPrompt()` called via `this._sessionRef?.refreshSystemPrompt?.()` after intel events.

### 7. `child.chat()` requires callback pattern
```typescript
await child.chat(msg, { onEvent: (json) => {...}, onDone: () => {}, onError: (err) => {...} });
```
NOT `await child.chat(msg)`. Think sub-agent chat is always callback-based.

### 8. `beforeToolCall` block action typed but not yet functional
```typescript
return { action: "block" as const, reason: "..." };
```
CF docs say `block`/`substitute` actions "not yet functional" at runtime. Type is correct. Will work when CF ships it.

### 9. `processFlow()` owns `pendingDelivery` — not bella-agent.ts
The flow controller layer manages delivery state. `bella-agent.ts` only manages the fiber-level timeout layer on top.

### 10. wrangler.toml — no `"experimental"` flag
CF rejected it (code 10021). Only `["nodejs_compat"]` in `compatibility_flags`.

---

## wrangler.toml State

```toml
name = "bella-think-agent-v1-brain"
main = "src/worker.ts"
compatibility_date = "2026-04-24"
compatibility_flags = ["nodejs_compat"]    ← NOT "experimental"
account_id = "9488d0601315a70cac36f9bd87aa4e82"

[durable_objects]
bindings = [{ name = "CALL_BRAIN", class_name = "BellaAgent" }]

[[migrations]]
tag = "v1"
new_sqlite_classes = ["BellaAgent", "ConsultantAgent", "DeepScrapeAgent", "ROIAgent"]

[[migrations]]
tag = "v2"
new_sqlite_classes = ["WowAgent"]

[[kv_namespaces]]
binding = "LEADS_KV"
id = "0fec6982d8644118aba1830afd4a58cb"

# MEMORY binding — COMMENTED OUT, awaiting CF Agent Memory beta access
# [[ai_memory_stores]]
# binding = "MEMORY"
# id = "bella-prospect-memory"
```

---

## Env Secrets Required

| Secret | Worker | Purpose |
|--------|--------|---------|
| `GEMINI_API_KEY` | bella-think-agent-v1-brain | LLM (BellaAgent + WowAgent) |
| `FIRECRAWL_API_KEY` | bella-think-agent-v1-brain | DeepScrapeAgent |
| `APIFY_TOKEN` / `APIFY_API_KEY` | bella-think-agent-v1-brain | DeepScrapeAgent |
| `GOOGLE_PLACES_API_KEY` | bella-think-agent-v1-brain | DeepScrapeAgent |

---

## Source File Map

| File | Role |
|------|------|
| `bella-agent.ts` | Main brain — Think class, all lifecycle hooks, callable endpoints |
| `worker.ts` | CF Worker entry — routing, health, /intel, /debug, /state endpoints |
| `types.ts` | All TypeScript types — ConversationState, IntelStore, WowStepId, etc. |
| `state.ts` | State initialisation, migration, persistence helpers |
| `controller.ts` | `processFlow()` — stage machine, delivery tracking, flow control |
| `moves.ts` | `buildStageDirective()`, `buildCriticalFacts()`, `buildContextNotes()` |
| `flow.ts` | `tryRunCalculator()` and calculator orchestration |
| `flow-constants.ts` | Stage constants, timeout values |
| `extraction/` | `deterministicExtract()` — regex-based field extraction from transcript |
| `consultant-agent.ts` | Sub-agent for business analysis |
| `deep-scrape-agent.ts` | Sub-agent for Apify/Firecrawl scraping |
| `wow-agent.ts` | Sub-agent for WOW line generation via Gemini |
| `roi-agent.ts` | Sub-agent for ROI calculation |
| `precall-workflow.ts` | `BellaPreCallResearch` — pre-call research workflow |
| `index.ts` | OLD V2-rescript brain logic — DO NOT MODIFY, reference only |

---

## Callable Endpoints (bridge calls these)

| Method | Description |
|--------|-------------|
| `initSession(leadId, starterIntel?)` | Start new session, load KV brief, trigger consultant analysis |
| `processBridgeTurn(stream, userText)` | Main turn handler — streaming, wrapped in runFiber |
| `receiveIntel(type, payload, version)` | Intel events from scrape pipeline — version-gated |
| `handleInterrupt()` | Barge-in / abort active turn |
| `onCallEnd()` | End-of-call Agent Memory ingest |
| `getDebugState()` | Debug snapshot — stage, inputs, intel versions, pendingDelivery |
| `getFullState()` | Full ConversationState dump |

---

## Worker HTTP Endpoints (from worker.ts)

| Path | Method | Description |
|------|--------|-------------|
| `/health` | GET | Health check — version + agents list |
| `/intel` | POST | Intel delivery — routes to `receiveIntel()` on CALL_BRAIN DO |
| `/debug/:leadId` | GET | Debug state for a lead |
| `/state/:leadId` | GET | Full state for a lead |
| `/*` (fallback) | * | Routes to CALL_BRAIN DO via `x-call-id` header or `?callId` param |

---

## WOW Lines System

`WowAgent.prepareLines()` generates personalised spoken lines for WOW steps via a single Gemini call.

- Called from `runWowPrep(priority)`:
  - priority=1 after consultant analysis completes
  - priority=2 after deep intel arrives (`deep_ready` event)
- **Priority guard:** `priority > (fresh.wowPrepCommittedPriority ?? 0)` — prevents stale overwrite
- Results stored in `state.wowLines: Partial<Record<WowStepId, string>>`
- WOW steps: `wow_2_reputation_trial`, `wow_3_icp_problem_solution`, `wow_4_conversion_action`, `wow_6_scraped_observation`
- 10s timeout on Gemini call (`AbortSignal.timeout(10_000)`)
- Non-fatal — falls back to template lines if Gemini fails

---

## Delivery Fiber System

Three methods manage silent-prospect timeout:

```typescript
// Called from onChatResponse after LLM completes
async trackDelivery(deliveryId, moveId)
  → void runFiber(`delivery:${deliveryId}`, ctx => {
      ctx.stash({ deliveryId, moveId, status: "pending", issuedAt })
      await setTimeout(30_000)
      // if still pending → mark timeout
    })

// Called from beforeTurn when prospect speaks
async completeDelivery(deliveryId)
  → state.pendingDelivery.status = "completed"

// Called by CF runtime if DO evicted during 30s window
async onFiberRecovered(ctx)
  → if ctx.name.startsWith("delivery:") → mark timeout from snapshot
```

**Important:** `pendingDelivery` in `ConversationState` is ALSO managed by `processFlow()` (flow controller layer). Both layers touch the same field. They're idempotent — both check status before writing.

---

## All Bugs Fixed (16 total)

| # | Bug | Fix |
|---|-----|-----|
| 1 | `getModel()` returned client not LanguageModel | Return `gemini("gemini-2.5-flash")` |
| 2 | `configureSession()` had no context blocks | Added all 4 withContext + withCachedPrompt + compactAfter |
| 3 | `receiveIntel()` called `replaceContextBlock()` (doesn't exist) | Removed, use `refreshSystemPrompt()` |
| 4 | WowAgent missing from wrangler.toml migrations | Added v2 migration block |
| 5 | BellaPreCallResearch missing from health array | Added to worker.ts |
| 6 | `child.chat()` used wrong pattern | Rewrote with `{ onEvent, onDone, onError }` callback |
| 7 | WowPrep race — slow consultant overwrites fast deep result | `priority > (?? 0)` guard |
| 8 | `beforeToolCall` returned `{ deny, allow }` — wrong shape | `{ action: "block" as const }` |
| 9 | `onChatRecovery` not async | Added `async`, returns `Promise<ChatRecoveryOptions>` |
| 10 | `onFiberRecovered` used `ctx.methodName` (doesn't exist) | Changed to `ctx.name` |
| 11 | `trackDelivery` used deprecated `spawnFiber` | Rewrote with `runFiber` + `ctx.stash` |
| 12 | `onDeliveryFiber` used deprecated `stashFiber` | Method deleted, logic moved into runFiber callback |
| 13 | `(this as any).runFiber` — unnecessary cast | Removed cast — public in agents@0.11.5 |
| 14 | `"experimental"` in wrangler.toml compatibility_flags | Removed — CF rejected (code 10021) |
| 15 | `fibers = true` — dead no-op property | Removed — doesn't exist in any installed package |
| 16 | `keepAliveWhile` wrapping `runFiber` — redundant | Removed — runFiber already calls keepAlive() internally |

---

## Open Items

| Item | Priority | Notes |
|------|----------|-------|
| Agent Memory (`MEMORY` binding) | P2 | Commented out in wrangler.toml — awaiting CF beta access. Code is ready in `initSession()` and `onCallEnd()`. |
| `BellaPreCallResearch` end-to-end test | P2 | Wired in worker.ts, not yet tested |
| `beforeToolCall` block action | P3 | Typed correctly but CF docs say not yet functional at runtime. No action needed until CF ships it. |
| `compactAfter(8000)` tuning | P3 | 8000 tokens may be aggressive for short voice turns. Monitor in production. |

---

## CF Think Agent API Quick Reference

```typescript
// Class setup
class BellaAgent extends Think<Env, BellaConfig> {
  chatRecovery = true;  // wraps chat turns in runFiber for crash recovery

  getModel() { return gemini("gemini-2.5-flash"); }
  configureSession(session) { return session.withContext(...).withCachedPrompt().compactAfter(N); }
  getTools(): ToolSet { return { toolName: tool({ inputSchema: z.object({...}), execute: async () => {...} }) }; }
  async beforeTurn(ctx: TurnContext): Promise<TurnConfig | void> {}
  async beforeToolCall(ctx): Promise<ToolCallDecision | void> {}
  async onChunk(ctx) {}
  async onStepFinish(ctx) {}
  async onChatResponse(result: ChatResponseResult) {}
  onChatError(error: unknown): unknown {}
  async onChatRecovery(ctx: ChatRecoveryContext): Promise<ChatRecoveryOptions> {}
  async onFiberRecovered(ctx: FiberRecoveryContext): Promise<void> {}
}

// Fiber API
await this.runFiber(name, async (ctx) => {
  ctx.stash(data);          // synchronous SQLite checkpoint
  // ctx.snapshot = last stash data on recovery
});

// FiberRecoveryContext
ctx.name      // name passed to runFiber()
ctx.snapshot  // last stash data
ctx.id        // fiber row ID

// Sub-agents
const child = await this.subAgent(AgentClass, "instance-name");
await child.chat(msg, { onEvent, onDone, onError });
this.abortSubAgent(AgentClass, "instance-name", "reason");

// ToolCallDecision
{ action: "block" as const, reason?: string }
{ action: "allow" as const, input?: Record<string, unknown> }

// ChatRecoveryOptions
{ persist?: boolean, continue?: boolean }
```

---

## Deploy Command

```bash
cd "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain"
npx wrangler deploy
```

Always bump VERSION in `src/worker.ts` before deploying.

---

## Version History

| Version | What |
|---------|------|
| v3.4.0-think | Sprint 1+2 — 6 foundation patches + WowAgent |
| v3.5.0-think | Sprint 3 — 6 API correctness fixes (package upgrade) |
| v3.6.0-think | Dead code removal (delivery fiber — later reversed) |
| v3.7.0-think | Delivery fiber restored + wired correctly |
| v3.8.0-think | fibers=true removed, keepAliveWhile removed |
