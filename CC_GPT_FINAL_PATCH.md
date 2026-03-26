# GPT FINAL FIXES — DROP INTO CC
# CC: Read this and execute ALL fixes. Exact code, exact paths.

URGENT PATCH — BELLA V1.1 DO BRAIN + PROMPT FIX

Apply these exact fixes to the following files:

1. /Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/index.ts
2. /Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v11/src/index.ts
3. /Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/moves.ts

==================================================
FIX 1 — STALL ORDERING (call-brain-do/src/index.ts)
==================================================

In handleTurn(), find the section where advanceIfGateOpen, wowStall++,
and buildNextTurnPacket happen. Replace so packet builds FIRST:

```typescript
const advanced = advanceIfGateOpen(brain);
if (advanced) {
  console.log(`[ADVANCE] → ${brain.stage}`);
}

// Build packet for CURRENT state/stall FIRST
const packet = buildNextTurnPacket(brain);

// Only AFTER packet, increment stall for NEXT turn
if (!advanced && brain.stage === 'wow' && typeof brain.wowStall === 'number') {
  brain.wowStall = Math.min(brain.wowStall + 1, 10);
}
```

Keep escape hatch and retry tracking AFTER this block.

==================================================
FIX 2 — REPLACE buildTinyVoicePrompt (deepgram-bridge-v11/src/index.ts)
==================================================

Delete buildTinyVoicePrompt(). Replace with this exact function:

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

Then update the call site. Find where buildTinyVoicePrompt is called
in the DO path and replace with:

```typescript
const ci = intel.core_identity ?? {};
const bizName = intel.business_name ?? ci.business_name ?? intel.fast_context?.business?.name ?? 'your business';
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

==================================================
FIX 3 — CLEAN criticalFacts (call-brain-do/src/moves.ts)
==================================================

Add these helpers near the top of moves.ts:

```typescript
function cleanCriticalFact(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  s = s.replace(/^["'`]+|["'`]+$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.includes('{') || s.includes('}') || s.includes('":') || s.includes('[]') || s.length < 6) return null;
  return s;
}

function cleanCriticalFacts(inputs: unknown[]): string[] {
  return inputs.map(cleanCriticalFact).filter((x): x is string => Boolean(x)).slice(0, 5);
}
```

Then find everywhere icpProblems/icpSolutions are pushed into criticalFacts
and wrap through cleanCriticalFacts(). Example:

BEFORE: facts.push(...icpProblems.slice(0, 2));
AFTER:  facts.push(...cleanCriticalFacts(icpProblems.slice(0, 2)));

==================================================
FIX 4 — REMOVE "Good catch" FROM ALL PROMPTS
==================================================

Search call-brain-do/ and deepgram-bridge-v11/ for "Good catch" or
"Thanks for clarifying" in any prompt string. Remove them.

==================================================
EXECUTION ORDER
==================================================

1. Fix stall ordering in call-brain-do/src/index.ts handleTurn()
2. Add cleanCriticalFact helpers to call-brain-do/src/moves.ts
3. Apply cleanCriticalFacts where icpProblems/icpSolutions enter criticalFacts
4. Delete buildTinyVoicePrompt from deepgram-bridge-v11/src/index.ts
5. Add buildVoicePrompt function to deepgram-bridge-v11/src/index.ts
6. Update call site to pass businessName, prospectFirstName, extractedState, callMemory
7. Remove "Good catch" from all prompt strings
8. tsc --noEmit in call-brain-do/
9. Deploy: cd call-brain-do && npx wrangler deploy
10. Deploy: cd deepgram-bridge-v11 && npx wrangler deploy
11. Report all changes with diffs

DO NOT TOUCH:
- deepgram-bridge-v9/ (V1.0 frozen)
- voice-agent-v9/ or voice-agent-v11/
- fast-intel-sandbox-v9/ (already patched)
- netlify-funnel-sandbox-v9/ or netlify-funnel-v11/
