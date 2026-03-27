# AUDIT-1: Deterministic Script-Output Diff
## Bridge Brain vs DO Brain — Stage-by-Stage Comparison

**Auditor:** Claude Code
**Date:** 2026-03-27
**Status:** READ-ONLY analysis — no code changes
**Source files:**
- Bridge: `deepgram-bridge-v11/src/index.ts` (buildStageDirective ~L1676-2114)
- DO: `call-brain-do/src/moves.ts` (full file, 1220 lines)
- DO ROI: `call-brain-do/src/roi.ts` (287 lines)

**Test Prospect:** Sarah Chen, Coastal Dental Care, dental, Sydney, 4.6★/187 reviews, ACV $2,500, runs Google Ads, 30 ad leads/wk (8 convert, 2-24hr response), 20 web leads/wk (5 convert), 80 calls/wk (15 missed, voicemail, >24hr callback), 500 old leads, 12 new patients/wk, no review system.

---

## SUMMARY SCORECARD

| Verdict | Count |
|---------|-------|
| EQUIVALENT | 5 |
| IMPROVED | 7 |
| DEGRADED | 3 |
| DIFFERENT | 6 |
| MISSING_IN_DO | 3 |
| MISSING_IN_BRIDGE | 2 |
| **Total comparisons** | **26** |

### CRITICAL FINDINGS (action required before M5)

> **DEGRADED-1:** DO wow_3 (ICP) lost `icpNarrative` and `bellaCheckLine` consultant priorities — falls back to mechanical stitch when consultant produced a better pre-built line.
>
> **DEGRADED-2:** DO wow_4 (Conversion) lost `convNarrative` consultant priority — falls back to CTA classification when consultant already wrote a spoken conversion line.
>
> **DEGRADED-3:** DO wow_5 (Alignment Bridge) lost the "opportunity-audit questions" framing that prepares the prospect for the numbers section. Extremely terse compared to bridge.
>
> **CRITICAL-ROI:** Bridge ROI formulas contain a systematic `/52` division on already-weekly inputs, producing artificially low numbers. DO formulas are mathematically principled and produce ~10x larger figures. This is an intentional redesign — the numbers are VERY different and need commercial sign-off.

---

## 0. GREETING

| | Bridge | DO |
|---|--------|-----|
| **Stage** | No greeting stage — initializes at `wow` | `greeting` stage |
| **Text** | *(handled by voice agent welcome message)* | `Hey Sarah, I'm Bella — welcome to your personalised AI Agent demonstration.` |
| **Wait** | N/A | `waitForUser: true` — pauses for prospect hello |

**Verdict: MISSING_IN_BRIDGE** — DO adds an explicit greeting stage. Bridge relied on the voice agent's built-in welcome, then jumped straight to WOW.

**Notes:** This is a deliberate DO improvement. The greeting stage gives Bella a human-sounding opening and pauses to let the prospect respond before launching into research.

---

## 1. WOW Stall 1 (Bridge) vs wow_1_research_intro (DO)

### Bridge (stall 1):
```
Now Sarah, I think you'll be impressed. We've done some research on
Coastal Dental Care, and we use that to pre-train your agents so they
understand your patients, your industry, and how you win business. Can I
quickly confirm a couple of our findings with you, just to make sure
your agents are dialled in?
```
*(~45 words)*

### DO (wow_1_research_intro):
```
So Sarah, your pre-trained agents are ready to go. You can play a
prospective Coastal Dental Care patient, and they'll engage like they've
worked for Coastal Dental Care for years — answering questions,
qualifying the opportunity, and moving people toward your key conversion
point on autopilot. Now Sarah, I think you'll be impressed. We've
researched Coastal Dental Care, and we use that to pre-train your agents
around your patients, your industry, and how you win business. Before we
begin, can I confirm a couple of findings so your agents are dialled in
and aimed at the highest-value opportunities?
```
*(~95 words)*

### Verdict: DIFFERENT

| Aspect | Bridge | DO |
|--------|--------|-----|
| Length | ~45 words | ~95 words (2x longer) |
| Demo frame | Not mentioned | "play a prospective patient", "worked for years", "on autopilot" |
| Pre-train mention | "pre-train your agents" | "pre-trained agents are ready" + "pre-train your agents" |
| Close question | "Can I quickly confirm..." | "can I confirm...aimed at the highest-value opportunities?" |
| Business name usage | 1x "Coastal Dental Care" | 3x "Coastal Dental Care" (repetitive) |
| First name usage | 1x "Sarah" | 2x "Sarah" |

**Notes:**
- DO adds a substantial demo-frame preamble explaining what agents do
- DO repeats the business name 3 times in one block — may sound unnatural in speech
- Bridge is tighter and more conversational
- DO's "aimed at the highest-value opportunities" close is stronger than bridge's "just to make sure"
- The DO version may be too long for a single TTS delivery — risk of prospect interrupting before the question

---

## 2. WOW Stall 2 (Bridge) vs wow_2_reputation_trial (DO)

### Path A: Rating >= 3 (4.6★ for test prospect)

**Bridge (stall 2):**
```
Oh Sarah, I noticed Coastal Dental Care has a 4.6-star reputation from
187 reviews — that's strong. Businesses already delivering good patient
outcomes qualify for our free trial, so if you'd like, I can get that
set up for you at any point during this demo.
```

**DO (wow_2):**
```
And just before we start, I noticed Coastal Dental Care has a 4.6-star
rating from 187 reviews — that's strong. Businesses already delivering
good outcomes are exactly the kind we like to put through our free trial,
so if you'd like, I can set that up for you at any point during this demo.
```

### Verdict: EQUIVALENT

| Aspect | Bridge | DO |
|--------|--------|-----|
| Opener | "Oh Sarah" (personal) | "And just before we start" (transitional) |
| Star word | "reputation" | "rating" |
| Industry term | "good **patient** outcomes" | "good outcomes" (generic) |
| Qualifier | "qualify for" (exclusive) | "exactly the kind we like to put through" (inviting) |
| Setup verb | "get that set up" | "set that up" |

**Notes:** Both convey the same message. DO loses the industry-specific "patient" in the outcomes phrase — minor loss of personalization. DO's "exactly the kind we like to put through" is slightly warmer than bridge's "qualify for."

### Path B: Rating < 3 or missing

**Bridge:** Silently increments stall to 3, falls through.
**DO:** Returns `{ speak: '', canSkip: true, skipReason: 'No Google rating or rating below 3.' }`

