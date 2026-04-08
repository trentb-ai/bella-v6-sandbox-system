/**
 * chris-voice-client.js v1.0.0
 * WIRED TO: bella-voice-agent-v2-rescript
 */
(function () {
  const AGENT_BASE = 'wss://bella-voice-agent-v2-rescript.trentbelasco.workers.dev';
  const TARGET_RATE = 16000;
  const BARGE_IN_RMS = 0.09;
  const BARGE_IN_RMS_INTRO = 0.18;
  const BARGE_IN_MS = 400;
  const BARGE_IN_COOLDOWN_MS = 600;
  const POST_COOL_MS = 0;

  const _urlParams = new URLSearchParams(window.location.search);
  const lid = _urlParams.get('lid') || 'default';
  const _scrapeBiz = _urlParams.get('biz') || '';

  let ws = null;
  let audioContext = null;
  let analyser = null;
  let rmsBuffer = [];
  let lastSpokeTime = Date.now();
  let bargingIn = false;
  let micStarted = false;
  let postCooldownTimeout = null;

  window.ChrisVoiceClient = {
    async init() {
      try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const source = audioContext.createMediaStreamAudioSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 4096;
        source.connect(analyser);
        micStarted = true;
        console.log('[ChrisV1] Microphone started');
        return true;
      } catch (e) {
        console.error('[ChrisV1] Mic error:', e);
        return false;
      }
    },

    connect(onMessage, onError) {
      const wsParamStr = [
        `lid=${encodeURIComponent(lid)}`,
        ..._scrapeBiz ? [`biz=${encodeURIComponent(_scrapeBiz)}`] : []
      ].join('&');
      
      const url = `${AGENT_BASE}/agents/chris-agent/${encodeURIComponent(lid)}${wsParamStr ? '?' + wsParamStr : ''}`;
      console.log('[ChrisV1] Connecting to:', url);
      
      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      
      ws.onopen = () => {
        console.log('[ChrisV1] Connected');
        this.init();
      };
      
      ws.onmessage = (evt) => {
        if (onMessage) onMessage(evt.data);
      };
      
      ws.onerror = (evt) => {
        console.error('[ChrisV1] WS error', evt);
        if (onError) onError(evt);
      };
      
      ws.onclose = () => {
        console.log('[ChrisV1] Disconnected');
      };
    },

    sendAudio(pcmData) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(pcmData);
      }
    },

    close() {
      if (ws) ws.close();
    }
  };
})();
