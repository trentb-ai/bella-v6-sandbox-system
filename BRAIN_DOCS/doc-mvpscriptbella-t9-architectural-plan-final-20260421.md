# MVPScriptBella — T9 ARCHITECTURAL PLAN (FINAL)
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### Status: TRENT-APPROVED DIRECTION — updated with Revision A decisions (markers, KB, script fidelity)
### Supersedes: doc-mvpscriptbella-fix-spec-20260420 (INCOMPLETE), doc-mvpscriptbella-t9-revised-plan-with-t2-review-20260421 (DRAFT)

---

## TRENT DECISIONS (LOCKED — 2026-04-21)

1. **Option B confirmed.** Port canonical script fresh into bridge inline. Brain DO untouched.
2. **S1 + S3 merged.** Stage machine restructure + prompt conflict fixes ship as one sprint.
3. **Site content blob = post-launch.** S4 not blocking MVP.
4. **WOW 6 "go deeper" path:** Source check (WOW 7) PLUS 1-2 pertinent conversion funnel questions before recommending. Gives Bella more signal for routing recommendation variant.
5. **Deep-scrape descoped for MVP.** No Apify scraping. BUT `personalisedaidemofinal-sandbox` stays in the mix — fires on load, provides backup data. NaturalBellaFROZEN uses this exact worker (BIG_SCRAPER binding + frontend direct POST). DO NOT TOUCH it — just ensure MVPScriptBella bindings point to `personalisedaidemofinal-sandbox`.
6. **Objections descoped for MVP.** No objection handlers, no universal recovery. Bella does WOW → recommend → close → done.
7. **Script fidelity = WORD FOR WORD for ALL script content.** Both hardcoded script lines AND consultant-generated lines (icpNarrative, conversionNarrative) are delivered WORD FOR WORD. No paraphrasing either. Improvisation freedom exists ONLY outside SCRIPT markers: the 1-2 sentence REACT before script, off-script answers using KB/freestyle, and bridging back to script.
8. **Agent KB = KV-backed.** Key `bella:agent_kb` in leads-kv. Read once on conversation init, cached on state. Hardcoded fallback if KV empty. Update KB by writing to KV — no code change needed.
9. **Markers: `--- SCRIPT ---` / `--- END SCRIPT ---`.** NOT `===SPEAK EXACTLY===`. "EXACTLY" triggers robot mode in Gemini. "SCRIPT" communicates "deliver this" without commanding robotic repetition.
10. **Unified TURN BEHAVIOR rule.** One instruction block replaces both old Output Rule 5 (verbatim delivery) AND separate REACT-BRIDGE-DELIVER instruction. No competing systems. Details: doc-mvpscriptbella-s1-spec-revision-a-20260421.

---

## CORE INSIGHT

NaturalBella FROZEN delivers consultant scripts correctly. Same Gemini. Same prompt structure. Same bridge architecture. The prompt engineering isn't broken — the CONTENT flowing into the prompt is wrong. Bridge feeds Gemini old stalls, old flow, old text. Fix what goes IN, Gemini delivers it.

Two divergent stage machines exist:
- **Brain DO** (moves.ts) — ~70% aligned with canonical. Structured directives. 361 tests. NOT what drives Gemini prompts.
- **Bridge** (index.ts inline) — ~30% aligned. Old NaturalBella flow. IS what the prospect hears.

Option B: replace bridge's inline `buildStageDirective()` with fresh code matching canonical script exactly. Delete ~450 lines of old stall/channel/ROI code. Replace with ~300 lines of canonical flow. Net reduction in bridge complexity.

---

## MVP STAGE MACHINE

```
wow_1 → wow_2 (skip if no Google rating) → wow_3 → wow_4 → wow_5 → wow_6
  ├── prospect says "recommend" → recommend → close → done
  └── prospect says "deeper"   → wow_7 → funnel_qs → recommend → close → done
```

### Stage type enum (new):
```
wow | recommend | close | done
```

