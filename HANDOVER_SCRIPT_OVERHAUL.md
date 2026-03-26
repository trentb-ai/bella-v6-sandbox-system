# BELLA V1.1 → SCRIPT OVERHAUL — FULL HANDOVER
# Date: 21 March 2026 AEST
# Purpose: Fresh session to implement Trent's new script/map/rules overhaul from Perplexity+GPT

---

## SESSION STARTUP — READ THESE IN ORDER

### 1. Skills (load your operating system first)

**Core operating principles:**
- `~/.claude/skills/bella-gsd/SKILL.md` — GSD iron rules: DO don't ask, one task one context, state on disk, verify before advancing, atomic commits, fix root cause. Deploy-and-verify cycle. Context rot prevention. Session startup checklist.

**Bella-specific domain skills:**
- `~/.claude/skills/bella-cloudflare/SKILL.md` — CF Workers, DOs, Workflows, Service Bindings, KV, Wrangler. Official docs only, verified vs unverified separation.
- `~/.claude/skills/bella-deepgram/SKILL.md` — Voice Agent API, BYO LLM, Flux STT, Aura TTS, turn detection, WebSocket messages.
- `~/.claude/skills/bella-gemini/SKILL.md` — Gemini 2.5 Flash prompting, script compliance, DELIVER_THIS enforcement, temperature/thinking control.
- `~/.claude/skills/bella-apify/SKILL.md` — Actor runs, polling, dataset fetch, scraping workflows.
- `~/.claude/skills/bella-firecrawl/SKILL.md` — Scrape API, formats, wait logic, proxies.
- `~/.claude/skills/bella-google-places/SKILL.md` — Places API (New), ratings, reviews, business cross-ref.
- `~/.claude/skills/bella-claude-code/SKILL.md` — CC skills architecture, execution-focused patterns.

**Deep-dive infrastructure:**
- `~/.claude/skills/cloudflare/workers-kv-do/SKILL.md` — KV namespace ops (MUST use --remote), key schema, LID sanitization, read-then-merge, raw DO hibernation, Bella KV reference (namespace ID, account ID).
- `~/.claude/skills/cloudflare/workflows/SKILL.md` — step.do() API, retry config, NonRetryableError, parallel execution, Bella 15-step enrichment pipeline target.
- `~/.claude/skills/cloudflare/service-bindings.md` — HTTP + RPC bindings, Bella binding map.
- `~/.claude/skills/cloudflare/wrangler-cli.md` — Deploy/verify checklist.
- `~/.claude/skills/voice-ai-deepgram/SKILL.md` — Broader voice AI patterns (OpenAI Realtime, Vapi, Deepgram, ElevenLabs, LiveKit). Latency budgets.

**Pocock skills (process + architecture):**
- `~/.claude/skills/grill-me/SKILL.md` — "Interview me relentlessly about every aspect of this plan until we reach a shared understanding." 3 sentences. Forces 20-50 questions before building.
- `~/.claude/skills/improve-codebase-architecture/SKILL.md` — Deep modules (Ousterhout). Explore organically, find friction, propose module-deepening refactors. Spawn parallel sub-agents for interface design.
- `~/.claude/skills/triage-issue/SKILL.md` — Bug investigation: explore codebase, find root cause, create GitHub issue with TDD fix plan (RED-GREEN cycles).
- `~/.claude/skills/write-a-prd/SKILL.md` — PRD through interview + codebase exploration.
- `~/.claude/skills/prd-to-plan/SKILL.md` — PRD → tracer-bullet vertical slices.
- `~/.claude/skills/prd-to-issues/SKILL.md` — PRD → independently-grabbable GitHub issues.

### 2. Repo context
- `CLAUDE.md` — Master brief (worker inventory, naming conventions, critical rules, KV schema, monitoring)
- Repo: `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/`

