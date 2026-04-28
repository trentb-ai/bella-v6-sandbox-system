# BELLA THINK MIGRATION — CHUNKED BUILD PLAN v2
**Doc ID:** doc-think-migration-build-plan-v2-20260426
**Date:** 2026-04-26 AEST
**Authority:** T9 Architect + Trent Belasco
**Status:** CANONICAL — SUPERSEDES v1. T2 specs from this, T3a gates every chunk.
**Supersedes:** doc-think-migration-build-plan-20260426 (v1)

---

## CHANGES FROM v1

1. **Chris sub-agent REMOVED** — Bella-only focus. Chris/other agents decided later.
2. **ROI UPGRADED to full sub-agent** — Trent directive: "overengineered", highly sophisticated, flexible, easy to change. Key value offering across entire product range.
3. **Consultant sub-agent ADDED** — Chunk 8
4. **Compliance sub-agent/tool ADDED** — Chunk 9
5. **R2SkillProvider ADDED** — folded into Chunk 1
6. **onStepFinish() ADDED** — folded into Chunk 3
7. **Workspace tools ADDED** — Chunk 10
8. **Compliance via lifecycle hooks ADDED** — expanded in Chunk 3

---

## OVERVIEW

Migrate Bella brain from standard DO to @cloudflare/think v0.4.0. **11 chunks** (0-10), dependency-ordered. Each independently deployable and testable. Port logic verbatim from frozen-bella-rescript-v2 — Think handles plumbing. Bella-only scope — Chris and other agent personas deferred.

## DEPENDENCY GRAPH

```
Chunk 0 (scaffold) ──→ Chunk 1 (context blocks + R2SkillProvider)
                   │       ──→ Chunk 3 (CONVERSATION INTELLIGENCE ENGINE)
                   │              ──→ Chunk 6 (extraction tools)
                   │              ──→ Chunk 9 (compliance sub-agent)
                   │       ──→ Chunk 7 (compaction + recovery + branching)
                   │
                   ──→ Chunk 2 (state migration)
                   │       ──→ Chunk 5 (intel delivery + consultant-on-event) [also needs Chunk 8]
                   │
                   ──→ Chunk 4 (ROI sub-agent) [depends on Chunk 1]
                   ──→ Chunk 8 (consultant sub-agent class) [depends on Chunk 1, needed by Chunk 5]
                   ──→ Chunk 10 (workspace tools) [depends on Chunk 2]
```

**NOTE:** Chunk 8 (ConsultantAgent class) must land BEFORE Chunk 5 (intel delivery) — Chunk 5 spawns consultant sub-agent on intel-event receipt.

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
- Dynamic sections (intel, ROI, stage directive) move to context blocks in Chunk 1

**0-4: Minimal getTools()**
- Placeholder tool definitions only — ROI tools move to ROI sub-agent in Chunk 4
- Keep extractData/confirmData stubs (implemented in Chunk 6)
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

## CHUNK 1: SESSION CONTEXT BLOCKS + R2 SKILL PROVIDER
**Priority:** P0 | **Effort:** Medium | **Risk:** Medium
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 0

### What
Replace manual prompt assembly (buildStageDirective, buildCriticalFacts, buildContextNotes) with Think Session context blocks. Add R2SkillProvider for dynamic stats-kb loading.

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

  // Live ROI calculations — updated after ROI sub-agent completes
  session.addWritableContextProvider("live_roi", {
    get: () => this.formatRoiResults(),
    set: (key, value) => { this.updateRoiResults(key, value); }
  });

  // Critical facts — captured inputs, confirmed data
  session.addWritableContextProvider("critical_facts", {
    get: () => this.formatCriticalFacts(),
    set: (key, value) => { this.updateCriticalFacts(key, value); }
  });

  // Live quote — updated after ROI sub-agent quote tool runs
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

**1-3: Static context providers (read-only)**
```typescript
session.addContextProvider("compliance_rules", {
  get: () => COMPLIANCE_RULES_TEXT
});
session.addContextProvider("stage_policies", {
  get: () => STAGE_POLICIES_TEXT
});
```

**1-4: R2SkillProvider for dynamic stats-kb**
```typescript
// R2SkillProvider loads knowledge base files from R2 on demand
// Replaces build-time bundled stats-kb/ files
session.addSkillProvider("knowledge_base", new R2SkillProvider({
  bucket: this.env.STATS_KB_BUCKET,  // R2 binding
  prefix: "stats-kb/",
  skills: [
    { name: "alex_knowledge", path: "alex.md" },
    { name: "chris_knowledge", path: "chris.md" },
    { name: "maddie_knowledge", path: "maddie.md" },
    { name: "sarah_knowledge", path: "sarah.md" },
    { name: "james_knowledge", path: "james.md" },
    { name: "roi_formulas", path: "roi-formulas.md" },
    { name: "industry_rates", path: "industry-rates.md" },
  ]
}));
```
- Requires R2 bucket binding in wrangler.toml: `[[r2_buckets]] binding = "STATS_KB_BUCKET" bucket_name = "bella-stats-kb"`
- Upload existing `stats-kb/` files to R2 bucket
- Knowledge base updates = R2 upload, no code deploy needed

**1-5: Delete manual prompt assembly**
- Remove `buildStageDirective()` from moves.ts (replaced by context block)
- Remove `buildCriticalFacts()` from moves.ts (replaced by context block)
- Remove `buildContextNotes()` from moves.ts (replaced by context block)
- Remove manual string concatenation in request handler

**1-6: Guard — never render empty sections**
- Each `get()` returns empty string when no data (T9 decision from architecture doc)
- ~460 tokens max for BOTH ROI + Quote sections populated — within Gemini budget

### Verification
- System prompt contains all context blocks when populated
- Empty sections produce no output
- Stage transitions update stage_directive block automatically
- Intel arrival updates intel block
- R2SkillProvider loads knowledge files on demand
- Total prompt size within Gemini budget (~3k chars target)

### Source Files
- FROM: `brain-v1-rescript/src/moves.ts` (buildStageDirective, buildCriticalFacts, buildContextNotes)
- FROM: `brain-v1-rescript/src/stats-kb/` (existing knowledge base files)
- TO: `brain-v1-rescript/src/bella-agent.ts` (configureSession + format functions)
- REF: `~/.claude/skills/think-agent-docs/think-docs/sessions.md` §context-blocks §R2SkillProvider

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
  private cs: ConversationState;
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

## CHUNK 3: CONVERSATION INTELLIGENCE ENGINE
**Priority:** P0 | **Effort:** High | **Risk:** Medium
**Gate:** T3a SPEC_STRESS_TEST (core conversation logic — touches every turn)
**Depends on:** Chunk 1

### What
Wire ALL five lifecycle hooks into a unified conversation intelligence layer. This is the BRAIN of the system — not just hooks, but the full freestyle/scripted/guided conversation engine, gated data collection, three-beat pattern, and compliance validation. Every turn, Bella's behavior adapts based on stage, missing data, and prospect intent.

### Actions

**3-1: Conversation mode engine — determineMode()**
```typescript
private determineMode(stage: string, missing: string[], intent: string): 'scripted' | 'guided' | 'freestyle' {
  // SCRIPTED: Opening beats, critical delivery stages
  // Must hit exact talking points — no deviation
  if (stage === 'wow' && this.cs.stall < 3) return 'scripted';
  if (stage === 'roi_delivery') return 'scripted';
  if (stage === 'quote_delivery') return 'scripted';

  // GUIDED: Data collection stages — need specific info, flexible HOW
  // Bella needs ACV but can ask naturally, not robotically
  if (missing.length > 0) return 'guided';

  // FREESTYLE: Prospect asking questions, going off-topic, pushing back
  // Bella responds naturally but steers back toward next beat
  if (intent === 'question' || intent === 'objection' || intent === 'tangent') return 'freestyle';

  return 'guided';
}
```

