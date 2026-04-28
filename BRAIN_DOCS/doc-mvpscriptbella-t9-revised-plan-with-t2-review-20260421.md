# MVPScriptBella — T9 REVISED PLAN + T2 CODE LEAD REVIEW
### Filed: 2026-04-21 AEST | Authors: T9 Architect (plan) + T2 Code Lead (review comments)
### Status: PLAN APPROVED BY T2 (~95% aligned with deep analysis) — NEEDS TRENT DECISIONS ON 5 ITEMS
### Prerequisite reading: doc-mvpscriptbella-dual-stage-machine-analysis-20260421

---

> **T2 REVIEW SUMMARY:** This revised plan is ~95% aligned with the deep analysis T2 conducted with Trent. First version was 85% — this one incorporates the dual stage machine discovery, Option B recommendation, all Trent directives, and correctly reprioritizes stage machine restructure over prompt fixes. Objection descoping for MVP is a good independent call by T9. Plan is executable. Minor gaps noted inline below.

---

## THE CORE INSIGHT (T9, confirmed by T2 analysis)

NaturalBella FROZEN delivers consultant scripts correctly. Same Gemini. Same prompt structure. Same bridge architecture. The prompt engineering isn't broken — the CONTENT flowing into the prompt is wrong. Bridge is feeding Gemini old stalls, old flow, old text. Fix what goes IN, Gemini will deliver it.

This reorders everything. Prompt conflict fixes (Sprint 1 from old spec) drop in priority. Stage machine alignment is the primary work.

> **T2 NOTE:** This reframe is correct and important. Our diagnostic confirmed pipeline is mechanically sound (KV, bindings, secrets — all clean). Canary proved consultant data IS in KV. Bridge IS reading it. The problem is bridge's inline buildStageDirective() generates wrong content from correct data.

---

## THE TWO-BRAIN PROBLEM

Brain DO (workers/brain/moves.ts + flow.ts):
- Flow: greeting → wow → recommendation → close
- Has canonical script text (10 surgical changes from build session)
- 361 tests, 9 Phase 2 skips
- Receives events from fast-intel
- NOT what drives Gemini prompts

Bridge (workers/bridge/src/index.ts inline):
- Flow: wow (9 stalls) → anchor_acv → channels → ROI → close
- Has OLD NaturalBella stage content
- IS what drives Gemini prompts
- IS what the prospect hears

These two stage machines are divergent. Both exist in the same stack. Neither knows about the other's flow.

> **T2 NOTE:** T2 deep analysis confirmed this from frozen-bella-natural-stack source code. Brain has individual WOW steps (wow_1 through wow_7), structured StageDirective objects (speak, allowedMoves, extract, advanceOn), and agent-named channels (ch_alex, ch_chris, ch_maddie). Bridge has single wow stage with stalls 0-10, topic-named channels (ch_ads, ch_website, ch_phone), and returns plain string prompts. Bridge only calls brain DO for extraction/scribe, NOT for stage decisions. Full details: doc-mvpscriptbella-dual-stage-machine-analysis-20260421.

---

## THREE OPTIONS FOR ALIGNMENT

### Option A — Brain DO becomes authority, bridge becomes transport
- Bridge calls brain DO per turn for stage directive + state management
- Bridge only handles: KV read, prompt assembly, Gemini streaming, TTS
- Pro: Single source of truth. Brain's 361 tests validate the live flow.
- Con: Adds service call latency per turn. Brain DO wasn't designed for this request/response pattern. Significant refactor of both workers.

> **T2 NOTE:** T2 latency analysis showed service binding overhead is sub-ms to low single-digit ms (separate V8 isolate, internal routing). Cold start adds 5-50ms. Against Gemini's 3-5s TTFB, this is negligible (<1%). The real concern is reliability — extra service call = extra failure point on voice hot path. Not recommended for MVP but viable for V3.

### Option B — Port brain's canonical content into bridge, fix bridge inline
- Copy the correct stage directives + flow from brain's moves.ts into bridge's buildStageDirective
- Bridge stays self-contained conversation engine
- Pro: Fastest to ship. No inter-worker latency. NaturalBella FROZEN proves this architecture works.
- Con: Two codebases with same content. Brain's tests validate brain, not bridge.

