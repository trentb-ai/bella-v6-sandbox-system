# GPT — URGENT: Fix the remaining V1.1 DO Brain failures
# You CANNOT access our repo. Here is the ACTUAL CODE. Give exact fixes.

## FAILURES FROM LIVE TEST (Walker Lane, 20 mins ago)

1. STALL 1 SKIPPED: First turn always delivers stall 2. Stall 1 never seen.
2. GEMINI READS JSON VERBATIM: "The typical challenges your clients face are 'No idea which direction to take'..." — raw consultant strings spoken aloud
3. FILLER HALLUCINATION: "Thanks for clarifying that" on turns where nothing was corrected
4. TOO MANY SENTENCES: 5+ sentences, 2 questions per turn
5. NO NAMES: "your business" instead of "Walker Lane", no prospect name "Trent"

## BUG 1: STALL ORDERING — here is the ACTUAL handleTurn code

```typescript
// call-brain-do/src/index.ts handleTurn() — CURRENT CODE
private async handleTurn(request: Request): Promise<Response> {
  // ... dedup logic, extraction ...

  // 2. Gate check + advance
  let advanced = advanceIfGateOpen(brain);

  // 3. WOW stall increment — THIS RUNS BEFORE buildNextTurnPacket!
  if (!advanced && brain.stage === 'wow') {
    brain.wowStall = Math.min(brain.wowStall + 1, 10);  // stall 1→2
  }

  // 4. Build packet — BUT stall is already 2, not 1!
  const packet = buildNextTurnPacket(brain);  // builds stall 2 packet

  // ... persist, return ...
}
```

stall starts at 1 → gate doesn't open → increment to 2 → build packet for stall 2.
Stall 1 greeting is NEVER delivered. Give me the exact reordered code.

## BUG 2+3+4+5: PROMPT — here is the ACTUAL buildTinyVoicePrompt

```typescript
// deepgram-bridge-v11/src/index.ts — CURRENT CODE
function buildTinyVoicePrompt(packet: DONextTurnPacket): string {
  return [
    "You are Bella.",
    "Speak naturally and briefly.",
    `Max ${packet.style.maxSentences} sentences.`,
    "Do not apologize.",
    "Only acknowledge a correction if the user actually corrected something.",
    "Do not use filler acknowledgements.",
    "Deliver the CHOSEN MOVE exactly once.",
    "",
    `OBJECTIVE: ${packet.objective}`,
    `CHOSEN MOVE: ${packet.chosenMove.text}`,
    "",
    "CRITICAL FACTS:",
    ...packet.criticalFacts.slice(0, 5).map(f => `- ${f}`),
    "",
    `STYLE: tone=${packet.style.tone}; terms=${packet.style.industryTerms.join(', ')}`,
  ].join("\n");
}
```

This produces ~540 chars. Gemini ignores the script, reads criticalFacts
verbatim, adds filler, uses 5+ sentences, doesn't know the business name.

## THE OLD BRIDGE PROMPT THAT WORKS (~3.5K directive section)

The old V1.0 bridge path (still live, works well) builds a prompt with:
- MANDATORY SCRIPT header with the scripted line
- BUSINESS: {name} | STAGE: {stage}
- CONFIRMED THIS CALL section (captured values, "DO NOT re-ask")
- LIVE ROI CALCULATIONS
- CALL MEMORY
- 7 OUTPUT RULES:
  1. ONLY SPOKEN WORDS. No labels, headers, XML tags.
  2. Up to 3 statements and a question (4 sentences max, fewer is fine).
  3. No symbols, no markdown.
  4. Say numbers as words.
  5. Max one question at the end.
  6. NEVER APOLOGISE.
  7. SCRIPT COMPLIANCE: deliver the scripted line word-for-word.

Gemini follows THIS prompt reliably. The 540-char prompt it does NOT.

## WHAT I NEED — EXACT TYPESCRIPT FIXES

### FIX 1: Stall ordering in handleTurn()
Give me the exact reordered code for the handleTurn() function showing
where buildNextTurnPacket() should go relative to the stall increment.

### FIX 2: Revised buildTinyVoicePrompt() (or whatever you want to call it)
