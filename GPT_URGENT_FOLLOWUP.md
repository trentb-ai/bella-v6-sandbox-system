# GPT — URGENT FOLLOW-UP: Your CC prompt has critical gaps
# YOUR DESKTOP COMMANDER HAS ACCESS TO THESE FILES. READ THEM.

## FILE LOCATIONS ON THIS MACHINE

### DO Brain (the broken part):
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/index.ts
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/moves.ts
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/extract.ts
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/types.ts
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/gate.ts
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/state.ts
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/roi.ts
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/intel.ts

### Bridge V1.1 (calls the DO):
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v11/src/index.ts

### Fast-intel (sends events to DO):
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/fast-intel-sandbox-v9/src/index.ts

### Old bridge V1.0 (WORKING — use as reference for prompt structure):
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v9/src/index.ts

READ THE ACTUAL CODE IN THESE FILES BEFORE ANSWERING.

---

## CONTEXT

You gave us a CC implementation prompt. CC is executing it NOW. But your
prompt persists with buildTinyVoicePrompt at ~540 chars. We just tested
it live and it FAILED. Gemini ignores the script at that size.

## THE PROOF (Walker Lane live test, 20 minutes ago)

Your tiny prompt produced:
- "Hi! Just so you know, because of the work we've done with similar
  businesses..." — NO business name, NO prospect name, generic garbage
- "The typical challenges your clients face are 'No idea which direction
  to take'..." — Gemini READ THE CONSULTANT JSON VERBATIM as speech
- "Thanks for clarifying that." — filler hallucination, nothing was corrected
- 5+ sentences per turn, 2 questions per turn — ignoring maxSentences

The OLD bridge path (~3.5K directive + OUTPUT RULES) works and Gemini
follows the script. Your 540-char prompt does NOT work.

## WHAT WE NEED FROM YOU RIGHT NOW

### 1. READ THE OLD BRIDGE'S WORKING PROMPT

Read deepgram-bridge-v9/src/index.ts — find buildTurnPrompt() and
buildStageDirective(). These produce the ~3.5K prompt that WORKS.
Understand WHY it works. Then design the new prompt to keep the
parts that make Gemini comply.

### 2. READ THE NEW BRIDGE'S BROKEN PROMPT

Read deepgram-bridge-v11/src/index.ts — find buildTinyVoicePrompt()
or buildDOTurnPrompt(). See how small it is. See what's missing.

### 3. FIX THE PROMPT — EXACT TYPESCRIPT

Write a revised buildVoicePrompt() that includes:
- Business name + prospect first name (from criticalFacts or packet)
- Full OUTPUT RULES (all 7 from the old bridge — they WORK)
- CONFIRMED INPUTS section ("DO NOT re-ask these")
- CRITICAL FACTS labeled "CONTEXT ONLY — do not read aloud"
- CHOSEN MOVE as the primary directive
- Target: ~1,500-2,000 chars

### 4. FIX THE STALL ORDERING BUG

Read call-brain-do/src/index.ts handleTurn(). The stall increments
BEFORE buildNextTurnPacket(). Fix: build packet FIRST, then increment.
Give exact code.

### 5. FIX CRITICAL FACTS BEING READ VERBATIM

Read call-brain-do/src/moves.ts — the buildNextTurnPacket() function
puts icpProblems[] and icpSolutions[] into criticalFacts[]. These are
raw consultant strings that Gemini reads aloud. Either:
a) Clean them in moves.ts before putting in criticalFacts
b) Label them in the prompt so Gemini doesn't read them

### 6. GIVE THE CC PATCH PROMPT

Write the exact text we paste into Claude Code to apply ALL fixes.
One prompt, all fixes, exact file paths, exact TypeScript code.
