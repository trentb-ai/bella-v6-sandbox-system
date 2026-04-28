# BELLA THINK MIGRATION — CHUNKED BUILD PLAN
**Doc ID:** doc-think-migration-build-plan-20260426
**Date:** 2026-04-26 AEST
**Authority:** T9 Architect + Trent Belasco
**Status:** CANONICAL — T2 specs from this, T3a gates every chunk

---

## OVERVIEW

Migrate Bella brain from standard DO to @cloudflare/think v0.4.0. 8 chunks, dependency-ordered. Each chunk is independently deployable and testable. Port logic verbatim from frozen-bella-rescript-v2 — Think handles plumbing.

## DEPENDENCY GRAPH

```
Chunk 0 (scaffold) ──→ Chunk 1 (context blocks) ──→ Chunk 3 (tool gating)
                   ──→ Chunk 2 (state migration)  ──→ Chunk 4 (sub-agents)
                                                   ──→ Chunk 5 (intel delivery)
                                                   ──→ Chunk 6 (extraction)
                                                   ──→ Chunk 7 (compaction + recovery)
```

Chunks 3-7 can run in parallel after Chunks 0-2 land.

---

## CHUNK 0: THINK SCAFFOLD
**Priority:** P0 | **Effort:** Medium | **Risk:** High (foundation)
**Gate:** T3a SPEC_STRESS_TEST (touches class hierarchy + wrangler config)

### What
Convert CallBrainDO from standard DO to Think agent. BellaAgent extends Think<Env>.

### Actions

**0-1: Class conversion**
- `export class BellaAgent extends Think<Env>` replaces `export class CallBrainDO`
- Add `chatRecovery = true` (one line — free crash recovery)
- Add `maxSteps = 10`
- Port `getModel()` → return Gemini 2.0 Flash via `createGoogleGenerativeAI`

**0-2: wrangler.toml update**
- Add `compatibility_flags: ["nodejs_compat", "experimental"]`
- Add migration: `new_sqlite_classes: ["BellaAgent"]`
- Verify existing bindings preserved (LEADS_KV)

**0-3: getSystemPrompt()**
- Extract static portions of current system prompt (persona, compliance rules, voice instructions)
- Return as string from `getSystemPrompt()`
- Dynamic sections (intel, ROI, stage directive) will move to context blocks in Chunk 1

**0-4: Minimal getTools()**
- Port existing `calculateROI` tool definition
- Port existing `calculateQuote` tool definition (from ROI+Quote blueprint)
- Tools available but NOT gated yet (gating = Chunk 3)

**0-5: Preserve /compat-turn endpoint**
- Existing HTTP endpoint for V2 bridge compatibility MUST keep working
- Think handles WebSocket natively — /compat-turn is the bridge adapter
- Verify SSE streaming still works post-conversion

### Verification
- BellaAgent instantiates without errors
- /compat-turn returns SSE stream
- Existing V2 bridge can connect and get responses
- `chatRecovery` active (check DO alarm registration)

### Source Files
- FROM: `brain-v1-rescript/src/index.ts` (CallBrainDO class)
- TO: `brain-v1-rescript/src/bella-agent.ts` (BellaAgent class)
- REF: `~/.claude/skills/think-agent-docs/think-types/think.d.ts`
- REF: `~/.claude/skills/think-agent-docs/think-docs/getting-started.md`

---

## CHUNK 1: SESSION CONTEXT BLOCKS
**Priority:** P0 | **Effort:** Medium | **Risk:** Medium
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 0

### What
Replace manual prompt assembly (buildStageDirective, buildCriticalFacts, buildContextNotes) with Think Session context blocks.

### Actions

**1-1: configureSession() implementation**
```typescript
configureSession(session: Session): Session {
  // Stage directive — changes every stage transition
  session.addWritableContextProvider("stage_directive", {
    get: () => this.formatStageDirective(),
    set: (key, value) => { this.updateStageDirective(key, value); }
  });

  // Intel — updated when fast-intel/deep-intel arrives
  session.addWritableContextProvider("intel", {
    get: () => this.formatIntel(),
    set: (key, value) => { this.updateIntel(key, value); }
  });

  // Live ROI calculations — updated after calculateROI tool runs
  session.addWritableContextProvider("live_roi", {
    get: () => this.formatRoiResults(),
    set: (key, value) => { this.updateRoiResults(key, value); }
  });

  // Critical facts — captured inputs, confirmed data
  session.addWritableContextProvider("critical_facts", {
    get: () => this.formatCriticalFacts(),
    set: (key, value) => { this.updateCriticalFacts(key, value); }
  });

  // Live quote (Chris build)
  session.addWritableContextProvider("live_quote", {
    get: () => this.formatQuoteResults(),
    set: (key, value) => { this.updateQuoteResults(key, value); }
  });

  return session;
}
```

