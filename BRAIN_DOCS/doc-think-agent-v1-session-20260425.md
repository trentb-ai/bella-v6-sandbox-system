# Think Agent V1 Brain — Session Report
**Date:** 2026-04-25 AEST
**Session type:** Sprint 1 canary execution — deploy + HTTP route verification
**Worker:** `bella-think-agent-v1-brain`
**Working dir:** `~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
**Team:** Charlie Team (T1 Orchestrator, T2 Code Lead, T3 Codex Judge, T3B Regression Judge, T4 Minion A, T5 Minion B, T9 Architect)

---

## What We Were Building

Think Agent V1 Brain — a Cloudflare Durable Object worker using the `@cloudflare/think@0.4.0` SDK. `BellaAgent` extends `Think` which extends `Agent` (agents SDK) which extends `Server` (partyserver).

**Sprint 1 goal:** Fix version string → deploy → health check → canary steps (intel POST, first turn, debug state).

---

## Bugs Found — Sequence of Discovery

### Bug 1 — Wrong entrypoint file (wasted 3 gate cycles)

**Root cause:** T2 specced `src/index.ts` across 3 rounds. Actual entrypoint is `src/worker.ts` per `wrangler.toml main` field. All 3 deploys were dead code no-ops.

**Evidence:** `wrangler.toml` contains `main = "src/worker.ts"`. `src/index.ts` contains legacy V2-rescript routing code (`const VERSION = 'v6.16.1'` at line 67) — it is not the entrypoint.

**Fix applied:** Pre-spec checklist item added — T5 greps `wrangler.toml main` field before ANY worker file edit. Memory saved to `feedback_verify_wrangler_entrypoint.md`.

**Protocol fix:** wrangler.toml pre-flight is now mandatory before any worker spec.

---

### Bug 2 — Wrong SDK method for DO forwarding (getServerByName)

**Root cause:** Spec used `getServerByName` (not in agents public API). Then corrected to `getAgentByName` — but this also fails.

**Root cause (deeper):** `getAgentByName → getServerByName → idFromName + .get() + .setName() → returns stub`. `stub.fetch()` does NOT inject the namespace/room headers that partyserver requires. HTTP forwarding via stub = broken.

**Fix:** Use `routeAgentRequest(request, env)` — the CF-official routing function. It calls `routePartykitRequest` internally which injects the required namespace/room headers. `worker.ts` simplified to:
```typescript
return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
```
T3 PASS'd. Waiting to deploy together with bella-agent.ts onRequest() fix.

---

### Bug 3 — @callable is WebSocket RPC only (no HTTP /fn/ handler)

**Root cause:** T9's original canary plan (steps 3-6) called `/fn/receiveIntel`, `/fn/processBridgeTurn` etc. These don't exist. The `@callable` decorator in the agents SDK dispatches via WebSocket RPC ONLY. The `if (isRPCRequest(parsed))` branch in `onMessage` handles it — there is NO HTTP `/fn/` handler registered anywhere.

**Impact:** Canary steps 3-6 were entirely invalid. All would 404.

**Fix:** BellaAgent needs `onRequest()` override — CF-documented HTTP handler for Think agents. All HTTP routes (/intel, /turn, /debug, /state, /interrupt) handled here via `url.pathname.endsWith()` checks.

**Architecture clarification from T9:** `@callable` = WebSocket RPC. `onRequest()` = HTTP API. Sprint 3 /v2-compat adapter calls `onRequest /turn` (HTTP), NOT `/fn/processBridgeTurn` (WebSocket RPC). These are distinct transport layers.

---

### Bug 4 — pathname === vs .endsWith() (T3 caught — RESOLVED)

**Root cause:** First onRequest() spec used `url.pathname === "/intel"` etc. Partyserver does NOT strip the DO prefix from the URL before calling `onRequest()`. `BellaAgent.onRequest` receives the FULL path: `/agents/call-brain/{callId}/intel`.

**Evidence:** Think SDK source uses `.endsWith("/get-messages")` not `=== "/get-messages"`.

**Impact:** All 5 route checks silently fail → 404 on every HTTP call to the DO. Intel POST, turn, debug, state, interrupt all broken.

**Fix:** All 5 checks changed to `.endsWith()`. T3 PASS'd (full 3-pass, Codex CLI 0.118.0). Deployed. Canary confirmed 200 on all routes.

---

## Architectural Clarifications (from T9 + CF docs)

| Concept | Clarification |
|---------|--------------|
| `routeAgentRequest` | CF-official HTTP routing. Routes `/agents/{namespace}/{name}/{path}` → DO's `onRequest()`. Injects namespace/room headers partyserver requires. |
| `BellaAgent.onRequest()` | CF-documented HTTP override. Receives FULL path — partyserver does NOT strip prefix. |
| `@callable` | WebSocket RPC ONLY. Dispatched via `isRPCRequest(parsed)` in `onMessage`. No HTTP `/fn/` route exists. |
| `getAgentByName` | Thin wrapper → `getServerByName` → stub. `stub.fetch()` lacks namespace/room headers. NOT correct for HTTP forwarding. |
| `StreamingResponse` | WebSocket-tied class (`new StreamingResponse(connection, id)`). `.send()` writes WebSocket RPC message. Cannot use directly in HTTP `onRequest()`. |
| Duck-typed HTTP stream | For `/turn` onRequest: use `ReadableStreamDefaultController.enqueue()` to duck-type StreamingResponse interface. `relayStream.send(ctx.chunk.textDelta)` at lines 182-183 works with this. |
| partyserver namespace | `CALL_BRAIN` binding → `camelCaseToKebabCase` → `call-brain` (confirmed utils.js:43: `str.toLowerCase().replace(/_/g, "-")`). |
| Sprint 3 /v2-compat | 40-60 line adapter on worker.ts. Translates Deepgram OpenAI SSE → Think Agent DO onRequest /turn. NOT a separate worker. |

---

## Protocol Violations Caught and Corrected

1. **T2 suggested streamlining T3 gate for "minor" changes** — T1 pushed back citing LAW 4 and prior session where T2 passed 3 broken versions. T2 withdrew recommendation. T3 immediately proved its value by catching the .endsWith() bug.

2. **T3 performed grep tasks (T5-class work)** — T3 self-flagged. Future reads go to T5 only. T3's role: review only.

3. **T3 verdict missing Codex CLI proof** — First T3 PASS lacked `which codex && codex --version` output. T2 correctly rejected per memory law (`feedback_codex_proof_on_verdicts.md`). T3 reissued with proof.

4. **T2 relayed "no new 6-gate needed" shortcut** — T1 caught. Protocol: every resubmit requires full 3-pass gate regardless of fix size.

---

## Key File Locations

| File | Role | Status |
|------|------|--------|
| `src/worker.ts` | **ACTUAL ENTRYPOINT** (wrangler.toml main) | Deployed ✓ |
| `src/bella-agent.ts` | Core BellaAgent DO | onRequest() deployed ✓ |
| `src/index.ts` | NOT entrypoint — legacy V2 code | Never edit |
| `package.json` | version: "3.8.0-think" | Deployed ✓ |

**DO binding:** `env.CALL_BRAIN` → `BellaAgent` (camelCase → kebab-case → `call-brain` namespace)

---

## Sprint 1 — COMPLETE

**Deployed:** `bella-think-agent-v1-brain` v3.8.0-think
**Version ID:** `4f9a6f52-08da-483c-9ac9-6a17c8a92f79`
**URL:** `https://bella-think-agent-v1-brain.trentbelasco.workers.dev`
**Deployed:** 2026-04-25 ~01:42 AEST

