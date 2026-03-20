# DO BRAIN IMPLEMENTATION SPEC — Bella V2.0
## CC Build Mandate | Created: 2026-03-20 AEST
## Authority: Trent Belasco + Claude.ai + Perplexity + GPT consensus

---

## OVERVIEW

Extract the state machine from the 2,680-line bridge (`deepgram-bridge-v9/src/index.ts`) into a new Durable Object (`call-brain-do`). The DO becomes the **sole live authority** for one call. The bridge becomes thin transport.

Simultaneously: bake in the tightened 9-stall WOW script, `IndustryLanguagePack`, merged channel-source question, and `NextTurnPacket` contract from day one.

### Why
- Bridge is 2,680 lines doing EVERYTHING — brain, transport, state, extraction, prompts
- KV is eventually consistent — wrong primitive for live turn-by-turn truth
- Extraction cascades: wrong values assigned to wrong fields
- ROI calculated but never delivered
- Repeated questions (no state authority)
- Deepgram UpdatePrompt appends, doesn't replace — prompts must be small by construction

### Single most important rule
**The bridge must stop being the state authority.**

---

## ARCHITECTURE — LIVE PATH

```
1. Client opens voice session
2. Bridge resolves callId → gets DO stub for that call
3. Workflow starts fast-intel → consultant → deep enrichment
4. Each enrichment completion POSTs typed event into DO (+ KV snapshot for replay)
5. On each user turn: bridge sends transcript to DO POST /turn
6. DO validates extraction → updates state → chooses move → returns NextTurnPacket
7. Bridge formats tiny Deepgram prompt from packet → streams Gemini → TTS → browser
```

### Component responsibilities after migration

| Component | Owns | Does NOT own |
|-----------|------|-------------|
| `call-brain-do` | Stage/stall, extraction validation, queue, ROI lock, spoken flags, intel merge, NextTurnPacket | Prompt formatting, Gemini calls, TTS streaming, Deepgram lifecycle |
| `bridge` | Deepgram transport, transcript receive, DO RPC, tiny prompt assembly, Gemini streaming, logging | Stage advancement, extraction truth, queue rebuilding, ROI gating |
| `workflow` | Enrichment fan-out, retries, KV snapshots, DO event delivery | Live call state |
| `consultant` | Structured intel generation (scriptFills, routing, ICP) | Live turn decisions |
| `KV` | Snapshots, replay, debug, analytics | Live authority for anything |

---

## TYPESCRIPT CONTRACTS

### 1. Stage type (tightened — 9-stall WOW, merged source question)

```ts
type Stage =
  | 'wow'
  | 'anchor_acv'
  | 'anchor_timeframe'
  | 'ch_website'
  | 'ch_ads'
  | 'ch_phone'
  | 'ch_old_leads'
  | 'ch_reviews'
  | 'roi_delivery'
  | 'close';
```

### 2. IndustryLanguagePack (replaces bare custTerm)

```ts
type IndustryLanguagePack = {
  industryLabel: string;          // "legal", "dental", "trades"
  singularOutcome: string;        // client, patient, booking, job, matter
  pluralOutcome: string;          // clients, patients, bookings, jobs, matters
  leadNoun: string;               // enquiry, lead, consult request, booking request
  conversionVerb: string;         // book, sign, retain, schedule, win
  revenueEvent: string;           // booked consult, retained matter, paid job
  kpiLabel: string;               // client value, patient value, job value
  missedOpportunity: string;      // missed consult, missed booking, missed quote
  tone: 'formal' | 'practical' | 'strategic' | 'friendly';
  examples: string[];
};
```

### 3. CallBrainState (DO-owned, strongly consistent)

