# BELLA ARCHITECTURE — HOW IT ACTUALLY WORKS
## Filed: 2026-04-20 AEST | Author: T9 Architect (Opus)
## D1 ID: doc-bella-architecture-how-it-works-20260420
## STATUS: CANONICAL REFERENCE — READ THIS BEFORE EVERY SESSION

---

## PURPOSE

This document explains exactly how Bella works end-to-end — both MVPScriptBella (active) and NaturalBellaFROZEN (reference). Every agent on the team must read this before starting work. It covers the full data pipeline, what consultant scripting delivers, what each WOW stall needs, what depends on deep-scrape vs website-only data, and what "Job Done" looks like.

---

## WHAT BELLA IS

Bella is an **inbound website voice AI sales receptionist**. NOT a cold caller. NOT a phone agent.

Flow:
1. Prospect submits details on a website funnel
2. System scrapes their site (~10-20s)
3. Bella greets them ON THE WEBSITE with personalised insights about THEIR business
4. Bella demos Alex/Chris/Maddie/Sarah/James — AI agents tailored to their specific business

The scrape data is the WOW — she knows their business because they gave her the URL. She NEVER asks "what does your business do?" She already knows.

---

## TWO STACKS

### MVPScriptBella (ACTIVE — being fixed and launched)
- **Repo:** ~/Desktop/MVPScriptBella/workers/
- **Workers:** mvpscriptbella{brain,bridge,fast-intel,consultant,scrape,tools,voice}
- **Frontend:** TBD (Netlify)
- **KV:** leads-kv (0fec6982d8644118aba1830afd4a58cb)
- **MVP scope:** No ROI delivery, no deep-scrape dependency. Website data + consultant + Google Places only.

### NaturalBellaFROZEN (REFERENCE — DO NOT TOUCH)
- **Tag:** bella-natural-v1 (commit 8e23c66)
- **Source:** ~/Desktop/BELLA_GOLDEN_V1 copy/
- **Workers:** frozen-bella-natural-*
- **Frontend:** bellanaturalv1desktop11111111.netlify.app
- **Canary result:** 10/10 stages, compliance 1.00, TTFB 490-702ms
- **Why it works:** All worker names consistent lowercase. All service bindings match exactly.

### Key difference
NaturalBella has full ROI delivery + deep-scrape enrichment. MVPScriptBella descopes both for launch speed. The consultant scripting, stage machine, and WOW journey are identical in both — the code is the same.

---

## THE FULL PIPELINE (what happens when a prospect submits)

```
STEP 1: FORM SUBMIT (0s)
  Browser → capture.html / loading-v15.html
    → POST fast-intel /fast-intel endpoint
    → POST personalisedaidemofinal-sandbox (landing page data — DO NOT TOUCH this worker)

STEP 2: FAST-INTEL (0-15s)
  fast-intel worker:
    a) Firecrawl scrapes website (2-5s) → raw HTML, hero, nav, tech stack
    b) Pixel detection → ads flags, CRM, chat, booking tools
    c) Google Places API cross-ref (2-3s) → rating, review count, verified name
       ⚠️ REQUIRES GOOGLE_PLACES_API_KEY secret on fast-intel
    d) Consultant /fast call (3-5s) → business name, basic scriptFills
    e) Consultant full call (4-8s) → icpAnalysis, conversionEventAnalysis, routing, hiringAnalysis
    f) Fire deep-scrape via DEEP_SCRAPE binding (fire-and-forget, 30-45s)
    g) Fire BIG_SCRAPER via service binding (fire-and-forget, 60-120s)
    h) Write KV: lead:{lid}:fast-intel (full intel envelope)
    i) Deliver events to Brain DO

STEP 3: LOADING PAGE REDIRECT (15-20s)
  loading-v15.html polls fast-intel /status?lid=xxx
  When ready → redirects to demo page

STEP 4: VOICE CALL STARTS (15-20s)
  demo page → WebSocket → voice-agent DO
    → Deepgram STT (speech-to-text)
    → HTTP POST to bridge (each turn)

STEP 5: BRIDGE PROCESSES EACH TURN
  bridge worker:
    a) Reads KV: lead:{lid}:fast-intel (intel envelope with consultant data)
    b) Builds system prompt (business intel, rules, agent descriptions)
    c) Builds turn prompt (stage directive, confirmed inputs, memory)
    d) Streams Gemini 2.5 Flash → SSE → Deepgram TTS → browser audio

STEP 6: DEEP-SCRAPE ENRICHMENT (30-45s, background)
  deep-scrape worker (fire-and-forget from Step 2f):
    → Apify actors: Google Maps, hiring (Indeed/LinkedIn), ads transparency
    → Writes back to KV additively (merge, not overwrite)
    → Bridge picks up enriched data on subsequent turns
    → [ENRICH] log tag when bridge detects new deep data
```

---

## CONSULTANT — WHAT IT DOES AND WHAT IT RETURNS

**File:** workers/consultant/worker.js (956 lines, plain JS)
**Endpoints:** `/fast` (3-5s), `/` root POST (4-8s), `/pass2` (post-scrape enrichment)
**Input:** Website content scraped by fast-intel (HTML, nav items, hero, tech stack)
**NOT input:** Deep-scrape data. Hiring data. Google reviews. (Those arrive later.)

### What consultant returns (all from WEBSITE content alone):

```
{
  businessIdentity: {
    correctedName,        // "Pitcher Partners" not just domain
    spokenName,           // TTS-friendly version
    industry,
    customerType,         // "client", "patient", "customer" etc.
  },
  scriptFills: {
    hero_header_quote,        // Main headline from website
    website_positive_comment, // "Your positioning around X really stands out"
    icp_guess,                // "mid-market accounting firms"
    reference_offer,          // Their primary service/product
    top_2_website_ctas,       // Main conversion actions on site
    recent_review_snippet,    // null without deep-scrape
    rep_commentary,           // null without Google rating
    campaign_summary,         // null without ads data
  },
  icpAnalysis: {
    icpNarrative,         // Pre-built spoken line for Bella (stall 3)
    icpProblems,          // ["problem 1", "problem 2"] from website
    icpSolutions,         // ["solution 1", "solution 2"] from website
    bellaCheckLine,       // Fallback ICP confirmation line
    marketPositionNarrative,
    whoTheyTarget,
  },
  conversionEventAnalysis: {
    conversionNarrative,  // Pre-built spoken line for Bella (stall 5)
    agentTrainingLine,    // How agents map to their conversion events
    primaryCTA,           // Main conversion action
    ctaAgentMapping,      // "Your booking form → Chris, your phone CTA → Maddie"
    ctaBreakdown,         // [{cta, type, agent, reason}]
    allConversionEvents,
  },
  routing: {
    priority_agents,      // ["Chris", "Alex"] — which agents to recommend
  },
  hiringAnalysis: {
    topHiringWedge,       // null without deep-scrape hiring data
    matchedRoles,         // [] without deep-scrape hiring data
  },
  conversationHooks,      // Personalised talking points
  mostImpressive,         // What stood out about their business
  redFlags,               // Caution areas
  copyAnalysis: { bellaLine },
  valuePropAnalysis: { bellaLine },
  landingPageVerdict,
}
```

### Critical insight: consultant generates from WEBSITE CONTENT ALONE
- icpNarrative, conversionNarrative, routing, scriptFills — ALL from website scrape
- hiringAnalysis needs deep-scrape data → returns null/empty without it
- rep_commentary needs Google rating → returns null without it
- This means MVP (no deep-scrape) still gets rich consultant scripting for stalls 3, 5, 7, 8, 9, 10

---

## THE WOW JOURNEY — EVERY STALL EXPLAINED

The bridge uses `buildStageDirective()` (inline function in bridge/src/index.ts) to generate per-stall directives. Each stall tells Gemini EXACTLY what to say via `<DELIVER_THIS>` tags.

### Data sources per stall:

| Stall | Name | What Bella says | Data source | Deep-scrape needed? |
|-------|------|----------------|-------------|-------------------|
| 1 | Research Intro | "We've done some research on {business}..." | firstName, businessName, customerType from consultant | NO — website only |
| 2 | Reputation + Trial | "{business} has a {rating}-star reputation from {reviews} reviews" | Google rating + review count | YES — Google Places API (fast, 2-3s) OR deep-scrape Apify (slow, 30-45s) |
| 3 | ICP + Problems + Solutions | Consultant's icpNarrative OR mechanical stitch from icpProblems/icpSolutions | consultant icpAnalysis | NO — website only |
| 4 | Pre-training Connect | "That's exactly the kind of business intelligence we've used to pre-train your AI team" | customerType only | NO — generic |
| 5 | Conversion Events | Consultant's conversionNarrative OR agentTrainingLine OR primaryCTA rebuild | consultant conversionEventAnalysis | NO — website only |
| 6 | Audit Transition | "I've just got a couple of quick opportunity-audit questions" | customerType, businessName | NO — generic |
| 7 | Lead Source | Question about main lead source (3 variants based on ads/phone signals) | routing.priority_agents, flags (ads, phone) from pixel detection | NO — pixel detection in fast-intel |
| 8 | Lead Source Deep | Multi-signal branching question (ads/chat/booking/email/reviews/hiring) | Full tech_stack signals via selectWow8Branch() | PARTIALLY — richer with deep data, has fallback |
| 9 | Hiring Wedge | topHiringWedge OR "I noticed you're hiring for {role}" OR "Are you hiring?" | hiringAnalysis from deep-scrape | YES for assertion, NO for question fallback |
| 10 | Provisional Recommendation | "The likely standouts look like {agent1} and {agent2}" | routing.priority_agents, ctaAgentMapping, hiringMatches | NO — routing from website, hiring is bonus |

### Stall 2 — The Google Rating Blocker

```javascript
const googleRating = deep.googleMaps?.rating
    ?? (intel.star_rating != null ? parseFloat(String(intel.star_rating)) || null : null);
if (googleRating && googleRating >= 3) {
  // Deliver reputation + trial offer
} else {
  // SKIP stall 2, advance to stall 3
}
```

**Path 1 (fast, 2-3s):** Google Places API in fast-intel → `(fastIntel).places.rating`
- Code exists at fast-intel/src/index.ts lines 1275-1372 (crossRefGooglePlaces function)
- REQUIRES `GOOGLE_PLACES_API_KEY` secret on fast-intel
- ⚠️ THIS SECRET IS MISSING ON MVPScriptBella — stall 2 ALWAYS skips

**Path 2 (slow, 30-45s):** Deep-scrape Apify Google Maps actor → `deep.googleMaps.rating`
- Arrives 30-45s into conversation — too late for stall 2 (happens at turn 2, ~10-15s)
- Available for later turns if bridge re-reads KV

**Path 3:** `intel.star_rating` at KV root — written by personalisedaidemofinal if alive

### Stall 2 fix for MVP:
```
npx wrangler secret put GOOGLE_PLACES_API_KEY --name mvpscriptbellafast-intel
```
Same key that's on personalisedaidemofinal-sandbox. Gives Bella Google rating in 2-3s during fast-intel phase, guaranteed before conversation starts.

---

## CHANNEL STAGES (post-WOW discovery)

After WOW stall 10, Bella enters channel-specific discovery:

| Channel | Agent | Questions asked | Data used |
|---------|-------|----------------|-----------|
| ch_ads | Alex | Leads/period, conversions, followup speed | adsOn flag, captured inputs |
| ch_website | Chris | Web leads, conversions, followup speed | Captured inputs |
| ch_phone | Maddie | Call volume, after-hours, callback speed | phone flags, captured inputs |
| ch_old_leads | Sarah | Old lead volume | Captured inputs |
| ch_reviews | James | New customers, rating, review count, review system | googleRating (if available), captured inputs |

Each channel ends with a **recommendation** (value language, no dollar figures in MVP).

### MVP vs Full (ROI)

**MVP:** Channels → recommendation (value language) → close
**Full (post-launch):** Channels → recommendation + ROI delivery (dollar figures from calcAgentROI) → roi_delivery stage (combined total) → close

ROI code exists in bridge but must be UNREACHABLE for MVP. Stage machine must skip roi_delivery → close. Channel directives must return at recommendation, not continue to "DELIVER ROI NOW" blocks.

---

## SYSTEM PROMPT STRUCTURE

