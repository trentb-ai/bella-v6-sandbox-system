# SESSION REPORT — 2026-04-14 AEST
## mvpscriptbella Stack — Day 1 Build Session
Filed by: T1 Orchestrator | Authority: Trent Belasco

---

## STACK STATE AT SESSION START
- Source: frozen-bella-natural-v1 (bella-golden-v1 tag, commit 8e23c66)
- Script: canonical launch script v6.16.2 (moves.ts — 10 changes, 19/19 gates)
- Repo: github.com/trentb-ai/bella-script-v1, tag mvpscriptbella-deployed
- 7 workers deployed: mvpscriptbellabrain, mvpscriptbellabridge, mvpscriptbellavoice, mvpscriptbellafast-intel, mvpscriptbellascrape, mvpscriptbellaconsultant, mvpscriptbellatools
- All secrets confirmed set. All 7 workers healthy.

---

## DEPLOYED TODAY ✅

### brain v6.16.3 — Fix 1 (D7)
- File: flow.ts lines 729-737
- Change: WOW3 neutral sentiment else clause → confirmedICP=true
- Gated by: T3a PASS
- Status: LIVE on mvpscriptbellabrain

### deep-scrape v1.7.1 — Fix 4 (Apify geo)
- File: apify-actors.ts lines 70-71, 161, 167
- Change: countryFromLocation() default US → AU. TLD-based geo-hint for .au/.nz/.co.uk/.ca
- Gated by: T3a PASS
- Status: LIVE on mvpscriptbellascrape

---

## IN PROGRESS — brain v6.16.4 (Fix 2+3)

### What it does
- Fix 2 (SQ2): Remove phrase repetition WOW2→WOW3 (both stages pulling consultant.icpNarrative)
- Fix 3 (SQ8): WOW2 no-data branch → PATH A (canSkip:false, deliver trial offer without review rationale)

### Current state
- T3a gated the spec (6 passes, v6 final pass)
- T4 applied all 10 changes
- Vitest: 57 failures
- Root causes identified by T2:
  1. STALE .js FILES — brain/src/ may have compiled .js shadowing .ts. Tag mismatch ([WOW_CHAIN_SKIP] in output vs [WOW_SKIP] in flow.ts) confirms stale .js likely running. MUST delete before re-running vitest.
  2. wow_2 PATH A auto-advance bug — canSkip:false causes flow.ts auto-advance to skip past wow_3 all the way to wow_5. Spec flaw not caught by T3a.
  3. recDeepInsight scope error — CHANGE 1 in moves.ts broke variable scope used by recommendation stage (~3 failures)
  4. Pre-existing failures — gate.test.ts x2, budget_exhausted x2, T09 (~5 failures). Per law: must be fixed, not deferred.

### 57 failure classification (T2 preliminary)
- CATEGORY A (~20): anchor_acv, ch_alex, roi_delivery — likely stale .js
- CATEGORY B (~15): wow_5 instead of wow_3 — auto-advance spec flaw
- CATEGORY C (~3): recDeepInsight scope error
- CATEGORY D (~5): Pre-existing (gate.test.ts, budget_exhausted, T09)
- CATEGORY E (~10): wow_1 opener, close phrase, other expectation mismatches

### What needs to happen next session
1. DELETE stale .js files in brain/src/ FIRST (mandatory pre-flight)
2. Fix wow_2 auto-advance: flow.ts needs waitForUser:true OR explicit wow_3 advance guard
3. Fix recDeepInsight scope error in moves.ts CHANGE 1
4. Re-run vitest — expect ~15-20 failures to clear from stale .js fix
5. Spec remaining fixes → T3a/T3b gate (use BOTH judges in parallel)
6. T4 implements → T2 6-gate → T3 CODE REVIEW gate → T4 deploy
7. Fix ALL pre-existing failures — no deferrals

---

## SYNTHETIC HARNESS RESULTS (pre-fix)

### Phase 1 (16/16 PASS)
- Pipeline confirmed: Pitcher Partners identified correctly
- KV schema correct
- Event-driven intel delivery confirmed (INTEL_RECV, no KV polling)
- Consultant data clean: all scriptFills reached prompt

### Phase 2 Extended (29/37 — FAIL)
- D7: confirmedICP not set on neutral WOW3 utterance → FIXED in v6.16.3
- SQ2: phrase repetition WOW2→WOW3 → Fix 2+3 in progress
- SQ8: internal state exposed ("Google data isn't loaded yet") → Fix 2+3 in progress
- B9/B11 naming: harness spec stale (correct path names in this stack)

---

## LATENCY FINDINGS
- Synthetic TTFB: 1318-1541ms (misleading — cold start artifact)
- Live call TTFB: 490-702ms confirmed (doc-bella-natural-v1-frozen-20260410)
- Bridge already has reasoning_effort:"none" — thinking suppressed
- Latency is not a regression. Live call will confirm.
- A/B test (thinking on vs off) still pending after v6.16.4 deploys

---

## GOOGLE REVIEWS / APIFY STATUS
- Pitcher Partners HAS Google reviews (5 stars, 29 reviews confirmed in golden canary)
- Apify was defaulting to US geo → returning empty for AU businesses
- Fix 4 deployed: default AU + TLD inference
- Next session: verify Pitcher returns review data with v1.7.1

---

## WOW STAGE CLARIFICATIONS (Trent confirmed)
- Google reviews/social proof: WOW2 only (correct in this stack)
- WOW6: passthrough, canSkip:true, speak:'' — dead/archived
- No-data WOW2: deliver same offer word-for-word, no review rationale, no reputation question, no pipeline exposure

---

## PROTOCOL FIXES APPLIED THIS SESSION

### T1 Orchestrator prompt (t1_orchestrator.md)
1. Gate cycle monitoring: T1 must intervene after 2nd gate failure — not let it run to 6
2. No idle agents law: splitting work is T1's job, never Trent's to suggest
3. Compaction re-brief protocol: T4 held until T2 confirms spec in hand
4. Use both judges: T3a and T3b must be utilized simultaneously

### T2 Code Lead prompt (t2_code_lead.md)
1. No Codex CLI: T2 never runs Codex. T3a/T3b only.
2. Model: upgraded to Opus (takes effect next session)

### T3 Codex Judge prompt (t3_codex_judge.md)
1. GPT subscription law: Codex CLI must use ChatGPT Plus/Pro subscription, never API key

### Memory (auto-memory)
1. Spec grep-first protocol: mandatory rg before any spec touching flow flags
2. Never second-guess Trent: updated with today's latency incident

---

## PRE-EXISTING FAILURES (deferred queue — fix next session)
1. T09 golden.test.ts: wow_5 never sets trialMentioned or speaks trial
2. gate.test.ts: deriveEligibility website+ads → alex+chris (expected true to be false)
3. gate.test.ts: nextChannelFromQueue returns roi_delivery when all completed (expected 'close')
4. flow-integration: ch_alex budget_exhausted (expected false to be true)
5. flow-integration: multi-channel budget exhaustion (expected false to be true)

---

## TEAM ROSTER (this session)
- T1: T1 Orchestrator (this session)
- T2: b4m52ze1 (Sonnet, upgrading to Opus next session)
- T3a: lp1cx2tm (Codex Judge PRIMARY)
- T3b: ru9ql1vs (Codex Judge SECOND)
- T4: 774q57v1 (Sonnet Minion A — fresh launch after compaction)
- T5: mmd3nbnm (Haiku execution)

---

## OPEN ITEMS FOR NEXT SESSION (priority order)
1. brain v6.16.4: delete stale .js → fix auto-advance + recDeepInsight → re-gate → deploy
2. Fix all pre-existing failures (5 known)
3. A/B latency test: thinking on vs off (live call)
4. First live test call (after v6.16.4 deploys)
5. T3a codex login: run `codex login` for subscription auth (OAuth needed interactively)
6. Verify Apify geo fix returns Pitcher reviews

---

## WHAT WORKED
- Synthetic harness Phase 1: 16/16 clean
- Consultant data: clean, all scriptFills reaching prompt
- Event-driven intel delivery: confirmed working
- Fix 1 (D7) and Fix 4 (Apify geo): cleanly deployed
- T3a/T3b dual judge system: effective when used in parallel
- Pre-spec grep law: identified and locked in (saves 90min next session)
