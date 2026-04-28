# Session Report — brain-worker v19.9.2 → v19.9.5
**Date:** 2026-04-20  
**Author:** T2 Code Lead  
**Architect:** T9 (Opus)  
**Scope:** PROJECT_CLAW brain-worker KG pipeline sprint

---

## Git Commits (all on branch v19.9-uncap-and-slice)

| Commit | Ticket | Description |
|---|---|---|
| 8ce9145 | T-200 | PROCESSING_VERSION_PASS2 stamp in pass2 workflow |
| 3d43941 | T-199 | Pass 2D category split + CF wrapper fix + source offsets post-processor |
| 54698cb | T-202 | writeTypedEdges returns dropped edges + drop counters in pass2 log |
| d0e7dea | T-203 | Exact-title CRITICAL directive + word-overlap fallback resolver |
| b591898 | T-204 | TRIGGERS priority reweight in operational prompt (30% target) |

---

## Deployed Versions

| Version | CF Version ID | Key change |
|---|---|---|
| v19.9.2 | (prior session) | Category split, CF wrapper fix |
| v19.9.3 | f1526e6c-8c99-4cda-a67f-4a9242265e45 | T-202: dropped edge visibility |
| v19.9.4 | fb6d6197-f301-4ff1-a413-f35aa18ae859 | T-203: prompt tightening + word-overlap fallback |
| v19.9.5 | pending deploy | T-204: TRIGGERS priority reweight |

---

## Tickets Completed This Session

### T-199: Pass 2D Category Split (v19.9.2)
Split single 28-type enum into 3 focused Gemma calls:
- `OPERATIONAL_EDGES`: TRIGGERS, CAUSES_IF, PREVENTS, ENABLES, BLOCKS, CAUSES
- `POLICY_EDGES`: ENFORCES, REQUIRES, VALIDATES, OVERRIDES, MAPS_TO, WHEN_TRIGGERS, RESOLVES_WITH
- `STRUCTURAL_KNOWLEDGE_EDGES`: OWNS, BELONGS_TO, DEPENDS_ON, DELEGATES_TO, ESCALATES_TO, CALLS, READS_FROM, WRITES_TO, INHERITS_FROM, SUPPORTS, EXTENDS, SUPERSEDES, REFERENCES, CONTRADICTS, SEMANTICALLY_SIMILAR_TO

Also fixed CF json_schema wrapper: `{ name: task.key, schema: task.schema }` across all 7 tasks. Removed strict:true (incompatible with optional properties).

Gate D replaced with per-category zero-yield retry (3 independent retries).

Source offsets post-processor (`computeSourceOffsets.ts`) created + migration `0001_add_source_offset.sql`. **Unwired** — T-201 pending T9 spec for Pass 1 hook point.

### T-200: PROCESSING_VERSION_PASS2 (v19.9.2)
Added `const PROCESSING_VERSION_PASS2 = 1` to pass2.ts. Version stamp in mark-pass2-complete: `UPDATE raw_objects SET pass2_processed_at=datetime('now'), pass2_version=? WHERE id=?`.

Migration `0002_pass2_version_columns.sql` adds `pass2_processed_at TEXT` + `pass2_version INTEGER` to raw_objects.

**Note:** Both migrations (0001 + 0002) confirmed applied to remote D1 (wrangler reported "No migrations to apply" on T4 check — already live).

### T-202: writeTypedEdges Dropped Edge Return (v19.9.3)
`writeTypedEdges` return type changed from `Promise<number>` to `Promise<{ written: number; dropped: DroppedEdge[] }>`.

`DroppedEdge` type exported. All 4 drop paths (missing_fields, no_source, no_target, self_ref) populate `dropped[]`. 4 callers in pass2.ts destructure. Results object gains operationalDropped/policyDropped/structuralDropped. Completion log: `dropped=[op:N pol:N str:N]`.

Gate: T2 6-gate only (additive return type, zero behavior change). T3A post-deploy verified PASS.

### T-203: Title Resolution Fix (v19.9.4)
**Part A:** Added CRITICAL directive to all 3 category system prompts: "source_title and target_title MUST be copied CHARACTER-FOR-CHARACTER from atom inventory. Skip edge rather than approximate title."

**Part B:** Word-overlap fallback scoped to `writeTypedEdges` only (NOT resolveTitleToMoId — shared resolver untouched per T3A FAIL finding). Added `STOP_WORDS` set (31 terms), `titleWords()` tokenizer (`match(/[a-z0-9]+/g)` + length>2 + STOP_WORDS filter), `wordOverlapFallback()` with tie rejection (tied → null), overlap>=2 minimum, ratio>=0.6 threshold.

Fallback tries word-overlap on src/tgt titles after primary resolution fails; on match, calls `resolveTitleToMoId` with exact matched atom title. Console.log on every fallback hit.