Bridge builds a two-part prompt every turn:

### Part 1: System prompt (cached, ~3.5K chars)
- Bella's identity and voice rules
- Agent descriptions (Alex, Chris, Maddie, Sarah, James)
- Behavioral rules (one question at a time, no hallucination, etc.)
- Business intel section (from KV — consultant scriptFills, tech stack, flags)
- ⚠️ MVP: Must NOT contain ROI rules (currently does — needs fix)

### Part 2: Turn prompt (rebuilt every turn, ~800 chars)
- Current stage + stall number
- Stage directive from buildStageDirective() — the `<DELIVER_THIS>` text
- Confirmed inputs so far
- Conversation memory
- Output contract
- ⚠️ MVP: Must NOT contain LIVE ROI section (currently does — needs fix)

### What Gemini does
Gemini's job is to DELIVER the scripted text naturally — not improvise. The `<DELIVER_THIS>` tags contain exact text from consultant scriptFills or template + placeholder replacement. Gemini adds natural transitions, handles prospect responses, but the core insight/claim comes from the script.

---

## MVP "JOB DONE" CHECKLIST

A working MVP Bella call looks like this:

### Pipeline (before voice call starts)
- [ ] Form submit fires fast-intel
- [ ] Firecrawl scrapes website successfully
- [ ] Google Places API returns rating + reviews (NEEDS SECRET)
- [ ] Consultant /fast returns business name
- [ ] Consultant full returns scriptFills, icpAnalysis, conversionEventAnalysis, routing
- [ ] KV written: lead:{lid}:fast-intel with full intel envelope
- [ ] Loading page redirects to demo page

### Voice call (10 stalls + channels + close)
- [ ] Stall 1: Research intro — uses businessName, customerType ✓
- [ ] Stall 2: Reputation + trial — uses Google rating from Places API ✓ (BLOCKED without secret)
- [ ] Stall 3: ICP — uses consultant icpNarrative or icpProblems/icpSolutions ✓
- [ ] Stall 4: Pre-training connect — generic ✓
- [ ] Stall 5: Conversion events — uses consultant conversionNarrative ✓
- [ ] Stall 6: Audit transition — generic ✓
- [ ] Stall 7: Lead source — uses routing + flags ✓
- [ ] Stall 8: Lead source deep — uses tech stack signals ✓
- [ ] Stall 9: Hiring wedge — asks question (no deep-scrape assertion) ✓
- [ ] Stall 10: Provisional rec — uses routing.priority_agents ✓
- [ ] Channels: Discovery questions → value-language recommendation (NO ROI) ✓
- [ ] Close: Punchy close ✓
- [ ] NO ROI questions asked at any point
- [ ] NO dollar figures mentioned
- [ ] NO "what does your business do?" asked
- [ ] Bella sounds personalised, not generic — consultant data visible in speech

