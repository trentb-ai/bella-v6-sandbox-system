# MVPScriptBella — Dual Stage Machine Analysis
### Filed: 2026-04-21 AEST | Author: T2 Code Lead
### Status: ARCHITECTURAL DECISION REQUIRED — Trent must choose path forward
### Context: T9 Architect discovered two parallel stage machines exist. T2 deep analysis follows.

---

## HOW WE GOT HERE

Yesterday (2026-04-20), T9 Architect + Codex ran a diagnostic session with Trent on MVPScriptBella. They found 18 prompt conflicts causing Gemini to ignore scripted content, designed REACT-BRIDGE-DELIVER architecture for natural conversation, and wrote a 5-sprint fix spec.

Today (2026-04-21), T2 reviewed the full session transcript and the canonical script. T2 found the fix spec was INCOMPLETE — it addressed prompt engineering but missed that the bridge stage machine doesn't match the canonical script at all. The canonical script has 7 WOW → recommendation → close → objection handling. Bridge has 10 stalls → channels → ROI → close.

T2 wrote an architect briefing and sent to T9. T9 then discovered something bigger: TWO separate stage machines exist in the codebase. This changes everything.

---

## THE TWO STAGE MACHINES

### 1. Brain DO (workers/brain/src/moves.ts)

Location: `frozen-bella-natural-stack/brain/src/moves.ts` (and `workers/brain/src/moves.ts` in MVPScriptBella)

Structure:
- 8 individual WOW steps: wow_1_research_intro, wow_2_reputation_trial, wow_3_icp_problem_solution, wow_4_conversion_action, wow_5_alignment_bridge, wow_6_scraped_observation, wow_7_explore_or_recommend, (plus wow_8 variants)
- `recommendation` stage with 4 variants (buildRecommendationDirective) — ALL 3, Alex+Chris, Alex+Maddie, Alex Only
- Agent-named channels: ch_alex, ch_chris, ch_maddie
- `roi_delivery`, `optional_side_agents`, `close`
- Close has sub-stages: offer, pricing objection, email, confirmed, agent handoff
- `just_demo` path that skips channels/ROI and goes straight to close
- 361 tests, 9 Phase 2 skips
- Returns structured `StageDirective` objects with: speak text, allowedMoves, extract fields, advanceOn conditions, objective

Each directive is structured:
```typescript
{
  objective: string,           // what this turn achieves
  allowedMoves: string[],      // valid next transitions
  speak: string,               // what Bella says
  contextNotes: string[],      // grounding context
  extract: string[],           // what data to capture from prospect
  advanceOn: string[],         // conditions to advance to next stage
}
```

### 2. Bridge (workers/bridge/src/index.ts inline)

Location: `frozen-bella-natural-stack/bridge/src/index.ts` lines ~1744-2200 (inline function)
Also: `workers/bridge/src/index.ts` in MVPScriptBella (same code)

Structure:
- Single `wow` stage with stalls 0-10 (stall counter increments each turn)
- `anchor_acv`, `anchor_timeframe`
- Topic-named channels: ch_ads, ch_website, ch_phone, ch_old_leads, ch_reviews
- `roi_delivery`, `close`
- gateOpen() checks: captured inputs per stage (e.g. ch_ads needs ads_leads + ads_conversions)
- advanceStage() logic: wow → anchor_acv → anchor_timeframe → channels (from queue) → roi_delivery → close
- Returns plain string (prompt text for Gemini) — no structured directive

Stage progression:
```
wow (stalls 0-10) → anchor_acv → anchor_timeframe → ch_ads/ch_website/ch_phone (queued) → roi_delivery → close
```

---

## HOW THEY RELATE (INTENDED ARCHITECTURE)

### Brain DO = choreographer
Brain is SUPPOSED to be the authority on: what Bella says, what to extract, when to advance. It returns structured directives with all the information bridge needs.

### Bridge = executor
Bridge is SUPPOSED to: receive brain's directive, wrap it into Gemini prompt format, handle audio streaming, manage transport.

### What ACTUALLY happens
Bridge ignores brain for stage decisions. Bridge has its own inline `buildStageDirective()` that generates prompt text independently. Bridge only calls brain DO (via CALL_BRAIN service binding) for:
- Extraction (parsing prospect utterances into structured data)
- Scribe (transcription logging)
- Error/failure reporting

