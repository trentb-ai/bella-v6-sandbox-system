# MVPScriptBella — "Make Her Sing" Full Diagnostic Report
### Filed: 2026-04-20 ~19:30 AEST | Author: T9 Architect + Codex Rescue
### Status: DIAGNOSTIC COMPLETE — awaiting Trent's priority call on fix order

---

## EXECUTIVE SUMMARY

Bella's pipeline is mechanically sound (KV wiring, service bindings, secrets, schema — all clean). The problems are ALL in how the bridge prompt is structured and what data reaches Gemini. Three categories:

1. **18 instruction conflicts** in the prompt cause Gemini to ignore scripted beats
2. **No REACT-BRIDGE-DELIVER architecture** means Bella either robots or drifts
3. **Raw site content never reaches the prompt** so Bella can't demonstrate deep knowledge

---

## SECTION 1: PIPELINE STATUS (ALL CLEAN)

### KV Wiring ✅
| Worker | KV Binding | Namespace ID | Status |
|--------|-----------|--------------|--------|
| bridge | LEADS_KV | 0fec6982d8644118aba1830afd4a58cb | ✅ |
| fast-intel | LEADS_KV | 0fec6982d8644118aba1830afd4a58cb | ✅ |
| consultant | LEADS_KV | 0fec6982d8644118aba1830afd4a58cb | ✅ |
| deep-scrape | WORKFLOWS_KV | 0fec6982d8644118aba1830afd4a58cb | ✅ Same namespace |
| voice-agent | LEADS_KV | 0fec6982d8644118aba1830afd4a58cb | ✅ |

### Service Bindings ✅
| Worker | Binding | Target | Status |
|--------|---------|--------|--------|
| fast-intel | CONSULTANT | mvpscriptbellaconsultant | ✅ |
| fast-intel | DEEP_SCRAPE | mvpscriptbellascrape | ✅ |
| fast-intel | BIG_SCRAPER | personalisedaidemofinal-sandbox | ⚠️ External ref |
| fast-intel | CALL_BRAIN | mvpscriptbellabrain | ✅ |
| bridge | TOOLS | mvpscriptbellatools | ✅ |
| bridge | CALL_BRAIN | mvpscriptbellabrain | ✅ |
| deep-scrape | CONSULTANT | mvpscriptbellaconsultant | ✅ |
| voice-agent | TOOLS | mvpscriptbellatools | ✅ |

### Secrets ✅
| Worker | Secret | Status |
|--------|--------|--------|
| bridge | GEMINI_API_KEY | ✅ Working |
| fast-intel | FIRECRAWL_API_KEY | ✅ Working |
| fast-intel | GEMINI_API_KEY | ✅ Working |
| fast-intel | GOOGLE_PLACES_API_KEY | ✅ Set |

### Known Issue: Voice-Agent Public URL (P1 — 1042 time bomb)
```
voice-agent/wrangler.toml line 24:
BRIDGE_URL = "https://mvpscriptbellabridge.trentbelasco.workers.dev/v9/chat/completions"
```
Should be service binding. Working now but vulnerable to CF 1042 same-zone routing.

### KV Schema Match ✅
- fast-intel WRITES: `lead:{lid}:fast-intel` (line 705 starter, line 1460 full)
- bridge READS: `lead:{lid}:fast-intel` (line 228) — exact key match
- Merge priority: stub < deep < deepFlags < oldIntel < fast-intel (fast wins)
- Canary confirmed: 33KB at `lead:canary3_...:fast-intel`, bridge read it (2423 prompt tokens)

### Consultant Data in KV ✅ (Canary 3 — KPMG)
- icpAnalysis.icpNarrative: ✅ "Your site speaks directly to large organisations..."
- conversionEventAnalysis.conversionNarrative: ✅ "Your website primarily focuses on presenting information..."
- conversionEventAnalysis.agentTrainingLine: ✅
- conversionEventAnalysis.ctaAgentMapping: ✅ "Chris is ideal for engaging visitors..."
- icpAnalysis.bellaCheckLine: ✅
- routing.priority_agents: ✅ [Alex, Chris, Maddie]
- hiringAnalysis.topHiringWedge: "None" (correct — KPMG not hiring)
- scriptFills: 11 fields all populated

