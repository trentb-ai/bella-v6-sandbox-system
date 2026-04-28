# THINK-FIRST LAW — UNIVERSAL BUILDING MANDATE
**Date:** 2026-04-27 AEST
**Authority:** Trent Belasco + T9 Architect (Opus)
**Status:** CANONICAL — binding on all agents, all sessions, all projects
**Supersedes:** Nothing — this is additive to think-migration-mandate.md

---

## THE LAW

**Every new agent capability MUST be built Think-first.**

No raw Workers for agent intelligence. No standard Durable Objects for agent state. No manual prompt assembly. No hand-rolled conversation memory. No fire-and-forget tool calls.

@cloudflare/think v0.4.0 provides all of this as framework primitives. Use them.

---

## WHY THIS LAW EXISTS

Think SDK gives you for free what raw Workers require hundreds of lines to hand-roll:

| Capability | Raw Worker | Think Agent |
|---|---|---|
| Persistent state | Manual KV/D1 read/write per turn | DO SQLite, survives hibernation/eviction/crashes |
| Sub-agent orchestration | Service binding fetch, manual state sync | chat() RPC, full conversation history preserved |
| Progressive tool activation | Manual if/else in request handler | beforeTurn() returns activeTools per turn |
| Knowledge bases | Manual R2 fetch + prompt injection | R2SkillProvider — new vertical = one file upload, zero code |
| Searchable intelligence | Not available | AgentSearchProvider — FTS5 over agent's own findings |
| Workspace filesystem | Manual R2/D1 writes | Built-in SQLite-backed read/write/edit/list/find/grep/delete |
| Dynamic context injection | Rebuild entire prompt | session.addContext() + refreshSystemPrompt() mid-session |
| Browser tools | Manual CDP setup | createBrowserTools() — one line |
| Industry extensions | Manual tool loading | extensionLoader + getExtensions() — zero agent code changes per vertical |
| Client configuration | Manual KV per-client state | configure/getConfig — persisted per-instance, survives restarts |
| Crash recovery | Not available | chatRecovery = true + onChatRecovery — one property |
| Context management | Manual token counting + truncation | Compaction with createCompactFunction, protectHead, tailTokenBudget |

Building raw Workers for agent intelligence is building a bicycle when a car is in the garage.

---

## THREE REFERENCE TEMPLATES — PICK THE RIGHT ONE

Not all agents are the same. Three template blueprints cover every agent type in the platform. Every new agent starts from the closest template and adapts.

### Template 1: ANALYSIS agents — ConsultantAgent v2

**Use for:** Intelligence gathering, business analysis, data synthesis, research, scoring, any agent whose primary job is turning raw data into structured insights.

**Key patterns:**
1. **Multi-pass analysis** — parent calls chat() repeatedly as data arrives. Model UPGRADES rather than re-analyzes.
2. **AgentSearchProvider** — FTS5 over the agent's own findings. Model indexes discoveries, searches them on subsequent passes.
3. **Workspace reports** — structured output per analysis pass. Parent reads workspace files for detailed data.
4. **Progressive tool activation** via beforeTurn() — tools unlock as analysis deepens.
5. **beforeToolCall() validation** — block tools when prerequisites missing (no data, wrong tier), substitute cached results on re-analysis.
6. **onStepFinish() observability** — loop detection (3 consecutive identical steps → inject course correction), per-step telemetry, tier-level cost logging.
7. **onChatError() graceful degradation** — structured errors with phase/tier/retryability, partial analysis preserved, parent retries or falls back.
8. **Session branching** — A/B routing comparison for ambiguous industries. Fork session, run two strategies, compare, pick best.
9. **Client configuration** via configure/getConfig — per-instance persistent preferences.
10. **Stability guarantees** via waitUntilStable() — parent waits before reading state.
11. **Recovery** via chatRecovery + onChatRecovery — durable execution.

