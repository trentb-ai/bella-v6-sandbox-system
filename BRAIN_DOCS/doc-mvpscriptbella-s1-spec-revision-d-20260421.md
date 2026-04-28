# MVPScriptBella S1 — Spec Revision D
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### D1 ID: doc-mvpscriptbella-s1-spec-revision-d-20260421
### Status: APPROVED BY TRENT — ready for T2 implementation spec + T3 gate
### Supersedes: Nothing. ADDITIVE to base S1 + Rev A + Rev B + Rev C.

---

## PURPOSE

Four additions to S1 discovered during T3 gate review + T9 architecture analysis. All are S1 completeness requirements — without them, S1 either doesn't execute (flag), fails silently (KV), or advances incorrectly (gates).

---

## CHANGE 1: USE_DO_BRAIN FLAG FLIP

### What
Set `USE_DO_BRAIN = "false"` in `workers/bridge/wrangler.toml`.

### Why
With `USE_DO_BRAIN=true`, bridge routes every turn through `callDOTurn()` → `buildDOTurnPrompt()` → returns before inline path executes. S1's gateOpen/advance/buildStageDirective/TURN BEHAVIOR never fires. S1 is correct but unreachable.

### Scope
Single line in wrangler.toml: `USE_DO_BRAIN = "false"`

### Effect
- Bridge inline path (S1) becomes primary execution path
- Brain DO no longer called on critical path
- Shadow mode (ctx.waitUntil DO call) also disabled (see Change 5)
- Brain DO stays deployed, untouched, available for V3

### Verification
After flag flip, `buildDOTurnPrompt` should never execute during a call. Confirm via wrangler tail: no `[DO_TURN]` log tags, only S1 inline `[ADVANCE]`, `[STAGE]`, `[BELLA_SAID]` tags.

---

## CHANGE 2: DO STATE STORAGE ENDPOINTS

### What
Add two endpoints to brain DO (`workers/brain/src/index.ts`) for S1 script_state persistence. Bridge reads/writes script_state via DO RPC instead of KV.

### Why (CF official documentation — exact quotes)
- KV: "eventually-consistent", same-location visibility "is not guaranteed and therefore it is not advised to rely on this behaviour"
- KV: negative lookups (key not found) are cached — if turn N+1 reads before turn N write propagates, "not found" itself gets cached
- KV: "Not ideal for applications where values must be read and written in a single transaction"
- DO Storage: "transactional and strongly consistent", read-after-write guaranteed
- DO Storage: `put()` writes to in-memory buffer (sub-ms), `get()` reads from buffer if pending write exists

Script_state is written every turn, read every turn, must be current. KV is designed for read-heavy cacheable workloads. DO Storage is designed for exactly this access pattern.

Failure mode without this: turn N writes state to KV. Turn N+1 reads null (propagation delay or cached negative lookup). BLANK_STATE fallback fires. Bella resets to stall 1 mid-call. Call is dead.

### Brain DO: Two new endpoints

**GET /s1-state?lid={leadId}**
- Read `this.state.storage.get('s1_script_state')`
- Return JSON body (the serialized State object) or `null` if not found
- No authentication needed (internal service binding only)
- Does NOT touch ConversationState, moves.ts, or any existing DO logic

**PUT /s1-state**
- Body: `{ lid: string, state: <serialized State JSON> }`
- Write `this.state.storage.put('s1_script_state', state)`
- Return 200 OK
- Does NOT touch ConversationState, moves.ts, or any existing DO logic

### Storage key isolation
- Use key `s1_script_state` — NOT `conversationState` or any existing key
- Brain DO's existing ConversationState blob is completely separate
- Two stage machines' state coexist in same DO instance on different storage keys — no conflict

### Brain DO: Routing
Add to the existing `fetch()` handler's URL router:
```
/s1-state GET  → read s1_script_state from storage
/s1-state PUT  → write s1_script_state to storage
```
Existing routes (`/turn`, `/state`, `/health`, etc.) unchanged.

### Bridge: State read swap

**Current (KV):**
```typescript
const raw = await env.LEADS_KV.get(`lead:${lid}:script_state`);
const state = raw ? JSON.parse(raw) : BLANK_STATE(lid);
```

