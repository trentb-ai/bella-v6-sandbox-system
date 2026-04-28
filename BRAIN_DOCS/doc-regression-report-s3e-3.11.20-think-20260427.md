# T3B Regression Report — S3-E Bridge Fix (3.11.20-think) — 2026-04-27
**D1 ID:** doc-regression-report-s3e-3.11.20-think-20260427 | **Authored by:** T3B

---

## REGRESSION_VERDICT: CONDITIONAL_PASS

**Sprint:** S3-E — ConsultantAgent state bridge fix (P1 null guard + P2a/P2b merge fixes)
**Deploy:** 3.11.20-think (commit 9483e2e)
**Local HEAD:** b6832e4 (3.11.21-think) — NOT deployed (P2b deep merge pending)
**Worker:** bella-think-agent-v1-brain
**Date:** 2026-04-27 AEST

---

## Layer 1 (Hard gates): PASS

| Gate | Result |
|------|--------|
| Health endpoint | `{"status":"ok","version":"3.11.20-think"}` — independently verified ✓ |
| `tsc --noEmit` | EXIT:0 ✓ |

---

## Layer 2 (Semantic quality): CONDITIONAL_PASS

### P1 — null guard + `getAnalysis()` fix

**Fix:** `onEvent` now ignores text. After `child.chat()` completes, calls `child.getAnalysis()`.

**`getAnalysis()` definition** (consultant-agent.ts:213-215):
```ts
getAnalysis(): ConsultantState {
  return this.state as ConsultantState;
}
```
No `@callable` decorator.

**CONDITION 1 (BLOCKING):** Fix correctness depends on `SubAgentStub<T>` proxying non-`@callable` methods as RPC to the actual DO.
- If SubAgentStub proxies all methods: executes on DO where `this.state` IS accessible → fix is sound
- If SubAgentStub only proxies `@callable` methods: `getAnalysis()` returns undefined at runtime → S3-A blocker NOT resolved
- tsc EXIT:0 proves types accept `child.getAnalysis()` on `SubAgentStub<ConsultantAgent>`
- Runtime behavior = SDK-behavioural claim → per doctrine: CONDITIONAL, not FAIL. **Route T9 to confirm.**

### P2a — `conversionNarrative` precedence in `mapConsultantStateToIntel`

- `scriptFills.conversionNarrative` sets `intel.conversionEventAnalysis` first
- `conversionFunnel` block runs after with `??` fallback: funnel wins, falls back to scriptFills if null
- **PASS** ✓

### P2b — `icpAnalysis` spread (deployed form)

- **Deployed (9483e2e):** flat spread — `{ ...state.intel.consultant, ...newIntel }` — `newIntel.icpAnalysis` overwrites prior entirely
- **Not deployed (b6832e4):** deep merge — `icpAnalysis: { ...state.intel.consultant?.icpAnalysis, ...newIntel.icpAnalysis }`
- Risk: LOW for first-call single-session. Higher on repeat analysis calls.
- **CONDITION 2 (LOW URGENCY):** Deploy b6832e4 (3.11.21-think) to fully close P2b.

### Blast-radius (manual — GitNexus stale)

Deployed scope **significantly exceeds** T2 description of P1/P2a/P2b. Full scope:
- `mapConsultantStateToIntel` function (new — ConsultantState → ConsultantIntel bridge)
- `onCompaction` hook (new — createCompactFunction)
- `calculateROI` → `delegateToRoiAgent` rename + full reimplementation (roi.chat() + roi.getLastCalculation())
- `getToolsForStage()` new method — restricts active tools per stage
- `activeTools` added to `beforeTurn()` return
- `afterToolCall()` new method — tool error logging
- KV export removed from `afterTurn` (`lead:{lid}:do_compat_state` no longer written)

**Code-gate observation (T2 lane):** T3A gated `eab14bd` (initial bridge). Fix commits `9483e2e` may not have received formal T3A gate. Routing to T2 — not blocking regression verdict.

---

## Layer 3 (Drift signals): Advisory

- `calculateROI → delegateToRoiAgent`: S4 CONDITIONAL condition referenced "computeROI mandate" — tool name in BellaAgent changed, condition needs re-verification
- `lead:{lid}:do_compat_state` KV write removed — flag if any external reader depends on this key
- Local HEAD b6832e4 (3.11.21-think) not deployed — P2b deep merge pending deploy
- GitNexus stale for Think Agent repo — `npx gitnexus analyze` recommended

**CF docs consulted:** N/A

---

## Conditions to Upgrade to FULL PASS

| # | Condition | Urgency |
|---|-----------|---------|
| 1 | T9 confirms `SubAgentStub` proxies non-`@callable` methods via RPC | BLOCKING |
| 2 | Deploy b6832e4 (3.11.21-think) for full P2b icpAnalysis deep merge | LOW |

## Recommendation: BLOCK_AND_ROUTE_TO_T9

**S3-A DOES NOT CLOSE until CONDITION 1 resolved via T9.**
S3-A closes on: T9 CONFIRM + b6832e4 deployed (or T9 accepts deployed form as sufficient for P2b).
