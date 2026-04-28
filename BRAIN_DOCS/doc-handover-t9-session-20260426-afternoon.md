# T9 ARCHITECT SESSION HANDOVER — 2026-04-26 Afternoon
**Doc ID:** doc-handover-t9-session-20260426-afternoon
**Date:** 2026-04-26 AEST
**From:** T9 Architect (Opus) — outgoing session
**To:** Next T9 Architect
**Session duration:** ~3 hours

---

## SESSION SUMMARY

This session produced 3 major architectural deliverables and 2 critical SDK findings that changed the Think Agent build plan. All driven by Trent's concern that Codex judges were stuck in old-code thinking and causing regressions.

---

## DECISIONS MADE (all Trent-approved)

### 1. ADR-001: Mandatory Think Reference Pack for Codex Judges
**Problem:** Codex CLI (GPT-based) has no training data on @cloudflare/think@0.4, agents@0.11, ai@6, zod@4. Judges flagged valid Think patterns as wrong → team reverted to old bridge code → regressions.

**Solution:** `canonical/think-reference-pack.md` — 12 chunked sections. Judges load §10 (Old→New map) + §11 (Anti-patterns) minimum on every Think review, plus scope-relevant sections.

**Enforcement:**
- T2 includes section references in every CODEX_REVIEW_REQUEST
- T3A/T3B must confirm `THINK_CONTEXT: loaded` in every verdict
- Codex lanes SKIPPED for SDK questions: Consultant, Architecture Interrogator, Hypothesis Challenge
- Codex lanes ACTIVE: PATCH_REVIEW, MERGE_GATE, VERIFICATION, REGRESSION_SCAN, LOOP_BREAKER
- T2 has full routing table mapping review scope → required sections

**Files:** 
- `canonical/think-reference-pack.md` (created + updated twice)
- `BRAIN_DOCS/adr-001-think-judge-context-pack-20260426.md` (local mirror)
- ADR filed to D1 as `adr-001-think-judge-context-pack-20260426` (confirmed written)

### 2. SDK Finding: provider.get() is One-Shot
**T3A claimed** provider.get() is cached at load. T9 initially flagged as likely wrong. **Source verification proved T3A correct.**

**Evidence chain (from node_modules source):**
- `Session.load()` (line 210): calls provider.get() once at init
- `Session.freezeSystemPrompt()` (line 484): returns persisted prompt on turns 2+
- `Session.refreshSnapshot()` (line 425): re-renders from blocks, does NOT re-call provider.get()
- `Session.refreshSystemPrompt()` (line 497): calls refreshSnapshot() + persists. Does NOT re-invoke providers.
- `Session.setBlock()` (line 297-301): only works on WRITABLE blocks. Provider blocks are READONLY.
- `Think._runInferenceLoop` (line 371): calls `session.freezeSystemPrompt()` every turn

**Impact:** Existing code's intel/script provider blocks are frozen after turn 1. Subtle bug in current codebase — dynamic content never refreshes.

**Resolution — Three-Tier Prompt Strategy (approved by Trent + T2):**

| Tier | What | Mechanism | Examples |
|---|---|---|---|
| 1. Static | Content never changes mid-call | Provider blocks in configureSession() | soul, compliance_rules, stage_policies |
| 2. LLM-writable | Model writes via set_context tool | Writable blocks with description + maxTokens | memory (prospect facts) |
| 3. Dynamic | Changes every turn programmatically | beforeTurn() returns { system: assembled } | intel, stage directive, ROI, critical facts |

### 3. SDK Finding: chatRecovery Continuation Behavior
**T3A found** (with Codex CLI reading think.js source): chatRecovery recovery does NOT resume mid-stream. It calls onChatRecovery() → _chatRecoveryContinue() → continueLastTurn() → fresh _runInferenceLoop(continuation: true). beforeTurn() re-fires on recovered turn.

**Resolution:** Ship chatRecovery=true in Sprint 1 WITH one-line idempotency guard:
```typescript
beforeTurn(ctx: TurnContext): TurnConfig | void {
  if (ctx.continuation) return; // skip extraction + flow on recovery turn
  // ... normal processing
}
```

### 4. Process Fix: SDK Claims Auto-Route to T9
**Problem:** T3A made an SDK behavioral claim. T2 didn't auto-route to T9. Trent had to manually tell T2 to send it.

**Fix:** New mandatory rule — any Codex verdict containing SDK behavioral claims → T5 verifies .d.ts → T9 reviews architectural impact. Trigger words: "cached", "not called", "only fires once", "doesn't support", "SDK limitation", "API doesn't allow".

**Format:** T2 → T9: SDK_CLAIM_REVIEW with claim + T5 evidence + spec impact.

### 5. Think Post-MVP Hardening Opportunities
Four opportunities captured from Cloudflare Agents Week GA features mapped against Bella:

| # | Opportunity | Impact | When |
|---|---|---|---|
| 1 | Tree-structured sessions for Quote A/B branching | HIGH | Chunk 7 |
| 2 | Dynamic Workers for industry-specific ROI formulas | HIGH | Post Chunk 4 |
| 3 | Self-authored extensions (prospect-specific tools mid-call) | VERY HIGH | Post-launch |
| 4 | Stream resumption for native WebSocket | MEDIUM | Post-launch |

---

## CURRENT SPRINT STATE

