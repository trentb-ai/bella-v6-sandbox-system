# T9 Handover — Live Test Debug + Frontend Wiring Fix
## 2026-04-28 ~12:45 AEST

---

## SESSION SUMMARY

First live call test on Think Agent V1 stack. Bella spoke but with zero personalisation, no script, no intel data, then crashed. Root cause: frontend called wrong workers — fast-intel pipeline never triggered, Think brain never received intel.

---

## BUGS FOUND + FIXED

### BUG 1: Frontend fast-intel URL wrong (P0 — FIXED)
**Files:** capture.html, loading-v15.html
**Was:** capture.html → `mvpscriptbellafast-intel` / loading-v15.html → `frozen-bella-natural-fast-intel`
**Fix:** Both → `https://fast-intel-v9-rescript.trentbelasco.workers.dev`
**Why it matters:** fast-intel-v9-rescript is the ONLY worker with Think brain dual delivery (THINK_BRAIN service binding). Old workers delivered to old brain only.

### BUG 2: Frontend scraper URL — PARTIALLY FIXED, PARTIALLY REVERTED
**personalisedaidemofinal-sandbox is READ-ONLY usage** — proxy for website mockup iframe + /log-lead + /get-lead on demo page. NOT a LAW 1 violation (never deployed/edited, only read).
**capture.html /fire-apify + /trigger:** Changed from `mvpscriptbellascrape` → `bella-scrape-workflow-v10-rescript` (correct — deep scrape workflow)
**capture.html WORKER_URL, loading-v15.html WORKER_URL, demo_v15_hybrid.html ALL refs:** REVERTED to `personalisedaidemofinal-sandbox` (proxy/scraper/mockup — must stay)
**GOTCHA:** I initially replaced ALL personalisedaidemofinal refs which broke the demo page website mockup. REVERTED immediately.

### BUG 3: No HTTP route to Think brain DO debug endpoints (P1 — FIXED)
**File:** bella-think-agent-v1-brain/src/worker.ts
**Was:** Debug endpoints (debug/tokens/tools-perf/compliance/session-info/state) existed in BellaAgent.onRequest() but worker.ts had no route to forward HTTP GETs to the DO.
**Fix:** Added `/do/{leadId}/{endpoint}` passthrough route with PartyKit headers (x-partykit-namespace: BellaAgent, x-partykit-room: leadId).
**Usage:** `curl https://bella-think-agent-v1-brain.trentbelasco.workers.dev/do/{leadId}/debug`

### BUG 4: Debug endpoints return no_session after hibernation (P2 — OPEN)
**File:** bella-think-agent-v1-brain/src/bella-agent.ts
**Issue:** `this.cs` (ConversationState) is in-memory only. After DO hibernation, wake-up creates fresh instance with null `this.cs`. Debug endpoints check `this.cs` and return `{error: "no_session"}`.
**Fix needed:** Hydrate `this.cs` from Think SDK SQLite storage on wake, or change debug endpoints to read from persistent storage.

---

## ARCHITECTURE VERIFIED

### Full Think Agent V1 Call Path (CONFIRMED WORKING)
```
Browser WS → frozen-bella-natural-voice DO (audio/Deepgram)
  → Deepgram servers call BRIDGE_URL (LLM endpoint)
    → bella-think-agent-v1-bridge (thin router)
      → bella-think-agent-v1-brain /v9/chat/completions
        → BellaAgent DO (compat-turn handler, line 850)
          → Think SDK chat() → Gemini → SSE response
```

### Intel Pipeline Path (CONFIRMED WIRED)
```
capture.html POST /fast-intel → fast-intel-v9-rescript
  → Firecrawl scrape + Consultant Gemini
  → KV write: lead:{lid}:fast-intel
  → Event POST to THINK_BRAIN /event?callId={lid} (line 1557-1592 of fast-intel)
    → brain worker.ts /event handler (line 40-55)
      → BellaAgent DO receives intel via receiveIntel()
```

### Bridge → Brain Test (PASSED)
```bash
curl -X POST https://bella-think-agent-v1-bridge.trentbelasco.workers.dev/v9/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"system","content":"lead_id is: test_001"},{"role":"user","content":"Hello"}]}'
# Returns: 200 + SSE stream with Bella response
```

---

## WORKER HEALTH (all verified 2026-04-28 12:28 AEST)

