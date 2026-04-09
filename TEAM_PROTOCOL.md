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

**Bella** is a voice AI sales receptionist built on Cloudflare Workers, Durable Objects, Deepgram STT/TTS, and Gemini 2.5 Flash. She qualifies inbound leads through a scripted-but-natural conversation flow (WOW → qualify → recommend → close).

**Current state:** Bella V7 tagged. All V7 bugs ON HOLD. We are building the **CF Hybrid architecture** — a ground-up rebuild that eliminates the bridge middleman and moves intelligence directly into the Durable Object.

**Repo:** `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM`
**Live frontend:** `cleanestbellav2rescripted.netlify.app` → v2-rescript workers
**Sandbox frontend:** `demofunnelbellasandboxv8.netlify.app` → v9/sandbox workers
**KV namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`

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
3. **Read your individual prompt file** (`prompts/tN_*.md`)
4. **Call `list_peers`** to see who is online
5. **Call `check_messages`** to catch anything sent while offline
6. **⚠️ LAW — Query shared brain D1 BEFORE ANY WORK** (`2001aba8-d651-41c0-9bd0-8d98866b057c`): `SELECT id, title FROM documents WHERE project_id='bella-v11' ORDER BY created_at DESC LIMIT 20`. Read session reports, bug register (`failure_patterns`), decisions log (`decisions`). This is NON-NEGOTIABLE. An agent who acts without reading D1 context is flying blind and will repeat mistakes already solved. No exceptions.
7. **Send `STATUS: online`** to T1 with a one-line summary of your role

### Role-specific startup:
- **T2:** Also query `failure_patterns` and `decisions` tables for today's bugs and architectural decisions before writing any spec
- **T3 Codex Judge:** Check for pending CODEX_REVIEW_REQUEST messages
- **T4/T5:** Check for pending TASK_REQUEST from T2

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
| **Reviews** | 6-gate manual review (correctness, safety, consistency, performance, completeness, deploy) | 3-pass Codex gate (adversarial-review → review → rescue). Token budget: 500K max, medium reasoning, FAIL fast. |
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

## STALE JS PRE-FLIGHT — NON-NEGOTIABLE

Before ANY implementation task, T4 MUST:
1. `find src/ -name "*.js" | grep -v node_modules` in the target worker directory
2. Delete every `.js` file that has a `.ts` counterpart in the same location
3. Only then begin code changes

**Why:** Module resolution picks `.js` over `.ts`. Stale compiled files silently shadow source edits. T4 updating them instead of deleting is a timebomb. Zero exceptions.

---

## DEPLOY PROTOCOL — NON-NEGOTIABLE

**T3 CODEX PASS = deploy authority. T1 relays to Trent when required.**

### Pipeline:
1. **Implement** — T4/T5 execute T2's specs
2. **Manual review** — T2 runs 6-gate review
3. **Codex review** — T3 runs 3-pass gate
4. **DEPLOY_BROADCAST** — T2 sends to T1 (awareness only):
   ```
   DEPLOY_BROADCAST: [worker] v[version]
   Approved by: T3 (Codex PASS) + T2 (6-gate PASS)
   Changes: [one-line summary]
   ```
5. **T3 sends DEPLOY_AUTH to T4 directly** — T3 PASS is the ONLY authorization needed. T2 and T1 are NOT in the deploy chain. T3 owns deploy authority end-to-end.
6. **Deploy** — T4 runs `npx wrangler deploy`

**T1 AUTHORISES ONE THING ONLY: xhigh Codex reasoning effort.** This requires Trent's explicit YES first. Nothing else goes through T1.
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
Trent /ultraplan → T1 chunk brief → T2 assigns READs to T5 → findings to T2 → T2 writes specs → [COMPLEX: T3 spec review] → T2 assigns implementation to T4 → T2 6-gate → T3 Codex gate → T2 DEPLOY_BROADCAST to T1 → T1 confirms to T4 → T4 deploys → T5 verifies
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

## CODEX TOKEN BUDGET — NON-NEGOTIABLE

**Context:** T3 burned 2 days of Codex credits in 2 hours using `xhigh` reasoning on every gate pass across multiple versions. These laws prevent recurrence.

### Reasoning effort by gate:
| Gate | Flag | Notes |
|------|------|-------|
| Gate 4A (adversarial) | `medium` | Default. No xhigh. |
| Gate 4B (diff review) | none (standard) | No -c flag at all. |
| Gate 4C (rescue) | `medium` | xhigh only with explicit T1 authorisation. |

**`xhigh` is banned by default.** Only T1 can authorise it, for a specific gate on a specific version, in writing. Requires Trent YES before T1 can authorise.

**`exec` mode is banned by default.** Never use `codex exec` without explicit written approval from T1 + Trent YES. Use `codex review` only. No exceptions, no workarounds.

### Gate completion rule:
- **Always run all 3 gates to completion. Never stop early.**
- Report all findings from all 3 gates in one verdict.

### Multi-version reviews:
- When T2 retracts a version mid-gate, abort all in-flight Codex processes immediately.
- Never run full 3-pass on a version that has already received a FAIL verdict.

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

## NO INTERRUPTIONS LAW — NON-NEGOTIABLE

**NEVER send new work, prep material, or any task to an agent who is currently focused on an active task.** Wait until they report completion. One task at a time per agent. Prep work for the NEXT task is held by T1/T5 until the current task clears. Interrupting a focused agent breaks their context and costs more than the prep saves.

---

## ESCALATION

- **Minion stuck >3 minutes** → escalate to T2
- **T2 stuck on architecture** → escalate to T1
- **Critical error detected** → ALERT to T1 + T2 simultaneously
- **Trent gives direct instruction** → overrides all protocol. Execute immediately.

---

## SAVE ALL PLANS TO SHARED BRAIN — MANDATORY LAW (authorized 2026-04-08)

Every plan written (sprint plan, chunk execution plan, architecture spec, fix sequence) MUST be saved to the shared brain D1 immediately after writing — before handing to T4 for execution.

- **D1:** `2001aba8-d651-41c0-9bd0-8d98866b057c`, table `documents`
- **Doc ID format:** `doc-[description]-[YYYYMMDD]`
- **Also mirror** to `BRAIN_DOCS/` locally (per existing mirror law)
- **If plan already exists in D1** from a prior session — DO NOT rewrite it. Read and use it.

Plans in D1 survive agent restarts, context compression, and session boundaries. Local memory alone is not sufficient.

---

## STALE JS PRE-FLIGHT — MANDATORY LAW (authorized 2026-04-08)

Before ANY implementation task, T4 MUST run in every target worker's src/ directory:
```bash
find cf-hybrid-bella/workers/[worker]/src -name "*.js" | grep -v node_modules | grep -v dist
```
**DELETE any .js file that has a matching .ts file.** Do NOT update them — delete them. Same applies to test directories (.test.js alongside .test.ts). T2 must include this check explicitly in every TASK_REQUEST. No exceptions.

**Why:** .js files shadow .ts in module resolution. Stale compiled artifacts cause silent deployment of old code. Three instances found in one session (brain-do.js, moves.js, chunk9.test.js).

---

## SHARED BRAIN REPORTING — MANDATORY (authorized 2026-04-08)

Every agent files a SHORT snapshot to shared brain D1 (ID: `2001aba8-d651-41c0-9bd0-8d98866b057c`) after EVERY action. NOT one big daily report — many small entries throughout the day. 100+ snapshots = full picture at end of day.

**Format:** INSERT into `documents` table:
- `id`: `report-[agent]-[YYYYMMDD]-[NNN]` — increment NNN each entry (001, 002, 003...)
- `project_id`: `bella-v11`
- `title`: one-line summary of what just happened
- `doc_type`: `session_report`
- `authored_by`: agent name
- `content`: exactly these fields, every time. NO LINE CAP — write everything:
  1. **ATTEMPTED**: version/task/spec/plan name
  2. **RESULT**: PASS / FAIL / COMPLETE + one-line reason
  3. **ROOT CAUSE** (if FAIL): specific — not "see findings", the actual bug
  4. **FILES CHANGED**: exact paths
  5. **BLOCKER/LESSON**: anything that would trip the next session
  6. **NEXT**: who has the ball and what they're doing now

**PLANS ALSO GET FILED.** Every T2 spec, architecture plan, sprint plan, or fix strategy gets its own report entry BEFORE implementation starts. Fields: PLAN NAME, WHAT IT DOES, WHY, FILES AFFECTED, RISKS, EXPECTED OUTCOME. This is how we know what was intended vs what was built.

⚠️ THIS REPORTING SYSTEM IS SUPERCRITICAL. It is the only persistent record of what this team does each day. Agents who skip, batch, or file vague reports are undermining the entire operation. No exceptions.

---

## FOUR PERMANENT REGISTERS — ALL IN SHARED BRAIN D1

### REGISTER 1: SESSION SNAPSHOTS (`documents`, doc_type: `session_report`)
Already running. Every action, every plan, every verdict. See format above.

### REGISTER 2: CODEX VERDICT LOG (`documents`, doc_type: `codex_verdict`)
T3a/T3b file after EVERY verdict. Fields:
- `id`: `verdict-t3[a/b]-[YYYYMMDD]-[NNN]`
- `title`: "T3a FAIL v1.19.3 — VERSION mismatch + allowFreestyle"
- `content`: VERSION gated, PASS/FAIL, EACH finding with severity (P0/P1/P2), fix assigned to who, who has the ball next

### REGISTER 3: BUG REGISTER (`failure_patterns`)
T2 files every confirmed bug. Same root cause appearing again → UPDATE occurrence_count, UPDATE last_seen. Every new session: T2 checks this register before speccing. Key fields:
- `failure_type`: bug category (e.g. "schema-migration", "race-condition", "stale-artifact")
- `title`: short name for the bug
- `root_cause`: exact technical cause
- `lesson`: what to check to avoid it
- `prevention`: rule that prevents recurrence
- `severity`: P0/P1/P2
- `occurrence_count`: increment each time it reappears
- `resolved`: 0 until confirmed fixed and gated

### REGISTER 4: ARCHITECTURAL DECISIONS LOG (`decisions`)
T1 or T2 files every architecture-level decision. Fields:
- `title`: what was decided
- `decision`: full decision text
- `rationale`: why this, not something else
- `alternatives_considered`: what was rejected and why
- `decided_by`: Trent / T1 / T2
- `status`: active / superseded

**RISK & FRAGILITY REGISTER** — also uses `failure_patterns` with `failure_type: "fragility"`. Known fragile areas tracked here with `resolved: 0`. Checked before every related change.

**T1 owns all 4 registers.** T1 backfills at end of each session. T2/T3/T4/T5 file to registers 1+2+3 in real time.

---

## ENGINEERING BEST PRACTICES — STANDING LAWS

### PRE-IMPLEMENTATION CHECKLIST (T2 runs before every spec)
1. Check bug register — has this root cause been seen before? If yes, apply known prevention.
2. Check architectural decisions log — is there a prior decision that constrains this change?
3. Check risk register — does this change touch a known fragile area?
4. Read actual source files — never spec from memory or reports alone.

### POST-DEPLOY VERIFICATION (T5 runs after every deploy)
1. Health endpoint returns 200
2. VERSION string matches what was deployed
3. No error spikes in wrangler tail for 60s post-deploy
4. File session snapshot to D1 confirming deploy + health result

### REGRESSION GUARD (T3 checks on every gate)
- Extraction dispatch: must be Cloudflare Workflow — never ctx.waitUntil, never await
- callStartedEmitted: must be persisted before any non-storage awaits
- VERSION: must match across source + wrangler.toml
- No ?? true on boolean flags that should default off
- No UNIQUE INDEX migration without preceding dedup DELETE

### HANDOVER PROTOCOL (when an agent is replaced mid-task)
Outgoing agent must send to T1 before going offline:
1. What task was in flight
2. Exact file + line number where work stopped
3. What the next step is
4. Any gotchas the incoming agent needs to know

### BUG REGISTER DISCIPLINE
- Same bug appears twice → occurrence_count incremented, `last_seen` updated
- Same bug appears three times → ALERT to T1. Something structural is wrong.
- Bug marked `resolved: 1` only after T3 PASS on the fix AND T5 health check confirms clean

### DECISION HYGIENE
- Never re-litigate a decision in the `decisions` table with `status: active`
- To change a decision: file a new one with `supersedes` pointing to the old ID, set old to `status: superseded`
- Trent's direct instructions always create a new decision entry

**Trigger: after EVERY action, no batching:**
- T2: every spec written, every 6-gate result, every DEPLOY_BROADCAST
- T3a/T3b: every gate verdict (PASS or FAIL)
- T1: every major decision or ruling

**T4/T5 do NOT file snapshots.** Their work is captured in T2/T3 reports.

**T1 is custodian** — owns the record, ensures T2/T3a/T3b are filing. T1 reports are provisional — quality reviewed by Trent.

---

## COMMIT AT CHUNK/SPRINT COMPLETION

T4 commits the working tree at the end of every completed chunk or sprint. Never let working tree accumulate across multiple chunks — T3 gate scope must equal one chunk's diff, not the full working tree history.

---

## PRIMARY LAW — NEVER ASK TRENT TO EXECUTE

**If T1 or the team can run it, run it. Never ask Trent to execute anything.**
Shell commands, secrets, exports, health checks, test calls, wrangler commands, token setup — the team handles all execution. Trent makes decisions only (yes/no calls). Any agent asking Trent to run a command is in violation of this law. No exceptions.

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
