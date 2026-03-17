# BELLA V5 HANDOVER — FOR OPUS
## Date: 2026-03-09 | Status: Voice connects, stuck on "Connecting to Bella…"

---

## SYSTEM OVERVIEW

Bella is a voice AI sales agent (Australian female) that calls business prospects via WebSocket.

```
Browser → Netlify (static) → WS → CF Durable Object (voice agent) → Deepgram Voice Agent API
                                                                            ↓
                                                             BYO LLM Bridge (CF Worker)
                                                                            ↓
                                                                   Gemini 2.5 Flash
```

---

## DEPLOYED WORKERS

| Worker | URL | Version |
|---|---|---|
| Voice Agent DO | bella-voice-agent-sandbox-v9.trentbelasco.workers.dev | v9.9.0 |
| BYO LLM Bridge | deepgram-bridge-sandbox-v9.trentbelasco.workers.dev | v9.3.1 |
| Tools Worker | bella-tools-worker-v9.trentbelasco.workers.dev | — |
| Consultant | consultant-sandbox-v9.trentbelasco.workers.dev | — |
| Scraper/Orch | personalisedaidemofinal-sandbox.trentbelasco.workers.dev | — |
| MCP Worker | leads-mcp-worker-sandbox-v9.trentbelasco.workers.dev | — |

**Netlify site:** claudedemofunnelv5cfsuper.netlify.app
**Netlify folder to drag-deploy:** /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/netlify-funnel-sandbox

**KV Namespace ID:** [REDACTED]
**CF Account ID:** [REDACTED]

---

## SECRETS (all confirmed set)

| Worker | Secret | Value |
|---|---|---|
| bella-voice-agent-sandbox-v9 | DEEPGRAM_API_KEY | [REDACTED] |
| bella-voice-agent-sandbox-v9 | TOOLS_BEARER | [REDACTED] |
| deepgram-bridge-sandbox-v9 | GEMINI_API_KEY | [REDACTED] |
| deepgram-bridge-sandbox-v9 | TOOLS_BEARER | [REDACTED] |
| bella-tools-worker-v9 | BEARER_TOKEN | [REDACTED] |

---

## THE MAIN BUG — "Stuck on Connecting to Bella…"

### Confirmed symptom
Browser console shows:
```
[V3] ws-shim-captured: wss://bella-voice-agent-sandbox-v9...
[BellaV2] connected          ← WS opens fine
[BellaV2] Mic started        ← Mic fine
[BellaV2] ctrl: pipeline_pending  ← Voice agent bails here
```
Then nothing. No `greeting_ready`. No audio. Label stuck forever.

### Root cause chain

**Step 1 — Voice agent intel load fails**
`loadIntelAndConnect()` tries 3 sources in order:
1. MCP worker (`/resolve-intel`) — returns `{success: false}` if no KV data yet
2. KV `lead:{lid}:intel` — may be empty for new leads
3. KV bare `{lid}` key — may be empty

**Step 2 — Null guard fires**
```typescript
const hasMinData = intelSuccess || !!kvIntel || !!intel.business_name || !!this.urlHints.biz;
if (!hasMinData) {
  sendJSON({ type: "pipeline_pending", ... });
  return; // ← bails without opening Deepgram
}
```
This fires when NO data is available at all (incl. no ?biz= URL param).

**Step 3 — Client has no retry**
`bella-voice-client.js` switch statement has no `pipeline_pending` case.
Message is received, falls through to default (nothing), WS closes, label stays stuck.

### Fix already applied (THIS SESSION — needs Netlify drag-deploy)
`bella-voice-client.js` now handles `pipeline_pending`:
```javascript
case 'pipeline_pending':
  setLabel('Analysing your business…', 'Connecting in a moment');
  cleanup();
  setTimeout(() => {
    connecting = false; connected = false;
    startCall(); // retry after 4s
  }, 4000);
  break;
```

### What STILL needs fixing

The underlying issue: voice agent bails before opening Deepgram at all.

**Real fix needed:** Even with no KV intel, the voice agent should open Deepgram with a basic fallback prompt. The `pipeline_pending` + retry loop is a band-aid — it retries but if KV never populates, it loops forever.

**The proper fix:**
In `voice-agent-v9-fresh/src/index.ts`, change the null guard so it ALWAYS proceeds to open Deepgram — using the fallback prompt if no intel:

```typescript
// Current (problematic) — sends pipeline_pending and returns:
if (!hasMinData) {
  sendJSON({ type: "pipeline_pending", ... });
  return;
}

// Should be — always proceed, use fallback:
if (!hasMinData) {
  log("INTEL", "no data — using bare fallback prompt");
  // let it fall through to buildSystemPromptV3 with empty intel
  // the fallback prompt path at line ~466 handles this case
}
```

The fallback prompt path already exists (line ~466-490 in index.ts):
```typescript
} else {
  // Existing simple greeting
  openingText = firstName ? `Hi ${firstName}! I'm Bella.` : `Hi there! I'm Bella.`;
}
```
So removing the early return from the null guard should be enough.

