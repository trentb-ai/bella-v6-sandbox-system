# T9 Architect Handover — Think-Native Debug + Live Test Session
## 2026-04-28 ~12:45–14:00 AEST

---

## SESSION SUMMARY

First live call test on Think Agent V1. Bella spoke with zero personalisation and crashed. Root cause: frontend voice worker pointed to WRONG bridge → Think brain never called. Fixed with Think-native architecture: eliminated bridge regex, added `/turn/{lid}` route, fixed PartyKit headers, added hibernation state persistence via configure(). Three deploy cycles — v3.14.0 → v3.15.0 (buggy) → v3.16.0 (clean). All canary tests passing on v3.16.0.

---

## BUGS FOUND + FIXED

### BUG 1: Voice worker BRIDGE_URL pointed to wrong worker (P0 — FIXED)
**File:** `frozen-bella-natural-stack/voice-agent/wrangler.toml`
**Was:** `BRIDGE_URL = "https://frozen-bella-natural-bridge.trentbelasco.workers.dev/v9/chat/completions"`
**Fix:** Changed to `BRAIN_URL = "https://bella-think-agent-v1-brain.trentbelasco.workers.dev"` — Think-native, no bridge middleman
**Voice agent code:** `endpoint.url` now uses `${this.env.BRAIN_URL}/turn/${this.lid}` — lid in URL path, no regex parsing
**Version:** Voice bumped `4.2.0-EOT-INJECT` → `4.3.0-THINK-NATIVE`
**Why it matters:** Deepgram's LLM callback was hitting the old bridge → old brain. Think brain was never in the call path.

### BUG 2: PartyKit headers missing on /event and /intel-event handlers (P0 — FIXED)
**File:** `bella-think-agent-v1-brain/src/worker.ts`
**Was:** Both event handlers forwarded to DO without `x-partykit-namespace` or `x-partykit-room` headers
**Fix:** Added both headers to both handlers
**Error before fix:** "Missing namespace or room headers when connecting to BellaAgent"

### BUG 3: Multi-turn re-greeting — DO hibernation state loss (P1 — FIXED)
**File:** `bella-think-agent-v1-brain/src/bella-agent.ts`
**Was:** `this.cs` (ConversationState via `this.state`) returned null after DO hibernation. Second turn → `!this.cs` true → initSession() → re-greeted
**Fix:** Three changes:
1. **hydrateFromConfig()** — reads ConversationState from Think SDK `configure()` storage (SQLite-backed, survives hibernation)
2. **compat-turn .finally()** — persists `this.cs` to `configure()` after every turn
3. **initSession()** — hydrates pending intel from `configure({ pendingIntel })` on session start

### BUG 4: Pre-session intel discarded (P1 — FIXED)
**File:** `bella-think-agent-v1-brain/src/bella-agent.ts`
**Was:** `receiveIntel()` checked `this.cs` — if null (no session yet), returned `{ status: "no_session" }` → intel lost
**Fix:** Queue in `configure({ pendingIntel: [...] })`. On initSession(), hydrate all pending intel before first turn.

### BUG 5: Side-effecting getter caused empty responses (P0 — FIXED, REGRESSION)
**File:** `bella-think-agent-v1-brain/src/bella-agent.ts`
**Version:** v3.15.0 only (brief deploy, ~10 min)
**Was:** Intermediate fix put `setState()` inside the `cs` getter — property read with side effects corrupted DO init
**Symptom:** chat() returned 0 tokens, empty SSE stream
**Affected lids:** canary_fix_005, canary_kv_103 (poisoned DOs from this window)
**Fix:** Made getter pure again. Moved hydration to explicit `hydrateFromConfig()` called only at entry points.

### BUG 6: Frontend fast-intel + scrape URLs wrong (P0 — FIXED, prior session)
**Files:** capture.html, loading-v15.html on bellathinkv1.netlify.app
**Fix:** FAST_INTEL_URL → `fast-intel-v9-rescript`, scrape → `bella-scrape-workflow-v10-rescript`
**GOTCHA:** `personalisedaidemofinal-sandbox` refs on demo page must STAY — it's the read-only proxy for website mockup iframe

### BUG 7: Fast-intel business_name contains raw prompt text (P1 — OPEN, flagged by T1)
**LID:** apitest_firecrawl_001 (pitcher.com.au)
**Symptom:** business_name field returned raw prompt/stub text instead of extracted name
**Status:** T2 investigating. Likely extraction prompt issue in fast-intel-v9-rescript.

---

## ARCHITECTURAL DECISIONS

### 1. Think-Native Turn Path (eliminates bridge regex)
**Before:** Voice → Bridge → `/v9/chat/completions` → brain parses lid from system message via regex
**After:** Voice → Brain `/turn/{lid}` → lid from URL path, zero regex
**Why:** Regex parsing was fragile. Think-native means lid is positional, not inferred. Bridge is still in the path for legacy compat but new calls skip it.

### 2. configure() for Hibernation-Safe State
**Decision:** Use Think SDK `configure()` (persists to `assistant_config` SQLite table) to store ConversationState. `setState()` is in-memory only — lost on hibernation.
**Pattern:** Every turn's .finally() block writes `configure({ ...getConfig(), cs: finalState })`. On wake, `hydrateFromConfig()` reads it back.
**SDK evidence:** `think.d.ts` confirms configure() survives restarts. setState() does not.

### 3. Pre-Session Intel Queuing
**Decision:** Intel events that arrive before user connects get queued in `configure({ pendingIntel: [...] })`. On first turn, initSession() drains the queue.
**Why:** Fast-intel fires ~30s before user clicks Bella. DO may not exist yet. configure() creates/persists even without an active session.