---

## SECTION 2: THE 18 PROMPT CONFLICTS (Why Gemini Ignores Scripts)

### Evidence of Failure
**Stall 1 DELIVER_THIS:** "Now Trent, I think you'll be impressed. We've done some research on KPMG Australia, and we use that to pre-train your agents so they understand your customers, your industry, and how you win business. Can I quickly confirm a couple of our findings with you, just to make sure your agents are dialled in?"

**What Bella SAID:** "So Trent, your pre-trained KPMG agents are ready to go. You play the role of a prospective customer, and your agents respond in real time like they've worked in the business for years — answering questions and moving people toward the actions that matter most. Before we begin, can I quickly confirm a couple of things so they're dialled in around the highest-value opportunities?"

Gemini rewrote it entirely. Pulled framing from the system prompt identity instead.

### What Gemini Receives (in order)

```
POSITION 1: AGENT KNOWLEDGE (~500 chars)
  - Alex, Chris, Maddie, Sarah, James descriptions
  - Contains benchmark claims: "4x more conversions", "24% more conversions"

POSITION 2: ==== MANDATORY SCRIPT — FOLLOW EXACTLY ====
  - Stage directive with <DELIVER_THIS> tags
  - The actual scripted content (hardcoded OR consultant narrative)
  ==== END ====

POSITION 3: BUSINESS + STAGE label

POSITION 4: CONFIRMED INPUTS (empty on turn 1)

POSITION 5: OUTPUT RULES (V2)
  - Rule 1: "No XML tags in output"
  - Rule 5: "Text inside <DELIVER_THIS> tags is your EXACT spoken output"
  - Rule 2: "4 sentences maximum"
  - Rules 4-9: various behavioral constraints

POSITION 6: --- REFERENCE DATA (use to inform, do not read aloud) ---

POSITION 7: EXECUTION RULES
  - "You are Bella, a live voice AI running a personalised AI Agent demonstration..."
  - Turn behavior: "React briefly to what the prospect just said"
  - Hard do-not rules

POSITION 8: BUSINESS INTEL
  - Hero message, website strength, ICP, market position
  - Opener: [bella_opener — different text from DELIVER_THIS]
  - Conversation hooks
```

### The 18 Conflicts (T9 + Codex Combined)

#### CRITICAL — Directly Cause Script Non-Compliance

| # | Location | Conflict | Impact |
|---|----------|----------|--------|
| 1 | Lines 1709 + 1713 | Rule 1 "no XML tags" vs Rule 5 "follow `<DELIVER_THIS>` tags" | Gemini may interpret "no XML" as "strip/ignore all XML tags" |
| 2 | Lines 727-733 | `stripApologies()` sanitizer REMOVES all XML tags + "DELIVER_THIS" text from output | Even if Gemini echoes tags, sanitizer kills them |
| 3 | Line 1600 | `Opener:` field in reference data provides COMPETING opening text | Gemini picks reference opener over DELIVER_THIS |
| 4 | Line 1474 | Identity: "running a personalised AI Agent demonstration for a business prospect" | Gemini elaborates "demonstration" framing into response |
| 5 | Lines 1726-1737 vs 3291 | MANDATORY SCRIPT at position 2, competing content at positions 7-8 (recency bias) | Gemini prioritizes last-read content |
| 6 | Lines 1713 vs 1948/1966/1999/2007 | Inconsistent markers: some stalls use `<DELIVER_THIS>`, others use `SAY:` or `SAY THIS:` | No consistent "speak this verbatim" signal |
| 7 | Line 1710 | "4 sentences maximum" but canonical script often exceeds 4 sentences | Gemini truncates or paraphrases to fit |
| 8 | Lines 1704 vs 1713 | "RETRIEVED INTEL (cite verbatim where relevant)" competes with DELIVER_THIS | Two things claiming "cite verbatim" |

#### MODERATE — Cause Behavioral Confusion

