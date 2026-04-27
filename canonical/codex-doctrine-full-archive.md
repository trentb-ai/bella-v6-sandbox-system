# Charlie Team — Codex Operating Doctrine
## Master Codex doctrine for judge workflow, lanes, rigor gates, and output contracts
### Ported from Echo/DeltaSquad canonical — supersedes prior Charlie Team codex-doctrine.md
### Filed: 2026-04-24 AEST | Authority: Trent Belasco

---

## Status

This file is binding doctrine for all Codex-facing process inside Charlie Team.

Where any prompt, note, support doc, or local habit conflicts with this file on Codex workflow, **this file wins**.

This doctrine governs:
- judge routing
- Codex mode selection
- mandatory rigor checkpoints
- output contracts
- rejection behavior
- approval boundaries
- effort policy
- what Codex is NOT used for

Read with:
- `TEAM_PROTOCOL.md`
- `canonical/codex-routing-matrix.md`
- `canonical/codex-request-contract.md`
- `canonical/team-workflow.md`

---

## Operating Philosophy

Claude and Codex do not serve the same function.

Claude provides direction, synthesis, orchestration, decomposition, and controlled forward motion.
Codex provides rigor, falsification, adversarial challenge, architecture pressure-testing, verification scrutiny, test adequacy auditing, regression suspicion, and loop-breaking.

The system is healthiest when Claude drives the work and Codex challenges the work.
The system is weakest when Claude speculates and Codex arrives only at the end.

Therefore:
- **T1** remains the strategic owner.
- **T2** remains the normal spec author, decomposition owner, and judge routing authority.
- **T4** remains the scoped implementation lane.
- **T5** remains the read-only reconnaissance lane.
- **Codex** is the independent rigor substrate across the lifecycle — not a peripheral reviewer, not just a merge gate.

Codex is the system's strongest falsification and evidence-discipline engine.

---

## Role Mapping

| Agent | Codex Role |
|---|---|
| T2 Code Lead | Request framing + judge routing. Routes to T3A for architecture/correctness, T3B for proof/regression. Never the wrong judge for convenience. |
| T3A Code Judge | Architecture/adversarial Codex lanes. Pre-deploy. Sole merge authority. |
| T3B Regression Judge | Verification/regression Codex lanes. Post-deploy. Sole sprint-completion authority. |
| T1 Orchestrator | Resolves strategic lane-ownership conflict. Fires REGRESSION_REQUEST after DEPLOY_COMPLETE. Routes architectural diagnosis to T9 on T3B FAIL. |
| T4 Minion A | Executes specs verbatim. Does NOT issue Codex verdicts. |
| T5 Minion B | Executes reads + post-deploy health. T3B SQL channel. Does NOT issue Codex verdicts. |

---

## Mandatory Checkpoints

Codex is mandatory at these **seven checkpoints** for non-trivial work:

1. **Hypothesis selection** — when 2+ plausible causes remain
2. **Spec or ticket finalization** — for complex or risky work
3. **First meaningful diff review** — on non-trivial implementation
4. **Fix verification** — before any task is treated as complete
5. **Test adequacy review** — when proof is indirect, intermittent, or environment-sensitive
6. **Regression scan** — before risky merge or deploy
7. **Loop-breaker intervention** — after two materially failed attempts on the same issue

These checkpoints exist because this is where teams most often fool themselves.
A workflow that can move from "we think this is the bug" → "we implemented a fix" → "we are done" without Codex scrutiny is structurally unsound.

---

## Full Codex Mode List (14 Modes)

### 1. Consultant
Use when T2 wants assumptions challenged before implementation, especially when multiple plausible solution paths exist and the architecture choice is expensive to reverse.

**Owner:** T3A
**Stage:** Architecture

### 2. Architecture Interrogator
Use when the system may be solving the problem in the wrong layer, when architecture drift is suspected, or when a bug may actually be a structural contract problem.