### Sub-stage tracking:
- `wow` stage uses `stall` counter (1-7) for WOW progression
- `recommend` has no sub-stages (single delivery based on routing variant)
- `close` has no sub-stages (single booking ask)
- `done` = conversation complete

### State interface (simplified):
```typescript
interface State {
  stage: 'wow' | 'recommend' | 'close' | 'done';
  stall: number;           // 1-7 within wow stage
  turns_in_stall: number;  // for safety net (force delivery after 2 turns)
  confirmed: {
    firstName: string | null;
    businessName: string | null;
    googleRating: number | null;
    googleReviews: number | null;
    deeper_requested: boolean;    // WOW 6 choice
    source_answer: string | null; // WOW 7 answer
    funnel_answer: string | null; // funnel Qs answer
  };
  conv_memory: string[];   // conversation summary per turn
  routing_variant: string; // 'all3' | 'alex_chris' | 'alex_maddie' | 'alex_only'
  _agentKb: string;        // cached from KV 'bella:agent_kb' on first turn
}
```

---

## EACH WOW STALL — SPECIFICATION

All content sourced from canonical script (`doc-bella-mvp-script-final-20260420`). ALL script content (hardcoded AND consultant) marked with `--- SCRIPT ---` / `--- END SCRIPT ---` — Gemini must deliver WORD FOR WORD.

### WOW 1: Research Intro

**Purpose:** Establish that Bella has researched their business. Set the frame.

**Data required:** firstName, businessName, customerType (all from consultant)

**Data variants:**
- **HIGH DATA** (businessName + customerType present): Full canonical intro — "So {firstName}, your pre-trained {businessName} agents are ready to go. We've done some deep research into your {customerType} base..."
- **LOW DATA** (missing businessName or customerType): Fallback variant — "So {firstName}, your pre-trained AI agents are ready to go. We've done some deep research into your business..."

**Gate to advance:** Prospect responded (any response). Minimum 1 turn in stall.

**Source in canonical script:** WOW 1 section, HIGH-DATA and LOW-DATA variants.

---

### WOW 2: Reputation Trial

**Purpose:** Use Google rating as social proof. Offer trial.

**Data required:** googleRating, googleReviews (from Google Places API via fast-intel)

**Skip logic:** If `googleRating` is null OR `googleRating < 3`, SKIP this stall entirely. Advance to WOW 3. This is not a failure — many businesses don't have Google Maps listings.

**Data variants:**
- **STRONG DATA** (rating >= 4.0 + reviews > 20): Full reputation line — "{businessName} already has a {rating}-star reputation from {reviews} reviews..."
- **MEDIUM DATA** (rating >= 3.0 but reviews < 20 or rating < 4.0): Softer variant — "I can see {businessName} has established a presence on Google..."

**Gate to advance:** Prospect responded. Minimum 1 turn.

**Source in canonical script:** WOW 2 section.

---

### WOW 3: ICP + Problem + Solution

**Purpose:** Show Bella understands WHO they serve and WHAT problems they solve. This is the first major consultant-scripted beat.

**Data required:** icpAnalysis from consultant

**Data variants:**
- **STRONG** (icpAnalysis.icpNarrative present and non-empty):
  --- SCRIPT ---
  {icpAnalysis.icpNarrative}
  --- END SCRIPT ---
  Consultant narrative spoken WORD FOR WORD. This is script, not context.

- **MEDIUM** (icpNarrative empty but icpProblems + icpSolutions arrays present):
  Mechanical stitch — "From what I can see, your ideal clients are dealing with {icpProblems[0]} and {icpProblems[1]}, and you're solving that with {icpSolutions[0]}..."

- **LOW** (all null):
  {icpAnalysis.bellaCheckLine} if available, else generic fallback — "Tell me a bit about who your ideal clients are and the main challenges they face?"

**Gate to advance:** Prospect responded. Minimum 1 turn.

**Source in canonical script:** WOW 3 section, STRONG/MEDIUM/LOW variants.

---

### WOW 4: Conversion / CTA

**Purpose:** Map their website's conversion events to specific AI agents. This is the narrative bridge that makes the recommendation feel EARNED, not arbitrary.

