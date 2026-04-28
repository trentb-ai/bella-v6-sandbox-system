# Think Sprint Review Protocol — T9 Pre-Approval + T3A Slim Gate
**Doc ID:** doc-think-sprint-review-protocol-20260426
**Date:** 2026-04-26 AEST
**Author:** T9 Architect
**Approved by:** Trent Belasco
**Scope:** All Think Agent sprints (S3 forward)

---

## PROBLEM

Sprint 3 shipped to T3A with 7 P1 errors — all SDK field mismatches that Codex CLI cannot detect because @cloudflare/think@0.4.0 is post-cutoff (zero training data). T9 pre-approval caught all 7 errors that Codex would have missed or hallucinated on.

Codex CLI is net-negative on SDK behavioral questions for Think Agent. It either misses errors or halluccinates FAILs on valid patterns.

## PROTOCOL

### Step 1: T2 Spec Pre-Flight (4 gates — mandatory)

Before writing any sprint spec:

0. **SKILL READ** (NEW) — Read `~/.claude/skills/think-agent-docs/SKILL.md`. Follow the task→file lookup table. Load relevant .d.ts and docs for the sprint scope. Evidence: "Skill consulted: think-types/think.d.ts §[section] — confirmed [fields]"
1. **SOURCE INVENTORY** — T5 reads actual function signatures/types from source files. Build plan snippets are INTENT, not SOURCE.
2. **SDK .d.ts GREP** — T5 greps `~/.claude/skills/think-agent-docs/think-types/think.d.ts` (NOT node_modules — same content, CWD-independent, always available). No memory-based field names.
3. **ADDITIVE CHECK** — Every hook modification declares PRESERVED (what stays from prior sprints) and ADDS (what's new). No silent replacements.

T5 raw output + skill consultation evidence attached as appendix to all downstream requests.

### Mandatory Skill Reads Per Agent

| Agent | Must Read | When |
|-------|-----------|------|
| T2 | SKILL.md → task→file table → relevant .d.ts/docs | Gate 0, before writing spec |
| T4 | think-types/think.d.ts + relevant doc for task | Before implementing any Think code |
| T3A | think-types/think.d.ts for SDK field verification | During slim gate |
| T5 | Grep think-types/think.d.ts (skills copy) | On every GREP_REQUEST for Think SDK types |

### Codex CWD Law

T3A must run Codex from the target worker directory. For Think sprints: `cd "/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/"` before Codex invocation. Wrong CWD = Codex reads wrong source = invalid findings.

### Step 2: T9 Pre-Approval (SDK + Architecture)

T2 → T9: `SPEC_PRE_APPROVAL:` with full spec + T5 evidence appendix.

T9 reviews for:
- SDK field name correctness (TurnConfig.system, ToolCallDecision.action, ctx.messages extraction, etc.)
- Architecture coherence with three-tier prompt strategy
- Hook additive safety (no silent overwrites of prior sprint work)
- State management (this.setState() on all mutations)
- Continuation guard pattern compliance

T9 returns:
- **APPROVED** — send to T3A
- **CONDITIONAL** — named fixes required, then send to T3A
- **REJECTED** — fundamental rework needed, reason provided

### Step 3: T3A Slim Codex Gate (Logic Only)

T3A receives spec with T9 pre-approval stamp.

**T3A RUNS:**
- Logic correctness (control flow, edge cases, error handling)
- Standard code quality (naming, structure, DRY)
- Test coverage assessment
- PATCH_REVIEW on implementation diff

**T3A SKIPS:**
- SDK behavioral claims (already verified by T9 from .d.ts source)
- SDK field name validation (already verified by T9)
- Provider/session lifecycle questions (already verified by T9)
- Any lane that requires SDK knowledge Codex doesn't have

### Step 4: Deploy + Regression (unchanged)

T3A PASS → deploy → T3B VERIFICATION + REGRESSION_SCAN (unchanged).

## SCOPE

- **APPLIES TO:** All Think Agent sprints (S3 forward) — any code touching @cloudflare/think, agents@0.11, ai@6, zod@4
- **DOES NOT APPLY TO:** Non-Think workers (V2-rescript, bridge, fast-intel, consultant) where Codex has full training data — standard full Codex gate applies

## AUTHORITY CHAIN

T9 owns SDK + arch correctness for Think Agent specs.
T3A owns logic + code quality for all specs.
T3B owns post-deploy quality for all deploys.

No overlap. No substitution.
