# Codex Operating Doctrine (Compressed)
### Binding for all Codex process in Charlie Team | Authority: Trent Belasco | 2026-04-27
### Read with: codex-routing-matrix.md, codex-request-contract.md, team-workflow.md

---

## Core Principle
Claude drives work. Codex challenges work. Codex is the system's falsification + evidence-discipline engine — not a peripheral reviewer. This file wins over any conflicting prompt, note, or habit.

## Role Map

| Agent | Codex Role |
|---|---|
| T2 | Request framing + judge routing. T3A for arch/correctness, T3B for proof/regression. Never wrong judge for convenience. |
| T3A | Pre-deploy. Arch/adversarial lanes. Sole merge authority. |
| T3B | Post-deploy. Verification/regression lanes. Sole sprint-completion authority. |
| T4/T5 | Execute only. Never issue verdicts. |

## 7 Mandatory Checkpoints (non-trivial work)
1. Hypothesis selection — 2+ plausible causes remain
2. Spec finalization — complex or risky work
3. First meaningful diff — non-trivial implementation
4. Fix verification — before task marked complete
5. Test adequacy — proof indirect/intermittent/environment-sensitive
6. Regression scan — before risky merge/deploy
7. Loop-breaker — after 2 materially failed attempts

## 14 Modes (Owner | Stage)
1. **Consultant** — T3A | Arch — challenge assumptions before costly commitment
2. **Architecture Interrogator** — T3A | Arch — wrong-layer suspicion, contract mismatch
3. **Repo Q&A** — T2/T5 | Discovery — subsystem understanding from repo evidence
4. **Hypothesis Challenge** — T3A | Discovery — adversarial pressure on leading theory
5. **Hypothesis Ranker** — T2 | Discovery/Planning — rank 2+ causes, find discriminating test
6. **Spec Stress-Test** — T3A | Planning — find hidden gaps before coding
7. **Patch Critic** — T3A | First impl — wrong layer, scope drift, second-order risk
8. **Adversarial Reviewer** — T3A | First impl — assume patch wrong, find failure modes
9. **Verification Engine** — T3B | Proof — does evidence actually prove the claimed fix?
10. **Test Adequacy Auditor** — T3B | Proof — do tests prove the real failure mode?
11. **Regression Sentry** — T3B | Pre-merge — adjacent breakage risk scan
12. **Merge Gate** — T3A+T3B | Pre-merge — evidence chain sufficient to ship?
13. **Loop-Breaker** — T3A (wrong theory) or T3B (weak proof) | Failure recovery
14. **External-Tool/MCP** — T2/T3A/T3B | Any — expand evidence surface

## 9-Field Output Contract (mandatory, no exceptions)
```
1. Task type  2. Claim under review  3. Evidence for  4. Evidence against
5. Missing evidence  6. Primary risks  7. Next step  8. Confidence  9. Verdict
```

## Minimum Rigor Chain
1. SPEC_STRESS_TEST (when required) → 2. PATCH_REVIEW → 3. VERIFICATION → 4. REGRESSION_SCAN
Expands when: shared surface, elevated deploy risk, Bella loop conditions, integrator conditions.

## SPEC_STRESS_TEST Mandatory When
Root cause uncertain | shared interface | state machine/orchestration touched | deploy-sensitive path | repeated failures | weak acceptance criteria | debatable layer choice

## Verdict Semantics
- **PASS** = lane approved, proceed
- **CONDITIONAL_PASS** = unfinished work, named conditions mandatory, never translate to PASS by optimism
- **FAIL** = full stop. Preserve exactly. Do not reinterpret. Route next action through T2. Escalate to T1 if strategic conflict.

## Effort Policy
Default: **medium**. Escalate to high when: 2+ failures on same bug, voice/realtime/state/timing/concurrency, hidden regressions likely, intermittent/environment-sensitive, architecture costly to unwind. **Extra-high requires Trent approval.**

## T2 Routing Rules
Route on the question, not the desired answer.
- **→ T3A:** root cause, selected layer, arch correctness, hidden coupling, adversarial challenge, spec validity
- **→ T3B:** proof quality, verification sufficiency, regression risk, test adequacy, readiness to close

## Deploy Gate
No deploy on implementation confidence alone. Required: all Codex gates satisfied, CONDITIONAL_PASS conditions closed, no unresolved FAIL, T3A PASS.

## Loop-Break Doctrine
After 2 failed attempts: stop, route LOOP_BREAKER, identify if failure is theoretical or evidentiary, reset per verdict. Repeated effort without theory correction is not progress.

## Not For Codex
Trivial bumps, obvious config, basic grep/read (T5), routine decomposition (T2), cosmetic refactors, aesthetic rewrites. Codex where rigor changes outcomes, not where it adds ceremony.

## Anti-Theater Law
Bad usage: vague prompts for performative rigor, easier judge for convenience, reassurance instead of challenge, omitting contradictory evidence, summarizing away uncertainty, treating activity as proof. **Codex is not there to bless momentum.**

## Escalation
→ T1: disputed lane ownership, strategic reset, shared-surface collision, doctrine-level conflict
→ Trent: strategic conflict, risk tolerance choice, doctrine contradiction

## Think Agent SDK Protocol (ADR-001 + ADR-002)
Codex has zero training data on @cloudflare/think@0.4, agents@0.9+, ai@6+, zod@4.

**CAN judge (SDK-agnostic):** TS correctness, our module coupling, state machine logic, DO race conditions, contract consistency, regression risk, diff scope, evidence chains.
**CANNOT judge (post-cutoff):** SDK API shapes, behavioral semantics, config correctness, usage patterns.

**Think lanes:** PATCH_REVIEW ✓ | MERGE_GATE ✓ | VERIFICATION ✓ | REGRESSION_SCAN ✓ | LOOP_BREAKER ✓ | Consultant/Arch Interrogator/Hypothesis Challenge on SDK → SKIP (route to T5 .d.ts)

**IR Gates (ADR-002):** IR-1: T5 SDK Discovery before spec. IR-2: T2 SDK Evidence Pack before CODEX_REVIEW_REQUEST. IR-3: T3A rejects if pack missing; strips SDK-specific findings.

**Compiler Gate Supremacy:** `tsc --noEmit = 0` outranks any Codex verdict on SDK questions. Runtime health > Codex opinion.

**Expires when:** Codex training includes Think docs, or Think reaches stable v1.0+.

## Final Law
Codex is the system's explicit rigor service. If the workflow weakens Codex where false confidence is most likely, the workflow is wrong.
