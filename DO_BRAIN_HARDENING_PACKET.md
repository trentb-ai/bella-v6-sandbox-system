# DO BRAIN V1.1 — STAGE 1 HARDENING IMPLEMENTATION PACKET
# Source: GPT deep research + Perplexity architecture review
# Date: 20 March 2026
# Authority: Trent Belasco + Claude.ai + GPT + Perplexity consensus
#
# THIS FILE IS THE SOURCE OF TRUTH FOR CC EXECUTION.
# CC reads this file and executes it. No improvisation.

---

## ARCHITECTURAL TRUTH (non-negotiable invariants)

1. DO is the ONLY live authority for stage/stall/extracted/ROI/spoken-state
2. There must be exactly ONE session creation path (ensureSession, lazy on /turn)
3. All async intel delivery is merge-only and version-guarded
4. /turn must be idempotent (dedup by turnId + transcriptHash)
5. Bridge builds a TINY prompt from NextTurnPacket — NO 5K reference blob
6. KV is NEVER the live source of truth
7. Async workers (fast-intel, deep-scrape) NEVER send session_init

---

## THE 4 FAILURES AND THEIR FIXES

### FIX 1: Kill duplicate session_init — make ensureSession idempotent

PROBLEM: handleSessionInit() always calls initState(), wiping state.
Both bridge AND fast-intel send session_init. Second init at +40s wipes everything.

FIX: Replace handleSessionInit() with ensureSession():
- Load existing state first
- If absent: create fresh state
- If present: DO NOT reset stage/stall/extracted/spoken/roi
- Only hydrate missing starter intel if intel.fast is null

```typescript
private async ensureSession(leadId: string, starterIntel?: any) {
  let brain = await loadState(this.state.storage);
  if (!brain) {
    brain = initState(this.state.id.toString(), leadId);
    if (starterIntel) {
      brain.intel.fast = starterIntel;
      brain.intel.mergedVersion = 1;
      initQueueFromIntel(brain);
    }
    await persistState(this.state.storage, brain);
    return { brain, created: true };
  }
  // State exists — merge intel only if missing
  if (!brain.leadId) brain.leadId = leadId;
  if (starterIntel && !brain.intel.fast) {
    brain.intel.fast = starterIntel;
    brain.intel.mergedVersion = Math.max(brain.intel.mergedVersion, 1);
  }
  await persistState(this.state.storage, brain);
  return { brain, created: false };
}
```

ALSO: Remove session_init from fast-intel deliverDOEvents().
fast-intel sends ONLY fast_intel_ready and consultant_ready. NEVER session_init.

### FIX 2: Dedup /turn calls — cache by turnId + transcriptHash

PROBLEM: Deepgram re-sends same transcript 2-3x. Each /turn increments stall.
turnId=3 fires 3 times, consuming 3 stalls instead of 1.

FIX: Before processing, check if turnId+hash already processed. Return cached packet.

```typescript
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

private async handleTurn(request: Request): Promise<Response> {
  const body = await request.json<TurnRequest>();
  const { leadId, transcript, turnId } = body;
  const { brain } = await this.ensureSession(leadId);

  const cleanTranscript = (transcript || '').trim();
  const hash = await sha256Hex(cleanTranscript);
  const cacheKey = `turn:${turnId}:${hash}`;

  const cached = await this.state.storage.get<any>(cacheKey);
  if (cached) {
    console.log(`[DEDUP] turnId=${turnId} — returning cached packet`);
    return json({ ...cached, dedup: true });
  }

  // ... normal extraction, gate, advance, build packet ...

  const responseBody = { packet, extraction, extractedState, advanced, stage, wowStall };
  await persistState(this.state.storage, brain);
  await this.state.storage.put(cacheKey, responseBody);
  return json({ ...responseBody, dedup: false });
}
```

### FIX 3: Version-guarded merge-only intel events

PROBLEM: fast_intel_ready/consultant_ready/deep_ready can overwrite newer data.
No version checks. Late stale event can clobber fresher intel.

FIX: Add intelVersions tracking. Only apply if version > last applied.

```typescript
function shouldApply(next: number, current?: number): boolean {
  return current == null || next > current;
}

// In handleEvent:
case 'fast_intel_ready':
  if (shouldApply(event.version, brain.intelVersions.fast)) {
    brain.intel.fast = deepMerge(brain.intel.fast ?? {}, event.payload);
    brain.intelVersions.fast = event.version;
  }
  break;
case 'consultant_ready':
  if (shouldApply(event.version, brain.intelVersions.consultant)) {
    brain.intel.consultant = deepMerge(brain.intel.consultant ?? {}, event.payload);
    brain.intelVersions.consultant = event.version;
  }
  break;
case 'deep_ready':
  if (shouldApply(event.version, brain.intelVersions.deep)) {
    brain.intel.deep = deepMerge(brain.intel.deep ?? {}, event.payload);
    brain.intelVersions.deep = event.version;
    brain.flags.apifyDone = true;
    rebuildFutureQueue(brain, flags, allIntel); // future only, preserve current
  }
  break;
```