| # | Location | Conflict | Impact |
|---|----------|----------|--------|
| 9 | Rule 5 internal | "EXACTLY as written" + "may add ONE acknowledgment sentence" | Self-contradicts: exact AND modified |
| 10 | Lines 1485 vs 1713 | Execution rule 3: "React briefly then continue" vs Rule 5: "word-for-word unchanged" | Contradictory orders on how to start response |
| 11 | Lines 1476 vs 1929 | "do not turn into audit/discovery" but stage says "opportunity-audit questions" | Conflicting framing |
| 12 | Lines 1487-1488 vs 2021 | "one question per turn" but some stage directives have two questions | Gemini drops one or merges them |
| 13 | Lines 1716 vs 1720-1721 | "no ROI improvisation" but AGENT KNOWLEDGE has "4x conversion", "24% more" | Are benchmarks OK or not? |
| 14 | Lines 1712 vs 1717 | "say conservative estimate" rebuttal vs "do NOT reference conservative estimate when ROI absent" | Contradicts depending on ROI state |

#### LOW — Noise That Dilutes Signal

| # | Location | Conflict | Impact |
|---|----------|----------|--------|
| 15 | Lines 1682-1684 vs 1716 | ROI disabled (`if (false)`) but output rules still reference it | Confusing dead instructions |
| 16 | Lines 1544 vs 1889 | Stub-intel forbids site observations but fallback WOW says "The site does a strong job" | Contradicts on stub data |
| 17 | Lines 1497 vs 1704 | "don't read structured fields aloud" vs "cite verbatim where relevant" | Conflicting about reference data |
| 18 | Lines 1495 vs 1544 | "don't sound dependent on missing context" but stub handling mentions missing data | Conflicting on data acknowledgment |

### Tag Parsing — 3 Locations in Bridge Code

- **Lines 727-733:** `stripApologies()` removes all XML tags + explicitly removes "DELIVER_THIS" text
- **Line 775:** `hasPromptArtifacts()` detects DELIVER_THIS in output as leaked artifact
- **Lines 2324, 2352, 2377:** streaming chunks sanitized through `stripApologies()`

**No code extracts content FROM tags.** Tags are used purely as prompt instruction markers. The sanitizer strips them from output as a safety net.

---

## SECTION 3: NATURAL CONVERSATION ARCHITECTURE (REACT-BRIDGE-DELIVER)

### Current State: Binary Robot/Drift
- DELIVER_THIS forces verbatim → Bella ignores prospect input (robot)
- If Gemini decides to react first → often loses the script entirely (drift)
- No architectural middle ground

### Required Capability: Dual-Mode Operation
Bella needs to run TWO modes simultaneously:

**SCRIPT ENGINE** — delivers scripted beats (hardcoded + consultant narratives) word-for-word at correct moments

**KNOWLEDGE ENGINE** — freestyles intelligently when:
- Prospect asks unexpected questions (about agents, pricing, their own site)
- Prospect goes off-topic (needs acknowledgment before redirect)
- Prospect references something specific on their website
- Conversational flow requires natural bridging between beats

### The Architecture

Every turn has three explicit parts:

```
REACT (1-2 sentences):
  - Acknowledge what prospect just said
  - Answer their question if they asked one (from AGENT KNOWLEDGE or site data)
  - Connect to your next point if possible
  - If off-topic: brief acknowledge ("Got it" / "Makes sense")

BRIDGE (one phrase):
  - Natural transition to script content
  - "That actually connects to..." / "And on that note..." / "Now..."

DELIVER (the script):
  - Hardcoded stall text OR consultant narrative — spoken faithfully
  - Key facts, offers, questions must land exactly
  - Minor phrasing adjustment for conversational flow OK
  - Core content NEVER dropped, changed, or skipped
```

### What Fuels the REACT:
- AGENT KNOWLEDGE (hardcoded — Alex, Chris, Maddie capabilities, pricing)
- Consultant conversationHooks (already in KV, currently injected at line 1605)
- bella_opener (consultant-generated opening context)
- website_positive_comment (site strength observation)
- Raw site content (NOT YET AVAILABLE — see Section 4)

### What Fuels the DELIVER:
- Hardcoded stall text (stalls 1, 2, 4, 5 alignment, 6, 7)
- Consultant icpNarrative (stall 3)
- Consultant conversionNarrative (stall 4/5)
- Consultant ctaAgentMapping + topHiringWedge (stalls 8-9)
- Recommendation variants (based on routing.priority_agents)
- Objection handlers (based on detected objection type)

