# Consultant Merge — Option A Spec
## 2026-04-28 AEST | Authority: Trent Belasco | Architect: T9
## D1 ID: spec-consultant-merge-option-a-20260428

---

## DECISION

Kill `bella-consultant/worker.js` standalone worker. Consolidate ALL consultant logic into Think ConsultantAgent sub-agent. **Trent GO 2026-04-28.**

---

## CONTEXT

Two consultant systems exist:
1. `bella-consultant/worker.js` — standalone CF Worker, 4 parallel Gemini micro-calls (~3-5s). Endpoints: `/fast`, `/pass2`. Bugs: pass2 json_schema missing, buildFallback null contract.
2. `ConsultantAgent` (`consultant-agent.ts`) — Think sub-agent (`extends Think<Env, ConsultantState>`), 15 tools, tiered analysis, FTS5, R2 workspace, session branching, defensive hooks (~15-25s).

Dual codebase = maintenance burden + recurring json_schema bugs. Think-first law (LAW 10) demands consolidation.

---

## LATENCY SOLUTION

SDK confirmed: tool `execute()` can run `Promise.all` internally. No restriction.

- Think wraps execute with `await` (.d.ts L576-608) — `Promise.all` is one Promise, one result
- `hookTimeout` applies to HOOKS only, not tool execute (.d.ts L557)
- No documented timeout on tool execution
- `abortSignal` only fires on external turn cancellation

**Build `runFastAnalysis` composite tool. 4 parallel Gemini calls inside one execute(). ~3-5s preserved.**

---

## TWO SPRINTS (MINIMUM VIABLE)

### SPRINT M1: CONSULTANT THINK UPGRADE
**Scope:** brain deploy only, standalone worker still alive as fallback
**Files:** `consultant-agent.ts` + `bella-agent.ts`

#### M1-A: `runFastAnalysis` composite tool
- New tool in ConsultantAgent
- `execute()` runs `Promise.all` of 4 parallel Gemini calls
- Ports `buildPromptCopy` / `buildPromptICP` / `buildPromptConversion` / `buildPromptResearch` logic from standalone worker
- Returns merged result identical to standalone worker output shape
- `beforeTurn()` forces this tool first on initial pass via `toolChoice`
- ~3-5s, single tool call — latency preserved

#### M1-B: Think SDK upgrades (while touching the file)
| Feature | SDK Source | What It Gives |
|---------|-----------|--------------|
| Dynamic context blocks | `addContext()` sessions.md L218-229 | Add intel sources at runtime as they arrive |
| Writable analysis memory | sessions.md L170-175 | LLM writes observations surviving compaction via `set_context` |
| R2SkillProvider | sessions.md L193-198 | Load only relevant industry KB docs per prospect |
| Full workspace tools | tools.md L18-29 | read/edit/grep/find/delete — not just writeFile |
| `continueLastTurn()` | .d.ts L704 | Tier chaining without saveMessages hack |

#### M1-C: BellaAgent wiring
- `receiveIntel()` triggers `ConsultantAgent.runFastAnalysis()` via sub-agent RPC
- `waitUntilStable()` for clean parent coordination (.d.ts L732)
- `mergeConsultantResult()` unchanged — same data shape

#### M1 Gate
- T3A Codex + canary
- Both consultants running in parallel (old standalone + new Think)
- Compare output quality — Think result must match or exceed standalone

---

### SPRINT M2: CUT
**Scope:** fast-intel deploy + standalone worker deprecation

#### M2-A: Reroute fast-intel
- Remove consultant worker call from `fast-intel-v9-rescript/src/index.ts`
- Send raw scrape data in Event POST to brain (brain's ConsultantAgent does analysis)
- Remove consultant service binding from `fast-intel wrangler.toml`
- Deploy fast-intel

#### M2-B: Kill standalone
- `bella-consultant/worker.js` → frozen/deprecated
- Remove from deploy scripts
- Canary: full call test, verify scriptFills arrive via Think ConsultantAgent only

#### M2 Gate
- T3B regression
- Full canary 65/65
- Standalone worker confirmed dead

---

## ROLLBACK

Safety snapshot committed + pushed before any destructive work:
- **Commit:** `6d3cc10`
- **Branch:** `feat/prompt-enhancements-20260425`
- **Remote:** `origin/feat/prompt-enhancements-20260425`
- **Restore:** `git checkout 6d3cc10` + redeploy fast-intel with consultant binding restored

---

## THINK SDK CAPABILITY AUDIT — 30 UNUSED FEATURES

Full audit performed against think.d.ts (790 lines) + all think-docs/*.md.

### Key features to add in merged consultant:
1. `session.search(query)` — FTS5 over conversation history (sessions.md L140-148)
2. Dynamic context blocks — `addContext/removeContext` at runtime (sessions.md L218-229)
3. Writable context blocks — LLM writes working memory via `set_context` (sessions.md L170-175)
4. R2SkillProvider — on-demand industry KB loading (sessions.md L193-198)
5. Full workspace tools — read/edit/list/find/grep/delete (tools.md L18-29)
6. `SessionManager.fork()` — full analysis A/B comparison (sessions.md L413+)
7. `session.compactAndSplit()` — split long analysis sessions (sessions.md L481+)
8. `continueLastTurn()` — self-correction without fake user messages (.d.ts L704)
9. `waitUntilStable()` — parent knows when consultant finishes (.d.ts L732)
10. Extension system — sandboxed industry analysis plugins (.d.ts L312-318)

### Additional unused features (lower priority):
11. `onChunk()` — per-token streaming analytics (.d.ts L524)
12. `resetTurnState()` — abort/invalidate turns (.d.ts L719)
13. `hasPendingInteraction()` — check pending approvals (.d.ts L731)
14. `clearMessages()` — wipe history (.d.ts L655)
15. `providerOptions` in TurnConfig (.d.ts L124)
16. `messageConcurrency` strategies (.d.ts L300)
17. Client tools / approval flows (client-tools.md)
18. R2 workspace spillover (.d.ts L326-329)
19. `createExecuteTool()` — sandboxed JS execution (tools.md L196-219)
20. `createBrowserTools()` — CDP browser automation (tools.md L246-287)

---

## COMPLIANCE RULING (T2 test 6.2 — separate issue)

Think SDK has NO post-processing hooks:
- `onChatResponse`: fires AFTER message persisted, void return (.d.ts L535, lifecycle-hooks.md L440)
- `onChunk`: "Observational only (void return)" (.d.ts L523)

**Fix — two layers:**
1. `beforeTurn()` TurnConfig.system injection — REPLACES assembled prompt (lifecycle-hooks.md L117). Strongest pre-generation enforcement.
2. Regex filter at transport layer (voice agent before TTS) — true enforcement outside Think SDK.

---

## STATUS: QUEUED

Current T2 sprint (v3.16.2-think WOW stage machine + compliance) completes first. M1/M2 execute after.
