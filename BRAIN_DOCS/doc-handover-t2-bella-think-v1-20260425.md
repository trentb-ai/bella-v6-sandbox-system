# T2 CODE LEAD HANDOVER — BELLA THINK AGENT V1 S3
Date: 2026-04-25 AEST
Outgoing T2: tej3g7py (Sonnet)
D1 ID: doc-handover-t2-bella-think-v1-20260425

---

## IMMEDIATE ACTION ON STARTUP

1. Read this doc fully
2. SPEC is REWORK — T3a (06pht1zr) returned SPEC_VERDICT: REWORK with fixes below
3. Apply 2 fixes to spec (P1 mandatory, P2 recommended)
4. Resend corrected spec to T3a as SPEC_REVIEW_REQUEST
5. On SPEC_VERDICT PASS → assign T4 (cdfvbkza) with TASK_REQUEST

---

## T3a SPEC_VERDICT: REWORK (received 2026-04-25 05:42 AEST)

### P1 — BLOCKING: Missing interruptController reset

Root cause:
- `onChunk()` (line 181): `if (this.interruptController?.signal.aborted) return;`
- `/interrupt` handler (line 312) calls `this.interruptController?.abort()`
- `/turn` handler (line 353) resets: `const controller = new AbortController(); this.interruptController = controller;`
- `/compat-turn` spec did NOT reset interruptController

Impact: if ANY prior turn was aborted (barge-in), subsequent compat-turn calls see `signal.aborted=true` → onChunk drops ALL tokens → empty SSE stream → no TTS output. Deterministic silent failure.

Fix — add before `ctx.waitUntil` in `/compat-turn` handler:
```typescript
this.interruptController = new AbortController();
```

### P2 — NON-BLOCKING: unguarded relayStream null in finally

Current spec finally: `this.relayStream = null`
Fix: `if (this.relayStream === openAIStream) this.relayStream = null`

---

## CORRECTED S3-1 SPEC (ready to send to T3a)

### FILE 1: worker.ts
`~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/src/worker.ts`

**Change 1** — version bump line 16:
```
BEFORE: version: "3.10.0-think"
AFTER:  version: "3.11.0-think"
```

**Change 2** — replace line 22:

BEFORE:
```typescript
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
```

AFTER:
```typescript
    if (url.pathname === "/v9/chat/completions" && request.method === "POST") {
      const body = await request.json<{ messages?: Array<{ role: string; content: string }> }>();
      const messages = body.messages ?? [];
      const systemMsg = messages.find(m => m.role === "system")?.content ?? "";
      const lidMatch = systemMsg.match(/lead[\s_]id\s*(?:is\s*[:=]?|[:=])\s*([a-z0-9][a-z0-9_\-:.]{3,})/i);
      const lid = lidMatch?.[1];
      if (!lid) return Response.json({ error: "missing_lid" }, { status: 400 });
      const isFirstTurn = messages.filter(m => m.role === "user").length <= 1;
      let starterIntel: Record<string, any> | null = null;
      if (isFirstTurn) {
        starterIntel = await env.LEADS_KV.get(`lead:${lid}:fast-intel`, "json");
      }
      const doId = env.CALL_BRAIN.idFromName(lid);
      const stub = env.CALL_BRAIN.get(doId);
      return stub.fetch(new Request("https://do-internal/compat-turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, starterIntel, lid }),
      }));
    }
    return (await routeAgentRequest(request, env)) ?? new Response("Not found", { status: 404 });
```

### FILE 2: bella-agent.ts
`~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/src/bella-agent.ts`

Insert before line 381 (`return new Response("Not found", { status: 404 });`):

