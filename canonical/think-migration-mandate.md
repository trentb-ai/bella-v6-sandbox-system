# THINK MIGRATION MANDATE — ALL AGENTS READ THIS
**Date:** 2026-04-26 AEST
**Authority:** Trent Belasco + T9 Architect
**Status:** CANONICAL — binding on all agents, all sessions

---

## WHAT THIS IS

Bella brain is migrating from standard Durable Object to **@cloudflare/think v0.4.0**. This doc defines the target architecture every agent must understand and build toward.

## WHY

Current brain (brain-v1-rescript) is a standard DO with manual everything:
- Manual prompt assembly (~200 lines in moves.ts)
- Manual KV state persistence (3+ keys per turn)
- Manual conversation memory management
- No crash recovery
- No tool gating (wrong-stage tool calls possible)
- No sub-agents (Chris = separate worker)
- No session compaction (long calls overflow context)
- No lifecycle hooks (all logic in request handler)

Think v0.4.0 solves ALL of these with battle-tested Cloudflare primitives.

## TARGET: BellaAgent extends Think + 3 Sub-Agents

```typescript
export class BellaAgent extends Think<Env> {
  chatRecovery = true;
  maxSteps = 10;

  getModel() { return createGoogleGenerativeAI(...)("gemini-2.0-flash"); }

  getSystemPrompt(): string {
    // Static only: persona, compliance rules, voice instructions
    // Dynamic data lives in context blocks (Session API)
  }

  getTools(): ToolSet {
    return {
      delegateToRoiAgent: tool({ ... }),   // ROI sub-agent delegation
      extractData: tool({ ... }),           // Gated to extraction stages
      confirmData: tool({ ... }),           // Gated to extraction stages
      runComplianceCheck: tool({ ... }),    // Gated to compliance stage
    };
  }

  // CONVERSATION INTELLIGENCE ENGINE — adaptive mode per turn
  beforeTurn(ctx: TurnContext): TurnConfig {
    const stage = this.cs?.currentStage;
    const missing = this.getMissingRequiredFields(stage);
    const intent = this.classifyLastUtterance(ctx);
    const mode = this.determineMode(stage, missing, intent); // scripted|guided|freestyle
    return {
      systemPrompt: this.buildAdaptivePrompt(stage, mode, missing),
      activeTools: this.getToolsForStage(stage),
    };
  }

  beforeToolCall(ctx: ToolCallContext): ToolCallDecision | void { /* validation */ }
  afterToolCall(ctx: ToolCallResultContext): void { /* state capture */ }

  // DUAL-GATED ADVANCEMENT — both gates must pass
  onChatResponse(result): void {
    // GATE 1: Script beats — all required beats spoken for this stage
    // GATE 2: Data gate — all required fields collected
    // BOTH pass → advance. Either holds → stay.
  }

  onStepFinish(ctx: StepContext): void { /* loop detection, observability */ }

  configureSession(session: Session): Session {
    session.compactAfter(50);
    // 5 writable context blocks
    session.addWritableContextProvider("stage_directive", { ... }); // CURRENT BEAT ONLY (~100-150 words)
    session.addWritableContextProvider("intel", { ... });
    session.addWritableContextProvider("live_roi", { ... });
    session.addWritableContextProvider("critical_facts", { ... });
    session.addWritableContextProvider("live_quote", { ... });
    // 2 read-only + R2SkillProvider
    session.addContextProvider("compliance_rules", { ... });
    session.addContextProvider("stage_policies", { ... });
    session.addSkillProvider("knowledge_base", new R2SkillProvider({ ... }));
    return session;
  }
}

// SUB-AGENTS (own sessions, own tools, own system prompts)
export class RoiAgent extends Think<Env> { /* 5 tools, R2SkillProvider */ }
export class ConsultantAgent extends Think<Env> { /* 3 tools, spawned on intel-event */ }
export class ComplianceAgent extends Think<Env> { /* 1 tool, structured scoring */ }
```

## KEY ARCHITECTURAL DECISIONS (T9, BINDING)