```ts
type CallBrainState = {
  callId: string;
  leadId: string;
  createdAt: string;
  updatedAt: string;

  // ── Stage machine ──
  stage: Stage;
  wowStall: number;           // 1-9 (tightened from 1-12)
  completedStages: string[];
  currentQueue: Stage[];       // built from flags/routing, selective not checklist

  // ── Extracted values (validated before advancing) ──
  extracted: {
    acv: number | null;
    timeframe: 'weekly' | 'monthly' | null;
    web_leads: number | null;
    web_conversions: number | null;
    web_followup_speed: string | null;
    ads_leads: number | null;
    ads_conversions: number | null;
    ads_followup_speed: string | null;
    phone_volume: number | null;
    missed_call_handling: string | null;
    missed_call_callback_speed: string | null;
    old_leads: number | null;
    new_customers: number | null;
    has_review_system: boolean | null;
  };

  // ── Flags ──
  flags: {
    trialMentioned: boolean;
    apifyDone: boolean;
    roiComputed: boolean;
    roiDelivered: boolean;
    justDemo: boolean;
    questionBudgetTight: boolean;
  };

  // ── What's been spoken (prevents repeats) ──
  spoken: {
    moveIds: string[];         // track which moves have been delivered
    factsUsed: string[];       // track which intel facts have been cited
    agentPitchesGiven: string[];
  };

  // ── Intel (loaded at init, updated via events) ──
  intel: {
    fast: Record<string, unknown> | null;
    consultant: Record<string, unknown> | null;
    deep: Record<string, unknown> | null;
    industryLanguage: IndustryLanguagePack | null;
    mergedVersion: number;
  };

  // ── ROI (computed by DO, not bridge) ──
  roi: {
    agentValues: Record<string, number>;  // { alex: 1200, chris: 800 }
    totalValue: number | null;
  };

  // ── Retry tracking ──
  retry: {
    extractionMisses: Record<string, number>;  // field → miss count
    stageLoops: number;
  };
};
```

### 4. BrainEvent (workflow/services → DO)

```ts
type BrainEvent =
  | { type: 'session_init'; leadId: string; starterIntel?: object }
  | { type: 'fast_intel_ready'; payload: object; version: number }
  | { type: 'consultant_ready'; payload: object; version: number }
  | { type: 'deep_ready'; payload: object; version: number }
  | { type: 'user_turn'; transcript: string; turnId: string; ts: string }
  | { type: 'llm_reply_done'; spokenText: string; moveId: string; ts: string }
  | { type: 'call_end'; reason: string; ts: string };
```

### 5. NextTurnPacket (DO → bridge, per-turn response)

```ts
type NextTurnPacket = {
  stage: Stage;
  wowStall: number | null;
  objective: string;               // "Capture ACV from prospect"
  chosenMove: {
    id: string;                    // "wow_s3_icp" — unique, trackable
    kind: 'question' | 'insight' | 'bridge' | 'roi' | 'close';
    text: string;                  // The actual line Bella should deliver
  };
  criticalFacts: string[];         // 3-5 max, from merged intel
  extractTargets: string[];        // ["acv", "timeframe"]
  validation: {
    mustCaptureAny: string[];      // at least one of these before advancing
    advanceOnlyIf: string[];       // all must be true
    doNotAdvanceIf: string[];      // any true = block
  };
  style: {
    tone: string;
    industryTerms: string[];       // from IndustryLanguagePack
    maxSentences: number;
    noApology: boolean;
  };
  roi?: {
    agentValues: Record<string, number>;
    totalValue: number;
  };
};
```

### 6. ExtractionResult (separate from generation)

```ts
type ExtractionResult = {
  fields: Record<string, number | string | boolean | null>;
  confidence: number;              // 0-1
  raw: string;                     // original utterance
  normalized: Record<string, string>;  // "about twenty" → "20"
};
```

The DO runs extraction SEPARATELY from Gemini generation:
1. Bridge sends user transcript to DO `/turn`
2. DO runs deterministic extraction (regex + normalizer) on transcript
3. DO validates typed fields (is number? in range? enum match?)
4. Only then: `advanceIfGateOpen()` runs
5. DO builds NextTurnPacket with validated state
6. Bridge gets packet, builds tiny Gemini prompt, streams response

---

## BRIDGE PROMPT TEMPLATE (tiny, fixed-shape)

```
SYSTEM:
You are Bella. Follow the chosen move exactly.
Max {maxSentences} sentences.
No apology. No filler. No repetition.
Use these terms naturally: {industryTerms}
React briefly to what they said, then deliver the move, then stop.

OBJECTIVE: {objective}

CHOSEN MOVE: {chosenMove.text}

CRITICAL FACTS:
- {fact1}
- {fact2}
- {fact3}

EXTRACT TARGETS: {extractTargets}
```

Target: <500 chars per turn. Never exceeds 1,500 chars.
This keeps Deepgram well under the 25k UpdatePrompt cap.

---

## TIGHTENED WOW — 9 STALLS (was 12)

Per Perplexity consensus: stalls 7+8 merged, stall 10 removed, WOW exits faster.

