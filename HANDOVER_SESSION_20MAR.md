# HANDOVER — Session 20 March 2026
## Claude.ai Strategy Session + CC Execution

---

## WHAT HAPPENED THIS SESSION

### Skills Library Built (21 new files)
Created 7 bella-* skill directories with SKILL.md + VERIFIED.md + UNVERIFIED.md each:
- bella-cloudflare, bella-deepgram, bella-gemini, bella-claude-code, bella-apify, bella-firecrawl, bella-google-places
- All sourced from Perplexity-verified official docs, not hallucinated
- Plus 5 supplementary deep-dive files in cloudflare/ and voice-ai-deepgram/
- Plus bella-gsd/SKILL.md (Get Shit Done operating principles)
- GSD CLI installed globally: `npm install -g gsd-pi`

### Full Scraping & Enrichment Audit
Mapped all 3 workers (fast-intel 1,292 lines, workflow 144 lines, bridge 2,680 lines):
- Identified duplicate Firecrawl (fast-intel AND workflow both scrape)
- Bridge reads 5 KV keys per turn and merges with priority chain
- Business name resolved independently by each worker
- snake_case/camelCase translation mess between workflow and bridge

### Consensus Reached (Claude.ai + CC + Perplexity)
Full unified workflow rewrite is architecturally correct but premature.
Two user-facing problems (wrong name, late data) fixable with targeted patches.
Full rewrite waits until conversation flow stable.

### CC Shipped 6+ Fixes
- P1-T0a: adsOn ?? vs || bug FIXED (v9.11.0)
- P1-T0b: Extraction regex — "maybe hundred" normalization FIXED (v9.12.0)
- P1-T0c: ROI delivery — combined total stage FIXED (v9.12.0)
- P2-T3: Apify fireActor retry on no_id FIXED (v9.12.0)
- P2-T4: FB Ads timeout 60s→90s, per-actor overrides 120s FIXED (v9.12.0)
- NEW: Landing page scraping step added to workflow (v9.12.0)
- NEW: Bridge ad_landing_pages integration (v9.12.0)

### CC Bug Report (v9.13.2) — Two P0 Bugs Found
BUG 1 (P0): Voice agent firstName — connection.request.url is null in Agents SDK WebSocket upgrade.
Fix spec written: override fetch() on BellaAgent to capture URL params before SDK handles upgrade,
store in _pendingUrlHints, read in onConnect(). ~30 lines. NOT YET DEPLOYED.

BUG 2 (P0): Full consultant hallucinating business name — "Trusted Financial Advisors Sydney" overwrites
correct fast consultant "Leading Advice". Line 691: `consultant = fullResult ?? fastResult` blindly
overwrites. Fix spec written: fast consultant is name authority, full is analysis authority. ~15 lines.
NOT YET DEPLOYED.

BUG 3 (P2): Google Places mismatch — safety net WORKED correctly (verified=false prevented bad overwrite).

### Consultant V8/V9 Sync Issue Discovered & Fixed
fast-intel was binding to consultant-v8 which was 24 HOURS behind consultant-v9.
5 deploys of fixes only on v9, v8 running stale code. SYNCED in this session.

### V1.0 Saved
Git commit 34e599a, tag v1.0. 32 files, clean baseline.
All active workers committed. Stale/unused folders excluded.
Naming convention documented in CLAUDE.md (v9 folders deploy to v8 worker names).

---

## CRITICAL DECISION: DO BRAIN MIGRATION

### Why
The step-by-step patch approach is NOT fixing the core problems:
- Extraction cascading (wrong values assigned to wrong fields)
- ROI calculated but never delivered to prospect
- Repeated questions (no state authority)
- NEVER APOLOGISE / SAY EXACTLY THIS ignored
- Bridge is 2,680 lines doing EVERYTHING — brain, transport, state, extraction, prompts

### What
Build a Durable Object as the "call brain" — extract state machine from bridge into a DO.
Based on Perplexity's architecture recommendation (verified against CF docs).

### MVP DO Brain (Next Session)
New `call-brain-do` containing:
- Current stage + stall
- All extracted values (acv, web_leads, web_conversions, etc.)
- What's been spoken / what hasn't
- calc_ready flag
- Merged intel (loaded ONCE at call start, updated when workflow events arrive)
- Extraction validation (doesn't advance until extraction succeeds)
- ROI delivery enforcement (close stage CANNOT loop without delivering numbers)

Bridge changes:
- Bridge receives transcript from Deepgram
- Bridge sends transcript to DO: POST /turn
- DO returns NextTurnPacket (stage, objective, chosen move, critical facts, extract targets)
- Bridge formats into small Gemini prompt and streams response
- Bridge drops from ~2,680 → ~1,500 lines

### Full Vision (After MVP)
Per Perplexity's plan, incrementally build toward:
- Consultant outputs TurnAssets (candidate moves per stage) not flat scriptFills
- DO selects best move per turn
- NextTurnPacket shrinks Deepgram prompts to <500 chars
- Workflow emits events to DO (late data arrives mid-call cleanly)
- Config packs (agent_pack, industry_pack, stage_pack) for reusable engine
- KV removed from live critical path (DO is strongly consistent authority)

---

## DEPLOYED VERSIONS (as of V1.0 tag)

| Worker | Deployed Name | Version | Last Deploy |
|--------|--------------|---------|-------------|
| Bridge | deepgram-bridge-sandbox-v8 | v9.13.2 | Mar 19 08:56 |
| Fast-Intel | fast-intel-v8 | v1.8.0 | Mar 19 09:48 |
| Voice Agent | bella-voice-agent-sandbox-v8 | v4.0.2-SUPERGOD | Mar 19 09:50 |
| Consultant | consultant-v8 AND consultant-v9 | SYNCED | Mar 19 23:12 |
| Workflow | bella-scrape-workflow-v9-test | latest | Mar 18 07:54 |
| Tools | bella-tools-worker-v8 | v8 | Mar 11 (8 days stale) |

NOTE: Local folders are -v9 but deploy to -v8 worker names. See wrangler.toml in each folder.

---

## NOT YET DEPLOYED (Bug fixes written but not shipped)

1. BUG 2 fix: Fast consultant name authority (fast-intel) — spec in BUG_REPORT_v9.13.2.md section 2.6
2. BUG 1 fix: Voice agent _pendingUrlHints (voice-agent) — spec in BUG_REPORT_v9.13.2.md section 1.6

Deploy Bug 2 first (simpler, wider impact), then Bug 1.

---

## SCRAPER STATUS (from CountsEdge test)

| Source | Status | Action Needed |
|--------|--------|---------------|
| Google Maps | ✅ WORKING (5★, 10 reviews) | DO NOT REPLACE — augment with Places API |
| Consultant | ✅ WORKING | Full+fast synced |
| Facebook Ads | ⚠️ Timeout increased to 120s | Monitor — may need Meta Ad Library API (Phase 3) |
| Google Search | ⚠️ Retry added for no_id | Monitor — may need SERP API (Phase 3) |
| Indeed | ❌ False positives | Needs investigation |
| Seek | ❌ Not scheduled | Add to waves |
| LinkedIn | ❌ All null | Low priority |
| Ad Landing Pages | ✅ NEW step added | Needs testing |

Perplexity scraper research prompt written: PERPLEXITY_SCRAPER_RESEARCH.md (not yet sent)

---

## SKILLS INVENTORY (as of this session)

Location: ~/.claude/skills/

### Bella-specific (new):
- bella-cloudflare/ (SKILL + VERIFIED + UNVERIFIED)
- bella-deepgram/ (SKILL + VERIFIED + UNVERIFIED)
- bella-gemini/ (SKILL + VERIFIED + UNVERIFIED)
- bella-claude-code/ (SKILL + VERIFIED + UNVERIFIED)
- bella-apify/ (SKILL + VERIFIED + UNVERIFIED)
- bella-firecrawl/ (SKILL + VERIFIED + UNVERIFIED)
- bella-google-places/ (SKILL + VERIFIED + UNVERIFIED)
- bella-gsd/ (GSD operating principles)

### Supplementary deep-dives:
- cloudflare/workflows/SKILL.md (step.do API, retry config, Bella 15-step target)
- cloudflare/service-bindings.md (HTTP + RPC, Bella binding map)
- cloudflare/workers-kv-do/SKILL.md (KV schema, CLI, raw DO patterns)
- cloudflare/wrangler-cli.md (deploy/verify checklist)
- voice-ai-deepgram/deepgram-voice-agent-api.md (BYO LLM, Flux, message types)

### Pre-existing:
- superpowers/systematic-debugging/ (4 files)
- claudekit/debugging/ (2 files)
- cloudflare/ (SKILL + agents-sdk + state-patterns + troubleshooting)
- orchestrator/, planning-with-files/, project-planner/
- superpowers/executing-plans/, subagent-driven-development/
- voice-ai-deepgram/ (SKILL + voice-agents)

### Tools installed:
- GSD CLI: `gsd-pi` (globally installed via npm)

---

## FILES CREATED THIS SESSION

| File | Purpose |
|------|---------|
| PHASE_1_2_EXECUTION_PLAN.md | Updated execution plan (15 tasks) |
| PERPLEXITY_SECOND_OPINION.md | Scraping/enrichment migration review prompt |
| PERPLEXITY_SCRAPER_RESEARCH.md | Scraper issues research prompt (not yet sent) |
| BUG_REPORT_v9.13.2.md | CC's P0 bug report with fix specs |
| CC_TASK_SAVE_V1.md | V1.0 save instructions for CC |
| HANDOVER_SESSION_20MAR.md | This file |
| 21 skill files in ~/.claude/skills/bella-* | See skills inventory above |

---

## NEXT SESSION PRIORITIES

1. Deploy Bug 2 fix (consultant name authority) — spec ready in BUG_REPORT
2. Deploy Bug 1 fix (voice agent _pendingUrlHints) — spec ready in BUG_REPORT
3. Write DO brain implementation spec (the big move)
4. Build MVP DO brain
5. Send PERPLEXITY_SCRAPER_RESEARCH.md for scraper alternatives research

---

## REFERENCE: Perplexity DO Architecture Plan

Full plan provided by Perplexity in this session. Key components:
- Workflow = enrichment only
- Durable Object = live call brain (state + move selection)
- Bridge = thin transport (~200 lines)
- Consultant = generates TurnAssets (candidate moves), not live script
- NextTurnPacket type: { objective, reactionHint, chosenMove, criticalFacts, extractTargets, style }
- Four portable config layers: agent_pack, industry_pack, stage_pack, consultant_schema
- MVP → Full path: extract state machine → add TurnAssets → shrink prompts → add config packs

Source: Perplexity research with CF Workflows docs, DO docs, Deepgram Voice Agent docs
