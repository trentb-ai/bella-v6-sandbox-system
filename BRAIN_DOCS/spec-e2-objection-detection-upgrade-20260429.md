# E2 Objection Detection Upgrade — Think-Native Spec (v2)
## 2026-04-29 AEST | Author: T9 Architect (Opus) | Approved: Trent
## Source: Trent's BELLA THINK OBJECTION BUSTERS (canonical, D1: doc-bella-objection-busters-canonical)
## D1 ID: spec-e2-objection-detection-upgrade-20260429
## Supersedes: v1 (regex approach — rejected by Trent)

---

## SUMMARY

Full Think-native objection handling. NO regex for objection detection. Model detects objections natively from playbook knowledge. `logObjection` Think tool for state tracking. Provider context block for Trent's 10 Objection Busters (ported VERBATIM). Escalation via beforeTurn() reading objection log. Consultant `objectionHandling` wired.

**Architecture change from v1:** Removed ALL regex-based intent classification for objections. Regex was a raw-Worker pattern — the model already reads every user message and is smarter than regex at understanding intent, tone, context, multi-intent, and nuance.

---

## FILES CHANGED

| File | CWD | Changes |
|------|-----|---------|
| `src/bella-agent.ts` | `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/` | configureSession (new context block), getTools (logObjection), getToolsForStage (add logObjection everywhere), beforeTurn (replace intent/recovery with escalation-only), DELETE classifyUserIntent, DELETE buildRecoveryDirective, ADD getConsultantObjectionHandling, UPDATE onChatResponse metrics |
| `src/types.ts` | same | ObjectionEntry interface, ConversationState: add objectionLog, REMOVE lastIntent, REMOVE intentHistory |
| `src/worker.ts` | same | Version bump → `3.21.0-think` |
| `scripts/canary-test.ts` | same | Version string update |

---

## CHANGE 1: Objection Busters provider context block (configureSession)

**File:** `bella-agent.ts` L185-225
**Action:** Add new `.withContext("objection_playbook", ...)` block after `stage_policies` (L209)

### AFTER L209 (insert new block):
```typescript
      .withContext("objection_playbook", {
        provider: {
          get: async () => OBJECTION_BUSTERS_TEXT,
        },
      })
```

### NEW CONSTANT (add near top of file, after COMPLIANCE_RULES_TEXT):

```typescript
const OBJECTION_BUSTERS_TEXT = `OBJECTION HANDLING PLAYBOOK — FOLLOW EXACTLY

DESIGN PRINCIPLES:
1. No dead ends — every objection: acknowledged → reframed → redirected to booking
2. No over-explaining — no long justifications, no defensive tone, no "convincing"
3. Trial = decision shortcut — every branch reinforces "don't think — test it live"
4. Bella stays in control — she never "hands off", she always asks for a time

When you detect ANY prospect objection, hesitation, or resistance:
- Log it immediately using the logObjection tool
- Apply the matching response pattern below VERBATIM (adapt only prospect name/business)
- Always end by asking for a specific time

═══ OBJECTION 1: "I don't have time right now" (no_time) ═══
No problem — that's exactly why most people use this.
It removes the need to chase leads, respond instantly, and handle calls manually.
Let's do this properly — I'll lock in a quick 20-minute onboarding at a time that suits you, and you'll see exactly how it runs without any pressure.
What does your schedule look like later today or tomorrow?

═══ OBJECTION 2: "Can you just send me info?" (send_info) ═══
Of course — I can send something through.
But to be honest, this only really clicks when you see it running in your own context.
Let's lock in a quick 20-minute session — I'll walk you through it properly, and then I'll send everything after so it actually makes sense.
What's a good time for you?

═══ OBJECTION 3: "How much does it cost?" (price_inquiry) ═══
Good question.
We run this on performance after the trial — so it's aligned with results.
There's a small upfront to cover costs, and then a percentage of the conversions we generate.
The key thing is seeing how it performs in your setup first — that's where the real value becomes clear.
Let's lock in your onboarding and get the trial running — then you can make a decision based on actual results.
What time works best?

═══ OBJECTION 4: "I need to think about it" (think_about_it) ═══
Totally fair.
Usually what people are weighing up is whether it'll actually work in their business — which is exactly what the trial is there to show.
So rather than guess, let's get it running and you'll have a clear answer very quickly.
I'll lock in a short onboarding so we set it up properly.
What's a good time?