**1-2: Port formatting functions**
- `formatStageDirective()` — port from `buildStageDirective()` in moves.ts verbatim
- `formatIntel()` — port intel formatting from current prompt builder
- `formatRoiResults()` — port from current LIVE ROI section builder
- `formatCriticalFacts()` — port from `buildCriticalFacts()` in moves.ts (6-max rule preserved)
- `formatQuoteResults()` — new, from ROI+Quote blueprint

**1-3: Static context providers**
```typescript
// Read-only providers for static knowledge
session.addContextProvider("compliance_rules", {
  get: () => COMPLIANCE_RULES_TEXT  // static, never changes
});
session.addContextProvider("stage_policies", {
  get: () => STAGE_POLICIES_TEXT   // static policy reference
});
```

**1-4: Delete manual prompt assembly**
- Remove `buildStageDirective()` from moves.ts (replaced by context block)
- Remove `buildCriticalFacts()` from moves.ts (replaced by context block)
- Remove `buildContextNotes()` from moves.ts (replaced by context block)
- Remove manual string concatenation in request handler

**1-5: Guard — never render empty sections**
- Each `get()` returns empty string when no data (T9 decision from architecture doc)
- ~460 tokens max for BOTH ROI + Quote sections populated — within Gemini budget

### Verification
- System prompt contains all context blocks when populated
- Empty sections produce no output (no "LIVE ROI\n" with nothing after)
- Stage transitions update stage_directive block automatically
- Intel arrival updates intel block
- Total prompt size within Gemini budget (~3k chars target)

### Source Files
- FROM: `brain-v1-rescript/src/moves.ts` (buildStageDirective, buildCriticalFacts, buildContextNotes)
- TO: `brain-v1-rescript/src/bella-agent.ts` (configureSession + format functions)
- REF: `~/.claude/skills/think-agent-docs/think-docs/sessions.md` §context-blocks

---

## CHUNK 2: STATE MIGRATION (KV → DO SQLite)
**Priority:** P1 | **Effort:** Medium | **Risk:** High (data migration)
**Gate:** T3a SPEC_STRESS_TEST
**Depends on:** Chunk 0

### What
Move hot-path state from KV round-trips to DO SQLite. Think's built-in DO SQLite persistence replaces manual KV reads/writes for conversation state.

### Actions

**2-1: Identify state that moves to DO SQLite**
- `script_state` (stage, stall count, flags) → DO SQLite
- `conv_memory` (conversation history) → Think Session messages (automatic)
- `captured_inputs` (extracted data) → DO SQLite
- `ConversationState` (~180 fields) → DO SQLite properties on BellaAgent

**2-2: Identify state that STAYS in KV**
- `lead:{lid}:fast-intel` — STAYS in KV (written by fast-intel worker, read by brain)
- `lead:{lid}:deepIntel` — STAYS in KV (written by deep-scrape worker)
- Bridge reads from KV are external data — not brain state

**2-3: ConversationState as class properties**
```typescript
export class BellaAgent extends Think<Env> {
  // Core state — persisted in DO SQLite automatically
  private cs: ConversationState;

  // On DO wake: restore from SQLite
  // On state change: Think handles persistence
}
```

**2-4: Remove KV writes for brain-internal state**
- Remove `ctx.waitUntil(kv.put("lead:{lid}:script_state", ...))` calls
- Remove `ctx.waitUntil(kv.put("lead:{lid}:conv_memory", ...))` calls
- Remove `ctx.waitUntil(kv.put("lead:{lid}:captured_inputs", ...))` calls
- Keep KV reads for external data (fast-intel, deepIntel)

**2-5: Migration path**
- First deploy: read from both KV and SQLite, write to SQLite only
- After soak: remove KV reads for migrated keys
- Existing leads with KV data: one-time migration on first DO wake

### Verification
- State persists across DO evictions (alarm-based recovery)
- No KV round-trips on hot path for brain-internal state
- External data (fast-intel) still read from KV correctly
- Cold start latency improved (SQLite local vs KV network)

### Source Files
- FROM: all KV put/get calls for script_state, conv_memory, captured_inputs
- TO: DO SQLite via Think's built-in persistence
- REF: `~/.claude/skills/think-agent-docs/think-types/think.d.ts` §Session
- REF: CF Durable Objects docs §SQLite

