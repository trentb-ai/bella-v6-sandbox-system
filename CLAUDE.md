# BELLA V9 — CLAUDE CODE MASTER BRIEF
### Last updated: 2026-04-03 AEST | Authority: Trent Belasco
### Current brain version: v6.16.1
### Current bridge version: v9.40.0
### Current fast-intel version: v1.18.0
### Current voice-agent version: v4.2.0-EOT-INJECT
### Current consultant version: synced (v8 = v9)

---

> ## 🟢 BELLA GOLDEN v1 — KNOWN-GOOD RESTORE POINT
>
> **Git tag:** `bella-golden-v1` | **Commit:** `8e23c66` | **Date:** 2026-04-03
>
> | Worker | Version | Folder | Deploys As |
> |--------|---------|--------|------------|
> | Brain | v6.16.1 | `brain-v2-rescript/` | `call-brain-do-v2-rescript` |
> | Bridge | v9.40.0 | `bridge-v2-rescript/` | `deepgram-bridge-v2-rescript` |
> | Fast-intel | v1.18.0 | `fast-intel-v9-rescript/` | `fast-intel-v9-rescript` |
> | Scrape | v1.7.0 | `bella-scrape-workflow-v10-rescript/` | `bella-scrape-workflow-v10-rescript` |
>
> **Restore:**
> ```bash
> git checkout bella-golden-v1
> cd brain-v2-rescript && npx wrangler deploy
> cd ../bridge-v2-rescript && npx wrangler deploy
> cd ../fast-intel-v9-rescript && npx wrangler deploy
> cd ../bella-scrape-workflow-v10-rescript && npx wrangler deploy
> ```
>
> **Live test result:** 10/10 stages (WOW1-8 + recommendation + close), all compliance 1.00, zero errors.

---

> **NOTE: NAMING CONVENTION — TWO WORKER SETS**
>
> **V2-RESCRIPT (LIVE — used by `cleanestbellav2rescripted.netlify.app`):**
>
> | Folder | Deploys As |
> |--------|-----------|
> | `brain-v2-rescript/` | `call-brain-do-v2-rescript` |
> | `bridge-v2-rescript/` | `deepgram-bridge-v2-rescript` |
> | `bella-voice-agent-v2-rescript/` | `bella-voice-agent-v2-rescript` |
> | `fast-intel-v9-rescript/` | `fast-intel-v9-rescript` |
> | `bella-scrape-workflow-v10-rescript/` | `bella-scrape-workflow-v10-rescript` |
>
> **SANDBOX V8/V9 (OLD — used by `demofunnelbellasandboxv8.netlify.app`):**
>
> | Folder | Deploys As |
> |--------|-----------|
> | `consultant-v9/` | `consultant-v9` AND `consultant-v8` (fast-intel binds to v8) |
> | `fast-intel-sandbox-v9/` | `fast-intel-v8` |
> | `deepgram-bridge-v9/` | `deepgram-bridge-sandbox-v8` |
> | `voice-agent-v9/` | `bella-voice-agent-sandbox-v8` |
> | `bella-scrape-workflow-v9/` | `bella-scrape-workflow-v9-test` |
> | `bella-tools-worker-v9/` | `bella-tools-worker-v8` |
>
> **⚠️ CRITICAL: Always check which frontend Trent is testing with before deploying fixes.
> If `cleanestbellav2rescripted` → deploy to v2-rescript folders.
> If `demofunnelbellasandboxv8` → deploy to v9/sandbox folders.**

---

## CRITICAL RULES — READ FIRST

1. **One problem at a time.** Pick ONE layer below. Deploy → verify → next.
2. **Bridge is READ-ONLY from `lead:{lid}:intel`.** Bridge writes ONLY: `script_state`, `conv_memory`, `captured_inputs`, `bridge_system`.
3. **No unsolicited tests or browser opens.** Wait for Trent.
4. **Always bump VERSION string** on every deploy.
5. **Always pipe wrangler tail through `tee`** to `/logs/` folder.
6. **Use fresh browser tab + fresh LID** between tests.
7. **Read actual source files before acting.** This doc may lag deploys.

---

