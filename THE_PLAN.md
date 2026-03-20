# THE PLAN — Bella V9 Master Roadmap

## Last Updated: 19 Mar 2026
## Status: CHUNK 1 COMPLETE ✅ — Smart Wave Scheduler DEPLOYED ✅ — LIVE TEST FAILED (prompt issues) — Bridge prompt fix + Apify priority reallocation IN PROGRESS

---

## THE PIVOT (ACCEPTED 18 MAR 2026)

Bella becomes the 6th agent. Chris upgrades from "concierge" to AI sales agent. Full positioning shift:

- **Chris**: AI sales agent on website + landing pages. Not a greeter — he SELLS, qualifies, handles objections, closes.
- **Alex**: Speed-to-lead follow-up. Catches leads Chris didn't close. SMS, Messenger, Instagram. Under 60 seconds.
- **Maddie**: AI receptionist. Missed calls, after-hours, overflow.
- **Sarah**: Database reactivation. Dormant leads.
- **James**: Reputation/reviews management.
- **Bella**: AI sales consultant. Research-driven personalised discovery. The 6th agent.

**B2B team**: Chris + Alex + Maddie + Bella (all four)
**SMB team**: Chris + Alex + Maddie (Bella sells them the team via demo)
**Enhancement agents**: Sarah + James (valuable add-ons, never lead the pitch)

Tagline candidate: "Turn every website visitor into an instant sales conversation"

See `.claude/skills/PRODUCT_BIBLE.md` for full agent definitions, stats, ROI formulas.

---

## CHUNK 1 — FIX THE PLUMBING (IN PROGRESS)

### Goal
Make Bella's bridge the ONLY script execution path. Remove dead code. Smart agent routing.

### Status

| Step | What | Status |
|------|------|--------|
| Step 1 | Bridge reader + StagePlanV2 types + feature flag | ✅ Deployed 8.12.0 |
| Step 2 | buildQueueV2 + delete V8 machinery + native advance() | ✅ Deployed 8.13.0 |
| Step 2b | Scoring fix — simple branching (ads=Chris+Alex, no ads=CTA-based) | ✅ Deployed 8.14.0 |
| Step 2c | Consultant prompt upgrade — urgency hierarchy, agentScorecard, leadRecommendation + Gemini model fix (old models were dead/404!) | ✅ Deployed, E2E verified |
| Step 3 | Consultant writeStagePlan() — replaces writeScriptStages(), writes StagePlanV2 to KV | ✅ Deployed, E2E verified |
| Step 4 | Delete dead Llama steps (5, 6, 16, Chain A of parallel-wow) + fix downstream refs | ✅ Deployed, verified |
| Step 5 | Remove old stage writers (write-early-stages, write-stages-late) — workflow now 11 clean steps | ✅ Deployed, verified |
| Step 6 | Cleanup — v9.0.0, E2E PASSED: stage_plan v2, correct queue, WOW fires, Gemini 2.5 Flash | ✅ COMPLETE |

### Key Architecture Decisions (DO NOT REVISIT)
- `buildStageDirective()` is the ONLY script engine — DO NOT TOUCH
- `script_stages` replaced by thin `stage_plan` metadata — no script text
- Routing: deterministic branching (not weighted scoring), consultant ranking as tiebreaker
- Max 2 active channel stages + 1 tease + always roi_delivery + close
- All 3 Llama calls are dead — being removed
- Feature flag `BELLA_STAGE_PLAN_V2_ENABLED` for rollback safety

---

## CHUNK 2 — MAKE BELLA A KILLER (AFTER CHUNK 1)

### Demo Page Rewrite
- Add Bella as 6th agent section
- Upgrade Chris from "Website Concierge" to "AI Sales Agent" positioning
- Sharpen all agent copy to reflect the pivot
- Add the Chris + Alex system explanation
- File: `netlify-funnel-sandbox-v9/demo_v15_hybrid.html`

