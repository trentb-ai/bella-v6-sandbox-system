# T9 Architect Handover — E2 Objection Detection Upgrade Brief
## 2026-04-29 ~09:30 AEST | Outgoing: T9 (Opus) | For: Incoming T9 Architect
## D1 ID: doc-handover-t9-architect-e2-brief-20260429

---

## SESSION SUMMARY

This session onboarded from prior T9 (peer `si5znswi`), received full handover, audited current E2 state in source, and mapped all gaps for E2 upgrade spec. No code changes made. Handing off with complete source audit.

---

## PRIOR T9 HANDOVER (read this first)

**Full handover doc:** `BRAIN_DOCS/doc-handover-t9-architect-full-20260429.md`

Contains: all shipped work (E1-E4, E5+E6+H1, M1), architectural decisions (TOOL vs @callable, message protocol, continueLastTurn, state generics, context blocks, Promise.all safety, non-blocking compliance), SDK gotchas, execution plan, team roster, safety commits. **READ THAT DOC FIRST** — this doc builds on it.

---

## CURRENT STATE — WHAT'S DONE

### Sprint order (from prior T9, LOCKED):
```
DONE  ✓ M1 Consultant Merge (v3.19.0-think, T3B 65/65)
DONE  ✓ C1 ComplianceAgent Think-native (Trent confirmed done)
NOW   → E2 Objection Detection upgrade — SPEC NEEDED (this brief)
THEN  → E3 WOW Quality Gating
THEN  → M2 Consultant Cut
LATER → E5 Script Conformance upgrade
LATER → E6 Observability upgrade
```

---

## E2 SOURCE AUDIT — WHAT EXISTS vs WHAT'S MISSING

### SHIPPED (v3.18.0-think — all in bella-agent.ts)

| Item | Location | What it does |
|------|----------|-------------|
| `classifyUserIntent()` | L1690-1711 | Regex classifier → 6 categories: silence, hostile, objection, confused, deflection, engaged |
| `buildRecoveryDirective()` | L1713-1733 | Generic recovery text per category — NOT stage-aware |
| `lastIntent` field | types.ts L358 | `{ category, confidence, trigger? }` on ConversationState |
| `intentHistory` field | types.ts L359 | `Array<{ category, turn, ts }>` on ConversationState, capped at 30 |
| Intent tracking in beforeTurn() | L449-457 | Writes lastIntent + pushes to intentHistory when not 'engaged' |
| Recovery injection in beforeTurn() | L450, L466 | recoveryDirective appended to dynamicSystem prompt array |
| Stall detection | L698-700 | 3 consecutive silence intents → alert |
| Hostile alert | L702-703 | Hostile intent → alert in turnMetrics |
| `objectionHandling` on AgentBrief | types.ts L249 | String field on consultant output — EXISTS but NEVER WIRED |

### GAPS — WHAT E2 UPGRADE MUST ADDRESS

**GAP 1: Recovery directives are stage-blind**
- `buildRecoveryDirective()` returns same text regardless of stage
- "too expensive" in greeting (before any value shown) needs totally different handling than "too expensive" in close (after ROI delivered)
- Fix: stage param → per-stage recovery patterns

**GAP 2: Consultant objectionHandling data never feeds recovery**
- ConsultantAgent `prepareAgentBriefs` tool (consultant-agent.ts L548-563) outputs `objectionHandling: string | null` per agent
- `AgentBrief` interface has the field (types.ts L249)
- `agentBriefs` stored on ConsultantState (types.ts L267)
- BUT `buildIntelContext()` (L1790-1844) never reads agentBriefs or objectionHandling
- Fix: when objection detected AND stage is recommendation/channel/close, inject relevant agent's objectionHandling into recovery

**GAP 3: No objection memory across turns**
- Same objection raised 3x gets identical generic response every time
- `intentHistory` tracks categories but recovery doesn't read it
- Fix: `buildRecoveryDirective` reads intentHistory, escalates strategy on repeats

**GAP 4: Missing intent patterns**
- No competitor mentions: "we use [competitor]", "already have ServiceTitan"
- No timeline deferral: "call me next month", "not the right time"
- No authority deferral: "my partner decides", "need to check with boss"
- No price anchoring: "how much does it cost", "what's the price"
- These are distinct from generic "objection" — each needs different handling
- Fix: expand classifyUserIntent with new categories or sub-categories

**GAP 5: No typed objection tracking on state**
- Only raw `intentHistory` exists (category + turn + ts)
- No structured record of: which objections raised, how many times, which were addressed, which are still open
- Fix: add `objectionLog` to ConversationState — typed objection entries with resolution status

**GAP 6: No escalation logic**
- Repeated objections should trigger strategy shifts (e.g., after 3rd "too expensive" → offer to send proposal instead of continuing pitch)
- Consecutive hostile signals should trigger graceful exit faster
- Fix: escalation thresholds in buildRecoveryDirective

---

## KEY SOURCE LOCATIONS (exact lines for spec writer)

