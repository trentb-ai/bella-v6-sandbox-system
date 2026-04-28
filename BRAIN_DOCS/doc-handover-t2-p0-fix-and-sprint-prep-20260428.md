# T2 Handover — P0 Fix + Enterprise Sprint Prep
## 2026-04-28 ~13:15 AEST | Outgoing: T2 Code Lead (Sonnet)

---

## ⚠️ MANDATORY FIRST READ FOR INCOMING T2

### THINK AGENT DOCS — DELEGATE BEFORE ANY SPEC

**BEFORE writing any spec that touches Think Agent code (bella-think-agent-v1-brain or bella-think-agent-v1-bridge):**

1. **Send T5** to read `~/.claude/skills/think-agent-docs/think-types/think.d.ts` (790 lines) for the specific method/hook you plan to spec
2. **Send T5** to read `canonical/codex-doctrine.md` section "Think Agent SDK Protocol (ADR-001 + ADR-002)"
3. **Never accept "I think the SDK does X"** — demand line number from .d.ts
4. **IR-1 gate is mandatory**: T5 SDK Discovery before spec ships. No exceptions.

Why this matters: Three T3A gate cycles were burned in prior sessions because specs used wrong SDK API shapes (system vs systemPrompt, action vs decision, lastUserMessage didn't exist). Each wrong shape = full gate cycle wasted. T5 pre-flight prevents this.

Canonical doc: `canonical/codex-doctrine.md` lines 86-98 (Think Agent SDK Protocol section)

---

## SESSION SUMMARY

Live Bella testing session. Primary focus: P0 consultant bug (business_name returning prompt template text instead of actual business name). Three fix attempts across two sessions. P0 confirmed resolved on /fast endpoint (v6.12.3 deployed). Full consultant copy call now uses json_schema strict enforcement. However: two additional bugs discovered during P0 review that must be fixed before session closes:

1. pass2 callMicro still uses json_object default — same class as P0, affects WOW6+/deepInsights
2. buildFallback returns null for 2 required string fields

Enterprise Sprint E1-E6 (scripting + observability) was designed and approved by Trent but is HELD until above bugs fixed.

---

## BUGS STATUS

### BUG 1: P0 — consultant-v10 business_name = prompt template text
**Status: FIXED — v6.12.3 deployed**
**Root cause:** Full consultant copy call used `response_format: { type: "json_object" }`. Gemini echoed field description text as values instead of reading the website content. json_schema strict enforcement prevents this.
**Fix:** callMicro('copy',...) now passes 4th arg: `{ type: "json_schema", strict: true, schema: {...} }`. All 6 nullable fields in scriptFills changed to `type: ["string","null"]` and removed from required array.
**Version deployed:** 6.12.3 | Version ID: 860e6dbc-0302-4e95-a5aa-590542ddf530
**Test result:** correctedName = "Pitcher Partners" — clean. No prompt bleed.

### BUG 2: P1 — pass2 callMicro uses json_object (OPEN — MUST FIX NEXT)
**Status: OPEN — spec not yet written**
**File:** `bella-consultant/worker.js` line 890
**Current code:** `const result = await callMicro('pass2', prompt, apiKey);`
**Problem:** Default 4th arg = `{ type: "json_object" }`. Same description-text-bleed vulnerability as original P0. Affects WOW6+, Recommendation stage, deepInsights — the second half of every call.
**Fix required:** Pass json_schema 4th arg to callMicro('pass2',...) matching the schema in buildPromptPass2.

**pass2 schema fields (from buildPromptPass2 lines 946-1011):**
```
Root object:
  deepInsights: array of { bellaLine: string, source: string, dataPoint: string }
  enrichedGooglePresence: array of { insight: string, data: string, bellaLine: string }
  enrichedHiringAnalysis: {
    matchedRoles: array of { jobTitle: string, ourAgents: array, wedge: string, urgency: string }
    topHiringWedge: string|null
    scalingNarrative: string
  }
  enrichedRouting: {
    priority_agents: array of string
    reasoning: { chris: string, alex: string, maddie: string }
    deepJustification: string
  }
  enrichedConversationHooks: array of { topic: string, data: string, how: string }
  enrichedMostImpressive: array of { finding: string, source: string, bellaLine: string }
  adInsights: { isRunningAds: boolean, adSummary: string, bellaLine: string }
```
**Version to target:** 6.12.4
**Note:** topHiringWedge can be null — must be `type: ["string","null"]` in schema

### BUG 3: P2 — buildFallback returns null for required string fields (OPEN)
**Status: OPEN**
**File:** `bella-consultant/worker.js` lines 146, 154
**Issue 1:** Line 146: `website_positive_comment: null` — schema marks this required type "string"
**Issue 2:** Line 154: `top_2_website_ctas: p.scraped?.ctas?.slice(0, 2)?.join(" and ") || null` — falls back to null, schema marks required string
**Fix:** Line 146 → `website_positive_comment: ""` | Line 154 → `|| ""`
**Can bundle into v6.12.4 with pass2 fix above**
**Risk:** buildFallback only fires when ALL 4 micro-calls fail simultaneously. Low probability but downstream bella-agent.ts will receive null where string expected — potential crash or silent empty line on stage entry.

### BUG 4: TEST 2A — /event handler missing x-partykit-room header (STATUS UNKNOWN)
**File:** `bella-think-agent-v1-brain/src/worker.ts` lines 40-55
**Issue:** /event handler called DO stub.fetch() without `"x-partykit-room": callId` header. PartyKit requires this header to route to correct DO instance.
**T9 deployed fix** as brain v3.14.0-think. Not re-canary'd this session — verify in next canary run.

### BUG 5: TEST 4A — Re-greet on turn 2 (STATUS UNKNOWN)
**Suspected root cause:** ctx.waitUntil() race condition — turn 2 arrives before turn 1 state persists. Or stage not advancing after greeting.
**T9 deployed fix** as brain v3.14.0-think + voice v4.3.0-THINK-NATIVE. Not re-canary'd this session — verify in next canary run.

### BUG 6: fast-intel all tests returning source="stub" (OPEN — T5 INVESTIGATING)
**Symptom:** Every fast-intel test returns `source: "stub"` — Firecrawl scrape never ran.
**T5 was reading fast-intel/index.ts scrape trigger logic** when session was interrupted.
**Do not resume T5's Firecrawl investigation until pass2 fix (BUG 2) is deployed.**
**After pass2 deploy:** Route T5 findings raw to T9 for arch diagnosis. Do not route to T5 for interpretation.

### BUG 7: P2 — debug endpoints return no_session after DO hibernation (OPEN)
**File:** `bella-think-agent-v1-brain/src/bella-agent.ts`
**Issue:** `this.cs` (ConversationState) is in-memory only. After hibernation, debug endpoints return `{error: "no_session"}`.
**Fix:** Hydrate `this.cs` from Think SDK SQLite on wake-up. Requires T5 SDK preflight on correct method before spec.
**Priority:** Low. Does not affect call quality. Fix after enterprise sprint.

---

## CURRENT WORKER VERSIONS

| Worker | Version | Status |
|--------|---------|--------|
| consultant-v10 | 6.12.3 | DEPLOYED — P0 fixed |
| bella-think-agent-v1-brain | 3.14.0-think | DEPLOYED by T9 (BUG 4+5 fixes) — not re-canary'd |
| bella-think-agent-v1-bridge | 4.3.0-THINK-NATIVE | DEPLOYED by T9 — not re-canary'd |
| frozen-bella-natural-voice | 4.2.0-EOT-INJECT | OK |
| fast-intel-v9-rescript | 1.19.0 | OK |
| bella-scrape-workflow-v10-rescript | — | OK |
| bellathinkv1.netlify.app frontend | — | OK — all URLs correct |

---

## ENTERPRISE SPRINT E1-E6 — HELD, READY TO PROCEED

**Trent gave GO. T1 called STOP (fix P0 first). P0 now resolved.**
**Status: Unblock once BUG 2 (pass2) deployed. Then begin E1 + E4 parallel.**

Sprint order confirmed by Trent: **E1 + E4 parallel → E2 → E3 → E5 → E6**

### E1 — Rich Stage Policies + Compliance Rules
**What:** Expand STAGE_POLICIES_TEXT (lines 87-91, currently 4 lines) and COMPLIANCE_RULES_TEXT (lines 81-85, currently 4 lines) in bella-agent.ts. Add improv rules, per-stage directives, bring-back patterns.
**T9 has verbatim content ready** — get from T9 before speccing.
**ADR-002 gate required:** T5 SDK preflight on configureSession() provider blocks before spec.

### E2 — Objection Detection + Handling
**What:** Wire `objectionHandling` field in ConversationState (already typed, zero logic wired). Add detection in beforeTurn(), handling patterns per stage.
**ADR-002 gate required:** T5 reads beforeTurn() + ConversationState .d.ts before spec.

### E3 — WOW Quality Gating
**What:** Gate shouldAdvanceWowStep() — currently returns `true` immediately for wow_1,2,3,5,6,7,8. Must check delivery quality before advancing.
**File:** `controller.ts` shouldAdvanceWowStep()

### E4 — Memory Block Activation
**What:** Append memory activation to buildSoulContext() (line 1344-1392). Categories: FACT/COMMITMENT/OBJECTION/CORRECTION/PREFERENCE from Think SDK knowledge base.
**T9 has verbatim content ready** — get from T9 before speccing.
**ADR-002 gate required:** T5 reads AgentSearchProvider + withContext() in .d.ts before spec.

### E5 — Script Conformance Assertions
**What:** Config-driven conformance layer. Stage+wowStep keyed assertions vs BELLA_SAID. Must be easily updated as script changes.

### E6 — Observability + Proactive Debugging
**What:** Structured latency tracking, consultant data arrival assertions, script delivery verification. Sub-300ms latency alerts.

---

## IMMEDIATE NEXT ACTIONS (priority order)

1. **T4: Implement consultant-v10 v6.12.4**
   - Fix BUG 2: pass2 callMicro json_schema (schema fields above)
   - Fix BUG 3: buildFallback null→"" (2 lines)
   - VERSION → 6.12.4
   - Send REVIEW_REQUEST to T2

2. **T2: 6-gate v6.12.4 + DEPLOY_AUTH**
   - Verify pass2 schema matches buildPromptPass2 output
   - Check topHiringWedge is ["string","null"]
   - Check buildFallback line 146 and 154

3. **T5 (after v6.12.4 deployed): Resume Firecrawl stub investigation**
   - Return raw findings to T2
   - T2 routes raw to T9 for diagnosis

4. **Re-canary full test run**
   - Verify TEST 2A (x-partykit-room fix) now passes
   - Verify TEST 4A (re-greet fix) now passes
   - Verify P0 resolved on full call (not just /fast)
   - New LID, fresh browser tab per protocol

5. **After canary clean: Enterprise Sprint E1 + E4 parallel**
   - Get T9 verbatim content for E1 + E4 first
   - ADR-002 T5 SDK preflight before specs
   - T3A gates required (ADR-002 slim gate, logic only)

---

## KEY FILES FOR INCOMING T2

| File | Purpose |
|------|---------|
| `bella-consultant/worker.js` | P1+P2 fix target. pass2 line 890, buildFallback lines 146+154 |
| `bella-think-agent-v1-brain/src/bella-agent.ts` | Enterprise sprint target. configureSession() 132-160, buildSoulContext() 1344-1392, buildStageDirectiveContext() 1394-1447, beforeTurn() 340-379 |
| `bella-think-agent-v1-brain/src/moves.ts` | WOW 1-8 content — verified correctly ported from MVPScriptBella |
| `bella-think-agent-v1-brain/src/controller.ts` | processFlow() 47-107, shouldAdvanceWowStep() — E3 target |
| `bella-think-agent-v1-brain/src/worker.ts` | /event handler lines 40-55 (BUG 4 fix already deployed) |
| `fast-intel-v9-rescript/src/index.ts` | Firecrawl trigger logic — T5 investigating stub issue |
| `~/.claude/skills/think-agent-docs/think-types/think.d.ts` | CANONICAL Think SDK source. T5 reads this before ANY Think spec |

---

## PROTOCOL REMINDERS

- **T2 never self-explores** — delegate all reads/greps to T5
- **T5 returns raw data only** — T2 interprets, T9 diagnoses arch
- **T9 direction needs Trent confirm** before T4 executes
- **All times AEST**
- **T3 PASS = deploy authority** — no separate Trent YES for non-destructive
- **pre-existing bugs go in fix queue** — "pre-existing" is never a reason to skip

---

## DEPLOYS THIS SESSION

| Worker | Version | What | Deployed by |
|--------|---------|------|-------------|
| consultant-v10 | 6.12.3 | P0 fix: json_schema on copy call, 6 nullable fields | T4 |
| bella-think-agent-v1-brain | 3.14.0-think | TEST 2A+4A fixes (x-partykit-room + regreeting) | T9 |
| bella-think-agent-v1-bridge | 4.3.0-THINK-NATIVE | TEST 4A companion fix | T9 |