### 3. Shared Brain (Cloudflare D1)
- Database ID: `2001aba8-d651-41c0-9bd0-8d98866b057c`
- Contains: session summaries, 9 speed-fix work items (NOT yet applied), 3 key decisions, project records
- Query: `SELECT * FROM work_items WHERE project_id='bella-v11' AND status='open' ORDER BY priority`

---

## WHAT'S DEPLOYED AND WORKING

| Worker | Version | What it does |
|--------|---------|-------------|
| call-brain-do | v2.4.0-watchdog | DO brain: stage/stall/extraction/gating/queue/ROI/watchdog alarms |
| deepgram-bridge-v11 | v9.18.0-question-gate | Bridge: calls DO, builds prompt, streams Gemini 2.5 Flash |
| fast-intel-v8 | v1.10.0+ | Scrapes website (Firecrawl), runs consultant, sends events to DO |
| deep-scrape-workflow-v9 | v9.2.0+ | Fires 5 Apify actors, sends deep_ready to DO |
| consultant-v9 | synced | Gemini analysis: ICP, routing, scriptFills, conversionEventAnalysis |
| bella-voice-agent-v11 | v4.0.3 | Deepgram Voice Agent DO (WebSocket + Flux STT + Aura-2 TTS) |
| bella-tools-worker-v8 | v8 | Deepgram function calls handler |

**Test URLs:**
- V1.1 (DO brain): bella-v11-do-brain.netlify.app
- V1.0 (frozen, old bridge): demofunnelbellasandboxv8.netlify.app

---

## THE DO BRAIN ARCHITECTURE (what's built)

CallBrainDO is the SOLE live authority for each call. Bridge is thin transport.

**How a turn works:**
```
Deepgram transcribes speech → calls Bridge /v9/chat/completions
  → Bridge reads KV for intel (STILL — should come from DO eventually)
  → Bridge POSTs transcript to call-brain-do /turn
  → DO: ensureSession → dedup check → extract → gate → build NextTurnPacket
  → Bridge: builds rich prompt (DELIVER_THIS + OUTPUT RULES + reference data)
  → Bridge: streams Gemini 2.5 Flash
  → Gemini response → Deepgram TTS → browser audio
  → Bridge: sends llm_reply_done to DO (tracks spoken moves)
```

**DO features built:**
- Idempotent ensureSession (no state wipes, lazy init on first /turn OR first intel event)
- Turn dedup (SHA-256 of turnId + transcript, cached packet replay)
- Version-guarded intel merge (fast_intel_ready, consultant_ready, deep_ready)
- Watchdog alarms: roi_pending, deep_missing, call_stale (flags only, never bulldoze)
- Event observability: eventId + sentAt on all async events
- IndustryLanguagePack: 10+ industry packs, keyword map, consultant-outranks-heuristic
- cleanFacts sanitizer: strips quotes/JSON from consultant data
- Extraction: loosened regex, EXTRACT_STANDALONE/MISS logging

---

## THE SCRIPT ENGINE (what you're about to replace)

**File:** `call-brain-do/src/moves.ts` (756 lines)
**Function:** `buildNextTurnPacket(state: CallBrainState) → NextTurnPacket`

**Current structure (9 WOW stalls):**
| Stall | ID | Job |
|-------|-----|-----|
| 1 | wow_s1_research | Research intro + permission to continue |
| 2 | wow_s2_reputation / wow_s2_trial | Reputation + free trial (skip if no rating) |
| 3 | wow_s3_icp | ICP + 2 problems + 2 solutions (combined) |
| 4 | wow_s4_pretrain | Pre-training connect to revenue |
| 5 | wow_s5_conversion | Conversion event alignment |
| 6 | wow_s6_audit | Audit setup transition (bridge, NOT question) |
| 7 | wow_s7_source | Main controllable source (3 variants) |
| 8 | wow_s8_hiring | Hiring / capacity wedge |
| 9 | wow_s9_rec | Provisional recommendation + bridge to numbers |

**Channel stages:** anchor_acv → anchor_timeframe → ch_website/ch_ads/ch_phone/ch_old_leads/ch_reviews → roi_delivery → close

**Each channel has:** Q1 (volume) → Q2 (conversions) → Q3 (speed/handling) → inline ROI delivery

**What's 90% aligned with Perplexity spec, what's not:**
- ✅ All stall text matches spec
- ✅ IndustryLanguagePack used everywhere
- ✅ Consultant pre-built spoken lines used as PRIMARY
- ✅ Channel Speed Rule respected (speed Q inside channels, not WOW)
- ❌ Stall 2 text slightly different from spec (too salesy)
- ❌ Missing "paid growth check" stall (spec had 10 stalls, code has 9)
- ❌ No WOW early exit (spec says aim for turn 6-8)
- ❌ WOW gate at stall 10 is too slow (3+ minutes before ACV)

---

## KNOWN ISSUES FROM LAST LIVE TEST (Walker Lane anon_jywk4s9e)

1. **WOW too slow** — 10 stalls, 3 minutes before ACV. ROI never reached.
2. **Industry misclassified** — "legal" instead of "financial planning"
3. **STALL_HOLD too aggressive** — "yeah"/"sure" doesn't advance stall
4. **"Walker Lane Pty Ltd"** — Pty Ltd not stripped from business name
5. **"Thanks for clarifying"** — still appearing despite filter
6. **Deep intel never arrived** — No Google reviews/hiring/ads for this call

Speed fixes are documented in `CC_LIVE_TEST_FIXES.md` but **NOT YET APPLIED** — may be superseded by the new script overhaul.

---

## KEY REPO FILES

| File | Lines | Purpose |
|------|-------|---------|
| call-brain-do/src/moves.ts | 756 | **THE SCRIPT** — buildNextTurnPacket() |
| call-brain-do/src/index.ts | 500 | DO handler: /turn, /event, ensureSession, watchdog |
| call-brain-do/src/types.ts | ~170 | TypeScript contracts: CallBrainState, NextTurnPacket, BrainEvent |
| call-brain-do/src/extract.ts | ~390 | Regex extraction + normalizeSpokenNumbers |
| call-brain-do/src/gate.ts | ~134 | Stage gating, advancement, queue building |
| call-brain-do/src/intel.ts | ~270 | Intel merge, IndustryLanguagePack, keyword map |
| call-brain-do/src/roi.ts | ~167 | ROI calculation engine (5 agents) |
| call-brain-do/src/state.ts | ~83 | DO storage: init, load, persist |
| deepgram-bridge-v11/src/index.ts | 2789 | Bridge: DO path + old path + prompt assembly |
| CC_LIVE_TEST_FIXES.md | ~250 | 9 speed fixes (NOT applied) |
| CC_PATCH_MOVES_V2.md | 436 | Perplexity script diff (every stall deviation) |
| DO_BRAIN_IMPLEMENTATION_SPEC.md | 683 | Original architecture spec with TypeScript contracts |
| BELLA_V2_ARCHITECTURE.md | 289 | Phase 2: atomic workers + queues + alarms |
| GPT_DEEP_ANALYSIS_3_ISSUES.md | ~224 | Deep intel, industry, extraction fixes |

---

## WHAT TRENT IS BRINGING

Extensive script rewrites from Perplexity + GPT — done outside this session:
- **New scripts** — rewritten conversation flow
- **New stage maps** — restructured stages/stalls
- **New TypeScript contracts** — updated types
- **New rules and frameworks** — conversation rules, pacing, ROI speed
- **Full overhaul** — may significantly change moves.ts structure

These documents are the NEW authority. Current moves.ts should be updated to match them.

---

## INFRASTRUCTURE REFERENCE

- **KV namespace:** leads-kv (ID: 0fec6982d8644118aba1830afd4a58cb)
- **Account ID:** 9488d0601315a70cac36f9bd87aa4e82
- **Shared Brain D1:** 2001aba8-d651-41c0-9bd0-8d98866b057c
- **Git repo:** https://github.com/trentb-ai/bella-v6-sandbox-system (main branch)
- **Local path:** /Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/