**3-2: Adaptive prompt builder — buildAdaptivePrompt()**
```typescript
private buildAdaptivePrompt(stage: string, mode: string, missing: string[]): string {
  const base = this.getSystemPrompt();  // Static persona

  switch (mode) {
    case 'scripted':
      return `${base}

MODE: SCRIPTED — follow the beat exactly.
CURRENT BEAT: ${this.getCurrentBeat()}
SAY THIS (adapt to natural voice, but hit every point):
${this.getScriptedBeat()}
DO NOT deviate. DO NOT freestyle. Hit the beat.`;

    case 'guided':
      return `${base}

MODE: GUIDED — you need specific information, but ask naturally.
STILL NEED: ${missing.join(', ')}
APPROACH: Work these into natural conversation. Don't interrogate.
If prospect mentions a number, use extractData tool immediately.
GUIDE BACK TO: ${this.getNextBeat()} (after collecting data)
${this.cs.collectionMode === 'direct' ? 'ESCALATION: 3 turns without data. Ask directly but warmly.' : ''}
TONE: Curious, not clinical.`;

    case 'freestyle':
      return `${base}

MODE: FREESTYLE — prospect went off-script. Respond naturally.
WHAT THEY SAID: Use conversation context to respond genuinely.
RULES:
- Answer their question honestly using intel data
- Never say "I don't know" — you have their scrape data
- Never criticize their business
- After responding, STEER BACK toward: ${this.getNextBeat()}
- Maximum 2 freestyle turns before returning to guided mode
STEER PHRASE EXAMPLES: "That's a great point, and actually that connects to something I noticed about your [business aspect]..."
FREESTYLE TURNS USED: ${this.cs.freestyleTurns ?? 0}/2`;
  }
}
```

**3-3: beforeTurn() — full conversation intelligence**
```typescript
beforeTurn(ctx: TurnContext): TurnConfig {
  const stage = this.cs?.currentStage;
  const missingFields = this.getMissingRequiredFields(stage);
  const lastUserIntent = this.classifyLastUtterance(ctx);

  // Determine conversation mode
  const mode = this.determineMode(stage, missingFields, lastUserIntent);

  // Track freestyle turns (max 2 before steer back)
  if (mode === 'freestyle') {
    this.cs.freestyleTurns = (this.cs.freestyleTurns ?? 0) + 1;
    if (this.cs.freestyleTurns > 2) {
      // Force back to guided mode
      this.cs.freestyleTurns = 0;
      console.log('[MODE] Freestyle limit hit — steering back to guided');
    }
  } else {
    this.cs.freestyleTurns = 0;
  }

  console.log(`[MODE] stage=${stage} mode=${mode} missing=${missingFields.join(',')} intent=${lastUserIntent}`);

  return {
    systemPrompt: this.buildAdaptivePrompt(stage, mode, missingFields),
    activeTools: this.getToolsForStage(stage),
  };
}

private getToolsForStage(stage: string): string[] {
  switch (stage) {
    case 'roi_delivery': return ['delegateToRoiAgent'];
    case 'quote_delivery': return ['delegateToRoiAgent'];
    case 'extraction_alex': return ['extractData', 'confirmData'];
    case 'extraction_chris': return ['extractData', 'confirmData'];
    case 'extraction_maddie': return ['extractData', 'confirmData'];
    case 'compliance_check': return ['runComplianceCheck'];
    default: return [];
  }
}
```

**3-4: Required fields per stage — gated data collection**
```typescript
private getRequiredFields(stage: string): string[] {
  switch (stage) {
    case 'extraction_alex': return ['leads_per_week', 'response_time', 'acv'];
    case 'extraction_chris': return ['conversion_rate'];
    case 'extraction_maddie': return ['missed_calls'];
    default: return [];
  }
}

private getMissingRequiredFields(stage: string): string[] {
  const required = this.getRequiredFields(stage);
  const collected = Object.keys(this.cs.capturedInputs ?? {});
  return required.filter(f => !collected.includes(f));
}
```

**3-5: Intent classification — classifyLastUtterance()**
```typescript
private classifyLastUtterance(ctx: TurnContext): string {
  const lastMsg = ctx.lastUserMessage?.toLowerCase() ?? '';

  // Question patterns
  if (lastMsg.includes('?') || lastMsg.startsWith('how') || lastMsg.startsWith('what') ||
      lastMsg.startsWith('why') || lastMsg.startsWith('can you')) return 'question';

  // Objection patterns
  if (lastMsg.includes('but') || lastMsg.includes('not sure') || lastMsg.includes('too expensive') ||
      lastMsg.includes('already have') || lastMsg.includes("don't need")) return 'objection';

  // Number/data patterns (prospect giving us data)
  if (/\d+/.test(lastMsg)) return 'data_statement';

  // Agreement
  if (lastMsg.includes('yes') || lastMsg.includes('sure') || lastMsg.includes('sounds good') ||
      lastMsg.includes('tell me more')) return 'agreement';

  // Short/unclear
  if (lastMsg.split(' ').length < 4) return 'brief';

  return 'statement';
}
```

**3-6: beforeToolCall() — validation + compliance guard**
```typescript
beforeToolCall(ctx: ToolCallContext): ToolCallDecision | void {
  if (ctx.toolName === 'delegateToRoiAgent') {
    if (ctx.args.acv !== undefined && ctx.args.acv <= 0) {
      return { decision: 'block', reason: 'Invalid ACV — must be positive' };
    }
  }

  if (ctx.toolName === 'extractData') {
    if (ctx.args.confidence === 'estimated' && !ctx.args.source_utterance) {
      return { decision: 'block', reason: 'Estimated values require source utterance' };
    }
  }

  console.log(`[TOOL_CALL] ${ctx.toolName}`, JSON.stringify(ctx.args));
  return { decision: 'allow' };
}
```

**3-7: afterToolCall() — state capture + quality validation**
```typescript
afterToolCall(ctx: ToolCallResultContext): void {
  if (ctx.toolName === 'delegateToRoiAgent' && ctx.result?.roiResults) {
    this.cs.calculatorResults = {
      ...(this.cs.calculatorResults ?? {}),
      ...ctx.result.roiResults
    };
  }

  if (ctx.toolName === 'delegateToRoiAgent' && ctx.result?.quoteResults) {
    this.cs.quoteResults = {
      ...(this.cs.quoteResults ?? {}),
      ...ctx.result.quoteResults
    };
  }

  if (ctx.toolName === 'delegateToRoiAgent') {
    const roi = ctx.result;
    if (roi?.weeklyValue > 50000) {
      console.warn(`[COMPLIANCE_WARN] ROI weekly value suspiciously high: ${roi.weeklyValue}`);
    }
  }

  console.log(`[TOOL_RESULT] ${ctx.toolName}`, JSON.stringify(ctx.result));
}
```

**3-8: onChatResponse() — DUAL-GATED advancement (script + data)**

Advancement requires TWO conditions met:
1. **Script gate:** All required beats for this stage have been spoken
2. **Data gate:** All required data fields for this stage have been collected

Even if no data is needed (e.g., WOW stage), Bella must hit her script beats before advancing.

