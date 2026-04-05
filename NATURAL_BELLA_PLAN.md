# NATURAL BELLA — Implementation Plan
### Date: 2026-04-04 | Baseline: Bella Golden v1 (git tag: bella-golden-v1)
### Goal: Transform Bella from mechanical script-reader to natural conversationalist
### Principle: Low effort / High ROI first

---

## THE PROBLEM

Bella feels mechanical because:
1. **Rigid templates** — `moves.ts` builds verbatim `speak` text with variable substitution. Gemini either reads it exactly (mandatory=true) or barely paraphrases it.
2. **No repair** — When a prospect pushes back or contradicts, Bella skips the step entirely. No acknowledgment, no rephrase, no "got it, let me adjust."
3. **Linear progression** — All 8 WOW steps fire in order regardless of engagement. A one-word "yeah" gets the same treatment as a prospect sharing their deepest business pain.
4. **"VERBATIM" instructions** — Recommendation and channel stages explicitly say "do NOT paraphrase, do NOT improvise."

## THE PRINCIPLES (from Claude.ai research)

1. **Conversational Intent Layers** — Replace rigid `speak` text with: goal, must_contain phrases, tone, and 2-3 example variants. Gemini picks the best fit for the conversation flow.
2. **Adaptive Listening + Repair** — When prospect contradicts or pushes back, inject a repair prompt so Bella acknowledges and reframes instead of silently skipping.
3. **Stage Depth Routing** — Measure engagement quality (response length, questions asked, pain points volunteered). High engagement = go deeper. Low engagement = compress and move on.

---

## TIER 1: LOW EFFORT / HIGH ROI (do first)

### 1A. Loosen Gemini Instructions for WOW Question Steps
**Effort:** ~30 min | **Impact:** Immediate naturalness improvement
**Files:** `brain-v2-rescript/src/index.ts` (prompt assembly)

Currently the brain sends the `speak` text to the bridge, and the bridge tells Gemini to deliver it. For WOW steps where `ask=true` (wow_1, wow_3, wow_4, wow_7, wow_8), change the instruction from "deliver this text" to "cover these points naturally."

**Change:**
- Keep `speak` text as the REFERENCE/EXAMPLE
- Add a `guidanceMode` field: `"verbatim"` (current) vs `"guided"` (new)
- When `guidanceMode=guided`: bridge prompt says "Cover these key points in a natural, conversational way. Use this as a guide, not a script: {speak}"
- When `guidanceMode=verbatim`: current behavior (mandatory delivery)

**WOW steps to loosen:**
| Step | Current | Proposed | Why |
|------|---------|----------|-----|
| wow_1 (research intro) | ask=true, verbatim | **guided** | This is the first impression — needs to feel natural |
| wow_2 (reputation/trial) | monologue, auto-advance | keep verbatim | Numbers/offer — must be precise |
| wow_3 (ICP/problem) | ask=true, verbatim | **guided** | Prospect is sharing about their business |
| wow_4 (conversion CTA) | ask=true, verbatim | **guided** | Asking about their conversion — should feel like curiosity |
| wow_5 (alignment bridge) | monologue, auto-advance | keep verbatim | Transition text — short, precise |
| wow_6 (scraped observation) | monologue, auto-advance | keep verbatim | Data-driven — needs accuracy |
| wow_7 (explore/recommend) | ask=true, mandatory | **guided** | Critical decision point — should feel collaborative |
| wow_8 (source check) | ask=true, mandatory | **guided** | Asking about lead sources — conversational |

**Compliance safety net:** `mustContainPhrases` still checks for key phrases. If Gemini drifts too far, compliance flags it. But we allow natural delivery instead of robotic recitation.

---

### 1B. Add Repair Context on Pushback/Contradiction
**Effort:** ~1 hour | **Impact:** Bella stops feeling deaf
**Files:** `brain-v2-rescript/src/flow.ts`, `brain-v2-rescript/src/index.ts`

Currently when `wow3Rejected=true` or `wow4Rejected=true`, the flow just skips ahead. The prospect gets no acknowledgment.