## LIVE MONITORING (USE THIS DURING TEST CALLS)

**Trent does not want you running `wrangler tail` and waiting — it times out in Claude.ai. Use CC (Claude Code) for all tail monitoring.**

### Quick monitor (pipe + grep for signal only)
```bash
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM
npx wrangler tail deepgram-bridge-sandbox-v9 --format pretty 2>&1 | grep --line-buffered -E \
  "\[KV_STATUS\]|\[PROMPT\]|\[BELLA_SAID\]|\[ADVANCE\]|\[CAPTURED\]|\[EXTRACT\]|\[WARN\]|\[ERR\]|\[INIT\]|\[REQ\]|\[GEMINI_TTFB\]|ERROR"
```

### Or use the monitor script
```bash
bash /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/monitor-bella.sh
# Optional: pass worker name as arg
bash monitor-bella.sh fast-intel-v9
```

### Log tags to watch
| Tag | Meaning |
|-----|---------|
| `[REQ]` | Turn received, lid extracted |
| `[KV_STATUS]` | `fast=true/false apify=true/false full=true/false kv_bytes=N` |
| `[INIT]` | First turn — stage set to wow |
| `[ADVANCE]` | Stage machine moved to next stage |
| `[PROMPT]` | `chars=N` — prompt size per turn (target <3k) |
| `[GEMINI_TTFB]` | Time to first token from Gemini |
| `[BELLA_SAID]` | **What Bella actually said this turn** |
| `[EXTRACT]` | What numeric data was captured from utterance |
| `[CAPTURED]` | KV write confirmed for captured_inputs |
| `[ENRICH]` | review_signals enriched after deep-scrape |
| `[WARN]` | Non-fatal issue (fallback used, null field, etc.) |
| `[ERR]` | Fatal error — examine immediately |

### What "no data" looks like vs working
- **Working:** `[KV_STATUS] lid=anon_xxx fast=true kv_bytes=4200`
- **No intel:** `[KV_STATUS] lid=anon_xxx fast=false kv_bytes=0` → fast-intel didn't write
- **Bella data-blind:** `[PROMPT] chars=280` (should be 800-3000) → intel not reaching prompt

---

## ARCHITECTURE

```
Browser → loading-v95.html → POST /fast-intel (fast-intel-sandbox v9.1.0)
                                    ↓ ctx.waitUntil (fire & forget via SERVICE BINDINGS)
                              deep-scrape-workflow-sandbox /trigger  (env.DEEP_SCRAPE)
                              personalisedaidemofinal-sandbox /log-lead (env.BIG_SCRAPER)
                                    ↓ (30-45s background)
                              Apify actors → KV write-back (additive merge)

Browser → demo_v95_hybrid.html → WebSocket → bella-voice-agent-sandbox-v9 (DO)
                                                    ↓ Deepgram STT
                                          HTTP POST → deepgram-bridge-sandbox-v9
                                                    ↓ reads KV
                                                    ↓ builds prompt
                                                    ↓ streams Gemini
                                                    ↓ SSE → Deepgram TTS → browser
```

