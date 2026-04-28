# T9 ARCHITECT HANDOVER — THINK MIGRATION v2
**Doc ID:** doc-handover-t9-think-migration-v2-20260426
**Date:** 2026-04-26 AEST
**From:** T9 Architect (Opus) — outgoing session
**To:** Next T9 Architect + T2 Code Lead (now also Orchestrator)

---

## CRITICAL: T1 ORCHESTRATOR REMOVED

Trent removed T1 this session. T2 Code Lead absorbs orchestrator duties:
- Direct team coordination (T3a, T3b, T4, T5)
- Sprint sequencing and agent tasking
- Deploy authorization (T3 PASS = deploy authority, unchanged)
- Complex architecture questions → T9

---

## STATE

Think migration v2 plan COMPLETE and APPROVED by Trent (11 chunks, 0-10).
Full audit cross-reference completed: **46/46 items addressed, zero gaps.**

Existing Think brain at: `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
Version: 3.11.8-think | 6 agent classes | 17 test files | 1013-line BellaAgent

---

## CANONICAL DOCS (READ BEFORE ANY WORK)

1. **BUILD PLAN:** `BRAIN_DOCS/doc-think-migration-build-plan-v2-20260426.md` (11 chunks, full code specs)
2. **MANDATE:** `canonical/think-migration-mandate.md` (all agents read this)
3. **AUDIT:** `~/.claude/skills/think-agent-docs/think-docs/bella-think-migration-audit.md`
4. **OPPORTUNITIES:** `BRAIN_DOCS/doc-think-opportunities-audit-t9-20260426.md`
5. **ROI BLUEPRINT:** `BRAIN_DOCS/doc-bella-roi-quote-agent-blueprint-20260426.md`

---

## ACTIVE BLOCKER — W1 (EMPTY SSE)

**Root cause CONFIRMED:** Relay wired to wrong hook.

- `onChunk` (line 178) fires for raw chunk objects where `text-start` has `textDelta=null`
- `onEvent` callback (line 455) receives actual text as `{"type":"text-delta","delta":"Hey there!..."}`
- onEvent only logs — doesn't relay to SSE stream

**Fix spec (10 lines):**

```typescript
// bella-agent.ts line 455 — REPLACE diagnostic log with relay:
onEvent: (json: string) => {
  try {
    const evt = JSON.parse(json);
    if (evt.type === 'text-delta' && evt.delta && openAIStream && !openAIStream.isClosed) {
      openAIStream.send(evt.delta);
    }
  } catch {}
},
```

Also neuter onChunk during compat-turn (line 178-184):
```typescript
async onChunk(ctx: any) {
  if (this._compatTurnActive) return;
}
```

Version bump to 3.11.9-think. This is Sprint 0.

**Secondary model issue:** ConsultantAgent (consultant-agent.ts line 7-10) uses `createOpenAI` + Gemini OpenAI-compat URL → 404. Fix: switch to `createGoogleGenerativeAI` from `@ai-sdk/google` (already installed in package.json).

---

## EXISTING CODEBASE AUDIT

| Component | File | State |
|---|---|---|
| BellaAgent extends Think | bella-agent.ts (1013 lines) | All 5 hooks wired, 4 context blocks, /compat-turn SSE |
| ConsultantAgent extends Think | consultant-agent.ts | System prompt done, model broken (createOpenAI) |
| ROIAgent extends Agent | roi-agent.ts | V2 formulas via @callable, NOT Think sub-agent yet |
| WowAgent extends Agent | wow-agent.ts | Gemini line generator via @callable |
| DeepScrapeAgent extends Agent | deep-scrape-agent.ts | Apify orchestration |
| BellaPreCallResearch | precall-workflow.ts | WorkflowEntrypoint |
| chatRecovery | bella-agent.ts line 27 | = false (needs true) |
| compactAfter | configureSession | = 8000 (needs tuning to 50) |
| onChatRecovery | bella-agent.ts line 236 | Wired and functional |

---

## WHAT'S NOT BUILT (v2 plan gaps — ordered by sprint)

1. **W1 SSE relay fix** (Sprint 0 — 10 lines)
2. **chatRecovery = true, getSystemPrompt()** (Sprint 1 — Chunk 0 remainders)
3. **Missing context blocks** (live_roi, live_quote, critical_facts, compliance_rules, stage_policies) + R2SkillProvider (Sprint 1 — Chunk 1 gaps)
4. **KV → DO SQLite state migration** (Sprint 2 — Chunk 2)
5. **Conversation Intelligence Engine** — 3 modes, dual gates, per-beat delivery, freestyle guardrails, collection escalation (Sprint 3 — Chunk 3, BIGGEST)
6. **ROI → Think sub-agent** with 5 tools, own R2, own session (Sprint 4 — Chunk 4)
7. **Consultant tools** — analyzeWebsite, buildScriptFills, identifyQuoteInputs (Sprint 5 — Chunk 8)
8. **Intel event POST** + consultant-on-event, kill KV polling (Sprint 6 — Chunk 5)
9. **extractData/confirmData as tools** (Sprint 7 — Chunk 6)
10. **FTS5, branching** (Quote A/B + compliance recovery) (Sprint 8 — Chunk 7)
11. **ComplianceAgent sub-agent** (Sprint 9 — Chunk 9)
12. **Workspace tools** (Sprint 10 — Chunk 10)

---

## SPRINT ORDER

| Sprint | What | Gate |
|---|---|---|
| 0 | W1 relay fix (NOW) | Quick deploy + verify |
| 1 | Chunk 0 remainders + Chunk 1 gaps | CODEX_REVIEW |
| 2 | Chunk 2: KV → DO SQLite state migration | SPEC_STRESS_TEST |
| 3 | Chunk 3: Conversation Intelligence Engine | SPEC_STRESS_TEST |
| 4 | Chunk 4: ROI sub-agent (OVERENGINEERED) | SPEC_STRESS_TEST |
| 5 | Chunk 8: Consultant sub-agent tools | SPEC_STRESS_TEST |
| 6 | Chunk 5: Intel delivery + consultant-on-event | CODEX_REVIEW |
| 7 | Chunk 6: Extraction tools | CODEX_REVIEW |
| 8 | Chunk 7: Compaction + recovery + branching | CODEX_REVIEW |
| 9 | Chunk 9: Compliance sub-agent | CODEX_REVIEW |
| 10 | Chunk 10: Workspace tools | CODEX_REVIEW |

---

## KEY LAWS

- Port logic verbatim from frozen-bella-rescript-v2. Never invent replacements.
- ROI must be OVERENGINEERED (Trent's words). 5 tools, own R2, own session.
- Per-beat prompt delivery CRITICAL for Deepgram latency (~100-150 words per beat, not full script dump)
- Dual-gated advancement: SCRIPT_GATE (beats spoken) + DATA_GATE (fields collected). BOTH pass before advance.
- Bella-only focus. Chris/other agents deferred.
- ConsultantAgent model MUST use @ai-sdk/google, not createOpenAI.
- T1 Orchestrator removed — T2 is orchestrator + code lead.

---

## PENDING D1 FILINGS (MCP was disconnected)

File these to D1 (2001aba8-d651-41c0-9bd0-8d98866b057c) on reconnect:
- `doc-think-migration-build-plan-v2-20260426`
- `doc-think-opportunities-audit-t9-20260426`
- `doc-bella-roi-quote-machine-architecture-t9-20260426`
- `doc-handover-t9-think-migration-v2-20260426` (this doc)

---

## FULL AUDIT PROOF (46/46)

| Section | Items | Addressed |
|---|---|---|
| 1. Sub-Agents | 4 | 4/4 (Chris intentionally excluded) |
| 2. Session API | 6 | 6/6 |
| 3. Lifecycle Hooks | 5 | 5/5 |
| 4. Tool System | 5 | 5/5 (ExtensionManager deferred P3) |
| 5. Prompt Management | 3 | 3/3 |
| 6. State Persistence | 3 | 3/3 |
| 7. Compliance | 4 | 4/4 |
| 8. Intel Delivery | 3 | 3/3 |
| 9. Extraction | 3 | 3/3 |
| 10. Error Recovery | 1 | 1/1 |
| Trent's Additions | 9 | 9/9 |
| **TOTAL** | **46** | **46/46** |