```typescript
onChatResponse(result): void {
  const stage = this.cs?.currentStage;

  // ── GATE 1: Script beats spoken ──
  const requiredBeats = this.getRequiredBeats(stage);
  const spokenBeats = this.cs.beatsSpoken?.[stage] ?? [];
  const unspokenBeats = requiredBeats.filter(b => !spokenBeats.includes(b));

  if (unspokenBeats.length > 0) {
    console.log(`[SCRIPT_GATE_HOLD] Stage ${stage} — unspoken beats: ${unspokenBeats.join(', ')}`);
    return;  // do not advance — script not complete
  }

  // ── GATE 2: Required data collected ──
  const requiredData = this.getRequiredFields(stage);
  const collected = Object.keys(this.cs.capturedInputs ?? {});
  const missingData = requiredData.filter(f => !collected.includes(f));

  if (missingData.length > 0) {
    console.log(`[DATA_GATE_HOLD] Stage ${stage} — missing: ${missingData.join(', ')}`);

    this.cs.guidedTurns = (this.cs.guidedTurns ?? 0) + 1;

    if (this.cs.guidedTurns > 3) {
      console.log('[GATE_ESCALATE] 3 turns without new data — switching to direct ask');
      this.cs.collectionMode = 'direct';
    }
    return;  // do not advance — data incomplete
  }

  // ── BOTH gates passed — evaluate advancement ──
  const eligible = deriveEligibility(this.cs);
  if (eligible && shouldAdvance(this.cs)) {
    const nextStage = getNextStage(this.cs);
    this.cs.currentStage = nextStage;
    this.cs.guidedTurns = 0;
    this.cs.collectionMode = 'natural';
    this.cs.freestyleTurns = 0;
    this.cs.currentBeatIndex = 0;  // reset beat pointer for new stage
    console.log(`[ADVANCE] → ${nextStage} (both gates passed)`);
  }
}

// Beat tracking — marks a beat as spoken after Bella delivers it
private markBeatSpoken(stage: string, beat: string) {
  if (!this.cs.beatsSpoken) this.cs.beatsSpoken = {};
  if (!this.cs.beatsSpoken[stage]) this.cs.beatsSpoken[stage] = [];
  if (!this.cs.beatsSpoken[stage].includes(beat)) {
    this.cs.beatsSpoken[stage].push(beat);
    console.log(`[BEAT_SPOKEN] ${stage}/${beat}`);
  }
}

// Required beats per stage
private getRequiredBeats(stage: string): string[] {
  switch (stage) {
    case 'wow': return ['opening_impression', 'deepen_insight', 'bridge_to_numbers'];
    case 'extraction_alex': return ['introduce_alex', 'explain_value'];
    case 'extraction_chris': return ['introduce_chris', 'explain_conversion'];
    case 'extraction_maddie': return ['introduce_maddie', 'explain_recovery'];
    case 'roi_delivery': return ['present_numbers', 'contextualize'];
    case 'recommendation': return ['summarize_value', 'recommend_package'];
    case 'close': return ['next_steps', 'booking_prompt'];
    default: return [];
  }
}
```

**3-9: onStepFinish() — step-level observability**
```typescript
onStepFinish(ctx: StepContext): void {
  console.log(`[STEP] step=${ctx.stepNumber} toolCalls=${ctx.toolCalls?.length ?? 0}`);

  if (ctx.stepNumber > 5) {
    console.warn(`[STEP_WARN] Agent taking ${ctx.stepNumber} steps — potential loop`);
  }

  if (ctx.toolCalls?.length) {
    const toolNames = ctx.toolCalls.map(tc => tc.name).join(',');
    console.log(`[STEP_TOOLS] ${toolNames}`);
  }
}
```

**3-10: Per-beat prompt delivery (CRITICAL for Deepgram latency)**

**WHY:** Deepgram LLM needs SHORT prompts per turn. If the full 10-stage script lands in the system prompt, Gemini gets a massive prompt → slow TTFB → bad voice latency. Consultant must deliver script ONE BEAT AT A TIME. Context block only contains the CURRENT beat — not the full script.

**HOW IT WORKS:**

Consultant produces a `beatScript` — an ordered array of beats per stage. Stored in DO SQLite (not in prompt). On each turn, only the CURRENT beat is injected into the system prompt via context block.

```typescript
// ConsultantAgent output structure (Chunk 8)
interface ConsultantBeatScript {
  stages: Record<string, StageBeatScript>;
}

interface StageBeatScript {
  beats: Array<{
    id: string;                    // e.g., "opening_impression"
    talkingPoints: string[];       // what Bella must say
    promptGuidance: string;        // short directive for Gemini (~50-100 words max)
    requiredData?: string[];       // data to collect during this beat (optional)
    maxTurns: number;              // max turns for this beat before auto-advance
  }>;
}

// Example for WOW stage:
{
  stages: {
    wow: {
      beats: [
        {
          id: "opening_impression",
          talkingPoints: ["Greet by name", "Reference their business", "Show you know their industry"],
          promptGuidance: "Warm greeting. Use prospect's name and business. Reference one specific thing from their website. Short — 2-3 sentences max.",
          maxTurns: 1,
        },
        {
          id: "deepen_insight",
          talkingPoints: ["Share a specific insight about their business", "Connect to industry trend"],
          promptGuidance: "Share one specific observation from intel data. Connect to how other businesses in their industry are using AI. Ask if that resonates.",
          maxTurns: 2,
        },
        {
          id: "bridge_to_numbers",
          talkingPoints: ["Transition to ROI", "Build curiosity about potential uplift"],
          promptGuidance: "Bridge from insight to numbers. 'Based on what I can see, I think there's real potential here — want me to run some numbers?' Keep it short.",
          maxTurns: 1,
        },
      ]
    }
  }
}
```

**Context block delivers ONLY current beat:**
```typescript
// In configureSession() — the stage_directive provider
session.addWritableContextProvider("stage_directive", {
  get: () => {
    const stage = this.cs?.currentStage;
    const beatIndex = this.cs?.currentBeatIndex ?? 0;
    const beatScript = this.cs?.beatScript?.stages?.[stage];

    if (!beatScript?.beats?.[beatIndex]) return '';

    const beat = beatScript.beats[beatIndex];
    return `CURRENT BEAT: ${beat.id}
TALKING POINTS: ${beat.talkingPoints.join('. ')}
GUIDANCE: ${beat.promptGuidance}
${beat.requiredData?.length ? `COLLECT: ${beat.requiredData.join(', ')}` : ''}`;
  },
  set: (key, value) => { /* update via beat advancement */ }
});
```

**Beat advancement logic:**
```typescript
private getCurrentBeat(): string {
  const stage = this.cs?.currentStage;
  const beatIndex = this.cs?.currentBeatIndex ?? 0;
  return this.cs?.beatScript?.stages?.[stage]?.beats?.[beatIndex]?.id ?? 'unknown';
}

private advanceBeat() {
  const stage = this.cs?.currentStage;
  const beatScript = this.cs?.beatScript?.stages?.[stage];
  const currentIndex = this.cs?.currentBeatIndex ?? 0;

  // Mark current beat as spoken
  this.markBeatSpoken(stage, beatScript?.beats?.[currentIndex]?.id ?? '');

  // Advance to next beat
  if (beatScript && currentIndex < beatScript.beats.length - 1) {
    this.cs.currentBeatIndex = currentIndex + 1;
    this.cs.beatTurns = 0;
    console.log(`[BEAT_ADVANCE] ${stage} → beat ${this.cs.currentBeatIndex}: ${beatScript.beats[this.cs.currentBeatIndex].id}`);
  }
  // If last beat, stage gate will handle advancement
}

// Called in onChatResponse() — auto-advance beat if maxTurns exceeded
private checkBeatMaxTurns() {
  const stage = this.cs?.currentStage;
  const beatIndex = this.cs?.currentBeatIndex ?? 0;
  const beat = this.cs?.beatScript?.stages?.[stage]?.beats?.[beatIndex];

  this.cs.beatTurns = (this.cs.beatTurns ?? 0) + 1;

  if (beat && this.cs.beatTurns >= beat.maxTurns) {
    this.advanceBeat();
  }
}
```

