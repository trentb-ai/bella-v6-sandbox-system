# MVPScriptBella — SESSION REPORT: Bugs, Discoveries & Cloudflare Insights
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### D1 ID: doc-mvpscriptbella-t9-session-report-bugs-discoveries-20260421
### Purpose: Permanent record of every bug found, every insight gained, and every CF official reference used in the 2026-04-21 architecture session.

---

## SESSION SUMMARY (one paragraph)

T9 Architect came online to a seemingly-complete S1 spec (base + Rev A + Rev B + Rev C) that had passed initial T3 gate. Within hours, T3's deeper Codex review revealed S1's entire implementation was UNREACHABLE due to a wrangler.toml flag. This led to an architecture cascade: the flag fix exposed a state persistence problem (KV eventual consistency), which led to official CF documentation research proving KV is fundamentally wrong for the use case, which led to a DO state storage solution, which led to T3 finding gate logic was turn-count-only (no extract verification). Each discovery built on the last. The session produced Rev D — 5 targeted changes that transform S1 from "correct but unreachable and fragile" to "correct, reachable, strongly consistent, and properly gated."

---

## BUG #1: THE UNREACHABLE S1 (Critical — entire sprint was dead code)

### Discovery
T3 Codex review (gpt-5.4, 50,539 tokens, session 019daf21) found that `USE_DO_BRAIN = "true"` in bridge wrangler.toml routes every turn through brain DO path. The execution flow:

```
Line 2232: const doResult = await callDOTurn(...)
Line 2249: buildDOTurnPrompt(doResult, ...) — builds prompt from DO path
Line 2256: buildFullSystemContext(...) — S1 TURN BEHAVIOR appended as "--- REFERENCE DATA ---" only
Line 2348: return streamToDeepgram(...) — RETURNS here. Inline path never executes.
```

S1's gateOpen, advance, buildStageDirective, TURN BEHAVIOR block — all correctly implemented per spec. All completely unreachable. The bridge function returns from the DO path before the inline code runs.

### Why it was missed
S1 was specced against the inline code path without anyone checking which path ACTUALLY EXECUTES in production. The wrangler.toml flag was set during an earlier session when the brain DO was primary. Nobody verified the execution path during spec writing.

### Impact
100% of S1 work was dead code. Every canary would have shown zero improvement — Bella would still use the old DO stage machine with DELIVER_THIS markers and old output rules.

### Fix
`USE_DO_BRAIN = "false"` in wrangler.toml. Single line. But this fix exposed Bug #2.

### Lesson
**Always verify the execution path before speccing changes to it.** Reading the code is not enough — you must trace which branch ACTUALLY RUNS in production config. Wrangler.toml environment variables control execution routing and can make entire code paths dead.

---

## BUG #2: KV EVENTUAL CONSISTENCY FOR SCRIPT STATE (Critical — mid-call state reset)

### Discovery
Once Bug #1 was identified (flag flip needed), T2 raised the state persistence question: S1's inline path uses KV for script_state. T2 provided exact CF documentation quotes. T9 initially recommended "ship on KV, canary for it" — then Trent pushed back: "TELL ME DIRECTLY WHAT YOUR INTERPRETATION IS — READ THE OFFICIAL CLOUDFLARE GUIDANCE FIRST."

T9 fetched official CF docs directly. The findings were unambiguous.

### Official Cloudflare Documentation (exact quotes, fetched 2026-04-21)

**From developers.cloudflare.com/kv/concepts/how-kv-works/:**

> "KV achieves high performance by being eventually-consistent."

> Changes are usually immediately visible at the location where made, but "this is not guaranteed and therefore it is not advised to rely on this behaviour."

> "Changes may take up to 60 seconds or more to be visible in other global network locations as their cached versions of the data time out."

> "Negative lookups indicating that the key does not exist are also cached, so the same delay exists noticing a value is created as when a value is changed."

> KV is unsuitable for "write-heavy Redis-type workloads" with frequent updates to identical keys. It suits "read-heavy, highly cacheable workloads."

> KV "is not ideal for applications where you need support for atomic operations or where values must be read and written in a single transaction."

**From developers.cloudflare.com/durable-objects/api/storage-api/:**

> "The Durable Object Storage API allows Durable Objects to access transactional and strongly consistent storage."

> Read-after-write guaranteed: "the copy from the write buffer will be returned, thus ensuring consistency with the latest call to put()."

> `put()` "usually completes immediately, because put() writes to an in-memory write buffer that is flushed to disk asynchronously."

### The mismatch
Script_state access pattern:
- Written EVERY turn (state update after advance/capture)
- Read EVERY turn (state load at turn start)
- Must be current (stale state = wrong stall = wrong script = broken call)
- Same key updated repeatedly (`lead:{lid}:script_state`)

CF says KV is for: read-heavy, cacheable, eventually-consistent workloads. Script_state is the OPPOSITE.

