# HANDOVER: BELLA COMPLIANCE + INTELLIGENCE SPRINT
## For new Claude Opus session — 28 March 2026
## Execute in tandem with Perplexity for prompt review and appendix prompting

---

## MISSION

Build a world-class closed-loop compliance and intelligence system for Bella (voice AI sales agent).
Two CC sessions. Perplexity validates each sprint prompt before CC executes.
This is the first voice agent compliance system of its kind. Publication target: April-May 2026.

---

## SESSION START PROTOCOL

### Step 1 — Pull these Brain docs FIRST (via Cloudflare MCP)
Brain D1 ID: 2001aba8-d651-41c0-9bd0-8d98866b057c

Pull in this order:
1. doc-handover-compliance-sprint-20260328 — this doc (also in Brain)
2. doc-bella-intelligence-verification-sprint-20260328 — Full 5-sprint plan
3. doc-loop-and-harness-system-20260327 — Loop & Harness architecture
4. doc-loop-harness-research-20260327 — Spotify/Phil Schmid/regulatory research
5. doc-bella-morgans-canary-eval-20260327 — The canary that exposed the gap
6. doc-bella-v11-handover-20260327 — Current Bella state

### Step 2 — Load these local skills
~/.claude/skills/gsd-superpowers/skills/test-driven-development/SKILL.md
~/.claude/skills/gsd-superpowers/skills/verification-before-completion/SKILL.md
~/.claude/skills/gsd-superpowers/skills/systematic-debugging/SKILL.md
~/.claude/skills/eval-bella/SKILL.md
~/.claude/skills/fix-bella/SKILL.md
~/.claude/skills/cloudflare/SKILL.md

### Step 3 — Local vs Cloudflare (which to use for what)
LOCAL FILES via Desktop Commander — for reading/editing ALL source code. Faster, richer, CC edits directly.
CLOUDFLARE MCP — Brain D1 reads/writes ONLY.

### Key local paths
DO source:      ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/
Bridge source:  ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v11/src/
Fast-intel:     ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/fast-intel-sandbox-v9/src/
Consultant:     ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/consultant-v9/ (deploy with --name consultant-v8)
Stages dir:     ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/stages/ (created, empty)
Backup:         ~/Desktop/BELLA_V1.0_SANDBOX_BACKUP_2026-03-28
Deploy map:     ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/DEPLOY_MAP.md

Git: trentb-ai/bella-v6-sandbox-system
Tags: v11-pre-compliance-sprint (current), v11-pre-deletion-backup (yesterday)

---

## CONTEXT — WHAT WAS ESTABLISHED TODAY

### The Core Problem
The DO brain tells Gemini exactly what to say. Gemini says whatever she wants. The DO marks it
"completed" because the stream finished. Nobody checks what was actually spoken.

Proven in Morgans Financial canary (anon_uqcn0i77): wrong ROI math, skipped Chris entirely,
lied about covering Chris, false ROI claims for Alex and Maddie. All invisible to the system.

### What Already Exists (the 90%)
- extractKeyPhrases() in index.ts — runs on every directive, already extracts phrases
- complianceChecks.mustContainPhrases — in every packet, already shipping, nobody reads it
- spokenText in llm_reply_done — bridge already sends it, nobody checks it
- criticalFacts[] in NextTurnPacket — declared, ALWAYS EMPTY (P2 gap from 0C Blueprint)
- scrapedDataSummary in types.ts + moves.ts wow_6 — declared, read, NEVER WRITTEN
- stages/ directory — created locally, empty, ready for module files (future sprint)

### Key Code Findings (from reading actual source today)
- handleLlmReplyDone() in index.ts: receives spokenText, does ZERO compliance check
- DeliveryStatus in types.ts: pending | completed | barged_in | failed — needs "drifted" added
- processFlow() in flow.ts: handles failed (reissue) and completed (advance), NO drift branch
- directiveToPacket() in index.ts: criticalFacts: [] hardcoded empty
- wow_6 in moves.ts: fills.scrapedDataSummary — always empty — falls to mostImpressive then GENERIC
- deep_ready timing: scrape workflow sends partials per actor but timing race means wow_6 often
  fires before data arrives — scrapedDataSummary fix avoids race (consultant is pre-call)
- Recommendation stage: routing.reasoning.alex/chris/maddie from consultant never used

---

## PERPLEXITY RESEARCH — KEY UPGRADES TO INCORPORATE

Perplexity validated all five sprints with these battle-tested upgrades:

### 1. String matching — multi-layer fuzzy-aware (not binary)
Do NOT use binary exact matching. Production pattern:
1. Normalize (lowercase, trim)
2. Word overlap check (60% threshold)
3. ALSO run Levenshtein-style fuzzy score (catches ASR rewrites: "Alex" to "Alice")
4. effectiveScore = Math.max(wordOverlap, fuzzyScore * 0.7)
5. Require 60% of phrase words — not just one token

Keep a short ASR name variants table: Alex->Alice/Alec, Chris->Kris, Maddie->Mattie

### 2. LLM judge — signal not law
- Gemini Flash 2.5 as compliance judge = industry standard for voice agents
- ctx.waitUntil async pattern = confirmed correct, never blocks hot path
- Only critical stages (8/call) — cost ~$0.0009/call confirmed
- Output is SIGNAL, aggregate in complianceLog[], human-in-loop for edge cases
- ADD EVAL ASSERTION C6: "LLM judge fired on >= 6 critical stages per full call"

### 3. criticalFacts injection — max 5, short declarative sentences
- RAG-style fact injection = battle-tested for grounding without fine-tuning
- MAX 5 facts — recall degrades with length (Perplexity-validated limit)
- Format as short declarative sentences
- Repeat high-importance facts across related stages

### 4. scrapedDataSummary — pre-call consultant is the right pattern
- Pre-call consultant scanning public data = exactly what production voice agent stacks do
- "Must reference actual data found, never fabricated" constraint is the right guard
- Keep wow_6 fallbacks intact — this only removes the always-no-data case

### 5. Recommendation grounding — "reasoning-as-colour"
- Keep core eligibility logic in flags (correct and unchanged)
- Inject consultant reasoning as supporting sentences only
- Enforce one sentence via split(".")[0] — keeps TTS timing safe
- Reasoning never becomes a deciding condition

### 6. Dollar compliance — 5% tolerance not exact
- "Eight hundred thousand" vs "$800K" edge cases real in voice
- Use 5% tolerance: Math.abs(n - expected) / expected < 0.05

---

## CC SESSION A — COMPLIANCE + JUDGE

### Files to create/modify
call-brain-do/src/compliance.ts                     NEW FILE
call-brain-do/src/__tests__/compliance.test.ts      NEW FILE (write FIRST)
call-brain-do/src/types.ts                          add "drifted" to DeliveryStatus
call-brain-do/src/index.ts                          handleLlmReplyDone, handleDebug, directiveToPacket
call-brain-do/src/flow.ts                           processFlow drift branch
deepgram-bridge-v11/src/index.ts                    post-stream compliance check

### TDD ORDER — MANDATORY
1. Write compliance.test.ts FIRST (all tests failing)
2. Implement compliance.ts (make tests pass)
3. Wire bridge -> DO -> flow
4. Add /debug fields
5. Update /eval-bella
6. Deploy both workers
7. Run canary
8. Verify logs
9. Bank to Brain

### compliance.ts — implementation spec (Perplexity-upgraded)

