# T2 Code Lead — Full Handover
**Date:** 2026-04-21 AEST  
**Outgoing:** T2 Code Lead (Sonnet, this session)  
**For:** Incoming T2 Code Lead (any model)  
**Authority:** Trent Belasco

---

## 1. YOUR ROLE — EXACTLY

You are **T2 Code Lead**. You own:
- Writing implementation specs (from T9 architectural plans)
- 6-gate manual review on all code before T3 gate
- Routing `CODEX_REVIEW_REQUEST` to T3 (never skip this)
- Sending `TASK_REQUEST` to T4 after T3 PASS
- `DEPLOY_BROADCAST` to T1 after T4 deploys + T5 health passes

You **NEVER**:
- Self-implement (T4 does that)
- Issue PASS or FAIL verdicts (T3 only)
- Read source files or grep code directly (delegate to T5)
- Ask Trent to execute anything

---

## 2. WHAT WE'RE BUILDING

**Bella** = inbound website voice AI sales receptionist. NOT outbound, NOT cold caller.

Flow: Prospect submits details on funnel → system scrapes site (~20-30s) → Bella greets them on-site with personalised insights → demos AI agents (Alex/Chris/Maddie/James/Sarah).

The scrape data is the WOW. Bella knows their business because they gave her the URL. She **never** asks "what does your business do?"

**Active stack:** `~/Desktop/MVPScriptBella/workers/`  
**Frozen reference:** `bella-natural-v1` git tag (DO NOT TOUCH)

---

## 3. CURRENT SPRINT STATE (as of 2026-04-21)

**Sprint:** MVPScriptBella S1 — Stage Machine Restructure + Prompt Fixes (S1+S3 merged)  
**Status:** T4 implementing. Awaiting T4 `REVIEW_REQUEST`.

### What S1 does
Replaces the broken bridge inline `buildStageDirective()` with a fresh port of the canonical script. The old bridge had ~30% alignment with the canonical script. This sprint brings it to 100%.

### 6 Locked Decisions (Trent — never revisit without Trent GO)
1. **Option B** — port canonical script fresh into bridge inline. Brain DO (`moves.ts`) untouched.
2. **S1+S3 merged** — stage machine restructure + prompt fixes = one sprint
3. **Site content blob** = post-launch (not in S1)
4. **WOW 6** → prospect chooses deeper or recommend → WOW 7 source check + 1-2 funnel Qs → then recommend
5. **Deep-scrape descoped** for MVP. `personalisedaidemofinal-sandbox` stays wired, never touch.
6. **Objections descoped** for MVP. Flow: wow → recommend → close → done.

### S1 Spec — 4 documents, read as a set
All in `BRAIN_DOCS/`:

| Doc | Role |
|-----|------|
| `doc-mvpscriptbella-s1-implementation-spec-20260421.md` | Base spec: DELETE (12), REPLACE (14), ADD, WIRING, VERIFY greps, CANARY |
| `doc-mvpscriptbella-s1-spec-revision-a-20260421.md` | Supersedes 2F/2G/2I/2J/2M/3E/Section 5 — new markers, unified TURN BEHAVIOR, KB |
| `doc-mvpscriptbella-s1-spec-revision-b-20260421.md` | Supersedes 4B/4D + RevA 5B — turn handler rewrite, dead code removal, stall 6 policy |
| `doc-mvpscriptbella-s1-spec-revision-c-20260421.md` | Supersedes RevB STEP 1 only — removes `&& s.turns_in_stall >= 1` from capture guards |

**Revision C is the final passing spec.** T3 PASS confirmed with Codex proof.

### T3 Gate History (important — understand why each fix happened)
- **FAIL 1:** P0: capture never fired (advance moved stall before capture checked it). P0: KB read ordering ambiguous. P1: dead [SKIP] code. P1: stall 6 undocumented.
- **FAIL 2:** P0 remained — `turns_in_stall >= 1` guard on capture checked BEFORE increment → always false on first response.
- **PASS:** Revision C removed the guard entirely. Capture fires on every turn at stall 7/8, last write before advance wins.

### Turn Handler Order (CRITICAL — T4 must not deviate)
```
STEP 0: KB read (stall 1, turns_in_stall === 0 only)
STEP 1: Save prevStall/prevStage, then capture (no guard at stall 7/8)
STEP 2: turns_in_stall increment
STEP 3: gateOpen check → advance() if true
STEP 4: buildStageDirective(s)
STEP 5: build prompt → call Gemini
```

---

## 4. MANDATORY READING — ORDERED BY PRIORITY

Read these before touching any spec or review work:

### Architecture + canonical script
| File | What it contains |
|------|-----------------|
| `BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md` | Full pipeline: fast-intel → consultant → KV → bridge → Gemini → TTS. Service bindings map. MVP job-done checklist. |
| `BRAIN_DOCS/doc-bella-mvp-script-final-20260420.md` | THE CANONICAL SCRIPT. 264 lines. 7 WOW stages + 4 rec variants + close. Everything Bella says comes from this. |
| `BRAIN_DOCS/doc-mvpscriptbella-t9-architectural-plan-final-20260421.md` | T9 final plan. All 6 Trent decisions. Full stall specs, State interface, canary criteria. Read before writing any spec. |

