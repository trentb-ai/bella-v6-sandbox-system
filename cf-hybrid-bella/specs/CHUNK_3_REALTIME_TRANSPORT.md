# CHUNK 3 SPEC — Realtime Transport Agent
### realtime-agent-v3 Durable Object
### Author: T2 Code Lead | Date: 2026-04-07
### Status: REWORK v3 — T3 P1-NEW-1 (SSE abort on barge-in) + P1-NEW-2 (greeting queue drain) fixes applied

---

## 1. SCOPE

Build the `RealtimeAgent` Durable Object in `workers/realtime-agent-v3/src/` that:
1. Accepts WebSocket connections from the browser (audio + control messages)
2. Opens a concurrent WebSocket to Deepgram for STT and TTS
3. Detects speaker identity (prospect vs. bella) from audio direction
4. Builds `TurnRequestV1` on each prospect utterance and POSTs to Brain DO
5. Receives `TurnPlanV1` from Brain, forwards to Prompt Worker, streams TTS back to browser
6. Handles barge-in (prospect interrupts Bella's speech) with < 100ms TTS clear
7. Manages VAD via Deepgram native configuration (no custom VAD logic)

**Transport only. Zero business logic.** No stage machine, no extraction regex, no prompt building, no Gemini calls, no KV reads for intel. All decisions come from Brain via TurnPlan.

**Out of scope for Chunk 3:** Brain internals (Chunk 1), Prompt Worker internals (Chunk 2), Extraction Workflow (Chunk 5), Compliance Workflow (Chunk 6), Telemetry internals (Chunk 4). These are service bindings only.

**V2 → V3 architectural shift:** V2 uses Deepgram Voice Agent API (embedded LLM + tool calling). V3 uses Deepgram STT + TTS only — Brain DO owns all decisions, Prompt Worker generates speech text via Gemini, Realtime Agent is pure transport.

---

## 2. FILE STRUCTURE

```
workers/realtime-agent-v3/src/
  index.ts              — Worker fetch handler + DO export + WebSocket upgrade routing
  realtime-do.ts        — RealtimeAgent DO class (WebSocket lifecycle, message routing)
  deepgram.ts           — openDeepgramSTT(), openDeepgramTTS(), Deepgram config constants
  speaker.ts            — determineSpeaker() — classifies audio direction into speakerFlag
  turn-dispatch.ts      — dispatchTurn() — builds TurnRequest, POSTs to Brain, calls Prompt Worker, streams TTS
  barge-in.ts           — handleBargeIn() — clears TTS buffer, signals Deepgram, resets state
  audio.ts              — PCM frame helpers, silence detection, audio format constants
  types.ts              — Internal types (BrowserMessage, DeepgramEvent, AgentState, etc.)
```

---

## 3. ARCHITECTURE — DUAL WEBSOCKET BRIDGE

### 3.1 Connection Topology

```
Browser (WebSocket)           Realtime Agent DO              Deepgram (WebSocket)
    │                              │                              │
    │── PCM audio ──────────────>  │── PCM audio ──────────────>  │  (STT)
    │                              │                              │
    │                              │  <── transcript JSON ───────  │  (STT result)
    │                              │                              │
    │                              │── POST /turn ──> Brain DO    │
    │                              │  <── TurnPlan ──             │
    │                              │                              │
    │                              │── POST /generate ──> Prompt Worker
    │                              │  <── SSE stream ──           │
    │                              │                              │
    │                              │── text chunks ──────────────> │  (TTS input)
    │                              │                              │
    │  <── TTS audio ────────────  │  <── TTS audio ─────────────  │  (TTS output)
    │                              │                              │
    │── barge_in ───────────────>  │── clear/interrupt ──────────> │
    │  <── listening ────────────  │                              │
```

### 3.2 Deepgram Usage — STT + TTS Only (NOT Voice Agent API)

V2 uses `wss://agent.deepgram.com/v1/agent/converse` (the full Voice Agent API with embedded LLM). V3 uses two separate Deepgram connections:

| Function | V2 Endpoint | V3 Endpoint | Notes |
|---|---|---|---|
| STT | Voice Agent API (bundled) | `wss://api.deepgram.com/v1/listen` | Standalone STT stream |
| TTS | Voice Agent API (bundled) | `wss://api.deepgram.com/v1/speak` | WebSocket TTS (streaming) |
| LLM | Voice Agent API (embedded Gemini) | **Not used** — Brain + Prompt Worker | Separation of concerns |

V3 does NOT use the Deepgram Voice Agent API. The Voice Agent API bundles STT + LLM + TTS into a single opinionated flow — V3 needs independent control of each layer.

### 3.3 STT Configuration

```typescript
const DG_STT_URL = 'wss://api.deepgram.com/v1/listen';
const DG_STT_CONFIG = {
  model: 'nova-3',                // Latest Nova model for accuracy
  language: 'en',
  smart_format: true,             // Punctuation, capitalization
  utterance_end_ms: '1200',       // 1.2s silence = end of utterance
  interim_results: true,          // Streaming partial results
  endpointing: 300,               // 300ms endpointing for responsive turn detection
  vad_events: true,               // VAD start/stop events for barge-in detection
  encoding: 'linear16',           // PCM 16-bit
  sample_rate: 16000,             // 16kHz
  channels: 1,                    // Mono
};
```

These are passed as query parameters on the WebSocket URL:
```
wss://api.deepgram.com/v1/listen?model=nova-3&language=en&smart_format=true&...
```

### 3.4 TTS Configuration

```typescript
const DG_TTS_URL = 'wss://api.deepgram.com/v1/speak';
const DG_TTS_CONFIG = {
  model: 'aura-2-theia-en',      // Same voice as V2
  encoding: 'linear16',           // PCM 16-bit output
  sample_rate: 16000,             // Match STT
  container: 'none',              // Raw PCM, no container
};
```

TTS is a separate WebSocket connection. Text chunks from Prompt Worker SSE are sent as JSON `{ "type": "Speak", "text": "chunk" }` messages. Audio comes back as binary frames.

---

## 4. DURABLE OBJECT — RealtimeAgent

### 4.1 Why a Durable Object?

The Realtime Agent needs to:
- Hold two concurrent WebSocket connections (browser + Deepgram STT)
- Maintain per-call state (turn counter, active TTS stream, barge-in state)
- Survive individual message processing without losing context

A Cloudflare Durable Object provides WebSocket hibernation, persistent state, and single-threaded execution guarantees.

### 4.2 DO Class Shape

```typescript
export class RealtimeAgent extends DurableObject {
  // Connections
  private browserWs: WebSocket | null = null;
  private sttWs: WebSocket | null = null;
  private ttsWs: WebSocket | null = null;

  // Call state
  private callId: string = '';
  private turnIndex: number = 0;
  private isSpeaking: boolean = false;       // Bella is currently outputting TTS
  private pendingTurnId: string | null = null; // Turn currently being processed
  private turnBusy: boolean = false;          // True while dispatchTurn() is in-flight
  private turnQueue: Array<{ utterance: string; speakerFlag: 'prospect' }> = []; // Queued turns
  private activeTtsAbort: AbortController | null = null; // P1-NEW-1: abort SSE stream on barge-in

  // Keepalive
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
}
```

### 4.3 WebSocket Lifecycle

```
Browser connects → fetch() intercepts → DO.webSocketAccept()
  → extract callId from URL params
  → open Deepgram STT WebSocket
  → open Deepgram TTS WebSocket
  → send { type: "ready" } to browser
  → begin audio forwarding

Browser disconnects → webSocketClose()
  → close Deepgram STT
  → close Deepgram TTS
  → clear timers
```

### 4.4 State Persistence

Realtime Agent state is **ephemeral** — it lives only for the duration of the WebSocket connection. No DO storage writes needed. If the connection drops and reconnects, state resets (Brain DO holds the durable conversation state).

Exception: `callId` is extracted from the URL on connect and does not change.

---

## 5. SPEAKER FLAGGING — determineSpeaker()

### 5.1 Algorithm

Speaker identity is determined by **audio direction**, not voice analysis:

| Source | Speaker Flag | Rule |
|---|---|---|
| Deepgram STT transcript event | `'prospect'` | STT only processes inbound browser audio = prospect speaking |
| TTS audio being sent to browser | `'bella'` | Outbound audio = Bella speaking |
| Deepgram STT with `is_final: false` | No flag yet | Interim results — wait for final |
| No transcript after VAD timeout | `'unknown'` | Ambiguous — do not extract |

```typescript
function determineSpeaker(event: DeepgramSTTEvent): 'prospect' | 'unknown' {
  // STT events are ALWAYS prospect (inbound audio)
  // 'bella' is never sent as a TurnRequest — Brain already knows what Bella said
  if (event.is_final && event.channel?.alternatives?.[0]?.transcript) {
    return 'prospect';
  }
  return 'unknown';
}
```

### 5.2 Critical Design Decision: No 'bella' TurnRequests

V3 does NOT send `speakerFlag: 'bella'` TurnRequests to Brain. Brain already knows what Bella said — it generated the TurnPlan. Sending Bella's speech back would create a feedback loop.

Only **prospect** utterances (from STT) trigger TurnRequests. The `'bella'` flag exists in the contract for future use (e.g., compliance audit logging) but Realtime Agent v3 never sends it to Brain's `/turn` endpoint.

### 5.3 Speaker Contamination Prevention (V2 Bug 3)

V2 had speaker contamination — Bella's TTS audio leaked back into STT extraction. V3 prevents this structurally:

1. **Separate audio paths:** Browser audio → STT WebSocket (inbound only). TTS audio → Browser (outbound only). No audio loopback.
2. **Barge-in gate during TTS:** While `isSpeaking === true`, browser audio still flows to STT (for barge-in detection via `SpeechStarted` events). If `is_final: true` arrives during TTS, `handleBargeIn()` fires first (clears TTS, sets `isSpeaking = false`), then the turn is queued/dispatched (§6.1 P1-6 rule). This prevents processing prospect speech while Bella is still talking.
3. **isSpeaking lifecycle:** Set to `true` in `dispatchTurn()` before `streamSSEToTTS()` (§6.3). Set to `false` by TTS `Flushed` event (§9.2) or by `handleBargeIn()` (§7.2). Never left dangling.

---

## 6. TURN DISPATCH — dispatchTurn()

### 6.1 STT Event → Turn Dispatch (entry point)

When a final STT transcript arrives, the DO's `webSocketMessage()` handler runs this logic:

```typescript
// In RealtimeAgent.webSocketMessage() — STT final transcript handler
const transcript = event.channel?.alternatives?.[0]?.transcript ?? '';
const speaker = determineSpeaker(event);

// P1-5: Filter empty/unknown transcripts — do NOT dispatch to Brain
if (!transcript || speaker === 'unknown') return;

// P1-6: If Bella is speaking when prospect talks → barge-in first
if (this.isSpeaking) {
  handleBargeIn(this.sttWs!, this.ttsWs!, this.browserWs!, this);
}

// P1-4: Turn queue — only one turn in-flight at a time
if (this.turnBusy) {
  this.turnQueue.push({ utterance: transcript, speakerFlag: 'prospect' });
  console.log(`[RT] queued turn (queue=${this.turnQueue.length})`);
  return;
}

// Dispatch immediately
this.turnIndex++;  // P2: turnIndex incremented here, before dispatch
await this.runTurn(transcript, 'prospect');
```

### 6.2 runTurn() — Single Turn Execution

```typescript
private async runTurn(utterance: string, speakerFlag: 'prospect'): Promise<void> {
  this.turnBusy = true;

  try {
    await dispatchTurn(
      this.callId,
      utterance,
      speakerFlag,
      this.turnIndex,
      this.env,
      this.ttsWs!,       // P1-1: WebSocket params passed explicitly
      this.browserWs!,    // P1-1: WebSocket params passed explicitly
      this,               // P1-2: AgentState for isSpeaking
    );
  } finally {
    this.turnBusy = false;
    // P1-4: Drain queue
    if (this.turnQueue.length > 0) {
      const next = this.turnQueue.shift()!;
      this.turnIndex++;
      await this.runTurn(next.utterance, next.speakerFlag);
    }
  }
}
```

### 6.3 dispatchTurn() — Brain → Prompt Worker → TTS

All connection references are passed as parameters (P1-1 fix — function lives in `turn-dispatch.ts`, not the DO class):

```typescript
async function dispatchTurn(
  callId: string,
  utterance: string,
  speakerFlag: 'prospect',
  turnIndex: number,
  env: Env,
  ttsWs: WebSocket,       // P1-1: explicit param
  browserWs: WebSocket,   // P1-1: explicit param
  state: AgentState,       // P1-2: for isSpeaking flag
): Promise<void> {
  // 1. Build TurnRequest
  const turnId = crypto.randomUUID();
  const turnRequest: TurnRequest = {
    version: 1,
    callId,
    turnId,
    utterance,
    speakerFlag,
    turnIndex,
  };

  // 2. POST to Brain DO
  const brainResponse = await env.BRAIN.fetch(
    new Request(`https://brain/turn?callId=${callId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(turnRequest),
    })
  );

  if (!brainResponse.ok) {
    console.error(`[RT] Brain error: ${brainResponse.status}`);
    return;
  }

  const plan: TurnPlan = await brainResponse.json();

  // 3. POST to Prompt Worker
  const promptResponse = await env.PROMPT_WORKER.fetch(
    new Request('https://prompt/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, utterance }),
    })
  );

  if (!promptResponse.ok || !promptResponse.body) {
    console.error(`[RT] Prompt Worker error: ${promptResponse.status}`);
    return;
  }

  // 4. P1-2: Set isSpeaking BEFORE streaming TTS
  state.isSpeaking = true;
  state.pendingTurnId = turnId;
  browserWs.send(JSON.stringify({ type: 'speaking', turnId }));

  // 5. P1-NEW-1: Create AbortController so barge-in can kill the SSE stream
  const abort = new AbortController();
  state.activeTtsAbort = abort;

  // 6. Stream SSE → TTS → Browser
  await streamSSEToTTS(promptResponse.body, ttsWs, browserWs, abort.signal);

  // Cleanup abort reference after stream completes normally
  if (state.activeTtsAbort === abort) state.activeTtsAbort = null;

  // Note: isSpeaking is set to false by TTS Flushed event (§9.2),
  // NOT here — audio may still be in Deepgram's buffer after SSE completes.
}
```

### 6.4 SSE → TTS Streaming

The Prompt Worker returns an SSE stream (OpenAI-compatible format). Realtime Agent must:
1. Parse SSE `data:` lines
2. Extract `choices[0].delta.content` from each chunk
3. Send text chunks to Deepgram TTS WebSocket as `{ "type": "Speak", "text": "..." }`
4. Forward resulting TTS audio (binary) to browser WebSocket (handled by TTS WebSocket message handler)
5. On `data: [DONE]`, send TTS flush command

```typescript
async function streamSSEToTTS(
  sseBody: ReadableStream<Uint8Array>,
  ttsWs: WebSocket,
  browserWs: WebSocket,
  abortSignal: AbortSignal,  // P1-NEW-1: barge-in aborts this stream
): Promise<void> {
  if (!ttsWs || ttsWs.readyState !== WebSocket.OPEN) {
    console.error('[RT] TTS WebSocket not open — cannot stream');
    return;
  }

  const reader = sseBody.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      // P1-NEW-1: Check abort on each iteration — barge-in kills the loop
      if (abortSignal.aborted) {
        console.log('[RT] SSE stream aborted (barge-in)');
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (abortSignal.aborted) break;  // P1-NEW-1: check inside inner loop too

        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') {
          // Signal TTS to flush remaining audio
          if (ttsWs.readyState === WebSocket.OPEN) {
            ttsWs.send(JSON.stringify({ type: 'Flush' }));
          }
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed?.choices?.[0]?.delta?.content;
          if (content && ttsWs.readyState === WebSocket.OPEN) {
            ttsWs.send(JSON.stringify({ type: 'Speak', text: content }));
          }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
```

### 6.5 Greeting Turn (turnIndex === 0)

The first turn is special — Brain sends a greeting TurnPlan without a prospect utterance. Realtime Agent triggers this immediately after Deepgram connections are established:

```typescript
// On connect, fire greeting turn via runTurn()
// P1-NEW-2: Uses runTurn() so queue drain works if prospect speaks during greeting TTS
// this.turnIndex starts at 0 — runTurn() does NOT increment for greeting (§6.1 increments before prospect turns only)
await this.runTurn('', 'prospect');
```

Brain's stage machine handles `turnIndex === 0` as the greeting stage and returns a mandatory speakText greeting. Brain returns `extractionTargets: []` for the greeting turn (nothing to extract from an empty utterance).

Note: `runTurn()` sets `turnBusy = true/false` and drains the queue in its `finally` block. If the prospect speaks during the greeting TTS, that turn is queued (§6.1) and drained after the greeting dispatch completes.

---

## 7. BARGE-IN HANDLING

### 7.1 Detection

Barge-in is detected two ways:

1. **Browser signal:** Browser sends `{ type: "barge_in" }` JSON message when it detects the user starting to speak while TTS is playing.
2. **Deepgram VAD:** Deepgram STT fires a `SpeechStarted` event when it detects voice activity in the inbound audio stream while TTS is active.

### 7.2 Response Flow

```typescript
async function handleBargeIn(
  sttWs: WebSocket,
  ttsWs: WebSocket,
  browserWs: WebSocket,
  state: AgentState,
): Promise<void> {
  // 1. P1-NEW-1: Abort the active SSE→TTS stream FIRST
  // This stops new Speak commands from reaching Deepgram after Clear
  state.activeTtsAbort?.abort();
  state.activeTtsAbort = null;

  // 2. Stop TTS output immediately
  ttsWs.send(JSON.stringify({ type: 'Clear' }));  // Deepgram TTS clear buffer

  // 3. Update state
  state.isSpeaking = false;
  state.pendingTurnId = null;

  // 4. Tell browser to stop playing audio
  browserWs.send(JSON.stringify({ type: 'clear_audio' }));

  // 5. Log
  console.log(`[RT] barge-in: SSE aborted + TTS cleared, listening`);
}
```

### 7.3 SLO: < 100ms TTS Clear

From barge-in detection to TTS audio stopping at the browser:
- Deepgram TTS `Clear` command: < 10ms (WebSocket message)
- Browser `clear_audio` command: < 10ms (WebSocket message)
- Browser audio buffer flush: < 50ms (depends on buffer size)
- **Total: < 100ms** (V2 Bug 4 fix)

---

## 8. BROWSER MESSAGE PROTOCOL

### 8.1 Browser → Realtime Agent

| Message Type | Format | Purpose |
|---|---|---|
| Audio | `ArrayBuffer` (binary) | PCM 16kHz 16-bit mono audio from microphone |
| `barge_in` | `{ type: "barge_in" }` | User started speaking during TTS |
| `end` | `{ type: "end" }` | User ended the call |
| `mute` | `{ type: "mute", muted: boolean }` | Microphone mute toggle |

### 8.2 Realtime Agent → Browser

| Message Type | Format | Purpose |
|---|---|---|
| Audio | `ArrayBuffer` (binary) | PCM TTS audio for playback |
| `ready` | `{ type: "ready", callId: string }` | Connections established, ready for audio |
| `listening` | `{ type: "listening" }` | Barge-in acknowledged, now listening |
| `speaking` | `{ type: "speaking", turnId: string }` | Bella started speaking |
| `clear_audio` | `{ type: "clear_audio" }` | Stop playing buffered audio (barge-in) |
| `turn_start` | `{ type: "turn_start", stage: string }` | New turn started (for UI) |
| `error` | `{ type: "error", message: string }` | Error occurred |
| `end` | `{ type: "end" }` | Call completed |

---

## 9. DEEPGRAM EVENT HANDLING

### 9.1 STT Events (from Deepgram Listen WebSocket)

| Event | Action |
|---|---|
| `Results` with `is_final: true` + non-empty transcript | Run §6.1 entry point: filter → barge-in if `isSpeaking` → queue or dispatch |
| `Results` with `is_final: true` + empty transcript | **DROP** — do not dispatch (P1-5) |
| `Results` with `is_final: false` | Interim — forward to browser as `{ type: "interim", text }` for live captions (optional) |
| `SpeechStarted` | If `isSpeaking`, trigger `handleBargeIn()` — single entry point for barge-in during TTS (P1-6) |
| `UtteranceEnd` | Confirms end of utterance — safe to process if final transcript received |
| `Metadata` | Log connection metadata |
| `Error` | Log and attempt reconnect |

**P1-6 rule:** If `is_final: true` arrives while `isSpeaking === true`, the handler MUST call `handleBargeIn()` first to clear TTS, then enqueue/dispatch the turn. Barge-in is the single entry point for any prospect speech during active TTS.

### 9.2 TTS Events (from Deepgram Speak WebSocket)

| Event | Action |
|---|---|
| Binary audio frame | Forward directly to browser WebSocket |
| `Flushed` | TTS buffer empty — set `isSpeaking = false` |
| `Warning` | Log |
| `Error` | Log and attempt reconnect |

---

## 10. CONNECTION MANAGEMENT

### 10.1 Deepgram Keepalive

Deepgram drops idle WebSocket connections. Send keepalive every 5 seconds:

```typescript
const KEEPALIVE_MS = 5000;

function startKeepAlive(sttWs: WebSocket): ReturnType<typeof setInterval> {
  return setInterval(() => {
    if (sttWs.readyState === WebSocket.OPEN) {
      sttWs.send(JSON.stringify({ type: 'KeepAlive' }));
    }
  }, KEEPALIVE_MS);
}
```

### 10.2 Reconnection

If Deepgram STT or TTS disconnects mid-call:
1. Log the disconnection with reason
2. Attempt reconnect once (same config)
3. If reconnect fails, send `{ type: "error", message: "Audio connection lost" }` to browser
4. Do NOT crash the DO — browser can reconnect

Max reconnect attempts: 1 per connection type per call.

### 10.3 Cleanup on Disconnect

When browser disconnects:
```typescript
webSocketClose(ws: WebSocket) {
  this.stopKeepAlive();
  if (this.sttWs) { try { this.sttWs.close(); } catch {} }
  if (this.ttsWs) { try { this.ttsWs.close(); } catch {} }
  this.sttWs = null;
  this.ttsWs = null;
  this.browserWs = null;
}
```

---

## 11. WORKER API

### 11.1 Routes

| Method | Path | Response | Purpose |
|---|---|---|---|
| GET | `/health` | `{ version, worker }` | Health check |
| GET | `/ws?callId=X` | WebSocket upgrade | Browser WebSocket connection |

### 11.2 WebSocket Upgrade

```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: '1.0.0', worker: 'realtime-agent-v3' });
    }

    if (url.pathname === '/ws') {
      const callId = url.searchParams.get('callId');
      if (!callId) return new Response('Missing callId', { status: 400 });

      const id = env.REALTIME_AGENT.idFromName(callId);
      const stub = env.REALTIME_AGENT.get(id);
      return stub.fetch(request);
    }

    return new Response('Not found', { status: 404 });
  },
};
```

The DO uses `callId` as the DO name — one DO instance per active call.

---

## 12. ENV BINDINGS

```typescript
interface Env {
  REALTIME_AGENT: DurableObjectNamespace;
  BRAIN: Fetcher;              // Service binding to brain-v3
  PROMPT_WORKER: Fetcher;      // Service binding to prompt-worker-v3
  DEEPGRAM_API_KEY: string;    // Secret
  VERSION?: string;
}
```

---

## 13. WRANGLER CONFIG

```toml
name = "realtime-agent-v3"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[vars]
VERSION = "1.0.0"

