# MVPScriptBella — T2 ARCHITECT BRIEFING
### Filed: 2026-04-21 AEST | Author: T2 Code Lead
### Purpose: Give T9 Architect complete context to produce a correct architectural plan
### Status: BLOCKING — existing fix spec is incomplete, stage machine mismatch unaddressed

---

## EXECUTIVE SUMMARY

Yesterday's session (2026-04-20) produced a diagnostic + fix spec. Both are useful but INCOMPLETE. They address prompt engineering conflicts (real, 18 found) but miss the fundamental problem: **the bridge stage machine does not match the canonical script**.

The canonical script (filed by Trent via ChatGPT) has 7 WOW stalls → recommendation → close → objection handling. The bridge has 10 stalls → channels → ROI → close. The entire post-WOW-7 flow is structurally wrong.

Sprint 1+5 from the existing fix spec (prompt conflict fixes + stall 1-2 text) is still valid work but insufficient. The stage machine itself needs restructuring.

---

## DOCUMENTS T9 MUST READ (in order)

### 1. THE CANONICAL SCRIPT — read this FIRST
**File:** `BRAIN_DOCS/doc-bella-mvp-script-final-20260420.md`
**D1:** `doc-bella-mvp-script-final-20260420`

This is THE script. Trent's authority. ChatGPT refined. Everything Bella says must come from this document. Read it end-to-end before touching anything else. 264 lines.

Contains:
- WOW 1-7 (with high/medium/low data variants per stall)
- 4 Recommendation variants (ALL 3, Alex+Chris, Alex+Maddie, Alex Only)
- Close (booking onboarding call — NOT email)
- Pricing objection handler
- 10 Objection handlers (all follow: acknowledge → reframe → redirect to booking)
- Universal recovery line
- Design principles

### 2. ARCHITECTURE REFERENCE
**File:** `BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md`
**D1:** `doc-bella-architecture-how-it-works-20260420`

Full pipeline: how fast-intel, consultant, bridge, voice-agent connect. What consultant returns. What each stall currently uses. Service bindings map. MVP "Job Done" checklist. Already in T9's startup sequence.

### 3. DIAGNOSTIC (18 PROMPT CONFLICTS)
**File:** `BRAIN_DOCS/doc-mvpscriptbella-make-her-sing-diagnostic-20260420.md`
**D1:** `doc-mvpscriptbella-make-her-sing-diagnostic-20260420`

Pipeline status (all clean), 18 instruction conflicts in bridge prompt, REACT-BRIDGE-DELIVER concept, missing site content problem, fix priority recs. Section 2 (the 18 conflicts) is the most useful part.

### 4. REACT-BRIDGE-DELIVER SPEC
**File:** `BRAIN_DOCS/doc-mvpscriptbella-natural-response-architecture-20260420.md`
**D1:** `doc-mvpscriptbella-natural-response-architecture-20260420`

Architecture for natural conversation: REACT (acknowledge) → BRIDGE (transition) → DELIVER (script). Examples, implementation spec, safety nets. Approved direction by Trent.

### 5. EXISTING FIX SPEC (INCOMPLETE — needs revision)
**File:** `BRAIN_DOCS/doc-mvpscriptbella-fix-spec-20260420.md`
**D1:** `doc-mvpscriptbella-fix-spec-20260420`

5 sprints of prompt fixes. Sprint 1 (conflict resolution) + Sprint 5 (stall 1-2 text) are valid. Sprint 2 (REACT-BRIDGE-DELIVER) is valid. Sprint 3 (site content) is valid. Sprint 4 (voice-agent binding) correctly descoped.

**WHAT'S MISSING FROM THIS SPEC:** The entire stage machine restructure. See Section 3 below.

### 6. STATUS REPORT (has one error)
**File:** `BRAIN_DOCS/doc-mvpscriptbella-status-report-20260420.md`
**D1:** `doc-mvpscriptbella-status-report-20260420`

**ERROR on line 70:** Says "Trent direction: REMOVE bella_opener." WRONG. Trent corrected this during session — bella_opener STAYS. Both hardcoded script + consultant freestyle data coexist. See Section 4 below.

---

## SECTION 1: WHAT THE CANONICAL SCRIPT ACTUALLY SAYS

### Stage flow:

```
WOW 1: Research Intro (high/low data variants)
WOW 2: Reputation Trial (strong data / skip)
WOW 3: ICP + Problem + Solution (strong/medium/low — uses {consultantICPLine})
WOW 4: Conversion / CTA (strong/medium/low — uses {consultantConversionLine})
WOW 5: Alignment Bridge ("Perfect — that's exactly what your agent team runs against")
WOW 6: Explore or Recommend (prospect chooses: go deeper or get recommendation)
WOW 7: Source Check ("Apart from referrals, where is most new business coming from?")
  → RECOMMENDATION (4 variants based on routing.priority_agents)
  → CLOSE (book 20-min onboarding call)
  → OBJECTION HANDLING (10 handlers + universal recovery)
```

### What is NOT in the canonical script:

- NO ROI calculations or dollar figures anywhere
- NO deep-scrape dependent stages (no hiring wedge assertion, no ads transparency deep-dive)
- NO channel stages (ch_ads, ch_website, ch_phone, ch_old_leads, ch_reviews)
- NO roi_delivery stage
- NO "How many leads per month?" / "What's your revenue?" capture questions
- NO email close — always booking an onboarding call
- Only stat used: "up to 4x more conversions" (benchmark, not calculated)

### What IS consultant-scripted (must be spoken word-for-word):

- WOW 3 strong: `{consultantICPLine}` = `icpAnalysis.icpNarrative`
- WOW 4 strong: `{consultantConversionLine}` = `conversionEventAnalysis.conversionNarrative`
- Recommendation uses `routing.priority_agents` to select variant

### What IS freestyle context (for REACT portions only):

- `bella_opener` — consultant opening insight
- `scriptFills.website_positive_comment` — site strength
- `conversationHooks` — pre-built reactions
- Agent knowledge — product capabilities
- Site content (NOT YET IN PROMPT — future sprint)

---

## SECTION 2: WHAT THE BRIDGE CURRENTLY IMPLEMENTS

### Current bridge stage machine (buildStageDirective, ~lines 1746-2200):

```
stall 1: Research Intro (hardcoded — OLD TEXT, not canonical)
stall 2: Reputation Trial (Google rating gated — skip if no rating)
stall 3: ICP (uses consultant icpNarrative ✅)
stall 4: Pre-training Connect (hardcoded generic — NOT in canonical script)
stall 5: Conversion Events (uses consultant convNarrative ✅)
stall 6: Audit Transition ("opportunity-audit questions" — canonical says "quick questions")
stall 7: Lead Source (3 variants based on ads/phone signals)
stall 8: Lead Source Deep (multi-signal branching — DEEP-SCRAPE DEPENDENT)
stall 9: Hiring Wedge (topHiringWedge — DEEP-SCRAPE DEPENDENT)
stall 10: Provisional Recommendation (only 2 agents, no close)
  → anchor_acv stage
  → Channel stages: ch_ads, ch_website, ch_phone, ch_old_leads, ch_reviews
  → Each channel: discovery questions → ROI calculation → recommendation
  → roi_delivery stage (combined ROI total)
  → close
```

### Structural mismatch summary:

| Canonical Script | Bridge Code | Status |
|-----------------|-------------|--------|
| WOW 1: Research Intro | stall 1 | Text mismatch (old vs canonical) |
| WOW 2: Reputation Trial | stall 2 | Text mismatch (similar intent, different words) |
| WOW 3: ICP | stall 3 | ✅ ALIGNED (uses consultant icpNarrative) |
| WOW 4: Conversion/CTA | stall 5 | ✅ ALIGNED (uses consultant convNarrative) — but numbering offset |
| WOW 5: Alignment Bridge | Nothing equivalent | MISSING — no alignment bridge stall |
| WOW 6: Explore or Recommend | Nothing equivalent | MISSING — prospect never gets choice |
| WOW 7: Source Check | stall 7 (partial) | Similar but different framing |
| Recommendation (4 variants) | stall 10 (weak, only 2 agents) | MAJOR GAP — need 4 full variants with close CTA |
| Close (booking) | close stage (email-based) | WRONG — must be onboarding call booking |
| 10 Objection Handlers | Not implemented | COMPLETELY MISSING |
| Universal Recovery | Not implemented | COMPLETELY MISSING |
| --- | stall 4: Pre-training Connect | SHOULD NOT EXIST — not in canonical |
| --- | stall 8: Lead Source Deep | SHOULD NOT EXIST — deep-scrape dependent |
| --- | stall 9: Hiring Wedge | SHOULD NOT EXIST — deep-scrape dependent |
| --- | Channel stages (5 channels) | SHOULD NOT EXIST — ROI capture flow |
| --- | roi_delivery stage | SHOULD NOT EXIST — no ROI in MVP |
| --- | anchor_acv stage | SHOULD NOT EXIST — old flow |

---

## SECTION 3: WHAT THE EXISTING FIX SPEC COVERS VS WHAT'S ACTUALLY NEEDED

### What fix spec Sprint 1+5 addresses (VALID, still do this):
- Replace DELIVER_THIS XML with ===SPEAK EXACTLY=== markers
- Fix sanitizer and artifact detector for new markers
- Reframe identity line (demonstration → consultation)
- Kill 4-sentence max rule
- Rewrite Output Rule 5 (verbatim rule)
- Separate freestyle context from script sections
- Remove dead ROI output rules
- Fix audit language
- Remove Rule 1 XML conflict
- Update stall 1+2 text to canonical

### What fix spec Sprint 2 addresses (VALID):
- REACT-BRIDGE-DELIVER turn structure
- REDIRECT rule
- stall_turns safety net

### What fix spec Sprint 3 addresses (VALID, future):
- Site content injection into prompt

