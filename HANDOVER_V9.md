# BELLA V9 HANDOVER — 18 MAR 2026

## FOR: Fresh Claude session to continue work
## STATUS: Modular rewrite V1 deployed and verified. Critical scripting fix IN PROGRESS.

---

## 1. SYSTEM ARCHITECTURE

### Deployed Workers

| Worker Name | Folder | Purpose | Latest Version |
|-------------|--------|---------|----------------|
| `bella-scrape-workflow-v9-test` | `bella-scrape-workflow-v9/` | Main V9 pipeline — modular TypeScript (20 modules) | a83fe135 (modular rewrite v1) |
| `deepgram-bridge-sandbox-v8` | `deepgram-bridge-v9/` | Voice call brain — ALL conversation scripting lives here | 488c7e65 |
| `bella-voice-agent-sandbox-v8` | `voice-agent-v9/` | WebSocket/Deepgram handler | unchanged |
| `fast-intel-v8` | `fast-intel-sandbox-v9/` | Firecrawl + Gemini Consultant → writes `lead:{lid}:fast-intel` | unchanged |
| `bella-tools-worker-v8` | `bella-tools-worker-v9/` | KV reads during call, ROI calculations | unchanged |
| `consultant-v8` | `consultant-v9/` | Gemini-powered business intelligence analyst | unchanged |
| `personalisedaidemofinal-sandbox` | — | OLD pipeline — still runs, writes `deepIntel` with 30-day TTL. DO NOT DISABLE. |

### KV Namespace
- Name: `leads-kv`
- ID: `0fec6982d8644118aba1830afd4a58cb`
- All KV ops need `--remote` flag

### Working Directory
`/Users/trentbelasco/Desktop/BELLA_V9_SANDBOX_COMPLETE_SYSTEM/`

### Backups
- `/Users/trentbelasco/Desktop/BELLA_V9_BACKUP_2026-03-16_1308/` (44MB, pre-fixes)
- `/Users/trentbelasco/Desktop/BELLA_V9_BACKUP_2026-03-17_1817/` (44MB, pre-modular rewrite)
- Future backups: `rsync -a --exclude='node_modules' SOURCE DEST`

### Git
- Repo initialized in working directory
- Latest commit: `a6ec67e` tagged `v9-modular-rewrite-v1`

---

## 2. THE CRITICAL ISSUE — SCRIPTING

### The Problem

The `script_stages` KV key contains **4 thin hardcoded stages** that override the bridge's rich 11-stage conversation system.

**What script_stages currently contains (WRONG — 4 thin stages):**
```
1. wow — "audit complete" + "who handles marketing?"
2. demo_value_bridge — "benchmarked against AI performance standards"
3. anchor_acv — ask customer value
4. anchor_volume — ask leads per week
```

**What the bridge's own stage system has (CORRECT — 11 stages):**
```
wow → anchor_acv → anchor_timeframe → [ch_ads, ch_website, ch_phone, ch_old_leads, ch_reviews] → roi_delivery → close
```

### Why This Matters

The bridge has TWO stage advancement paths:
1. **`advance()` function** — the bridge's own 11-stage system with `buildStageDirective()` (500 lines of rich, evidence-based conversation scripts using consultant data)
2. **`advanceV8Stage()` function** — reads `script_stages` from KV and walks those stages sequentially

When `script_stages` exists (which it always does after T=7s), the bridge activates the V8 path. The 4 thin stages override the bridge's rich scripts.

### V8 Stage Machine Bugs

- `demo_value_bridge` maps to `"wow"` via alias → gateOpen requires stall >= 6 AGAIN → stuck
- `anchor_volume` maps to `"ch_ads"` → gateOpen requires `ads_leads && ads_conversions` (null) → stuck
- Bridge stage keys (`anchor_timeframe`, `ch_ads`, `ch_website`, `ch_phone`, `ch_old_leads`, `ch_reviews`, `roi_delivery`, `close`) are NOT in the `v8StageAlias` map → all fall through to `"wow"` default

### Who Writes script_stages (THREE writers, all writing the same bad data)

