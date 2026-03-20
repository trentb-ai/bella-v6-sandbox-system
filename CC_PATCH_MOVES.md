# CC PATCH: moves.ts Script Alignment
# Priority: P0 — fixes script drift from Perplexity spec
# File: call-brain-do/src/moves.ts

## PROBLEM

moves.ts has drifted from the Perplexity-approved script. The consultant
generates rich strategic insight (icpAnalysis, conversionEventAnalysis,
pre-built spoken lines) but moves.ts ignores most of it and falls back
to shallow scriptFills fields that sound like copy lifted from the website.

Read these files FIRST before making any changes:
```
cat DO_BRAIN_IMPLEMENTATION_SPEC.md
cat call-brain-do/src/moves.ts
cat consultant-v9/worker.js
```

You need to understand what the consultant ACTUALLY outputs (the icpAnalysis,
conversionEventAnalysis, hiringAnalysis objects) so you use the RIGHT fields.

## THE 8 FIXES

### FIX 1: Stall 3 — Merge ICP + 2 problems + 2 solutions into ONE stall

CURRENT (WRONG): Stall 3 only does ICP observation. Problems/solutions missing entirely.

CORRECT per Perplexity: Stall 3 is the COMBINED ICP + problems + solutions stall.

The consultant outputs these fields you MUST use:
- `consultant.icpAnalysis.icpProblems[]` — array of 2-3 specific problems in THEIR language
- `consultant.icpAnalysis.icpSolutions[]` — array of 2-3 specific solutions in THEIR words
- `consultant.icpAnalysis.bellaCheckLine` — pre-written confirmation question
- `consultant.scriptFills.icp_guess` — who they sell to

PRIMARY directive (when icpProblems + icpSolutions have data):
"It looks like you mainly work with {icpGuess}. The common challenges
they run into are {icpProblems[0]} and {icpProblems[1]}, and you solve
those through {icpSolutions[0]} and {icpSolutions[1]}. Does that sound
about right?"

FALLBACK (when problems/solutions are thin but referenceOffer exists):
"From your website, it looks like your positioning is really centred
around {referenceOffer}, and the way you present it suggests you're
speaking to {industryAudience}. Does that sound right?"

LAST RESORT (no ICP data at all):
Use consultant.icpAnalysis.bellaCheckLine if it exists, otherwise:
"The site does a strong job of positioning what {shortBiz} does. Is that right?"

DO NOT split ICP and problems into separate stalls. ONE stall, ONE move.

### FIX 2: Stall 4 — Use Perplexity's exact pre-training text

CURRENT (WRONG): "feel like they've been inside {shortBiz} for years"
That's CC's invention. Not in the spec.

CORRECT per Perplexity:
"That's exactly the kind of intelligence we use to pre-train your AI
team, so they don't sound generic. They understand your positioning,
the way your buyers think, and most importantly how {business} actually
generates revenue — so they can help drive more of that while your
team focuses on delivery."

Optional append if trial not yet mentioned:
"And if you want, I can help you activate the free trial during this session."

### FIX 3: Stall 6 — Must be audit setup transition, NOT follow-up speed

CURRENT (WRONG): Stall 6 asks about follow-up speed. This violates
Perplexity's Channel Speed Rule: "ask follow-up speed inside the
relevant channel stage, not in WOW."

CORRECT per Perplexity — stall 6 is purely a transition:
"Perfect — that tells me your agents are aligned with the right
audience and the right conversion actions. I've just got a couple
of quick audit questions so I can work out which combination of
agents would create the most value for {business}."

This is a BRIDGE move (kind: 'bridge'), not a question. No extraction.

### FIX 4: Stall 7 — Add the third "source already clear" variant

CURRENT: Only has ads-detected and no-ads-detected variants.

CORRECT per Perplexity — THREE variants:

IF ads detected:
"Now {firstName}, I can see you're already running ads, which is
interesting. Apart from referrals, would you say that's your main
source of new {leadNoun}s, or is another channel doing most of the
heavy lifting?"

IF no ads detected:
"Apart from referrals, what would you say is your main source of new
{leadNoun}s right now — your website, phone calls, organic, paid ads,
or something else?"