**RESULT:**
- Prompt size stays small: ~100-150 words of beat guidance per turn (not 2000+ words of full script)
- Deepgram TTS latency stays low (short prompt → fast Gemini TTFB)
- Consultant delivers full beat script once → brain walks through one beat at a time
- Beat advancement is automatic (maxTurns) or manual (afterToolCall when data extracted)
- Script gate in onChatResponse() ensures ALL beats spoken before stage advances

**3-11: getNextBeat() and getScriptedBeat()**
```typescript
private getScriptedBeat(): string {
  const stage = this.cs?.currentStage;
  const beatIndex = this.cs?.currentBeatIndex ?? 0;
  const beat = this.cs?.beatScript?.stages?.[stage]?.beats?.[beatIndex];
  return beat?.promptGuidance ?? '';
}

private getNextBeat(): string {
  const stage = this.cs?.currentStage;
  const beatIndex = this.cs?.currentBeatIndex ?? 0;
  const nextBeat = this.cs?.beatScript?.stages?.[stage]?.beats?.[beatIndex + 1];
  if (nextBeat) return nextBeat.id;
  return 'next stage';
}
```

### Verification
- MODE logged every turn: scripted/guided/freestyle with stage and missing fields
- SCRIPTED mode: Bella follows beat exactly during WOW and ROI delivery
- GUIDED mode: Bella asks for missing data naturally, escalates to direct after 3 turns
- FREESTYLE mode: Bella responds naturally, steers back within 2 turns max
- GATE_HOLD prevents advancement with missing required fields
- GATE_ESCALATE fires after 3 guidedTurns
- Intent classification detects questions, objections, tangents, data statements
- Three-beat pattern (opening → deepen → bridge) tracked per stage
- ROI delegation only during roi_delivery stage
- All tool calls validated before execution
- All tool results captured and quality-checked
- Stage advancement fires only when all required data collected
- onStepFinish logs step count, warns on loops
- All hooks logged with structured tags

### Source Files
- FROM: `brain-v1-rescript/src/flow.ts` (processFlow, gate logic)
- FROM: `brain-v1-rescript/src/gate.ts` (deriveEligibility, shouldForceAdvance)
- FROM: `brain-v1-rescript/src/stats-kb/WIRING_RULES.ts` (three-beat pattern)
- TO: `brain-v1-rescript/src/bella-agent.ts` (conversation intelligence engine)
- TO: `brain-v1-rescript/src/conversation-modes.ts` (mode engine, intent classifier, adaptive prompt builder)
- REF: `~/.claude/skills/think-agent-docs/think-docs/lifecycle-hooks.md`

---

## CHUNK 4: ROI + QUOTE SUB-AGENT (SOPHISTICATED)
**Priority:** P0 | **Effort:** High | **Risk:** Medium
**Gate:** T3a SPEC_STRESS_TEST (new agent class, complex tool system, inter-DO comms)
**Depends on:** Chunk 0, Chunk 1

### What
Build a dedicated, highly sophisticated ROI + Quote sub-agent. This is a KEY VALUE OFFERING across the entire Bella product range. Must handle complex quoting formulae, be highly flexible, and easy to change without touching the parent agent.

### Why Sub-Agent (Not Tool)
- ROI/quoting is the CORE PRODUCT DIFFERENTIATOR — it deserves its own agent with full Think capabilities
- Own session = own conversation context for multi-turn ROI discussions
- Own tools = calculateROI, calculateQuote, compareScenarios, adjustAssumptions — full toolset
- Own system prompt = specialized financial reasoning, not generic Bella persona
- Own knowledge base = R2SkillProvider for rate tables, formulas, industry data
- Easy to change = update ROI agent independently without touching Bella
- Easy to extend = new industries, new formulas, new quoting models — just add tools

### Actions

**4-1: RoiAgent class**
```typescript
export class RoiAgent extends Think<Env> {
  chatRecovery = true;
  maxSteps = 15;  // ROI conversations can have more steps (multi-agent calc)

  getModel() {
    return createGoogleGenerativeAI(...)("gemini-2.0-flash");
  }

  getSystemPrompt(): string {
    return `You are a financial calculation specialist within the Bella AI sales platform.
Your role: compute ROI projections and generate industry-specific quotes with precision.

RULES:
- Never hallucinate numbers. Only use deterministic formulas.
- Always show your working via tool calls — never mental math.
- Express all monetary values as words (e.g., "approximately four thousand two hundred dollars per week")
- State confidence level for every calculation.
- If inputs are missing, return what you CAN calculate with stated assumptions.
- Never criticize the prospect's current business metrics.

