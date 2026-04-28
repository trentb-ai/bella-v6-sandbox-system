# Enterprise Scripting + Observability Sprint — T9 Architecture Spec
## 2026-04-28 | T9 Architect | For: T2 Code Lead

---

## EXECUTIVE SUMMARY

9 requirements → **6 independently deployable sprint chunks**. Each chunk touches bella-agent.ts (hooks/state) and optionally moves.ts, controller.ts, types.ts. Every chunk maps to Think SDK primitives — no raw Workers, no custom frameworks.

**Target file:** `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/src/bella-agent.ts`
**Supporting files:** `moves.ts`, `controller.ts`, `types.ts`, `state.ts`

---

## CURRENT STATE (from source reads)

| Component | Lines | Status |
|-----------|-------|--------|
| STAGE_POLICIES_TEXT | L87-91 | 4 lines, no improv/recovery |
| COMPLIANCE_RULES_TEXT | L81-85 | 4 lines, legal-only |
| beforeTurn() | L350-390 | Flow check + directive injection. No objection detection |
| onChatResponse() | L480-590 | Compliance + fallback extraction. No conformance check |
| onStepFinish() | L455-478 | Token accounting only |
| beforeToolCall() | L416-429 | ROI stage gate + deep scrape guard only |
| afterToolCall() | L431-443 | Performance logging only |
| memory context block | L140-146 | 2000 tokens, writable, BUT model never instructed to write |
| shouldAdvanceWowStep() | controller.ts L126-140 | 7/8 steps auto-advance (only wow_4 gates on confirmation) |
| objectionHandling | types.ts L249 | Field exists in AgentBrief. Zero wired logic in bella-agent |

---

## SPRINT CHUNKS

### CHUNK E1: Rich Stage Policies + Improv Rules
**Requirement:** Items 1, 2 from T2 brief
**Think primitive:** Provider context blocks (static, injected every turn via `withContext`)
**Files:** `bella-agent.ts` (STAGE_POLICIES_TEXT, COMPLIANCE_RULES_TEXT constants)
**Risk:** LOW — additive text, no logic change

**What to build:**

Replace STAGE_POLICIES_TEXT (L87-91) with comprehensive per-stage policy block:
```
STAGE POLICIES

UNIVERSAL IMPROV RULES:
- Prospect controls pace. If they go deep on a topic, stay with them — don't rush to next step
- When prospect deflects or changes subject: acknowledge briefly ("good point"), bridge back with "and actually that connects to..." or "that's exactly why..."
- If prospect asks a question Bella can answer from intel: answer it, then bridge back to current objective
- If prospect asks something Bella cannot answer: "that's a great question — I'll flag that for the team to cover in detail. What I CAN show you right now is..."
- Never say "moving on" or "next up" — transitions must feel organic
- Match prospect energy: if they're excited, match. If they're measured, dial back
- When prospect gives a one-word answer: don't accept it. Probe: "and when you say [word], do you mean [specific A] or more like [specific B]?"

PER-STAGE RULES:
- greeting: One attempt to get first name. If prospect skips, continue — never ask twice
- wow (all steps): 3-stall minimum before advance. "Stall" = prospect responded but didn't engage. Track via quality signal, not just turn count
- wow_4_conversion_action: MUST get CTA confirmation before advancing. This gates the entire ROI
- recommendation: Prospect MUST say yes/ready/let's do it. Silence or "maybe" = not ready. Restate the value
- anchor_acv: If prospect says "I don't know" for deal value: offer range brackets ("is it closer to $500 or $5000?"). Never accept "I don't know" as final answer — it poisons ROI
- channel stages: If prospect says "we don't do that" for a channel: acknowledge, skip, move to next channel. Don't push
- roi_delivery: ONLY after ACV confirmed. Deliver each line item. Pause for reactions. Don't rush the numbers
- close: Only after ROI delivered. If prospect hedges: "totally understand — want me to send this as a summary so you can review it?" Never push

BRING-BACK-ON-TRACK PATTERNS:
- Soft redirect: "that's really interesting — and it actually ties into what I was about to show you..."
- Value bridge: "100% — and that's exactly the kind of thing [Agent Name] handles. Let me show you..."
- Acknowledge + park: "great question. Let me note that down [write to memory]. Right now I want to make sure we cover..."
- Time anchor: "we've got a lot to cover and I want to make sure you see the best bits..."
```

