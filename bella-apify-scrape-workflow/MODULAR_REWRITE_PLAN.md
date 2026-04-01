# BELLA V9 WORKFLOW — MODULAR REWRITE PLAN
### Date: 2026-03-17 | Author: Claude Code audit of deployed.js
### Current deployed version: `12a3c734` (bella-scrape-workflow-v9-test)

---

## 1. CURRENT STATE AUDIT

### 1.1 Step Inventory (deployed.js lines 1664-2258)

Lines 1-1663 are bundled polyfills (unenv, Node.js shims). Actual workflow starts at line 1664.

| # | Step Name | Node ID | What It Does | Reads | Writes (KV) | Time (par_mar17) |
|---|-----------|---------|-------------|-------|-------------|-----------------|
| 0 | `step_entry_0` | node-entry | Parse event.payload (lid, url, name, firstName) | event.payload | — | instant |
| 1 | `step_kv_put_1` | node-kv-stub | Write stub to KV | step_0 (lid, name, url, firstName) | `lead:{lid}:stub` | ~1s |
| 2 | `step_http_request_2` | node-firecrawl | Firecrawl scrape of prospect URL | step_0.url, env.FIRECRAWL_KEY | — | ~3-5s |
| 3 | `step_transform_3` | node-truncate-content | Truncate Firecrawl markdown to 4000 chars | step_2.body | — | instant |
| 4 | `step_transform_4` | node-fire-apify | Fire 5 Apify actors (or reuse pre-fired from `/fire-apify` endpoint) | step_0 (name, url), env.APIFY_TOKEN, KV `lead:{lid}:apify_runs` | — | ~2s |
| 5 | `step_workers_ai_5` | node-consultant-ai | Workers AI Llama 3.1 **8B** — one paragraph of flattery from website content | step_3.content, step_0.name | — | ~2-3s |
| 6 | `step_kv_put_6` | node-kv-phase-a | Write AI summary to KV | step_5.text | `lead:{lid}:phase_a` | ~1s |
| E | `step_early_stages` | node-early-stages | **[OPT2]** Write 4-stage script_stages to KV | step_0 (lid, name) | `lead:{lid}:script_stages` | ~1s |
| 7 | `step_wait_event_7` | node-wait-call-connected | **NO-OP** (dead waitForEvent removed) | — | — | instant |
| P | `step_parallel_7` | node-parallel-wow-apify | **[OPT1]** Promise.all of Chain A + Chain B | (see sub-steps) | (see sub-steps) | ~34s total |
| P.A8 | _(inside parallel)_ | — | Read `phase_a` back from KV | KV `lead:{lid}:phase_a` | — | ~1s |
| P.A9 | _(inside parallel)_ | — | Workers AI Llama 3.1 **70B** — WOW script refinement | P.A8 value, step_0 (firstName, name) | — | ~5-8s |
| P.A10 | _(inside parallel)_ | — | Gemini 2.5 Flash — polish WOW for natural speech | P.A9 rawSnippet, env.GEMINI_API_KEY | — | ~3-5s |
| P.A11 | _(inside parallel)_ | — | Write polished snippet to KV | P.A10 polished | `lead:{lid}:stage1_snippet` | ~1s |
| P.B12 | _(inside parallel)_ | — | Poll all 5 Apify actors (15 iterations x 2s sleep, 45s timeout) | step_4 runIds, env.APIFY_TOKEN | — | ~30-34s |
| 13 | `step_transform_13` | node-extract-deep | Extract structured data from Apify results (ratings, ads, jobs, linkedin) | P.B12 output | — | ~1s |
| 14 | `step_kv_put_14` | node-kv-deep-flags | Write extracted deep data to KV | step_13.raw_json | `lead:{lid}:deep_flags` | ~1s |
| 15 | `step_kv_get_15` | node-kv-get-deep | **Read back** `deep_flags` we just wrote in step 14 | KV `lead:{lid}:deep_flags` | — | ~1s |
| 16 | `step_workers_ai_16` | node-consultant-ai-v2 | Workers AI Llama 3.1 **8B** — one paragraph of flattery from Apify data | step_15.value, step_0.name | — | ~2-3s |
| 17 | `step_transform_17` | node-build-intel-json | Build `{summary, deep_data}` JSON envelope | step_16.text, step_15.value | — | instant |
| 18 | `step_kv_put_18` | node-kv-write-intel | Write intel envelope to KV | step_17.json | `lead:{lid}:intel` | ~1s |
| 19s | `step_kv_put_script_stages` | node-kv-write-stages | **Safety net** — rewrite script_stages (duplicate of step E) | step_0 (lid, name) | `lead:{lid}:script_stages` | ~1s |
| 19 | `step_transform_19` | node-signal-update-kv | Return static signal `{signal: "update-kv", status: "intel-ready"}` | — | — | instant |
| 20 | `step_return_20` | node-return | Return final result `{status: "complete", lid, intel}` | step_0.lid, step_16.text | — | instant |