### The failure mode
1. Turn 3: bridge writes updated state to KV (stall=4, confirmed fields populated)
2. Turn 4: bridge reads KV — gets null (propagation delay or cached negative lookup)
3. BLANK_STATE fallback fires: stage resets to 'wow', stall resets to 1
4. Bella delivers research intro AGAIN mid-call
5. Call is dead. Prospect confused.

The cached negative lookup is especially insidious: CF explicitly says "Negative lookups indicating that the key does not exist are also cached." If the very first read happens before the first write propagates, the "not found" result gets cached, potentially causing multiple subsequent reads to also return null.

### T9's initial mistake
T9 initially recommended shipping on KV with canary monitoring, arguing same-colo reads are "usually" fine. Trent's instinct pushed for reading the actual docs. The docs proved KV is wrong — not "risky", wrong. CF explicitly says don't rely on same-location visibility. T9 corrected the recommendation to DO state storage.

### Fix
DO state storage endpoints on brain DO (GET/PUT /s1-state). Bridge reads/writes state via DO RPC instead of KV. Strong consistency guaranteed. Sub-millisecond latency (DO put writes to memory buffer).

### Lesson
**"Usually works" is not an architecture.** When CF themselves say "not advised to rely on this behaviour," believe them. For voice calls where the failure mode is catastrophic (mid-call reset), you need guarantees, not probabilities. Always read official documentation before making persistence architecture decisions — don't rely on assumptions about how KV "probably" works.

**Second lesson: Trent's gut was right.** When the founder says "read the official docs," do it immediately. Don't rationalize around it.

---

## BUG #3: TURN-COUNT-ONLY GATES (Medium — Bella advances on "hmm")

### Discovery
T3 Codex review flagged that S1's `gateOpen` function uses `turns_in_stall >= 1` for all stalls. This is a timer, not a gate.

### The problem
```
Stall 7 (Source Check): Bella asks "Where do most of your leads come from?"
Prospect: "hmm"
gateOpen: turns_in_stall >= 1 → TRUE
advance() fires → stall 8
source_answer = "hmm" (captured by Rev C)
```

Bella moves on without getting a real answer. The brain DO has extract-verified gates (advance only when required data extracted OR safety net fires). S1's gates were a regression from DO rigor.

### Why it was missed
S1 spec focused on getting the RIGHT CONTENT to Gemini (stage machine, prompt architecture, script markers). Gate logic was carried over from the old inline path without questioning whether turn-count gating was sufficient. The brain DO's extract-based gates weren't referenced during S1 spec writing.

### Fix
Extract-verified gates on critical stalls:
- Stall 3: ICP confirmation (agreement regex OR utterance >50 chars) OR turns >= 3
- Stall 6: Explicit deeper_requested signal required (recommend vs explore regex), NO turn-count bypass
- Stall 7: source_answer length > 10 OR turns >= 3
- Stall 8: funnel_answer length > 10 OR turns >= 3

Safety nets (turns >= 3) prevent Bella getting stuck forever if prospect gives non-parseable answers.

### Lesson
**Gate logic is as important as content logic.** Getting the right words to Gemini is half the battle. Ensuring Bella only advances when the prospect has actually engaged is the other half. Always compare gate rigor against the strongest existing implementation (brain DO in this case).

---

## BUG #4: SHADOW MODE COMPETING WRITES (Low — confusion risk)

### Discovery
With USE_DO_BRAIN=false, the inline S1 path executes. But shadow mode (`ctx.waitUntil(callDOTurn(...))`) still fires brain DO's `/turn` endpoint in the background. This means two stage machines run simultaneously on every turn — S1 inline writing `s1_script_state` to DO storage, and moves.ts ConversationState writing its own state to the same DO instance (different key).

### The problem
Not functionally broken (different storage keys), but creates:
- Unnecessary DO invocations (cost + latency budget waste)
- Confusing debug logs (two sets of stage transitions per turn)
- Potential for future maintenance confusion (which stage machine is "real"?)

### Fix
Guard shadow mode behind USE_DO_BRAIN flag. If false, no shadow call.

---

## BUG #5: DEAD ROI_DELIVERY REFERENCE (Trivial)

### Discovery
T3 found `roi_delivery` stage reference at line ~2314. Stage type union is `'wow' | 'recommend' | 'close' | 'done'`. The `roi_delivery` case never matches.

### Fix
Delete the reference. One line.

---

## INSIGHT #1: THE DUAL STAGE MACHINE PROBLEM

The deepest architectural insight from this sprint: Bella has TWO stage machines and nobody realized they were both "live" in different senses.

**Brain DO (moves.ts):** wow_1→wow_7, structured StageDirective objects, 361 tests, strongly consistent DO storage. Used when USE_DO_BRAIN=true.

