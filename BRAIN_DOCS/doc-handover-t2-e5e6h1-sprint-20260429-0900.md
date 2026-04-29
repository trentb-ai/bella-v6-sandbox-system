# T2 Code Lead Handover — E5+E6+H1 Sprint
## 2026-04-29 ~09:00 AEST

---

## SESSION SUMMARY

New T2 session onboarded from prior T2 handover. E1-E4 sprint was CLOSED (T3B PASS, v3.17.0-think live). This session drove v3.18.0-think (H1+E5+E6) sprint. Sprint NOT YET CLOSED — awaiting T3A valid verdict (CWD issue blocking).

---

## SPRINT STATUS AT HANDOVER

### v3.18.0-think — H1+E5+E6
**Status:** T4 implemented, tsc EXIT 0. T3A verdict INVALID (wrong CWD). Re-gate in progress.

**What's implemented (T2 grep-verified):**
- L127: `checkConformance()` function ✓
- L140-143: LATENCY/STALL constants ✓
- L161: `private _turnStartMs = 0` class property ✓
- L405: `this._turnStartMs = Date.now()` in `beforeTurn()` ✓
- L644-648: bellaResponse = `result?.message?.parts` (pre-existing bug fixed) ✓
- L652: E5 conformance block in `onChatResponse()` ✓
- L670: E6 metrics block in `onChatResponse()` ✓
- L705: alerts cap at 100 ✓
- L985-988: H1 reverse().find() in test-turn handler ✓
- worker.ts: "3.18.0-think" ✓
- types.ts: conformanceLog, turnMetrics, alerts added ✓

**Next action:** T3A (xjra9344) re-gate with correct CWD. Then T4 deploy + T5 canary + T3B sprint close.

---

## BUGS FOUND + FIXED THIS SESSION

### BUG: bellaResponse pre-existing (P0 — compliance sub-agent never fired)
**File:** bella-agent.ts (was L625, now ~L644)
**Was:** `const bellaResponse = typeof result.text === "string" ? result.text : "";`
**Root cause:** `ChatResponseResult` has no `.text` field. Text is in `result.message.parts[].text`
**Fix:** `const bellaResponse = (result?.message?.parts ?? []).filter(p => p.type==='text').map(p => p.text??'').join('');`
**SDK proof:** think.js L730-731: `_fireResponseHook({ message: assistantMsg, requestId, status })` — `result.message` is UIMessage, `.parts` has text parts.
**Impact:** Compliance sub-agent at `if (bellaResponse.length > 10)` was NEVER firing. E5 conformance also needs this. FIXED in v3.18.0-think.

---

## CRITICAL GOTCHAS FOR NEW T2

### GOTCHA 1: T3A CWD bug (SUPREME PRIORITY)
Think Agent V1 brain is in a SEPARATE directory with a SPACE in the path:
```
/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/
```
NOT in:
```
/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/
```
T3A has hit wrong CWD twice this session despite explicit warnings. Before EVERY T3A gate, send them a `sed -n 'L,Lp'` verification command to confirm they're reading the correct file. Never accept a verdict without CWD confirmation.

### GOTCHA 2: ChatResponseResult shape
`onChatResponse(result)` — result shape (from think.js L730):
```typescript
{
  message: UIMessage,   // .parts[] has text/tool-call parts
  requestId: string,
  continuation: boolean,
  status: "completed" | "aborted" | "error"
}
```
`result.text` does NOT exist. Extract text via:
```typescript
(result?.message?.parts ?? []).filter(p => p.type === 'text').map(p => p.text ?? '').join('')
```

### GOTCHA 3: state.turnCount does not exist
ConversationState has `transcriptLog: string[]` not `turnCount`. Always use `state.transcriptLog.length`.

### GOTCHA 4: maxSteps = 10 (SDK default)
think.js L44: `this.maxSteps = 10`. BellaAgent does not override. Full tool round-trips complete within `saveMessages()` Promise.

### GOTCHA 5: Canary run variance
Run 3 cascade (31/65) was caused by Gemini key rotation mid-run. Pattern: Cat 1+8 (stateless) pass, first Gemini call fails, cascade. Not a code bug. Wait 5min after key changes before canary.

### GOTCHA 6: Extraction flakiness is test harness (H1 fixes it)
Cat 4 extraction failures in runs 1-2 were model non-determinism: Gemini sometimes ends turn with only tool-call message (no text). H1 fix (reverse().find()) resolves this.

### GOTCHA 7: GitNexus FTS read-only errors
Every bash command triggers FTS errors. Cosmetic — doesn't block. Fix: `npx gitnexus analyze` from sandbox dir. P2, do post-sprint.

---

## LEARNINGS

1. **SDK docs law is real** — `result.text` assumption cost 2 gate cycles. Always grep think.js for actual runtime behavior, not just .d.ts.
2. **T3A CWD must be verified every gate** — send verification grep before relying on verdict.
3. **Parallel T4+T3A works** — T4 implemented, T3A gated simultaneously. Saved ~15min.
4. **Two T3A sessions = waste on single gate cycle** — only useful with two independent code bundles.
5. **Pre-existing bugs must be fixed in same PR** — bellaResponse bug was pre-existing, fixed in v3.18.0-think per "never ignore failures" law.

---

## CURRENT PEER IDs (verify with list_peers — change per session)
- T3A: xjra9344 (active, mid re-gate)
- T3B: zrmc7vm6 (hot standby)
- T4: dsumpncb (standing by, implementation done)
- T5: l2rdznw3 (standing by)
- T9: si5znswi (standing by)

---

## IMMEDIATE NEXT ACTIONS

1. **Wait for T3A (xjra9344) verdict** — they were sent CWD correction + verification command
2. **If PASS** → send DEPLOY_AUTH to T4 → T5 canary (65/65 target) → T3B SPRINT_COMPLETE
3. **If FAIL** → fix only genuine new findings (verify CWD first before acting)
4. **After sprint close** → next sprint is M1 (consultant merge) per T9
5. **CF MCP was disconnected** — file this doc to D1 as `doc-t2-handover-session-20260429-0900` when MCP reconnects

---

## OPEN BACKLOG (post this sprint)

| Item | Priority |
|------|----------|
| GitNexus FTS fix (`npx gitnexus analyze`) | P2 |
| Debug endpoint hibernation (this.cs null after DO wake) | P2 |
| M1 Consultant merge (T9 approved, next sprint) | P1 |
| E5 P2 noise reduction (checkConformance heuristics) | P3 |
| E6 P2 tokenLog per-turn scoping | P3 |
| Gemini extraction hardening under key rotation (T3B mandatory) | P1 |

---

## WORKER HEALTH AT HANDOVER

| Worker | Version | Status |
|--------|---------|--------|
| bella-think-agent-v1-brain | 3.17.0-think LIVE / 3.18.0-think PENDING | T4 deploy pending T3A PASS |
| bella-think-agent-v1-bridge | thin-router-v1.2.0 | OK |
| fast-intel-v9-rescript | 1.19.0 | OK |
| consultant-v10 | 6.12.4 | OK |

**Frontend:** bellathinkv1.netlify.app
