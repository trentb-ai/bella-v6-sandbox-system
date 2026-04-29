# Post-Compliance Sprint Roadmap — Prioritized (v2)
## 2026-04-28 AEST | Authority: Trent Belasco | Architect: T9
## D1 ID: roadmap-post-compliance-sprint-20260428
## Updated: 2026-04-28 ~17:30 AEST — added Think-native compliance architecture (C1)

---

## OPTIMAL EXECUTION ORDER

### 1. COMPLIANCE FIX DEPLOYS + 65/65 CANARY → SPRINT_COMPLETE *(in flight)*
- v3.16.2-think at T3A gate
- T3B regression after deploy
- Compliance test 6.2 fix: beforeTurn() TurnConfig.system injection (T9 arch ruling sent to T2)

### 2. FIRECRAWL STUB FIX *(P0 pipeline blocker)*
- fast-intel returning `source="stub"` — Firecrawl scrape never runs
- Blocks ALL live personalisation. No scrape data = no consultant data = generic Bella
- T5 was mid-investigation (reading `fast-intel/src/index.ts` scrape trigger logic)
- Unblocks everything downstream — every sprint after this is testable live

### 3. E1 + E4 PARALLEL — Rich Stage Policies + Memory Block Activation + Compliance Layer 1
- T9 has verbatim content ready
- Low risk, high impact — first real scripting upgrade
- ADR-002 T5 SDK preflight required before spec
- E1: Expand STAGE_POLICIES_TEXT + COMPLIANCE_RULES_TEXT + improv rules
- E4: Append memory activation to buildSoulContext() — FACT/COMMITMENT/OBJECTION/CORRECTION/PREFERENCE
- **NEW — Compliance Layer 1 (L1):** Stage-specific banned phrases + required language patterns injected via `beforeTurn()` → `TurnConfig.system`. Zero latency cost. Folds into E1 naturally — compliance rules ARE stage policies.
- **NEW — Compliance Layer 3 (L3):** History sanitization in `beforeTurn()` → `TurnConfig.messages` override. Scan prior assistant messages for known violation patterns, replace with clean versions. Model never reinforces its own bad patterns. ~5ms string scan per turn.

### 4. CONSULTANT MERGE M1 — Think Upgrade
> **Full spec:** `spec-consultant-merge-option-a-20260428` (D1 + BRAIN_DOCS)
> **Trent GO:** 2026-04-28

- **runFastAnalysis composite tool** — `Promise.all` of 4 parallel Gemini calls inside one tool execute(). Ports buildPromptCopy/ICP/Conversion/Research from standalone worker. ~3-5s latency preserved.
- **Think SDK upgrades:**
  - Dynamic context blocks — `addContext()` on intel arrival (sessions.md L218-229)
  - Writable analysis memory — survives compaction (sessions.md L170-175)
  - R2SkillProvider for industry KB — load only relevant vertical docs (sessions.md L193-198)
  - Full workspace tools — read/edit/grep/find/delete (tools.md L18-29)
  - `continueLastTurn()` for tier chaining (.d.ts L704)
- **BellaAgent wiring:**
  - `receiveIntel()` triggers `ConsultantAgent.runFastAnalysis()` via sub-agent RPC
  - `waitUntilStable()` for parent coordination (.d.ts L732)
- **Gate:** T3A Codex + canary. Both consultants running parallel. Compare output quality.
- **30 unused SDK features identified** — 10 high-value additions in this sprint

### 5. C1 — COMPLIANCEAGENT THINK-NATIVE UPGRADE *(Compliance Layer 2)*
> **Depends on:** M1 patterns proven (sub-agent upgrade playbook established)
> **T9 arch spec:** Think-native compliance architecture ruling (this session)

**Why here:** M1 proves the sub-agent upgrade pattern. C1 follows same playbook. L1+L3 (step 3) handle pre-generation and history. L2 is the post-generation GATE — catches anything L1 missed.

**ComplianceAgent upgrade — from 56 lines to full Think compliance officer:**