**Verdict: EQUIVALENT** — both skip silently. DO adds structured skip metadata.

### Side effect: trialMentioned

**Bridge:** Sets `s.trial_reviews_done = true`
**DO:** Sets `state.trialMentioned = true`

Same behavior, different field name.

---

## 3. WOW Stall 3 (Bridge) vs wow_3_icp_problem_solution (DO)

Both systems have branching logic. Bridge has **5 priority levels**, DO has **3**.

### Branch resolution for test prospect:
- `icp_guess` = "families and professionals seeking preventive and cosmetic dental care"
- `icpProblems` = ["Finding a dentist who takes their concerns seriously", "Long wait times for appointments"]
- `icpSolutions` = ["Personalised treatment plans", "Same-day emergency appointments"]
- Both arrays have >= 2 items → **ICP_FULL** branch fires in both systems.

### ICP_FULL Branch

**Bridge (stall 3):**
```
It looks like you're primarily targeting families and professionals
seeking preventive and cosmetic dental care. The typical challenges your
patients face are Finding a dentist who takes their concerns seriously
and Long wait times for appointments, and you solve those through
Personalised treatment plans and Same-day emergency appointments. Does
that sound right?
```

**DO (wow_3):**
```
It looks like you mainly serve families and professionals seeking
preventive and cosmetic dental care. The main problems they come to you
with are Finding a dentist who takes their concerns seriously and Long
wait times for appointments, and you solve those through Personalised
treatment plans and Same-day emergency appointments. Does that sound
right?
```

### Verdict: DEGRADED

| Aspect | Bridge | DO |
|--------|--------|-----|
| Audience verb | "primarily targeting" | "mainly serve" |
| Problem intro | "typical challenges your **patients** face" | "main problems **they** come to you with" |
| ICP cleaning | Strips "it looks like", "is that right?" | Same cleaning + also strips "you mainly/primarily serve" |
| **icpNarrative** priority | YES — Priority 1 (consultant pre-built) | **MISSING** |
| **bellaCheckLine** fallback | YES — Last resort before generic | **MISSING** |
| cleanFact filter | No filtering on problems/solutions | Filters out strings <6 chars or containing JSON |

**Why this is DEGRADED:**
The bridge has `icpNarrative` as Priority 1 — when the consultant writes a bespoke spoken line for ICP confirmation, the bridge uses it directly. The DO always falls back to mechanical stitching of `icpGuess + icpProblems + icpSolutions`. Similarly, `bellaCheckLine` is a consultant-written fallback that provides a more natural line when full ICP data is missing.

**Fix required:** Add `icpNarrative` as Priority 1 and `bellaCheckLine` as Priority 4 (before GENERIC) in DO wow_3.

### REF_OFFER Branch (when icpGuess + referenceOffer present, but <2 problems/solutions)

**Bridge:**
```
From your website, it looks like your positioning is really centred
around ${referenceOffer}, and the way you present it suggests you're
speaking to ${cleanIcp}. Does that sound right?
```

**DO:**
```
From your website, it looks like your positioning is centred around
${referenceOffer}, and it seems like you're speaking mainly to
${icpGuess || lang.pluralOutcome}. Does that sound right?
```

Minor wording differences ("really centred" vs "centred", "the way you present it suggests" vs "it seems like"). DO falls back to `lang.pluralOutcome` ("patients") when icpGuess is empty — bridge uses `cleanIcp` which would be empty.

### GENERIC Branch

**Bridge:** `The site does a strong job of positioning what Coastal does. Does that sound right?`
**DO:** `The site does a strong job of positioning what Coastal Dental Care does. Does that sound right?`

**Difference:** Bridge's `shortBizName("Coastal Dental Care")` = **"Coastal"** (first word). DO's `shortBiz(state)` = **"Coastal Dental Care"** (first 3 meaningful words). DO preserves more of the name.

---

## 4. WOW Stall 4 (Bridge) vs NO DIRECT DO EQUIVALENT

### Bridge (stall 4) — Pre-Training Connect:
```
That's exactly the kind of business intelligence we've used to pre-train
your AI team — so they don't sound generic. They understand your
positioning, your patients, your reputation, and most importantly how
you generate revenue.
```
+ Trial re-offer if stall 2 was skipped: `If you'd like, I can also help you activate the free trial during this session.`

### Verdict: MISSING_IN_DO

**What the bridge delivers that the DO doesn't:**
1. Explicit "business intelligence" framing — tells prospect their data was used meaningfully
2. Four-pillar summary: "positioning, patients, reputation, revenue generation"
3. "So they don't sound generic" — addresses the #1 AI skepticism objection
4. Trial re-offer for skipped stall 2

**Partial coverage in DO:**
- wow_1 mentions "pre-trained agents" but doesn't summarize what was used
- wow_5 has trial re-offer when `trialMentioned=false` ✓
- Nowhere does DO say "they understand your positioning, your patients, your reputation"

**Fix required:** Consider adding the pre-training connect concept to wow_5 or as a new step between wow_4 and wow_5.

---

## 5. WOW Stall 5 (Bridge) vs wow_4_conversion_action (DO)

### Bridge (stall 5) — Conversion Event Alignment:

Branch priority:
1. `convNarrative` (consultant pre-built spoken line)
2. `agentTrainingLine` (consultant)
3. Rebuild from `primaryCTA`
4. Generic

**Bridge (generic path for test prospect with primaryCTA="Book Online"):**
```
So looking at your website, it seems your main conversion event is Book
Online. That's how you turn interest into new patients, and it's exactly
the kind of action we train your AI agents to drive more of,
automatically. Would that be useful?
```

### DO (wow_4) — Conversion Action:

Branch priority:
1. `agentTrainingLine` (>30 chars)
2. `ceaBellaLine` (>20 chars)  ← NEW, bridge didn't have this
3. CTA with type classification  ← NEW, bridge didn't have this
4. CTA text only
5. Generic

**DO (CTA_TYPED_booking path for test prospect):**
```
And it looks like your main conversion action is a booking action — Book
Online. That's exactly the kind of conversion we train your AI agents to
drive more of. Is that the right focus?
```

### Verdict: DEGRADED (for lost convNarrative) + IMPROVED (for type classification)

