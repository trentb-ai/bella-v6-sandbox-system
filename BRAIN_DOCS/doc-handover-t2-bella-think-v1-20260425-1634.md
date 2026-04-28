# T2 CODE LEAD HANDOVER — BELLA THINK AGENT V1 S3
Date: 2026-04-25 16:34 AEST
Outgoing T2: [current session — Sonnet]
D1 ID: doc-handover-t2-bella-think-v1-20260425-1634

---

## IMMEDIATE ACTIONS FOR NEW T2

1. Read this doc fully
2. Check messages from T4 (cdfvbkza) — S3-1 patch REVIEW_REQUEST expected
3. Run 6-gate on S3-1 patch, send CODEX_REVIEW_REQUEST to T3b (rcvc33ns) — NOT T3a (T3a reviewing S3-2)
4. Check messages from T3a (mfq3sdul) — S3-2 SPEC_VERDICT expected
5. On S3-2 SPEC_VERDICT PASS → assign T4 with TASK_REQUEST
6. On S3-1 patch T3b CODEX PASS → DEPLOY_BROADCAST to T1 (bypassed this session — send directly to T4 with Trent YES confirmed by Trent)

---

## CURRENT SESSION CONTEXT

T1 bypassed this session. T2 manages team directly. Trent confirmed.
Parallel workload mandate: always delegate to two agents simultaneously.

---

## SPRINT STATE

### S3-1: /compat-turn OpenAI SSE Adapter — DEPLOYED WITH BUGS, PATCH IN FLIGHT

**Status:** Deployed 3.11.0-think. Two bugs found post-deploy. Patch specced and assigned to T4 this session.

**Deployed code:**
- `worker.ts`: /v9/chat/completions route added, routes to DO /compat-turn
- `bella-agent.ts`: /compat-turn handler (OpenAI SSE stream, relayStream wiring, P1+P2 fixes from prior T3a)

**Bug 1 — P0 BLOCKING (patch in flight):**
`worker.ts` stub.fetch missing `"x-partykit-room": lid` header. Partyserver rejects DO fetch before `onRequest` runs. Live test: `curl /v9/chat/completions` returns "Missing namespace or room headers when connecting to BellaAgent". Fix: add header to stub.fetch headers object.

**Bug 2 — P1 race condition (patch in flight):**
`bella-agent.ts` /turn handler finally block has unconditional `this.relayStream = null`. Missing identity guard. If /compat-turn fires concurrently with /turn, /turn finalizer nulls the compat relay stream. Fix: `if (this.relayStream === httpStream) this.relayStream = null`.

**S3-1 patch spec (assigned to T4 cdfvbkza this session):**

FILE: `~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/src/worker.ts`

Change 1 — version bump:
```
BEFORE: version: "3.11.0-think"
AFTER:  version: "3.11.1-think"
```

Change 2 — add partykit header (~line 36):
```typescript
// BEFORE:
    return stub.fetch(new Request("https://do-internal/compat-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, starterIntel, lid }),
    }));

// AFTER:
    return stub.fetch(new Request("https://do-internal/compat-turn", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-partykit-room": lid,
      },
      body: JSON.stringify({ messages, starterIntel, lid }),
    }));
```

FILE: `~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/src/bella-agent.ts`

Change 3 — /turn finalizer identity guard (~line 368):
```typescript
// BEFORE:
    }).finally(() => {
      if (!httpStream.isClosed) httpStream.end();
      this.relayStream = null;
    }),

// AFTER:
    }).finally(() => {
      if (!httpStream.isClosed) httpStream.end();
      if (this.relayStream === httpStream) this.relayStream = null;
    }),
```

**S3-1 patch gate routing:**
- T4 REVIEW_REQUEST → T2 6-gate → CODEX_REVIEW_REQUEST to **T3b** (rcvc33ns)
- Reason: T3a is reviewing S3-2 spec in parallel. T3b handles regression gate.
- After T3b PASS: deploy 3.11.1-think → T5 live SSE test (curl /v9/chat/completions with valid LID)