### 1.2 Timing Summary (from par_mar17 test)

```
T=0s    step_entry_0         (instant)
T=0-1s  step_kv_put_1        (stub write)
T=1-4s  step_http_request_2  (Firecrawl scrape)
T=4s    step_transform_3     (truncate — instant)
T=4-6s  step_transform_4     (fire 5 Apify actors)
T=6-7s  step_workers_ai_5    (Llama 3.1 8B analysis)
T=7s    step_kv_put_6        (phase_a write)
T=7-8s  step_early_stages    (script_stages write)   ← bridge gets V8 mode HERE
T=8s    step_wait_event_7    (no-op)
T=8-41s step_parallel_7      (34s — Apify poll is bottleneck)
T=41s   step_transform_13    (extract deep)
T=41s   step_kv_put_14       (deep_flags write)       ← bridge gets Apify data HERE
T=42s   step_kv_get_15       (redundant read-back)
T=42-45s step_workers_ai_16  (Llama 3.1 8B summary)
T=45s   step_transform_17    (build intel JSON)
T=45s   step_kv_put_18       (intel write)
T=46s   step_kv_put_script_stages (duplicate write)
T=46s   step_transform_19    (static signal)
T=46s   step_return_20       (return)
─────────────────────────────────────
TOTAL: ~54s (measured), ~46s (steps only, excl. Workflows engine overhead)
```

### 1.3 DEAD Steps (output never consumed)

| Step | Why It's Dead | Evidence |
|------|--------------|----------|
| **step_http_request_2** (Firecrawl) | fast-intel already scrapes the same URL with Firecrawl (with fallback chain). This workflow's scrape is redundant. | fast-intel writes `lead:{lid}:fast-intel` containing full page content, consultant analysis, tech stack. Workflow re-scrapes same URL. |
| **step_transform_3** (truncate) | Only feeds step_5 which feeds step_6 (phase_a). Phase_a is part of dead WOW chain. | See step_6 below. |
| **step_workers_ai_5** (Llama 8B) | Produces "phase_a" text — a weaker duplicate of fast-intel's Consultant analysis (Gemini-powered). | fast-intel's Consultant uses Gemini via service binding. This uses Llama 3.1 8B. Output only consumed by dead WOW chain. |
| **step_kv_put_6** (phase_a write) | Writes `lead:{lid}:phase_a` — **bridge NEVER reads this key**. Only read back by this workflow's own Chain A. | Bridge reads confirmed: phase_a is NOT in the read list. |
| **step_wait_event_7** (no-op) | Already a no-op. Was dead waitForEvent, removed in Fix 1. | Produces `{event: null, timedOut: true}` — nothing reads it. |
| **P.A8-A11** (WOW chain) | Entire Chain A of the parallel block. Reads phase_a → AI refine → Gemini polish → writes `stage1_snippet`. **Bridge NEVER reads `stage1_snippet`**. | Bridge reads confirmed: stage1_snippet is NOT in the read list. The bridge gets its WOW content from `fast-intel` → `consultant.scriptFills.website_positive_comment` and `bella_opener`. |
| **step_kv_get_15** (read-back) | Reads `deep_flags` immediately after step_14 just wrote it. The data is already in `_workflowResults.step_transform_13.raw_json`. | Pure waste — could use in-memory reference. |
| **step_kv_put_script_stages** (late duplicate) | Identical content to `step_early_stages`. Safety net write at T=46s; early write already succeeded at T=8s. | Produces identical 4-stage payload. |
| **step_transform_19** (signal) | Returns `{signal: "update-kv", status: "intel-ready"}` — nobody reads this. No webhook, no event dispatch. | Static return value consumed by nobody. |