| Stall | ID | Job | Data requirement | Skip condition |
|-------|-----|-----|-----------------|----------------|
| 1 | `wow_s1_research` | Research intro + permission | firstName, business, industry | Never skip |
| 2 | `wow_s2_reputation` | Reputation + free trial | places.rating >= 3, reviewCount | rating < 3 or missing |
| 3 | `wow_s3_icp` | ICP + 2 problems + 2 solutions | scriptFills.icp_guess OR fallback | Never skip (has fallback) |
| 4 | `wow_s4_pretrain` | Pre-training connect | None beyond fast-intel | Never skip |
| 5 | `wow_s5_conversion` | Conversion event alignment | primaryCTA or conversionAnalysis | Missing CTA data |
| 6 | `wow_s6_audit` | Audit setup / transition | None | Never skip |
| 7 | `wow_s7_source` | Main controllable source (MERGED 7+8) | ads detection flag | Source already clear |
| 8 | `wow_s8_hiring` | Hiring / capacity wedge | consultant or deep hiring signal | No wedge + budget tight |
| 9 | `wow_s9_rec` | Provisional recommendation + bridge | top 2 likely agents | Never skip |

### Stall 7 adaptive logic (merged from old 7+8)
- If ads detected: "I can see you're running ads. Apart from referrals, is that your main source of new {leadNoun}s, or is another channel doing the heavy lifting?"
- If no ads detected: "Apart from referrals, what's your main source of new {leadNoun}s — website, phone, organic, ads, or something else?"
- If source already clear: "Apart from referrals, it looks like {detectedChannel} is a meaningful source — is that fair?"

### Data timing rules
- Stalls 1-4: MUST be safe on fast-intel only
- Stalls 5-9: MAY use full consultant data
- Apify-only details: only when deep.status === "done" AND stall is eligible
- WOW exit: aim for turn 6-8 when credibility + routing confidence is sufficient

---

## GATE LOGIC (moves from bridge to DO)

```ts
function gateOpen(state: CallBrainState): boolean {
  const { stage, extracted: e, wowStall, flags } = state;
  switch (stage) {
    case 'wow':              return wowStall >= 10;  // 9 stalls, gate at 10
    case 'anchor_acv':       return e.acv !== null;
    case 'anchor_timeframe': return e.timeframe !== null;
    case 'ch_website':       return e.web_leads !== null && e.web_conversions !== null;
    case 'ch_ads':           return e.ads_leads !== null && e.ads_conversions !== null;
    case 'ch_phone':         return e.phone_volume !== null && e.missed_call_handling !== null;
    case 'ch_old_leads':     return e.old_leads !== null;
    case 'ch_reviews':       return e.new_customers !== null && e.has_review_system !== null;
    case 'roi_delivery':     return flags.roiDelivered;  // MUST deliver before advancing
    case 'close':            return false;  // terminal
  }
}
```

### ROI delivery lock (state invariant)
- `close` CANNOT become active if `roiComputed === true && roiDelivered === false`
- `roi_delivery` CANNOT be skipped once at least one channel produced usable numbers
- If only one channel complete → deliver partial ROI rather than losing calculation
- DO tracks `roi.agentValues` separately from speech; `roiDelivered` set true only after bridge confirms the ROI line was spoken (via `llm_reply_done` event with moveId containing "roi")

### Advance logic
```ts
function advance(state: CallBrainState): void {
  state.completedStages.push(state.stage);
  state.wowStall = 0;
  if (state.flags.justDemo && (state.stage === 'anchor_timeframe' || state.stage.startsWith('ch_'))) {
    state.stage = 'roi_delivery';
    return;
  }
  const transitions: Partial<Record<Stage, Stage>> = {
    wow: 'anchor_acv',
    anchor_acv: 'anchor_timeframe',
    roi_delivery: 'close',
  };
  state.stage = transitions[state.stage] ?? state.currentQueue.shift() ?? 'roi_delivery';
}
```

---

## FILE STRUCTURE

### New: call-brain-do/
```
call-brain-do/
  src/
    index.ts              — DO class + fetch handler (routes /turn, /event, /state)
    types.ts              — CallBrainState, NextTurnPacket, BrainEvent, IndustryLanguagePack, ExtractionResult
    state.ts              — initState(), loadState(), persistState()
    gate.ts               — gateOpen(), advance(), buildQueue()
    extract.ts            — extractFromTranscript(), normalizeNumeric(), validateFields()
    moves.ts              — buildNextTurnPacket() — the core per-stall/per-stage move selector
    intel.ts              — mergeIntel(), buildIndustryLanguagePack()
    roi.ts                — runCalcs(), roiDeliveryCheck()
  wrangler.toml
  package.json
  tsconfig.json
```

