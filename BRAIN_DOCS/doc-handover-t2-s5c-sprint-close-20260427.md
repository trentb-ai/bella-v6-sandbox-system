# Handover | T2 → T2
## Sprint S5-C Close | 2026-04-27 AEST

---

## SPRINT CLOSED: S5-C ✅

**Version deployed:** `3.11.29-think`
**Worker:** `bella-think-agent-v1-brain`
**Commit:** `e344148` (branch: `feat/prompt-enhancements-20260425`)
**T3A verdict:** PASS (slim gate, T9 pre-approved)
**T3B verdict:** PASS (awaiting confirmation — write on T3B PASS)
**Deploy health:** ✅ Worker online, all agents loaded, /health confirmed

---

## WHAT WAS BUILT — S5-C

### The pivot: HARDCODE vs FILE-REFERENCED (LAW for all future agents)

**HARDCODE** (compilation required — gates, types, plumbing):
- Zod schemas on tools
- Tool `execute()` implementations
- Lifecycle hooks (`beforeToolCall`, `onStepFinish`, `onChatError`)
- Forced tool sequences (`beforeTurn toolChoice + maxSteps`)
- Binding refs (R2, KV, D1)
- Type definitions

**FILE-REFERENCED** (no-redeploy editable):
- System prompt / methodology → R2 `consultant-prompts/system.md` ← NEW S5-C
- Enrichment sequence → R2 `consultant-prompts/enrichment.md` (S5-D)
- Industry KB → R2 `consultant-kb/industries/*.md` (S5-A)
- Agent briefs → R2 `consultant-kb/agent-briefs/*.md` (S5-A)
- Per-client config → DO SQLite via `configure()` (S5-D)
- Scratchpad → session SQLite WritableContextProvider (S5-B)

### 11 changes across 4 files + R2 upload

**consultant-agent.ts** (523 → 637 lines):
- `CONSULTANT_SYSTEM_PROMPT` → `CONSULTANT_PROMPT_FALLBACK` (rename)
- `withContext("task")` now reads R2 `consultant-prompts/system.md`, falls back to const
- Private fields: `_enrichmentGapForced`, `_completionForced` (instance, resets on DO eviction — idempotent)
- `beforeTurn()` replaced: detects `[ENRICHMENT_PASS:]` / `[PROSPECT_UPDATE:]` message prefixes, FORCES `assessAnalysisGaps` via `toolChoice` on enrichment pass, FORCES `setAnalysisConfidence` via `toolChoice` when all tiers complete
- `onChatResponse()` replaced: Chain 1 now gated with `&& !this._enrichmentGapForced` (P1 fix), Chain 2 handles post-gap continuation
- `onChatError()` added: SYNC (no async), structured JSON return with phase/tier/retryable
- `_getHighestCompletedTier()` + `_isRetryable()` private helpers added

**bella-agent.ts** (1150 → 1235 lines):
- `mergeConsultantResult()` private helper (eliminates inline merge duplication)
- `_handleConsultantError()` private helper with salvage pattern (reads partial state via subAgent)
- `runConsultantAnalysis()` refactored: try/catch replaces onError callback
- `enrichConsultantAnalysis()` added: `[ENRICHMENT_PASS:deep_intel]` prefix triggers forced gap assessment
- `updateConsultantFromProspect()` added: `[PROSPECT_UPDATE:{type}]` for high-value extraction fields
- `receiveIntel("deep_ready")`: now fires BOTH `runWowPrep()` AND `enrichConsultantAnalysis()` in parallel via `ctx.waitUntil`
- Extraction: high-value fields (`acv`, `missed_calls`, `after_hours`, `old_leads`, `phone_volume`) trigger `updateConsultantFromProspect()` when `state.intel.consultant` exists (gate prevents pre-analysis fires)

**R2:** `consultant-prompts/system.md` uploaded to `bella-agent-kb` bucket

---

## BUGS FOUND + FIXED

| Bug | Fix |
|-----|-----|
| Chain 2 shadowed by Chain 1 in `onChatResponse` (P1) | Added `&& !this._enrichmentGapForced` to Chain 1 |
| `type: "tool"` inferred as `string` by TypeScript | `{ type: "tool" as const }` on both toolChoice objects |
| VERSION in worker.ts is object property, not const | Fixed in TASK_REQUEST to T4 |

---

## GOTCHAS — CARRY FORWARD TO S5-D

1. **`onChatError` is SYNC** — no `async`, no `await`. `setState()` safe. R2/fetch NOT safe inside it.
2. **Partial message persisted BEFORE `onChatError` fires** — design around it, don't undo it.
3. **`_enrichmentGapForced`/`_completionForced` reset on DO eviction** — idempotent, CONDITIONAL not FAIL.
4. **`toolChoice` forces ONE call** — `maxSteps=2` = forced tool + one react step. Never `maxSteps=1`.
5. **`subAgent("consultant")` = SAME DO always** — name is identity. Don't change the name string.
6. **`ChatOptions` has NO `onError` field** — confirmed from think.d.ts. Errors throw to try/catch.
7. **`ctx.messages` content = string OR parts array** — both handled in beforeTurn message extraction.
8. **`streamText toolChoice` type** — use `{ type: "tool" as const, toolName: "..." }` form always.

---

## MULTI-PASS FLOW (critical for S5-D understanding)

```
Initial analysis:
  runConsultantAnalysis(fastIntel)
    → child.chat("Analyze this business...")
    → consultant runs tiers 1→2→3 via beforeTurn + onChatResponse chains
    → mergeConsultantResult() → refreshSystemPrompt() → runWowPrep()

Deep intel enrichment (receiveIntel "deep_ready"):
  ctx.waitUntil(runWowPrep())                        // parallel
  ctx.waitUntil(enrichConsultantAnalysis(deepIntel)) // parallel
    → child.chat("[ENRICHMENT_PASS:deep_intel] ...")
    → beforeTurn detects prefix → FORCES assessAnalysisGaps (toolChoice)
    → onChatResponse Chain 2 continues with upgradeAnalysis path
    → mergeConsultantResult() → refreshSystemPrompt() → runWowPrep() (again)

Prospect verbal update (extraction high-value field):
  ctx.waitUntil(updateConsultantFromProspect("extraction", dataDesc))
    → child.chat("[PROSPECT_UPDATE:extraction] ...")
    → beforeTurn detects prefix → FORCES assessAnalysisGaps
    → non-critical: existing analysis valid even if this fails
```

---

## THIS SESSION — ADDITIONAL WORK DONE

### ADR-002: SDK Verification Gate (Trent confirmed, active S5-D onward)
- **IR-1:** T5 reads think.d.ts BEFORE T9 writes any spec
- **IR-2:** SDK_EVIDENCE_PACK required field in every CODEX_REVIEW_REQUEST
- **IR-3:** T3A auto-rejects if pack missing
- **Compiler gate supremacy:** `tsc --noEmit=0` outranks Codex on SDK questions

Files updated: `TEAM_PROTOCOL.md`, `prompts/t2_code_lead.md`, `prompts/t3_codex_judge.md`, `prompts/t3b_regression_judge.md`, `prompts/t4_minion_sonnet.md`, `prompts/t5_minion_haiku.md`, `BRAIN_DOCS/adr-002-t2-sdk-verification-gate-20260427.md`

### codex-doctrine.md compressed (513 → 101 lines)
- All binding content preserved
- Narrative/examples/redundant tables cut
- ADR-002 IR gates merged into Think section
- Archive at: `canonical/codex-doctrine-full-archive.md`
- Live: `canonical/codex-doctrine.md` (101 lines)

### GitNexus FTS indexes rebuilt
- `npx gitnexus analyze` run — 24,178 nodes, 30,570 edges, 479 clusters, 300 flows

---

## SDK FINDINGS THIS SESSION (think.d.ts verified)