> **T2 NOTE:** T2 recommends this. Canonical script is only 264 lines — new buildStageDirective is bounded in scope. Brain's moves.ts is a REFERENCE for correct content, not a drop-in import (different structure, has ROI/channels that canonical removes, missing 9 objection handlers).

### Option C — Shared module, both import
- Extract stage machine (directives, flow, gating) into a shared package
- Both brain and bridge import it
- Pro: Single source of truth, both get it
- Con: Most refactoring. Package management overhead. Deployment coupling.

> **T2 NOTE:** T2 recommends Option C as the POST-MVP path (not Option A as T9 suggests for V3). Shared module gives single source of truth with ZERO latency (same-isolate import, no service binding call). Option A's service binding adds an unnecessary network dependency. Option C achieves the same architectural goal without the latency/reliability penalty.

### T9 recommendation: Option B for MVP, plan for Option A in V3.

> **T2 AMENDMENT:** Option B for MVP ✅ agreed. For V3, prefer Option C (shared module) over Option A (service binding). Same single-source-of-truth benefit, zero latency overhead.

---

## WHAT HAPPENS TO BRAIN DO FOR NOW

Stays as-is. Its moves.ts is the REFERENCE for what the bridge should say. Its flow.ts is the REFERENCE for how stages progress. Its tests validate the canonical script logic. Bridge gets aligned to match it. Two codebases exist short-term — accepted tech debt, retired when V3 ships.

> **T2 NOTE:** Agreed. Brain DO continues handling extraction events via CALL_BRAIN binding. No changes to brain for MVP.

---

## MVP STAGE MACHINE (what bridge gets)

```
wow (WOW 1-7) → recommend → close → done
```

