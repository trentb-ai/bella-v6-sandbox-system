# THINK OPPORTUNITIES AUDIT — BELLA STACK
**Doc ID:** doc-think-opportunities-audit-t9-20260426
**Date:** 2026-04-26 AEST
**Authority:** T9 Architect (Opus), approved by Trent Belasco
**Status:** CANONICAL — filed to D1 + BRAIN_DOCS

---

## PURPOSE

Comprehensive audit of every Think v0.4.0 feature the Bella stack is NOT using but SHOULD be. Current brain is a standard Durable Object with manual everything — Think gives us lifecycle hooks, session management, tool gating, sub-agents, compaction, crash recovery, and context blocks. All battle-tested by Cloudflare. We're hand-rolling every one of these patterns.

---

## 1. SUB-AGENT OPPORTUNITIES

**Current state: ZERO sub-agents used anywhere.**

| Current Pattern | Think Sub-Agent Alternative | Value |
|---|---|---|
| **Chris brain = separate DO worker** with own wrangler.toml, deploy, bindings | `this.subAgent(ChrisAgent, "chris")` — spawns child DO, calls via `chat()` RPC with streaming | Eliminates entire worker. Chris shares BellaAgent's bindings, KV, session state. Deploy once, not twice. |
| **Consultant = separate Worker** called via service binding fetch | `this.subAgent(ConsultantAgent, "consultant")` — structured chat() with onEvent streaming | Consultant becomes Think agent with own tools, system prompt, session. Parent gets structured results via onEvent. No HTTP serialization. |
| **WOW agent / compliance checker** — raw Gemini fetch() for compliance scoring | Sub-agent with specific system prompt + tools for compliance evaluation | Think manages model call, token limits, retry. Parent gets typed result. |
| **ROI delivery** — calculator runs in main agent turn | Dedicated ROI sub-agent with `calculateROI` as its only tool | Isolates ROI conversation loop. Parent resumes after ROI sub-agent completes. Clean stage separation. |

**Why this matters:** Sub-agents share parent DO's durability, get automatic `chatRecovery`, communicate via structured `chat()` RPC — not HTTP fetch + JSON parse. Each sub-agent gets own session, message history, and tool scope.

### Sub-Agent Technical Details

```typescript
// Spawn pattern
const chris = await this.subAgent(ChrisAgent, "chris");
await chris.chat("deliver quote for carpet installation", {
  onEvent(json) { /* stream partial results to parent */ },
  onDone() { /* chris turn complete */ },
  onError(err) { /* handle failure */ }
});

// ChatOptions signature (from think.d.ts)
interface ChatOptions {
  signal?: AbortSignal;
  tools?: ToolSet;
}
```

- chatRecovery wraps ALL four turn paths (WebSocket, auto-continuation, saveMessages, continueLastTurn)
- Sub-agents get own DO instance via `subAgent()` — NOT a new Worker, a child DO
- Parent can pass tools via ChatOptions for task-specific tool injection

---

## 2. SESSION API — COMPLETELY UNUSED

**Current pattern:** Manual KV reads/writes for `script_state`, `conv_memory`, `captured_inputs`. Manual prompt string concatenation in `buildStageDirective()`.

| Feature | What It Does | Current Gap |
|---|---|---|
| **Context blocks** (`WritableContextProvider`) | Key-value sections injected into system prompt automatically. Updated via `session.set("intel", data)`. Always current, never stale. | `moves.ts` manually concatenates 6+ string sections into prompt. Any missed section = silent data loss. Context blocks are declarative — set once, always present. |
| **ContextProvider** (read-only) | Injects static context (ROI formulas, stage policies, compliance rules) into every turn without manual assembly | Currently hardcoded in system prompt string. Changes require full prompt rebuild + deploy. |
| **SkillProvider / R2SkillProvider** | Load knowledge base files from R2 on demand, injected as context when relevant | `stats-kb/` files bundled at build time. Can't update without deploy. R2SkillProvider loads dynamically. |
| **Session compaction** (`session.compactAfter(n)`) | LLM-driven message summarization with head/tail protection when context grows | No compaction anywhere. Long calls accumulate full message history until Gemini context window fills. Then silent truncation. |
| **FTS5 search** (`SearchProvider`) | Full-text search over session message history | Zero search capability. If Bella needs to recall something from turn 3 while on turn 15, buried in raw history. |
| **Session branching/forking** | Create conversation branches for A/B exploration | Not applicable now but free with Think. |

### Context Blocks Replace moves.ts

Instead of ~200 lines of string concatenation:

```typescript
// configureSession() — declare context providers
configureSession(session: Session): Session {
  session.addContextProvider("stage_directive", {
    get: () => this.cs?.currentStageDirective ?? ""
  });
  session.addWritableContextProvider("intel", {
    get: () => formatIntel(this.cs?.intel),
    set: (key, value) => { /* update intel section */ }
  });
  session.addWritableContextProvider("live_roi", {
    get: () => formatRoiResults(this.cs?.calculatorResults),
    set: (key, value) => { /* update ROI results */ }
  });
  session.addWritableContextProvider("critical_facts", {
    get: () => formatCriticalFacts(this.cs?.capturedInputs),
    set: (key, value) => { /* update facts */ }
  });
  return session;
}
```

Think injects them into every turn automatically. No manual prompt assembly. No missed sections.

### Compaction Configuration

```typescript
configureSession(session: Session): Session {
  session.compactAfter(50); // summarize after 50 messages
  // head/tail protection preserves first and last N messages
  return session;
}
```

---

## 3. LIFECYCLE HOOKS — NONE USED

**Current pattern:** All logic in main request handler. No per-turn interception, no tool-level guards.

| Hook | What It Enables | Current Gap |
|---|---|---|
| **beforeTurn()** | Return `TurnConfig` to override model, system prompt, activeTools per turn. Stage-driven tool gating lives here. | Tool availability is static. No per-turn model switching (e.g., cheaper model for simple acknowledgment turns, premium for ROI delivery). |
| **beforeToolCall()** | Intercept any tool call before execution. Return `allow`, `block`, or `substitute` with modified args. | No tool-level guardrails. If Gemini hallucinates tool call with bad args, it executes raw. beforeToolCall can validate, log, or substitute. |
| **afterToolCall()** | Post-execution hook. Log results, update state, trigger side effects. | Tool results disappear into model context. No structured capture of what tools ran, what they returned, or state updates based on results. |
| **onChatResponse()** | Fires after turn completes, turn lock released. | No post-turn processing. Extraction, state persistence, analytics — all happen inline, blocking next turn. |
| **onStepFinish()** | Fires after each model step (tool use + response). | No step-level visibility. Can't track multi-step reasoning or tool chains. |

### Stage Advancement via Hooks

Current: `flow.ts processFlow()` manually checks gate conditions after each turn, does string matching on Bella's response.

Think pattern:
```typescript
afterToolCall(ctx: ToolCallResultContext): void {
  // Check if stage-advancing tool was called
  if (ctx.toolName === 'advanceStage') {
    this.cs.currentStage = ctx.result.nextStage;
    // Context blocks auto-update on next turn
  }
}

onChatResponse(result): void {
  // Post-turn gate evaluation
  const eligible = deriveEligibility(this.cs);
  if (eligible) {
    this.cs.currentStage = getNextStage(this.cs);
    // Update context blocks
    this.session.set("stage_directive", buildDirective(this.cs.currentStage));
  }
}
```

---

## 4. TOOL SYSTEM — PARTIALLY USED, MOSTLY MANUAL

| Think Feature | Current Gap |
|---|---|
| **activeTools in beforeTurn()** | Tools always available. Gemini can call ROI calculator during WOW stage (wrong). beforeTurn returns `activeTools: ['calculateROI']` only during roi_delivery stage. |
| **Tool merge order** (7 layers) | Single flat getTools(). No workspace tools, no MCP tools, no extension tools, no client tools. |
| **Workspace tools** (createWorkspaceTools) | No filesystem. Think gives DO SQLite-backed virtual FS. Could store per-lead documents, generated quotes, compliance reports — queryable, persistent. |
| **MCP tools** (auto-merged) | Not using MCP tool integration. Think auto-merges MCP server tools into agent's tool set. |
| **Extension tools** (ExtensionManager) | No dynamic tool loading. V3 quote architecture needs per-industry tools — extensions solve this natively. |

### beforeTurn Tool Gating

```typescript
beforeTurn(ctx: TurnContext): TurnConfig {
  const stage = this.cs?.currentStage;
  return {
    activeTools: stage === 'roi_delivery'
      ? ['calculateROI']
      : stage === 'quote_delivery'
      ? ['calculateQuote']
      : stage === 'extraction'
      ? ['extractData', 'confirmData']
      : [],
  };
}
```

---

## 5. PROMPT MANAGEMENT — ENTIRELY MANUAL

**Current:** `buildStageDirective()` in `moves.ts` builds massive string. `buildCriticalFacts()` caps at 6 items. `buildContextNotes()` caps at 6 items. All concatenated manually.

**Think replacement:**

- **getSystemPrompt()** — returns base system prompt. Static persona, compliance rules, voice instructions.
- **Context blocks** — dynamic per-turn data (intel, ROI results, stage directive, captured facts) injected automatically.
- **beforeTurn() systemPrompt override** — swap entire system prompt per stage if needed.

