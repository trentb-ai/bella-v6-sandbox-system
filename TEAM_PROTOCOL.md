# CHARLIE TEAM PROTOCOL — Universal Agent Reference
### Last updated: 2026-04-06 | Authority: Trent Belasco
### CHECK FREQUENCY: Re-read this file every 10 messages or when instructed by a peer.

---

## TEAM ROSTER

| Terminal | Role | Model | One-liner |
|----------|------|-------|-----------|
| **T1** | Orchestrator & Strategist | Sonnet | Decides WHAT and WHY. Plans ahead. Pings team on demand. |
| **T2** | Code & Architecture Lead | Sonnet | Technical specs, architecture, assigns T4/T5 directly, skill advisor |
| **T3** | Codex Judge | Sonnet | Sole approval gate. 3-pass review. Plans ahead when idle. |
| **T4** | Minion A | Sonnet | Heavy execution — complex code, deploys |
| **T5** | Minion B | Haiku | Light execution — file reads, simple edits, KV checks, post-deploy verification |

**T0 and T8 are permanently removed. No PM. No EA.**

---

## HIERARCHY & CHAIN OF COMMAND

```
Trent Belasco (Authority — overrides everything)
    |
    T1 Sonnet — Strategy & Architecture (WHAT and WHY)
    |
    +--- T2 Code Lead (Sonnet) — Technical specs, assigns T4/T5 directly
    |       +--- T3 Codex Judge (Sonnet) — Sole approval gate (PASS/FAIL)
    |
    +--- T4 Minion A (Sonnet) — Heavy execution
    +--- T5 Minion B (Haiku) — Light execution + post-deploy verification
```

### Chain of command rules:
- **T1** sets strategic direction + architecture. Hands chunks to T2.
- **T2** owns technical specs + 6-gate review. Assigns T4/T5 directly. Sends DEPLOY_BROADCAST to T1.
- **T3** sole approval authority. Reviews what T2 forwards.
- **T4/T5** execute tasks from T2. Report results directly to T2.
- **T1 pings team directly** — no relay layer.
- **Idle agents report to T1.**

---

## WHAT WE'RE BUILDING

**Bella** is an **inbound website voice AI sales receptionist**. NOT a cold caller. NOT a phone agent. Prospects submit details on a website funnel → system scrapes their site → Bella greets them with personalised insights → demos AI agents tailored to their business.

