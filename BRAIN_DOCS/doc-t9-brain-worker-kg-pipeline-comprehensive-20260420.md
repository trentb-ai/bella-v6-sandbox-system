# BRAIN-WORKER KG PIPELINE — COMPREHENSIVE STATE REPORT
## Filed: 2026-04-20 AEST | Author: T9 Architect (Opus)
## Scope: brain-worker versions v19.8 through v19.9.4
## D1 ID: doc-t9-brain-worker-kg-pipeline-comprehensive-20260420

---

## EXECUTIVE SUMMARY

The brain-worker knowledge graph pipeline extracts atoms (facts) and edges (relationships) from documents using Gemma 26B via Cloudflare Workers AI. Over 5 versions, atom density improved 4x (8 to 31.2 atoms/KB) but edge distribution regressed — TRIGGERS and ENFORCES types collapsed while ENABLES and CONTAINS dominated. Root causes identified, partial fixes shipped, architectural path forward defined.

---

## VERSION HISTORY — FULL SCORECARD

| Metric | Target | v19.8 | v19.9 | v19.9.1 | v19.9.2 | v19.9.4 |
|---|---|---|---|---|---|---|
| Atoms/KB | >=25 | 8.0 BAD | 20.3 BAD | ~18 BAD | 31.2 GOOD | 31.2 GOOD |
| Rogue types | 0 | unknown | BAD | 0 GOOD | 0 GOOD | 0 GOOD |
| CONTAINS% | <=25% | 24% GOOD | 34% BAD | 16.7% GOOD | 10.5% GOOD | ~29% BAD |
| ENFORCES% | >=15% | 19% GOOD | 5% BAD | 11.1% BAD | 11.1% BAD | 6.5% BAD |
| TRIGGERS% | >=10% | 15% GOOD | 4% BAD | 0% BAD | 5.9% BAD | 5.7% BAD |
| Narrative% | >=12% | unknown | 0% BAD | 7.6% BAD | 7.6% BAD | 7.6% BAD |

Test corpus: 10 canonical docs (procedural, overlay, architectural).

---

## THE CORE TRADE-OFF: DEPTH vs DISTRIBUTION

v19.8 was shallow but balanced. v19.9+ is deep but lopsided.

### Why v19.8 had better distribution
- 8 atoms/KB = ~20-30 atoms per doc
- Simple graph, Gemma could see all relationships
- Single Pass 2D call with all 28 relation types
- Easy for Gemma to find TRIGGERS and ENFORCES with small atom inventories

### Why v19.9+ distribution collapsed
- 31.2 atoms/KB = ~80-100 atoms per doc
- Relationship space explodes combinatorially
- Gemma defaults to easiest, safest edge types (ENABLES, REQUIRES, SUPPORTS, CONTAINS)
- Hard types (TRIGGERS, ENFORCES) require deeper causal reasoning Gemma skips when overwhelmed

### The goal: BOTH high density AND good distribution
v19.8 proves the relationship types ARE extractable from these docs. The system needs to handle higher atom counts without defaulting to easy edges.

---

## ARCHITECTURE — WHAT EXISTS TODAY (v19.9.4)

### Pipeline stages
1. **Pass 1A** — Entity/atom extraction (Gemma 26B). Extracts facts, decisions, rules, procedures from raw docs. Writes to knowledge_atoms table.
2. **Pass 1B** — Additional atom types (if configured)
3. **Pass 2A** — Procedure writer. Identifies multi-step procedures, creates memory_objects + CONTAINS/PRECEDES edges for each step. Hardcoded edge types.
4. **Pass 2B** — Causal chain writer. Identifies causal chains, creates memory_objects + CONTAINS/PRECEDES edges. Hardcoded edge types.
5. **Pass 2C** — Contradiction detector. Finds conflicting atoms. Creates CONTRADICTS edges.
6. **Pass 2D** — Typed edges (3 category passes, added v19.9.1). The main relationship extraction:
   - Operational: TRIGGERS, CAUSES_IF, PREVENTS, ENABLES, BLOCKS, CAUSES
   - Policy: ENFORCES, REQUIRES, VALIDATES, OVERRIDES, MAPS_TO, WHEN_TRIGGERS, RESOLVES_WITH
   - Structural+Knowledge: OWNS, BELONGS_TO, DEPENDS_ON, DELEGATES_TO, ESCALATES_TO, CALLS, READS_FROM, WRITES_TO, INHERITS_FROM, SUPPORTS, EXTENDS, SUPERSEDES, REFERENCES, CONTRADICTS, SEMANTICALLY_SIMILAR_TO
7. **Pass 2E** — Invalidation edges. For decision atoms, identifies conditions that would invalidate them.

