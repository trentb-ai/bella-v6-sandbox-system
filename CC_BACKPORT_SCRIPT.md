# CC TASK: Backport Perplexity Script to Bridge buildStageDirective()
# Priority: P0 — This is the fastest path to improved scripting
# File: deepgram-bridge-v9/src/index.ts (function buildStageDirective, ~line 1625)
#
# CONTEXT: The DO brain (call-brain-do/src/moves.ts) has the correct
# Perplexity-approved script but the DO path broke because buildTinyPrompt()
# is too thin for Gemini. The old bridge path WORKS but has the old script.
#
# TASK: Apply the Perplexity script changes to the OLD bridge's
# buildStageDirective() function. DO NOT touch the DO brain code.
# DO NOT change the bridge architecture. Just update the script text.
#
# READ THESE FIRST:
# 1. This file (the mandate)
# 2. call-brain-do/src/moves.ts (the SOURCE OF TRUTH for correct scripting)
# 3. deepgram-bridge-v9/src/index.ts lines 1625-2024 (what you're changing)
# 4. CC_PATCH_MOVES_V2.md (the detailed diff of every change needed)

---

## WHAT TO CHANGE

The bridge buildStageDirective() has 12 WOW stalls. Perplexity's script
has 9. The content of each stall also needs updating. Here's the mapping:

### WOW STALLS — from 12 to 9

OLD stall 1 (Research intro) → NEW stall 1: Update text to Perplexity version
OLD stall 2 (Free trial)     → NEW stall 2: Shorten to 2 sentences per Perplexity
OLD stall 3 (ICP)            → NEW stall 3: MERGE with old stall 4 (problems+solutions)
OLD stall 4 (Problems)       → DELETED (merged into stall 3)
OLD stall 5 (Pre-training)   → NEW stall 4: Perplexity text with "how you generate revenue"
OLD stall 6 (Reputation)     → DELETED (moved into stall 2 if reviews exist)
OLD stall 7 (Conversion)     → NEW stall 5: Use conversionNarrative as primary
OLD stall 8 (Process check)  → DELETED (follow-up speed moves to channel stages)
OLD stall 9 (Data review)    → NEW stall 6: Audit setup transition (bridge, not question)
OLD stall 10 (Late data)     → NEW stall 7: Merged source question (3 variants)
OLD stall 11 (Agent rec)     → NEW stall 8: Hiring/capacity wedge
OLD stall 12 (Bridge)        → NEW stall 9: Provisional rec + short bridge

### Gate change
OLD: gate at stall >= 13
NEW: gate at stall >= 10

### Per-stall text changes

Use moves.ts as your EXACT source for the text of each stall.
Copy the chosenMove.text values from moves.ts into the bridge's
buildStageDirective() return strings. The text in moves.ts IS the
Perplexity-approved script.

Key text changes to look for:
- Stall 1: "some research" not "a lot of research", "quickly confirm"
- Stall 2: SHORT 2-sentence trial, not the long pitch
- Stall 3: COMBINED ICP + icpProblems[0..1] + icpSolutions[0..1]
- Stall 4: "most importantly how you generate revenue"
- Stall 5: conversionNarrative → agentTrainingLine → fallback
- Stall 6: Audit transition bridge, NOT follow-up speed question
- Stall 7: Three variants (ads/no-ads/source-clear)
- Stall 8: topHiringWedge as primary, short "hiring at the moment?"
- Stall 9: ctaAgentMapping as primary, SHORT bridge line

### ANCHOR_ACV change
OLD: "Annual Client Value or ACV" + industry benchmarks
NEW: "What's a new {ct} worth to {biz} on average? A ballpark is totally fine."
NO mention of "ACV". NO benchmarks upfront. Just the simple question.

### custTerm() → IndustryLanguagePack
The bridge doesn't have IndustryLanguagePack yet, so keep using custTerm()
BUT update the text to match Perplexity's framing everywhere. Don't introduce
IndustryLanguagePack into the bridge — that's a DO brain feature.

### Channel stage changes
Add follow-up speed Q3 to ch_website and ch_phone:
- ch_website Q3: "And when a website enquiry comes in, how quickly is
  your team usually getting back to them?"
- ch_phone Q3: "And how quickly are missed calls usually called back?"

Update ROI delivery text to match Perplexity:
- ch_ads ROI: Remove uplift percentages from spoken text
- ch_website ROI: Remove "23%" from spoken text, use "engaging visitors in real time"
- ch_phone ROI: Outcome-focused "answering and qualifying consistently"
- ch_reviews ROI: Remove "1-star/9%" statistic from spoken text

### ROI_DELIVERY change
OLD: Includes annual projection and trial re-pitch
NEW: Clean format: "let me add that up for you... combined total of
approximately {total} dollars per week... conservative numbers.
Does that all make sense?"
NO annual. NO trial pitch. That's CLOSE stage.

### CLOSE change
OLD: Assumptive "Let me get your free trial set up"
NEW: "Would you like to go ahead and activate your free trial? It takes
about ten minutes to set up, there's no credit card required, and you
could start seeing results this week."

### USE CONSULTANT PRE-BUILT LINES
The consultant already generates these. Use them as PRIMARY in the bridge:
- consultant.icpAnalysis.bellaCheckLine → stall 3 fallback
- consultant.conversionEventAnalysis.conversionNarrative → stall 5 primary
- consultant.conversionEventAnalysis.agentTrainingLine → stall 5 secondary
- consultant.conversionEventAnalysis.ctaAgentMapping → stall 9 primary
- consultant.hiringAnalysis.topHiringWedge → stall 8 primary

These are already available in the bridge via the `intel` object.
The bridge reads consultant data from KV — just access the right fields.

---

## EXECUTION

1. Read moves.ts to see the correct Perplexity text for every stall
2. Read bridge buildStageDirective() to see the current old text
3. Update buildStageDirective() stall by stall:
   - Renumber from 12 stalls to 9
   - Update gate from >= 13 to >= 10
   - Update each stall's text to match moves.ts
   - Update advance() if needed for new stall count
4. Update anchor_acv case
5. Update channel stage texts and add follow-up speed Q3s
6. Update roi_delivery and close
7. Bump VERSION string
8. tsc --noEmit (if applicable) or syntax check
9. wrangler deploy --dry-run
10. Deploy
11. Report every change made

## CRITICAL RULES
- DO NOT change the bridge architecture
- DO NOT touch buildTurnPrompt() or the persona block
- DO NOT touch the DO brain code
- DO NOT change service bindings or wrangler config
- ONLY change text inside buildStageDirective() and the gate/advance functions
- USE_DO_BRAIN stays "false" — old path stays active
- One change at a time, verify each compiles