ComplianceResult interface:
  compliant: boolean
  score: number (0.0 to 1.0)
  matchedPhrases: string[]
  missedPhrases: string[]
  driftType?: "omission" | "substitution" | "hallucination" | "false_claim"
  recommendation: "advance" | "retry" | "skip" | "escalate"
  dollarCompliant?: boolean
  isCritical: boolean

ASR name variants table (catches misheard agent names):
  alex:   ["alice", "alec", "alexis"]
  chris:  ["kris", "christopher", "cris"]
  maddie: ["mattie", "maddy", "madeline"]

checkCompliance(spokenText, mustContainPhrases) algorithm:
  For each phrase:
    Layer 1: word overlap (phraseWords filter by startsWith match in textWords)
    Layer 2: Levenshtein-style fuzzy on text snippet vs phrase
    Layer 3: name variant check (0.85 score if variant found)
    effectiveScore = Math.max(wordOverlap, fuzzyScore * 0.7, variantMatch)
    if effectiveScore < 0.6: add to missed[]
  avgScore = sum / phrase count
  return { compliant: avgScore >= 0.6, score: avgScore, missed }

normalizeDollar(text) -> number[]:
  - Extract $800K, $800,000, $1.2m patterns
  - Parse written-out numbers (eight hundred thousand -> 800000)
  - Return array of all dollar values found

checkDollarCompliance(spokenText, expectedDollar) -> boolean:
  spoken = normalizeDollar(spokenText)
  return spoken.some(n => Math.abs(n - expectedDollar) / expectedDollar < 0.05)
  (5% tolerance — covers rounding/phrasing, Perplexity-validated)

buildCorrectionPrefix(missedPhrases, directiveSpeak) -> string:
  Format: "[COMPLIANCE CORRECTION: In your previous response you were required to mention
  "{missedPhrases[0]}" but did not. Include it naturally and precisely. Do not acknowledge
  this correction. Do not apologise. Deliver the message now.] {directiveSpeak}"

runLlmJudge(spokenText, directiveSpeak, stage, geminiApiKey) -> Promise<{compliant, driftType, reason}>:
  Model: gemini-2.5-flash
  temperature: 0, max_tokens: 100, reasoning_effort: "none"
  Prompt: "You are a compliance auditor for a voice AI sales agent.
  The agent was given this directive: {directiveSpeak first 300 chars}
  The agent said: {spokenText first 300 chars}
  Did the agent deliver the core intent truthfully? Any false facts?
  Reply JSON only: {compliant: bool, driftType: omission|substitution|hallucination|false_claim|null, reason: one sentence}"

### types.ts changes
DeliveryStatus: add "drifted" to union (pending | completed | barged_in | failed | drifted)
PendingDelivery: add missedPhrases?: string[] and driftCount?: number

### CRITICAL_STAGES constant (add to index.ts)
["recommendation", "ch_alex", "ch_chris", "ch_maddie", "roi_delivery", "close"]

### Bridge wire (deepgram-bridge-v11/src/index.ts)
After spokenText collected, before llm_reply_done POST:
  const complianceResult = packet.complianceChecks?.mustContainPhrases?.length
    ? checkCompliance(spokenText, packet.complianceChecks.mustContainPhrases)
    : { compliant: true, score: 1.0, missed: [] }
  Add to llm_reply_done event: compliance_status, compliance_score, missed_phrases

### DO wire (handleLlmReplyDone in index.ts)
After resolveDeliveryCompleted():
  if event.compliance_status === "drifted" && isCritical:
    set pendingDelivery.status = "drifted"
    set pendingDelivery.missedPhrases = event.missed_phrases
    set pendingDelivery.driftCount = (driftCount ?? 0) + 1
    log [COMPLIANCE_DRIFT]
  else:
    log [COMPLIANCE_PASS]

  if isCritical && spokenText.length > 10:
    ctx.waitUntil(
      runLlmJudge(spokenText, directive.speak, stage, GEMINI_API_KEY)
        .then(result => { brain.complianceLog.push({...result, stage, ts, score, missedPhrases}) })
        .catch(e => console.error([JUDGE_ERR]))
    )

### processFlow drift branch (flow.ts)
At top of processFlow(), before building directive:
  if pendingDelivery.status === "drifted" && isCritical && driftCount < 1:
    build directive normally
    prepend buildCorrectionPrefix(missedPhrases, directive.speak)
    reset pendingDelivery.status = "pending"
    log [COMPLIANCE_RETRY]
    return { directive, moveId: stage_retry, advanced: false }

### /debug additions
complianceLog: brain.complianceLog ?? []
complianceSummary: {
  overallScore: avg of scores in complianceLog
  driftCounts: { ch_alex: N, ch_chris: N, ... } per critical stage
  judgeFiredCount: count of entries with judgeCompliant defined
}

### eval-bella — 6 new assertions
C1: [COMPLIANCE_PASS] or [COMPLIANCE_DRIFT] log appears on >= 1 turn
C2: No critical directive scored below 0.5
C3: overallComplianceScore > 0.7
C4: No ROI dollar figure mismatch (checkDollarCompliance true on roi stages)
C5: driftCount < 3 for any single stage
C6: judgeFiredCount >= 6 for any full call (Perplexity-added)

### compliance.test.ts — test cases (write FIRST, all failing)
checkCompliance:
  - Exact phrase match -> score 1.0, compliant true
  - 70% word overlap -> compliant true
  - 40% word overlap -> missed phrase, compliant false
  - Empty mustContainPhrases -> compliant true, score 1.0
  - ASR variant: "Alice" in text, "alex" required -> partial match >= 0.6
  - Multiple phrases: 3/4 matched -> score ~0.75, compliant true
  - Empty spokenText -> score 0, compliant false if phrases required

checkDollarCompliance:
  - "eight hundred thousand" -> matches 800000 -> true
  - "$400K" vs expected 800000 -> false
  - "$800,000" vs expected 800000 -> true
  - "$800K" vs expected 800000 -> true
  - "approximately $810K" vs expected 800000 -> true (within 5%)
  - No dollar in text -> false

buildCorrectionPrefix:
  - Contains missed phrase in correction header
  - Does not start the spoken portion with an apology
  - Includes original directiveSpeak at end
  - Contains COMPLIANCE CORRECTION marker

normalizeDollar:
  - "eight hundred thousand" -> [800000]
  - "$800K" -> [800000]
  - "$1.2m" -> [1200000]
  - "800,000 dollars" -> [800000]

---

## CC SESSION B — INTELLIGENCE

### Files to modify
call-brain-do/src/moves.ts              buildCriticalFacts(), recommendation colour
call-brain-do/src/index.ts              directiveToPacket() calls buildCriticalFacts()
fast-intel-sandbox-v9/src/index.ts      deliverDOEvents() scrapedDataSummary wire
consultant-v9/worker.js                 add scrapedDataSummary to prompt schema

### buildCriticalFacts() — add to moves.ts (after cleanFacts())
function buildCriticalFacts(stage, state):
  c = consultant(state)  // helper already exists
  raw = []
  raw.push(c.icpAnalysis?.marketPositionNarrative)  // always
  switch stage:
    "recommendation", "ch_alex": raw.push(c.routing?.reasoning?.alex?.split(".")[0])
    "ch_chris": raw.push(c.routing?.reasoning?.chris?.split(".")[0])
    "ch_maddie": raw.push(c.routing?.reasoning?.maddie?.split(".")[0])
    "roi_delivery", "close": raw.push(c.conversionEventAnalysis?.agentTrainingLine)
  raw.push(c.hiringAnalysis?.topHiringWedge?.split(".")[0])  // always if exists
  return cleanFacts(raw).slice(0, 5)  // max 5, Perplexity-validated

