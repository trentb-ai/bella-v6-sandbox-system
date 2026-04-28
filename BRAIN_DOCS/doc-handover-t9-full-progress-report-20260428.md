# T9 Architect Full Progress Report + Handover
## 2026-04-28 ~14:30-15:30 AEST | Session: New T9 onboarding from prior T9 handover

---

## ⚠️ MANDATORY FOR NEXT T9: READ BEFORE ARCHITECTING ANYTHING

### THINK-NATIVE BUILD — SUPREME DIRECTIVE (LAW 10)

Every agent capability MUST be built on `@cloudflare/think` (`extends Think<Env>`). No exceptions.

1. **READ** `~/.claude/skills/think-agent-docs/think-types/think.d.ts` (790 lines) — ground truth
2. **READ** `~/.claude/skills/think-agent-docs/SKILL.md` — task→file lookup table
3. **VERIFY** every SDK method against .d.ts. Never spec without citing line number.
4. **Delegate T5** to verify if unsure. T5 reads .d.ts, reports raw.

---

## EXECUTIVE SUMMARY

Think Agent V1 migration is COMPLETE. All 11 chunks shipped. Bella runs on Think SDK with 7 sub-agents, 5 context blocks, hibernation-safe state, FTS5 search, R2 workspace, and event-driven intel delivery. V2 bridge-mediated architecture eliminated.

Current blockers: P0 Firecrawl (no scrape data), P1 consultant null contract, P1 WOW step initialization (fix confirmed this session). Enterprise sprint E1-E6 specced and ON HOLD.

---

## ARCHITECTURE: BEFORE vs AFTER

### V2-Rescript (Before)
```
Browser → Deepgram → Bridge (regex LID parse) → Brain DO (raw Worker)
  - KV polling for intel (race condition)
  - In-memory state (lost on hibernation)
  - No sub-agents (inline Gemini math = hallucination)
  - No compaction (unbounded context)
  - No workspace persistence
```

### Think Agent V1 (After — v3.16.0-think)
```
Browser WS → Voice DO (Deepgram) → Brain /turn/{lid} DIRECT
  - BellaAgent extends Think<Env>
  - 5 context blocks (soul, memory, compliance, stage_policies, knowledge)
  - 7 sub-agents (Consultant, DeepScrape, ROI, WOW, Compliance, PreCallResearch, ComplianceAgent)
  - Hibernation-safe state via configure() → SQLite
  - FTS5 searchable conversation history (AgentSearchProvider)
  - R2-backed workspace (auto-save ROI/compliance/intel)
  - Session tree branching for compliance recovery
  - Token/tool/turn observability hooks
  - Event POST intel delivery (no KV polling)
```

---

## ALL 11 MIGRATION CHUNKS — VERIFIED SHIPPED

| Chunk | What | Version | Source Evidence |
|-------|------|---------|----------------|
| 0 | Think scaffold | — | `BellaAgent extends Think<Env>` in bella-agent.ts |
| 1 | Context blocks + R2 | — | `configureSession()` with 5 blocks |
| 2 | State migration (KV → DO SQLite) | — | `configure()`/`hydrateFromConfig()` |
| 3 | Conversation Intelligence Engine | — | `processFlow()`, full stage machine |
| 4 | ROI sub-agent | — | `delegateToRoiAgent`, `compareQuotes`, `this.subAgent(ROIAgent)` |
| 5 | Intel delivery | v3.11.34 | `receiveIntel()`, `applyIntel()`, `pendingIntel` queuing |
| 6 | Extraction | v3.11.35 | `extractData`/`confirmData` tools + regex fallback |
| 7 | Session (compaction+recovery+branching) | v3.12.0 | FTS5, `appendMessage` branching, `createCompactFunction` |
| 8 | Consultant sub-agent (S5 sprints) | S5-A→F | `ConsultantAgent` 15 tools, defensive hooks |
| 9 | Compliance sub-agent | v3.11.36 | `ComplianceAgent` every response via `ctx.waitUntil` |
| 10 | Workspace | v3.12.0 | `Workspace({sql, r2, name})` + auto-save hooks |

---

## KEY ARCHITECTURAL DECISIONS

### 1. Think-Native Turn Path
Voice → Brain `/turn/{lid}` direct. No bridge regex parsing. LID positional in URL.

### 2. configure() for Hibernation-Safe State
`configure()` persists to `assistant_config` SQLite table — survives DO hibernation. `setState()` is in-memory only. Every turn's `.finally()` writes state to `configure()`. On wake, `hydrateFromConfig()` reads it back.

### 3. Pre-Session Intel Queuing
Intel events arriving before user connects get queued in `configure({ pendingIntel: [...] })`. On first turn, `initSession()` drains the queue.

### 4. Pure cs Getter — No Side Effects
`private get cs()` returns `this.state ?? null`. All hydration via explicit method calls. Side-effecting getter in v3.15.0 caused catastrophic empty responses.