Net effect: `moves.ts` shrinks from ~200 lines to ~30 lines of context block updates. Framework handles injection, ordering, and token management.

---

## 6. STATE PERSISTENCE — MANUAL KV vs THINK BUILT-IN

**Current:** Manual KV writes for every state change. `script_state`, `conv_memory`, `captured_inputs` — each separate KV key, manually serialized/deserialized.

**Think:** DO SQLite is persistence layer. Session state, message history, context blocks — all persisted automatically in DO's SQLite database. No KV round-trips on hot path.

**Specific wins:**
- `ConversationState` (~180 fields) currently serialized to KV every turn. In Think, it's DO-local SQLite — zero network latency.
- Message history currently managed manually. Think's Session handles it with automatic compaction.
- State recovery after DO eviction: currently manual. Think's `chatRecovery` wraps turns in `runFiber` + alarm, auto-recovers.

---

## 7. COMPLIANCE / QUALITY CHECKING — RAW FETCH vs TOOL PATTERN

**Current:** Raw `fetch()` to Gemini for compliance scoring. Manual JSON parse of response. No retry, no structured error handling.

**Think alternatives:**
- **Sub-agent** with compliance-specific system prompt and tools — returns structured `ComplianceResult`
- **beforeToolCall()** — intercept outbound tool calls for compliance checks before they execute
- **afterToolCall()** — validate tool results meet quality bar
- **Dedicated compliance tool** in getTools() — Gemini calls it to self-check before responding

---

## 8. INTEL DELIVERY — KV POLLING vs THINK PATTERNS

**Current:** Fast-intel writes to KV. Brain polls KV on each turn. Deep-intel arrives later, brain re-reads KV.

**Think alternatives:**
- **saveMessages()** — programmatic turn injection. When intel arrives, inject it as system message into session. No polling.
- **Context blocks** — `session.set("intel", newIntel)` when event arrives. Next turn automatically sees updated intel.
- **continueLastTurn()** — if intel arrives mid-turn, resume assistant's turn with new context.

Eliminates KV polling pattern entirely for brain-side intel consumption.

---

## 9. TRANSCRIPT / EXTRACTION — MANUAL vs SESSION

**Current:** Bridge manually tracks what Bella said, manually extracts data from utterances, manually manages conversation memory.

**Think:**
- Full message tree in Session — every turn, every tool call, every result, searchable via FTS5
- Extraction becomes a tool: `extractData` tool called by Gemini when it detects extractable information
- afterToolCall() persists extracted data to context blocks automatically
- No manual transcript parsing

---

## 10. ERROR RECOVERY — NONE vs chatRecovery

**Current:** If DO gets evicted mid-turn, turn is lost. No recovery mechanism.

**Think:** `chatRecovery = true` wraps every turn in `runFiber`. If DO evicts, alarm fires, turn resumes from last checkpoint. Free with Think — just set the boolean.

---

## PRIORITY RANKING (T9 RECOMMENDATION)

| Priority | Opportunity | Effort | Impact |
|---|---|---|---|
| **P0** | Session context blocks replace manual prompt assembly | Medium | Eliminates entire class of "missing data in prompt" bugs |
| **P0** | beforeTurn() for stage-driven tool gating | Low | Prevents wrong-stage tool calls immediately |
| **P0** | chatRecovery = true | One line | Free crash recovery |
| **P1** | Chris as sub-agent (not separate worker) | Medium | Eliminates worker, shared state, single deploy |
| **P1** | Session compaction | Low | Prevents context window overflow on long calls |
| **P1** | DO SQLite state instead of KV round-trips | Medium | Eliminates hot-path network latency |
| **P2** | Consultant as sub-agent | Medium | Structured results, shared durability |
| **P2** | afterToolCall() for extraction + state updates | Low | Clean separation of concerns |
| **P2** | saveMessages() for intel delivery (kill KV polling) | Medium | Eliminates polling, real-time intel |
| **P3** | FTS5 search over conversation history | Low | Nice-to-have for long calls |
| **P3** | Extension tools for dynamic quoting | High | V3 architecture — not now |
| **P3** | Workspace filesystem for per-lead docs | Low | Future value |

---

## BOTTOM LINE

Current brain = standard DO with manual everything. Think gives lifecycle hooks, session management, tool gating, sub-agents, compaction, crash recovery, context blocks. Migration path: BellaAgent extends Think, port stage machine into beforeTurn() + context blocks, ROI/quote become gated tools, Chris becomes sub-agent, KV state moves to DO SQLite. Frozen-bella-rescript-v2 patterns stay as logic source — framework handles plumbing.

---

## D1 FILING NOTE

File to D1 (database 2001aba8-d651-41c0-9bd0-8d98866b057c) with key `doc-think-opportunities-audit-t9-20260426`.