1. **ROI = SOPHISTICATED sub-agent** (RoiAgent) with 5 tools + own R2SkillProvider — NOT a simple tool. Key value offering, overengineered by design.
2. **Single calculateQuote** with z.discriminatedUnion (carpet/dental/legal/trade) — NOT per-industry tools
3. **Consultant = sub-agent** (ConsultantAgent) spawned on intel-event — NOT separate worker fetch
4. **Compliance = sub-agent** (ComplianceAgent) with structured scoring — NOT raw Gemini fetch
5. **Context blocks** replace buildStageDirective()/buildCriticalFacts()/buildContextNotes()
6. **Per-beat prompt delivery** — consultant produces beat array, context block delivers ONLY current beat (~100-150 words). Critical for Deepgram latency.
7. **Dual-gated advancement** — SCRIPT_GATE (all required beats spoken) + DATA_GATE (all required fields collected). BOTH must pass before stage advances.
8. **Conversation Intelligence Engine** — three modes (scripted/guided/freestyle) with adaptive system prompt per turn via beforeTurn()
9. **Freestyle guardrails** — max 2 freestyle turns before auto-steer back to script
10. **Collection escalation** — natural → guided → direct ask after 3 turns without new data
11. **chatRecovery = true** — free crash recovery, one line
12. **DO SQLite** replaces KV for hot-path state — zero network latency
13. **Session compaction** prevents context window overflow on long calls
14. **Intel via event POST** + saveMessages() — kills KV polling entirely
15. **Session branching** — Quote A/B comparison + compliance self-correction
16. **Chris/other agents DEFERRED** — Bella-only focus for this migration
17. **R2SkillProvider** for dynamic knowledge base loading — no deploy for KB updates

## MIGRATION BOUNDARY

- Frozen-bella-rescript-v2 patterns = logic source (ROI formulas, stage policies, gate conditions)
- Think = plumbing (hooks, sessions, tools, sub-agents, recovery)
- Port logic verbatim. Never reinvent working code. Framework handles the wiring.

## BUILD PLAN

**11 chunks (0-10), dependency-ordered. Full plan: `BRAIN_DOCS/doc-think-migration-build-plan-v2-20260426.md`**

| Sprint | Chunk | Core |
|---|---|---|
| 1 | Chunk 0: Think Scaffold | BellaAgent extends Think, chatRecovery, getModel |
| 2 | Chunk 1: Context Blocks + R2SkillProvider | 5 writable + 2 read-only providers + R2 |
| 3 | Chunk 2: State Migration | KV → DO SQLite for brain state |
| 4 | Chunk 3: Conversation Intelligence Engine | ALL 5 hooks, mode engine, dual gates, per-beat delivery |
| 5 | Chunk 4: ROI Sub-Agent | 5 tools, own R2, own session, own compaction |
| 6 | Chunk 8: Consultant Sub-Agent | 3 tools, spawned on intel-event |
| 7 | Chunk 5: Intel Delivery | Event POST, consultant-on-event, kill KV polling |
| 8 | Chunk 6: Extraction Tools | extractData + confirmData, gated |
| 9 | Chunk 7: Compaction + Recovery + Branching | compactAfter(50), FTS5, Quote A/B, compliance recovery |
| 10 | Chunk 9: Compliance Sub-Agent | Structured scoring, 7 criteria |
| 11 | Chunk 10: Workspace Tools | DO SQLite filesystem + R2 spillover |

## REFERENCE DOCS

- Full build plan: `BRAIN_DOCS/doc-think-migration-build-plan-v2-20260426.md`
- Think opportunities audit: `BRAIN_DOCS/doc-think-opportunities-audit-t9-20260426.md`
- ROI + Quote blueprint: `BRAIN_DOCS/doc-bella-roi-quote-agent-blueprint-20260426.md`
- Architecture doc: `BRAIN_DOCS/doc-bella-roi-quote-machine-architecture-t9-20260426.md`
- Think Agent docs: `~/.claude/skills/think-agent-docs/`
- Migration audit: `~/.claude/skills/think-agent-docs/think-docs/bella-think-migration-audit.md`
- Think types: `~/.claude/skills/think-agent-docs/think-types/think.d.ts`