**Owner:** T3A
**Stage:** Architecture

### 3. Repo Q&A / Unfamiliar-Subsystem Explainer
Use when the team lacks confident local understanding of a subsystem, boundary, contract, or runtime path and needs Codex to synthesize repo evidence into an explanation.

**Owner:** T2 or T5
**Stage:** Discovery

### 4. Hypothesis Challenge
Use when the current leading theory needs adversarial pressure, especially if confidence has outrun evidence.

**Owner:** T3A
**Stage:** Discovery

### 5. Hypothesis Ranker
Use when 2+ plausible causes remain and the team needs a ranked view of what is most likely, what evidence supports each candidate, and what cheapest next step best discriminates between them.

**Owner:** T2
**Stage:** Discovery / Planning

### 6. Spec Stress-Test
Use before implementation when the proposed chunk touches risky realtime, stateful, multi-worker, voice, timing, orchestration, or contract-sensitive behavior.

**Owner:** T3A
**Stage:** Planning

### 7. Patch Critic / Patch Review
Use on the first meaningful diff for non-trivial implementation to determine whether the patch is hitting the right layer, hiding scope drift, or creating second-order risk.

**Owner:** T3A
**Stage:** First implementation

### 8. Adversarial Reviewer
Use when the team needs Codex to assume the patch is wrong until proven otherwise and to search for failure modes the implementation path may be missing.

**Owner:** T3A
**Stage:** First implementation

### 9. Verification Engine
Use when someone claims the fix works and the system needs Codex to examine whether the evidence actually supports that claim.

**Owner:** T3B
**Stage:** Proof

### 10. Test Adequacy Auditor
Use when tests pass but may not actually prove the original failure mode, especially on intermittent, stateful, async, timing, environment, or integration bugs.

**Owner:** T3B
**Stage:** Proof

### 11. Regression Sentry / Regression Scan
Use when a fix touches shared utilities, worker boundaries, contracts, config, state persistence, event flow, or deploy-sensitive behavior and the team must scan adjacent breakage risk before merge.

**Owner:** T3B
**Stage:** Pre-merge

### 12. Merge Gate / Final Killshot
Use when the system needs Codex to make a final rigor judgment on whether the evidence chain is strong enough for merge or deploy recommendation.

**Owner:** T3A + T3B
**Stage:** Pre-merge

### 13. Loop-Breaker
Use when the team has failed twice on materially the same issue, when churn is rising faster than understanding, or when broad iteration is replacing clean diagnosis.

**Owner:** T3A (wrong theory) or T3B (weak proof)
**Stage:** Failure recovery

### 14. External-Tool / MCP / Evidence-Acquisition
Use when local repo evidence is insufficient and Codex needs commands, logs, docs, MCP tools, or other external evidence sources to answer the real question.

**Owner:** T2, T3A, or T3B
**Stage:** Any

---

## Codex Role Map (by workflow stage)

| Stage | Codex Role |
|---|---|
| Discovery | Hypothesis Challenger |
| Architecture | Consultant + Architecture Interrogator |
| Repo understanding | Unfamiliar-Subsystem Explainer |
| Planning | Hypothesis Ranker + Spec Stress-Tester |
| First implementation | Patch Critic |
| Proof | Verification Engine + Test Adequacy Auditor |
| Pre-merge | Regression Sentry + Merge Gate |
| Failure recovery | Loop-Breaker |

---

## Codex Usage Matrix

