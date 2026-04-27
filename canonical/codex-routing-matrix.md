# CODEX ROUTING MATRIX

## Purpose
This document defines how Codex modes are selected in live operation.

Each mode must have:
- a clear trigger
- a clear owner
- one primary question
- a minimum evidence pack
- a default effort level
- a required output shape

If a request does not satisfy these conditions, rewrite the request before routing.

## Mode Boundary Law
Modes are distinct only if they answer materially different questions.
Do not swap one mode for another casually.

## Operational Matrix

| Mode | Use when | Do not use when | Owner | Primary question | Minimum evidence pack | Default effort | Required output |
|---|---|---|---|---|---|---|---|
| Consultant | Choosing between plausible implementation paths with meaningful tradeoffs | Root cause is still unresolved and diagnosis is the real problem | T2 | Which path is strongest and why? | ticket, constraints, options, tradeoffs, current preference | medium | tradeoff analysis + recommendation |
| Architecture Interrogator | Wrong-layer suspicion, contract mismatch, hidden coupling, architecture masking symptom | The issue is already narrow and local | T3A | Are we solving this in the wrong layer? | failing behavior, touched boundaries, architecture context, current patch idea | medium | wrong-layer analysis + layer recommendation |
| Repo Q&A / Unfamiliar-Subsystem Explainer | The team lacks operational understanding of a subsystem or boundary | Scout can answer with simple file lookup alone | T2 or T5 | How does this subsystem actually work? | files, boundary question, unknowns, relevant logs or traces | medium | subsystem explanation + key uncertainties |
| Hypothesis Challenge | One leading theory exists and needs adversarial pressure | Multiple causes remain unresolved and ranking is needed first | T3A | What is wrong with our current theory? | leading hypothesis, evidence for, evidence against, unknowns | medium | attack on theory + missing evidence |
| Hypothesis Ranker | Two or more plausible causes remain | One dominant theory already exists | T2 | Which root cause is most likely, and what best discriminates next? | candidate hypotheses, observations, reproduction notes, contradictory signals | medium | ranked hypotheses + decisive next test |
| Spec Stress-Test | A non-trivial implementation spec exists before coding | The work is trivial and mechanically obvious | T2 | What is wrong with this spec? | draft ticket/spec, allowed files, acceptance criteria, risks | medium | spec gaps + tightened scope |
| Patch Critic / Patch Review | First meaningful diff exists on non-trivial work | No meaningful patch exists yet | T3A | What is wrong with this diff? | diff summary, files changed, tests run, current belief | medium | patch weaknesses + second-order risks |
| Adversarial Reviewer | The team wants maximum skepticism against a spec, patch, or claim | Basic review is enough and time cost outweighs benefit | T3A | Assume this is wrong; where does it fail first? | target artifact, claim under review, strongest supporting evidence | medium or high | failure-mode map + confidence challenge |
| Verification Engine | Someone claims the fix works | Test adequacy, not claim verification, is the main concern | T3B | Does the evidence actually prove the claimed fix? | claimed fix, tests run, observed outcomes, repro path | medium | claim-vs-proof analysis + verification verdict |
| Test Adequacy Auditor | Tests pass but may not prove the real failure mode | Verification of the broader claim is the primary task | T3B | What evidence is missing to call this fixed? | tests, repro history, environment notes, remaining uncertainty | medium | proof gaps + additional required tests |
| Regression Sentry / Regression Scan | Adjacent breakage risk is material before merge/deploy | Change surface is tiny and clearly isolated | T3B | What could regress if we ship this? | touched surfaces, dependencies, interfaces, config/state impacts | medium | regression map + guardrails |
| Merge Gate / Final Killshot | A non-trivial chunk is about to merge or deploy | Earlier checkpoints are still incomplete | T3A + T3B | Is the evidence chain sufficient to proceed? | full evidence chain, prior verdicts, unresolved risks | medium | final proceed / do-not-proceed verdict |
| Loop-Breaker | Two failed attempts or churn without learning | Normal forward progress is still occurring | T1 or T2 | Why are we stuck and what single next experiment best resets diagnosis? | iteration history, disproven ideas, unresolved unknowns, current churn | high with approval | reset diagnosis + decisive next experiment |
| External-Tool / MCP / Evidence Acquisition | Local repo evidence is insufficient | Local evidence already supports a clean answer | T2, T3A, or T3B | What external evidence must we gather before deciding? | decision gap, local evidence, external sources available | medium | evidence acquisition plan + stop/go threshold |

## Effort Notes
- Default: `medium`
- Propose `high` only if medium is unlikely to produce enough value
- High effort requires Trent approval
- If approval is absent, route at medium or narrow the question

## Escalation Notes
Escalate before routing if:
- the primary question is still fuzzy
- the evidence pack is mostly empty
- the mode boundary is unclear
- the team is trying to use Codex as a substitute for basic recon

## Output Semantics
All modes must return the structured contract in:
- `canonical/codex-request-contract.md`

Mode-specific additions are allowed.
Mode-specific omissions are not.
