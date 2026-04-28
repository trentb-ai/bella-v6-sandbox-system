# T9 Architect Handover — Enterprise Sprint + Session Context
## 2026-04-28 ~13:05–14:30 AEST

---

## ⚠️ MANDATORY FOR NEXT T9: READ BEFORE ARCHITECTING ANYTHING

### THINK-NATIVE BUILD — SUPREME DIRECTIVE

Every agent capability MUST be built on `@cloudflare/think` (`extends Think<Env>`). This is LAW 10. No exceptions.

**BEFORE you spec or architect ANYTHING touching Think Agent V1:**

1. **READ the canonical .d.ts** — `~/.claude/skills/think-agent-docs/think-types/think.d.ts` (790 lines). This is ground truth. If .d.ts conflicts with any doc or memory, .d.ts wins.
2. **READ the SKILL.md lookup table** — `~/.claude/skills/think-agent-docs/SKILL.md` for hook docs, session API, workspace API, extension system.
3. **VERIFY every SDK method you reference** — grep the .d.ts for exact signature. `session.search()` is synchronous (L119-126). `configureSession` returns `Session | Promise<Session>` not SessionManager. `configure()` persists to SQLite. `setState()` does NOT survive hibernation. These distinctions matter.
4. **Delegate T5 to verify** if you're unsure about any SDK behavior. T5 reads .d.ts, reports raw. You form conclusions.
5. **Never spec Think features without citing .d.ts line number.** "I think the SDK does X" is not acceptable. Demand proof from yourself.

**Three reference templates for all agent types:**
- ANALYSIS agents → ConsultantAgent v2 pattern (multi-pass, FTS5, workspace)
- COMPUTATION agents → ROI Agent pattern (deterministic math, beforeToolCall validation, session branching)
- ORCHESTRATOR agents → BellaAgent pattern (dual-gated advancement, sub-agent coordination, real-time streaming)

**Blueprint:** `BRAIN_DOCS/doc-bella-consultant-agent-v2-blueprint-20260427.md`
**ADR-001:** `BRAIN_DOCS/adr-001-think-judge-context-pack-20260426.md`

---

## CURRENT LIVE STACK

| Worker | Version | Status |
|--------|---------|--------|
| bella-think-agent-v1-brain | 3.16.0-think | LIVE — all 11 migration chunks shipped |
| frozen-bella-natural-voice | 4.3.0-THINK-NATIVE | LIVE — direct to brain /turn/{lid} |
| fast-intel-v9-rescript | 1.19.0 | LIVE — dual delivery (KV + Think brain Event POST) |
| consultant-v10 | 6.12.1 (or 6.12.2 pending rollback decision) | SEE BUGS SECTION |
| bella-scrape-workflow-v10-rescript | — | LIVE |
| Frontend | bellathinkv1.netlify.app | LIVE — URLs fixed this session |

**7 agents in brain DO:** BellaAgent, ConsultantAgent, DeepScrapeAgent, ROIAgent, WowAgent, BellaPreCallResearch, ComplianceAgent

---

## THINK-NATIVE CALL PATH (VERIFIED)

```
Browser WS → frozen-bella-natural-voice DO (audio/Deepgram)
  → Deepgram servers call BRAIN_URL/turn/{lid}
    → bella-think-agent-v1-brain worker.ts /turn handler
      → BellaAgent DO (compat-turn handler, ~L862)
        → Think SDK chat() → Gemini → SSE response
```

### Intel Pipeline:
```
capture.html POST → fast-intel-v9-rescript
  → Firecrawl scrape + Consultant Gemini
  → KV write: lead:{lid}:fast-intel
  → Event POST to THINK_BRAIN /event?callId={lid}
    → brain worker.ts /event handler (PartyKit headers added)
      → BellaAgent DO receiveIntel()
        → configure({ pendingIntel }) if no session yet
        → applyIntel() if session active
```

---

## KEY ARCHITECTURE DECISIONS (carry forward)

### 1. Think-Native Turn Path
Voice → Brain `/turn/{lid}` direct. No bridge regex parsing. Lid is positional in URL, not extracted from system message.

### 2. configure() for Hibernation-Safe State
`configure()` persists to `assistant_config` SQLite table — survives DO hibernation. `setState()` is in-memory only. Every turn's `.finally()` writes state to `configure()`. On wake, `hydrateFromConfig()` reads it back.