You have access to canonical ROI formulas (V2, audited) and industry rate tables.
Use them exactly as defined — no modifications to formula constants.`;
  }

  getTools(): ToolSet {
    return {
      // Core ROI calculation — per agent
      calculateAgentROI: tool({
        description: "Calculate weekly revenue uplift for a specific Bella agent",
        inputSchema: z.object({
          agent: z.enum(["Alex", "Chris", "Maddie", "Sarah", "James"]),
          acv: z.number().describe("Average customer value in dollars"),
          leadsPerWeek: z.number().optional(),
          currentResponseTime: z.enum(["under_30s", "under_5min", "5_to_30min", "30min_to_2h", "2_to_24h", "next_day_plus"]).optional(),
          currentConversionRate: z.number().optional(),
          missedCallsPerWeek: z.number().optional(),
          oldLeadsInDatabase: z.number().optional(),
          newCustomersPerWeek: z.number().optional(),
          currentGoogleRating: z.number().optional(),
        }),
        execute: async (inputs) => {
          const result = computeAgentRoi(inputs.agent, inputs);
          return result;
        }
      }),

      // Combined ROI (Alex + Chris + Maddie)
      calculateCombinedROI: tool({
        description: "Calculate combined weekly ROI across core agents (Alex + Chris + Maddie)",
        inputSchema: z.object({
          alexResult: z.any().optional(),
          chrisResult: z.any().optional(),
          maddieResult: z.any().optional(),
        }),
        execute: async (inputs) => {
          return computeCombinedRoi(inputs);
        }
      }),

      // Industry-specific quoting — discriminated union
      calculateQuote: tool({
        description: "Generate a quote for a specific job type based on industry and inputs",
        inputSchema: z.discriminatedUnion("jobType", [
          z.object({
            jobType: z.literal("carpet_installation"),
            roomType: z.enum(["bedroom", "living_room", "hallway", "commercial", "full_home"]),
            squareMetres: z.number().optional(),
            carpetGrade: z.enum(["budget", "mid", "premium", "commercial"]),
            includesUnderlay: z.boolean().default(true),
            includesRemoval: z.boolean().default(false),
          }),
          z.object({
            jobType: z.literal("dental_treatment"),
            treatmentType: z.enum(["crown", "implant", "whitening", "checkup", "extraction", "braces"]),
            patientType: z.enum(["new", "existing"]),
            complexity: z.enum(["standard", "complex"]).optional(),
          }),
          z.object({
            jobType: z.literal("legal_service"),
            matterType: z.enum(["conveyancing", "family", "commercial", "will", "dispute"]),
            complexity: z.enum(["standard", "complex"]),
            estimatedHours: z.number().optional(),
          }),
          z.object({
            jobType: z.literal("trade_service"),
            tradeType: z.string(),
            size: z.union([z.number(), z.string()]).optional(),
            materials: z.array(z.string()).optional(),
            urgency: z.enum(["standard", "urgent"]).optional(),
          }),
        ]),
        execute: async (inputs) => {
          const quote = buildQuote(inputs.jobType, inputs, this.intelContext);
          return quote;
        }
      }),

      // Scenario comparison — prospect asks "what if we got more leads?"
      compareScenarios: tool({
        description: "Compare ROI under different input scenarios",
        inputSchema: z.object({
          baseScenario: z.record(z.unknown()),
          alternativeScenario: z.record(z.unknown()),
          agent: z.enum(["Alex", "Chris", "Maddie", "Sarah", "James"]),
        }),
        execute: async ({ baseScenario, alternativeScenario, agent }) => {
          const base = computeAgentRoi(agent, baseScenario as any);
          const alt = computeAgentRoi(agent, alternativeScenario as any);
          return {
            base,
            alternative: alt,
            delta: {
              weeklyValue: (alt?.weeklyValue ?? 0) - (base?.weeklyValue ?? 0),
              percentChange: base?.weeklyValue
                ? (((alt?.weeklyValue ?? 0) - base.weeklyValue) / base.weeklyValue * 100).toFixed(1) + '%'
                : 'N/A',
            }
          };
        }
      }),

      // Assumption adjustment — prospect challenges a number
      adjustAssumptions: tool({
        description: "Recalculate ROI with adjusted assumptions (e.g., prospect says 'I think our conversion rate is lower')",
        inputSchema: z.object({
          agent: z.enum(["Alex", "Chris", "Maddie", "Sarah", "James"]),
          originalInputs: z.record(z.unknown()),
          adjustments: z.record(z.unknown()).describe("Fields to override"),
          reason: z.string().describe("Why the adjustment is being made"),
        }),
        execute: async ({ agent, originalInputs, adjustments, reason }) => {
          const adjusted = { ...originalInputs, ...adjustments };
          const result = computeAgentRoi(agent, adjusted as any);
          return {
            result,
            adjustmentsMade: adjustments,
            reason,
            confidenceNote: "Recalculated with prospect-stated values — confidence upgraded to HIGH for adjusted fields",
          };
        }
      }),
    };
  }

  // ROI agent gets own knowledge base via R2
  configureSession(session: Session): Session {
    session.addSkillProvider("roi_knowledge", new R2SkillProvider({
      bucket: this.env.STATS_KB_BUCKET,
      prefix: "roi-kb/",
      skills: [
        { name: "roi_formulas_v2", path: "roi-formulas-v2.md" },
        { name: "industry_rate_tables", path: "industry-rates.md" },
        { name: "agent_uplift_research", path: "uplift-research.md" },
      ]
    }));
    session.compactAfter(30);  // ROI conversations compact aggressively
    return session;
  }

  // Stage-driven tool gating within ROI agent
  beforeTurn(ctx: TurnContext): TurnConfig {
    return {
      activeTools: [
        'calculateAgentROI',
        'calculateCombinedROI',
        'calculateQuote',
        'compareScenarios',
        'adjustAssumptions',
      ],
      // All tools always available within ROI agent — it's the specialist
    };
  }

  // Intel context passed from parent
  private intelContext: any = null;

  async receiveIntelContext(intel: any) {
    this.intelContext = intel;
  }
}
```

**4-2: wrangler.toml — add RoiAgent to migrations**
```jsonc
"migrations": [
  { "new_sqlite_classes": ["BellaAgent", "RoiAgent"], "tag": "v2" }
]
```

**4-3: Parent delegation tool in BellaAgent**
```typescript
// In BellaAgent.getTools()
delegateToRoiAgent: tool({
  description: "Delegate ROI calculation or quote generation to the specialist ROI agent",
  inputSchema: z.object({
    task: z.enum(["calculate_roi", "calculate_quote", "compare_scenarios", "adjust_assumptions"]),
    inputs: z.record(z.unknown()),
  }),
  execute: async ({ task, inputs }) => {
    const roi = await this.subAgent(RoiAgent, `roi-${this.cs.leadId}`);

    // Pass intel context
    await roi.saveMessages([{
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: JSON.stringify({
        type: "intel_context",
        intel: this.cs.intel,
        capturedInputs: this.cs.capturedInputs,
        task,
        inputs,
      })}]
    }]);

    let result: any = null;
    await roi.chat(`Execute ${task} with provided inputs`, {
      onEvent: (json) => {
        // Capture structured result
        try {
          const parsed = JSON.parse(json);
          if (parsed.roiResults || parsed.quoteResults) result = parsed;
        } catch {}
      },
      onDone: () => {
        console.log(`[ROI_AGENT] ${task} complete`);
      },
      onError: (err) => {
        console.error(`[ROI_AGENT_ERR] ${task}`, err);
      }
    });

    return result;
  }
})
```

**4-4: ROI formula source (V2 canonical)**
- Port `computeAgentRoi()`, `computeCombinedRoi()` from `frozen-bella-rescript-v2-brain/src/roi.ts` VERBATIM
- Port `buildQuote()` from ROI+Quote blueprint
- Port rate tables from `src/stats-kb/`
- Upload ROI knowledge base to R2 bucket `bella-stats-kb/roi-kb/`

**4-5: QuoteResult schema**
```typescript
interface QuoteResult {
  jobType: string;
  description: string;
  totalEstimate: number;
  breakdown: Array<{ item: string; cost: number }>;
  confidence: 'high' | 'medium' | 'low';
  source: 'rate_table' | 'site_pricing' | 'estimate';
  rateTableVersion: string;
}
```

### Verification
- ROI sub-agent instantiates with own session
- calculateAgentROI produces correct results for all 5 agents (match frozen roi.ts output)
- calculateCombinedROI excludes Sarah + James (by design)
- calculateQuote works for carpet/dental/legal/trade
- compareScenarios shows delta between base and alternative
- adjustAssumptions recalculates with overrides
- R2SkillProvider loads ROI knowledge base
- Parent delegateToRoiAgent tool invokes sub-agent and captures results
- Results populate live_roi and live_quote context blocks
- chatRecovery covers ROI agent turns

### Source Files
- FROM: `frozen-bella-rescript-v2-brain/src/roi.ts` (V2 canonical formulas)
- FROM: `brain-v1-rescript/src/stats-kb/` (knowledge base files)
- FROM: `BRAIN_DOCS/doc-bella-roi-quote-agent-blueprint-20260426.md` (quote architecture)
- TO: `brain-v1-rescript/src/roi-agent.ts` (RoiAgent class)
- TO: `brain-v1-rescript/src/bella-agent.ts` (delegateToRoiAgent tool)
- REF: `~/.claude/skills/think-agent-docs/think-docs/sub-agents.md`

---

## CHUNK 5: INTEL DELIVERY + CONSULTANT-ON-EVENT (KILL KV POLLING)
**Priority:** P2 | **Effort:** Medium | **Risk:** Medium
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 2, Chunk 8 (ConsultantAgent class)

### What
Replace KV polling for intel with Think's saveMessages() + context blocks. **Critical integration:** When raw intel arrives, spawn ConsultantAgent sub-agent to enrich it — all within the brain DO. No external HTTP fetch to consultant worker. Data flows: scraper → brain DO → consultant sub-agent → context blocks → Bella speaks with full intel.

### Actions

