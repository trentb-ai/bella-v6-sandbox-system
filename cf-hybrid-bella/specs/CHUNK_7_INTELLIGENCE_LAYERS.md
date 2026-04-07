# CHUNK 7 SPEC — Intelligence Layers
### bella-brain-v3 additions (Layers 2-7, 9-11 of Intelligence Addendum)
### Author: T2 Code Lead | Date: 2026-04-07
### Status: DRAFT v2 — P1-1/P1-2/P1-3/P1-4 fixes applied per T3 SPEC_GATE_VERDICT FAIL

---

## 1. SCOPE

Add 8 intelligence layers to `workers/brain-v3/`. All additions are to the existing DO — no new deployed workers. Layers operate inside the Brain DO per-turn, during `buildTurnPlan()`.

| Layer | Name | New files | Modifies |
|-------|------|-----------|---------|
| 2 | Hybrid Freestyle | — | turn-plan.ts, moves.ts |
| 3 | Intent Detection | intent.ts (NEW) | turn-plan.ts |
| 4 | Engagement Scoring | engagement.ts (NEW) | state.ts, turn-plan.ts |
| 5 | Active Listening | — | moves.ts |
| 6 | Memory Recall | — | brain-do.ts (D1 warm load on call start) |
| 7 | Conversational Repair | repair.ts (NEW) | turn-plan.ts, stage-machine.ts |
| 9 | Stats KB Wiring | DEFERRED TO CHUNK 10 — stats-kb/ directory does not exist | — |
| 10 | Three-Tier KB | kb.ts (NEW) | brain-do.ts, wrangler.toml |
| 11 | Full Data Activation | — | moves.ts, turn-plan.ts |

**Out of scope for Chunk 7:** Stats KB (Layer 9 — deferred, stats-kb/ directory does not exist), Vectorize indexing/population, OTel export, replay harness, Chunk 8 event endpoints, multi-session memory.

---

## 0. PRE-IMPLEMENTATION PREREQUISITE — Contracts patch (P1-3 fix)

T4 must patch `packages/contracts/src/turn-plan.ts` BEFORE implementing any brain-v3 changes. Run `npx vitest run` in packages/contracts after patching — zero errors required.

Add to `TurnPlanV1` Zod schema:
```typescript
allowFreestyle: z.boolean().default(true),
improvisationBand: z.enum(['strict', 'wide', 'narrow']).default('wide'),
intent: z.enum(['interested', 'objecting', 'confused', 'ready_to_buy', 'off_topic', 'neutral']).optional(),
consultantReady: z.boolean().default(false),  // also required by Chunk 8
```

These are required for Layers 2, 3, and 7 (and `consultantReady` for Chunk 8 §6). Without them, brain-v3 TypeScript compile will fail when setting these fields on TurnPlan objects.

---

## 2. LAYER 3 — INTENT DETECTION (intent.ts)

Detect prospect intent from utterance — pure keyword/pattern logic, no extra Gemini call.

```typescript
// workers/brain-v3/src/intent.ts

export type IntentType =
  | 'interested'       // positive signals: "that sounds good", "tell me more"
  | 'objecting'        // price, timing, competitor objections
  | 'confused'         // "what do you mean", "I don't understand"
  | 'ready_to_buy'     // "how do we get started", "what's the next step"
  | 'off_topic'        // unrelated tangent
  | 'neutral';         // default

const INTENT_PATTERNS: Record<IntentType, RegExp[]> = {
  interested: [
    /\b(sounds? good|tell me more|interesting|love that|that'?s? great|makes sense)\b/i,
    /\b(how does? (that|it) work|walk me through)\b/i,
  ],
  objecting: [
    /\b(too expensive|can'?t? afford|already have|not (the )?right time|busy|think about it)\b/i,
    /\b(competitor|already (using|working with)|contract)\b/i,
    /\b(not sure|not convinced|doubt|skeptic)\b/i,
  ],
  confused: [
    /\b(what do you mean|don'?t? (understand|follow)|can you (explain|clarify)|confused)\b/i,
    /\b(sorry\??|huh\??|pardon)\b/i,
  ],
  ready_to_buy: [
    /\b(how (do|can) (we|i) (get started|sign up|proceed)|next steps?|let'?s? do (it|this))\b/i,
    /\b(send (me|us) (the|more) (info|details|proposal)|set (up|that) up)\b/i,
  ],
  off_topic: [
    /\b(by the way|unrelated|different (topic|question)|quick question about)\b/i,
  ],
  neutral: [],
};

export function detectIntent(utterance: string): IntentType {
  for (const [intent, patterns] of Object.entries(INTENT_PATTERNS) as [IntentType, RegExp[]][]) {
    if (intent === 'neutral') continue;
    if (patterns.some(p => p.test(utterance))) return intent;
  }
  return 'neutral';
}
```