| Situation | Mode | Effort | Why |
|---|---|---|---|
| 2+ plausible root causes remain | Hypothesis Ranker | Medium | Forces ranked causality instead of speculative implementation |
| Architecture choice is expensive to reverse | Consultant | Medium | Challenges assumptions before costly commitment |
| Wrong-layer suspicion or architecture masking bug | Architecture Interrogator | Medium or High | Prevents symptom patching at the wrong abstraction layer |
| Unfamiliar subsystem or unclear contract | Repo Q&A / Unfamiliar-Subsystem Explainer | Medium | Converts repo evidence into operational understanding |
| Risky or complex spec before coding | Spec Stress-Test | Medium | Finds hidden gaps before they turn into bad diffs |
| First meaningful diff on non-trivial work | Patch Critic | Medium | Catches wrong-layer, drift, and second-order risk early |
| Team wants maximum skepticism | Adversarial Reviewer | Medium or High | Assumes the current belief may be wrong and tests it hard |
| Someone claims the fix is done | Verification Engine | Medium | Separates observed evidence from optimistic conclusion |
| Tests pass but proof feels indirect | Test Adequacy Auditor | Medium | Stops fake certainty from generic green runs |
| Adjacent breakage risk is material | Regression Scan | Medium or High | Hunts side effects before they ship |
| Merge or deploy recommendation is pending | Merge Gate | Medium | Requires a rigor verdict, not vibes |
| Team has failed twice on same issue | Loop-Breaker | High | Resets diagnosis and forces a cleaner path |
| Repo evidence is insufficient | External-Tool / MCP / Evidence-Acquisition | Medium or High | Expands evidence surface before decision |
| Strong theory needs challenge | Hypothesis Challenge | Medium | Prevents confidence inflation from weak support |

---

## 9-Field Output Contract

**Every Codex interaction must return all nine fields. No exceptions. No freeform commentary in place of this.**

```
1. Task type
2. Claim under review
3. Strongest evidence for
4. Strongest evidence against
5. Missing evidence
6. Primary risks
7. Recommended next step
8. Confidence: low / medium / high
9. Verdict: APPROVE / CONDITIONAL / REJECT
```

This contract exists to keep Codex operational, comparable, and easy to route back into T1/T2 decision-making.

---

## Minimum Rigor Chain (non-trivial tickets)

Default minimum:
1. `SPEC_STRESS_TEST` when doctrine or risk level requires it
2. `PATCH_REVIEW` on first meaningful diff
3. `VERIFICATION` before calling the ticket done
4. `REGRESSION_SCAN` before final closure where applicable

Chain expands when:
- surface is shared
- deploy risk is elevated
- Bella loop conditions present
- integrator conditions present

---

## When SPEC_STRESS_TEST is Mandatory

Required when any of the following:
- root cause is uncertain
- shared interface involved
- state machine or orchestration path touched
- deploy-sensitive path affected
- repeated attempts already failed
- acceptance criteria are weak
- selected implementation layer is debatable

---

## Conditional Pass Law

`CONDITIONAL_PASS` means:
- the lane is not fully approved
- named conditions are mandatory
- no one may translate it into a full PASS by optimism
- outstanding condition = next gate requirement

A conditional pass is unfinished work, not soft approval.

---

## Failure Law

`FAIL` is a full stop for that lane.

Required behavior after FAIL:
- preserve the verdict exactly
- do not reinterpret it into a pass
- route required next action back through T2
- escalate to T1 if failure creates strategic conflict, overlap, or reset conditions
- do not continue implementation/deploy motion on the failed basis

---

## Effort Policy

Default: **medium**.

Escalate to **high** when:
- same bug has already failed twice
- issue touches voice, realtime, state, timing, concurrency, or cross-worker coordination
- hidden regressions are likely
- bug is intermittent or environment-sensitive
- multiple approved patches may interact dangerously
- architecture choice is costly to unwind
- team is clearly circling

**Extra-high effort requires Trent approval.** Never self-escalate.

---

## Routing Rules for T2

Route based on the question, not the desired answer.

**Route to T3A** when the question is about:
- root cause
- selected layer
- architecture correctness
- hidden coupling
- adversarial challenge
- patch-theory alignment
- spec validity

**Route to T3B** when the question is about:
- proof quality
- verification sufficiency
- regression risk
- test adequacy
- readiness to close a ticket

If one lane reveals the need for the other, T2 routes the next gate accordingly.

