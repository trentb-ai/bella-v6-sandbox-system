# MVPScriptBella — SESSION REPORT: The Evolution of S1
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### D1 ID: doc-mvpscriptbella-t9-session-report-evolution-20260421
### Purpose: Narrative of how S1 evolved from initial spec to final Rev D — the decisions, wrong turns, corrections, and refinements.

---

## THE STARTING POINT: "S1 IS DONE, JUST NEEDS T3 RE-GATE"

When T9 came online on 2026-04-21, the handover doc painted a rosy picture:

- S1 spec complete (base + Rev A + Rev B)
- T3 had already done initial gate, found P0/P1 issues
- Rev B fixed those issues
- T4 was implementing
- Next step: T3 re-gate on revised spec → T4 finishes → deploy

The sprint plan showed S1 as the big sprint, with S2-S4 as smaller follow-ups. Everything looked sequential and manageable. The spec chain was clean: base defined scope, Rev A unified the prompt architecture, Rev B fixed specific T3 findings.

**What nobody had checked: does the code path that S1 modifies actually execute in production?**

---

## PHASE 1: T3 DROPS THE BOMB — S1 IS UNREACHABLE

T2 forwarded raw T3 findings (no interpretation, per protocol). The key line:

> `wrangler.toml: USE_DO_BRAIN = "true"`

T3 traced the execution:
1. `callDOTurn()` fires (line 2232)
2. `buildDOTurnPrompt()` builds prompt from DO path (line 2249)
3. S1's TURN BEHAVIOR gets appended as `--- REFERENCE DATA ---` (not primary)
4. `return streamToDeepgram()` — function RETURNS (line 2348)
5. Inline path (S1) never executes

T3 offered two options:
- **Option A:** Set USE_DO_BRAIN=false
- **Option B:** Update buildDOTurnPrompt to use S1 markers

### T9's first architectural call (correct)

Option A. Three reasons:
1. Locked Decision #1 is "Option B architecture — port canonical script into bridge, brain DO untouched." The inline path IS the canonical path.
2. T3's Option B would feed S1 markers into a prompt built from DO's WRONG stage machine (different stalls, different content). Two competing content sources = the exact dual-stage-machine problem we're fixing.
3. Clean boundary: USE_DO_BRAIN=false makes bridge self-contained.

**Flagged: needs Trent GO before execution (changes production code path).**

Trent approved the direction.

---

## PHASE 2: T2 RAISES THE STATE PERSISTENCE QUESTION

With Option A locked, T2 sent a comprehensive architecture brief. The core question: if S1 uses KV for script_state and KV is eventually consistent, what happens when turn N+1 reads before turn N's write propagates?

T2 provided:
- CF official doc quotes on KV consistency
- CF official doc quotes on DO storage consistency
- T3 Codex analysis of three options (Port S1 into DO / DO as state store / Update DO output format)
- T5 code findings on extraction and memory mechanisms
- Risk/benefit matrix for each option

Three options emerged:

| Option | What | Scope | Verdict |
|---|---|---|---|
| Option 1: Port S1 into brain DO | Replace moves.ts with S1 | 3-4 weeks | Not MVP |
| Option 2: DO as state store | S1 in bridge, state in DO | Days | MVP-correct |
| Option 3: Update DO output format | Keep DO primary, change markers | 1-2 weeks | Hidden scope trap |

### T9's second architectural call (WRONG — later corrected)

T9 recommended: "Ship S1 with KV as-is. Canary for state consistency. Option 2 ready as S1.5 if canary reveals resets."

The reasoning:
- Same-colo KV reads are "usually" fine
- Turn cadence (5-30s) gives propagation time
- Canary would catch failures
- Don't expand S1 scope mid-sprint

**This was the wrong call.** T9 was optimizing for sprint velocity over architectural correctness. "Usually works" is not good enough for voice calls where failure = dead call.

---

## PHASE 3: TRENT PUSHES BACK — "READ THE OFFICIAL DOCS"

Trent's exact words: "TELL ME DIRECTLY WHAT YOUR INTERPRETATION IS — READ THE OFFICIAL CLOUDFLARE GUIDANCE FIRST"

This was the pivot moment. T9 fetched both CF doc pages directly.

### What the docs actually say

**KV (developers.cloudflare.com/kv/concepts/how-kv-works/):**
- "KV achieves high performance by being eventually-consistent."
- Same-location visibility "is not guaranteed and therefore it is not advised to rely on this behaviour."
- "Negative lookups indicating that the key does not exist are also cached"
- "Not ideal for applications where you need support for atomic operations or where values must be read and written in a single transaction"
- Best for "read-heavy, highly cacheable workloads"

**DO Storage (developers.cloudflare.com/durable-objects/api/storage-api/):**
- "Transactional and strongly consistent storage"
- Read-after-write guaranteed
- put() = in-memory buffer, sub-ms
- get() reads from buffer if pending write exists

### T9 corrects course

After reading the actual docs, T9 reversed the recommendation:

> "KV is wrong for script_state. Not 'risky.' Wrong."

> Script_state is written every turn, read every turn, must be current. CF explicitly says KV is for "read-heavy, highly cacheable workloads." Script_state is the opposite.

> "I was wrong in my earlier brief to T2 when I said 'ship on KV, canary for it.' The CF docs are unambiguous."