In directiveToPacket() replace criticalFacts: [] with criticalFacts: buildCriticalFacts(state.currentStage, state)

### Recommendation colour — buildRecommendationDirective in moves.ts
AFTER existing recLine is built (existing eligibility logic UNCHANGED):
  c = consultant(state)
  alexColour  = c.routing?.reasoning?.alex  -> first sentence + "."  else ""
  chrisColour = c.routing?.reasoning?.chris -> first sentence + "."  else ""
  maddieColour = c.routing?.reasoning?.maddie -> first sentence + "." else ""
  Append colours for agents eligible in recLine (additive only, never changes who is recommended)
  GUARD: 3-agent recommendation non-negotiable, only maddieSkip flag can exclude Maddie

### consultant-v9 prompt addition (in buildPrompt() OUTPUT JSON schema, after scriptFills):
"scrapedDataSummary": "A single natural spoken observation (max 25 words) about a SPECIFIC
data point from Google reviews, ads activity, or hiring signals. NOT a website compliment.
Must reference actual data only. Examples: 'you have 47 Google reviews averaging 4.8 stars'
OR 'you are currently running Google Ads' OR 'you are actively hiring for three roles'.
If no concrete data available: null."

### deliverDOEvents wire (fast-intel-sandbox-v9/src/index.ts)
In deliverDOEvents(), change consultant_ready payload:
  payload: {
    ...consultant,
    scriptFills: {
      ...(consultant.scriptFills ?? {}),
      scrapedDataSummary: consultant.scrapedDataSummary ?? null,
    },
  }

### Session B deploy order
1. Deploy consultant (from consultant-v9/ with --name consultant-v8 per DEPLOY_MAP.md)
2. Deploy fast-intel (check DEPLOY_MAP.md for correct name)
3. Deploy call-brain-do
4. Wait 30s
5. Run canary
6. Check logs: [WOW_FIELDS] scrapedDataSummary=true, [WOW6_RESOLVE] source=SCRAPED_SUMMARY
7. Check /debug: criticalFacts non-empty
8. Bank canary results to Brain D1

---

## PERPLEXITY WORKFLOW

For EACH CC session prompt:
1. Write the CC prompt
2. Send to Perplexity: "Review this CC implementation prompt for Bella voice AI compliance
   sprint [A/B]. Validate: (1) string matching robustness for ASR, (2) LLM judge operating
   model, (3) risk mitigations, (4) TDD assertions. Flag gaps vs production voice agent patterns."
3. Incorporate Perplexity feedback
4. Send to CC

---

## ARCHITECTURAL DECISIONS (LOCKED)

1. DeliveryStatus "drifted" — new status alongside existing ones, not a replacement
2. LLM judge is ASYNC (ctx.waitUntil) — never blocks voice hot path
3. Correction prefix tells WHY Gemini failed — Spotify pattern, 50% course-correction rate
4. Max 1 retry per directive per turn — voice cannot stall
5. criticalFacts[] max 5 items — Perplexity-validated recall limit
6. Dollar compliance: 5% tolerance — covers voice rounding/phrasing edge cases
7. scrapedDataSummary fix is consultant-layer (pre-call) — avoids deep_ready timing race
8. Recommendation grounding is additive colour only — eligibility flags remain sole decider
9. 3-agent recommendation non-negotiable — only maddieSkip flag can exclude Maddie

---

## SUCCESS CRITERIA

After Session A canary:
  [COMPLIANCE_PASS] or [COMPLIANCE_DRIFT] on every turn
  [COMPLIANCE_RETRY] log if any critical drift triggers retry
  /debug: complianceLog[] populated, judgeFiredCount >= 6, overallScore present
  eval-bella: C1-C6 all pass, original 246/247 assertions still passing

After Session B canary:
  [WOW_FIELDS] log: scrapedDataSummary=true
  [WOW6_RESOLVE] log: source=SCRAPED_SUMMARY (not GENERIC)
  [REC_RESOLVE] log: speak contains consultant reasoning colour
  /debug: criticalFacts array non-empty in turn logs

---

## PARKED (DO NOT TOUCH IN THESE SESSIONS)

- Step module architecture (stages/ dir created — see doc-bella-step-module-architecture-20260328)
- M5 bridge deletion
- Paperclip install
- Publication draft (needs canary data first)
- stats-kb Phase 2

---

## BRAIN DOCS WRITTEN TODAY

doc-bella-intelligence-verification-sprint-20260328  — full 5-sprint plan with all code specs
doc-bella-step-module-architecture-20260328          — StepModule interface + file layout
doc-session-summary-20260328                         — full session summary + key findings

---

## BUSINESS CONTEXT

Performance-based pricing: free trial -> 10-20% cut of conversions.
Compliance scoring = the evidence layer. Clients see per-call quality BEFORE the cut is charged.
Zero risk + visible quality = conversion. This sprint directly strengthens the commercial model.
Also produces artifacts for OMB M-26-04 (federal procurement, March 2026) and EU AI Act (August 2026).

Publication: canary data -> April-May 2026 -> "Closing the Loop on Voice: The Missing Category
in Closed-Loop Agent Taxonomy". See doc-voice-compliance-publication-strategy-20260327.

---
Local file: ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/HANDOVER_COMPLIANCE_SPRINT_20260328.md

---

## SPRINT 4 EXPANDED — FULL DATA INJECTION AUDIT

### Critical Finding: "Delivered to DO but not used in moves.ts" = Gemini never sees it

The Gemini system prompt has EXACTLY 6 slots. Only data that lands in one of these slots
reaches Gemini. Everything else in brain.intel.consultant is invisible:

  1. MANDATORY SCRIPT     <- packet.chosenMove.text (the speak string moves.ts built)
  2. CONFIRMED THIS CALL  <- extracted state fields (acv, leads etc)
  3. LIVE ROI             <- packet.roi dollar figures
  4. CONTEXT              <- packet.criticalFacts[] (currently ALWAYS EMPTY)
  5. ACTIVE MEMORY        <- packet.activeMemory[] (commitment notes only)
  6. STYLE                <- packet.style.tone + industryTerms

Confirmed by reading deepgram-bridge-v11/src/index.ts buildFullSystemContext() function.

Two paths to get consultant data into Gemini:
  Path A: Hard-code into the speak string (moves.ts reads it, Bella says it verbatim)
  Path B: Put it in criticalFacts[] (CONTEXT block — Gemini uses for off-script responses)

### Full Gap Matrix — Three Tiers

TIER 1 — Produced, delivered, USED (working correctly):
  icpAnalysis.icpNarrative              -> wow_3 priority 1
  icpAnalysis.icpProblems/Solutions     -> wow_3 priority 2
  icpAnalysis.icp_guess (scriptFills)   -> wow_3 priority 2
  icpAnalysis.bellaCheckLine            -> wow_3 priority 4
  conversionEventAnalysis.conversionNarrative  -> wow_4 priority 0
  conversionEventAnalysis.agentTrainingLine    -> wow_4 priority 1
  conversionEventAnalysis.bellaLine            -> wow_4 priority 2
  conversionEventAnalysis.primaryCTA           -> wow_4 priority 3
  mostImpressive[0].bellaLine           -> wow_6 fallback
  hiringAnalysis.topHiringWedge         -> wow_6 fallback
  routing.priority_agents/skip_agents   -> queue building
  d.googleMaps.rating/review_count      -> wow_2
  d.ads.*                               -> wow_8
  d.hiring.*                            -> wow_6, recommendation

TIER 2 — Produced, delivered to DO, NEVER USED (Gemini has zero knowledge of these):
  businessIdentity.spokenName           -> shortBiz() rolls its own logic instead
  icpAnalysis.marketPositionNarrative   -> never read anywhere
  icpAnalysis.howTheyKnow               -> never read
  icpAnalysis.problemSolutionMapping    -> never read
  copyAnalysis.* (ALL fields)           -> entire object unused
  copyAnalysis.bellaLine                -> unused
  copyAnalysis.strongestLine            -> unused
  valuePropAnalysis.* (ALL fields)      -> entire object unused
  valuePropAnalysis.statedBenefits      -> unused
  valuePropAnalysis.strongestBenefit    -> unused
  valuePropAnalysis.bellaLine           -> unused
  conversionEventAnalysis.ctaAgentMapping    -> produced, REQUIRED in prompt, never used
  conversionEventAnalysis.allConversionEvents -> unused
  conversionEventAnalysis.ctaBreakdown       -> unused
  conversionEventAnalysis.frictionPoints     -> unused
  googlePresence[0].bellaLine           -> unused (Google-data spoken observation)
  googlePresence[0].insight             -> unused
  websiteCompliments[0].bellaLine       -> unused (intentionally removed from script)
  conversationHooks[0-2]                -> delivered as array, never read in moves.ts
  routing.reasoning.alex/chris/maddie   -> never injected as spoken colour
  routing.questions_to_prioritise       -> never used
  routing.questions_to_brush_over       -> never used
  secondaryRecommendations[*]           -> entire array unused
  redFlags[*]                           -> delivered as red_flags, never read
  landingPageVerdict.verdictLine        -> unused
  landingPageVerdict.trustSignals       -> unused
  scriptFills.rep_commentary            -> arrives, never used in moves.ts
  scriptFills.recent_review_snippet     -> arrives, never used in moves.ts
  scriptFills.top_2_website_ctas        -> arrives, never used in moves.ts

TIER 3 — Not produced yet (prompt gap):
  scriptFills.scrapedDataSummary        -> SPRINT 4 core fix (add to prompt + wire delivery)

### Updated Sprint 4 Scope — Wire ALL missing data in one pass

Priority order (highest bang-for-buck first):

1. scrapedDataSummary — add to consultant prompt + wire deliverDOEvents()
   HOW: Add field to consultant JSON schema. Map in deliverDOEvents() scriptFills merge.

2. googlePresence[0].bellaLine — use in wow_6 as priority 2
   HOW: In wow_6 case in moves.ts, read c.googlePresence?.[0]?.bellaLine after scrapedDataSummary check.
   RESULT: wow_6 gets a Google-data-specific observation instead of falling to mostImpressive.

3. conversationHooks[0] — use in wow_6 as priority 4 (before GENERIC)
   HOW: Read c.conversationHooks?.[0] — has .topic, .data, .how fields — compose observation line.
   RESULT: wow_6 almost never hits GENERIC fallback.

4. businessIdentity.spokenName — replace shortBiz() fallback
   HOW: In shortBiz() helper: return c.businessIdentity?.spokenName ?? (existing logic).
   RESULT: Bella uses the consultant-verified spoken name instead of algorithmic stripping.

5. conversionEventAnalysis.ctaAgentMapping — promote to wow_4 priority 0
   HOW: Read cea.ctaAgentMapping in wow_4, use as highest-priority spoken line.
   RESULT: wow_4 uses consultant-written CTA->agent mapping sentence (currently REQUIRED in prompt, never spoken).

6. marketPositionNarrative — into criticalFacts[] always slot
   HOW: buildCriticalFacts() always includes c.icpAnalysis?.marketPositionNarrative (Sprint 3 already planned).

7. valuePropAnalysis.strongestBenefit — into criticalFacts[] when present
   HOW: buildCriticalFacts() adds c.valuePropAnalysis?.strongestBenefit as second slot.

8. routing.questions_to_prioritise — into recommendation stage notes[]
   HOW: In buildRecommendationDirective(), set notes: c.routing?.questions_to_prioritise ?? [].
   RESULT: Gemini knows which questions matter most for this specific prospect.

### Updated wow_6 Priority Stack (post-Sprint-4)

  Priority 1: fills.scrapedDataSummary          <- NEW (Sprint 4 core)
  Priority 2: googlePresence[0].bellaLine        <- NEW (Google-data observation)
  Priority 3: mostImpressive[0].bellaLine        <- existing
  Priority 4: conversationHooks[0]               <- NEW (specific hook with data)
  Priority 5: topHiringWedge                     <- existing
  Priority 6: hiringMatches                      <- existing
  Priority 7: GENERIC                            <- existing last resort

### What stays parked (diminishing returns for current call flow)
  copyAnalysis.*        — website copy analysis, not directly speakable
  websiteCompliments.*  — intentionally removed from script
  redFlags.*            — internal routing signal, not spoken
  secondaryRecommendations.* — subsumed by routing.reasoning colour
  landingPageVerdict.*  — not part of current call flow
  scriptFills.rep_commentary/recent_review_snippet — covered by wow_2 Google data path

### Files for Sprint 4 expanded scope
  call-brain-do/src/moves.ts           — wow_6 priority stack, wow_4 ctaAgentMapping, shortBiz()
  consultant-v9/worker.js              — add scrapedDataSummary to prompt schema
  fast-intel-sandbox-v9/src/index.ts   — deliverDOEvents() scriptFills merge


---

## STATS KB — PHASE 2 WIRING (Sprint 6 — after compliance + consultant data)

### What exists (Phase 1 complete — do not rebuild)
Location: call-brain-do/src/stats-kb/

Files:
  alex-speed-to-lead.ts      171 lines — pain, urgency, competitor, close, ROI stats
  chris-website-concierge.ts 202 lines — engagement, conversion, abandonment stats
  maddie-ai-receptionist.ts  255 lines — missed call, after-hours, receptionist cost stats
  sarah-database-reactivation.ts 139 lines — dormant lead, reactivation ROI stats
  james-reputation-uplift.ts 132 lines — review impact, reputation ROI stats
  WIRING_RULES.ts            443 lines — Three-Beat Pattern, trigger conditions, NLP matching
  index.ts                   barrel export of all 5 agent stat sets
  PHASE_2_TODO.md            complete spec for wiring (already written)
  TOTAL: 1,354 lines of sourced, tiered, tagged stats with URLs

Current status: ALL STATS IMPORTED BY NOTHING.
grep confirmed: zero references to ALEX_STATS, CHRIS_STATS etc in any DO source file.
Stats compile into the Worker bundle but Gemini has never seen a single stat.

### Why this is separate from Sprint 4 (consultant data)
Sprint 4 wires data that already EXISTS in DO state (brain.intel.consultant).
Stats KB wiring requires building new modules:
  - detect-trigger.ts (new file) — what did the prospect just say?
  - select-stat.ts (new file) — which stat fits this moment?
  - gemini-extract.ts changes — add statTrigger extraction field
  - moves.ts changes — inject stat into directive notes[]