**New (DO RPC via CALL_BRAIN binding):**
```typescript
const doId = env.CALL_BRAIN.idFromName(lid);
const doStub = env.CALL_BRAIN.get(doId);
const res = await doStub.fetch(new Request('https://do/s1-state?lid=' + lid));
const raw = res.ok ? await res.text() : null;
const state = raw ? JSON.parse(raw) : BLANK_STATE(lid);
```

### Bridge: State write swap

**Current (KV, fire-and-forget):**
```typescript
ctx.waitUntil(env.LEADS_KV.put(`lead:${lid}:script_state`, JSON.stringify(state)));
```

**New (DO RPC, awaited):**
```typescript
const doId = env.CALL_BRAIN.idFromName(lid);
const doStub = env.CALL_BRAIN.get(doId);
await doStub.fetch(new Request('https://do/s1-state', {
  method: 'PUT',
  body: JSON.stringify({ lid, state }),
}));
```

**Note:** State write MUST be AWAITED, not fire-and-forget. Strong consistency means the write confirms before the turn response completes. Guarantees next turn reads current state. Cost: sub-ms (DO put is memory buffer write).

### Error handling
- READ failure: log `[ERR] DO state read failed`, use BLANK_STATE (acceptable on first turn only)
- WRITE failure: log `[ERR] DO state write failed` — CRITICAL. Retry once. If retry fails, log `[ERR] DO state write FAILED TWICE` and continue (state will be stale next turn but call continues).
- No KV fallback. KV script_state writes REMOVED entirely to avoid split-brain.

### Bridge: Remove old KV script_state operations
- Delete all `env.LEADS_KV.get('lead:${lid}:script_state')` calls
- Delete all `env.LEADS_KV.put('lead:${lid}:script_state', ...)` calls
- KV keys `lead:{lid}:script_state` become dead/orphaned — no cleanup needed

### CALL_BRAIN binding
Bridge wrangler.toml already has `CALL_BRAIN` binding to `mvpscriptbellabrain`. No new binding needed. T4 verify exists before implementation.

---

## CHANGE 3: EXTRACT-VERIFIED GATES

### What
Replace turn-count-only gating with extract-verified gates on critical stalls.

### Why
Current S1 gateOpen: `turns_in_stall >= 1` = prospect spoke once = advance. This is a timer, not a gate. Bella advances stall 7 with prospect saying "hmm" → source_answer = "hmm". Bella advances stall 3 without ICP confirmed. Brain DO has extract-based gates — S1 must match that rigor.

### Gate logic per stall

**Stall 1 (Research Intro):** `turns_in_stall >= 1` — unchanged. Bella delivers, prospect responds, advance.

**Stall 2 (Reputation Trial):** `turns_in_stall >= 1` — unchanged. Bella delivers or skips. Simple.

**Stall 3 (ICP):**
```typescript
gateOpen = turns_in_stall >= 3
  || (turns_in_stall >= 1 && /\b(yes|yeah|yep|that's right|exactly|correct|spot on|absolutely|for sure|definitely)\b/i.test(utterance))
  || (turns_in_stall >= 1 && utterance.length > 50)
```
ICP confirmation = agreement words OR prospect elaborates (>50 chars). Safety net at turns >= 3.

**Stall 4 (Conversion CTA):** `turns_in_stall >= 1` — unchanged. Bella delivers consultant narrative, prospect responds, advance.

**Stall 5 (Alignment Bridge):** `turns_in_stall >= 1` — unchanged. Generic bridge.

**Stall 6 (Explore or Recommend):**
```typescript
gateOpen = state.deeper_requested !== null
```
Must have explicit signal. Regex on utterance:
- Recommend signals: `/\b(recommend|which agents?|what do you suggest|show me|let's see|let me see|sounds good|go ahead)\b/i` → `deeper_requested = false`
- Deeper signals: `/\b(tell me more|want to understand|what else|go deeper|more questions|explore|keep going)\b/i` → `deeper_requested = true`
- NO turn-count safety net. If stuck after 3 turns with no signal, Bella asks directly (directive should include: "If no clear signal after 2 turns, ask: Would you like me to give you my recommendation, or would you prefer to explore a couple more questions first?")

**Stall 7 (Source Check):**
```typescript
gateOpen = turns_in_stall >= 3
  || (state.confirmed.source_answer != null && state.confirmed.source_answer.length > 10)
```
source_answer captured from utterance (per Rev C). Must be substantive (>10 chars). Safety net at turns >= 3.