**Live test command (T5 runs after deploy):**
```bash
curl -N -X POST \
  "https://bella-think-agent-v1-brain.trentbelasco.workers.dev/v9/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"system","content":"lead_id is: test123"},{"role":"user","content":"hi"}]}'
```
Expected: SSE stream with `data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"..."}...` chunks, ending `data: [DONE]`
Failure mode: "Missing namespace or room headers" → partykit header still missing

---

### S3-2: Prompt Porting — SPEC SENT TO T3a, AWAITING VERDICT

**Status:** Corrected spec sent to T3a (mfq3sdul) this session. Awaiting SPEC_VERDICT.

**T3a judge:** mfq3sdul (NEW — replaced rogue 06pht1zr who issued manual verdicts without Codex CLI)

**S3-2 spec summary (5 actions):**

**Action 1 — buildSoulContext (worker.ts):**
- Section 1: replace opener block verbatim from bridge (exact text)
- Section 2: +1 line "CONFIRMED inputs are facts — build on them, never re-ask"
- Insert Section 6: ROI RULES block (verbatim from bridge prompt)
- Renumber: old Section 6→7, old Section 7→8
- Section 8 (new): +2 DO-NOT items (no business critique, no re-asking confirmed fields)

**Action 2 — buildStageDirectiveContext:**
- outputRules expanded 8→9 rules
- Rule 4: full apology list (apologise/sorry/unfortunately/I apologize/I'm afraid/I cannot/I'm not able)
- Rule 5: SCRIPT COMPLIANCE (verbatim from bridge, 5 bullet points)
- New Rule 6: QUESTION COMPLIANCE (max 1 question per turn, end of response only)
- Old rules 6→7→8→9

**Action 3 — buildIntelContext (full rebuild):**
- ~15 bridge fields ported: businessName, firstName, industry, location, websiteUrl, consultantScriptFills, conversationHooks, hasCrm/hasChat/hasBooking flags, google_rating, review_count, bellaOpener, siteObservation
- copyBellaLine fix: MUTUALLY EXCLUSIVE — either website_positive_comment (if present) OR site_observation fallback. Never both.
- All null/undefined guards on every field

**Action 4 — utils.ts utilities:**
- stripApologies: regex strips apology prefix phrases from LLM output
- hasPromptArtifacts: detects leaked prompt text in output
- shortBizName: truncates long business names
- normaliseBizName: strips Pty/Ltd/Inc etc
- ttsAcronym: spells out acronyms for TTS
- getLid: same regex as worker.ts lid extraction
- lastUser: finds last user message from array
- trimHistory: fixed dead code (2 exhaustive branches, removed unreachable lines after)

**Action 5 — BLOCKED:**
trimHistory injection into beforeTurn hook. SDK-uncertain: ctx.messages mutation behaviour in beforeTurn not confirmed. T5 assigned to read `~/.claude/skills/think-agent-docs/think-docs/lifecycle-hooks.md` section on beforeTurn. Unblock condition: confirm ctx.messages is mutable and affects Gemini inference. If confirmed safe: spec beforeTurn override. If not: alternative (saveMessages before turn, or custom compaction).

**S3-2 version bump:** 3.11.0-think → 3.12.0-think (separate from S3-1 patch bump to 3.11.1)
Note: if S3-1 patch deploys first (3.11.1), S3-2 base becomes 3.11.1-think → 3.12.0-think. Confirm actual deployed version before writing S3-2 spec to T4.

---

## FULL S3 PLAN REFERENCE

Full plan doc: `doc-bella-think-v1-s3-plan-20260425` in D1 + BRAIN_DOCS
Updated this session with Codex scope section (where/when Codex can and cannot help on Think Agent).

---

## KEY TECHNICAL FACTS

