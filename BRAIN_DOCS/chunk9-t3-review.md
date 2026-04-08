# T3 Chunk 9 Review Findings (Codex CLI)
**D1 ID:** doc-bella-v3-chunk9-t3-review-20260408

3 Codex CLI passes on Chunk 9 (brain-v3).

Gate 1 FAIL: P1 stage/directive desync — directive built before processFlow but plan.stage still read post-advance state.currentStage.

Gate 2 FAIL: resolvedStage incomplete — moveId/isCritical/buildCriticalFacts still used state.currentStage; extraction dispatch also post-advance.

Gate 3 PASS: v1.7.0 all findings fixed.

False-positive override documented: pre-advance TurnPlan ordering is intentional design (Bella responds to current stage, not advanced stage).

Codex model: gpt-5.3-codex.
