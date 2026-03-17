---
name: debug-bridge
description: "USE THIS before debugging ANY issue with the Bella V8 bridge (deepgram-bridge-sandbox-v9), voice agent (bella-voice-agent-sandbox-v9), or KV data pipeline. Covers: Bella going silent, no data in prompt, LID extraction failure, Gemini latency, KV misses, stage machine stuck, extraction not firing, ROI not calculating, memory not persisting."
---

# Bella V8 Bridge — Debug Skill

## Architecture in One Paragraph

Browser mic → WebSocket → `bella-voice-agent-sandbox-v9` (Durable Object) → Deepgram STT →
Deepgram calls `deepgram-bridge-sandbox-v9 /v9/chat/completions` each turn →
Bridge reads `lead:{lid}:intel` from KV → builds system prompt → calls Gemini →
streams SSE back → Deepgram TTS → browser speaker.

**The bridge is stateless per request.** All state lives in KV. Every turn is a fresh HTTP POST.

---

## Worker Inventory

| Worker | URL | Role |
|--------|-----|------|
| `bella-voice-agent-sandbox-v9` | https://bella-voice-agent-sandbox-v9.trentbelasco.workers.dev | WebSocket + Deepgram connection |
| `deepgram-bridge-sandbox-v9` | https://deepgram-bridge-sandbox-v9.trentbelasco.workers.dev | LLM brain — reads KV, calls Gemini |
| `fast-intel-v9` | https://fast-intel-v9.trentbelasco.workers.dev | Layer 1 KV write at T=0 |
| `personalisedaidemofinal-v9` | https://personalisedaidemofinal-v9.trentbelasco.workers.dev | Big scraper, Phase A+B KV write |
| `deep-scrape-workflow-v9` | https://deep-scrape-workflow-v9.trentbelasco.workers.dev | Apify deep intel KV write |
| `consultant-v9` | https://consultant-v9.trentbelasco.workers.dev | Sales intelligence analysis |
| `bella-tools-worker-v9` | https://bella-tools-worker-v9.trentbelasco.workers.dev | Tool calls from Deepgram |
| `leads-mcp-worker-v9` | https://leads-mcp-worker-v9.trentbelasco.workers.dev | MCP server for Bella |

**KV Namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb` (shared by ALL workers)

---

## Canonical KV Schema

```
lead:{lid}:intel            ← Main data envelope (bridge reads this EVERY turn)
lead:{lid}:script_state     ← State machine (stage, queue, inputs, stall counter)
lead:{lid}:conv_memory      ← Qualitative call memory (regex signals, bullets)
lead:{lid}:captured_inputs  ← Numeric inputs snapshot (written by bridge after extraction)
lead:{lid}:roi              ← ROI calculations (written by bridge when calcs >= 1)
lead:{lid}:script_stages    ← Custom stage overrides (optional)
lead:{lid}:pending          ← Lead status flag
lead:{lid}:outcome          ← Post-call outcome (written by bella-tools only)
```

**NEVER** read/write bare `{lid}` key — that was a V6 bug, fixed in schema alignment.

---

## Standard Tail Commands

**Always open these in separate terminal tabs before debugging:**

```bash
# Bridge (primary — most important)
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM
npx wrangler tail deepgram-bridge-sandbox-v9 --format pretty 2>&1 | tee logs/bridge-live.log

# Voice agent
npx wrangler tail bella-voice-agent-sandbox-v9 --format pretty 2>&1 | tee logs/voice-live.log

# Fast intel (check scrape pipeline)
npx wrangler tail fast-intel-v9 --format pretty 2>&1 | tee logs/fast-intel-live.log
```

---

## KV Inspection Commands

```bash
# List all keys for a lead
npx wrangler kv key list --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote --prefix="lead:{lid}"

# Read intel envelope
npx wrangler kv key get "lead:{lid}:intel" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote | python3 -m json.tool

# Read state machine
npx wrangler kv key get "lead:{lid}:script_state" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote | python3 -m json.tool

# Read captured inputs
npx wrangler kv key get "lead:{lid}:captured_inputs" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote | python3 -m json.tool

# Read ROI
npx wrangler kv key get "lead:{lid}:roi" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote | python3 -m json.tool

