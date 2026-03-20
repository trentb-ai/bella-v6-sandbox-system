# BELLA COMPLETE SYSTEM BRIEF — For Perplexity Research
## What We're Building, What Works, What's Broken, What's Next
## Date: 20 March 2026

---

## 1. WHAT BELLA IS

Bella is a voice AI agent that conducts personalised sales discovery calls
for Australian businesses. She scrapes a prospect's website, analyses their
business, and then calls them with a structured sales conversation that:

1. WOW stage: Proves she's done deep research on THEIR business
2. Anchor stage: Captures their customer value and measurement timeframe
3. Channel stages: Asks about their lead channels (website, ads, phone, old leads, reviews)
4. ROI delivery: Calculates and delivers per-agent revenue projections
5. Close: Offers a free trial

She sells 5 AI agents: Alex (speed-to-lead), Chris (website concierge),
Maddie (AI receptionist), Sarah (database reactivation), James (reputation).

## 2. CURRENT ARCHITECTURE

```
Browser → Netlify static site (loading page + demo page)
  → Loading page POSTs to fast-intel worker (scrapes website, runs consultant)
  → Demo page opens WebSocket to Voice Agent DO
    → Voice Agent connects to Deepgram (STT/TTS)
    → Deepgram calls Bridge worker for each turn (BYO LLM)
    → Bridge reads KV, builds prompt, streams Gemini 2.5 Flash
    → Gemini response → Deepgram TTS → browser audio
```

### Workers (all Cloudflare):
- fast-intel: Scrapes website via Firecrawl, runs fast+full consultant via Gemini
- deep-scrape-workflow: Fires 5 Apify actors for deep data (Google Maps, FB ads, hiring, etc.)
- consultant: Gemini analysis producing ICP, problems, solutions, routing, scoring
- bridge: THE BRAIN — reads KV, manages state machine, builds prompts, streams Gemini
- voice-agent: Durable Object, handles WebSocket, connects to Deepgram Voice Agent API
- tools-worker: Handles Deepgram function calls
- call-brain-do: NEW — Durable Object meant to replace bridge's state machine (WIP)

### Voice stack:
- STT: Deepgram Flux (flux-general-en) — conversational voice-agent-specific model
- TTS: Deepgram Aura-2-Theia-EN
- LLM: BYO LLM → Gemini 2.5 Flash via bridge worker
- Turn detection: Flux integrated end-of-turn detection

### Data pipeline:
- Firecrawl: Primary website scraper (fast, ~3s)
- ScrapingAnt: Fallback scraper
- Google Places API: Business name cross-reference, rating, reviews
- Apify actors (5 concurrent via CF Workflow):
  - Google Maps scraper → rating, review count, review samples with names
  - Facebook Ads scraper → ad count, creative text
  - Google Ads Transparency scraper → ad presence
  - Indeed/Seek job scraper → hiring signals
  - LinkedIn scraper → company presence

### State management:
- KV (leads-kv): Eventually consistent, currently used for everything
- Durable Object storage: Strongly consistent (DO brain, WIP)

---

## 3. WHAT'S WORKING (V1.0 — live)

- Full scraping pipeline: Firecrawl → fast consultant → deep scrape workflow
- 12-stall WOW stage with data-driven personalisation
- 5 channel stages with per-agent ROI calculations
- Consultant generates: ICP analysis, problems/solutions, conversion events,
  CTA breakdown, hiring analysis, agent routing, scorecard
- Google Places cross-reference for business name correction
- Service bindings between all workers (no public URL calls)
- Shadow mode: DO brain runs in parallel and logs diffs

### What's decent but could be better:
- Script text is old (pre-Perplexity), being backported now
- Bridge is 2,680 lines doing everything — brain, transport, state, prompts
- KV polled every turn (eventually consistent = sometimes stale)
- Extraction is inline with generation (same Gemini call does both)
- "About twenty" → null failures cause cascading extraction problems

---

## 4. THE DO BRAIN MIGRATION (V1.1 — in progress, separate Netlify)

### What we built:
- CallBrainDO: Durable Object that owns stage, stall, extraction, queue,
  ROI lock, spoken tracking, intel merge
- 9-stall WOW (Perplexity-approved script), IndustryLanguagePack,
  merged source question, consultant pre-built spoken lines