```typescript
    if (url.pathname.endsWith("/compat-turn") && request.method === "POST") {
      const { messages, starterIntel, lid } = await request.json<{
        messages: Array<{ role: string; content: string }>;
        starterIntel: Record<string, any> | null;
        lid: string;
      }>();
      const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
      const userText = lastUserMsg?.content ?? "";
      if (!userText) return Response.json({ error: "missing_user_message" }, { status: 400 });

      if (!this.cs) {
        await this.initSession(lid, starterIntel ?? undefined);
      }

      const streamId = crypto.randomUUID();
      const encoder = new TextEncoder();
      let streamController!: ReadableStreamDefaultController<Uint8Array>;
      const readable = new ReadableStream<Uint8Array>({
        start(c) { streamController = c; },
      });

      const openAIStream = {
        _closed: false,
        get isClosed() { return this._closed; },
        send(delta: string): boolean {
          if (this._closed) return false;
          const chunk = JSON.stringify({
            id: `chatcmpl-${streamId}`,
            object: "chat.completion.chunk",
            model: "gpt-4",
            choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
          });
          streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          return true;
        },
        end(finalDelta?: string): boolean {
          if (this._closed) return false;
          this._closed = true;
          if (finalDelta !== undefined) {
            const chunk = JSON.stringify({
              id: `chatcmpl-${streamId}`,
              object: "chat.completion.chunk",
              model: "gpt-4",
              choices: [{ index: 0, delta: { content: finalDelta }, finish_reason: "stop" }],
            });
            streamController.enqueue(encoder.encode(`data: ${chunk}\n\n`));
          } else {
            const done = JSON.stringify({
              id: `chatcmpl-${streamId}`,
              object: "chat.completion.chunk",
              model: "gpt-4",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            });
            streamController.enqueue(encoder.encode(`data: ${done}\n\n`));
          }
          streamController.enqueue(encoder.encode("data: [DONE]\n\n"));
          streamController.close();
          return true;
        },
        error(message: string): boolean {
          if (this._closed) return false;
          this._closed = true;
          streamController.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`));
          streamController.close();
          return true;
        },
      } as unknown as StreamingResponse;

      this.relayStream = openAIStream;
      this.interruptController = new AbortController();  // P1 FIX — must reset per-turn

      this.ctx.waitUntil(
        this.runFiber(`compat:${lid}`, async (ctx: any) => {
          ctx.stash({ lid, turnAt: Date.now() });
          await this.chat(userText, {
            onEvent: () => {},
            onDone: () => {},
            onError: (err: string) => console.error(`[COMPAT_TURN_ERR] ${err}`),
          });
        }).finally(() => {
          if (!openAIStream.isClosed) openAIStream.end();
          if (this.relayStream === openAIStream) this.relayStream = null;  // P2 FIX
        }),
      );

      return new Response(readable, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }
```

---

## NEXT STEPS

1. Resend corrected spec to T3a (06pht1zr) as `SPEC_REVIEW_REQUEST`
2. On `SPEC_VERDICT PASS` → `TASK_REQUEST` to T4 (cdfvbkza)
3. T4 implements → `REVIEW_REQUEST` to T2
4. T2 6-gate → `CODEX_REVIEW_REQUEST` to T3a
5. T3a CODEX PASS → T4 deploys → T5 (suod1211) health check → `DEPLOY_COMPLETE`

---

## KEY TECHNICAL FACTS

- `chatRecovery = true` already set (bella-agent.ts line 27)
- `relayStream` type: `StreamingResponse` from `"agents"` (line 3)
- `relayStream.send()` receives string (textDelta) — onChunk line 182-184
- `interruptController`: AbortController | null — MUST reset per-turn (P1 fix)
- `this.cs` getter line 33: `(this.state as ConversationState) ?? null`
- `initSession` is `@callable` but callable as `this.initSession()` directly from within DO
- `CALL_BRAIN`: DurableObjectNamespace → BellaAgent (confirmed wrangler.toml)
- `LEADS_KV`: `0fec6982d8644118aba1830afd4a58cb`
- KV mismatch: fast-intel writes `lead:{lid}:fast-intel`, initSession reads `brief:{lid}` — bridged via `starterIntel`

---

## TEAM PEERS

| ID | Role |
|---|---|
| m247raws | T1 Orchestrator |
| 06pht1zr | T3a Code Judge |
| rcvc33ns | T3b Regression Judge |
| cdfvbkza | T4 Minion A |
| suod1211 | T5 Minion B |
| sm57uyft | T9 Architect |

---

## S3-2 PROMPT PORTING (QUEUED)
Full plan: `doc-bella-think-v1-s3-plan-20260425` in D1 + BRAIN_DOCS
Pending S3-1 deploy + T5 health pass.

---

## GIT / WRANGLER
- Rollback tag: `BELLA-THINK-PRE-BRIDGE-BLOWN-bella-think-agent-v1-brain`
- Working dir: `~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
- wrangler.toml: `CALL_BRAIN → BellaAgent`, `LEADS_KV → 0fec6982d8644118aba1830afd4a58cb`