### wrangler.toml for call-brain-do
```toml
name = "call-brain-do"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[durable_objects]
bindings = [{ name = "CALL_BRAIN", class_name = "CallBrainDO" }]

[[migrations]]
tag = "v1"
new_classes = ["CallBrainDO"]

[[kv_namespaces]]
binding = "LEADS_KV"
id = "0fec6982d8644118aba1830afd4a58cb"
```

### Service binding changes

**Bridge wrangler.toml — ADD:**
```toml
[durable_objects]
bindings = [{ name = "CALL_BRAIN", class_name = "CallBrainDO", script_name = "call-brain-do" }]
```

**fast-intel wrangler.toml — ADD:**
```toml
[[services]]
binding = "CALL_BRAIN_WORKER"
service = "call-brain-do"
```

**Workflow wrangler.toml — ADD:**
```toml
[[services]]
binding = "CALL_BRAIN_WORKER"
service = "call-brain-do"
```

---

## EXACT CUT LINES — What moves out of bridge

### MOVE TO DO (delete from bridge after migration):
| Bridge lines (approx) | Function | Destination |
|----------------------|----------|-------------|
| 348-395 | `Stage`, `Inputs`, `State`, `BLANK` types | `call-brain-do/src/types.ts` |
| 396-430 | `buildQueue()` | `call-brain-do/src/gate.ts` |
| 520-565 | `gateOpen()`, `advance()` | `call-brain-do/src/gate.ts` |
| 566-640 | `runCalcs()` | `call-brain-do/src/roi.ts` |
| 1625-2024+ | `buildStageDirective()` (~400 lines) | `call-brain-do/src/moves.ts` → rewritten as `buildNextTurnPacket()` |
| Extraction logic (scattered) | `extractFromUtterance()` | `call-brain-do/src/extract.ts` |

### KEEP IN BRIDGE:
| Function | Why |
|----------|-----|
| Deepgram WebSocket lifecycle | Transport layer |
| Transcript receive/parse | Input handling |
| `POST /turn` to DO + receive NextTurnPacket | DO RPC |
| Tiny prompt assembly from NextTurnPacket | Prompt compression |
| Gemini streaming | LLM transport |
| TTS stream handling | Output transport |
| Logging / observability (`[REQ]`, `[PROMPT]`, `[BELLA_SAID]`, etc.) | Debug |
| History distillation (conv_memory) | Keep for now, move later |

---

## LATE-DATA HANDLING

### Event-driven intel updates (replaces KV polling)
1. fast-intel completes → `POST /event` to DO with `{ type: 'fast_intel_ready', payload, version }`
2. Consultant completes → `POST /event` to DO with `{ type: 'consultant_ready', payload, version }`
3. Deep scrape completes → `POST /event` to DO with `{ type: 'deep_ready', payload, version }`
4. Each service ALSO writes KV snapshot (replay/debug only)

### Intel merge rules
- Preserve current stage and completed stages
- Only rerank FUTURE stages via `rebuildFutureQueue()`
- Never retroactively replay skipped spoken moves
- Allow new high-value facts to alter future queue and chosen move selection
- `intel.mergedVersion` increments on each merge

### No-surprise-machine rule
Bella never says "I just noticed new data." She naturally surfaces the strongest newly available angle at the next eligible moment.

---

## ROLLOUT PLAN

### Phase 1: Shadow mode
- Bridge still uses old flow as authority
- DO runs in parallel, logs proposed NextTurnPacket
- Compare: `[SHADOW_DIFF] old_stage=wow old_stall=5 do_stage=wow do_stall=5 match=true`

### Phase 2: Read-only compare
- Diff old stage decisions vs DO stage decisions over N test calls
- Flag any divergence for manual review

### Phase 3: Controlled cutover
- Feature flag `USE_DO_BRAIN=true` on bridge
- One internal test environment uses DO as authority
- Old path remains as fallback

### Phase 4: Full cutover
- Bridge no longer reads live state from KV
- Remove force-advance hacks, old state logic, old extraction
- Bridge drops from ~2,680 → ~800-1,000 lines

---

## REQUIRED TESTS

