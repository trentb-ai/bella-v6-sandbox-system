# BELLA V9 — SESSION HANDOVER 19 MARCH 2026
## Status: PARTIALLY BROKEN — WORKFLOW RESTRUCTURE REQUIRED

## DEPLOYED CHANGES THIS SESSION
| Worker | Version | Changes |
|--------|---------|---------|
| `deepgram-bridge-sandbox-v8` | v9.3.2 | Dedup passthrough (no early return), temp 0.95→0.7 |
| `bella-voice-agent-sandbox-v8` | v4.0.2-SUPERGOD | New greeting, name fallback fix, urlHints log |
| `fast-intel-v8` | v1.7.0 | Parallel Firecrawl+direct, parallel consultants, starter KV |
| `consultant-v8` + `v9` | +/fast | `/fast` endpoint (6-field 3-5s), improved full prompt |

## WHAT WORKS
- Dedup passthrough — Bella no longer goes silent mid-call
- Fast consultant `/fast` returns in ~2.7s
- Parallel scrape eliminates 31s waterfall
- Name fallback chain reaches greeting correctly

## WHAT'S STILL BROKEN
1. Business name wrong — each worker resolves independently
2. Gemini ignores SAY EXACTLY THIS — paraphrases scripts
3. Full consultant 35s — data misses stalls 1-2
4. Starter KV too thin (1.5KB) for rich conversation
5. reqUrl=null in voice agent DO — url hints not reaching connection.request
6. NEVER APOLOGISE rule ignored by Gemini
7. Secrets possibly missing after deploys — not verified

## WHY THIS SESSION FAILED
- Debugging by live voice call — 5-10 min per test cycle
- Stacked untested changes — deployed 3 fixes before verifying any
- No local dev/test — every change goes straight to production
- Wrong LIDs checked, missed obvious issues, lost context in long session
- No structured task tracking — jumping between issues

## ROOT CAUSES IDENTIFIED
1. Dedup early return (v9.2.2 regression) killed conversations — FIXED
2. Fast consultant used full prompt schema — took 28s not 3-5s — FIXED with /fast
3. Sequential scrape fallback wasted 31s — FIXED with parallel
4. No single authority for business name — NOT FIXED
5. No automated testing — NOT FIXED

## PRIORITY 1: UNIFIED ENRICHMENT WORKFLOW

### The Core Problem
fast-intel and bella-scrape-workflow are TWO separate systems doing overlapping work. Firecrawl runs twice. Workers fire-and-forget with race conditions. No guaranteed ordering. Data arrives at unpredictable times.

### Current: Two Systems
fast-intel worker: Firecrawl → fallbacks → fast consultant → full consultant → KV write → fire Apify → fire big scraper
bella-scrape-workflow: Firecrawl (AGAIN) → truncate → fire Apify → poll → extract → write deep_flags → build intel → write intel

### Target: One Unified Workflow
```
POST /enrich {lid, websiteUrl, firstName}
  step.do("write_stub")
  step.do("scrape_page")       → Firecrawl + direct fetch PARALLEL, ONE scrape
  step.do("fast_consultant")   → /fast endpoint, 3-5s, NAME AUTHORITY
  step.do("google_places")     → cross-ref name, get rating early, ~500ms
  step.do("write_starter_kv")  → bridge has data for stalls 1-4
  step.do("fire_apify_wave1")  → uses confirmed name
  step.do("full_consultant")   → complete analysis, runs while Apify polls
  step.do("write_full_kv")     → complete scriptFills, routing, scorecard
  step.do("poll_apify_wave1")  → durable, auto-retry
  step.do("fire_apify_wave2")
  step.do("poll_apify_wave2")  → durable, auto-retry
  step.do("extract_deep")      → hiring classification, reviews, ads
  step.do("write_deep_flags")
  step.do("build_final_intel")
  step.do("write_final_intel")
```

### What This Fixes
- Duplicate Firecrawl → one scrape
- 31s fallback waterfall → parallel in one durable step
- Business name chaos → fast_consultant is single authority
- Starter data late → write_starter_kv fires immediately after fast_consultant
- Full consultant blocks pipeline → separate step, doesn't block starter
- Race conditions → durable sequential steps, guaranteed order
- Data loss on worker eviction → every step auto-retries
- No timing visibility → workflow status API + per-step timing
- Google Places not checked → new parallel step

### What STAYS as Separate Workers
- Voice Agent DO — real-time WebSocket
- Bridge Worker — real-time HTTP per turn
- Consultant Worker — called BY workflow via service binding
- Tools Worker — real-time Deepgram function calls
- MCP Worker — external API endpoint

### What Gets REMOVED
- `fast-intel-v8` → replaced by workflow steps
- `bella-scrape-workflow-v9-test` → absorbed into unified workflow
- `personalisedaidemofinal-sandbox` → replaced by workflow steps

## PRIORITY 2: AUTOMATED TEST PIPELINE

Build BEFORE any more code changes. Lives in `/tests/`.

A. `test-bridge.sh` — trigger fast-intel, poll KV, simulate bridge turn, check SSE response. 30 seconds not 10 minutes.

B. `test-stall-progression.sh` — 7+ simulated turns, verify stall/stage/extraction/ROI.

