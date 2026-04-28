# BELLA MVPScriptBella DIAGNOSTIC SPRINT — COMPREHENSIVE HANDOVER
## Filed: 2026-04-20 AEST | Author: T9 Architect (Opus)
## Stack: MVPScriptBella | Reference: NaturalBellaFROZEN (READ ONLY)
## D1 ID: doc-t9-bella-diagnostic-sprint-20260420
## UPDATED: 2026-04-20 with full investigation findings

---

## EXECUTIVE SUMMARY

Trent flagged Bella as broken: scraping not working, consultant not delivering, team kept re-adding removed features or treating intentional removals as bugs. T9 conducted full evidence-based diagnostic across all 7 workers, all wrangler.toml files, all service bindings, the frontend, and compared against the known-good NaturalBellaFROZEN stack.

**Bottom line:** The code is fine (361/361 tests passing). The failures are infrastructure wiring — mixed-case worker names causing silent service binding failures. Same root cause as the original V2-rescript CF error 1042 debug. Wrangler.toml normalization is now in progress.

---

## STACK STATE

### MVPScriptBella (ACTIVE — being fixed)
- **Repo:** ~/Desktop/MVPScriptBella/
- **brain:** v6.16.6 — workers/brain/ — deployed as mvpscriptbellabrain
- **bridge:** v9.40.0 — workers/bridge/ — deployed as mvpscriptbellabridge (NOW LOWERCASE)
- **fast-intel:** v1.18.0 — workers/fast-intel/ — deployed as mvpscriptbellafast-intel (NOW LOWERCASE)
- **consultant:** v6.12.0-pass2 — workers/consultant/ — deployed as mvpscriptbellaconsultant (NOW LOWERCASE)
- **deep-scrape:** v1.7.1 — workers/deep-scrape/ — deployed as mvpscriptbellascrape
- **tools:** workers/tools/ — deployed as mvpscriptbellatools (NEEDS LOWERCASE CHECK)
- **voice-agent:** workers/voice-agent/ — deployed as mvpscriptbellavoice (NEEDS LOWERCASE CHECK)
- **KV namespace:** leads-kv ID 0fec6982d8644118aba1830afd4a58cb
- **Tests:** brain vitest 361/361 passing, 9 skipped, 0 fail

### NaturalBellaFROZEN (REFERENCE ONLY — DO NOT TOUCH)
- **Tag:** bella-natural-v1 (commit 8e23c66)
- **Source:** ~/Desktop/BELLA_GOLDEN_V1 copy/
- **Frozen workers:** frozen-bella-natural-* (7 workers, all lowercase, all consistent)
- **Frontend:** bellanaturalv1desktop11111111.netlify.app
- **Canary result:** 10/10 stages, compliance 1.00, TTFB 490-702ms (fastest ever)
- **Full registry:** BRAIN_DOCS/bella-natural-v1-frozen.md
- **WHY IT WORKS:** All worker names consistent lowercase. All service bindings match deployed names exactly.

---

## FAILURE 1 (P0): SERVICE BINDING NAME CHAOS — ROOT CAUSE OF ALL FAILURES

### What T9 found
Worker names in wrangler.toml were a mix of cases. Some workers deployed lowercase (brain, scrape), others mixed case (bridge, consultant, fast-intel, tools, voice). Service binding targets referenced names that may not match the actual deployed worker name in CF's registry.

### Evidence gathered (exact grep output)

**Worker names (before fix):**
| Worker | wrangler.toml name= | Case |
|---|---|---|
| brain | mvpscriptbellabrain | lowercase OK |
| bridge | MVPSCRIPTBELLAbridge | MIXED — NOW FIXED to lowercase |
| consultant | MVPSCRIPTBELLAconsultant | MIXED — NOW FIXED to lowercase |
| deep-scrape | mvpscriptbellascrape | lowercase OK |
| fast-intel | MVPSCRIPTBELLAfast-intel | MIXED — NOW FIXED to lowercase |
| tools | MVPSCRIPTBELLAtools | MIXED — STILL NEEDS FIX |
| voice-agent | MVPSCRIPTBELLAvoice | MIXED — STILL NEEDS FIX |

