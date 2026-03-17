# BELLA V5 HANDOVER DOC
## For: Claude Opus (or next session)
## Status: Voice agent connects + speaks. Bridge fails to respond → Deepgram drops connection.

---

## SYSTEM OVERVIEW

Bella is a voice AI sales agent (Australian female) that calls business prospects via WebSocket.

**Architecture:**
```
Browser → WebSocket → CF Durable Object (voice agent) → Deepgram Voice Agent API
                                                              ↓
                                              BYO LLM Bridge (CF Worker)
                                                              ↓
                                                      Gemini 2.5 Flash
```

The bridge is the brain. It owns the script state machine, trigger matrix, calc engine.
Gemini only receives a ~200 token lean prompt per turn — persona + intel + ONE directive.

---

## CURRENT STATE

### What WORKS ✅
- Voice agent connects and speaks (V4 code base, deployed as V5)
- Bridge deploys and responds to direct curl tests
- Scraper pipeline writes intel to KV correctly
- All secrets are set

### What is BROKEN ❌
**The bridge is causing Deepgram to drop the connection.**

When `DG_LLM_PROVIDER = "custom"` + bridge URL is set in Deepgram Settings,
Deepgram calls the bridge for LLM inference. The bridge is not responding in a format
Deepgram accepts → Deepgram closes the WebSocket → browser disconnects silently.

**Symptom in logs:**
```
[INTEL] using structured prompt
[DG] opening WebSocket
Unknown Event - Ok
[CLOSE] browser disconnected
```
"Unknown Event - Ok" = Deepgram sent something the voice agent didn't recognise before closing.

---

## DEPLOYED WORKERS

| Worker | URL | Version |
|---|---|---|
| Voice Agent DO | bella-voice-agent-sandbox-v9.trentbelasco.workers.dev | v9.9.0 (V4 code) |
| BYO LLM Bridge | deepgram-bridge-sandbox-v9.trentbelasco.workers.dev | v9.3.1 |
| Tools Worker | bella-tools-worker-v9.trentbelasco.workers.dev | — |
| Consultant | consultant-sandbox-v9.trentbelasco.workers.dev | — |
| Scraper/Orch | personalisedaidemofinal-sandbox.trentbelasco.workers.dev | — |
| MCP Worker | leads-mcp-worker-sandbox-v9.trentbelasco.workers.dev | — |

**Netlify:** bellademosandbox.netlify.app

**KV Namespace ID:** `[REDACTED]`
**CF Account ID:** `[REDACTED]`

---

## SECRETS (all set)

| Worker | Secret | Value |
|---|---|---|
| bella-voice-agent-sandbox-v9 | DEEPGRAM_API_KEY | [REDACTED] |
| bella-voice-agent-sandbox-v9 | TOOLS_BEARER | [REDACTED] |
| deepgram-bridge-sandbox-v9 | GEMINI_API_KEY | [REDACTED] |
| deepgram-bridge-sandbox-v9 | TOOLS_BEARER | [REDACTED] |
| bella-tools-worker-v9 | BEARER_TOKEN | [REDACTED] |

---

## THE EXACT PROBLEM TO FIX

### What Deepgram expects from a BYO LLM bridge

Deepgram's `custom` LLM provider calls the bridge URL as an OpenAI-compatible
chat completions endpoint. It sends:

```json
{
  "model": "gemini-2.5-flash",
  "messages": [...conversation history...],
  "stream": true
}
```

It expects back a **Server-Sent Events stream** in OpenAI format:
```
data: {"id":"x","object":"chat.completion.chunk","model":"x","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}
data: {"id":"x","object":"chat.completion.chunk","model":"x","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}
data: [DONE]
```

### What the bridge currently does

The bridge (v5.3.1) is a full orchestrator. On each request it:
1. Parses the `lid` from the system message
2. Loads intel from KV
3. Loads/inits script state from KV
4. Runs extraction on last prospect utterance (separate Gemini call)
5. Advances state machine
6. Builds a lean ~200 token prompt
7. Streams Gemini response back

The bridge DOES return SSE. Direct curl test works:
```bash
curl -X POST https://deepgram-bridge-sandbox-v9.trentbelasco.workers.dev/v9/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"system","content":"lead_id: test"},{"role":"user","content":"hello"}]}'
# Returns valid SSE ✅
```

### Suspected causes of failure

1. **Response latency** — the bridge does 2 Gemini calls per turn (extraction + main).
   Deepgram may have a tight timeout on its BYO LLM endpoint (~3-5s?).
   The extraction call adds ~1-2s before the stream even starts.
   **Fix: Make extraction async/fire-and-forget. Start streaming Gemini immediately.**

2. **SSE format mismatch** — Deepgram may require specific headers or chunk format.
   The bridge uses `text/event-stream` with standard OpenAI chunk format.
   Might need `Transfer-Encoding: chunked` or specific CORS headers.

3. **First chunk latency** — Gemini 2.5 Flash has a cold start. If TTFT > Deepgram's
   timeout, it closes the connection before the first token arrives.
   **Fix: Use gemini-2.0-flash for lower latency, or pre-warm.**

4. **`lid` extraction failing** — if the bridge can't find lid in system message,
   it falls through to a default state and may error silently.

---

## FILE LOCATIONS

```
/Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/
├── voice-agent-v9-fresh/          ← ACTIVE voice agent (V4 code as V5)
│   └── src/index.ts               ← Line 720: bridge URL injected here
├── deepgram-bridge-v9/
│   └── src/index.ts               ← The bridge (v5.3.1) — this is what needs fixing
├── bella-tools-worker-v9/
│   └── src/index.ts
├── consultant-sandbox/
│   └── worker.js
├── netlify-funnel-sandbox/
│   ├── bella-voice-client.js      ← Line 19: AGENT_BASE URL
│   └── demo_v95_hybrid.html
└── workers-sandbox/
    └── sandbox_personalisedaidemofinal.js  ← Scraper/orchestrator
```

