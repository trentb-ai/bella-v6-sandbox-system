# BELLA V6 — PHASE 1: FULL SYSTEM DEBUG BRIEF
### For Claude Code (Opus) | Updated: 2026-03-11 | Authority: Trent Belasco

---

## STEP 0 — READ THESE BEFORE ANYTHING ELSE

**Debugging skills (read ALL of these before touching any code):**
1. `.claude/skills/systematic-debugging/SKILL.md` — 4-phase root cause framework. Non-negotiable. Use this.
2. `.claude/skills/systematic-debugging/root-cause-tracing.md` — trace bugs backward through the call stack to the original trigger
3. `.claude/skills/systematic-debugging/defense-in-depth.md` — validate at every layer, make bugs structurally impossible
4. `.claude/skills/systematic-debugging/condition-based-waiting.md` — async/timing bugs, fire-and-forget patterns

**Voice AI / Deepgram skills:**
5. `.claude/skills/voice-ai-deepgram/SKILL.md` — voice AI architect patterns, Deepgram STT/TTS, latency budgets, WebSocket audio pipelines
6. `.claude/skills/voice-ai-deepgram/voice-agents.md` — pipeline vs speech-to-speech architectures, barge-in, turn-taking, VAD, sub-800ms latency techniques

**Cloudflare skills (Workers/KV/DO/Workflows):**
5. `.claude/skills/cloudflare/SKILL.md` — building AI agents on Cloudflare, patterns and gotchas
6. `.claude/skills/cloudflare/troubleshooting.md` — CF-specific debugging (ctx.waitUntil, DO lifecycle, KV consistency)
7. `.claude/skills/cloudflare/state-patterns.md` — KV and DO state management patterns
8. `.claude/skills/cloudflare/agents-sdk/SKILL.md` — Workflows, Durable Objects, KV, service bindings

**Planning and orchestration:**
9. `.claude/skills/planning-with-files/SKILL.md` — persistent planning, your working memory on disk
10. `.claude/skills/subagent-driven-development/SKILL.md` — how to coordinate multi-step work without losing context
11. `.claude/skills/orchestrator/SKILL.md` — spawn focused subagents per ticket

**Project context:**
- `CLAUDE.md` — canonical architecture, KV schema, worker inventory, rules

Do not write a single line of code until you have read ALL skills above and created `PLAN.md`.

---

## YOUR MISSION

**Get Bella working end-to-end. Right now she's broken in multiple compounding ways.**

This is a voice AI sales agent. Her entire value prop — knowing things about prospects that feel impossible to know — requires a full data pipeline: scrape → enrich → KV → brain → voice. None of that pipeline is working correctly. Bella is flying blind, slow, and forgetful.

Phase 1 is not done until a live test call with a fresh lead shows Bella:
- Responding in under 3 seconds
- Citing specific scraped data (Google reviews, ads, hiring signals) that came from the Apify pipeline
- Never asking a question she's already received an answer to
- Running through the WOW stage properly before pivoting to qualification

---

## THE SYSTEM — UNDERSTAND IT FULLY

Five Cloudflare Workers collaborate to build Bella's knowledge base per lead:

```
[Browser form submit]
      ↓
fast-intel-sandbox          ← Phase A: Firecrawl + Gemini Consultant (~35s)
      ↓ ctx.waitUntil (fire & forget ×2)
deep-scrape-workflow-sandbox ← Phase B: 5 Apify actors concurrent (~45s)  
personalisedaidemofinal-sandbox ← Phase C: 110-point deep scrape (~90s)
      ↓ all write back to KV (additive merge)
leads-kv (namespace 0fec6982d8644118aba1830afd4a58cb)
      ↓
deepgram-bridge-sandbox-v9  ← reads KV every turn, builds Gemini prompt, streams response
      ↓
bella-voice-agent-sandbox-v9 ← WebSocket / Durable Object, Deepgram STT+TTS
      ↓
Bella speaks with prospect intel
```

**Local source:** `/Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/`

| Folder | Deployed worker name | Role |
|--------|---------------------|------|
| `fast-intel-sandbox/` | `fast-intel-sandbox` | Phase A scraper |
| `deep-scrape-workflow-sandbox/` | `deep-scrape-workflow-sandbox` | Apify pipeline |
| `deepgram-bridge-v9/` | `deepgram-bridge-sandbox-v9` | BRAIN |
| `voice-agent-v9/` | `bella-voice-agent-sandbox-v9` | WebSocket/DO |
| `consultant-v9/` | `consultant-sandbox-v9` | ROI/persona enrichment |