### 1.4 Duplicate Work (already done by fast-intel)

| This Workflow | fast-intel | Quality Comparison |
|---------------|-----------|-------------------|
| step_2: Firecrawl scrape (`/v1/scrape`, markdown only, 4KB truncate) | `firecrawlScrape()`: `/v9/scrape`, markdown + HTML + extract + links, 20KB, with ScrapingAnt + direct-fetch fallback | **fast-intel is far superior** (structured extraction, fallback chain, more content) |
| step_5: Llama 3.1 8B "flattery paragraph" | `callConsultant()`: Gemini via service binding → businessIdentity, scriptFills, routing, conversationHooks | **fast-intel is far superior** (Gemini vs 8B, structured output vs free text) |
| step_6: Write `phase_a` to KV | fast-intel writes full intel envelope to `lead:{lid}:fast-intel` | fast-intel's output is comprehensive; phase_a is a weak summary |

---

## 2. DEPENDENCY GRAPH

### 2.1 Step Dependencies

```
step_entry_0 (payload)
├── step_kv_put_1 (stub)           → needs: lid, name, url, firstName
├── step_http_request_2 (firecrawl) → needs: url, FIRECRAWL_KEY
│   └── step_transform_3 (truncate) → needs: step_2.body
│       └── step_workers_ai_5 (AI)  → needs: step_3.content, name
│           └── step_kv_put_6 (phase_a) → needs: step_5.text, lid
├── step_transform_4 (fire apify)   → needs: name, url, APIFY_TOKEN, (optional: KV apify_runs)
├── step_early_stages (stages)      → needs: lid, name
│
│   [PARALLEL BLOCK — after steps 1-6 + E complete]
│   ├── Chain A (WOW): phase_a → AI 70B → Gemini → snippet  → needs: step_6 output
│   └── Chain B (Apify poll): poll runs → needs: step_4 output
│
│   [SEQUENTIAL — after parallel]
│   step_transform_13 (extract)     → needs: Chain B output
│   step_kv_put_14 (deep_flags)     → needs: step_13.raw_json
│   step_kv_get_15 (read-back)      → needs: step_14 to have written (REDUNDANT)
│   step_workers_ai_16 (AI summary) → needs: step_15.value (could use step_13 directly)
│   step_transform_17 (build intel) → needs: step_16.text, step_15.value
│   step_kv_put_18 (intel write)    → needs: step_17.json
│   step_kv_put_script_stages       → needs: lid, name (DUPLICATE of step_early_stages)
│   step_transform_19 (signal)      → needs: nothing (static)
│   step_return_20                   → needs: lid, step_16.text
```

### 2.2 Independence Analysis

**Can run in parallel (zero cross-deps):**
- `step_kv_put_1` (stub) ↔ `step_transform_4` (fire Apify) ↔ `step_early_stages` (stages)
  - All three only need `step_entry_0` fields
- Chain A (WOW) ↔ Chain B (Apify poll) — already parallelized in Opt 1

**Sequential chains:**
- Firecrawl → truncate → AI → phase_a → Chain A  (entire chain is DEAD)
- Fire Apify → poll → extract → deep_flags → (read-back) → AI summary → build intel → write intel

### 2.3 KV Writes: Bridge-Consumed vs Internal

