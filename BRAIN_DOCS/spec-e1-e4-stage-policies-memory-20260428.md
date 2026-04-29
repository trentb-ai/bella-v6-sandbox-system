# Sprint E1+E2+E3+E4: Stage Policies + Objection Detection + WOW Gating + Memory
## 2026-04-28 ~19:25 AEST | Architect: T9 | For: T2 Code Lead
## Target: bella-think-agent-v1-brain v3.17.0-think
## ONE GATE. ONE DEPLOY. BUNDLED.

---

## OVERVIEW

4 chunks bundled for single Codex gate. Dependency chain: E1 (policies) → E2 (objection detection, uses policies) → E3 (wow gating, uses engagement signal) + E4 (memory, independent).

**Files touched:**
- `bella-agent.ts` — E1-A/B/C/D + E2-A/B + E4-A (all changes)
- `controller.ts` — E3-A/B (shouldAdvanceWowStep + processFlow)
- `types.ts` — E2-C + E3-C (new state fields)

**CWD for Codex:** `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`

---

## CHUNK E1: Rich Stage Policies + Compliance L1/L3

### E1-A: Replace COMPLIANCE_RULES_TEXT (bella-agent.ts L81-86)

**BEFORE:**
```typescript
const COMPLIANCE_RULES_TEXT = `COMPLIANCE RULES
- Never make false claims about ROI or agent capabilities
- Never use the word "guarantee" or phrases like "definitely will" regarding outcomes or revenue
- Never pressure or coerce — always low-friction close
- Never record without consent
- If prospect is uncomfortable, offer to end call immediately`;
```

