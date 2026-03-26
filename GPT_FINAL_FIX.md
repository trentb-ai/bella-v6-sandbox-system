# GPT FINAL FIX — STALL ORDERING + PROMPT + CRITICALFACTS
# Source: GPT research, Gemini official prompting docs
# CC: Read this file and execute ALL fixes.

You are CLAUDE CODE with full repo access.

MISSION: Apply 4 exact fixes to the Bella V1.1 DO brain. These come from
GPT's code review of our live test failures. DO NOT improvise. Apply exactly.

--------------------------------------------------
FIX 1 — STALL ORDERING (call-brain-do/src/index.ts)
--------------------------------------------------

In handleTurn(), the packet is built AFTER wowStall increments.
This means stall 1 is permanently skipped.

Find this pattern in handleTurn():
  advanceIfGateOpen → wowStall++ → buildNextTurnPacket

Replace so it becomes:
  advanceIfGateOpen → buildNextTurnPacket → THEN wowStall++

Exact code for the relevant section:

```typescript
// 2. Gate check + advance
const advanced = advanceIfGateOpen(brain);
if (advanced) {
  console.log(`[ADVANCE] → ${brain.stage}`);
}

// 3. Build packet for CURRENT state/stall FIRST
const packet = buildNextTurnPacket(brain);

// 4. Only AFTER packet is built, increment stall for NEXT turn
if (!advanced && brain.stage === 'wow' && typeof brain.wowStall === 'number') {
  brain.wowStall = Math.min(brain.wowStall + 1, 10);
}
```

Keep the escape hatch and retry tracking AFTER this block.

--------------------------------------------------
FIX 2 — REPLACE buildTinyVoicePrompt (deepgram-bridge-v11/src/index.ts)
--------------------------------------------------

Delete buildTinyVoicePrompt(). Replace with buildVoicePrompt():

```typescript
function buildVoicePrompt(
  packet: DONextTurnPacket,
  opts: {
    businessName?: string;
    prospectFirstName?: string;
    extractedState?: Record<string, unknown>;
    callMemory?: string;
  } = {},
): string {
  const businessName = (opts.businessName || 'Unknown Business').trim();
  const prospectFirstName = (opts.prospectFirstName || 'there').trim();

  const confirmedInputs = Object.entries(opts.extractedState || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== '')
    .slice(0, 8)
    .map(([k, v]) => `- ${k}: ${String(v)}`);

  const knownSection = confirmedInputs.length > 0
    ? `CONFIRMED THIS CALL (DO NOT re-ask ANY of these)\n${confirmedInputs.join('\n')}`
    : 'CONFIRMED THIS CALL (DO NOT re-ask ANY of these)\n- none yet';

  let roiSection = '';
  if (packet.roi && Object.keys(packet.roi.agentValues || {}).length > 0) {
    const lines = Object.entries(packet.roi.agentValues)
      .map(([agent, value]) => `- ${agent}: ${String(value)} dollars per week`);
    const total = packet.roi.totalValue != null ? `\n- Total: ${String(packet.roi.totalValue)} dollars per week` : '';
    roiSection = `\nLIVE ROI CALCULATIONS (say as words, never symbols)\n${lines.join('\n')}${total}`;
  }

  const memSection = opts.callMemory
    ? `\nCALL MEMORY\n${opts.callMemory}`
    : '';

  const contextFacts = packet.criticalFacts?.length > 0
    ? packet.criticalFacts.slice(0, 5).map(f => `- ${f}`).join('\n')
    : '- none';

  return `====================================
MANDATORY SCRIPT — FOLLOW EXACTLY
====================================
<DELIVER_THIS>
${packet.chosenMove.text}
</DELIVER_THIS>
====================================

BUSINESS: ${businessName}
PROSPECT: ${prospectFirstName}
STAGE: ${String(packet.stage || '').toUpperCase()}
OBJECTIVE: ${packet.objective}
TONE: ${packet.style.tone}
INDUSTRY TERMS: ${packet.style.industryTerms.join(', ') || 'none'}

${knownSection}
${roiSection}
${memSection}

CONTEXT ONLY — DO NOT READ ALOUD
${contextFacts}