- NextTurnPacket contract: objective, chosenMove, criticalFacts, extractTargets
- Event-driven intel: fast-intel/workflow POST typed events to DO
- Shadow mode: DO runs in parallel, logs diffs, zero impact on live

### What broke on first flip:
- buildTinyPrompt() was 620 chars — Gemini had no persona, no history,
  no business context. Went off-script, hallucinated "Good catch", robotic.
- Intel timing race: first /turn hit before fast_intel_ready event landed.
  DO had empty intel, used raw page titles as business names.
- Extraction bug: bare numbers ("20") mapped to wrong field, causing
  infinite loops in channel stages.
- Stall counter mismatch between DO and bridge.

### What CC is fixing now:
1. Replace buildTinyPrompt() with buildDOTurnPrompt() — same ~3.5K rich
   prompt as old path, but swaps buildStageDirective() output for DO's
   chosenMove.text. Best of both worlds.
2. Fix bare number extraction fallback (web_leads already set → map to
   web_conversions)
3. Align extractTargetsForCurrentStage with moves.ts
4. Fix stall 2 skip (deliver trial mention without reputation)
5. Pass convMemory and CONFIRMED section to DO prompt

### Parallel environments:
- V1.0: demofunnelbellasandboxv8.netlify.app (live, old bridge, being backported)
- V1.1: bella-v11-do-brain.netlify.app (DO brain, separate workers, testing)

---

## 5. SCRAPER STATUS & KNOWN ISSUES

| Source | Status | Issue | Possible Fix |
|--------|--------|-------|-------------|
| Firecrawl | ✅ Working | Primary scraper, ~3s | None needed |
| ScrapingAnt | ✅ Working | Fallback only | None needed |
| Google Places | ✅ Working | Name cross-ref, rating, reviews | None needed |
| Google Maps (Apify) | ✅ Working | Rating, review samples with names | None needed |
| Consultant (Gemini) | ✅ Working | Full + fast synced | None needed |
| Facebook Ads (Apify) | ⚠️ Slow | Timeout at 120s, sometimes fails | Meta Ad Library API? |
| Google Ads (Apify) | ⚠️ Flaky | Retry added for no_id errors | Google Ads Transparency direct? |
| Indeed (Apify) | ❌ Broken | False positive matches | Needs tighter matching or different approach |
| Seek (Apify) | ❌ Not implemented | Never scheduled | Add to wave 2 |
| LinkedIn (Apify) | ❌ Broken | All null returns | Low priority, possibly blocked |
| Ad Landing Pages | ✅ New | Added in v9.12.0 | Needs more testing |

### Scraper pain points:
- Facebook Ads: Apify actor takes 60-120s+, often times out. Need faster alternative.
- Hiring signals: Indeed gives false positives. Seek not integrated. LinkedIn blocked.
- All Apify actors run via CF Workflow with durable retries but still slow.
- Deep data (Apify wave) arrives 30-45s into the call — WOW stalls 1-4 must be
  safe on fast-intel only.

---

## 6. UPCOMING ARCHITECTURAL ENHANCEMENTS (ideas, not committed)

### A. Specialist workers called from DO brain
Instead of one Gemini call doing everything, the DO could coordinate:
- bella-extractor-worker: Small, fast, structured JSON extraction from transcript
  (separate Gemini call with thinkingBudget:0, ~200ms)
- bella-generator-worker: Main voice response with full persona prompt (~800ms)
- bella-reranker-worker: Background analysis for queue reranking when new intel lands

Each as a service-bound worker, independently deployable, own CPU budget.
DO coordinates: extract → validate → generate. Never 1101 risk on DO.

### B. TurnAssets model (Perplexity's full vision)
Consultant generates TurnAssets (candidate moves per stage), not flat scriptFills.
DO selects best move per turn from candidates. NextTurnPacket shrinks Deepgram
prompts to <500 chars. Config packs (agent_pack, industry_pack, stage_pack)
make the engine reusable across Bella and future client agents.

### C. IndustryLanguagePack everywhere
Replace bare custTerm() with structured pack: singularOutcome, pluralOutcome,
leadNoun, conversionVerb, revenueEvent, kpiLabel, missedOpportunity, tone.
Resolution: consultant industry → toneAndVoice → keyword map → generic fallback.
Already implemented in DO brain moves.ts, needs backport to old bridge.