**KV namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`

### Service Bindings

| Worker | Binding | Target |
|--------|---------|--------|
| `fast-intel-sandbox` | `CONSULTANT` | `consultant-sandbox-v9` |
| `fast-intel-sandbox` | `DEEP_SCRAPE` | `deep-scrape-workflow-sandbox` |
| `fast-intel-sandbox` | `BIG_SCRAPER` | `personalisedaidemofinal-sandbox` |
| `personalisedaidemofinal-sandbox` | `CONSULTANT` | `consultant-sandbox-v9` |
| `personalisedaidemofinal-sandbox` | `DEEP_SCRAPE` | `deep-scrape-workflow-sandbox` |
| `deepgram-bridge-sandbox-v9` | `TOOLS` | `bella-tools-worker-v9` |

**Note:** Worker-to-Worker calls MUST use service bindings (`env.BINDING.fetch(new Request(...))`), NOT public `fetch("https://worker.workers.dev/...")`. Public same-zone fetch returns Cloudflare error 1042.

---

## WORKER INVENTORY (ALL V8)

| Folder | Deployed name | URL | Role |
|--------|--------------|-----|------|
| `deepgram-bridge-v9/` | `deepgram-bridge-sandbox-v9` | https://deepgram-bridge-sandbox-v9.trentbelasco.workers.dev | BRAIN |
| `voice-agent-v9/` | `bella-voice-agent-sandbox-v9` | https://bella-voice-agent-sandbox-v9.trentbelasco.workers.dev | WebSocket/DO |
| `fast-intel-sandbox/` | `fast-intel-v9` | https://fast-intel-v9.trentbelasco.workers.dev | Phase A scraper |
| `deep-scrape-workflow-sandbox/` | `deep-scrape-workflow-v9` | https://deep-scrape-workflow-v9.trentbelasco.workers.dev | Apify pipeline |
| `consultant-v9/` | `consultant-v9` | https://consultant-v9.trentbelasco.workers.dev | ROI/persona |
| `workers-sandbox/` | `personalisedaidemofinal-v9` | https://personalisedaidemofinal-v9.trentbelasco.workers.dev | 110-pt deep scraper |
| `bella-tools-worker-v9/` | `bella-tools-worker-v9` | https://bella-tools-worker-v9.trentbelasco.workers.dev | Tool handler |
| `mcp-worker-v9/` | `leads-mcp-worker-v9` | https://leads-mcp-worker-v9.trentbelasco.workers.dev | MCP server |

**V6 workers preserved as rollback. NEVER modify V6 or V7.**
**KV namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb` (shared across ALL versions)

---

## KV SCHEMA — CANONICAL (single source of truth)

| Key | Writer | Reader | Status |
|-----|--------|--------|--------|
| `lead:{lid}:intel` | fast-intel, deep-scrape, personalisedaidemofinal | bridge | Working |
| `lead:{lid}:script_state` | bridge | bridge | Working |
| `lead:{lid}:conv_memory` | bridge | bridge | Working |
| `lead:{lid}:bridge_system` | bridge (write-once) | bridge | Working (KV cache) |
| `lead:{lid}:captured_inputs` | bridge | demo agents | Working |
| `lead:{lid}:deepIntel` | deep-scrape | bridge (via intel merge) | Written by deep-scrape |
| `{lid}` (bare key) | fast-intel, personalisedaidemofinal | MCP worker | Working |

### intel envelope structure (what bridge reads from `lead:{lid}:intel`)

```
{
  v, lid, ts, firstName, first_name, websiteUrl,
  business_name,          ← enriched by Consultant (e.g., "Pitcher Partners" not just domain)
  fast_intel: { ... },    ← full fast-intel output
  core_identity: { business_name, industry, location, ... },
  consultant: { scriptFills, routing, conversationHooks, businessIdentity, ... },
  flags: {                ← FIXED v9.1.0: derived from correct tech_stack fields
    is_running_ads, is_retargeting,
    has_fb_pixel, has_google_ads, has_tiktok_ads, has_multi_platform_ads,
    speed_to_lead_needed, call_handling_needed,
    no_crm,               ← !(tech_stack.has_crm) — consistent with website_health
    no_chat,              ← !(tech_stack.has_chat) — consistent with website_health
    no_booking_tool,      ← !(tech_stack.has_booking) — consistent with website_health
    database_reactivation, business_age_established, review_signals
  },
  tech_stack: {
    has_crm, has_chat, has_booking, crm_name, chat_tool, booking_tool,
    is_running_ads, ads_pixels, social_channels,
    flags_tech: { ... }   ← nested priority flags (pixel-level detail)
  },
  bella_opener,
  fast_context: { ... },
  intel: {
    grade,
    bella_opener,
    deep: { status: "processing"|"done", googleMaps, ads, hiring, linkedin }
  },
  website_health: {
    google_rating,        ← null until deep-scrape fills it
    review_count,         ← null until deep-scrape fills it
    has_crm, crm_name,   ← set by fast-intel, consistent with flags
    has_chat, has_booking,
    is_running_ads, ads_pixels, social_channels,
    ...
  },
  scrapeStatus,           ← "phase_a" | "phase_b" | "done" (set by personalisedaidemofinal)
  phase_a_ts, site_content_blob
}
```

