# COMPREHENSIVE CODE REVIEW REQUEST — Bella V1.1 DO Brain
# For GPT/Perplexity deep research and battle-tested fix recommendations

## CONTEXT

We're building Bella, a voice AI sales agent on Cloudflare Workers + Durable
Objects + Deepgram Voice Agent API + Gemini 2.5 Flash BYO LLM.

We extracted the state machine from a 2,680-line bridge worker into a Cloudflare
Durable Object ("call-brain-do"). The DO owns stage/stall/extraction/gating/ROI.
The bridge builds prompts and streams Gemini. When we flipped it live, it failed
catastrophically. We need you to:

1. Research official Cloudflare DO docs for correct patterns
2. Identify what went wrong in our design AND our code
3. Provide battle-tested, official-source-backed fixes
4. Tell us if the architecture itself is flawed or just the implementation

## CRITICAL FAILURES (from live testing)

### FAILURE 1: Session re-initialization wipes state
- At +40s into the call, a SECOND session_init fires, resetting DO state to stall=0
- Root cause: TWO callers send session_init — the bridge (on first /turn) AND fast-intel (at end of its pipeline)
- The DO's handleSessionInit() calls initState() which ALWAYS creates fresh state, wiping everything
- There is NO idempotency check — no "if state exists, skip init"

### FAILURE 2: Duplicate /turn calls consume stalls 2-3x faster
- The voice agent sends the same transcript multiple times (Deepgram re-sends interim transcripts)
- Each /turn POST increments wowStall, so stalls get consumed 2-3x too fast
- turnId=3 fires 3 times, turnId=7 fires twice
- There is NO dedup check — no "if turnId already processed, return cached packet"

### FAILURE 3: Gemini ignores DELIVER_THIS script
- Despite 6,470 char prompts (up from 620), Gemini still goes off-script
- Turn 1: Supposed to deliver wow_s2_trial. Gemini talked about website value prop instead
- Turn 3: Gemini said "Good catch. good catch" then partially delivered the scripted line
- Hypothesis: The ~5K reference data section drowns out the ~1.3K directive section
- The DELIVER_THIS tags and OUTPUT RULE 7 aren't being respected

### FAILURE 4: Stall counter reset from re-init
- The second session_init (from fast-intel at +40s) resets stall from current back to 0
- Turn 2 shows stall=1 when it should have been stall=3+
- Combined with duplicate /turn calls, stall tracking is completely broken

---

## ARCHITECTURE

```
Browser → Netlify static → Voice Agent DO (WebSocket ↔ Deepgram)
  → Deepgram transcribes speech (Flux STT)
  → Deepgram calls Bridge worker /v9/chat/completions (BYO LLM)
  → Bridge reads KV intel, POSTs transcript to call-brain-do /turn
  → DO: extracts values → validates → advances stage → returns NextTurnPacket
  → Bridge: builds rich prompt from packet + intel + persona (~6.5K chars)
  → Bridge: streams Gemini 2.5 Flash response
  → Gemini response → Deepgram TTS (Aura-2) → browser audio

Enrichment pipeline (runs async, delivers events to DO):
  fast-intel worker: scrapes website → runs consultant → writes KV
    → sends session_init + fast_intel_ready + consultant_ready to DO
  deep-scrape workflow: fires Apify actors → writes KV
    → sends deep_ready to DO
```

### Service bindings (all internal, no public URL calls):
- Bridge → call-brain-do (CALL_BRAIN service binding)
- fast-intel → call-brain-do (CALL_BRAIN service binding)
- deep-scrape → call-brain-do (CALL_BRAIN service binding)

### DO addressing:
- Worker entrypoint resolves callId → env.CALL_BRAIN.idFromName(callId) → stub.fetch()
- Each call gets its own DO instance keyed by leadId

---

## CODE: call-brain-do/src/index.ts (handleSessionInit — THE BUG)

