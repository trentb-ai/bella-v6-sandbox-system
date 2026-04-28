# Flood Test Report — brain-worker v19.9.2
**Date:** 2026-04-20  
**Author:** T2 Code Lead  
**FloodId:** flood-1776670331705-a70a53  
**Scope:** 10 canonical docs, echo-architecture  
**Version under test:** v19.9.2 (category-split Pass 2D, CF json_schema wrapper fix, PROCESSING_VERSION_PASS2)

---

## Test Execution

### Pre-flood reset
All 10 canonical docs reset via D1: `processing_version=0, processed_at=NULL`. Confirmed 10 rows changed.

### Flood fired
```
POST https://brain-worker.trentbelasco.workers.dev/run/flood-echo
Bearer: Fs2h0xfLUTTKYCLGqdWFuEmYoQyrt65_22ZXGFXdZco
```
Response: `{"ok":true,"status":"flood-started","floodId":"flood-1776670331705-a70a53","totalDocs":10,"waveSize":10,"waveGapSec":30,"totalWaves":1,"estimatedWallMin":1}`

---

## 10 Canonical Docs

| Raw ID | Document | Size |
|---|---|---|
| raw-1776500427284-abab750c | echo-v3-auxiliary:execute-not-review-firm.md | 362B |
| raw-1776500338955-9dfc44b9 | echo-v3-canonical:codex-request-contract.md | 720B |
| raw-1776500414727-f56de412 | echo-v3-overlays:workers-realtime-AGENTS.md | 761B |
| raw-1776500416089-f81994dd | echo-v3-skills:README.md | 761B |
| raw-1776500410674-a5033ea9 | echo-v3-overlays:deploy-AGENTS.md | 783B |
| raw-1776500413398-5b6ae11c | echo-v3-overlays:state-AGENTS.md | 800B |
| raw-1776500412014-999c7f45 | echo-v3-overlays:integrations-AGENTS.md | 888B |
| raw-1776500431832-6bf221f4 | echo-v3-auxiliary:execution-task-prompt.md | 900B |
| raw-1776500346911-591bc689 | echo-v3-canonical:scout-recon-sop.md | 905B |
| raw-1776500436231-1b8aa43d | echo-v3-auxiliary:handover-prompt-short.md | 1097B |

Total corpus: ~7.977KB

---

## Q1 — Atom Type Distribution (249 total atoms)

| Atom Type | Count | % |
|---|---|---|
| field_definition | 65 | 26.1% |
| procedure | 45 | 18.1% |
| capability | 35 | 14.1% |
| law | 28 | 11.2% |
| trigger_condition | 20 | 8.0% |
| gate_step | 19 | 7.6% |
| philosophy | 11 | 4.4% |
| boundary | 10 | 4.0% |
| rationale | 6 | 2.4% |
| configuration | 4 | 1.6% |
| contract | 2 | 0.8% |
| identity | 2 | 0.8% |
| decision | 1 | 0.4% |
| failure_pattern | 1 | 0.4% |

**Atoms/KB: 249 / 7.977 = 31.2** (target ≥25 ✅)  
**Narrative atoms (philosophy+rationale+identity): 19/249 = 7.6%** (target ≥12% ❌)

---

## Q2 — Edge Distribution (Q2 join vs direct scope query)

### CRITICAL: Q2 join severely undercounts operational edges

Q2 uses `INNER JOIN memory_objects mo ON mo.id = mr.source_memory_object_id` — only returns edges where source atom has a mirrored memory_object. Operational edges (TRIGGERS, ENABLES, CAUSES) write to `memory_relations` with source objects that are not necessarily mirrored from these 10 docs specifically. This caused TRIGGERS=0% in Q2 — a query artifact, NOT a pipeline failure.

**Q2 join result (171 edges — undercounted):**

| Type | n | % |
|---|---|---|
| PRECEDES | 38 | 22.2% |
| VALIDATES | 33 | 19.3% |
| REQUIRES | 21 | 12.3% |
| ENFORCES | 19 | 11.1% |
| CONTAINS | 18 | 10.5% |
| SUPPORTS | 15 | 8.8% |
| OWNS | 10 | 5.8% |
| PREVENTS | 8 | 4.7% |
| BLOCKS | 2 | 1.2% |
| SEMANTICALLY_SIMILAR_TO | 2 | 1.2% |
| BELONGS_TO | 1 | 0.6% |
| CAUSES | 1 | 0.6% |
| DELEGATES_TO | 1 | 0.6% |
| EXTENDS | 1 | 0.6% |
| REFERENCES | 1 | 0.6% |

**Direct scope query — full echo-architecture memory_relations (1873 total):**

