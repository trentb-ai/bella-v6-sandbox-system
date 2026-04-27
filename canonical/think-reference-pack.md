# THINK REFERENCE PACK — Judge Pre-Read
**For:** T3A, T3B | **Load before:** any Think-related review
**SDK versions:** @cloudflare/think@0.4.0 | agents@0.11.5 | ai@6.0.0 | zod@4.0.0
**Codebase:** `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`

---

## §0 HOW TO USE THIS DOC (load: always)

**Two tools, two purposes. Don't confuse them.**

| Need | Tool | Token Cost |
|---|---|---|
| "Does the SDK support X?" | **Grep .d.ts directly** — 3-10 lines | Minimal |
| "Is this an old pattern or a Think pattern?" | **§10 + §11 of this doc** — ~60 lines | Low |

### SDK verification = grep, not this doc

When reviewing code and you need to verify an SDK type, method, or field exists:

```bash
# Check if TurnConfig has 'system' field
grep "system" "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/node_modules/@cloudflare/think/dist/think.d.ts"

# Check if Agent has 'callable' decorator
grep "callable" "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/node_modules/agents/dist/index-Biv6K70p.d.ts"

# Check Session API
grep "refreshSystemPrompt\|freezeSystemPrompt\|setBlock" "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/node_modules/agents/dist/experimental/memory/session/index.d.ts"

# Check ai@6 tool signature
grep "inputSchema\|parameters" "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/node_modules/ai/dist/index.d.ts"
```

**3 lines of grep output > 40 lines of reference doc for SDK questions.**

### Pattern matching = §10 + §11 of this doc

When reviewing code and you need to check "is this an old bridge pattern that shouldn't be in Think?":
- Load §10 (Old→New map) — 16-row table, instant pattern recognition
- Load §11 (Anti-patterns) — 10 items, instant REJECT triggers

### Full §sections = orientation only

Load other sections (§2-§9) only when you're unfamiliar with a Think subsystem and need orientation before reviewing. Once oriented, grep .d.ts for specific claims.

**NEVER issue FAIL based on this doc alone for SDK behavioral claims. Grep the source.**

---

## §1 CLASS HIERARCHY (load for: all reviews)

```
Think<Env, State, Props> extends Agent<Env, State, Props>
  ├─ BellaAgent extends Think<Env, BellaConfig>     ← MAIN brain
  ├─ ConsultantAgent extends Think<Env>              ← sub-agent
  ├─ ROIAgent extends Agent<Env>                     ← @callable sub-agent
  ├─ WowAgent extends Agent<Env>                     ← @callable sub-agent
  └─ DeepScrapeAgent extends Agent<Env>              ← @callable sub-agent
```

**Rule:** Think sub-agents = full chat capability. Agent sub-agents = RPC-only via @callable. Choose based on need.

---

## §2 THINK LIFECYCLE HOOKS (load for: hook/flow reviews)

| Hook | Signature | Fires | Returns |
|------|-----------|-------|---------|
| `getModel()` | `(): LanguageModel` | Once per turn setup | AI SDK model instance |
| `getSystemPrompt()` | `(): string` | Fallback if no context blocks | Static prompt string |
| `getTools()` | `(): ToolSet` | Each turn | `{ name: tool({...}) }` |
| `configureSession(s)` | `(Session): Session` | Once on `onStart` | Chained session |
| `beforeTurn(ctx)` | `(TurnContext): TurnConfig \| void` | Before streamText | Override model/system/tools/activeTools |
| `beforeToolCall(ctx)` | `(ToolCallContext): ToolCallDecision \| void` | Before each tool execute | allow/block/substitute |
| `afterToolCall(ctx)` | `(ToolCallResultContext): void` | After tool outcome | Observational |
| `onStepFinish(ctx)` | `(StepContext): void` | After each step | Observational |
| `onChunk(ctx)` | `(ChunkContext): void` | Per streaming token | Observational — high frequency |
| `onChatResponse(result)` | `(ChatResponseResult): void` | After turn persisted | Post-processing |
| `onChatError(error)` | `(unknown): unknown` | On turn error | Error to surface |
| `onChatRecovery(ctx)` | `(ChatRecoveryContext): ChatRecoveryOptions` | On crash recovery | `{ persist, continue }` |

**Critical:** `chatRecovery = true` enables crash recovery via DO alarms. Default is `false`.

---

## §3 SESSION + PROMPT STRATEGY (load for: prompt/context reviews)

**CRITICAL: provider.get() is ONE-SHOT.** Called once at Session.load(). NOT re-invoked by refreshSystemPrompt(). Provider blocks are READONLY after load — setBlock() throws on them.

### Three-tier prompt strategy:

**Tier 1 — Static provider blocks** (content never changes mid-call):
```typescript
configureSession(session: Session): Session {
  return session
    .withContext("soul", {
      provider: { get: async () => PERSONA_PROMPT },      // static identity
    })
    .withContext("compliance_rules", {
      provider: { get: async () => COMPLIANCE_PROMPT },    // static rules
    })
    .withContext("memory", {
      description: "LLM-writable scratchpad",              // Tier 2: writable
      maxTokens: 2000,
    })
    .withCachedPrompt()
    .compactAfter(8000);
}
```