Gate: T3A SPEC_STRESS_TEST (3 passes, 2 FAIL → 1 PASS). FAIL reasons: (1) scope too broad (shared resolver), (2) inadequate stop-words, (3) tie handling unsafe.

### T-204: TRIGGERS Priority Reweight (v19.9.5, pending deploy)
Replaced closing paragraph of OPERATIONAL_EDGES_SYSTEM with explicit priority ordering:
1. TRIGGERS (≥30% target), 2. CAUSES/CAUSES_IF, 3. BLOCKS/PREVENTS, 4. ENABLES (last)

Added "common mistake" example: T3A PASS → deploy is TRIGGERS not ENABLES.

Gate: T2 6-gate (prompt string only).

---

## Flood Test Results

### Flood 1 — v19.9.2 (floodId: flood-1776670331705-a70a53)

| Metric | Result | Target | Pass? |
|---|---|---|---|
| Atoms/KB | 31.2 | ≥25 | ✅ |
| Rogue types | 0 | 0 | ✅ |
| CONTAINS% (Q2 join) | 10.5% | ≤25% | ✅ |
| ENFORCES% | 11.1% | ≥15% | ❌ |
| TRIGGERS% | 0% (query artifact) | ≥10% | ❌ |
| Narrative% | 7.6% | ≥12% | ❌ |

249 atoms, 171 edges via Q2 join (undercounts), 1206 tag-accumulated total.

**Critical finding:** Q2 join via memory_objects underestimates operational edges. Direct scope query shows TRIGGERS=111. Query artifact, not pipeline failure.

**Critical finding:** pass2_version=NULL on all docs despite T-200 — migration 0002 not yet applied at flood time. Resolved: T4 applied migrations, confirmed live.

### Flood 2 — v19.9.4 (floodId: flood-1776673165064-162aac)

This-run edges (535 written, 215 net new after dedup):

| Type | This run | % of run |
|---|---|---|
| CONTAINS | 112 | 20.9% |
| ENABLES | 83 | 15.5% |
| TRIGGERS | 20 | 3.7% |
| ENFORCES | 10 | 1.9% |

**Key finding:** CONTAINS=112 sourced from writeProcedures/writeCausalChains (Pass 2A/2B), NOT Pass 2D. By design (v19.2 CONTAINS/PRECEDES emission). CONTAINS% target (≤25%) should be scoped to Pass 2D only — which is 0% CONTAINS. ✅

**Key finding:** TRIGGERS=20 vs ENABLES=83 confirms generation bias, not resolution failure. Word-overlap fallback rescued ENABLES (+41) but TRIGGERS only +9. Root cause: Gemma defaults to weaker enablement claim over direct trigger claim. Fix: T-204 priority reweight.

---

## Issues Filed

| ID | Issue | Status |
|---|---|---|
| ISSUE-1 | pass2_version NULL — migration 0002 not applied | ✅ Fixed (migrations applied) |
| ISSUE-2 | Q2 query underestimates operational edges | Open — protocol update needed |
| ISSUE-3 | CONTAINS% scope target needs reframing | Open — T9 noted structural baseline |
| ISSUE-4 | TRIGGERS% scope 5.9% — generation bias | Addressed by T-204 |
| ISSUE-5 | Narrative% flat 7.6% | Open — Pass 1 prompt work needed |
| ISSUE-6 | FOLLOWS/INVALIDATES legacy rows | Open — historical, won't grow |

---

## Pending Work

| Ticket | Description | Owner | Status |
|---|---|---|---|
| T-201 | Wire computeSourceOffsets into Pass 1 | T4 after T9 spec | Blocked on T9 |
| T-204 deploy | Deploy v19.9.5 + flood | T4 | Next |
| T2.1 | Gleaning loop design | T9 | After T-204 results |
| T2.2 | (per T9 sequence) | T9 | Queued |
| T2.3 | Orphan coupling | T9 | Queued after T2.2 |

---

## Protocol Issues Found

1. **Q2 flood protocol query is broken** — memory_objects join silently drops operational edges. Needs replacement with direct `memory_relations` join to `knowledge_atoms` via `source_document_id`.
2. **T3B used unnecessarily** — T3B dispatched for T-202 VERIFICATION when tsc+additive change made it redundant. Law established: T3B only for genuine regression risk.
3. **T3A/T3B parallelism** — should review DIFFERENT tickets simultaneously, not same ticket. Established going forward.

---

## Key Architecture Insights (T9)

- CONTAINS at scope level dominated by structural emission from Pass 2A/2B (procedure/chain steps). This is correct behavior. Scope-wide CONTAINS% target needs reframing.
- TRIGGERS generation bias is a Gemma model characteristic — enablement is a safer inference than direct causation. Explicit priority ordering + 30% target directive is the correct mitigation before deeper architectural solutions.
- Gleaning loop (T2.1) addresses dropped edges at write time — but won't help if LLM doesn't generate them. T-204 must ship first, validate generation improvement, then T2.1 handles the residual drop problem.
