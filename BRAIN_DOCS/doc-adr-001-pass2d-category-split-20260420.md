# ADR-001: Category-Split Pass 2D + Source Offsets Post-Processor

**STATUS:** APPROVED (Trent GREENLIGHT 2026-04-20)
**AUTHOR:** T9 Architect (Opus)
**SCOPE:** brain-worker v19.9.2 — Pass 2D rewrite + source_offsets fix
**D1 ID:** doc-adr-001-pass2d-category-split-20260420

---

## CONTEXT

v19.9.1 deployed category-split Pass 1 (T1.1) successfully — 2.4x edge count, CONTAINS fixed. But Pass 2D still uses a SINGLE Gemma 26B call with 28 free-form relation types. Result: Gemma gravitates to easy types (REQUIRES, SUPPORTS) and ignores hard ones.

Measured regressions:
- TRIGGERS: 0% (was 6.7% in v19.9)
- ENFORCES: 11.1% (was 22.2% in v19.9)
- source_offsets: 0% populated (CF strict mode does not enforce required on nested fields)

Root cause: Free-form enum with 28 options lets Gemma pick favorites. Same pattern T1.1 fixed for Pass 1 atoms.

Additionally, Pass 2D line 184 has the SAME malformed CF json_schema wrapper that T1.1 fixed in Pass 1A/1B.

---

## DECISION

Replace single Pass 2D typed_edges task with 3 category-specific tasks.

### Category 1: OperationalEdges (6 types)
TRIGGERS, CAUSES_IF, PREVENTS, ENABLES, BLOCKS, CAUSES

### Category 2: PolicyEdges (8 types)
ENFORCES, REQUIRES, VALIDATES, OVERRIDES, INVALIDATES, MAPS_TO, WHEN_TRIGGERS, RESOLVES_WITH

### Category 3: StructuralAndKnowledgeEdges (15 types)
OWNS, BELONGS_TO, DEPENDS_ON, DELEGATES_TO, ESCALATES_TO, CALLS, READS_FROM, WRITES_TO, INHERITS_FROM, SUPPORTS, EXTENDS, SUPERSEDES, REFERENCES, CONTRADICTS, SEMANTICALLY_SIMILAR_TO

### Excluded (Pass 2A handles):
CONTAINS, PRECEDES, FOLLOWS

---

## CF WRAPPER FIX

ALL Pass 2 tasks get corrected wrapper:
```
response_format: {
  type: "json_schema",
  json_schema: { name: task.name, schema: task.schema, strict: true }
}
```

---

## T2.0: SOURCE_OFFSETS POST-PROCESSOR

Deterministic TS — zero LLM. `sourceText.indexOf(atom.content.slice(0,80))`. Runs after Pass 1.

---

## GATE D — PER-CATEGORY RETRY

Check each category independently. Retry only the category that returned 0 edges.

---

## FILE CHANGES

- `src/prompts/pass2d-relations.ts` — 3 category exports replace single schema/prompt
- `src/workflows/pass2.ts` — 3 category tasks, CF wrapper fix on ALL tasks, per-category Gate D
- `src/jobs/echo-relational-writers.ts` — UNCHANGED (relation_type-agnostic)

---

## PARALLELIZATION

3 category calls run via Promise.allSettled — total latency ~1x, not 3x.

---

## SUCCESS CRITERIA

- TRIGGERS% >= 10%
- ENFORCES% >= 15%
- CONTAINS from Pass 2D = 0%
- source_offsets > 50% populated
- Total edge count maintained or improved
- No regression in REQUIRES, SUPPORTS, DEPENDS_ON

---

## EXECUTION ROUTE

T9 ADR → ARCH_BRIEF T2 → T2 ticket+spec → T3A SPEC_STRESS_TEST → T4 implement → T3A PATCH_REVIEW → T3B VERIFICATION + REGRESSION_SCAN → deploy