---

## KV DATA SCHEMA

Scraper writes intel to: `lead:{lid}:intel`

Structure:
```json
{
  "first_name": "Trent",
  "core_identity": {
    "business_name": "Charltons",
    "industry": "...",
    "location": "..."
  },
  "consultant": {
    "scriptFills": {
      "hero_header_quote": "...",
      "website_positive_comment": "...",
      "icp_guess": "...",
      "reference_offer": "...",
      "campaign_summary": "..."
    }
  },
  "flags": {
    "is_running_ads": true
  },
  "website_health": {
    "google_rating": 4.8,
    "review_count": 127
  }
}
```

Bridge reads `lead:{lid}:intel` and `lead:{lid}:script_state`.

The `lid` is passed in the Deepgram system prompt as: `lead_id: {lid}`
It's also in the WebSocket URL: `/agents/bella-agent/{lid}`

---

## THE BRIDGE ARCHITECTURE (v5.3.1)

The bridge is the core innovation. Keep it. Just fix the latency/format issue.

**State machine stages (in order):**
`wow` → `anchor_acv` → `anchor_timeframe` → channel stages → `roi_delivery` → `close`

**Channel stages** (only triggered ones from intel flags):
`ch_ads` → `ch_website` → `ch_phone` → `ch_old_leads` → `ch_reviews`

**Per-turn flow:**
1. Parse lid from system message
2. Load KV intel (cached after first turn)
3. Load script state (KV: `lead:{lid}:script_state`)
4. Run extraction on prospect's last utterance → update inputs
5. Check gate conditions → advance stage if complete
6. Build lean prompt (~200 tokens: persona + intel + ONE directive)
7. Replace system message with lean prompt
8. Stream to Gemini, pipe back to Deepgram

**Calc engine** — hardcoded TypeScript, runs when stage = `roi_delivery`:
- Alex: `conversions × uplift_rate × acv / 52` (uplift by speed: >24h=3.91x etc)
- Chris: `web_conversions × 0.23 × acv / 52`
- Maddie: `missed_calls × call_conversion × acv / 52`
- Sarah: `old_leads × 0.05 × acv / 52`
- James: `new_cust × acv × 0.09 / 52` (directional)

---

## RECOMMENDED FIX

**Option A (quickest): Make extraction fire-and-forget**

Don't await the extraction Gemini call before streaming.
Fire it, update KV async, stream the main response immediately.
This cuts TTFT from ~3s to ~0.5s.

```typescript
// Instead of:
const items = await extract(utt, stage, env);
s = await applyExtracted(items, s, lid, env);

// Do:
extract(utt, stage, env).then(items => applyExtracted(items, s, lid, env)).catch(() => {});
// Then immediately build prompt and stream
```

**Option B: Diagnose Deepgram's exact timeout**

Add a `/ping` endpoint to the bridge that responds in <100ms with a valid SSE chunk.
Point Deepgram at it temporarily to confirm the format is correct.
Then re-enable the full bridge logic.

**Option C: Hybrid — keep V4 prompt for now, add bridge as enrichment later**

Revert `DG_LLM_PROVIDER` to `open_ai` + `gpt-4.1-mini` (V4 config).
Voice works reliably. Bridge runs separately as a prompt-enrichment service
that just writes a better system prompt to KV before the call connects.
Then switch to bridge LLM once latency is resolved.

---

## QUICK TEST COMMANDS

```bash
# Test bridge directly
curl -X POST https://deepgram-bridge-sandbox-v9.trentbelasco.workers.dev/v9/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"system","content":"lead_id: test-123"},{"role":"user","content":"hello"}]}'

# Check bridge health
curl https://deepgram-bridge-sandbox-v9.trentbelasco.workers.dev/health

# Check voice agent health
curl https://bella-voice-agent-sandbox-v9.trentbelasco.workers.dev/health

# Watch logs
npx wrangler tail bella-voice-agent-sandbox-v9 --format pretty
npx wrangler tail deepgram-bridge-sandbox-v9 --format pretty

# Check KV for a lead
npx wrangler kv key list --namespace-id=0fec6982d8644118aba1830afd4a58cb
```

---

## ROLLBACK TO V4 VOICE (if needed)

```bash
# In bella-voice-client.js line 19, change:
# wss://bella-voice-agent-sandbox-v9.trentbelasco.workers.dev
# back to:
# wss://antigrav-bella-voice-agent-v9-sandbox.trentbelasco.workers.dev
# Then redeploy Netlify
```

---

## CANONICAL PROMPT SOURCE OF TRUTH

The full canonical Bella prompt is in two Google Docs:
- FINAL BELLA PROMPT: https://docs.google.com/document/d/1dRjTXuiU0nxerNtECERLQ8R89xtlpibYORa36IeMm3k/edit
- CANONICAL BELLA PROMPT PACK: https://docs.google.com/document/d/1XASEAWHR_513uI6Tw0UFMkr64FMrQYR5nd8nvVNjGLQ/edit

The bridge `buildLeanPrompt()` function is canonically aligned to these docs.
Every directive uses exact approved question phrasing from the source of truth.

---

## PRIORITY ORDER

1. Fix bridge latency (fire-and-forget extraction) → test connection
2. If still failing, test Option C (revert to OpenAI, use bridge as pre-call enrichment)
3. Verify KV intel is flowing through to Bella's prompts
4. Test full call: WOW → ACV → timeframe → channels → ROI → close