One full CC session minimum. Must not be rushed into compliance sprint.

### The Three-Beat Pattern (from WIRING_RULES.ts)
Every stat deployment follows:
  Beat 1 — STAT: "Research shows 85% of callers who don't get through never call back."
  Beat 2 — TRANSLATE: "So out of every 10 people calling you, if 6 miss — 5 are gone forever."
  Beat 3 — CONNECT: "You mentioned 30 calls/week and your team can't always get to the phone —
              that's real jobs walking out the door every single week."

The CONNECT beat uses prospect's own numbers from state (phoneVolume, inboundLeads etc).
This is what makes stats feel personal not generic.

### Five trigger conditions (when to deploy a stat)
  1. PAIN AMPLIFICATION — prospect describes a problem
     Pull: pain tier stats for current agent stage
  2. OBJECTION TURNAROUND — prospect pushes back
     Pull: competitor or scepticism stats
  3. COMPETITOR PRESSURE — prospect mentions competitors or asks "what are others doing?"
     Pull: competitor stats
  4. CLOSING / VALUE REINFORCEMENT — prospect warming up, asking about pricing
     Pull: close or ROI stats
  5. CREDIBILITY CHALLENGE — prospect asks "where'd you get that?" or seems sceptical
     Action: cite source + offer URL

Rule: stats deployed ONLY when trigger fires. Never sprayed randomly.
Rule: one stat per turn maximum. The beat pattern takes time — don't stack.

### Files to build (Phase 2)

NEW: call-brain-do/src/stats-kb/detect-trigger.ts
  function detectTrigger(prospectUtterance, currentStage):
    { triggerType: 'pain'|'objection'|'competitor'|'close'|'scepticism'|null, agentHint: StageId|null }
  Can use keyword pre-filter OR add statTrigger to gemini-extract.ts schema
  Keyword approach is faster (no extra Gemini call), good enough for MVP

NEW: call-brain-do/src/stats-kb/select-stat.ts
  function selectStat(stage, triggerType, state, intel):
    { stat, source, url, tier, deliveryModality, connectTemplate } | null
  Logic:
    - Map stage to agent stats file (ch_alex -> ALEX_STATS, ch_maddie -> MADDIE_STATS etc)
    - Filter by triggerType category
    - Prefer tier 1 during wow/discovery, tier 2 during channel stages
    - Industry match: if intel has industry -> prefer industry-specific stat where tagged
    - Personalisation: if state has prospect numbers -> build connectTemplate with their data
    - Return null if no good match — never force a stat

MODIFY: call-brain-do/src/gemini-extract.ts
  Add optional statTrigger field to per-turn extraction schema:
    statTrigger?: { type: 'pain'|'objection'|'competitor'|'close'|'scepticism', agentHint: string|null } | null
  Gemini detects trigger from prospect's words
  Alternative: keyword matching in detectTrigger.ts (no schema change needed)

MODIFY: call-brain-do/src/moves.ts — each build[Agent]Directive()
  At top of each channel builder:
    const trigger = detectTrigger(lastProspectUtterance, stage)
    const stat = trigger ? selectStat(stage, trigger.triggerType, state, intel) : null
  If stat found, append to directive notes[]:
    STAT_CONTEXT: {
      stat: stat.stat,
      source: stat.source,
      url: stat.url,
      beatPattern: "Acknowledge prospect concern -> Quote stat -> Translate to plain English
                    -> Connect: 'You mentioned [their number] — that means [personalised impact]'"
    }
  If no stat: notes unchanged — do not force it

### Stat injection into Gemini
Stats go into directive.notes[] — which appears in the system prompt as guidance,
not as mandatory script. Gemini reads it and weaves the stat in naturally.
This preserves the "Bella sounds human" quality — stats feel conversational not recited.

Important: compliance loop checks the SPEAK string (mandatory script).
Stats in notes[] are guidance only — compliance loop should NOT penalise for not quoting
a stat verbatim. Add a compliance exemption: notes[] content is never checked.

### Stage-to-stats mapping
  greeting, wow_1-8: no stats (discovery only — do not interrupt the wow sequence)
  recommendation:    ALEX_STATS.urgency tier 1 if pain trigger fires
  ch_alex:           ALEX_STATS — all categories, tier 2 during channel questions
  ch_chris:          CHRIS_STATS — all categories, tier 2
  ch_maddie:         MADDIE_STATS — all categories, tier 2
  ch_sarah:          SARAH_STATS — tier 2 during collection
  ch_james:          JAMES_STATS — tier 2 during collection
  roi_delivery:      best tier 1 stat from primary agent (reinforcement)
  close:             close/ROI stats from primary agent (value reinforcement)

### Success criteria for Phase 2
  - [STAT_DEPLOYED] log tag when a stat fires (stage, triggerType, stat preview)
  - [STAT_SKIPPED] log when trigger detected but no matching stat (for tuning)
  - [NO_TRIGGER] log when no trigger detected (majority of turns — expected)
  - In canary: at least 1 stat deployed per channel stage when prospect gives a
    pain signal or pushback
  - Stats never appear in wow_1-8 (guarded by stage check)
  - Compliance loop ignores notes[] content (verified via eval)

### Files for Phase 2
  call-brain-do/src/stats-kb/detect-trigger.ts    NEW
  call-brain-do/src/stats-kb/select-stat.ts        NEW
  call-brain-do/src/gemini-extract.ts              MODIFY (optional statTrigger field)
  call-brain-do/src/moves.ts                       MODIFY (inject stat into notes[])

Do NOT modify stats KB files themselves — Phase 1 is complete and correct.

---

## FINAL LOCKED DECISIONS — Post Perplexity Review (28 Mar 2026)

Perplexity reviewed the full plan and accepted all corrections from the Opus analysis.
The plan is now locked. These decisions are non-negotiable in CC execution.

### DECISION 1: Six real prompt slots only — no invented channels

The Gemini system prompt has exactly these slots (confirmed from buildDOTurnPrompt()):
  1. MANDATORY SCRIPT      <- speak string — what Bella says verbatim
  2. CONFIRMED THIS CALL   <- extracted state (acv, leads, etc)
  3. LIVE ROI              <- dollar figures for channel stages
  4. CONTEXT               <- criticalFacts[] — the ONLY non-spoken grounding slot
  5. ACTIVE MEMORY         <- commitment notes from memoryNotes[]
  6. STYLE                 <- tone + industryTerms

There is NO contextDocuments[], NO silent grounding channel, NO Bella V2 architecture.
Any consultant field not routed through the speak string or criticalFacts[] is Gemini-blind.

### DECISION 2: criticalFacts[] priority order — LOCKED, hard cap 6 items

ALWAYS (2 slots — every stage):
  1. icpAnalysis.marketPositionNarrative
  2. valuePropAnalysis.strongestBenefit

STAGE-SPECIFIC (1-2 slots — only the relevant one):
  3. routing.reasoning.<current_agent> first sentence
     (ch_alex → alex, ch_chris → chris, ch_maddie → maddie, recommendation → alex)
  4. hiringAnalysis.topHiringWedge first sentence (only if present in intel)

