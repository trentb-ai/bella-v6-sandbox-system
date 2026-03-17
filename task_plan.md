# BELLA V6 Bridge Fix Plan

## Goal
Fix three compounding bridge issues: latency, scraped data access, and prompt/stage flow.

## Root Cause Analysis (from logs + source)

### Issue 1: LATENCY — 14K char system prompt
- `buildFullSystemContext()` builds 13K+ chars (full persona + full flow framework + intel) EVERY turn
- `buildTurnPrompt()` adds ~1K more → total 14K+ per turn
- Deepgram warns `SLOW_THINK_REQUEST` after 5s waiting for bridge
- Bridge 6.7.0 worked at ~2K system_chars; current 6.11.0-D sends 14K+
- **Fix**: Don't send the full persona + flow framework every turn. The turn prompt already has stage-specific directives. Send a lean persona preamble (~500 chars) + intel summary + turn prompt.

### Issue 2: SCRAPED DATA NOT REACHING GEMINI
- Deep-scrape workflow uses fixed ID `deep-${lid}` → `instance.already_exists` for retested LIDs
- Bridge synthesizes `website_health` from `tech_stack` but the data paths are fragile
- `bella_opener` uses domain name ("kpmg.com") instead of resolved business name ("KPMG")
- Intel IS in KV (kv_bytes=48091) but the prompt builder doesn't surface it effectively
- **Fix**: Fix workflow ID collision + ensure intel data is surfaced in the lean prompt

### Issue 3: PROMPT/STAGE FLOW NOT WORKING
- Stale state from reused LIDs: stall >= 3 from previous session → WOW skipped immediately
- WOW stage directive is good but gets drowned in 14K chars of surrounding text
- Stage directives need to be the DOMINANT instruction, not buried
- **Fix**: Reset state on first turn, make stage directive the primary instruction

## Phases

### Phase 1: Bridge Prompt Reduction [PRIORITY — fixes latency + prompt clarity]
- [ ] Replace `buildFullSystemContext()` with a lean ~500 char persona preamble
- [ ] Keep `buildTurnPrompt()` as-is (it's already well-designed at ~1-2K)
- [ ] Move essential intel into turn prompt (business name, key data points)
- [ ] Target: system_chars < 3K total
- **Files**: `deepgram-bridge-v9/src/index.ts`

### Phase 2: State Reset on New Call [fixes WOW skip]
- [ ] When messages.length <= 2 (first turn), always reinitialize state
- [ ] Prevents stale state from previous sessions
- **Files**: `deepgram-bridge-v9/src/index.ts`

### Phase 3: Deep-Scrape Workflow ID Fix [fixes instance.already_exists]
- [ ] Make workflow ID unique: `deep-${lid}-${Date.now()}`
- [ ] Update /status endpoint to handle multiple instances per LID
- **Files**: `deep-scrape-workflow-sandbox/src/index.ts`

### Phase 4: Deploy + Verify
- [ ] Bump VERSION to 6.12.0-D
- [ ] Deploy bridge
- [ ] Deploy deep-scrape
- [ ] Tail logs, verify system_chars < 3K

## Deploy Order
1. `deepgram-bridge-v9` (Phase 1 + 2 — biggest impact)
2. `deep-scrape-workflow-sandbox` (Phase 3)