### Key files
- `src/workflows/pass2.ts` — orchestrates all Pass 2 tasks, CF wrapper, retry logic
- `src/prompts/pass2d-relations.ts` — 3 category prompts + schemas for typed edges
- `src/jobs/echo-relational-writers.ts` — writes edges to D1. Contains resolveTitleToMoId(), writeTypedEdges(), writeProcedures(), writeCausalChains(), writeContradictions(), writeInvalidationEdges()
- `src/prompts/gemma-constitution.ts` — base system prompt for all Gemma tasks
- `src/workflows/pass1.ts` — atom extraction
- `src/do/scope-coordinator.ts` — orchestrates flood/reprocessing

### Edge resolution mechanism (critical to understand)
writeTypedEdges() at echo-relational-writers.ts:242 processes LLM-generated edges:
1. For each edge, calls resolveTitleToMoId() for source_title and target_title
2. resolveTitleToMoId() tries: exact match on memory_objects -> case-insensitive -> substring -> word-overlap (added v19.9.4)
3. If EITHER title fails to resolve: edge is SILENTLY DROPPED
4. If both resolve: edge written to memory_relations via INSERT OR IGNORE (canonical_hash dedup)
5. Edges batched in groups of 50 per D1 transaction

### Writer contract (in prompts)
The WRITER_CONTRACT block tells Gemma that source_title and target_title must be exact matches from the atom inventory. Gemma frequently ignores this and paraphrases titles, causing resolution failures.

---

## PROBLEMS IDENTIFIED (ordered by severity)

### P0: TRIGGERS generation deficit
- **Status:** DIAGNOSED, FIX IN PROGRESS (v19.9.5 prompt weighting)
- **Root cause:** Gemma prefers ENABLES (safe, passive) over TRIGGERS (specific, event-driven) when atom count is high. With 80-100 atoms, Gemma generated 83 ENABLES but only 20 TRIGGERS from the same operational prompt.
- **Evidence:** v19.8 (low atom count) had 15% TRIGGERS. v19.9.4 (high atom count) has 3.7%. The types are extractable, Gemma just defaults to safer claims.
- **Fix shipped (v19.9.5):** Prompt priority ordering — TRIGGERS first, ENABLES last, with explicit common-mistake example ("T3A PASS enables deploy" is actually TRIGGERS). Target: 30% of operational edges should be TRIGGERS.
- **Fix pending (T2.1):** Gleaning loop — second pass on missed relationships
- **Fix potential:** If prompt weighting insufficient, split operational into TRIGGERS-only sub-pass

### P1: ENFORCES% regression (19% -> 6.5%)
- **Status:** DIAGNOSED, partially doc-type dependent
- **Root cause:** Same Gemma bias — VALIDATES (25 edges) preferred over ENFORCES (10 edges) in policy category. Also: the 10 canonical docs are mostly procedural/overlay, not rule-heavy. 15% target may be unrealistic for this doc mix.
- **Fix:** Same prompt weighting approach as TRIGGERS. Also: evaluate target per doc-type rather than universal.

### P2: CONTAINS% scope-wide inflation (~29%)
- **Status:** DIAGNOSED, NOT a regression
- **Root cause:** CONTAINS edges come from Pass 2A (procedures) and Pass 2B (causal chains), NOT from Pass 2D category split. Every procedure step and chain step emits one CONTAINS edge (hardcoded at echo-relational-writers.ts lines 128-131 and 186-189). This is BY DESIGN (v19.2 fix). 112 CONTAINS edges from 10 docs is expected.
- **Key insight:** Pass 2D CONTAINS = 0% (correctly excluded from enum). Scope-wide CONTAINS% target needs reframing: track Pass 2D CONTAINS separately from structural CONTAINS.
- **No fix needed** — measurement adjustment only

### P3: Narrative% stuck at 7.6% (target 12%)
- **Status:** NOT YET INVESTIGATED
- **Root cause:** Unknown. May be atom-type distribution issue (not enough narrative atoms extracted in Pass 1), or narrative edges not well-defined in the edge taxonomy.
- **Next step:** Investigate what counts as "narrative" in the scoring query

### P4: Title resolution drops (FIXED in v19.9.4)
- **Status:** FIXED
- **Root cause:** Gemma paraphrases atom titles in edge source/target fields. resolveTitleToMoId() exact/substring matching failed.
- **Fix shipped (v19.9.4):** Word-overlap fallback with 60% Jaccard threshold. Rescued ENABLES (+41) and DEPENDS_ON (+34) significantly.
- **Remaining gap:** Some titles still unresolvable. T-202 (writeTypedEdges returns dropped edges) is prep for T2.1 gleaning loop.