# Read conv_memory
npx wrangler kv key get "lead:{lid}:conv_memory" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote
```

---

## Bridge Log Tags — What They Mean

| Tag | Meaning | What to look for |
|-----|---------|-----------------|
| `[REQ]` | New turn received | `lid=` present? If empty → LID extraction failure |
| `[DIAG]` | First 2 turns diagnostic | `sys_chars` — how big is incoming system message? |
| `[KV_STATUS]` | Intel load result | `fast=true apify=true kv_bytes=N` — is data arriving? |
| `[INIT]` | State machine initialised | `queue=[...]` — correct channels queued? |
| `[ADVANCE]` | Stage advanced | `→ anchor_acv` etc — is progression happening? |
| `[CAPTURED]` | Field extracted from utterance | `acv=50000` etc — is extraction working? |
| `[EXTRACT]` | Extraction summary | `extractions=0` means nothing found |
| `[MEMORY]` | Qualitative signal written | Objections, buying signals etc |
| `[GEMINI_TTFB]` | Gemini time-to-first-byte | Target <800ms. >2000ms = problem |
| `[GEMINI_USAGE]` | Token counts | `prompt=N` — how big is prompt? |
| `[PROMPT]` | System prompt size | `system_chars=N` — target ~3000-5000 |
| `[BELLA_SAID]` | Gemini response preview | What did Bella actually say? |
| `[WARN]` | State missing mid-call | State TTL expired — session too long |
| `[DEDUP]` | Duplicate turn detected | Deepgram resent same content |
| `[APIFY]` | Apify deep intel landed | Good — intel enriched mid-call |
| `[FALLBACK]` | Name/biz from DG system prompt | Firecrawl may have failed |

---

## Common Failure Patterns

### ❌ Bella speaks but has no business data ("Hi Trent!")

**Symptom:** Generic opener, no business name or intel referenced.

**Diagnosis sequence:**
1. Check `[KV_STATUS]` — is `fast=true`? If `fast=false` → intel never wrote to KV
2. Check `[FALLBACK]` — did bridge fall back to Deepgram system prompt data?
3. Run KV inspection: `lead:{lid}:intel` — is it empty or stub?
4. Check fast-intel tail — did Firecrawl 408?

**Root causes:**
- Firecrawl timed out → ScrapingAnt fallback should catch it
- LID mismatch between funnel and KV writer
- fast-intel wrote to wrong namespace (use `--remote` flag always)

---

### ❌ Bella goes silent / stops responding mid-call

**Symptom:** Call connects, Bella says 1-2 things, then silence.

**Diagnosis sequence:**
1. Check bridge tail for `[GEMINI_ERR]` or `[GEMINI_STREAM_ERR]`
2. Check `[GEMINI_TTFB]` — did it exceed 30s timeout?
3. Check `[WARN]` — did state go missing?
4. Check voice agent tail for WebSocket disconnect events

**Root causes:**
- Gemini timeout (30s hard limit in bridge) → model overloaded
- State TTL expired (14400s) → session somehow exceeded 4 hours
- DEEPGRAM_API_KEY not set on voice agent
- GEMINI_API_KEY not set on bridge

---

### ❌ LID is empty — bridge has no lead data

**Symptom:** `[REQ] lid=` (empty). Bridge uses default fallback state.

**Diagnosis sequence:**
1. Check `[DIAG]` — what is `sys_chars`? If tiny (<50) → voice agent sent hollow prompt
2. Check voice agent code — is it sending `lead_id: {lid}` in the Deepgram `agent.think.prompt`?
3. Check LID format — bridge regex: `/lead[\s_]id\b[\s\w]*?[:=]\s*([a-z0-9][a-z0-9_-]{3,})/i`
   - LID must start with letter or number
   - Must be 4+ chars
   - Allowed: letters, numbers, underscores, hyphens

**Root cause:** Voice agent not injecting LID into Deepgram system prompt.

---

### ❌ Stage machine stuck — Bella keeps asking same question

**Symptom:** Bella repeatedly asks for ACV even after prospect answers.

**Diagnosis sequence:**
1. Check `[EXTRACT]` — is `extractions=0`? Regex not matching utterance.
2. Check `[CAPTURED]` — what field/value was captured?
3. Check `[KV_STATUS]` — `kv_bytes` changing between turns? State saving?
4. Check `[DEDUP]` — is Deepgram resending same turn?

**Root causes:**
- Regex extraction failing for non-standard phrasing (e.g. "bout fifty grand")
- State not persisting — KV write failing silently
- `gateOpen()` conditions not met — check `script_state.inputs` values

---

### ❌ ROI not calculating

**Symptom:** Bella reaches `roi_delivery` but has no numbers.

**Diagnosis sequence:**
1. Read `lead:{lid}:captured_inputs` — are the required fields populated?
2. Read `lead:{lid}:roi` — does the key exist?
3. Check which stage requires which inputs:
   - Alex: `ads_leads` + `ads_conversions`
   - Chris: `web_leads` + `web_conversions`
   - Maddie: `phone_volume` + `after_hours`
   - Sarah: `old_leads`
   - James: `new_cust_per_period` + `star_rating` + `review_count` + `has_review_system`
4. Check `[EXTRACT]` logs — were these fields ever captured?

**Root cause:** Usually extraction regex miss — prospect phrased answer unusually.

---

### ❌ Gemini latency >3s (sluggish Bella)

**Symptom:** Long pauses between prospect speech and Bella response.

**Diagnosis sequence:**
1. Check `[GEMINI_TTFB]` — baseline for current model
2. Check `[GEMINI_USAGE]` — `prompt=N` — how many tokens?
3. Check `[PROMPT]` — `system_chars=N` — is it growing unboundedly?
4. Check if `buildFullSystemContext()` is being called inline (it should cache to `bella_system` KV key — this is an **open gap in V8**)

**Root cause:** `buildFullSystemContext()` currently runs inline every turn (~8-10KB rebuild). 
**Fix (pending):** fast-intel writes `lead:{lid}:bella_system` at init. Bridge reads from KV instead of rebuilding.

---

## Debug Test URL

```
https://claudedemofunnelv5cfsuper.netlify.app/loading-v95.html?lid=anon_v9test_001&web=https%3A%2F%2Fwww.kpmg.com&name=Trent&email=test%40test.com
```

Replace `anon_v9test_001` with a fresh LID for each test to avoid stale state.

---

## Health Check

```bash
curl https://deepgram-bridge-sandbox-v9.trentbelasco.workers.dev/health
# Expected: {"status":"ok","version":"8.0.0","model":"gemini-2.5-flash",...}