**AFTER:**
```typescript
const COMPLIANCE_RULES_TEXT = `COMPLIANCE + CONVERSATION STEERING
- Never make false claims about ROI or agent capabilities — if you don't have the data, say so
- Never use "guarantee", "definitely will", "promise", "100%" regarding outcomes or revenue. Rephrase with: "in our experience", "typically", "based on similar businesses"
- Never pressure or coerce — always low-friction close
- Never record without consent
- If prospect is uncomfortable, offer to end call immediately
- Never criticise the prospect's website, tools, or current approach — maximise what they have
- Never say "actually" (implies they're wrong), "honestly" (implies you were lying before), or "no offence"
- If prospect gets hostile: stay warm. "I hear you. Want me to wrap up, or is there something specific I can address?"
- If prospect is confused: slow down, simplify, ask what specifically is unclear
- If prospect goes silent for 2+ turns: "still with me? Want me to go a different direction?"
- Never repeat the same pitch twice — if it didn't land, rephrase or move on
- VOICE PERSPECTIVE: Always "you/your" to the prospect, "they/their" only for THEIR customers`;
```

### E1-B: Replace STAGE_POLICIES_TEXT (bella-agent.ts L88-92)

**BEFORE:**
```typescript
const STAGE_POLICIES_TEXT = `STAGE POLICIES
- WOW stages: 3 stall minimum before advance
- ROI delivery: only after ACV confirmed
- Close: only after ROI delivered
- Never re-open a completed stage`;
```

**AFTER:**
```typescript
const STAGE_POLICIES_TEXT = `STAGE POLICIES

UNIVERSAL IMPROV RULES:
- Prospect controls pace. If they go deep on a topic, stay with them — don't rush to next step
- When prospect deflects or changes subject: acknowledge briefly ("good point"), bridge back with "and actually that connects to..." or "that's exactly why..."
- If prospect asks a question Bella can answer from intel: answer it, then bridge back to current objective
- If prospect asks something Bella cannot answer: "that's a great question — I'll flag that for the team to cover in detail. What I CAN show you right now is..."
- Never say "moving on" or "next up" — transitions must feel organic
- Match prospect energy: if they're excited, match. If they're measured, dial back
- When prospect gives a one-word answer: don't accept it. Probe: "and when you say [word], do you mean [specific A] or more like [specific B]?"

PER-STAGE RULES:
- greeting: One attempt to get first name. If prospect skips, continue — never ask twice
- wow (all steps): 3-stall minimum before advance. "Stall" = prospect responded but didn't engage
- wow_4_conversion_action: MUST get CTA confirmation before advancing. This gates the entire ROI
- recommendation: Prospect MUST say yes/ready/let's do it. Silence or "maybe" = not ready. Restate the value
- anchor_acv: If prospect says "I don't know" for deal value: offer range brackets ("is it closer to $500 or $5000?"). Never accept "I don't know" as final answer
- channel stages: If prospect says "we don't do that" for a channel: acknowledge, skip, move to next channel. Don't push
- roi_delivery: ONLY after ACV confirmed. Deliver each line item. Pause for reactions. Don't rush the numbers
- close: Only after ROI delivered. If prospect hedges: "totally understand — want me to send this as a summary so you can review it?" Never push

BRING-BACK-ON-TRACK PATTERNS:
- Soft redirect: "that's really interesting — and it actually ties into what I was about to show you..."
- Value bridge: "100% — and that's exactly the kind of thing [Agent Name] handles. Let me show you..."
- Acknowledge + park: "great question. Let me note that down. Right now I want to make sure we cover..."
- Time anchor: "we've got a lot to cover and I want to make sure you see the best bits..."

HARD RULES:
- Never re-open a completed stage
- Never skip ROI delivery
- Never close before ROI delivered`;
```

### E1-C: Compliance Layer 1 — Stage-Specific Rules in beforeTurn()

**IN bella-agent.ts beforeTurn() — BEFORE (L395-401):**
```typescript
    const dynamicSystem = [
      ctx.system,
      this.buildIntelContext(),
      this.formatRoiResults(),
      this.buildStageDirectiveContext(),
      COMPLIANCE_ENFORCEMENT,
    ].filter(Boolean).join('\n\n');
```

**AFTER (note: E2 recovery directive also goes here — see E2-B):**
```typescript
    const stageCompliance = this.buildStageComplianceRules(state?.currentStage, state?.currentWowStep);
    const intentResult = this.classifyUserIntent(transcript);
    const recoveryDirective = this.buildRecoveryDirective(intentResult, state);

    if (state && intentResult.category !== 'engaged') {
      state.lastIntent = intentResult;
      state.intentHistory = state.intentHistory ?? [];
      state.intentHistory.push({ category: intentResult.category, turn: state.turnCount ?? 0, ts: Date.now() });
      if (state.intentHistory.length > 30) state.intentHistory.shift();
    }

    const dynamicSystem = [
      ctx.system,
      this.buildIntelContext(),
      this.formatRoiResults(),
      this.buildStageDirectiveContext(),
      COMPLIANCE_ENFORCEMENT,
      stageCompliance,
      recoveryDirective,
    ].filter(Boolean).join('\n\n');
```

**NEW METHOD — add after buildStageDirectiveContext() (~L1480):**
```typescript
  private buildStageComplianceRules(stage?: string, wowStep?: string | null): string {
    const rules: string[] = [];
    rules.push('STAGE-SPECIFIC COMPLIANCE:');

    if (stage === 'greeting') {
      rules.push('- Do NOT reference scrape data or intel yet — save the wow for the wow stage');
      rules.push('- Do NOT ask "what does your business do?" — you already know');
      rules.push('- Do NOT mention agent names yet');
    }

    if (stage === 'wow') {
      rules.push('- Do NOT mention pricing, ROI, or costs — too early');
      rules.push('- Do NOT recommend agents yet — build wow first');
      rules.push('- Do NOT say "I noticed" more than once per step — vary your phrasing');
      if (wowStep === 'wow_4_conversion_action') {
        rules.push('- MUST confirm CTA before advancing. Ask explicitly, wait for answer');
      }
    }

    if (stage === 'recommendation') {
      rules.push('- Do NOT discuss pricing or ROI yet — recommend agents first');
      rules.push('- Do NOT recommend more than 3 agents — focus on highest-value');
    }

    if (stage === 'anchor_acv') {
      rules.push("- Do NOT accept \"I don't know\" for deal value — offer brackets");
      rules.push('- Do NOT skip this stage — ACV gates ROI delivery');
    }

    if (stage === 'roi_delivery') {
      rules.push('- Do NOT rush the numbers — pause after each line item');
      rules.push('- Do NOT round aggressively — use the calculator output');
      rules.push('- Do NOT say "guaranteed" or "definitely" about ROI figures');
    }

    if (stage === 'close') {
      rules.push('- Do NOT high-pressure close — low-friction only');
      rules.push('- Do NOT invent urgency ("limited time", "only today")');
      rules.push('- DO offer summary/proposal if they hesitate');
    }

    return rules.length > 1 ? rules.join('\n') : '';
  }
```

### E1-D: Compliance Layer 3 — History Sanitization in beforeTurn()

**ADD inside beforeTurn(), after the COMPLIANCE_TRIGGER block (after L416, before `return turnConfig`):**
```typescript
    // Compliance L3: sanitize prior assistant messages so model doesn't reinforce violations
    const VIOLATION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
      { pattern: /\bguarantee[ds]?\b/gi, replacement: 'typically delivers' },
      { pattern: /\bdefinitely will\b/gi, replacement: 'in our experience' },
      { pattern: /\bpromise you\b/gi, replacement: 'based on similar businesses' },
      { pattern: /\b100%\s*(certain|sure|guaranteed)\b/gi, replacement: 'very likely' },
    ];

    const msgs = turnConfig.messages ?? ctx.messages ?? [];
    let sanitized = false;
    const cleanedMessages = msgs.map((m: any) => {
      if (m.role !== 'assistant') return m;
      let text = typeof m.content === 'string' ? m.content : '';
      if (!text) return m;
      let changed = false;
      for (const { pattern, replacement } of VIOLATION_PATTERNS) {
        if (pattern.test(text)) {
          text = text.replace(pattern, replacement);
          changed = true;
        }
      }
      if (changed) { sanitized = true; return { ...m, content: text }; }
      return m;
    });

    if (sanitized) {
      turnConfig.messages = cleanedMessages;
      console.log('[COMPLIANCE_L3] Sanitized prior assistant violations from history');
    }
```

---

## CHUNK E2: Objection Detection + Recovery Injection

### E2-A: classifyUserIntent — NEW METHOD on BellaAgent (bella-agent.ts)

**Add after buildStageComplianceRules:**
```typescript
  private classifyUserIntent(transcript: string): { category: string; confidence: number; trigger?: string } {
    const t = (transcript ?? '').toLowerCase().trim();

    if (!t || t.length < 3)
      return { category: 'silence', confidence: 0.9 };
    if (/^(ok|yeah|sure|right|mm|uh huh|yep|cool|okay|yea|mhm)$/i.test(t))
      return { category: 'silence', confidence: 0.7, trigger: t };

    if (/not interested|waste of time|stop calling|hang up|piss off|scam|go away/i.test(t))
      return { category: 'hostile', confidence: 0.9, trigger: t.match(/not interested|waste of time|stop calling|hang up|piss off|scam|go away/i)?.[0] };

    if (/too expensive|can't afford|no budget|not right now|maybe later|need to think|talk to my partner|already have|don't need|we're fine|not for us/i.test(t))
      return { category: 'objection', confidence: 0.8, trigger: t.match(/too expensive|can't afford|no budget|not right now|maybe later|need to think|talk to my partner|already have|don't need|we're fine|not for us/i)?.[0] };

    if (/anyway|but what about|can we talk about|let me ask you|what do you think about/i.test(t))
      return { category: 'deflection', confidence: 0.6, trigger: 'topic change' };

    if (/what do you mean|i don't understand|confused|what is that|can you explain|huh\?|what\?/i.test(t))
      return { category: 'confused', confidence: 0.8, trigger: 'confusion' };

    return { category: 'engaged', confidence: 0.5 };
  }
```

### E2-B: buildRecoveryDirective — NEW METHOD on BellaAgent (bella-agent.ts)

**Add after classifyUserIntent:**
```typescript
  private buildRecoveryDirective(
    intent: { category: string; confidence: number; trigger?: string },
    state: ConversationState | null,
  ): string {
    if (intent.category === 'engaged') return '';

    switch (intent.category) {
      case 'silence':
        return `[RECOVERY: Prospect gave minimal response. Don't accept one-word answers. Probe deeper: "when you say that, do you mean X or Y?" or rephrase the question with more context.]`;
      case 'hostile':
        return `[RECOVERY: Prospect is resistant (said: "${intent.trigger}"). Stay warm. Offer to wrap up: "I hear you — want me to stop here, or is there something specific I can address?" Do NOT push. If they want to stop, thank them and end gracefully.]`;
      case 'objection':
        return `[RECOVERY: Prospect raised objection (said: "${intent.trigger}"). Acknowledge: "totally fair." Then reframe with value. If "too expensive" → point to ROI. If "already have" → "how's that going for you?" If "need to think" → "what specifically would help you decide?"]`;
      case 'confused':
        return `[RECOVERY: Prospect is confused. Slow down. Use simpler language. Ask: "which part should I explain differently?" Don't repeat the same explanation — rephrase.]`;
      case 'deflection':
        return `[RECOVERY: Prospect changed topic. If their topic is answerable from intel, answer briefly then bridge back. If not: "great question — let me note that. Right now I want to make sure you see..." Park and return.]`;
      default:
        return '';
    }
  }