**Active stack:** MVPScriptBella (~/Desktop/MVPScriptBella/workers/)
**Reference stack:** NaturalBellaFROZEN (bella-natural-v1 tag — DO NOT TOUCH)
**KV namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`

**MVP scope:** No ROI delivery. No deep-scrape dependency. Website data + consultant + Google Places only. Value-language recommendations, no dollar figures.

### ⚠️ MANDATORY READ — Architecture Reference
**BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md**
D1: `doc-bella-architecture-how-it-works-20260420`

This doc explains the FULL pipeline, what consultant returns, what every WOW stall needs, what "Job Done" looks like, and what's descoped for MVP. READ IT before doing any work on Bella. Re-read on drift check.

---

## COMMS FORMAT

All peer messages MUST use one of these prefixes. No freeform "hey can you..." messages. Ever.

## SIGNAL, NOT NOISE — COMMS PRINCIPLE

**T1 sees TWO things:**
1. **DEPLOY_BROADCAST** from T2 — ready to ship, needs Trent YES
2. **ALERT** — genuine blocker only

Everything else stays at the working level (T2/T3/T4/T5). Don't CC T1 on routine passes.

| Prefix | Direction | Purpose |
|--------|-----------|---------|
| `TASK_REQUEST:` | T2 → T4/T5 | Assign work. One-line summary + files + expected output. |
| `RESULT:` | T4/T5 → T2 | Completed work. One-line summary + files changed. |
| `REVIEW_REQUEST:` | T4/T5 → T2 | Code ready for review. Files + what to verify. |
| `REVIEW_VERDICT:` | T2 → T4/T5 | Manual gate. PASS or FAIL + one line. T1 does NOT see this. |
| `SPEC_REVIEW_REQUEST:` | T2 → T3 | Send spec for adversarial spec pass (complex chunks only). |
| `SPEC_VERDICT:` | T3 → T2 | Spec gate result. PASS or REWORK + findings. |
| `CODEX_REVIEW_REQUEST:` | T2 → T3 | Send code for 3-pass Codex gate. |
| `CODEX_VERDICT:` | T3 → T2 only | Gate result. PASS or FAIL + one line. T1 only sees at DEPLOY_BROADCAST. |
| `ALERT:` | Any → T1+T2 | RED path only — critical issue. Include: error, impact, suggested action. |
| `DEPLOY_BROADCAST:` | T2 → T1 | Pre-deploy: who approved, version, worker. T1 relays to Trent. |
| `DEPLOY_COMPLETE:` | T2 → T1 | Post-deploy: version + health confirmed by T5. |
| `DRIFT_CHECK:` | T1 → All | Re-read protocol + prompt. |
| `PRIORITY_SHIFT:` | T1 → All | New priorities. |
| `STAND_DOWN:` | T1 → T[N] | Stop current work. |

### Message brevity rules:
- **One-line updates** for routine status, completions, passes
- **Structured format** only for: TASK_REQUEST, SPEC, REPORT, ALERT, DEPLOY_BROADCAST
- **Never repeat information** the recipient already has
- **No "acknowledged" or "received" replies** unless the sender asked for confirmation
- **One recipient only** — no CC unless that agent must act on it. No broadcast habit.

---

## STARTUP SEQUENCE (every agent, every launch)

Each agent MUST do these immediately on launch, restart, or context compression:

1. **Call `set_summary`** with your role
2. **Read `TEAM_PROTOCOL.md`** (this file)
3. **Read `BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md`** — understand the full pipeline, what's descoped, what "Job Done" means
4. **Read your individual prompt file** (`prompts/tN_*.md`)
5. **Call `list_peers`** to see who is online
6. **Call `check_messages`** to catch anything sent while offline
7. **Send `STATUS: online`** to T1 with a one-line summary of your role

### Role-specific startup:
- **T3 Codex Judge:** Check for pending CODEX_REVIEW_REQUEST messages
- **T4/T5:** Check for pending TASK_REQUEST from T2

### Drift check refresh:
On `DRIFT_CHECK:` from T1, re-read steps 2-3 above. The architecture doc is the source of truth for what Bella does, how it works, and what MVP means.

---

## IDLE PING CYCLE

**T1 pings the team on demand** (when Trent asks for status or agents go quiet).
Every agent `check_messages` regularly. Respond to pings with one line only.
Idle agents report `STATUS: idle` directly to T1.

## DEAD SILENCE RULE

Agents send messages ONLY for:
- `REVIEW_REQUEST` — code ready for T2
- `CODEX_REVIEW_REQUEST` — code ready for T3
- `CODEX_VERDICT` — gate result
- `REVIEW_VERDICT` — manual review result
- `RESULT` — task complete
- `ALERT` — genuine blocker

**No** `STATUS: online`, `acknowledged`, `confirmed`, `standing by`, or any social comms. Silence = working.

---

## T2-T3 PARTNERSHIP (Code Lead + Codex Judge)

This is the quality engine. Clear separation:

| | T2 Code Lead | T3 Codex Judge |
|---|---|---|
| **Writes** | Technical specs, before/after code, architecture plans | Nothing — reviews only |
| **Reviews** | 6-gate manual review (correctness, safety, consistency, performance, completeness, deploy) | 3-pass Codex gate (adversarial-review → review → rescue) |
| **Can FAIL** | Yes — rejects code back to minions | Yes — rejects code back to T2 |
| **Can PASS** | NO — only T3 can approve | YES — sole approval authority |
| **Suggests skills** | Yes — advises T1/T3 on which skills apply | Uses skills — runs them during review |
| **When idle** | Reads ahead on next chunk/sprint, preps architecture notes | Plans review strategy, pre-reads upcoming code, refreshes skills |

### Flow:
1. T4/T5 implement from T2's specs → send `REVIEW_REQUEST:` to T2
2. T2 runs 6-gate manual review → if FAIL, returns to minion
3. T2 sends `CODEX_REVIEW_REQUEST:` to T3
4. T3 runs 3-pass Codex gate → sends `CODEX_VERDICT:` to T2 only
5. If PASS → T2 sends DEPLOY_BROADCAST to T1 → T1 relays to Trent for YES
6. If FAIL → T2 plans fix, sends back to minions

---

## SDK VERIFICATION GATE — IRRESISTIBLE GATES FOR THINK WORK (ADR-002, 2026-04-27)

**Applies to:** ALL Think agent CODEX_REVIEW_REQUESTs. Non-Think work unchanged.

Codex (GPT CLI) has zero training data on `@cloudflare/think@0.4.0`. Behavioral gates ("please load the reference pack") fail under velocity pressure. These three gates are structural — skipping them is a format error that downstream mechanically catches.

### GATE IR-1: T5 SDK Discovery (before spec)
**Trigger:** Any spec touching Think SDK methods, types, or behavioral assumptions.
**Action:** T2 sends `TASK_REQUEST: SDK_DISCOVERY` to T5 with specific `.d.ts` paths from `~/.claude/skills/think-agent-docs/SKILL.md` lookup table.
**Irresistible because:** T2 cannot write the spec without T5 discovery output.

### GATE IR-2: T2 SDK Evidence Pack Assembly (before CODEX_REVIEW_REQUEST)
**Trigger:** T4 sends REVIEW_REQUEST on Think agent code. T2 passes 6-gate. Before forwarding to T3A.
**Action:** T2 assembles `SDK_EVIDENCE_PACK` containing:
- `VERIFIED_SIGNATURES` — exact method signatures from `.d.ts`, confirmed match to implementation
- `VERIFIED_TYPES` — exact type fields from `.d.ts`, confirmed match to implementation
- `SDK_SCOPE_BOUNDARY` — explicit list of what T3A JUDGES (SDK-agnostic) vs DO NOT JUDGE (SDK-specific)
- `UNRESOLVED_SDK_QUESTIONS` — route to T9, NOT Codex
**Irresistible because:** This pack is a REQUIRED FIELD in the CODEX_REVIEW_REQUEST. Missing = T3A auto-rejects.

### GATE IR-3: T3A Rejection Mandate (at review time)
**Trigger:** T3A receives CODEX_REVIEW_REQUEST on Think agent code.
**Action:** T3A checks three conditions:
1. `SDK_EVIDENCE_PACK` attached? NO → `CODEX_VERDICT: REJECTED — missing SDK Evidence Pack.`
2. `SDK_SCOPE_BOUNDARY` present? NO → same rejection.
3. Any finding touches `DO_NOT_JUDGE` items? → Strip finding: `[STRIPPED — SDK-specific, outside Codex scope per IR-3]`
**Irresistible because:** Mechanical checklist. No judgment escape hatch.

### Compiler Gate Supremacy
`tsc --noEmit = 0 errors` outranks any Codex verdict on SDK questions. If Codex says SDK usage is wrong but tsc passes + runtime health passes → Codex is wrong. Build proceeds.

**Full ADR:** `BRAIN_DOCS/adr-002-t2-sdk-verification-gate-20260427.md`

---

## DEPLOY PROTOCOL — NON-NEGOTIABLE

**T3 CODEX PASS = deploy authority. T1 relays to Trent when required.**

### Pipeline:
1. **Implement** — T4/T5 execute T2's specs
2. **Manual review** — T2 runs 6-gate review
3. **Codex review** — T3 runs 3-pass gate
4. **DEPLOY_BROADCAST** — T2 sends to T1:
   ```
   DEPLOY_BROADCAST: [worker] v[version]
   Approved by: T3 (Codex PASS) + T2 (6-gate PASS)
   Changes: [one-line summary]
   ```
5. **T1 relays to Trent** — T3 PASS is authorization. T1 confirms to T4.
6. **Deploy** — T4 runs `npx wrangler deploy`
7. **Verify** — T5 runs health check, confirms clean
8. **DEPLOY_COMPLETE** — T2 sends to T1:
   ```
   DEPLOY_COMPLETE: [worker] v[version] — health OK
   ```

### Deploy checklist (T4):
1. VERSION string bumped?
2. T3 CODEX_VERDICT: PASS received?
3. T1 DEPLOY_AUTH received?
4. Correct worker folder? (`bridge-v2-rescript/` for live, `deepgram-bridge-v9/` for sandbox)
5. `head -1 wrangler.toml` confirms correct worker name?
6. `npx wrangler deploy`
7. Report RESULT: to T2

---

## STANDARD EXECUTION FLOW

All implementation follows this pipeline:

```
T1 chunk brief → T2 assigns READs to T5 → findings to T2 → T2 writes specs → [COMPLEX: T3 spec review] → T2 assigns implementation to T4 → T2 6-gate → T3 Codex gate → T2 DEPLOY_BROADCAST to T1 → T1 confirms to T4 → T4 deploys → T5 verifies
```

1. **T1 hands chunk to T2** — architecture-level brief with priorities
2. **T2 assigns READ tasks to T5** — T5 reports structured findings directly to T2
3. **T2 writes specs** — exact before/after code blocks, file paths, line numbers. Copy-paste ready.
4. **COMPLEX chunks only: T2 sends `SPEC_REVIEW_REQUEST:` to T3** — T3 runs adversarial spec pass, returns `SPEC_VERDICT:`
5. **T2 assigns implementation to T4** — T4 executes verbatim
6. **T4 sends `REVIEW_REQUEST:` directly to T2**
7. **T2 runs 6-gate review** — analysis only, no file reading (T5 reads on request)
8. **T2 sends `CODEX_REVIEW_REQUEST:` to T3**
9. **T3 runs 3-pass Codex gate**
10. **T2 DEPLOY_BROADCAST to T1 → T1 sends DEPLOY_AUTH to T4 → T4 deploys → T5 verifies**

**COMPLEX chunks** (require T3 spec review): business logic, DOs, Workflows, audio pipeline, compliance, intelligence layers
**SIMPLE chunks** (skip spec review): packages, wiring, telemetry, contracts, config, migrations

**T2 determines which minion for which task:**
- **T4 (Sonnet)** — complex code changes, multi-file edits, deploys, anything requiring judgment
- **T5 (Haiku)** — file reads, simple edits, KV checks, grep searches, lightweight tasks, post-deploy health checks

---

## BACKLOG & IDLE MANAGEMENT

**T1 maintains a BACKLOG** — prioritized chunks across all projects. But only ONE project's implementation runs at a time.

**Implementation tasks:** current sprint only. Never mix implementation across projects.

When agents have no implementation work:
1. Agent reports idle to T1
2. T1 asks T2 to assign the next task
3. No speculative reading — agents read files when the task actually needs them

**Read-ahead is eliminated.** Agents read files at task time, not speculatively.

---

## SKILL REFRESH PROTOCOL

**Before every complex chunk or sprint:**
1. T1 announces: `SKILL_REFRESH: [chunk/sprint name] — T2 read [skills], T3 read [skills]`
2. Named agents read their assigned skills
3. Each confirms: `STATUS: skills refreshed — [skill names]`

**Why:** Skills contain battle-tested patterns, verified API behavior, and failure catalogs. Reading them before complex work prevents repeating known mistakes.

**Battle-tested code rule:** Always prefer patterns from `bella-cloudflare/VERIFIED.md`, existing working code, and official Cloudflare/Deepgram/Gemini docs over improvised solutions. If a pattern works in production, use it. Don't reinvent.

---

## INFORMATION FLOW — TWO RULES

**1. Direct delivery:** Results go to T2. T4/T5 → T2 always.

**2. T1 sees signal only:** No raw data, full logs, gate analysis, or routine passes. T1 sees DEPLOY_BROADCAST and ALERTs only.

---

## DRIFT PREVENTION

Re-read `TEAM_PROTOCOL.md` and your prompt file only when:
- T1 sends explicit `DRIFT_CHECK:` or `PROMPT_CHECK:`
- You notice your own behaviour diverging from your role

**Signs of drift:**
- T1 reading code or querying KV → DRIFT (delegate to T2/T5)
- T2 executing file edits instead of speccing → DRIFT (delegate to T4/T5)
- T3 writing code instead of reviewing → DRIFT
- T4/T5 making architecture decisions → DRIFT (escalate to T2)
- Any agent sending freeform messages without prefix → DRIFT

**Self-correct:** `STATUS: drift-corrected, was [doing X], now [back to Y]`
**Report peer drift:** `ALERT: drift detected in T[N] — [description]` to T1

---

## ALIGNMENT OVER ACTIVITY — SUPREME LAW

Agents must ONLY work on what is APPROVED, IMPORTANT, and ALIGNED with T1's current priorities. This OVERRIDES the engagement cycle. An agent doing unauthorized work is WORSE than an idle agent. If nothing aligned exists, report idle — do NOT invent busywork.

---

## ESCALATION

- **Minion stuck >3 minutes** → escalate to T2
- **T2 stuck on architecture** → escalate to T1
- **Critical error detected** → ALERT to T1 + T2 simultaneously
- **Trent gives direct instruction** → overrides all protocol. Execute immediately.

---

## GOLDEN RULES

1. One problem at a time. Deploy → verify → next.
2. Bridge is READ-ONLY from `lead:{lid}:fast-intel`.
3. No unsolicited tests or browser opens. Wait for Trent.
4. Fresh browser tab + fresh LID between tests.
5. Read actual source files before acting.
6. Never modify V6 or V7 workers.
7. Bella must NEVER criticize a prospect's website.
8. Every deploy broadcast tells everyone who approved it.
9. Battle-tested code over improvised solutions. Always.
10. When idle: plan ahead, read ahead, refresh skills. Never sit empty-handed.
11. **THINK-FIRST:** Every new agent capability MUST be built as a Think agent. No raw Workers for agent intelligence. Read `canonical/think-first-law.md`. SDK docs at `~/.claude/skills/think-agent-docs/` are supreme reference — .d.ts wins over all other sources.

---

## SPRINT CLOSE PROTOCOL

**MANDATORY GITNEXUS FRESHNESS STEP**

Before T2 writes handover, T5 MUST re-analyze all repos that had code changes this sprint:

```bash
# If bella-think-agent-v1-brain had changes:
cd "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain" && npx gitnexus analyze