---

## SECONDARY BUG — Bridge may be causing Deepgram drop

Even when intel loads and Deepgram opens, the bridge (BYO LLM) may cause Deepgram to drop the connection.

### What bridge does per turn
1. Parse lid from system message
2. Load KV intel
3. Load/init script state
4. ~~Await~~ extraction Gemini call (NOW fire-and-forget — fixed this session)
5. Advance state machine
6. Build ~200 token lean prompt
7. Stream Gemini response as SSE back to Deepgram

### Bridge fix applied this session
Extraction call is now fire-and-forget (no longer awaited before streaming).
This cuts TTFT from ~3s to ~0.5s.
Deployed: version 48319924 → then re-deployed as current.

### If bridge is still causing drops
Check these in order:
1. Tail bridge logs during a call: `cd voice-agent-v9-fresh && npx wrangler tail deepgram-bridge-sandbox-v9 --format pretty`
2. Look for `[bridge 5.3.1] [REQ]` entries — if absent, bridge isn't being called
3. Look for any errors in the SSE streaming path
4. Deepgram's BYO LLM timeout is ~5s for first chunk. If Gemini 2.5 Flash is slow, switch to `gemini-2.0-flash` in bridge

---

## FILE LOCATIONS

```
/Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/
├── netlify-funnel-sandbox/            ← DRAG THIS TO NETLIFY
│   ├── bella-voice-client.js          ← pipeline_pending handler added (needs deploy)
│   ├── capture.html                   ← fire-and-forget fixed (needs deploy)
│   ├── loading-v95.html               ← MIN_DURATION reduced 20s→8s (needs deploy)
│   ├── demo_v95_hybrid.html           ← main demo page
│   └── assets/
├── voice-agent-v9-fresh/              ← ACTIVE voice agent source
│   └── src/index.ts                   ← null guard on line ~493, fallback on ~466
├── deepgram-bridge-v9/
│   └── src/index.ts                   ← bridge v9.3.1, extraction fire-and-forget
└── ...other workers...
```

---

## WHAT WAS FIXED THIS SESSION

| Fix | File | Status |
|---|---|---|
| Bridge extraction: await→fire-and-forget | deepgram-bridge-v9/src/index.ts | ✅ Deployed CF |
| Voice agent null-guard: added urlHints.biz check | voice-agent-v9-fresh/src/index.ts | ✅ Deployed CF |
| Voice client: pipeline_pending handler + retry | netlify-funnel-sandbox/bella-voice-client.js | ⚠️ Needs Netlify deploy |
| Capture page: no longer awaits scrape | netlify-funnel-sandbox/capture.html | ⚠️ Needs Netlify deploy |
| Loading page: 20s → 8s | netlify-funnel-sandbox/loading-v95.html | ⚠️ Needs Netlify deploy |

**ACTION REQUIRED: Drag netlify-funnel-sandbox to claudedemofunnelv5cfsuper.netlify.app**

---

## QUICK DIAGNOSTICS

```bash
# Health checks
curl https://bella-voice-agent-sandbox-v9.trentbelasco.workers.dev/health
curl https://deepgram-bridge-sandbox-v9.trentbelasco.workers.dev/health
curl https://leads-mcp-worker-sandbox-v9.trentbelasco.workers.dev/health

# Test bridge directly
curl -X POST https://deepgram-bridge-sandbox-v9.trentbelasco.workers.dev/v9/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"system","content":"lead_id: test-123"},{"role":"user","content":"hello"}]}'

# Tail logs (run from voice-agent-v9-fresh dir)
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/voice-agent-v9-fresh
npx wrangler tail bella-voice-agent-sandbox-v9 --format pretty
npx wrangler tail deepgram-bridge-sandbox-v9 --format pretty

# Check KV for a lead
npx wrangler kv key list --namespace-id=0fec6982d8644118aba1830afd4a58cb | head -20
```

---

## CANONICAL PROMPT DOCS
- FINAL BELLA PROMPT: https://docs.google.com/document/d/1dRjTXuiU0nxerNtECERLQ8R89xtlpibYORa36IeMm3k/edit
- CANONICAL BELLA PROMPT PACK: https://docs.google.com/document/d/1XASEAWHR_513uI6Tw0UFMkr64FMrQYR5nd8nvVNjGLQ/edit

---

## PRIORITY ORDER FOR NEXT SESSION

1. **Deploy netlify-funnel-sandbox** to claudedemofunnelv5cfsuper.netlify.app (drag and drop)
2. **Fix null guard in voice agent** — remove the early return, always open Deepgram with fallback
3. **Test full call flow** with a real URL (e.g. pass ?biz=TestBiz&fn=Trent in URL)
4. **Verify bridge is intercepting** — watch for `[bridge 5.3.1] [REQ]` in logs during call
5. **Test pipeline_pending retry** — if intel still missing after retry, investigate scraper