### 5. Session Tree Branching (not SessionManager)
`configureSession` returns `Session`, not `SessionManager`. Think owns Session lifecycle. Use `session.appendMessage(msg, parentId)` for branches.

### 6. ComplianceAgent on Every Response
Non-blocking via `ctx.waitUntil`. V2 compliance functions need phrase arrays not available in Think context. Full coverage, fire-and-forget.

### 7. Three-Tier Prompt Strategy (ADR-001)
- Static → provider blocks (soul, compliance, stage_policies)
- LLM-writable → writable blocks (memory)
- Dynamic → beforeTurn() system override (intel context, ROI results, stage directives)

### 8. Dual Extraction Stores
`inputs` (tool-captured, high confidence) vs `inputsFallback` (regex, lower confidence). Never pollute tool data with regex results.

---

## FORMAL ADRs

- **ADR-001:** Think Judge Context Pack — three-tier prompt strategy
- **ADR-002:** SDK Verification Gate — IR-1/IR-2/IR-3 for Codex gates on Think work

---

## V2 BUGS ELIMINATED BY ARCHITECTURE

| V2 Bug | Think Fix |
|--------|----------|
| KV race condition (intel late) | Event POST direct to Brain DO |
| Empty stages (consultant micro-call fails) | Merge laws + no micro-call dependency |
| Speaker contamination (TTS in extraction) | Speaker flag at transport layer |
| No barge-in | VAD + <100ms TTS clear (voice layer) |
| No extraction retry (fire-and-forget) | Workspace auto-save + Cloudflare Workflow (V3 design) |
| ROI hallucination (Gemini math) | Deterministic ROI calculator + ROIAgent sub-agent |

---

## CURRENT LIVE STACK

| Worker | Version | Status |
|--------|---------|--------|
| bella-think-agent-v1-brain | 3.16.0-think | LIVE |
| frozen-bella-natural-voice | 4.3.0-THINK-NATIVE | LIVE |
| fast-intel-v9-rescript | 1.19.0 | LIVE (dual delivery) |
| consultant-v10 | 6.12.2 | LIVE but T3A FAIL (null contract) |
| bella-scrape-workflow-v10-rescript | — | LIVE |
| Frontend | bellathinkv1.netlify.app | LIVE |

7 agents in brain DO: BellaAgent, ConsultantAgent, DeepScrapeAgent, ROIAgent, WowAgent, BellaPreCallResearch, ComplianceAgent

---

## ACTIVE BUGS

| Priority | Bug | Status |
|----------|-----|--------|
| P0 | Firecrawl not running — blocks intel pipeline | Unresolved |
| P1 | consultant-v10 null contract (json_schema "" vs null) | T3A FAIL, fix-forward needed |
| P1 | business_name prompt bleed in fast-intel | T2 investigating |
| P1 | WOW step not initializing (currentWowStep=null) | Fix confirmed, T2 speccing |
| P2 | Debug endpoint hibernation hydration | Monitor |
| P2 | 163 pre-existing test failures | Backlog |

---

## NEXT SPRINTS (Priority Order)

### Sprint A: Stage Machine Fix (IMMEDIATE)
currentWowStep initialization in processFlow() when advancing to "wow". One-line fix.

### Sprint B: Consultant-v10 Fix-Forward
Null normalization layer + prompt instruction preservation. File: `bella-consultant/worker.js`

### Sprint C: P0 Firecrawl Resolution
API key/endpoint/rate limit diagnosis.

### Sprint D: Enterprise Scripting + Observability (E1-E6) — ON HOLD
Full spec: `BRAIN_DOCS/spec-enterprise-scripting-observability-sprint-20260428.md`

| Chunk | What | Risk |
|-------|------|------|
| E1 | Rich Stage Policies + Improv Rules | LOW |
| E2 | Objection Detection + Recovery Injection | MED |
| E3 | WOW Step Quality Gating | MED |
| E4 | Memory Block Activation | LOW |
| E5 | Script Conformance Checking | MED |
| E6 | Structured Observability + Alerts | LOW |

Order: E1 → E4 (parallel) → E2 → E3 → E5 → E6

### Sprint E: Post-MVP Hardening (parked)
- Tree sessions, Dynamic Workers ROI, self-authored extensions, stream resumption

---

## HOOK STATE (bella-agent.ts)

| Hook | Lines | What It Does |
|------|-------|-------------|
| beforeTurn() | ~L350-390 | processFlow() + dynamic system prompt (intel + ROI + stage directive) |
| beforeToolCall() | ~L416-429 | ROI stage gate + deep scrape guard |
| afterToolCall() | ~L431-443 | Performance logging to state.toolLog |
| onStepFinish() | ~L455-478 | Token accounting to state.tokenLog |
| onChunk() | ~L445-453 | SSE relay |
| onChatResponse() | ~L480-590 | Fallback extraction + ComplianceAgent + delivery tracking |
| onChatError() | ~L592-596 | User-friendly error message |
| onChatRecovery() | ~L598-607 | State persistence before crash |

