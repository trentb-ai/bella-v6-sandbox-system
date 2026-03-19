# BELLA V9 — PHASE 1 & 2 EXECUTION PLAN (UPDATED)
## For Claude Code — 19 March 2026
## Updated with CountsEdge test findings + scraper audit

---

## SKILLS TO LOAD BEFORE STARTING

Read these skill files FIRST, in this order:

```
~/.claude/skills/bella-gsd/SKILL.md                    — Operating principles (GSD)
~/.claude/skills/superpowers/systematic-debugging/SKILL.md  — Debugging methodology
~/.claude/skills/bella-cloudflare/SKILL.md              — Cloudflare patterns
~/.claude/skills/bella-cloudflare/VERIFIED.md           — Verified CF facts
~/.claude/skills/bella-google-places/SKILL.md           — Google Places API
~/.claude/skills/bella-google-places/VERIFIED.md        — Verified Places facts
~/.claude/skills/bella-apify/SKILL.md                   — Apify patterns
~/.claude/skills/bella-firecrawl/SKILL.md               — Firecrawl patterns
~/.claude/skills/cloudflare/workers-kv-do/SKILL.md      — KV ops + DO patterns
~/.claude/skills/cloudflare/wrangler-cli.md             — Deploy/verify commands
```

Also read the handover before any code changes:
```
HANDOVER_SESSION_19MAR.md
CLAUDE.md
```
---

## CONSENSUS (Claude.ai + CC + Perplexity)

The unified workflow rewrite is architecturally correct but premature. Fix user-facing problems with targeted patches. Full pipeline rewrite waits until conversation flow is stable.