Replace COMPLIANCE_RULES_TEXT (L81-85) with conversation steering rules:
```
COMPLIANCE + CONVERSATION STEERING
- Never make false claims about ROI or agent capabilities — if you don't have the data, say so
- Never pressure or coerce — always low-friction close
- Never record without consent
- If prospect is uncomfortable, offer to end call immediately
- Never criticise the prospect's website, tools, or current approach — maximise what they have
- Never say "actually" (implies they're wrong), "honestly" (implies you were lying before), or "no offence"
- If prospect gets hostile: stay warm. "I hear you. Want me to wrap up, or is there something specific I can address?"
- If prospect is confused: slow down, simplify, ask what specifically is unclear
- If prospect goes silent for >2 turns: "still with me? Want me to go a different direction?"
- Never repeat the same pitch twice — if it didn't land, rephrase or move on
- VOICE PERSPECTIVE: Always "you/your" to the prospect, "they/their" only for THEIR customers
```

**Deploy test:** Canary call — verify new policies appear in system prompt via `/do/{lid}/session-info` (check context blocks).

---

### CHUNK E2: Objection Detection + Recovery Injection in beforeTurn()
**Requirement:** Items 3, 4 from T2 brief
**Think primitive:** `beforeTurn()` → `TurnConfig.system` override. Dynamic system injection based on last user message analysis.
**Files:** `bella-agent.ts` (beforeTurn method + new classifyUserIntent() function)
**Risk:** MEDIUM — modifies system prompt per-turn. Must not break existing directive injection.

**What to build:**

Add `classifyUserIntent(transcript: string): UserIntent` function. Pure string analysis — no LLM call (too slow for beforeTurn). Pattern matching on keywords + sentiment signals:

```typescript
type UserIntent = {
  category: "engaged" | "deflection" | "objection" | "hostile" | "confused" | "off_topic" | "silence";
  confidence: number; // 0-1
  trigger?: string; // the phrase that matched
};

function classifyUserIntent(transcript: string): UserIntent {
  const t = transcript.toLowerCase().trim();
  
  // Silence / minimal response
  if (!t || t.length < 3) return { category: "silence", confidence: 0.9 };
  if (/^(ok|yeah|sure|right|mm|uh huh|yep|cool)$/i.test(t)) 
    return { category: "silence", confidence: 0.7, trigger: t };
  
  // Hostile signals
  if (/not interested|waste of time|stop calling|hang up|piss off|scam/i.test(t))
    return { category: "hostile", confidence: 0.9, trigger: t.match(/not interested|waste of time|stop calling|hang up|piss off|scam/i)?.[0] };
  
  // Objection signals
  if (/too expensive|can't afford|no budget|not right now|maybe later|need to think|talk to my partner|already have|don't need/i.test(t))
    return { category: "objection", confidence: 0.8, trigger: t.match(/too expensive|can't afford|no budget|not right now|maybe later|need to think|talk to my partner|already have|don't need/i)?.[0] };
  
  // Deflection signals
  if (/anyway|but what about|can we talk about|let me ask you|what do you think about/i.test(t))
    return { category: "deflection", confidence: 0.6, trigger: "topic change" };
  
  // Confused signals
  if (/what do you mean|i don't understand|confused|what is that|can you explain|huh\?|what\?/i.test(t))
    return { category: "confused", confidence: 0.8, trigger: "confusion" };
  
  // Off-topic (long response that doesn't address the current objective)
  // This is heuristic — if transcript is long but doesn't contain any expected keywords for current stage
  // Leave this for E2b if needed — keep simple for v1
  
  return { category: "engaged", confidence: 0.5 };
}
```

**In beforeTurn() (after processFlow, before return):**