| Aspect | Bridge | DO |
|--------|--------|-----|
| **convNarrative** priority | YES — Priority 1 | **MISSING** |
| bellaLine priority | No | YES — Priority 2 |
| CTA type classification | No | YES — booking/phone/form/quote/purchase/download |
| Type-specific spoken label | No | YES ("a booking action", "an inbound call", etc.) |
| Industry term in text | "new patients" | *(not used)* |
| Close question | "Would that be useful?" | "Is that the right focus?" |
| Connector | "So looking at your website" | "And it looks like" |

**Why DEGRADED for convNarrative:**
When the consultant writes a `conversionNarrative` — a bespoke spoken paragraph about how the business converts — the bridge uses it as-is. It's often better than any mechanical reconstruction. The DO drops this entirely.

**Why also IMPROVED:**
The DO's CTA type classification is genuinely better than the bridge's text-only approach. "A booking action — Book Online" is clearer than "your main conversion event is Book Online."

**Fix required:** Add `convNarrative` as Priority 0 (before agentTrainingLine) in DO wow_4.

---

## 6. WOW Stall 6 (Bridge) vs wow_5_alignment_bridge (DO)

### Bridge (stall 6) — Audit Setup Transition:
```
Perfect — so that confirms your agents are trained to bring in the right
kind of patients and move them toward your key conversion points. I've
just got a couple of quick opportunity-audit questions so I can work out
which agent mix would be most valuable for Coastal Dental Care.
```

### DO (wow_5) — Alignment Bridge:
```
Great — that helps confirm your agents are dialled in around the
highest-value opportunities.
```
+ Trial re-offer if `trialMentioned=false`: `And by the way, if you'd like to activate a free trial at any point during the demo, just let me know — I can set that up for you.`

### Verdict: DEGRADED

| Aspect | Bridge | DO |
|--------|--------|-----|
| Length | ~40 words | ~12 words (70% shorter) |
| Agent capabilities | "trained to bring in the right kind of patients" | "dialled in" (vague) |
| Conversion mention | "move them toward your key conversion points" | *(missing)* |
| **Audit framing** | "opportunity-audit questions" + "agent mix" | **MISSING** |
| Trial re-offer | In stall 4, not here | Here when trialMentioned=false ✓ |

**Why this is DEGRADED:**
The bridge's stall 6 serves a critical conversational function: it **frames the transition to numbers**. "I've just got a couple of quick opportunity-audit questions" prepares the prospect for the channel questions that follow. Without this framing, the jump from WOW insights to "how many ad leads per week?" feels abrupt.

**Fix required:** Add the audit framing language to DO wow_5: "I've got a few quick questions so I can work out which agent setup would create the most value for {business}."

---

## 7. NO BRIDGE EQUIVALENT vs wow_6_scraped_observation (DO)

### DO (wow_6) — Scraped Observation + Hiring Wedge:

6 priority paths:
1. **SCRAPED_SUMMARY:** `Also Sarah, we noticed Strong focus on patient experience with modern facilities and same-day availability. That helps show where the biggest upside from automation could be for Coastal Dental Care.`
2. **MOST_IMPRESSIVE:** From consultant's `mostImpressive[0].bellaLine`
3. **HIRING_WEDGE_CONSULTANT:** From consultant's `topHiringWedge`
4. **HIRING_WEDGE_MATCH:** `I noticed you're hiring for ${role}...`
5. **HIRING_WEDGE_GENERIC:** `I noticed you're actively hiring...`
6. **GENERIC:** `From what we can already see on your site, there looks to be a clear opportunity to improve how inbound demand gets captured and converted.`

For test prospect (has scrapedDataSummary, not hiring):
```
Also Sarah, we noticed Strong focus on patient experience with modern
facilities and same-day availability. That helps show where the biggest
upside from automation could be for Coastal Dental Care.
```

### Verdict: MISSING_IN_BRIDGE

**What DO adds:**
- A dedicated observation step that demonstrates research depth
- Scraped data summary spoken as a finding
- Hiring wedge consolidated here (bridge had it in stall 8)
- `mostImpressive` consultant line as a priority path

**Notes:** This is a valuable addition. The bridge had scraped data in the intel context but never spoke it as a WOW finding. The DO turns passive data into an active demonstration of research capability.

---

## 8. WOW Stall 7 (Bridge) vs wow_8_source_check (DO)

### Bridge (stall 7) — Lead Source Detection:

3 variants:
1. **sourceAlreadyClear:** `Now Sarah, apart from referrals, it looks like paid advertising is a meaningful source of new patients for you — is that fair to say?`
2. **adsOn (test prospect):** `Now Sarah, I can see you're already running ads, which is interesting. Apart from referrals, would you say that's your main source of new patients, or is another channel doing most of the heavy lifting?`
3. **else:** `Apart from referrals, what would you say is your main source of new patients right now — your website, phone calls, organic, paid ads, or something else?`

### DO (wow_8) — Source Check:

3 variants:
1. **source-already-known** (high confidence): `speak: ''` + skip
2. **adsOn (test prospect):** `Apart from referrals, are paid ads your main source of new patients, or is another channel doing a lot of the work as well?`
3. **else:** `Apart from referrals, where does most new business come from right now — your website, paid ads, phone calls, organic, or something else?`

### Verdict: DIFFERENT

| Aspect | Bridge | DO |
|--------|--------|-----|
| Name personalization | "Now Sarah" (2 variants) | *(no name in question)* |
| Engagement phrase | "which is interesting" | *(missing)* |
| sourceAlreadyClear | Asks confirming question | **Skips entirely** (silent) |
| Ads-detected wording | "would you say that's your main source" | "are paid ads your main source" |
| No-ads option order | website, phone, organic, ads, other | website, ads, phone, organic, other |
| Follow-up note | *(none)* | Has follow-up note in `notes[]` for vague replies |

**Notes:**
- Bridge is more personal ("Now Sarah", "which is interesting")
- DO's skip behavior when source is already known is efficient but loses a confirmation touchpoint
- DO adds a follow-up note for handling vague replies — bridge relies on Gemini to figure it out

---

## 9. WOW Stall 8 (Bridge) vs wow_6 HIRING_WEDGE Branch (DO)

### Bridge (stall 8) — Hiring Wedge:

For test prospect (NOT hiring):
```
And are you doing any hiring at the moment?
```
*(Bridge ALWAYS asks this question, even when no hiring signal exists.)*

For hiring with match: `I also noticed you're hiring for ${role}, which is interesting because that's exactly the kind of workload one of our agents can often absorb.`

