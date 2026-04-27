# CODEX REQUEST CONTRACT

## Purpose
This document defines the standard request and response format for Codex tasks.

The goal is to make Codex:
- easy to route
- easy to compare
- easy to audit
- hard to misuse

## Request Contract
Every Codex request must use this structure.

```text
CODEX_TASK
Mode:
Checkpoint:
Ticket_or_Chunk:
Primary_question:
Reason_for_routing:

Files_or_Boundaries_in_Scope:
- 

Evidence_pack:
- observed_behavior:
- expected_behavior:
- reproduction_notes:
- diff_or_patch_summary:
- tests_run:
- logs_traces_or_artifacts:
- strongest_current_belief:
- strongest_uncertainty:
- proof_gap:

Requested_effort: low | medium | high
High_effort_approval: YES | NO | N/A
Requested_output_emphasis:
