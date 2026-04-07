# CHUNK 1 SPEC — Brain TurnPlan Engine
### bella-brain-v3 Durable Object
### Author: T2 Code Lead | Date: 2026-04-07
### Status: REWORK v3 — T3 P1-P5 + state ordering + compat date fixes

---

## 1. SCOPE

Build the `BrainDO` Durable Object in `workers/brain-v3/src/` that:
1. Accepts `TurnRequest` from Realtime Agent via the worker fetch handler
2. Maintains per-call conversation state in DO transactional storage
3. Runs a deterministic stage machine (no Gemini calls — Brain is pure logic)
4. Reads/writes `lead_facts` from D1 using the Universal Data Law
5. Returns a `TurnPlan` that Prompt Worker will use to build the Gemini call
6. Fires extraction to the Extraction Workflow (filtered by speakerFlag)

**Out of scope for Chunk 1:** Prompt Worker, Realtime Agent, Extraction Workflow internals, Compliance Workflow, telemetry emission. These are stubs only.

---

## 2. FILE STRUCTURE

```
workers/brain-v3/src/
  index.ts          — Worker fetch handler + DO routing
  brain-do.ts       — BrainDO class (DurableObject)
  state.ts          — ConversationState type + initialState()
  stage-machine.ts  — processFlow() stage transitions
  facts.ts          — getFact(), shouldAskQuestion(), FIELD_EQUIVALENTS, hydrateFacts(), persistFacts()
  gate.ts           — STAGE_POLICIES, shouldForceAdvance(), maxQuestionsReached(), eligibility
  roi.ts            — computeAlexRoi(), computeChrisRoi(), computeMaddieRoi() (deterministic, ported from V2)
  queue.ts          — buildInitialQueue(), nextChannelFromQueue(), rebuildFutureQueueOnLateLoad()
  turn-plan.ts      — buildTurnPlan() — assembles TurnPlan from stage + state + facts
  moves.ts          — buildStageDirective() — per-stage directive text builder
  types.ts          — Internal types (StageId, WowStepId, CoreAgent, StagePolicy, etc.)
  helpers.ts        — normalizeConversionRate(), alexGapFactor(), bandToSpokenLabel()
```

---

## 3. UNIVERSAL DATA LAW — getFact() + shouldAskQuestion()

### 3.1 getFact() Source Priority Waterfall

Brain reads ALL `lead_facts` rows for a `lead_id` from D1. No channel filtering. Facts captured during Alex-mode are available in Chris-mode, Maddie-mode, close.

```typescript
type DataSource = 'prospect' | 'consultant' | 'scrape' | 'industry_default';

const SOURCE_PRIORITY: DataSource[] = ['prospect', 'consultant', 'scrape', 'industry_default'];

interface WarmFact {
  fact_key: string;
  fact_value: string;
  data_source: DataSource;
  confidence: number;
}

/**
 * Resolve a fact value using the source priority waterfall.
 * HotMemory (in-call extracted values not yet persisted) wins over all D1 rows.
 */
function getFact(
  key: string,
  hotMemory: Record<string, string | number | null>,
  warmFacts: WarmFact[],
): string | number | null {
  // 1. HotMemory (current call extractions) wins
  if (hotMemory[key] != null) return hotMemory[key];

  // 2. D1 warm facts — priority waterfall
  const matching = warmFacts.filter(f => f.fact_key === key);
  for (const source of SOURCE_PRIORITY) {
    const found = matching.find(f => f.data_source === source);
    if (found) return found.fact_value;
  }

  return null;
}
```

### 3.2 shouldAskQuestion() with FIELD_EQUIVALENTS

Prevents re-asking questions when an equivalent field already has a value.

```typescript
const FIELD_EQUIVALENTS: Record<string, string[]> = {
  webLeads:              ['webLeads', 'inboundLeads'],
  inboundLeads:          ['inboundLeads', 'webLeads'],
  webConversions:        ['webConversions', 'inboundConversions'],
  inboundConversions:    ['inboundConversions', 'webConversions'],
  webConversionRate:     ['webConversionRate', 'inboundConversionRate'],
  inboundConversionRate: ['inboundConversionRate', 'webConversionRate'],
};

function shouldAskQuestion(
  fieldKey: string,
  hotMemory: Record<string, string | number | null>,
  warmFacts: WarmFact[],
): boolean {
  const equivalents = FIELD_EQUIVALENTS[fieldKey] ?? [fieldKey];
  return !equivalents.some(f => getFact(f, hotMemory, warmFacts) != null);
}
```

### 3.3 Fact Persistence

On each turn where extraction yields new facts:
```sql
INSERT INTO lead_facts (id, lead_id, fact_key, fact_value, data_source, confidence, captured_at, captured_during)
VALUES (?, ?, ?, ?, 'prospect', ?, datetime('now'), ?)
ON CONFLICT (lead_id, fact_key, data_source) DO UPDATE SET
  fact_value = excluded.fact_value,
  confidence = excluded.confidence,
  captured_at = excluded.captured_at;
```

Source-aware upsert: `ON CONFLICT (lead_id, fact_key, data_source)`. Never overwrites a different source's row.

### 3.4 Fact Hydration on Call Start

When a call begins (turnIndex === 0), Brain loads ALL warm facts for the lead:
```sql
SELECT fact_key, fact_value, data_source, confidence
FROM lead_facts WHERE lead_id = ?
ORDER BY data_source ASC;
```

These populate the `warmFacts` array. HotMemory starts empty and accumulates extraction results during the call.

---

## 4. T3 HARD REQUIREMENTS

### 4.1 NB1: Speaker Flag Filter Before Extraction

Brain MUST filter `speakerFlag === 'unknown'` turns before dispatching to extraction.

```typescript
// In brain-do.ts processTurn():
if (turnRequest.speakerFlag === 'unknown') {
  // Log and skip extraction — unknown speaker = unreliable data
  console.log(`[BRAIN] turnId=${turnRequest.turnId} speakerFlag=unknown — skipping extraction`);
  // Still advance stage machine (prospect silence can trigger timeouts)
  // But do NOT fire extraction workflow
}

// Only fire extraction for prospect utterances:
if (turnRequest.speakerFlag === 'prospect') {
  // Dispatch to extraction workflow with targets from current stage policy
}
// speakerFlag === 'bella' → log turn, no extraction (we know what Bella said)
```

### 4.2 NB2: Authoritative Business Name Resolution

Single rule: `consultant.businessIdentity.correctedName` is authoritative when present. Fallback chain:

```typescript
function resolveBusinessName(
  hotMemory: Record<string, string | number | null>,
  warmFacts: WarmFact[],
  intelEvent?: IntelReadyEvent,
): string {
  // 1. Consultant-corrected name (highest authority)
  const consultantName = getFact('business_name', hotMemory,
    warmFacts.filter(f => f.data_source === 'consultant'));
  if (consultantName) return String(consultantName);

  // 2. IntelReadyEvent.core_identity.business_name
  if (intelEvent?.core_identity?.business_name) return intelEvent.core_identity.business_name;

  // 3. Any warm fact for business_name (scrape, etc.)
  const anyName = getFact('business_name', hotMemory, warmFacts);
  if (anyName) return String(anyName);

  // 4. Fallback — should never reach here if intel arrived
  return 'your business';
}
```

The consultant writes `business_name` as `data_source = 'consultant'` in `lead_facts`. The scrape writes it as `data_source = 'scrape'`. The getFact() waterfall naturally prefers consultant over scrape. This function adds the explicit `correctedName` check for extra safety.

---

## 5. STAGE MACHINE

### 5.1 Stage IDs

```typescript
type StageId =
  | 'greeting'
  | 'wow_1' | 'wow_2' | 'wow_3' | 'wow_4'
  | 'wow_5' | 'wow_6' | 'wow_7' | 'wow_8'
  | 'recommendation'
  | 'anchor_acv'
  | 'ch_alex' | 'ch_chris' | 'ch_maddie'
  | 'ch_sarah' | 'ch_james'
  | 'roi_delivery'
  | 'optional_side_agents'
  | 'close';
```

### 5.2 processFlow() — Stage Transitions

Ported from V2 `flow.ts` with V3 separation of concerns (Brain returns TurnPlan, doesn't call Gemini).

```
greeting → wow_1 → wow_2 → ... → wow_8 → recommendation → anchor_acv
  → ch_{first_from_queue} → ch_{next} → ... → roi_delivery
  → optional_side_agents → close
```

Key transition rules (from V2, preserved exactly):
- **greeting → wow_1**: After first prospect utterance (turnIndex > 0)
- **wow_N → wow_N+1**: After Bella speaks each WOW step (auto-advance, no prospect input needed for 1-3)
- **wow_3 gate**: `stall >= 3` minimum turns before advancing past WOW
- **recommendation**: Bella speaks agent recommendation; on prospect reply → `nextChannelFromQueue()`
- **anchor_acv**: See Section 5.4 below
- **ch_X → ch_Y**: `shouldForceAdvance()` (minimum data met) OR `maxQuestionsReached()` → `nextChannelFromQueue()`
- **Last channel → roi_delivery**: Queue exhausted → combined ROI delivery
- **roi_delivery → optional_side_agents**: After combined ROI spoken and prospect replies
- **optional_side_agents → close**: See Section 5.6 below

### 5.4 anchor_acv Stage

ACV (average contract value / deal value) is shared across all three core calculators. It is captured ONCE before any channel stage begins, preventing each channel from independently asking "what's your average deal value?"

**Directive:**
```typescript
function buildAnchorAcvDirective(
  hotMemory: Record<string, string | number | null>,
  warmFacts: WarmFact[],
): StageDirective {
  const existingAcv = getFact('acv', hotMemory, warmFacts);

  if (existingAcv != null) {
    // ACV already known (from prior call, consultant estimate, or intel)
    // Auto-advance — no question needed
    return {
      objective: 'ACV already captured — auto-advance to first channel.',
      allowedMoves: ['advance:first_channel'],
      requiredData: [],
      speak: '',
      ask: false,
      waitForUser: false,
      canSkip: true,
    };
  }

  return {
    objective: 'Capture average deal value before channel ROI calculations.',
    allowedMoves: ['extract:acv'],
    requiredData: ['acv'],
    speak: 'Before we dig into the specifics — roughly what would you say your average customer or deal is worth to you?',
    ask: true,
    waitForUser: true,
    canSkip: false,
    extract: ['acv'],
    maxQuestions: 1,
    forceAdvanceWhenSatisfied: true,
  };
}
```

**Advance condition:** `getFact('acv', hotMemory, warmFacts) != null` → advance to `nextChannelFromQueue()`. If ACV is already known on entry (from intel, prior call, or consultant), this stage auto-advances with no user interaction (zero-turn pass-through).

**Extraction targets:** `['acv']`

**Question budget:** 1. If prospect doesn't provide ACV after one ask, advance anyway — channel calculators use a conservative industry default (stored as `data_source = 'industry_default'` in lead_facts by the consultant).

### 5.6 optional_side_agents Stage

**Deferred to Chunk 7 (Intelligence Layers).** Sarah (database reactivation) and James (review uplift) are optional agents that require additional intel signals and eligibility logic beyond the core 3.

**Chunk 1 behavior: stub pass-through.** When the stage machine reaches `optional_side_agents`, it auto-advances to `close` with zero user interaction:

```typescript
case 'optional_side_agents': {
  // Chunk 1 stub: auto-advance to close
  // Chunk 7 will add Sarah/James eligibility checks here
  state.completedStages.push('optional_side_agents');
  state.currentStage = 'close';
  console.log('[ADVANCE] optional_side_agents → close (Chunk 1 stub)');
  break;
}
```

The `ch_sarah` and `ch_james` StageIds remain in the type union for forward compatibility but are never enqueued in Chunk 1. STAGE_POLICIES for sarah/james exist in V2 gate.ts and will be ported in Chunk 7.

### 5.7 Intel Arrival (IntelReadyEvent)

Brain exposes `POST /intel` on the DO. When intel arrives:
1. Parse and validate against `IntelReadyEventV1` (Zod)
2. Write intel facts to D1 as `data_source = 'scrape'` or `'consultant'` per tag
3. Hydrate consultant routing → rebuild future queue (see 5.8)
4. Store intel snapshot in DO transactional storage for directive building

This replaces V2's KV polling. No polling anywhere in V3.

### 5.8 rebuildFutureQueueOnLateLoad — "Future Only" Semantics

When late-arriving intel (e.g., deep scrape completing mid-call) changes agent eligibility, the queue is rebuilt with these invariants:

```typescript
function rebuildFutureQueueOnLateLoad(
  currentQueue: QueueItem[],
  state: ConversationState,
  intel: IntelReadyEvent,
): QueueItem[] {
  const completedSet = new Set<StageId>(state.completedStages);
  const currentStage = state.currentStage;

  // 1. Derive fresh eligibility from latest intel
  const freshEligibility = deriveEligibility(intel, state);

  // 2. Build fresh queue from new eligibility
  const freshQueue = buildInitialQueue(freshEligibility);

  // 3. INVARIANT: completed stages are IMMUTABLE — never re-enqueue
  // 4. INVARIANT: current in-progress stage is NOT interrupted
  // 5. Only future (unvisited, uncompleted) items are candidates
  return freshQueue.filter(item =>
    !completedSet.has(item.stage) && item.stage !== currentStage
  );
}
```

**Rules:**
- **Completed stages are immutable.** If ch_alex was already completed when deep intel arrives and now marks Alex ineligible, ch_alex stays completed. We do not undo or re-run completed stages.
- **Current in-progress stage is not interrupted.** If ch_chris is mid-conversation when intel arrives, ch_chris continues. The rebuild only affects stages AFTER the current one.
- **New eligibility can ADD stages.** If deep intel reveals phone signals and Maddie was previously ineligible, Maddie gets added to the future queue.
- **New eligibility can REMOVE future stages.** If deep intel reveals no website and Chris hasn't started yet, Chris is removed from the future queue.

---

## 6. CONVERSATION STATE

```typescript
interface ConversationState {
  // Identity
  callId: string;
  leadId: string;
  businessName: string;

  // Stage machine
  currentStage: StageId;
  completedStages: StageId[];
  wowStep: number;              // 1-8
  turnIndex: number;

  // Queue
  currentQueue: QueueItem[];
  topAgents: CoreAgent[];

  // Eligibility flags (derived from intel)
  alexEligible: boolean;
  chrisEligible: boolean;
  maddieEligible: boolean;

  // Question budgets
  questionCounts: Record<string, number>;

  // Extracted inputs (HotMemory)
  hotMemory: Record<string, string | number | null>;

  // ROI calculator results
  calculatorResults: Partial<Record<CoreAgent, AgentRoiResult>>;

  // Intel snapshot
  intelReceived: boolean;
  intelEvent: IntelReadyEvent | null;

  // Warm facts (loaded from D1 at call start)
  warmFacts: WarmFact[];
}
```

Persisted in DO transactional storage via `this.ctx.storage.put('state', state)` after every turn. **This put MUST be awaited before returning the Response** — see Section 12 write ordering rules.

---

## 7. ROI CALCULATORS

Ported verbatim from V2 `roi.ts`. Pure functions, zero Gemini involvement.

| Calculator | Inputs (via getFact) | Formula |
|---|---|---|
| `computeAlexRoi` | acv, inboundLeads, inboundConversions/Rate, responseSpeedBand | Speed-to-lead gap × max 3.94x uplift, capped at 40% conversion |
| `computeChrisRoi` | acv, webLeads, webConversions/Rate | 23% flat uplift on current rate, capped at 35% |
| `computeMaddieRoi` | acv, phoneVolume, missedCalls/Rate | 35% recovery × 50% booked value |
| `computeCombinedRoi` | Results from core 3 | Sum of weekly values (Sarah/James excluded) |

### 7.1 When Calculators Fire

Calculators fire inside `processFlow()` when `shouldForceAdvance()` returns true for a channel stage:

```typescript
if (shouldForceAdvance(stage, state)) {
  // Gather inputs from hotMemory + warmFacts via getFact()
  const inputs = gatherCalculatorInputs(stage, state);
  state.calculatorResults[agent] = computeAgentRoi(agent, inputs);
  // Advance to next stage
}
```

ROI is NEVER computed by Gemini. Brain computes, TurnPlan carries the result, Prompt Worker weaves it into speech.

---

## 8. STAGE POLICIES (from V2 gate.ts)

```typescript
const STAGE_POLICIES = {
  ch_alex: {
    requiredFields: ['acv', 'inboundLeads', 'responseSpeedBand'],
    eitherOrFields: [['inboundConversions', 'inboundConversionRate']],
    maxQuestions: 3,
    forceAdvanceWhenSatisfied: true,
  },
  ch_chris: {
    requiredFields: ['acv', 'webLeads'],
    eitherOrFields: [['webConversions', 'webConversionRate']],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
  },
  ch_maddie: {
    requiredFields: ['phoneVolume'],
    eitherOrFields: [['missedCalls', 'missedCallRate']],
    maxQuestions: 2,
    forceAdvanceWhenSatisfied: true,
  },
};
```

### 8.1 shouldForceAdvance() — EITHER/OR resolution

`requiredFields` are simple keys resolved via `getFact()`. `eitherOrFields` are pairs where EITHER key having a value satisfies the requirement. This prevents the V2 bug where composite keys like `inboundConversionsOrRate` would never resolve in `getFact()`.

```typescript
function shouldForceAdvance(
  stage: StageId,
  hotMemory: Record<string, string | number | null>,
  warmFacts: WarmFact[],
): boolean {
  const policy = STAGE_POLICIES[stage];
  if (!policy) return false;

  // All simple required fields must have values
  const allRequired = policy.requiredFields.every(
    key => getFact(key, hotMemory, warmFacts) != null
  );
  if (!allRequired) return false;

  // Each either/or pair: at least ONE must have a value
  const allEitherOr = (policy.eitherOrFields ?? []).every(
    pair => pair.some(key => getFact(key, hotMemory, warmFacts) != null)
  );

  return allEitherOr;
}
```

`maxQuestionsReached()` checks `state.questionCounts[stage] >= policy.maxQuestions`.

Both use `getFact()` — never raw state fields.

---

## 9. TURNPLAN OUTPUT

Every `processTurn()` call returns a `TurnPlan` (validated against `TurnPlanV1` Zod schema):

```typescript
function buildTurnPlan(state: ConversationState, directive: StageDirective): TurnPlan {
  return {
    version: 1,
    callId: state.callId,
    turnId: currentTurnId,
    stage: state.currentStage,
    moveId: `${state.currentStage}_${state.turnIndex}`,
    directive: directive.objective,
    speakText: directive.speak || undefined,
    mandatory: !directive.canSkip,
    maxTokens: directive.ask ? 150 : 80,
    confirmedFacts: buildConfirmedFactsList(state),
    activeMemory: buildActiveMemoryList(state),
    contextNotes: directive.notes ?? [],
    extractionTargets: directive.extract ?? [],
  };
}
```

### 9.1 confirmedFacts

Array of human-readable strings for Prompt Worker's "DO NOT re-ask" section:
```typescript
function buildConfirmedFactsList(state: ConversationState): string[] {
  const confirmed: string[] = [];
  const check = (key: string, label: string) => {
    const val = getFact(key, state.hotMemory, state.warmFacts);
    if (val != null) confirmed.push(`${label}: ${val}`);
  };
  check('acv', 'Average deal value');
  check('inboundLeads', 'Inbound leads/week');
  check('webLeads', 'Website leads/week');
  check('phoneVolume', 'Phone volume/week');
  check('missedCalls', 'Missed calls/week');
  check('responseSpeedBand', 'Response speed');
  check('business_name', 'Business name');
  // ... all captured fields
  return confirmed;
}
```

### 9.2 extractionTargets

Array of field keys the extraction workflow should attempt to extract from the prospect's utterance this turn. Derived from the current stage policy's next-needed fields via `shouldAskQuestion()`.

---

## 10. BRAIN DO API

### 10.1 Routes (via worker fetch handler → DO)

| Method | Path | Body | Response | Purpose |
|---|---|---|---|---|
| POST | `/turn` | `TurnRequestV1` | `TurnPlanV1` | Process a turn, return plan |
| POST | `/intel` | `IntelReadyEventV1` | `{ ok: true }` | Receive intel event (replaces KV poll) |
| POST | `/extraction-result` | `ExtractionResultV1` | `{ ok: true }` | Receive extraction results back |
| GET | `/debug?callId=X` | — | Full state dump | Debug endpoint |
| GET | `/health` | — | `{ version, worker }` | Health check |

### 10.2 DO Routing

**All routes require `?callId=X` query parameter.** The worker fetch handler NEVER reads the request body — body stream must arrive intact at the DO.

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: '1.0.0', worker: 'brain-v3' });
    }

    // callId MUST be in query param — never read body at worker layer
    // (Request.body is a readable stream — consumed once, gone forever)
    const callId = url.searchParams.get('callId');
    if (!callId) return new Response('Missing ?callId= query parameter', { status: 400 });

    // Route to DO instance — body passes through untouched
    const doId = env.BRAIN_DO.idFromName(callId);
    const stub = env.BRAIN_DO.get(doId);
    return stub.fetch(request);
  },
};
```

**Callers MUST include callId in both the query string AND the JSON body:**
- Query string: for worker→DO routing (worker layer reads this)
- JSON body: for Zod validation inside the DO (DO reads this)

Example: `POST /turn?callId=abc123` with body `{ "version": 1, "callId": "abc123", ... }`

---

## 11. EXTRACTION DISPATCH (outbound from Brain)

When Brain receives a `prospect` turn and the stage has extraction targets:

```typescript
// Brain dispatches to Extraction Workflow via service binding
if (turnRequest.speakerFlag === 'prospect' && plan.extractionTargets.length > 0) {
  const payload: ExtractionPayload = {
    version: 1,
    callId: state.callId,
    turnId: turnRequest.turnId,
    utterance: turnRequest.utterance,
    speakerFlag: 'prospect',  // ONLY prospect — NB1 enforced
    stage: state.currentStage,
    targets: plan.extractionTargets,
    existingFacts: state.hotMemory,
  };
  // Fire via service binding (non-blocking, Workflow handles retries)
  ctx.waitUntil(env.EXTRACTION_WORKFLOW.fetch(
    new Request('https://fake/trigger', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
  ));
}
```

Extraction results arrive back at `POST /extraction-result` and merge into `hotMemory`.

---

## 12. D1 WRITES PER TURN

Each `processTurn()` writes:

1. **call_turns** — Insert turn record (speaker, utterance, stage, move_id)
2. **lead_facts** — Upsert any newly extracted facts (source-aware)
3. **calls** — Update `total_turns`, `status`, `final_stage` on close

### 12.1 Write Ordering Rules

**`this.ctx.storage.put('state', state)` → MUST be awaited before returning the Response.** DO transactional storage is the source of truth for stage machine state. If this is deferred to `ctx.waitUntil()`, the next turn request can start processing before Turn N's state commit completes — CF DO does not block new requests while waitUntil is in flight. This would cause Turn N+1 to read stale state, leading to double-advances, replayed decisions, or ignored facts.

**D1 writes (call_turns INSERT, lead_facts UPSERT, calls UPDATE) → `ctx.waitUntil()`.** These are safe to run async because they are append-only (call_turns) or upsert-idempotent (lead_facts). They do not affect the next turn's processing — Brain reads from DO storage + warmFacts (loaded at call start), not from D1 mid-call.

```typescript
// In brain-do.ts processTurn():
const plan = buildTurnPlan(state, directive);

// 1. MUST await — next turn depends on this
await this.ctx.storage.put('state', state);

// 2. Safe to defer — append-only / idempotent, no mid-call dependency
this.ctx.waitUntil(this.persistToD1(state, turnRequest, plan));

return Response.json(plan);
```

---

## 13. WRANGLER CONFIG

```toml
name = "bella-brain-v3"
main = "src/index.ts"
compatibility_date = "2025-04-01"  # Must match Chunk 0 convention (or newer)

[[durable_objects.bindings]]
name = "BRAIN_DO"
class_name = "BrainDO"

[[migrations]]
tag = "v1"
new_classes = ["BrainDO"]

[[d1_databases]]
binding = "DB"
database_name = "bella-data-v3"
database_id = "TBD"
```

---

## 14. ASSERTIONS

All assertions run in vitest. Test file: `workers/brain-v3/src/__tests__/chunk1.test.ts`

### C1-24: getFact() returns prospect over consultant for same key
```typescript
test('C1-24: getFact prefers prospect over consultant', () => {
  const warm: WarmFact[] = [
    { fact_key: 'acv', fact_value: '5000', data_source: 'consultant', confidence: 0.8 },
    { fact_key: 'acv', fact_value: '8000', data_source: 'prospect', confidence: 1.0 },
  ];
  expect(getFact('acv', {}, warm)).toBe('8000');
});
```

### C1-25: getFact() returns consultant over scrape for same key
```typescript
test('C1-25: getFact prefers consultant over scrape', () => {
  const warm: WarmFact[] = [
    { fact_key: 'industry', fact_value: 'Accounting', data_source: 'scrape', confidence: 0.7 },
    { fact_key: 'industry', fact_value: 'Professional Services', data_source: 'consultant', confidence: 0.9 },
  ];
  expect(getFact('industry', {}, warm)).toBe('Professional Services');
});
```

### C1-26: getFact() returns HotMemory over D1 warm facts
```typescript
test('C1-26: getFact prefers hotMemory over all warm facts', () => {
  const hot = { acv: 10000 };
  const warm: WarmFact[] = [
    { fact_key: 'acv', fact_value: '5000', data_source: 'prospect', confidence: 1.0 },
  ];
  expect(getFact('acv', hot, warm)).toBe(10000);
});
```

### C1-27: shouldAskQuestion('webLeads') = false when inboundLeads has value
```typescript
test('C1-27: shouldAskQuestion respects FIELD_EQUIVALENTS', () => {
  const hot = { inboundLeads: 50 };
  expect(shouldAskQuestion('webLeads', hot, [])).toBe(false);
});
```

### C1-28: shouldAskQuestion('acv') = true when no value anywhere
```typescript
test('C1-28: shouldAskQuestion returns true when no value exists', () => {
  expect(shouldAskQuestion('acv', {}, [])).toBe(true);
});
```

### C1-29: TurnPlan for Chris includes facts from Alex
```typescript
test('C1-29: TurnPlan carries cross-channel facts', () => {
  // Setup: Alex stage captured inboundLeads=50 into hotMemory
  const state = createTestState({ currentStage: 'ch_chris' });
  state.hotMemory = { inboundLeads: 50, acv: 5000 };

  const plan = buildTurnPlan(state, buildStageDirective('ch_chris', state));

  // Chris TurnPlan must include the fact captured during Alex
  expect(plan.confirmedFacts).toContainEqual(expect.stringContaining('5000'));
});
```

### C1-30: TurnPlan for Chris does NOT ask webLeads when inboundLeads captured
```typescript
test('C1-30: Chris skips webLeads question when inboundLeads exists', () => {
  const state = createTestState({ currentStage: 'ch_chris' });
  state.hotMemory = { inboundLeads: 50 };

  const directive = buildStageDirective('ch_chris', state);

  // Should NOT have webLeads in extraction targets (equivalent already captured)
  expect(directive.extract).not.toContain('webLeads');
});
```

### C1-NB1: Unknown speakerFlag skips extraction
```typescript
test('C1-NB1: unknown speakerFlag does not trigger extraction', () => {
  const turn: TurnRequest = {
    version: 1, callId: 'test', turnId: 't1',
    utterance: 'hello', speakerFlag: 'unknown', turnIndex: 1,
  };
  const { plan, extractionDispatched } = processTurnForTest(turn);
  expect(extractionDispatched).toBe(false);
  // But plan is still returned (stage machine still advances)
  expect(plan.stage).toBeDefined();
});
```

### C1-NB2: Business name resolves consultant > scrape
```typescript
test('C1-NB2: resolveBusinessName prefers consultant correctedName', () => {
  const warm: WarmFact[] = [
    { fact_key: 'business_name', fact_value: 'kpmg.com', data_source: 'scrape', confidence: 0.5 },
    { fact_key: 'business_name', fact_value: 'KPMG Australia', data_source: 'consultant', confidence: 0.95 },
  ];
  expect(resolveBusinessName({}, warm)).toBe('KPMG Australia');
});
```

---

## 15. IMPLEMENTATION NOTES FOR T4

1. **Port V2 calculators verbatim** from D1 doc `doc-bella-roi-calculators-source-20260407`. Do not modify formulas, constants, or guard logic. The `normalizeConversionRate()`, `alexGapFactor()`, implausible rate guard — all preserved exactly.

2. **Port V2 gate logic verbatim** from D1 doc `doc-bella-roi-gates-source-20260407`. Stage policies, eligibility derivation, queue builder, `nextChannelFromQueue()` — all preserved.

3. **Port V2 directive builder structure** from D1 doc `doc-bella-roi-delivery-moves-source-20260407`. The speak text patterns, slot-attempt guards, cross-channel dedup (Chris auto-populating webLeads from Alex's inboundLeads) — all preserved.

4. **DO transactional storage** for state, NOT SQLite (DO has both). Transactional storage is faster for single-key read/write and matches the per-call access pattern.

5. **D1 is for lead_facts, call_turns, calls, quality_scores** — shared across calls for the same lead. This is the warm/cold tier.

6. **Every TurnPlan generator reads via getFact()** — never raw `state.someField`. This is the core of the Universal Data Law.

7. **SLO target**: `TurnRequest → TurnPlan < 150ms`. Brain does zero network calls during plan generation (all data pre-loaded in DO memory). D1 reads happen only at call start and intel arrival.

---

## 16. CONTRACT CHANGES REQUIRED

None. All existing Chunk 0 contracts (`TurnRequestV1`, `TurnPlanV1`, `ExtractionPayloadV1`, `IntelReadyEventV1`) are sufficient. No schema changes needed.

---

## 17. DEPENDENCY GRAPH

```
Chunk 0 (contracts + stubs) ← DONE
  ↓
Chunk 1 (Brain TurnPlan Engine) ← THIS SPEC
  ↓
Chunk 2 (Prompt Worker) — needs TurnPlan to build Gemini calls
Chunk 5 (Extraction Workflow) — needs ExtractionPayload from Brain
```

---

END OF SPEC v3 — ALL T3 ISSUES RESOLVED — AWAITING T3 RE-REVIEW
