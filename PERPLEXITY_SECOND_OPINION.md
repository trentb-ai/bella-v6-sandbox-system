# PERPLEXITY SECOND OPINION — Bella V9 Scraping & Enrichment Migration

## CONTEXT

We're building a voice AI sales agent called Bella that runs on Cloudflare Workers. The system scrapes prospect websites, enriches the data through multiple APIs, and uses it to power personalised sales conversations via Deepgram Voice Agent + Gemini 2.5 Flash.

We have a SCRAPING AND ENRICHMENT PROBLEM: three separate workers doing overlapping work with race conditions, duplicate API calls, and a 2,696-line bridge worker that merges 5 KV keys per turn because nobody agreed on a single data format.

We want to migrate everything into a single Cloudflare Workflows pipeline. Below is our audit. We need your second opinion, enhancement suggestions, gotchas, and any battle-tested patterns or tools we're missing.

---

## CURRENT ARCHITECTURE (BROKEN)

### Worker 1: fast-intel-sandbox-v9 (1,292 lines)
Fires immediately on form submit (~8s window). Does:
- Firecrawl v1 scrape with FULL LLM extraction schema (services, CTAs, tech stack, 20+ fields)
- ScrapingAnt fallback (raw HTML when Firecrawl fails)
- Direct HTTP fetch fallback (bare GET as last resort)
- Content cleaning: strips nav/menu/footer, extracts post-H1 content
- Tech stack detection from raw HTML (CRM, chat widget, booking, ecommerce signals)
- Business name extraction from JSON-LD, footer copyright, og:site_name
- Fast Consultant call (/fast endpoint via Cloudflare service binding, ~2.7s, returns 6 fields)
- Full Consultant call (via service binding, ~35s, returns complete scriptFills + routing)
- Industry guessing from raw page text
- Fires Apify deep scrape via service binding
- Writes to KV: `lead:{lid}:fast-intel` and `lead:{lid}:starter`

### Worker 2: bella-scrape-workflow-v9 (already using Cloudflare Workflows step.do())
Deep scrape pipeline. Steps:
- write-stub → KV status marker
- firecrawl-scrape → Firecrawl v1 (markdown only, onlyMainContent: true) — **DUPLICATE of fast-intel's scrape**
- truncate-content → Truncate markdown
- fire-apify → Fire 5 Apify actors (Google Maps, Facebook Ads, Indeed, Seek, Google Ads Transparency)
- poll-apify-deep → Durable poll until results ready
- extract-deep → Parse Apify results into structured flags (hiring, reviews, ads)
- write-deep-flags → KV write `lead:{lid}:deep_flags`
- read-deep-flags → Read back for verification
- build-intel → Build complete intel JSON
- write-intel → Write final intel to KV

### Worker 3: deepgram-bridge-v9 (2,696 lines — THE MONSTER)
Per-turn HTTP handler. Called every time the user speaks. Scraping/data-related logic:
- `loadMergedIntel()` — reads 5 separate KV keys per turn, merges with priority chain: stub → deep → deepFlags → oldIntel → fast
- `loadCallBrief()` — V9 pattern reads single `lead:{lid}:call_brief` blob, falls back to loadMergedIntel
- Manual snake_case→camelCase translation of 30+ deep flag fields
- Embedding/vector retrieval for knowledge injection
- Script fill reading from intel for prompt construction
- ROI calculation reading
- Stage-specific prompt building consuming the merged intel

## KEY PROBLEMS

1. **Firecrawl runs TWICE** — fast-intel (full extraction) AND workflow (markdown only)
2. **Bridge reads 5 KV keys per turn** — latency on every turn, merge complexity, race conditions
3. **Two different Firecrawl schemas** — fast-intel gets rich extracted data; workflow gets thin markdown
4. **Business name resolved independently by each worker** — no single authority
5. **Consultant called from fast-intel, not the workflow** — workflow has no consultant step
6. **Starter KV too thin** — bridge stalls 1-4 don't have enough data for rich conversation
7. **snake_case/camelCase mismatch** — workflow writes snake_case, bridge expects camelCase, 30+ field manual translations

---

## PROPOSED: UNIFIED ENRICHMENT WORKFLOW

Merge fast-intel + bella-scrape-workflow into ONE Cloudflare Workflow with 15 durable steps:

```
step.do("write_stub")         → KV status marker
step.do("scrape_page")        → Firecrawl (full extraction) + direct fetch PARALLEL inside one step
step.do("fast_consultant")    → /fast endpoint via service binding, ~3s, NAME AUTHORITY
step.do("google_places")      → Cross-ref business name, get rating/reviews, ~500ms
step.do("write_starter_kv")   → Bridge has rich data for stalls 1-4 (scrape + consultant + Places)
step.do("fire_apify_wave1")   → Uses confirmed name from fast_consultant
step.do("full_consultant")    → Complete analysis, runs after starter is written
step.do("write_full_kv")      → Complete scriptFills, routing, scorecard
step.do("poll_apify_wave1")   → Durable retry until data ready
step.do("fire_apify_wave2")   → Second wave scrapers
step.do("poll_apify_wave2")   → Durable retry
step.do("extract_deep")       → Hiring classification, reviews, ads analysis
step.do("write_deep_flags")   → Deep track flags
step.do("build_final_intel")  → Assemble single call_brief blob in bridge's expected format
step.do("write_final_intel")  → Single KV write: lead:{lid}:call_brief
```

Bridge changes: `loadMergedIntel()` DELETED, `loadCallBrief()` becomes primary, all snake/camel translation DELETED (workflow writes correct format).

---

## WHAT WE NEED FROM YOU

### 1. Architecture Review
- Is 15 step.do() calls in a single Cloudflare Workflow reasonable? Any known limits on step count?
- The first 5 steps MUST complete within ~8 seconds (loading animation window). Is that realistic for Cloudflare Workflows, or is there per-step overhead that makes this too slow?
- Should `scrape_page` and `fast_consultant` run in PARALLEL (Promise.allSettled inside one step) rather than sequential? The scrape takes 3-6s and consultant takes 2.7s — sequential = 6-9s which blows the 8s window.

### 2. Cloudflare Workflows Gotchas
- What's the maximum execution time for a single workflow run?
- Is there a limit on the number of step.do() calls?
- What happens if a step.do() callback makes an external HTTP call (Firecrawl, Apify) that takes >30s?
- Can a workflow write to KV mid-run (at step 5) and have another worker (the bridge) read that KV value immediately?
- What's the cold-start overhead per step.do() call?

### 3. Scraping Enhancements
- Are there better alternatives to Firecrawl for single-page extraction that are faster or cheaper?
- For the Apify polling pattern (fire actors, poll until done), is there a webhook-based alternative that avoids polling entirely? Cloudflare Workflows has `step.waitForEvent()` — could Apify send a webhook to the workflow?
- Is ScrapingAnt still a viable fallback? Are there better fallback scrapers?
- Any patterns for handling Firecrawl timeouts more gracefully than abort-after-12s?

### 4. Battle-Tested Patterns
- Has anyone published a Cloudflare Workflow that does web scraping + enrichment at scale?
- Are there existing open-source data enrichment pipelines on Cloudflare Workers we should reference?
- For the fast consultant (Gemini 2.5 Flash, ~3s, 6-field response), is there a way to make this faster? Structured output? Smaller context window?
- Any patterns for ensuring the bridge gets data within a hard time budget (8s) when the enrichment workflow may still be running?

### 5. Alternative Approaches
- Should we consider Cloudflare Queues instead of/alongside Workflows for the Apify polling?
- Would Durable Objects with alarms be better than Workflows for the long-running Apify poll steps?
- Is there a way to split the workflow into a "fast path" (steps 1-5, must complete in 8s) and a "slow path" (steps 6-15, can take 60-120s) as two separate workflows triggered sequentially?

### 6. Data Format
- For the single call_brief blob, should we use a typed schema (TypeScript interface) or keep it as loose JSON?
- Any patterns for versioning the call_brief schema so old briefs still work after updates?
- Should the call_brief include raw scrape data or only processed/cleaned data?

---

## KEY CONSTRAINTS

- Cloudflare Workers runtime (not Node.js)
- Pay As You Go plan (50ms CPU time per invocation)
- KV for all state (not D1 or R2)
- Gemini 2.5 Flash as LLM (via bridge, not Workers AI)
- Deepgram Voice Agent API for voice (BYO LLM, Flux STT, Aura-2 TTS)
- Australian market — business data sources are Google Maps, Indeed AU, Seek, Facebook Ads Library
- Budget-constrained startup — every API call costs money
- The 8-second loading animation is a HARD constraint — Bella must have data when she starts talking

Please provide specific, actionable recommendations with links to official docs or repos where possible.