---

## CHUNK 3: LIFECYCLE HOOKS + TOOL GATING
**Priority:** P0 | **Effort:** Low | **Risk:** Low
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 1

### What
Wire beforeTurn() for stage-driven tool gating + model switching. Wire afterToolCall() for extraction capture. Wire onChatResponse() for post-turn gate evaluation.

### Actions

**3-1: beforeTurn() — tool gating**
```typescript
beforeTurn(ctx: TurnContext): TurnConfig {
  const stage = this.cs?.currentStage;
  return {
    activeTools: this.getToolsForStage(stage),
  };
}

private getToolsForStage(stage: string): string[] {
  switch (stage) {
    case 'roi_delivery': return ['calculateROI'];
    case 'quote_delivery': return ['calculateQuote'];
    case 'extraction': return ['extractData', 'confirmData'];
    default: return []; // no tools in WOW, rapport, etc.
  }
}
```

**3-2: beforeToolCall() — validation**
```typescript
beforeToolCall(ctx: ToolCallContext): ToolCallDecision | void {
  // Validate ROI inputs are positive numbers
  if (ctx.toolName === 'calculateROI') {
    if (ctx.args.acv <= 0) return { decision: 'block', reason: 'Invalid ACV' };
  }
  // Log all tool calls
  console.log(`[TOOL_CALL] ${ctx.toolName}`, JSON.stringify(ctx.args));
  return { decision: 'allow' };
}
```

**3-3: afterToolCall() — state capture**
```typescript
afterToolCall(ctx: ToolCallResultContext): void {
  // Capture ROI results into state
  if (ctx.toolName === 'calculateROI') {
    this.cs.calculatorResults = {
      ...(this.cs.calculatorResults ?? {}),
      [ctx.args.agent]: ctx.result
    };
    // Context block auto-updates via get() on next turn
  }
  // Capture quote results
  if (ctx.toolName === 'calculateQuote') {
    this.cs.quoteResults = {
      ...(this.cs.quoteResults ?? {}),
      [ctx.args.jobType]: ctx.result
    };
  }
  console.log(`[TOOL_RESULT] ${ctx.toolName}`, JSON.stringify(ctx.result));
}
```

**3-4: onChatResponse() — gate evaluation + stage advancement**
```typescript
onChatResponse(result): void {
  // Post-turn gate evaluation (port from flow.ts processFlow)
  const eligible = deriveEligibility(this.cs);
  if (eligible && shouldAdvance(this.cs)) {
    const nextStage = getNextStage(this.cs);
    this.cs.currentStage = nextStage;
    console.log(`[ADVANCE] → ${nextStage}`);
    // Context blocks auto-update — stage_directive.get() reads currentStage
  }

  // Post-turn extraction (port from current extraction logic)
  // Move to non-blocking — onChatResponse fires after turn lock released
}
```

### Verification
- ROI tool only callable during roi_delivery stage
- Quote tool only callable during quote_delivery stage
- No tools during WOW/rapport stages
- Tool call validation catches bad inputs
- Stage advancement fires post-turn, not inline
- All tool calls logged with [TOOL_CALL] / [TOOL_RESULT] tags

### Source Files
- FROM: `brain-v1-rescript/src/flow.ts` (processFlow, gate logic)
- FROM: `brain-v1-rescript/src/gate.ts` (deriveEligibility, shouldForceAdvance)
- TO: `brain-v1-rescript/src/bella-agent.ts` (lifecycle hooks)
- REF: `~/.claude/skills/think-agent-docs/think-docs/lifecycle-hooks.md`

---

## CHUNK 4: CHRIS SUB-AGENT
**Priority:** P1 | **Effort:** Medium | **Risk:** Medium
**Gate:** T3a SPEC_STRESS_TEST (new agent class + inter-DO communication)
**Depends on:** Chunk 0, Chunk 1

### What
Convert Chris brain from separate DO worker to Think sub-agent. Chris shares BellaAgent's bindings, gets own session and tools.

### Actions