**Blueprint:** `BRAIN_DOCS/doc-bella-consultant-agent-v2-blueprint-20260427.md`
**Future agents using this template:** Compliance, WOW analysis, any client-facing intelligence agent.

---

### Template 2: COMPUTATION agents — ROI Agent (blueprint pending)

**Use for:** Deterministic calculations, quoting, pricing, any agent that mixes hardcoded formulas with LLM reasoning. Critical distinction: the MODEL decides WHEN to calculate, but the CALCULATION ITSELF is deterministic code — never LLM-generated math.

**Key patterns (extending analysis template — inherits all 11 patterns above, adds):**
1. **Deterministic tool execution** — tool bodies contain hardcoded formulas, lookup tables, industry rates. NO Gemini math. V3 design law: no ROI hallucination.
2. **beforeToolCall() for computation** — extends analysis validation: block calculateROI without ACV, substitute cached calculation results. Analysis template provides tier gating; computation template adds formula-input validation.
3. **Session branching for quotes** — Quote A/B comparison (conservative vs aggressive). Analysis template uses branching for routing; computation template uses it for pricing strategies.
4. **z.discriminatedUnion for industry routing** — single calculateQuote tool with per-industry schemas, not per-industry tools.
5. **onStepFinish() for calculation loops** — extends analysis loop detection: detect model recalculating same agent 3+ times. Analysis template catches analysis loops; computation template catches calculation loops.
6. **Inter-agent signaling** — child signals parent when quote is ready mid-turn (via state + parent polling or @callable callback).

**Blueprint:** `BRAIN_DOCS/doc-bella-roi-agent-blueprint-20260427.md` (T9 authoring next)
**Future agents using this template:** Any pricing/quoting/scoring agent, industry-specific calculators.

---

### Template 3: ORCHESTRATOR agents — BellaAgent (emerges from migration)

**Use for:** Top-level conversation managers that coordinate sub-agents, manage stage progression, handle real-time voice streaming, and make routing decisions.

**Key patterns (unique to orchestrators):**
1. **Dual-gated stage advancement** — SCRIPT_GATE (all required beats spoken) + DATA_GATE (all required fields collected). BOTH must pass.
2. **Conversation Intelligence Engine** — three modes (scripted/guided/freestyle) with adaptive system prompt per turn via beforeTurn().
3. **Sub-agent coordination** — spawns and manages analysis + computation sub-agents. Reads their state, merges their output, routes data between them.
4. **Real-time streaming** — output goes to TTS. Per-beat prompt delivery (~100-150 words). Latency-critical.
5. **Intel event handling** — receives Event POST, routes to correct sub-agent, triggers re-analysis.
6. **onChatError() recovery** — graceful degradation when Gemini fails. Fallback responses. Never dead air.
7. **Freestyle guardrails** — max N freestyle turns before auto-steer back to script. Collection escalation after M turns without new data.

**Blueprint:** Emerges from migration chunks 3-7. Will be formalized as canonical doc when BellaAgent migration completes.
**Future agents using this template:** Any top-level conversation agent, client-facing orchestrators on PAS.

---

### Shared patterns (ALL three templates)

Every Think agent regardless of type MUST have:
- `chatRecovery = true` — explicit, never rely on default
- `maxSteps` — explicitly set based on worst-case tool calls per turn
- `configureSession()` with at minimum: writable reasoning context + compaction
- `waitUntilStable()` before parent reads state
- Public getter methods for parent access (SubAgentStub excludes base properties)
- Version bumped on every deploy (worker.ts + package.json)

### Template selection guide

| Agent characteristic | Template |
|---------------------|----------|
| Turns raw data into structured insights | Analysis (ConsultantAgent v2) |
| Produces deterministic numbers/quotes/scores | Computation (ROI Agent) |
| Manages conversation flow + coordinates sub-agents | Orchestrator (BellaAgent) |
| Mix of analysis + computation | Start with Computation, add analysis patterns |
| Not sure | Start with Analysis — it's the simplest and most tested |