**5-1: Intel reception endpoint with consultant sub-agent spawn**
```typescript
async handleIntelEvent(request: Request): Promise<Response> {
  const rawIntel = await request.json();

  // Store raw intel immediately — Bella can start speaking with partial data
  this.cs.intel = mergeIntel(this.cs.intel, rawIntel);

  // Inject system message so model knows intel arrived
  await this.saveMessages([{
    id: crypto.randomUUID(),
    role: "system",
    parts: [{ type: "text", text: `[INTEL_UPDATE] New intel received: ${rawIntel.type}` }]
  }]);

  // Spawn ConsultantAgent to enrich — runs async, doesn't block response
  // Consultant returns scriptFills, routing, conversationHooks
  this.enrichWithConsultant(rawIntel);

  return new Response("ok");
}

private async enrichWithConsultant(rawIntel: any) {
  try {
    const consultant = await this.subAgent(ConsultantAgent, `consultant-${this.cs.leadId}`);

    await consultant.chat(JSON.stringify({
      siteContent: rawIntel.site_content_blob,
      fastIntel: rawIntel,
      leadId: this.cs.leadId,
    }), {
      onEvent: (json) => {
        try {
          const enriched = JSON.parse(json);
          if (enriched.scriptFills) {
            this.cs.consultant = enriched.scriptFills;
            this.cs.routing = enriched.routing;
            this.cs.conversationHooks = enriched.hooks;
            this.cs.quoteInputs = enriched.quoteInputs;
            console.log('[CONSULTANT] Enrichment complete — context blocks updated');
          }
        } catch {}
      },
      onDone: () => { console.log('[CONSULTANT] Sub-agent done'); },
      onError: (err) => { console.error('[CONSULTANT_ERR]', err); }
    });
  } catch (err) {
    console.error('[CONSULTANT_SPAWN_ERR]', err);
    // Fallback: Bella works with raw intel, no consultant enrichment
  }
}
```

**5-2: Update fast-intel to POST to brain DO**
- Fast-intel sends RAW scrape data (not consultant-enriched) to brain DO
- Brain DO handles consultant enrichment internally via sub-agent
- ADD: POST to brain DO at `/intel-event` via service binding
- Keep KV write as fallback

**5-3: Update deep-scrape to POST to brain DO**
- ADD: POST to brain DO at `/intel-event` via service binding
- Keep KV write as fallback
- Deep-intel enriches existing context blocks (google maps, ads, hiring, linkedin)

**5-4: Remove KV polling from brain turn handler**
- Cold start: read KV once on DO wake, then events only
- No per-turn KV reads after initial hydration

**5-5: continueLastTurn() for mid-turn intel**
- If intel arrives while Bella is speaking, `continueLastTurn()` lets model incorporate new data
- Only if turn is active — check turn lock state

**5-6: Data flow diagram (final)**
```
Prospect submits URL
→ Fast-intel scrapes (~10-20s)
→ Fast-intel POSTs raw data to brain DO /intel-event (+ KV fallback)
→ Brain DO stores raw intel in context blocks (Bella can speak immediately)
→ Brain DO spawns ConsultantAgent sub-agent (async)
→ Consultant analyzes: identity, ICP, routing, hooks, quote inputs
→ Consultant returns scriptFills to parent via chat() onEvent
→ Parent updates context blocks: consultant, routing, conversationHooks, quoteInputs
→ Next Bella turn sees full enriched intel — zero polling, zero external fetch

Deep-scrape arrives later (~2min):
→ POSTs to brain DO /intel-event
→ Brain DO merges deep data (google maps, ads, hiring)
→ Context blocks auto-update
→ Bella's next turn incorporates deep intel seamlessly
```

### Verification
- Fast-intel POST → raw intel in context blocks → Bella can speak with partial data
- Consultant sub-agent spawns on intel-event → enriches → context blocks updated
- Deep-intel POST → enrichment visible in next turn
- No KV reads on hot path after cold start
- continueLastTurn() works for mid-turn intel
- KV fallback works for cold starts
- Consultant failure doesn't break Bella — falls back to raw intel

### Source Files
- FROM: KV polling in brain turn handler
- FROM: fast-intel KV write (keep + add POST)
- FROM: deep-scrape KV write (keep + add POST)
- TO: `brain-v1-rescript/src/bella-agent.ts` handleIntelEvent() + enrichWithConsultant()
- REF: `~/.claude/skills/think-agent-docs/think-docs/sub-agents.md` §saveMessages §chat()

---

## CHUNK 6: EXTRACTION AS TOOLS
**Priority:** P2 | **Effort:** Low | **Risk:** Low
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 3

### What
Convert manual transcript parsing for data extraction into Think tools.

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
      existing.confidence = "stated";
      console.log(`[CONFIRM] ${field}=${confirmedValue}`);
    }
    return { confirmed: true, field, value: confirmedValue };
  }
})
```

**6-3: Remove manual extraction logic**
- Remove regex-based extraction
- Gemini calls extractData naturally
- afterToolCall() (Chunk 3) handles persistence

**6-4: Extraction gated to extraction stage**
- beforeTurn() (Chunk 3) gates extractData/confirmData

### Verification
- extractData fires on prospect number statements
- confirmData upgrades confidence
- Tools only available during extraction stage
- [EXTRACT] / [CONFIRM] log tags fire

### Source Files
- FROM: manual extraction logic in turn handler
- TO: `brain-v1-rescript/src/bella-agent.ts` getTools()
- REF: `~/.claude/skills/think-agent-docs/think-docs/tools.md`

---

## CHUNK 7: SESSION COMPACTION + RECOVERY
**Priority:** P1 | **Effort:** Low | **Risk:** Low
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 1

### What
Enable session compaction. Verify chatRecovery end-to-end. Add FTS5 search.

### Actions

**7-1: Compaction configuration**
```typescript
session.compactAfter(50);
```

**7-2: Verify chatRecovery**
- Test: simulate DO eviction mid-turn
- Verify alarm fires and turn resumes
- Verify no duplicate responses

**7-3: FTS5 search**
```typescript
session.addSearchProvider("conversation", {
  search: async (query) => this.searchMessages(query)
});
```

**7-4: onChatRecovery hook**
```typescript
onChatRecovery(): void {
  console.log('[RECOVERY] DO evicted and recovered — resuming turn');
}
```

**7-5: Session branching — Quote A/B + compliance recovery**

Two concrete branching use cases built into Bella:

**Use Case A: Quote A/B Comparison**
When prospect asks to compare two options (e.g., "wool vs synthetic?"), Bella forks the conversation, runs quote tool on both branches, presents side-by-side. No state contamination between scenarios.

```typescript
async compareQuoteOptions(optionA: any, optionB: any) {
  const currentMessageId = this.session.lastMessageId;

  // Fork for option B — original branch gets option A
  const branchB = await this.session.fork(currentMessageId);

  // Run option A on current branch
  const resultA = await this.delegateToRoiAgent('calculate_quote', optionA);

  // Switch to branch B, run option B
  await this.session.switchBranch(branchB.id);
  const resultB = await this.delegateToRoiAgent('calculate_quote', optionB);

  // Switch back to main, present both
  await this.session.switchBranch('main');
  return { optionA: resultA, optionB: resultB };
}
```

**Use Case B: Compliance Recovery (automatic self-correction)**
If ComplianceAgent (Chunk 9) flags a violation on Bella's last response, rewind to pre-violation fork point. Re-run turn with compliance feedback injected. Bad branch preserved for audit trail.

```typescript
// In onChatResponse() — after compliance check
if (complianceResult.violations.length > 0) {
  const lastGoodMessage = this.session.getMessageBefore(violatingMessageId);
  const recoveryBranch = await this.session.fork(lastGoodMessage);

  // Inject compliance feedback into recovery branch
  await this.saveMessages([{
    id: crypto.randomUUID(),
    role: "system",
    parts: [{ type: "text", text: `[COMPLIANCE_RECOVERY] Previous response violated: ${complianceResult.violations.join(', ')}. Respond again without these issues.` }]
  }]);

  // Re-run turn — Bella self-corrects
  await this.continueLastTurn();
  console.log(`[BRANCH_RECOVERY] Forked at ${lastGoodMessage} due to compliance violation`);
}
```

**NOT building (deferred):**
- Multi-agent demo comparison (complexity vs value)
- Stage exploration / rewind (stage machine handles this)

### Verification
- Long calls (50+ turns) don't overflow context
- chatRecovery works: eviction → alarm → resume
- FTS5 returns relevant messages
- [RECOVERY] tag fires on eviction
- Quote A/B fork produces two independent results without state contamination
- Compliance recovery forks at correct message, re-runs without violation
- Bad branches preserved in session history for audit

### Source Files
- TO: `brain-v1-rescript/src/bella-agent.ts` configureSession() + onChatRecovery() + branching methods
- REF: `~/.claude/skills/think-agent-docs/think-docs/sessions.md` §compaction §FTS5 §branching

---

## CHUNK 8: CONSULTANT SUB-AGENT
**Priority:** P2 | **Effort:** Medium | **Risk:** Medium
**Gate:** T3a SPEC_STRESS_TEST
**Depends on:** Chunk 0, Chunk 1

### What
Convert Consultant from separate Worker (called via service binding fetch) to Think sub-agent. Consultant gets own session, tools, and system prompt for prospect analysis.

### Actions

**8-1: ConsultantAgent class**
```typescript
export class ConsultantAgent extends Think<Env> {
  chatRecovery = true;
  maxSteps = 10;

