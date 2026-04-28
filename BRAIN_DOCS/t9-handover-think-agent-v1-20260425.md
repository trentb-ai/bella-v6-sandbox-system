# T9 Architect Handover — Think Agent V1
### Filed: 2026-04-25 AEST | Outgoing T9 → Incoming T9
### Session: bella-think-agent-v1-brain canary + launch readiness

---

## YOUR ROLE

You are T9 Architect (Opus). System design counsel for Trent directly. You brief T1 or T2 only — never below. You do not write code, review PRs, or execute. You think, design, document, and decide.

**Prompt file:** `prompts/t9_architect.md` — READ IN FULL on every session start.

**Outbound format:** `ARCH_BRIEF:` prefix to T1 or T2 via claude-peers.

**Authority law (CRITICAL):** T9 recommends → T1 takes to Trent → Trent approves → T1 dispatches. You NEVER claim Trent's authority. Never write "Trent GO", "Trent-approved", or "Trent directive" in briefs. Previous T9 was stood down 3x for this.

---

## WHAT WE'RE BUILDING

**Think Agent V1** — complete rewrite of Bella's brain on Cloudflare's experimental Think Agent SDK (`@cloudflare/think@^0.4.0`).

**Bella** is an inbound website voice AI sales receptionist. Prospects submit details on a website funnel → system scrapes their site (~20s) → Bella greets them with personalised insights → demos AI agents tailored to their business. She is NOT a cold caller. She NEVER asks what their business does (she has scrape data).

**Think Agent codebase:** `~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`

**Key files:**
- `src/bella-agent.ts` (803 lines) — main BellaAgent, extends Think<Env, BellaConfig>
- `src/worker.ts` (81 lines) — fetch handler, exports all agents
- `src/types.ts` (225 lines) — full type definitions
- `src/controller.ts` (151 lines) — stage machine
- `src/moves.ts` — stage directives, critical facts, context notes
- `src/wow-agent.ts` (107 lines) — WowAgent sub-agent
- `src/consultant-agent.ts` — ConsultantAgent sub-agent
- `src/deep-scrape-agent.ts` — DeepScrapeAgent sub-agent (stub)
- `src/roi-agent.ts` — ROIAgent sub-agent
- `src/precall-workflow.ts` — BellaPreCallResearch workflow

---

## SDK LANDSCAPE (post-cutoff — Codex can't judge these)

| SDK | Version | Key gotcha |
|-----|---------|------------|
| `@cloudflare/think` | ^0.4.0 | Experimental. Think extends Agent with LLM integration, sub-agents, sessions, context blocks |
| `agents` | ^0.11.5 | @callable() uses TC39 decorators (NOT experimentalDecorators). runFiber() for durable execution |
| `ai` | ^6.0.0 | tool() uses `inputSchema` not `parameters` — BREAKING from v4 |
| `zod` | ^4.0.0 | Required by agents@0.9+. Schema API changes from v3 |
| `@ai-sdk/openai` | ^3.0.0 | createOpenAI for Gemini via OpenAI-compatible endpoint |

**Codex scoping:** Codex CLI (GPT-based) has NO training data on these SDKs. Use T5 `.d.ts` discovery for SDK questions. Codex lanes that still apply: PATCH_REVIEW, MERGE_GATE, VERIFICATION, REGRESSION_SCAN (all SDK-agnostic). Full protocol in `canonical/codex-doctrine.md` → "Think Agent Codex Scope" section.

---

## CURRENT STATE (as of 2026-04-25)

### What's done:
- Sprint 1 Phase 1: All type errors resolved. `tsc --noEmit` passes clean.
- TC39 decorator fix: `experimentalDecorators` removed from tsconfig.json
- AI SDK v6 migration: all tool() calls use `inputSchema`
- child.chat() callback pattern correctly implemented (NOT simple await)
- Codex doctrine updated with Think Agent scoping protocol
- AGENTS.md updated with Think Agent scoping section

### What's in flight:
- Sprint 1 Phase 2+3: Deploy + canary + secrets (T2 speccing now)

### What's next (sprint roadmap):
1. **Sprint 1 Phase 2+3** — Deploy to CF, set secrets, run 7-step canary
2. **Sprint 2** — Gap closure: abortSubAgent, compactAfter, DeepScrapeAgent, keepAliveWhile, wow_8 `||true`
3. **Sprint 3** — Bridge integration: connect existing Deepgram voice agent to Think Agent brain (adapter layer)
4. **Sprint 4** — Integration canary + polish
5. **Launch** — existing voice layer + new brain + existing intel pipeline

---

## KNOWN RISKS (verify these — they may be resolved by the time you read this)

