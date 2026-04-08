/**
 * realtime-agent-v3/src/realtime-do.ts — RealtimeAgent Durable Object
 * Chunk 3 — V3
 *
 * Pure transport layer. Zero business logic. No stage machine, no extraction,
 * no prompt building, no Gemini calls, no KV reads.
 *
 * Manages:
 * - Browser WebSocket lifecycle (accept, message, close)
 * - Deepgram STT WebSocket (audio forwarding + STT event handling)
 * - Deepgram TTS WebSocket (Speak commands in, PCM audio out to browser)
 * - Turn queue (one Brain request in-flight per call)
 * - Barge-in (<100ms TTS clear)
 * - Deepgram keepalive
 *
 * State is ephemeral — no DO storage writes. Brain DO holds durable call state.
 */

import { DurableObject } from 'cloudflare:workers';
import type { Env, AgentState, QueuedTurn, DeepgramSTTEvent, DeepgramTTSEvent } from './types';
import { openDeepgramSTT, openDeepgramTTS, startKeepAlive } from './deepgram';
import { determineSpeaker, extractTranscript } from './speaker';
import { handleBargeIn } from './barge-in';
import { dispatchTurn } from './turn-dispatch';
import { isAudioFrame } from './audio';

export class RealtimeAgent extends DurableObject {
  private env: Env;

  // ── Connections ──────────────────────────────────────────────────────────
  private browserWs: WebSocket | null = null;
  private sttWs: WebSocket | null = null;
  private ttsWs: WebSocket | null = null;

  // ── Call state ───────────────────────────────────────────────────────────
  private callId: string = '';
  private turnIndex: number = 0;

  // AgentState — passed to dispatchTurn and handleBargeIn (P1-1/P1-2)
  private agentState: AgentState = {
    isSpeaking: false,
    pendingTurnId: null,
    activeTtsAbort: null,
  };

  // ── Shutdown flag — prevents reconnect loops on intentional close ────────
  private isShuttingDown = false;

  // ── Turn queue ───────────────────────────────────────────────────────────
  private turnBusy: boolean = false;
  private turnQueue: QueuedTurn[] = [];