### DO (wow_6) — Hiring folded into Scraped Observation:

For test prospect (NOT hiring, has scrapedDataSummary):
Hiring paths 3-5 are bypassed. wow_6 delivers SCRAPED_SUMMARY instead.
The hiring question is **never asked** — DO doesn't ask about hiring when there's no hiring signal.

### Verdict: DIFFERENT

| Aspect | Bridge | DO |
|--------|--------|-----|
| Asks about hiring when not hiring | YES (always) | NO (only speaks when hiring signal present) |
| Dedicated hiring stall | YES (stall 8) | NO (folded into wow_6) |
| topHiringWedge usage | YES (priority 1) | YES (priority 3 in wow_6) |
| Hiring match line | YES | YES (priority 4 in wow_6) |
| Generic hiring | YES ("actively hiring") | YES (priority 5 in wow_6) |

**Notes:** Bridge asks every prospect about hiring — this can feel irrelevant for non-hiring businesses and wastes a WOW turn. DO only raises hiring when it has evidence, which is more efficient and relevant.

---

## 10. WOW Stall 9 (Bridge) vs wow_7_explore_or_recommend + recommendation (DO)

### Bridge (stall 9) — Provisional Rec + Bridge to Numbers:

For test prospect (priority_agents=["alex","chris","maddie"], not hiring, no ctaAgentMapping):
```
Based on what I've found so far, the likely standouts for Coastal Dental
Care look like Alex and Chris. Alex would help with engaging visitors on
your website before they bounce, and Chris would help with following up
every patient enquiry. If you want, I can now work out which of those
would likely generate the most extra revenue for you.
```

**BUG IN BRIDGE:** The generic path hardcodes "engaging visitors on your website" for a1 and "following up every patient enquiry" for a2. When consultant priority puts Alex first, the role descriptions are **swapped** — Alex is described as doing Chris's job (website engagement) and vice versa.

### DO — Two-step approach:

**wow_7_explore_or_recommend:**
```
You can explore the agents yourself, or I can recommend the highest-value
ones for Coastal Dental Care and bring the first one on live so you can
hear how they'd handle your prospects. Sound good?
```

**recommendation stage (all 3 eligible):**
```
Based on what we've found, Alex looks like the biggest opportunity first,
and then Chris and Maddie both look relevant. Alex tightens lead
follow-up, Chris drives more website actions, and Maddie captures call
opportunities that might otherwise be lost. If you want, I can work out
which of those is likely to create the most extra revenue.
```
+ Hiring reference append if applicable.

### Verdict: IMPROVED

| Aspect | Bridge | DO |
|--------|--------|-----|
| Agent count | 2 agents named | All eligible agents named (up to 3) |
| Role accuracy | **BUGGED** — roles can be swapped | Correct: Alex=follow-up, Chris=website, Maddie=calls |
| Explore option | Not offered | "explore yourself or I recommend" |
| Variants | 3 (ctaMapping, hiring, generic) | 5 (all3, alex+chris, alex+maddie, maddie-only, generic) |
| Numbers bridge | Combined with rec | Separate wow_7 then recommendation |
| Hiring mention | In ctaMapping/hiring variants | As append to any variant |

**Notes:** DO is clearly better here. Correct agent-role mapping, more variants for different eligibility combinations, and the explore/recommend choice is a useful prospect engagement technique.

---

## 11. recommendation stage (DO only)

### Verdict: MISSING_IN_BRIDGE

The DO has a dedicated `recommendation` stage between wow and anchor_acv with 5 variants:
1. **All 3 eligible:** Names all 3 agents with correct roles
2. **Alex + Chris:** Mentions follow-up lift + website CTA
3. **Alex + Maddie:** Mentions follow-up lift + phone path
4. **Maddie only:** Phone-focused recommendation
5. **Generic fallback:** "a few agents that could add real value"

Bridge folded this into wow stall 9 with only 3 variants and a role-swap bug.

---

## 12. anchor_acv

### Bridge:
```
Perfect. What's a new patient worth to Coastal Dental Care on average?
A ballpark is totally fine.
```
Then (after ACV captured):
```
Got it, thanks. And when you think about lead flow, do you usually
measure it weekly or monthly?
```

### DO:
```
Perfect. What's a new patient worth to Coastal Dental Care on average?
A ballpark is totally fine.
```
*(No timeframe question — DO is weekly-native.)*

### Verdict: EQUIVALENT

Identical ACV question text. DO deliberately removed the timeframe question (see item 13).

---

## 13. anchor_timeframe (Bridge) vs NO DO EQUIVALENT

### Bridge:
```
Got it, thanks. And when you think about lead flow, do you usually
measure it weekly or monthly?
```

### DO: *(removed)*

### Verdict: MISSING_IN_DO (intentional)

**Design decision:** DO is weekly-native. All ROI formulas use weekly inputs directly. Bridge supported weekly/monthly with a `wf` multiplier (`timeframe === "monthly" ? 1/4.3 : 1`), which added complexity and introduced the `/52` formula bug (see ROI section).

---

## 14. Channel Stages: ch_ads/ch_website/ch_phone (Bridge) vs ch_alex/ch_chris/ch_maddie (DO)

### 14a. Alex (Speed-to-Lead)

#### Questions Comparison

| Q# | Bridge (ch_ads, ads detected) | DO (ch_alex, ads path) |
|----|-------------------------------|------------------------|
| Q1 | "How many leads are your ads generating per week? Just a rough figure is fine." | "Roughly how many leads are your ads generating in a typical week?" |
| Q2 | "And roughly how many of those are converting into paying patients?" | "And how many of those are turning into paying patients?" |
| Q3 | "And when those ad leads come in, how quickly is your team following up — under 30 minutes, 30 minutes to 3 hours, 3 to 24 hours, or more than 24 hours?" | "When those ad leads come in, how quickly is your team usually following up?" |

| Q# | Bridge (ch_ads, NO ads detected) | DO (ch_alex, aggregate-online) |
|----|----------------------------------|-------------------------------|
| Q1 | "I didn't see any Google or Facebook ads campaigns — is that right? Are you running any other online campaigns?" | "Roughly how many online enquiries or leads need follow-up in a typical week?" |