```

### E2-C: State additions (types.ts)

**ADD to ConversationState interface (after L356 `complianceCorrecting?: boolean;`):**
```typescript
  lastIntent?: { category: string; confidence: number; trigger?: string };
  intentHistory?: Array<{ category: string; turn: number; ts: number }>;
  wowStepTurns?: Record<string, number>;
  wowStepEngagement?: Record<string, 'none' | 'minimal' | 'engaged' | 'deep'>;
```

Note: `wowStepTurns` and `wowStepEngagement` are for E3 — added here since we're in the same file.

---

## CHUNK E3: WOW Step Quality Gating

### E3-A: Track engagement in processFlow (controller.ts L47)

**ADD inside processFlow(), after L57 (after initial buildStageDirective), before L59 (shouldAdvance check):**
```typescript
  // E3: Track per-step turns and engagement for quality gating
  if (state.currentStage === 'wow' && state.currentWowStep) {
    state.wowStepTurns = state.wowStepTurns ?? {};
    state.wowStepTurns[state.currentWowStep] = (state.wowStepTurns[state.currentWowStep] ?? 0) + 1;

    state.wowStepEngagement = state.wowStepEngagement ?? {};
    const tLen = (transcript ?? '').trim().length;
    if (tLen < 5) state.wowStepEngagement[state.currentWowStep] = 'none';
    else if (tLen < 20) state.wowStepEngagement[state.currentWowStep] = 'minimal';
    else if (tLen < 80) state.wowStepEngagement[state.currentWowStep] = 'engaged';
    else state.wowStepEngagement[state.currentWowStep] = 'deep';
  }