**Service binding cross-references (before fix):**
| Source worker | Binding | Target (was) | Target (should be) |
|---|---|---|---|
| bridge | TOOLS | MVPSCRIPTBELLAtools | mvpscriptbellatools — NOW FIXED |
| bridge | CALL_BRAIN | MVPSCRIPTBELLAbrain | mvpscriptbellabrain — NOW FIXED |
| deep-scrape | CONSULTANT | mvpscriptbellaconsultant | mvpscriptbellaconsultant OK |
| fast-intel | CONSULTANT | MVPSCRIPTBELLAconsultant | mvpscriptbellaconsultant — NOW FIXED |
| fast-intel | DEEP_SCRAPE | MVPSCRIPTBELLAscrape | mvpscriptbellascrape — NOW FIXED |
| fast-intel | BIG_SCRAPER | personalisedaidemofinal-sandbox | personalisedaidemofinal-sandbox (KEEP — see below) |
| fast-intel | CALL_BRAIN | MVPSCRIPTBELLAbrain | mvpscriptbellabrain — NOW FIXED |
| tools | CONSULTANT | MVPSCRIPTBELLAconsultant | mvpscriptbellaconsultant — NEEDS FIX |
| voice-agent | TOOLS | MVPSCRIPTBELLAtools | mvpscriptbellatools — NEEDS FIX |

### Why this breaks everything
Cloudflare service bindings must match the EXACT deployed worker name. If consultant was deployed as lowercase (T4 lowercased brain+scrape in the 2026-04-14 session) but fast-intel's binding says MVPSCRIPTBELLAconsultant, the binding silently fails with CF error 1042.

The code SILENTLY SWALLOWS these failures:
- fast-intel/src/index.ts line 384: `if (!resp.ok) { log("CONSULTANT_FAST", ...); return null; }`
- fast-intel/src/index.ts line 390: `catch (err) { log("CONSULTANT_FAST", ...); return null; }`
- fast-intel/src/index.ts line 419: `if (!resp.ok) { log("CONSULTANT", ...); return null; }`
- fast-intel/src/index.ts line 428: `catch (err) { log("CONSULTANT", ...); return null; }`

No crash. No error page. Bella just speaks without consultant data — no scriptFills, no routing, no conversationHooks, no bella_opener. She sounds generic and broken.

### Why NaturalBella works but MVPScriptBella doesn't
Identical consultant code (same worker.js, same v6.12.0-pass2). The ONLY difference is NaturalBella has ALL worker names as consistent lowercase (frozen-bella-natural-*). MVPScriptBella has mixed case chaos.

### Fix
Normalize ALL wrangler.toml name= and service= to lowercase. Redeploy all 7 in dependency order:
1. consultant (no deps)
2. brain (no deps)
3. tools (deps: consultant)
4. scrape (deps: consultant)
5. fast-intel (deps: consultant, scrape, brain)
6. bridge (deps: brain, tools)
7. voice (deps: tools)

### Current status of fix
Bridge, consultant, fast-intel wrangler.toml files have been normalized to lowercase. Tools and voice-agent still need checking.

---

## FAILURE 2 (P1): PERSONALISEDAIDEMOFINAL — KEEP IT, DO NOT REMOVE

### CRITICAL: Trent confirmed personalisedaidemofinal IS NEEDED

Despite the law saying never touch/edit/deploy it, Trent confirmed it MUST still be CALLED. It serves two critical functions:

1. **Landing page data population** — frontend calls it directly on form submit
2. **Fallback data source** — Bella system uses its data as fallback

### How it is wired (exact code locations)

**Frontend (public URL calls — NOT service bindings):**
- ~/Desktop/MVPScriptBella/netlify-frontend/loading-v15.html: `WORKER_URL = 'https://personalisedaidemofinal-sandbox.trentbelasco.workers.dev'`
- ~/Desktop/MVPScriptBella/netlify-frontend/demo_v15_hybrid.html: proxy URL + scraper URL both point to personalisedaidemofinal-sandbox
- ~/Desktop/MVPScriptBella/netlify-frontend/capture.html: `WORKER_URL = 'https://personalisedaidemofinal-sandbox.trentbelasco.workers.dev'`

**fast-intel (service binding):**
- workers/fast-intel/wrangler.toml: `binding = "BIG_SCRAPER"`, `service = "personalisedaidemofinal-sandbox"`
- workers/fast-intel/src/types.ts line 7: `BIG_SCRAPER: Fetcher;`
- workers/fast-intel/src/index.ts lines 1644-1661: ctx.waitUntil fires BIG_SCRAPER.fetch() to /log-lead endpoint
  - Sends: lid, websiteUrl, firstName, businessName
  - Purpose: "rich Phase B enrichment (Google reviews, AI extraction, marketing intel)"
  - Fire-and-forget via ctx.waitUntil — does not block fast-intel response
  - Errors caught and logged as BIG_SCRAPER_ERR, execution continues