The two stage machines diverged because bridge was never wired to use brain's directives for stage content. Someone built the correct canonical flow in brain's moves.ts (2026-04-14), but bridge kept running its old inline copy.

---

## NEITHER MATCHES THE CANONICAL SCRIPT

### The Canonical Script (doc-bella-mvp-script-final-20260420.md)

```
WOW 1: Research Intro (high/low data variants)
WOW 2: Reputation Trial (strong data or skip)
WOW 3: ICP / Problem / Solution (uses {consultantICPLine})
WOW 4: Conversion / CTA (uses {consultantConversionLine})
WOW 5: Alignment Bridge
WOW 6: Explore or Recommend (prospect chooses)
WOW 7: Source Check
→ RECOMMENDATION (4 variants: ALL 3, Alex+Chris, Alex+Maddie, Alex Only)
→ CLOSE (book 20-min onboarding call — NOT email)
→ OBJECTION HANDLING (10 handlers + universal recovery + pricing handler)
```

NO ROI. NO channels. NO deep-scrape dependent stages. NO dollar figures. Only stat: "up to 4x more conversions."

### Brain DO vs Canonical Script

| Canonical | Brain DO | Match? |
|-----------|----------|--------|
| WOW 1: Research Intro | wow_1_research_intro | ✅ Structure matches (has 4-tier priority) |
| WOW 2: Reputation Trial | wow_2_reputation_trial | ✅ Structure matches (has skip logic) |
| WOW 3: ICP | wow_3_icp_problem_solution | ✅ Structure matches (uses icpNarrative) |
| WOW 4: Conversion/CTA | wow_4_conversion_action | ✅ Structure matches (uses convNarrative) |
| WOW 5: Alignment Bridge | wow_5_alignment_bridge | ✅ EXISTS (handles correction/pushback) |
| WOW 6: Explore or Recommend | wow_7_explore_or_recommend | ⚠️ Similar but numbered differently, has wow_6_scraped_observation between |
| WOW 7: Source Check | Part of wow_7_explore_or_recommend | ⚠️ Combined, not separate |
| Recommendation (4 variants) | recommendation (4 variants) | ✅ EXISTS (buildRecommendationDirective) |
| Close (booking) | close (with sub-stages) | ⚠️ Brain has email close, not onboarding booking |
| 10 Objection Handlers | Pricing objection only | ❌ Only 1 of 10 exists |
| Universal Recovery | Not implemented | ❌ MISSING |
| --- | wow_6_scraped_observation | ❌ NOT in canonical — deep-scrape dependent |
| --- | ch_alex, ch_chris, ch_maddie | ❌ NOT in canonical — no channels in MVP |
| --- | roi_delivery | ❌ NOT in canonical — no ROI in MVP |
| --- | optional_side_agents | ❌ NOT in canonical |
| --- | anchor_acv | ❌ NOT in canonical |

**Brain is ~70% aligned.** WOW 1-5 + recommendation structure match. But it has extra stages (channels, ROI, deep-scrape observation) that canonical removes, and is missing 9 of 10 objection handlers + universal recovery.

### Bridge vs Canonical Script

| Canonical | Bridge | Match? |
|-----------|--------|--------|
| WOW 1 | stall 1 | ❌ Old text, not canonical wording |
| WOW 2 | stall 2 | ⚠️ Similar intent, different wording |
| WOW 3 | stall 3 | ✅ Uses consultant icpNarrative |
| WOW 4 | stall 5 | ✅ Uses consultant convNarrative (numbering offset) |
| WOW 5: Alignment Bridge | MISSING | ❌ No equivalent stall |
| WOW 6: Explore or Recommend | MISSING | ❌ No equivalent stall |
| WOW 7: Source Check | stall 7 (partial) | ⚠️ Different framing |
| Recommendation (4 variants) | stall 10 (weak, 2 agents only) | ❌ MAJOR GAP |
| Close (booking) | close (email-based) | ❌ Wrong close type |
| 10 Objection Handlers | MISSING | ❌ Not implemented |
| Universal Recovery | MISSING | ❌ Not implemented |
| --- | stall 4 (Pre-training Connect) | ❌ NOT in canonical |
| --- | stall 8 (Lead Source Deep) | ❌ Deep-scrape dependent |
| --- | stall 9 (Hiring Wedge) | ❌ Deep-scrape dependent |
| --- | anchor_acv, anchor_timeframe | ❌ NOT in canonical |
| --- | 5 channel stages | ❌ NOT in canonical |
| --- | roi_delivery | ❌ NOT in canonical |

