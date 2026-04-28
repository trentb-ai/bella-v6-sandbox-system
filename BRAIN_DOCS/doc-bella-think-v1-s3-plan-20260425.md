# BELLA THINK AGENT V1 — S3 SPRINT PLAN
Date: 2026-04-25 AEST
Authority: Trent Belasco
D1 ID: doc-bella-think-v1-s3-plan-20260425
Status: S3-1 IN PROGRESS (T3a spec review), S3-2 QUEUED

---

## S3 SPRINT 1 — Transport Adapter /v2-compat
Status: SPEC WITH T3a (06pht1zr) — awaiting SPEC_VERDICT
Owner: T4 (on T3a PASS)
Version bump: 3.10.0-think → 3.11.0-think

### Goal
Add /v9/chat/completions intercept → Think Agent brain. Deepgram Voice Agent POSTs OpenAI-format requests directly. Bridge bypassed.

### Files
- `worker.ts`: intercept /v9/chat/completions, extract LID from system message, read `lead:{lid}:fast-intel` on first turn, forward to DO `/compat-turn`
- `bella-agent.ts`: `/compat-turn` handler — parse messages, initSession on first turn, OpenAI SSE adapter → runFiber → chat()

### Key decisions
- LID regex: `/lead[\s_]id\s*(?:is\s*[:=]?|[:=])\s*([a-z0-9][a-z0-9_\-:.]{3,})/i`
- KV key mismatch bridged: fast-intel writes `lead:{lid}:fast-intel`, initSession reads `brief:{lid}` — adapter reads correct key, passes as `starterIntel`
- runFiber fiber ID: `compat:{lid}`
- OpenAI SSE format: `chatcmpl-{uuid}` chunks, `data: [DONE]` at end

### Acceptance criteria
1. POST /v9/chat/completions + valid system message → SSE stream
2. SSE chunks in OpenAI `chat.completion.chunk` format
3. Final event: `data: [DONE]`
4. First turn triggers `initSession(lid, starterIntel)` — subsequent turns skip (`cs` set)
5. `npx wrangler deploy --dry-run` passes

---

## S3 SPRINT 2 — Prompt Porting (Bridge → Think Agent)
Status: QUEUED — pending S3-1 deploy + T5 health pass
Source: T9 ARCH_BRIEF #1 + #2 (2026-04-25 AEST)
Reference: `bridge-v2-rescript/src/index.ts`

### Action items

#### 1. buildSoulContext diff + port (bella-agent.ts line 676)
vs bridge `executionBlock` (index.ts line 1509-1574). Missing:
- Section 6: ROI RULES (entirely absent in Think)
- Section 8 DO-NOT: add 2 missing items ("Do not ask every branch in sequence" + "Do not switch into architecture/platform/workers/implementation talk")
- Section 2: add "Do not remain in a question stage once controller marks stage ready for ROI"
- Section 1: update opener to bridge verbatim: "The prospect just submitted their details on your website — they gave you their name and business URL. Your system scraped their site in real time."

#### 2. buildStageDirectiveContext diff + port (bella-agent.ts line 726)
vs bridge `buildDOTurnPrompt` (index.ts line 2545-2613). Missing:
- Rule 4: full banned-phrases list from bridge line ~2601
- Rule 5: bridge SCRIPT COMPLIANCE phrasing (one brief sentence allowed before script) vs Think's vaguer "VERBATIM DELIVERY"
- All 9 OUTPUT RULES (V2) must be present verbatim (Think has 8)

#### 3. buildIntelContext full rebuild (bella-agent.ts line 781)
vs bridge `buildFullSystemContext` Part 2 (index.ts line 1576-1648). Missing ~15 fields:
- `[INTEL QUALITY: LIMITED]` stub intel warning
- tagline, business model, phone, hours
- Full tech stack: CRM, booking, chat (with AI assessment), email, payment, ecommerce, platform
- Ad pixels on site
- Social presence
- Hero message fallback chain: `scriptFills.hero_header_quote` → raw hero → `og_description`
- `website_strength` personal-opinion prefix stripping
- ICP validation question stripping
- `key_opportunity`, opener
- Market position / ICP narrative
- Site observation
- Conversation hooks (capped at 3)
- `[APIFY_ENRICHED]` marker