---

## Codex Request Shape

Every Codex request from T2 must include:

```text
CODEX_TASK
Mode: [mode name]
Checkpoint: [which of the 7 mandatory checkpoints]
Ticket_or_Chunk: [ticket ID or chunk name]
Primary_question: [one sharp question]
Reason_for_routing: [why this mode, why this judge]

Files_or_Boundaries_in_Scope:
- [exact paths]

Evidence_pack:
- observed_behavior:
- expected_behavior:
- reproduction_notes:
- diff_or_patch_summary:
- tests_run:
- logs_traces_or_artifacts:
- strongest_current_belief:
- strongest_uncertainty:
- proof_gap:

Requested_effort: low | medium | high
High_effort_approval: YES | NO | N/A
Requested_output_emphasis:
```

The sharper the question, the more valuable the Codex answer. Bad requests produce blurred rigor.

---

## What Codex Is NOT Used For

Codex should not be wasted on:
- trivial package bumps
- obvious config wiring
- basic grep/read tasks T5 can do cheaper
- routine decomposition T2 can do cleanly without ambiguity
- cosmetic refactors or "while we're here" cleanup
- broad rewrites justified only by aesthetics
- acting as a permanent passenger in every trivial step

Codex is used where rigor changes outcomes, not where it adds ceremony.

---

## Anti-Theater Law

Bad Codex usage includes:
- sending vague prompts for performative rigor
- routing to the easier judge instead of the correct one
- asking for reassurance instead of challenge
- omitting contradictory evidence
- summarizing away uncertainty
- treating activity as proof
- burying the actual question inside noise

Codex is not there to bless momentum.

---

## Escalation Law

Escalate to T1 when:
- lane ownership is disputed
- a failure implies strategic reset
- two tickets collide through shared surfaces
- verdicts reveal doctrine-level conflict
- the team cannot tell whether the next gate is architecture or verification

Escalate to Trent when:
- the conflict is strategic rather than procedural
- risk tolerance must be chosen by the human authority
- doctrine itself appears contradictory or insufficient

---

## Deploy Interaction

Deploy may not proceed on implementation confidence alone.

Before deploy:
- required Codex gates must be satisfied
- unresolved `CONDITIONAL_PASS` conditions must be closed
- any `FAIL` affecting the deploy lane must be resolved
- T3 PASS required — T3 Codex PASS = deploy authority

---

## Loop-Break Doctrine

When the team has repeated failed attempts:
- do not continue on the same reasoning by default
- route a LOOP_BREAKER lane
- identify whether the failure is theoretical or evidentiary
- reset the lane according to the verdict

Repeated effort without theory correction is not progress.

---

## Think Agent Codex Scope — Post-Cutoff SDK Protocol

**Applies to:** All work on Bella Think Agent V1 and any future project built on `@cloudflare/think`, `agents@0.9+`, `ai@6+`, or other post-training-cutoff SDKs.

**Does NOT apply to:** MVPScriptBella, frozen-bella-rescript-v2-*, or any work on established/known stacks. Those follow the full Codex pipeline above.

### The Problem

Codex (GPT-based CLI) has no training data on SDKs released after its cutoff. For Think Agent V1, this includes:
- `@cloudflare/think@0.1` — Cloudflare Agents Week, April 2026
- `agents@0.9` — TC39 stage 3 decorators, Agent base class
- `ai@6` — breaking API changes (`tool()` signature, `inputSchema`)
- `zod@4` — new schema API

Codex verdicts on SDK-specific API behavior are structurally uninformed. Confident 9-field output on questions Codex cannot answer is worse than no verdict — it produces authoritative-sounding noise the team may act on.

### What Codex CAN Judge (SDK-Agnostic)

- TypeScript correctness at the language level
- Architectural coupling between our own modules
- State machine logic (flow.ts, gate.ts, moves.ts)
- Race conditions in Durable Objects
- Contract consistency between worker boundaries
- Regression risk from changes
- Diff scope drift and hidden coupling
- Evidence chain sufficiency

