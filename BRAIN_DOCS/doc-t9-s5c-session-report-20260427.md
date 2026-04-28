# T9 Architect Session Report — S5-C Spec Build
**Date:** 2026-04-27 AEST | **Author:** T9 (Opus) | **Sprint:** S5-C
**Spec produced:** `BRAIN_DOCS/spec-s5c-multipass-error-gates-20260427.md`
**Status:** SPEC COMPLETE — ready for T2 → T3A gate pipeline

---

## WHAT WAS DONE

### 1. Full SDK Source Audit (before speccing)
Read every relevant Think SDK doc:
- `think.d.ts` lines 360-410 (configure/getConfig), 520-600 (onChatError, TurnConfig)
- `sub-agents.md` — chat() RPC, saveMessages, waitUntilStable, chatRecovery
- `lifecycle-hooks.md` — beforeTurn, beforeToolCall, onStepFinish, onChatError execution order
- `sessions.md` — context blocks, provider types, R2SkillProvider, AgentSearchProvider, addContext/removeContext
- `tools.md` — tool merge order, workspace tools, browser tools, extensions

### 2. Full Source Audit
Read live code at `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/src/`:
- `consultant-agent.ts` (523 lines) — full read, annotated all hook locations
- `bella-agent.ts` (1150 lines) — full read of runConsultantAnalysis, receiveIntel, beforeTurn extraction, mapConsultantStateToIntel
- `types.ts` (348 lines) — confirmed ConsultantState v2 fields sufficient
- `worker.ts` — confirmed VERSION = 3.11.28-think (S5-B base)

### 3. Blueprint + Prior Art Review
- `doc-bella-consultant-agent-v2-blueprint-20260427.md` (1422 lines) — canonical blueprint, S5-C scope extracted
- `spec-s5b-findings-context-20260427.md` — confirmed S5-B baseline
- `doc-handover-t2-s5a-sprint-close-20260427.md` — S5-A bugs to avoid repeating

### 4. Architecture Intervention (Trent directive mid-session)
Trent intervened to reshape approach:
- **Before:** S5-C was "add enrichment methods + onChatError" — mechanical
- **After:** S5-C became architecture-aware: R2 prompt migration, forced tool sequences, message-level protocol

Taxonomy established: HARDCODE = gates/types/plumbing. FILE-REFERENCED = prompts/methodology/knowledge.

### 5. Spec Written
11 changes across 4 files + R2 upload. Full before/after code for every change. 16 acceptance criteria, 5 scope-fence criteria.

---

## BUGS / GOTCHAS IDENTIFIED (T2/T3A must know these)

### BUG 1: onChatError is SYNC, not async
**Source:** think.d.ts line 540 — `onChatError(error: unknown): unknown`
**Gotcha:** No `async`. No `await` inside. setState is sync on DO so that works, but never put async ops (fetch, R2 read) in onChatError. The spec's setState call is safe. Anything else = runtime error.

### BUG 2: Partial message already persisted before onChatError fires
**Source:** lifecycle-hooks.md § onChatError
**Impact:** If consultant errors mid-tool-sequence, the partial assistant message (including any tool calls that completed) is already in conversation history. Next chat() call sees that history. This is GOOD for us — it means gap assessment on enrichment sees what was attempted before the error.
**Gotcha for T3A:** Don't try to "undo" the partial message. It's persisted. Design around it.

### BUG 3: Instance fields reset on DO eviction
**Fields:** `_enrichmentGapForced`, `_completionForced` (CHANGE 3)
**Impact:** If DO is evicted between turns (rare but possible on cold start), gate flags reset to false. This means gap assessment could fire twice on same enrichment pass.
**Mitigation:** Acceptable — double gap assessment is harmless (idempotent tool, just reads state). Moving to persistent state is over-engineering for this edge case.
**If T3A flags this:** CONDITIONAL_PASS, not FAIL. Explain the idempotency argument.

