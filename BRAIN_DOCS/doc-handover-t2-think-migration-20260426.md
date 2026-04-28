# T2 CODE LEAD HANDOVER — BELLA THINK MIGRATION v2
**Doc ID:** doc-handover-t2-think-migration-20260426
**Date:** 2026-04-26 AEST
**Outgoing T2:** Sonnet (session compacted mid-sprint)
**Status:** Sprint 0 + Sprint 1 CLOSED. Sprint 2 scoped, NOT started.

---

## IMMEDIATE ACTIONS FOR INCOMING T2

1. Read this doc fully
2. Read `canonical/think-reference-pack.md` (updated this session — §3, §10, §11, §12)
3. Read `canonical/think-migration-mandate.md`
4. Call `list_peers` — get current team IDs
5. Send STATUS: online to T3A, T3B, T4, T4B, T5
6. Start Sprint 2 — spec is ready below. Assign T4 + T4B in parallel (T4=impl, T4B=reads)

---

## SPRINT STATUS

| Sprint | What | Status |
|--------|------|--------|
| S0 | W1 SSE relay fix + ConsultantAgent model | CLOSED — deployed 3.11.9-think |
| S1 | chatRecovery + context blocks + beforeTurn() | CLOSED — deployed 3.11.10-think |
| S2 | KV → DO SQLite cleanup | READY TO START — spec below |
| S3 | Conversation Intelligence Engine | PENDING S2 |
| S4-S10 | See T9 handover + build plan | PENDING |

**Deployed version:** 3.11.10-think
**Git commit:** 2f772e3

---

## SPRINT 2 SPEC — KV COMPAT CLEANUP

### Context (CRITICAL — read before speccing)

ConversationState is **ALREADY in DO SQLite**. State migration is complete:
- `this.cs` getter at `bella-agent.ts:46`: `return (this.state as ConversationState) ?? null`
- `this.setState(state)` at `bella-agent.ts:242` — Think built-in persistence, wired and working
- `this.state` = Think's DO SQLite property — persists across evictions automatically

The build plan (Chunk 2) described a migration that is already done. Sprint 2 is CLEANUP only.

### What Actually Needs To Happen

**2-A: Remove dead `do_compat_state` KV write**

`bella-agent.ts` lines 227-235:
```typescript
// BEFORE (lines 227-235):
if (state.leadId && state.leadId !== "unknown") {
  state.kvExportVersion++;
  this.ctx.waitUntil(
    this.env.LEADS_KV.put(
      `lead:${state.leadId}:do_compat_state`,
      JSON.stringify(state),
    ).catch((err: any) => console.error(`[COMPAT_EXPORT_ERR] ${err.message}`)),
  );
}

// AFTER (delete entirely — zero readers confirmed by T5 grep)
```

**2-B: Remove `kvExportVersion` from ConversationState**

`src/types.ts` — remove `kvExportVersion: number` from ConversationState interface.
`bella-agent.ts:972` — remove `kvExportVersion: 0` from `initState()` return object.

**2-C: Version bump**

`worker.ts` health response: `"3.11.10-think"` → `"3.11.11-think"`

### KV reads that STAY (do not touch)

| Location | Key pattern | Reason |
|----------|-------------|--------|
| `worker.ts:32` | `lead:${lid}:fast-intel` | External pipeline read — stay |
| `bella-agent.ts:508` | `brief:${leadId}` | Precall-workflow write — stay |

### Source of truth for Sprint 2 scope

T5 grep confirmed: `do_compat_state` has ONE write (bella-agent.ts:231) and ZERO reads anywhere in codebase. Safe to delete.
`src/index.ts` has ~25 KV calls but is NOT imported by any live file — dead code, out of scope.

### Gate routing

- T4 implements → REVIEW_REQUEST to T2
- T2 6-gate → CODEX_REVIEW_REQUEST to T3A (implementation gate)
- T3A PASS → T4 deploys → T3B regression gate
- T3B PASS → SPRINT_COMPLETE

---

