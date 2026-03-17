# BELLA V6 — CLAUDE CODE HANDOVER
**Date:** 2026-03-11 | **Prepared by:** Claude (claude.ai session)
**Status:** System functional but KV data quality is broken end-to-end. Full audit required.

---

## YOUR MISSION
Perform a complete audit and fix of the Bella V6 voice agent data pipeline.
The system speaks to prospects but delivers generic/wrong information because:
1. KV data has `business_name: "Home"` baked into multiple sub-fields
2. The bridge prompt builder reads from poisoned sub-fields, not the corrected top-level field
3. Several KV fields are contradictory or missing
4. The bella_opener stored in KV contains "Home" verbatim and gets read aloud

---

## ARCHITECTURE OVERVIEW

```
Browser → voice-agent-sandbox-v9 (Durable Object)
              ↓ reads KV intel on connect
              ↓ builds 23k char system prompt
              ↓ opens WebSocket to Deepgram
                    ↓ every user turn → POST to bridge
                          deepgram-bridge-sandbox-v9
                              ↓ reads KV every turn (stage-aware)
                              ↓ builds lean stage prompt
                              ↓ calls Gemini API (streams back)
```

**Workers:**
| Worker | URL | Local path |
|--------|-----|-----------|
| `bella-voice-agent-sandbox-v9` | https://bella-voice-agent-sandbox-v9.trentbelasco.workers.dev | `voice-agent-v9/src/index.ts` |
| `deepgram-bridge-sandbox-v9` | https://deepgram-bridge-sandbox-v9.trentbelasco.workers.dev | `deepgram-bridge-v9/src/index.ts` |
| `fast-intel-sandbox` | https://fast-intel-sandbox.trentbelasco.workers.dev | `fast-intel-sandbox/src/index.ts` |
| `consultant-sandbox-v9` | (service binding from fast-intel) | `consultant-v9/worker.js` |

**KV Namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`

**Test lead:** `anon_ni3i8fqd` — pitcher.com.au (Pitcher Partners Sydney, accounting firm)

---

## THE KV DATA STRUCTURE (key: `lead:{lid}:intel`)

The KV intel object has a layered structure. Here's the full shape with current data quality:

```
TOP LEVEL (written by phase_a scraper - mostly CORRECT)
├── business_name: "Pitcher Partners Sydney"  ✅ CORRECT
├── star_rating: "5"                          ✅ CORRECT
├── review_count: "29"                        ✅ CORRECT
├── location: "Darling Park, Level 16..."     ✅ CORRECT
├── logo_url: "https://logo.clearbit.com/..." ✅ CORRECT
├── is_running_ads: false                     ✅
├── google_ads_running: false                 ✅ (top-level)
├── facebook_ads_running: false               ✅
├── firstName / first_name: "Trent"           ✅
└── websiteUrl: "https://www.pitcher.com.au"  ✅

core_identity (written by fast-intel scraper - BROKEN)
├── business_name: "Home"                     ❌ WRONG (page title bug)
├── industry: "real estate"                   ❌ WRONG (Pitcher Partners = accounting/advisory)
├── location: ""                              ❌ EMPTY
├── phone: ""                                 ❌ EMPTY
├── tagline: ""                               ❌ EMPTY
└── model: "B2C"                              ❌ WRONG (they are B2B)

website_health (written by fast-intel - PARTIALLY BROKEN)
├── google_rating: null                       ❌ MISSING (top-level has star_rating: "5")
├── review_count: null                        ❌ MISSING (top-level has review_count: "29")
├── business_name_normalised: "Home"          ❌ WRONG
├── google_ads_running: true                  ⚠️  CONTRADICTS top-level false
├── facebook_ads_running: false               ✅
├── has_crm: true (HubSpot)                   ✅
├── has_chat: false                           ✅
├── has_booking: false                        ✅
└── landing_page_score: null                  ❌ MISSING

flags (written by fast-intel - CONTRADICTIONS)
├── no_crm: true                              ❌ WRONG (tech_stack.has_crm = true, HubSpot)
├── speed_to_lead_needed: true                ✅ reasonable
├── call_handling_needed: false               ✅
└── review_signals: false                     ❌ WRONG (29 reviews exist at top level)