| Test | Validates |
|------|----------|
| session_init creates correct blank state | State initialization |
| fast_intel_ready merges starter intel, builds IndustryLanguagePack | Intel merge |
| consultant_ready enriches without clobbering extracted fields | Merge safety |
| deep_ready reranks only future stages | Late-data queue rebuild |
| user_turn "maybe a hundred" extracts as `100` | Numeric normalization |
| user_turn "about twenty" extracts as `20` | Numeric normalization |
| Stage does NOT advance when required extraction missing | Gate enforcement |
| ROI MUST be delivered before close activates | ROI lock invariant |
| Partial ROI delivered if only 1 channel complete | Partial delivery |
| DO recovers correctly after hibernation/restart | State persistence |
| Bridge prompt stays under 1,500 chars | Prompt budget |
| WOW stall 2 skipped when no rating | Skip logic |
| WOW stall 7 adapts based on ads detection | Adaptive source question |
| WOW stall 8 skipped when no hiring + budget tight | Skip logic |
| NextTurnPacket.chosenMove.text uses IndustryLanguagePack terms | Language pack |
| Shadow mode logs match between old and new paths | Rollout safety |

---

## TASK BACKLOG

### T001: Scaffold call-brain-do worker
- **Priority:** P0
- **Status:** Todo
- **Scope:** Create folder structure, wrangler.toml, package.json, tsconfig.json, empty src/index.ts with DO class skeleton
- **Acceptance Criteria:** `npx wrangler deploy --dry-run` succeeds, DO class exports correctly
- **Validation:** `npx wrangler deploy --dry-run` returns no errors

### T002: Implement types.ts
- **Priority:** P0
- **Status:** Todo
- **Scope:** All TypeScript interfaces from this spec: CallBrainState, NextTurnPacket, BrainEvent, IndustryLanguagePack, ExtractionResult, Stage
- **Acceptance Criteria:** Types compile, no `any` types except intel payloads
- **Validation:** `npx tsc --noEmit`

### T003: Implement state.ts
- **Priority:** P0
- **Status:** Todo
- **Scope:** `initState(callId, leadId)`, `loadState()` from DO storage, `persistState()` to DO storage. Blank extracted values, empty queue, stage='wow', wowStall=1
- **Acceptance Criteria:** State round-trips through DO storage correctly
- **Validation:** Unit test: init → persist → load → assert equal

### T004: Implement gate.ts
- **Priority:** P0
- **Status:** Todo
- **Scope:** `gateOpen()`, `advance()`, `buildQueue()` — ported from bridge lines ~396-565 but using new types and tightened WOW (9 stalls, gate at 10)
- **Acceptance Criteria:** All gate conditions match spec. Queue builds from flags/routing correctly.
- **Validation:** Unit tests for each gate condition, advance transitions, queue priority order

### T005: Implement extract.ts
- **Priority:** P0
- **Status:** Todo
- **Scope:** `extractFromTranscript(transcript, targets)` — deterministic regex + normalizer. Handles: "about twenty"→20, "maybe a hundred"→100, "around fifty thousand"→50000, "weekly"/"monthly", yes/no→boolean. Returns ExtractionResult with confidence.
- **Acceptance Criteria:** All numeric normalization cases pass. Returns null for low-confidence. Never advances on bad data.
- **Validation:** Test suite with 20+ extraction cases from real call transcripts

### T006: Implement roi.ts
- **Priority:** P0
- **Status:** Todo
- **Scope:** `runCalcs(extracted, timeframe)` — ported from bridge lines ~566-640. `roiDeliveryCheck(state)` — returns whether ROI is ready, partially ready, or not ready. ROI lock enforcement.
- **Acceptance Criteria:** Calc results match current bridge output. Lock prevents close without delivery.
- **Validation:** Unit tests with known inputs → expected weekly values

### T007: Implement intel.ts
- **Priority:** P0
- **Status:** Todo
- **Scope:** `mergeIntel(existing, event)` — deep merge, version bump, no clobber of extracted fields. `buildIndustryLanguagePack(intel)` — resolution order: explicit consultant industry → toneAndVoice + service pages → keyword map → generic fallback.
- **Acceptance Criteria:** Merge preserves existing data, new data augments. Language pack resolves for 10+ industries.
- **Validation:** Unit tests for merge conflict scenarios, language pack for legal/dental/trades/agency/medical