**Change:**
- When sentiment detection flags a rejection/contradiction, inject a `repairContext` field into the directive
- `repairContext` = a short instruction for Gemini: "The prospect just said '{utterance}' which contradicts what you expected. Acknowledge their correction warmly, then transition naturally to the next topic."
- Bridge passes this as part of the system prompt
- Gemini handles the repair naturally — no template needed

**Example flow:**
```
Bella: "It looks like you mainly work with large enterprises..."
Prospect: "No, actually we focus on small businesses and startups."
Bella (OLD): *silently skips to wow_5*
Bella (NEW): "Ah got it — small businesses and startups, that's actually even more 
interesting because that's exactly where our agents tend to have the biggest impact. 
Let me adjust what I'm showing you..."
```

---

### 1C. Filler vs Substantive Response Detection
**Effort:** ~30 min | **Impact:** Bella responds appropriately to depth
**Files:** `brain-v2-rescript/src/flow.ts`

Currently any non-empty input advances the flow. "Yeah" and a 200-word business story get identical treatment.

**Change:**
- Add `responseDepth` classification: `filler` (<15 chars or matches filler patterns), `short` (15-50 chars), `substantive` (>50 chars or contains question marks)
- When `responseDepth=substantive` on a WOW question step: tell Gemini to reference what they said before moving to the next point
- When `responseDepth=filler`: advance normally (current behavior)
- This is NOT about blocking advancement — it's about making Bella's NEXT response acknowledge what they said

**Example:**
```
Prospect (filler): "Yeah sounds good"
→ Bella advances to next step normally

Prospect (substantive): "Yeah we mainly work with family-owned manufacturing 
businesses in Western Sydney, been doing it for 20 years"
→ Bella's next step references this: "Twenty years with family manufacturers in 
Western Sydney — that's a deep niche. So when it comes to..."
```

---

## TIER 2: MEDIUM EFFORT / HIGH ROI (do second)

### 2A. Intent Layer Architecture for WOW Steps
**Effort:** ~3 hours | **Impact:** Fundamental naturalness upgrade
**Files:** `brain-v2-rescript/src/moves.ts`, `brain-v2-rescript/src/index.ts`

Replace the `speak` field with a full intent object:

```typescript
interface WowDirective {
  // What must be achieved this step
  goal: string;
  // Phrases that MUST appear (compliance gate)
  mustContain: string[];
  // Tone/style guide for Gemini
  tone: 'expert_peer' | 'curious_consultant' | 'enthusiastic_presenter';
  // 2-3 example deliveries (Gemini picks/blends)
  examples: string[];
  // What to extract from the response
  extract: string[];
  // Whether to wait for user
  waitForUser: boolean;
}
```

Benefits:
- Gemini has creative freedom WITHIN guardrails
- Each call sounds different (picks different example or blends them)
- Compliance still enforced via `mustContain`
- Easy to A/B test — just swap examples

### 2B. Engagement Quality Scoring
**Effort:** ~2 hours | **Impact:** Adaptive call flow
**Files:** `brain-v2-rescript/src/flow.ts`, `brain-v2-rescript/src/index.ts`

Track across the conversation:
- `avgResponseLength`: rolling average of user utterance length
- `questionsAsked`: count of user turns containing "?"  
- `painPointsMentioned`: count of turns with business-problem keywords
- `engagementScore`: weighted composite (0-10)

Use engagement score to:
- **High (7+):** Stay in WOW longer, ask follow-up questions, go deeper on topics they care about
- **Medium (4-6):** Normal flow (current behavior)
- **Low (<4):** Compress remaining WOW steps, skip non-essential ones, move to recommendation faster

### 2C. Conversational Memory Within the Call
**Effort:** ~1 hour | **Impact:** Bella remembers what you said
**Files:** `brain-v2-rescript/src/index.ts`, `bridge-v2-rescript/src/index.ts`

Currently each WOW step is somewhat isolated. The prospect might say "we mainly get clients from Google Ads" in wow_3, but wow_6 doesn't reference it.