curl https://fast-intel-v9.trentbelasco.workers.dev/health
```

---

## Secrets Required (must be set before V8 goes live)

| Worker | Secrets |
|--------|---------|
| `deepgram-bridge-sandbox-v9` | `GEMINI_API_KEY`, `TOOLS_BEARER` |
| `bella-voice-agent-sandbox-v9` | `DEEPGRAM_API_KEY`, `TOOLS_BEARER_TOKEN` |
| `consultant-v9` | `GEMINI_API_KEY` |
| `fast-intel-v9` | `FIRECRAWL_API_KEY`, `GEMINI_API_KEY`, `SCRAPINGANT_KEY` |
| `personalisedaidemofinal-v9` | `APIFY_API_KEY`, `BUILTWITH_API_KEY`, `FIRECRAWL_API_KEY`, `FIRECRAWL_KEY`, `GEMINI_API_KEY`, `GOOGLE_PLACES_API_KEY`, `OUTSCRAPER_API_KEY`, `SCRAPINGANT_KEY` |
| `bella-tools-worker-v9` | `BEARER_TOKEN` |

---

## Known Open Gaps in V8 (do not re-investigate — already documented)

1. **`bella_system` KV cache not implemented** — `buildFullSystemContext()` runs inline every turn. Fix: fast-intel writes `lead:{lid}:bella_system` at call init, bridge reads it.
2. **Frontend still pointing at V6** — loading page and demo page need updating to V8 endpoints after secrets are set and health check passes.
3. **Bearer token naming inconsistency** — `TOOLS_BEARER` / `TOOLS_BEARER_TOKEN` / `BEARER_TOKEN` are three names for the same shared value. Harmless, fix in next major version.

---

## Rules from Trent

1. No unsolicited tests — do not run the funnel unless explicitly asked
2. No changes without per-change approval — state the diff, wait for yes
3. Go slow and systematic — one change, deploy, verify logs, then next
4. Always read wrangler tail after deploy — never assume it worked
5. Never modify V6 or V7 workers — they are rollback points