  // ── Keepalive ────────────────────────────────────────────────────────────
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  // ── Reconnect tracking ───────────────────────────────────────────────────
  private sttReconnectAttempted: boolean = false;
  private ttsReconnectAttempted: boolean = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.env = env;
  }

  // ─── Fetch handler (WebSocket upgrade) ────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: '1.2.0', worker: 'realtime-agent-v3' });
    }

    // WebSocket upgrade
    const upgradeHeader = request.headers.get('Upgrade');
    if (upgradeHeader !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    this.callId = url.searchParams.get('callId') ?? crypto.randomUUID();

    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    this.isShuttingDown = false;
    this.turnBusy = false;                    // prevent old in-flight finally from draining new session
    this.turnQueue = [];
    this.sttReconnectAttempted = false;       // reset one-shot reconnect guards
    this.ttsReconnectAttempted = false;
    this.agentState.isSpeaking = false;       // clear phantom barge-in state
    this.agentState.pendingTurnId = null;
    if (this.agentState.activeTtsAbort) {
      this.agentState.activeTtsAbort.abort();
      this.agentState.activeTtsAbort = null;
    }
    this.browserWs = server;

    // Open Deepgram connections
    await this.openDeepgramConnections();

    // Send ready to browser
    this.safeSendToBrowser({ type: 'ready', callId: this.callId });

    // Greeting turn — fire via runTurn() so queue drain works (P1-NEW-2)
    // turnIndex stays 0 for greeting; prospect turns increment before dispatch (§6.1)
    this.runTurn('', 'prospect').catch(err =>
      console.error('[RT] greeting turn failed:', err)
    );

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket handlers ───────────────────────────────────────────────────

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (ws !== this.browserWs) return;
    // Browser → Realtime Agent
    if (isAudioFrame(message)) {
      // Forward PCM audio to Deepgram STT untouched
      if (this.sttWs?.readyState === WebSocket.OPEN) {
        this.sttWs.send(message);
      }
      return;
    }

    // JSON control messages
    try {
      const msg = JSON.parse(message as string);
      this.handleBrowserControl(msg);
    } catch {
      console.warn('[RT] Unparseable browser message');
    }
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    if (ws !== this.browserWs) return;
    console.log(`[RT] Browser WebSocket closed: ${code} ${reason}`);
    this.cleanup();
  }

  webSocketError(ws: WebSocket, error: unknown): void {
    if (ws !== this.browserWs) return;
    console.error('[RT] Browser WebSocket error:', error);
    this.cleanup();
  }

  // ─── Browser control message handler ─────────────────────────────────────

  private handleBrowserControl(msg: Record<string, unknown>): void {
    switch (msg.type) {
      case 'barge_in':
        if (this.agentState.isSpeaking) {
          handleBargeIn(this.sttWs, this.ttsWs, this.browserWs, this.agentState);
        }
        break;

      case 'end':
        this.safeSendToBrowser({ type: 'end' });
        this.cleanup();
        break;

      case 'mute':
        // Mute is handled client-side — audio just stops arriving
        console.log(`[RT] mute=${msg.muted}`);
        break;

      default:
        console.warn(`[RT] Unknown browser message type: ${msg.type}`);
    }
  }

  // ─── Deepgram connection setup ────────────────────────────────────────────

  private async openDeepgramConnections(): Promise<void> {
    try {
      // Open STT WebSocket
      this.sttWs = openDeepgramSTT(this.env.DEEPGRAM_API_KEY);
      this.attachSTTHandlers(this.sttWs);

      // Open TTS WebSocket — attach handlers BEFORE awaiting open to avoid race on fast connections
      this.ttsWs = openDeepgramTTS(this.env.DEEPGRAM_API_KEY);
      this.attachTTSHandlers(this.ttsWs);  // attach BEFORE awaiting open
      await new Promise<void>(resolve => {
        if (this.ttsWs!.readyState === WebSocket.OPEN) { resolve(); return; }
        this.ttsWs!.addEventListener('open', () => resolve(), { once: true });
        this.ttsWs!.addEventListener('error', () => resolve(), { once: true });
        setTimeout(resolve, 3000);
      });

      // Start keepalive
      this.keepAliveTimer = startKeepAlive(this.sttWs);

      console.log(`[RT] Deepgram connections opened callId=${this.callId}`);
    } catch (err) {
      console.error('[RT] Failed to open Deepgram connections:', err);
      this.safeSendToBrowser({ type: 'error', message: 'Audio connection failed' });
    }
  }

  // ─── STT WebSocket handlers ───────────────────────────────────────────────

  private attachSTTHandlers(ws: WebSocket): void {
    ws.addEventListener('message', (event) => {
      if (ws !== this.sttWs) return;
      try {
        const data = JSON.parse(event.data as string) as DeepgramSTTEvent;
        this.handleSTTEvent(data);
      } catch {
        // Binary from STT is unexpected — skip
      }
    });

    ws.addEventListener('close', (event) => {
      if (ws !== this.sttWs) return;
      console.log(`[RT] STT WebSocket closed: ${event.code}`);
      this.handleSTTDisconnect();
    });

    ws.addEventListener('error', (event) => {
      if (ws !== this.sttWs) return;
      console.error('[RT] STT WebSocket error:', event);
    });
  }

  private handleSTTEvent(event: DeepgramSTTEvent): void {
    switch (event.type) {
      case 'Results': {
        const transcript = extractTranscript(event);
        const speaker = determineSpeaker(event);

        // Forward interim results to browser for live captions
        if (!event.is_final && transcript) {
          this.safeSendToBrowser({ type: 'interim', text: transcript });
        }

        // P1-5: Filter empty/unknown — do NOT dispatch
        if (!transcript || speaker === 'unknown') return;

        // P1-6: If Bella is speaking when prospect talks → barge-in first
        if (this.agentState.isSpeaking) {
          handleBargeIn(this.sttWs, this.ttsWs, this.browserWs, this.agentState);
        }

        // P1-4: Queue if busy, dispatch if free
        if (this.turnBusy) {
          const TURN_QUEUE_MAX = 5;
          if (this.turnQueue.length >= TURN_QUEUE_MAX) {
            console.warn(`[RT] turnQueue full (${TURN_QUEUE_MAX}) — dropping oldest turn`);
            this.turnQueue.shift();
          }
          this.turnQueue.push({ utterance: transcript, speakerFlag: 'prospect' });
          console.log(`[RT] queued turn (queue=${this.turnQueue.length})`);
          return;
        }

        // Increment turnIndex for prospect turns (greeting stays at 0)
        this.turnIndex++;
        this.runTurn(transcript, 'prospect').catch(err =>
          console.error('[RT] runTurn error:', err)
        );
        break;
      }

      case 'SpeechStarted': {
        // VAD detected speech start — trigger barge-in if Bella is speaking
        if (this.agentState.isSpeaking) {
          handleBargeIn(this.sttWs, this.ttsWs, this.browserWs, this.agentState);
        }
        break;
      }

      case 'UtteranceEnd': {
        // Confirms end of utterance — informational only, is_final handles dispatch
        break;
      }

      case 'Metadata': {
        console.log('[RT] Deepgram STT metadata:', JSON.stringify(event));
        break;
      }

      case 'Error': {
        console.error('[RT] Deepgram STT error event:', JSON.stringify(event));
        this.handleSTTDisconnect();
        break;
      }
    }
  }

  private handleSTTDisconnect(): void {
    if (this.isShuttingDown) return;
    if (this.sttReconnectAttempted) {
      this.safeSendToBrowser({ type: 'error', message: 'Audio connection lost' });
      return;
    }
    this.sttReconnectAttempted = true;
    console.log('[RT] Attempting STT reconnect...');
    try {
      this.sttWs = openDeepgramSTT(this.env.DEEPGRAM_API_KEY);
      this.attachSTTHandlers(this.sttWs);
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = startKeepAlive(this.sttWs);
    } catch (err) {
      console.error('[RT] STT reconnect failed:', err);
      this.safeSendToBrowser({ type: 'error', message: 'Audio connection lost' });
    }
  }

  // ─── TTS WebSocket handlers ───────────────────────────────────────────────

  private attachTTSHandlers(ws: WebSocket): void {
    ws.addEventListener('message', (event) => {
      if (ws !== this.ttsWs) return;
      // Binary audio → forward directly to browser
      if (event.data instanceof ArrayBuffer) {
        if (this.browserWs?.readyState === WebSocket.OPEN) {
          this.browserWs.send(event.data);
        }
        return;
      }

      // JSON TTS events
      try {
        const data = JSON.parse(event.data as string) as DeepgramTTSEvent;
        this.handleTTSEvent(data);
      } catch {
        // Skip malformed
      }
    });

    ws.addEventListener('close', (event) => {
      if (ws !== this.ttsWs) return;
      console.log(`[RT] TTS WebSocket closed: ${event.code}`);
      this.handleTTSDisconnect();
    });

    ws.addEventListener('error', (event) => {
      if (ws !== this.ttsWs) return;
      console.error('[RT] TTS WebSocket error:', event);
    });
  }

  private handleTTSEvent(event: DeepgramTTSEvent): void {
    switch (event.type) {
      case 'Flushed': {
        // TTS buffer drained — Bella finished speaking
        this.agentState.isSpeaking = false;
        this.agentState.pendingTurnId = null;
        console.log('[RT] TTS Flushed — isSpeaking=false');
        break;
      }

      case 'Warning': {
        console.warn('[RT] Deepgram TTS warning:', event.message);
        break;
      }

      case 'Error': {
        console.error('[RT] Deepgram TTS error:', event.message);
        this.handleTTSDisconnect();
        break;
      }
    }
  }

  private handleTTSDisconnect(): void {
    if (this.isShuttingDown) return;
    if (this.ttsReconnectAttempted) {
      this.safeSendToBrowser({ type: 'error', message: 'Audio output lost' });
      return;
    }
    this.ttsReconnectAttempted = true;
    console.log('[RT] Attempting TTS reconnect...');
    try {
      this.ttsWs = openDeepgramTTS(this.env.DEEPGRAM_API_KEY);
      this.attachTTSHandlers(this.ttsWs);
    } catch (err) {
      console.error('[RT] TTS reconnect failed:', err);
      this.safeSendToBrowser({ type: 'error', message: 'Audio output lost' });
    }
  }

  // ─── runTurn() — single turn execution with queue drain ───────────────────

  /**
   * Execute one turn through dispatchTurn().
   * Sets turnBusy flag. finally block drains queue (P1-4 spec §6.2).
   * Greeting (turnIndex===0) calls this directly — no increment (§6.5).
   */
  private async runTurn(utterance: string, speakerFlag: 'prospect'): Promise<void> {
    this.turnBusy = true;

    try {
      await dispatchTurn(
        this.callId,
        utterance,
        speakerFlag,
        this.turnIndex,
        this.env,
        this.ttsWs!,
        this.browserWs!,
        this.agentState,
      );
    } finally {
      this.turnBusy = false;
      if (this.isShuttingDown) return;
      // Drain queue — process next turn if any queued during this one
      if (this.turnQueue.length > 0) {
        const next = this.turnQueue.shift()!;
        this.turnIndex++;
        await this.runTurn(next.utterance, next.speakerFlag);
      }
    }
  }

  // ─── Cleanup ──────────────────────────────────────────────────────────────

  private cleanup(): void {
    this.isShuttingDown = true;
    this.stopKeepAlive();

    if (this.agentState.activeTtsAbort) {
      this.agentState.activeTtsAbort.abort();
      this.agentState.activeTtsAbort = null;
    }

    if (this.sttWs) {
      try { this.sttWs.close(); } catch {}
      this.sttWs = null;
    }
    if (this.ttsWs) {
      try { this.ttsWs.close(); } catch {}
      this.ttsWs = null;
    }
    this.browserWs = null;
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer !== null) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private safeSendToBrowser(msg: object): void {
    if (this.browserWs?.readyState === WebSocket.OPEN) {
      this.browserWs.send(JSON.stringify(msg));
    }
  }
}