#### 4. Port utility functions verbatim (bridge line refs)

| Function | Bridge line | Purpose |
|---|---|---|
| `stripApologies()` | 741-787 | Strip XML leaks, hallucination, 20+ apology/deflection regex patterns |
| `hasPromptArtifacts()` | 790-792 | Detect leaked prompt artifacts |
| `normaliseBizName()` | 806-816 | Strip AU city names + legal suffixes (Pty Ltd etc.) |
| `ttsAcronym()` | 820-822 | Acronym formatter (pass-through now, interface preserved) |
| `custTerm()` | 826-839 | industry→customer-term map (dental→patient, legal→client, trade→job etc.) |
| `getLid()` | 2234-2254 | Two-pass LID extraction from messages |
| `lastUser()` | 2256-2260 | Get last user message text |
| `trimHistory()` | 1439-1449 | Keep only last 2 user turns, strip prior Bella utterances |
| `shortBizName()` | 797-801 | First word unless stop word |

#### 5. Port trimHistory into beforeTurn() hook
Think currently passes full message history to Gemini via context providers.
Bridge passes only last 2 user turns (`trimHistory`).
Integration point: `beforeTurn()` hook — trim `ctx.messages` before inference loop.

### Gate
T3a SPEC_VERDICT PASS + T3a CODEX PASS before deploy.

---

## NOTES
- Bridge source of truth: `bella-golden-v1` git tag
- Think Agent working dir: `~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
- Bridge source: `~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/bridge-v2-rescript/src/index.ts`
- Rollback snapshot tag: `BELLA-THINK-PRE-BRIDGE-BLOWN-bella-think-agent-v1-brain` (pushed 2026-04-25)

---

## CODEX SCOPE — THINK AGENT V1
### Where Codex CAN vs CANNOT judge. Read before routing any gate request.

### CAN judge (SDK-agnostic)
- Pure string template changes (buildSoulContext, buildStageDirectiveContext)
- Object field access + string building (buildIntelContext)
- Standalone utility functions (utils.ts)
- TypeScript correctness at language level
- Architectural coupling between our own modules
- State machine logic (flow.ts, gate.ts, moves.ts)
- Diff scope drift and hidden coupling
- Evidence chain sufficiency
- DO patterns, AbortController, ReadableStream — established JS, not @cloudflare/think SDK

### CANNOT judge (post-cutoff SDK — @cloudflare/think@0.1, agents@0.9+)
- ctx.messages mutation safety in beforeTurn()
- subAgent() patterns and return types
- runFiber() and fiber recovery semantics
- @callable() decorator behavior
- chat() callback signatures
- Session compaction behavior
- Any question: "does the SDK do X when we call Y"

### Protocol for SDK-uncertain actions
1. T5 reads `.d.ts` from node_modules/ (do NOT ask Codex)
2. T2 specs from real types, not assumptions
3. T3a reviews diff quality and coupling only — not SDK correctness
4. Compiler gate (tsc --noEmit = 0) + runtime test = real SDK proof

### Per-action Codex routing (S3 sprint)

| Action | Codex? | Reason |
|--------|--------|--------|
| S3-1 compat-turn | YES | DO/AbortController/ReadableStream = established JS |
| S3-2 Action 1 buildSoulContext | YES | Pure string templates |
| S3-2 Action 2 buildStageDirectiveContext | YES | Pure string templates |
| S3-2 Action 3 buildIntelContext | YES | TypeScript field access only |
| S3-2 Action 4 utils.ts utilities | YES | Pure TypeScript |
| S3-2 Action 5 trimHistory in beforeTurn() | BLOCKED | ctx.messages mutation = SDK behavior — T5 .d.ts discovery first |
| Any sprint touching subAgent/runFiber/@callable/chat() | SKIP for SDK questions | T5 .d.ts first, Codex judges diff quality only |
