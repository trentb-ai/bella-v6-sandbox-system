# BELLA V9 Comprehensive Bug Report — v9.13.2 Post-Deploy Test
**Date:** 2026-03-19
**Test LID:** `anon_h7qy7c4i`
**Test URL:** `https://www.leadingadvice.com.au`
**Test Name:** `Trent` (passed via `?fn=Trent`)
**Workers Under Test:** bridge v9.13.2, fast-intel v1.8.0, consultant-v8, voice-agent v4.0.2-SUPERGOD, deep-scrape-workflow

---

## EXECUTIVE SUMMARY

Two P0 bugs cause Bella to fail the most critical moment of any sales call — the first 10 seconds. She does not know the prospect's name ("Hi there" instead of "Hi Trent") and she refers to the wrong business ("Trusted Financial Advisors Sydney" instead of "Leading Advice"). Both bugs are independently fixable with targeted code changes. No architectural rework required.

---

## BUG 1: Voice Agent Cannot Read URL Query Parameters — Bella Doesn't Know Prospect's Name

### 1.1 Symptom
Bella greeted with **"Hey there, I'm Bella, welcome to your personalised AI opportunity audit"** instead of **"Hey Trent, I'm Bella..."** despite the demo page URL containing `?fn=Trent`.

### 1.2 Raw Log Evidence

**Voice agent tail (`bella-voice-agent-sandbox-v8`):**
```
[BellaV4 4.0.2-SUPERGOD] [CONNECT] lid="anon_h7qy7c4i"
[BellaV4 4.0.2-SUPERGOD] [CONNECT] NO url hints — reqUrl=null biz="" fn=""
```

The `reqUrl=null` is the smoking gun. The DO received zero URL parameters.

### 1.3 Full Data Flow Trace (How `fn` Should Reach Bella)

```
BROWSER (demo_v15_hybrid.html)
  └─ bella-voice-client.js line 28-34:
       Reads ?fn=Trent from demo page URL → stores in _scrapeFn
  └─ bella-voice-client.js line 110-117:
       Builds WebSocket URL:
       wss://bella-voice-agent-sandbox-v8.trentbelasco.workers.dev
         /agents/bella-agent/anon_h7qy7c4i?fn=Trent&biz=...
  └─ new WebSocket(url) — browser sends HTTP Upgrade request with full URL + query params

EDGE WORKER (voice-agent-v9/src/index.ts line 962-988)
  └─ default export fetch(request) receives request with FULL URL including ?fn=Trent
  └─ Passes directly to routeAgentRequest(request, env) — CF Agents SDK
  └─ SDK routes to Durable Object, upgrades to WebSocket

DURABLE OBJECT (BellaAgent.onConnect line 225-263)
  └─ line 242: const reqUrl = (connection.request?.url) ? new URL(connection.request.url) : null;
  └─ connection.request?.url is NULL ← BUG IS HERE
  └─ All urlHints default to ""
  └─ fn="" → greeting says "Hey there" instead of "Hey Trent"
```

### 1.4 Root Cause Analysis

The `BellaAgent` class extends `Agent` from the Cloudflare `agents` SDK (`import { Agent, routeAgentRequest } from "agents"`). The SDK internally handles:
1. Routing the HTTP request to the correct Durable Object
2. Upgrading the HTTP connection to WebSocket
3. Calling `onConnect(connection)` with the WebSocket connection object

**The `connection` parameter in `onConnect` is a server-side WebSocket object, NOT an HTTP Request.** The `.request` property on this object is either:
- Not populated by the Agents SDK at all
- Populated with an internal DO-relative URL that has no query params
- Lost during the WebSocket upgrade/hibernation handshake

The code at line 242 assumed `connection.request.url` would contain the original browser WebSocket URL with all query params. **This assumption is incorrect** — the Agents SDK does not guarantee passing the original request URL through to the WebSocket connection object.

### 1.5 Why the Fallback Also Failed

There are TWO fallback paths that could have saved the name. Both failed:

**Fallback 1 — KV intel (line 359):**
```typescript
if (!intel.first_name && (kvIntel.firstName || kvIntel.first_name))
  intel.first_name = kvIntel.firstName || kvIntel.first_name;
```
**Why it failed:** The voice agent WebSocket connects ~2s after page load. The fast-intel KV write (`lead:{lid}:fast-intel` with `first_name: "Trent"`) doesn't complete until ~10s after the POST. KV data simply isn't ready yet.

**Fallback 2 — MCP worker (line 328-343):**
```typescript
const res = await fetch(`${this.env.MCP_WORKER_URL}/resolve-intel`, { ... });
```
**Why it failed:** MCP reads from the same KV namespace. Same timing problem — no data written yet.

### 1.6 Solution — Override `fetch()` to Capture URL Before SDK Handles It

The edge worker `fetch()` at line 962 receives the full HTTP request with all query params intact. The fix is to intercept the request before `routeAgentRequest` and embed the params in a way the DO can read them.

**Implementation — voice-agent-v9/src/index.ts:**

**Step 1: Add a private field to BellaAgent to receive params before onConnect:**

At line 212, add:
```typescript
private _pendingUrlHints: { biz: string; ind: string; serv: string; loc: string; fn: string } | null = null;
```

**Step 2: Override the DO's `fetch()` to capture params before WebSocket upgrade:**

Add this method to the `BellaAgent` class (e.g., after `onStart()` at line 223):

```typescript
// Intercept the incoming HTTP request BEFORE the Agents SDK upgrades to WebSocket.
// connection.request.url is unreliable in onConnect — the SDK may strip query params
// during the WebSocket upgrade. Capture them here where the full URL is guaranteed.
async fetch(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    this._pendingUrlHints = {
      biz:  url.searchParams.get('biz') ?? "",
      ind:  url.searchParams.get('ind') ?? "",
      serv: url.searchParams.get('serv') ?? "",
      loc:  url.searchParams.get('loc') ?? "",
      fn:   url.searchParams.get('fn') ?? "",
    };
  } catch {
    this._pendingUrlHints = null;
  }
  return super.fetch(request);
}
```

**Step 3: In `onConnect()`, prefer `_pendingUrlHints` over `connection.request.url`:**

Replace lines 240-251 with:

```typescript
// Read scraped data hints from URL params — set by loading page redirect
// _pendingUrlHints is captured in fetch() before WebSocket upgrade (reliable).
// connection.request.url is a fallback (unreliable — SDK may strip params).
if (this._pendingUrlHints && (this._pendingUrlHints.biz || this._pendingUrlHints.fn)) {
  this.urlHints = this._pendingUrlHints;
} else {
  const reqUrl = (connection.request?.url) ? new URL(connection.request.url) : null;
  this.urlHints = {
    biz:  reqUrl?.searchParams.get('biz') ?? "",
    ind:  reqUrl?.searchParams.get('ind') ?? "",
    serv: reqUrl?.searchParams.get('serv') ?? "",
    loc:  reqUrl?.searchParams.get('loc') ?? "",
    fn:   reqUrl?.searchParams.get('fn') ?? "",
  };
}
this._pendingUrlHints = null; // consumed — clear for next connection

if (this.urlHints.biz || this.urlHints.fn)
  log("CONNECT", `url hints: biz="${this.urlHints.biz}" fn="${this.urlHints.fn}"`, t0);
else
  log("CONNECT", `NO url hints — biz="${this.urlHints.biz}" fn="${this.urlHints.fn}"`, t0);
```

### 1.7 Impact of Fix

| Before | After |
|--------|-------|
| `fn=""` always, greeting = "Hey there" | `fn="Trent"`, greeting = "Hey Trent" |
| `biz=""` always, business unknown to greeting | `biz="Leading Advice"` (from loading page scrape) |
| Deepgram prompt says `prospect_first_name: "unknown"` | Deepgram prompt says `prospect_first_name: "Trent"` |

### 1.8 Files to Modify
- `voice-agent-v9/src/index.ts` — Add `_pendingUrlHints` field (line 212), add `fetch()` override (after line 223), modify `onConnect()` param extraction (lines 240-251)

### 1.9 Deploy Command
```bash
cd /Users/trentbelasco/Desktop/BELLA_V9_SANDBOX_COMPLETE_SYSTEM/voice-agent-v9
npx wrangler deploy --config /Users/trentbelasco/Desktop/BELLA_V9_SANDBOX_COMPLETE_SYSTEM/voice-agent-v9/wrangler.toml
npx wrangler secret list --name bella-voice-agent-sandbox-v8
```

### 1.10 Verification
Tail the voice agent and look for:
```
[CONNECT] url hints: biz="Leading Advice" fn="Trent"
[INTEL] audit welcome (firstName=Trent biz=Leading Advice)
```
Instead of:
```
[CONNECT] NO url hints — reqUrl=null biz="" fn=""
```

---

## BUG 2: Full Consultant Hallucinating Business Name — Overwrites Correct Fast Result