- **Sprint 0** (W1 SSE relay fix): In-flight when session started. T2 sent spec to T4.
- **Sprint 1** (Chunk 0 remainders + Chunk 1): Spec v3 approved by T9. Going to T3A gate. Key changes from v1/v2:
  - chatRecovery=true with continuation guard
  - Static blocks only in configureSession() (soul, compliance_rules, stage_policies, memory)
  - Dynamic content moved to beforeTurn() system override
  - intel + script REMOVED from configureSession() (broken frozen blocks)
  - Existing refreshSystemPrompt() calls in triggerDeepScrape/receiveIntel are now no-ops for removed blocks — left as-is, cleanup in future sprint

---

## TEAM STATE

- **T1:** REMOVED this session. T2 absorbs orchestrator.
- **T2 (s2vmwn9x):** Orchestrator + Code Lead. Has full routing table for Think reviews. Acknowledged SDK auto-route rule.
- **T3A (pr25kham):** Online. Has Think Reference Pack pre-read mandate. Corrected §4+§5 → §2+§3 routing.
- **T4 (toi88f5m):** Online. Executing Sprint 0.
- **T5:** Dispatched to verify provider.get() refresh timing (completed — T3A confirmed correct).
- **T9 (this session):** Handing over.

---

## FILES CREATED THIS SESSION

| File | Status | Purpose |
|---|---|---|
| `canonical/think-reference-pack.md` | CREATED + UPDATED 2x | Judge pre-read for Think reviews. 12 sections. §3 and §10 updated with three-tier strategy. |
| `BRAIN_DOCS/adr-001-think-judge-context-pack-20260426.md` | CREATED | Local mirror of ADR-001 |
| `BRAIN_DOCS/doc-think-post-mvp-hardening-opportunities-20260426.md` | CREATED | 4 post-MVP opportunities with full context |
| `memory/feedback_sdk_claims_autoroute_t9.md` | CREATED | Process fix: SDK claims → T9 auto-route |
| `memory/feedback_t1_removed_t2_orchestrates.md` | CREATED (by T2) | T1 removal acknowledged |

---

## DOCS REQUIRING IMMEDIATE D1 FILING (MCP was disconnected)

File these to D1 (`2001aba8-d651-41c0-9bd0-8d98866b057c`) on reconnect:

1. **`doc-think-post-mvp-hardening-opportunities-20260426`**
   - title: "Think Post-MVP Hardening — Dynamic Workers, Tree Sessions, Extensions, Stream Resumption"
   - doc_type: "architecture"
   - authored_by: "t9-architect"
   - project_id: "bella-think-v1"
   - content: full file from BRAIN_DOCS/

2. **`doc-handover-t9-session-20260426-afternoon`** (this doc)
   - title: "T9 Architect Session Handover — 2026-04-26 Afternoon"
   - doc_type: "handover"
   - authored_by: "t9-architect"
   - project_id: "bella-think-v1"
   - content: full file from BRAIN_DOCS/

3. **VERIFY** `adr-001-think-judge-context-pack-20260426` exists in D1 (was filed earlier this session before MCP disconnected — confirmed success at time of write)

4. **From prior T9 session (listed in earlier handover, may still be pending):**
   - `doc-think-migration-build-plan-v2-20260426`
   - `doc-think-opportunities-audit-t9-20260426`
   - `doc-bella-roi-quote-machine-architecture-t9-20260426`
   - `doc-handover-t9-think-migration-v2-20260426`

---

## ARCHITECTURAL CONTEXT FOR NEXT SESSION

### Build plan still canonical
`BRAIN_DOCS/doc-think-migration-build-plan-v2-20260426.md` — 11 chunks, dependency-ordered. Sprint 1 spec adjusted (v3) per this session's findings. Later chunk specs (especially 3, 4, 5) will need similar adjustment for three-tier prompt strategy.

### Key laws established this session
- Provider.get() is one-shot — never use for dynamic content
- beforeTurn() system override is THE pattern for per-turn dynamic prompts
- Codex can't judge SDK behavior — route to T5 .d.ts reads
- T2 auto-routes SDK claims to T9 — no Trent intervention needed
- Compiler (tsc --noEmit = 0) and runtime proof outrank Codex on SDK questions

### Think Reference Pack is living doc
`canonical/think-reference-pack.md` must be updated when:
- New SDK patterns discovered via T5 .d.ts reads
- New anti-patterns found during implementation
- Build plan chunk specs change prompt strategy
- SDK version bumps change behavior

### Working codebase
`/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
- Version: 3.8.0-think (package.json) — note: handover from prior session said 3.11.8-think, may have been bumped
- SDK: @cloudflare/think@0.4.0, agents@0.11.5, ai@6.0.0, zod@4.0.0
- 6 agent classes, 1013-line BellaAgent, 17 test files

---

## WHAT WENT WELL

1. ADR-001 system worked — caught SDK mis-claim before it shipped as broken architecture
2. Process gap (SDK auto-route) identified and fixed same session
3. Source verification from node_modules replaced Codex guessing — exactly what ADR-001 prescribes
4. T2 self-corrected routing (§4+§5 → §2+§3) after receiving routing table
5. Three-tier prompt strategy is architecturally cleaner than original build plan

## WHAT TO WATCH

1. Sprint 1 S1-v3 spec at T3A gate — first real test of Think Reference Pack enforcement
2. Later chunk specs need three-tier adjustment — T9 should review when T2 specs Chunks 3, 4, 5
3. D1 MCP reconnection — 6+ docs need filing
4. think-reference-pack.md accuracy — update as T5 discovers more SDK behavior
