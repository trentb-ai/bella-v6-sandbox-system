# ADR-002: T2 SDK Verification Gate — Irresistible Gates for Think Agent Work

## Status
Accepted

## Date
2026-04-27

## CF Docs Consulted
YES — ~/.claude/skills/think-agent-docs/think-types/think.d.ts §Think class — canonical type source for all SDK verification
YES — ~/.claude/skills/think-agent-docs/SKILL.md §STEP 1 — task-to-file routing table

## Context
ADR-001 gave judges a reference pack to load before Think reviews. But the failure mode persists: Codex (GPT CLI) still issues confident verdicts on SDK behavior it has zero training data for. The reference pack is a behavioral gate — it depends on judges remembering to load it and correctly separating SDK questions from code questions. Behavioral gates fail under pressure.

Trent directed: make the gates irresistible. Structural. If the artifact is missing, downstream refuses to proceed. Not "please remember" but "cannot proceed without."

## Decision
We will require T2 to produce an SDK Evidence Pack before any CODEX_REVIEW_REQUEST on Think agent work. T3A MUST reject any Think CODEX_REVIEW_REQUEST missing this pack. The pack is a required input field, not an optional attachment.

## The Three Irresistible Gates

### GATE IR-1: T5 SDK Discovery (before spec)
**Trigger:** Any spec touching Think SDK methods, types, or behavioral assumptions.
**Action:** T2 sends TASK_REQUEST to T5:
```
TASK_REQUEST: SDK_DISCOVERY
Target files: [specific .d.ts paths from SKILL.md lookup table]
Verify: [list of methods/types/signatures the spec assumes]
Output: RAW — exact type signatures, JSDoc comments, confirmed/denied per item
```
**Irresistible because:** T2 cannot write the spec without T5 discovery output. Spec references unverified SDK claims = T3A auto-rejects at IR-3.

### GATE IR-2: T2 SDK Evidence Pack Assembly (before CODEX_REVIEW_REQUEST)
**Trigger:** T4 sends REVIEW_REQUEST on Think agent code. T2 runs 6-gate. Before forwarding to T3A.
**Action:** T2 assembles SDK_EVIDENCE_PACK:
```
SDK_EVIDENCE_PACK
Sprint: [sprint-id]
SDK_version: @cloudflare/think@0.4.0
Discovery_source: T5 read of [files]

VERIFIED_SIGNATURES:
- method: [name]
  signature: [exact from .d.ts]
  used_in: [file:line]
  matches_impl: YES | NO | PARTIAL

VERIFIED_TYPES:
- type: [name]
  fields: [exact from .d.ts]
  used_in: [file:line]
  matches_impl: YES | NO | PARTIAL

SDK_SCOPE_BOUNDARY:
- JUDGE_THESE (SDK-agnostic): [list — coupling, state logic, race conditions, regression risk, diff scope]
- DO_NOT_JUDGE (SDK-specific): [list — API shapes, behavioral semantics, config correctness, usage patterns]
- SDK_CORRECTNESS_SETTLED_BY: T5 .d.ts discovery + tsc --noEmit

UNRESOLVED_SDK_QUESTIONS: [any items T5 could not confirm — route to T9 arch review, NOT Codex]
```
**Irresistible because:** This pack is a REQUIRED FIELD in the CODEX_REVIEW_REQUEST. Missing = T3A rejects without reading the code.

### GATE IR-3: T3A Rejection Mandate (at review time)
**Trigger:** T3A receives CODEX_REVIEW_REQUEST on Think agent code.
**Action:** T3A checks three conditions before running ANY Codex lane:
1. `SDK_EVIDENCE_PACK` attached? NO → `CODEX_VERDICT: REJECTED — missing SDK Evidence Pack. Return to T2.`
2. `SDK_SCOPE_BOUNDARY` section present? NO → same rejection.
3. Any finding in verdict touches items listed under `DO_NOT_JUDGE`? YES → strip that finding, note: `[STRIPPED — SDK-specific, outside Codex scope per IR-3]`

**Irresistible because:** T3A has a mechanical checklist. Missing artifact = auto-reject. No judgment call required. No "I think it is fine" escape hatch.

## Extended CODEX_REVIEW_REQUEST Format (Think Work Only)

```
CODEX_REVIEW_REQUEST: [sprint-id]
Mode: [PATCH_REVIEW | MERGE_GATE | etc]
THINK_CONTEXT: loaded
SDK_EVIDENCE_PACK: [inline or reference to message]

[standard Codex request fields per codex-request-contract.md]
```

## Compiler Gate Supremacy

For SDK correctness, `tsc --noEmit = 0 errors` outranks any Codex verdict. Period.

If Codex says the SDK usage is wrong but tsc passes and runtime health checks pass:
- Codex is wrong. Not the code.
- T2 notes the false positive in the SDK Evidence Pack for future reference.
- Build proceeds.

If tsc fails:
- Build stops regardless of any Codex PASS.
- T5 reads .d.ts for the failing type. T2 fixes spec. Pipeline restarts.

## Rationale
Behavioral gates ("please load the reference pack") fail under velocity pressure. Structural gates (artifact is a required input, missing = auto-reject) survive velocity pressure because skipping them is not a discipline failure — it is a format error that the downstream step mechanically catches.

Three gates, each irresistible for a different reason:
- IR-1: T2 cannot spec without data (input dependency)
- IR-2: T3A will not review without pack (format requirement)
- IR-3: T3A will not judge SDK behavior even if asked (scope enforcement)

## Consequences
### Positive
- Eliminates false Codex FAIL/REWORK on valid Think SDK usage
- SDK correctness proven by source (.d.ts) + compiler (tsc), not by a model with no training data
- Pipeline velocity improves — no wasted cycles on bad verdicts + rework
- Gates are mechanical, not behavioral — survive team pressure and fatigue
- Unresolved SDK questions route to T9 (arch), not Codex (uninformed)

### Negative
- Adds T5 discovery step + T2 assembly step per Think sprint (~2-5 min)
- T2 carries more pre-gate work on Think sprints
- Non-Think work unchanged (no overhead)

### Neutral
- ADR-001 reference pack still valid — IR gates layer on top, not replace
- T3B regression gates unaffected (already SDK-agnostic by design)

## Alternatives Considered
### Option A: Train Codex on Think SDK (not possible)
- Pros: would solve root cause
- Cons: Codex is GPT CLI, we do not control training data
- Rejected because: not actionable

### Option B: Skip Codex entirely for Think work
- Pros: no false negatives ever
- Cons: loses coupling/regression/drift analysis Codex does well
- Rejected because: Codex is valuable on SDK-agnostic lanes

### Option C: Behavioral gate only (ADR-001 status quo)
- Pros: lighter process
- Cons: judges forget under pressure, behavioral compliance degrades with velocity
- Rejected because: already proven insufficient — Trent directed structural gates

## Invalidation Criteria
Revisit when:
- Codex training data includes @cloudflare/think documentation
- Think SDK stabilizes beyond experimental (v1.0+)
- Team accumulates 30+ verified Think patterns making discovery pro-forma

## Related ADRs
- ADR-001: Think Reference Pack for Codex Judges (complementary — IR gates layer on top)

## Implementation Boundary
- T9 files this ADR (this document)
- T2 implements IR-1 and IR-2 in sprint workflow immediately
- T3A implements IR-3 rejection mandate immediately
- T2 updates TEAM_PROTOCOL.md with SDK Evidence Pack requirement
- Trent approves: directed this ADR explicitly