```typescript
// Existing: lines 371-389
// ADD after line 375 (after watchdog update):

const intent = classifyUserIntent(transcript);
if (intent.category !== "engaged") {
  state.lastIntent = intent; // persist for observability
  
  // Write to memory block so model has context
  // (model reads memory block automatically — we inject the pattern)
  
  let recoveryDirective = "";
  switch (intent.category) {
    case "silence":
      recoveryDirective = `\n[RECOVERY: Prospect gave minimal response. Don't accept one-word answers. Probe deeper: "when you say that, do you mean X or Y?" or rephrase the question with more context.]`;
      break;
    case "hostile":
      recoveryDirective = `\n[RECOVERY: Prospect is resistant (said: "${intent.trigger}"). Stay warm. Offer to wrap up: "I hear you — want me to stop here, or is there something specific I can address?" Do NOT push. If they want to stop, thank them and end gracefully.]`;
      break;
    case "objection":
      recoveryDirective = `\n[RECOVERY: Prospect raised objection (said: "${intent.trigger}"). Acknowledge it: "totally fair." Then reframe with value: address the specific concern, don't generic-pitch. If "too expensive" → point to ROI. If "already have" → "how's that going for you?" If "need to think" → "what specifically would help you decide?"]`;
      break;
    case "confused":
      recoveryDirective = `\n[RECOVERY: Prospect is confused. Slow down. Use simpler language. Ask: "which part should I explain differently?" Don't repeat the same explanation — rephrase.]`;
      break;
    case "deflection":
      recoveryDirective = `\n[RECOVERY: Prospect changed topic. If their topic is answerable from intel, answer briefly then bridge back. If not: "great question — let me note that. Right now I want to make sure you see..." Park and return.]`;
      break;
    case "off_topic":
      recoveryDirective = `\n[RECOVERY: Prospect went off-script. Acknowledge briefly, then bridge: "that's interesting — and actually it connects to what I was about to show you..."]`;
      break;
  }
  
  // Append to system override (existing system + recovery)
  // This goes into TurnConfig.system which beforeTurn already returns
}
```

**Modify the return in beforeTurn()** to append `recoveryDirective` to system:

```typescript
return {
  system: `${ctx.system}\n${buildIntelContext(state)}\n${formatRoiResults(state)}\n${buildStageDirectiveContext(state)}${recoveryDirective}`,
  activeTools: getActiveToolsForStage(state.currentStage, state.currentWowStep),
};
```

**State addition (types.ts):**
```typescript
lastIntent?: { category: string; confidence: number; trigger?: string };
intentHistory?: Array<{ category: string; turn: number; ts: number }>;
```

**Deploy test:** Canary with "not interested" user message → verify [RECOVERY: ...] appears in system prompt via debug endpoint. Verify normal "engaged" turns have no recovery injection.

---

### CHUNK E3: WOW Step Quality Gating
**Requirement:** Item 5 from T2 brief
**Think primitive:** `beforeTurn()` flow check + state tracking. No new Think primitives — pure logic in `controller.ts`.
**Files:** `controller.ts` (shouldAdvanceWowStep), `types.ts` (state fields)
**Risk:** MEDIUM — changes advancement logic. Must not break existing wow_4 gate.

**What to build:**

Currently 7/8 wow steps auto-advance after 1 turn. Add engagement quality signal:

**State additions (types.ts):**
```typescript
wowStepTurns?: Record<string, number>;  // turns spent per wow step
wowStepEngagement?: Record<string, "none" | "minimal" | "engaged" | "deep">;
```

**In processFlow() (controller.ts), after transcript is available:**
```typescript
// Track turns per wow step
if (state.currentStage === "wow" && state.currentWowStep) {
  state.wowStepTurns = state.wowStepTurns ?? {};
  state.wowStepTurns[state.currentWowStep] = (state.wowStepTurns[state.currentWowStep] ?? 0) + 1;
  
  // Classify engagement from last transcript
  state.wowStepEngagement = state.wowStepEngagement ?? {};
  const len = transcript.length;
  if (len < 5) state.wowStepEngagement[state.currentWowStep] = "none";
  else if (len < 20) state.wowStepEngagement[state.currentWowStep] = "minimal";
  else if (len < 80) state.wowStepEngagement[state.currentWowStep] = "engaged";
  else state.wowStepEngagement[state.currentWowStep] = "deep";
}
```

**Replace shouldAdvanceWowStep():**
```typescript
function shouldAdvanceWowStep(step: WowStepId, state: ConversationState): boolean {
  // wow_4 always gates on CTA confirmation — unchanged
  if (step === "wow_4_conversion_action") return state.confirmedCTA !== null;
  
  const turns = state.wowStepTurns?.[step] ?? 0;
  const engagement = state.wowStepEngagement?.[step] ?? "none";
  
  // Deep engagement = advance after 1 turn (they're ready)
  if (engagement === "deep") return true;
  
  // Engaged = advance after 1 turn (confirmed they heard it)
  if (engagement === "engaged") return true;
  
  // Minimal = need at least 2 turns (they barely responded)
  if (engagement === "minimal") return turns >= 2;
  
  // None/silence = need 3 turns (the 3-stall minimum from policy)
  return turns >= 3;
}
```

**Why this works:** Deep/engaged responses = prospect heard and reacted → safe to advance. Minimal/silence = prospect didn't engage → hold and re-engage (recovery injection from E2 will fire). 3-stall ceiling prevents infinite loops.

**Deploy test:** Canary with 3 one-word responses on wow_1 → verify step doesn't advance until turn 3. Canary with detailed response → verify immediate advance.

---

### CHUNK E4: Memory Block Activation
**Requirement:** Item 6 from T2 brief
**Think primitive:** Writable context block (`session.withContext("memory", { writable: true })`). Already configured at L140-146. The model already has `set_context` tool from the writable block.
**Files:** `bella-agent.ts` (configureSession + system prompt), `moves.ts` (directive additions)
**Risk:** LOW — the infrastructure exists. We're just instructing the model to USE it.

**What to build:**

The memory block exists and is writable. Problem: the model is never told to write to it. Fix = add memory instructions to the soul context block.

**Add to buildSoulContext() (bella-agent.ts):**
```
MEMORY SYSTEM:
You have a memory block. Use set_context("memory", content) to store important facts during the conversation. Read it at the start of each turn — it persists across the entire call.