**Change:**
- Accumulate `conversationFacts[]` from extraction at each turn
- Inject these into every subsequent Gemini prompt as "Things the prospect has told you so far"
- Gemini naturally weaves them in: "You mentioned earlier you get most clients from Google Ads — that's exactly where Alex would focus..."

---

## TIER 3: HIGHER EFFORT / MEDIUM ROI (do later)

### 3A. Agent Benefit Lines to D1 (A/B Testing)
**Effort:** ~2 hours | **Impact:** Testable recommendation copy
**Files:** `brain-v2-rescript/src/moves.ts`, D1 database

Move the "LOCKED AGENT BENEFIT LINES" from hardcoded moves.ts to Brain D1 as JSON documents. Each agent (Alex, Chris, Maddie, Sarah, James) gets 3-4 benefit line variants. Brain DO reads them at call start, picks one based on industry/engagement.

Unlocks: A/B test different benefit copy without redeploying. Track which variant drives more trial signups.

### 3B. Stage Depth Routing (Branching Flow)
**Effort:** ~4 hours | **Impact:** Truly adaptive calls
**Files:** `brain-v2-rescript/src/flow.ts`

Replace linear WOW1→WOW8 with a graph:
- If prospect is highly engaged at WOW3, add a "deep dive" sub-step
- If prospect is disengaged, skip WOW5+WOW6 and go straight to WOW7
- If prospect asks a question mid-WOW, park the current step and answer, then resume

This is the most complex change and should only be attempted after Tier 1+2 are verified.

### 3C. Move Observability + Analytics Hooks
**Effort:** ~2 hours | **Impact:** Data-driven script optimization
**Files:** `brain-v2-rescript/src/index.ts`

Log every move as a structured analytics event to D1:
- `move_id`, `stage`, `wow_step`, `engagement_score`, `response_depth`, `compliance_score`
- Track which WOW steps have highest/lowest engagement
- Track which agent benefit lines convert best
- Feed data back into Gemini prompt selection

### 3D. Full Freestyle Mode for Post-Recommendation
**Effort:** ~3 hours | **Impact:** Natural close conversation
**Files:** `bridge-v2-rescript/src/index.ts`, `brain-v2-rescript/src/moves.ts`

After recommendation is delivered, switch Bella to full freestyle mode:
- No more script, just a knowledge base + conversation history
- Gemini answers prospect questions naturally from the intel data
- Only hard guardrail: never criticize the prospect's business, never make up numbers
- This is where Bella should feel most human — answering questions, handling objections, closing naturally

---

## IMPLEMENTATION ORDER

```
Week 1: Tier 1 (1A + 1B + 1C)
  └─ Deploy as v6.17.0 brain + v9.41.0 bridge
  └─ Live test 3-5 calls
  └─ Codex review before deploy

Week 2: Tier 2 (2A + 2B + 2C)  
  └─ Deploy as v6.18.0 brain
  └─ Live test with engagement scoring visible in logs
  └─ Compare call quality before/after

Week 3+: Tier 3 (3A-3D)
  └─ Based on Tier 1+2 learnings
  └─ A/B test framework first, then depth routing
```

---

## RISKS & MITIGATIONS

| Risk | Mitigation |
|------|------------|
| Gemini goes off-script on guided steps | `mustContainPhrases` compliance check catches drift. Start with lenient threshold (0.4) and tighten. |
| Repair context confuses Gemini | Keep repair instructions short (1-2 sentences). Test with adversarial pushback. |
| Engagement scoring over-compresses for shy prospects | Default to normal flow (Tier 2B medium score). Only compress on very low engagement. |
| Losing Bella Golden baseline | Tag is locked. Any regression → `git checkout bella-golden-v1` + 4 deploys. |

---

## BELLA GOLDEN V1 BASELINE (restore point)
- Git tag: `bella-golden-v1` | Commit: `8e23c66`
- Local backup: `/Users/trentbelasco/Desktop/BELLA_GOLDEN_V1/`
- All changes build on this baseline. If anything breaks, restore in 5 commands.