**Key differences:**
- Bridge offers speed tiers explicitly in Q3; DO relies on natural language extraction
- Bridge has a no-ads-detected variant that probes for campaigns; DO skips this (assumes intel is correct)
- DO has 3 sub-paths (ads/website/aggregate-online); bridge has only ads-scoped
- Bridge: "per week" vs DO: "in a typical week"
- Bridge: "Just a rough figure is fine" dropped in DO

#### ROI Delivery Comparison

**Bridge:**
```
So your average patient is worth 2,500 dollars, and you're currently
converting 8 from 30 ad leads per week. Based on the follow-up speed you
mentioned, Alex could conservatively add around 1,504 dollars per week
just by improving speed-to-lead. Does that make sense?
```

**DO:**
```
So with an average patient value of 2,500 dollars, around 30 inbound
leads a week, and a response time of two to twenty-four hours, Alex
could conservatively add around 10,000 dollars a week just by tightening
speed-to-lead and follow-up consistency. Does that make sense?
```

| Aspect | Bridge | DO |
|--------|--------|-----|
| Conversion ratio stated | "converting 8 from 30" | *(omitted)* |
| Speed mentioned | "the follow-up speed you mentioned" (vague) | "two to twenty-four hours" (specific, spoken label) |
| $ figure | **$1,504/week** | **$10,000/week** |
| Wording | "dollars per week" | "dollars a week" |
| Mechanism | "improving speed-to-lead" | "tightening speed-to-lead and follow-up consistency" |

**Verdict: DIFFERENT** — DO scopes Alex questions to detected channel (ads/website/aggregate). ROI delivery is more specific about speed. See ROI Formula section for the massive number difference.

---

### 14b. Chris (Website Conversion)

#### Questions Comparison

| Q# | Bridge (ch_website) | DO (ch_chris) |
|----|---------------------|---------------|
| Q1 | "How many enquiries or leads is your website generating per week?" | "Roughly how many website enquiries are you getting in a typical week?" |
| Q2 | "And roughly how many of those convert into paying patients?" | "And how many of those turn into paying patients?" |
| Q3 | "And when a website enquiry comes in, how quickly is your team usually getting back to them?" | *(removed — not needed for conversion-rate model)* |

**Key difference:** DO correctly removes Q3 (follow-up speed). Chris's uplift model is conversion-rate-based (23% lift), not speed-based. Asking about follow-up speed for Chris is irrelevant and wastes a question.

#### ROI Delivery Comparison

**Bridge:**
```
So you're getting around 20 website leads per week, and converting about
5 of them into paying patients. Chris, our Website Concierge, typically
lifts conversion by engaging visitors in real time, and at your value of
2,500 dollars that could mean roughly 55 dollars per week in additional
revenue. Does that sound reasonable?
```

**DO:**
```
So you're getting around 20 website leads a week and converting about 5.
Chris typically lifts conversion by engaging people in real time, and at
an average value of 2,500 dollars that could mean roughly 2,875 dollars
a week in extra revenue. Does that sound reasonable?
```

| Aspect | Bridge | DO |
|--------|--------|-----|
| Agent title | "Chris, our **Website Concierge**" | "Chris" (no title) |
| $ figure | **$55/week** | **$2,875/week** |
| Conversion desc | Hardcoded "converting about 5" | Dynamic: count or rate % |
| "visitors" vs "people" | "engaging visitors" | "engaging people" |

**Verdict: IMPROVED** — DO correctly removes irrelevant Q3, but loses "Website Concierge" title. Numbers dramatically different (see ROI).

---

### 14c. Maddie (Missed Call Recovery)

#### Questions Comparison

| Q# | Bridge (ch_phone) | DO (ch_maddie) |
|----|-------------------|----------------|
| Q1 | "Roughly how many inbound calls does Coastal Dental Care get per week?" | "Roughly how many inbound calls do you get in a typical week?" |
| Q2 | "And when calls are missed — whether that's after hours or during busy periods — what usually happens?" | "And roughly how many of those get missed?" |
| Q3 | "And how quickly are missed calls usually called back?" | *(removed)* |

**Key difference:** Bridge asks **what happens** when calls are missed (captures after_hours behavior), then asks callback speed. DO asks **how many** get missed (captures missed count directly). Bridge's approach captures richer qualitative data; DO's is more direct and efficient.

#### 24/7 Skip Comparison

**Bridge:** `"PHONE — Maddie — 24/7 coverage confirmed. Skip Maddie, acknowledge and advance."` (instruction to Gemini)
**DO:** `"Since you've got full coverage on the phones, let's focus on where the bigger opportunity is."` (actual speak text)

DO has better skip handling — actual spoken text vs a Gemini instruction.

#### ROI Delivery Comparison

**Bridge:**
```
So you're getting around 80 inbound calls per week, and when calls are
missed they're currently handled by voicemail. Even a small percentage of
missed opportunities there adds up fast, so conservatively Maddie could
recover around 216 dollars per week in extra revenue by answering and
qualifying more of those calls consistently. Does that track?
```

**DO:**
```
So if you're getting around 80 inbound calls a week and missing about 15,
that's a meaningful number of live opportunities at risk. When people hit
voicemail, a lot of them just try the next option. That's why Maddie is
so valuable — she captures and qualifies more of those calls before they
disappear. Conservatively, that could mean around 6,563 dollars a week in
recovered revenue. Does that track?
```

| Aspect | Bridge | DO |
|--------|--------|-----|
| After-hours mention | "handled by voicemail" | "When people hit voicemail..." (emotional) |
| Urgency language | "adds up fast" | "live opportunities at risk", "try the next option", "before they disappear" |
| $ figure | **$216/week** | **$6,563/week** |
| Mechanism | "answering and qualifying" | "captures and qualifies" |

**Verdict: IMPROVED** — DO's delivery is significantly more emotionally compelling. The urgency language ("live opportunities at risk", "try the next option", "before they disappear") is better sales copywriting. Question path is cleaner (2 vs 3 questions). Numbers vastly different.

---

## 15. ch_old_leads (Bridge) vs ch_sarah (DO)

### Question Comparison

**Bridge:** `"How many past patients or older leads would you say are sitting in your database that haven't been contacted in a while?"`

**DO:** `"Roughly how many old leads or past contacts are sitting in your database right now — even a ballpark is fine?"`

Minor wording differences. DO adds "even a ballpark is fine" encouragement.

### ROI Delivery Comparison