No objections (descoped per Trent's call).
No ROI. No channels. No anchor_acv. No deep-scrape stages.

### WOW Stalls (7 total):

| WOW | Name | Content Source | Key Data |
|-----|------|---------------|----------|
| 1 | Research Intro | Canonical script (high/low data variants) | firstName, businessName, customerType |
| 2 | Reputation Trial | Canonical script (skip if no Google rating) | googleRating, googleReviews |
| 3 | ICP + Problem + Solution | Consultant icpNarrative — WORD FOR WORD | icpAnalysis.icpNarrative (strong), icpProblems/icpSolutions (medium), bellaCheckLine (fallback) |
| 4 | Conversion / CTA | Consultant conversionNarrative — WORD FOR WORD | conversionEventAnalysis.conversionNarrative (strong), agentTrainingLine (medium), primaryCTA (fallback) |
| 5 | Alignment Bridge | Canonical script | Generic — "Perfect, that's exactly what your agent team runs against" |
| 6 | Explore or Recommend | Canonical script | Prospect chooses: deeper or recommendation |
| 7 | Source Check | Canonical script | "Apart from referrals, where is most new business coming from?" |

> **T2 NOTE:** WOW 3 and WOW 4 consultant lines are SCRIPT, not context. ===SPEAK EXACTLY=== markers apply to consultant narratives just as much as hardcoded text. This was a key Trent directive from the 2026-04-20 session — "consultant data is also scripting. The consultant script must be repeated word for word."

### Recommendation:

4 variants selected by routing.priority_agents:
- All 3 (Alex + Chris + Maddie)
- Alex + Chris
- Alex + Maddie
- Alex Only (default)

Each variant has close CTA baked in: "would you like to experience them live first, or lock in your 20-minute onboarding?"

### Close:

Booking onboarding call. "What's the best day and time for you?" Not email. Not trial activation button.

---

## TWO GREETINGS — SCRIPTED + CONSULTANT

Both exist. Both stay.

1. **Scripted greeting (WOW 1 hardcoded text):** "So {name}, your pre-trained {business} agents are ready to go..."
2. **Consultant bella_opener:** freestyle context for REACT portions between scripted beats

bella_opener is NOT the script. It's fuel for when Bella needs to react naturally to prospect input. The scripted WOW stalls are what she DELIVERS. The consultant data (bella_opener, conversationHooks, website_positive_comment) is what she draws on when the prospect says something unexpected.

> **T2 NOTE:** Prior status report (doc-mvpscriptbella-status-report-20260420) incorrectly says "Trent direction: REMOVE bella_opener." WRONG. Trent corrected during session — bella_opener STAYS. This section correctly captures the correction.

---

## NATURAL FREESTYLE + KNOWLEDGE BASE + SITE BLOB

Bella needs three knowledge sources for off-script responses:

1. **Agent Knowledge (hardcoded)** — Alex, Chris, Maddie capabilities, benchmarks ("up to 4x")
2. **Consultant freestyle data** — bella_opener, conversationHooks, website_positive_comment, copyAnalysis.bellaLine
3. **Site content blob** — page_content.markdown from fast-intel. Currently in KV but NOT injected into bridge prompt. Needs to be.

When prospect goes off-script, Bella draws from these to respond naturally (1-2 sentences), then bridges back to her scripted beat. This is the REACT-BRIDGE-DELIVER architecture — but it only works if the DELIVER content is correct first.

> **T2 NOTE:** Confirmed from code — bridge NEVER reads page_content.markdown from KV. Raw site content sits in KV envelope unused. Sprint 4 (site content injection) addresses this. Not blocking for MVP but limits Bella's ability to answer "did you see our FAQs?" type questions.

---

## THE ALIGNMENT STAGE (WOW 4 — WHY IT MATTERS)

WOW 4 is where consultant's conversionEventAnalysis lands. This tells the prospect:
- "Your website primarily drives {primaryCTA}"
- "Chris is ideal for {this CTA}, Alex for {that CTA}"
- The CTA-to-agent mapping that directly informs the recommendation

Without this stage delivering correctly, the recommendation feels arbitrary. With it, the recommendation feels like a logical conclusion. This is the critical bridge from "I know your business" to "here's what I recommend."

The consultant already generates this. It's in KV. The current bridge stall 5 uses it. The fix is: renumber to WOW 4, update text to canonical, ensure conversionNarrative lands word-for-word.

> **T2 NOTE:** Good architectural insight. WOW 4 is the narrative bridge that makes the recommendation feel earned, not arbitrary. Canary confirmed conversionNarrative is populated in KV — it just needs to reach Gemini via the correct stall.

---

## WIRING CHECK — WHY TRENT IS RIGHT

NaturalBella FROZEN has:
- Correct consultant data flowing → correct stage directives referencing it → Gemini delivers it

MVPScriptBella has:
- Correct consultant data flowing (pipeline verified clean in diagnostic) → WRONG stage directives (old flow, old text, wrong stall numbers) → Gemini can't deliver what it's not given

Fix the stage directives, the scripts will land. The 18 prompt conflicts are secondary — they cause paraphrasing, not wrong content. Wrong content is a stage machine problem.

That said, some prompt fixes still matter (remove "4 sentences max", remove ROI rules, fix identity line). Bundle those with the stage work, don't make them a separate sprint.

> **T2 NOTE:** Agreed on bundling. The 18 prompt conflicts (documented in doc-mvpscriptbella-make-her-sing-diagnostic-20260420) are still real — XML tag paradox, sanitizer stripping DELIVER_THIS, competing opener text, identity framing. But they cause paraphrasing, not wrong content. Fix content first (stage machine), then fix delivery fidelity (prompt cleanup). Bundling S3 into S1 makes sense.

---

## REVISED SPRINT ORDER

| Sprint | What | Size |
|--------|------|------|
| **S1** | Stage machine restructure — remove stalls 4/8/9, channels, ROI, anchor_acv. Renumber to WOW 1-7. Add WOW 5 (alignment bridge) + WOW 6 (explore/recommend). Update all stall text to canonical. Port consultant narrative handling from brain's moves.ts reference. Simplify State interface. New gateOpen() + advance(). | LARGE |
| **S2** | Recommendation + Close — 4 variants with routing logic, booking close. Port from canonical script. | MEDIUM |
| **S3** | Prompt cleanup — fix identity line, kill sentence limit, remove ROI output rules, standardize markers, separate freestyle context. Bundle with S1 or run after. | MEDIUM |
| **S4** | Site content injection — inject page_content.markdown (or condensed summary) into bridge prompt as freestyle knowledge. | SMALL |
| **S5** | REACT-BRIDGE-DELIVER — natural turn structure for all stalls. | MEDIUM |

S1 is the big one. Gets the right content flowing to Gemini. Canary after S1 should show Bella speaking canonical script with consultant data landing.

S3 can merge into S1 (prompt fixes are small, reduce risk of doing them alongside structural work).

S4 and S5 are post-launch polish — nice to have but Bella works without them if S1-S3 ship.

> **T2 NOTE:** Sprint order is correct. Two additions for future sprints:
> 1. **stall_turns safety net** (from REACT-BRIDGE-DELIVER spec) — if Bella gets stuck on a stall for 2+ turns, force delivery. Should be part of S5.
> 2. **Gate logic detail needed for S1 spec:** Most WOW stalls gate on "prospect responded" (stall count), but WOW 2 gates on Google rating data existing, WOW 6 gates on prospect choice (deeper vs recommend). This is spec-phase detail, not plan-phase.

---

## WHAT MUST BE REMOVED FROM BRIDGE (S1 scope)

- Stall 4 (Pre-training Connect) — not in canonical
- Stall 8 (Lead Source Deep / multi-signal branching) — deep-scrape dependent
- Stall 9 (Hiring Wedge) — deep-scrape dependent
- anchor_acv stage
- anchor_timeframe stage
- ALL 5 channel stages (ch_ads, ch_website, ch_phone, ch_old_leads, ch_reviews)
- roi_delivery stage
- buildQueue() function
- rebuildFutureQueueOnLateLoad()
- calcAgentROI() + runCalcs()
- All Inputs fields for channel capture (ads_leads, web_leads, phone_volume, etc.)
- All extraction logic for captured inputs

## WHAT MUST BE ADDED TO BRIDGE (S1 + S2 scope)

- WOW 5: Alignment Bridge
- WOW 6: Explore or Recommend
- Recommendation stage — 4 variants with routing logic (S2)
- Close stage — booking onboarding (S2)
- New gateOpen() for simplified stage machine
- New advance() for wow → recommend → close → done
- Simplified State interface

## WHAT STAYS BUT GETS RENUMBERED (S1 scope)

- Stall 1 → WOW 1 (Research Intro) — text update to canonical
- Stall 2 → WOW 2 (Reputation Trial) — text update to canonical
- Stall 3 → WOW 3 (ICP) — ALIGNED, uses consultant icpNarrative ✅
- Stall 5 → WOW 4 (Conversion/CTA) — ALIGNED, uses consultant convNarrative ✅
- Stall 6 → removed (was Audit Transition — replaced by WOW 5 Alignment Bridge)
- Stall 7 → WOW 7 (Source Check) — text update to canonical framing

---

## DECISIONS NEEDED FROM TRENT

1. **Option B confirmed?** (Port brain's canonical content to bridge, bridge stays conversation engine, brain DO stays as-is for now)
2. **S1 + S3 merged or separate?** T9 recommends merge. T2 agrees — prompt fixes are small diffs alongside stage restructure.
3. **Site content blob (S4) — block launch or post-launch?** Bella functions without it (consultant summaries cover most questions). But she can't answer "did you see our pricing page?" without it.
4. **WOW 6 "go deeper" path** — if prospect says deeper, Bella does WOW 7 (source check) then recommends? Or skip WOW 7 and recommend regardless?
5. **Anything else descoped for MVP besides objections and ROI?**

---

## DOCUMENTS REFERENCED

| Doc ID | Title | Location |
|--------|-------|----------|
| doc-bella-mvp-script-final-20260420 | THE canonical script (264 lines) | D1 + BRAIN_DOCS |
| doc-bella-architecture-how-it-works-20260420 | Full pipeline architecture | D1 + BRAIN_DOCS |
| doc-mvpscriptbella-make-her-sing-diagnostic-20260420 | 18 prompt conflicts + pipeline status | D1 + BRAIN_DOCS |
| doc-mvpscriptbella-natural-response-architecture-20260420 | REACT-BRIDGE-DELIVER spec | D1 + BRAIN_DOCS |
| doc-mvpscriptbella-fix-spec-20260420 | Existing fix spec (INCOMPLETE — superseded by this plan) | D1 + BRAIN_DOCS |
| doc-mvpscriptbella-t2-architect-briefing-20260421 | T2 structural gap analysis | D1 + R2 + BRAIN_DOCS |
| doc-mvpscriptbella-dual-stage-machine-analysis-20260421 | T2 deep analysis — brain vs bridge vs shared module | D1 + R2 + BRAIN_DOCS |
| doc-mvpscriptbella-status-report-20260420 | Status report (⚠️ bella_opener error — corrected in this doc) | D1 + BRAIN_DOCS |