**4-1: ChrisAgent class**
```typescript
export class ChrisAgent extends Think<Env> {
  chatRecovery = true;
  maxSteps = 10;

  getModel() { return createGoogleGenerativeAI(...)("gemini-2.0-flash"); }

  getSystemPrompt(): string {
    // Chris persona — more technical, hands-on
    // Quote-focused language
    // Port from Chris prompt spec
  }

  getTools(): ToolSet {
    return {
      calculateQuote: tool({ ... }),  // discriminated union, per-industry
      calculateROI: tool({ ... }),    // same as Bella
    };
  }

  beforeTurn(ctx: TurnContext): TurnConfig {
    const stage = this.cs?.currentStage;
    return {
      activeTools: stage === 'quote_delivery'
        ? ['calculateQuote']
        : stage === 'roi_delivery'
        ? ['calculateROI']
        : [],
    };
  }

  configureSession(session: Session): Session {
    // Chris-specific context blocks
    session.addWritableContextProvider("industry_quote", { ... });
    session.addWritableContextProvider("intel", { ... });
    session.compactAfter(50);
    return session;
  }
}
```

**4-2: wrangler.toml — add ChrisAgent to migrations**
```jsonc
"migrations": [
  { "new_sqlite_classes": ["BellaAgent", "ChrisAgent"], "tag": "v2" }
]
```

**4-3: Sub-agent invocation from BellaAgent**
```typescript
// When stage machine routes to Chris demo
async startChrisDemo() {
  const chris = await this.subAgent(ChrisAgent, `chris-${this.cs.leadId}`);

  // Pass intel context
  await chris.saveMessages([{
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text: JSON.stringify({
      type: "intel_context",
      intel: this.cs.intel,
      capturedInputs: this.cs.capturedInputs,
    })}]
  }]);

  // Stream Chris responses back to caller
  await chris.chat(this.cs.lastUserMessage, {
    onEvent: (json) => { /* relay to bridge SSE */ },
    onDone: () => { /* Chris turn complete */ },
    onError: (err) => { console.error('[CHRIS_ERR]', err); }
  });
}
```

**4-4: Delete Chris separate worker**
- Remove Chris worker folder (after soak period)
- Remove Chris worker wrangler.toml
- Remove Chris service binding from other workers
- Chris is now a sub-agent — deployed with BellaAgent

### Verification
- Chris sub-agent instantiates with own session
- Chris receives intel context from parent
- Chris responses stream back via chat() onEvent
- Quote tool works within Chris sub-agent
- No separate Chris worker deployment needed
- chatRecovery covers Chris turns

### Source Files
- FROM: Chris worker folder (separate worker)
- TO: `brain-v1-rescript/src/chris-agent.ts` (ChrisAgent class)
- REF: `~/.claude/skills/think-agent-docs/think-docs/sub-agents.md`

---

## CHUNK 5: INTEL DELIVERY (KILL KV POLLING)
**Priority:** P2 | **Effort:** Medium | **Risk:** Medium
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 2

### What
Replace KV polling for intel with Think's saveMessages() + context blocks. When fast-intel/deep-intel arrives, inject directly into session — no polling.

### Actions

**5-1: Intel reception endpoint**
```typescript
// POST /intel-event — called by fast-intel worker
async handleIntelEvent(request: Request): Promise<Response> {
  const intel = await request.json();

  // Update context block directly
  this.cs.intel = mergeIntel(this.cs.intel, intel);
  // Context block auto-updates — intel.get() reads this.cs.intel

  // Inject system message so model knows intel arrived
  await this.saveMessages([{
    id: crypto.randomUUID(),
    role: "system",
    parts: [{ type: "text", text: `[INTEL_UPDATE] New intel received: ${intel.type}` }]
  }]);

  return new Response("ok");
}
```

**5-2: Update fast-intel to POST to brain DO**
- Fast-intel currently writes to KV key `lead:{lid}:fast-intel`
- ADD: also POST to brain DO at `/intel-event` via service binding
- Keep KV write as fallback (brain reads KV on cold start)

**5-3: Update deep-scrape to POST to brain DO**
- Deep-scrape currently writes to KV key `lead:{lid}:deepIntel`
- ADD: also POST to brain DO at `/intel-event` via service binding
- Keep KV write as fallback

**5-4: Remove KV polling from brain turn handler**
- Remove `kv.get("lead:{lid}:fast-intel")` calls on every turn
- Intel arrives via event POST — already in context block
- Cold start: read KV once on DO wake, then events only

**5-5: continueLastTurn() for mid-turn intel**
- If intel arrives while Bella is speaking, `continueLastTurn()` lets model incorporate new data
- Only if turn is active — check turn lock state

### Verification
- Fast-intel POST → brain DO receives → context block updates → next turn sees intel
- Deep-intel POST → brain DO receives → context block updates → enrichment visible
- No KV reads on hot path after initial cold start
- Mid-turn intel arrival handled gracefully
- KV fallback works for cold starts

