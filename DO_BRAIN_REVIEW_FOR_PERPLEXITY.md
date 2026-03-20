# DO BRAIN DIAGNOSTIC REVIEW — For Perplexity/GPT
## Bella V1.1 Voice AI System — Code Review Request
## Date: 20 March 2026

## CONTEXT

We have a voice AI agent (Bella) that conducts sales discovery calls.
The system runs on Cloudflare Workers + Durable Objects + Deepgram Voice Agent API + Gemini 2.5 Flash.

We built a Durable Object ("call-brain-do") to replace a 2,680-line bridge
worker as the state/extraction/gating authority. The DO brain has the correct
Perplexity-approved sales script. When we flipped it live, the call quality
was terrible. We've since applied fixes but need expert review.

## ARCHITECTURE

```
Browser → Netlify → Voice Agent DO (WebSocket + Deepgram)
  → Deepgram STT (Flux) transcribes user speech
  → Deepgram calls Bridge worker (BYO LLM endpoint)
  → Bridge POSTs transcript to call-brain-do /turn
  → DO: extracts values, validates, advances stage, returns NextTurnPacket
  → Bridge: builds rich prompt from packet + intel + persona
  → Bridge: streams Gemini 2.5 Flash response
  → Gemini response → Deepgram TTS → browser audio
```

## KNOWN FAILURES (from first live test)