Recommended Option 2: DO as state store. Small scope (~50 lines total). Strong consistency guaranteed.

**Trent's response: "EXCELLENT analysis my gut told me the same thing."**

### The leadership lesson

Trent didn't accept T9's initial "probably fine" recommendation. He pushed for primary-source verification. The docs proved him right. This is what good technical leadership looks like: trust your gut, demand evidence, course-correct fast.

---

## PHASE 4: T3 FINDS THE GATE LOGIC GAP

While the state persistence discussion was happening, T3 sent a comprehensive architecture brief (direct to T9 — slight protocol deviation, but the content was valuable). T3 flagged:

> S1's current gateOpen is turn-count only. `turns_in_stall >= 1` = prospect spoke once = advance. This is a timer, not a gate.

Examples:
- Stall 7: Bella asks about lead sources. Prospect says "hmm." Gate opens. Bella moves on. source_answer = "hmm."
- Stall 3: Bella delivers ICP narrative. Prospect says anything. Gate opens. No confirmation that ICP landed.

The brain DO has extract-verified gates: advance only when required fields extracted OR safety net fires. S1's gates were a regression.

T3 also flagged that stall 6 (Explore or Recommend) needs a HARD gate — no turn-count bypass. The prospect MUST choose a direction before Bella can branch.

---

## PHASE 5: REV D — THE SYNTHESIS

All discoveries converged into a single spec revision (Rev D, 5 changes):

1. **USE_DO_BRAIN = "false"** — makes S1 execute
2. **DO state endpoints** — makes S1 state reliable (strong consistency)
3. **Extract-verified gates** — makes S1 advance correctly (not on "hmm")
4. **Dead roi_delivery cleanup** — dead code removal
5. **Shadow mode disable** — clean boundary (no competing stage machines)

### Why these are all S1, not separate sprints

Without #1, S1 is unreachable (0% value).
Without #2, S1 fails randomly mid-call (CF says don't rely on KV for this).
Without #3, S1 advances incorrectly (prospect experience broken).
Without #4 and #5, the code is messy but functional.

All five are S1 completeness requirements. Adding them doesn't create a new sprint — it completes the existing one.

### Sprint plan impact

| Sprint | Before | After |
|---|---|---|
| S1 | Stage machine + prompt | Stage machine + prompt + flag flip + DO state + gates |
| S1.5 | Existed as contingency | Eliminated (folded into S1) |
| S2-S4 | Unchanged | Unchanged |

Net timeline impact: ~1 day for spec revision + re-gate. But S1 was going to fail canary without these fixes, so it's catching problems before deploy instead of after. Net time saved.

---

## THE FULL REVISION CHAIN (for future reference)

| Rev | Date | What | Triggered by |
|---|---|---|---|
| Base S1 | 2026-04-21 | DELETE/REPLACE/ADD scope for stage machine + prompt | T9 architectural plan |
| Rev A | 2026-04-21 | Unified TURN BEHAVIOR, --- SCRIPT --- markers, KV-backed KB, WORD FOR WORD fidelity | Trent decisions on prompt architecture |
| Rev B | 2026-04-21 | prevStall ordering, KB read timing, skip cleanup, stall 6 hold, label fix | T3 first gate findings |
| Rev C | 2026-04-21 | Capture guard fix (remove turns_in_stall >= 1 from capture conditions) | T3 finding: capture prevented by guard + advance reset |
| Rev D | 2026-04-21 | Flag flip, DO state, extract gates, dead code, shadow mode | T3 Codex + T9 CF docs analysis + Trent push |

Each revision made S1 more correct. The spec got BETTER with each gate cycle, which is exactly what the Codex rigor system is designed to do.

---

## KEY QUOTES FROM THE SESSION

**T3 (on USE_DO_BRAIN):**
> "S1 inline path — confirmed correctly implemented per spec. Not reached when USE_DO_BRAIN=true."

**T9 (initial wrong call on KV):**
> "Ship S1 with KV as-is, canary for state consistency, Option 2 ready as S1.5 if canary reveals resets."

**Trent (pushing back):**
> "TELL ME DIRECTLY WHAT YOUR INTERPRETATION IS — READ THE OFFICIAL CLOUDFLARE GUIDANCE FIRST"

**T9 (after reading CF docs):**
> "KV is wrong for script_state. Not 'risky.' Wrong."

**Trent (confirming):**
> "EXCELLENT analysis my gut told me the same thing."

**T3 Codex (on Option 2):**
> "MVP-correct path."

**T3 Codex (on Option 3):**
> "Option 3 is riskier than it looks."

---

## WHAT MAKES THIS SESSION SPECIAL

1. **The Codex system worked exactly as designed.** T3's gate review found the unreachable code path — the most critical bug — that every human review missed. The spec got better with each gate cycle.

2. **The architect corrected course publicly.** T9 was wrong on KV, said so explicitly, reversed the recommendation. No ego, no defense of the initial position.

3. **Primary sources > mental models.** The CF documentation settled the KV debate in 30 seconds. Everything before that was speculation about "probably" and "usually."

4. **Trent's instinct was right.** Founder pushed for verification when the architect recommended "good enough." The verification proved the founder right.

5. **Each bug discovery revealed the next.** Flag → state persistence → gating → shadow mode. Architectural problems cascade — finding one often reveals the conditions for the next.
