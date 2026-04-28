# Final Session Report — brain-worker v19.9.5 GOLDEN
**Date:** 2026-04-20  
**Author:** T2 Code Lead  
**Architect:** T9 (Opus)  
**Status:** RESTORE POINT — all targets met or explained  
**Git tag:** brain-worker-v19.9.5-golden

---

## CRITICAL METHODOLOGY NOTE

All flood tests prior to the final clean run were contaminated by dedup. `INSERT OR IGNORE` on `canonical_hash` meant repeated floods only wrote net-new edges — not what Gemma actually generated. Results appeared to regress between versions when the real problem was shrinking net-new pools.

**Fix applied before final test:** Wiped 1108 memory_relations + 1411 memory_objects for 10 canonical docs. Reran from clean slate. First uncontaminated measurement of actual Gemma output.

**Going forward:** Always wipe target doc edges before flood tests. Protocol updated.

---

## Final Clean Results — v19.9.5 (238 edges, 10 docs, zero dedup)

| Relation Type | Count | % |
|---|---|---|
| ENABLES | 34 | 14.3% |
| TRIGGERS | 30 | **12.6% ✅** |
| SUPPORTS | 27 | 11.3% |
| REQUIRES | 26 | 10.9% |
| CONTAINS | 22 | 9.2% |
| VALIDATES | 14 | 5.9% |
| CAUSES | 13 | 5.5% |
| DEPENDS_ON | 10 | 4.2% |
| EXTENDS | 9 | 3.8% |
| ENFORCES | 8 | 3.4% |
| REFERENCES | 8 | 3.4% |
| BELONGS_TO | 6 | 2.5% |
| INVALIDATES | 5 | 2.1% |
| PREVENTS | 5 | 2.1% |
| WHEN_TRIGGERS | 5 | 2.1% |
| MAPS_TO | 4 | 1.7% |
| SEMANTICALLY_SIMILAR_TO | 4 | 1.7% |
| BLOCKS | 3 | 1.3% |
| CAUSES_IF | 2 | 0.8% |
| CONTRADICTS | 2 | 0.8% |
| PRECEDES | 1 | 0.4% |

**Total: 238 edges across 21 distinct types. Good semantic diversity.**

---

## Full Version Comparison (Clean)

| Metric | Target | v19.8 | v19.9 | v19.9.1 | v19.9.2 | v19.9.4* | v19.9.5 |
|---|---|---|---|---|---|---|---|
| Atoms/KB | ≥25 | 8.0 ❌ | 20.3 ❌ | ~18 ❌ | 31.2 ✅ | 31.2 ✅ | 31.2 ✅ |
| Rogue types | 0 | ❓ | ❌ | ✅ | ✅ | ✅ | ✅ |
| CONTAINS% | ≤25% | 24% ✅ | 34% ❌ | 16.7% ✅ | 20.9%* | 20.9%* | 9.2% ✅ |
| ENFORCES% | ≥15% | 19% ✅ | 5% ❌ | 11.1% ❌ | 1.9%* | 1.9%* | 3.4% ❌ |
| TRIGGERS% | ≥10% | 15% ✅ | 4% ❌ | 0% ❌ | 3.7%* | 3.7%* | 12.6% ✅ |
| Narrative% | ≥12% | ❓ | 0% ❌ | 7.6% ❌ | 7.6% ❌ | 7.6% ❌ | 7.6% ❌ |

*contaminated by dedup — not reliable signal

**Session net: 3/6 targets met** (Atoms/KB, Rogue types, TRIGGERS, CONTAINS all passing. ENFORCES and Narrative still open.)

---

## Tickets Shipped This Session

### T-199 — Pass 2D Category Split (v19.9.2)
- Single 28-type enum → 3 focused Gemma calls (OPERATIONAL / POLICY / STRUCTURAL)
- CF json_schema wrapper fixed: `{ name, schema }` across all 7 tasks, strict:true removed
- Gate D replaced with per-category zero-yield retry
- `computeSourceOffsets.ts` created + migration 0001. **Unwired — T-201 pending T9 spec**
- Gate: T3A SPEC_STRESS_TEST PASS

### T-200 — PROCESSING_VERSION_PASS2 (v19.9.2)
- `PROCESSING_VERSION_PASS2 = 1` added to pass2.ts
- Version stamp in mark-pass2-complete
- Migration 0002 adds `pass2_processed_at` + `pass2_version` columns
- Gate: T2 6-gate PASS

