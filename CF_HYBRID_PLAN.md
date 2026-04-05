# CLOUDFLARE HYBRID VOICE ARCHITECTURE — Strategic Plan
### Date: 2026-04-05 | Baseline: Bella Golden v1 (git tag: bella-golden-v1, v6.16.1)
### Goal: Cut voice latency 400-600ms and add edge-native intelligence + durable compliance
### Principle: Staged rollout (7 weeks), leverage CF Realtime API + Workers AI, maintain Gemini as fallback

---

## EXECUTIVE SUMMARY

**Current bottleneck:** Bridge worker → Gemini TTFB (2-4s cold, 1.2-1.8s warm), then SSE to TTS creates cascading delay.

**Hybrid solution:** 
- Phase 0 (IMMEDIATE): Lock TurnPlan contract (brain→bridge formal interface)
- Phase 1 (Week 1-2): Add CF Realtime Agent for low-latency first response + edge inference
- Phase 2 (Week 2-3): Bounded prompt system (1.5k token limit, fact prioritization)
- Phase 3 (Week 3-4): Durable extraction pipeline (Workflows + scheduled D1 writes)
- Phase 4 (Week 4-6): Compliance sidecar (cached audit logs, multi-decision replay)
- Phase 5 (Week 6-7): Dialogue tuning + A/B test bounded vs mega prompt

**Expected outcomes:**
- Latency: p99 <800ms edge-to-speech (vs current 2-3s)
- Operational cost: $68/mo → $97/mo (+$29, −29% latency)
- Compliance: 100% audit trail, zero silent drops, SLA-ready logging
- Quality: Natural, low-latency response even on cold starts

---

## THE PROBLEM

### Root Cause Chain
1. **Gemini stream latency** (cold: 4-6s, warm: 1.2-2s)
   - Network round-trip to googleapis.com (200-400ms)
   - Model startup time (varies by load)
   - Streaming chunk arrival (250ms chunks with 1-2s TTFB)

2. **Bridge worker on critical path**
   - Every turn: read KV → build prompt → POST to Gemini → SSE back to agent
   - Serialized (no parallelism)
   - No fallback for slow Gemini — must wait full stream

3. **Mega prompt (3-4k tokens)**
   - Full intel envelope (fast + consultant + deep scrape)
   - All 8 stage directives (context bloat)
   - Full conversation history (memory explosion)
   - Result: Gemini slower to token-1 on complex input

4. **No durable extraction**
   - Extraction happens in-call (competes with speech delivery)
   - Failed extractions silently drop
   - No audit trail for compliance

### Impact on UX
- **Cold start** (no cache): 3-5s silence before first Bella word
- **Warm turn** (KV cached): 1.5-2s delay between prospect speech → Bella response
- **Complex intel** (deep scrape loaded): 2-3s even when warm
- **Mobile networks**: 3-8s (adds network jitter)

---

## THE STRATEGY: HYBRID EDGE + CLOUD

### Architectural Shift
```
BEFORE:
Browser → Voice Agent → Bridge Worker → [serialize: read KV + build prompt + Gemini stream] → TTS → Browser
(single critical path, ~2-3s p99)

AFTER (Phase 5):
Browser → Voice Agent → Bridge Worker → {Parallel: Realtime Agent (90ms) | Gemini (1.2s)} → TTS → Browser
(dual path, first-to-respond wins, ~800ms p99)

With durable extraction + compliance sidecar:
DO → Workflows (extract) → D1 (audit log)
(async, non-blocking, 100% coverage)
```

### CF Primitives Used
| Primitive | Purpose | Cost | Latency |
|-----------|---------|------|---------|
| **Realtime API** | Edge LLM (Claude 3.5 Sonnet mini) | $3/M tokens | 80-150ms |
| **Workers AI** | Fallback reasoning (if Realtime quota hit) | Included in Workers plan | 200-400ms |
| **Durable Objects** | TurnPlan state machine (existing) | $0.15/req + storage | <10ms |
| **Workflows** | Extraction pipeline (new) | $0.50/trigger + compute | <500ms async |
| **D1** | Audit log + compliance cache | $0.50/month | <50ms local read |
| **KV** | Session state (existing) | $0.50/mo + ops | <10ms |
| **Gemini** | Primary LLM fallback | $0.30-1/M tokens | 1.2-1.8s |

**Total cost delta:** +$29/mo (Realtime API $20 + Workflows $5 + D1 overhead $4)

---

## PHASES (7-WEEK ROLLOUT)

### Phase 0: TurnPlan Contract Lock (DAYS 1-2)
**Effort:** 4 hours | **Impact:** Unblocks all downstream work
**Files:** `brain-v2-rescript/src/index.ts`, `bridge-v2-rescript/src/index.ts`

**Deliverable:** Formal TypeScript interface for brain→bridge handoff

```typescript
// brain.ts emits this
type TurnPlan = {
  stage: string;                    // current stage (wow_1...close)
  turnGoal: string;                 // what this turn is trying to accomplish
  mustMention: string[];            // phrases must appear in speech
  mustNotSay: string[];             // explicit guardrails
  factsToUse: Record<string, any>;  // prioritized facts for Gemini
  fallback: string;                 // worst-case response if Gemini fails
  improvisationBand: "verbatim" | "guided" | "freestyle";  // how loose Bella can be
};
```

**Bridge consumes TurnPlan:**
- Route 1: **Realtime path** — TurnPlan sent to CF Realtime Agent, fires in parallel
- Route 2: **Gemini path** — Build bounded prompt from TurnPlan, stream response
- Route 3: **Fallback** — If both fail, speak `fallback` field

**Success gate:**
- [ ] TypeScript interface compiles in both workers
- [ ] Brain exports valid TurnPlan on every turn
- [ ] Bridge validates contract before consuming (logs violations)
- [ ] 58-assertion harness passes with TurnPlan instrumentation

---

### Phase 1: Realtime Agent + Dual-Path Execution (WEEKS 1-2)
**Effort:** 20 hours | **Impact:** 90-150ms first response on hot path
**Files:** `bridge-v2-rescript/src/index.ts`, new `bridge-realtime.ts`

**Deliverables:**
1. Realtime Agent instance on Cloudflare
2. Bridge worker spawns Realtime request in parallel with Gemini
3. First-to-respond wins (Realtime if <500ms, else Gemini)
4. Fallback to Gemini if Realtime quota exhausted

**Implementation outline:**
```typescript
// bridge.ts turn handler
async function handleTurn(turnPlan: TurnPlan, transcript: string) {
  const [realtimePromise, geminiPromise] = await Promise.all([
    callRealtimeAgent(turnPlan, transcript),  // 80-150ms
    callGemini(turnPlan, transcript),         // 1.2-1.8s
  ]);
  
  return Promise.race([
    realtimePromise.then(r => ({ source: 'realtime', response: r })),
    geminiPromise.then(g => ({ source: 'gemini', response: g })),
  ]);
}
```

**Realtime Agent instructions:**
- System prompt: "You are Bella, a voice sales agent. Use the TurnPlan to respond naturally."
- Input: TurnPlan + prospect utterance + prior context
- Output: One sentence response (max 50 tokens, must stay under 2s)
- Guardrails: Honor `mustNotSay`, stick to `factsToUse`

**Success gates:**
- [ ] Realtime endpoint created and authenticated
- [ ] Dual-path fires correctly (logs show both requests)
- [ ] First-to-respond logic works (Realtime chosen when <500ms)
- [ ] Fallback to Gemini when Realtime fails
- [ ] Measured p99 latency <800ms on warm path

---

### Phase 2: Bounded Prompt System (WEEKS 2-3)
**Effort:** 12 hours | **Impact:** 30-40% faster Gemini TTFB (1.8s → 1.2s)
**Files:** `bridge-v2-rescript/src/index.ts` (prompt builder)

**Deliverable:** Replace mega-prompt with fact-prioritized bounded prompts

**Current prompt structure (3.5k tokens):**
```
System: [8 stage directives + full intel envelope]
History: [full conversation]
Facts: [all KV data]
```

**New bounded structure (1.5k tokens):**
```
System: [current stage only + TurnPlan guidance]
Relevant facts: [top 5 facts from TurnPlan.factsToUse]
Recent history: [last 3 turns only]
Compliance guards: [mustMention, mustNotSay]
```

**Fact prioritization logic:**
1. Rank facts by relevance to current stage
2. Take top 5 by token count
3. Compress arrays (join with commas)
4. Truncate long strings

**Success gates:**
- [ ] Prompt builder generates <1.5k bounded prompts
- [ ] Top 5 facts remain in output (no critical data dropped)
- [ ] Gemini TTFB measured <1.2s on same hardware
- [ ] Compliance still enforces mustMention/mustNotSay
- [ ] Comparison test: mega vs bounded quality (58-assertion harness)

---

### Phase 3: Durable Extraction Pipeline (WEEKS 3-4)
**Effort:** 16 hours | **Impact:** 100% capture rate, zero silent drops
**Files:** `bridge-v2-rescript/src/index.ts`, new `extraction-workflow.ts`, D1 schema