```

### E3-B: Replace shouldAdvanceWowStep (controller.ts L136-150)

**BEFORE:**
```typescript
function shouldAdvanceWowStep(state: ConversationState): boolean {
  if (!state.currentWowStep) return false;

  switch (state.currentWowStep) {
    case "wow_1_research_intro": return true;
    case "wow_2_reputation_trial": return true;
    case "wow_3_icp_problem_solution": return true;
    case "wow_4_conversion_action": return state.confirmedCTA !== null;
    case "wow_5_alignment_bridge": return true;
    case "wow_6_scraped_observation": return true;
    case "wow_7_explore_or_recommend": return true;
    case "wow_8_source_check": return true;
    default: return false;
  }
}
```

**AFTER:**
```typescript
function shouldAdvanceWowStep(state: ConversationState): boolean {
  if (!state.currentWowStep) return false;

  // wow_4 always gates on CTA confirmation — unchanged
  if (state.currentWowStep === 'wow_4_conversion_action') return state.confirmedCTA !== null;

  const turns = state.wowStepTurns?.[state.currentWowStep] ?? 0;
  const engagement = state.wowStepEngagement?.[state.currentWowStep] ?? 'none';

  // Deep/engaged = advance after 1 turn (they heard it and reacted)
  if (engagement === 'deep' || engagement === 'engaged') return true;

  // Minimal = need at least 2 turns (barely responded)
  if (engagement === 'minimal') return turns >= 2;

  // None/silence = need 3 turns (the 3-stall minimum from policy)
  return turns >= 3;
}
```

**WHY:** Currently 7/8 wow steps auto-advance immediately (`return true`). Prospect may not have engaged with the content at all. New logic: if they responded meaningfully → advance. If silence/minimal → hold and let recovery injection (E2) re-engage them. 3-turn ceiling prevents infinite loops.

---

## CHUNK E4: Memory Block Activation

### E4-A: Add Memory Instructions to buildSoulContext() (bella-agent.ts L1429-1434)

**BEFORE (the AGENTS section + closing backtick):**
```typescript
THE AGENTS:
Alex — speed-to-lead and follow-up consistency.
Chris — improving website conversion actions while prospects are warm.
Maddie — capturing live phone opportunities before they disappear.
Sarah — dormant database reactivation.
James — reviews and reputation.`;
```

