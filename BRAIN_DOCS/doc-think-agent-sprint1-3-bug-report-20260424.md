# Bella Think Agent V1 — Sprint 1–3 Bug Report
## Authored by: T3A (Code Judge)
## Date: 2026-04-24 AEST
## D1 ID: doc-think-agent-sprint1-3-bug-report-20260424

---

## SPRINT 1 — SDK Type Fixes

### Bugs Found (by T2 before T3A gate)
1. **saveMessages / waitUntilStable not in SDK .d.ts** — methods don't exist in @cloudflare/think@0.1 = compile error / runtime crash.
2. **chatRecovery=true is a no-op on Think** — correct flag is `fibers = true` (class property). Wrong flag = fiber recovery silently disabled.

### Fix
- `fibers = true` class property set (bella-agent.ts:24)
- chatRecovery removed, non-existent calls removed

### Verdict: SKIPPED — tsc=EXIT:0 sufficient for pure type fix.

---

## SPRINT 2 — Fiber Recovery + Memory Ingest

### P1 Bug — Double Transcript Ingest
**Files:** bella-agent.ts:248 (onFiberRecovered), bella-agent.ts:436 (onCallEnd)
**Bug:** Both paths called `memory.ingest(state.transcriptLog, { sessionId: state.callId })` with no dedup guard. Crash-recovery + normal call-end = double ingest.

### P2 Bug — ctx.stash() Residual
**File:** bella-agent.ts:400
`processBridgeTurn` still called `ctx.stash()` inside `runFiber`. Misleading but low-risk.

### Fix
- `memoryIngested: boolean` in ConversationState (types.ts:189)
- `setState({ memoryIngested: true })` BEFORE `memory.ingest()` in both paths — at-most-once guarantee across crashes
- Both paths gated: `if (state.memoryIngested) return`

### Verdict: CONDITIONAL → APPROVE after fix.

---

## SPRINT 3 — WowAgent Sub-Agent + wowLines Pre-Generation

### Pre-Gate Fix (T2/T4)
Migration tag reuse — WowAgent was in tag "v1" (already ran in prod). Split to new tag "v2". Fixed before gate.

### P0-1 — Concurrent runWowPrep Race
**Files:** bella-agent.ts:501 (consultant), bella-agent.ts:352 (deep_ready)
**Bug:** Both ctx.waitUntil(runWowPrep()) fire with no in-flight guard. Both read empty wowLines, both pass guard, both spend ~10s on Gemini, both setState({...fresh, wowLines:{...}}). Last writer wins — consultant-only stale lines can overwrite richer deep-ready lines on same wow_* keys. Double Gemini spend every call.

### P0-2 — Early Return Guard Blocks Enrichment
`if (Object.keys(fresh.wowLines ?? {}).length > 0) return` — after consultant partial fill, deep_ready hits this guard and returns. Better deep-enriched lines never written. Defect masquerading as an optimisation.

### P1 — No Version Metadata
No `intel.mergedVersion` tracked against wowLines. Can't enforce safe ordering.

### P1 — No Gemini Timeout
WowAgent Gemini call unbounded. Hangs in ctx.waitUntil.

### Codex Corrections (NOT bugs)
- setState spread does NOT clobber unrelated state — re-reads fresh AFTER await. Overstated concern.
- "wow-prep" fixed name is NOT cross-lead singleton — keyed within parent facet context (SDK index.js:1834-1843).

### Required Fix
```
Add to ConversationState: wowPrepVersion: number
Logic in runWowPrep:
1. if state.wowPrepVersion >= state.intel.mergedVersion → return (already have best lines)
2. Set in-flight flag before spawning WowAgent
3. Post-prepareLines: write MISSING keys only, OR overwrite if current key is from older mergedVersion
4. Deep-ready (higher mergedVersion) always beats consultant-ready (lower)
5. Clear in-flight flag after setState
```

### Verdict: FAIL → RETURN_TO_IMPLEMENTER

---

## SUMMARY

| Sprint | Verdict | P0 | P1 | Status |
|--------|---------|----|----|--------|
| 1 | SKIPPED | 0 | 0 | MERGED |
| 2 | CONDITIONAL → APPROVE | 1 | 1 | MERGED |
| 3 | FAIL | 2 | 2 | RETURN_TO_IMPLEMENTER |

## KEY PATTERNS

1. **At-most-once async side effects**: setState(flag=true) BEFORE async call. Pattern established by memoryIngested.
2. **Intel version gating**: State derived from intel must track intel.mergedVersion. Never overwrite higher-version with lower.
3. **ctx.waitUntil concurrency**: Multiple concurrent fires from different events = always guard with in-flight flag + version check.
4. **SDK post-cutoff**: @cloudflare/think, agents@0.9+, ai@6+ — T5 .d.ts discovery only. Codex cannot judge. tsc=EXIT:0 is primary proof.