### Diagnostic + background
| File | What it contains |
|------|-----------------|
| `BRAIN_DOCS/doc-mvpscriptbella-dual-stage-machine-analysis-20260421.md` | Why Option B was chosen. Brain DO vs bridge stage machine divergence analysis. |
| `BRAIN_DOCS/doc-mvpscriptbella-make-her-sing-diagnostic-20260420.md` | 18 prompt conflicts causing Gemini to paraphrase. S3 (now merged into S1). |
| `BRAIN_DOCS/doc-mvpscriptbella-natural-response-architecture-20260420.md` | REACT-BRIDGE-DELIVER spec. How freestyle + scripted parts interleave. |
| `BRAIN_DOCS/doc-mvpscriptbella-t2-architect-briefing-20260421.md` | Structural gap analysis. Corrections to prior docs. Read to avoid prior T2 mistakes. |
| `BRAIN_DOCS/doc-mvpscriptbella-fix-spec-20260420.md` | Original fix spec before T9 rewrote architectural plan. Background context. |
| `BRAIN_DOCS/doc-mvpscriptbella-handover-20260421.md` | Prior T9 session handover. Background only. |

### Canonical team protocols
| File | What it contains |
|------|-----------------|
| `canonical/codex-doctrine.md` | How Codex gates work. Read before your first gate. |
| `canonical/codex-routing-matrix.md` | Which review type routes to which T3 lane. |
| `canonical/codex-request-contract.md` | Exact format for CODEX_REVIEW_REQUEST messages. |
| `canonical/team-workflow.md` | Full pipeline: T1 brief → T2 spec → T3 gate → T4 implement → T2 6-gate → T3 gate → T4 deploy → T5 verify. |
| `TEAM_PROTOCOL.md` | Re-read every 10 messages. Core operating laws. |

---

## 5. LAWS THAT CAUSE P0 FAIL IN REVIEW

These are Bella product laws. Violating any = immediate P0 FAIL in your 6-gate:

| Law | Detail |
|-----|--------|
| **Consultant narratives = word-for-word** | `icpNarrative`, `conversionNarrative` are `--- SCRIPT ---` blocks. NOT freestyle context. Gemini delivers them verbatim. |
| **bella_opener STAYS** | Freestyle fuel for REACT portions. Prior session incorrectly said remove — Trent corrected this. Keep it. |
| **Only one stat** | "up to 4x more conversions". No dollar figures. No calculated ROI. No "conservative estimate". |
| **Bella never asks "what does your business do?"** | She has scrape data pre-loaded. This question = automatic P0. |
| **Bella never criticises a prospect's website** | Maximise whatever they have. Never negative framing. |
| **Close = book onboarding call only** | Not email, not trial activation, not demo link. Onboarding call. |
| **personalisedaidemofinal — never touch** | Any version, any file, any config, any URL. Supreme law. Sighting → flag T2/T1 only. |
| **Bella is inbound, not outbound** | No cold-call framing. Prospect chose to be there. |

---

## 6. THE 6-GATE REVIEW CHECKLIST

Run these 6 gates on EVERY REVIEW_REQUEST from T4:

1. **Correctness** — does the code implement the spec exactly? Trace every field from input to output. No guessing.
2. **Safety** — no frozen workers touched, no personalisedaidemofinal bindings added, no destructive state mutations.
3. **Consistency** — does code align with canonical script? No invented lines. No ROI math. No wrong stat.
4. **Performance** — no new sync KV reads on critical path. No new Gemini calls on critical path. `ctx.waitUntil` for fire-and-forget only.
5. **Completeness** — all spec items implemented? All VERIFY greps pass? Section 1 deletes confirmed? No stubs.
6. **Deploy safety** — VERSION string bumped? wrangler.toml unchanged except version? No new bindings without T1 approval?

**You can FAIL. You cannot PASS.** Every review goes to T3 regardless. Never tell T4 the code is good — T3 decides.

---

## 7. TEAM STRUCTURE + PEER IDs (current session)

| Role | Peer ID | Model | Notes |
|------|---------|-------|-------|
| T1 Orchestrator | oklhj030 | Sonnet | Receives DEPLOY_BROADCAST only. Not code/data. |
| T3 Code Judge | 7ukjsbl9 | Sonnet | Only PASS authority. Codex CLI mandatory. |
| T3B Regression Judge | 592zq7lt | Sonnet | Post-deploy gate. Chain: T4→T5 health→T2 DEPLOY_BROADCAST→T1→T3B. |
| T4 Minion A | lyq72gu8 | Sonnet | Implementation + deploys. Never self-deploys. |
| T5 Minion B | e7t549bm | Haiku | Raw execution only. No diagnosis. |
| T9 Architect | eebdxnjq | Opus | Architecture. Raw data only from T2. Wait Trent confirm before executing T9 direction. |

**Note:** Peer IDs change each session. Run `list_peers(scope: machine)` on startup.