  getModel() { return createGoogleGenerativeAI(...)("gemini-2.0-flash"); }

  getSystemPrompt(): string {
    return `You are a business intelligence consultant within the Bella AI platform.
Your role: analyze scraped website data and produce structured consultantScriptFills
for the sales agent. You extract: business identity, ICP analysis, routing recommendations,
conversation hooks, pain points, and industry-specific quoting inputs.

Never output raw JSON to the user. Use your tools to produce structured output.`;
  }

  getTools(): ToolSet {
    return {
      analyzeWebsite: tool({
        description: "Analyze scraped website data and produce consultant analysis",
        inputSchema: z.object({
          siteContent: z.string(),
          fastIntel: z.record(z.unknown()),
        }),
        execute: async ({ siteContent, fastIntel }) => {
          // Port consultant analysis logic
          return buildConsultantAnalysis(siteContent, fastIntel);
        }
      }),

      buildScriptFills: tool({
        description: "Generate scriptFills for the sales agent based on analysis",
        inputSchema: z.object({
          analysis: z.record(z.unknown()),
        }),
        execute: async ({ analysis }) => {
          return generateScriptFills(analysis);
        }
      }),

      identifyQuoteInputs: tool({
        description: "Identify industry-specific quoting inputs from website analysis",
        inputSchema: z.object({
          industry: z.string(),
          services: z.array(z.string()),
          pricingSignals: z.array(z.string()),
        }),
        execute: async ({ industry, services, pricingSignals }) => {
          return {
            industry_quote_type: industry,
            typical_job_sizes: inferJobSizes(industry, services),
            pricing_signals: pricingSignals,
            service_categories: services,
            quote_confidence: pricingSignals.length > 2 ? 'high' : pricingSignals.length > 0 ? 'medium' : 'low',
          };
        }
      }),
    };
  }
}
```

**8-2: wrangler.toml — add ConsultantAgent to migrations**
```jsonc
"migrations": [
  { "new_sqlite_classes": ["BellaAgent", "RoiAgent", "ConsultantAgent"], "tag": "v3" }
]
```

**8-3: Parent invocation**
```typescript
async runConsultantAnalysis(siteContent: string, fastIntel: any) {
  const consultant = await this.subAgent(ConsultantAgent, `consultant-${this.cs.leadId}`);

  let scriptFills: any = null;
  await consultant.chat(JSON.stringify({ siteContent, fastIntel }), {
    onEvent: (json) => {
      try {
        const parsed = JSON.parse(json);
        if (parsed.scriptFills) scriptFills = parsed.scriptFills;
      } catch {}
    },
    onDone: () => { console.log('[CONSULTANT] Analysis complete'); },
    onError: (err) => { console.error('[CONSULTANT_ERR]', err); }
  });

  if (scriptFills) {
    this.cs.consultant = scriptFills;
    // Context blocks auto-update
  }
}
```

**8-4: Remove service binding fetch to consultant worker**
- After soak: remove `env.CONSULTANT.fetch()` calls
- Consultant is sub-agent — no HTTP serialization

### Verification
- ConsultantAgent produces scriptFills matching current consultant output
- identifyQuoteInputs extracts industry-specific data
- Parent receives structured results via onEvent
- No service binding fetch needed
- chatRecovery covers consultant turns

### Source Files
- FROM: `bella-consultant/worker.js` (current consultant logic)
- TO: `brain-v1-rescript/src/consultant-agent.ts`
- REF: `~/.claude/skills/think-agent-docs/think-docs/sub-agents.md`

---

## CHUNK 9: COMPLIANCE SUB-AGENT
**Priority:** P2 | **Effort:** Medium | **Risk:** Low
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 3

### What
Build dedicated compliance checking sub-agent. Replaces raw Gemini fetch() for compliance scoring with structured Think agent.

### Actions

**9-1: ComplianceAgent class**
```typescript
export class ComplianceAgent extends Think<Env> {
  chatRecovery = false;  // compliance checks are stateless — no recovery needed
  maxSteps = 3;  // compliance is fast — check + score + return

  getModel() { return createGoogleGenerativeAI(...)("gemini-2.0-flash"); }

  getSystemPrompt(): string {
    return `You are a compliance validator for Bella AI voice agent responses.
Score each response on these criteria:
1. Never criticizes prospect's website or business
2. Never cold-call framing (Bella is inbound)
3. Never asks "what does your business do?" (scrape data pre-loaded)
4. Never improvises ROI numbers (only tool-calculated values)
5. Never reads symbols aloud (dollars as "dollars", percentages as "percent")
6. Stays on-stage (doesn't skip ahead or go backward)
7. Natural conversational tone (not scripted/robotic)

Use scoreCompliance tool to produce structured result.`;
  }

  getTools(): ToolSet {
    return {
      scoreCompliance: tool({
        description: "Score a Bella response for compliance violations",
        inputSchema: z.object({
          bellaResponse: z.string(),
          currentStage: z.string(),
          hasIntel: z.boolean(),
          hasCapturedInputs: z.boolean(),
        }),
        execute: async ({ bellaResponse, currentStage, hasIntel, hasCapturedInputs }) => {
          return {
            score: 1.0,  // placeholder — LLM evaluates via system prompt
            violations: [],
            warnings: [],
            stage_appropriate: true,
          };
        }
      }),
    };
  }
}
```

**9-2: wrangler.toml migration**
```jsonc
"migrations": [
  { "new_sqlite_classes": ["BellaAgent", "RoiAgent", "ConsultantAgent", "ComplianceAgent"], "tag": "v4" }
]
```

**9-3: Compliance check tool in BellaAgent**
```typescript
runComplianceCheck: tool({
  description: "Run compliance check on Bella's last response",
  inputSchema: z.object({
    response: z.string(),
    stage: z.string(),
  }),
  execute: async ({ response, stage }) => {
    const compliance = await this.subAgent(ComplianceAgent, `compliance-${this.cs.leadId}`);
    let result: any = null;
    await compliance.chat(JSON.stringify({ response, stage, hasIntel: !!this.cs.intel }), {
      onEvent: (json) => { try { result = JSON.parse(json); } catch {} },
      onDone: () => { console.log('[COMPLIANCE] Check complete'); },
    });
    return result;
  }
})
```

**9-4: Remove raw Gemini fetch for compliance**
- Remove all `fetch()` calls to Gemini for compliance scoring
- Remove manual JSON parse of compliance responses
- Compliance agent handles everything

### Verification
- ComplianceAgent produces structured compliance scores
- Violations detected: website criticism, cold-call framing, improvised numbers
- Compliance tool gated to compliance_check stage via beforeTurn()
- No raw Gemini fetch remaining for compliance

### Source Files
- FROM: raw Gemini fetch compliance logic
- TO: `brain-v1-rescript/src/compliance-agent.ts`
- REF: `~/.claude/skills/think-agent-docs/think-docs/sub-agents.md`

---

## CHUNK 10: WORKSPACE TOOLS (DO SQLite Filesystem)
**Priority:** P3 | **Effort:** Low | **Risk:** Low
**Gate:** T3a CODEX_REVIEW_REQUEST
**Depends on:** Chunk 2

### What
Enable Think's workspace tools — DO SQLite-backed virtual filesystem. Store per-lead documents, generated quotes, compliance reports. Queryable and persistent.

### Actions

**10-1: Enable workspace in wrangler.toml**
- Workspace tools auto-merge into getTools() — no code needed
- Add R2 binding for large file spillover: `WORKSPACE_R2`

**10-2: Configure workspace in BellaAgent**
```typescript
// Workspace is automatically available via createWorkspaceTools()
// Think auto-merges workspace tools into the agent's tool set
// Files stored in DO SQLite, large files spill to R2