| Capability | SDK Source | What It Gives |
|---|---|---|
| Persistent violation memory | WritableContextProvider + `set_context` | Remembers every violation across ALL calls. Learns patterns. Gets SMARTER over time. |
| R2 compliance KB | R2SkillProvider (sessions.md L193-198) | Industry-specific compliance rules. Load relevant vertical per prospect. |
| FTS5 violation search | AgentSearchProvider | Search past violations by phrase/pattern/stage |
| Writable context blocks | sessions.md L170-175 | LLM writes compliance observations surviving compaction |
| Multiple tools | `scoreCompliance`, `checkPhrase`, `suggestRewrite`, `logViolation`, `searchViolations` | Full compliance toolkit (up from 1 tool) |
| Session with compaction | Session.create() + compactAfter() | Persistent compliance conversation history |
| `@callable()` methods | sub-agents.md | `checkResponse()`, `getViolationHistory()`, `isClean()` for parent RPC |
| Workspace | tools.md L18-29 | Store compliance reports, audit trail in R2 |

**BellaAgent wiring:**
- `onChatResponse()` calls `ComplianceAgent.checkResponse()` via `@callable`
- If FAIL → `continueLastTurn()` (.d.ts L704) with compliance context injected
- Model self-corrects. No fake user message. Clean correction loop.
- **Latency:** ~100-300ms. Decision for Trent: blocking (guaranteed clean) vs non-blocking via `ctx.waitUntil` (zero latency, catch-after).

**Gate:** T3A Codex + compliance canary (banned phrases in test prompts, verify catch rate)

### 6. E2 — Objection Detection + Recovery Injection
- Wire `objectionHandling` field in ConversationState (typed, zero logic wired)
- Detection in `beforeTurn()`, handling patterns per stage
- Benefits from better consultant data post-M1

### 7. E3 — WOW Quality Gating
- Gate `shouldAdvanceWowStep()` — currently returns `true` immediately
- Must check delivery quality before advancing
- File: `controller.ts`

### 8. CONSULTANT MERGE M2 — Cut
> **Full spec:** `spec-consultant-merge-option-a-20260428` (D1 + BRAIN_DOCS)

- Reroute fast-intel — remove consultant worker call, send raw scrape data only
- Remove consultant service binding from `fast-intel wrangler.toml`
- Kill `bella-consultant/worker.js` → frozen/deprecated
- **Gate:** T3B regression, 65/65 canary
- **Rollback:** `git checkout 6d3cc10` + redeploy fast-intel with binding restored

### 9. E5 — Script Conformance Assertions
- Config-driven conformance layer
- Stage+wowStep keyed assertions vs BELLA_SAID

### 10. E6 — Structured Observability + Alerts
- Latency tracking, consultant data arrival assertions, script delivery verification
- Sub-300ms latency alerts
- ComplianceAgent violation metrics + alert on repeat violations

---

## COMPLIANCE ARCHITECTURE SUMMARY (3 Layers — ALL Think-Native)

```
Layer 1 (PRE-GEN) — beforeTurn() TurnConfig.system injection
  ├── Stage-specific banned phrases
  ├── Required language patterns  
  ├── "NEVER say guarantee/definitely will/100%"
  └── Zero latency cost. Ships with E1 (step 3).

Layer 2 (POST-GEN GATE) — ComplianceAgent sub-agent check
  ├── Full Think sub-agent with memory/KB/search/workspace
  ├── Called via @callable checkResponse() from onChatResponse()
  ├── FAIL → continueLastTurn() self-correction loop
  ├── Persistent violation memory — gets smarter over time
  └── ~100-300ms. Ships with C1 (step 5).

Layer 3 (HISTORY SANITIZE) — beforeTurn() TurnConfig.messages override
  ├── Scan prior assistant messages for violation patterns
  ├── Replace with clean versions before inference
  ├── Model never reinforces its own bad patterns
  └── ~5ms string scan. Ships with E1 (step 3).
```

**No regex. No text mangling. No transport-layer hacks. 100% Think-native.**

---

## BACKLOG (non-blocking)
- WOW exit null-clear both branches (T9 Option A, 1 line, needs Trent GO)
- Debug endpoint hibernation (P2 — `this.cs` null after DO wake)
- 163 pre-existing test failures (processFlow/deriveTopAgents export mismatches)

## INFRA (opportunistic — T5 tackles while T2 specs)
- T3A bash hooks broken — "Hook JSON output validation failed"
- CF MCP disconnected — D1 offline some sessions

---

## SAFETY
- **Rollback commit:** `6d3cc10`
- **Branch:** `feat/prompt-enhancements-20260425`
- **Remote:** pushed to `origin/feat/prompt-enhancements-20260425`