WHAT TO STORE:
- [FACT] Prospect-stated business details: "runs 3 locations", "20 staff", "been in business 12 years"
- [COMMITMENT] Things they agreed to: "wants to see ROI", "interested in trial", "said they'd review proposal"
- [OBJECTION] Concerns raised: "worried about cost", "already has a chatbot", "partner needs to approve"
- [CORRECTION] Things you got wrong that they corrected: "actually it's dental not medical"
- [PREFERENCE] Communication preferences: "prefers email", "busy Mondays", "wants numbers not stories"

FORMAT: One line per fact. Category tag first. Most recent at top.
Example: [FACT] 3 locations across Sydney | [OBJECTION] "we tried AI before and it didn't work" | [COMMITMENT] wants to see Chris demo

WHEN TO READ:
- Before every response, check memory for corrections and commitments
- In recommendation stage: reference their stated problems from memory
- In ROI delivery: use their actual numbers from memory, not defaults
- In close: reference commitments they made earlier

WHEN TO WRITE:
- Every time prospect states a business fact
- Every time prospect raises a concern or objection  
- Every time prospect agrees to something
- Every time you need to correct a prior assumption
```

**Also modify beforeTurn()** to read memory and include in recovery context:
```typescript
// In beforeTurn, after intent classification:
const memoryContent = this.session.getContextBlock("memory");
if (memoryContent && state.lastIntent?.category === "objection") {
  // Check if this objection was already raised
  const priorObjections = memoryContent.match(/\[OBJECTION\].*/g) ?? [];
  if (priorObjections.length > 0) {
    recoveryDirective += `\n[PRIOR OBJECTIONS: ${priorObjections.join("; ")}. Do NOT repeat the same counter. Try a different angle.]`;
  }
}
```

**Deploy test:** Run 5-turn canary. After call, check memory block via `/do/{lid}/session-info` — verify model wrote facts. Verify facts persist across turns.

---

### CHUNK E5: Script Conformance Checking in onChatResponse()
**Requirement:** Items 7, 9 from T2 brief
**Think primitive:** `onChatResponse()` hook. Already fires after every turn. Add conformance check.
**Files:** `bella-agent.ts` (onChatResponse method), `types.ts` (conformance state)
**Risk:** MEDIUM — adds processing to critical path. Must be non-blocking.

**What to build:**

After each turn, check: did Bella actually deliver what the directive told her to say?

**State additions (types.ts):**
```typescript
conformanceLog?: Array<{
  turn: number;
  stage: string;
  wowStep: string | null;
  directiveSpeak: string;  // what she was told to say
  bellaSaid: string;        // what she actually said (first 500 chars)
  delivered: boolean;       // did she cover the key content?
  keyMisses: string[];      // specific phrases/concepts she skipped
  ts: number;
}>;
```

**In onChatResponse() (after existing compliance check, ~L571):**
```typescript
// Script conformance check
const directive = buildStageDirective({
  stage: state.currentStage,
  wowStep: state.currentWowStep,
  intel: state.intel,
  state,
});