1. **Workflow `write-early-stages.ts`** — fires at T=7s, writes 4 thin hardcoded stages
2. **Workflow `write-stages-late.ts`** — fires at T=47s, writes identical 4 thin stages
3. **Consultant `consultant-v9/worker.js` `writeScriptStages()`** — fires when consultant completes, writes the same 4 thin stages with some consultant data in script text

### The Consultant's Role (CRITICAL)

The **Gemini-powered consultant** (`consultant-v9/worker.js`) is the BRAIN of the system. It does massive analysis:
- **5 lenses**: Copy Quality, Market & ICP, Surfaced Benefits, Conversion Events, Business Identity
- **Outputs**: `scriptFills`, `copyAnalysis`, `icpAnalysis`, `valuePropAnalysis`, `conversionEventAnalysis`, `routing`, `conversationHooks`, `redFlags`
- **Model**: Gemini 2.0 Flash (with fallback to Gemini 1.5 Flash)
- **Called by**: fast-intel via service binding

The consultant's rich output flows to the bridge via `lead:{lid}:fast-intel`. The bridge's `buildStageDirective()` reads `intel.consultant.scriptFills`, `intel.consultant.icpAnalysis`, etc. to build rich conversation scripts. The consultant feeds the bridge. They work together.

### What the Bridge's buildStageDirective() Already Does (DO NOT TOUCH)

`buildStageDirective()` (~line 1670, ~500 lines) is a comprehensive conversation engine:
- **WOW stage**: 8 stall levels with progressive disclosure — personalised opener, ICP confirmation, solutions, reputation, ads, bridge to numbers
- **anchor_acv**: Industry-benchmarked ACV question
- **anchor_timeframe**: Weekly/monthly preference
- **ch_ads → ch_reviews**: Per-agent ROI calculation and delivery during each channel stage
- **roi_delivery**: Summary of all agent values
- **close**: Trial offer with calculated revenue

It uses `intel.consultant.scriptFills`, `icpAnalysis.icpProblems`, `icpAnalysis.icpSolutions`, Google ratings from `deep`, ads flags, etc. **This function is rich and correct. DO NOT TOUCH.**

### The Bridge's buildQueue() Function

`buildQueue()` (~line 390) dynamically selects which channel stages to include based on flags:
- `ch_ads` — only if running ads or social/email traffic
- `ch_website` — always
- `ch_phone` — only if speed-to-lead needed, call handling needed, or has phone
- `ch_old_leads` — only if database signals or hiring signals
- `ch_reviews` — only if review count > 0 or review signals

---

## 3. DATA FLOW — COMPLETE MAP

### What fires at T=0 (capture.html form submit)
```
T=0   /fire-apify  → bella-scrape-workflow-v9-test (fires Apify actors)
T=0   /fast-intel  → fast-intel-v8 (Firecrawl + Gemini Consultant)
T=0   /trigger     → bella-scrape-workflow-v9-test (starts workflow)
T=0   old pipeline → personalisedaidemofinal-sandbox (writes deepIntel with 30-day TTL)
```

### KV Keys Written (who writes what, when)

| Key | Writer | When | TTL | Bridge Reads? |
|-----|--------|------|-----|---------------|
| `lead:{lid}:stub` | Workflow step 1 | T=1s | 3600 | Yes (lowest priority) |
| `lead:{lid}:fast-intel` | fast-intel-v8 | T=8-28s | none | Yes (HIGHEST priority) |
| `lead:{lid}:phase_a` | Workflow step 6 | T=7s | 3600 | NO (only Llama Step 9 reads — dead) |
| `lead:{lid}:script_stages` | Workflow + Consultant | T=7s / T=20s / T=47s | 86400 | Yes (V8 stage machine — THE PROBLEM) |
| `lead:{lid}:stage1_snippet` | Workflow Chain A | T=23s | 3600 | NO (orphaned) |
| `lead:{lid}:deep_flags` | Workflow step 14 | T=43s | 86400 | Yes |
| `lead:{lid}:intel` | Workflow step 18 | T=46s | 3600 | Yes (low priority, below fast-intel) |
| `lead:{lid}:deepIntel` | OLD pipeline | T=4s | 2592000 (30 days) | Yes (merged as `deep`) |

