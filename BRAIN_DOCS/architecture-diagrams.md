# BELLA GOLDEN BEFORE AND AFTER — V1/V2 vs V3 Architecture
**D1 ID:** doc-bella-golden-before-after-architecture-20260407

BEFORE (V1/V2 Monolith):
- Netlify funnel → Fast Intel v9 → KV Store → Consultant v10
- Voice Agent v11 monolith: Stage machine + Gemini LLM call + Extraction (waitUntil)
- Deepgram bridge (STT + TTS single pipe)

SIX ROOT-CAUSE BUGS:
1. BUG 1: KV race condition — Intel arrives after turns already spoken.
2. BUG 2: Empty stages — Consultant conversion micro-call fails silently → stages: [] → Bella ad-libs.
3. BUG 3: Speaker contamination — Bella TTS leaks into STT extraction. 4/14 extracted notes were Bella's own words.
4. BUG 4: No barge-in — No VAD, no TTS clear. Bella talks over interruptions.
5. BUG 5: No extraction retry — ctx.waitUntil fire-and-forget. Gemini failure = facts lost forever.
6. BUG 6: ROI hallucination — Gemini does math inline, gets numbers wrong every time.

AFTER (V3 Separated Concerns):
- Netlify funnel v3 → Fast Intel v3 + Realtime Agent v3
- Fast Intel v3 + Deep Scrape → EVENT POST to Brain v3 DO (FIX 1+2)
- Realtime Agent v3 (pure transport): STT flux, TTS aura-2, VAD + barge-in <100ms (FIX 4), Speaker flag (FIX 3)
- Brain v3 DO (choreographer): Stage machine, TurnPlan gen, ROI calculator (FIX 6), Warm memory, Merge laws
- Prompt Worker v3: receives TurnPlan, calls Gemini, sends speak text to TTS
- Extraction Workflow: durable, validated, retried max 3 (FIX 5)
- Compliance Workflow: 3-ring audit

HOW EACH BUG IS KILLED:
- FIX 1+2: Event POST replaces KV polling. Merge laws prevent consultant:false clobber.
- FIX 3: Speaker flag at transport layer. TTS output vs STT input are separate streams.
- FIX 4: Dedicated VAD + barge-in. <100ms TTS clear.
- FIX 5: Cloudflare Workflow — durable, retryable max 3, Zod validated.
- FIX 6: Deterministic ROI calculator in Brain DO. Pre-computed numbers as lockedLines. Gemini delivers verbatim.

WORKER MAPPING (current live V2 rescript stack):
- Bridge: deepgram-bridge-v2-rescript (source: bridge-v2-rescript/)
- Voice Agent: bella-voice-agent-v2-rescript
- Fast Intel: fast-intel-v9-rescript → binds to call-brain-do-v2-rescript
- Brain (ACTIVE): call-brain-do-v2-rescript (source: brain-v2-rescript/) — CANONICAL BRAIN
- Brain (FROZEN): bella-brain-v8 — DO NOT USE. Sounds newer, is actually oldest.
