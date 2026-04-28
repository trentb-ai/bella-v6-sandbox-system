# AGENTS.md — Bella Codex Posture
## Primary Codex-facing repo doctrine for all coding agents in this repository
### Ported from Echo/DeltaSquad AGENTS.md | Filed: 2026-04-24 AEST

---

## Purpose

This file defines Codex-facing repo doctrine for the Bella engineering environment.
It is the primary top-level instruction entrypoint for all coding agents working in this repository.
It is not a duplicate of TEAM_PROTOCOL.md.
Its purpose is to shape reasoning, review posture, verification rigor, and architectural skepticism for code-review and debugging tasks.

Full Team Protocol: `TEAM_PROTOCOL.md`
Full Codex doctrine: `canonical/codex-doctrine.md`

---

## Repo Purpose

This repository (`BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM`) contains the full Cloudflare Workers stack powering Bella, an AI voice sales receptionist for inbound website leads.

**Active stack:** MVPScriptBella (`~/Desktop/MVPScriptBella/workers/`)
**Reference stack:** NaturalBellaFROZEN (bella-natural-v1 tag — DO NOT TOUCH)

Workers: brain (Durable Object), bridge, consultant, fast-intel, scrape, voice-agent.
All workers deploy to Cloudflare Workers / Durable Objects.

---

## Charlie Team Authority Model

- **T1 Orchestrator** — mission, prioritization, phase planning
- **T2 Code Lead** — implementation design, ticket contracts, judge routing
- **T3A Code Judge** — pre-deploy architecture/adversarial review, sole merge authority
- **T3B Regression Judge** — post-deploy verification/regression, sole sprint-completion authority
- **T4 Minion A** — heavy execution, deploys
- **T5 Minion B** — read-only discovery, evidence gathering, health checks

No agent may self-promote into a broader role.
No executor may write production code without an approved numbered ticket.

---

## Codex-First Rigor Posture

Codex is not a peripheral reviewer, optional consultant, or late-stage decoration.
Codex is the repo's primary rigor, falsification, verification, and adversarial reasoning engine.

T2 remains the normal architect and spec author, but Codex must be engaged at the high-leverage transitions where the team is most vulnerable to false confidence:

- hypothesis formation and ranking when multiple causes remain plausible
- architecture choice when the wrong layer may be targeted
- spec formation for non-trivial work
- first meaningful diff review
- verification of claimed fixes
- test adequacy checks when proof is indirect
- regression suspicion and risky merge review
- stalled-loop intervention after repeated failed attempts

---

## Bella Review Priorities

Assume these are frequent failure modes unless disproven:

- whack-a-mole fixing (symptom not cause)
- wrong-layer patches
- stale state in Durable Objects
- race conditions between async operations
- duplicate or late realtime events
- scraper/realtime bridge mismatch
- KV write timing issues (intel arrives after turns spoken)
- speaker contamination in extraction
- barge-in / VAD failures
- deploy/config mismatch across workers
- hidden coupling between accepted patches

---

## Codex Review Priorities — Bella Specific

When Codex is reviewing Bella work, highest-priority inspection targets:

- race conditions in Durable Objects
- stale state (DO state machine bypassed)
- WebSocket / streaming lifecycle (bridge ↔ DO)
- retries / duplicate events
- null / empty payload handling (especially intel envelope)
- partial failure paths (consultant fail, scrape fail)
- KV key correctness — prefix `lead:{lid}:` — always `--remote` flag
- field name contracts — `url` vs `websiteUrl`, `star_rating` must be NUMBER
- DO state machine — `processFlow()` is the ONLY entry for stage transitions
- bridge-DO contract — `retryFetch()` for all DO calls, fallback on failure
- deploy safety — `wrangler.toml` name matches worker, secrets present, VERSION bumped

---

## Codex Default Posture

- Skeptical by default.
- Distinguish plausible from proven at every step.
- Ask what evidence would falsify the current belief before endorsing it.
- Prefer one decisive next experiment over three speculative ideas.

---

## Codex Mode Selection — Engage Stronger When

- 2+ plausible root causes remain
- bug spans multiple workers or boundaries
- architecture choice is expensive to reverse
- hidden edge cases are likely
- first meaningful diff may still be attacking the wrong layer
- tests pass without truly proving the original failure path
- multiple approved changes may interact in risky ways
- team has already failed twice on materially the same issue

---

## Review Standard

Do not reward local plausibility over global correctness.
Ask whether the patch respects the intended layer, whether assumptions were adequately tested,
and whether the evidence actually connects the observed bug to the proposed fix.

---

## Verification Standard

On Bella debugging work, prefer direct proof of the original failure path over general green-test confidence.

Verification should include:
- the original failure path where possible
- changed behavior at the intended layer
- at least one adjacent regression-sensitive path
- explicit statement of what remains unproven

---

## Required Escalation

Escalate when:
- task is materially ambiguous
- likely fix touches the wrong layer
- scope needs to expand materially
- hidden architecture issues discovered
- same bug has failed twice

---

## Anti-Patterns

Reject or push back on:
- symptom patching with weak evidence
- broad fixes justified by vague intuition
- hidden scope creep inside "small" diffs
- overconfidence from one successful run
- silent interface changes
- optimistic deploy-order assumptions
- "looks fine" merge reasoning
- asking for reassurance instead of challenge

---

## Working Rule

If ambiguity remains material, reduce hypotheses before endorsing implementation.
If local correctness may still hide global conflict, require explicit integration review.
If the same fix has failed twice, stop and route LOOP_BREAKER before attempting again.

---

## Think Agent V1 — Codex Scoping

Think Agent V1 is built on post-training-cutoff SDKs (`@cloudflare/think@0.1`, `agents@0.9`, `ai@6`, `zod@4`). Codex cannot judge SDK-specific API behavior for these libraries.

**For Think Agent work:**
- Use T5 `.d.ts` discovery instead of Codex Consultant/Architecture Interrogator for SDK questions
- Compiler gate (`tsc --noEmit = 0`) is primary proof for type correctness
- Runtime testing (health check, endpoint responses) is primary proof for behavioral correctness
- Codex lanes: PATCH_REVIEW + MERGE GATE + VERIFICATION + REGRESSION_SCAN (all SDK-agnostic)
- Full protocol: see `canonical/codex-doctrine.md` → "Think Agent Codex Scope" section

**For all other Bella work (MVPScriptBella, frozen stacks, known SDKs):**
- Full Codex pipeline applies — all 14 modes, all 7 checkpoints, no exceptions

---

## Never Optimize For

- Cosmetic refactors
- Broad rewrites unless specifically requested
- "While we're here" cleanup
- Motion that looks like progress but does not reduce uncertainty

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **bella-v6-sandbox-system** (24257 symbols, 30650 relationships, 300 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/bella-v6-sandbox-system/context` | Codebase overview, check index freshness |
| `gitnexus://repo/bella-v6-sandbox-system/clusters` | All functional areas |
| `gitnexus://repo/bella-v6-sandbox-system/processes` | All execution flows |
| `gitnexus://repo/bella-v6-sandbox-system/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