---

## DO DEBUG ENDPOINTS (via /do/{leadId}/{endpoint})

| Endpoint | Returns |
|----------|---------|
| /debug | Stage, wowStep, completedStages, calculatorResults, inputs, turnCount |
| /state | Full ConversationState |
| /tokens | Token accounting: totalInput/Output/Cached, step log |
| /tools-perf | Per-tool summary + raw log |
| /session-info | pathLength, messageCount, contextBlocks, compactions |
| /workspace-files | Lead workspace file listing |
| /compliance | Compliance log entries |

---

## CALL PATH (VERIFIED)

```
Browser WS → frozen-bella-natural-voice DO (audio/Deepgram)
  → Deepgram servers call BRAIN_URL/turn/{lid}
    → bella-think-agent-v1-brain worker.ts /turn handler
      → BellaAgent DO (compat-turn handler, ~L862)
        → Think SDK chat() → Gemini → SSE response
```

Intel Pipeline:
```
capture.html POST → fast-intel-v9-rescript
  → Firecrawl scrape + Consultant Gemini
  → KV write: lead:{lid}:fast-intel
  → Event POST to THINK_BRAIN /event?callId={lid}
    → brain worker.ts /event handler (PartyKit headers)
      → BellaAgent DO receiveIntel()
        → configure({ pendingIntel }) if no session
        → applyIntel() if session active
```

---

## CRITICAL GOTCHAS

1. **Think brain is in SEPARATE directory** — `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/` — NOT in sandbox repo
2. **No git in Think brain dir** — deployed via wrangler, not version-controlled
3. **Poisoned DOs persist** — buggy deploy = corrupted DO state. Always FRESH lids.
4. **PartyKit headers mandatory** — `x-partykit-namespace` + `x-partykit-room` on every DO fetch
5. **configure() vs setState()** — configure = SQLite (hibernation-safe). setState = in-memory only.
6. **routeAgentRequest() is WS-only** — custom routes in worker.ts for HTTP
7. **session.search() is synchronous** — .d.ts L119-126
8. **configureSession returns Session, not SessionManager** — separate systems
9. **personalisedaidemofinal-sandbox is READ proxy** — never replace its URLs on demo page
10. **wrangler tail unreliable** — use /do/{lid}/debug for post-hoc observability

---

## PRIOR HANDOVER DOCS (read these for full context)

| Doc | What |
|-----|------|
| doc-handover-t9-enterprise-sprint-20260428.md | Enterprise sprint + full session context |
| doc-handover-t9-think-native-debug-20260428.md | Bugs 1-7, Think-native arch, canary results |
| doc-handover-t9-think-migration-complete-20260428.md | All 11 chunks, SDK verifications |
| doc-handover-t9-live-test-debug-20260428.md | Frontend URL fixes, live test debug |
| doc-handover-t9-observability-harness-20260428.md | Token/tool/turn metrics |
| spec-enterprise-scripting-observability-sprint-20260428.md | E1-E6 full spec |

---

## SDK VERIFICATIONS PERFORMED (carry forward)

| Feature | Source | Verified |
|---------|--------|----------|
| Session.search() | .d.ts L119-126 | Synchronous |
| Session.appendMessage(msg, parentId) | .d.ts | Tree branching |
| AgentSearchProvider | .d.ts | Auto-generates search_context + set_context |
| configureSession return type | think.d.ts | `Session \| Promise<Session>` only |
| SessionManager NOT usable with Think | think.js L52-54 | Think creates Session.create(this) internally |
| onChatRecovery | think.d.ts | Returns { persist?, continue? } |
| this.subAgent(Class, id) | sub-agents.md | Verified |
| Workspace({ sql, r2, name }) | @cloudflare/shell v0.3.3 | Verified |

---

## THIS SESSION'S ARCHITECTURAL CONTRIBUTIONS

1. **Verified all 11 chunks shipped** — source-level grep evidence for each
2. **Diagnosed WOW step initialization bug** — controller.ts advances to "wow" but never sets currentWowStep. Confirmed fix approach (raw state mutation in processFlow).
3. **Clarified refreshSystemPrompt() not needed on receiveIntel()** — beforeTurn() rebuilds system prompt every turn from live state. Red herring diagnosis redirected.
4. **Separated toolCalls=0 non-bug from stage advancement bug** — tools correctly not exposed in WOW stages. Real issue was advancement logic.
5. **Two-source merge validation flagged** — Trent's concern about WOW (MVPScriptBella) vs ROI/recs (NaturalBellaFROZEN) patterns. Investigation started, parked per Trent direction.
6. **Reconciled v6.12.2 timeline confusion** — flagged to T1 for T2 clarification.
