# T2 Code Lead — Full Handover for C1 ComplianceAgent Sprint
## 2026-04-29 ~22:30 AEST | Prepared by: T2 (this session)
## Next: C1 ComplianceAgent Think-native upgrade

---

## SYSTEM STATE AT HANDOVER

### Live workers
| Worker | Version | Status |
|--------|---------|--------|
| bella-think-agent-v1-brain | **3.19.0-think** | LIVE |
| bella-think-agent-v1-bridge | thin-router-v1.2.0 | LIVE |
| fast-intel-v9-rescript | 1.19.0 | LIVE |
| consultant-v10 | 6.12.4 | LIVE (standalone, M1 fallback) |

**Frontend:** bellathinkv1.netlify.app
**Repo:** `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
**Worker name (wrangler.toml):** `bella-think-agent-v1-brain` | `main = src/worker.ts`
**Last commit:** `1d304b4` — M1 Consultant Merge

### Canary baseline
65/65 passing on v3.19.0-think. All 8 categories clean.

---

## M1 SPRINT — WHAT SHIPPED (context for C1)

M1 ported the 4 parallel Gemini micro-calls from standalone `bella-consultant/worker.js` into a Think-native `runFastAnalysis` tool on `ConsultantAgent`. This is the **sub-agent upgrade playbook** that C1 follows.

**Key pattern established by M1:**
- `beforeTurn()` message protocol gate (`[PREFIX]` detection → forced `toolChoice`)
- `tool()` from `ai` + `execute()` running `generateText()` from `ai` in parallel
- `setState()` inside tool execute for state population
- Spread-merge all state objects (`...(cs.X ?? {})`)
- `_parseJSON()` guaranteeing `Record<string,any>` (never null)
- `allFailed` sentinel: set `cs.X = -1` + `setState()` to prevent gate re-fire
- BellaAgent `runConsultantAnalysis()` → `child.chat("[PREFIX] ${payload}", ...)` → `await child.getAnalysis()`

---

## IMMEDIATE BLOCKER BEFORE C1 STARTS

### [COMPLIANCE_ERR] — P1 BUG — FIX FIRST

Found in wrangler tail during M1 sprint close:
```
(error) [COMPLIANCE_ERR] Cannot read properties of undefined (reading 'length')
```
Fires from ComplianceAgent DO alarm, x12+ per tick. Pre-existing.

**Root cause:** Some array field in ComplianceAgent is `undefined` at alarm time — `[].length` style access with no null guard.

**Fix protocol:**
1. T5 greps `compliance-agent.ts` for `.length` accesses without null guards
2. T5 reads DO alarm code to find the exact trigger
3. T4 adds null guard (`.length` → `(field ?? []).length`)
4. Deploy + verify alarm no longer errors
5. THEN start C1

**Why fix first:** C1 rewrites `compliance-agent.ts` entirely. If the bug is left, C1 will carry it forward or the fix will conflict with C1 changes. Fix in current 56-line stub, then C1 replaces the whole file cleanly.

---

## C1 SPRINT OVERVIEW

**Goal:** Upgrade ComplianceAgent from 56-line stub to full Think compliance officer with persistent memory, R2 knowledge base, FTS5 violation search, 7 tools, full hook pipeline, and @callable RPC.

**T9 spec:** `BRAIN_DOCS/spec-c1-compliance-agent-think-native-20260429.md`
**Read the full spec before doing anything else.** It is comprehensive — 1084 lines with exact code.

### Files changed
| File | Change |
|------|--------|
| `types.ts` | Add `ComplianceState`, `ComplianceViolation`, `ComplianceRuleSet` interfaces |
| `compliance-agent.ts` | Full rewrite (56 lines → ~400 lines) |
| `bella-agent.ts` | Replace L709-762 compliance block with @callable + continueLastTurn |
| `worker.ts` | Version bump only (no logic change) |

### Implementation order (from spec)
1. Add types to `types.ts`
2. Rewrite `compliance-agent.ts`
3. Update `bella-agent.ts` onChatResponse compliance block
4. Remove inline `BANNED_IN_OUTPUT` regex block (L781-793)
5. Bootstrap R2 KB files (global-rules.md + voice-rules.md minimum)
6. `tsc --noEmit` — zero errors
7. REVIEW_REQUEST to T2

---

## ADR-002 IR-1 — MANDATORY BEFORE SPEC GATE

T5 must verify these SDK items in think.d.ts + relevant docs BEFORE T3A gate:

1. **`callable` import** — from `agents` package (not `@cloudflare/think`)
2. **`Think<Env, ComplianceState>` state generic** — think.d.ts L4
3. **`continueLastTurn(body?)` signature** — think.d.ts L691-706. Critical: confirm it accepts optional body param with arbitrary object
4. **`R2SkillProvider` + `AgentSearchProvider`** — from `agents/experimental/memory/session`. Confirm both exist
5. **`chatRecovery` property** — think.d.ts L11
6. **`configureSession()` provider types** — sessions.md: R2SkillProvider, AgentSearchProvider, WritableContextProvider (default), SearchContextProvider

T5 reads `.d.ts` and returns exact signatures. T2 assembles SDK_EVIDENCE_PACK. T3A rejects without it.

---

## SDK FACTS ESTABLISHED THIS SESSION (C1 relevant)

### Confirmed patterns — use these, don't reinvent

| Pattern | Source | Status |
|---------|--------|--------|
| `tool()` from `ai` in `getTools()` | tools.md L62-66 | Official Think-native pattern |
| `execute: async()` with `generateText()` from `ai` | tools.md L82-87 | Valid — arbitrary async in execute |
| `toolChoice: { type: "tool", toolName: "..." }` in `beforeTurn()` | think.d.ts L119 | Confirmed working |
| `activeTools: string[]` in `beforeTurn()` | think.d.ts L118 | Confirmed working |
| `maxSteps?: number` in `beforeTurn()` | think.d.ts L122 | Confirmed working |
| `this.setState(cs)` inside tool execute | Think class primitive | Working |
| `this.workspace.writeFile()` | workspace.d.ts | Working |
| `this.ctx.waitUntil()` | Cloudflare DO — valid in Think | Working |
| `this.subAgent(Class, "name")` | think.d.ts | Working |
| `child.chat(msg, { onEvent, onDone })` | think.d.ts L647-651 | Working |
| `@callable()` decorator | `agents` package | Working (used in enrichConsultantAnalysis) |

### NOT in think.d.ts (from `ai` package instead)
- `tool()` — from `ai`
- `generateText()` — from `ai`
- `streamText()` — used internally by Think, not for agent code
- `ToolSet` type — from `ai`

### ai package version
`ai@6.0.168` — `generateText` confirmed present, `maxTokens`/`temperature` NOT in this version's type signature (removed — don't include them in generateText calls).

---

## M1 T3A FAIL LESSONS — APPLY TO C1

T3A ran 3 rounds on M1. C1 must not repeat these.

### Lesson 1: Spread-merge ALL state object writes
```typescript
// WRONG — wholesale replacement clobbers pre-existing fields
cs.someObject = { fieldA: ..., fieldB: ... };