---

## SDK DOCS ARE SUPREME REFERENCE

### The .d.ts is ground truth

`~/.claude/skills/think-agent-docs/think-types/think.d.ts` — 790 lines. Every class, method, property, type. If docs and .d.ts conflict, .d.ts wins.

### Enforcement rules

1. **NEVER spec a Think feature without reading the relevant doc first.** chatRecovery defaulting to false was caught ONLY by reading think.d.ts line 305. Without doc read, it ships broken.
2. **NEVER accept "I think the SDK does X" from any agent.** Demand the .d.ts line number or doc section.
3. **NEVER approve a sprint that uses Think features not verified in docs.** The v2 blueprint's SDK Verification Log is the standard.
4. **If docs and .d.ts conflict, .d.ts wins.** Types are generated from source. Docs may lag.
5. **T5 must read .d.ts BEFORE any spec touching Think SDK.** Existing law (feedback_think_sdk_preflight_mandatory) — enforce religiously.
6. **New T9 architect: FIRST read after prompt file is think.d.ts, cover to cover.** Not skimming. 790 lines. Know every type.

### Doc locations

```
~/.claude/skills/think-agent-docs/
  SKILL.md                          <- START HERE
  think-types/
    think.d.ts                      <- GROUND TRUTH (790 lines)
    index.d.ts                      <- Bridge exports
    manager.d.ts                    <- ExtensionManager
    tools/
      workspace.d.ts                <- createWorkspaceTools()
      browser.d.ts                  <- createBrowserTools()
  think-docs/
    sessions.md                     <- Context blocks, providers, compaction, workspace
    sub-agents.md                   <- chat(), recovery, stability
    tools.md                        <- Tool merge order, browser, extensions
    lifecycle-hooks.md              <- All hooks + execution order
    client-tools.md                 <- Browser tools, approvals
    getting-started.md              <- Setup
    bella-think-migration-audit.md  <- Migration audit
```

### When to read which doc

| Task | Read First |
|------|-----------|
| Any new spec | think.d.ts (full) + relevant topic doc |
| Reviewing sprint code | think.d.ts (types) + lifecycle-hooks.md |
| Sub-agent integration | sub-agents.md + think.d.ts (waitUntilStable, chat) |
| Context/knowledge/search | sessions.md (full) |
| Tool design | tools.md (merge order, schemas, browser, extensions) |
| SDK dispute resolution | think.d.ts (exact types) — .d.ts wins |
| Property defaults | think.d.ts ONLY — chatRecovery=false, maxSteps=10 |

---

## VIOLATIONS

Any of these is a FAIL in code review:

- Building a new raw Worker for agent intelligence when Think can do it
- Speccing Think features without citing doc source
- Accepting SDK behavioral claims without .d.ts proof
- Shipping chatRecovery/maxSteps at defaults without explicit assessment
- Building one-shot analysis when multi-pass is appropriate
- Skipping waitUntilStable() before parent reads sub-agent state
- Hand-rolling state persistence when DO SQLite handles it
- Manual prompt assembly when context blocks handle it

---

## SCOPE

This law applies to:
- All Bella sub-agents (ConsultantAgent, ROI, Compliance, WOW, future)
- All Pillar Agent Substrate agents
- All client agents built on PAS
- Any new agent capability, anywhere in the platform

This law does NOT apply to:
- Pure transport workers (thin routers, bridges, webhooks)
- Workflow orchestrators (WorkflowEntrypoint)
- Static asset workers
- MCP servers that don't need agent intelligence

---

## RELATED DOCS

- `canonical/think-migration-mandate.md` — migration-specific architecture
- `canonical/think-reference-pack.md` — reference materials
- `BRAIN_DOCS/doc-bella-consultant-agent-v2-blueprint-20260427.md` — template blueprint
- `~/.claude/skills/think-agent-docs/SKILL.md` — SDK doc index