OUTPUT RULES
1. ONLY SPOKEN WORDS. No labels, no headers, no XML tags in output.
2. Up to 3 statements and a question per turn (4 sentences max, fewer is fine).
3. No symbols, no markdown.
4. Say numbers as words.
5. Max one question at the end.
6. NEVER APOLOGISE. Only acknowledge a correction if the user actually corrected something. Do not use filler acknowledgements.
7. SCRIPT COMPLIANCE: Text inside <DELIVER_THIS> tags is your EXACT script. Deliver it word-for-word. You may add a brief natural reaction BEFORE the scripted line, but the scripted line MUST be verbatim.

IMPORTANT
- The CONTEXT ONLY section is for reasoning support and MUST NOT be read aloud.
- Do NOT read bullet points, JSON-like strings, labels, or field names aloud.
- Do NOT re-ask anything already listed in CONFIRMED THIS CALL.
- Use the business name and prospect name naturally when appropriate.`;
}
```

Then update the call site in the DO path block. Find where buildTinyVoicePrompt
is called and replace with:

```typescript
// Get business name and prospect name from intel
const ci = intel.core_identity ?? {};
const bizName = intel.business_name ?? ci.business_name ?? 'your business';
const fn = intel.first_name ?? ci.first_name ?? intel.firstName ?? '';

const voicePrompt = buildVoicePrompt(doResult.packet, {
  businessName: bizName,
  prospectFirstName: fn,
  extractedState: doResult.extractedState,
  callMemory: convMemory,
});
log('DO_PROMPT', `stage=${doResult.stage} stall=${doResult.wowStall} move=${doResult.packet.chosenMove.id} chars=${voicePrompt.length}`);

const systemContent = `lead_id: ${lid}\n\n${voicePrompt}`;
```

Remove any reference to buildFullSystemContext() or the "--- REFERENCE DATA ---"
blob in the DO path. The new prompt is self-contained.

--------------------------------------------------
FIX 3 — CLEAN criticalFacts (call-brain-do/src/moves.ts)
--------------------------------------------------

Add these helpers at the top of moves.ts:

```typescript
function cleanFact(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^["'`]+|["'`]+$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.includes('{') || s.includes('}') || s.includes('":') || s.includes('[]') || s.length < 6) return null;
  return s;
}

function cleanFacts(inputs: unknown[]): string[] {
  return inputs.map(cleanFact).filter((x): x is string => Boolean(x)).slice(0, 5);
}
```

Then in buildCriticalFacts() and anywhere icpProblems/icpSolutions are
pushed into criticalFacts, wrap them through cleanFacts():

BEFORE:
  facts.push(...icpProblems.slice(0, 2));
  facts.push(...icpSolutions.slice(0, 2));

AFTER:
  facts.push(...cleanFacts(icpProblems.slice(0, 2)));
  facts.push(...cleanFacts(icpSolutions.slice(0, 2)));

--------------------------------------------------
FIX 4 — REMOVE "Good catch" CANNED RULE
--------------------------------------------------

Search ALL files in call-brain-do/ and deepgram-bridge-v11/ for any
mention of "Good catch" or "Thanks for clarifying" in prompt strings.
Remove them. The new OUTPUT RULE 6 handles this correctly:
"Only acknowledge a correction if the user actually corrected something.
Do not use filler acknowledgements."

--------------------------------------------------
EXECUTION ORDER
--------------------------------------------------

1. Fix stall ordering in call-brain-do/src/index.ts
2. Add cleanFact/cleanFacts to call-brain-do/src/moves.ts
3. Replace buildTinyVoicePrompt with buildVoicePrompt in deepgram-bridge-v11/src/index.ts
4. Update call site for buildVoicePrompt in bridge DO path
5. Remove "Good catch" from all prompt strings
6. tsc --noEmit in call-brain-do/
7. Deploy call-brain-do: cd call-brain-do && npx wrangler deploy
8. Deploy bridge v11: cd deepgram-bridge-v11 && npx wrangler deploy
9. Report all changes

DO NOT TOUCH:
- deepgram-bridge-v9/ (V1.0 frozen)
- voice-agent-v9/ or voice-agent-v11/
- netlify-funnel-sandbox-v9/ or netlify-funnel-v11/
- fast-intel-sandbox-v9/ (already patched)