OPTIONAL (0-1 slots — only if materially relevant to current stage):
  5. ctaAgentMapping one-sentence summary (recommendation and close stages only)
  6. One redFlags item (only if it protects against a likely bad claim or weak recommendation)

HARD CAP: 6 items maximum. Never exceed.
Use cleanFacts().slice(0, 6) — already exists in moves.ts.

OMIT BY DEFAULT (diminishing returns, not worth the slot cost):
  copyAnalysis.* (all fields)
  full landingPageVerdict.*
  full secondaryRecommendations
  googlePresence beyond what goes in speak string
  conversationHooks beyond what goes in speak string

### DECISION 3: notes[] — add to DONextTurnPacket and render in bridge (Option A)

notes[] exists in StageDirective (types.ts line 436) but is NOT transmitted via
DONextTurnPacket and is NOT rendered in buildDOTurnPrompt(). Confirmed by code read.

Decision: ADD notes[] as a real transmitted slot for Sprint 6 Stats KB.

Rationale: Keeping stat guidance structurally separate from business facts is cleaner.
Gemini performs better when instruction sections are clearly separated. A labelled
STAT_GUIDANCE section avoids ambiguity vs CONTEXT facts.

Implementation (Sprint 6 — ~5 lines in bridge):
  DONextTurnPacket: add notes?: string[]
  buildDOTurnPrompt(): add notes section after CONTEXT:
    const notesSection = packet.notes?.length
      ? '\nSTAT_GUIDANCE (deploy if opportunity arises — use Three-Beat pattern):\n'
        + packet.notes.map(n => `- ${n}`).join('\n') + '\n'
      : '';
  Insert notesSection between contextSection and memorySection.

This change is DEFERRED to Sprint 6 (Stats KB). Do NOT add to Sprint 1/2 or Session B.

### DECISION 4: complianceLog structure — LOCKED (lean, no content previews)

  { stage, ts, score, driftType, judgeCompliant, missedPhrases, reason }

Do NOT add: severity, directivePreview, spokenPreview, judgeRan.
Reason: DO state has size constraints. Content already exists in transcriptLog.
judgeRan is implicit — if judgeCompliant is defined, judge ran.

### DECISION 5: wow_* stages — checkType: 'none' — NO compliance check

wow_1 through wow_8 are high-variance content-rich stages.
Phrase-level compliance would generate constant false drifts.
Policy: zero compliance checking on any wow stage.
Log [COMPLIANCE_SKIP] if needed for observability but run no check.

### DECISION 6: Session grouping — FINAL

Session A (CC): string match + async judge + complianceLog + eval-bella C1-C6
Session B (CC): buildCriticalFacts() + scrapedDataSummary + full data activation + recommendation colour
Sprint 6 (separate CC session): Stats KB — detect-trigger.ts + select-stat.ts
                                             + notes[] slot added to packet/bridge
                                             + inject into moves.ts build[Agent]Directive()

### DECISION 7: Updated wow_6 priority stack — LOCKED

  1. fills.scrapedDataSummary              (new — Sprint 4 core)
  2. googlePresence[0].bellaLine           (new — Google-data observation)
  3. mostImpressive[0].bellaLine           (existing)
  4. conversationHooks[0] (topic + data)   (new — specific hook)
  5. hiringAnalysis.topHiringWedge         (existing)
  6. hiringMatches[0]                      (existing)
  7. GENERIC                               (last resort only)

### DECISION 8: Perplexity access to Brain

Brain D1 ID: 2001aba8-d651-41c0-9bd0-8d98866b057c
Cloudflare Account ID: 9488d0601315a70cac36f9bd87aa4e82
Perplexity can query via Cloudflare MCP if connected to same account.
Key docs to pull: doc-bella-intelligence-verification-sprint-20260328,
doc-loop-and-harness-system-20260327, doc-bella-morgans-canary-eval-20260327,
doc-bella-step-module-architecture-20260328.

---
HANDOVER DOC STATUS: FINAL AND LOCKED. No further changes before CC execution.
Total lines: see wc -l HANDOVER_COMPLIANCE_SPRINT_20260328.md

---

## FINAL LOCKED DECISIONS — Post Perplexity Review (28 Mar 2026)

Perplexity reviewed the full plan, accepted all Opus corrections, and converged correctly.
Plan is now locked. These decisions are non-negotiable in CC execution.

### DECISION 1: Six real prompt slots only — no invented channels

The Gemini system prompt has exactly these slots (confirmed from buildDOTurnPrompt()):
  1. MANDATORY SCRIPT      <- speak string — what Bella says verbatim
  2. CONFIRMED THIS CALL   <- extracted state (acv, leads, etc)
  3. LIVE ROI              <- dollar figures for channel stages
  4. CONTEXT               <- criticalFacts[] — the ONLY non-spoken grounding slot
  5. ACTIVE MEMORY         <- commitment notes from memoryNotes[]
  6. STYLE                 <- tone + industryTerms

There is NO contextDocuments[], NO silent grounding channel, NO Bella V2 architecture.
Any consultant field not routed through the speak string or criticalFacts[] is Gemini-blind.

### DECISION 2: criticalFacts[] priority order — LOCKED, hard cap 6 items

ALWAYS (2 slots — every stage):
  1. icpAnalysis.marketPositionNarrative
  2. valuePropAnalysis.strongestBenefit

STAGE-SPECIFIC (1-2 slots):
  3. routing.reasoning.<current_agent> first sentence only
     (ch_alex->alex, ch_chris->chris, ch_maddie->maddie, recommendation->alex)
  4. hiringAnalysis.topHiringWedge first sentence (only if present)

OPTIONAL (0-1 slots — only if materially relevant):
  5. ctaAgentMapping one sentence (recommendation + close stages only)
  6. One redFlags item (only if protects against likely bad claim)

HARD CAP: 6 items. Use cleanFacts().slice(0, 6) — already exists in moves.ts.

OMIT BY DEFAULT:
  copyAnalysis.* (all), full landingPageVerdict.*, full secondaryRecommendations,
  googlePresence beyond what goes in speak string,
  conversationHooks beyond what goes in speak string.

### DECISION 3: notes[] — add to DONextTurnPacket and render in bridge (Sprint 6)

notes[] exists in StageDirective (types.ts line 436) but is NOT in DONextTurnPacket
and NOT rendered in buildDOTurnPrompt(). Confirmed by code read.

Decision: ADD notes[] as a real transmitted slot — but ONLY in Sprint 6 (Stats KB).
Do NOT add in Session A or Session B. Deferred.

Rationale: Keeping stat guidance structurally separate from criticalFacts[] is cleaner.
Gemini performs better when sections are clearly labelled. A STAT_GUIDANCE block avoids
ambiguity with CONTEXT facts. The bridge change is ~5 lines.

Sprint 6 implementation:
  DONextTurnPacket: add   notes?: string[]
  buildDOTurnPrompt(): add after contextSection:
    const notesSection = packet.notes?.length
      ? '\nSTAT_GUIDANCE (deploy if opportunity arises — use Three-Beat pattern):\n'
        + packet.notes.map(n => '- ' + n).join('\n') + '\n'
      : '';

### DECISION 4: complianceLog structure — LOCKED (lean)

  { stage, ts, score, driftType, judgeCompliant, missedPhrases, reason }

NOT included: severity, directivePreview, spokenPreview, judgeRan.
judgeRan is implicit — if judgeCompliant is defined, judge ran.
Content previews excluded — DO state has size constraints, content exists in transcriptLog.

