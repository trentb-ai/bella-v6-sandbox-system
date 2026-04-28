# T3B Regression Report — S3-A Sprint Close (3.11.21-think) — 2026-04-27
**D1 ID:** doc-regression-report-s3a-close-20260427 | **Authored by:** T3B

---

## REGRESSION_VERDICT: PASS — S3-A SPRINT CLOSE

**Sprint:** S3-A — ConsultantAgent Tier 1 tools (analyzeBusinessProfile, analyzeDigitalPresence, analyzeConversionFunnel)
**Final deployed version:** 3.11.21-think (b6832e4)
**Worker:** bella-think-agent-v1-brain
**Date:** 2026-04-27 AEST

---

## History

S3-A held CONDITIONAL since 3.11.17-think on blocker:
> `BellaAgent.runConsultantAnalysis` read JSON text from `onEvent`, but `ConsultantAgent` stores state via tools not text. `SubAgentStub<T>` excludes Agent base class properties — `child.state` NOT accessible post-`chat()`.

---

## Resolution Path

**S3-E bridge fix (3.11.20 → 3.11.21-think) deployed:**
- P1: null guard + `child.getAnalysis()` replaces JSON text parsing
- P2a: `conversionNarrative` precedence fix in `mapConsultantStateToIntel`
- P2b: `icpAnalysis` deep merge (b6832e4, 3.11.21-think)

---

## Condition Resolutions

### CONDITION 1 — T9 SDK CONFIRM ✓

`getAnalysis()` without `@callable` is correct pattern.

**Evidence (T9 via T2):**
- `subAgent()` returns `ctx.facets` co-located stub — NOT WebSocket RPC proxy
- `_cf_invokeSubAgent` (agents/dist/index.js:2106-2109) bypasses `_isCallable` gate entirely
- Production precedent: `ROIAgent.getLastCalculation()` + `clearLastCalculation()` have no `@callable`, working in production since 3.11.14-think

### CONDITION 2 — Deep merge deployed ✓

b6832e4 (3.11.21-think) deployed. `icpAnalysis` deep merge confirmed.

---

## Sprint Closure Summary

| Sprint | Version | Verdict |
|--------|---------|---------|
| S3-A ConsultantAgent Tier 1 | 3.11.17→3.11.21-think | **PASS** (bridge fix chain complete) |
| S3-B ConsultantAgent Tier 2 | 3.11.18-think | **PASS** |
| S3-E Bridge fix | 3.11.21-think | **PASS** (upgraded from CONDITIONAL) |

---

## Recommendation: MARK_COMPLETE

**Remaining open:** S4 CONDITIONAL condition (`computeROI`/`delegateToRoiAgent` mandate) — needs re-verification given tool rename in S3-E.