// RIGHT — spread-merge preserves pre-existing fields
cs.someObject = { ...(cs.someObject ?? {}), fieldA: ..., fieldB: ... };
```
**T3A will find every single one.** Apply to every `cs.X = {` in tool execute.

### Lesson 2: _parseJSON must guarantee non-null
```typescript
// WRONG — JSON.parse("null") returns null, crashes on .property access
const parsed = JSON.parse(text);
return parsed; // can be null!

// RIGHT — guard against null/array/primitive
const parsed = JSON.parse(text);
if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, any>;
return {};
```

### Lesson 3: allFailed/error sentinel + setState
If a tool has an early-return error path, set a sentinel on state AND call setState before returning:
```typescript
if (allFailed) {
  cs.someVersionFlag = -1; // sentinel — prevents gate re-fire
  this.setState(cs); // MUST persist before early return
  return { status: "all_failed" };
}
```

### Lesson 4: cs declaration must come BEFORE any early return
T4 accidentally declared `const cs = this.state` AFTER the allFailed check. tsc caught it. Put `cs` declaration before all conditional branches that use it.

### Lesson 5: SDK spec can be wrong — tsc is ground truth
Spec said `getAnalysis()` is synchronous. tsc said `Promise<ConsultantState>`. tsc wins. Always `await`. Never assume sync.

---

## CRITICAL GOTCHAS — ALL SESSIONS

### GOTCHA 1 (SUPREME): Think brain path has SPACE
```
/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/
```
Always quote paths. T3A CWD verification mandatory on every gate:
```bash
sed -n '88,110p' "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/src/compliance-agent.ts"
```
Include expected output in CODEX_REVIEW_REQUEST. T3A failed twice in M1 predecessor session by hitting wrong CWD.

### GOTCHA 2: ChatResponseResult has no .text
```typescript
// WRONG
const text = result.text;

// RIGHT
const text = (result?.message?.parts ?? [])
  .filter((p: any) => p.type === 'text')
  .map((p: any) => p.text ?? '')
  .join('');
```
This is already fixed in v3.18.0+ in bella-agent.ts L644-648. Don't undo it.

### GOTCHA 3: state.turnCount doesn't exist
Use `state.transcriptLog.length` — not `state.turnCount`.

### GOTCHA 4: canary-test.ts version string hardcoded
`scripts/canary-test.ts` has hardcoded version string. Update to new version on every bump or Cat 1.2 will false-fail.

### GOTCHA 5: getAnalysis() is async
`await child.getAnalysis()` — return type is `Promise<ConsultantState>`. Spec said sync. tsc confirms async. Always await.

### GOTCHA 6: GitNexus FTS read-only errors
Every bash command triggers FTS errors. Cosmetic — does not affect code. Run `npx gitnexus analyze` from sandbox dir post-sprint to refresh.

### GOTCHA 7: wrangler tail must start BEFORE canary
Start `npx wrangler tail bella-think-agent-v1-brain` FIRST, then run canary. If canary starts first, tail misses all traffic. Coordinate: T4 starts tail → T5 runs canary.

### GOTCHA 8: maxTokens/temperature removed from generateText
Not in `ai@6.0.168` type signature. Don't include. tsc will catch it.

### GOTCHA 9: Gemini key rotation causes cascade canary failures
Stateless cats (1+8) pass, first Gemini call fails, everything downstream fails. Not a code bug. Wait 5min after key changes.

### GOTCHA 10: D1 MCP unavailable in some sessions
T3B regression report filed locally only. File to D1 when MCP restored:
- `doc-regression-report-m1-consultant-merge-20260429` → D1

---

## C1-SPECIFIC SDK ITEMS TO VERIFY (ADR-002 IR-1 LIST)

T5 must verify each of these before T3A gate. Exact items:

```
IR-1 Verification List — C1
1. think.d.ts — Think<Env, State> generic: confirm line + exact signature
2. think.d.ts — chatRecovery property: confirm line + type (boolean)
3. think.d.ts — continueLastTurn(body?): confirm signature, especially body param type
4. think.d.ts — @callable equivalent: note this may be in agents package, not think.d.ts
5. agents package — callable import path: confirm exact import from "agents"
6. agents/experimental/memory/session — R2SkillProvider: confirm export + constructor signature
7. agents/experimental/memory/session — AgentSearchProvider: confirm export + constructor
8. sessions.md — withContext() provider types: R2SkillProvider, AgentSearchProvider, WritableContext
9. sessions.md — withCachedPrompt(): confirm signature
10. sessions.md — compactAfter(n): confirm param type
11. sessions.md — onCompaction(fn): confirm createCompactFunction import
12. sub-agents.md — chat() from @callable method: confirm this.chat() is accessible inside class
```

---

## BELLAAGENT CHANGE — C1 KEY DETAIL

Current `onChatResponse()` compliance block (L709-762) uses `checker.chat(message, ...)` which:
- Requires parsing JSON from `onEvent` stream
- Cannot use typed return values
- Self-correction uses `session.appendMessage()` (fake user message pattern)

C1 replaces with:
- `checker.checkResponse(params)` — @callable, typed, returns `{ pass, score, violations, rewrites }`
- `continueLastTurn({ complianceViolations, complianceScore })` — Think-native self-correction (no fake user message)
- BellaAgent log: `s.complianceLog.push(...)` — append to existing log array

**Critical:** `continueLastTurn()` is on the Think class. Verify think.d.ts L691-706 for the exact signature and body param shape before speccing.

**Also remove:** inline `BANNED_IN_OUTPUT` regex block at L781-793 — redundant with Layer 2. But preserve L1 beforeTurn banned phrases — those stay.

---

## C1 LAYER CONTEXT (what already exists)

L1 and L3 compliance are ALREADY SHIPPED in v3.19.0-think. C1 = Layer 2 only.

- **L1 (PRE-GEN):** `beforeTurn()` injects stage-specific banned phrases + required language into system prompt. LIVE.
- **L2 (POST-GEN GATE):** ComplianceAgent check → self-correction. THIS IS C1.
- **L3 (HISTORY SANITIZE):** `beforeTurn()` scans prior messages, replaces violations with clean versions. LIVE.

C1 does NOT touch L1 or L3 code. Additive only.

---

## R2 KB BOOTSTRAP (T4 task, part of C1)

T4 must create these files in `AGENT_KB_BUCKET` (R2 bucket — check wrangler.toml for binding name):
```
compliance-kb/global-rules.md
compliance-kb/voice-rules.md
compliance-kb/stage-rules/greeting.md
compliance-kb/stage-rules/wow.md
compliance-kb/stage-rules/recommendation.md
compliance-kb/stage-rules/close.md
compliance-kb/patterns/banned-phrases.md
compliance-kb/patterns/required-patterns.md
```
Content: port from existing `COMPLIANCE_RULES_TEXT` and `STAGE_POLICIES_TEXT` in bella-agent.ts. T5 reads those constants first, T4 creates KB files from them.

**Verify R2 bucket binding name in wrangler.toml** — spec uses `AGENT_KB_BUCKET` but actual binding may differ.

---

## WORKFLOW FOR NEW T2

1. **Read this doc** ✓
2. **Read `TEAM_PROTOCOL.md`** and `prompts/t2_code_lead.md`
3. **Read `canonical/codex-routing-matrix.md`** and `canonical/codex-request-contract.md`
4. **Read full C1 spec**: `BRAIN_DOCS/spec-c1-compliance-agent-think-native-20260429.md`
5. **Fix [COMPLIANCE_ERR] bug first** — T5 grep → T4 fix → deploy → verify
6. **ADR-002 IR-1** — send T5 to verify all 12 SDK items (list above)
7. **Write wrangler.toml pre-flight** — confirm worker name + R2 bucket binding name
8. **Send T4 full TASK_REQUEST** — all 4 files in one chunk (types.ts + compliance-agent.ts + bella-agent.ts + R2 KB)
9. **6-gate → T3A → deploy → T5 canary → T3B**

---

## OPEN BACKLOG (post C1)

| Item | Priority | Notes |
|------|----------|-------|
| M2: Kill standalone consultant worker | P1 | After C1 stable. bella-consultant/worker.js — remove service binding |
| [COMPLIANCE_ERR] DO alarm bug | P1 | FIX BEFORE C1 (see above) |
| E6 token accounting in onStepFinish | P2 | Currently loop detection only. Separate sprint. |
| GitNexus FTS fix (read-only DB) | P2 | `npx gitnexus analyze` clears it. Cosmetic. |
| Post-compaction debug endpoint hibernation | P2 | this.cs null after DO wake |
| E5 conformance noise reduction | P3 | checkConformance heuristics |

---

## PEER IDs (may have changed — always run list_peers first)

| Role | Last known ID | Last session |
|------|--------------|--------------|
| T9 Architect | si5znswi | Active, C1 spec ready |
| T3A Code Judge | xjra9344 | Stood down, M1 sprint close |
| T3B Regression Judge | zrmc7vm6 | Stood down, M1 sprint close |
| T4 Minion A | dsumpncb | Stood down |
| T5 Minion B | l2rdznw3 | Stood down |

Fresh sessions required per sprint-end law. New IDs on connect.