// Optional: configure workspace bounds
get workspaceConfig() {
  return {
    maxFileSize: 1024 * 100,  // 100KB per file
    r2Bucket: this.env.WORKSPACE_R2,  // spillover for large files
  };
}
```

**10-3: Use cases**
- Store generated ROI reports per lead (queryable later)
- Store generated quotes per lead
- Store compliance check history
- Store conversation summaries (from compaction)
- Future: store uploaded documents from prospects

### Verification
- Workspace tools appear in agent tool list
- Files persist across DO wake/sleep cycles
- Large files spill to R2
- Files queryable via workspace read tools

### Source Files
- TO: `brain-v1-rescript/src/bella-agent.ts` (workspace config)
- REF: `~/.claude/skills/think-agent-docs/think-types/tools/workspace.d.ts`
- REF: `~/.claude/skills/think-agent-docs/think-docs/tools.md` §workspace

---

## EXECUTION ORDER + SPRINT SIZING

### Critical Path: Chunk 0 → 1 → 3 → 4 (foundation → intelligence → ROI engine)

| Sprint | Chunk | Est. Effort | Dependencies | Gate |
|---|---|---|---|---|
| Sprint 1 | **Chunk 0: Think Scaffold** | 2-3 days | None | SPEC_STRESS_TEST |
| Sprint 2 | **Chunk 1: Context Blocks + R2SkillProvider** | 2-3 days | Chunk 0 | CODEX_REVIEW |
| Sprint 3 | **Chunk 2: State Migration** | 2-3 days | Chunk 0 | SPEC_STRESS_TEST |
| Sprint 4 | **Chunk 3: Conversation Intelligence Engine** | 3-4 days | Chunk 1 | SPEC_STRESS_TEST |
| Sprint 5 | **Chunk 4: ROI Sub-Agent** | 3-4 days | Chunk 0, 1 | SPEC_STRESS_TEST |
| Sprint 6 | **Chunk 8: Consultant Sub-Agent** | 2-3 days | Chunk 0, 1 | SPEC_STRESS_TEST |
| Sprint 7 | **Chunk 5: Intel Delivery + Consultant-on-Event** | 2-3 days | Chunk 2, Chunk 8 | CODEX_REVIEW |
| Sprint 8 | **Chunk 6: Extraction Tools** | 1-2 days | Chunk 3 | CODEX_REVIEW |
| Sprint 9 | **Chunk 7: Compaction + Recovery + Branching** | 1-2 days | Chunk 1 | CODEX_REVIEW |
| Sprint 10 | **Chunk 9: Compliance Sub-Agent** | 2 days | Chunk 3 | CODEX_REVIEW |
| Sprint 11 | **Chunk 10: Workspace Tools** | 1 day | Chunk 2 | CODEX_REVIEW |

### Parallel Tracks (after Sprint 3)

**Track A:** Chunk 3 → Chunk 6 → Chunk 9 (intelligence engine → extraction → compliance)
**Track B:** Chunk 4 (ROI sub-agent — can start after Chunk 1)
**Track C:** Chunk 8 → Chunk 5 (consultant class → intel delivery with consultant-on-event)
**Track D:** Chunk 7 (compaction + branching — after Chunk 1)

### Gate Requirements

Every chunk: **T2 spec → T3a gate → T4 implement → T2 6-gate → T3a Codex gate → T4 deploy**

SPEC_STRESS_TEST gates: Chunk 0, 2, 3, 4, 8 (foundation + intelligence engine + new agent classes)
CODEX_REVIEW gates: Chunk 1, 5, 6, 7, 9, 10

**NOTE:** Chunk 3 upgraded from CODEX_REVIEW to SPEC_STRESS_TEST — it's now the core conversation logic, not just hook wiring.

---

## RISK REGISTER

| Risk | Mitigation |
|---|---|
| Think v0.4.0 breaking changes in v0.5 | Pin exact version. Clean abstraction boundary. |
| DO SQLite migration loses existing KV state | Dual-read migration period. KV stays as fallback. |
| chatRecovery interferes with /compat-turn SSE | /compat-turn may need chatRecovery=false per analysis |
| ROI sub-agent latency (sub-agent cold start) | Sub-agents share parent DO — warm if parent is warm |
| Compaction loses critical context | Head/tail protection. Test with real call transcripts. |
| fast-intel POST to brain DO fails | KV fallback preserved. |
| Multiple DO classes = multiple migration tags | Sequential tag numbering (v1→v2→v3→v4). Test each. |
| R2SkillProvider latency on first load | R2 is edge-local — sub-10ms reads. Cache in session. |

---

## SUCCESS CRITERIA

After all 11 chunks:
1. BellaAgent extends Think — ALL five lifecycle hooks active
2. Zero KV round-trips on hot path for brain state
3. Context blocks replace manual prompt assembly — moves.ts manual concat deleted
4. R2SkillProvider loads knowledge bases dynamically — no deploy for KB updates
5. Stage-driven tool gating — wrong-stage calls impossible
6. **Conversation Intelligence Engine** — adaptive scripted/guided/freestyle mode per turn
7. **Gated stage advancement** — required script beats AND data collection enforced before progression
8. **Per-stage prompt delivery** — consultant provides beat-by-beat script, one stage at a time, not full script dump
9. **Three-beat pattern** (opening → deepen → bridge) tracked and enforced per stage
10. **Freestyle with guardrails** — max 2 freestyle turns, auto-steer back to script
11. **Collection escalation** — natural → guided → direct ask after 3 turns
12. ROI = sophisticated sub-agent with 5 tools (calculateAgentROI, calculateCombinedROI, calculateQuote, compareScenarios, adjustAssumptions)
13. Consultant = sub-agent, spawned on intel-event, enriches raw scrape into per-beat scriptFills
14. Compliance = sub-agent with structured scoring
15. Intel arrives via event POST → consultant sub-agent enriches → context blocks update — zero polling
16. Extraction via tools, not regex
17. Session compaction prevents context overflow
18. FTS5 search over conversation history
19. chatRecovery provides crash resilience with onChatRecovery hook
20. onStepFinish provides step-level observability
21. Workspace filesystem for per-lead document storage
22. Session branching for Quote A/B comparison and compliance self-correction
23. All existing V2 bridge compatibility preserved

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

File to D1 (database 2001aba8-d651-41c0-9bd0-8d98866b057c) with key `doc-think-migration-build-plan-v2-20260426`.
