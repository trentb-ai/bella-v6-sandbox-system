/**
 * bella-voice-client.js v2.7.2
 *
 * Deepgram official per-chunk audio pattern (matches dg_react_agent AudioManager).
 * No drain loop — each audio chunk is scheduled immediately on arrival.
 * AgentAudioDone (forwarded as "listening") marks true end of utterance.
 *
 * Audio rates:
 *  - Playback AudioContext: 24000Hz (Deepgram Aura-2 native TTS output rate)
 *  - Input mic: 16000Hz (Deepgram STT expects this)
 *  - Worker requests sample_rate: 24000 from Deepgram
 *
 * Architecture: Browser → WS → CF Durable Object → Deepgram Voice Agent
 *   Input:  linear16 PCM @ 16kHz (mono)
 *   Output: linear16 PCM @ 24kHz (Aura-2 native rate)
 */
(function () {

  const AGENT_BASE = 'wss://bella-voice-agent-v2-rescript.trentbelasco.workers.dev';
  const TARGET_RATE = 16000;   // Must match Deepgram Settings audio.input.sample_rate
  const BARGE_IN_RMS = 0.09;       // RMS threshold for barge-in after echo window clears
  const BARGE_IN_RMS_INTRO = 0.18; // Higher threshold during first 600ms — blocks initial echo burst
  const BARGE_IN_MS = 400;         // Hold time before interrupt (lowered from 700ms)
  const BARGE_IN_COOLDOWN_MS = 600; // Echo-protection window at start of each Bella turn
  const POST_COOL_MS = 0;           // Official pattern: zero cooldown — mic always streams, Deepgram VAD handles it

  // Pull scraped data from URL params (set by loading-v15.html redirect)
  const _urlParams = new URLSearchParams(window.location.search);
  const lid = _urlParams.get('lid') || 'default';
  const _scrapeBiz = _urlParams.get('biz') || '';
  const _scrapeInd = _urlParams.get('ind') || '';
  const _scrapeServ = _urlParams.get('serv') || '';
  const _scrapeLoc = _urlParams.get('loc') || '';
  const _scrapeFn = _urlParams.get('fn') || '';

  // ── State ──────────────────────────────────────────────────────────────────
  let ws = null;
  let micStream = null;
  let audioCtx = null;   // AudioContext locked to TARGET_RATE for capture
  let processor = null;
  let connecting = false;
  let connected = false;
  let bellaActive = false;  // true while Bella's audio is playing/queued

  let bargeInTimer = null;
  let cooldownUntil = 0;
  let ignoreAudio = false;
  let bargeInCooldownUntil = 0;  // tracks end of per-turn echo-protection window
  let binaryMsgCount = 0;
  let agentAudioDone = false;    // true when Deepgram has finished sending audio for current utterance

  // ── UI ─────────────────────────────────────────────────────────────────────
  const widget = document.getElementById('bella-widget');
  const labelNode = document.getElementById('bella-widget-label');
  const statusEl = document.getElementById('bella-widget-status');

  function setLabel(main, sub) {
    if (labelNode) labelNode.firstChild.textContent = main;
    if (statusEl) statusEl.textContent = sub;
  }

  function setListening(on) {
    widget && widget.classList.toggle('listening', on);
  }

  // ── Public toggle ──────────────────────────────────────────────────────────
  window.bellaWidgetToggle = function () {
    if (!connected && !connecting) startCall();
    else if (connected) endCall();
  };

  // ── Start call ─────────────────────────────────────────────────────────────
  async function startCall() {
    if (connecting) return;
    connecting = true;
    setLabel('Connecting…', 'Setting up call');
    widget.style.pointerEvents = 'none';

    // CRITICAL: Create AND resume the playback AudioContext HERE — inside the
    // user gesture click handler. Browsers (Safari, Chrome autoplay policy)
    // will block or suspend AudioContext created outside a user gesture.
    // If we wait until the first audio chunk arrives it is too late.
    // getPlaybackCtx() will reuse this context on every subsequent call.
    if (!playbackCtx || playbackCtx.state === 'closed') {
      playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    if (playbackCtx.state === 'suspended') {
      try { await playbackCtx.resume(); } catch (_) {}
    }
    // Re-zero the schedule clock on each new call
    startTimeRef = 0;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,   // CRITICAL: prevents speaker audio bleeding into mic
          noiseSuppression: true,   // reduces background hiss triggering false VAD
          autoGainControl: false,   // keep gain manual so RMS thresholds are predictable
        },
        video: false
      });
    } catch (e) {
      connecting = false;
      setLabel('Talk to Bella', 'Mic blocked — check browser permissions');
      widget.style.pointerEvents = '';
      return;
    }

    // Pass scraped data as URL params so worker can use them immediately
    const wsParams = new URLSearchParams();
    if (_scrapeBiz) wsParams.set('biz', _scrapeBiz);
    if (_scrapeInd) wsParams.set('ind', _scrapeInd);
    if (_scrapeServ) wsParams.set('serv', _scrapeServ);
    if (_scrapeLoc) wsParams.set('loc', _scrapeLoc);
    if (_scrapeFn) wsParams.set('fn', _scrapeFn);
    const wsParamStr = wsParams.toString();
    const url = `${AGENT_BASE}/ws?callId=${encodeURIComponent(lid)}${wsParamStr ? '&' + wsParamStr : ''}`;
    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      connecting = false;
      connected = true;
      binaryMsgCount = 0;
      window._bellaWS = ws;  // V3 Fix A: expose WS for inject_context shim
      console.log('[BellaV2] connected');
      widget.style.pointerEvents = '';
      setLabel('Connecting to Bella…', 'Just a moment');
      setListening(true);
      startMic();
    };

    ws.onmessage = async (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        binaryMsgCount++;
        if (ignoreAudio) {
          console.log(`[BellaV2] DROPPED audio #${binaryMsgCount} — post-barge-in`);
          return;
        }
        console.log(`[BellaV2] audio #${binaryMsgCount} — ${evt.data.byteLength}b`);
        playAudio(evt.data);
        return;
      }

      let msg;
      try { msg = JSON.parse(evt.data); } catch { return; }
      if (!msg.type) return;
      if (msg.type.startsWith('cf_agent')) return; // SDK internal — ignore

      console.log('[BellaV2] ctrl:', msg.type);

      switch (msg.type) {
        case 'ready':
          setLabel('Connecting to Bella…', 'Just a moment');
          break;
        case 'greeting_ready':
          setLabel(msg.first_name ? `Hi ${msg.first_name}!` : 'Bella speaking…', 'Speak to interrupt');
          bellaActive = true;
          bargeInCooldownUntil = Date.now() + BARGE_IN_COOLDOWN_MS;
          break;
        case 'speaking':
          bellaActive = true;
          ignoreAudio = false;
          bargeInCooldownUntil = Date.now() + BARGE_IN_COOLDOWN_MS;
          setLabel('Bella speaking…', 'Speak to interrupt');
          break;
        case 'user_started_speaking':
          // Deepgram server-side VAD detected user speech — STOP Bella's audio immediately
          console.log('[BellaV2] server barge-in: UserStartedSpeaking');
          stopAllAudio();
          setLabel('Bella listening…', 'Tap to end call');
          break;
        case 'listening':
          // AgentAudioDone from Deepgram — all audio SENT, but may still be scheduled to play.
          // Mark that no more audio is coming. The onended callback on the last source
          // will handle the actual transition to listening state.
          ignoreAudio = false;
          agentAudioDone = true;
          // If nothing is scheduled (or already finished), transition immediately
          if (scheduledSources.size === 0) {
            finishBellaUtterance();
          }
          // Otherwise, the onended callback in playAudio will call finishBellaUtterance
          break;
        case 'transcript':
          console.log('[BellaV2 heard]', msg.text);
          break;
        case 'pipeline_pending':
          // Intel still loading — close this WS and auto-retry in 4s
          console.log('[BellaV2] pipeline_pending — retrying in 4s');
          setLabel('Analysing your business…', 'Connecting in a moment');
          cleanup();
          setTimeout(() => {
            connecting = false;
            connected = false;
            startCall();
          }, 4000);
          break;
        case 'error':
          console.error('[BellaV2 error]', msg.message);
          break;
      }
    };

    ws.onerror = (e) => {
      console.error('[BellaV2] WS error', e);
      connecting = false;
      setLabel('Talk to Bella', 'Connection failed — try again');
      cleanup();
    };

    ws.onclose = () => {
      setLabel('Talk to Bella', 'Voice AI • Click to call');
      setListening(false);
      cleanup();
    };
  }

  // ── End call ───────────────────────────────────────────────────────────────
  function endCall() {
    setLabel('Talk to Bella', 'Voice AI • Click to call');
    setListening(false);
    widget && (widget.style.pointerEvents = '');
    stopAllAudio();
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify({ type: 'end' })); } catch (_) { }
      setTimeout(() => { try { ws.close(); } catch (_) { } }, 200);
    }
    cleanup();
  }

  function cleanup() {
    window._bellaWS = null;  // V3 Fix A: clear global WS ref on disconnect
    connecting = false;
    connected = false;
    bellaActive = false;
    ignoreAudio = false;
    agentAudioDone = false;
    cooldownUntil = 0;
    startTimeRef = 0;
    clearTimeout(bargeInTimer);
    bargeInTimer = null;
    scheduledSources.forEach(s => {
      try { s.onended = null; } catch (_) { }
      try { s.disconnect(); } catch (_) { }
      try { s.stop(); } catch (_) { }
    });
    scheduledSources.clear();
    stopMic();
    if (ws) { try { ws.close(); } catch (_) { } ws = null; }
    widget && (widget.style.pointerEvents = '');
    setListening(false);
  }

  // ── Mic capture @ 16kHz → send raw PCM to Deepgram ────────────────────────
  function startMic() {
    if (!micStream) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: TARGET_RATE });
    const src = audioCtx.createMediaStreamSource(micStream);

    processor = audioCtx.createScriptProcessor(4096, 1, 1);

    processor.onaudioprocess = (e) => {
      if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;

      const float32 = e.inputBuffer.getChannelData(0);

      // RMS for voice detection — always calculated even when not streaming
      let sum = 0;
      for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
      const rms = Math.sqrt(sum / float32.length);

      // ── Barge-in: Deepgram official pattern (browser-agent) ─────────────────
      // Mic audio flows to Deepgram AT ALL TIMES — no muting, no local RMS gating.
      // Browser echoCancellation: true (in getUserMedia) prevents speaker bleed.
      // Deepgram's server-side VAD detects user speech → fires UserStartedSpeaking
      // → CF Worker forwards as user_started_speaking → client calls stopAllAudio().

      // ── Deepgram official pattern: mic ALWAYS streams ─────────────────────
      // No local cooldown or muting. Browser echoCancellation: true handles echo.
      // Deepgram server-side VAD detects speech → UserStartedSpeaking event.

      // ── Send PCM to Deepgram ───────────────────────────────────────────────
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
      }
      ws.send(int16.buffer);
    };

    src.connect(processor);
    processor.connect(audioCtx.destination);
    console.log('[BellaV2] Mic started at', TARGET_RATE, 'Hz');
  }

  function stopMic() {
    if (processor) { try { processor.disconnect(); } catch (_) { } processor = null; }
    if (audioCtx) { try { audioCtx.close(); } catch (_) { } audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  }

  // ── Audio playback — Deepgram official per-chunk pattern ─────────────────
  // Matches dg_react_agent AudioManager: each chunk is decoded and scheduled
  // immediately on arrival using startTimeRef. No drain loop, no polling.
  let scheduledSources = new Set();
  let playbackCtx = null;
  let startTimeRef = 0;  // Deepgram pattern: tracks next available playback slot

  function getPlaybackCtx() {
    if (!playbackCtx || playbackCtx.state === 'closed') {
      // Fallback: create here if somehow not created in startCall()
      playbackCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    if (playbackCtx.state === 'suspended') {
      // Best-effort resume — may fail if no user gesture available
      playbackCtx.resume().catch(e => console.warn('[BellaV2] playbackCtx resume failed:', e));
    }
    return playbackCtx;
  }

  // Matches Deepgram official AudioUtils.ts createAudioBuffer — no fading
  function pcm16ToAudioBuffer(arrayBuffer, ctx) {
    const pcm16 = new Int16Array(arrayBuffer);
    if (pcm16.length === 0) return null;
    const audioBuf = ctx.createBuffer(1, pcm16.length, 24000);
    const channel = audioBuf.getChannelData(0);
    for (let i = 0; i < pcm16.length; i++) {
      channel[i] = pcm16[i] / 32768;
    }
    return audioBuf;
  }

  function stopAllAudio() {
    bellaActive = false;
    agentAudioDone = false;
    startTimeRef = 0;
    // Disconnect and stop ALL scheduled sources (Deepgram official clearAudioQueue pattern)
    scheduledSources.forEach(s => {
      try { s.onended = null; } catch (_) { }  // prevent stale callbacks
      try { s.disconnect(); } catch (_) { }
      try { s.stop(); } catch (_) { }
    });
    scheduledSources.clear();
    // Silent buffer flush — official Deepgram pattern to clear audio pipeline
    try {
      const ctx = playbackCtx;
      if (ctx && ctx.state !== 'closed') {
        const silentBuf = ctx.createBuffer(1, 1024, ctx.sampleRate);
        const silentSrc = ctx.createBufferSource();
        silentSrc.buffer = silentBuf;
        silentSrc.connect(ctx.destination);
        silentSrc.start();
      }
    } catch (_) { }
  }

  // ── Utterance completion (matches official activeSourceNodes.length === 0 pattern) ─
  function finishBellaUtterance() {
    if (!bellaActive) return;
    bellaActive = false;
    agentAudioDone = false;
    console.log('[BellaV2] speech done — Bella now listening');
    if (connected) setLabel('Bella listening…', 'Tap to end call');
  }

  // ── Per-chunk scheduling (Deepgram official playAudioBuffer pattern) ───────
  function playAudio(arrayBuffer) {
    const ctx = getPlaybackCtx();
    const decoded = pcm16ToAudioBuffer(arrayBuffer, ctx);
    if (!decoded) return;

    bellaActive = true;
    setLabel('Bella speaking…', 'Speak to interrupt');

    const currentTime = ctx.currentTime;
    // If startTimeRef is in the past, snap to now (gap recovery)
    if (startTimeRef < currentTime) {
      startTimeRef = currentTime;
    }

    // Debug: log context state on first chunk so we can diagnose silent audio
    if (scheduledSources.size === 0) {
      console.log(`[BellaV2] playAudio first chunk — ctx.state=${ctx.state} ctx.sampleRate=${ctx.sampleRate} buf.duration=${decoded.duration.toFixed(3)}s`);
    }

    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.connect(ctx.destination);

    // Track source for barge-in cleanup
    scheduledSources.add(source);
    source.onended = () => {
      scheduledSources.delete(source);
      // Official pattern: when last source finishes AND AgentAudioDone received, transition
      if (scheduledSources.size === 0 && agentAudioDone) {
        finishBellaUtterance();
      }
    };

    source.start(startTimeRef);
    startTimeRef += decoded.duration;
  }

})();