### P5: Q2 query artifact — TRIGGERS=0% in join query
- **Status:** DIAGNOSED, fix pending
- **Root cause:** The Q2 scorecard query joins memory_relations to memory_objects. TRIGGERS edges where source atom has no mirrored memory_object are invisible to this join. Direct memory_relations query showed TRIGGERS=111 (not 0).
- **Fix:** Remove or fix the memory_objects join in Q2 protocol query.

---

## FIXES SHIPPED (chronological)

### v19.9.1 — Category-split Pass 2D (ADR-001)
- **What:** Replaced single 28-type Pass 2D call with 3 category-specific calls (Operational, Policy, Structural+Knowledge)
- **Why:** Single call let Gemma gravitate to easy types (REQUIRES, SUPPORTS) and ignore hard ones
- **Result:** 2.4x edge count improvement, CONTAINS fixed (removed from Pass 2D enum), rogue types eliminated
- **ADR:** doc-adr-001-pass2d-category-split-20260420
- **Parallelization:** 3 calls run via Promise.allSettled, total latency ~1x not 3x

### v19.9.2 — CF wrapper fix on all Pass 2 tasks
- **What:** Corrected malformed json_schema wrapper: response_format.json_schema.schema (not response_format.schema)
- **Why:** CF strict mode was not enforcing schema constraints, allowing rogue types
- **Result:** Schema enforcement working, atom density maintained at 31.2/KB

### v19.9.4 — Word-overlap fallback + prompt tightening
- **What:** Added word-overlap matcher (60% Jaccard) to resolveTitleToMoId(). Added CHARACTER-FOR-CHARACTER exact title instruction to all 3 category prompts.
- **Why:** Gemma paraphrases titles causing silent edge drops
- **Result:** ENABLES +41, DEPENDS_ON +34 rescued. TRIGGERS +9 (minimal — generation problem, not resolution)

---

## FIXES IN PROGRESS / PENDING

### T-200: TRIGGERS prompt weighting (v19.9.5)
- **Status:** Spec sent to T2, awaiting implementation
- **What:** Priority ordering in operational prompt (TRIGGERS first, ENABLES last), common-mistake example, 30% target directive
- **Expected impact:** TRIGGERS from 3.7% to >= 10% of operational edges
- **Gate:** Trivial (prompt only), T2 6-gate sufficient

### T-202: writeTypedEdges returns dropped edges
- **Status:** Spec sent to T2, standalone prep ticket
- **What:** Change writeTypedEdges return type from number to { written, dropped[] } with reason codes
- **Why:** Prep for T2.1 gleaning loop — needs dropped edges as input
- **Gate:** Trivial (return type expansion), T2 6-gate sufficient

### T-201: Pass 2 PROCESSING_VERSION (migration 0002)
- **Status:** Spec sent to T2
- **What:** Add pass2_processed_at and pass2_version columns to raw_objects. Independent versioning for Pass 1 and Pass 2 reprocessing.
- **Why:** Currently no way to selectively reprocess Pass 2 when logic changes
- **Gate:** Trivial (D1 migration + ~15 lines)

---

## ARCHITECTURAL DESIGNS PENDING

### T2.1: Gleaning Loop
- **Owner:** T9 designs, T2 specs, T4 implements
- **Status:** Awaiting T-200 flood results before design
- **Purpose:** Second pass over edges that failed title resolution or were missed by initial extraction
- **Shape (preliminary):**
  1. Collect dropped edges from writeTypedEdges (requires T-202)
  2. Attempt resolution with relaxed matching
  3. For remaining unresolved, semantic similarity via Vectorize
  4. Optionally: re-prompt Gemma with explicit atom title list + dropped edge context
- **Key question:** If TRIGGERS prompt weighting works (v19.9.5), gleaning loop may not be needed for distribution. May shift to pure title-resolution recovery.

### T2.3: Orphan Coupling
- **Owner:** T9 designs
- **Status:** Not started, queued after T2.1
- **Purpose:** Connect atoms that have no edges (orphans) to the graph. Currently some atoms exist in knowledge_atoms but have zero memory_relations connections.

### Atom-count-aware prompting
- **Status:** Concept only, not designed
- **Purpose:** When doc has >50 atoms, chunk the atom inventory into smaller windows for edge passes. Prevents Gemma overwhelm that causes distribution collapse.
- **Trigger:** If v19.9.5 prompt weighting doesn't recover TRIGGERS to >= 10%

---

## KEY TABLES (D1 schema)