if (directive.speak && bellaSaid) {
  const conformance = checkConformance(directive.speak, bellaSaid);
  state.conformanceLog = state.conformanceLog ?? [];
  state.conformanceLog.push({
    turn: state.turnCount,
    stage: state.currentStage,
    wowStep: state.currentWowStep,
    directiveSpeak: directive.speak.substring(0, 300),
    bellaSaid: bellaSaid.substring(0, 500),
    delivered: conformance.delivered,
    keyMisses: conformance.misses,
    ts: Date.now(),
  });
  
  if (!conformance.delivered) {
    console.log(`[CONFORMANCE_MISS] turn=${state.turnCount} stage=${state.currentStage} misses=${conformance.misses.join(",")}`);
  }
}
```

**checkConformance() function** — key-phrase extraction, not exact match:
```typescript
function checkConformance(
  directiveSpeak: string,
  bellaSaid: string
): { delivered: boolean; misses: string[] } {
  // Extract key concepts from directive (not exact words — semantic anchors)
  const misses: string[] = [];
  const said = bellaSaid.toLowerCase();
  
  // Check for named entities (business name, agent names, specific numbers)
  const nameMatches = directiveSpeak.match(/\b(Alex|Chris|Maddie|Sarah|James)\b/gi) ?? [];
  for (const name of nameMatches) {
    if (!said.includes(name.toLowerCase())) misses.push(`agent:${name}`);
  }
  
  // Check for extract fields — if directive says extract: ["confirmedICP"], 
  // Bella should have asked a question
  // (This is heuristic — good enough for v1)
  if (directiveSpeak.includes("confirm") && !said.includes("?")) {
    misses.push("missing_question");
  }
  
  // Check for key value propositions (numbers, ratings, dollar amounts)
  const numbers = directiveSpeak.match(/\d+(\.\d+)?/g) ?? [];
  for (const num of numbers) {
    if (!said.includes(num)) misses.push(`number:${num}`);
  }
  
  return { delivered: misses.length === 0, misses };
}
```

**New DO endpoint: `/conformance`**
```typescript
case "conformance":
  return Response.json({
    entries: state.conformanceLog ?? [],
    totalTurns: state.turnCount,
    conformantTurns: (state.conformanceLog ?? []).filter(c => c.delivered).length,
    missTurns: (state.conformanceLog ?? []).filter(c => !c.delivered).length,
  });
```

**Deploy test:** Run canary. Pull `/do/{lid}/conformance` after call. Verify entries logged per turn with delivered/miss status.

---

### CHUNK E6: Structured Observability + Latency Thresholds
**Requirement:** Item 8 from T2 brief
**Think primitive:** `onStepFinish()` (already has token accounting), `onChatResponse()` (already fires), `afterToolCall()` (already logs perf)
**Files:** `bella-agent.ts` (extend existing hooks), `types.ts` (metrics state)
**Risk:** LOW — additive logging. No logic changes.

**What to build:**

**State additions (types.ts):**
```typescript
turnMetrics?: Array<{
  turn: number;
  startMs: number;
  endMs: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  steps: number;
  toolCalls: string[];
  stage: string;
  wowStep: string | null;
  intent: string;         // from E2 classification
  conformance: boolean;   // from E5 check
}>;