**Bridge is ~30% aligned.** Only stalls 3 and 5 (consultant-driven) match. Everything else is wrong structure.

---

## THREE OPTIONS EVALUATED

### Option A: Bridge delegates to Brain DO via service binding each turn

Bridge calls `env.CALL_BRAIN.fetch("/stage-directive", { state, intel })` every turn. Brain returns structured directive. Bridge wraps into Gemini prompt.

**Pros:**
- Brain already has correct WOW 1-5 + recommendation (4 variants)
- 361 tests validate brain's stage logic
- Single source of truth — no duplication
- Matches V3 target architecture (brain = choreographer)
- Brain's structured StageDirective is richer (speaks, extract, advanceOn, allowedMoves)

**Cons:**
- LATENCY: Service binding = separate V8 isolate. Sub-ms to low single-digit ms per call. On voice hot path, this adds up. Every turn pays this tax.
- COLD START: If brain DO isolate isn't warm, first call adds 5-50ms. Voice conversation is latency-sensitive — Gemini TTFB is already 3-5s.
- SERIALIZATION: Full state + intel must be JSON serialized/deserialized each turn.
- DEBUGGING: Stage logic in brain, prompt assembly in bridge — two places to trace.
- BRAIN ISN'T CANONICAL: Brain has ROI, channels (ch_alex/chris/maddie), optional_side_agents, anchor_acv — all need removing. wow_6_scraped_observation is deep-scrape dependent. Missing 9 objection handlers + universal recovery. Still needs significant work.
- DIFFERENT CHANNEL NAMES: Brain uses agent-named channels (ch_alex), bridge uses topic-named (ch_ads). Canonical has NO channels. Wiring mismatch.

### Option B: Port canonical script fresh into bridge inline

Replace bridge's `buildStageDirective()` with new inline function matching canonical script exactly. 7 WOW → recommendation → close → objection handling. All inline, same isolate.

**Pros:**
- ZERO latency overhead — all inline, same V8 isolate
- Matches canonical script EXACTLY — no adapting brain's different structure
- Single file to debug — everything Gemini sees lives in one place
- Simpler deploy — one worker change
- No cold start risk on hot path
- Canonical script is only 264 lines — the replacement function is bounded in scope

**Cons:**
- Duplicates stage logic (brain has one version, bridge has another) — divergence continues
- No existing test suite for the new code — brain's 361 tests don't apply
- Bridge already 3340 lines — gets bigger (though old stage code gets deleted)
- Future changes need updating in two places if brain DO stays
- Doesn't move toward V3 architecture (brain as choreographer)
- Loses brain's structured StageDirective (allowedMoves, extract, advanceOn) — bridge just generates strings

### Option C: Import brain's moves.ts as a shared module (same isolate, no service call)

Extract brain's `buildStageDirective` + types into a shared package. Bridge imports directly — runs in same isolate, zero network overhead.

**Pros:**
- ZERO latency (imported code, not fetched over network)
- Single source of truth (shared module)
- Brain's 361 tests still validate the core logic
- Brain's structured StageDirective is available to bridge natively
- Clean separation: stage logic in module, prompt building in bridge
- Path toward V3 architecture without the service binding latency penalty

**Cons:**
- BRAIN ISN'T CANONICAL: Same problem as Option A — brain has ROI, channels, deep-scrape stages that need removing. Missing 9 objection handlers. Still needs modification.
- BUILD COMPLEXITY: Shared package = monorepo tooling. Workers need to import from a common location. May need workspace/packages setup.
- DEPENDENCY CHAIN: Brain's moves.ts imports from gate.ts, helpers/, types.ts, flow-constants.ts, stages/ — extracting cleanly means extracting all dependencies too.
- Brain's moves.ts is 1800+ lines with V3-specific code — trimming to canonical MVP is significant refactoring work.