[[durable_objects.bindings]]
name = "REALTIME_AGENT"
class_name = "RealtimeAgent"

[[migrations]]
tag = "v1"
new_classes = ["RealtimeAgent"]
```

Secrets: `DEEPGRAM_API_KEY` (set via `wrangler secret put`).

Service bindings added at deploy time:
```toml
[[services]]
binding = "BRAIN"
service = "bella-brain-v3"

[[services]]
binding = "PROMPT_WORKER"
service = "bella-prompt-v3"
```

---

## 14. ASSERTIONS

Test file: `workers/realtime-agent-v3/src/__tests__/chunk3.test.ts`

### C3-01: determineSpeaker returns 'prospect' for final STT transcript
```
Given a Deepgram STT event with is_final=true and transcript='hello'
When determineSpeaker() is called
Then returns 'prospect'
```

### C3-02: determineSpeaker returns 'unknown' for non-final transcript
```
Given a Deepgram STT event with is_final=false
When determineSpeaker() is called
Then returns 'unknown'
```

### C3-03: determineSpeaker returns 'unknown' for empty transcript
```
Given a Deepgram STT event with is_final=true and transcript=''
When determineSpeaker() is called
Then returns 'unknown'
```

### C3-04: dispatchTurn builds valid TurnRequestV1
```
Given callId='test-call', utterance='hello', speakerFlag='prospect', turnIndex=1
When dispatchTurn() builds the TurnRequest
Then TurnRequestV1.safeParse() succeeds on the built object
And version === 1, callId === 'test-call', utterance === 'hello'
```

### C3-05: SSE text extraction matches Prompt Worker format
```
Given an SSE stream: 'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\ndata: {"choices":[{"delta":{"content":"world"}}]}\n\ndata: [DONE]\n\n'
When streamSSEToTTS() processes it
Then TTS receives 'Hello ' then 'world' then Flush command
```

### C3-06: Barge-in clears TTS state
```
Given isSpeaking=true and pendingTurnId='turn-1'
When handleBargeIn() is called
Then isSpeaking=false and pendingTurnId=null
And TTS WebSocket receives Clear command
And browser WebSocket receives clear_audio message
```

### C3-07: No TurnRequest sent for 'bella' speaker
```
Given Realtime Agent receives TTS audio for playback
Then no TurnRequest is POSTed to Brain
(Bella's speech is not sent back as a turn — Brain already knows what it generated)
```

### C3-08: Greeting turn fires on connect with turnIndex 0
```
Given browser WebSocket connects with callId='test-call'
When connection is established and Deepgram is ready
Then dispatchTurn is called with utterance='', speakerFlag='prospect', turnIndex=0
```

### C3-09: Deepgram STT config uses correct parameters
```
Given openDeepgramSTT() is called
Then WebSocket URL contains model=nova-3, encoding=linear16, sample_rate=16000
And vad_events=true for barge-in detection
```

### C3-10: Keepalive fires every 5 seconds
```
Given an active STT WebSocket connection
When 5 seconds elapse
Then a KeepAlive message is sent to Deepgram
```

### C3-11: Browser disconnect cleans up all connections
```
Given browser WebSocket closes
Then STT WebSocket is closed
And TTS WebSocket is closed
And keepalive timer is cleared
```

### C3-12: Missing callId returns 400
```
Given a request to /ws without callId query param
Then response status is 400
```

### C3-13: Turn queue prevents concurrent Brain requests
```
Given turnBusy=true (a turn is in-flight)
When a new is_final STT transcript arrives
Then the turn is added to turnQueue (not dispatched)
And when the in-flight turn completes, the queued turn is drained and dispatched
```

### C3-14: Empty final transcript is dropped
```
Given a Deepgram STT event with is_final=true and transcript=''
When the STT handler processes it
Then no TurnRequest is sent to Brain
And turnQueue is unchanged
```

### C3-15: Final transcript during TTS triggers barge-in first
```
Given isSpeaking=true
When a is_final STT transcript 'I have a question' arrives
Then handleBargeIn() is called first (isSpeaking→false, TTS Clear sent)
Then the turn is dispatched (or queued if turnBusy)
```

---

## 15. SLO TARGETS

| Metric | Target | Measurement |
|---|---|---|
| WebSocket upgrade | < 200ms | Browser connect to `ready` message |
| Deepgram STT open | < 500ms | STT WebSocket connected and streaming |
| Deepgram TTS open | < 500ms | TTS WebSocket connected |
| Speaker flag determination | < 5ms | STT event to speakerFlag assignment |
| Barge-in to TTS clear | < 100ms | Browser barge_in to TTS audio stop |
| Turn dispatch (Brain + Prompt) | < 2s | TurnRequest sent to first TTS audio at browser |
| Keepalive interval | 5s | Prevent Deepgram idle disconnect |

---

## 16. IMPLEMENTATION NOTES FOR T4

1. **Use Deepgram Listen + Speak separately** — NOT the Voice Agent API. The Voice Agent API bundles STT + LLM + TTS into one opinionated flow. V3 needs independent control of each layer.

2. **DO WebSocket API** — Use `this.ctx.acceptWebSocket(ws)` and implement `webSocketMessage()`, `webSocketClose()` handlers. Cloudflare DOs have native WebSocket support.

3. **Audio is forwarded as-is** — Browser sends PCM 16kHz 16-bit mono. Forward to Deepgram STT untouched. Deepgram TTS returns PCM. Forward to browser untouched. No transcoding.

4. **STT connection params go in the URL** — Deepgram Listen accepts config as query parameters on the WebSocket URL, not as a JSON settings message.

5. **TTS connection params go in the URL** — Same for Deepgram Speak WebSocket. Model and encoding in query params.

6. **Deepgram auth** — Both STT and TTS WebSocket connections use `Authorization: Token ${DEEPGRAM_API_KEY}` header on the upgrade request.

7. **Binary vs. JSON multiplexing** — WebSocket messages are either `ArrayBuffer` (audio) or `string` (JSON control). Use `instanceof ArrayBuffer` to distinguish. Same as V2.

8. **No DO storage writes** — Realtime Agent state is ephemeral. Brain DO holds all durable state. If the WebSocket drops, state resets on reconnect.

9. **Turn sequencing** — Only one turn in-flight at a time. DO class has `turnBusy: boolean` and `turnQueue: Array<{ utterance, speakerFlag }>`. When `turnBusy === true`, new transcripts are pushed to `turnQueue`. After `runTurn()` completes, it drains the queue (see §6.2). This prevents concurrent Brain requests for the same call.

10. **Deepgram STT `UtteranceEnd` vs `is_final`** — `is_final` marks a final transcript for a speech segment. `UtteranceEnd` fires after `utterance_end_ms` of silence. Use `is_final` transcripts for turn dispatch. `UtteranceEnd` is a confirmation signal, not a trigger.

---

## 17. CONTRACT DEPENDENCIES

| Contract | Direction | Notes |
|---|---|---|
| `TurnRequestV1` | OUT (to Brain) | Defined in Chunk 0 |
| `TurnPlanV1` | IN (from Brain) | Defined in Chunk 0 |

No new contracts needed for Chunk 3.

---

## 18. DEPENDENCY GRAPH

```
Chunk 0 (contracts) ← DONE
Chunk 1 (Brain DO) ← DONE, T3 Codex PASS
  ↓
Chunk 2 (Prompt Worker) ← DONE, T3 Codex PASS
  ↓
Chunk 3 (Realtime Transport) ← THIS SPEC
  ↓
Chunk 4 (Telemetry) — optional, non-blocking
Chunk 5 (Extraction Workflow) — Brain dispatches, independent of transport
```

---

END OF SPEC v3 — T3 P1-NEW-1 (SSE abort) + P1-NEW-2 (greeting queue drain) FIXED — AWAITING T3 RE-REVIEW