| KV Key | Written By Step | Bridge Reads? | Priority in Merge | Verdict |
|--------|----------------|---------------|-------------------|---------|
| `lead:{lid}:stub` | step_1 | YES | Lowest (fallback) | **KEEP** — bridge's last-resort data |
| `lead:{lid}:phase_a` | step_6 | **NO** | N/A | **CUT** — internal to dead WOW chain |
| `lead:{lid}:script_stages` | step_E (early) | YES | Direct read | **KEEP** — activates V8 stage machine |
| `lead:{lid}:stage1_snippet` | Chain A step_11 | **NO** | N/A | **CUT** — nobody reads it |
| `lead:{lid}:deep_flags` | step_14 | YES | High (primary Apify source) | **KEEP** — bridge enriches flags from this |
| `lead:{lid}:intel` | step_18 | YES | Low (below fast-intel) | **QUESTIONABLE** — fast-intel's `fast-intel` key has higher priority. This adds `{summary, deep_data}` but bridge doesn't specifically extract `summary` field |
| `lead:{lid}:script_stages` | step_19s (late) | YES | Direct read | **CUT** — duplicate of early write |

---

## 3. PROPOSED MODULAR STRUCTURE

### 3.1 File Structure

```
bella-scrape-workflow-v9/
├── src/
│   ├── index.ts                    # Orchestrator — WorkflowEntrypoint, step.do calls, HTTP handler
│   ├── steps/
│   │   ├── write-stub.ts           # KV write: lead:{lid}:stub
│   │   ├── fire-apify.ts           # Fire 5 Apify actors (check pre-fired first)
│   │   ├── write-early-stages.ts   # KV write: lead:{lid}:script_stages
│   │   ├── poll-apify.ts           # Poll Apify runs, collect results
│   │   ├── extract-deep.ts         # Transform Apify results → structured deep data
│   │   ├── write-deep-flags.ts     # KV write: lead:{lid}:deep_flags
│   │   ├── summarize-deep.ts       # AI summary of Apify data (if kept)
│   │   └── write-intel.ts          # KV write: lead:{lid}:intel (if kept)
│   ├── lib/
│   │   ├── apify-client.ts         # Apify API helpers (fire, poll, collect)
│   │   └── types.ts                # Shared types (WorkflowPayload, ApifyRun, DeepFlags, etc.)
│   └── fire-apify-handler.ts       # HTTP handler for /fire-apify endpoint (extracted from fetch)
├── wrangler.toml
└── package.json
```

### 3.2 Orchestrator (index.ts)

```typescript
// PROPOSED — index.ts orchestrator
import { WorkflowEntrypoint } from "cloudflare:workers";

export class BellaV9Orchestrator extends WorkflowEntrypoint<Env, WorkflowPayload> {
  async run(event: WorkflowEvent<WorkflowPayload>, step: WorkflowStep) {
    const { lid, url, name, firstName } = event.payload;

    // ── Phase 1: Immediate writes (parallel, ~2s) ──────────────────────
    const [stubResult, apifyRuns, stagesResult] = await Promise.all([
      step.do("write-stub", () => writeStub(this.env, lid, name, url, firstName)),
      step.do("fire-apify", () => fireApify(this.env, lid, name, url)),
      step.do("write-early-stages", () => writeEarlyStages(this.env, lid, name)),
    ]);

    // ── Phase 2: Apify poll (~30-34s, bottleneck) ──────────────────────
    const apifyResults = await step.do("poll-apify", () =>
      pollApify(this.env, apifyRuns)
    );

    // ── Phase 3: Process + write (~3s) ─────────────────────────────────
    const deepFlags = await step.do("extract-deep", () =>
      extractDeep(apifyResults)
    );

    await step.do("write-deep-flags", () =>
      writeDeepFlags(this.env, lid, deepFlags)
    );

    // Optional: AI summary + intel write (see section 4 for cut analysis)
    // ...

    return { status: "complete", lid };
  }
}
```

### 3.3 Step Module Example

```typescript
// steps/fire-apify.ts
import type { Env } from "../lib/types";

const ACTORS = [
  { key: "facebook_ads", actor: "apify~facebook-ads-scraper", /* ... */ },
  { key: "google_ads",   actor: "apify~google-search-scraper", /* ... */ },
  { key: "indeed",       actor: "misceres~indeed-scraper", /* ... */ },
  { key: "google_maps",  actor: "compass~google-maps-reviews-scraper", /* ... */ },
  { key: "linkedin",     actor: "curious_coder~linkedin-company-scraper", /* ... */ },
] as const;

export async function fireApify(
  env: Env, lid: string, bizName: string, siteUrl: string
): Promise<Record<string, ApifyRun>> {
  // 1. Check for pre-fired runs from /fire-apify endpoint
  const prefiredRaw = await env.WORKFLOWS_KV.get(`lead:${lid}:apify_runs`);
  if (prefiredRaw) {
    const prefired = JSON.parse(prefiredRaw);
    if (Object.values(prefired).some(r => r?.runId)) return prefired;
  }

  // 2. Fallback: fire actors now
  const domain = new URL(siteUrl).hostname.replace("www.", "");
  const slug = bizName.toLowerCase().replace(/[^a-z0-9]/g, "-");
  const token = env.APIFY_TOKEN || env.APIFY_API_KEY;

  const results = await Promise.all(
    ACTORS.map(a => startActor(a, domain, slug, bizName, token))
  );

  return Object.fromEntries(results.map(r => [r.key, r]));
}
```

### 3.4 Service Binding Opportunities

| Current | Proposed | Rationale |
|---------|----------|-----------|
| Inline `this.env.AI.run("@cf/meta/llama-3.1-8b-instruct", ...)` | **Remove entirely** — step 5 (phase_a AI) is dead | Fast-intel already does this better with Gemini |
| Inline `this.env.AI.run("@cf/meta/llama-3.1-70b-instruct", ...)` | **Remove entirely** — Chain A WOW is dead | Bridge gets WOW from fast-intel's scriptFills |
| Inline `fetch("https://generativelanguage.googleapis.com/...")` for Gemini | **Remove entirely** — Gemini polish for dead snippet | Bridge doesn't read stage1_snippet |
| Inline `fetch("https://api.firecrawl.dev/v1/scrape")` | **Remove entirely** — Firecrawl scrape is redundant | fast-intel already scrapes with better fallbacks |
| Inline `fetch("https://api.apify.com/...")` for fire + poll | Keep as-is (direct fetch is fine for Apify API) | No Cloudflare service binding available for Apify |

**Net result:** Remove `AI` binding, remove `GEMINI_API_KEY` secret, remove `FIRECRAWL_KEY` secret. Only need `WORKFLOWS_KV` + `APIFY_TOKEN`.

### 3.5 AI Model Usage

| Step | Current Model | Proposed |
|------|--------------|----------|
| step_5 (phase_a) | Llama 3.1 8B | **DELETE** — redundant with fast-intel Consultant |
| Chain A step_9 (WOW refine) | Llama 3.1 70B | **DELETE** — bridge doesn't use stage1_snippet |
| Chain A step_10 (Gemini polish) | Gemini 2.5 Flash | **DELETE** — bridge doesn't use stage1_snippet |
| step_16 (deep summary) | Llama 3.1 8B | **KEEP or DELETE** — see section 4 analysis |

---

## 4. WHAT CAN BE CUT

### 4.1 Definite Cuts (zero bridge impact)

| Cut | Steps Removed | KV Writes Removed | Time Saved | Cost Saved |
|-----|---------------|-------------------|------------|------------|
| **Firecrawl scrape** | steps 2, 3 | — | ~5s from critical path | Firecrawl API call ($) |
| **Phase A AI + write** | steps 5, 6 | `lead:{lid}:phase_a` | ~3s from critical path | Workers AI inference |
| **WOW chain (Chain A)** | P.A8, P.A9, P.A10, P.A11 | `lead:{lid}:stage1_snippet` | 0s wall time (parallel), but CPU + Gemini cost | Llama 70B + Gemini API call ($$$) |
| **Dead waitForEvent no-op** | step 7 | — | 0s (already instant) | — |
| **Redundant KV read-back** | step 15 | — | ~1s | KV read op |
| **Duplicate script_stages** | step 19s | — | ~1s | KV write op |
| **Static signal** | step 19 | — | ~0s | — |

