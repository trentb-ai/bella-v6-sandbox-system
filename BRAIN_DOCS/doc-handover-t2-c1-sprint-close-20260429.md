# T2 Code Lead Handover — C1 Sprint Close (Regression Fix)
## 2026-04-29 ~00:00 AEST

---

## SPRINT STATUS AT HANDOVER

### C1 ComplianceAgent + Regression Fix — CLOSED
**Deployed:** bella-think-agent-v1-brain v3.20.3-think  
**Canary:** 65/65 PASS (live worker, bellathinkv1.netlify.app)  
**Commit:** `9737c77` — pushed to main  
**Tags:** `v3.19.1-think` → `1d304b4`, `v3.20.3-think` → `9737c77`

---

## WHAT SHIPPED THIS SESSION

### Regression Fix — v3.20.3-think (on top of C1)
T3B found 64/65 regression (6.2 "no false guarantee language") immediately after C1 deploy.

Root cause: C1 deleted synchronous BANNED_IN_OUTPUT check, replaced with async-only ComplianceAgent. Async fires after response delivered → first response not intercepted.

Fix path:
- Round 1: Restored sync BANNED_IN_OUTPUT check → T3A FAIL Q2+Q5 (double-correction race, turn key unreliable)
- Round 2: Turn-scoped dedup via `lastBannedCorrectionTurn` (number) → T3A FAIL Q1+Q5 (`transcriptLog.length` stalls on continuation turns + empty output)
- Round 3: UUID-scoped dedup `complianceTurnId = crypto.randomUUID()` → T3A PASS → 65/65

Final implementation in bella-agent.ts:
```typescript
// L709 — per-invocation UUID (stall-immune)
const complianceTurnId = crypto.randomUUID();

// L734 — async guard
if (!freshState || freshState.complianceCorrecting || freshState.lastBannedCorrectionTurnId === complianceTurnId) return;
freshState.lastBannedCorrectionTurnId = complianceTurnId;

// L779 — sync guard
const BANNED_IN_OUTPUT = /\b(guarantee|definitely will|definitely would|promise you)\b/i;
if (BANNED_IN_OUTPUT.test(bellaResponse) && !state.complianceCorrecting && state.lastBannedCorrectionTurnId !== complianceTurnId) {
  state.lastBannedCorrectionTurnId = complianceTurnId;
  ...
}
```

types.ts: `lastBannedCorrectionTurnId?: string` in BellaState

---

## PROCESS IMPROVEMENTS THIS SESSION

### LAW: Parallel judges mandatory (codified in TEAM_PROTOCOL.md)
T3A (logic) + T3B (regression/blast radius) must run in parallel on every re-gate cycle. T3B idle while T3A gates = process violation. T2 sends both briefs simultaneously.

### LAW: T3B canary = post-deploy only (identified this session)
Pre-deploy canary is zero signal — tests old deployed code. T3B canary fires ONLY after deploy confirmed. Pre-deploy = T3A Codex only.

### LAW: Git commit gate before sprint close (codified in TEAM_PROTOCOL.md)
Every deployed version committed before sprint declared closed. Multiple versions = separate commits oldest-first. This session: 3 deployed versions sat uncommitted until EOD.

---

## CRITICAL GOTCHAS (carry forward)

1. **Think brain path has SPACE** — `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
2. **`transcriptLog.length` unreliable as turn key** — continuation turns skip user push (L409 `!ctx.continuation` guard), empty output skips assistant push (L766 `if (messageText)` guard). Always use `crypto.randomUUID()` for per-invocation keys.
3. **`@callable` Promise wrapper** — always add `.catch(reject)`. Executor throw doesn't auto-propagate.
4. **onDone reads stored state** — never recompute pass/score. Store at write time.
5. **Canary base URL** — pass as `process.argv[2]`, not env var. `npx tsx scripts/canary-test.ts https://[worker-url]`
6. **`definitely` (solo) passes 6.2** — test checks `definitely will` phrase only. Bella uses "definitely" 3x in transcript. Not a violation but worth watching.
7. **T5 summary drift** — T5 returned "Key findings:" summaries multiple times this session instead of raw output. Fresh T5 on next sprint.
8. **T9 went offline** — si5znswi not found when routing Q3 arch question. T2 made arch call directly.

---

## SDK VERIFICATION NOTES

Q3 (T3A finding) — `continueLastTurn` targeting:
- T3A claimed SDK auto-pins `targetAssistantId`. T5 verified: FALSE.
- think.js:860 uses `getLatestLeaf()` only. No SDK-side pinning.
- Race risk (concurrent turn between checkResponse + continueLastTurn) assessed LOW in sequential voice context.
- Q3 accepted risk, no implementation change.

---

## WORKER HEALTH AT HANDOVER

| Worker | Version | Status |
|--------|---------|--------|
| bella-think-agent-v1-brain | 3.20.3-think LIVE | 65/65 ✅ |
| bella-think-agent-v1-bridge | thin-router-v1.2.0 | OK |
| fast-intel-v9-rescript | 1.19.0 | OK |
| consultant-v10 | 6.12.4 | OK (standalone, fallback until M2) |

**Frontend:** bellathinkv1.netlify.app

---

## NEXT SPRINTS

| Sprint | Work | Priority |
|--------|------|----------|
| E2 | Objection Detection — pattern match transcriptLog, route to ROIAgent | High |
| M2 | Consultant Cut — remove standalone bella-consultant/worker.js | Medium |
| E3 | WOW Quality Gating — gate WOW delivery on scrape data quality score | Medium |

---

## D1 FILING STATUS

| Doc | Status |
|-----|--------|
| C1 sprint progress (previous session) | Filed |
| C1 handover (previous session) | Filed |
| C1 regression report (this session) | PENDING — file on new session startup |
| This handover doc | File to D1 as `doc-handover-t2-c1-regression-close-20260429` |

---

## AGENT STAND-DOWN

All agents stand down per sprint-end law.
New T2: read this doc + TEAM_PROTOCOL.md + canonical/codex-doctrine.md on startup.
T3B: stand down. Next canary fires post-deploy on E2.
T4: stand down.
T5: stand down — fresh T5 recommended (summary drift observed).
