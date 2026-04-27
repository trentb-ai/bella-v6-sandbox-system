# TEAM WORKFLOW

## Purpose
This document defines the team's standard operating workflow.

It covers:
- phase flow
- ticket structure
- handoff structure
- review and verification outputs
- Codex trigger rules
- integration triggers
- failure-loop control

It is operational, not constitutional.
Constitutional rules live in `team-protocol.md`.

## Mandatory Reference Documents
Every agent MUST read on startup:
- `TEAM_PROTOCOL.md` — constitutional rules
- `BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md` — Bella system architecture (how all workers connect)

## LAW: SPRINT-END TEAM REFRESH (added 2026-04-27)

At the close of every sprint, spin up fresh agent sessions. Never carry accumulated sprint context into the next sprint.

**Trigger:** T3B PASS on sprint regression gate = sprint closed.
**Protocol:**
1. T2 writes sprint handover doc → D1 upsert + BRAIN_DOCS mirror
2. T2 broadcasts `SPRINT_COMPLETE: [sprint-id]` to all agents
3. All agents stand down (close sessions)
4. New sessions spin up reading handover doc only — not prior session context
5. Fresh T2 sets summary, reads handover, confirms team online before next sprint starts

**Why:** Accumulated context = wasted tokens + stale reasoning. Fresh sessions load only what matters.

---

## Default Operating Rhythm
Default sequence for non-trivial work:

1. T1 defines objective, success condition, and current phase.
2. T0 updates visible task board and current agent states.
3. T2 writes or updates the ticket, including required Codex checkpoint or `NONE`.
4. T5 performs any required read/recon work unless an explicit exception applies.
5. T2 finalizes the scoped task package.
6. Codex is routed before implementation if trigger conditions are met.
7. T4 executes only the approved ticket scope.
8. On the first meaningful diff for non-trivial work, Codex review occurs before acceptance.
9. T3A reviews logic, architecture fit, and adversarial risk.
10. T3B verifies reproduction path, fix behavior, test adequacy, and regression risk.
11. Integrator activates if global coherence risk exists.
12. T1 decides next phase, escalation, or deploy readiness.

## Work Classification
Use the smallest valid classification:

### Trivial
Examples:
- obvious config wiring
- mechanical text fix
- package bump with no behavioral change
- low-risk one-file adjustment with clear proof path

Default:
- Codex optional
- normal review still required if code changes

### Non-Trivial
Examples:
- bug with multiple plausible causes
- fix touching architecture, interfaces, schemas, contracts, or worker boundaries
- change where tests may miss the real failure mode
- work likely to create regression risk
- repeated-failure debugging
- any chunk requiring independent falsification

Default:
- Codex required at defined checkpoints
- review and verification both mandatory

## Ticket Template
Every meaningful task MUST use the following template.

```text
TICKET_ID:
TITLE:
OWNER:
STATUS:

GOAL:
WHY_IT_MATTERS:

ALLOWED_FILES:
FORBIDDEN_FILES:

INPUTS_AND_DEPENDENCIES:
CONSTRAINTS:

IMPLEMENTATION_PLAN:
1.
2.
3.

ACCEPTANCE_CRITERIA:
- 
- 
- 

REQUIRED_TESTS:
- 
- 

ROLLBACK_AND_RISK_NOTES:
- 
- 

CHECKPOINT_EXPECTATION:
DELIVERABLE_FORMAT:
REQUIRED_CODEX_CHECKPOINT:
REGRESSION_SENSITIVE_ADJACENCIES:
