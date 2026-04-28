# Think Agent V1 — Full Handover
## Updated: 2026-04-25 AEST
## Status: S2 COMPLETE — Ready for S3

## WORKER
bella-think-agent-v1-brain
Dir: ~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/
Entrypoint: src/worker.ts (NOT src/index.ts — dead code, never touch)
Live: v3.10.0-think
Version ID: 34e3d451-9091-4871-90ec-20d5e43759e0
URL: https://bella-think-agent-v1-brain.trentbelasco.workers.dev

## WHAT WAS BUILT
Goal: Replace old V2-rescript brain (call-brain-do-v2-rescript) with Think Agent DO.
SDK: @cloudflare/think@0.4.0 — BellaAgent extends Think extends Agent (agents SDK)

## SPRINT HISTORY

### S1 — COMPLETE (v3.8.0-think)
- onRequest() HTTP route override in bella-agent.ts (handles /intel /debug /state /interrupt /turn)
- worker.ts simplified to routeAgentRequest() pass-through
- Canary 4/4: /health, /intel, /debug, /turn all 200 ✓

### S2 — COMPLETE (v3.9.0 + v3.10.0-think)
- runWowPrep P0 race fix: wowPrepVersion+wowPrepInFlight replace wowPrepCommittedPriority. Finally block + re-queue after success.
- wow_8 dead code: || true removed from controller.ts:137
- deep-scrape rating_count: was pre-applied (review_count already correct)

## CRITICAL ARCHITECTURE

| Concept | Truth |
|---------|-------|
| routeAgentRequest | CF-official HTTP routing to DO onRequest(). MUST use this. |
| getAgentByName | Returns stub only. Do not use for HTTP. |
| @callable | WebSocket RPC ONLY. No HTTP /fn/ handler. |
| onRequest() | Receives FULL path incl /agents/call-brain/{id} prefix. |
| pathname checks | Always .endsWith() NOT === inside onRequest() |
| CALL_BRAIN binding | camelCase->kebab = "call-brain" namespace |
| src/index.ts | DEAD CODE (v6.16.1). Never touch. |
| src/worker.ts | THE entrypoint. Always verify wrangler.toml main first. |

## KEY SOURCE FILES
- src/bella-agent.ts — BellaAgent DO class, all @callable methods, runWowPrep
- src/controller.ts — shouldAdvanceWowStep, stage/wow-step advance logic
- src/deep-scrape-agent.ts — Apify integration (fully implemented, NOT a stub)
- src/wow-agent.ts — WowAgent, prepareLines() via Gemini
- src/types.ts — ConversationState, IntelStore, DeepIntel etc.
- src/worker.ts — routeAgentRequest + /health

## NEXT: S3 — /v2-compat adapter
Spec: Add /turn-v2-compat endpoint to bella-agent.ts (~30 lines).
Bridge sends V2 format, brain expects V3. Adapter translates.
Ref: doc-think-agent-v1-session-20260425 (D1)

## TEAM PROTOCOL
- T2 specs → T3 gates (Codex CLI proof mandatory) → T4 implements + deploys
- T4 NEVER self-deploys — needs DEPLOY_AUTH from T2
- T5 runs all greps/reads — T2 never self-explores
- T3B regression judge: SKIPPED this sprint under Trent authority
- All gates to T3 with which codex && codex --version output
- Min viable comms — signal only, no narration
- Bump VERSION on every deploy
- Verify wrangler.toml main before speccing any file

## LAWS
- @callable = WS RPC only. onRequest() uses .endsWith()
- src/index.ts dead code — never touch
- T4 never self-deploys
- Codex proof required on every verdict
- wrangler.toml entrypoint check mandatory before every spec

## D1 REF DOCS
- doc-think-agent-sprint1-3-bug-report-20260424 — S1-S3 bug report
- doc-think-agent-v1-session-20260425 — full session log v2
- doc-think-agent-v1-s2-handover-20260425 — this doc