C. `test-consultant.sh` — hit /fast and full, verify name is real, icp is specific, insight isn't generic garbage.

Claude Code can run these autonomously. No live voice calls for 90% of debugging.

## PRIORITY 3: BRIDGE MODULARISATION

2,463 lines in one file. Split into:
- index.ts — HTTP handler, routing, main loop (~200 lines)
- state.ts — load/save state, loadMergedIntel, loadCallBrief
- queue.ts — buildQueue, rebuildFutureQueue, gateOpen, advance
- extraction.ts — regexExtract, extractAndApply, parseNumber
- prompt.ts — buildSystemContext, buildTurnPrompt, buildStageDirective
- streaming.ts — streamToDeepgram, Gemini SSE handling
- calcs.ts — runCalcs, isCalcReady, ROI calculations
- memory.ts — extractQualitativeSignals, trimHistory
- types.ts — State, Inputs, Stage, Env interfaces

## WORKFLOW & TOOLING RECOMMENDATIONS

### Claude Code as Primary Builder
Claude.ai (this) for strategy, architecture, prompt design, log analysis, research.
Claude Code for ALL code, deploys, tests, KV inspection, systematic debugging.
Reason: Claude Code has native filesystem, can run wrangler dev locally, execute tests, follow skills properly.

### Cowork for Parallel Agents
Investigate immediately. Two Claude Code agents: one on workflow restructure, one on test pipeline. Or one coding, one monitoring tails and flagging issues. Key constraint: they need to work on different files.

### Obsidian for Knowledge Retention
Worth it but not urgent. The .claude/skills/ directory already serves this purpose if consistently read. Obsidian adds cross-linking for architectural decisions, KV schema, debugging patterns. Consider after core restructure.

### Perplexity Research — Run These Queries
1. "Deepgram Voice Agent API BYO LLM duplicate request handling"
2. "Gemini 2.5 Flash instruction following SAY EXACTLY THIS prompt engineering"
3. "Cloudflare Agents SDK WebSocket connection.request URL parameters"
4. "Cloudflare Workflows best practices durable steps parallel execution"

### Google Places API
Add GOOGLE_PLACES_API_KEY secret to fast-intel (and unified workflow when built). Use text search to cross-reference business name from fast consultant. ~500ms call. Also gets rating + review count early.

### New Skills to Create
1. `test-bella/SKILL.md` — automated test procedures, what PASS means
2. `deploy-verify/SKILL.md` — deploy checklist: bump version, dry-run, deploy, check secrets, run test
3. `session-startup/SKILL.md` — what to read before any work starts

## DOCS TO READ BEFORE NEXT SESSION

### Debugging & Development Skills (in .claude/skills/)
1. `systematic-debugging/SKILL.md` — Iron Law: root cause before fixes, 4 phases
2. `systematic-debugging/root-cause-tracing.md` — trace backward to original trigger
3. `systematic-debugging/defense-in-depth.md` — validate at every layer
4. `systematic-debugging/condition-based-waiting.md` — replace arbitrary timeouts
5. `debug-bridge/SKILL.md` — Bella-specific: log tags, KV schema, common failures, tail commands

### Cloudflare Skills (in .claude/skills/)
6. `cloudflare/SKILL.md` — Agents SDK, state management, routing
7. `cloudflare/troubleshooting.md` — WebSocket failures, state issues, deployment
8. `cloudflare/state-patterns.md` — state vs SQL, hybrid patterns, queues
9. `cloudflare/agents-sdk/SKILL.md` — SDK API, callable, scheduling, workflows

### Voice AI Skills
10. `voice-ai-deepgram/SKILL.md` — STT/TTS, latency optimization
11. `voice-ai-deepgram/voice-agents.md` — architecture, turn detection

### Project Context
12. `THE_PLAN.md` — master roadmap
13. `DATA_ENRICHMENT_MASTER_PLAN.md` — full enrichment architecture
14. `PRODUCT_BIBLE.md` — agent definitions, data→pitch mappings
15. `CLAUDE.md` — architecture, KV schema, worker inventory (some names stale)
16. `HANDOVER_V9.md` — system architecture deep dive
17. This file: `HANDOVER_SESSION_19MAR.md`

## REFERENCE: DEPLOYED VERSIONS
| Worker | Name | Version |
|--------|------|---------|
| Bridge | `deepgram-bridge-sandbox-v8` | v9.3.2 |
| Voice | `bella-voice-agent-sandbox-v8` | v4.0.2-SUPERGOD |
| Fast Intel | `fast-intel-v8` | v1.7.0 |
| Consultant | `consultant-v8` + `consultant-v9` | +/fast |
| Workflow | `bella-scrape-workflow-v9-test` | unchanged |

## REFERENCE: KV & ACCOUNT
- KV namespace: `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`
- Cloudflare account: `9488d0601315a70cac36f9bd87aa4e82`
- ALL KV operations MUST use `--remote` flag

## EXECUTION ORDER
1. Build automated test scripts (2h)
2. Verify all secrets across all workers (15min)
3. Run Perplexity research queries (30min)
4. Build unified enrichment workflow (4-6h)
5. Modularise bridge (4h)
6. Set up Cowork parallel agents (1h)
7. Live test ONLY after automated tests pass