**Total critical path savings: ~9-10s** (from removing Firecrawl + AI + read-back + duplicate)

### 4.2 Questionable: `lead:{lid}:intel` Write (steps 16-18)

**Current state:**
- step_16 uses Llama 3.1 8B to generate a "flattery paragraph" from Apify data
- step_17 wraps it as `{summary: "...", deep_data: {...}}`
- step_18 writes to `lead:{lid}:intel`

**Bridge behavior:**
- Bridge reads `lead:{lid}:intel` in `loadMergedIntel()` at **lowest priority** (below `fast-intel`, below `deep_flags`)
- The merge spreads `{summary, deep_data}` into the root intel object
- Bridge's prompt building reads `intel.consultant?.scriptFills` (from fast-intel), `intel.deep` (from deep_flags), `intel.flags` (from fast-intel)
- **The `summary` field is NOT explicitly consumed** by any known bridge prompt path

**Recommendation:** CUT steps 16-18. The `deep_flags` write already gives the bridge all Apify data. The `summary` field from Llama 8B is low quality and unused.

If cut: saves ~3s + removes AI binding entirely.

### 4.3 Summary: Steps After Cuts

**KEEP (7 effective steps):**
| New # | Old Step | What | Time |
|-------|----------|------|------|
| 1 | step_kv_put_1 | Write stub | ~1s |
| 2 | step_transform_4 | Fire Apify actors | ~2s |
| 3 | step_early_stages | Write script_stages | ~1s |
| 4 | Chain B (poll) | Poll Apify actors | ~30-34s |
| 5 | step_transform_13 | Extract deep data | instant |
| 6 | step_kv_put_14 | Write deep_flags | ~1s |
| 7 | step_return_20 | Return | instant |

**Steps 1-3 can run in parallel** (all only need entry payload).

### 4.4 KV Writes After Cuts

| KV Key | When Written | Bridge Reads? | TTL |
|--------|-------------|---------------|-----|
| `lead:{lid}:stub` | T=0-1s | Yes (fallback) | 1h |
| `lead:{lid}:script_stages` | T=0-1s | Yes (V8 stages) | 24h |
| `lead:{lid}:deep_flags` | T=~35s | Yes (Apify data) | 1h |

**Removed:** `phase_a`, `stage1_snippet`, `intel`, `script_stages` (late duplicate)

---

## 5. TIMING TARGET

### 5.1 Current Timing (deployed, par_mar17)

```
Total wall time:           54s
script_stages available:   T=8s
deep_flags available:      T=41s
Critical path bottleneck:  Apify poll (34s)
Dead work time:            ~10s (Firecrawl, AI x3, Gemini, redundant reads)
Step count:                21+ (including sub-steps in parallel block)
External API calls:        Firecrawl, Workers AI x3, Gemini, Apify x5
Secrets required:          APIFY_TOKEN, FIRECRAWL_KEY, GEMINI_API_KEY
```

### 5.2 Target After Modular Rewrite

```
Total wall time:           ~36-38s
script_stages available:   T=1-2s (faster — no Firecrawl/AI blocking it)
deep_flags available:      T=~35s (Apify poll is irreducible)
Critical path bottleneck:  Apify poll (30-34s, unchanged)
Dead work:                 0
Step count:                7 (3 parallel + 4 sequential)
External API calls:        Apify x5 (fire + poll only)
Secrets required:          APIFY_TOKEN only
```

### 5.3 Timing Waterfall (After Rewrite)

```
T=0s       Parse payload
T=0-1s     ┌─ write-stub         (KV put)
           ├─ fire-apify          (5x Apify start)
           └─ write-early-stages  (KV put)     ← bridge gets V8 mode at T=1s!
T=1-34s    poll-apify             (15 iterations x 2s, 45s timeout)
T=34s      extract-deep           (transform — instant)
T=34-35s   write-deep-flags       (KV put)     ← bridge gets Apify data
T=35s      return
─────────────────────────────────────
TOTAL: ~35-38s
IMPROVEMENT: 16-18s faster (30% reduction)
```