consultant (written by consultant worker - POISONED with "Home")
├── scriptFills.website_positive_comment      ✅ usable
├── scriptFills.hero_header_quote: null       ❌
├── scriptFills.icp_guess: "real estate"      ❌ WRONG industry
├── routing.priority_agents: ["Chris","Maddie"] ✅ reasonable
├── routing.reasoning.sarah: "hasCRM is false" ❌ WRONG (HubSpot exists)
├── routing.reasoning.james: "reviewCount is 0" ❌ WRONG (29 reviews)
├── landingPageVerdict                        ✅ usable
├── conversationHooks                         ✅ usable
└── redFlags: "Zero Google reviews"           ❌ WRONG (29 reviews exist)

bella_opener (stored in KV - BROKEN)
└── "Hi Trent! We've taken a proper look at Home..."  ❌ says "Home" not "Pitcher Partners"
```

---

## WHAT THE BRIDGE ACTUALLY USES (deepgram-bridge-v9/src/index.ts)

The bridge reads `lead:{lid}:intel` on every turn and builds a stage prompt.
Key fields it injects into the prompt:

```typescript
// In buildSystemPromptV3():
const ci = intel.core_identity ?? {};        // ← READS BROKEN core_identity
const wh = intel.website_health ?? {};       // ← READS BROKEN website_health  
const flags = intel.flags ?? {};             // ← READS CONTRADICTORY flags
const rank = intel.agent_ranking ?? [];      // ← may be empty

// Injected into prompt:
`BUSINESS: ${businessName}`                  // ← NOW fixed (uses kvIntel.business_name)
`INDUSTRY: ${ci.industry}`                   // ← "real estate" ❌
`PHONE: ${ci.phone}`                         // ← "" ❌
`Google Rating: ${wh.google_rating}/5`       // ← null ❌ (should be 5)
`review_count: ${wh.review_count}`           // ← null ❌ (should be 29)
`Has CRM: ${wh.has_crm}`                     // ← true ✅
`Running Ads: ${flags.is_running_ads}`       // ← false ✅ (but google_ads_running: true in wh)
```

---

## WHAT THE VOICE AGENT USES (voice-agent-v9/src/index.ts)

The voice agent builds the initial system prompt on connect using `buildSystemPromptV3()`.
It receives the full `kvIntel` object and passes `kvIntel.business_name` as businessName (FIXED in v9.0.1-v9).
But the consultant block inside the prompt still uses `intel.consultant` which has poisoned data.

The `bella_opener` injected as Deepgram's greeting comes from `kvIntel.bella_opener` — still says "Home".

---

## ROOT CAUSES

### Root Cause 1: fast-intel reads `<title>` tag for business_name
`core_identity.business_name` = page `<title>` tag = "Home - Pitcher Partners" → stripped to "Home"
This poisons: `core_identity`, `website_health.business_name_normalised`, `bella_opener`, `fast_context.business.name`

### Root Cause 2: fast-intel has no access to Google Business Profile data
`website_health.google_rating` and `review_count` are null because fast-intel doesn't call GMB API.
The big scraper (`personalisedaidemofinal-sandbox`) DOES get this data and writes it to top-level fields.
But the bridge reads from `website_health.*` not from top-level `star_rating`/`review_count`.

### Root Cause 3: flags.no_crm contradicts tech_stack.has_crm
fast-intel's consultant reasoning used wrong field path.

### Root Cause 4: bella_opener was generated before business_name was corrected
The opener is cached in KV with "Home" baked in and never regenerated.

---

## THE FIX STRATEGY

### Option A: Fix the bridge/voice-agent to read from correct KV paths (RECOMMENDED FIRST)
Don't change KV structure. Just fix the code to prefer top-level fields over sub-fields.

In `buildSystemPromptV3` (bridge):
```typescript
// BEFORE (broken):
const ci = intel.core_identity ?? {};
`Google Rating: ${wh.google_rating ?? "?"}/5 (${wh.review_count ?? 0} reviews)`