**KV namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`

---

## YOUR APPROACH — NON-NEGOTIABLE

**1. Plan first.** Create `PLAN.md` in this directory using the planning-with-files skill. No code before the plan exists.

**2. Diagnose before fixing.** For every problem below: read the actual source files, run diagnostics, confirm the root cause. This brief describes *observed symptoms* and *my best hypothesis*. You may find the real cause is different. Trust code over this doc.

**3. Investigate broadly.** Don't fixate on Problem 1 and call it done. All five problems are likely compounding. Understand the whole before touching any part.

**4. Deploy order matters.** Fix in dependency order:
   1. `fast-intel-sandbox` — pipeline trigger
   2. `deep-scrape-workflow-sandbox` — verify it runs and writes back
   3. `deepgram-bridge-sandbox-v9` — latency, WOW logic, memory
   4. KV schema — reconcile contradictions

**5. Verify every fix.** Deploy → tail → curl → confirm logs → next. Never assume a fix worked.

**6. Update CLAUDE.md** every time you change architecture, KV schema, or worker behaviour. The next session depends on it.

---

## THE PROBLEMS

### 🔴 PROBLEM 1: SCRAPER PIPELINE NEVER FIRES (MOST CRITICAL)

**Observed symptoms:**
- Every lead: bridge logs show `apify=false full=false` on every turn, never changes
- `intel.deep.status = "processing"` in KV — never becomes `"done"`
- `scrapeStatus = "phase_a"` — never advances to `"phase_b"` or `"done"`
- `GET /status?lid=anon_xxx` on deep-scrape-workflow returns `{"status":"not_found"}` for all real leads
- Direct curl to trigger endpoint works: `curl -X POST .../trigger` → `{"ok":true,"status":"queued"}`

**My hypothesis (verify this, don't just accept it):**
`fast-intel-sandbox` calls `ctx.waitUntil(fetch(".../trigger", ...))` to kick off the workflow after Phase A. This appears to be silently failing. The fetch either errors without logging, the payload is malformed, there's a CORS or auth issue on the receiving worker, or the Cloudflare Workflow runner has a cold-start issue that causes the initial trigger to be swallowed. I don't know which. Read the actual trigger code in `fast-intel-sandbox/src/` and the receiving handler in `deep-scrape-workflow-sandbox/src/` before forming conclusions.

**What I want at the end:**
- `wrangler tail fast-intel-sandbox` shows `[APIFY_TRIGGER] ok:true status:queued` for new leads
- `/status?lid=NEW_LID` returns `running` within 10s of form submit, `complete` within 90s
- `intel.deep.googleMaps.rating`, `intel.deep.ads`, `intel.deep.hiring` populated in KV
- Bridge logs show `apify=true` after 90s

---

### 🔴 PROBLEM 2: LATENCY — 12-17 SECONDS PER TURN

**Observed symptoms:**
- `[UTT]` fires → 12-17 seconds → POST to Gemini completes
- Frequent `Canceled` responses from Deepgram (it gives up before bridge responds)
- Latency regressed significantly after qualitative memory Gemini call was added
- `system_chars=18937` in bridge logs — 18KB prompt going to Gemini every single turn

**My hypothesis (verify this):**
Multiple compounding issues. The qualitative conv_memory Gemini call likely landed on the critical path. The 18KB system message may be causing Gemini cold-start delay. There may also be sequential KV reads that could be parallelised. I don't know the exact breakdown — instrument the bridge timing yourself to find where the time goes.

**What I want at the end:**
- `[UTT]` → `[STREAM]` fires within 500ms
- Full turn response (POST complete + TTS begins) under 3 seconds
- Zero `Canceled` responses from Deepgram

---

### 🟡 PROBLEM 3: KV SCHEMA CONTRADICTIONS

**Observed symptoms:**
- `flags.no_crm = true` BUT `website_health.has_crm = true` for the same lead
- `flags.review_signals = false` BUT `star_rating = 4.2` and `review_count = 83` at top level
- `website_health.google_rating = null` BUT `intel.star_rating = 4.2`
- Bridge has `[FIX_FLAGS]` runtime patches to work around these every turn

**Root cause (verify):**
Three separate writers (`fast-intel`, `Consultant`, `deep-scrape`) write overlapping keys with no reconciliation step. The bridge is compensating with runtime patches instead of reading clean data.

**What I want at the end:**
- One canonical `flags` object that accurately reflects all data sources after Phase A completes
- `website_health` keys populated from whatever source has them (fallback chain)
- No `[FIX_FLAGS]` patches needed in bridge — clean reads only

---

### 🟡 PROBLEM 4: WOW STAGE EXITS IN 1 UTTERANCE

**Observed symptoms:**
- Prospect says 4 words ("Yeah. That'd be right.") agreeing with Bella's ICP guess
- Bridge immediately: `[CAPTURED] wants_numbers=true` → `[ADVANCE] → anchor_acv`
- WOW delivered zero intel before advancing
- Prospect gets interrogated with no relationship built

**My hypothesis:**
`wants_numbers` extraction is too loose — firing on any agreement. And/or it's being used as the sole WOW exit condition when it shouldn't be. WOW should require Bella to have delivered 2+ specific intel points before ANY stage advance is possible.

**What I want at the end:**
- WOW delivers minimum 2 specific scraped data points before any qualification begins
- Exit from WOW only possible after: (a) 2+ intel delivered AND (b) prospect signals readiness
- Transition to anchor_acv feels earned

---

### 🟡 PROBLEM 5: MEMORY NOT PERSISTING

**Observed symptoms:**
- Prospect gives ACV ($250k). Bella acknowledges. Later in same call, Bella asks for ACV again.
- `[CAPTURED]` logs show fields being written but "never ask again" enforcement is broken

**What I want at the end:**
- Once `[CAPTURED]` fires for a field, Bella never asks for it again in the same session
- If prospect references a previously given number, Bella confirms it naturally
- `captured_inputs` in KV always reflects current known state and bridge reads it before asking any question

---

## VERIFICATION COMMANDS

```bash
# Tail workers (always before testing)
cd fast-intel-sandbox && npx wrangler tail --format pretty 2>&1 | tee ../logs/fast-intel-$(date +%Y%m%d-%H%M%S).log
cd deepgram-bridge-v9 && npx wrangler tail --format pretty 2>&1 | tee ../logs/bridge-$(date +%Y%m%d-%H%M%S).log