- **knowledge_atoms** — extracted facts/decisions/rules from Pass 1. Fields: id, raw_object_id, atom_type, title, content, source_offsets, confidence, agent
- **memory_objects** — promoted atoms + procedure/chain objects from Pass 2. Fields: id, scope_id, memory_type, title, summary, content_json, confidence, importance, status, canonical_hash
- **memory_relations** — all edges. Fields: id, scope_id, relation_type, source_memory_object_id, target_memory_object_id, condition_json, confidence, canonical_hash
- **memory_versions** — version history for memory_objects
- **raw_objects** — source documents. Fields: id, project_id, processed_at, processing_version (Pass 1 only currently)

---

## SCORING QUERIES

### Atoms/KB
```sql
SELECT COUNT(*) as atoms, SUM(length(content))/1024.0 as total_kb,
       CAST(COUNT(*) AS FLOAT) / (SUM(length(content))/1024.0) as atoms_per_kb
FROM knowledge_atoms WHERE raw_object_id IN (select id from raw_objects where project_id = ?)
```

### Edge distribution (scope-wide, ALL edges)
```sql
SELECT relation_type, COUNT(*) as cnt,
       ROUND(100.0 * COUNT(*) / (SELECT COUNT(*) FROM memory_relations WHERE scope_id = ?), 1) as pct
FROM memory_relations WHERE scope_id = ?
GROUP BY relation_type ORDER BY cnt DESC
```

### Edge distribution (this run only)
```sql
SELECT relation_type, COUNT(*) as cnt
FROM memory_relations
WHERE created_at > datetime('now', '-1 hour')
GROUP BY relation_type ORDER BY cnt DESC
```

### Direct TRIGGERS count (bypasses Q2 join issue)
```sql
SELECT relation_type, COUNT(*) as cnt
FROM memory_relations
WHERE relation_type IN ('TRIGGERS','CAUSES_IF','PREVENTS','ENABLES','BLOCKS','CAUSES')
GROUP BY relation_type ORDER BY cnt DESC
```

---

## FLOOD TEST PROTOCOL

1. Reset 10 canonical docs (mark as unprocessed)
2. Fire flood via scope-coordinator
3. Wait for completion (~2-5 min for 10 docs)
4. Run scoring queries
5. Compare against targets and previous version
6. File results to D1 + BRAIN_DOCS mirror

---

## LAWS AND CONSTRAINTS

- **Atom Capture Law:** Never lower atom counts, excerpt caps, or edge limits to solve token budget. Solve via chunking/map-reduce.
- **Brain Law:** Never summarize content going into Brain D1. Full content always.
- **Fix-bugs-now Law:** If analysis surfaces a result-degrading bug, fix it in the current sprint.
- **Codex integrity:** All non-trivial changes through T3A SPEC_STRESS_TEST before implementation.
- **PROCESSING_VERSION independence:** Pass 1 and Pass 2 version independently. Bumping one must NOT force re-run of the other.

---

## RELATED DOCS IN D1

- doc-adr-001-pass2d-category-split-20260420 — ADR for category split architecture
- doc-v19.9.1-mvp-triage-plan-20260420-v2 — triage plan with T1.1-T2.3 breakdown
- doc-t9-handover-20260420-session2 — prior session handover
- doc-flood-test-v19.9.2-results-20260420 — v19.9.2 flood test results
- doc-project-coordinates-brain-worker — brain-worker infra coordinates
- doc-t9-bella-diagnostic-sprint-20260420 — Bella MVPScriptBella diagnostic sprint (separate project)

---

## TEAM CONTEXT

- T9 (Architect/Opus) — designed category split (ADR-001), diagnosed TRIGGERS=0%, designed prompt weighting fix, queued T2.1 gleaning loop
- T2 (Code Lead) — implemented v19.9.1-v19.9.4, ran flood tests, filed results
- T3A (Codex Judge) — gates all pre-deploy changes
- T4 (Minion) — executes implementations
- T5 (Minion) — runs health checks, D1 queries

---

## PICKUP INSTRUCTIONS FOR NEXT TEAM

1. Read this doc first
2. Read ADR-001: doc-adr-001-pass2d-category-split-20260420
3. Check if v19.9.5 (TRIGGERS prompt weighting) has been deployed and tested
4. If v19.9.5 shipped: run flood test, check TRIGGERS%. If >= 10%, move to T2.1 gleaning loop design. If still < 10%, escalate to T9 for TRIGGERS-only sub-pass design.
5. Check T-202 status (writeTypedEdges dropped-edge return). If not shipped, ship it before T2.1.
6. Check T-201 status (Pass 2 PROCESSING_VERSION migration). Ship if not done.
7. Q2 query join fix — remove memory_objects join that hides operational edges
8. Narrative% — investigate what counts as narrative in scoring, currently uninvestigated

Priority order: v19.9.5 flood verify -> Q2 query fix -> T-202 -> T-201 -> T2.1 gleaning loop -> T2.3 orphan coupling
