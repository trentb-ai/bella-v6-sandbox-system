# BELLA V9 — COMPREHENSIVE HANDOVER
## Date: 19 March 2026 | For: Claude Code (CC)
## Status: TESTING PHASE — Multiple issues found during live voice test

---

## READ THESE DOCS FIRST (in this order)

| # | File | What it is | Why you need it |
|---|------|-----------|----------------|
| 1 | `THE_PLAN.md` | Master roadmap — chunk status, what's done, what's pending, session history | Overall context and priority order |
| 2 | `DATA_ENRICHMENT_MASTER_PLAN.md` | **THE BIG DOC (1,500+ lines)** — every data source, script segments, wave scheduler, quota mgmt, progressive enrichment, hiring wedges | Full enrichment architecture |
| 3 | `.claude/skills/PRODUCT_BIBLE.md` | Agent definitions, data→agent pitch mappings, hiring→agent replacement wedges | What Bella sells and how data maps to pitches |
| 4 | `.claude/skills/debug-bridge/SKILL.md` | Debug skill — tail commands, KV inspection, common failure patterns, log tags | How to diagnose every bridge issue |
| 5 | `.claude/skills/voice-ai-deepgram/SKILL.md` | Deepgram Voice Agent API, STT/TTS, UpdatePrompt, Flux config | Voice layer architecture |
| 6 | `.claude/skills/voice-ai-deepgram/voice-agents.md` | Deepgram agent patterns, WebSocket lifecycle | Voice agent specifics |
| 7 | `.claude/skills/orchestrator/SKILL.md` | Orchestrator/workflow patterns | Scrape workflow architecture |
| 8 | `.claude/skills/systematic-debugging/SKILL.md` | Root cause tracing methodology | How to debug systematically |
| 9 | `.claude/skills/systematic-debugging/root-cause-tracing.md` | Specific root cause techniques | Trace before fix |
| 10 | `.claude/skills/systematic-debugging/defense-in-depth.md` | Defense in depth patterns | Prevent regressions |
| 11 | `.claude/skills/cloudflare/SKILL.md` | Workers, KV, Durable Objects patterns | CF-specific gotchas |
| 12 | `.claude/skills/cloudflare/troubleshooting.md` | CF error codes, deployment issues | Error 1042, 1101, etc |
| 13 | `.claude/skills/cloudflare/state-patterns.md` | DO + KV state management | State persistence patterns |
| 14 | `.claude/skills/planning-with-files/SKILL.md` | File-based planning workflow | How to track work |
| 15 | `.claude/skills/subagent-driven-development/SKILL.md` | Subagent delegation patterns | Task decomposition |
| 16 | `CLAUDE.md` | CC master brief — architecture, KV schema, worker inventory, deploy commands | **NOTE: some worker names are stale — see ACTUAL WORKERS below** |
| 17 | `HANDOVER_V9.md` | System architecture deep dive | Supplementary reference |
| 18 | `PERPLEXITY_SPEC.md` | Stage plan architectural blueprint | Design decisions |

---

## ACTUAL DEPLOYED WORKERS (verified from wrangler.toml — trust THESE names, not CLAUDE.md)

| Local Folder | Deployed Worker Name | Role |
|-------------|---------------------|------|
| `deepgram-bridge-v9/` | `deepgram-bridge-sandbox-v8` | **BRAIN** — v9.2.2 deployed. Reads KV, builds prompt, calls Gemini, streams SSE |
| `voice-agent-v9/` | `bella-voice-agent-sandbox-v8` | WebSocket DO — Deepgram connection, greeting, STT/TTS |
| `fast-intel-sandbox-v9/` | `fast-intel-v8` | Phase A scraper — Firecrawl + Gemini consultant |
| `bella-scrape-workflow-v9/` | `bella-scrape-workflow-v9-test` | Apify pipeline — smart wave scheduler, deep scraping |
| `consultant-v9/` | `consultant-v9` | Gemini consultant — urgency hierarchy, agentScorecard |
| `deep-scrape-workflow-sandbox-v9/` | `deep-scrape-workflow-v9` | Deep scrape workflow (old) |
| `workers-sandbox-v9/` | `personalisedaidemofinal-v9` | 110-pt deep scraper |
| `bella-tools-worker-v9/` | `bella-tools-worker-v9` | Tool handler |
| `mcp-worker-v9/` | `leads-mcp-worker-v9` | MCP server |
| `voice-agent-source-sandbox-v9/` | `bella-voice-agent-sandbox-v9` | Voice agent (alternate deploy target) |