Usage in `turn-plan.ts`: call `detectIntent(prospectUtterance)` and set `turnPlan.intent` on the outgoing TurnPlan. Prompt Worker uses this for tone adaptation (not mandatory script — guidance only).

---

## 3. LAYER 4 — ENGAGEMENT SCORING (engagement.ts)

Track prospect engagement per turn. Score stored in `ConversationState`.

```typescript
// workers/brain-v3/src/engagement.ts

export type EngagementLevel = 'low' | 'medium' | 'high';

export interface EngagementSignals {
  wordCount: number;
  hasQuestion: boolean;
  hasAffirmation: boolean;
  hasMention: boolean;     // prospect mentions their business/situation
}

const AFFIRMATION_RE = /\b(yes|yeah|yep|right|exactly|absolutely|definitely|sure|correct|true)\b/i;
const QUESTION_RE = /\?/;
const MENTION_RE = /\b(we|our|my|i|us)\b/i;

export function extractEngagementSignals(utterance: string): EngagementSignals {
  return {
    wordCount: utterance.trim().split(/\s+/).length,
    hasQuestion: QUESTION_RE.test(utterance),
    hasAffirmation: AFFIRMATION_RE.test(utterance),
    hasMention: MENTION_RE.test(utterance),
  };
}

export function scoreEngagement(signals: EngagementSignals): number {
  let score = 0;
  if (signals.wordCount >= 20) score += 2;
  else if (signals.wordCount >= 10) score += 1;
  if (signals.hasQuestion) score += 2;
  if (signals.hasAffirmation) score += 1;
  if (signals.hasMention) score += 1;
  return Math.min(score, 5); // cap at 5
}

export function engagementLevel(score: number): EngagementLevel {
  if (score >= 4) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}
```

### 3A. State additions

In `workers/brain-v3/src/state.ts`, add to `ConversationState`:

```typescript
// Add to ConversationState interface:
engagementScore: number;      // running score, updated each turn
engagementHistory: number[];  // last 5 turn scores, for trend analysis
```

Add to `initialState()`:
```typescript
engagementScore: 0,
engagementHistory: [],
```

### 3B. Brain DO usage

In `brain-do.ts` handleTurn(), after extracting prospectUtterance:

```typescript
const signals = extractEngagementSignals(prospectUtterance);
const turnScore = scoreEngagement(signals);
state.engagementHistory = [...state.engagementHistory.slice(-4), turnScore];
state.engagementScore = state.engagementHistory.reduce((a, b) => a + b, 0) / state.engagementHistory.length;
const engagement = engagementLevel(state.engagementScore);
// Pass engagement to buildTurnPlan — used for directive tone
```

---

## 4. LAYER 7 — CONVERSATIONAL REPAIR (repair.ts)

When prospect is confused or highly off-topic, Brain generates a repair directive.

```typescript
// workers/brain-v3/src/repair.ts

import type { IntentType } from './intent';
import type { ConversationState } from './state';

export interface RepairDirective {
  needed: boolean;
  repairSpeak?: string;  // optional override speak — Gemini can soften it
}

/**
 * Determine if a repair turn is needed.
 * Repair is a SOFT override — Prompt Worker may paraphrase but must land the redirect.
 */
export function needsRepair(
  intent: IntentType,
  state: ConversationState,
): RepairDirective {
  if (intent === 'confused') {
    return {
      needed: true,
      repairSpeak: `Let me clarify — ${state.currentStage === 'roi_delivery' ? 'the numbers I just mentioned are based on what you told me about your business' : 'I was asking about your current situation so I can show you something relevant'}.`,
    };
  }

  if (intent === 'off_topic' && state.stagesCompleted.length < 3) {
    return {
      needed: true,
      repairSpeak: `Good point — I want to come back to that. First let me quickly show you something specific to your setup.`,
    };
  }

  return { needed: false };
}
```