### BUG 4: ctx.messages format in beforeTurn
**Gotcha:** `ctx.messages` may have content as string OR as parts array `[{type: "text", text: "..."}]`. Spec handles both:
```typescript
const msgText = typeof lastUserMsg?.content === "string"
  ? lastUserMsg.content
  : (lastUserMsg?.content?.[0]?.text ?? "");
```
**T3A:** Verify this dual extraction matches Think SDK message format. Check `think.d.ts` for Message type.

### BUG 5: toolChoice forces ONE tool call, not a sequence
**Source:** TurnConfig.toolChoice in think.d.ts
**Gotcha:** `toolChoice: { type: "tool", toolName: "assessAnalysisGaps" }` forces the model to call that tool, but only ONE call per turn. Combined with `maxSteps: 2`, the model gets: step 1 = forced tool call, step 2 = one react step. Then turn ends. onChatResponse chains the continuation.
**Do not set maxSteps=1** — model needs the react step to process tool output.

### BUG 6: subAgent returns SAME instance (not a new one)
**Source:** sub-agents.md § Sub-Agent Pattern
**Critical understanding:** `this.subAgent(ConsultantAgent, "consultant")` always returns the same DO instance (name-based). So enrichConsultantAnalysis's chat() call ADDS to the existing conversation, doesn't start fresh. This is the entire multi-pass paradigm.
**Gotcha:** If someone changes the name string ("consultant"), they break multi-pass. Name is identity.

### BUG 7: S5-A bugs to NOT repeat (from S5-A handover)
- `inputSchema` not `parameters` in tool() calls
- `generateScriptFills` not `fillScriptFields` (tool name)
- `hooks` excluded from upgradeAnalysis tier enum (ConversationHook[] — array, spread unsafe)
- tier4 must be gated behind tier2Done (unconditional = gate bypass)
- confidence condition must be `=== "low"` not `!== "high"` (infinite loop)

### BUG 8: Error propagation across DO RPC boundary
**Mechanism:** consultant's onChatError returns `new Error(JSON.stringify({...}))`. This propagates across the DO RPC boundary to parent's chat() call. When parent omits onError callback, chat() throws. Parent's try/catch catches it. JSON.parse(err.message) extracts structured data.
**Gotcha:** If someone adds an onError callback to chat(), errors go there instead of throwing. The spec deliberately removes onError from runConsultantAnalysis for this reason.

---

## ARCHITECTURAL DECISIONS

### ADR-1: Message-level protocol for pass detection
**Decision:** Parent sends `[ENRICHMENT_PASS:source]` / `[PROSPECT_UPDATE:type]` prefixes. Consultant's beforeTurn detects via string prefix match.
**Why not @callable:** @callable is S5-D scope. Can't use it yet.
**Why not configure():** configure() is also S5-D. And it's per-instance config, not per-turn signaling.
**Why message prefix:** Parent controls message format. No ambiguity. Model sees it in conversation history (good for context). beforeTurn has access to ctx.messages. Clean separation.
**S5-D migration path:** When @callable lands, enrichConsultantAnalysis can become a @callable method that still uses the same chat() protocol internally. No breaking change.

### ADR-2: R2 prompt with hardcoded fallback
**Decision:** System prompt reads from R2 `consultant-prompts/system.md`. Falls back to `CONSULTANT_PROMPT_FALLBACK` const.
**Why R2:** Prompt tuning without redeploy. Methodology changes = R2 upload, not code change. withCachedPrompt() means R2 hit once per session, SQLite cached.
**Why fallback:** R2 outage shouldn't crash analysis. Fallback is the current working prompt. Only diverges when R2 is intentionally updated.
**Gotcha:** Fallback and R2 content can drift. Add R2 content hash logging if this becomes a problem (post-S5-F).