---

## 8. MESSAGE PROTOCOLS

### CODEX_REVIEW_REQUEST format (to T3)
```
CODEX_REVIEW_REQUEST — [SPEC_STRESS_TEST | PATCH_REVIEW] — [task name]

[List all docs/files T3 must read, with full absolute paths]

CONTEXT: [1-2 sentences on what this does]

CODEX PROOF REQUIRED: Attach raw `which codex && codex --version` output. No proof = verdict rejected.

Requestor: T2 Code Lead (Sonnet)
```

### TASK_REQUEST format (to T4)
Include: target file, all spec doc paths, mandatory pre-flight steps, laws that apply, turn handler order if bridge work, VERSION bump reminder, "send REVIEW_REQUEST to T2 on completion — do NOT deploy."

### DEPLOY_BROADCAST format (to T1)
```
T2 DEPLOY_BROADCAST: [worker name] v[X.Y.Z] deployed. T5 health: PASS. T3B regression: [pending/pass]. Ready for T3B gate.
```

### Signal not noise (T1 rule)
T1 only sees: `DEPLOY_BROADCAST`, `ALERT` (P0 blocker), final sprint status. Never raw data, never routine passes.

---

## 9. CODEX PROOF LAW

**Reject any T3 or T3B verdict missing raw `which codex && codex --version` output.**

Valid proof looks like:
```
/Users/trentbelasco/.local/bin/codex
codex-cli 0.118.0
Model: gpt-5.4 (ChatGPT subscription)
Tokens: XXXXX
```

No proof = verdict has no authority. Send back and request re-gate with proof attached.

---

## 10. SPRINT PIPELINE (post-S1)

| Sprint | Scope | Status |
|--------|-------|--------|
| S1 | Stage machine restructure + prompt fixes | T4 implementing |
| S2 | REACT-BRIDGE-DELIVER polish (if needed post-S1 canary) | Pending |
| S3 | Site content injection | Post-launch |
| S4 | Objection handling | Post-launch |

**S1 canary criteria** (from T9 architectural plan):
- All 7 WOW stages fire in correct order
- No stage advance fires before stall minimum
- source_answer populated by end of stall 7
- funnel_answer populated by end of stall 8
- recommend stage fires after stall 8
- No ROI figures, no dollar amounts in Bella output
- close stage reached without extra stages
- BELLA_SAID logs present every turn

---

## 11. COMMON MISTAKES — DON'T REPEAT

From T2 Opus session notes and T3 FAIL history:

| Mistake | Correct behaviour |
|---------|------------------|
| Accepting T3 verdict without Codex proof | Reject. Request re-gate with proof. |
| Writing spec from T9 report without reading actual files | T5 reads files first. Spec from file content, not reports. |
| Passing 6-gate without tracing every field | Trace EVERY field input → output. Not just the flagged one. |
| Sending DEPLOY_BROADCAST before T5 health check | T5 health check is mandatory before broadcast. |
| Asking T9 for architectural direction then auto-executing | Wait for Trent's explicit GO before acting on T9 direction. |
| Sending Trent raw data instead of distilled status | Distil. One sentence. Trent decides, team executes. |
| Greping/reading files yourself | Delegate to T5. Law. |

---

## 12. QUICK REFERENCE — KEY FILE PATHS

```
Target bridge:          ~/Desktop/MVPScriptBella/workers/bridge/src/index.ts
Canonical script:       BRAIN_DOCS/doc-bella-mvp-script-final-20260420.md
S1 base spec:           BRAIN_DOCS/doc-mvpscriptbella-s1-implementation-spec-20260421.md
S1 Revision A:          BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-a-20260421.md
S1 Revision B:          BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-b-20260421.md
S1 Revision C (FINAL):  BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-c-20260421.md
T9 arch plan (final):   BRAIN_DOCS/doc-mvpscriptbella-t9-architectural-plan-final-20260421.md
Architecture:           BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md
Backup (pre-S1):        ~/Desktop/MVPScriptBella_BACKUP_20260421/
GitHub backup:          https://github.com/trentb-ai/MVPScriptBella-backup-20260421
KV namespace:           leads-kv (ID: 0fec6982d8644118aba1830afd4a58cb)
Shared brain D1:        2001aba8-d651-41c0-9bd0-8d98866b057c
CF Account ID:          9488d0601315a70cac36f9bd87aa4e82
```

---

## 13. STARTUP SEQUENCE (every new session)

1. `set_summary` — "T2 Code Lead online. [current sprint + status]"
2. `list_peers(scope: machine)` — map current peer IDs
3. Send STATUS to T1
4. Read `TEAM_PROTOCOL.md`
5. Read `canonical/codex-doctrine.md`, `codex-routing-matrix.md`, `codex-request-contract.md`, `team-workflow.md`
6. Read your prompt file: `prompts/t2_code_lead.md`
7. Check messages — respond to any pending items
8. Query D1 brain for current sprint state before asking Trent anything

---

*Handover written by T2 Code Lead (Sonnet) — 2026-04-21 AEST*