**Canary results (test ID: canary_1777081338):**

| Step | Route | HTTP | Result |
|------|-------|------|--------|
| Health | `/health` | 200 | `{"status":"ok","version":"3.8.0-think",...}` ✓ |
| Intel POST | `/agents/call-brain/{id}/intel` | 200 | `{"status":"no_session"}` ✓ |
| Debug | `/agents/call-brain/{id}/debug` | 200 | `{"error":"no_session"}` ✓ |
| Turn POST | `/agents/call-brain/{id}/turn` | 200 | SSE stream opened ✓ |

`no_session` on routes 2-4 is **correct and expected**. `initSession` is `@callable` (WebSocket RPC only) — must be invoked via WebSocket before HTTP data routes have state. Routing is proven live.

**T3 replacement mid-session:** T3 pf7cpb6b went offline after issuing PASS. New T3 = bgsougg2 (Opus). T1 confirmed prior PASS verdict stands — full 3-pass with CLI proof, issued before offline. No resubmit needed.

**T2b onboarded:** New Code Lead T2b (plmqdfdp) brought online, full handover sent, running parallel track (runWowPrep debounce fix).

---

## Next Steps

### Sprint 2 (T1 GO required)
- `abortSubAgent` — verify `ctx.facets` exists in Think SDK
- `compactAfter(8000)` — verify experimental API hasn't changed
- `keepAliveWhile` — grep broader codebase for usage pattern
- WowAgent P0 race conditions

### Sprint 3 (after S2 COMPLETE + T1 GO)
- T5 discovery first: StreamingResponse wire format, `initSession` idempotency, `starterIntel` shape
- `/v2-compat` adapter spec: ~40-60 lines on worker.ts
- Translates Deepgram bridge OpenAI SSE format → Think Agent DO onRequest /turn
- NOT a separate worker

### Post-Sprint (architecture)
- Wire V2-rescript bridge → Think Agent V1 Brain via /v2-compat
- Decommission old brain (call-brain-do-v2-rescript) after full canary

---

## Memory Files Written This Session

- `feedback_verify_wrangler_entrypoint.md` — Check wrangler.toml main field before any worker file edit