### DECISION 5: wow_* stages — checkType none — zero compliance checking

wow_1 through wow_8: high-variance content, phrase matching generates false drifts.
Policy: zero compliance checks on any wow stage. No exceptions.

### DECISION 6: Session grouping — FINAL

Session A: string match + async judge + complianceLog + eval-bella C1-C6
Session B: buildCriticalFacts() + scrapedDataSummary + full data activation + rec colour
Sprint 6:  Stats KB — detect-trigger.ts + select-stat.ts + notes[] slot + moves.ts wiring

### DECISION 7: wow_6 priority stack — LOCKED

  1. fills.scrapedDataSummary           (new — Sprint 4 core)
  2. googlePresence[0].bellaLine        (new — Google-data observation)
  3. mostImpressive[0].bellaLine        (existing)
  4. conversationHooks[0]               (new — specific hook with topic + data)
  5. hiringAnalysis.topHiringWedge      (existing)
  6. hiringMatches[0]                   (existing)
  7. GENERIC                            (last resort)

---

## COMPLETE DATA ACTIVATION MAP — FINAL (post full audit, 28 Mar 2026)

This section supersedes the partial field lists above. It is the definitive, complete account
of every consultant field, what it is, where it goes, and exactly how to wire it.

Audited against the full consultant-v9 OUTPUT JSON schema — every field accounted for.

---

### FIELDS ADDED IN THIS REVISION (were missing from previous versions)

#### businessIdentity.businessModel
What: "B2B or B2C or Both — based on who their customers are from the copy"
Where: criticalFacts[] optional slot
Why: Meaningfully affects every agent pitch. B2B = selling to businesses. B2C = consumers.
     Gemini needs this to frame language correctly across all channel stages.
How: buildCriticalFacts() — add after hiringWedge if slot available:
     const bizModel = c.businessIdentity?.businessModel;
     if (bizModel) raw.push(`This is a ${bizModel} business.`);

#### businessIdentity.serviceArea
What: "Where they operate — national, state-wide, or local"
Where: criticalFacts[] optional slot OR fold into marketPositionNarrative
Why: A local plumber in eastern Sydney vs a national SaaS — Bella should reference scale.
How: buildCriticalFacts() — single sentence:
     const serviceArea = c.businessIdentity?.serviceArea;
     if (serviceArea) raw.push(`They operate ${serviceArea}.`);

#### copyAnalysis.strongestLine
What: "The single most compelling verbatim line from the entire site"
Where: wow_1 research intro — speak string, as proof Bella actually read the site
Why: Specific quote = credibility. Generic "we've researched your business" = weak.
How: In buildWow1Directive() in moves.ts, add priority after bella_opener:
     const strongestLine = c.copyAnalysis?.strongestLine;
     if (strongestLine) observationLine = `I noticed you lead with "${strongestLine}" —
       that's a strong positioning statement.`;

#### scriptFills.website_positive_comment
What: "A specific STRATEGIC observation about their positioning — NOT a generic compliment.
       An INSIGHT that would make the owner think 'they actually understand our business'."
Where: wow_1 research intro — speak string, priority 1 (highest quality personalisation)
Why: This field is specifically designed for wow_1. It's not a compliment — it's an insight.
     Currently wow_1 uses a generic "we've researched X" opener. This replaces it.
How: In buildWow1Directive() in moves.ts:
     Priority 1: scriptFills.website_positive_comment (strategic insight)
     Priority 2: copyAnalysis.strongestLine (verbatim quote approach)
     Priority 3: existing generic opener (current fallback)

#### hiringAnalysis.matchedRoles[*].wedge
What: Per-role spoken replacement pitch for each matched hiring role.
      e.g. "You're hiring a customer service rep for $55K — Alex follows up every lead
      instantly from day one, no salary, no sick days."
Where: ch_alex, ch_maddie, ch_sarah channel directives — deliver stage speak string
Why: topHiringWedge covers the single best one. But if there are 3 matched roles,
     there are 3 specific wedge lines. The most urgent role's wedge should appear in
     the relevant agent's deliver directive.
How: In build[Agent]Directive() deliver mode:
     const matchedRole = (c.hiringAnalysis?.matchedRoles ?? [])
       .filter(r => r.ourAgent === 'Alex' && r.urgency === 'high')[0];
     if (matchedRole?.wedge) — inject into speak string priority 2 (after ROI, before generic)
     Map: Alex roles → ch_alex, Maddie roles → ch_maddie, Sarah roles → ch_sarah

---

### PARTIAL FIELDS — NOW COMPLETE

#### conversationHooks[0] — ALL THREE sub-fields
Previous: "compose from .topic + .data"
CORRECTED: Use all three sub-fields: topic, data, AND how
How: In wow_6 priority 4 (conversationHooks):
     const hook = c.conversationHooks?.[0];
     if (hook?.topic && hook?.data) {
       observationLine = hook.how
         ? `${hook.how} — ${hook.data}`
         : `${hook.topic} — ${hook.data}`;
     }
The .how field tells Bella HOW to bring it up ("casually mention" vs "ask directly" vs
"reference as an observation"). Use it as framing, not as the spoken line itself.

#### secondaryRecommendations[0].whySecond — now included in recommendation colour
Previous: "parked — subsumed by routing.reasoning"
CORRECTED: Not the same. routing.reasoning is internal logic. whySecond is a Bella-ready
spoken sentence. Different content, different purpose. Add as third colour sentence.
How: In buildRecommendationDirective() after alexColour/chrisColour/maddieColour:
     const secondaryRec = c.secondaryRecommendations?.[0];
     const secondaryColour = secondaryRec?.whySecond
       ? ' ' + secondaryRec.whySecond.split('.')[0] + '.'
       : '';
     Append secondaryColour only if it adds new info not already in agent colours.
     GUARD: Never change who is recommended. Colour only.

#### landingPageVerdict.verdictLine — now in criticalFacts[] optional
Previous: "fully parked"
CORRECTED: verdictLine is a single punchy sentence — exactly right for criticalFacts[].
           Gives Gemini landing page quality context for off-script responses about the website.
How: buildCriticalFacts() — add as optional final slot (only if budget permits):
     const verdictLine = c.landingPageVerdict?.verdictLine;
     if (verdictLine) raw.push(verdictLine);
     Priority: lower than businessModel/serviceArea. Only include if under 6-item cap.

---

### COMPLETE SESSION B FILE CHANGES (updated)

moves.ts changes:
  1. buildCriticalFacts() — add businessModel, serviceArea, verdictLine to pool
  2. buildWow1Directive() — add website_positive_comment (priority 1) + strongestLine (priority 2)
  3. buildWow6Directive() — updated priority stack (all 7 tiers, hooks uses .how field)
  4. buildWow4Directive() — ctaAgentMapping priority 0
  5. buildRecommendationDirective() — add secondaryRecommendations[0].whySecond as third colour
  6. build[Alex/Maddie/Sarah]Directive() — inject matchedRoles[*].wedge in deliver mode
  7. shortBiz() helper — use businessIdentity.spokenName as priority 1

---

### COMPLETE criticalFacts[] POOL (final, hard cap 6)

ALWAYS (2 slots):
  1. icpAnalysis.marketPositionNarrative
  2. valuePropAnalysis.strongestBenefit