### DECISION: KEEP the BIG_SCRAPER binding
- personalisedaidemofinal-sandbox is the ONLY remaining path for deep enrichment data (Google reviews, marketing intel) now that deep-scrape has been removed
- The law says never TOUCH/EDIT/DEPLOY it — CALLING it via existing binding is fine
- If personalisedaidemofinal-sandbox goes down, fast-intel continues without it (fire-and-forget pattern)

### Open question for Trent (not blocking)
- Is personalisedaidemofinal-sandbox the correct version? Could be pointing to a stale/broken deployment.
- Worth a health check: `curl https://personalisedaidemofinal-sandbox.trentbelasco.workers.dev/health`

---

## FAILURE 3 (P1): DEEP SCRAPE REMOVAL NOT CLEAN

### Context from Trent
Deep scrape was removed from the system because it never worked. Only Google reviews functionality is being used. The team kept seeing the removal as a bug and putting old pieces back in.

### What is still in the codebase
- workers/deep-scrape/ — full source code still present
- mvpscriptbellascrape — still deployed on Cloudflare
- fast-intel/wrangler.toml: DEEP_SCRAPE service binding still present (service = mvpscriptbellascrape)
- fast-intel/src/index.ts line 352: fireApifyEarly() calls env.DEEP_SCRAPE.fetch() to /trigger endpoint
- fast-intel/src/index.ts lines 348-367: full fireApifyEarly function fires on every form submit

### Impact
Every form submit, fast-intel fires fireApifyEarly() which calls deep-scrape. If deep-scrape is broken, this silently errors (caught at line 361, logged as APIFY_EARLY_ERR). Not fatal but adds latency and log noise.

### Decision needed from Trent
- **If deep-scrape is truly dead:** Remove DEEP_SCRAPE binding from fast-intel wrangler.toml. Guard fireApifyEarly() with `if (!env.DEEP_SCRAPE) return;`. Do not delete the folder (historical reference).
- **If only Google reviews path is needed:** Figure out which Apify actor handles Google reviews and whether it is called via deep-scrape or via BIG_SCRAPER (personalisedaidemofinal-sandbox). If via BIG_SCRAPER, deep-scrape is fully redundant.

### Google reviews data flow
Based on code investigation:
- deep-scrape (workers/deep-scrape/src/lib/apify-actors.ts) fires 5 Apify actors including Google Maps
- Fix 4 from 2026-04-14 session fixed the Apify geo default (US->AU) in this worker
- personalisedaidemofinal-sandbox ALSO does Google reviews via its own pipeline (110-point deep scraper)
- So Google reviews has TWO paths. If deep-scrape is removed, personalisedaidemofinal-sandbox still provides them.

---

## FULL WIRING MAP (what calls what)

```
FRONTEND (Netlify)
  capture.html
    -> POST personalisedaidemofinal-sandbox.workers.dev (public URL, landing page data)
    -> POST mvpscriptbellafast-intel.workers.dev/fast-intel (fast intel)
    -> POST mvpscriptbellascrape.workers.dev/fire-apify (deep scrape)
    -> POST mvpscriptbellascrape.workers.dev/trigger (deep scrape)
  loading-v15.html
    -> GET mvpscriptbellafast-intel.workers.dev/status?lid=xxx (polling)
    -> personalisedaidemofinal-sandbox.workers.dev (WORKER_URL)
  demo_v15_hybrid.html
    -> personalisedaidemofinal-sandbox.workers.dev (proxy URL, scraper URL)
  bella-voice-client.js
    -> wss://mvpscriptbellavoice.workers.dev/agents/bella-agent/{lid} (WebSocket)

FAST-INTEL (mvpscriptbellafast-intel)
  -> env.CONSULTANT.fetch(/fast) -> mvpscriptbellaconsultant (fast consultant, 3-5s)
  -> env.CONSULTANT.fetch(/) -> mvpscriptbellaconsultant (full consultant, 4-8s)
  -> env.DEEP_SCRAPE.fetch(/trigger) -> mvpscriptbellascrape (Apify actors, 30-45s)
  -> env.BIG_SCRAPER.fetch(/log-lead) -> personalisedaidemofinal-sandbox (110-pt pipeline, 60-120s)
  -> env.CALL_BRAIN -> mvpscriptbellabrain (brain DO)
  -> Writes to KV: lead:{lid}:fast-intel

BRIDGE (mvpscriptbellabridge)
  -> env.CALL_BRAIN -> mvpscriptbellabrain (brain DO, turn processing)
  -> env.TOOLS -> mvpscriptbellatools (tool handler)
  -> Reads from KV: lead:{lid}:fast-intel
  -> Streams Gemini 2.5 Flash -> SSE -> Deepgram TTS

VOICE (mvpscriptbellavoice)
  -> env.TOOLS -> mvpscriptbellatools
  -> Deepgram STT (WebSocket)
  -> HTTP POST to bridge

DEEP-SCRAPE (mvpscriptbellascrape)
  -> env.CONSULTANT -> mvpscriptbellaconsultant
  -> Apify actors (Google Maps, reviews, etc.)
  -> Writes to KV: lead:{lid}:fast-intel (additive merge)

CONSULTANT (mvpscriptbellaconsultant)
  -> Gemini 2.5 Flash (analysis)
  -> Returns: scriptFills, routing, conversationHooks, businessIdentity, bella_opener

TOOLS (mvpscriptbellatools)
  -> env.CONSULTANT -> mvpscriptbellaconsultant
  -> KV reads/writes
```