**AFTER:**
```typescript
THE AGENTS:
Alex — speed-to-lead and follow-up consistency.
Chris — improving website conversion actions while prospects are warm.
Maddie — capturing live phone opportunities before they disappear.
Sarah — dormant database reactivation.
James — reviews and reputation.

8. MEMORY SYSTEM
You have a writable memory block. Use set_context("memory", content) to store important facts during the conversation. This memory persists across the entire call and survives compaction.

WHAT TO STORE:
- [FACT] Prospect-stated business details: "runs 3 locations", "20 staff", "been in business 12 years"
- [COMMITMENT] Things they agreed to: "wants to see ROI", "interested in trial", "said they'd review proposal"
- [OBJECTION] Concerns raised: "worried about cost", "already has a chatbot", "partner needs to approve"
- [CORRECTION] Things you got wrong that they corrected: "actually it's dental not medical"
- [PREFERENCE] Communication preferences: "prefers email", "busy Mondays", "wants numbers not stories"

FORMAT: One line per fact. Category tag first. Most recent at top.
Example: [FACT] 3 locations across Sydney | [OBJECTION] "we tried AI before and it didn't work" | [COMMITMENT] wants to see Chris demo

WHEN TO WRITE:
- Every time prospect states a business fact you didn't already have from intel
- Every time prospect raises a concern or objection
- Every time prospect agrees to something or shows interest
- Every time you need to correct a prior assumption
- If memory is getting long, combine related facts and remove outdated ones

WHEN TO READ:
- Before every response, check memory for corrections and commitments
- In recommendation stage: reference their stated problems from memory
- In ROI delivery: use their actual numbers from memory, not defaults
- In close: reference commitments they made earlier`;
```

---

## VERSION BUMP

Whatever the current VERSION → `3.17.0-think`

---

## THINK SDK PRIMITIVE MAPPING

| Change | Think Primitive | Native? |
|--------|----------------|---------|
| STAGE_POLICIES_TEXT expansion | `withContext("stage_policies", { provider })` | YES — existing block |
| COMPLIANCE_RULES_TEXT expansion | `withContext("compliance_rules", { provider })` | YES — existing block |
| Stage compliance (E1-C) | `beforeTurn()` → `TurnConfig.system` | YES — system override |
| History sanitization (E1-D) | `beforeTurn()` → `TurnConfig.messages` | YES — messages override |
| Intent classification (E2) | `beforeTurn()` → string analysis | CUSTOM — Think provides hook |
| Recovery injection (E2) | `beforeTurn()` → `TurnConfig.system` | YES — system override |
| WOW quality gating (E3) | `beforeTurn()` flow check | CUSTOM — logic in controller.ts |
| Memory instructions (E4) | `withContext("memory", { writable })` | YES — block exists |

**All Think-native. No new SDK features. No new dependencies.**

---

## STATE FIELD SUMMARY (all optional, backward-compatible via `??`)

| Field | Type | Chunk | Purpose |
|-------|------|-------|---------|
| `lastIntent` | `{ category, confidence, trigger? }` | E2 | Current turn classification |
| `intentHistory` | `Array<{ category, turn, ts }>` | E2 | Stall detection across turns |
| `wowStepTurns` | `Record<string, number>` | E3 | Turns spent per wow step |
| `wowStepEngagement` | `Record<string, engagement>` | E3 | Engagement quality per step |

---

## DEPLOY + TEST

1. `cd "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain" && npx wrangler deploy`
2. Use FRESH lid
3. Canary checks:
   - `/do/{lid}/session-info` → expanded policy text in context blocks
   - Run 5+ turn call → `/do/{lid}/state` → verify memory block entries, intentHistory populated, wowStepTurns tracked
   - Say "guarantee" → check logs for `[COMPLIANCE_L3]` sanitization
   - Give one-word answers in wow → verify step holds (doesn't auto-advance)
   - Say "not interested" → verify `[RECOVERY: ...]` appears in system prompt
   - Say "too expensive" → verify objection recovery, not hostile recovery
   - Greeting stage: Bella should NOT mention agents or intel directly
   - wow_4: should NOT advance without CTA confirmation (regression check)

---

## RISK ASSESSMENT

| Chunk | Risk | Reason |
|-------|------|--------|
| E1-A/B | ZERO | String constant replacement |
| E1-C | LOW | Additive system injection, empty string = no-op |
| E1-D | LOW-MED | Message history mod, bounded to 4 patterns, assistant-only |
| E2 | LOW | Additive system injection, regex classification is fast (~1ms) |
| E3 | MEDIUM | Changes wow advancement logic. wow_4 CTA gate UNCHANGED. 3-turn ceiling prevents infinite loops |
| E4 | ZERO | Additive soul text. Graceful degradation if model ignores |

**Highest risk = E3.** Regression check: wow_4 must still gate on confirmedCTA. Other steps must still advance (just with engagement threshold). 3-turn ceiling = guaranteed progress.

---

## GATE

- T5 reads .d.ts to verify TurnConfig has `system` and `messages` fields (ADR-002 IR-1)
- T3A Codex from CWD `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
- SDK_EVIDENCE_PACK: beforeTurn → TurnConfig.system, TurnConfig.messages, withContext writable
- T3B regression after deploy: 65/65 canary + wow advancement + intent classification
