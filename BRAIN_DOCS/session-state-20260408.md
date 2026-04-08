# BELLA V3 SESSION STATE — 2026-04-08
**Filed by:** T2 Code & Architecture Lead  
**Time:** ~04:40 AEST  
**Git baseline:** `7032414` (Chunks 0-8B, 68/68 tests)

---

## DEPLOYED THIS SESSION

### brain-v3 v1.19.5 — LIVE
**URL:** https://bella-brain-v3.trentbelasco.workers.dev  
**Health confirmed:** `{"version":"1.19.5","worker":"brain-v3"}`  
**Version ID:** e05d29f4-7790-4e15-bd40-fd4b51fa368f  

**What's in this version (all fixes from C9 + gate cycles):**
- Chunk 9 harness fixes: `wowStep:1` in makeState, `makeEnv` D1 mock, `allowFreestyle:false` on optional_side_agents
- Migration 0002: `call_turns` UNIQUE constraint with DELETE dedup
- `callStartedEmitted` race: early `storage.put` before emit
- Extraction: `ctx.waitUntil` restored with `.catch()`
- `ConsultantEventSchema` + `DeepScrapeEventSchema` validation (union type for googleMaps — nested correctly inside `deep` subobject)
- Anti-clobber `deepIntel` merge in `handleTurn` (line 212)
- `allowFreestyle:false` on `buildCloseDirective` (moves.ts:471)
- `persistFacts .catch()` on waitUntil (brain-do.ts:418)
- VERSION aligned: `index.ts` + `wrangler.toml` both `1.19.5`
- Tests: **70/70 unit + 30/30 harness GREEN**
- Stale contracts .js files removed (8 files)

---

## IN FLIGHT

### prompt-worker-v3 Sprint 1 — v1.0.4 at T3b gate
**What:** Chunk 10D Sprint 1 — `improvisationBand` + `allowFreestyle` wiring into Gemini prompt builder  
**File:** `prompt-worker-v3/src/prompt-builder.ts` lines 63-71  
**Change:** 4-branch `paraphraseRule` chain (mandatory+speakText / allowFreestyle=false / strict / narrow / wide)  
**Also:** `.catch()` on compliance `waitUntil` chain (index.ts:125-127)  
**VERSION:** 1.0.4  
**Gate:** T3b (1u30i0sk) — v1.0.3 FAILed (mandatory guard missing speakText check, compliance missing .catch). v1.0.4 fixes both.

### Git commit — brain-v3 in progress
T5 committing brain-v3 Chunk 9 + fixes as clean commit. HEAD still at `7032414` pre-commit.

---

## CHUNK 10D SPRINT STATUS

| Sprint | Description | Status | Notes |
|--------|-------------|--------|-------|
| **Sprint 5** | deterministicExtract | Implemented (v1.19.0) | Gate after 10C — T3b |
| **Sprint 1** | improvisationBand wiring | At T3b gate (v1.0.4) | prompt-worker-v3 |
| **Sprint 2** | Stage-aware KB query (1 line) | Not started | brain-do.ts `queryKB` prefix |
| **Sprint 3** | KB ingestion (complex) | Not started | Needs T3 spec review first |
| **Sprint 4** | Prospect-only guard removal | Not started | Depends on Sprint 3 |

**Execute order: 5 → 1 → 2 → 3 → 4**

---

## NEXT ACTIONS (in order)

1. **T3b PASS Sprint 1** → deploy prompt-worker-v3 → commit
2. **T4 Sprint 2**: `brain-do.ts` — `queryKB(turn.utterance)` → `` queryKB(`${state.currentStage}: ${turn.utterance}`) `` (1 line, brain-v3 worker)
3. **T3b gates Sprint 5** (deterministicExtract, already implemented)
4. **Sprint 3 spec** (complex — T2 writes spec, T3 reviews spec, then T4 implements)
5. **10C** (realtime/compliance/prompt bundle v1.0.1 — T3a gates this)
6. **Pre-cutover tag**: `bella-v3-pre-cutover` after v1.14.4 deployed + T5 health pass

---

## KEY VERSIONS

| Worker | Version | Status |
|--------|---------|--------|
| brain-v3 | 1.19.5 | LIVE ✓ |
| prompt-worker-v3 | 1.0.3 (1.0.4 pending) | 1.0.3 deployed, 1.0.4 at gate |
| realtime-agent-v3 | unknown | Not touched this session |
| compliance-workflow-v3 | unknown | Not touched this session |
| fast-intel-v3 | unknown | Not touched this session |

---

## GATE ROUTING

- **T3a** (r7iepm73): 10C (realtime/compliance/prompt bundle v1.0.1) — next after Sprint cycles
- **T3b** (1u30i0sk): Sprint 1 (current) → Sprint 2 → Sprint 5 → Sprint 3 (after spec review)

---

## RECURRING BUGS TO WATCH

1. **VERSION bump**: ALWAYS touch BOTH `index.ts` AND `wrangler.toml` — missing one has been the cause of multiple gate FAILs
2. **Stale JS pre-flight**: ALWAYS run before implementation — contracts had 8 stale files
3. **Schema nesting**: Always check handler code to confirm payload shape before writing Zod schema
4. **speakText guard**: `mandatory && !!speakText` — not just `mandatory` (WOW stages have mandatory=true, speakText=undefined)