In `turn-plan.ts`: call `needsRepair(intent, state)` and if `needed`, inject `repair.repairSpeak` as the directive's `speak` override (with `improvisationBand: 'narrow'` — Gemini may rephrase but must preserve intent).

---

## 5. LAYER 9 — STATS KB WIRING — ⛔ DEFERRED TO CHUNK 10

`stats-kb/` directory does not exist in brain-v3/src/. stats-selector.ts cannot be implemented without stats content to import. Layer 9 will be scoped into Chunk 10 once stats content files are created.

No `stats-selector.ts` in this chunk. No stats-related imports. Assertions C7-13/C7-14/C7-15 are renumbered below.

---

## 6. LAYER 10 — THREE-TIER KB (kb.ts)

Vectorize semantic retrieval for answering off-script questions. Three tiers:
- Tier 1: General business stats (high confidence, always available)
- Tier 2: Industry-specific knowledge
- Tier 3: Client-specific data (Chunk 10 — stub only in Chunk 7)

```typescript
// workers/brain-v3/src/kb.ts

interface Env {
  BRAIN_VECTORS: VectorizeIndex;
}

export interface KBResult {
  tier: 1 | 2 | 3;
  content: string;
  score: number;
}

/**
 * Query the Three-Tier KB for the prospect's question.
 * Returns top results above threshold. Stub-safe — returns [] if BRAIN_VECTORS unavailable.
 */
export async function queryKB(
  query: string,
  env: Env,
  opts: { topK?: number; scoreThreshold?: number } = {},
): Promise<KBResult[]> {
  if (!env.BRAIN_VECTORS) return []; // stub-safe for workers without binding

  const { topK = 3, scoreThreshold = 0.75 } = opts;

  // Embed query via built-in Workers AI text embedding
  // Note: In Chunk 7 we use a pre-computed mock for testing.
  // Real embedding via workers-ai in Chunk 10.
  // For now: Vectorize query with a placeholder vector.
  try {
    const results = await env.BRAIN_VECTORS.query(new Float32Array(768).fill(0), {
      topK,
      returnValues: true,
      returnMetadata: 'all',
    });
    return results.matches
      .filter(m => m.score >= scoreThreshold)
      .map(m => ({
        tier: (m.metadata?.tier as 1 | 2 | 3) ?? 1,
        content: m.metadata?.content as string ?? '',
        score: m.score,
      }));
  } catch {
    return []; // never throw — KB failure must not break call handling
  }
}
```

### 6A. wrangler.toml addition (brain-v3)

```toml
[[vectorize]]
binding = "BRAIN_VECTORS"
index_name = "bella-brain-vectors"
```

**Note:** The `bella-brain-vectors` Vectorize index must be created before deploy. T4 creates it with:
```bash
npx wrangler vectorize create bella-brain-vectors --dimensions=768 --metric=cosine
```

In `turn-plan.ts`: if `intent === 'confused'` or prospect asks a direct factual question, call `queryKB()` and add results as context notes. Stub-safe — if Vectorize unavailable or returns empty, proceed without KB context.

---

## 7. LAYER 11 — FULL DATA ACTIVATION (moves.ts + turn-plan.ts additions)

Wire consultant fields that were computed but never reaching Gemini. All changes are in `moves.ts` and `turn-plan.ts`. No new files.

### 7A. criticalFacts[] pool (buildCriticalFacts in turn-plan.ts)

Add `buildCriticalFacts()` called from `buildTurnPlan()`:

```typescript
function buildCriticalFacts(stage: string, state: ConversationState): string[] {
  const c = state.consultantData; // from intel hydration
  if (!c) return [];

  const raw: string[] = [];

  // ALWAYS slots (1-2)
  if (c.icpAnalysis?.marketPositionNarrative) raw.push(c.icpAnalysis.marketPositionNarrative);
  if (c.valuePropAnalysis?.strongestBenefit) raw.push(c.valuePropAnalysis.strongestBenefit);

  // Stage-specific slots (3-4)
  const agentKey = stage.startsWith('ch_alex') ? 'alex' : stage.startsWith('ch_chris') ? 'chris' : stage.startsWith('ch_maddie') ? 'maddie' : null;
  if (agentKey && c.routing?.reasoning?.[agentKey]) {
    raw.push(c.routing.reasoning[agentKey].split('.')[0] + '.'); // first sentence only
  }
  if (c.hiringAnalysis?.topHiringWedge) {
    raw.push(c.hiringAnalysis.topHiringWedge.split('.')[0] + '.');
  }

  // Optional slots (5-6) — fill to cap of 6
  if (raw.length < 6 && c.businessIdentity?.businessModel) raw.push(c.businessIdentity.businessModel);
  if (raw.length < 6 && c.businessIdentity?.serviceArea) raw.push(c.businessIdentity.serviceArea);
  if (raw.length < 6 && stage.match(/recommendation|close/) && c.consultant?.ctaAgentMapping) {
    raw.push(c.consultant.ctaAgentMapping);
  }

  return cleanFacts(raw).slice(0, 6); // hard cap — never exceed 6
}

// Local helper — cleanFacts() does NOT exist in moves.ts (P1-2 fix)
function cleanFacts(facts: string[]): string[] {
  return facts.filter(f => typeof f === 'string' && f.trim().length > 0);
}
```

### 7B. wow_1 priority stack (moves.ts)

Update `buildWow1Directive()` to use the full 4-tier stack:

```typescript
// Priority: scriptFills.website_positive_comment > copyAnalysis.strongestLine > bella_opener > generic
const observation =
  state.scriptFills?.website_positive_comment ??
  state.consultantData?.copyAnalysis?.strongestLine ??
  state.fastIntelData?.bella_opener ??
  'I can see you run a strong operation';
```

### 7C. scrapedDataSummary in wow_6 (moves.ts)

Update `buildWow6Directive()` to use the full 7-tier stack (doc-bella-v3-universal-data-amendments-20260407 §DECISION 7):

```typescript
const observation =
  state.scriptFills?.scrapedDataSummary ??
  state.deepIntel?.googlePresence?.[0]?.bellaLine ??
  state.consultantData?.mostImpressive?.[0]?.bellaLine ??
  state.consultantData?.conversationHooks?.[0]?.topic ??
  state.consultantData?.hiringAnalysis?.topHiringWedge ??
  state.deepIntel?.hiringMatches?.[0] ??
  'You\'ve built a solid business — let me show you what that means for growth';
```

### 7D. Recommendation colour (moves.ts)

In `buildRecommendationDirective()`, append first sentence of routing.reasoning per agent as additive colour (NEVER changes eligibility):

```typescript
// After existing recLine build:
const alexColour = c.routing?.reasoning?.alex?.split('.')[0];
const chrisColour = c.routing?.reasoning?.chris?.split('.')[0];
const maddieColour = c.routing?.reasoning?.maddie?.split('.')[0];
// Inject as directive notes — additive only
```

---

## 8. LAYER 5 — ACTIVE LISTENING (moves.ts + state.ts)

### 8A. State addition — priorHotMemoryKeys (P1-4 fix)

Add to `ConversationState` in `state.ts`:
```typescript
priorHotMemoryKeys: string[];   // hotMemory keys that had non-null values at START of this turn
```

Add to `initialState()`:
```typescript
priorHotMemoryKeys: [],
```

In `brain-do.ts` handleTurn(), at the **END** of each turn handler (after all extractions and state writes are done):
```typescript
// Update priorHotMemoryKeys for the NEXT turn's active listening check
state.priorHotMemoryKeys = Object.keys(state.hotMemory).filter(k => state.hotMemory[k] != null);
```

### 8B. Active listening cue injection (moves.ts)

In directive builders for WOW stages, include acknowledgment cue when prospect shared new data in the **previous** turn:

```typescript
// In buildWow[N]Directive(), check for newly captured facts:
const newlyCaptured = Object.keys(state.hotMemory).find(
  k => state.hotMemory[k] != null && !state.priorHotMemoryKeys.includes(k)
);
if (newlyCaptured) {
  directive.activeListeningCue = `Acknowledge what they just shared about ${newlyCaptured} naturally before continuing.`;
}
```

`priorHotMemoryKeys` is now a required field (not optional) — no `?.includes()` needed.

---

## 9. LAYER 2 — HYBRID FREESTYLE (turn-plan.ts)