| Primitive | Location | Notes |
|-----------|----------|-------|
| `TurnConfig` | think.d.ts:108-126 | toolChoice = `Parameters<typeof streamText>[0]["toolChoice"]` |
| `beforeTurn` | think.d.ts:439 | Returns `TurnConfig \| void \| Promise<...>` |
| `onChatError` | think.d.ts:540 | **SYNC** — `onChatError(error: unknown): unknown` |
| `onChatResponse` | think.d.ts:535 | `void \| Promise<void>` |
| `onStepFinish` | think.d.ts:518 | `void \| Promise<void>` |
| `beforeToolCall` | think.d.ts:487-489 | Returns `ToolCallDecision \| void \| Promise<...>` |
| `TurnContext` | think.d.ts:90-104 | `.messages` is `ModelMessage[]`, `.system`, `.tools`, `.model`, `.continuation`, `.body` |
| `chat()` | think.d.ts:647-650 | `chat(msg, callback: StreamCallback, options?: ChatOptions)` |
| `StreamCallback` | sub-agents.md:21-26 | `onEvent`, `onDone`, **`onError?` (optional)** |
| `ChatOptions` | think.d.ts:66-69 | Only `signal?` + `tools?` — NO `onError` here |
| `subAgent()` | sub-agents.md:61 | Framework method on Think base class — NOT in think.d.ts exports |
| `setState()` | index.md ref | Agent base class method — NOT a Think-specific hook |
| `configure()` | think.d.ts:368 | `configure<T>(config: T): void` |
| `getConfig()` | think.d.ts:378 | `getConfig<T>(): T \| null` |
| `saveMessages()` | think.d.ts:685-691 | Accepts `UIMessage[]` OR transform function |

---

## P2 BACKLOG (S5-D)

**Salvage version guard missing** (T3A finding):
- File: `bella-agent.ts` ~line 1224
- Bug: no upper-bound check on `partial.analysisVersion` — stale salvage can overwrite newer intel
- Fix: `partial.analysisVersion >= (this.cs?.intel?.consultant as any)?.analysisVersion ?? 0`

---

## D1 ITEMS PENDING (CF MCP disconnected this session)

File to D1 on reconnect:
- `spec-s5c-multipass-error-gates-20260427` → S5-C spec
- `doc-t9-s5c-session-report-20260427` → T9 session report

---

## NEXT SPRINT: S5-D

**Scope:** `@callable` injection + `configure()` + `session.addContext()`
**Status:** Unspecced
**Protocol:** Full ADR-002 IR-1/IR-2/IR-3 gates apply
**First task for new session:** T5 SDK_DISCOVERY (read think.d.ts for @callable, configure, addContext primitives) BEFORE T9 writes spec

**Remaining chain:**
```
S5-C ✅ Multi-pass + Error + Forced Gates + R2 Prompt
S5-D ← NEXT: @callable + configure() + session.addContext()
S5-E: Public getters + waitUntilStable exposure
S5-F: Session branching + branchAndCompareRouting (tool 15)
```

---

## SESSION LAWS LEARNED (new this session)

1. ADR-002 IR gates — T5 reads .d.ts BEFORE spec. SDK_EVIDENCE_PACK in every CODEX_REVIEW_REQUEST.
2. Mid-session prompt changes take effect on respin only — not retroactive.
3. For Think SDK: local .d.ts = canonical source. Online fetch NOT required for Think primitives.
4. `subAgent()` and `setState()` are base class methods — not in think.d.ts exports. Confirmed by tsc.
5. `ChatOptions.onError` doesn't exist — `StreamCallback.onError?` does (optional, second param).
6. GitNexus FTS read-only error → `npx gitnexus analyze` fixes it.

---

## COMMIT RECORD

| Commit | What |
|--------|------|
| `29a0605` | S5-B base (AgentSearchProvider + findings context) |
| `e344148` | S5-C: 11 changes + ADR-002 + codex-doctrine compression (17 files, +1987/-53) |