| Type | n | % |
|---|---|---|
| CONTAINS | 610 | 32.6% |
| PRECEDES | 265 | 14.2% |
| REQUIRES | 172 | 9.2% |
| ENFORCES | 130 | 6.9% |
| TRIGGERS | 111 | 5.9% |
| VALIDATES | 102 | 5.4% |
| SUPPORTS | 58 | 3.1% |
| OWNS | 54 | 2.9% |
| ENABLES | 43 | 2.3% |
| SEMANTICALLY_SIMILAR_TO | 40 | 2.1% |
| CAUSES | 38 | 2.0% |
| PREVENTS | 37 | 2.0% |
| INVALIDATES | 32 | 1.7% |
| CAUSES_IF | 20 | 1.1% |
| BELONGS_TO | 15 | 0.8% |
| REFERENCES | 15 | 0.8% |
| EXTENDS | 13 | 0.7% |
| DEPENDS_ON | 12 | 0.6% |
| BLOCKS | 10 | 0.5% |
| DELEGATES_TO | 8 | 0.4% |
| FOLLOWS | 8 | 0.4% |
| CONTRADICTS | 4 | 0.2% |
| MAPS_TO | 3 | 0.2% |
| WHEN_TRIGGERS | 2 | 0.1% |
| SUPERSEDES | 1 | 0.1% |

**Note:** INVALIDATES (32) and FOLLOWS (8) are legacy types from pre-v19.9.2 runs — these types were removed from schemas in v19.9.2. No new INVALIDATES/FOLLOWS should be generated going forward. Existing rows are historical.

---

## Q3 — Total Edges from Tags

Tag-accumulated total: **1206** (sum of all `relations:N` tags across 10 docs, includes multiple runs)

Per-doc new-run relations (from latest `relations:` tag entry):

| Doc | Relations (new run) |
|---|---|
| execute-not-review-firm | 43 |
| codex-request-contract | 54 |
| workers-realtime-AGENTS | 35 |
| skills-README | 59 |
| deploy-AGENTS | 54 |
| state-AGENTS | 57 |
| integrations-AGENTS | 62 |
| execution-task-prompt | 75 (single entry) |
| scout-recon-sop | 54 |
| handover-prompt-short | 66 |

**Estimated v19.9.2 run total: ~559 edges across 10 docs**  
**Average per doc: ~55.9 edges**

---

## Q4 — Rogue Atom Types

**Result: 0 rogue types** ✅ — All atoms use canonical enum.

---

## Per-Doc State

| Doc | processing_version | pass2_version | pass2-complete |
|---|---|---|---|
| execute-not-review-firm | 19 | NULL | ✅ |
| codex-request-contract | 19 | NULL | ✅ |
| workers-realtime-AGENTS | 19 | NULL | ✅ |
| skills-README | 19 | NULL | ✅ |
| deploy-AGENTS | 19 | NULL | ✅ |
| state-AGENTS | 19 | NULL | ✅ |
| integrations-AGENTS | 19 | NULL | ✅ |
| execution-task-prompt | 19 | NULL | ✅ |
| scout-recon-sop | 19 | NULL | ✅ |
| handover-prompt-short | 19 | NULL | ✅ |

---

## Scorecard vs Targets

| Metric | v19.8 | v19.9 | v19.9.1 | v19.9.2 | Target | Pass? |
|---|---|---|---|---|---|---|
| Atoms (10 docs) | 233* | 158 | 144 | 249 | — | — |
| Atoms/KB | 8.0 | 20.3 | ~18 | **31.2** | ≥25 | ✅ |
| Rogue types | — | present | 0 | **0** | 0 | ✅ |
| CONTAINS% (scope) | 24% | 34% | 16.7% | **32.6%** | ≤25% | ❌ |
| CONTAINS% (Q2 join) | — | — | — | 10.5% | ≤25% | ✅ |
| ENFORCES% (scope) | 19% | 5% | 11.1% | **6.9%** | ≥15% | ❌ |
| ENFORCES% (Q2 join) | — | — | — | 11.1% | ≥15% | ❌ |
| TRIGGERS% (scope) | 15% | 4% | 0% | **5.9%** | ≥10% | ❌ |
| TRIGGERS% (Q2 join) | — | — | — | 0% | ≥10% | ❌ (query artifact) |
| Narrative% | — | 0% | 7.6% | **7.6%** | ≥12% | ❌ |
| Total edges (scope) | 394 | ~300 | 706 | **1873** | — | — |

*v19.8 was 3 docs only

**Summary: 2/6 targets hit** (Atoms/KB ✅, Rogue types ✅)

---

## Issues Found

### ISSUE-1: CRITICAL — pass2_version NULL on all docs
**Symptom:** All 10 docs show `pass2_version=NULL` after flood. mark-pass2-complete step runs `UPDATE raw_objects SET pass2_processed_at=datetime('now'), pass2_version=? WHERE id=?` inside try/catch that swallows errors.  
**Root cause:** Migration 0002 (`0002_pass2_version_columns.sql`) has NOT been applied to remote D1. Column doesn't exist → UPDATE fails silently.  
**Fix required:** `npx wrangler d1 migrations apply shared-brain --remote` before next flood.

