# BELLA FLOW HARNESS — AUTONOMOUS TEST SUITE
# Self-iterative: write tests → run → fix → re-run → until green
# Scope: flow.ts, flow-constants.ts, flow-audit.ts + integration with index.ts

---

## READ THESE FILES FIRST (in order)

1. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/vitest.config.ts` — test runner config
2. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/__tests__/helpers.ts` — existing mock helpers (mockState, mockIntel)
3. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/__tests__/scenarios.test.ts` — existing scenario tests (understand the pattern)
4. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/flow.ts` — THE HARNESS (your test target)
5. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/flow-constants.ts` — constants + skip table
6. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/flow-audit.ts` — audit helpers
7. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/types.ts` — all types including FlowResult, PendingDelivery, FlowEntry
8. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/state.ts` — initState defaults
9. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/moves.ts` — buildStageDirective (read first 30 lines for imports/signature)
10. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/src/gate.ts` — shouldForceAdvance, maxQuestionsReached, etc.
11. `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do/scripts/smoke-test.sh` — existing HTTP smoke tests

Also read the existing test files to understand patterns:
- `src/__tests__/extract.test.ts`
- `src/__tests__/gate.test.ts`
- `src/__tests__/moves.test.ts`
- `src/__tests__/roi.test.ts`

---

## CONTEXT

The Bella Flow Harness v5.0 is deployed across 4 chunks:
- v4.9.1: types + state + audit scaffolding
- v5.0.0: processFlow() replaced 207-line switch block
- v5.1.0: delivery resolution + alarm timeout + /debug
- v9.26.0: bridge deliveryId + failed + retries

We need a comprehensive test suite that validates the harness works correctly.This is NOT about testing moves.ts or gate.ts (those have existing tests). This is about testing the NEW flow control layer.

---

## YOUR TASK — AUTONOMOUS LOOP

You will work in a self-iterative loop:
1. **Write tests** for a test group
2. **Run tests:** `cd /Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do && npx vitest run`
3. **If tests fail:** Read the errors, determine if it's a TEST bug or a CODE bug
   - If TEST bug: fix the test
   - If CODE bug: fix the code in flow.ts / flow-constants.ts / flow-audit.ts / types.ts / state.ts
   - NEVER fix bugs in moves.ts or gate.ts — those are not your concern
4. **Re-run tests** until the group is green
5. **Move to next test group**
6. **After all groups green:** Run the full suite AND the smoke test
7. **Report:** Summary of what was tested, what bugs were found and fixed, final pass/fail

DO NOT STOP until all tests pass or you've identified a genuine architectural issue that needs human decision.

---

## TEST GROUPS TO WRITE

### Group 1: `flow-constants.test.ts` — Skip Table + Constants

```
Test: shouldSkipWowStep returns { skip: false } for always-deliver steps (wow_1, wow_5, wow_7, wow_8)
Test: shouldSkipWowStep returns { skip: true, reason: 'no_google_rating' } for wow_2 when no rating in intel
Test: shouldSkipWowStep returns { skip: false } for wow_2 when rating IS present
Test: shouldSkipWowStep returns { skip: true, reason: 'no_icp_data' } for wow_3 when no consultant ICP
Test: shouldSkipWowStep returns { skip: true, reason: 'no_conversion_data' } for wow_4 when no conversion data
Test: shouldSkipWowStep returns { skip: true, reason: 'no_scrape_data' } for wow_6 when no tagline/hero
Test: shouldSkipWowStep returns { skip: false } for wow_6 when tagline OR hero present
Test: WOW_STEP_ORDER has exactly 8 entries in correct sequence
Test: MIN_WOW_DWELL is 2
Test: MAX_DELIVERY_ATTEMPTS is reasonable (2-3)
Test: DELIVERY_TIMEOUT_MS is 15000
```

### Group 2: `flow-audit.test.ts` — Audit Trail

```
Test: appendAudit adds entry with monotonic seq
Test: appendAudit enforces FIFO cap (add 600 entries, verify only last 500 remain)
Test: auditDirectiveIssued creates correct entry shape
Test: auditStageAdvanced includes from/to/reason/completionMode
Test: auditStepSkipped creates correct entry for wow skip
Test: auditStaleEvent logs received vs expected deliveryId
Test: auditCallDegraded logs consecutive timeout count
Test: all audit entries have ts, turnId, action, stage fields
```

### Group 3: `flow-delivery.test.ts` — Delivery Gate + Resolution

```
Test: canAdvanceAfterDelivery returns { canAdvance: true } when no pending delivery
Test: canAdvanceAfterDelivery with pending + waitForUser + user spoke → marks completed, returns canAdvance true
Test: canAdvanceAfterDelivery with pending + waitForUser + empty transcript → returns canAdvance false, reissue true
Test: canAdvanceAfterDelivery with pending + status already 'completed' → returns canAdvance true
Test: canAdvanceAfterDelivery with pending + status 'barged_in' + waitForUser → canAdvance true (implicit success)
Test: canAdvanceAfterDelivery with pending + status 'barged_in' + !waitForUser → canAdvance false (monologue interrupted)
Test: canAdvanceAfterDelivery with pending + status 'failed' + attempts exhausted → canAdvance true (escape hatch)
Test: canAdvanceAfterDelivery with pending + status 'failed' + attempts remaining → canAdvance false
Test: resolveDeliveryCompleted with matching deliveryId → status becomes 'completed', resets consecutiveTimeouts
Test: resolveDeliveryCompleted with mismatched deliveryId → returns false, logs stale event
Test: resolveDeliveryCompleted when status already != 'pending' → returns false (first-valid-event-wins)

Test: resolveDeliveryBargedIn with matching deliveryId → status becomes 'barged_in'
Test: resolveDeliveryBargedIn with mismatched deliveryId → returns false

Test: resolveDeliveryFailed with matching deliveryId → status becomes 'failed'
Test: resolveDeliveryFailed when already resolved → returns false

Test: resolveDeliveryTimeout when pending + attempts < max → increments attempts, returns reissue true
Test: resolveDeliveryTimeout when pending + attempts exhausted → marks timed_out, returns reissue false
Test: resolveDeliveryTimeout when already resolved → no-op (idempotent alarm guard)
Test: resolveDeliveryTimeout increments consecutiveTimeouts, triggers degraded at threshold
```