### Bridge loadMergedIntel() Merge Order
```
stub (lowest) → deep (deepIntel) → deepFlags (deep_flags) → oldIntel (intel) → fast (fast-intel, HIGHEST)
```

---

## 4. LLAMA CALLS — ALL THREE ARE DEAD/REDUNDANT

| Step | Model | Output | Who Reads | Verdict |
|------|-------|--------|-----------|---------|
| Step 5 (consultant-ai.ts) | Llama 3.1 8B | "flattery paragraph" → `phase_a` | Only Step 9's Llama 70B | DEAD — only consumer is also dead |
| Step 9 (parallel-wow-apify.ts Chain A) | Llama 3.1 70B | WOW script → `stage1_snippet` | NOTHING — bridge never reads it | DEAD — orphaned output |
| Step 16 (consultant-ai-v2.ts) | Llama 3.1 8B | "deep intel paragraph" → `intel` | Bridge at LOWEST priority, overwritten by fast-intel | REDUNDANT |

---

## 5. WORKING RULES — NON-NEGOTIABLE

1. Root cause before ANY fix — no guessing, no assumptions
2. One change at a time — deploy, verify, confirm before next
3. All KV ops need `--remote` flag
4. `wrangler tail --format=json` for all log checks
5. Read deployed worker code before any change
6. If 3+ fixes fail on same issue — stop and question architecture
7. `buildStageDirective()` in deepgram-bridge-v9 — DO NOT TOUCH unless explicitly told
8. No unsolicited tests, no browser opens
9. NEVER destroy, disable, remove, or modify any existing worker, pipeline, endpoint, or production system without Trent's EXPLICIT approval
10. All future backups: `rsync -a --exclude='node_modules'`
11. Cloudflare account ID: `9488d0601315a70cac36f9bd87aa4e82`
12. KV namespace ID: `0fec6982d8644118aba1830afd4a58cb`

---

## 6. KEY FILES TO READ

| File | Why |
|------|-----|
| `deepgram-bridge-v9/src/index.ts` | The BRAIN — loadMergedIntel(), buildStageDirective(), gateOpen(), advance(), advanceV8Stage(), v8StageAlias() |
| `consultant-v9/worker.js` | The ANALYST — Gemini prompt, scriptFills output, writeScriptStages() |
| `fast-intel-sandbox-v9/src/index.ts` | The SCOUT — Firecrawl + calls consultant + writes fast-intel to KV |
| `bella-scrape-workflow-v9/src/index.ts` | The PIPELINE — modular orchestrator |
| `bella-scrape-workflow-v9/src/steps/write-early-stages.ts` | The 4 thin stages (needs replacing) |
| `bella-scrape-workflow-v9/src/steps/write-stages-late.ts` | Duplicate thin stages (needs replacing) |
| `bella-scrape-workflow-v9/src/steps/parallel-wow-apify.ts` | Chain A (Llama 70B, dead) + Chain B (Apify poll, alive) |
| `bella-scrape-workflow-v9/src/steps/consultant-ai.ts` | Llama 8B Step 5 (dead) |
| `bella-scrape-workflow-v9/src/steps/consultant-ai-v2.ts` | Llama 8B Step 16 (dead) |

---

## 7. SKILLS LOCATIONS

### Project-level skills (READ ALL before starting work)
```
.claude/skills/systematic-debugging/SKILL.md
.claude/skills/systematic-debugging/root-cause-tracing.md
.claude/skills/systematic-debugging/defense-in-depth.md
.claude/skills/systematic-debugging/condition-based-waiting.md
.claude/skills/cloudflare/SKILL.md
.claude/skills/cloudflare/troubleshooting.md
.claude/skills/cloudflare/state-patterns.md
.claude/skills/voice-ai-deepgram/SKILL.md
.claude/skills/voice-ai-deepgram/voice-agents.md
.claude/skills/debug-bridge/SKILL.md
.claude/skills/orchestrator/SKILL.md
.claude/skills/planning-with-files/SKILL.md
```