### 5.4 What We Cannot Improve

- **Apify actor execution time** (~30-34s) — external dependency, actors need time to scrape Facebook, Google, Indeed, LinkedIn
- **Apify poll interval** (2s sleep between checks) — could reduce to 1s but adds API call volume
- **KV write latency** (~100-200ms per write) — negligible

### 5.5 Further Optimizations (Future, Not In This Rewrite)

1. **Reduce Apify poll interval** from 2s to 1s — saves ~15 iterations x 1s = net ~15s savings on late actors, but doubles API calls
2. **Stream partial deep_flags** — write `deep_flags` after EACH actor completes (not all 5). Bridge would get partial data sooner (e.g., Google Maps at T=15s)
3. **Eliminate stub write** — fast-intel already writes comprehensive data to `lead:{lid}:fast-intel`. The stub's only unique value is setting `status: "pending"`, which nothing checks
4. **Move script_stages to fast-intel** — fast-intel has the same `lid` + `name` data at T=0s, could write stages during the loading page, eliminating this workflow's involvement entirely

---

## 6. MIGRATION STRATEGY

### 6.1 Phase 1: Cut Dead Steps (Low Risk)

Remove dead steps from deployed.js **without changing file structure**. Same deployed.js, just fewer steps.

- Remove steps 2, 3, 5, 6 (Firecrawl + truncate + AI + phase_a)
- Remove Chain A from parallel block (keep Chain B as standalone step)
- Remove step 15 (redundant read-back)
- Remove steps 16, 17, 18 (AI summary + build intel + write intel)
- Remove step 19s (duplicate script_stages)
- Remove step 19 (static signal)
- Verify: 3 KV writes remain (stub, script_stages, deep_flags)

**Risk:** Low. All removed steps produce outputs the bridge never reads.

### 6.2 Phase 2: Parallelize Setup (Medium Risk)

Wrap stub + fire-apify + early-stages in a single `step.do` with `Promise.all`.

**Risk:** Medium. Cloudflare Workflows has specific semantics around step.do retries. Need to verify that parallel KV writes + HTTP calls inside a single step.do are safe.

### 6.3 Phase 3: TypeScript Rewrite (Higher Risk)

Convert from generated deployed.js to clean TypeScript modules. Requires changing `wrangler.toml` from `main = "src/deployed.js"` to `main = "src/index.ts"`.

**Risk:** Higher. The current deployed.js was generated by a visual workflow builder. A TypeScript rewrite needs careful testing to ensure identical behavior.

### 6.4 Phase 4: Remove Unused Bindings

- Remove `[ai]` binding from wrangler.toml
- Remove `FIRECRAWL_KEY` and `GEMINI_API_KEY` secrets
- Only keep: `WORKFLOWS_KV`, `APIFY_TOKEN`, `BELLAV9ORCHESTRATOR_WORKFLOW`

---

## 7. DECISION POINTS (Need Trent's Input)

1. **Cut `intel` write?** This removes the workflow's `lead:{lid}:intel` KV write. Bridge still gets all data from `fast-intel` and `deep_flags`. Llama 8B summary is low quality. But if any other system reads `lead:{lid}:intel` expecting this workflow's data, cutting it would break that.

2. **Cut `stub` write?** The stub provides `{status: "pending", basics: {name, url, firstName}}` which is the bridge's last-resort fallback. fast-intel writes much richer data to `lead:{lid}:fast-intel` within 8-12s. Is the stub still needed?

3. **Phase 1 first or full rewrite?** Phase 1 (cut dead steps in deployed.js) is low-risk and gets 80% of the improvement. Phase 3 (TypeScript rewrite) is cleaner but higher risk. Recommend Phase 1 first, then Phase 3 as a separate effort.

4. **Move script_stages to fast-intel?** This would make script_stages available at T=0s (during the loading page) instead of T=1s (after workflow starts). But it couples fast-intel to the stage machine definition, which currently lives in the workflow.