### Bella Script Upgrade
- Update `buildStageDirective()` to reflect new positioning (carefully — this is the DO NOT TOUCH function, needs Trent's explicit approval)
- Update bridge system persona to reflect Bella as 6th agent / consultant
- Improve WOW with more consultative, research-driven opener
- Better data-to-insight conversion (not just facts, but what they MEAN commercially)

### Consultant Deep Upgrade
- Multi-step reasoning (evidence → diagnosis → ranking → brief) — Perplexity recommended
- `conversationStrategy` fields (openingThesis, proofBullets, confirmationQuestions, fallbackPivot)
- Better use of Apify deep data as sales ammunition (competitor reviews, hiring signals as growth indicators)
- Teach consultant to think like a closer, not an analyst

### Agent Persona Handoff (UpdatePrompt)
- "Let me bring Alex on to talk you through your ads" — swap system prompt persona mid-call
- Deepgram `UpdatePrompt` enables this — swap persona when entering a channel stage
- Each agent "owns" their channel stage with distinct voice/personality
- Massive experiential differentiator — nobody else does this

### Conversation-Driven Dynamic Re-ranking
- If prospect says "we're drowning in missed calls" during WOW → boost ch_phone regardless of initial queue
- Bridge's `extractQualitativeSignals()` already captures signals — needs to feed into channel scoring
- Real-time queue adjustment based on what the prospect reveals

### ROI Narrative Power
- Not just math — the STORY around the math
- "Every click is costing you X and Y% are bouncing without a conversation" is more powerful than "23% conversion uplift"
- Consultant's `routing.reasoning` has prospect-specific insight that could sharpen the ROI narrative

---

## CHUNK 3 — SCALE & FUTURE (AFTER CHUNK 2)

### Bella as Standalone B2B Product
- Research-driven personalised outbound voice discovery calls
- Nobody in market does this with VOICE (AiSDR, Piper, Ava all do email/chat)
- 10x more persuasive than email
- Potential product line: "Bella for B2B"

### Stage-Adaptive Flux Configuration
- Deepgram Flux (`flux-general-en`) with stage-specific settings
- Different STT sensitivity for WOW (listening mode) vs channel stages (number capture mode)

### UpdateThink / UpdatePrompt for Mid-Call Intel Injection
- When deep data (Apify) arrives during the call, inject it via UpdatePrompt
- Bella gets smarter as the call progresses — reviews land, ad data lands

### Multi-Agent Handoff Patterns
- Full persona switching between agents during the call
- Voice changes, personality changes, expertise changes
- "Let me bring Maddie on to explain how she handles your after-hours calls"

### Gemini Multimodal
- Screenshot/PDF analysis during live calls
- Prospect shares their screen → Bella analyses in real-time

### More Agents
- As the agent team grows, the scoring/routing system will need more sophistication
- Perplexity's weighted scoring + consultant ranking approach may become relevant at 8+ agents
- Current simple branching works for 5-6 agents

---

## WORKING RULES — NON-NEGOTIABLE (ALL CHUNKS)

1. Root cause before ANY fix
2. One change at a time — deploy, verify, confirm
3. All KV ops need `--remote` flag
4. `wrangler tail --format=json` for all log checks
5. Read deployed worker code before any change
6. If 3+ fixes fail → stop and question architecture
7. `buildStageDirective()` — DO NOT TOUCH without Trent's explicit approval
8. No unsolicited tests, no browser opens
9. NEVER destroy/disable/remove any existing worker/pipeline without explicit approval
10. `capture.html` — DO NOT MODIFY without explicit approval
11. Old pipeline (`personalisedaidemofinal-sandbox`) — DO NOT DISABLE
12. KV namespace ID: `0fec6982d8644118aba1830afd4a58cb`
13. Cloudflare account ID: `9488d0601315a70cac36f9bd87aa4e82`

---

## REFERENCE DOCS IN PROJECT

| File | Purpose |
|------|---------|
| `.claude/skills/PRODUCT_BIBLE.md` | Ground truth — agents, roles, stats, ROI, sales logic, data→agent pitch mapping, hiring→agent replacement wedges |
| `THE_PLAN.md` | THIS FILE — master roadmap, chunk status, working rules |
| `DATA_ENRICHMENT_MASTER_PLAN.md` | **THE BIG DOC (1,500+ lines)** — every data source, every script segment, wave scheduler, quota management, progressive enrichment policy, modular script architecture, hiring signal wedges |
| `HANDOVER_V9.md` | System architecture, data flow, KV keys |
| `PERPLEXITY_SPEC.md` | Architectural blueprint for stage plan |
| `PERPLEXITY_DATA_ENRICHMENT_BRIEF.md` | Perplexity research prompt for scraper alternatives |
| `CC_IMPLEMENTATION_BRIEF.md` | CC's mission for Chunk 1 |
| `V1_UPGRADE_BRIEF.md` | Consultant prompt upgrade spec |
| `SCORING_FIX.md` | Simple branching logic for buildQueueV2 |
| `DATA_ENRICHMENT_BLOCKER.md` | Original blocker doc (superseded by MASTER_PLAN) |
| `DATA_ENRICHMENT_IMPLEMENTATION.md` | Original implementation brief (superseded by MASTER_PLAN) |

---

## WHAT HAPPENED THIS SESSION (18-19 MAR 2026)

### Completed
1. Chunk 1 Steps 1-6 — all deployed and E2E verified (v9.0.0 → v9.1.3)
2. Consultant upgraded — Gemini 2.5 Flash, urgency hierarchy, agentScorecard
3. Gemini model fix — old models (2.0-flash-exp, 1.5-flash) were dead/404, consultant was returning FALLBACK on every call
4. Ads detection bug fixed — deep.ads.google_ads_count now read correctly (v9.0.1)
5. Full 14-turn multi-turn simulation verified — all stages, all extractions, all ROI calcs working
6. Workflow 17% faster (39s vs 47.2s baseline)
7. Phase 1 Enrichment deployed (v9.1.2-v9.1.3) — rich data passthrough, google_ads renamed to google_search, Google Ads Transparency actor added, Seek added, Indeed globalised
8. Smart Wave Scheduler deployed — dynamic wave packing under 8GB Apify Free plan cap, 3 priority-based waves, 5s deallocation delay, conditional actor firing
9. Bella greeting script fixed — new audit welcome, "It looks like" language
10. The Pivot accepted — Bella as 6th agent, Chris upgraded to AI sales agent
11. Product Bible created and expanded with data→agent pitch mappings and hiring→agent replacement wedges
12. DATA_ENRICHMENT_MASTER_PLAN.md written (1,500+ lines) — the complete enrichment vision

### Failed / Pending
1. **LIVE VOICE TEST FAILED** — Bella had 52KB of intel but asked generic questions, went into sorry loops, never got past WOW stall 4
2. **Bridge prompt structure wrong** — directive buried after 8,600 chars of intel, Gemini ignores SAY EXACTLY THIS
3. **Dedup not gating** — duplicate utterances still trigger full prompt builds and increment stall counter
4. **No pushback recovery** — Bella apologises instead of delivering data when challenged
5. **Apify priority reallocation needed** — Indeed promoted to priority 2 (hiring signals = agent replacement wedge)
6. **Hiring signal classification** — extract-deep needs to map job titles to agent replacements

### CC Has These Pending Prompts
1. Bridge prompt fix: flip structure (directive first, intel last), dedup hard gate, never-apologise rule
2. Apify priority reallocation: Indeed to priority 2, hiring signal classification in extract-deep, consultant upgrade for hiring wedges
3. Both should be done in parallel — they're independent changes
