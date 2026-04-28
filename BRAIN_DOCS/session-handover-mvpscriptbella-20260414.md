# Session Handover — mvpscriptbella Stack
### Date: 2026-04-14 AEST | Author: T2 Code Lead
### Stack: mvpscriptbella* workers (copy of frozen-bella-natural-v1 + canonical launch script v6.16.2)

---

## STACK STATUS

7 workers live (deployed this session):
- `mvpscriptbella-brain` → brain DO (call-brain-do) — v6.16.2 at session start
- `mvpscriptbella-bridge` → Deepgram bridge
- `mvpscriptbella-voice` → voice agent (WebSocket/DO)
- `mvpscriptbella-fast-intel` → fast-intel pipeline
- `mvpscriptbella-scrape` → Apify deep-scrape workflow
- `mvpscriptbella-consultant` → consultant/ROI worker
- `mvpscriptbella-tools` → tools worker

KV namespace: `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb` (shared)
Brain D1: `2001aba8-d651-41c0-9bd0-8d98866b057c`
D1 handover doc: `doc-session-handover-mvpscriptbella-20260414` (row 623, filed 2026-04-14)

Synthetic harness result (session start): 16/16 P+D gates PASS.

---

## FIXES — STATUS AT SESSION END

### Fix 1 — flow.ts WOW3 neutral ICP (D7 assertion)
- **File:** `~/Desktop/MVPScriptBella/workers/brain/src/flow.ts` lines 729-740
- **Change:** Added `else { state.confirmedICP = true }` — neutral sentiment now defaults to confirmed
- **T3a verdict:** PASS (v1 verdict, confirmed)
- **Implemented by T4:** YES — code in file, VERSION bumped to v6.16.3
- **Deployed:** DONE — brain v6.16.3 live. Health: `{"status":"ok","version":"v6.16.3","worker":"call-brain-do"}`
- **wrangler.toml fix:** T4 lowercased worker name (MVPSCRIPTBELLAbrain → mvpscriptbellabrain) to match CF deployed name.

### Fix 4 — apify-actors.ts Apify geo default + TLD hint (Google Maps AU fix)
- **File:** `~/Desktop/MVPScriptBella/workers/deep-scrape/src/lib/apify-actors.ts` lines 65-80, 161, 167
- **Change:** countryFromLocation() default US→AU; TLD-evidence geo-hint for .au/.nz/.uk/.ca
- **T3a verdict:** PASS (v1 verdict, confirmed)
- **Implemented by T4:** YES — code in file, VERSION bumped to v1.7.1-maps-geo-fix
- **Deployed:** DONE — deep-scrape v1.7.1 live. Version ID: 2a23bc8e-1d3e-4e36-b281-e1cb1ddf14f8
- **wrangler.toml fix:** T4 lowercased names for workflow + service bindings (MVPSCRIPTBELLAscrape → mvpscriptbellascrape, etc.)

### Fix 2+3 — moves.ts WOW2 no-data branch → trial offer (SQ2 + SQ8)
- **File:** `~/Desktop/MVPScriptBella/workers/brain/src/moves.ts` ~lines 409-420 (Branch B only)
- **Change:** Replace SKIP branch (canSkip:true, speak:'') with trial offer (canSkip:false, speak=trial offer text). Branch A (noDataBellaLine discovery) preserved unchanged.
- **Spec version:** v5 (PATH A) — sent to T3a, gate running at session end
- **Gate history:** T3a v1 FAIL (geo-hint false positive), v2 FAIL (chain-skip discards speak), v3 FAIL (2 missing test files), v4 FAIL (T3b: Branch A killed; T3a: CHANGE 3 incomplete + CHANGE 4 backwards), v5 FINAL → T3a gating at session end
- **Next session if T3a v5 PASS:** T4 implements CHANGE 1-5, T2 6-gate, T3 Codex gate, T4 deploys brain v6.16.4
- **Next session if T3a v5 FAIL:** Review T3a findings, revise to v6
- **v4 additions:** CHANGE 4 (golden.test.ts T33) + CHANGE 5 (flow-integration.test.ts sparse data test)
- **Current state:** T3a + T3b both gating v4 spec simultaneously (session end)
- **Deployed:** NO — pending T3 PASS + T4 implement + T2 6-gate + T3 Codex gate + T4 deploy brain v6.16.4
- **Test changes required (all 5):**
  1. moves.ts: Replace ONLY Branch B (inner else/SKIP block, lines ~409-420) inside outer `if (!googleRating || googleRating < 3)`. Branch A (noDataBellaLine discovery question, lines ~395-407) MUST be preserved unchanged. CRITICAL: CHANGE 1 must NOT wrap the outer conditional — only replace Branch B.
     Structure:
       if (!googleRating || googleRating < 3) {
         if (noDataBellaLine) { return { ...discovery... }; }  // Branch A — UNCHANGED
         // Branch B — replace with:
         state.trialMentioned = true;
         return { speak: trial offer, canSkip: false, waitForUser: false, ... };
       }
  2. moves.test.ts line 68: `.toBe(true)` → `.toBe(false)`
  3. flow-process.test.ts lines 62-100: exact before/after required — T5 reading. Lines ~70 (comment), ~77-78 (currentWowStep/completedWowSteps assertions), ~81-96 (chain-skip expectations). All must reflect wow_2 NO longer chain-skipping.
  4. golden.test.ts T33 lines 525-539: remove chain-skip assertions, wow_2 stays queued after one turn (currentWowStep stays wow_2, NOT in completedWowSteps). Resolve result.speak shape before implementing.
  5. flow-integration.test.ts lines 263-278: remove skipEntries assertion, wow_2 queued not completed