### WHAT IS NOT IN ANY SPRINT (the actual structural work):
1. **Remove stall 4** (Pre-training Connect — not in canonical script)
2. **Remove stall 8** (Lead Source Deep — deep-scrape dependent)
3. **Remove stall 9** (Hiring Wedge — deep-scrape dependent)
4. **Remove anchor_acv stage** (old flow)
5. **Remove ALL channel stages** (ch_ads, ch_website, ch_phone, ch_old_leads, ch_reviews)
6. **Remove roi_delivery stage**
7. **Remove ALL ROI calculation code paths**
8. **Add WOW 5: Alignment Bridge** (new stall)
9. **Add WOW 6: Explore or Recommend** (new stall — prospect chooses)
10. **Restructure recommendation** — 4 variants (ALL 3, Alex+Chris, Alex+Maddie, Alex Only) with full text from canonical script including close CTA
11. **Add Close stage** — booking onboarding call, not email
12. **Add Objection Detection + Routing** — detect 10 objection types, route to correct handler
13. **Add 10 Objection Handler scripts** — all from canonical script
14. **Add Universal Recovery** — stall fallback when prospect goes quiet
15. **Renumber stalls** to match canonical WOW 1-7 (currently stall numbering doesn't match WOW numbering)

---

## SECTION 4: CORRECTIONS TO PRIOR DOCS

### bella_opener — STAYS (status report says REMOVE — that's WRONG)
Trent corrected during session: bella_opener stays. Both modes coexist:
- Hardcoded script = structural beats, flow control, questions
- Consultant data (bella_opener, conversationHooks, website_positive_comment) = freestyle fuel for REACT portions

### Consultant narratives ARE scripted (not just context)
The diagnostic correctly identifies this, but the fix spec doesn't fully internalize it. When the canonical script says `{consultantICPLine}`, that consultant narrative must be spoken WORD FOR WORD by Bella. It's not "context for freestyle" — it IS the script for that stall.

### "Up to 4x" is the ONLY stat
Canonical script uses "up to 4x more conversions" as a benchmark in recommendation variants. No other dollar figures, no calculated ROI, no "conservative estimate." Agent knowledge can keep this benchmark. Everything else ROI-related must be unreachable.

---

## SECTION 5: WHAT T9 NEEDS TO PRODUCE

An updated architectural plan that covers:

1. **Stage machine restructure** — new stall numbering, what to remove, what to add, what to keep
2. **Recommendation routing logic** — how to select which of 4 variants based on routing.priority_agents
3. **Objection detection** — how bridge detects which of 10 objection types (or unknown) and routes to handler
4. **Close flow** — booking-focused close replacing email close
5. **Integration with Sprint 1 prompt fixes** — the prompt conflict fixes are still valid and should ship first or alongside
6. **Integration with REACT-BRIDGE-DELIVER** — the natural conversation architecture applies to ALL stalls including new ones
7. **What code to DELETE** — specific line ranges in bridge/src/index.ts for channels, ROI, dead stalls
8. **What code to ADD** — new stalls, recommendation variants, objection handlers, close
9. **Sprint ordering** — what ships in what order, canary between each

The existing fix spec sprints 1-3 slot IN as part of this larger plan. They don't replace it.

---

## SECTION 6: FILE REFERENCE

| File | What | Read? |
|------|------|-------|
| `BRAIN_DOCS/doc-bella-mvp-script-final-20260420.md` | CANONICAL SCRIPT — read FIRST | MANDATORY |
| `BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md` | Full pipeline architecture | MANDATORY |
| `BRAIN_DOCS/doc-mvpscriptbella-make-her-sing-diagnostic-20260420.md` | 18 prompt conflicts + pipeline status | MANDATORY |
| `BRAIN_DOCS/doc-mvpscriptbella-natural-response-architecture-20260420.md` | REACT-BRIDGE-DELIVER spec | MANDATORY |
| `BRAIN_DOCS/doc-mvpscriptbella-fix-spec-20260420.md` | Existing fix spec (INCOMPLETE) | Read after above |
| `BRAIN_DOCS/doc-mvpscriptbella-status-report-20260420.md` | Status report (bella_opener error) | Read after above |
| `workers/bridge/src/index.ts` | The actual bridge code (3340 lines) | Reference as needed |
| `workers/bridge/src/buildStageDirective-v1.ts` | DEAD CODE — not imported, but has correct no-ROI channel recs | Reference only |
| `workers/bridge/src/bella-v1-script.ts` | DEAD CODE — all BELLA_SCRIPT templates | Reference only |

---

## SECTION 7: TRENT'S KEY DIRECTIVES (from session transcript)

1. Consultant-generated lines ARE script — must be spoken word-for-word
2. bella_opener STAYS — freestyle fuel, not removed
3. ROI is GONE — no dollar figures, no calculated ROI, "up to 4x" benchmark only
4. Deep-scrape stages are GONE — no hiring wedge assertion, no ads deep-dive
5. Close = book onboarding call, not send email
6. Freestyle = REACT to unexpected input using consultant context + site content + agent KB
7. Site content blob should eventually reach prompt (Sprint 3 — future)
8. Voice-agent public URL is 1042 time bomb (descoped for now — Deepgram calls externally)
