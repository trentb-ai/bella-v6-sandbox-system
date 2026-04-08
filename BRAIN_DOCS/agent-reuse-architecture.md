# Bella V3 Agent Reuse Architecture
**D1 ID:** doc-bella-v3-agent-reuse-architecture-20260408

5-FILE AGENT CONFIG SURFACE (fork per agent):
- moves.ts
- gate.ts
- stage-machine.ts
- roi.ts
- types.ts

AGENT-AGNOSTIC CORE (reuse untouched):
- brain-do.ts, turn-plan.ts, intel-merge.ts, facts.ts
- engagement.ts, intent.ts, repair.ts, kb.ts
- all packages

Action: Document 5-file surface in CLAUDE.md when Bella ships.