═══ OBJECTION 5: "I need to speak to my partner / team" (authority_deferral) ═══
Makes sense.
What tends to work best is getting it set up first, so when you do speak with them, you're showing something real — not just explaining it.
We can also bring them into the onboarding call if that helps.
Let's lock in a time that works for you, and we can include them if needed.
What does your availability look like?

═══ OBJECTION 6: "I want to see the demo first" (demo_request) ═══
Perfect — that's the best place to start.
Let's do this properly — I'll show you a couple of your agents live, and then we'll lock in your onboarding straight after so you can get the trial running.
Jump in as the prospect and test it however you like.
[After demo]: So you can see how that performs — let's lock in your onboarding and get this live for you.
What time works best?

═══ OBJECTION 7: "We already have something like this" (competitor) ═══
That's good — it means you're already thinking in the right direction.
What most people find is the difference comes down to how well it actually converts — not just responding, but qualifying and moving people to action.
Let's get this running alongside what you've already got and you'll see the difference pretty quickly.
I'll lock in your onboarding so we can set it up properly.
What time works for you?

═══ OBJECTION 8: "Leads aren't really the issue" (wrong_fit) ═══
Got it — so it's more about what happens after they come in?
That's exactly where this sits — response speed, qualification, and making sure the right opportunities actually turn into booked calls or sales.
Let's map it to your current flow and tighten that up.
I'll lock in your onboarding so we can set it up around your process.
What time works best?

═══ OBJECTION 9: "We handle everything ourselves" (self_sufficient) ═══
That's usually the case — and that's exactly where time and opportunities start getting lost.
This doesn't replace your team — it takes care of the front end so your team only deals with qualified, ready-to-move conversations.
Let's get it set up so you can see the difference in how clean those opportunities become.
What time works for your onboarding?

═══ OBJECTION 10: "Just curious / not ready yet" (not_ready) ═══
That's fine — most people start there.
The difference is when you actually see it running in your own business, it becomes very clear very quickly whether it's worth doing.
So rather than keep it theoretical, let's get your trial live and you'll have a real answer within days.
I'll lock in a quick onboarding to get you set up.
What time works best?

═══ UNIVERSAL RECOVERY (if they stall or give unclassifiable resistance) ═══
Totally understand.
The easiest way to evaluate this is just to see it running — that's what the trial is for.
Let's lock in a quick onboarding and you'll have full clarity from there.
What time works for you?

═══ HOSTILE / WANTS TO STOP ═══
Stay warm. Do NOT push. "I hear you — want me to stop here, or is there something specific I can address?"
If they want to stop: "No problem at all — thanks for your time today. If anything changes, we're here." End gracefully.
If 2+ hostile signals: wrap up immediately, thank them, end warmly. Do NOT attempt another reframe.

═══ ESCALATION RULES ═══
If the logObjection tool returns escalate: true (same objection raised 3+ times):
STOP repeating the same angle. Pivot: "I can see this is a real consideration — rather than go back and forth, let me send you a quick summary so you can review it in your own time. Would that be helpful?"
Offer proposal/email as graceful off-ramp. Do NOT repeat the same reframe.

═══ CONSULTANT ADVICE ═══
If you see [CONSULTANT_OBJECTION_ADVICE] in the system context, use that industry-specific or prospect-specific advice to ENHANCE your response. It supplements the playbook — don't replace the playbook pattern, weave the advice into it.
`;
```

---

## CHANGE 2: logObjection Think tool (getTools)

**File:** `bella-agent.ts` L228+ (inside getTools())
**Action:** Add `logObjection` tool after existing tools