### 2.1 Symptom
Bella referred to the business as **"Trusted Financial Advisors Sydney"** throughout the entire call. The correct name is **"Leading Advice"**.

### 2.2 Raw Log Evidence

**Consultant tail (`consultant-v8`):**
```
[Consultant] /fast done in 2704ms biz=Leading Advice          ← CORRECT
[Consultant] Success with gemini-2.5-flash
[Consultant] stage_plan written lid=anon_h7qy7c4i stages=3    ← Full consultant finished (name not logged)
```

**Fast-intel tail (`fast-intel-v8`):**
```
[CONSULTANT_FAST] Done in 2801ms name=Leading Advice           ← CORRECT
[CONSULTANT_FULL] Done in 19043ms                              ← Name not logged — but it returned "Trusted Financial Advisors Sydney"
[PLACES] MATCH "Financial Spectrum" rating=4.9 reviews=65 score=2 verified=false
[KV] Written lid=anon_h7qy7c4i biz="Trusted Financial Advisors Sydney" fn="Trent" 38248 bytes  ← WRONG NAME IN KV
```

### 2.3 Full Data Flow Trace

```
FAST-INTEL WORKER (fast-intel-sandbox-v9/src/index.ts)

  ┌─ Promise.all fires BOTH consultants in parallel:
  │
  ├─ callFastConsultant (line 656) → consultant-v8 /fast endpoint
  │    Model: gemini-2.5-flash, temp 0.5
  │    Input: nav items + post-H1 slice (4000 chars) + name cross-ref signals
  │    Prompt: 30 lines, 6-field JSON output, focused on brand identification
  │    Instruction: "Cross-reference ALL name signals (og:site_name, JSON-LD, footer, domain, copy)"
  │    Result: { correctedName: "Leading Advice" } ← CORRECT in 2.8s
  │    Side effects:
  │      → fires Apify early with name "Leading Advice"
  │      → writes KV starter (lead:{lid}:fast-intel) with business_name: "Leading Advice"
  │
  └─ callConsultant (line 684) → consultant-v8 / (root) endpoint
       Model: gemini-2.5-flash → gemini-2.0-flash fallback chain, temp 0.7/0.6
       Input: ENTIRE page content (40k chars) + full payload JSON stringify
       Prompt: 293 lines, 30+ field JSON output, full business analysis
       Instruction: "PAGE CONTENT is the MOST RELIABLE source" (LENS 5, line 462)
       Result: { businessIdentity: { correctedName: "Trusted Financial Advisors Sydney" } } ← WRONG in 19s

  MERGE (line 691):
    consultant = fullResult ?? fastResult;
    // Full result is non-null → it COMPLETELY REPLACES fast result
    // correctedName is now "Trusted Financial Advisors Sydney"

  RESOLVE (line 697):
    resolvedBizName = consultant.businessIdentity.correctedName
    // = "Trusted Financial Advisors Sydney"

  KV WRITE (line 735-737):
    core_identity.business_name = resolvedBizName
    // "Trusted Financial Advisors Sydney" persisted to KV → bridge reads this → Bella uses it
```

### 2.4 Root Cause Analysis

**Two independent failures compound into the wrong name:**

**Failure A — Full consultant hallucination:**
The full consultant's Gemini prompt (293 lines, LENS 5 at line 453-466) explicitly instructs: "page content is the authority over domain/tags." For `leadingadvice.com.au`, the page content is heavily financial-planning focused — services like superannuation, investment strategy, retirement planning. Gemini interpreted the broader content as a generic financial advisory practice rather than identifying the specific brand "Leading Advice" which appears in the header/logo area.

The fast consultant avoided this because:
- It only receives the **header area** (nav items + first 4000 chars post-H1) where "Leading Advice" branding is prominent
- It receives explicit **name cross-reference signals** (og:site_name, JSON-LD, footer copyright) via the `nameSignals` object
- Its prompt is simpler — 30 lines focused on brand identification, not full business analysis

**Failure B — Unconditional full-over-fast merge:**
```typescript
// Line 691:
consultant = fullResult ?? fastResult;
```
This is a blanket preference. If `fullResult` is non-null (even with a wrong name), it replaces `fastResult` entirely. There is zero cross-validation between the two results.

### 2.5 Why This Will Recur

The full consultant's prompt tells Gemini to prioritize page content over domain/metadata for name extraction. This is correct for ambiguous domains (e.g., `mercury.com` could be Mercury Insurance or Mercury Financial) but catastrophically wrong for sites where:
- The brand name differs from the industry description in the body copy
- The homepage copy is service-focused rather than brand-focused
- The actual brand is small/subtle and the content reads generically

