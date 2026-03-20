# PERPLEXITY ARCHITECTURAL SPEC — Bella V9 Stage Plan

## Overview

The bridge is the ONLY script engine. `script_stages` becomes `stage_plan` — thin versioned metadata, no authored copy. Routing uses deterministic eligibility + consultant ranking. All Llama calls are removed.

## Ownership Model

- **Deterministic extractors** own factual fields, eligibility inputs, and late-arriving deep signals
- **Gemini consultant** owns strategic interpretation, phrasing ingredients, priorities, and qualitative opportunity assessment
- **Bridge** owns queue construction, gate checks, stage advancement, and final per-turn directive generation

---

## StagePlanV2 TypeScript Interface

```ts
export type BridgeStageKey =
  | "wow"
  | "anchor_acv"
  | "anchor_timeframe"
  | "ch_ads"
  | "ch_website"
  | "ch_phone"
  | "ch_old_leads"
  | "ch_reviews"
  | "roi_delivery"
  | "close";

export type ChannelStageKey =
  | "ch_ads"
  | "ch_website"
  | "ch_phone"
  | "ch_old_leads"
  | "ch_reviews";

export type StageSource = "fast" | "deep" | "bridge";

export interface StagePlanStageV2 {
  key: BridgeStageKey;
  active: boolean;
  priority: number;
  source: StageSource;
}

export interface StagePlanV2 {
  version: 2;
  tease_stage: ChannelStageKey | null;
  stages: StagePlanStageV2[];
}
```

Stage invariants:
```ts
export const BASE_STAGES: BridgeStageKey[] = ["wow", "anchor_acv", "anchor_timeframe"];
export const CHANNEL_STAGES: ChannelStageKey[] = ["ch_ads", "ch_website", "ch_phone", "ch_old_leads", "ch_reviews"];
export const TAIL_STAGES: BridgeStageKey[] = ["roi_delivery", "close"];
```

---

## buildQueueV2() Scoring Algorithm

### Hard Eligibility (deterministic from flags + deep data)

- `ch_ads`: ads signals (pixels, flags) OR social/email traffic
- `ch_website`: ALWAYS eligible
- `ch_phone`: speed_to_lead_needed OR call_handling_needed OR has phone
- `ch_old_leads`: database signals OR hiring signals OR business age
- `ch_reviews`: review count > 0 OR review_signals flag

### Soft Ranking (consultant boost)

Agent-to-channel mapping:
- Alex → ch_ads
- Chris → ch_website
- Maddie → ch_phone
- Sarah → ch_old_leads
- James → ch_reviews

Consultant boost by priority position:
- Position 0 (top): +40
- Position 1: +28
- Position 2: +18
- Position 3+: +10

### Output

- Discard channels below eligibility threshold
- Sort by total score (deterministic + consultant boost)
- Top 2 = active channels
- 3rd = tease_stage
- Always append roi_delivery then close

### Late-Load Integration

When deep data arrives mid-call:
- Rebuild queue from fresh MergedIntel using buildQueueV2()
- Lock completed stages and current stage (never change them)
- Only swap future ch_* stages

---

## File-by-File Changes

### File 1: deepgram-bridge-v9/src/index.ts

**DELETE:**
- `v8StageAlias()` → replace with `normalizeLegacyStageKey()` (strict, no default-to-wow)
- `advanceV8Stage()` → all callers use native `advance()`
- `seedV8State()` → initial queue comes from stage_plan or buildQueueV2(mergedIntel)
- `captureToInputs()` → regex extraction engine already owns input capture

**ADD:**
- `StagePlanV2` types
- `readStagePlanCompat()` — reads new stage_plan OR old script_stages (ignoring script field)
- `normalizeLegacyStageKey()` — strict mapping, unknown keys return null (NOT "wow")
- `buildQueueV2()` — scoring function
- `rebuildFutureQueueOnLateLoad()` — for deep data arrival
- Feature flag: `BELLA_STAGE_PLAN_V2_ENABLED` (default true)

**MODIFY:**
- `initState()` → read stage_plan first, compat-read script_stages second, synthesize from MergedIntel third
- LATE-LOAD block → use rebuildFutureQueueOnLateLoad()
- HOT-SWAP block → patch only pending channel stages

### File 2: consultant-v9/worker.js

**REPLACE:** `writeScriptStages()` → `writeStagePlan()`
- New function writes StagePlanV2 using routing.priority_agents + basic eligibility
- KV key: `lead:{lid}:stage_plan` (TTL 86400)
- NO script text, NO capture fields, NO agent fields

### File 3: bella-scrape-workflow-v9/src/steps/write-early-stages.ts

**DELETE** this file. Bridge synthesizes fallback queue from MergedIntel if stage_plan is absent.

### File 4: bella-scrape-workflow-v9/src/steps/write-stages-late.ts

**DELETE** this file. Bridge rebuilds pending queue in memory when deep data arrives.

### File 5: Steps to DELETE

- `consultant-ai.ts` (Step 5, Llama 8B) — delete entirely
- `consultant-ai-v2.ts` (Step 16, Llama 8B) — delete entirely
- `parallel-wow-apify.ts` Chain A (Llama 70B) — delete Chain A only, KEEP Chain B (Apify poll)

---

## Rollout Sequence

1. Deploy bridge reader first (add new reader, keep old paths working)
2. Deploy bridge queue logic (buildQueueV2, delete advanceV8Stage etc)
3. Deploy consultant writer (writeStagePlan)
4. Delete dead Llama steps
5. Remove old writer paths (write-early-stages, write-stages-late)
6. Cleanup compat helpers after verification

## Rollback

- Feature flag `BELLA_STAGE_PLAN_V2_ENABLED=false` → bridge skips stage_plan, synthesizes from MergedIntel
- Safer than returning to broken V8 script path

## Verification Checklist

- [ ] buildStageDirective() fires for every active stage
- [ ] No unknown stage defaults to wow
- [ ] Queue contains max 2 active ch_* stages + optional tease
- [ ] Deep late-load only changes future stages
- [ ] No code path reads script_stages.script
- [ ] Full conversation flow completes through all stages
- [ ] ROI calculations fire correctly during channel stages
