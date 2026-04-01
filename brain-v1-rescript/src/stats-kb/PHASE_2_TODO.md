# PHASE 2 — Stats KB Wiring Into Live Agent

## STATUS: NOT STARTED — Come back to this next session

## What's Done (Phase 1)
- 5 agent stats KBs complete (1,275 lines total)
- WIRING_RULES.ts complete (443 lines — Three-Beat, Triggers, NLP Matching)
- All files in `/call-brain-do/src/stats-kb/`

## What Phase 2 Builds

### 1. Sentiment & Modality Extraction
**File:** `gemini-extract.ts`
- Add new fields extracted every turn (not stage-specific):
  - `prospectModality`: 'visual' | 'auditory' | 'kinaesthetic' | null
  - `prospectSentiment`: 'frustrated' | 'excited' | 'sceptical' | 'neutral' | null
  - `prospectLanguageRegister`: 'formal' | 'casual' | 'technical' | null
- Gemini detects these from the prospect's speech patterns
- Modality locks after 2-3 consistent signals (don't flip every turn)

### 2. Stat Selection Module (NEW FILE)
**File:** `src/stats-kb/select-stat.ts`
- Function: `selectStat(stageId, triggerCategory, conversationState, prospectSentiment, intel)`
- Reads from the agent's stats KB
- Picks the MOST RELEVANT stat based on:
  - Current stage (which agent is being discussed)
  - Trigger category (pain/competitor/close/etc) detected from prospect's words
  - Industry match (prefer industry-specific stats when intel has industry data)
  - Number availability (prefer stats that can be personalised with prospect's numbers)
  - Sentiment match (frustrated → pain stats, excited → close/ROI stats)
- Returns: `{ stat, source, url, use, deliveryModality }` — ready for prompt injection

### 3. Trigger Detection
**File:** `src/stats-kb/detect-trigger.ts` OR inline in extraction
- Analyse prospect's latest utterance for trigger signals
- Map signal phrases → stat categories (as documented in WIRING_RULES.ts)
- Can be done via:
  - Gemini extraction (add a `statTrigger` field to the per-turn schema)
  - OR keyword matching as a fast pre-filter before Gemini
- Output: `{ triggerType: 'pain'|'ambition'|'competitor'|'scepticism'|null, agentHint: StageId|null }`

### 4. Prompt Injection in moves.ts
**File:** `src/moves.ts` — each `build[Agent]Directive()` function
- When building the stage directive, if a stat trigger fired:
  - Inject the selected stat into the directive's `speak` or `notes` field
  - Include delivery instructions matching the Three-Beat Pattern
  - Include modality hint so Gemini delivers in the prospect's language
- When NO trigger fires: inject nothing — don't force stats
- Template in directive:
  ```
  STAT_CONTEXT: {
    stat: "85% of callers who don't get through never call back",
    source: "Aira (2024 study)",
    deliverAs: "kinaesthetic",
    connectTo: "prospect mentioned missing calls on job sites",
    beatPattern: "Acknowledge → Stat → Translate in their language → Connect to their 20 calls/week"
  }
  ```

### 5. URL Follow-Up Flag
- When Bella cites a source during the call, flag it in state:
  - `state.pendingSourceLinks.push({ url, sourceName, citedAt: turnNumber })`
- Post-call follow-up system sends SMS/email with the source links
- Bella says: "Happy to send you that link after our chat"
- Never reads URLs on a voice call

### 6. NLP Matching in Prompt
- Distill WIRING_RULES NLP section into a concise prompt block
- Include in system prompt (not per-turn — this is persistent behaviour):
  - Sensory modality matching rules
  - Language mirroring instructions
  - Sentiment mirroring boundaries
  - Pacing & leading pattern
- Feed detected modality/sentiment from extraction into each turn's context

## Implementation Order
1. Sentiment/modality extraction fields → `gemini-extract.ts`
2. Trigger detection → `detect-trigger.ts` or extraction field
3. Stat selection → `select-stat.ts`
4. Prompt injection → `moves.ts` directive builders
5. NLP rules → system prompt update
6. URL follow-up flag → state + post-call handler

## Key Principle
**Extraction logic is FRESH — we just built and debugged it this session.**
**Wire this while the architecture is hot. Don't let it go stale.**
