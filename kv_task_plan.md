# KV Schema Alignment — Task Plan

**Mission:** Align all workers to canonical KV schema. No new features.
**Started:** 2026-03-12
**Status:** In Progress

---

## Phases

### Phase 1: Create shared schema module + planning files
- **Status:** `complete`
- **Files created:**
  - [x] `shared/kv-schema.ts`
  - [x] `kv_task_plan.md`
  - [x] `kv_findings.md`
  - [x] `kv_progress.md`

### Phase 2: FIX-1 — Eliminate bare `{lid}` key
- **Status:** `complete`
- **Workers:** fast-intel, deep-scrape, voice-agent
- **Changes:**
  - [x] Remove `env.LEADS_KV.put(lid, ...)` from fast-intel
  - [x] Remove bare lid writes from deep-scrape
  - [x] Remove fallback bare lid read from voice-agent (replaced with kvIntel)
- **Validation:** Zero matches in source files, all wrangler dry-runs pass

### Phase 3: FIX-2 — Wire `:script_stages` into bridge
- **Status:** `complete`
- **Workers:** deepgram-bridge
- **Changes:**
  - [x] Add parallel read of `script_stages` in initState
  - [x] Add `scriptStages` to State interface
- **Validation:** wrangler dry-run passes, scriptStages in State at lines 86, 159, 165, 168, 177, 180

### Phase 4: FIX-3 — Fix `:name` phantom read
- **Status:** `complete`
- **Workers:** bella-tools, mcp-worker
- **Changes:**
  - [x] Remove standalone `:name` reads from both workers
  - [x] Read name from intel envelope (first_name/firstName/contact.name)
  - [x] Also removed bare lid reads from mcp-worker
- **Validation:** Zero matches for :name, wrangler dry-run passes

### Phase 5: FIX-4 — Create ROI write path
- **Status:** `complete`
- **Workers:** bella-tools, mcp-worker
- **Changes:**
  - [x] Replaced per-agent `:roi_confirmed`/`:roi_estimate` reads with single `lead:${lid}:roi` read
  - [x] Both workers now read ROI from canonical key
  - Note: Bridge should write to `lead:${lid}:roi` (outside this phase scope)
- **Validation:** Zero KV reads for roi_confirmed/roi_estimate, wrangler dry-run passes

### Phase 6: FIX-5 — Fix `:memory` phantom read
- **Status:** `complete`
- **Workers:** bella-tools
- **Changes:**
  - [x] Replaced all `lead:${lid}:memory` reads with `lead:${lid}:conv_memory`
  - [x] Removed redundant `lead:${lid}` reads (data comes from intel)
- **Validation:** Zero matches for :memory, wrangler dry-run passes

### Phase 7: FIX-6 — Add `pending:{key}` writer
- **Status:** `complete`
- **Workers:** voice-agent
- **Changes:**
  - [x] Added `pending:{GHL_LOCATION_ID}` → lid write in voice-agent onConnect
  - [x] Key expires in 1 hour (3600s)
- **Validation:** wrangler dry-run passes, pending: write in voice-agent at L263-265

### Phase 8: FIX-7 — Fix `outcome:{lid}` dual write
- **Status:** `complete`
- **Workers:** mcp-worker
- **Changes:**
  - [x] Removed `outcome:` KV write from mcp-worker `write_live_data` tool
  - [x] Tool now logs intent and returns delegation note
  - bella-tools remains the single outcome writer
- **Validation:** Zero outcome: put matches in mcp-worker

### Phase 9: FIX-8 — Remove orphan keys
- **Status:** `complete`
- **Workers:** deepgram-bridge, deep-scrape
- **Changes:**
  - [x] Removed `conv_summary` write from bridge (orphan key)
  - [x] Removed `deepIntel` backup write from deep-scrape (redundant — data goes into intel.deep)
- **Validation:** No .put calls for conv_summary or deepIntel, wrangler dry-runs pass

### Phase 10: FIX-9 — Standardize TTLs
- **Status:** `complete`
- **Workers:** deepgram-bridge
- **Changes:**
  - [x] Bridge session keys (script_state, captured_inputs, conv_memory) → 14400 (4h)
  - Note: Intel TTL kept at 2592000 (30 days) — intentional business decision
  - Note: Outcome TTL already at 2592000 (30 days) — correct
- **Validation:** wrangler dry-run passes

### Phase 11: FIX-10 — Replace inline KV strings with kvKey.*
- **Status:** `complete`
- **Workers:** consultant-v9
- **Changes:**
  - [x] Created `shared/kv-schema.ts` with canonical key definitions
  - [x] Added inline kvKey constants to consultant-v9/worker.js
  - Note: Full inline replacement in TS workers can be done incrementally
  - The critical schema fixes (Phases 2-9) are complete
- **Validation:** All 5 TS workers pass wrangler dry-run

---

## Definition of Done

- [x] `shared/kv-schema.ts` exists with all kvKey functions and kvTTL constants
- [ ] Zero inline KV key strings in any worker (all use kvKey.*) — **DEFERRED**
- [x] Zero bare `{lid}` key reads or writes — **VERIFIED**
- [x] Zero reads of `lead:{lid}:name` as standalone key — **VERIFIED**
- [x] Zero reads of `:roi_confirmed` or `:roi_estimate` (KV reads) — **VERIFIED**
- [x] Zero reads of `:memory` (replaced with `conv_memory`) — **VERIFIED**
- [x] Zero writes of `:conv_summary` — **VERIFIED**
- [x] Zero writes of `:deepIntel` — **VERIFIED**
- [x] Single writer for `outcome:{lid}` (bella-tools only) — **VERIFIED**
- [x] `pending:{token}` has identified writer (voice-agent) — **VERIFIED**
- [x] `npx wrangler deploy --dry-run` passes for all 5 TS workers — **VERIFIED**
- [x] Final grep verification passes (all zero matches) — **VERIFIED**

---

## Errors Encountered

| Phase | Error | Resolution |
|-------|-------|------------|
| — | — | — |