**Deliverable:** Move extraction off critical path into CF Workflows

**Current (in-call extraction):**
- Bridge extracts while streaming Gemini response
- Competes with speech delivery
- Failures silently drop data

**New (async extraction):**
```
Bridge turn handler
  ↓ (store turn data in temp KV)
  ↓ ctx.waitUntil(
      env.EXTRACTION_WORKFLOW.trigger({
        lid, turnIndex, transcript, stage, directives
      })
    )
  ↓ (return immediately, no wait)

Workflow executor (runs serverless)
  ↓ Extract fields using regex + Gemini (if needed)
  ↓ Write to D1 audit log
  ↓ Merge back to lead:{lid}:captured_inputs
```

**D1 schema:**
```sql
CREATE TABLE turn_extractions (
  id INTEGER PRIMARY KEY,
  lid TEXT,
  turn_index INTEGER,
  stage TEXT,
  extracted_fields JSONB,  -- {field: value, field: value}
  confidence REAL,
  extraction_method TEXT,  -- regex|gemini|manual
  timestamp DATETIME
);
```

**Success gates:**
- [ ] Workflows endpoint created and authenticated
- [ ] Bridge fires extraction workflow without blocking
- [ ] All 5-turn canary extractions logged to D1
- [ ] Zero missed extractions (previous silent drop cases caught)
- [ ] Audit log readable by compliance team

---

### Phase 4: Compliance Sidecar (WEEKS 4-6)
**Effort:** 20 hours | **Impact:** SLA-ready audit trail, zero ambiguity
**Files:** new `compliance-sidecar.ts`, D1 compliance schema

**Deliverable:** Multi-decision replay + cached audit logs

**Use case:**
Trent asks: "Did Bella mention our ROI?" → Look up canary lid in D1 → Replay full call logic.

**Implementation:**
```typescript
// After each turn, log decision
async function logComplianceDecision(context: {
  lid: string;
  turnIndex: number;
  stage: string;
  turnGoal: string;
  prospectUtterance: string;
  bellaResponse: string;
  extractedFields: Record<string, any>;
  decisionsApplied: string[];  // ["mustMention:ROI", "guardrail:avoid_price", ...]
}) {
  await env.DB.prepare(
    `INSERT INTO compliance_log (lid, turn_index, decision_log) VALUES (?, ?, ?)`
  ).bind(lid, turnIndex, JSON.stringify(context)).run();
}

// Query all decisions for a lid
async function auditCall(lid: string) {
  return env.DB.prepare(
    `SELECT * FROM compliance_log WHERE lid = ? ORDER BY turn_index`
  ).bind(lid).all();
}
```

**Success gates:**
- [ ] Compliance log captures all decisions (mustMention, guardrails, extraction)
- [ ] Log is queryable by lid (can reconstruct any call)
- [ ] P1 violations flagged (e.g., mustMention not found in response)
- [ ] Query time <200ms for 10-turn call
- [ ] Audit report matches canary test results

---

### Phase 5: Dialogue Tuning + A/B Test (WEEKS 6-7)
**Effort:** 12 hours (tuning) + 4 hours (A/B setup)
**Files:** `bridge-v2-rescript/src/index.ts` (prompt variants)

**Deliverable:** Prove bounded vs mega prompt quality parity

**Experiment design:**
```
Canary: Realtime + bounded prompt (treatment)
Control: Realtime + mega prompt (old behavior, for baseline)
Metric: 58-assertion score (must match or exceed control)
```

**Tuning levers (if bounded loses quality):**
1. Increase budget to 2k tokens (vs 1.5k)
2. Add conversation history back (2 turns instead of 3)
3. Re-rank facts by stage-specific priority (not global)

**Success gates:**
- [ ] A/B framework coded (route 5% of traffic to control)
- [ ] 50-call sample run (bounded vs mega)
- [ ] No difference in 58-assertion scores (P1-P11, D1-D10, B1-B13, SQ1-SQ10, Q1-Q14)
- [ ] Gemini cost reduced by 35-40% (token efficiency)
- [ ] Rollout: 5% → 25% → 100% over 1 week

---

## COST BREAKDOWN

| Phase | Resource | Monthly Cost | Cumulative |
|-------|----------|--------------|-----------|
| Current (v6.16.1) | Gemini + Workers | $68 | **$68** |
| + Phase 1 (Realtime) | +Realtime API | +$20 | **$88** |
| + Phase 2 (Bounded) | (no delta) | $0 | **$88** |
| + Phase 3 (Extraction) | +Workflows | +$5 | **$93** |
| + Phase 4 (Compliance) | +D1 + logging | +$4 | **$97** |
| Phase 5 (Tuning) | A/B routing | $0 | **$97** |
| **Cost savings from bounded prompt** | Gemini tokens −35% | −$24 | **$73** |