### What "broken" looks like
- Bella says generic lines without business specifics → consultant data not reaching bridge (binding issue or consultant returning null)
- Bella skips stall 2 every time → GOOGLE_PLACES_API_KEY missing
- Bella asks ROI questions (how many leads, what's your revenue) → ROI not properly muted in bridge
- Bella asks "what does your business do?" → consultant scriptFills empty, falling to last-resort generic
- Bella hallucinates agent names or dollar figures → system prompt ROI rules still active
- [BELLA_SAID] logs show generic text without business name → check KV for intel data

---

## OPEN ITEMS FOR MVP LAUNCH

### DONE (Sprint 1 — 2026-04-20)
- [x] All 7 wrangler.toml names normalized to lowercase
- [x] All service binding targets normalized to lowercase
- [x] All 7 workers redeployed in dependency order
- [x] Consultant data confirmed flowing (canary: scriptFills populated in stalls 3+)

### BLOCKING
- [ ] **GOOGLE_PLACES_API_KEY** secret on mvpscriptbellafast-intel (unlocks stall 2)
- [ ] **ROI made unreachable** — mute system prompt ROI rules, skip roi_delivery stage, channel recs stop at value language

### NOT BLOCKING (post-launch)
- [ ] Deep-scrape: fires fire-and-forget, works if bindings OK, enriches mid-call. First thing back post-launch.
- [ ] ROI delivery: code stays in bridge, just unreachable. Restore = revert 4 targeted changes.
- [ ] personalisedaidemofinal-sandbox: alive, called by frontend + BIG_SCRAPER binding. DO NOT TOUCH. Verify correct version.
- [ ] Fix 2+3 from prior session (moves.ts WOW2 no-data branch) — was in T3a gate

---

## SERVICE BINDINGS MAP (MVPScriptBella — post Sprint 1)

```
mvpscriptbellafast-intel
  → CONSULTANT  → mvpscriptbellaconsultant
  → DEEP_SCRAPE → mvpscriptbellascrape
  → BIG_SCRAPER → personalisedaidemofinal-sandbox
  → CALL_BRAIN  → mvpscriptbellabrain

mvpscriptbellabridge
  → TOOLS       → mvpscriptbellatools
  → CALL_BRAIN  → mvpscriptbellabrain

mvpscriptbellavoice
  → TOOLS       → mvpscriptbellatools

mvpscriptbellatools
  → CONSULTANT  → mvpscriptbellaconsultant

mvpscriptbellascrape
  → CONSULTANT  → mvpscriptbellaconsultant
```

---

## SECRETS REQUIRED (MVPScriptBella)

| Worker | Secret | Status |
|--------|--------|--------|
| mvpscriptbellafast-intel | FIRECRAWL_API_KEY | ✓ Set |
| mvpscriptbellafast-intel | GEMINI_API_KEY | ✓ Set |
| mvpscriptbellafast-intel | SCRAPINGANT_KEY | ✓ Set |
| mvpscriptbellafast-intel | GOOGLE_PLACES_API_KEY | ⚠️ MISSING — stall 2 broken |
| mvpscriptbellabridge | GEMINI_API_KEY | ✓ Set |
| mvpscriptbellaconsultant | GEMINI_API_KEY | ✓ Set |
| mvpscriptbellascrape | APIFY_API_KEY | ✓ Set |
| mvpscriptbellascrape | GEMINI_API_KEY | ✓ Set |
| mvpscriptbellavoice | DEEPGRAM_API_KEY | ✓ Set |

---

## KEY FILES

| File | Purpose |
|------|---------|
| workers/fast-intel/src/index.ts | Pipeline: scrape → consultant → KV write. Lines 1275-1372: Google Places. Lines 370-431: consultant calls. Lines 1400-1470: KV envelope. |
| workers/bridge/src/index.ts | Brain: reads KV, builds prompts, streams Gemini. Lines 1744-2200: buildStageDirective (inline, NOT the separate file). Lines 1420-1610: system prompt. Lines 1612-1740: turn prompt. |
| workers/bridge/src/buildStageDirective-v1.ts | DEAD CODE — not imported. Contains correct no-ROI channel recommendations. Reference for MVP channel recs. |
| workers/bridge/src/bella-v1-script.ts | DEAD CODE — not imported. Contains all BELLA_SCRIPT templates. Reference only. |
| workers/consultant/worker.js | Consultant analysis: 956 lines. /fast and / endpoints. Returns scriptFills, icpAnalysis, routing, etc. |
| workers/fast-intel/wrangler.toml | Service bindings: CONSULTANT, DEEP_SCRAPE, BIG_SCRAPER, CALL_BRAIN |
| workers/bridge/wrangler.toml | Service bindings: TOOLS, CALL_BRAIN |

---

## LAWS FOR ALL AGENTS

1. **Bella NEVER asks "what does your business do?"** — she has scrape data pre-loaded
2. **Bella NEVER criticises a prospect's website** — maximise whatever they have
3. **MVP = no ROI, no deep-scrape dependency** — value language only, website data + consultant + Google Places
4. **Service bindings must match EXACT deployed worker names** — mixed case = silent 1042 failure
5. **The inline buildStageDirective in index.ts is what runs** — the separate .ts file is dead code
6. **Consultant generates from website content alone** — deep-scrape enriches later, not a dependency
7. **personalisedaidemofinal — NEVER touch/edit/deploy** — calling via existing binding is fine
8. **NaturalBellaFROZEN is the reference** — when in doubt, compare against it. Same code, proven working.