### D. Scraper improvements
- Replace Apify Facebook Ads with Meta Ad Library API (faster, direct)
- Replace Apify Google Ads with Google Ads Transparency Center direct scrape
- Fix Indeed false positives or replace with direct career page scraping
- Add Seek integration
- Consider SerpAPI for Google search results (more reliable than Apify)
- Firecrawl + Gemini as fast primary ad intelligence path (already partially working)

### E. Prompt budget control
- Deepgram UpdatePrompt appends, doesn't replace. 25K char cap on managed LLMs.
- Current bridge sends ~3.5K per turn (acceptable but could shrink)
- DO brain NextTurnPacket targets <500 chars per turn
- Stage-adaptive Flux configuration: different turn-taking per conversation stage

### F. Late-data handling improvements
- Event-driven intel updates to DO (built, deployed)
- Workflow emits events as data arrives mid-call
- No-surprise-machine rule: never say "I just noticed new data"
- rebuildFutureQueue on late load: preserve current/completed, rerank future only

### G. Conversation quality improvements
- Extraction separated from generation (DO validates before advancing)
- ROI delivery lock: close blocked until ROI spoken (state invariant)
- Spoken tracker: prevents repeating moves/facts
- Retry tracking: extraction misses counted, fallback after 3 failures
- History distillation: compress old turns, keep last 6 raw

---

## 7. THE QUESTION FOR PERPLEXITY

Given everything above — what we have, what's built, what's broken, and
the architectural options on the table — what are the highest-ROI
enhancements we should prioritise?

Specifically:

1. **Specialist workers from DO**: Is splitting extraction into a separate
   Gemini worker (fast, structured, thinkingBudget:0) the right next move
   after the DO brain prompt fix ships? What's the latency/quality tradeoff?

2. **Scraper stack**: What's the fastest, most reliable replacement for
   our flaky Apify actors? Meta Ad Library API for Facebook ads? Direct
   Google Ads Transparency scrape? SerpAPI? Career page scraping vs Indeed?
   What's the modern best practice for fast business intelligence gathering?

3. **Prompt architecture**: Should we pursue the TurnAssets model now
   (consultant generates candidate moves, DO selects best per turn) or is
   the current "DO picks one move, bridge formats rich prompt" good enough
   for the next 3-6 months?

4. **Deepgram optimisation**: We have Flux, Nova-3, Aura-2, UpdateThink,
   stage-adaptive config. What else can we squeeze out of Deepgram's Voice
   Agent API for latency, turn-taking accuracy, and voice quality?

5. **Multi-agent coordination**: The DO brain coordinates one call. Could
   we have multiple DOs for different parts of the conversation? Or is
   the single-DO model correct and we just need better internal coordination?

6. **Reusability**: We want to sell this engine to other businesses.
   What's the minimum set of config packs (agent_pack, industry_pack,
   stage_pack) needed to make Bella's engine reusable without code changes?

7. **Cost optimisation**: We're a hungry startup on low budget. Where are
   the biggest cost saves — Gemini model choices, Apify alternatives,
   Deepgram tier, Cloudflare workers pricing, caching strategies?

---

## 8. TECH STACK SUMMARY

| Layer | Tech | Notes |
|-------|------|-------|
| Frontend | Netlify static HTML | Two sites: V1.0 live + V1.1 testing |
| Workers | Cloudflare Workers | 8+ workers, service bindings throughout |
| State | CF Durable Objects + KV | DO for live state, KV for snapshots |
| Workflows | CF Workflows | Durable multi-step enrichment pipeline |
| Voice | Deepgram Voice Agent API | BYO LLM, Flux STT, Aura-2 TTS |
| LLM | Google Gemini 2.5 Flash | Via bridge worker, BYO LLM endpoint |
| Scraping | Firecrawl + Apify + ScrapingAnt | Firecrawl primary, Apify deep, ScrapingAnt fallback |
| Places | Google Places API | Name cross-ref, rating, reviews |
| Consultant | Gemini 2.5 Flash | ICP, routing, scoring, pre-built spoken lines |

---

*This brief covers the complete Bella system as of 20 March 2026.
Use it to research the highest-ROI enhancements across architecture,
scrapers, prompt design, voice quality, and cost optimisation.*