This will happen again for any business where the brand name isn't repeated heavily throughout the body copy.

### 2.6 Solution — Fast Consultant Is Name Authority, Full Consultant Is Analysis Authority

The fast consultant is purpose-built for rapid brand identification with cross-reference signals. The full consultant is purpose-built for deep business analysis. **The name should always come from the fast consultant.** The full consultant's name should only be used as a fallback when the fast consultant fails.

**Implementation — fast-intel-sandbox-v9/src/index.ts:**

Replace lines 689-697 with:

```typescript
    // ── Merge consultant results ─────────────────────────────────────────────
    // FAST consultant is the authority on BUSINESS NAME (purpose-built for brand
    // identification: reads header area + cross-references og:site_name, JSON-LD,
    // footer copyright, domain). FULL consultant is the authority on everything
    // else (stage plan, ICP, pain points, routing, conversation hooks, etc.).
    //
    // If full consultant returns a different name, it's likely a hallucination
    // from interpreting generic page content as the business identity.
    consultant = fullResult ?? fastResult;

    // Preserve fast consultant's correctedName — it has dedicated name signals
    // that the full consultant doesn't receive
    if (fastResult?.correctedName && consultant?.businessIdentity) {
      const fastName = fastResult.correctedName;
      const fullName = consultant.businessIdentity.correctedName ?? "";
      if (fastName.toLowerCase() !== fullName.toLowerCase()) {
        log("CONSULTANT_MERGE", `Name mismatch: fast="${fastName}" full="${fullName}" — using fast`);
      }
      consultant.businessIdentity.correctedName = fastName;
    }
  }

  // Consultant is the authority on business identity — fast consultant for name,
  // full consultant for everything else
  const bi = consultant?.businessIdentity ?? {};
  const resolvedBizName = bi.correctedName || scrapedBizName;
```

**Also add logging to the full consultant return to capture the name for debugging (line 684-687):**

Replace:
```typescript
      callConsultant(fullPayload, env).then(r => {
        log("CONSULTANT_FULL", `Done in ${Date.now() - t2}ms`);
        return r;
      }),
```

With:
```typescript
      callConsultant(fullPayload, env).then(r => {
        log("CONSULTANT_FULL", `Done in ${Date.now() - t2}ms name=${r?.businessIdentity?.correctedName ?? "?"}`);
        return r;
      }),
```

### 2.7 Impact of Fix

| Before | After |
|--------|-------|
| Full consultant name overwrites fast: "Trusted Financial Advisors Sydney" | Fast consultant name preserved: "Leading Advice" |
| Wrong name in KV → wrong name in bridge → wrong name spoken by Bella | Correct name in KV → correct name in bridge → correct name spoken |
| Full consultant deep analysis (ICP, routing, hooks, stage plan) still used | Same — no change to analysis quality |

### 2.8 Files to Modify
- `fast-intel-sandbox-v9/src/index.ts` — Lines 684-697 (consultant merge logic + logging)

### 2.9 Deploy Command
```bash
cd /Users/trentbelasco/Desktop/BELLA_V9_SANDBOX_COMPLETE_SYSTEM/fast-intel-sandbox-v9
npx wrangler deploy --config /Users/trentbelasco/Desktop/BELLA_V9_SANDBOX_COMPLETE_SYSTEM/fast-intel-sandbox-v9/wrangler.toml
npx wrangler secret list --name fast-intel-v8
```

### 2.10 Verification
Tail fast-intel and look for:
```
[CONSULTANT_FAST] Done in 2801ms name=Leading Advice
[CONSULTANT_FULL] Done in 19043ms name=Trusted Financial Advisors Sydney
[CONSULTANT_MERGE] Name mismatch: fast="Leading Advice" full="Trusted Financial Advisors Sydney" — using fast
[KV] Written lid=anon_h7qy7c4i biz="Leading Advice"
```

---

## BUG 3 (MINOR): Google Places Matching Wrong Business

### 3.1 Symptom
Google Places returned **"Financial Spectrum - Financial Planners Sydney"** (rating 4.9, 65 reviews) for a search that should have matched **"Leading Advice"**.

### 3.2 Log Evidence
```
[PLACES] MATCH "Financial Spectrum - Financial Planners Sydney" rating=4.9 reviews=65 score=2 verified=false (618ms)
```

### 3.3 Analysis
The `crossRefGooglePlaces()` function searches Places Text Search API with the business name + location. For "Leading Advice" (a generic-sounding name in the financial planning space), Google returned a different financial planner that ranks higher in Sydney.

