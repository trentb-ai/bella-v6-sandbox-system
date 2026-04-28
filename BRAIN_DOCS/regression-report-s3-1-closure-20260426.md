# T3B Regression Report — S3-1 Sprint Closure — 2026-04-26

## Verdict: DEGRADED → MARK_COMPLETE_WITH_WARNING

**Sprint:** S3-1 compat-turn bridge adapter  
**Deploy:** bella-think-agent-v1-brain v3.11.1-think  
**Judge:** T3B Regression Judge (Sonnet)  
**Date:** 2026-04-26 AEST  
**Codex CLI:** 0.118.0 | Prior session: 019dc344-947e-74f3-b56a-5af44ae353f0  
**D1 status:** CF MCP disconnected — local mirror only

---

## Layer 1 — Hard Gates: PASS (partial)

✓ Live SSE test ran — no "Missing namespace or room headers" error  
✓ x-partykit-room header fix confirmed working  
✓ OpenAI chunk format structure correct (id, object, model, choices fields present)  
✓ [DONE] terminator present  
⚠ Evidence gap: only final STOP chunk in evidence (delta:{}, finish_reason:stop). No intermediate content chunks. Cannot confirm chat() produced actual tokens.

## Layer 2 — Semantic Quality: DEGRADED

- Empty delta in final chunk: if output was NOT truncated, chat() returned zero content. Cold-start test lid with no real intel context could explain this legitimately.
- Pre-existing onChunk/interrupt architecture risks remain (documented in doc-regression-report-s3-1-20260425). Not introduced by S3-1 patches.

## Layer 3 — Drift Signals: None new

## Recommendation: MARK_COMPLETE_WITH_WARNING

Sprint closes. Routing is proven. Standing warnings:
1. Confirm full SSE stream shows intermediate content chunks. If chat() returned empty, that is a separate issue — not a regression from S3-1 patches.
2. onChunk/interrupt turn-scoped isolation is outstanding architectural debt — schedule separately.
