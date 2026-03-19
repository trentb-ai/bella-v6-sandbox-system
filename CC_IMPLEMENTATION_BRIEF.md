# BELLA V9 — Chunk 1 Implementation Brief

## YOUR MISSION

Fix the script_stages architecture so the bridge's native `buildStageDirective()` becomes the ONLY script execution path. Remove dead Llama calls. Layer consultant ranking into channel selection.

## BEFORE YOU DO ANYTHING

1. Read these files IN FULL (confirm each with one line):
   - `.claude/skills/systematic-debugging/SKILL.md`
   - `.claude/skills/cloudflare/troubleshooting.md`
   - `HANDOVER_V9.md` (this project root)
   - `PERPLEXITY_SPEC.md` (this project root)

2. Read these source files to understand what you're changing:
   - `deepgram-bridge-v9/src/index.ts` — THE BRAIN
   - `consultant-v9/worker.js` — Focus on `writeScriptStages()`
   - `bella-scrape-workflow-v9/src/steps/write-early-stages.ts`
   - `bella-scrape-workflow-v9/src/steps/write-stages-late.ts`
   - `bella-scrape-workflow-v9/src/steps/parallel-wow-apify.ts`
   - `bella-scrape-workflow-v9/src/steps/consultant-ai.ts`
   - `bella-scrape-workflow-v9/src/steps/consultant-ai-v2.ts`

## ARCHITECTURAL DECISIONS (ALREADY MADE — DO NOT REVISIT)

- `buildStageDirective()` is the ONLY script engine. DO NOT TOUCH IT.
- `script_stages` becomes `stage_plan` — thin metadata only. NO script text.
- Routing: deterministic eligibility FIRST, consultant ranking SECOND.
- Max 2 active channel stages + 1 tease stage + always roi_delivery + close.
- All 3 Llama calls are dead — remove them.
- PERPLEXITY_SPEC.md is the BLUEPRINT. Use for architectural guidance but write production code that fits OUR codebase. Don't copy-paste blindly.

## IMPLEMENTATION ORDER (ONE AT A TIME — DEPLOY AND VERIFY EACH)

### Step 1: Bridge reader + feature flag
- Add `StagePlanV2` types (see PERPLEXITY_SPEC.md)
- Add `readStagePlanCompat()` that reads new `stage_plan` OR old `script_stages` (ignoring `script` field)
- Add `normalizeLegacyStageKey()` — NO silent default-to-wow. Unknown keys return null.
- Add env flag `BELLA_STAGE_PLAN_V2_ENABLED` (default true, false = synthesize from MergedIntel)
- Wire into `initState()` — read stage_plan first, compat-read script_stages second, synthesize third
- DO NOT delete anything yet. Just add the new reader path.
- Deploy `deepgram-bridge-sandbox-v8`, verify with `wrangler tail --format=json`

### Step 2: Bridge queue logic
- Add `buildQueueV2()` function (scoring: hard eligibility + consultant boost)
- Wire into `initState()` — when synthesizing from MergedIntel, use `buildQueueV2()`
- Add `rebuildFutureQueueOnLateLoad()` for deep data arrival
- Replace LATE-LOAD block to use new rebuild logic
- Replace HOT-SWAP block to patch only pending channel stages
- Delete `advanceV8Stage()`, `seedV8State()`, `captureToInputs()`, `v8StageAlias()`
- All stage advancement now goes through native `advance()` only
- Deploy, verify

### Step 3: Consultant writer
- Replace `writeScriptStages()` in `consultant-v9/worker.js` with `writeStagePlan()`
- Writes StagePlanV2 shape using routing.priority_agents + basic eligibility from its payload
- KV key: `lead:{lid}:stage_plan` (TTL 86400)
- Note: consultant is vanilla JS, not TypeScript. Adapt accordingly.
- Deploy `consultant-v8`, verify

### Step 4: Delete dead Llama steps
- Delete `bella-scrape-workflow-v9/src/steps/consultant-ai.ts` (Step 5)
- In `parallel-wow-apify.ts`: delete Chain A (Llama 70B) entirely, keep Chain B (Apify poll)
- Delete `bella-scrape-workflow-v9/src/steps/consultant-ai-v2.ts` (Step 16)
- Update `bella-scrape-workflow-v9/src/index.ts` to remove deleted step imports and calls
- `write-phase-a.ts` writes `phase_a` which only Step 9 read — evaluate if still needed
- Deploy `bella-scrape-workflow-v9-test`, verify E2E

### Step 5: Remove old writer paths
- Delete `bella-scrape-workflow-v9/src/steps/write-early-stages.ts`
- Delete `bella-scrape-workflow-v9/src/steps/write-stages-late.ts`
- Update orchestrator `index.ts` to remove these step calls
- Deploy, verify

### Step 6: Cleanup (after live call verification)
- Remove compat helpers
- Remove feature flag check
- Consider renaming `parallel-wow-apify.ts` → `poll-apify-deep.ts`

## WORKING RULES — NON-NEGOTIABLE

1. Root cause before ANY fix — no guessing
2. One change at a time — deploy, verify, confirm before next
3. All KV ops need `--remote` flag
4. `wrangler tail --format=json` for all log checks
5. Read deployed worker code before any change
6. If 3+ fixes fail on same issue — stop and question architecture
7. `buildStageDirective()` in deepgram-bridge-v9 — DO NOT TOUCH
8. No unsolicited tests, no browser opens
9. NEVER destroy, disable, remove, or modify any existing worker, pipeline, endpoint, or production system without Trent's EXPLICIT approval
10. All backups: `rsync -a --exclude='node_modules'`
11. KV namespace ID: `0fec6982d8644118aba1830afd4a58cb`
12. Cloudflare account ID: `9488d0601315a70cac36f9bd87aa4e82`

## VERIFICATION CHECKLIST (after each deploy)

- [ ] `buildStageDirective()` fires for every active stage
- [ ] No unknown stage key silently defaults to `wow`
- [ ] Queue contains max 2 active `ch_*` stages + optional tease
- [ ] Deep late-load only changes future stages, never current/completed
- [ ] No code path reads `script_stages.script`
- [ ] Bella can complete a full conversation flow through all stages
- [ ] ROI calculations fire correctly during channel stages

## WHAT SUCCESS LOOKS LIKE

After all steps: Bella calls use the bridge's native `advance()` → `buildQueueV2()` → `buildStageDirective()` path with consultant-ranked channel selection. No V8 stage machine. No Llama calls. No thin script text overriding rich directives. Clean logs showing eligible_channels, scored_channels, selected_channels, tease_stage per call.