**KV namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`
**Cloudflare account:** `9488d0601315a70cac36f9bd87aa4e82`
**ALL KV operations MUST use `--remote` flag or they silently read/write local storage.**

---

## WHAT'S BEEN BUILT AND IS WORKING

1. **Chunk 1 complete** — Steps 1-6, bridge v9.0.0 → v9.2.2, StagePlanV2, buildQueueV2, scoring fix, consultant upgrade, writeStagePlan, dead code removal
2. **Smart Wave Scheduler deployed** — dynamic wave packing under Apify 8GB Free plan cap. Nike test: 5/5 actors succeeded, 76s across 2 waves
3. **Phase 1 Enrichment deployed** — rich data passthrough, Google Ads Transparency actor, Seek AU scraper, Indeed global, google_ads renamed to google_search
4. **Bridge v9.2.2 has 3 prompt fixes** — directive FIRST (intel LAST as REFERENCE DATA), DEDUP hard gate (204 return), NEVER APOLOGISE rule in persona
5. **Consultant upgraded** — Gemini 2.5 Flash, urgency hierarchy, agentScorecard
6. **Product Bible + Master Plan + Hiring Wedges** all documented
7. **14-turn simulation passed** — all stages, all extractions, all ROI calcs working in text

---

## WHAT'S BROKEN — LIVE VOICE TEST FAILED

Bella breaks after the Deepgram intro. Multiple issues found:

### KNOWN ISSUES (from last night's test — LID anon_ojqsmntt, Pitcher Partners)

1. **Stall 1 directive ignored** — Gemini skipped the free trial pitch SAY EXACTLY THIS and improvised a discovery question instead. Prompt structure was fixed in v9.2.0→v9.2.2 (directive first) but NOT YET RETESTED LIVE.

2. **Apify scraping issues** — Facebook ads timed out (60s race). Wave scheduling is working but actor reliability varies. Need monitoring.

3. **Stage progression stuck** — Never got past WOW stall 4 in last night's test. Could be caused by dedup consuming stalls, or gateOpen threshold (currently stall >= 7).

4. **ROI calculation section unreachable** — Because WOW never advanced, never reached anchor_acv, never collected inputs, never calculated ROI.

5. **Sorry loop** — When prospect pushed back, Bella apologised repeatedly instead of delivering data. NEVER APOLOGISE rule added in v9.2.2 but NOT YET RETESTED.

### NEW ISSUES FROM THIS MORNING'S TEST

Trent reports: "She breaks after the Deepgram intro." Additional issues in Apify scraping, stall progression, and shifting to ROI calc section. LOTS of issues. Full diagnostic needed.

---

## YOUR MISSION RIGHT NOW

### STEP 1: Start full tails on ALL workers
```bash
cd /Users/trentbelasco/Desktop/BELLA_V9_SANDBOX_COMPLETE_SYSTEM

# Bridge (most important)
npx wrangler tail deepgram-bridge-sandbox-v8 --format=json 2>&1 | tee /tmp/bella_bridge_$(date +%s).log &

# Voice agent
npx wrangler tail bella-voice-agent-sandbox-v8 --format=json 2>&1 | tee /tmp/bella_voice_$(date +%s).log &

# Workflow (Apify scraping)
npx wrangler tail bella-scrape-workflow-v9-test --format=json 2>&1 | tee /tmp/bella_workflow_$(date +%s).log &

# Fast intel
npx wrangler tail fast-intel-v8 --format=json 2>&1 | tee /tmp/bella_fastintel_$(date +%s).log &