### Data consistency
- `flags.no_crm` and `website_health.has_crm` are now consistent (both derive from `tech_stack.has_crm`)
- `review_signals` is enriched by bridge after deep-scrape populates review data (logged as `[ENRICH]`)
- No `[FIX_FLAGS]` patches in bridge — data is clean at source

---

## RECENT FIXES (Phase 1 Debug — 2026-03-11)

### P1: Scraper Pipeline — FIXED
- **Root cause:** CF error 1042 — Worker-to-Worker `fetch()` via public URL blocked by Cloudflare
- **Fix:** Added service bindings (`DEEP_SCRAPE`, `BIG_SCRAPER`) to fast-intel wrangler.toml and updated trigger calls to use `env.DEEP_SCRAPE.fetch(new Request(...))` pattern
- **Also fixed:** personalisedaidemofinal's `/log-lead` was overwriting fast-intel's enriched KV data with a stub. Changed to read-first-check: only writes stub if no existing data.

### P2: Latency — FIXED in 6.6.0-D
- system_chars reduced 18K→3.5K (81% reduction)
- No Gemini distillation call on critical path
- KV reads parallelized, state save non-blocking via ctx.waitUntil
- Warm TTFB measured 2.98-5.27s

### P3: KV Schema Contradictions — FIXED in fast-intel v9.1.0
- **Root cause:** `flags` object read from `fc.tech_stack.no_crm` (UNDEFINED — nested in `flags_tech`), falling back to `?? true` always
- **Fix:** Derive from correct paths: `!(tech_stack.has_crm)` for `no_*` flags, `flags_tech.*` for pixel flags
- Bridge `[FIX_FLAGS]` patches removed (replaced with `[ENRICH]` for review_signals only)

### P4: WOW Stage — FIXED in 6.6.0-D
- Gate: `s.stall >= 3` (minimum 3 turns)
- 3-phase WOW directive: opening impression → deepen → bridge to numbers
- `wants_numbers` regex tightened, NOT used in gateOpen

### P5: Memory — FIXED in 6.7.0-D
- Added "DO NOT re-ask ANY of these — the prospect already told you" to CONFIRMED section
- Stage directives already have per-field "CONFIRMED" short-circuits

---

## DEPLOY COMMANDS

```bash
# Always deploy from V8 folder
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/{worker-folder}
npx wrangler deploy

# Verify — check health endpoint after deploy
curl https://{worker-name}.trentbelasco.workers.dev/health
```

## TEST URLS (V8)

```
# Step 1: Submit lead (Netlify loading page → fast-intel-v9)
https://demofunnelbellasandboxv8.netlify.app/loading-v95.html?lid=anon_NEW_LID&web=https%3A%2F%2Fwww.kpmg.com&name=Trent&email=test%40test.com

# Step 2: Talk to Bella (demo page → bella-voice-agent-sandbox-v9)
https://demofunnelbellasandboxv8.netlify.app/demo_v95_hybrid.html?fn=Trent&lid=SAME_LID&web=https%3A%2F%2Fwww.kpmg.com
```

**Always use a fresh LID** — Durable Object persists state per LID.

After submitting, verify pipeline:
```bash
# KV after ~10s
npx wrangler kv key list --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote --prefix="lead:NEW_LID"

# Read intel
npx wrangler kv key get "lead:NEW_LID:intel" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote
```

---

## SECRETS

| Worker | Secrets |
|--------|---------|
| `deepgram-bridge-sandbox-v9` | `GEMINI_API_KEY` |
| `fast-intel-sandbox` | `FIRECRAWL_API_KEY`, `GEMINI_API_KEY`, `SCRAPINGANT_KEY` |
| `deep-scrape-workflow-sandbox` | `APIFY_API_KEY` |
| `bella-voice-agent-sandbox-v9` | `DEEPGRAM_API_KEY` |
| `personalisedaidemofinal-sandbox` | `APIFY_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `SCRAPINGBEE_KEY`, `FIRECRAWL_KEY`, `BUILTWITH_API_KEY` |