### Source Files
- FROM: KV polling in brain turn handler
- FROM: fast-intel KV write (keep + add POST)
- FROM: deep-scrape KV write (keep + add POST)
- TO: `brain-v1-rescript/src/bella-agent.ts` handleIntelEvent()
- REF: `~/.claude/skills/think-agent-docs/think-docs/sub-agents.md` §saveMessages

---

## CHUNK 6: EXTRACTION AS TOOLS
**Priority:** P2 | **Effort:** Low | **Risk:** Low
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 3

### What
Convert manual transcript parsing for data extraction into Think tools. Gemini calls `extractData` when it detects extractable information. afterToolCall() persists results.

### Actions

**6-1: extractData tool**
```typescript
extractData: tool({
  description: "Extract structured data from prospect's statement",
  inputSchema: z.object({
    field: z.enum(["acv", "leads_per_week", "missed_calls", "response_time",
                    "review_count", "old_leads", "ad_spend", "conversion_rate"]),
    value: z.union([z.number(), z.string()]),
    confidence: z.enum(["stated", "inferred", "estimated"]),
    source_utterance: z.string().describe("Exact words the prospect said"),
  }),
  execute: async ({ field, value, confidence, source_utterance }) => {
    // Persist to captured_inputs
    this.cs.capturedInputs = {
      ...(this.cs.capturedInputs ?? {}),
      [field]: { value, confidence, source: source_utterance, ts: Date.now() }
    };
    console.log(`[EXTRACT] ${field}=${value} (${confidence})`);
    return { captured: true, field, value };
  }
})
```

**6-2: confirmData tool**
```typescript
confirmData: tool({
  description: "Confirm a previously extracted data point with the prospect",
  inputSchema: z.object({
    field: z.string(),
    confirmedValue: z.union([z.number(), z.string()]),
  }),
  execute: async ({ field, confirmedValue }) => {
    const existing = this.cs.capturedInputs?.[field];
    if (existing) {
      existing.value = confirmedValue;
      existing.confidence = "stated";  // upgraded from inferred
      console.log(`[CONFIRM] ${field}=${confirmedValue}`);
    }
    return { confirmed: true, field, value: confirmedValue };
  }
})
```

**6-3: Remove manual extraction logic**
- Remove regex-based extraction from current turn handler
- Remove manual transcript parsing
- Gemini calls extractData tool naturally when prospect states numbers
- afterToolCall() (from Chunk 3) handles state persistence

**6-4: Extraction only in extraction stage**
- beforeTurn() gating (from Chunk 3) ensures extractData/confirmData only available during extraction stage
- Prevents premature extraction during WOW/rapport

### Verification
- Gemini calls extractData when prospect states "we get about 50 leads a week"
- Extracted data appears in captured_inputs context block
- confirmData upgrades confidence from "inferred" to "stated"
- [EXTRACT] and [CONFIRM] log tags fire correctly
- Tools only available during extraction stage

### Source Files
- FROM: manual extraction logic in current turn handler
- TO: `brain-v1-rescript/src/bella-agent.ts` getTools() + afterToolCall()
- REF: `~/.claude/skills/think-agent-docs/think-docs/tools.md`

---

## CHUNK 7: SESSION COMPACTION + RECOVERY
**Priority:** P1 | **Effort:** Low | **Risk:** Low
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 1

### What
Enable session compaction for long calls. Verify chatRecovery works end-to-end. Add FTS5 search for conversation recall.

### Actions

**7-1: Compaction configuration**
```typescript
configureSession(session: Session): Session {
  session.compactAfter(50); // summarize after 50 messages
  // Head protection: first 5 messages preserved (context setting)
  // Tail protection: last 10 messages preserved (recent context)
  // ... other context blocks from Chunk 1 ...
  return session;
}
```

**7-2: Verify chatRecovery**
- `chatRecovery = true` set in Chunk 0
- Test: simulate DO eviction mid-turn
- Verify alarm fires and turn resumes from checkpoint
- Verify no duplicate responses

**7-3: FTS5 search (optional)**
```typescript
configureSession(session: Session): Session {
  session.addSearchProvider("conversation", {
    search: async (query) => {
      // FTS5 search over message history
      return this.searchMessages(query);
    }
  });
  return session;
}
```