// AFTER (fixed):
const ci = intel.core_identity ?? {};
const googleRating = wh.google_rating ?? intel.star_rating ?? "?";
const reviewCount = wh.review_count ?? intel.review_count ?? 0;
const industry = ci.industry !== "real estate" ? ci.industry : intel.fast_intel?.core_identity?.industry ?? ci.industry;
// Better: just read top-level fields first
`Google Rating: ${googleRating}/5 (${reviewCount} reviews)`
```

For the `bella_opener` — regenerate it on-the-fly if it contains "Home":
```typescript
const opener = kvIntel.bella_opener?.includes("Home") 
  ? kvIntel.bella_opener.replace(/\bHome\b/g, businessName)
  : kvIntel.bella_opener;
```

For `flags.no_crm` contradiction:
```typescript
const hasCrm = wh.has_crm ?? intel.tech_stack?.has_crm ?? !flags.no_crm;
```

### Option B: Re-run the scraper to regenerate KV data
Trigger `fast-intel-sandbox` for `anon_ni3i8fqd` with correct business name.
But fast-intel will still read the `<title>` tag and get "Home" again unless that bug is fixed first.

### Option C: Fix fast-intel to not use `<title>` as business_name
In `fast-intel-sandbox/src/index.ts`, find where `core_identity.business_name` is set.
It should use OG tags, schema.org, or GMB name — not the `<title>` tag.

---

## CURRENT DEPLOYED VERSIONS
| Worker | Version | Deploy ID |
|--------|---------|-----------|
| `bella-voice-agent-sandbox-v9` | **3.0.1-v9** | `6f0e6bbe-9e77-41a2-968f-f38009c7fe2b` |
| `deepgram-bridge-sandbox-v9` | **6.2.2-D** | `1daf3ae0-fbcd-46fd-9ec5-24cad484bda1` |
| `fast-intel-sandbox` | latest | `6fe4bd42-5217-4aa0-92b9-425ea6f92e25` |

---

## DEPLOY COMMANDS
```bash
# Bridge
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v9
npx wrangler deploy

# Voice agent
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/voice-agent-v9
npx wrangler deploy

# Fast intel
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/fast-intel-sandbox
npx wrangler deploy
```

## TAIL/DEBUG COMMANDS
```bash
# Bridge tail (persistent to file)
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v9
npx wrangler tail --format pretty 2>&1 | tee -a ../logs/bridge-tail-live.log

# Voice agent tail
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/voice-agent-v9
npx wrangler tail --format pretty 2>&1 | tee -a ../logs/voice-agent-tail-live.log

# Read KV intel for test lead
cd /Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v9
npx wrangler kv key get "lead:anon_ni3i8fqd:intel" --binding=LEADS_KV --remote --text | python3 -m json.tool

# List all KV keys for this lead
npx wrangler kv key list --binding=LEADS_KV --remote --prefix="lead:anon_ni3i8fqd" | python3 -m json.tool
```

## TEST URL
```
https://claudedemofunnelv5cfsuper.netlify.app/demo_v95_hybrid.html?fn=Trent&lid=anon_ni3i8fqd&web=https%3A%2F%2Fwww.pitcher.com.au
```

---

## PRIORITY ORDER FOR FIXES

1. **[IMMEDIATE]** Fix bridge `buildSystemPromptV3` to read `intel.star_rating` / `intel.review_count` when `website_health.*` is null
2. **[IMMEDIATE]** Fix bridge to sanitise `bella_opener` — replace "Home" with `businessName`
3. **[IMMEDIATE]** Fix `flags.no_crm` contradiction — check `tech_stack.has_crm` first
4. **[IMMEDIATE]** Fix `ci.industry` — "real estate" is wrong for an accounting firm; fall back to domain-based inference or leave blank
5. **[MEDIUM]** Fix fast-intel `core_identity.business_name` extraction — don't use `<title>` tag
6. **[MEDIUM]** Re-trigger scraper for `anon_ni3i8fqd` after fixing #5 to get clean KV data
7. **[MEDIUM]** Wire big scraper (`personalisedaidemofinal-sandbox`) into V6 pipeline so GMB data flows correctly
8. **[LOW]** Fix `website_health.google_ads_running: true` contradiction vs top-level `false`

---

## RULES (DO NOT BREAK)
1. No writes to KV from the bridge — bridge is READ-ONLY
2. One change at a time — deploy, verify with wrangler tail, then next
3. Always bump version string on deploy
4. Always pipe wrangler tail through `tee` to `/logs/` folder
5. The Durable Object (`BellaAgent`) persists state — test with fresh LID or clear state if needed