STAGE-SPECIFIC (1-2 slots):
  3. routing.reasoning.<current_agent> first sentence
  4. hiringAnalysis.topHiringWedge first sentence (if present)

OPTIONAL — pick highest-value available within cap (0-2 slots):
  5. businessIdentity.businessModel ("This is a B2B business.")
  6. businessIdentity.serviceArea ("They operate locally in Sydney.")
  7. conversionEventAnalysis.ctaAgentMapping one sentence (rec/close only)
  8. One redFlags item (if protects against bad claim)
  9. landingPageVerdict.verdictLine (lowest priority — only if cap allows)

HARD CAP 6: cleanFacts(raw).slice(0, 6)
Priority within optional slots: businessModel > serviceArea > ctaAgentMapping > redFlags > verdictLine

OMIT PERMANENTLY:
  copyAnalysis.messagingStrength/Weakness/toneAndVoice
  valuePropAnalysis.statedBenefits/missingBenefits/bellaLine
  icpAnalysis.whoTheyTarget/howTheyKnow/icpConfidenceLevel/problemSolutionMapping
  conversionEventAnalysis.ctaClarity/conversionStrength/frictionPoints/allConversionEvents/ctaBreakdown
  websiteCompliments (intentionally removed from script)
  landingPageVerdict.heroEffectiveness/ctaClarity/conversionBarriers/trustSignals/verdictLine2
  businessIdentity.industry (already used in buildIndustryLanguagePack())
  secondaryRecommendations (spoken via colour, not facts)
  routing.questions_to_brush_over

---

### COMPLETE wow_1 PRIORITY STACK (new — was not defined before)

  Priority 1: scriptFills.website_positive_comment (strategic insight — best personalisation)
  Priority 2: copyAnalysis.strongestLine (verbatim quote — shows specific research)
  Priority 3: existing bella_opener from fast-intel (current fallback)
  Priority 4: generic "we've researched {business}" opener (last resort)

---

### COMPLETE FIELD ACTIVATION TABLE (every consultant field, final status)

businessIdentity.correctedName          -> biz() helper (already wired)
businessIdentity.spokenName             -> shortBiz() priority 1 (Session B fix)
businessIdentity.industry               -> buildIndustryLanguagePack() (already wired)
businessIdentity.businessModel          -> criticalFacts[] optional slot 5 (NEW — Session B)
businessIdentity.serviceArea            -> criticalFacts[] optional slot 6 (NEW — Session B)

scriptFills.website_positive_comment    -> wow_1 priority 1 (NEW — Session B)
scriptFills.hero_header_quote           -> wow_1 fallback context (already present in fills)
scriptFills.reference_offer             -> wow_3 fallback (already wired)
scriptFills.icp_guess                   -> wow_3 (already wired)
scriptFills.campaign_summary            -> wow_8 (already wired via tech_stack)
scriptFills.rep_commentary              -> wow_2 optional (PARKED — covered by googleMaps path)
scriptFills.recent_review_snippet       -> wow_2 optional (PARKED — covered by googleMaps path)
scriptFills.rep_quality_assessment      -> PARKED
scriptFills.top_2_website_ctas          -> PARKED (covered by ctaAgentMapping)
scriptFills.scrapedDataSummary          -> wow_6 priority 1 (NEW — needs prompt + delivery wire)

copyAnalysis.messagingStrength          -> PARKED
copyAnalysis.messagingWeakness          -> PARKED
copyAnalysis.strongestLine              -> wow_1 priority 2 (NEW — Session B)
copyAnalysis.toneAndVoice               -> PARKED
copyAnalysis.bellaLine                  -> PARKED (too similar to website_positive_comment)

icpAnalysis.whoTheyTarget               -> PARKED
icpAnalysis.howTheyKnow                 -> PARKED
icpAnalysis.icpConfidenceLevel          -> PARKED
icpAnalysis.icpProblems/Solutions       -> wow_3 (already wired)
icpAnalysis.problemSolutionMapping      -> PARKED
icpAnalysis.bellaCheckLine              -> wow_3 priority 4 (already wired)
icpAnalysis.marketPositionNarrative     -> criticalFacts[] slot 1 always (Session B)
icpAnalysis.icpNarrative                -> wow_3 priority 1 (already wired)

valuePropAnalysis.statedBenefits        -> PARKED
valuePropAnalysis.strongestBenefit      -> criticalFacts[] slot 2 always (Session B)
valuePropAnalysis.missingBenefits       -> PARKED
valuePropAnalysis.bellaLine             -> PARKED

conversionEventAnalysis.primaryCTA      -> wow_4 (already wired)
conversionEventAnalysis.ctaType         -> wow_4 CTA classification (already wired)
conversionEventAnalysis.ctaClarity      -> PARKED
conversionEventAnalysis.frictionPoints  -> PARKED
conversionEventAnalysis.conversionStrength -> PARKED
conversionEventAnalysis.bellaLine       -> wow_4 priority 2 (already wired)
conversionEventAnalysis.allConversionEvents -> PARKED
conversionEventAnalysis.ctaBreakdown    -> PARKED
conversionEventAnalysis.conversionNarrative -> wow_4 priority 0 (already wired)
conversionEventAnalysis.agentTrainingLine   -> wow_4 priority 1 (already wired)
conversionEventAnalysis.ctaAgentMapping -> wow_4 priority 0 + criticalFacts[] optional (Session B)

routing.priority_agents/skip_agents     -> queue building (already wired)
routing.lower_priority_agents           -> PARKED
routing.reasoning.alex/chris/maddie     -> recommendation colour (Session B)
routing.reasoning.sarah/james           -> PARKED
routing.questions_to_prioritise         -> recommendation notes[] (Sprint 6 deferred)
routing.questions_to_brush_over         -> PARKED

secondaryRecommendations[0].whySecond   -> recommendation third colour sentence (NEW — Session B)
secondaryRecommendations[1].whyNotFirst -> PARKED

hiringAnalysis.matchedRoles[*].wedge    -> channel deliver directives (NEW — Session B)
hiringAnalysis.matchedRoles[*].jobTitle/salary -> wow_5/wow_6 context (PARKED)
hiringAnalysis.topHiringWedge           -> wow_6 priority 5 + criticalFacts[] slot 4 (already + Session B)

websiteCompliments[*].bellaLine         -> PARKED (intentionally removed from script)
mostImpressive[0].bellaLine             -> wow_6 priority 3 (already wired)
mostImpressive[1].bellaLine             -> PARKED (wow_6 already uses [0])

googlePresence[0].bellaLine             -> wow_6 priority 2 (Session B)
googlePresence[0].insight/data          -> PARKED (bellaLine covers it)
googlePresence[1].bellaLine/bestQuote   -> PARKED

conversationHooks[0] (topic+data+how)   -> wow_6 priority 4 — use all 3 sub-fields (Session B)
conversationHooks[1-2]                  -> PARKED

redFlags[0]                             -> criticalFacts[] optional slot 8 (Session B)
redFlags[1+]                            -> PARKED

landingPageVerdict.verdictLine          -> criticalFacts[] optional slot 9 lowest priority (Session B)
landingPageVerdict.verdictLine2         -> PARKED
landingPageVerdict.heroEffectiveness    -> PARKED
landingPageVerdict.ctaClarity           -> PARKED
landingPageVerdict.conversionBarriers   -> PARKED
landingPageVerdict.trustSignals         -> PARKED