alerts?: Array<{
  type: "latency" | "token_budget" | "tool_error" | "conformance_miss" | "hostile_user" | "stall";
  message: string;
  turn: number;
  ts: number;
}>;
```

**Constants:**
```typescript
const LATENCY_WARN_MS = 8000;    // 8s per turn = warn
const LATENCY_CRIT_MS = 15000;   // 15s per turn = critical
const TOKEN_BUDGET_WARN = 50000; // cumulative input tokens
const STALL_THRESHOLD = 3;       // consecutive silence turns
```

**In beforeTurn() — record start time:**
```typescript
state._turnStartMs = Date.now();
```

**In onChatResponse() — record metrics + fire alerts:**
```typescript
const latencyMs = Date.now() - (state._turnStartMs ?? Date.now());
const lastStep = state.tokenLog?.[state.tokenLog.length - 1];

const metric = {
  turn: state.turnCount,
  startMs: state._turnStartMs ?? Date.now(),
  endMs: Date.now(),
  latencyMs,
  inputTokens: lastStep?.input ?? 0,
  outputTokens: lastStep?.output ?? 0,
  cachedTokens: lastStep?.cached ?? 0,
  steps: state.tokenLog?.length ?? 0,
  toolCalls: state.toolLog?.filter(t => t.ts > (state._turnStartMs ?? 0)).map(t => t.tool) ?? [],
  stage: state.currentStage,
  wowStep: state.currentWowStep,
  intent: state.lastIntent?.category ?? "unknown",
  conformance: state.conformanceLog?.[state.conformanceLog.length - 1]?.delivered ?? true,
};
state.turnMetrics = state.turnMetrics ?? [];
state.turnMetrics.push(metric);

// Alerts
state.alerts = state.alerts ?? [];
if (latencyMs > LATENCY_CRIT_MS) {
  state.alerts.push({ type: "latency", message: `Turn ${state.turnCount} took ${latencyMs}ms (CRITICAL >15s)`, turn: state.turnCount, ts: Date.now() });
  console.error(`[ALERT_LATENCY_CRIT] turn=${state.turnCount} ${latencyMs}ms`);
} else if (latencyMs > LATENCY_WARN_MS) {
  state.alerts.push({ type: "latency", message: `Turn ${state.turnCount} took ${latencyMs}ms (WARN >8s)`, turn: state.turnCount, ts: Date.now() });
  console.warn(`[ALERT_LATENCY_WARN] turn=${state.turnCount} ${latencyMs}ms`);
}

// Cumulative token check
const totalInput = state.turnMetrics.reduce((s, m) => s + m.inputTokens, 0);
if (totalInput > TOKEN_BUDGET_WARN) {
  state.alerts.push({ type: "token_budget", message: `Cumulative input tokens ${totalInput} exceeds budget`, turn: state.turnCount, ts: Date.now() });
}

// Stall detection (consecutive silence)
const recentIntents = state.intentHistory?.slice(-STALL_THRESHOLD) ?? [];
if (recentIntents.length >= STALL_THRESHOLD && recentIntents.every(i => i.category === "silence")) {
  state.alerts.push({ type: "stall", message: `${STALL_THRESHOLD} consecutive silence turns`, turn: state.turnCount, ts: Date.now() });
}

// Hostile user alert
if (state.lastIntent?.category === "hostile") {
  state.alerts.push({ type: "hostile_user", message: `Hostile signal: "${state.lastIntent.trigger}"`, turn: state.turnCount, ts: Date.now() });
}