---

## THE INTENDED ARCHITECTURE (what SHOULD happen)

Based on V3 target architecture (from CLAUDE.md) and the structure of brain DO's code:

```
Brain DO = CHOREOGRAPHER
  - Owns the stage machine
  - Owns the script content (what Bella says)
  - Owns gating logic (when to advance)
  - Owns extraction rules (what data to capture)
  - Returns structured StageDirective each turn

Bridge = PROMPT BUILDER + TRANSPORT
  - Receives StageDirective from brain
  - Builds Gemini system prompt (identity, rules, agent knowledge)
  - Builds turn prompt (stage directive + confirmed inputs + memory)
  - Streams Gemini response
  - Manages TTS/audio transport
  - Does NOT decide what Bella says — only HOW she says it
```

This is the correct separation of concerns. Brain knows the WHAT. Bridge knows the HOW.

The problem: this architecture requires brain to be callable from bridge on every turn. In current implementation, that's a service binding call (Option A) with latency cost. Or a shared module import (Option C) with build complexity.

---

## WHAT EACH OPTION REQUIRES IN TERMS OF WORK

### Option A work (service binding delegation):
1. Modify brain's moves.ts to match canonical script:
   - Remove: wow_6_scraped_observation, ch_alex/chris/maddie, roi_delivery, optional_side_agents, anchor_acv
   - Add: 9 missing objection handlers, universal recovery, onboarding-booking close
   - Update: wow_6 → explore_or_recommend to match canonical, wow_7 → source_check
   - Update: recommendation speak text to match canonical wording
   - Update: close to booking (not email)
2. Add /stage-directive endpoint to brain DO
3. Wire bridge to call brain for stage directives instead of using inline function
4. Remove bridge's inline buildStageDirective()
5. Update bridge prompt building to use brain's structured StageDirective
6. Test end-to-end latency impact

### Option B work (fresh inline in bridge):
1. Delete bridge's current buildStageDirective() (~450 lines)
2. Delete bridge's channel queue logic, ROI code, anchor stages
3. Write new buildStageDirective() matching canonical script:
   - 7 WOW stalls with high/medium/low data variants
   - Recommendation with 4 variants + routing logic
   - Close (booking onboarding)
   - 10 objection handlers + universal recovery + pricing
   - Stage gate logic (when to advance)
4. Apply Sprint 1 prompt fixes (===SPEAK EXACTLY=== markers, identity reframe, output rules)
5. Apply REACT-BRIDGE-DELIVER architecture to all stalls