### Group 4: `flow-process.test.ts` — processFlow() Core Transitions

```
Test: greeting → wow on user speech
Test: greeting stays if no transcript
Test: wow → advances through steps on user speech
Test: wow chain-skip: skips wow_2 when no rating, lands on next non-skippable
Test: wow chain-skip: skips multiple consecutive steps (wow_2, wow_3, wow_4 all missing data)
Test: wow exits to recommendation when all steps completed
Test: wow minimum dwell: logs dwell_floor_triggered if <2 steps delivered
Test: recommendation → anchor_acv on user speech (builds queue)
Test: anchor_acv → first channel when acv captured
Test: anchor_acv stays if acv is null
Test: channel stage advances when shouldForceAdvance is true
Test: channel stage advances when maxQuestionsReached + stuck
Test: channel stage completionMode is 'complete' when force advance
Test: channel stage completionMode is 'budget_exhausted' when budget hit
Test: channel stage completionMode is 'stuck_escape' when stuck past budget
Test: optional channel (ch_sarah/ch_james) routes back to optional_side_agents
Test: roi_delivery → optional_side_agents on user speech
Test: optional_side_agents → ch_sarah if prospectAskedAboutSarah
Test: optional_side_agents → ch_james if prospectAskedAboutJames
Test: optional_side_agents → close if no optional pending
Test: close is terminal (no advancement)
```

### Group 5: `flow-integration.test.ts` — Delivery Gate + Advancement Combined

```
Test: processFlow with pending delivery blocks advancement (reissues directive)
Test: processFlow with pending + user speech on waitForUser step → clears gate + advances
Test: processFlow with barged_in monologue → does NOT advance, returns directive for current stage
Test: Full conversation simulation: greeting → wow (with skips) → recommendation → anchor → alex → roi → close
  - Verify flowLog has complete chain of directive_issued + stage_advanced entries
  - Verify completedStages array is correct at end
  - Verify no gaps in audit trail
Test: Sparse data simulation: all optional wow steps skipped → dwell floor triggers → recommendation reached
Test: Budget exhaustion: ch_alex gets 4 questions with no data → completionMode=stuck_escape → advances
```
### Group 6: Smoke Test Update

After all vitest groups pass, update the existing smoke-test.sh OR create a new one:

```bash
# Add these HTTP contract tests to scripts/smoke-test.sh:
# Test /debug endpoint exists and returns flow harness state
# Test /turn returns flowResult shape with advanced + stage fields
# Test /event with delivery_failed type returns { status: 'resolved' } or { status: 'stale' }
# Test /event with delivery_barged_in type returns { status: 'resolved' } or { status: 'stale' }
# Test /health returns current version
```

---

## UPDATE helpers.ts

The existing `mockState` and `mockIntel` may need updates for the new flow harness fields. Check if `initState` now includes `pendingDelivery`, `flowLog`, `flowSeq`, `consecutiveTimeouts`. If so, `mockState` should work as-is since it spreads `initState`. If not, add defaults.

Also add a helper:

```typescript
export function mockPendingDelivery(overrides?: Partial<PendingDelivery>): PendingDelivery {
  return {
    deliveryId: 'test-turn:test-move',
    moveId: 'test-move',
    turnId: 'test-turn',
    stage: 'greeting' as StageId,
    wowStep: null,
    status: 'pending',
    waitForUser: true,
    hasSpeak: true,
    attempts: 1,
    issuedAt: Date.now(),
    ...overrides,
  };
}
```

---

## RULES FOR THE AUTONOMOUS LOOP

1. **Write → Run → Fix → Re-run.** Do not write all tests then run once. Work group by group.
2. **If a test reveals a CODE BUG in flow.ts:** Fix it. This is expected. Log what you fixed.
3. **Do NOT fix moves.ts or gate.ts.** If tests fail because of those, adjust the test expectations.
4. **Do NOT modify the test runner config** unless necessary for imports.
5. **Keep tests fast.** No network calls. No timeouts. Pure unit tests against exported functions.
6. **After each group passes:** Run `npx vitest run` for the FULL suite to catch regressions.
7. **After ALL groups pass:** Run `bash scripts/smoke-test.sh` against the deployed worker.
8. **Final report format:**

```
## FLOW HARNESS TEST RESULTS

### Test Groups
| Group | Tests | Pass | Fail | Bugs Found |
|-------|-------|------|------|------------|
| flow-constants | X | X | 0 | none |
| flow-audit | X | X | 0 | none |
| ... | ... | ... | ... | ... |

### Bugs Found and Fixed
1. [file:line] — [what was wrong] — [how it was fixed]
2. ...

### Full Suite
- vitest: X/X passed
- smoke-test: X/X passed

### Remaining Issues
- [anything that needs human decision]
```

---

## GO

Start with Group 1. Work autonomously. Don't stop until everything is green or you need a human decision.