## KEY TECHNICAL FACTS (learned this session)

### Think SDK — VERIFIED FROM SOURCE

All facts verified against `node_modules/@cloudflare/think/dist/think.d.ts` + `think.js`.

| Fact | Source | Verified |
|------|--------|---------|
| `beforeTurn()` returning `{ system: string }` overrides frozen session prompt | think.js:389 `const finalSystem = config.system ?? system;` | ✅ T3B |
| `ctx.continuation: boolean` typed on TurnContext | think.d.ts:100 | ✅ T3B |
| `ctx.continuation = false` on normal turns | think.js:710 | ✅ T3B |
| `ctx.continuation = true` on recovery turns | think.js:1515 | ✅ T3B |
| `provider.get()` one-shot at session init — result frozen | think.js verified | ✅ T9 |
| `this.sql` bound to `this.ctx.storage.sql` | think.js:49,56 | ✅ T5 |
| `this.state` / `this.setState()` = Think's DO SQLite persistence | think.d.ts:365 | ✅ T4B |
| `chatRecovery = true` → onChatRecovery fires on DO eviction | think.js verified | ✅ T9 |

### Think SDK — ANTI-PATTERNS (DO NOT DO)

- **provider.get() for dynamic content** — frozen at init. Use `beforeTurn()` system override instead.
- **getSystemPrompt() when context blocks configured** — Think skips getSystemPrompt() when any context block exists. Never mix.
- **compactAfter without onCompaction** — no-op. Deferred to Chunk 7.
- **SDK FAIL without .d.ts source** — prohibited. See SDK FAIL LAW below.

### Three-Tier Prompt Strategy (T9 — ADR-001)

1. **Static** → `provider.get()` context blocks (soul, compliance_rules, stage_policies)
2. **LLM-writable** → `writable` context blocks (memory)
3. **Dynamic** → `beforeTurn()` system override (intel, ROI results, stage directive)

### beforeTurn() Guard Pattern (MANDATORY)

```typescript
async beforeTurn(ctx: any) {
  if (!ctx.continuation) {
    // Side effects only here: extraction, flow, watchdog, state writes
  }
  // System assembly ALWAYS runs (even on recovery turns):
  const dynamicSystem = [ctx.system, ...dynamicParts].filter(Boolean).join('\n\n');
  return { system: dynamicSystem };
}
```

Never early-return before system assembly — recovery turns still need dynamic system.

---

## PROCESS LAWS (new this session)

### SDK FAIL LAW — MANDATORY

T3A and T3B must NEVER issue FAIL on an SDK behavioral claim without `.d.ts` proof from `node_modules`.

**Protocol:**
1. Before any verdict containing SDK behavioral claim → grep actual `.d.ts`/`.js` from `node_modules`
2. Source found → cite file:line in verdict
3. Source NOT found → verdict says `SDK-UNVERIFIABLE — route T5 + T9, NOT a FAIL`
4. Codex has no `@cloudflare/think` training data. All Think SDK claims are UNVERIFIABLE unless sourced.

**Why this law exists:** T3B Sprint 1 FAIL had 2/3 items that were hallucinated SDK limitations. Both were valid patterns verified from think.d.ts. Session lost 2 gate cycles.

**Saved in memory:** `feedback_no_sdk_fail_without_source.md` + MEMORY.md indexed.

### Codex CLI Proof — MANDATORY

Every verdict must include raw `which codex && codex --version` output. Token counts are NOT proof. No raw CLI output = verdict rejected immediately.

### T1 Removed — T2 is Orchestrator

T1 removed 2026-04-26. T2 manages team directly:
- Sprint sequencing
- Agent tasking
- DEPLOY_AUTH after T3 PASS (no relay needed)
- Complex arch questions → T9

### Gate Routing (unchanged)

- **Spec gate:** T3A (SPEC_STRESS_TEST for Chunks 2-4, CODEX_REVIEW for others)
- **Implementation gate:** T3A
- **Regression gate:** T3B (post-deploy quality check)
- **T2 has NO gate authority** — never PASS or FAIL