**Tier 2 — LLM-writable blocks** (model writes via set_context tool):
- `memory` block — prospect facts, commitments, objections
- Has `description` + `maxTokens`, no provider

**Tier 3 — Dynamic content via beforeTurn() override** (changes every turn):
```typescript
beforeTurn(ctx: TurnContext): TurnConfig | void {
  if (ctx.continuation) return; // idempotency guard for chatRecovery
  
  // ... extraction + flow logic ...
  
  const dynamicSystem = [
    ctx.system,                          // frozen blocks (soul, compliance)
    this.buildStageDirectiveContext(),    // current stage
    this.buildIntelContext(),             // latest intel
    this.formatRoiResults(),             // ROI calculations
    this.buildCriticalFacts(),           // captured inputs
  ].filter(Boolean).join('\n\n');
  
  return { system: dynamicSystem };
}
```

**Why not provider blocks for dynamic content?** freezeSystemPrompt() returns cached prompt on turns 2+. Provider.get() never re-fires. refreshSystemPrompt() re-renders from stale block content. beforeTurn() override is the correct Think pattern for per-turn dynamic assembly.

---

## §4 TOOL DEFINITION (load for: tool reviews)

```typescript
// ai@6 tool() — inputSchema takes zod@4 schema directly
import { tool } from "ai";
import { z } from "zod";

getTools() {
  return {
    myTool: tool({
      description: "What it does",
      inputSchema: z.object({ field: z.string() }),
      execute: async ({ field }) => { return result; },
    }),
  };
}
```

**Sub-agent tools via @callable:**
```typescript
// agents@0.11 — decorator on Agent subclass method
import { Agent, callable } from "agents";

export class ROIAgent extends Agent<Env> {
  @callable()
  async calculate(agent: string, inputs: ROIInputs): Promise<AgentROI | null> {
    // deterministic logic, no LLM
  }
}

// Parent spawns + calls:
const roi = await this.subAgent(ROIAgent, "roi-calculator");
const result = await roi.calculate("alex", inputs);
```

---

## §5 WRANGLER CONFIG (load for: deploy/config reviews)

```toml
# Think requires SQLite — ALL DO classes need new_sqlite_classes
[[migrations]]
tag = "v1"
new_sqlite_classes = ["BellaAgent", "ConsultantAgent", "DeepScrapeAgent", "ROIAgent"]

# Only parent DO gets a binding — sub-agents discovered via ctx.exports
[durable_objects]
bindings = [{ name = "CALL_BRAIN", class_name = "BellaAgent" }]

# nodejs_compat required
compatibility_flags = ["nodejs_compat"]
```

---

## §6 MODEL PROVIDER (load for: model/API reviews)

```typescript
// CORRECT — @ai-sdk/google for Gemini
import { createGoogleGenerativeAI } from "@ai-sdk/google";
const google = createGoogleGenerativeAI({ apiKey: this.env.GEMINI_API_KEY });
return google("gemini-2.5-flash");

// WRONG — createOpenAI + Gemini compat URL → 404
import { createOpenAI } from "@ai-sdk/openai";  // ← REJECT THIS
```

---

## §7 STATE MANAGEMENT (load for: state/persistence reviews)

```typescript
// Think state via Agent base class — DO SQLite backed
private get cs(): ConversationState | null {
  return (this.state as ConversationState) ?? null;
}

// Write state
this.setState(updatedState);

// NOT: KV put/get for conversation state
// NOT: manual JSON.parse of KV values
// NOT: bridge_system KV pattern
```

**KV is READ-ONLY for intel** (fast-intel writes, brain reads). All conversation state lives in DO SQLite.

---

## §8 SUB-AGENT SPAWNING (load for: sub-agent reviews)

```typescript
// Think sub-agent (full chat)
const consultant = await this.subAgent(ConsultantAgent, "consultant");
await consultant.chat(userMessage, streamCallback);

// Agent sub-agent (RPC via @callable)
const roi = await this.subAgent(ROIAgent, "roi-calculator");
const result = await roi.calculate("alex", inputs);
```

**Sub-agents share the worker** — discovered via `ctx.exports`. No separate worker needed. No service bindings for sub-agents.

---

## §9 STREAMING (load for: SSE/streaming reviews)

```typescript
// onChunk fires per token — ctx.chunk is discriminated union
onChunk(ctx: ChunkContext) {
  if (ctx.chunk.type === "text-delta") {
    // ctx.chunk.textDelta is the text fragment
  }
}

// Sub-agent streaming via StreamCallback (RPC boundary)
interface StreamCallback {
  onEvent(json: string): void | Promise<void>;  // receives JSON events
  onDone(): void | Promise<void>;
  onError?(error: string): void | Promise<void>;
}

// onEvent receives: {"type":"text-delta","delta":"Hey there!..."}
// onChunk receives raw chunk objects where text-start has textDelta=null
```

---