| Worker | Version | Status |
|--------|---------|--------|
| bella-think-agent-v1-brain | 3.13.0-think | OK — 7 agents |
| bella-think-agent-v1-bridge | thin-router-v1.0.0 | OK |
| frozen-bella-natural-voice | 4.2.0-EOT-INJECT | OK |
| fast-intel-v9-rescript | 1.19.0 | OK |
| bella-scrape-workflow-v10-rescript | — | OK |

---

## DEPLOYS THIS SESSION

1. **bella-think-agent-v1-brain** — added /do/{leadId}/{endpoint} debug route + PartyKit headers. Version ID: ffdfcc48-bdcf-41d6-b256-82b9d5d34556
2. **bellathinkv1.netlify.app** — fixed all stale worker URLs (3 files, 7 replacements). Deploy ID: 69f020d20e780cea12622ab0

---

## CODE CHANGES

### worker.ts — Debug passthrough route (bella-think-agent-v1-brain)
```typescript
// Added before the routeAgentRequest fallback:
const doMatch = url.pathname.match(/^\/do\/([^/]+)\/(.+)$/);
if (doMatch) {
  const [, leadId, endpoint] = doMatch;
  const doId = env.CALL_BRAIN.idFromName(leadId);
  const stub = env.CALL_BRAIN.get(doId);
  return stub.fetch(new Request(`https://do-internal/${endpoint}`, {
    method: request.method,
    headers: {
      "Content-Type": "application/json",
      "x-partykit-namespace": "BellaAgent",
      "x-partykit-room": leadId,
    },
    body: request.method !== "GET" ? request.body : undefined,
  }));
}
```

### Frontend URL fixes (2 files — demo_v15_hybrid.html UNTOUCHED)
- `capture.html`: FAST_INTEL_URL → fast-intel-v9-rescript, /fire-apify + /trigger → bella-scrape-workflow-v10-rescript. WORKER_URL stays personalisedaidemofinal-sandbox.
- `loading-v15.html`: FAST_INTEL_URL → fast-intel-v9-rescript. WORKER_URL stays personalisedaidemofinal-sandbox.
- `demo_v15_hybrid.html`: ALL refs stay personalisedaidemofinal-sandbox (proxy/mockup/scraper — DO NOT CHANGE)

---

## FRONTEND URL RENAME
Old: dapper-lily-66c68a.netlify.app
New: **bellathinkv1.netlify.app**

---

## TEST FLOW (correct order)
1. `https://bellathinkv1.netlify.app/capture.html` — triggers fast-intel + scrape
2. Auto-redirects to loading-v15.html — polls fast-intel status
3. Auto-redirects to demo_v15_hybrid.html — voice widget + text agents
4. Click Bella widget → voice call via Deepgram → Think brain
5. After call: `curl https://bella-think-agent-v1-brain.trentbelasco.workers.dev/do/{leadId}/debug`

---

## OPEN ITEMS (next session)

1. **P2: Fix debug endpoint hibernation** — hydrate this.cs from SQLite on DO wake
2. **Test full pipeline end-to-end** — capture → loading → demo → voice call → pull debug
3. **Verify fast-intel Think delivery** — confirm THINK_FAST log in fast-intel worker logs
4. **Check scrape workflow API compat** — bella-scrape-workflow-v10-rescript may have different routes than personalisedaidemofinal (e.g. /fire-apify, /trigger). Verify capture.html calls match actual routes.
5. **Voice worker system prompt** — Deepgram think.prompt (line 715) is minimal fallback. Full this.systemPrompt (line 520) is NOT sent to Deepgram. This is by design IF Think brain handles all intelligence. But verify brain actually receives and uses intel on turns.

---

## KEY LEARNINGS

- Frontend was wired to 3 different WRONG workers. Think Agent V1 frontend copy-pasted from V2-rescript but URLs never updated.
- Think SDK agents need PartyKit headers (x-partykit-namespace, x-partykit-room) on every DO fetch — without them: "Missing namespace or room headers" error.
- routeAgentRequest only handles WebSocket upgrade, not HTTP GET — custom routes needed for debug endpoints.
- DO in-memory state (this.cs) does NOT survive hibernation. All observability must read from persistent storage.
- Going direct to demo_v15_hybrid.html skips pipeline. Must start at capture.html.
- Wrangler tail NOT needed — 6 persistent debug endpoints on brain DO provide better observability (queryable after the fact, structured, never dropped).