### T008: Implement moves.ts (THE BIG ONE)
- **Priority:** P0
- **Status:** Todo
- **Scope:** `buildNextTurnPacket(state)` — replaces the ~400-line `buildStageDirective()` switch. Returns NextTurnPacket for each stage/stall. Uses IndustryLanguagePack everywhere instead of bare `custTerm()`. Implements tightened 9-stall WOW with all skip logic, data timing rules, and adaptive stall 7.
- **Acceptance Criteria:** Every stage/stall produces a valid NextTurnPacket. No stall produces >3 sentences in chosenMove.text. IndustryLanguagePack terms used throughout. All skip conditions respected.
- **Validation:** Snapshot tests: given state+intel → expected NextTurnPacket for each stage/stall combo

### T009: Implement DO index.ts (HTTP handler)
- **Priority:** P0
- **Status:** Todo
- **Scope:** DO class with `fetch()` handler routing: `POST /turn` (user turn), `POST /event` (intel updates), `GET /state` (debug). Each route loads state, processes, persists, returns response. Constructor is cheap (hibernation-safe).
- **Acceptance Criteria:** All three routes work. State persists across requests. Constructor does no heavy lifting.
- **Validation:** curl tests against local wrangler dev

### T010: Bridge refactor — add DO integration path
- **Priority:** P0
- **Status:** Todo
- **Scope:** Add feature flag `USE_DO_BRAIN`. When true: on each user turn, bridge POSTs transcript to DO `/turn`, receives NextTurnPacket, builds tiny prompt from template, streams Gemini. When false: old path unchanged. Add `CALL_BRAIN` DO binding to wrangler.toml.
- **Acceptance Criteria:** Feature flag works. New path produces valid Gemini prompts. Old path untouched.
- **Validation:** Deploy with flag=false → old behavior. Flag=true → DO path works end-to-end.

### T011: Bridge refactor — tiny prompt assembler
- **Priority:** P0
- **Status:** Todo
- **Scope:** New function `buildTinyPrompt(packet: NextTurnPacket): string` that implements the fixed-shape template from this spec. Max 1,500 chars. Replaces the current `buildTurnPrompt()` + `buildStageDirective()` + persona block when DO path is active.
- **Acceptance Criteria:** Output matches template. Never exceeds 1,500 chars. Includes all packet fields.
- **Validation:** Unit test with sample NextTurnPacket → assert char count and structure

### T012: fast-intel — add DO event delivery
- **Priority:** P1
- **Status:** Todo
- **Scope:** After fast-intel writes KV snapshot, also POST `fast_intel_ready` event to DO via service binding. Add `CALL_BRAIN_WORKER` binding to wrangler.toml. Non-blocking (ctx.waitUntil).
- **Acceptance Criteria:** DO receives event. KV write still happens. Failure to reach DO does not break fast-intel.
- **Validation:** Deploy, trigger fast-intel, check DO logs for event receipt

### T013: Workflow — add DO event delivery
- **Priority:** P1
- **Status:** Todo
- **Scope:** After consultant writes KV, POST `consultant_ready` to DO. After deep-scrape writes KV, POST `deep_ready` to DO. Add service binding. Non-blocking.
- **Acceptance Criteria:** DO receives both event types. KV writes still happen. Failures graceful.
- **Validation:** Trigger workflow for test LID, verify DO receives events in order

### T014: Bridge — llm_reply_done event
- **Priority:** P1
- **Status:** Todo
- **Scope:** After Gemini finishes streaming and bridge has the full response text, POST `llm_reply_done` to DO with spokenText and moveId. This lets DO track what was actually spoken and set `roiDelivered` when ROI move is confirmed.
- **Acceptance Criteria:** DO updates spoken.moveIds and flags.roiDelivered correctly
- **Validation:** Test call through ROI delivery stage, verify DO state shows roiDelivered=true

### T015: Shadow mode logging
- **Priority:** P1
- **Status:** Todo
- **Scope:** When `USE_DO_BRAIN=false`, bridge still calls DO `/turn` in background (ctx.waitUntil) and logs `[SHADOW_DIFF]` comparing old vs new stage/stall decisions. No impact on live call.
- **Acceptance Criteria:** Shadow logs appear in wrangler tail. Old path unaffected.
- **Validation:** Run test call with flag=false, verify shadow diff logs appear