Brain sets `allowFreestyle` on TurnPlan based on stage criticality. Non-critical stages get more Gemini latitude; critical stages are tightly bounded.

```typescript
// In buildTurnPlan():
const CRITICAL_STAGES = ['roi_delivery', 'recommendation', 'ch_alex', 'ch_chris', 'ch_maddie', 'close'];
turnPlan.allowFreestyle = !CRITICAL_STAGES.includes(stage);
turnPlan.improvisationBand = CRITICAL_STAGES.includes(stage) ? 'strict' : 'wide';
```

---

## 10. LAYER 6 — MEMORY RECALL (brain-do.ts)

On call start (turn 0), load warm facts from D1 for the leadId. This covers returning prospects.

```typescript
// In handleTurn() when state.turnCount === 0:
const warmFacts = await env.DB.prepare(
  `SELECT fact_key, fact_value, data_source, confidence FROM lead_facts WHERE lead_id = ? ORDER BY captured_at DESC`
).bind(state.leadId).all();
state.warmFacts = warmFacts.results as WarmFact[];
console.log(`[MEMORY_RECALL] leadId=${state.leadId} warmedFacts=${state.warmFacts.length}`);
```

Already partially covered by `hydrateFacts()` in facts.ts — confirm that call is happening on turn 0.

---

## 11. NEW FILES SUMMARY

```
workers/brain-v3/src/
  intent.ts          — NEW: detectIntent()
  engagement.ts      — NEW: extractEngagementSignals(), scoreEngagement(), engagementLevel()
  repair.ts          — NEW: needsRepair()
  kb.ts              — NEW: queryKB() (Vectorize, stub-safe)
  [stats-selector.ts — DEFERRED to Chunk 10]
```

---

## 12. ASSERTIONS C7-01 through C7-20

```
C7-01: detectIntent('that sounds interesting, tell me more') → 'interested'
C7-02: detectIntent('it's too expensive for us') → 'objecting'
C7-03: detectIntent('what do you mean by that') → 'confused'
C7-04: detectIntent('how do we get started') → 'ready_to_buy'
C7-05: detectIntent('') → 'neutral'
C7-06: scoreEngagement({ wordCount: 25, hasQuestion: true, hasAffirmation: true, hasMention: true }) → 5
C7-07: scoreEngagement({ wordCount: 5, hasQuestion: false, hasAffirmation: false, hasMention: false }) → 0
C7-08: engagementLevel(4) → 'high'
C7-09: engagementLevel(2) → 'medium'
C7-10: engagementLevel(1) → 'low'
C7-11: needsRepair('confused', mockState) → { needed: true, repairSpeak: string }
C7-12: needsRepair('interested', mockState) → { needed: false }
C7-13: buildCriticalFacts returns array length <= 6
C7-14: buildCriticalFacts returns empty array when consultantData is null
C7-15: queryKB('any query', mockEnv_noBinding) → [] (stub-safe)
C7-16: TurnPlan has allowFreestyle=true for 'wow_1' stage
C7-17: TurnPlan has allowFreestyle=false for 'roi_delivery' stage
C7-18: TurnPlan.improvisationBand = 'strict' for 'roi_delivery' stage
C7-19: TurnPlan.improvisationBand = 'wide' for 'wow_3' stage
C7-20: Active listening cue is absent when priorHotMemoryKeys already contains the key (no duplicate cue)
```

---

## 13. VERSION BUMP

brain-v3: bump to next minor version (e.g. v1.0.0 → v1.1.0) — this is a substantial intelligence addition.

---

## 14. IMPLEMENTATION NOTES

- `queryKB()` uses a zero-vector placeholder in Chunk 7. Real embedding wired in Chunk 10. Stub-safe by design.
- Layer 9 (Stats KB) is DEFERRED to Chunk 10 — stats-kb/ directory does not exist.
- `cleanFacts()` is defined as a local helper in turn-plan.ts (spec §7A) — NOT imported from moves.ts.
- Never throw in intelligence layer functions — all must be safe with null/undefined inputs.
- `priorHotMemoryKeys` MUST be updated at end of every turn handler — correctness of Layer 5 depends on it.
- Three-Tier KB Vectorize index creation is a deploy prerequisite — T4 must create `bella-brain-vectors` before deploy.
- Contracts patch (§0) is Step 1 — nothing else runs until contracts compile clean.