### NEW (add inside getTools() return object):
```typescript
      logObjection: tool({
        description: "Log when prospect raises an objection, shows resistance, or expresses hesitation. Call this EVERY TIME you detect an objection before responding. The tool returns escalation status.",
        inputSchema: z.object({
          objectionType: z.enum([
            'no_time', 'send_info', 'price_inquiry', 'think_about_it',
            'authority_deferral', 'demo_request', 'competitor', 'wrong_fit',
            'self_sufficient', 'not_ready', 'hostile', 'stall', 'other',
          ]),
          trigger: z.string().describe("What the prospect actually said that triggered this"),
          severity: z.enum(['soft', 'firm', 'hard']).describe("soft=hesitation, firm=clear objection, hard=resistance/hostile"),
        }),
        execute: async (args) => {
          const state = this.cs;
          if (!state) return { status: "no_session" };

          state.objectionLog = state.objectionLog ?? [];
          state.objectionLog.push({
            objectionType: args.objectionType,
            trigger: args.trigger,
            severity: args.severity,
            stage: state.currentStage,
            turn: state.transcriptLog?.length ?? 0,
            ts: Date.now(),
          });
          if (state.objectionLog.length > 30) state.objectionLog.shift();
          await this.setState(state);

          const sameTypeCount = state.objectionLog.filter(
            o => o.objectionType === args.objectionType
          ).length;
          const hostileCount = state.objectionLog.filter(
            o => o.objectionType === 'hostile'
          ).length;

          return {
            status: "logged",
            sameObjectionCount: sameTypeCount,
            totalObjections: state.objectionLog.length,
            escalate: sameTypeCount >= 3,
            exitNow: hostileCount >= 2,
          };
        },
      }),
```

---

## CHANGE 3: Add logObjection to ALL stages (getToolsForStage)

**File:** `bella-agent.ts` L521-543

### BEFORE:
```typescript
  private getToolsForStage(stage: string | undefined): string[] {
    const extraction = ['extractData', 'confirmData'];
    switch (stage) {
      case 'roi_delivery':
        return [...extraction, 'delegateToRoiAgent'];
      case 'greeting':
      case 'wow':
        return ['triggerDeepScrape'];
      case 'anchor_acv':
        return [...extraction, 'triggerDeepScrape'];
      case 'ch_alex':
      case 'ch_chris':
      case 'ch_maddie':
      case 'ch_sarah':
      case 'ch_james':
      case 'recommendation':
      case 'optional_side_agents':
      case 'close':
        return extraction;
      default:
        return [];
    }
  }
```

### AFTER:
```typescript
  private getToolsForStage(stage: string | undefined): string[] {
    const always = ['logObjection'];
    const extraction = ['extractData', 'confirmData'];
    switch (stage) {
      case 'roi_delivery':
        return [...always, ...extraction, 'delegateToRoiAgent'];
      case 'greeting':
      case 'wow':
        return [...always, 'triggerDeepScrape'];
      case 'anchor_acv':
        return [...always, ...extraction, 'triggerDeepScrape'];
      case 'ch_alex':
      case 'ch_chris':
      case 'ch_maddie':
      case 'ch_sarah':
      case 'ch_james':
      case 'recommendation':
      case 'optional_side_agents':
      case 'close':
        return [...always, ...extraction];
      default:
        return always;
    }
  }
```

---

## CHANGE 4: Replace beforeTurn() intent/recovery block with escalation-only

**File:** `bella-agent.ts` L448-467

### BEFORE (L448-467):
```typescript
    const stageCompliance = this.buildStageComplianceRules(state?.currentStage, state?.currentWowStep);
    const intentResult = this.classifyUserIntent(lastUserText);
    const recoveryDirective = this.buildRecoveryDirective(intentResult, state);

    if (state && intentResult.category !== 'engaged') {
      state.lastIntent = intentResult;
      state.intentHistory = state.intentHistory ?? [];
      state.intentHistory.push({ category: intentResult.category, turn: state.transcriptLog?.length ?? 0, ts: Date.now() });
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

### AFTER:
```typescript
    const stageCompliance = this.buildStageComplianceRules(state?.currentStage, state?.currentWowStep);
    const escalationDirective = this.buildEscalationDirective(state);
    const consultantObjectionAdvice = this.getConsultantObjectionHandling(state, state?.currentStage ?? 'greeting');

    const dynamicSystem = [
      ctx.system,
      this.buildIntelContext(),
      this.formatRoiResults(),
      this.buildStageDirectiveContext(),
      COMPLIANCE_ENFORCEMENT,
      stageCompliance,
      escalationDirective,
      consultantObjectionAdvice,
    ].filter(Boolean).join('\n\n');