**Stall 8 (Funnel Questions):**
```typescript
gateOpen = turns_in_stall >= 3
  || (state.confirmed.funnel_answer != null && state.confirmed.funnel_answer.length > 10)
```
Same pattern as stall 7.

**Recommend / Close / Done:** `turns_in_stall >= 1` — unchanged. Delivery stages, not capture stages.

### Implementation location
All gate logic lives in `gateOpen(state, utterance)` function in bridge inline path. Single function, single location.

### State interface
No new fields needed — `source_answer`, `funnel_answer`, `deeper_requested` already exist in S1 spec. Change is gateOpen reading them + deeper_requested capture logic in the turn handler.

### Deeper_requested capture
Add to turn handler (after Rev C's STEP 1 captures, before STEP 3 gateOpen):
```typescript
if (s.stage === 'wow' && s.stall === 6 && s.deeper_requested === null) {
  if (/\b(recommend|which agents?|what do you suggest|show me|let's see|let me see|sounds good|go ahead)\b/i.test(utterance)) {
    s.deeper_requested = false;
  } else if (/\b(tell me more|want to understand|what else|go deeper|more questions|explore|keep going)\b/i.test(utterance)) {
    s.deeper_requested = true;
  }
}
```

---

## CHANGE 4: DEAD CODE CLEANUP

### What
Delete dead `roi_delivery` stage reference at line ~2314 in bridge.

### Why
Stage type union is `'wow' | 'recommend' | 'close' | 'done'`. `roi_delivery` never matches. Dead code.

### Scope
Delete the case/branch/reference. Trivial.

---

## CHANGE 5: SHADOW MODE DISABLE

### What
Disable shadow mode (ctx.waitUntil DO call) when USE_DO_BRAIN=false.

### Why
Shadow mode calls brain DO `/turn` in background, running moves.ts ConversationState — a different stage machine. With S1 as primary and DO state endpoints for persistence, shadow writes create confusion (two stage machines writing to same DO instance on different keys). Clean boundary = no shadow.

### Scope
Remove or guard the `ctx.waitUntil(callDOTurn(...))` block behind the USE_DO_BRAIN flag. If flag is false, no shadow call.

---

## SUPERSESSION CHAIN (complete)

1. **Base S1 spec** — DELETE/REPLACE/ADD scope for stage machine + prompt
2. **Revision A** — Unified TURN BEHAVIOR, markers, KB, fidelity
3. **Revision B** — prevStall ordering, KB read timing, skip cleanup, stall 6 hold, label fix
4. **Revision C** — Capture guard fix (remove turns_in_stall >= 1 from capture conditions)
5. **Revision D (this doc)** — ADDITIVE. Flag flip, DO state endpoints, extract-verified gates, dead code cleanup, shadow mode disable

Everything not explicitly superseded stands as written.

---

## VERIFICATION CHECKLIST (for T2 6-gate + T3 Codex gate)

- [ ] USE_DO_BRAIN = "false" in wrangler.toml
- [ ] Brain DO has GET/PUT /s1-state endpoints using this.state.storage
- [ ] Brain DO uses key `s1_script_state` (not conflicting with existing keys)
- [ ] Bridge reads script_state from DO RPC, not KV
- [ ] Bridge writes script_state to DO RPC (AWAITED, not fire-and-forget)
- [ ] All KV script_state read/write calls removed from bridge
- [ ] Error handling: read failure = BLANK_STATE + [ERR]; write failure = [ERR] + retry once
- [ ] Shadow mode disabled when USE_DO_BRAIN=false
- [ ] Stall 3 gate: ICP confirmation OR turns >= 3
- [ ] Stall 6 gate: explicit deeper_requested signal required, no turn-count bypass
- [ ] Stall 6: deeper_requested capture regex in turn handler
- [ ] Stall 7 gate: source_answer length > 10 OR turns >= 3
- [ ] Stall 8 gate: funnel_answer length > 10 OR turns >= 3
- [ ] Dead roi_delivery reference deleted
- [ ] No [DO_TURN] log tags during canary (DO path not executing)
- [ ] S1 [ADVANCE], [STAGE], [BELLA_SAID] tags present every turn