**Data required:** conversionEventAnalysis from consultant

**Data variants:**
- **STRONG** (conversionEventAnalysis.conversionNarrative present and non-empty):
  --- SCRIPT ---
  {conversionEventAnalysis.conversionNarrative}
  --- END SCRIPT ---
  Consultant narrative spoken WORD FOR WORD.

- **MEDIUM** (conversionNarrative empty but agentTrainingLine or ctaAgentMapping present):
  Use agentTrainingLine — maps CTAs to agents. "Your booking form maps perfectly to Chris, and your phone CTA is ideal for Maddie..."

- **LOW** (all null):
  Rebuild from primaryCTA if available — "Your main conversion action is {primaryCTA} — that's exactly what Chris is built for."
  Else generic — "Based on what I've seen, there are some clear opportunities to capture more conversions from your website traffic."

**Gate to advance:** Prospect responded. Minimum 1 turn.

**Source in canonical script:** WOW 4 section.

---

### WOW 5: Alignment Bridge

**Purpose:** Transition from "I know your business" to "here's what I recommend." Confirms everything Bella said maps to agent capabilities.

**Content (hardcoded — no data variants):**
"Perfect — that's exactly the kind of intelligence your agent team runs against. Everything I've just walked you through — your ideal client profile, your conversion events, your online presence — that's all pre-loaded into your agents from day one."

**Gate to advance:** Prospect responded. Minimum 1 turn.

**Source in canonical script:** WOW 5 section.

---

### WOW 6: Explore or Recommend

**Purpose:** Give prospect CHOICE. Agency. They decide pacing.

**Content (hardcoded):**
"Now I can give you a provisional recommendation on which agents would be the strongest fit for {businessName} — or if you'd prefer, we can explore a couple more things first. What would you prefer?"

**Gate to advance:** Prospect indicates choice. TWO PATHS:
- **"Recommend" / "let's hear it" / affirmative toward recommendation** → set `deeper_requested = false`, advance stage to `recommend`
- **"Go deeper" / "explore more" / "tell me more"** → set `deeper_requested = true`, advance to WOW 7

**Detection:** Gemini classifies prospect intent. Bridge instruction: "If prospect wants the recommendation, output [RECOMMEND]. If prospect wants to explore more, output [DEEPER]." Bridge parses output for signal.

**Source in canonical script:** WOW 6 section.

---

### WOW 7: Source Check (only if deeper_requested)

**Purpose:** Understand where their new business comes from. Informs recommendation routing.

**Content (hardcoded):**
"Apart from referrals and repeat business, where is most of your new business coming from right now?"

**Gate to advance:** Prospect answered. Capture `source_answer`. Minimum 1 turn.

**Source in canonical script:** WOW 7 section.

---

### Funnel Questions (only if deeper_requested, after WOW 7)

**Purpose:** 1-2 pertinent questions about their conversion funnels. Gives Bella more signal for routing the recommendation variant. Per Trent direction.

**Content (data-driven, selected by bridge based on available signals):**

Pick 1-2 from this menu based on what's relevant to their business:

1. **If ads signals present** (is_running_ads from tech_stack): "And when someone clicks through from one of your ads, what does that journey look like — do they hit a landing page, fill out a form, or call directly?"

2. **If website CTA is booking/form** (from consultant ctaBreakdown): "When someone fills out that {primaryCTA} on your site, what happens next — does someone call them back, or is it automated?"

3. **If no clear CTA detected**: "What's the main way a new prospect actually becomes a paying {customerType} for you right now?"

4. **If phone signals present** (has_phone from tech_stack): "For the calls that come in, roughly how quickly does someone pick up or call back?"

**Gate to advance:** Prospect answered. Capture `funnel_answer`. Then advance to `recommend`.

**Source:** Trent direction (2026-04-21). Not in original canonical script — additive per Trent's call on WOW 6 deeper path.

---

### RECOMMENDATION

**Purpose:** Recommend specific AI agents. Close CTA baked in.