```

---

## CHANGE 5: New helper methods (replace classifyUserIntent + buildRecoveryDirective)

**File:** `bella-agent.ts`
**Action:** DELETE `classifyUserIntent()` (L1690-1711) and `buildRecoveryDirective()` (L1713-1733). ADD these:

### NEW:
```typescript
  private buildEscalationDirective(state: ConversationState | null): string {
    if (!state?.objectionLog?.length) return '';

    const counts = new Map<string, number>();
    for (const o of state.objectionLog) {
      counts.set(o.objectionType, (counts.get(o.objectionType) ?? 0) + 1);
    }

    const hostileCount = counts.get('hostile') ?? 0;
    if (hostileCount >= 2) {
      return '[ESCALATION: Prospect has shown repeated resistance. Wrap up gracefully NOW. Do NOT push further. Thank them and end warmly. Do NOT attempt another reframe.]';
    }

    const maxRepeat = Math.max(...counts.values());
    if (maxRepeat >= 3) {
      const repeatedType = [...counts.entries()].find(([_, c]) => c >= 3)?.[0] ?? 'unknown';
      return `[ESCALATION: Prospect has raised "${repeatedType}" concern ${maxRepeat} times. STOP repeating the same angle. Pivot to proposal/summary off-ramp per the escalation rules in your objection playbook.]`;
    }

    return '';
  }

  private getConsultantObjectionHandling(state: ConversationState | null, stage: string): string {
    if (!state?.intel?.consultant) return '';

    const consultant = state.intel.consultant as any;
    const briefs = consultant.agentBriefs as Partial<Record<string, any>> | null;
    if (!briefs) return '';

    const relevantStages = ['recommendation', 'wow', 'close', 'ch_alex', 'ch_chris', 'ch_maddie', 'ch_sarah', 'ch_james'];
    if (!relevantStages.includes(stage)) return '';

    const advice: string[] = [];
    for (const [name, brief] of Object.entries(briefs)) {
      if (brief?.objectionHandling) {
        advice.push(`[CONSULTANT_OBJECTION_ADVICE for ${brief.agentName ?? name}: ${brief.objectionHandling}]`);
      }
    }

    return advice.length ? advice.join('\n') : '';
  }
```

---

## CHANGE 6: Update onChatResponse metrics — remove intent references

**File:** `bella-agent.ts` L682, L698-703

### BEFORE (L682):
```typescript
      intent: state.lastIntent?.category ?? "unknown",
```

### AFTER:
```typescript
      intent: state.objectionLog?.length
        ? state.objectionLog[state.objectionLog.length - 1].objectionType
        : "none",
```

### BEFORE (L698-703 — stall + hostile alert):
```typescript
    const recentIntents = (state.intentHistory ?? []).slice(-STALL_THRESHOLD);
    if (recentIntents.length >= STALL_THRESHOLD && recentIntents.every(i => i.category === "silence")) {
      state.alerts.push({ type: "stall", message: `${STALL_THRESHOLD} consecutive silence turns`, turn: metric.turn, ts: Date.now() });
    }
    if (state.lastIntent?.category === "hostile") {
      state.alerts.push({ type: "hostile_user", message: `Hostile: "${state.lastIntent.trigger}"`, turn: metric.turn, ts: Date.now() });
    }
```

### AFTER:
```typescript
    const recentObjections = (state.objectionLog ?? []).slice(-STALL_THRESHOLD);
    if (recentObjections.length >= STALL_THRESHOLD && recentObjections.every(o => o.objectionType === 'stall')) {
      state.alerts.push({ type: "stall", message: `${STALL_THRESHOLD} consecutive stall turns`, turn: metric.turn, ts: Date.now() });
    }
    const lastObj = state.objectionLog?.length ? state.objectionLog[state.objectionLog.length - 1] : null;
    if (lastObj?.objectionType === 'hostile' && lastObj.turn === metric.turn) {
      state.alerts.push({ type: "hostile_user", message: `Hostile: "${lastObj.trigger}"`, turn: metric.turn, ts: Date.now() });
    }
```

---

## CHANGE 7: Type additions + removals

**File:** `types.ts`

### NEW (add after existing interfaces):
```typescript
export interface ObjectionEntry {
  objectionType: string;
  trigger: string;
  severity: 'soft' | 'firm' | 'hard';
  stage: string;
  turn: number;
  ts: number;
}
```

### MODIFY ConversationState:

**REMOVE** (L358-359):
```typescript
  lastIntent?: { category: string; confidence: number; trigger?: string };
  intentHistory?: Array<{ category: string; turn: number; ts: number }>;
```

**ADD** (in same location):
```typescript
  objectionLog?: ObjectionEntry[];