## §10 OLD→NEW PATTERN MAP (load for: ALL reviews)

| Old Bridge Pattern | Think Pattern | If you see old in Think file → |
|---|---|---|
| `extends DurableObject` | `extends Think<Env>` | REJECT |
| Manual `this.ctx.storage.put/get` for conv state | `this.setState(s)` / `this.state` | REJECT manual storage |
| KV `put` for `script_state`, `conv_memory` | DO SQLite via Think state | REJECT KV for state |
| `buildSystemPrompt()` string concatenation | Static: `getSystemPrompt()` / provider blocks. Dynamic: `beforeTurn()` system override | REJECT manual concat outside beforeTurn |
| Prompt >3K chars assembled per turn | Static blocks + `beforeTurn()` dynamic assembly + `compactAfter()` | REJECT if not using beforeTurn for dynamic |
| Provider blocks for dynamic content (intel, stage, ROI) | `beforeTurn()` returns `{ system: assembled }` | REJECT — provider.get() is one-shot, blocks freeze after load |
| `refreshSystemPrompt()` to update dynamic content | `beforeTurn()` override — fires every turn automatically | REJECT refreshSystemPrompt for dynamic sections |
| `env.BRIDGE.fetch(new Request(...))` for sub-agents | `this.subAgent(Class, "name")` | REJECT service binding for sub-agent |
| `createOpenAI` + Gemini URL | `createGoogleGenerativeAI` from `@ai-sdk/google` | REJECT — causes 404 |
| `ctx.waitUntil` for critical async (extraction, intel) | `runFiber()` for durable execution | REJECT waitUntil for critical paths |
| Manual alarm-based crash recovery | `chatRecovery = true` + `onChatRecovery()` | REJECT manual alarms |
| Regex-based stage advancement | `processFlow()` + dual gates | REJECT inline regex gating |
| `JSON.parse(await KV.get(...))` for state hydration | Think auto-hydrates from SQLite | REJECT KV state hydration |
| Bridge reads `lead:{lid}:fast-intel` every turn | Intel delivered via POST to `/intel` endpoint | REJECT per-turn KV polling |

---

## §11 ANTI-PATTERNS (load for: ALL reviews)

**REJECT on sight in Think files:**

1. **KV for conversation state** — Think uses DO SQLite. KV is intel-read-only.
2. **Manual prompt string assembly outside beforeTurn()** — Static: provider blocks. Dynamic: `beforeTurn()` system override. Provider.get() is one-shot — do NOT use for content that changes mid-call.
3. **`createOpenAI` for Gemini** — Use `@ai-sdk/google`. OpenAI compat = 404.
4. **`new_classes` in wrangler.toml** — Think requires `new_sqlite_classes`.
5. **Service bindings for sub-agents** — Use `this.subAgent(Class, "name")`.
6. **`ctx.waitUntil` for critical async** — Use `runFiber()` for durability.
7. **Bridge-style `onRequest` routing** — Think has lifecycle hooks. Use them.
8. **Manual `alarm()` scheduling** — Think fibers handle durable timers.
9. **Importing from old bridge files** — Port logic, don't import.
10. **`tool({ parameters: z.object(...) })` — ai@6 uses `inputSchema`, not `parameters`**.

---

## §12 CODEX LANE RULES FOR THINK (load for: judge routing)

### PRE-VERDICT SDK VERIFICATION (MANDATORY — inside every Think gate)

Before issuing ANY verdict containing an SDK behavioral claim:
1. **STOP** — do not write PASS or FAIL yet
2. **GREP** actual `.d.ts`/`.js` from `node_modules/` for the type/method in question
3. **SOURCE FOUND** → cite file + line in verdict
4. **SOURCE NOT FOUND** → mark finding as `SDK-UNVERIFIABLE` — **NOT FAIL**
5. `SDK-UNVERIFIABLE` items route to T5 source read → T9 arch review → re-gate with evidence

**A FAIL based on "Codex thinks the SDK doesn't support X" is INVALID.** Codex has no Think training data. Two false FAILs shipped in one session because this rule didn't exist.

| Lane | Use? | Why |
|---|---|---|
| PATCH_REVIEW | YES | Judges coupling, drift, diff quality — SDK-agnostic |
| MERGE_GATE | YES | Evidence chain — SDK-agnostic |
| VERIFICATION | YES | Binary: tsc passes + health responds |
| REGRESSION_SCAN | YES | Adjacent breakage in our modules |
| LOOP_BREAKER | YES | Theory reset — SDK-agnostic |
| Consultant | SKIP for SDK Qs | Codex has no Think training data |
| Architecture Interrogator | SKIP for SDK Qs | Route to T5 .d.ts reads |
| Hypothesis Challenge | SKIP for SDK behavior | Would produce guesses |
| SPEC_STRESS_TEST | OPTIONAL | Logic gaps yes, SDK mismatches no |

**Compiler is king:** `tsc --noEmit = 0` is harder proof than Codex on SDK questions.
**Runtime is proof:** `/fn/initSession` returning correct stage = proof Codex cannot produce.