# Consultant
npx wrangler tail consultant-v9 --format=json 2>&1 | tee /tmp/bella_consultant_$(date +%s).log &
```

### STEP 2: Trent runs a live voice call. Capture EVERYTHING.

### STEP 3: After call, pull FULL DIAGNOSTIC:
A) **TIMING TABLE** — T+0 to T+end, every event with timestamps
B) **FULL CONVERSATION TRANSCRIPT** — every BELLA_SAID + every user utterance with stage/stall
C) **DATA AVAILABILITY PER TURN** — what KV sources existed, deep_flags content, late-load status
D) **WAVE DEBUG** — read `lead:{lid}:wave_debug` from KV for Apify actor results
E) **EXTRACTION ACCURACY** — every captured input, were regex captures correct?
F) **ROI CALCULATIONS** — read `lead:{lid}:roi` from KV
G) **STAGE FLOW** — full stage progression, any stuck/skipped stages

### STEP 4: Root cause each issue. Fix ONE AT A TIME. Deploy → verify → next.

### STEP 5: Repeat test until Bella completes a full conversation: intro → WOW → ACV → timeframe → channels → ROI → close.

---

## ISSUES TO WATCH FOR AND FIX

### Apify Scraping Issues
- Facebook ads actor frequently times out (60s limit). If it hits 0 items, that's OK — data goes to Alex in channel stage, not needed for WOW.
- Indeed was promoted to priority 2 (hiring signals = agent replacement wedge). Verify wave packing puts it in Wave 1.
- Check `lead:{lid}:wave_debug` for per-actor timing and success/failure.
- Actor config is in `bella-scrape-workflow-v9/src/steps/poll-apify-deep.ts`

### Stall Issues
- WOW gate is `stall >= 7` — that's 7 genuine new utterances before advancing
- DEDUP should return 204 and NOT increment stall (fixed in v9.2.2 — verify in logs)
- New turn with same content DOES increment stall (treated as confirmation)
- If prospect says "yeah" repeatedly, stall should advance — check it does

### ROI Calc Section Issues
- ROI requires: ACV (from anchor_acv) + channel inputs (from ch_ads, ch_website, etc.)
- If WOW never advances → ACV never captured → ROI never calculates
- Check `gateOpen()` in bridge — WOW needs `stall >= 7`
- Check `advance()` — WOW → anchor_acv → anchor_timeframe → channels → roi_delivery → close
- Check `runCalcs()` — needs at least `acv` + one channel's inputs

### Prompt Issues
- v9.2.2 puts MANDATORY SCRIPT directive FIRST, intel LAST as REFERENCE DATA
- If Gemini still improvises, check prompt size (`[PROMPT] system_chars=N`) — should be 3000-10000
- Temperature is 0.95 — consider lowering to 0.7 for more script adherence
- If SAY EXACTLY THIS is still being ignored, the directive section needs to be even more forceful

---

## APIFY QUOTA HARD RULES

- Free plan: 8,192MB concurrent memory cap
- Never fire actors exceeding 8192MB concurrent
- Sort by priority before wave packing
- Wait 5s between waves for deallocation
- Facebook ads timeout: 60s (others: 30s default)
- LinkedIn: DISABLED (trial expired)
- Instagram: conditional (only when IG detected on site)

### Current Actor Priorities (PENDING REALLOCATION — Indeed to be promoted)
| Priority | Actor | Memory |
|----------|-------|--------|
| 1 | google_maps | 1024MB |
| 2 | indeed | 4096MB | ← PROMOTE to Wave 1 (hiring = agent replacement wedge) |
| 3 | facebook_ads | 1024MB |
| 4 | google_ads_transparency | 4096MB |
| 5 | google_search | 1024MB |
| 6 | seek_jobs | 256MB (AU only) |
| 7 | instagram | 1024MB (conditional) |

---

## HIRING SIGNAL WEDGE (NEW — highest value commercial data)

When a prospect is hiring for roles our agents replace, this is the ULTIMATE pitch:
- Receptionist → Maddie: "You're hiring a receptionist for $60K — Maddie does the job today for pennies"
- SDR → Alex: "You're hiring an SDR — Alex follows up every lead in under 60 seconds"
- Customer support → Chris + Maddie
- Marketing → Chris + Alex
- Sales → Alex + Sarah

Full mapping in PRODUCT_BIBLE.md and DATA_ENRICHMENT_MASTER_PLAN.md.
extract-deep.ts needs to classify job titles into agent matches.
Consultant needs to look for hiring signals and produce wedge insights.

---

## KEY SOURCE FILES

| File | What it is |
|------|-----------|
| `deepgram-bridge-v9/src/index.ts` | **THE BRAIN** — v9.2.2. buildFullSystemContext, buildTurnPrompt, buildStageDirective, regexExtract, runCalcs, advance, gateOpen, dedup logic, streamToDeepgram |
| `voice-agent-v9/src/index.ts` | Deepgram DO — WebSocket handler, greeting script, system prompt injection |
| `bella-scrape-workflow-v9/src/index.ts` | Workflow orchestrator — 11 steps |
| `bella-scrape-workflow-v9/src/steps/poll-apify-deep.ts` | Smart wave scheduler — buildWaves(), actor config, priority packing, 60s FB timeout |
| `bella-scrape-workflow-v9/src/steps/extract-deep.ts` | Rich data extraction from Apify results |
| `bella-scrape-workflow-v9/src/steps/write-deep-flags.ts` | KV write — ALL fields to deep_flags |
| `bella-scrape-workflow-v9/src/fire-apify-handler.ts` | T=0 actor firing |
| `consultant-v9/worker.js` | Gemini consultant — scriptFills, routing, urgency hierarchy |
| `fast-intel-sandbox-v9/src/index.ts` | Phase A — Firecrawl + consultant at T=0 |
| `netlify-funnel-sandbox-v9/demo_v15_hybrid.html` | Demo page — what the prospect sees |

---

## CONVERSATION FLOW (what SHOULD happen)

```
1. Prospect clicks Bella widget on demo page
2. Voice agent DO spins up → reads KV intel → builds Deepgram greeting
3. Deepgram speaks greeting: "Hey {name}, I'm Bella, welcome to your personalised AI opportunity audit..."
4. Prospect says "Yeah sounds good"
5. Bridge stall=1: FREE TRIAL PITCH — "Great, and one more thing..." → Sound good?
6. Prospect confirms
7. Bridge stall=2: FIRST CONSULTATIVE INSIGHT — ICP or Google rating or offer
8. Stalls 3-7: More insights, hiring wedge, ads/reputation, situation probes
9. Bridge stall=8+: BRIDGE TO NUMBERS — "Would you like me to work out the opportunities?"
10. advance() → anchor_acv: "What's the annual value of a new client?"
11. advance() → anchor_timeframe: "Weekly or monthly?"
12. advance() → ch_website/ch_ads (from queue): Ask channel-specific questions, deliver per-agent ROI
13. advance() → roi_delivery: Recap total ROI
14. advance() → close: Free trial offer
```

If the conversation breaks at ANY point, check the logs at that exact turn to see what went wrong.

---

## WORKING RULES — NON-NEGOTIABLE

1. Root cause before ANY fix
2. One change at a time — deploy, verify, confirm
3. All KV ops need `--remote` flag
4. `wrangler tail --format=json` for all log checks
5. Read deployed worker code before any change
6. If 3+ fixes fail → stop and question architecture
7. `buildStageDirective()` — DO NOT TOUCH without Trent's explicit approval
8. No unsolicited tests, no browser opens
9. NEVER destroy/disable/remove any existing worker/pipeline
10. `capture.html` — DO NOT MODIFY
11. Old pipeline (`personalisedaidemofinal-sandbox`) — DO NOT DISABLE
12. Deploy consultant to BOTH `consultant-v8` AND `consultant-v9`
13. ALL existing scrapers STAY — we ADD, never remove
14. Every data point must map to a specific agent pitch
15. Cost target: SINGLE DIGIT CENTS per lead total
16. Apify Free plan: NEVER exceed 8192MB concurrent memory
17. Always bump VERSION string on every deploy

---

## PRIORITY ORDER

1. **START TAILS** on all workers
2. **RUN LIVE TEST** — Trent calls Bella, CC captures everything
3. **DIAGNOSE** — pull full diagnostic from logs, identify every issue
4. **FIX BRIDGE ISSUES** — stall progression, prompt adherence, dedup, stage advancement
5. **FIX APIFY ISSUES** — actor reliability, wave scheduling, data extraction
6. **REALLOCATE APIFY PRIORITIES** — Indeed to priority 2 for hiring signals
7. **ADD HIRING CLASSIFICATION** — extract-deep maps job titles to agent replacements
8. **ITERATE** — test → fix → test → fix until Bella completes a full conversation

GO.