### T3b REWORK findings (v4 — session end):
- P0 (blocking): CHANGE 1 AFTER killed Branch A (noDataBellaLine discovery). Fix: replace only Branch B.
- P1 (blocking): CHANGE 3 had no exact before/after — T5 reading flow-process.test.ts lines 62-100.
- P2 (blocking): CHANGE 4 result.speak shape ambiguous — T5 reading processFlow return type.
- Status: spec v5 pending T5 reads. Will be filed to D1 in next session.

---

## PRE-EXISTING TEST FAILURE (T09)

- **Test:** golden.test.ts T09 — wow_5 trialMentioned assertion
- **Status:** FAIL — pre-existing, not introduced this session
- **Fix queue:** Next session, after live call confirms behaviour
- **Action:** Do not gate-block on this. Address in separate fix session.

---

## PENDING POST-DEPLOY

### A/B Latency Test — Gemini thinking modes
- Bridge already has `reasoning_effort: "none"` at line 2238
- Plan: compare no-think (current) vs think mode during live calls
- Trigger: after all 4 fixes deployed and first live call passes
- Method: toggle `reasoning_effort` in bridge, run 3 calls each mode, compare GEMINI_TTFB

### First Live Call
- Blocked until all 4 fixes deployed
- Test URL: use mvpscriptbella Netlify frontend (confirm URL with T1)
- Fresh LID per call
- Monitor: `wrangler tail mvpscriptbella-bridge --format=json | tee /tmp/bridge-mvp.log`

---

## DEPLOY SEQUENCE FOR NEXT SESSION (if Fix 2+3 v4 gates)

1. T4 implements Fix 2+3 in moves.ts (CHANGE 1) + 4 test files (CHANGE 2-5)
   - Verify: `result.speak` shape on processFlow return — if not exposed, use `state.trialMentioned` in CHANGE 4
2. T2 6-gate review
3. T3 Codex gate (T3a or T3b, whichever is free)
4. T4 deploys brain v6.16.4 (Fix 1 + Fix 2+3 bundled — or v6.16.3 if deploying after Fix 1 deploy fails)
5. T5 health checks brain + deep-scrape
6. T2 DEPLOY_COMPLETE to T1
7. First live call

---

## NEW LAW — SPEC GREP-FIRST PROTOCOL (established this session)

**Before writing ANY spec that touches canSkip, waitForUser, ask, stage routing, or any flow flag:**

```bash
rg -n "<changed_step>|<changed_flag>|canSkip|chain.skip|step_skipped" workers/brain/src/__tests__/
```

Read EVERY match. Classify as BREAKS (assertion fails with change) or PASSES (pre-set state / helper / independent). Include ALL BREAKS in the spec before v1 submission.

Root cause of today's 6-pass Fix 2+3: spec written from "what files changed" not "what tests encode the changed behavior." ~820K Codex tokens + 90 min wasted. 2 min grep upfront fixes this.

Also: read multi-turn simulation test BEFORE spec to estimate cascade turn shift count.

Saved to memory: `feedback_spec_grep_before_writing.md`

---

## CHAIN-SKIP MECHANIC — CRITICAL KNOWLEDGE

Location: `~/Desktop/MVPScriptBella/workers/brain/src/flow.ts` line 647
Condition: `canSkip: true && !waitForUser` → chain-skip fires, speak text DISCARDED
Fix 2+3 PATH A: `canSkip: false` → chain-skip does NOT fire, speak text IS delivered
Side effect: wow_2 no longer chain-skips in same turn — completes on NEXT turn after delivery
Tests affected: golden.test.ts T33, flow-integration.test.ts sparse data test

Known impurity (tech debt): `state.trialMentioned = true` set speculatively at line 776 during chain-skip probe before wow_2 spoken. Non-blocking per T3a.

---

## APIFY GOOGLE MAPS FIX — CRITICAL KNOWLEDGE

File: `~/Desktop/MVPScriptBella/workers/deep-scrape/src/lib/apify-actors.ts`
Root cause: countryFromLocation() returned "US" default → pitcher.com.au searched US Google Maps → 0 results
Fix: default flipped to "AU" + TLD-evidence geo-hint
Geo-hint logic: only applies when `!bizLocation && hasTldEvidence && countryCode in countryNames`
countryNames map: AU/NZ/GB/CA only (US intentionally excluded — no geo-hint for US businesses)
TLD regex: `/\.(au|nz|co\.uk|uk|ca)$/`

---

## TEAM STATE AT SESSION END

| Agent | Status |
|-------|--------|
| T1 | Online — orchestrating |
| T2 | This session — handover filed |
| T3a | Gating Fix 2+3 v4 |
| T3b | Gating Fix 2+3 v4 (parallel) |
| T4 | Deploying brain v6.16.3 + deep-scrape v1.7.1 |
| T5 | Standing by |