```typescript
private async handleSessionInit(
  event: Extract<BrainEvent, { type: 'session_init' }>,
): Promise<Response> {
  const callId = this.state.id.toString();
  // BUG: Always creates fresh state. No idempotency check.
  // If state already exists (bridge initialized it), this WIPES it.
  const brain = initState(callId, event.leadId);

  if (event.starterIntel) {
    brain.intel.fast = event.starterIntel;
    brain.intel.mergedVersion = 1;
    initQueueFromIntel(brain);
  }

  await persistState(this.state.storage, brain);
  console.log(`[INIT] callId=${callId} leadId=${event.leadId} queue=[${brain.currentQueue.join(',')}]`);

  const packet = buildNextTurnPacket(brain);
  return json({ status: 'initialized', callId, leadId: event.leadId, packet, stage: brain.stage, wowStall: brain.wowStall });
}
```

## CODE: call-brain-do/src/index.ts (handleTurn — NO DEDUP)

```typescript
private async handleTurn(request: Request): Promise<Response> {
  const body = await request.json<{ transcript: string; turnId: string; ts?: string }>();
  const brain = await loadState(this.state.storage);
  if (!brain) {
    return json({ error: 'no_session', message: 'Call session_init first' }, 400);
  }

  const { transcript, turnId } = body;
  // BUG: No check for "have I already processed this turnId?"
  // Deepgram/voice-agent sends same transcript multiple times
  // Each call increments wowStall, consuming stalls 2-3x too fast

  const targets = extractTargetsForCurrentStage(brain);
  const result = extractFromTranscript(transcript, targets, brain.stage, ...);
  const applied = applyExtraction(brain, result);

  let advanced = advanceIfGateOpen(brain);

  // BUG: This increments every time, even for duplicate turnIds
  if (!advanced && brain.stage === 'wow') {
    brain.wowStall = Math.min(brain.wowStall + 1, 10);
  }

  const packet = buildNextTurnPacket(brain);
  await persistState(this.state.storage, brain);
  return json({ packet, extraction: { applied, confidence: result.confidence, normalized: result.normalized }, extractedState: brain.extracted, advanced, stage: brain.stage, wowStall: brain.wowStall });
}
```

## CODE: fast-intel deliverDOEvents (SENDS DUPLICATE session_init)