```

### UPDATE import in bella-agent.ts (L19-29):
Add `ObjectionEntry` to the import from `./types`.

---

## CHANGE 8: Version bump

**File:** `worker.ts`
```typescript
// BEFORE:
const VERSION = "3.20.3-think";
// AFTER:
const VERSION = "3.21.0-think";
```

**File:** `scripts/canary-test.ts` — update version string to match.

---

## WHAT GOT DELETED (old patterns killed)

| Deleted | Why |
|---------|-----|
| `classifyUserIntent()` (L1690-1711) | Regex classification replaced by model-native detection |
| `buildRecoveryDirective()` (L1713-1733) | Recovery text replaced by playbook context block |
| `lastIntent` on ConversationState | Replaced by `objectionLog` |
| `intentHistory` on ConversationState | Replaced by `objectionLog` |
| All regex objection patterns | Model detects objections from playbook knowledge |
| beforeTurn() intent tracking block | Replaced by `logObjection` tool |

---

## WHAT OLD T9 GAPS THIS ADDRESSES

| Gap | Status | How |
|-----|--------|-----|
| GAP 1: Recovery directives stage-blind | ✅ FIXED | Model reads stage context + consultant data. Escalation directive is stage-aware. |
| GAP 2: Consultant objectionHandling never wired | ✅ FIXED | `getConsultantObjectionHandling()` injects into dynamicSystem |
| GAP 3: No objection memory | ✅ FIXED | `objectionLog` on state, populated by `logObjection` tool |
| GAP 4: Missing intent patterns | ✅ FIXED | Model detects ALL patterns natively — no regex gaps possible |
| GAP 5: No typed objection tracking | ✅ FIXED | `ObjectionEntry` interface with type/trigger/severity/stage/turn |
| GAP 6: No escalation logic | ✅ FIXED | `buildEscalationDirective()` + tool returns `escalate`/`exitNow` |

---

## ARCHITECTURAL COMPLIANCE (revised)

| Principle | Status |
|-----------|--------|
| Think-native | ✅ Provider context block + Think tool + beforeTurn() state read |
| No regex for objection detection | ✅ Model-native from playbook knowledge |
| Trent's playbook ported VERBATIM | ✅ All 10 objection responses word-for-word in OBJECTION_BUSTERS_TEXT |
| State backward-compatible | ✅ `objectionLog` optional (`??` defaults). Old `lastIntent`/`intentHistory` removed — unused by any other code path |
| Consultant data wired not recomputed | ✅ Reads stored agentBriefs |
| logObjection available at all stages | ✅ Added to `always` array in getToolsForStage |
| Full hook observability | ✅ logObjection fires beforeToolCall + afterToolCall + onStepFinish |

---

## RISK ASSESSMENT

| Risk | Severity | Mitigation |
|------|----------|------------|
| Model doesn't call logObjection | LOW | Tool description says "Call this EVERY TIME". Playbook says "Log it immediately using the logObjection tool". If model still skips, add beforeTurn() hint. |
| Model misclassifies objection type | LOW | Wrong type logged = wrong escalation count. But playbook response is model-native regardless — model reads playbook and picks correct pattern. |
| activeTools restriction blocks logObjection | NONE | Added to `always` array in getToolsForStage |
| Removing lastIntent/intentHistory breaks other code | CHECKED | Only referenced in: beforeTurn L452-456 (replaced), turnMetrics L682 (updated), alerts L698-703 (updated). No other consumers. |
| OBJECTION_BUSTERS_TEXT prompt length | LOW | ~3500 tokens. Provider block = cached by withCachedPrompt(). Compaction-safe. |

---

## GATE INSTRUCTIONS

### T2 Review:
1. Verify all 10 objection responses match Trent's OBJECTION BUSTERS doc VERBATIM
2. Verify logObjection tool available at all stages (always array)
3. Verify lastIntent/intentHistory fully removed — no dangling references
4. Verify buildEscalationDirective thresholds (3x same type, 2x hostile)
5. Verify getConsultantObjectionHandling reads correct state path

### T3A Codex Gate:
- **CWD:** `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
- Verify CWD with: `sed -n '1,5p' "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/src/bella-agent.ts"`
- Focus areas: logObjection tool schema, getToolsForStage always array, no orphaned lastIntent/intentHistory refs

### T3B Regression:
- 65/65 canary post-deploy
- Verify model calls logObjection during objection scenarios
- Verify compliance tests still pass
- Check BELLA_SAID for verbatim playbook language in objection responses