### T016: Deploy Bug 2 fix (consultant name authority)
- **Priority:** P0
- **Status:** Todo
- **Scope:** From BUG_REPORT_v9.13.2.md section 2.6 — fast consultant is name authority, full is analysis authority. ~15 lines.
- **Acceptance Criteria:** Business name from fast consultant survives full consultant merge
- **Validation:** Test with known business, verify name correct in KV intel

### T017: Deploy Bug 1 fix (voice agent _pendingUrlHints)
- **Priority:** P0
- **Status:** Todo
- **Scope:** From BUG_REPORT_v9.13.2.md section 1.6 — override fetch() on BellaAgent to capture URL params before SDK handles upgrade. ~30 lines.
- **Acceptance Criteria:** firstName correctly available in DO onConnect
- **Validation:** Test call, verify firstName appears in greeting

---

## EXECUTION ORDER

```
Phase A — Pre-requisites (ship first, unblock everything):
  T016: Bug 2 fix (consultant name authority)
  T017: Bug 1 fix (voice agent _pendingUrlHints)

Phase B — DO core (build, test locally):
  T001: Scaffold call-brain-do
  T002: types.ts
  T003: state.ts
  T004: gate.ts
  T005: extract.ts
  T006: roi.ts
  T007: intel.ts
  T008: moves.ts (THE BIG ONE — depends on T002-T007)
  T009: DO index.ts (depends on T002-T008)

Phase C — Integration (connect bridge to DO):
  T010: Bridge DO integration path
  T011: Bridge tiny prompt assembler
  T015: Shadow mode logging

Phase D — Event pipeline (connect enrichment to DO):
  T012: fast-intel DO event delivery
  T013: Workflow DO event delivery
  T014: Bridge llm_reply_done event

Phase E — Cutover:
  Shadow mode testing (N calls)
  Controlled cutover (flag=true)
  Full cutover (remove old path)
```

---

## DEFINITION OF DONE

- [ ] call-brain-do deploys and accepts /turn, /event, /state requests
- [ ] Bridge with USE_DO_BRAIN=true produces valid calls end-to-end
- [ ] NextTurnPacket prompts stay under 1,500 chars
- [ ] Extraction validates before advancing (no more cascading nulls)
- [ ] ROI delivery is enforced (close blocked until ROI spoken)
- [ ] IndustryLanguagePack used throughout (no bare custTerm)
- [ ] 9-stall WOW with merged source question works correctly
- [ ] Shadow mode shows <5% divergence from old path on test calls
- [ ] Late intel events reach DO and rerank future stages
- [ ] All 16 required tests pass

---

## CONSTRAINTS & RULES

1. **DO constructor must be cheap.** Hibernated DOs re-run constructor on wake. All state loads from DO storage, not computed in constructor.
2. **KV is snapshot-only.** Bridge + DO never read KV for live state. KV writes are for replay/debug.
3. **One change at a time.** Deploy → verify → next. Per GSD principles.
4. **Bridge old path preserved.** Feature flag controls which path is active. Old path is rollback.
5. **No unsolicited tests or browser opens.** Wait for Trent.
6. **Version bump on every deploy.** Tag format: `v2.0.0-do-alpha.N`
7. **Local folders deploy to existing worker names.** See CLAUDE.md naming convention.
8. **call-brain-do is a NEW worker** — new wrangler.toml, new deployment, referenced via service binding from bridge.
9. **Never touch V6 or V7 workers.**
10. **LID sanitization mandatory:** `lid.replace(/[^a-z0-9]/gi, '')`

---

## OPEN QUESTIONS

1. Should DO use raw DO storage API or Agents SDK `setState()`? — **Decision: Raw DO storage.** Bella's voice agent is already raw DO, not Agents SDK. Keep consistent.
2. Should extraction use a separate Gemini call or deterministic regex? — **Decision: Deterministic regex first.** Faster, cheaper, no LLM latency. Add Gemini extraction as P2 fallback for complex cases only.
3. Should IndustryLanguagePack live in DO or be generated by consultant? — **Decision: Generated by consultant, stored in DO intel.** Consultant already has industry analysis. DO receives it via `consultant_ready` event.
4. How does bridge get DO stub for a call? — **Decision: `env.CALL_BRAIN.get(env.CALL_BRAIN.idFromName(callId))`** using callId (same as leadId) as the DO name.

---

## DISCOVERED ISSUES LOG

_New issues must be appended here with a timestamp and brief context._

---

*End of spec. This file is the source of truth for the DO brain migration. CC executes from this. Claude.ai maintains it.*
