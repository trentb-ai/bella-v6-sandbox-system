# BELLA V7 — Status Report
### Date: 2026-04-05 | Authority: Trent Belasco
### Brain: v6.29.0 | Bridge: v6.28.0 | Fast-intel: v1.18.0 | Scrape: v1.7.0

---

## DEPLOYED FIXES (since Golden v1)

| Fix | Version | What |
|-----|---------|------|
| DO state isolation | v6.26.0 | leadId validation prevents cross-session data leakage |
| Bridge hang timeout | v6.27.0 | AbortSignal.timeout(8000) on DO service binding fetch |
| Deep intel merge | v6.28.0 | Bridge reads lead:{lid}:deep-status:v2 KV key |
| SQ2 trimHistory | v6.28.0 | Strip prior ASSISTANT turns to prevent Gemini phrase remixing |
| Extract normalized | v6.29.0 | Populate result.normalized so bridge receives real extracted data |

---

## OUTSTANDING BUGS (ON HOLD — CF Hybrid will address)

| # | Bug | Severity | Root Cause | CF Hybrid Fixes? |
|---|-----|----------|-----------|-----------------|
| 1 | Bridge hangs (Promise.all KV reads) | HIGH | deep-status:v2 read hangs, blocks entire chain | YES — no bridge middleman |
| 2 | Zero numeric data captured | MEDIUM | extractedInputs all null in live tests | MAYBE — depends on Gemini quality |
| 3 | No objection handling | MEDIUM | Bella ignores prospect corrections | NO — prompt/script quality |
| 4 | Generic language (no site data used) | MEDIUM | CTA text not referenced in conversation | PARTIALLY — better data flow |
| 5 | Bridge hang still occurs with timeout | LOW | Timeout makes it recoverable but not eliminated | YES — architecture change |

---

## TEST RESULTS SUMMARY

| Test | Version | Score | Stage Reached | WOW Steps | Hangs |
|------|---------|-------|---------------|-----------|-------|
| anon_fybi4g0u | v6.26.0 | 34/58 | close (full) | 8/8 | 1 hang |
| anon_ewrnpv2x | Golden v1 | ~15/58 | wow (stuck) | 6/8 | 9 hangs |
| anon_itmq5p4b | v6.29.0 | TBD | close (full) | 8/8 | 4 hangs (recovered) |

---

## TEAM PROTOCOL UPDATES (this session)

- Direct Delivery law — results go to requester, not through T1
- T2b sole code approval authority (PASS and FAIL)
- T2 = Codex Skill Advisor (suggests skills, no verdict authority)
- T2b owns ALL Codex + review skills (26+ skills)
- T1 receives overviews only, not raw data
- T0 Exec Coordinator prompt created (not yet launched)
- Alignment over activity — supreme law
- 120s agent pings
- No deploy without Trent approval

---

## NEXT: CF Hybrid Implementation

Shifting to CF_HYBRID_PLAN.md Phase 0. Current Bella V7 tagged as baseline.
All outstanding bugs on hold — CF Hybrid architecture eliminates most of them.