**7-4: onChatRecovery hook**
```typescript
onChatRecovery(): void {
  console.log('[RECOVERY] DO evicted and recovered — resuming turn');
  // Re-read KV for latest intel (in case events arrived during eviction)
  // Context blocks will auto-populate on next get()
}
```

### Verification
- Long call (50+ turns) doesn't overflow context window
- Compacted messages preserve critical information
- chatRecovery works: eviction → alarm → resume → correct response
- FTS5 search returns relevant messages
- [RECOVERY] log tag fires on eviction recovery

### Source Files
- TO: `brain-v1-rescript/src/bella-agent.ts` configureSession() + onChatRecovery()
- REF: `~/.claude/skills/think-agent-docs/think-docs/sessions.md` §compaction §FTS5
- REF: `~/.claude/skills/think-agent-docs/think-docs/sub-agents.md` §chatRecovery

---

## EXECUTION ORDER + SPRINT SIZING

### Critical Path: Chunk 0 → 1 → 3 (foundation before features)

| Sprint | Chunk | Est. Effort | Dependencies |
|---|---|---|---|
| Sprint 1 | **Chunk 0: Think Scaffold** | 2-3 days | None |
| Sprint 2 | **Chunk 1: Context Blocks** | 2 days | Chunk 0 |
| Sprint 3 | **Chunk 2: State Migration** | 2-3 days | Chunk 0 |
| Sprint 4 | **Chunk 3: Lifecycle Hooks** | 1-2 days | Chunk 1 |
| Sprint 5 | **Chunk 7: Compaction + Recovery** | 1 day | Chunk 1 |
| Sprint 6 | **Chunk 4: Chris Sub-Agent** | 2-3 days | Chunk 0, Chunk 1 |
| Sprint 7 | **Chunk 5: Intel Delivery** | 2-3 days | Chunk 2 |
| Sprint 8 | **Chunk 6: Extraction Tools** | 1-2 days | Chunk 3 |

### Parallel Tracks (after Sprint 3)

**Track A (T4):** Chunk 3 → Chunk 6 (hooks + extraction)
**Track B (T4b or T4):** Chunk 4 (Chris sub-agent)
**Track C (T4):** Chunk 5 (intel delivery — needs fast-intel + deep-scrape changes)

### Gate Requirements

Every chunk goes through: **T2 spec → T3a gate → T4 implement → T2 6-gate → T3a Codex gate → T4 deploy**

Chunk 0 and Chunk 2 get SPEC_STRESS_TEST (high-risk foundation changes).
All others get CODEX_REVIEW_REQUEST (standard gate).

---

## RISK REGISTER

| Risk | Mitigation |
|---|---|
| Think v0.4.0 breaking changes in v0.5 | Pin exact version. Scaffold has clean abstraction boundary. |
| DO SQLite migration loses existing KV state | Dual-read migration period. KV stays as fallback. |
| chatRecovery interferes with /compat-turn SSE | Already identified — /compat-turn may need chatRecovery=false per FAIL-1 analysis |
| Chris sub-agent cold start latency | Sub-agents share parent DO — warm if parent is warm |
| Compaction loses critical context | Head/tail protection. Test with real call transcripts. |
| fast-intel POST to brain DO fails | KV fallback preserved. Brain reads KV on cold start. |

---

## SUCCESS CRITERIA

After all 8 chunks:
1. BellaAgent extends Think — all lifecycle hooks active
2. Zero KV round-trips on hot path for brain state
3. Context blocks replace manual prompt assembly — moves.ts deleted
4. Stage-driven tool gating — wrong-stage calls impossible
5. Chris = sub-agent, not separate worker
6. Intel arrives via event POST, not KV polling
7. Extraction via tools, not regex
8. Session compaction prevents context overflow
9. chatRecovery provides crash resilience
10. All existing V2 bridge compatibility preserved

---

## REFERENCE DOCS

- Think opportunities audit: `BRAIN_DOCS/doc-think-opportunities-audit-t9-20260426.md`
- ROI + Quote blueprint: `BRAIN_DOCS/doc-bella-roi-quote-agent-blueprint-20260426.md`
- Architecture doc: `BRAIN_DOCS/doc-bella-roi-quote-machine-architecture-t9-20260426.md`
- Think Agent docs skill: `~/.claude/skills/think-agent-docs/`
- Canonical context: `canonical/think-migration-mandate.md`
- Frozen brain source: `frozen-bella-rescript-v2-brain/src/`

---

## D1 FILING NOTE

File to D1 (database 2001aba8-d651-41c0-9bd0-8d98866b057c) with key `doc-think-migration-build-plan-20260426`.