**Bridge:**
```
If even a small percentage of those older leads re-engage, Sarah could
turn that dormant database into a real revenue channel. Based on the
number you gave me, that could look like around 1,202 dollars per week
in recovered opportunity. Sound fair?
```

**DO:**
```
So you've got around 500 old leads sitting in your database. Even at a
conservative five percent reactivation rate, that's a dormant pipeline
worth around 62,500 dollars that Sarah could help you unlock — and these
are people who already know Coastal Dental Care. Does that make sense?
```

### Verdict: DIFFERENT (intentional design change)

| Aspect | Bridge | DO |
|--------|--------|-----|
| Value framing | **"$1,202 dollars per week"** (weekly-ized pool) | **"$62,500 dollars"** (total pool value) |
| Reactivation rate stated | "small percentage" (vague) | "five percent reactivation rate" (specific) |
| Personal touch | *(none)* | "people who already know Coastal Dental Care" |
| Lead count stated | *(not restated)* | "500 old leads" (restated) |
| Formula | `500 × 0.05 × 2500 / 52 = $1,202/wk` | `500 × 0.05 × 2500 = $62,500 total` |

**CRITICAL:** Bridge artificially weekly-izes Sarah's pool value by dividing by 52, presenting a dormant database as a weekly revenue stream. DO correctly presents it as a one-time recoverable pool. This is commercially more honest — a dormant database doesn't generate $1,202 **every week forever**; it represents ~$62,500 of potential one-time recovery.

---

## 16. ch_reviews (Bridge) vs ch_james (DO)

### Question Comparison

| Q# | Bridge (ch_reviews) | DO (ch_james) |
|----|---------------------|---------------|
| Q1 | "Roughly how many new patients do you bring in each week?" | "Roughly how many new patients does Coastal Dental Care bring on in a typical week?" |
| Q2 | "What's your current average rating?" | "And do you know roughly what your current Google star rating is?" |
| Q3 | "Roughly how many reviews do you have?" | *(removed — uses Google Maps data)* |
| Q4 | Review system question with Google data | "And do you currently have any kind of system for actively collecting and managing your online reviews?" |

DO removes Q3 (review count) — already available from Google Maps deep intel. Reduces to 3 questions max.

### has_review_system=false ROI Delivery

**Bridge:**
```
With your current patient flow, even a modest lift in review volume and
response consistency can materially improve trust and conversion.
Conservatively, James could create around 2,700 dollars per week in
additional value by increasing review momentum and protecting your
reputation. Does that seem realistic?
```

**DO:**
```
So with around 12 new patients a week, if James automates your review
collection and gets your rating climbing, the data shows a nine percent
revenue uplift per star improvement. That works out to roughly 840
dollars a week in additional revenue as your reputation compounds.
Does that track?
```

| Aspect | Bridge | DO |
|--------|--------|-----|
| Mechanism stated | "review volume and response consistency" (vague) | "automates review collection", "nine percent revenue uplift per star" (specific) |
| $ figure | **$2,700/week** | **$840/week** |
| Formula transparency | Hidden | States the 9%/star principle |
| Rating ceiling cap | **No cap** (flat 9% regardless of current rating) | **Capped** at room to 5.0 stars |

### has_review_system=true Path

**Bridge:** `"Great, sounds like you've already got that covered. Let me summarise the opportunity..."`

**DO:** `"It sounds like you've already got a review system in place, which is great — that means James would be more of a refinement than a revenue driver for Coastal Dental Care right now."`

DO provides a fuller explanation of why James is skipped.

### Verdict: IMPROVED