Key findings from CountsEdge test (anon_ty0gumpi):
- Google Maps: ✅ WORKING (5★, 10 reviews) — DO NOT REPLACE, augment with Places API
- Consultant: ✅ WORKING (full scriptFills, routing, ICP)
- Facebook Ads: ❌ TIMEOUT (actor timed out, 0 items)
- Google Search: ❌ NO_RUN (actor didn't even start — no run ID returned)
- Indeed: ❌ FALSE POSITIVE (1 raw item = page metadata, 0 actual jobs)
- Seek: ❌ NOT SCHEDULED (not in waves at all)
- LinkedIn: ❌ ALL NULL (scraper returned nothing)
- Ad Landing Pages: ❌ NOT SCRAPED AT ALL
- CRITICAL BUG: adsOn uses ?? instead of || — deep.ads data never reaches bridge

---

## GSD OPERATING RULES FOR THIS SESSION

1. ONE change at a time. Deploy after EACH change. Verify EACH one.
2. Read deployed code before modifying (wrangler tail, check KV state).
3. Use systematic-debugging for any bugs: root cause FIRST, then fix.
4. Deploy-and-verify cycle for every change:
   - Bump version string
   - wrangler deploy --dry-run
   - wrangler deploy
   - wrangler secret list (verify secrets)
   - wrangler tail --format=json (watch 30s)
   - Run test
5. NO "while I'm here" refactoring. Stay on task.
6. If 3 fix attempts fail on one task → STOP, flag as blocked.
---

## PHASE 1: CRITICAL BUGS (from CountsEdge transcript + test)

### P1-T0a: Fix adsOn Bug — ?? vs || + Wrong Deep Path
- **Problem:** Bridge line ~1621. `flags.is_running_ads = false` is NOT null/undefined, so `??` stops there and returns false. Deep data checks never reached. Also `deep.ads?.fb?.running` is OLD format — actual path is `deep.ads.is_running_google_ads`.
- **Impact:** CRITICAL — Bella thinks no ads running even when deep scrape CONFIRMS Google Ads active
- **File:** `deepgram-bridge-v9/src/index.ts` line ~1621-1624
- **Fix:**
  ```typescript
  // BEFORE (broken):
  const adsOn = !!(
    ts.is_running_ads ?? flags.is_running_ads ?? flags.has_fb_pixel ?? flags.has_google_ads
    ?? deep.ads?.fb?.running ?? deep.ads?.google?.running
  );
  
  // AFTER (fixed):
  const adsOn = !!(
    ts.is_running_ads || flags.is_running_ads || flags.has_fb_pixel || flags.has_google_ads
    || deep?.ads?.is_running_google_ads || (deep?.ads?.fb_ads_count > 0)
    || (deep?.ads?.google_ads_count > 0) || (deep?.ads?.google_search_count > 0)
  );
  ```
- **Validation:** Tail bridge, trigger call for business with known Google Ads. Verify adsOn=true in logs.
- **Deploy:** Bump bridge version, deploy, verify
### P1-T0b: Fix Extraction Bug — "Maybe a hundred" Not Captured
- **Problem:** From best call transcript: user said "Maybe a hundred" at ch_website stall 0 → extractions=0. Number not captured. Then "twenty" (CONVERSIONS answer) got captured as web_leads=20. Cascaded through entire close stage.
- **Impact:** CRITICAL — ROI numbers were wrong, prospect noticed and ended call
- **File:** `deepgram-bridge-v9/src/index.ts` (extraction regex section)
- **Root Cause Investigation:**
  1. Search for the extraction regex that handles numeric capture
  2. Check if "maybe" / "about" / "probably" prefixes are handled
  3. Check if the regex expects a clean number without qualifiers
- **Fix approach:** Extraction regex must handle: "maybe a hundred", "about 100", "probably around a hundred", "roughly 100", "like a hundred"
- **Validation:** Simulate bridge turn with text "Maybe a hundred" — verify extractions > 0 and value = 100
- **Deploy:** Bundle with P1-T0a in same bridge deploy

### P1-T0c: Fix Close Stage — ROI Never Delivered
- **Problem:** From best call: Alex=$11,279/wk, Chris=$442/wk, total=$11,721/wk were CALCULATED but never spoken. Close stage kept looping at stall=0 without delivering numbers.
- **Impact:** CRITICAL — the entire point of the call is the ROI pitch and it never happened
- **File:** `deepgram-bridge-v9/src/index.ts` (close stage / ROI delivery section)
- **Root Cause Investigation:**
  1. Check close stage prompt — does it instruct Bella to deliver the ROI numbers?
  2. Check if calc_ready flag is being set correctly
  3. Check if the close stage gate-open condition includes ROI delivery
- **Fix approach:** Close stage MUST deliver ROI numbers before any other close behavior
- **Validation:** Trigger close stage with known calcs, verify ROI numbers appear in Gemini response
- **Deploy:** Bundle with P1-T0a and P1-T0b
### P1-T1: Gemini Ignoring "SAY EXACTLY THIS" Directives
- **Problem:** Gemini paraphrases scripted lines instead of speaking them verbatim
- **Impact:** HIGH — Bella sounds generic instead of following the crafted sales script
- **File:** `deepgram-bridge-v9/src/index.ts` (prompt construction sections)
- **Fix approach:**
  - Lower temperature further (try 0.3-0.5 for scripted sections)
  - Use XML delimiters: `<SPEAK_VERBATIM>text here</SPEAK_VERBATIM>`
  - Add post-generation check in bridge: compare output to expected script line
- **Validation:** Tail bridge logs, check Gemini response contains exact script text
- **Deploy:** Bump bridge version, deploy, verify, tail

### P1-T2: "NEVER APOLOGISE" Rule Ignored by Gemini
- **Problem:** 6+ apologies in best call transcript. Bella said "My apologies" at lines 425, 446, 483, 504, 601, 640, 662, 680.
- **Impact:** HIGH — call ended partly because of compounding apologies + errors
- **File:** `deepgram-bridge-v9/src/index.ts` (system prompt section)
- **Fix approach:**
  - Move to earliest position in system prompt (highest priority)
  - Explicit constraint: "CONSTRAINT: You MUST NOT use words 'sorry', 'apologize', 'apologies', 'apology', 'my apologies' in any response. When corrected, pivot to data."
  - Add word-level blocklist in bridge post-processing — strip apology phrases before sending to TTS
- **Validation:** Tail bridge logs during test call, grep for apologize/sorry/apologies
- **Deploy:** Bundle with P1-T1

### P1-T3: reqUrl=null in Voice Agent DO
- **Problem:** URL hints not reaching connection.request in the voice agent DO
- **Impact:** MEDIUM — urlHints fallback behavior not working
- **File:** `voice-agent-source-sandbox-v9/src/` (or `voice-agent-v9/src/`)
- **Fix approach:** Pass urlHints via initial HTTP request headers or first WebSocket message
- **Validation:** Log urlHints on connection, verify they persist across hibernation wake
- **Deploy:** Bump voice agent version, deploy, verify

### P1-T4: Starter KV Too Thin for Rich Conversation (Stalls 1-4)
- **Problem:** lead:{lid}:starter only contains fast consultant output (~1.5KB)
- **Impact:** HIGH — Bella's early conversation lacks depth
- **File:** `fast-intel-sandbox-v9/src/index.ts` (starter KV write section)
- **Fix approach:** Enrich starter KV write with scrape data (services, CTAs, tech stack, industry) alongside fast consultant output
- **Validation:** Check KV value size after write, verify bridge can read all needed fields
- **Deploy:** Bump fast-intel version, deploy, verify
---

## PHASE 2: DATA PIPELINE PATCHES + SCRAPER FIXES

### P2-T1: Fix Business Name — Google Places Cross-Reference
- **Problem:** Each worker resolves business name independently → prospect hears wrong name
- **Impact:** HIGH — prospect-facing
- **File:** `fast-intel-sandbox-v9/src/index.ts`
- **What to do:**
  1. After fast consultant returns `correctedName`, call Google Places Text Search
  2. Endpoint: `POST https://places.googleapis.com/v1/places:searchText`
  3. Body: `{ "textQuery": "{correctedName} {domain locality}" }`
  4. If Places returns a match → use Places name as AUTHORITY, also grab rating + review count
  5. If no match → keep consultant name, flag as unverified
  6. Write confirmed name + Places data to KV with starter data
- **NOTE:** Google Maps Apify actor STAYS — it works. Places API AUGMENTS, does not replace.
- **Requires:** `GOOGLE_PLACES_API_KEY` secret added to fast-intel worker
- **Estimated lines:** ~30-50
- **Deploy:** Bump fast-intel to v1.8.0, deploy, verify secrets, tail

### P2-T2: Fire Apify Earlier — Before Full Consultant
- **Problem:** fireApifyEarly() fires AFTER full consultant call (~35s delay)
- **Impact:** HIGH — deep data arrives 35s later than necessary
- **File:** `fast-intel-sandbox-v9/src/index.ts`
- **What to do:** Move `fireApifyEarly()` call to IMMEDIATELY after fast consultant returns, BEFORE full consultant. Fast consultant gives confirmed name — that's all Apify needs.
- **Estimated lines:** ~5 (move one function call)
- **Deploy:** Bundle with P2-T1
### P2-T3: Fix Google Search — Switch to SERP API
- **Problem:** `apify~google-search-scraper` returning no run ID — actor broken/deprecated
- **Impact:** HIGH — zero organic search results, no competing listings, no SEO data
- **File:** `bella-scrape-workflow-v9/src/steps/fire-apify.ts` OR `fast-intel-sandbox-v9/src/index.ts`
- **What to do:**
  1. Replace the broken Apify Google Search actor with a SERP API call
  2. Options: SerpAPI, ValueSERP, or SerpStack — all have simple REST endpoints
  3. Query: `{businessName} {location}` — get top 10 organic results + knowledge panel
  4. This runs from a Worker (simple HTTP fetch, no browser needed)
  5. Parse results for: competing businesses, SEO position, knowledge panel data
- **Requires:** SERP API key (choose provider, add secret)
- **Estimated lines:** ~40-60
- **Deploy:** Separate deploy to workflow or fast-intel depending on where we put it

### P2-T4: Fix Facebook Ads — Consider Meta Ad Library API
- **Problem:** Apify FB Ads actor timing out (0 items). Browser-heavy scraping unreliable.
- **Impact:** MEDIUM — can't tell if business runs FB campaigns
- **File:** `bella-scrape-workflow-v9/src/steps/fire-apify.ts`
- **What to do:**
  1. OPTION A: Increase wave timeout for FB Ads actor (quick fix, may not solve root cause)
  2. OPTION B: Switch to Meta Ad Library API (Graph `ads_archive` endpoint)
     - Direct API, no browser needed, no timeouts
     - Requires Meta app setup + access token
     - More reliable long-term
  3. For TODAY: Try Option A first. File Option B for Phase 3.
- **Estimated lines:** ~5-10 for timeout increase
- **Deploy:** Bundle with workflow changes

### P2-T5: Add Seek to Waves
- **Problem:** Seek jobs not scheduled in ANY wave. Missing AU hiring data entirely.
- **Impact:** MEDIUM — can't detect hiring signals for Australian businesses
- **File:** `bella-scrape-workflow-v9/src/steps/fire-apify.ts` (or wherever waves are configured)
- **What to do:**
  1. Find where wave actors are defined
  2. Add Seek jobs actor to wave 1 or wave 2
  3. Perplexity says Seek is the easiest DIY replacement (256MB actor = just HTML parse)
  4. For TODAY: just add to existing Apify waves. DIY Worker replacement is Phase 3.
- **Estimated lines:** ~10-15
- **Deploy:** Bundle with P2-T4
### P2-T6: Kill Duplicate Firecrawl in Workflow
- **Problem:** bella-scrape-workflow-v9 runs its own Firecrawl scrape even though fast-intel already scraped
- **Impact:** MEDIUM — double API cost, wasted latency
- **File:** `bella-scrape-workflow-v9/src/steps/firecrawl-scrape.ts`
- **What to do:** Check if `lead:{lid}:fast-intel` exists in KV. If yes → skip Firecrawl. If no → run as normal.
- **Estimated lines:** ~10-15
- **Deploy:** Bundle with P2-T4 and P2-T5

### P2-T7: Tiered Scraping — Direct Fetch First, Firecrawl as Escalation
- **Problem:** Always hitting Firecrawl first adds cost and latency even for simple AU SMB sites
- **Impact:** MEDIUM — faster + cheaper for majority of sites
- **File:** `fast-intel-sandbox-v9/src/index.ts`
- **What to do:**
  1. Run `directFetch()` FIRST (already exists, ~1-2s)
  2. Extract meta/title/h1/description from raw HTML (already have `extractMetaFromHtml()`)
  3. Run `detectTechStack()` on raw HTML (already exists)
  4. If title + h1 + description + >500 chars body → SKIP Firecrawl
  5. If key fields missing → THEN escalate to Firecrawl
- **Estimated lines:** ~50-80
- **Deploy:** Bundle with P2-T1 and P2-T2 into fast-intel v1.8.0

### P2-T8: Define CallBrief TypeScript Interface
- **Problem:** No typed schema for call_brief blob → schema drift, snake/camel mess
- **Impact:** LOW now, HIGH later — foundation for Phase 3
- **File:** `shared/call-brief.ts` (NEW FILE)
- **What to do:**
  1. Define `CallBriefV1` interface based on what bridge's `loadCallBrief()` expects
  2. Add `schemaVersion: 1` field
  3. Add `readiness` flags: `{ hasFastConsultant, hasFullConsultant, hasDeepFlags, hasPlaces }`
  4. Do NOT change the bridge yet — just define the target shape
- **Estimated lines:** ~30
- **Deploy:** No deploy needed — type definition only
---

## EXECUTION ORDER

Execute sequentially. ONE task at a time. Deploy-and-verify after EACH.

```
PHASE 1 — CRITICAL BUGS (bridge + voice agent):
  P1-T0a: Fix adsOn ?? vs || bug (bridge line ~1621)          ← CRITICAL
  P1-T0b: Fix extraction regex — "maybe a hundred" = 100      ← CRITICAL  
  P1-T0c: Fix close stage — deliver ROI numbers                ← CRITICAL
  P1-T1:  Fix SAY EXACTLY THIS (bridge prompt + temperature)
  P1-T2:  Fix NEVER APOLOGISE (bridge prompt + post-processing)
  P1-T3:  Fix reqUrl=null (voice agent DO)
  P1-T4:  Enrich starter KV (fast-intel)

PHASE 2 — DATA PIPELINE PATCHES (fast-intel + workflow):
  P2-T1:  Google Places cross-ref for business name (fast-intel)
  P2-T2:  Fire Apify earlier (fast-intel — 5 line move)
  P2-T3:  Switch Google Search to SERP API (replace broken actor)
  P2-T4:  Fix FB Ads timeout (increase wave timeout)
  P2-T5:  Add Seek to waves
  P2-T6:  Kill duplicate Firecrawl (workflow)
  P2-T7:  Tiered scraping (fast-intel)
  P2-T8:  Define CallBrief interface (shared/ — no deploy)
```

### Batching Guidance
- P1-T0a + P1-T0b + P1-T0c + P1-T1 + P1-T2 can be ONE bridge deploy (all bridge changes)
- P1-T3 is separate (voice agent deploy)
- P1-T4 + P2-T1 + P2-T2 + P2-T7 can be ONE fast-intel v1.8.0 deploy
- P2-T3 depends on SERP API choice — may be workflow or fast-intel
- P2-T4 + P2-T5 + P2-T6 can be ONE workflow deploy
- P2-T8 is no deploy (type definition)

### Total Estimated Changes
- Bridge: ~100-150 lines changed (bugs + prompt fixes)
- Fast-intel: ~130-190 lines changed (Places, Apify timing, tiered scraping, starter KV)
- Voice agent: ~20-30 lines changed
- Workflow: ~30-50 lines changed (Seek, FB timeout, kill dupe Firecrawl)
- SERP integration: ~40-60 lines new
- Shared types: ~30 lines new
- **Total: ~350-510 lines across 5-6 files**
---

## WHAT IS NOT IN SCOPE TODAY

Filed for Phase 3 (when conversation flow is stable):

- Full unified workflow rewrite (merge fast-intel + workflow into one)
- Durable Object for starter handoff consistency
- Apify webhooks + step.waitForEvent() (replacing polling)
- Bridge modularisation (splitting 2,696-line file)
- loadMergedIntel() removal
- snake/camel translation removal
- Meta Ad Library API (replacing FB Ads Apify actor)
- Seek DIY Worker (replacing Seek Apify actor)
- Ad landing page scraping (new capability)
- LinkedIn replacement
- Indeed direct fetch replacement

---

## SECRETS CHECKLIST

Before starting, verify these secrets exist on relevant workers:

```bash
cd fast-intel-sandbox-v9 && wrangler secret list
# Must have: FIRECRAWL_KEY, SCRAPINGANT_KEY, GEMINI_KEY
# Must add: GOOGLE_PLACES_API_KEY (for P2-T1)

cd ../deepgram-bridge-v9 && wrangler secret list
# Must have: GEMINI_KEY

cd ../bella-scrape-workflow-v9 && wrangler secret list
# Must have: FIRECRAWL_KEY, APIFY_TOKEN
# May need: SERP_API_KEY (for P2-T3, depends on where SERP integration lives)

cd ../voice-agent-source-sandbox-v9 && wrangler secret list
# Must have: DEEPGRAM_API_KEY
```

---

## REFERENCE FILES

| File | What's In It |
|------|-------------|
| `HANDOVER_SESSION_19MAR.md` | Session state, what's broken, what works |
| `CLAUDE.md` | Architecture, KV schema, worker inventory |
| `BEST  BELLA EXCHANGE YET PLUS AUDIT.md` | Full call transcript with 8 issues identified |
| `DATA_ENRICHMENT_MASTER_PLAN.md` | Full enrichment architecture vision |
| `fast-intel-sandbox-v9/src/index.ts` | Fast-intel worker (1,292 lines) |
| `deepgram-bridge-v9/src/index.ts` | Bridge worker (2,696 lines) |
| `bella-scrape-workflow-v9/src/index.ts` | Workflow orchestrator (144 lines) |
| `bella-scrape-workflow-v9/src/steps/` | Individual workflow steps |
| `consultant-v9/worker.js` | Consultant worker (fast + full) |
| `shared/kv-schema.ts` | KV schema types |