### Safety Net: stall_turns Counter
If Bella hasn't delivered script content after 2 turns on same stall (prospect keeps going off-topic):
```
FORCE DELIVER — you've been on this point for 2 turns.
Acknowledge briefly, then deliver this NOW: [script line]
Do not ask another question. Deliver and advance.
```

---

## SECTION 4: MISSING — Raw Site Content Never Reaches Prompt

### What Exists in KV (When Firecrawl Works)
```json
{
  "page_content": {
    "markdown": "[up to 20KB of raw website text]",
    "services": ["Service A", "Service B"],
    "ctas": ["Book a call", "Download guide"],
    "key_benefits": ["Benefit 1", "Benefit 2"],
    "links": ["about", "services", "contact", "faq", "pricing"]
  }
}
```

### What Bridge Actually Reads From This: NOTHING
Bridge reads `intel.consultant.*` and `intel.core_identity.*` but NEVER reads `intel.fast_intel.page_content.markdown`. The raw site content sits in KV unused by the prompt.

### Impact
When prospect asks "did you see our FAQs?" or "what about our pricing page?" or "did you notice we offer X?" — Bella CANNOT answer because she only has consultant SUMMARIES, not the raw content.

### KPMG Canary Issue
For KPMG specifically, `page_content.markdown` was EMPTY (0 chars). Firecrawl returned 200 but with no markdown content (line 552 triggered fallback to directHtml, but markdown field ended up empty). The consultant still worked because it received first 1000 chars via a separate path (line 468).

### Existing Infrastructure (Unused)
Bridge has a COMPLETE vector retrieval system (lines 91-217):
- Reads `lead:{lid}:fast_vector` and `lead:{lid}:deep_vector` from KV
- Embeds the current stage query via Gemini text-embedding-004
- Cosine similarity matching
- Returns best snippet for injection into prompt
- `ENABLE_EMBEDDING = "true"` is SET in bridge wrangler.toml

**But fast-intel NEVER writes vectors.** The system is wired end-to-end but has no data.

### Options to Fix

**Option A: Write vectors in fast-intel**
- After scraping, embed the markdown into vectors
- Write to `lead:{lid}:fast_vector` 
- Bridge retrieval system activates automatically
- Pro: Only retrieves RELEVANT snippets per stage (smart)
- Con: Adds embedding latency to fast-intel pipeline (~2-3s)

**Option B: Condensed site summary field**
- Use Gemini in fast-intel to generate a 2-3KB "site knowledge" summary
- Include: services, key pages, FAQs summary, team, pricing signals, unique selling points
- Write as `intel.site_knowledge` → bridge injects into reference data
- Pro: Compact, always available, no retrieval logic needed
- Con: Loses specific details (can't reference exact FAQ text)

**Option C: Direct markdown injection (short sites)**
- If `page_content.markdown.length < 4000`, inject entire markdown into bridge prompt
- If longer, use Option B summary
- Pro: Full detail for smaller sites
- Con: Token explosion for large sites, no stage-relevance filtering

**Option D: Hybrid (A + B)**
- Always generate condensed summary (Option B) — available every turn
- Also write vectors (Option A) — retrieved for deeper questions
- Bridge uses summary as baseline context + vector snippets for specific questions
- Pro: Best of both worlds
- Con: Most complex, most latency

---

## SECTION 5: FIX PRIORITY RECOMMENDATIONS

### Codex-Recommended Fix Order (safest → riskiest)
1. **Fix B** — Remove competing `Opener:` from reference data line 1600 → zero blast radius
2. **Fix D** — Reframe "demonstration" → "consultation" in identity line 1474 → low risk
3. **Fix C** — Move MANDATORY SCRIPT to last position in system message → medium risk
4. **Fix A** — Replace `<DELIVER_THIS>` XML tags with plain text `SAY EXACTLY:` → needs sanitizer update at lines 727-733, 775
5. **Fix E** — Put script in user message on turn 1 → highest risk, changes semantics

### T9 Recommended Approach
Do B + D + A together as one deploy. Then test. If still paraphrasing, do C.

### Additional Fixes Needed
- Remove "4 sentences maximum" rule (conflicts with scripts > 4 sentences)
- Standardize ALL stall markers to same format (SAY EXACTLY: not mixed DELIVER_THIS/SAY:/SAY THIS:)
- Remove dead ROI references from output rules
- Fix "audit" language contradiction
- Add stall_turns counter for REACT-BRIDGE-DELIVER safety net

### Larger Architectural Work
- Implement REACT-BRIDGE-DELIVER turn structure
- Add site content to prompt (Option A, B, C, or D above)
- Voice-agent service binding fix (1042 prevention)
- Update stall 1 text to match canonical ChatGPT script

---

## SECTION 6: THE TWO SCRIPTS (What MUST Be Delivered)

### Hardcoded Script Content (Bridge Code)
Lives in `buildStageDirective()` — these are the structural beats, transitions, and questions that control conversation flow. Currently at stalls 1-9 + channel stages.

### Consultant Script Content (Generated Per-Lead)
Lives in KV at `intel.consultant.*` — these are personalised spoken lines generated by Gemini Flash from the prospect's actual website content:
- `icpAnalysis.icpNarrative` → WOW 3 primary content
- `conversionEventAnalysis.conversionNarrative` → WOW 4/5 primary content
- `conversionEventAnalysis.agentTrainingLine` → WOW 5 fallback
- `conversionEventAnalysis.ctaAgentMapping` → WOW 9 recommendation content
- `hiringAnalysis.topHiringWedge` → WOW 8 primary content
- `icpAnalysis.bellaCheckLine` → WOW 3 last-resort fallback
- `scriptFills.icp_guess` → WOW 3 medium-data variant
- `routing.priority_agents` → Recommendation variant selection

**BOTH are scripted. BOTH must be delivered word-for-word.** The only freestyle is the REACT portion (acknowledging prospect input between scripted beats).

### Freestyle Fuel (Context for REACT, NOT for replacing scripts)
- `bella_opener` — consultant-generated opening insight
- `scriptFills.website_positive_comment` — site strength observation
- `conversationHooks` — pre-built reactions to common responses
- `page_content.markdown` — raw site content (NOT YET IN PROMPT)
- AGENT KNOWLEDGE — product capabilities, benchmarks

---

## SECTION 7: CANONICAL SCRIPT REFERENCE

The full canonical script is filed separately at:
- Local: `BRAIN_DOCS/doc-bella-mvp-script-final-20260420.md`
- D1: `doc-bella-mvp-script-final-20260420`

WOW 1-7 → Recommendation (4 variants) → Close (booking) → 10 Objection Handlers → Universal Recovery

---

## APPENDIX: Files Referenced

| File | Lines | What |
|------|-------|------|
| bridge/src/index.ts | 91-217 | Vector retrieval system (wired, no data) |
| bridge/src/index.ts | 220-330 | loadMergedIntel — KV merge logic |
| bridge/src/index.ts | 727-733 | stripApologies() sanitizer (strips XML tags) |
| bridge/src/index.ts | 775 | hasPromptArtifacts() (detects leaked DELIVER_THIS) |
| bridge/src/index.ts | 1423-1609 | buildFullSystemContext() — reference data assembly |
| bridge/src/index.ts | 1474 | Identity line ("demonstration") |
| bridge/src/index.ts | 1576-1605 | Intel lines injection (hero, website_positive, ICP, opener, hooks) |
| bridge/src/index.ts | 1622-1738 | buildTurnPrompt() — mandatory script + output rules |
| bridge/src/index.ts | 1708-1717 | Output rules (V2) — the conflicting rules |
| bridge/src/index.ts | 1746-1990 | buildStageDirective() — all stall content |
| bridge/src/index.ts | 3265-3304 | Final prompt assembly (turnPrompt + bridgeSystem) |
| fast-intel/src/index.ts | 540-570 | Firecrawl + direct fetch parallel scrape |
| fast-intel/src/index.ts | 850-900 | Full KV envelope structure (page_content.markdown) |
| voice-agent/wrangler.toml | 24 | Public URL to bridge (should be service binding) |
| bridge/wrangler.toml | 20 | ENABLE_EMBEDDING = "true" (vectors enabled, no data) |