### 3. Pre-Session Intel Queuing
Intel events arriving before user connects get queued in `configure({ pendingIntel: [...] })`. On first turn, `initSession()` drains the queue.

### 4. Pure cs Getter
`private get cs()` returns `this.state ?? null` — pure read, no side effects. v3.15.0 proved why: side-effecting getter caused catastrophic empty responses.

### 5. ComplianceAgent on Every Response
Non-blocking via `ctx.waitUntil`. V2 compliance functions need phrase arrays not available in Think context. Full coverage, fire-and-forget.

### 6. Session Tree Branching (not SessionManager)
`configureSession` returns `Session`, not `SessionManager`. Think owns Session lifecycle. Use `session.appendMessage(msg, parentId)` for branches. SessionManager is a separate opt-in system.

---

## CURRENT HOOK STATE (bella-agent.ts)

| Hook | Lines | What It Does Now |
|------|-------|-----------------|
| beforeTurn() | ~L350-390 | processFlow() + dynamic system prompt (intel + ROI + stage directive) |
| beforeToolCall() | ~L416-429 | ROI stage gate + deep scrape guard |
| afterToolCall() | ~L431-443 | Performance logging to state.toolLog |
| onStepFinish() | ~L455-478 | Token accounting to state.tokenLog |
| onChunk() | ~L445-453 | SSE relay |
| onChatResponse() | ~L480-590 | Fallback extraction + ComplianceAgent + delivery tracking |
| onChatError() | ~L592-596 | User-friendly error message |
| onChatRecovery() | ~L598-607 | State persistence before crash |

### Context Blocks (configureSession ~L131-172):
| Block | Type | Tokens |
|-------|------|--------|
| soul | Provider | — |
| memory | Writable | 2000 |
| compliance_rules | Provider | — |
| stage_policies | Provider | — |
| knowledge | Searchable (AgentSearchProvider) | — |

### Thin Constants:
- STAGE_POLICIES_TEXT (~L87-91): 4 lines only
- COMPLIANCE_RULES_TEXT (~L81-85): 4 lines only

---

## ENTERPRISE SPRINT SPEC (PENDING — ON HOLD)

**Spec:** `BRAIN_DOCS/spec-enterprise-scripting-observability-sprint-20260428.md`
**D1:** `spec-enterprise-scripting-observability-sprint-20260428`
**Status:** Trent GO → T1 HOLD (P0 Firecrawl first) → awaiting priority confirmation

6 chunks, all Think-native:

| Chunk | What | Risk | Think Primitive |
|-------|------|------|----------------|
| E1 | Rich Stage Policies + Improv Rules | LOW | withContext provider blocks |
| E2 | Objection Detection + Recovery Injection | MED | beforeTurn() → TurnConfig.system |
| E3 | WOW Step Quality Gating | MED | beforeTurn() flow + controller.ts |
| E4 | Memory Block Activation | LOW | withContext writable + soul instructions |
| E5 | Script Conformance Checking | MED | onChatResponse() |
| E6 | Structured Observability + Alerts | LOW | onStepFinish() + onChatResponse() |

**Order:** E1 → E4 (parallel) → E2 → E3 → E5 → E6
**Verbatim implementation text for E1+E4** already sent to T2 via peer message.

---

## ACTIVE BUGS

### P0: Firecrawl Not Running
- Status: T1 flagging. Blocks live testing pipeline.
- Impact: capture.html → fast-intel → Firecrawl scrape fails → no consultant data → no personalisation

### P1: Consultant-v10 v6.12.2 T3A FAIL
- Root cause I diagnosed: `buildPromptCopy()` uses description-as-value JSON template. Gemini echoes descriptions on thin content.
- Fix attempt (v6.12.2): json_schema conversion. T5 verified values now correct.
- T3A FAIL reasons:
  1. null→empty string contract break on 6 scriptFills fields. `json_schema` enforces `type: "string"` = always returns `""` not `null`. Downstream null-checks break.
  2. Lost prompt semantics: they/their voice rule, icp_guess framing instructions moved to schema descriptions only — model follows them less reliably.
  3. websiteCompliments cardinality unenforced.
  4. callMicro retry passes same responseFormat to all models with no guard.
- **Fix-forward needed:** Add null normalization layer (map `""` → `null` for nullable fields) + keep voice/framing instructions in prompt text, not just schema descriptions.
- File: `bella-consultant/worker.js` — `buildPromptCopy()` (~L496-577) and `runConsultant()` (~L787+)