**Bridge inline:** 10 stalls with channels/ROI/deep-scrape stages. Used when USE_DO_BRAIN=false. Written for the old V8/V9 flow.

S1 replaces the bridge inline machine with an 8-stall canonical script flow. But because USE_DO_BRAIN=true, S1 was replacing code that wasn't even running. The "fix" was fixing dead code while the live code (DO path) continued unchanged.

**This is documented in:** doc-mvpscriptbella-dual-stage-machine-analysis-20260421 (T2's analysis)

### Lesson
When a system has feature flags that control execution routing, the FIRST question for any spec is: "Which path runs in production?" Not "what does the code say?" but "what does the CONFIG say the code does?"

---

## INSIGHT #2: CF KV vs DO STORAGE — THE DECISION FRAMEWORK

This session produced a clear decision framework for Bella's persistence layer:

| Access Pattern | Use KV | Use DO Storage |
|---|---|---|
| Read-heavy, rarely written | ✅ | Overkill |
| Written once, read many (intel envelope) | ✅ | Overkill |
| Written every request, read every request | ❌ | ✅ |
| Must be current (stale = broken) | ❌ | ✅ |
| Acceptable to be 60s stale | ✅ | Overkill |
| Cross-colo reads needed | ✅ (it's designed for this) | ❌ (single colo) |

**Bella-specific mapping:**
- `lead:{lid}:fast-intel` → KV ✅ (written once by fast-intel, read by bridge, acceptable if 30s stale)
- `lead:{lid}:conv_memory` → KV ✅ (written per turn but loss = miss context signals, not catastrophic)
- `lead:{lid}:script_state` → DO Storage ✅ (written per turn, read per turn, must be current, stale = broken call)

### Key CF quote to remember
> "Negative lookups indicating that the key does not exist are also cached"

This means the first-read-before-first-write problem is WORSE than simple propagation delay. A cached "not found" can persist even after the write propagates, because the negative lookup itself is cached at the edge.

---

## INSIGHT #3: TRENT'S GUT > T9'S FIRST ANALYSIS

T9 initially recommended shipping on KV with canary monitoring. The reasoning was sound in isolation: same-colo reads are "usually" fine, turn cadence gives propagation time, canary would catch failures.

Trent said: "READ THE OFFICIAL CLOUDFLARE GUIDANCE FIRST."

The official docs proved T9's recommendation wrong. "Usually" is not an architecture for voice calls where failure = dead call. CF explicitly warns against the exact pattern S1 was using.

### Lesson for future architects
When the founder pushes back on a technical recommendation and asks you to verify against primary sources — do it immediately and thoroughly. Don't defend the initial analysis. Read the docs. The docs are the authority, not your mental model of how the system "probably" works.

---

## CLOUDFLARE REFERENCE CARD (save this — reusable across all Bella work)

### KV
- **Consistency:** Eventually consistent. Same-location "usually" immediate but "not guaranteed and not advised to rely on."
- **Propagation:** Up to 60s cross-colo. Negative lookups also cached.
- **Best for:** Read-heavy, cacheable, write-infrequent data. Config, intel envelopes, static assets.
- **Not for:** Write-every-request state, transactional data, anything where stale = broken.
- **Doc URL:** developers.cloudflare.com/kv/concepts/how-kv-works/

### DO Storage
- **Consistency:** Transactional, strongly consistent. Read-after-write guaranteed.
- **Performance:** put() writes to in-memory buffer (sub-ms). get() reads from buffer if pending write.
- **Best for:** Per-entity state that changes frequently and must be current. Session state, conversation state, game state.
- **Constraint:** Single-colo (DO is pinned). Private to DO instance.
- **Doc URL:** developers.cloudflare.com/durable-objects/api/storage-api/

### Service Bindings
- **Same-colo:** Service binding calls typically execute in same colo as caller.
- **Implication:** Bridge called from voice agent DO (pinned) via service binding → likely same colo. DO state RPC from bridge → same colo as the DO.
- **Error 1042:** Worker-to-Worker calls via public URL blocked by CF. MUST use service bindings.

---

## COMPLETE BUG REGISTRY

| # | Bug | Severity | Found by | Fixed in |
|---|---|---|---|---|
| 1 | USE_DO_BRAIN=true makes S1 unreachable | CRITICAL | T3 Codex | Rev D Change 1 |
| 2 | KV eventual consistency for script_state | CRITICAL | T2 + T9 CF docs | Rev D Change 2 |
| 3 | Turn-count-only gates (advance on "hmm") | MEDIUM | T3 Codex | Rev D Change 3 |
| 4 | Shadow mode competing writes | LOW | T9 | Rev D Change 5 |
| 5 | Dead roi_delivery reference | TRIVIAL | T3 | Rev D Change 4 |
| 6 | Capture guard prevents capture (turns_in_stall check) | CRITICAL | T3 | Rev C (prior) |