**Final state (Phase 5 complete):** $73/mo, −29% from baseline (latency cut 400ms, compliance +100%)

---

## SUCCESS CRITERIA

### Per Phase
| Phase | Gate | Measurement |
|-------|------|-------------|
| **0** | TurnPlan interface | TypeScript strict mode passes, no errors |
| **1** | Dual-path execution | Realtime fires + Gemini in parallel, first-to-respond <500ms |
| **2** | Bounded prompt | Gemini TTFB <1.2s, quality parity on 58-harness |
| **3** | Extraction pipeline | 100% extraction, zero silent drops, D1 queryable |
| **4** | Compliance log | All decisions captured, audit replay works |
| **5** | A/B tuning | Quality ≥ control, cost ↓35%, rollout 100% |

### Overall
- **Latency:** p99 <800ms edge-to-speech (vs current 2-3s)
- **Quality:** 58-assertion harness ≥54/58 (same threshold as v6.16.1)
- **Compliance:** 100% audit trail, zero ambiguity, SLA-ready
- **Cost:** $73/mo (−$29/mo vs Phase 1 start, −$73 gross from Phase 0)
- **Reliability:** <0.1% failure rate (fallback to Gemini if Realtime down)

---

## KNOWN UNKNOWNS

1. **Realtime Agent token efficiency** — How much context does Claude 3.5 mini need vs Gemini? May require prompt tuning.
2. **Workflow execution under load** — What's the latency distribution at 100 concurrent extractions?
3. **TTS interleaving** — Can Deepgram TTS start before extraction completes? Timing dependency?
4. **Fallback chain breakdown** — What happens if both Realtime AND Gemini timeout? (Implement hardcoded fallback phrase.)
5. **D1 write-ahead log capacity** — How many compliance decisions before D1 hits concurrency limits?

---

## DEPLOYMENT STRATEGY

### Pre-Phase 0 Checklist
- [ ] Trent approves Phase 0-5 roadmap (this document)
- [ ] T2 drafts TurnPlan TypeScript interface
- [ ] T3/T4 implement Phase 0 in brain + bridge
- [ ] v6.27.0 tagged with TurnPlan interface (no functional change)

### Canary → Production Flow
1. **Canary phase 0** (TurnPlan): 100% signal, no behavior change
2. **Canary phase 1** (Realtime + dual-path): 5% traffic, compare latency + quality
3. **Promote 1** → 25% if latency <800ms + quality maintained
4. **Promote 2** → 100% after 48h at 25% (zero alerts)
5. **Phases 2-5:** Repeat canary → 25% → 100% per phase

### Rollback Plan
- **If Realtime latency >1s:** Disable Realtime path, revert to Gemini-only
- **If bounded prompt quality drops:** Increase token budget back to 2.5k
- **If Workflows fail:** Extraction stays in-call (Phase 3 reverted)

---

## NEXT STEPS

1. **Get approval** — Trent reviews + signs off on phases 0-5
2. **Lock TurnPlan** — T2 designs interface, T3/T4 implement Phase 0
3. **Parallel track: nano-claude-code** — Micro-Claude runtime for CF Workers (enables edge-native agents)
4. **Canary v6.27.0** — Phase 0 TurnPlan, full signal collection
5. **Realtime onboarding** — Set up CF Realtime API access, service principal
6. **Phase 1 canary** — Dual-path with measured latency + quality gates

---

## APPENDIX: TurnPlan Example

```typescript
// Brain computes for wow_3 turn
const turnPlan: TurnPlan = {
  stage: "wow_3",
  turnGoal: "Discover prospect's ICP and pain points",
  mustMention: ["industry", "business model"],
  mustNotSay: ["our competitors", "industry leaders"],
  factsToUse: {
    business_name: "Pitcher Partners",
    industry: "legal services",
    location: "Sydney",
    website_health_score: 6.2,
  },
  fallback: "Got it, so you're in legal services. That's great — so what's your biggest challenge right now with leads or conversions?",
  improvisationBand: "guided",
};

// Bridge sends to Realtime Agent
// Realtime responds: "Pitcher Partners, legal services in Sydney — I'm curious, when you think about your ideal clients, what does that look like?"

// If Realtime times out, Gemini takes over with bounded prompt
// If both fail, Bridge speaks: `fallback`
```