DO is better because:
1. Fewer questions (removes known data from deep intel)
2. States the formula principle transparently ("9% per star")
3. Caps at 5.0 stars (bridge doesn't — at 4.6★, room is only 0.4, not 1.0)
4. More specific mechanism language
5. Better skip text for has_review_system=true

---

## 17. roi_delivery

### Bridge:
```
So Sarah, let me add that up for you. We've got Alex at about 1,504
dollars per week, and Chris at about 55 dollars per week, and Maddie
at about 216 dollars per week. That's a combined total of approximately
1,775 dollars per week in additional revenue across your selected agents
— and those are conservative numbers. Does that all make sense?
```
*(Sarah's $1,202/week is included in the combined total if she was calculated, making it ~$2,977/week.)*

### DO:
```
So Sarah, if we add that up, we've got Alex at about 10,000 dollars a
week and Chris at about 2,875 dollars a week and Maddie at about 6,563
dollars a week. That's a combined total of roughly 19,438 dollars a week
in additional revenue, and those are conservative numbers. And
separately, Sarah could unlock around 62,500 dollars from your dormant
database. And James could add around 840 dollars a week through
reputation uplift. Does that all make sense?
```

### Verdict: IMPROVED

| Aspect | Bridge | DO |
|--------|--------|-----|
| Core total | **$1,775/week** (or ~$2,977 with Sarah) | **$19,438/week** (core 3 only) |
| Sarah in total | **Included** (weekly-ized) | **Excluded** — mentioned separately as pool |
| James in total | Included if calculated | **Excluded** — mentioned separately |
| Sarah framing | "$X dollars per week" (misleading) | "$62,500 from your dormant database" (accurate) |
| James framing | "$X dollars per week" | "$840 a week through reputation uplift" |
| Wording | "approximately", "across your selected agents" | "roughly" |

**Notes:** DO correctly separates:
- Core recurring revenue (Alex + Chris + Maddie) as the combined total
- Sarah as a one-time pool (excluded from combined)
- James as optional side agent (excluded from combined)

Bridge lumps everything into one number, including Sarah's artificially weekly-ized pool value.

---

## 18. close

### Standard Close

**Bridge:**
```
Perfect. Would you like to go ahead and activate your free trial? It
takes about ten minutes to set up, there's no credit card required, and
you could start seeing results this week.
```

**DO:**
```
Perfect. Would you like to go ahead and activate your free trial? It
takes about ten minutes to set up, there's no credit card required, and
you could start seeing results this week.
```

**Verdict: EQUIVALENT** — identical text.

### just_demo Close

**Bridge:** Uses the same close text (no separate just_demo close variant in buildStageDirective — the just_demo flag only affects stage routing, not close text).

**DO:**
```
No worries at all — you can explore everything on the page at your own
pace. If you'd like to activate the free trial, it takes about ten
minutes, no credit card required. Would you like me to set that up?
```

**Verdict: MISSING_IN_BRIDGE** — DO adds a dedicated just_demo close variant that's more appropriate for prospects who declined the numbers path.

---

## CROSS-CUTTING BEHAVIORS

### A. Business Name Formatting

| | Bridge | DO |
|---|--------|-----|
| Full name function | `normaliseBizName()` + `ttsAcronym()` | `biz()` (raw from state/intel) |
| Short name function | `shortBizName()` | `shortBiz()` |
| City stripping | YES (Sydney, Melbourne, etc.) | YES (same cities in stop words) |
| Legal stripping | YES (Pty Ltd, Inc, LLC, etc.) | YES (same suffixes in stop words) |
| TTS acronym | YES (AMP → A. M. P.) | **NO** |
| Short name logic | First word (if not stop word) | First 3 meaningful words |

**Test: "Coastal Dental Care"**
- Bridge full: "Coastal Dental Care" (no changes)
- Bridge short: **"Coastal"**
- DO full: "Coastal Dental Care" (no changes)
- DO short: **"Coastal Dental Care"** (all 3 words are meaningful)

**Test: "AMP"**
- Bridge: **"A. M. P."** (TTS letter-spacing)
- DO: **"AMP"** (no TTS handling — Deepgram may mispronounce)

**Test: "Pitcher Partners Sydney Pty Ltd"**
- Bridge full: "Pitcher Partners" (strips Sydney + Pty Ltd)
- Bridge short: "Pitcher"
- DO full: "Pitcher Partners Sydney Pty Ltd" (raw — `biz()` doesn't strip) **← DEGRADED**
- DO short: "Pitcher Partners" (strips Sydney, Pty, Ltd from stop words)

> **DEGRADED NOTE:** DO's `biz()` function returns the raw business name from state/intel without stripping cities or legal suffixes. Only `shortBiz()` strips. When the full name is used in speech (e.g., "we've researched Pitcher Partners Sydney Pty Ltd"), it sounds unnatural. Bridge's `normaliseBizName()` strips both, so the full name is always clean.

> **DEGRADED NOTE:** DO lacks `ttsAcronym()`. For businesses like AMP, KPMG, etc., Deepgram TTS may read "AMP" as a word instead of spelling it out. Bridge prevents this with letter-spacing (A. M. P.).

### B. Industry Language

| | Bridge | DO |
|---|--------|-----|
| System | `custTerm(industry)` → single string | `IndustryLanguagePack` → object with multiple fields |
| Singular | "patient" | `singularOutcome` = "patient" |
| Plural | "patients" (via `${ct}s` concat) | `pluralOutcome` = "patients" |
| Extra fields | *(none)* | `industryLabel`, `verbPhrase`, etc. |

For dental, output is functionally identical: "patient" / "patients".

DO's `IndustryLanguagePack` is richer but the extra fields aren't used in current directives. **EQUIVALENT** in practice.

### C. ROI Number Formatting

| | Bridge | DO |
|---|--------|-----|
| Number format | `.toLocaleString()` | `.toLocaleString()` |
| Period label | "dollars per week" or "dollars per month" | "dollars a week" (always weekly) |
| Annual projection | Not in delivery (only internally) | Not in delivery |

Minor: "per week" vs "a week" — subjective which sounds more natural in speech.

### D. Consultant Data Usage

#### Bridge uses, DO doesn't:
| Field | Bridge Usage | Impact |
|-------|-------------|--------|
| `icpNarrative` | wow stall 3 Priority 1 | **HIGH** — bespoke spoken ICP line |
| `convNarrative` | wow stall 5 Priority 1 | **HIGH** — bespoke spoken conversion line |
| `bellaCheckLine` | wow stall 3 last resort | MEDIUM — better than generic fallback |
| `ctaAgentMapping` | wow stall 9 rec line | LOW — only used in one variant |
| `timeframe` | "weekly"/"monthly" | LOW — intentionally removed |
| `marketPositionNarrative` | wow stall 3 (unused in practice) | LOW — was available but rarely fired |
| `conversionNarrative` | wow stall 5 Priority 1 | **HIGH** — same as convNarrative |

#### DO uses, bridge doesn't:
| Field | DO Usage | Impact |
|-------|---------|--------|
| `conversionEventAnalysis.bellaLine` | wow_4 Priority 2 | MEDIUM — new consultant field |
| `conversionEventAnalysis.ctaType` | wow_4 type classification | HIGH — typed CTA classification |
| `mostImpressive[0].bellaLine` | wow_6 Priority 2 | MEDIUM — new observation line |
| `scrapedDataSummary` | wow_6 Priority 1 | HIGH — spoken research finding |
| `industryLanguagePack` | Multiple stages | LOW — same output as custTerm for dental |
| Eligibility engine | recommendation stage | HIGH — proper agent-role mapping |

---

## ROI FORMULA COMPARISON (CRITICAL)

### The /52 Problem in Bridge

The bridge ROI formula uses: `conversions × wf × uplift × ACV / 52`

When `timeframe = "weekly"`, `wf = 1`, so the formula becomes:
`weekly_conversions × uplift × ACV / 52`

This divides an already-weekly figure by 52, producing a number that is 1/52 of what it should be. This appears to be a legacy artifact from when the formula may have expected annual inputs.

### Side-by-Side Calculations (Test Prospect)

| Agent | Bridge Formula | Bridge Result | DO Formula | DO Result |
|-------|---------------|---------------|------------|-----------|
| **Alex** | `8 × 3.91 × 2500 / 52` | **$1,504/wk** | `30 × 13.3% × 2500` | **$10,000/wk** |
| **Chris** | `5 × 0.23 × 2500 / 52` | **$55/wk** | `20 × 5.75% × 2500` | **$2,875/wk** |
| **Maddie** | `15 × 0.3 × 2500 / 52` | **$216/wk** | `15 × 35% × 2500 × 50%` | **$6,563/wk** |
| **Sarah** | `500 × 5% × 2500 / 52` | **$1,202/wk** | `500 × 5% × 2500` | **$62,500 total** |
| **James** | `12 × 52 × 2500 × 9% / 52` | **$2,700/wk** | `12 × 2500 × 0.4 × 7%` | **$840/wk** |
| **Core Total** | | **$1,775/wk** | | **$19,438/wk** |

### Key Formula Differences

| Aspect | Bridge | DO |
|--------|--------|-----|
| Alex model | Tier-based multiplier (0.5x-3.91x) on conversions | Gap-factor × max-uplift on leads × incremental rate |
| Alex speed mapping | 4 tiers: <30m, 30m-3h, 3h-24h, >24h | 6 bands: under_30s, under_5m, 5-30m, 30m-2h, 2-24h, next_day+ |
| Chris model | `conversions × 23% × ACV / 52` | `leads × incremental_rate × ACV` (23% uplift, 35% cap) |
| Maddie model | `missed × 30% × ACV / 52` | `missed × 35% recovery × ACV × 50% booked-value` |
| Sarah model | Pool / 52 = weekly | Pool total (no weekly conversion) |
| James model | Flat 9% of annual revenue | 7% per star × projected star uplift (capped at 5.0) |
| Division by 52 | **Present in all formulas** | **Not present** |
| Implausible rate guard | None | Yes (>95% rate → conservative 15% default) |
| Conversion cap | None | Alex: 40%, Chris: 35% |

### Why the Numbers Differ So Much

1. **The /52 bug:** Bridge divides weekly figures by 52, systematically understating all ROI by ~52x
2. **Alex model:** Bridge uses a simple multiplier on conversions; DO uses gap-factor × max-uplift applied to total leads × incremental conversion rate. DO calculates from leads (30), bridge from conversions (8)
3. **Maddie model:** Bridge uses 30% conversion; DO uses 35% recovery × 50% booked-value (net 17.5% but applied to missed calls × ACV directly, vs bridge's /52)
4. **James model:** Bridge applies flat 9% regardless of current rating; DO caps at room-to-5.0 and uses 7% per star. At 4.6★ with 0.4 room, this produces much less than bridge's uncapped 9%

### Commercial Impact

> **The ROI numbers Bella speaks to the prospect will be approximately 10x higher with the DO.** This is a deliberate change to more principled mathematics, but it requires commercial sign-off because prospects will hear dramatically different numbers.
>
> Bridge combined total for test prospect: **~$1,775/week**
> DO combined total for test prospect: **~$19,438/week**

---

## STAGE FLOW COMPARISON

### Bridge Stage Order:
```
wow (stalls 1-9) → anchor_acv → anchor_timeframe → [queue: ch_website, ch_ads] → roi_delivery → close
```
Queue is 2 channels from buildQueue + 1 tease. Old leads and reviews folded into queue or skipped.

### DO Stage Order:
```
greeting → wow (8 steps) → recommendation → anchor_acv → [queue: ch_alex, ch_chris, ch_maddie] → ch_sarah → ch_james → roi_delivery → optional_side_agents → close
```
Queue is up to 3 core agents + 2 optional agents.

| Bridge | DO | Notes |
|--------|-----|-------|
| *(no greeting)* | greeting | NEW |
| wow (9 stalls) | wow (8 steps) | 1 fewer (pre-training connect removed) |
| *(folded into wow 9)* | recommendation | Separate stage |
| anchor_acv | anchor_acv | Same |
| anchor_timeframe | *(removed)* | Weekly-native |
| ch_ads (Alex) | ch_alex | Renamed + multi-path |
| ch_website (Chris) | ch_chris | Renamed, fewer Qs |
| ch_phone (Maddie) | ch_maddie | Renamed, fewer Qs |
| ch_old_leads (Sarah) | ch_sarah | Renamed |
| ch_reviews (James) | ch_james | Renamed, fewer Qs |
| roi_delivery | roi_delivery | Restructured total |
| *(no equivalent)* | optional_side_agents | NEW |
| close | close | Same + just_demo variant |

---

## FINAL SUMMARY

### What the DO Does Better (IMPROVED):
1. **Greeting stage** — human opening with pause
2. **Recommendation stage** — correct agent-role mapping, 5 variants, explore option
3. **Channel scoping** — Alex adapts questions to ads/website/aggregate path
4. **Chris questions** — removes irrelevant follow-up speed Q3
5. **Maddie delivery** — emotionally compelling urgency language
6. **Sarah framing** — honest pool value vs misleading weekly-ized number
7. **James formula** — capped at room to 5.0, transparent 9%/star principle

### What the DO Lost (DEGRADED):
1. **icpNarrative** — consultant pre-built ICP spoken line (wow_3) **← FIX BEFORE M5**
2. **convNarrative** — consultant pre-built conversion line (wow_4) **← FIX BEFORE M5**
3. **Audit framing** — "opportunity-audit questions" transition (wow_5) **← FIX BEFORE M5**
4. **biz() doesn't strip** — full business name includes cities/legal suffixes
5. **ttsAcronym missing** — AMP, KPMG etc. may be mispronounced by TTS

### What the DO Changed Intentionally (DIFFERENT):
1. Weekly-native (no timeframe question)
2. shortBiz keeps 3 words (bridge keeps 1)
3. Hiring wedge folded into scraped observation (not a dedicated stall)
4. Source check skips when high confidence (bridge always asks)
5. "per week" → "a week"
6. ROI formulas completely redesigned (10x larger numbers)

### What the DO Added (MISSING_IN_BRIDGE):
1. wow_6_scraped_observation — spoken research finding
2. just_demo close variant text

### What the DO Removed (MISSING_IN_DO):
1. Pre-training connect (wow stall 4 concept)
2. anchor_timeframe (weekly/monthly choice)
3. icpNarrative, convNarrative, bellaCheckLine consultant priorities

---

## REQUIRED FIXES BEFORE M5

| # | Priority | Fix | File | Effort |
|---|----------|-----|------|--------|
| 1 | P0 | Add `icpNarrative` as Priority 1 in wow_3 (before ICP_FULL) | moves.ts:203 | Small |
| 2 | P0 | Add `convNarrative` as Priority 0 in wow_4 (before agentTrainingLine) | moves.ts:252 | Small |
| 3 | P0 | Add `bellaCheckLine` as Priority 4 in wow_3 (before GENERIC) | moves.ts:232 | Small |
| 4 | P1 | Add audit framing to wow_5: "I've got a few quick questions so I can size the opportunity" | moves.ts:308 | Small |
| 5 | P1 | Add `normaliseBizName()` equivalent to `biz()` — strip cities + legal suffixes | moves.ts:48 | Small |
| 6 | P2 | Add `ttsAcronym()` equivalent to `shortBiz()` — letter-space all-caps 2-4 char names | moves.ts:57 | Small |
| 7 | P2 | Commercial sign-off on 10x ROI number increase | *(decision)* | N/A |