### Option C work (shared module):
1. All of Option A step 1 (modify brain's moves.ts to match canonical)
2. Extract moves.ts + all dependencies into shared package
3. Set up monorepo workspace/packages
4. Wire bridge to import from shared package
5. Wire brain DO to import from same shared package
6. Verify build pipeline works for both workers
7. Remove bridge's inline buildStageDirective()

---

## LATENCY ANALYSIS

Current voice path latency breakdown (from diagnostic):
- Deepgram STT: ~200-500ms
- Bridge processing (KV read + prompt build): ~50-100ms
- Gemini TTFB: ~3-5s (warm), ~5-8s (cold)
- Deepgram TTS: ~200-400ms
- Total: ~3.5-6s turn latency

Adding service binding call (Option A): +1-5ms per turn (warm), +5-50ms (cold start)
Impact: Negligible on warm path. Cold start could add ~50ms but only on first turn.

Verdict: Service binding latency is NOT a practical blocker. Gemini TTFB dominates at 3-5 seconds. Adding 5ms is noise. Even cold start 50ms is <1% of total latency.

**However:** The concern is reliability, not just latency. An extra service binding call = one more failure point. If brain DO is unavailable or errors, the entire turn fails. Inline code can't fail this way.

---

## T2 RECOMMENDATION

**For MVP launch: Option B (fresh inline).**

Reasoning:
1. Canonical script is only 264 lines — the new buildStageDirective is bounded
2. Brain's moves.ts needs heavy modification to match canonical anyway — it's not "reuse", it's "rewrite while extracting"
3. Zero latency, zero extra failure points
4. One file to deploy, one file to debug
5. Sprint 1 prompt fixes + REACT-BRIDGE-DELIVER apply cleanly to fresh inline code
6. Brain DO's 361 tests cover NaturalBella's flow, not canonical MVP — they don't transfer

**For post-MVP: Option C (shared module).**

Once MVP ships and canonical flow is proven:
1. Extract bridge's new buildStageDirective into a shared package
2. Both brain DO and bridge import from same source
3. Brain's tests adapt to test canonical flow
4. Single source of truth achieved without service binding latency

**DO NOT pursue Option A (service binding).** Not because of latency (it's negligible) but because:
- Brain's moves.ts isn't canonical — needs same amount of rewriting as fresh code
- Adds a network dependency to the voice hot path (reliability risk)
- Debugging across two workers is harder
- V3 architecture can be achieved via shared module (Option C) without the drawbacks

---

## CORRECTIONS TO PRIOR DOCS

### Status report (doc-mvpscriptbella-status-report-20260420.md)
- Line 70 says "Trent direction: REMOVE bella_opener" — WRONG. Trent corrected: bella_opener STAYS. Both hardcoded script + consultant freestyle data coexist.

### Fix spec (doc-mvpscriptbella-fix-spec-20260420.md)
- Sprint 1+5 changes (prompt conflicts + stall 1-2 text) are VALID but INSUFFICIENT
- Missing the entire stage machine restructure (Section 3 of architect briefing)
- Sprint 4 correctly descoped (Deepgram calls bridge externally)

### Diagnostic (doc-mvpscriptbella-make-her-sing-diagnostic-20260420.md)
- 18 prompt conflicts analysis is CORRECT and still applies
- Pipeline status (all clean) is CORRECT
- REACT-BRIDGE-DELIVER architecture is CORRECT and still applies
- Missing site content analysis is CORRECT
- Fix priority ordering needs revision — stage machine restructure comes first, then prompt fixes apply to new code

---

## TRENT'S KEY DIRECTIVES (from session transcript + today)

1. Consultant-generated lines ARE script — must be spoken word-for-word
2. bella_opener STAYS — freestyle fuel for REACT portions, not removed
3. ROI is GONE — no dollar figures, no calculated ROI, "up to 4x" benchmark only
4. Deep-scrape stages are GONE — no hiring wedge assertion, no ads deep-dive
5. Close = book onboarding call, not send email
6. Freestyle = REACT to unexpected input using consultant context + site content + agent KB
7. Site content blob should eventually reach prompt (future sprint)
8. Voice-agent public URL is 1042 time bomb (descoped for now)
9. Latency is the killer — voice agent, every ms counts
10. Big rebuilds are the killer — reuse what's fit for purpose
11. The canonical script (doc-bella-mvp-script-final-20260420.md) is THE authority

---

## DOCUMENTS REFERENCED

| File | What |
|------|------|
| BRAIN_DOCS/doc-bella-mvp-script-final-20260420.md | THE canonical script — 264 lines, 7 WOW + rec + close + objections |
| BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md | Full pipeline architecture |
| BRAIN_DOCS/doc-mvpscriptbella-make-her-sing-diagnostic-20260420.md | 18 prompt conflicts + pipeline status |
| BRAIN_DOCS/doc-mvpscriptbella-natural-response-architecture-20260420.md | REACT-BRIDGE-DELIVER spec |
| BRAIN_DOCS/doc-mvpscriptbella-fix-spec-20260420.md | Existing fix spec (INCOMPLETE) |
| BRAIN_DOCS/doc-mvpscriptbella-t2-architect-briefing-20260421.md | Structural gap analysis + corrections |
| frozen-bella-natural-stack/brain/src/moves.ts | Brain DO stage machine (NaturalBella) |
| frozen-bella-natural-stack/bridge/src/index.ts | Bridge inline stage machine (NaturalBella) |
| workers/brain/src/moves.ts | Brain DO stage machine (MVPScriptBella) |
| workers/bridge/src/index.ts | Bridge inline stage machine (MVPScriptBella — 3340 lines) |
