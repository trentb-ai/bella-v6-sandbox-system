# Regression Report — M1 Consultant Merge
### Sprint: M1 Consultant Merge — Think-native runFastAnalysis
### Date: 2026-04-29 (AEST)
### Worker: bella-think-agent-v1-brain v3.19.0-think
### Commit: 1d304b4
### Deployed: 2026-04-28T22:10:53Z
### Judge: T3B Regression Judge (Sonnet)

---

## VERDICT: PASS → MARK_COMPLETE

---

## Layer 1 — Hard Gates (numeric, objective)

| Gate | Required | Actual | Result |
|------|----------|--------|--------|
| Canary total | 65/65 | 65/65 | ✅ PASS |
| Health/Version | 8/8 | 8/8 | ✅ PASS |
| Session Init + Intel Delivery | 10/10 | 10/10 | ✅ PASS |
| Stage Progression | 8/8 | 8/8 | ✅ PASS |
| Extraction | 8/8 | 8/8 | ✅ PASS |
| ROI + Sub-agents | 7/7 | 7/7 | ✅ PASS |
| Compliance | 8/8 | 8/8 | ✅ PASS |
| Close + Recovery | 8/8 | 8/8 | ✅ PASS |
| Debug Endpoints | 8/8 | 8/8 | ✅ PASS |

Baseline: 65/65 (v3.18.0-think). Zero regression.

**Layer 1 verdict: PASS**

---

## Layer 2 — Semantic Quality (interpretive)

### Blast Radius

**Note:** GitNexus index is stale (read-only DB error on FTS update — new M1 symbols `runFastAnalysis`, `runConsultantAnalysis` not indexed). Manual blast radius substituted.

M1 change scope: 4 files, +1026 / -22 lines.

| File | Change type | Blast risk |
|------|------------|------------|
| `src/consultant-agent.ts` | NEW file (576 lines) | NEW DO type — zero existing callers |
| `src/bella-agent.ts` | +417 lines | Additive: new `runConsultantAnalysis()` + beforeTurn gate branch |
| `src/worker.ts` | +53 lines | Additive: new export + existing endpoints unchanged |
| `scripts/canary-test.ts` | 2 lines | Version bump only |

**beforeTurn gate analysis** (consultant-agent.ts:88-107):
- New `[FAST_ANALYSIS]` branch at top of `beforeTurn()` 
- Guard: `if (isFastAnalysis && (!cs || cs.analysisVersion === 0))` — fires only on first pass
- Falls through to full existing logic if condition false — existing behaviour fully preserved

**State mutation safety:**
- Spread-merge pattern on all state objects: `{ ...(cs.fieldX ?? {}), ...newData }` — preserves prior state
- allFailed sentinel: `cs.analysisVersion = -1` — one-way (cannot return to 0), correct
- Gate re-entry protection: `analysisVersion === 0` check prevents double-fire

**Call chain change:**
- `runConsultantAnalysis()` called at bella-agent.ts:1256 via `ctx.waitUntil(...catch)` — fire-and-forget, non-blocking to session
- BellaAgent → ConsultantAgent via `this.subAgent()` — scoped DO, no shared state contamination

**Actual blast radius vs spec:** Matches. Additive-only. No existing call chains broken.

### Semantic Quality

Canary ROI + Sub-agents category (7/7) confirms ConsultantAgent execution path functional at test level.

BELLA_SAID transcripts: pending from T4 at time of verdict. Qualitative speech check deferred. Not blocking given:
1. Canary functional coverage of sub-agent path is complete
2. M1 changes are internal consultant analysis (feeds system prompt enrichment), not direct speech output
3. No existing Bella speech paths modified

**Layer 2 verdict: PASS**

---

## Layer 3 — Drift Signals (advisory, non-blocking)

1. **GitNexus stale** — read-only DB error prevents FTS index update. New M1 symbols not indexed. T5 must run `npx gitnexus analyze` in `bella-think-agent-v1-brain/` per Sprint Close Protocol before handover. Sprint cannot close with stale index.

2. **ctx.waitUntil for consultant + WoW prep** — `runConsultantAnalysis` (bella-agent.ts:1255) and `runWowPrep` (bella-agent.ts:1463) both use `ctx.waitUntil` fire-and-forget. This is V2 bug #5 pattern (fire-and-forget extraction). For non-extraction flows (consultant analysis, WoW prep), this is acceptable per V3 design. However: if consultant results are intermittently absent under edge conditions (DO eviction during long analysis), this pattern could silently fail. Monitor in live runs.

3. **BELLA_SAID pending** — T4 to forward wrangler tail transcripts. Recommend T2 verifies qualitative output once received, even post-sprint-close.

**Layer 3 verdict: No blockers. Advisory items filed.**

---

## CF Docs Consulted

N/A — regression not CF-behaviour-related. Layer 1 failures absent; Layer 2 anomalies trace to code change scope, not CF runtime behaviour.

---

## Evidence Summary

- Canary output: 65/65 PASS (0 failed) — provided by T2
- Source verification: manual read of bella-agent.ts:1240-1466, consultant-agent.ts:85-333, worker.ts:1-63
- Blast radius: manual (GitNexus stale — read-only DB)
- Baseline: 65/65 v3.18.0-think

---

## Recommendation: MARK_COMPLETE

**Pre-completion mandatory:** T5 must run `npx gitnexus analyze` in `bella-think-agent-v1-brain/` before T2 writes handover.