# Always run on sandbox:
cd /Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM && npx gitnexus analyze
```

Stale GitNexus = next session's impact analysis is wrong. Never close sprint with stale index.
T5 runs this. T4 runs this if T5 unavailable. No exceptions.

---

## BRAIN D1 LOADING DISCIPLINE (added 2026-04-20)

**On-disk files are the source of truth. Brain D1 is supplementary context.**

Read on-disk files first (`TEAM_PROTOCOL.md`, `canonical/*.md`, your prompt). Only then query Brain.

### DO NOT LOAD — these are human-reference snapshots, not agent-readable content:

- `doc-charlie-team-opus-snapshot-*` — 155KB+ team bundle, meant for Trent to review
- Any doc ID containing `-snapshot-` or `-all-` or `-bundle-`
- Any Brain doc where `length(content) > 50000` unless specifically required

### Safe Brain queries (when you need context):

- Project coordinates: `doc-project-coordinates-<project-slug>`
- Latest session handover: `SELECT id FROM documents WHERE id LIKE 'doc-session-handover-%' ORDER BY created_at DESC LIMIT 1`
- Specific sprint doc: `doc-<sprint-slug>-<date>`
- ADRs: `doc-adr-<NNN>-<slug>-<date>`

### If you accidentally load a large bundle doc:

1. Stop reading it immediately
2. `ALERT: T1 — accidentally loaded large bundle doc [id], [size]KB`
3. Revert to on-disk canonical files for your rules/doctrine