---

## PRIOR SESSION STATE (from 2026-04-14 handover)

### Deployed in that session
- brain v6.16.3 (Fix 1: WOW3 neutral ICP — flow.ts lines 729-740)
- deep-scrape v1.7.1 (Fix 4: Apify geo default US->AU — apify-actors.ts lines 65-80)

### Since then
- brain bumped to v6.16.6 (TICKET-001: vitest realignment, 361 pass)

### Pending from prior session (NOT YET DONE)
- Fix 2+3 (moves.ts WOW2 no-data branch -> trial offer) — was in T3a gate at session end, spec v5
  - 5 file changes required (moves.ts, moves.test.ts, flow-process.test.ts, golden.test.ts, flow-integration.test.ts)
  - Had 6 gate attempts (v1 FAIL through v5)
  - Root issue: WOW2 auto-advance bug + recDeepInsight scope error + stale .js files
- Pre-existing test failures: T09 (golden.test.ts wow_5 trialMentioned), gate.test.ts x2, budget_exhausted x2
- A/B latency test (Gemini thinking modes — reasoning_effort none vs enabled)
- First live test call (blocked on Fix 2+3)

### Critical pre-flight for next session
- DELETE stale .js files in brain/src/ BEFORE any implementation
- Run: `find workers/brain/src -name '*.js' -not -path '*/node_modules/*' -delete`

---

## CONSULTANT DEEP DIVE

### What it does
Consultant receives scraped data, returns script-ready analysis for Bella. Two endpoints:
- `/fast` — stripped-down 3-5s analysis for conversation starters (fast consultant)
- `/pass2` — deep data enrichment after scrape completes
- `/` (root POST) — full consultant analysis, 4-8s

### What it returns
- `correctedName` — proper business name (e.g., "Pitcher Partners" not just domain)
- `scriptFills` — pre-built spoken lines for each WOW stage
- `routing` — which demo agents to recommend (Alex/Chris/Maddie)
- `conversationHooks` — personalized talking points
- `businessIdentity` — industry, location, size signals
- `bella_opener` — the opening line Bella says

### File location
- ~/Desktop/MVPScriptBella/workers/consultant/worker.js (956 lines, plain JS, no TypeScript)
- Identical to ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/frozen-bella-rescript-v2-consultant/worker.js

### How fast-intel calls it
- callFastConsultant() at fast-intel/src/index.ts lines 370-391
- callConsultant() at fast-intel/src/index.ts lines 398-429
- Both use env.CONSULTANT service binding
- Both return null on ANY error (HTTP error, exception, missing binding)
- Error is logged but execution continues — Bella gets no consultant data

---

## RECOMMENDED EXECUTION ORDER

### Sprint 1 (30 min) — Wiring fix (IN PROGRESS)
1. Normalize ALL wrangler.toml names to lowercase — bridge, consultant, fast-intel DONE; tools, voice-agent CHECK STATUS
2. Normalize ALL service= binding targets to lowercase — tools CONSULTANT binding STILL NEEDS FIX
3. Redeploy all 7 workers in dependency order (see order above)
4. T5 health check each worker: `curl https://{name}.trentbelasco.workers.dev/health`
5. This alone likely fixes both consultant not delivering AND scraping issues

### Sprint 2 (20 min) — Dead binding cleanup
1. Trent decides deep-scrape status (remove DEEP_SCRAPE binding or keep for Google reviews)
2. If removing: delete binding from fast-intel wrangler.toml, add guard to fireApifyEarly()
3. Redeploy fast-intel only