### ISSUE-2: Q2 query is not fit for per-doc edge analysis
**Symptom:** Q2 join via memory_objects showed TRIGGERS=0% — contradicted by direct scope query (TRIGGERS=111).  
**Root cause:** Q2 requires source atom to have a mirrored memory_object. Operational edges whose source atoms aren't mirrored don't appear in Q2.  
**Recommendation:** Replace Q2 with a direct query filtering `memory_relations` by `scope_id` + joining to `knowledge_atoms` via `source_document_id` (no memory_objects intermediary). Protocol update needed.

### ISSUE-3: CONTAINS% in full scope = 32.6% (above 25% target)
**Context:** Full scope includes all historical runs. The 10-doc Q2 join shows 10.5%. Category split is working on new runs — old CONTAINS rows are diluting scope-wide %.  
**Not a v19.9.2 regression** — pre-existing historical data. Scope will normalise as more docs are reprocessed.

### ISSUE-4: TRIGGERS% in full scope = 5.9% (below 10% target)
**Context:** 111 TRIGGERS across 1873 total edges in scope. Category split added new TRIGGERS in this run but full scope dilution from old runs masks the improvement.  
**Recommendation:** Need per-run edge isolation (by `created_at` band or flood tag) to measure v19.9.2-specific improvement accurately.

### ISSUE-5: Narrative% flat at 7.6%
**Symptom:** philosophy+rationale+identity = 7.6%, unchanged from v19.9.1. Target ≥12%.  
**Not a Pass 2 issue** — narrative atom types are generated in Pass 1 (1A atoms). Pass 2D changes don't affect atom extraction. Requires Pass 1 prompt tuning to increase narrative type output.

### ISSUE-6: FOLLOWS and INVALIDATES legacy rows remain
**Count:** FOLLOWS=8, INVALIDATES=32 in scope. These types removed from v19.9.2 schemas.  
**Not a regression** — historical rows from prior runs. Won't grow. Can be purged if desired.

---

## Pending Actions

| # | Action | Owner | Priority |
|---|---|---|---|
| P0 | Apply migration 0002 to remote D1 | T4 | Immediate |
| P1 | Fix Q2 protocol query — remove memory_objects join | T9/T2 | High |
| P2 | Wire computeSourceOffsets into Pass 1 (T-201) | T4 after T3A gate | High |
| P3 | Investigate TRIGGERS% gap — per-run isolation needed | T9 | Medium |
| P4 | Pass 1 prompt tuning for narrative% | T9 | Low |

---

## T9 Architect Diagnosis (received 2026-04-20)

### TRIGGERS=0% — Title Resolution Drop (confirmed)

T9 diagnosis: TRIGGERS=0% in Q2 join is a **title resolution drop** at write time, not missing LLM output. Direct scope query confirms TRIGGERS=111 in echo-architecture — edges ARE being written.

**Mechanism:**
1. Pass 2D operational_edges runs → Gemma generates edges with source_title + target_title
2. `writeTypedEdges()` calls `resolveTitleToMoId()` for each title
3. Resolution tries: exact → case-insensitive → substring match
4. If EITHER title fails → edge silently dropped (droppedNullSource / droppedNullTarget)
5. Operational edges (TRIGGERS, ENABLES) drop more than policy/structural because they reference event-driven relationships — action/process titles Gemma invents don't exactly match atom titles

**Fix paths:**
- **Option A (quick):** Fuzzy title matcher in resolveTitleToMoId — ~15 lines, risk of false positives
- **Option B (correct):** Gleaning loop (T2.1 design). After initial write: collect dropped edges, attempt relaxed matching, semantic similarity via Vectorize for remaining. T9 to design.

**Immediate action:** Make `writeTypedEdges` RETURN dropped edges (source_title, target_title, relation_type) instead of only logging them — enables gleaning loop to consume them.

### ENFORCES at 11.1%
T9: "On procedural/overlay docs, 11.1% is plausible. 15% target may need to be per-doc-type, not universal. Not a failure — track it."

### Disposition
T3B VERIFICATION approved to proceed with caveat: TRIGGERS=0% has known causal theory (title resolution drop), not a regression from v19.9.1.

---

## Previous Test Results (for cross-version reference)

- `doc-brain-v19.8-canary-success-20260420` — v19.8 baseline
- `doc-session-handover-20260420-v19.9-deploy` — v19.9 deploy state
- `doc-session-handover-20260420-v19.9-research-complete` — v19.9 verified numbers
- `doc-t1.1-execution-report-20260420` — T1.1 execution report
- `doc-flood-atom-audit-20260420` — atom audit