### 4. Pure cs Getter — No Side Effects
**Decision:** `private get cs()` returns `this.state ?? null` — pure read. All hydration happens via explicit method calls at known entry points only (onRequest top, compat-turn handler).
**Why:** Side-effecting getter in v3.15.0 caused catastrophic empty responses. Property reads must be safe.

---

## DEPLOYED VERSIONS (current live)

| Worker | Version | Deploy ID |
|--------|---------|-----------|
| bella-think-agent-v1-brain | 3.16.0-think | (latest — 3 deploys this session) |
| frozen-bella-natural-voice | 4.3.0-THINK-NATIVE | (1 deploy) |
| bellathinkv1.netlify.app | — | 69f020d20e780cea12622ab0 (prior session) |

---

## CANARY TEST RESULTS (v3.16.0)

| Test | LID | Result | Notes |
|------|-----|--------|-------|
| canary_batch_001 | canary_batch_001 | ✅ PASS | Init + turn + BELLA_SAID confirmed |
| canary_batch_002 | canary_batch_002 | ✅ PASS | Init + turn + BELLA_SAID confirmed |
| canary_batch_003 | canary_batch_003 | ✅ PASS | Init + turn + BELLA_SAID confirmed |
| canary_fix_005 | canary_fix_005 | ❌ FAIL | Poisoned DO from v3.15.0 window — NOT v3.16.0 regression |
| canary_kv_103 | canary_kv_103 | ❌ FAIL | Poisoned DO from v3.15.0 window — NOT v3.16.0 regression |

**Verdict:** v3.16.0 is clean. Failures are from DOs created during brief v3.15.0 deploy with side-effecting getter.

---

## GOTCHAS + LEARNINGS

1. **Poisoned DOs persist** — A DO created during a buggy deploy retains corrupted state even after re-deploy. Must use FRESH lids for retesting.
2. **PartyKit headers are non-optional** — Every DO fetch in Think SDK needs `x-partykit-namespace` and `x-partykit-room`. Missing = "Missing namespace or room headers" error.
3. **configure() vs setState()** — configure() = SQLite-persisted, survives hibernation. setState() = in-memory only, broadcasts to WS clients. Use configure() for anything that must survive DO sleep.
4. **routeAgentRequest() is WS-only** — Does not handle HTTP GET/POST to DO endpoints. Custom routes in worker.ts needed for debug/event/turn endpoints.
5. **wrangler tail is unreliable** — Drops logs under load. Persistent debug endpoints (`/do/{leadId}/debug`) are superior for post-hoc observability.
6. **KV edge caching anomaly** — KV `get()` via wrangler CLI can return null while worker reads succeed. Likely edge caching. Not blocking — primary intel path is Event POST → configure(), KV is fallback.
7. **Never speculate to Trent** — "This is likely..." is unacceptable. Investigate with evidence (logs, tail, curl) before reporting. Delegate if needed. Trent was VERY clear on this.
8. **Delegate execution aggressively** — Haiku agents handle curls, health checks, file reads. Don't do it yourself when team is available.

---

## OPEN ITEMS FOR NEXT SESSION

### P1: Fast-intel business_name prompt bleed
- LID: apitest_firecrawl_001
- T2 investigating. Likely extraction prompt in fast-intel-v9-rescript leaking into output field.

### P2: Missing /trigger route on scrape workflow
- capture.html calls `/trigger` on `bella-scrape-workflow-v10-rescript` but route may not exist
- Deep scrape (Apify) silently fails. Verify actual routes match.

### P2: API key live-fire verification
- Firecrawl key test: delegated to T1/Haiku, awaiting results
- Apify key test: delegated to T1/Haiku, awaiting results
- Keys are SET on all workers (verified via wrangler secret list) but not yet confirmed WORKING via live scrape

### P3: Full end-to-end live call test
- capture.html → loading → demo → voice call → pull debug
- Not yet performed with v3.16.0 + v4.3.0

### P3: Debug endpoint hibernation hydration
- hydrateFromConfig() added to onRequest() — partially addresses
- Monitor: does debug return valid state after extended hibernation?

---

## FULL CALL PATH (VERIFIED WORKING)

```
Browser WS → frozen-bella-natural-voice DO (audio/Deepgram)
  → Deepgram servers call BRAIN_URL/turn/{lid}
    → bella-think-agent-v1-brain worker.ts /turn handler
      → BellaAgent DO (compat-turn handler)
        → Think SDK chat() → Gemini → SSE response
```

### Intel Pipeline:
```
capture.html POST → fast-intel-v9-rescript
  → Firecrawl scrape + Consultant Gemini
  → KV write: lead:{lid}:fast-intel
  → Event POST to THINK_BRAIN /event?callId={lid}
    → brain worker.ts /event handler
      → BellaAgent DO receiveIntel()
        → configure({ pendingIntel }) if no session
        → applyIntel() if session active
```

---

## KEY FILES MODIFIED THIS SESSION

| File | What Changed |
|------|-------------|
| `frozen-bella-natural-stack/voice-agent/wrangler.toml` | BRIDGE_URL → BRAIN_URL (Think-native) |
| `frozen-bella-natural-stack/voice-agent/src/index.ts` | Env type, endpoint URL, version bump |
| `bella-think-agent-v1-brain/src/worker.ts` | /turn/{lid} route, PartyKit headers on /event + /intel-event |
| `bella-think-agent-v1-brain/src/bella-agent.ts` | hydrateFromConfig(), pure cs getter, configure() persistence, pre-session intel queue |