---

## CODEBASE STATE

**Worker:** `bella-think-agent-v1-brain`
**Working dir:** `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
**Deployed:** `https://bella-think-agent-v1-brain.trentbelasco.workers.dev`
**Version:** 3.11.10-think (health endpoint confirms)

**Key bindings (wrangler.toml):**
- `CALL_BRAIN → BellaAgent` (DurableObjectNamespace)
- `LEADS_KV → 0fec6982d8644118aba1830afd4a58cb`
- `new_sqlite_classes: ["BellaAgent", "ConsultantAgent", "DeepScrapeAgent", "ROIAgent"]` (v1 migration)
- `new_sqlite_classes: ["WowAgent"]` (v2 migration)

**Key files:**
| File | Lines | State |
|------|-------|-------|
| `src/bella-agent.ts` | ~990 | All hooks wired, S0+S1 shipped |
| `src/consultant-agent.ts` | 119 | @ai-sdk/google fixed S0 |
| `src/worker.ts` | 47 | /v9/chat/completions + /health |
| `src/types.ts` | ~250 | ConversationState (40 fields) |
| `src/state.ts` | ~510 | Has KV puts for captured_inputs/roi — review for S2 |
| `src/index.ts` | ~2000 | DEAD CODE — not imported anywhere. Out of scope. |

**State pattern:**
```typescript
// getter
private get cs(): ConversationState | null {
  return (this.state as ConversationState) ?? null;  // this.state = Think DO SQLite
}
// setter (at end of each turn)
this.setState(state);
```

---

## CANONICAL DOCS

| Doc | Location | Purpose |
|-----|----------|---------|
| Build plan v2 (11 chunks) | `BRAIN_DOCS/doc-think-migration-build-plan-20260426.md` | Sprint source of truth |
| T9 handover | `BRAIN_DOCS/doc-handover-t9-think-migration-v2-20260426.md` | Arch decisions + 46/46 audit |
| Think reference pack | `canonical/think-reference-pack.md` | SDK anti-patterns, three-tier strategy, SDK-UNVERIFIABLE rule |
| Migration mandate | `canonical/think-migration-mandate.md` | All-agents read |
| ROI+Quote blueprint | `BRAIN_DOCS/doc-bella-roi-quote-agent-blueprint-20260426.md` | Chris build reference |

---

## TEAM ROSTER (peer IDs from this session — MAY CHANGE next session)

| ID | Role |
|----|------|
| pr25kham | T3A Code Judge |
| jol43yws | T3B Regression Judge |
| toi88f5m | T4 Minion A |
| 58bb1y4m | T4B Minion B |
| zcamus9y | T5 Haiku |
| wau1gf2x | T9 Architect (Opus) |

**Note:** Peer IDs reset each session. Call `list_peers` on startup.

---

## PENDING D1 FILINGS

These docs exist locally but D1 filing status unknown — verify and file if missing:
- `doc-think-migration-build-plan-v2-20260426`
- `doc-handover-t9-think-migration-v2-20260426`
- `doc-handover-t2-think-migration-20260426` (this doc)
- D1: 2001aba8-d651-41c0-9bd0-8d98866b057c

---

## SPRINT 3 PREVIEW (Conversation Intelligence Engine)

Sprint 3 is the BIGGEST chunk. Do NOT start until Sprint 2 is fully gated and deployed.

Ref: `BRAIN_DOCS/doc-think-migration-build-plan-20260426.md` Chunk 3.

Key components:
- 3 conversation modes: SCRIPTED / FREESTYLE / COLLECTION
- Dual-gated stage advancement: SCRIPT_GATE (beats spoken) + DATA_GATE (fields collected)
- Per-beat delivery: ~100-150 words per beat, not full script dump
- Freestyle guardrails: Gemini can improvise but cannot advance stage
- Gate: SPEC_STRESS_TEST (Codex stress-tests before any implementation)

T9 must pre-approve Sprint 3 spec before T3A gate. Schedule T9 brief before spec is written.
