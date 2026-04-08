# Charlie Team Streamlined — Architecture & Lessons
**D1 ID:** doc-charlie-team-streamlined-20260406

## Final Team (6 agents — CURRENT)
T1: Orchestrator (Sonnet) | T2: Code Lead (Sonnet) | T3: Codex Judge (Sonnet) | T4: Minion A heavy execution (Sonnet) | T5: Minion B reads/health/canary (Haiku)
Eliminated: T6 Sentinel, T7 Librarian, T8 PM.
Launch alias: CharlieTeamStreamlined

## Key Protocol Changes
1. DEAD SILENCE RULE: messages only for deliverables
2. 5-MIN PING CYCLE
3. NO CC ON VERDICTS: CODEX_VERDICT to T2 only
4. T5 FIRST RULE: T2/T4 never read files. T5 does all mechanical work.
5. SPEC REVIEW GATE: T3 reviews complex specs before T4 builds.
6. INFRA NAMING: never version-stamp KV/R2/D1. Workers versioned, infra shared.

## T0 EA+PM Lessons (CRITICAL — why T0 was eliminated)
- Haiku hallucinates on open-ended questions
- T0 created ghost CronCreate tasks then forgot them after context compression
- Repeatedly violated dead silence rule
- FIX: Stand T0 down. Direct T1 routing faster.