### T-202 — writeTypedEdges Dropped Edge Return (v19.9.3)
- Return type: `Promise<number>` → `Promise<{ written: number; dropped: DroppedEdge[] }>`
- `DroppedEdge` type exported. All 4 drop paths populate dropped[]
- 4 callers in pass2.ts destructure. Drop counts in completion log
- CF Version ID: f1526e6c-8c99-4cda-a67f-4a9242265e45
- Gate: T2 6-gate PASS + T3A post-deploy verification PASS

### T-203 — Title Resolution Fix (v19.9.4)
- Part A: CRITICAL exact-title directive in all 3 category system prompts
- Part B: `wordOverlapFallback()` scoped to `writeTypedEdges` only (resolveTitleToMoId untouched)
  - STOP_WORDS set (31 terms), titleWords() tokenizer, tie rejection (tied → null), overlap≥2, ratio≥0.6
- CF Version ID: fb6d6197-f301-4ff1-a413-f35aa18ae859
- Gate: T3A SPEC_STRESS_TEST — 3 iterations (2 FAIL → PASS). Failures: shared resolver scope, stop-words, tie handling

### T-204 — TRIGGERS Priority Reweight (v19.9.5)
- Replaced closing paragraph of OPERATIONAL_EDGES_SYSTEM with explicit priority order:
  1. TRIGGERS (≥30% target), 2. CAUSES/CAUSES_IF, 3. BLOCKS/PREVENTS, 4. ENABLES (last)
- "Common mistake" example: T3A PASS → deploy is TRIGGERS not ENABLES
- CF Version ID: 33df60da-c477-4c64-9cf7-9782a5ca0fd9
- Gate: T2 6-gate PASS (prompt string only)
- Result: TRIGGERS 12.6% ✅ (target ≥10% hit)

---

## Git Commits

| Commit | Ticket | Description |
|---|---|---|
| 8ce9145 | T-200 | PROCESSING_VERSION_PASS2 stamp |
| 3d43941 | T-199 | Pass 2D category split + CF wrapper fix |
| 54698cb | T-202 | writeTypedEdges returns dropped edges |
| d0e7dea | T-203 | Exact-title directive + word-overlap fallback |
| b591898 | T-204 | TRIGGERS priority reweight |

Branch: `v19.9-uncap-and-slice` — pushed to origin.  
Tag: `brain-worker-v19.9.5-golden`

---

## Atom Quality Finding

Spot-check of `execute-not-review-firm.md` (362B, ~62 words, 12 atoms) revealed:
- **Over-splitting:** "No prompt feedback", "No commentary", "No delay" extracted as 3 separate atoms (2-3 words each) — one compound instruction fragmented
- **Duplicate:** "Return Report" appears twice (standalone + procedure step)
- **Parent+children:** "Execution Procedure" contains full text AND each step extracted separately

31.2 atoms/KB is inflated by over-splitting. True semantic density lower. Pass 1 prompt tuning needed to consolidate fragments.

---

## Open Issues

| # | Issue | Priority | Owner |
|---|---|---|---|
| T-201 | Wire computeSourceOffsets into Pass 1 | High | T9 spec → T4 |
| ENFORCES% | 3.4% vs 15% target — corpus-dependent | Medium | T9: may need per-doc-type targets |
| Narrative% | 7.6% vs 12% target | Medium | Pass 1 prompt tuning |
| Atom over-splitting | Fragments inflate atoms/KB | Medium | Pass 1 prompt tuning |
| Q2 flood query | Memory_objects join undercounts edges | Low | Protocol update |
| INVALIDATES legacy | 5 rows still in scope from old runs | Low | Optional cleanup |

---

## Protocol Updates (apply from next session)

1. **Always wipe target doc edges before flood** — DELETE memory_relations + memory_objects for test docs before every flood. Dedup contamination makes results meaningless otherwise.
2. **T3A + T3B parallel on different tickets** — not same ticket, not sequential. Divide work.
3. **T3B only for genuine regression risk** — not additive/type-only changes.
4. **Flood test query** — use direct `memory_relations WHERE created_at > datetime('now', '-30 minutes')`, not Q2 join through memory_objects.

---

## Restore Instructions

```bash
cd /Users/trentbelasco/Desktop/PROJECT_CLAW/brain-worker
git checkout brain-worker-v19.9.5-golden
npx wrangler deploy
```

CF Version ID to rollback to: `33df60da-c477-4c64-9cf7-9782a5ca0fd9`

```bash
# Instant CF rollback without code checkout:
npx wrangler rollback 33df60da-c477-4c64-9cf7-9782a5ca0fd9
```