### What Codex CANNOT Judge (Post-Cutoff SDKs)

- SDK API shapes (`child.chat()` return type, `@callable()` signature)
- SDK behavioral semantics (fiber recovery, session compaction)
- SDK configuration correctness (`new_sqlite_classes` vs `new_classes`)
- Whether a pattern matches the SDK's intended usage

### Think Agent Lane Selection

| Codex Lane | Use? | Rationale |
|---|---|---|
| PATCH_REVIEW (Mode 7) | **YES** | Judges our code patterns, coupling, drift — SDK-agnostic |
| MERGE GATE (Mode 12) | **YES** | Evidence chain assessment — evaluable without SDK knowledge |
| VERIFICATION (Mode 9) | **YES** | Binary proof: tsc passes + health check + endpoints respond |
| REGRESSION_SCAN (Mode 11) | **YES** | Adjacent breakage in our modules — no SDK knowledge needed |
| LOOP_BREAKER (Mode 13) | **YES** | Theory reset is SDK-agnostic |
| Consultant (Mode 1) | **SKIP for SDK questions** | Cannot answer. Route to T5 .d.ts discovery instead |
| Architecture Interrogator (Mode 2) | **SKIP for SDK questions** | Same. Real answer is in node_modules type definitions |
| Spec Stress-Test (Mode 6) | **OPTIONAL** | Can catch logic gaps but not SDK API mismatches |
| Hypothesis Challenge (Mode 4) | **SKIP for SDK behavior** | Would produce guesses, not falsification |

### Think Agent Minimum Rigor Chain

1. **T5 DISCOVERY** — read actual `.d.ts` files from `node_modules/` for any uncertain SDK API. This replaces Consultant/Architecture Interrogator for SDK-specific questions.
2. **T2 SPEC** — informed by T5 discovery output (real types, not Codex guesses)
3. **T4 IMPLEMENT** — execute spec verbatim
4. **COMPILER GATE** — `npx tsc --noEmit` = zero errors. This is a harder proof than any Codex verdict on SDK compatibility.
5. **T2 6-GATE REVIEW**
6. **T3A PATCH_REVIEW** — 9-field output contract. Judges diff quality, coupling, drift.
7. **T3A MERGE GATE** — evidence chain sufficient to deploy
8. **T4 DEPLOY + T5 HEALTH CHECK** — runtime proof (endpoints respond correctly)
9. **T3B VERIFICATION** — does evidence prove the fix
10. **T3B REGRESSION_SCAN** — adjacent breakage risk

### Key Principle

The real safety nets for Think Agent work are **the compiler** and **runtime testing**. `tsc --noEmit = 0` is a harder proof than Codex on SDK questions. POST `/fn/initSession` actually returning `stage=greeting` is proof Codex cannot replicate.

Don't weaken the Codex doctrine. Don't ask Codex questions it cannot answer. Route SDK-specific uncertainty to T5 discovery instead of Codex lanes.

### Voice Layer Law

The existing Deepgram voice agent is the LAUNCH voice layer. Think Agent V1 brain launches with the current working voice agent. `@cloudflare/voice` upgrade is a POST-LAUNCH improvement, not a prerequisite. Never reference voice as a blocker, gap, or missing sprint item in launch readiness assessments.

### When This Protocol Expires

Revisit when:
- Codex training data includes @cloudflare/think and agents@0.9+ documentation
- The team has accumulated enough verified patterns that SDK behavior is no longer uncertain
- Think Agent moves from experimental (@0.1) to stable SDK versions

At that point, revert to the full Codex pipeline for Think Agent work.

---

## Final Law

Codex is not a name-drop, not a reviewer sticker, and not an optional second opinion.
It is the system's explicit rigor service.
If the workflow weakens Codex at the moments where false confidence is most likely, the workflow is wrong and must be rewritten.