### P2: Debug Endpoint Hibernation
- `hydrateFromConfig()` partially addresses. Monitor if debug returns valid state after extended hibernation.

### P2: Missing /trigger Route on Scrape Workflow
- capture.html calls `/trigger` on `bella-scrape-workflow-v10-rescript` but route may not exist.

### P2: 163 Pre-Existing Test Failures
- All from `processFlow`/`deriveTopAgents` export mismatches. Unrelated to current work.

---

## CRITICAL GOTCHAS

1. **Think brain is in SEPARATE directory** — `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/` — NOT in the sandbox repo. CWD matters for Codex gates.
2. **No git in Think brain dir** — changes deployed via wrangler but not version-controlled separately.
3. **Poisoned DOs persist** — A DO created during a buggy deploy retains corrupted state even after re-deploy. Always use FRESH lids.
4. **PartyKit headers mandatory** — Every DO fetch needs `x-partykit-namespace` + `x-partykit-room`. Missing = "Missing namespace or room headers" error.
5. **configure() vs setState()** — configure() = SQLite-persisted, survives hibernation. setState() = in-memory only, broadcasts to WS. Use configure() for anything that must survive DO sleep.
6. **routeAgentRequest() is WS-only** — Does not handle HTTP. Custom routes in worker.ts needed for debug/event/turn endpoints.
7. **personalisedaidemofinal-sandbox is READ proxy** — serves website mockup iframe + /log-lead + /get-lead on demo page. NOT a LAW 1 violation. Never replace its URLs on demo_v15_hybrid.html.
8. **Never speculate to Trent** — investigate with evidence first. Delegate to T5 for raw reads/curls.
9. **wrangler tail unreliable** — Use persistent debug endpoints (`/do/{leadId}/debug`) for post-hoc observability.

---

## DO DEBUG ENDPOINTS (all via /do/{leadId}/{endpoint})

| Endpoint | Returns |
|----------|---------|
| /debug | Stage, wowStep, completedStages, calculatorResults, inputs, turnCount, token totals |
| /state | Full ConversationState |
| /tokens | Token accounting: totalInput/Output/Cached, step log |
| /tools-perf | Per-tool summary (calls, totalMs, errors) + raw log |
| /session-info | pathLength, messageCount, contextBlocks, compactions |
| /workspace-files | Lead workspace file listing |
| /compliance | Compliance log entries |

---

## PRIOR HANDOVER DOCS (read these too)

| Doc | What |
|-----|------|
| doc-handover-t9-think-native-debug-20260428.md | Bugs 1-7, Think-native arch decisions, canary results, v3.16.0 |
| doc-handover-t9-live-test-debug-20260428.md | Frontend URL fixes, first live test debug, call path verification |
| doc-handover-t9-think-migration-complete-20260428.md | All 11 chunks, SDK verifications, session/workspace/compliance |
| doc-handover-t9-observability-harness-20260428.md | Token/tool/turn metrics, canary test script, version guard fix |
| doc-handover-t9-chunks-5-6-9-sprint-close-20260428.md | Intel delivery, extraction, compliance sub-agent |
| doc-handover-t9-s5def-sprint-close-20260427.md | Consultant sub-agent sprints |

---

## TEAM ROSTER (as of session end)

| ID | Role | Status |
|----|------|--------|
| j5b71zqp | T1 Orchestrator | Flagging P0 Firecrawl |
| 1ea3ngtu | T2 Code Lead | Standing by for priority confirmation |
| 7v2jec2x | T3A Code Judge | Idle after consultant FAIL verdict |
| zrmc7vm6 | T3B Regression Judge | Standing by |
| dsumpncb | T4 Minion A | Standing by |
| qjc4q049 | T5 Minion B (Haiku) | Verified consultant fix, standing by |
| z19ybflt | Old T9 (stale) | Peer messaging broken, last session deployed v3.16.0 |

---

## WHAT NEXT SESSION SHOULD DO

1. **Get Trent's priority call:** P0 Firecrawl fix vs enterprise sprint vs consultant fix-forward
2. **If enterprise sprint:** E1+E4 specs are ready (verbatim text sent to T2). T4 can implement immediately.
3. **If consultant fix:** Spec null normalization layer + prompt instruction preservation. One function: normalize empty strings to null on Gemini response, keep voice rules in prompt body.
4. **If Firecrawl:** Diagnose why Firecrawl API calls fail. Check key validity, endpoint, rate limits.