### ADR-3: Forced gates via toolChoice + maxSteps
**Decision:** beforeTurn returns `{ toolChoice: { type: "tool", toolName: X }, maxSteps: N }` for forced sequences.
**Why not saveMessages:** saveMessages is a "suggestion" — model can ignore it and do something else. toolChoice is a FORCE — model MUST call that tool.
**Why maxSteps:** Without maxSteps, model runs unlimited steps after forced tool. maxSteps=2 gives: forced tool + one react step. Then turn ends, onChatResponse chains next phase.
**Key insight:** toolChoice + maxSteps + onChatResponse = deterministic forced sequences without losing model agency between steps.

### ADR-4: Parallel enrichment + WOW prep
**Decision:** `receiveIntel("deep_ready")` fires both runWowPrep and enrichConsultantAnalysis via ctx.waitUntil in parallel.
**Why parallel:** They're independent. WOW prep uses current intel. Enrichment upgrades consultant. When enrichment completes, it fires runWowPrep again to update WOW lines with richer data.
**Risk:** Two concurrent runWowPrep calls if enrichment completes fast. Acceptable — WOW prep is idempotent (overwrites wowLines).

### ADR-5: High-value field filter for extraction → consultant
**Decision:** Only acv, missed_calls, after_hours, old_leads, phone_volume trigger consultant updates.
**Why filter:** Every extraction triggering consultant update = noise. Most extracted fields (timeframe, review system) don't change routing or analysis. High-value fields directly affect agent recommendations and ROI.
**Why gate on state.intel.consultant:** Prevents firing before initial analysis. If consultant hasn't run yet, extraction data is already available in the initial analysis payload.

---

## WHAT'S REVISED FROM BLUEPRINT

| Blueprint said | Spec does | Why |
|---|---|---|
| "enrichConsultantAnalysis calls chat() with enrichment data" | Same + forced gap assessment via toolChoice | Trent directive: gated not philosophical |
| "onChatError returns modified error" | Same + structured JSON with phase/tier/retryable | More useful for parent parsing |
| System prompt in hardcoded const | R2 with fallback | Trent directive: minimize hardcoding |
| "Update consultant on prospect data" | Same + high-value field filter + message protocol | Prevent noise updates |
| Generic error handling | Salvage pattern — always try to read partial analysis | Prevents data loss on error |

---

## SCOPE FENCE (what S5-C does NOT touch)

- **types.ts** — no changes (existing ConsultantState v2 fields sufficient)
- **@callable** — S5-D scope
- **configure()/getConfig()** — S5-D scope
- **session.addContext()** — S5-D scope
- **Session branching** — S5-F scope
- **Tool schemas** — no changes to any Zod schemas
- **branchAndCompareRouting (tool 15)** — S5-F scope

---

## SPRINT DEPENDENCY CHAIN (current state)

```
S5-A ✅ State + Tools 11-14 + Defensive Hooks (v3.11.27-think)
S5-B ✅ AgentSearchProvider + Findings Context (v3.11.28-think)  
S5-C SPEC READY: Multi-pass + Error + Forced Gates + R2 Prompt (→ v3.11.29-think)
S5-D UNSPECCED: @callable injection + configure() + session.addContext()
S5-E UNSPECCED: Public getters + waitUntilStable exposure
S5-F UNSPECCED: Session branching + branchAndCompareRouting (tool 15)
```

---

## D1 STATUS

CF MCP disconnected this session. Spec and report filed locally to BRAIN_DOCS/. T2 or T5 to upsert both to D1 when MCP reconnects:
- `spec-s5c-multipass-error-gates-20260427` → spec doc
- `doc-t9-s5c-session-report-20260427` → this report

---

## FILES PRODUCED THIS SESSION

| File | Type | Location |
|---|---|---|
| S5-C Spec | Spec | `BRAIN_DOCS/spec-s5c-multipass-error-gates-20260427.md` |
| S5-C Session Report | Report | `BRAIN_DOCS/doc-t9-s5c-session-report-20260427.md` |