**Routing logic:**
```
routing.priority_agents from consultant determines variant:

- Contains Alex + Chris + Maddie (or 3+) → "all3" variant
- Contains Alex + Chris (no Maddie)       → "alex_chris" variant  
- Contains Alex + Maddie (no Chris)       → "alex_maddie" variant
- Default / Alex only / unclear           → "alex_only" variant
```

**4 variants (from canonical script):**

Each variant follows structure: Agent intro → what each agent does for THEIR business → combined power → close CTA.

Close CTA baked into every variant:
"Would you like to experience them live first, or lock in your twenty-minute onboarding call now?"

**Only stat allowed:** "up to 4x more conversions" — benchmark, not calculated.

**NO dollar figures. NO ROI. NO "conservative estimate."**

**Gate to advance:** After Bella delivers recommendation + CTA, advance to `close` regardless of prospect response. If prospect answers the CTA question, capture in close stage.

**Source in canonical script:** RECOMMENDATION section, 4 variants.

---

### CLOSE

**Purpose:** Book onboarding call. NOT email. NOT trial.

**Content:**
If prospect said "lock in onboarding" → "Brilliant. What day and time works best for a twenty-minute onboarding session?"
If prospect said "experience live first" → "Perfect — I'll set that up for you right now. Before I do, what's the best day and time for your twenty-minute onboarding, just so we've got that locked in too?"
If unclear → "What's the best day and time for a quick twenty-minute onboarding call?"

**Gate:** Prospect provides day/time or declines. Either way → `done`.

**Source in canonical script:** CLOSE section.

---

### DONE

Conversation complete. No further prompts. Bridge can log final state, run extraction, etc.

---

## WHAT TO DELETE FROM BRIDGE (index.ts)

T2 to identify exact line ranges during spec phase. Architectural scope:

### Stage machine code (~450 lines):
- Current `buildStageDirective()` function body — all 10 stalls (replace entirely, don't patch)
- `gateOpen()` function — replace with simplified version
- `advanceStage()` function — replace with simplified version
- `buildQueue()` function — DELETE entirely
- `rebuildFutureQueueOnLateLoad()` — DELETE entirely

### ROI code:
- `calcAgentROI()` — DELETE entirely
- `runCalcs()` — DELETE entirely
- All `Inputs` fields for channel capture: `ads_leads`, `ads_conversions`, `web_leads`, `web_conversions`, `phone_volume`, `phone_afterhours`, `callback_speed`, `old_lead_volume`, `current_rating`, `review_count`, `review_system`
- All extraction logic for these captured inputs

### Stage references:
- `anchor_acv` stage — DELETE
- `anchor_timeframe` stage — DELETE
- All 5 channel stages: `ch_ads`, `ch_website`, `ch_phone`, `ch_old_leads`, `ch_reviews` — DELETE
- `roi_delivery` stage — DELETE
- Channel queue array and all queue manipulation

### System prompt ROI content:
- Any ROI rules in output rules section
- Any "calculate" / "conservative estimate" / dollar figure instructions
- Any channel-specific capture instructions

### Dead stalls:
- Stall 4 (Pre-training Connect) — not in canonical
- Stall 8 (Lead Source Deep) — deep-scrape dependent
- Stall 9 (Hiring Wedge) — deep-scrape dependent

---

## WHAT TO ADD TO BRIDGE

### New `buildStageDirective()` function:
- Switch on `state.stage` + `state.stall`
- Returns prompt text for each WOW 1-7 + recommend + close
- Uses `--- SCRIPT ---` / `--- END SCRIPT ---` markers for ALL script content (hardcoded + consultant)
- Uses data variant selection (high/medium/low) based on available intel
- WOW 2 skip logic (no Google rating → advance past)
- WOW 6 branching (recommend vs deeper)
- Funnel questions (1-2 selected from menu)
- 4 recommendation variants with routing logic

### New `gateOpen()` function:
Simplified gating — most stalls gate on "prospect responded + minimum 1 turn in stall":
- WOW 1-5, 7: prospect responded, `turns_in_stall >= 1`
- WOW 2: special — skip if no Google rating data
- WOW 6: prospect indicated choice (RECOMMEND or DEEPER signal)
- Funnel Qs: prospect answered, `turns_in_stall >= 1`
- Recommend: always advance after delivery
- Close: prospect responds

### New `advance()` function:
```
wow (stall < 7 and not stall 6 deeper branch) → increment stall
wow stall 6 + recommend chosen → stage = 'recommend'
wow stall 6 + deeper chosen → stall 7
wow stall 7 → funnel_qs (sub-stage of wow, stall 8 internally)
funnel_qs done → stage = 'recommend'
recommend done → stage = 'close'  
close done → stage = 'done'
```

### Safety net (from REACT-BRIDGE-DELIVER spec):
If `turns_in_stall >= 2` and Bella hasn't delivered the stall content yet, force delivery on next turn. Prevents Bella getting stuck in REACT mode forever.

---

## PROMPT ARCHITECTURE (what changes in system + turn prompt)

### System prompt changes (S1+S3 merged):

1. **Identity line:** "demonstration" → "consultation"
   - Old: "You are Bella, running a live demonstration..."
   - New: "You are Bella, running a personalised consultation..."

2. **Kill 4-sentence max rule.** Remove entirely. Consultant narratives exceed 4 sentences.

3. **Remove Rule 1 XML conflict.** Update to "no raw code or markup in speech."

4. **DELETE Output Rule 5 entirely.** Replaced by unified TURN BEHAVIOR block (see below).

5. **Remove dead ROI output rules.** Any rule referencing ROI calculation, dollar figures, conservative estimates.

6. **Separate freestyle context from script.** Clear section headers:
   ```
   ---- FREESTYLE CONTEXT (use ONLY when reacting to unexpected prospect input — NEVER instead of the scripted content) ----
   [bella_opener, conversationHooks, website_positive_comment, copyAnalysis.bellaLine]
   ---- END FREESTYLE CONTEXT ----
   ```

7. **Agent Knowledge = KV-backed.** Read from `bella:agent_kb` on first turn, hardcoded fallback. Alex, Chris, Maddie descriptions + trial/onboarding info. Only stat: "up to 4x more conversions."
   ```
   ---- AGENT KNOWLEDGE (use when prospect asks about agents, pricing, or how they work) ----
   [content from KV or hardcoded default]
   ---- END AGENT KNOWLEDGE ----
   ```

8. **Unified TURN BEHAVIOR block** (replaces old Output Rule 5 + separate REACT-BRIDGE-DELIVER instruction):
   ```
   ---- TURN BEHAVIOR ----
   HOW TO DELIVER:
   1. REACT naturally to what prospect said (1-2 sentences max)
   2. DELIVER the SCRIPT content WORD FOR WORD — hardcoded and consultant lines alike
   3. End with the question from the script

   IF PROSPECT GOES OFF-SCRIPT:
   - Answer briefly from AGENT KNOWLEDGE / FREESTYLE CONTEXT
   - Bridge back to script
   - ALWAYS return to script

   WHERE YOU CAN IMPROVISE:
   - The 1-2 sentence REACT before script
   - Answering off-script questions
   - Bridging back to script
   - NOWHERE ELSE. Everything inside SCRIPT markers is locked.
   ---- END TURN BEHAVIOR ----
   ```

9. **REDIRECT rule** (built into TURN BEHAVIOR): "If the prospect goes significantly off-topic, acknowledge briefly, then redirect and deliver script."

### Turn prompt changes:

1. **Stage + stall clearly labeled:** "STAGE: wow | STALL: 3 of 7 | ICP + Problem + Solution"

2. **Confirmed inputs section** — only show what's been confirmed so far. Grows each turn.

3. **Conversation memory** — brief summary of prior turns (existing, just clean up format).

4. **WOW 6 output instruction** — "End your response with exactly [RECOMMEND] or [DEEPER] based on the prospect's choice." Bridge parses this for branching.

---

## personalisedaidemofinal-sandbox HANDLING

NaturalBellaFROZEN fires `personalisedaidemofinal-sandbox` via:
- BIG_SCRAPER service binding in fast-intel (fire-and-forget)
- Direct frontend POST from loading/capture HTML

MVPScriptBella must maintain the same binding. Verify:
- `workers/fast-intel/wrangler.toml` has `BIG_SCRAPER = "personalisedaidemofinal-sandbox"` (not a different worker)
- Frontend loading HTML POSTs to `personalisedaidemofinal-sandbox` URL

DO NOT TOUCH `personalisedaidemofinal-sandbox` itself. It fires, provides backup data to KV, and bridge reads it if available. Bonus data, not a dependency.

---

## SPRINT PLAN

### S1: Stage Machine + Prompt Fixes (LARGE — primary work)

**Scope:** Everything above. Delete old stage machine. Write new one. Fix prompt conflicts. Wire routing.

**Deliverable:** Bridge deploys with:
- 7 WOW stalls matching canonical script
- ALL script content (hardcoded + consultant) delivered via `--- SCRIPT ---` markers WORD FOR WORD
- Recommendation with 4 routing variants
- Close (booking onboarding)
- WOW 6 branching (recommend vs deeper path)
- Funnel questions on deeper path
- All prompt conflict fixes from original Sprint 1+5+3
- Unified TURN BEHAVIOR block (replaces old Rule 5 + REACT-BRIDGE-DELIVER)
- AGENT KNOWLEDGE block — KV-backed (`bella:agent_kb`) with hardcoded fallback
- Safety net (2-turn force delivery)
- All ROI/channel/dead-stall code deleted
- Simplified State interface (with `_agentKb` cache field)

**Version:** v9.43.0

**Canary criteria:**
- BELLA_SAID every turn — no silent turns
- WOW 3: consultant icpNarrative appears WORD FOR WORD in BELLA_SAID
- WOW 4: consultant conversionNarrative appears WORD FOR WORD in BELLA_SAID
- WOW 2: skips cleanly when no Google rating (no error, no stall)
- WOW 6: responds to "recommend" and "go deeper" correctly
- Recommendation: correct variant selected based on routing.priority_agents
- Close: asks for day/time, not email
- NO ROI questions asked anywhere
- NO dollar figures spoken
- NO "what does your business do?" asked
- prompt_tokens reasonable (2000-3500 range, not 18K)
- Gemini TTFB stable (3-5s, no regression from deleted code)

### S2: REACT-BRIDGE-DELIVER Polish (MEDIUM — if S1 canary shows robot delivery)

**Scope:** If S1 canary shows Bella delivering script correctly but sounding robotic (no natural transitions, ignoring prospect input), tune the REACT instruction. May need per-stall REACT guidance.

**May not be needed.** S1 includes base REACT-BRIDGE-DELIVER instruction. If Gemini handles it well with the base instruction, S2 becomes unnecessary.

**Version:** v9.44.0

### S3: Site Content Injection (SMALL — post-launch)

**Scope:** Inject `page_content.markdown` (or condensed summary) into bridge prompt freestyle section. Gives Bella ability to answer "did you see our FAQs?" type questions.

**Not blocking MVP.** Consultant summaries cover most questions.

**Version:** v9.45.0

### S4: Objection Handling (MEDIUM — post-launch)

**Scope:** Add objection detection + 10 handlers from canonical script + universal recovery. This is the full canonical script's objection section.

**Not in MVP.** Bella handles wow → recommend → close → done. If prospect objects, she'll use REACT-BRIDGE-DELIVER to acknowledge and redirect. Not ideal, but functional.

**Version:** v9.46.0

---

## POST-MVP ARCHITECTURE PATH

**Option C (shared module)** — once MVP ships and canonical flow is proven:

1. Extract bridge's new `buildStageDirective()` + types into shared package (`packages/stage-machine/`)
2. Both brain DO and bridge import from same source
3. Brain's 361 tests adapt to test canonical flow
4. Single source of truth achieved without service binding latency
5. Monorepo workspace setup (lightweight — just shared types + stage logic)

This retires the "two codebases with same content" tech debt from Option B. Timeline: after MVP canary passes and Trent is satisfied with Bella's delivery quality.

---

## EXECUTION PROTOCOL

1. This plan → T1 for relay to team
2. T2 writes exact before/after code specs for S1 (line numbers, exact deletions, exact additions)
3. T2 may request T5 reads for current line ranges in bridge/src/index.ts
4. T3 spec review (SPEC_STRESS_TEST) — S1 is complex, touches stage machine + prompt + state
5. T4 implements from T2's spec
6. T2 6-gate review
7. T3 Codex review (PATCH_REVIEW)
8. T2 DEPLOY_BROADCAST → T1 → Trent
9. T4 deploys
10. T5 post-deploy health check
11. Full canary against criteria above

**T9 role from here:** Available for architectural questions during T2 spec writing. If T3 FAIL surfaces a design-level issue, T1 routes diagnosis back to me.

---

## DOCUMENTS REFERENCED

| Doc ID | Title |
|--------|-------|
| doc-bella-mvp-script-final-20260420 | THE canonical script (264 lines) |
| doc-bella-architecture-how-it-works-20260420 | Full pipeline architecture |
| doc-mvpscriptbella-make-her-sing-diagnostic-20260420 | 18 prompt conflicts + pipeline status |
| doc-mvpscriptbella-natural-response-architecture-20260420 | REACT-BRIDGE-DELIVER spec |
| doc-mvpscriptbella-fix-spec-20260420 | Existing fix spec (SUPERSEDED by this plan) |
| doc-mvpscriptbella-t2-architect-briefing-20260421 | T2 structural gap analysis |
| doc-mvpscriptbella-dual-stage-machine-analysis-20260421 | T2 deep analysis — two stage machines |
| doc-mvpscriptbella-t9-revised-plan-with-t2-review-20260421 | Prior draft (SUPERSEDED by this plan) |
| doc-mvpscriptbella-s1-implementation-spec-20260421 | S1 implementation spec (base) |
| doc-mvpscriptbella-s1-spec-revision-a-20260421 | S1 spec Revision A — unified markers, TURN BEHAVIOR, KV-backed KB |
| doc-mvpscriptbella-handover-20260421 | Session handover |

---

## RISK REGISTER

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Gemini still paraphrases despite `--- SCRIPT ---` markers + TURN BEHAVIOR | Medium | High | Test with single stall first. TURN BEHAVIOR says "WORD FOR WORD." If still paraphrasing, try stronger instruction ("Output the text between markers CHARACTER FOR CHARACTER"). NaturalBella FROZEN proves Gemini CAN deliver scripted content. |
| Google Places API key still missing on MVPScriptBella fast-intel | High | Medium (stall 2 skips) | T5 verify secret exists: `cd workers/fast-intel && npx wrangler secret list`. If missing: `cd workers/fast-intel && npx wrangler secret put GOOGLE_PLACES_API_KEY`. |
| WOW 6 branching misclassified by Gemini | Low | Medium | [RECOMMEND]/[DEEPER] signals are simple classification. Fallback: if no signal detected after 1 turn, default to recommend path. |
| Bridge index.ts edit breaks something unrelated | Medium | High | T2's spec must identify ALL functions that reference deleted stages/channels. Grep for every deleted stage name, function name, variable name. T3 Codex gate catches what T2 misses. |
| personalisedaidemofinal-sandbox binding wrong in MVPScriptBella | Low | Low (backup data, not dependency) | T5 verify: grep BIG_SCRAPER in workers/fast-intel/wrangler.toml, confirm target = personalisedaidemofinal-sandbox. |

---

## INVALIDATION CRITERIA

Revisit this plan if:
- Trent changes canonical script materially (new stalls, different flow)
- Canary reveals consultant data is NOT reaching bridge (pipeline regression)
- Gemini fundamentally cannot deliver `--- SCRIPT ---` content word-for-word (would need different marker/instruction approach)
- Trent decides objection handling IS MVP-blocking
- Service binding to personalisedaidemofinal-sandbox is broken or that worker is decommissioned