**The safety net worked:** `verified=false` (score=2 is below the verification threshold) meant the wrong Places name did NOT overwrite the consultant's name. The `places` data was still attached to the KV envelope for rating/review enrichment, but the business name was correctly left alone.

### 3.4 Recommendation
No code change required — the verification threshold correctly prevented a bad overwrite. However, consider:
- Passing the domain URL to the Places search query for better matching (e.g., search `"Leading Advice" site:leadingadvice.com.au`)
- Increasing the verification score threshold if false positives become common
- Adding the domain's hostname as a cross-ref signal to the name matching algorithm

This is a **P2 — Nice to have**, not blocking.

---

## WHAT WORKED CORRECTLY IN THIS TEST

| Component | Status | Evidence |
|-----------|--------|----------|
| `adsOn` flat-path fallback (bridge v9.13.2) | WORKING | Stalls advanced past gate correctly, `adsOn=true` |
| `shortBizName()` stop-word guard (bridge v9.13.2) | WORKING | No "Let" or single-word stop-word names |
| Tag stripping in `stripApologies()` | WORKING | No `<tag>` leaks in Bella's speech |
| Google Places cross-ref (fast-intel v1.8.0) | WORKING | Fired, matched, correctly rejected bad match (verified=false) |
| Apify early fire from fast consultant | WORKING | `[APIFY_EARLY_OK]` fired with correct LID |
| KV starter write | WORKING | 1404 bytes written immediately after fast consultant |
| Deep scrape workflow trigger | WORKING | `[BIG_SCRAPER_TRIGGER]` fired with correct payload |
| Fast consultant name extraction | WORKING | "Leading Advice" correctly identified in 2.8s |
| Dedup hard gate (bridge) | WORKING | No duplicate turns |
| WOW stall advancement | WORKING | Stalls progressed normally |

---

## IMPLEMENTATION PRIORITY AND ORDER

| # | Bug | Severity | Fix Complexity | Est. Lines Changed | Deploy |
|---|-----|----------|----------------|--------------------|--------|
| 1 | BUG 2: Consultant name overwrite | P0 | Low | ~15 lines in fast-intel | fast-intel v1.9.0 |
| 2 | BUG 1: Voice agent firstName | P0 | Medium | ~30 lines in voice-agent | voice-agent v4.0.3 |

**Do Bug 2 first** — it's simpler, faster to deploy, and affects both the voice agent greeting AND all bridge turns (the business name propagates everywhere). Bug 1 only affects the greeting.

After both deploys, **delete all KV keys for the test LID** and re-test with a fresh LID:
```bash
for suffix in fast-intel script_state conv_memory bridge_system captured_inputs stub intel deepIntel deep_flags ""; do
  key="lead:anon_NEW_LID:${suffix}"
  [ -z "$suffix" ] && key="anon_NEW_LID"
  echo "y" | npx wrangler kv key delete "$key" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote 2>/dev/null
done
```

---

## DEPLOY CHECKLIST

- [ ] Bump fast-intel VERSION to "1.9.0" with comment: "Fix: fast consultant is name authority, full consultant name merge"
- [ ] Apply consultant merge fix (Section 2.6) to `fast-intel-sandbox-v9/src/index.ts`
- [ ] Deploy fast-intel: `npx wrangler deploy --config .../fast-intel-sandbox-v9/wrangler.toml`
- [ ] Verify secrets: `npx wrangler secret list --name fast-intel-v8`
- [ ] Bump voice-agent VERSION to "4.0.3" with comment: "Fix: capture URL params in fetch() before WebSocket upgrade"
- [ ] Add `_pendingUrlHints` field and `fetch()` override (Section 1.6) to `voice-agent-v9/src/index.ts`
- [ ] Modify `onConnect()` param extraction (Section 1.6) in `voice-agent-v9/src/index.ts`
- [ ] Deploy voice-agent: `npx wrangler deploy --config .../voice-agent-v9/wrangler.toml`
- [ ] Verify secrets: `npx wrangler secret list --name bella-voice-agent-sandbox-v8`
- [ ] Delete stale KV data for test LID
- [ ] Test with fresh LID on a known business (e.g., `leadingadvice.com.au` with `fn=Trent`)
- [ ] Verify in voice-agent tail: `url hints: biz="Leading Advice" fn="Trent"`
- [ ] Verify in fast-intel tail: `biz="Leading Advice"` (not "Trusted Financial Advisors Sydney")
- [ ] Verify Bella's greeting says "Hey Trent" and refers to "Leading Advice"
