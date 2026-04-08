# Charlie Team Framework — 9-Agent Multi-Model Architecture
**D1 ID:** doc-charlie-team-framework-20260406

## Team Roster (original 9-agent design)
| T | Role | Model | Purpose |
|---|------|-------|---------|
| T0 | EA | Haiku | Comms layer |
| T1 | Orchestrator | Opus | Strategy, architecture, backlog |
| T2 | Code Lead | Sonnet | Technical specs, 6-gate review |
| T3 | Codex Judge | Opus | Sole approval gate, 3-pass |
| T4 | Minion A | Sonnet | Heavy execution |
| T5 | Minion B | Haiku | Light execution |
| T6 | Sentinel | Haiku | Log monitoring |
| T7 | Librarian | Haiku | D1/KV/R2 queries |
| T8 | PM | Sonnet | Task queues, deploy coordination |

## Current (Streamlined): T1+T2+T3+T4+T5 only. Launch: CharlieTeamStreamlined

## Key Design Decisions
1. Author (T2) and Judge (T3) separated — adversarial review can't review own specs.
2. T3 is SOLE PASS authority. T2 can FAIL but not PASS.
3. Signal not noise — T1 sees DEPLOY_BROADCAST and ALERTs only.
4. One project implementation at a time.
5. Deploy broadcast to T1 before every deploy.
6. Battle-tested code over improvised solutions. Always.

## Work Flow
T1 backlog → T2 specs → T4 implements → T2 6-gate → T3 3-pass Codex gate → T2 DEPLOY_BROADCAST → T1 DEPLOY_AUTH → T4 deploys → T5 verifies