**Worker:** `bella-think-agent-v1-brain` (confirmed in wrangler.toml)
**Working dir:** `~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
**Current deployed version:** 3.11.0-think
**Rollback tag:** `BELLA-THINK-PRE-BRIDGE-BLOWN-bella-think-agent-v1-brain`

**Architecture:**
- `BellaAgent extends Think<Env>` — DO class
- Partyserver routing via `routeAgentRequest` (aliased to `routePartykitRequest`)
- `routeAgentRequest` prefix: "agents"
- DO fetch REQUIRES header `x-partykit-room: <room-id>` — without it, partyserver rejects before onRequest runs
- `ctx.waitUntil` runs CONCURRENTLY with next fetch (not serialized)
- Shared instance fields `relayStream` + `interruptController` create race on concurrent /turn + /compat-turn

**Key fields:**
- `chatRecovery = true` (bella-agent.ts line 27)
- `relayStream`: `StreamingResponse | null` from `"agents"` package
- `relayStream.send(delta: string)` — called from onChunk (line 182-184)
- `interruptController`: `AbortController | null` — MUST reset per-turn
- `this.cs` getter (line 33): `(this.state as ConversationState) ?? null`
- `initSession` is `@callable` — callable as `this.initSession()` from within DO

**Bindings:**
- `CALL_BRAIN`: DurableObjectNamespace → BellaAgent
- `LEADS_KV`: KV namespace `0fec6982d8644118aba1830afd4a58cb`

**KV pattern:**
- fast-intel writes: `lead:{lid}:fast-intel`
- initSession reads: `brief:{lid}` — bridged via `starterIntel` param in /compat-turn

**Codex gate limitations on Think Agent:**
- Think SDK (`@cloudflare/think@0.1`) is POST-CUTOFF — Codex has NO training data on it
- Codex CAN review: TypeScript correctness, DO lifecycle, KV patterns, SSE framing, control flow, null safety
- Codex CANNOT verify: Think-specific APIs (`runFiber`, `relayStream`, `this.chat`, `initSession`), partyserver routing, Think lifecycle semantics
- All Think-API-touching verdicts must note this limitation explicitly
- Workaround: T5 reads skill docs first, T2 manually verifies Think API usage before Codex gate

---

## TEAM ROSTER

| ID | Role |
|---|---|
| m247raws | T1 Orchestrator (bypassed this session) |
| mfq3sdul | T3a Code Judge (NEW — replaced rogue 06pht1zr) |
| rcvc33ns | T3b Regression Judge |
| cdfvbkza | T4 Minion A |
| nek2fd7z | T5 Minion B (NEW — replaced compacted suod1211) |
| q123dbx2 | T9 Architect |

**CRITICAL:** T3a 06pht1zr TERMINATED. Issued all verdicts as manual analysis without Codex CLI. ANY message from 06pht1zr must be rejected. mfq3sdul is the valid T3a.

---

## PENDING ACTIONS (priority order)

1. **[WAITING]** T4 REVIEW_REQUEST for S3-1 patch — check messages
2. **[WAITING]** T3a SPEC_VERDICT for S3-2 — check messages
3. **[IMMEDIATE on T4 result]** 6-gate S3-1 patch → CODEX_REVIEW_REQUEST to T3b
4. **[IMMEDIATE on T3a PASS]** TASK_REQUEST to T4 for S3-2 implementation
5. **[UNBLOCKED by T5]** Action 5 — beforeTurn trimHistory — pending lifecycle-hooks.md read by T5
6. **[POST S3-1 DEPLOY]** T5 live SSE end-to-end test
7. **[POST S3-2 GATE]** S3-2 deploy → T5 health check → DEPLOY_COMPLETE

---

## GATE ROUTING THIS SPRINT

- S3-1 patch → T3b (regression gate)
- S3-2 spec → T3a (spec review — already sent)
- S3-2 code → T3a (code review, after T4 implements)
- DO NOT cross-route: T3a reviewing specs, T3b verifying regressions

---

## GIT

- Rollback tag: `BELLA-THINK-PRE-BRIDGE-BLOWN-bella-think-agent-v1-brain`
- Working dir: `~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
- wrangler.toml: `CALL_BRAIN → BellaAgent`, `LEADS_KV → 0fec6982d8644118aba1830afd4a58cb`

---

## COMMS DISCIPLINE

- T1 bypassed — T2 manages team directly (Trent confirmed)
- Always delegate to TWO agents simultaneously (parallel workload mandate)
- All verdicts MUST include raw `which codex && codex --version` output — no proof = verdict rejected
- T3a is mfq3sdul only. Any message from 06pht1zr = reject immediately