| File | Lines | What |
|------|-------|------|
| `bella-agent.ts` | L448-457 | beforeTurn() intent tracking + recovery injection |
| `bella-agent.ts` | L459-467 | dynamicSystem array — where recovery gets injected |
| `bella-agent.ts` | L682 | turnMetrics intent field |
| `bella-agent.ts` | L698-703 | Stall + hostile alert logic |
| `bella-agent.ts` | L1690-1711 | classifyUserIntent() — current 6-category regex |
| `bella-agent.ts` | L1713-1733 | buildRecoveryDirective() — current generic directives |
| `bella-agent.ts` | L1790-1844 | buildIntelContext() — consultant data rendering (missing agentBriefs) |
| `bella-agent.ts` | L1267-1326 | receiveIntel() — how consultant data arrives |
| `consultant-agent.ts` | L548-563 | prepareAgentBriefs tool — produces objectionHandling per agent |
| `consultant-agent.ts` | L1242 | getAgentBriefs() @callable — retrieves stored briefs |
| `types.ts` | L243-250 | AgentBrief interface with objectionHandling field |
| `types.ts` | L252-270 | ConsultantState with agentBriefs field |
| `types.ts` | L358-361 | ConversationState intent/engagement fields |
| `controller.ts` | (none) | No objection logic in controller currently |

---

## ARCHITECTURAL CONSTRAINTS (from prior T9 rulings)

1. **All changes go through beforeTurn()** — recovery directives injected via TurnConfig.system. This is the established pattern (E1 compliance, E2 basic). Don't invent new injection points.

2. **State fields must be optional + backward-compatible** — use `??` defaults. Existing sessions must not break.

3. **Regex classification stays** — no LLM call for intent detection. Must be <5ms. Gemini is for response generation, not classification.

4. **Recovery directives are SYSTEM PROMPT injections** — model reads them and adjusts response. Not tool calls. Not @callable. Not sub-agent.

5. **objectionHandling from consultant is PRE-COMPUTED** — it arrives via receiveIntel → consultant_ready. Available on `state.intel.consultant.agentBriefs[agentName].objectionHandling`. Wire it, don't recompute it.

6. **Think-native only** — all patterns must use Think primitives (beforeTurn, TurnConfig, setState). No raw Worker hacks.

---

## SPEC WRITING CHECKLIST (for new T9)

- [ ] Read `BRAIN_DOCS/doc-handover-t9-architect-full-20260429.md` — prior T9 full handover
- [ ] Read `BRAIN_DOCS/spec-e1-e4-stage-policies-memory-20260428.md` — original E2 spec (what shipped)
- [ ] Read `BRAIN_DOCS/roadmap-post-compliance-sprint-20260428.md` — execution order context
- [ ] Read `bella-agent.ts` L1690-1733 — current classifyUserIntent + buildRecoveryDirective
- [ ] Read `bella-agent.ts` L448-467 — current beforeTurn() injection
- [ ] Read `consultant-agent.ts` L548-563 — agentBrief objectionHandling output
- [ ] Grep `state.intel.consultant` in bella-agent.ts to see how consultant data flows
- [ ] ADR-002: T5 reads think.d.ts before spec touching Think SDK
- [ ] Spec format: BEFORE/AFTER code blocks (T4 implements verbatim)
- [ ] Files touched, CWD, version bump, risk assessment, gate instructions

---

## TEAM STATUS (as of handover)

| Terminal | Role | Peer ID | Status |
|----------|------|---------|--------|
| T2 | Code Lead | 6gq5q0j3 | Online — new session, requesting onboard |
| T3A | Code Judge | xjra9344 | Standing by for next gate |
| T3B | Regression Judge | zrmc7vm6 | C1 regression done |
| T4 | Minion | skiyqha2 | Online, awaiting brief |
| T5 | Execution | l2rdznw3 | Queued for SDK preflight |

---

## SAFETY

- **Rollback commit:** `6d3cc10` (pre-M1 safety snapshot)
- **Branch:** `feat/prompt-enhancements-20260425`
- **Remote:** pushed to origin
- **Golden restore:** `bella-golden-v1` tag, commit `8e23c66`

---

## KEY REFERENCE DOCS

| Doc | Location |
|-----|----------|
| Prior T9 full handover | `BRAIN_DOCS/doc-handover-t9-architect-full-20260429.md` |
| E1-E4 original spec | `BRAIN_DOCS/spec-e1-e4-stage-policies-memory-20260428.md` |
| C1 ComplianceAgent spec | `BRAIN_DOCS/spec-c1-compliance-agent-think-native-20260429.md` |
| M1 Consultant Merge spec | `BRAIN_DOCS/spec-m1-consultant-merge-think-native-20260429.md` |
| Post-compliance roadmap | `BRAIN_DOCS/roadmap-post-compliance-sprint-20260428.md` |
| Think SDK .d.ts | `~/.claude/skills/think-agent-docs/think-types/think.d.ts` |
| ConsultantAgent v2 blueprint | `BRAIN_DOCS/doc-bella-consultant-agent-v2-blueprint-20260427.md` |