### Sprint 3 — Canary test
1. Fresh LID
2. Submit via capture.html or loading page
3. Wait 30s for fast-intel + consultant
4. Check KV: `npx wrangler kv key get "lead:{LID}:fast-intel" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote`
5. Verify consultant data present: look for scriptFills, routing, bella_opener fields
6. Voice call: open demo page, talk to Bella
7. Monitor: `wrangler tail mvpscriptbellabridge --format=json` — watch for [CONSULTANT_FAST], [BELLA_SAID], [KV_STATUS]
8. Compare BELLA_SAID output against NaturalBella reference call

### Sprint 4 — Fix 2+3 from prior session (if needed)
1. Delete stale .js files first
2. Implement Fix 2+3 spec v5 (WOW2 no-data branch)
3. Full gate chain: T2 spec -> T3A gate -> T4 implement -> T2 6-gate -> T3A Codex gate -> deploy

---

## KEY FILES REFERENCE

| File | Location | What to look at |
|---|---|---|
| fast-intel wrangler.toml | ~/Desktop/MVPScriptBella/workers/fast-intel/wrangler.toml | Service bindings: CONSULTANT, DEEP_SCRAPE, BIG_SCRAPER, CALL_BRAIN |
| fast-intel index.ts | ~/Desktop/MVPScriptBella/workers/fast-intel/src/index.ts | callFastConsultant() L370-391, callConsultant() L398-429, fireApifyEarly() L348-367, BIG_SCRAPER L1644-1661, /status endpoint L1677 |
| fast-intel types.ts | ~/Desktop/MVPScriptBella/workers/fast-intel/src/types.ts | Env interface with all binding types (L7: BIG_SCRAPER) |
| consultant worker.js | ~/Desktop/MVPScriptBella/workers/consultant/worker.js | /fast endpoint, /pass2 endpoint, root POST. 956 lines. |
| bridge wrangler.toml | ~/Desktop/MVPScriptBella/workers/bridge/wrangler.toml | TOOLS + CALL_BRAIN bindings |
| bridge index.ts | ~/Desktop/MVPScriptBella/workers/bridge/src/index.ts | VERSION at top, KV reads, Gemini streaming |
| brain index.ts | ~/Desktop/MVPScriptBella/workers/brain/src/index.ts | VERSION v6.16.6, brain DO |
| voice-agent wrangler.toml | ~/Desktop/MVPScriptBella/workers/voice-agent/wrangler.toml | TOOLS binding, Durable Object config |
| tools wrangler.toml | ~/Desktop/MVPScriptBella/workers/tools/wrangler.toml | CONSULTANT binding |
| NaturalBella frozen registry | BRAIN_DOCS/bella-natural-v1-frozen.md | Complete reference: all workers, bindings, secrets, restore runbook |
| Frontend loading | ~/Desktop/MVPScriptBella/netlify-frontend/loading-v15.html | FAST_INTEL_URL, WORKER_URL (personalisedaidemofinal) |
| Frontend demo | ~/Desktop/MVPScriptBella/netlify-frontend/demo_v15_hybrid.html | proxy URLs, scraper URLs |
| Frontend capture | ~/Desktop/MVPScriptBella/netlify-frontend/capture.html | Form submit -> fast-intel + personalisedaidemofinal |
| Voice client | ~/Desktop/MVPScriptBella/netlify-frontend/bella-voice-client.js | AGENT_BASE = wss://mvpscriptbellavoice.workers.dev |

---

## ARCHITECTURAL NOTE

This is the SAME failure pattern as the original V2-rescript debug (P1 fix documented in CLAUDE.md): CF error 1042 from Worker-to-Worker fetch via mismatched names. Service bindings must match exact deployed worker names. This was fixed once in V2-rescript (consistent naming) and again in NaturalBella (frozen-bella-natural-* prefix). The fix was not carried forward cleanly to MVPScriptBella because the team copied workers with mixed-case names and only partially normalized them.

**The consultant code is not broken. The scraping code is not broken. The WIRING is broken.** Fix the wiring first, then assess what is actually a code problem vs what was masked by silent binding failures.

---

## STATUS
- Wiring normalization IN PROGRESS (bridge, consultant, fast-intel done; tools, voice-agent pending)
- personalisedaidemofinal-sandbox: KEEP — confirmed needed by Trent
- deep-scrape: decision pending from Trent (remove or keep for Google reviews)
- Sprint 1 deploy in progress (T2 coordinating, T4 deploying)
- Bella diagnostic sprint ready to execute on Trent's go signal
