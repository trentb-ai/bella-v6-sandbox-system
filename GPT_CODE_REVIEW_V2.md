# GPT CODE REVIEW — Bella V1.1 DO Brain (Live Failures)
# Repo: https://github.com/trentb-ai/bella-v6-sandbox-system
# Branch: main (latest push)
# Date: 20 March 2026

## WHAT TO REVIEW

The DO brain (call-brain-do/) is failing in live testing. The V1.0 old
bridge path works fine. We need you to review the ACTUAL DEPLOYED CODE
in the repo, not summaries, and provide exact fixes.

## KEY FILES IN THE REPO

### The DO brain (the broken part):
- call-brain-do/src/index.ts — DO class, /turn handler, /event handler, ensureSession
- call-brain-do/src/moves.ts — Script engine (9 WOW stalls, channels, ROI, close)
- call-brain-do/src/extract.ts — Regex extraction from transcripts
- call-brain-do/src/types.ts — All TypeScript contracts
- call-brain-do/src/gate.ts — Stage gating, advancement, queue building
- call-brain-do/src/state.ts — DO storage operations
- call-brain-do/src/roi.ts — ROI calculation engine
- call-brain-do/src/intel.ts — Intel merging, IndustryLanguagePack

### The bridge V1.1 (calls the DO):
- deepgram-bridge-v11/src/index.ts — Bridge worker, DO path, buildTinyVoicePrompt

### Fast-intel (sends events to DO):
- fast-intel-sandbox-v9/src/index.ts — deliverDOEvents function

## LATEST TEST FAILURE (Walker Lane, walkerlane.com.au)

### What's fixed:
- Intel events now accepted (ensureSession creates session if needed) ✅
- Session NOT reset on subsequent turns ✅
- Prompt under 1,500 chars ✅
- Gemini TTFB fast (1.1-2.2s) ✅

### What's STILL broken:

FAILURE 1: Stall 1 greeting NEVER delivered

The DO increments wowStall BEFORE building the packet in handleTurn():
```
stall starts at 1
→ no extraction, gate doesn't open
→ brain.wowStall = Math.min(brain.wowStall + 1, 10)  // now 2
→ buildNextTurnPacket(brain)  // builds for stall 2, not 1
```
Result: First turn always delivers stall 2 (free trial). Stall 1 (greeting)
is permanently skipped. The prospect never hears "we've done research on
your business."

FAILURE 2: Gemini reads consultant data verbatim as speech
Turn 2: "The typical challenges your clients face are 'No idea which
direction to take' in financial planning and 'Complexities of money
management,' and you solve those through 'Clear plan to achieve financial
independence in retirement'..."

These are raw consultant JSON strings from criticalFacts or chosenMove.text
in moves.ts. Gemini treats them as script to read aloud instead of
paraphrasing. The consultant icpProblems[] and icpSolutions[] contain
quoted website copy, not conversational language.

FAILURE 3: "Thanks for clarifying that" filler hallucination
Gemini says "Thanks for clarifying that" on turns where nothing was
corrected. The tiny prompt says "Do not use filler acknowledgements"
but Gemini ignores it. The prompt lacks the forceful OUTPUT RULES that
the OLD working bridge path has.

FAILURE 4: Too many sentences + multiple questions per turn
Turn 2 has 5+ sentences and 2 questions. The maxSentences constraint
in buildTinyVoicePrompt isn't strong enough. The old bridge path has
explicit rules: "Up to 3 statements and a question per turn (4 sentences
max)" and "Max one question at the end."

FAILURE 5: No business name or prospect name in prompt
buildTinyVoicePrompt() never includes the business name or prospect
first name. Gemini says "your business" generically because it has
no name to use. The old bridge path includes these in every prompt.

## TIMELINE (Walker Lane test)

+0s:   fast-intel receives request
+7s:   Consultant done ("Walker Lane")
+43s:  Bridge turn 1 → DO returns stall=2 (stall 1 skipped!)
+44s:  DO session created, queue=[]
+45s:  fast_intel_ready accepted (status=200)
+46s:  consultant_ready accepted (status=200)
+44s:  BELLA_SAID: free trial pitch (no name, no greeting)
+58s:  BELLA_SAID: reads consultant JSON verbatim, 5+ sentences
+78s:  BELLA_SAID: "Thanks for clarifying that" filler

## WHAT I NEED FROM YOU

Review the ACTUAL CODE in the repo. For each failure:

1. Find the exact line(s) causing the bug
2. Provide the exact fix (TypeScript, not pseudocode)
3. Explain WHY the fix works, citing CF DO docs or Gemini docs where relevant

### Specific questions:

Q1: STALL ORDERING — In call-brain-do/src/index.ts handleTurn(), should
the packet be built BEFORE or AFTER the stall increment? What's the
correct pattern for a turn-based state machine in a DO?

Q2: PROMPT SIZE vs COMPLIANCE — The old bridge path uses a ~6.5K prompt
and Gemini follows the script well. The new tiny prompt (~540 chars) and
Gemini goes off-script. Is there a MIDDLE GROUND? What's the minimum
prompt structure needed for Gemini 2.5 Flash to reliably follow scripted
lines? Research Gemini prompt compliance patterns.

Q3: CRITICAL FACTS AS SPEECH — moves.ts buildNextTurnPacket() puts
consultant data (icpProblems, icpSolutions) into criticalFacts[]. The
bridge puts criticalFacts into the prompt. Gemini reads them verbatim.
Should criticalFacts be removed from the prompt entirely? Labeled as
"background only"? Or should moves.ts clean/paraphrase them before
putting them in criticalFacts?

Q4: BUSINESS NAME + PROSPECT NAME — buildTinyVoicePrompt() doesn't
include these. The NextTurnPacket's chosenMove.text already includes
interpolated names from moves.ts. But criticalFacts also needs them
so Gemini can use them naturally. What's the right approach?

Q5: OUTPUT RULES — The old bridge has 7 explicit output rules (max
sentences, no symbols, numbers as words, max one question, no apology,
script compliance). buildTinyVoicePrompt() only has 4 vague rules.
Should we bring back the full OUTPUT RULES or find a middle ground?

## THE WORKING OLD BRIDGE PROMPT (for comparison)

The old path (V1.0, still live, works well) builds a ~6.5K prompt with:
1. MANDATORY SCRIPT header + <DELIVER_THIS> tags
2. BUSINESS: {name} | STAGE: {stage}
3. CONFIRMED THIS CALL section (all captured values)
4. LIVE ROI CALCULATIONS
5. CALL MEMORY
6. 7 OUTPUT RULES (explicit, forceful)
7. --- REFERENCE DATA --- section with full persona + intel

The new path (V1.1, broken) builds ~540 chars with:
1. "You are Bella." + 4 vague rules
2. OBJECTIVE + CHOSEN MOVE
3. CRITICAL FACTS (3-5 bullet points)
4. STYLE line

The old path works. The new path doesn't. The question is: what's the
MINIMUM viable prompt that makes Gemini comply? Because the old path's
6.5K prompt also had problems (Gemini sometimes ignored DELIVER_THIS
when the reference data section drowned out the directive).

## PROVIDE EXACT CODE FIXES

For each fix, give me the exact TypeScript code that goes into the exact
file path. Not pseudocode. Not descriptions. Actual deployable code.

I will give these fixes to Claude Code for execution.