```typescript
async function deliverDOEvents(lid, envelope, consultant, env) {
  const doFetch = (path, body) =>
    env.CALL_BRAIN.fetch(
      new Request(`https://do-internal${path}?callId=${encodeURIComponent(lid)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-call-id': lid },
        body: JSON.stringify(body),
      }),
    );

  // BUG: This fires session_init even though the bridge already initialized the DO
  // fast-intel runs ~10-40s into the call. By then, bridge has already sent session_init
  // and processed several /turn calls. This WIPES all that state.
  const initRes = await doFetch('/event', {
    type: 'session_init',
    leadId: lid,
    starterIntel: envelope,
  });
  log('DO_INIT', `lid=${lid} session initialized`);

  const fastRes = await doFetch('/event', {
    type: 'fast_intel_ready', payload: envelope, version: 1,
  });

  if (consultant) {
    const consultRes = await doFetch('/event', {
      type: 'consultant_ready', payload: consultant, version: 1,
    });
  }
}
```

## CODE: Bridge V1.1 DO path (init + turn + prompt assembly)

```typescript
const useDoPath = env.USE_DO_BRAIN === 'true' && !!lid;
if (useDoPath) {
  const utt = lastUser(messages);
  const turnNum = messages.length;

  // Try /turn first, init on no_session error, retry
  let doResult = await callDOTurn(lid, utt, String(turnNum), env);
  if (!doResult) {
    // BUG: This sends ANOTHER session_init. Combined with fast-intel's session_init,
    // the DO gets initialized 2+ times. Each init wipes state.
    await callDOSessionInit(lid, intel, env);
    doResult = await callDOTurn(lid, utt, String(turnNum), env);
  }
  if (!doResult) {
    // Fallback to old path
  } else {
    const bridgeSystem = buildFullSystemContext(intel, apifyDone); // ~5K chars persona+intel
    const doTurnPrompt = buildDOTurnPrompt(packet, intel, convMemory, ...); // ~1.3K chars directive

    // Assemble: directive FIRST, reference data LAST
    const systemContent = `lead_id: ${lid}\n\n${doTurnPrompt}\n\n--- REFERENCE DATA ---\n${bridgeSystem}`;
    // Total: ~6.5K chars

    const finalMessages = [{ role: "system", content: systemContent }, ...conversation];
    return streamToDeepgram(finalMessages, env, async (spokenText) => {
      await callDOLlmReplyDone(lid, doMoveId, spokenText, env);
    });
  }
}
```

## CODE: buildDOTurnPrompt (the directive section, ~1.3K chars)

```typescript
function buildDOTurnPrompt(packet, intel, convMemory, appliedFields, extractedState) {
  const stageDirective = `<DELIVER_THIS>\n${packet.chosenMove.text}\n</DELIVER_THIS>`;

  // Confirmed inputs, ROI calcs, call memory, output rules...

  return `====================================
MANDATORY SCRIPT — FOLLOW EXACTLY
====================================
${stageDirective}
====================================

BUSINESS: ${biz} | STAGE: ${packet.stage.toUpperCase()}
${knownSection}${roiSection}${memSection}

OUTPUT RULES
1. ONLY SPOKEN WORDS. No labels, no headers, no XML tags in output.
2. Up to 3 statements and a question per turn (4 sentences max).
3-5. [formatting rules]
6. NEVER APOLOGISE. Say "Good catch" or "Thanks for clarifying" instead.
7. SCRIPT COMPLIANCE: Text inside <DELIVER_THIS> tags is your EXACT script.
   Deliver it word-for-word. You may add a brief natural reaction BEFORE
   the scripted line, but the scripted line MUST be delivered verbatim.`;
}
```

## DO STATE SCHEMA

```typescript
type CallBrainState = {
  callId: string;
  leadId: string;
  createdAt: string;
  updatedAt: string;
  stage: 'wow' | 'anchor_acv' | 'anchor_timeframe' | 'ch_website' | 'ch_ads' | 'ch_phone' | 'ch_old_leads' | 'ch_reviews' | 'roi_delivery' | 'close';
  wowStall: number;  // 1-9
  completedStages: Stage[];
  currentQueue: Stage[];
  extracted: { acv, timeframe, web_leads, web_conversions, ads_leads, ads_conversions, phone_volume, missed_call_handling, old_leads, new_customers, has_review_system, ... };
  flags: { trialMentioned, apifyDone, roiComputed, roiDelivered, justDemo, questionBudgetTight };
  spoken: { moveIds: string[], factsUsed: string[], agentPitchesGiven: string[] };
  intel: { fast, consultant, deep, industryLanguage, mergedVersion: number };
  roi: { agentValues: Record<string, number>, totalValue: number | null };
  retry: { extractionMisses: Record<string, number>, stageLoops: number };
};
```

## DO STORAGE PATTERN

```typescript
const STATE_KEY = 'call_brain_state';

async function loadState(storage: DurableObjectStorage): Promise<CallBrainState | null> {
  const raw = await storage.get<CallBrainState>(STATE_KEY);
  return raw ?? null;
}