IF source already mostly clear (new variant — add this):
"Now {firstName}, apart from referrals, it looks like {detectedChannel}
is a meaningful source of new {leadNoun}s for you — is that fair to say?"

Determine "source already clear" from routing.priority_agents or
strong ads/phone/website signals in intel flags.

### FIX 5: Stall 5 — Use consultant's conversionNarrative, not rebuilt version

CURRENT: CC rebuilds a conversion line from raw fields.

CORRECT: The consultant already generates these pre-built spoken lines:
- `consultant.conversionEventAnalysis.conversionNarrative` — 2-3 sentence spoken summary
- `consultant.conversionEventAnalysis.agentTrainingLine` — single sentence connecting CTAs to agents

Priority order:
1. Use conversionNarrative if it exists (it's already written for Bella to speak)
2. Fall back to agentTrainingLine
3. LAST RESORT: rebuild from primaryCTA

After the narrative, append: "Would that be useful?"

### FIX 6: Stall 9 — Split recommendation from bridge-to-numbers

CURRENT: Stall 9 crams recommendation AND bridge-to-numbers into one massive blob.

CORRECT per Perplexity: Stall 9 is the PROVISIONAL recommendation.
The bridge-to-numbers is a SHORT closing line, not a second paragraph.

Recommendation part (use consultant.conversionEventAnalysis.ctaAgentMapping
if available — it's pre-written):
"Based on what I've found so far, the likely standouts for {business}
look like {agent1} and {agent2}. {agent1} would help with
{agent1ContextNative}, and {agent2} would help with {agent2ContextNative}."

Bridge part (SHORT — one line):
"If you want, I can now work out which of those would likely generate
the most extra revenue."

Then STOP and wait. Do NOT add annual figures or trial re-pitch here.

### FIX 7: Channel stages — Add follow-up speed questions (currently missing)

Perplexity's Channel Speed Rule: follow-up speed is asked INSIDE the
channel stage, not in WOW.

ch_website needs Q3:
"And when a website enquiry comes in, how quickly is your team usually
getting back to them?"
Extract target: web_followup_speed

ch_ads already has follow-up speed Q3 — KEEP as-is.

ch_phone needs Q3:
"How quickly are missed calls usually called back?"
Extract target: missed_call_callback_speed

Update extractTargetsForStage() to include these new fields.
Update the channel packet builders to ask Q3 before delivering ROI.

### FIX 8: ROI delivery — Use Perplexity's clean format, no trial re-pitch

CURRENT: ROI delivery adds annual figure and re-pitches trial.
That belongs in CLOSE, not ROI delivery.

CORRECT per Perplexity — roi_delivery stall 0:
"So {firstName}, adding that up, we've got {agent1} at about {value1}
per {timeframeUnit}, and {agent2} at about {value2} per {timeframeUnit}.
That's a combined total of roughly {totalValue} in additional revenue
per {timeframeUnit}, and those are conservative numbers. Does that all
make sense?"

Stall 1: Brief confirmation, handle reaction, reinforce conservatism.
NO trial pitch. NO annual projection. Those come at close stage.

## GENERAL RULE: USE CONSULTANT PRE-BUILT SPOKEN LINES

The consultant generates these ready-to-speak lines. USE THEM as primary,
fall back to building from raw fields only when they're null:

| Consultant field | Use in |
|-----------------|--------|
| icpAnalysis.bellaCheckLine | Stall 3 fallback |
| copyAnalysis.bellaLine | Stall 4 fallback |
| valuePropAnalysis.bellaLine | Stall 5 fallback |
| conversionEventAnalysis.conversionNarrative | Stall 5 primary |
| conversionEventAnalysis.agentTrainingLine | Stall 5 secondary |
| conversionEventAnalysis.ctaAgentMapping | Stall 9 primary |
| hiringAnalysis.topHiringWedge | Stall 8 primary |

These lines are Gemini's STRATEGIC ANALYSIS, not raw website copy.
That's the whole point of the consultant — don't bypass it.

## EXECUTION

1. Read moves.ts, consultant-v9/worker.js, and this patch file
2. Apply all 8 fixes
3. Run tsc --noEmit to verify
4. Run wrangler deploy --dry-run on call-brain-do
5. Deploy call-brain-do
6. Report what changed

One change at a time. Verify after each fix compiles clean.