Add `intelVersions: { fast?: number; consultant?: number; deep?: number }` to CallBrainState.

### FIX 4: Shrink the live prompt drastically

PROBLEM: 6.5K prompt with 1.3K directive + 5K reference blob.
Gemini ignores DELIVER_THIS because reference data drowns out the directive.
"Good catch" hallucination from canned replacement phrase in prompt.

FIX: Replace buildDOTurnPrompt + bridgeSystem combo with buildTinyVoicePrompt.

```typescript
function buildTinyVoicePrompt(packet: NextTurnPacket): string {
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

REMOVE from bridge V1.1 DO path:
- buildFullSystemContext() call (the 5K reference blob)
- "--- REFERENCE DATA ---" section
- The old OUTPUT RULES with "Good catch" / "Thanks for clarifying"
- The <DELIVER_THIS> tags (use CHOSEN MOVE label instead)

ALSO: Remove bridge fallback session re-init dance:
- DELETE the pattern: try /turn → if fail → callDOSessionInit → retry /turn
- /turn self-heals via ensureSession() inside the DO
- If DO truly fails, fall back to old path cleanly

---

## FILES TO MODIFY

| File | Changes |
|------|---------|
| call-brain-do/src/index.ts | Replace handleSessionInit with ensureSession. Add turn dedup. Version-guard events. Add intelVersions to state. |
| call-brain-do/src/types.ts | Add intelVersions to CallBrainState |
| call-brain-do/src/state.ts | Add intelVersions to initState() blank |
| deepgram-bridge-v11/src/index.ts | Replace buildDOTurnPrompt+bridgeSystem with buildTinyVoicePrompt. Remove fallback session re-init. Remove "Good catch" rule. |
| fast-intel-sandbox-v9/src/index.ts | Remove session_init from deliverDOEvents. Send only fast_intel_ready + consultant_ready. |

## FILES NOT TO TOUCH
- deepgram-bridge-v9/ (V1.0 frozen)
- voice-agent-v9/ (V1.0 frozen)
- voice-agent-v11/ (no changes needed)
- netlify-funnel-v11/ (no changes needed)
- netlify-funnel-sandbox-v9/ (V1.0 frozen)
- call-brain-do/src/moves.ts (script is correct, don't touch)
- call-brain-do/src/roi.ts (calcs are correct, don't touch)
- call-brain-do/src/extract.ts (already patched, don't touch)
- call-brain-do/src/gate.ts (logic is correct, don't touch)

---

## EXECUTION ORDER

1. call-brain-do/src/types.ts — add intelVersions
2. call-brain-do/src/state.ts — add intelVersions to initState
3. call-brain-do/src/index.ts — replace handleSessionInit with ensureSession, add turn dedup, version-guard events
4. fast-intel-sandbox-v9/src/index.ts — remove session_init from deliverDOEvents
5. deepgram-bridge-v11/src/index.ts — replace prompt with buildTinyVoicePrompt, remove fallback init, remove "Good catch"
6. tsc --noEmit on call-brain-do
7. tsc --noEmit on deepgram-bridge-v11 (or syntax check)
8. Deploy call-brain-do
9. Deploy fast-intel-v8 (shared, but session_init removed is safe for V1.0 too since V1.0 ignores DO events)
10. Deploy deepgram-bridge-v11
11. Verify: tail all workers, test via bella-v11-do-brain.netlify.app

## TESTS

1. Second ensureSession does NOT wipe stage/stall/extracted
2. Duplicate /turn with same turnId returns cached packet, stall unchanged
3. Late fast_intel_ready does NOT reset stage
4. deep_ready reranks FUTURE only, preserves current stage + extracted
5. ROI must deliver before close activates
6. Bridge prompt stays under 1,500 chars
7. No "Good catch" in prompt text

## ROLLBACK

If anything breaks:
- V1.0 is untouched on demofunnelbellasandboxv8.netlify.app
- V1.1 is isolated on bella-v11-do-brain.netlify.app
- Revert by redeploying previous call-brain-do version
- fast-intel session_init removal is safe (V1.0 bridge ignores DO events anyway)