# Check workflow triggered
curl https://deep-scrape-workflow-sandbox.trentbelasco.workers.dev/status?lid=NEW_LID

# Check fast-intel status  
curl https://fast-intel-sandbox.trentbelasco.workers.dev/status?lid=NEW_LID

# List all KV keys for lead
npx wrangler kv key list --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote --prefix="lead:NEW_LID"

# Read intel envelope from KV
npx wrangler kv key get "lead:NEW_LID:intel" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote

# Deploy a worker
cd {worker-folder} && npx wrangler deploy
```

## TEST URL PATTERN

```
https://claudedemofunnelv5cfsuper.netlify.app/loading-v95.html?lid=anon_NEWLID&web=https%3A%2F%2Fwww.kpmg.com&name=Trent&email=test%40test.com
```
**Always use a fresh LID.** Durable Objects persist state per LID. Reusing a LID tests old state.

After Phase A completes (~35s), open demo:
```
https://claudedemofunnelv5cfsuper.netlify.app/demo_v95_hybrid.html?fn=Trent&lid=SAME_LID&web=https%3A%2F%2Fwww.kpmg.com
```

---

## RULES

1. **One layer at a time.** Deploy → verify → next. No batching changes across workers.
2. **Bridge reads `lead:{lid}:intel` ONLY.** Bridge writes only: `script_state`, `conv_memory`, `captured_inputs`, `bridge_system`.
3. **Always bump VERSION string** on every deploy.
4. **Always pipe wrangler tail through `tee`** to `/logs/` folder.
5. **Read actual source files before acting.** CLAUDE.md may lag deployed state.
6. **Update CLAUDE.md** after every architectural change.

---

## PHASE 1 DONE WHEN ALL OF THESE ARE TRUE

For a fresh test lead (fresh LID, full flow):

- [ ] `wrangler tail fast-intel-sandbox` shows successful apify trigger logs
- [ ] `GET /status?lid=NEW_LID` returns `complete` within 90 seconds  
- [ ] `intel.deep.googleMaps.rating` has a real value in KV
- [ ] `intel.deep.ads` shows real fb/google ad status
- [ ] Bridge logs show `apify=true` after 90s
- [ ] No `[FIX_FLAGS]` contradictions in bridge logs
- [ ] Turn-to-speech latency under 3 seconds, zero `Canceled` responses
- [ ] WOW stage delivers 2+ intel points before advancing to qualification
- [ ] `[CAPTURED]` fields are never re-asked in same session

When all boxes are checked: update CLAUDE.md with clean system state, tell Trent Phase 1 is done.
