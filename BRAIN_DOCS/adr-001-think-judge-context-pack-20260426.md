# ADR-001: Think Reference Pack for Codex Judges

## Status
Accepted

## Date
2026-04-26

## CF Docs Consulted
N/A — process architecture decision, no CF primitive touched

## Context
Codex CLI (GPT-based) has no training data on @cloudflare/think@0.4, agents@0.11, ai@6, zod@4. When T3A/T3B review Think code, old bridge patterns look "correct" to Codex and Think patterns look "wrong". This caused regressions on 2026-04-25 — team reverted valid Think code to old bridge patterns because Codex flagged it.

## Decision
We will require T3A and T3B to load `canonical/think-reference-pack.md` before any Think-related code review. Verdicts must include `THINK_CONTEXT: loaded`. Codex lanes requiring SDK knowledge (Consultant, Architecture Interrogator, Hypothesis Challenge on SDK behavior) are SKIPPED for Think work — route to T5 `.d.ts` discovery instead.

## Rationale
Codex is structurally uninformed on post-cutoff SDKs. Confident verdicts on questions it cannot answer produce authoritative noise the team acts on. The reference pack gives judges verified patterns from real `.d.ts` files and working code. Lane restriction prevents Codex from producing guesses dressed as falsification.

## Consequences
### Positive
- Judges have verified SDK patterns before every review
- Old→New mapping table catches regression-inducing patterns immediately
- Lane restriction prevents false confidence on SDK questions
- Compiler (tsc) and runtime become primary proof, not Codex

### Negative
- Extra pre-read step per review (~30s)
- Reference pack must be maintained as SDK evolves
- Some Codex lanes unavailable for Think work

### Neutral
- Non-Think work (MVPScriptBella, frozen-bella-rescript-v2) unchanged

## Alternatives Considered
### Option A: Full Codex on everything
- Pros: simpler process
- Cons: Codex produces wrong verdicts on SDK code, causes regressions
- Rejected because: proven failure on 2026-04-25

### Option B: Skip Codex entirely for Think
- Pros: no false negatives
- Cons: loses SDK-agnostic value (coupling, drift, regression)
- Rejected because: Codex still valuable for non-SDK questions

## Invalidation Criteria
Revisit when:
- Codex training data includes @cloudflare/think docs
- Team has 20+ verified Think patterns making SDK uncertainty negligible
- Think moves from @0.4 experimental to stable

## Related ADRs
None (first ADR)

## Implementation Boundary
- T9 created `canonical/think-reference-pack.md` (done)
- T2 enforces pre-read on all Think CODEX_REVIEW_REQUESTs
- T3A/T3B include `THINK_CONTEXT: loaded` in verdicts
- T2-as-orchestrator updates TEAM_PROTOCOL.md with reference