1. **abortSubAgent()** — called at bella-agent.ts:452. May not exist in Think SDK. If throws, sub-agent orchestration breaks.
2. **compactAfter(8000)** — called at bella-agent.ts:73 in configureSession(). Not found in Context7 docs. May be no-op or throw.
3. **keepAliveWhile** — referenced in codebase. Not in Context7 docs. Runtime test needed.
4. **Version mismatch** — package.json says "3.1.0-think", worker.ts says "3.8.0-think". Must align before deploy.
5. **DeepScrapeAgent** — stub only, needs Apify integration to be functional.
6. **wow_8 `|| true`** in controller.ts:shouldAdvanceWowStep — always advances. May be debug artifact.

---

## LAWS YOU MUST KNOW (previous T9 learned these the hard way)

1. **Voice layer is NOT a blocker** — Existing Deepgram voice agent (bella-voice-agent-v2-rescript) IS the launch voice layer. @cloudflare/voice upgrade is POST-LAUNCH. Never list voice as gap, blocker, or "Sprint 3 prerequisite." Saved as LAW in memory.

2. **Authority law** — You recommend. T1 routes to Trent. Trent approves. You NEVER claim Trent's authority in any brief. No "Trent GO", "Trent directive", "Trent-approved" unless Trent literally said it to you.

3. **Bella is inbound** — NOT a cold caller. She greets website visitors who submitted their details. She already knows their business from scrape data. Cold-call framing = P0 FAIL.

4. **Bella never asks what the business does** — She has the scrape data. Any prompt asking "what does your business do?" = P0 FAIL.

5. **Bella never criticises a prospect's website** — Maximise whatever they have. No negative framing.

6. **Codex post-cutoff protocol** — Don't send SDK-specific questions to Codex. Use T5 .d.ts discovery. Codex only for SDK-agnostic lanes (patch review, merge gate, verification, regression scan).

7. **All times AEST** — Never display UTC to Trent.

---

## CANARY TESTING PLAN (already briefed to T1+T2)

Full 7-step canary plan delivered to team. Key points:
- Old headless-harness.sh is DEAD for Think Agent (targets V2-rescript bridge endpoints)
- New canary uses direct RPC to Think Agent brain endpoints: /health, /intel, /fn/processBridgeTurn, /debug/:lid, /state/:lid
- 12 verification points covering health, intel, stage machine, personalisation, ROI, context blocks, chat recovery, memory persistence
- T2 owns spec. T5 greps .d.ts files for runtime risks BEFORE T4 fires canary.

---

## TEAM STATUS (as of this handover)

| Peer ID | Terminal | Status |
|---------|----------|--------|
| ndgwjijm | T2 Code Lead | ACK'd canary brief. Queuing T5 for .d.ts grep pre-flight. |
| v2yunbjv | T4 Minion A | Standing by for T2 task assignments |
| f212m5yl | T0 EA+PM | Routing briefs |
| pf7cpb6b | Unknown | Online |
| hk5lx5im | Unknown | Online |
| vd7ns2ie | Unknown | Online |
| 7wdtgtx6 | Unknown | Online |

---

## YOUR STARTUP CHECKLIST

1. `set_summary` — "T9 Architect — system design counsel for Trent"
2. Read `TEAM_PROTOCOL.md`
3. Read `canonical/codex-doctrine.md`, `canonical/codex-routing-matrix.md`, `canonical/codex-request-contract.md`, `canonical/team-workflow.md`
4. Read `prompts/t9_architect.md` (your full instructions)
5. Read THIS handover
6. `list_peers` + `check_messages`
7. Send `STATUS: T9 Architect online` to T1
8. Wait for Trent or T1 to brief you. Do not proactively start designing.

---

## ARCHITECTURAL DECISIONS PENDING YOUR INPUT

When Trent or T1 asks:

**Sprint 3 adapter layer design** — How to connect existing Deepgram voice agent to Think Agent brain. Three options evaluated:
- (a) `/turn-v2-compat` endpoint on brain (~30 lines) — T2 prefers this, lowest surface area
- (b) Thin translator worker between voice agent and brain
- (c) Update voice agent to call Think Agent RPC directly

T2 will spec this after Sprint 1 canary passes. You may be asked to weigh in on the adapter contract.

**Post-launch voice upgrade** — When @cloudflare/voice is stable enough. NOT a launch blocker. Your call on timing and architecture when Trent asks.

---

## FILES MODIFIED THIS SESSION

- `canonical/codex-doctrine.md` — Added "Think Agent Codex Scope — Post-Cutoff SDK Protocol" section
- `AGENTS.md` — Added "Think Agent V1 — Codex Scoping" section
- `BRAIN_DOCS/t9-handover-think-agent-v1-20260425.md` — This file

---

End of handover. Good luck.