async function persistState(storage: DurableObjectStorage, state: CallBrainState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await storage.put(STATE_KEY, state);
}
```

---

## QUESTIONS FOR YOU — RESEARCH THOROUGHLY, CITE OFFICIAL SOURCES

### Q1: Idempotent session_init — what's the correct Cloudflare DO pattern?
Our handleSessionInit() always calls initState(), wiping existing state.
Multiple callers (bridge + fast-intel) both send session_init.
What is the battle-tested pattern for idempotent DO initialization?
Should we check storage first? Use a mutex? Use DO alarm? What do the
official CF docs recommend for "initialize if not exists, merge if exists"?

### Q2: Duplicate request dedup in Durable Objects
Our /turn endpoint gets called 2-3x with the same turnId because Deepgram
re-sends interim transcripts via the voice agent. Each call increments
state. What's the correct CF DO pattern for request deduplication?
Should we store the last processed turnId in DO state? Use a Set?
What's the performance impact? Official CF guidance on this?

### Q3: Multiple writers to the same DO — race conditions?
Bridge and fast-intel both write to the same DO (one via /turn, one via
/event). CF docs say DO is single-threaded (one request at a time).
But our logs show concurrent requests — is this because of CF's input
gate? Do we need explicit locking? What does the official CF DO
concurrency model actually guarantee?

### Q4: Gemini ignoring DELIVER_THIS despite being in the prompt
Our prompt structure is:
  [1.3K directive with DELIVER_THIS tags] + [5K reference data]
Gemini ignores the scripted lines and improvises. Possible causes:
- Reference data drowning out the directive?
- Should directive be LAST in the prompt, not first?
- Is Gemini 2.5 Flash known to ignore long system prompts?
- Would moving the script to a user message instead of system help?
- Should we use Gemini's structured output / function calling instead?
Research Gemini 2.5 Flash prompt compliance patterns.

### Q5: Was the original design plan flawed?
The plan was: DO owns state → bridge sends transcript → DO returns
NextTurnPacket → bridge builds prompt → streams Gemini.
But the bridge also needs to init the DO session, and fast-intel also
inits it. Should session_init come from ONLY ONE source? Should the DO
self-initialize on first /turn instead of requiring explicit init?
Was event-driven intel delivery the wrong pattern?

### Q6: Should extraction happen in the DO or the bridge?
Currently the DO does regex extraction on the transcript. But the bridge
also has access to the transcript and the full conversation history.
The DO only sees one turn at a time. Should extraction move back to the
bridge, with the DO only receiving validated extracted values?
What's the latency/accuracy tradeoff?

### Q7: Prompt architecture for voice AI — what's battle-tested?
We're using Deepgram Voice Agent API with BYO LLM (Gemini 2.5 Flash).
Deepgram sends the bridge a POST with conversation history in OpenAI
chat format. Bridge replaces the system message each turn.
- Is replacing the entire system message each turn correct?
- Should we use Deepgram's UpdatePrompt (append-only) instead?
- UpdatePrompt has a 25K char cap. Our ~6.5K/turn would fill it in 4 turns.
- What's the correct pattern for BYO LLM with Deepgram Voice Agent?
- Official Deepgram docs: https://developers.deepgram.com/docs/voice-agent

### Q8: The "Good catch" hallucination
OUTPUT RULE 6 says: "NEVER APOLOGISE. Say 'Good catch' or 'Thanks for
clarifying' instead." But Gemini is saying "Good catch" even when nothing
was corrected — it's using it as generic filler. Should we remove "Good
catch" from the prompt entirely? What's the correct way to handle the
no-apology rule without creating a new hallucination pattern?

---

## TECH STACK

| Layer | Tech |
|-------|------|
| Workers | Cloudflare Workers (service bindings, no public URLs) |
| State | Cloudflare Durable Objects (raw DO, not Agents SDK) |
| KV | Cloudflare Workers KV (eventually consistent, snapshots only) |
| Voice | Deepgram Voice Agent API (BYO LLM, Flux STT, Aura-2 TTS) |
| LLM | Google Gemini 2.5 Flash (via bridge worker, streaming) |
| Scraping | Firecrawl + Apify + ScrapingAnt |

## OFFICIAL DOCS TO REFERENCE

- CF Durable Objects: https://developers.cloudflare.com/durable-objects/
- CF DO API: https://developers.cloudflare.com/durable-objects/api/
- CF DO storage: https://developers.cloudflare.com/durable-objects/api/storage-api/
- CF DO WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- CF DO concurrency: https://developers.cloudflare.com/durable-objects/reference/in-memory-state/
- Deepgram Voice Agent: https://developers.deepgram.com/docs/voice-agent
- Deepgram BYO LLM: https://developers.deepgram.com/docs/voice-agent-llm-models
- Deepgram UpdatePrompt: https://developers.deepgram.com/docs/voice-agent-update-prompt
- Gemini prompting: https://ai.google.dev/gemini-api/docs/prompting-strategies

## WHAT WE WANT BACK

1. Root cause analysis for each of the 4 failures — backed by official docs
2. Battle-tested code patterns for each fix — not theoretical, actual TypeScript
3. Architectural recommendations — is the design fundamentally flawed or just buggy?
4. Prompt engineering recommendations for Gemini compliance with scripted lines
5. Priority order — what fixes first for maximum impact
6. Any patterns we're missing from CF DO best practices that would prevent these classes of bugs