console.log(`[TURN_METRICS] turn=${state.turnCount} latency=${latencyMs}ms tokens=${metric.inputTokens}/${metric.outputTokens} stage=${state.currentStage} intent=${metric.intent}`);
```

**New DO endpoints:**
```typescript
case "metrics":
  return Response.json({
    turns: state.turnMetrics ?? [],
    avgLatencyMs: avg(state.turnMetrics?.map(m => m.latencyMs) ?? []),
    p95LatencyMs: p95(state.turnMetrics?.map(m => m.latencyMs) ?? []),
    totalInputTokens: sum(state.turnMetrics?.map(m => m.inputTokens) ?? []),
    totalOutputTokens: sum(state.turnMetrics?.map(m => m.outputTokens) ?? []),
  });

case "alerts":
  return Response.json({
    alerts: state.alerts ?? [],
    count: state.alerts?.length ?? 0,
    byType: groupBy(state.alerts ?? [], "type"),
  });
```

**Deploy test:** Run canary. Pull `/do/{lid}/metrics` and `/do/{lid}/alerts`. Verify per-turn latency logged. Intentionally delay a turn (large tool chain) — verify latency alert fires.

---

## SPRINT ORDER + DEPENDENCIES

```
E1 (policies)     — independent, deploy first
E2 (objections)   — depends on E1 (recovery refers to policies)
E3 (wow gating)   — depends on E2 (uses engagement signal)
E4 (memory)       — independent of E2/E3, can parallel with E1
E5 (conformance)  — depends on E1 (needs directive.speak)
E6 (observability) — depends on E2+E5 (reads intent + conformance)
```

**Recommended order:** E1 → E4 (parallel) → E2 → E3 → E5 → E6

**Total new state fields:** ~8 (all optional, backward-compatible via `??` defaults)
**Total new DO endpoints:** 3 (/conformance, /metrics, /alerts)
**Total new functions:** 3 (classifyUserIntent, checkConformance, helpers)
**Lines of change estimate:** ~400 net new lines across all chunks

---

## THINK SDK MAPPING

| Requirement | Think Primitive | Native? |
|-------------|----------------|---------|
| Rich policies | `withContext("stage_policies", { provider })` | YES — existing block, just replace content |
| Objection detection | `beforeTurn()` → `TurnConfig.system` | YES — system override is native |
| Recovery injection | `beforeTurn()` → `TurnConfig.system` | YES — append to system |
| WOW quality gate | `beforeTurn()` flow check | CUSTOM — logic in controller.ts, Think provides the hook |
| Memory utilization | `withContext("memory", { writable: true })` | YES — block exists, model has set_context |
| Conformance check | `onChatResponse()` | YES — hook is native, check logic is custom |
| Structured metrics | `onStepFinish()` + `onChatResponse()` | YES — hooks native, metric aggregation is custom |
| Proactive alerts | `onChatResponse()` threshold checks | CUSTOM — Think provides the hook, alert logic is ours |
| Latency tracking | `onChatResponse()` timing | CUSTOM — simple Date.now() delta |

**No new Think features needed. Everything builds on existing hooks.**

---

## GOTCHAS

1. **beforeTurn() must be fast.** classifyUserIntent() is regex-only — no LLM call. If it takes >50ms, it delays the entire turn. Profile it.
2. **conformanceLog grows unbounded.** Cap at last 50 entries in state. Older entries → workspace file for archival.
3. **Memory block has 2000 token limit.** Model must be instructed to summarize/prune when full. Add instruction: "If memory is getting long, combine related facts and remove outdated ones."
4. **intentHistory vs lastIntent.** Both needed. lastIntent for current turn recovery. intentHistory for stall detection across turns.
5. **State persistence via configure().** Every new field must flow through the configure() → hydrateFromConfig() cycle for hibernation survival. Test with deliberate DO eviction.
6. **wowStepEngagement uses transcript length as proxy.** Not perfect — a long transcript could be off-topic. Good enough for v1. Can upgrade to keyword-match scoring in v2.

---

## NON-GOALS (out of scope for this sprint)

- LLM-based intent classification (too slow for beforeTurn)
- Analytics Engine integration (needs CF binding — separate chunk)
- Real-time dashboard UI (post-sprint)
- A/B testing different policies (post-sprint)
- Automated policy tuning from conformance data (post-sprint)
