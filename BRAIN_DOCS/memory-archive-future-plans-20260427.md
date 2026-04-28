# MEMORY ARCHIVE — Future Plans + Parked State
**Created:** 2026-04-27 AEST | **Purpose:** Token efficiency trim — all entries below parked here, not deleted.
**To restore:** Copy any entry back into MEMORY.md index + verify the .md file still exists.

---

## V3 CHUNK PLAN (on hold 2026-04-10 — may resume post-launch)

- [BELLA V3 Chunk Execution Plan](project_bella_v3_chunk_plan.md) — 12-chunk build plan. Critical path: 0→1→3→9→11. Working dir: ~/Desktop/BELLA_V2_HYBRID/bella-v3/. All 8 Brain D1 docs confirmed present.
- [V3 build status](project_v3_build_status.md) — Chunks 0-8B deployed. 68/68 tests passing. Chunk 9 (integration canary) in progress.
- [V3 git baseline](project_v3_git_baseline.md) — Commit 7032414, tag bella-v3-c8b-baseline (2026-04-07). 115 files, 68 tests. Restore: git checkout bella-v3-c8b-baseline.
- [Adapter Layer Wiring](project_adapter_layer_wiring.md) — V2→V3 protocol translator. Bridge sends V2 format, brain-v3 expects V3. Add /turn-v2-compat endpoint (~30 lines). Git checkpoint f137326. CRITICAL blocker for Bella audio.
- [Chunk 10D scope](project_chunk10d_scope.md) — improvisationBand + allowFreestyle wiring into buildUserMessage() is MANDATORY. No descope. 4-5 sprints — needs full scoping session.
- [Chunk 10D — 5 Sprint Plan](project_10d_sprint_plan.md) — Full sprint plan: 5→1→2→3→4. Sprint 5 done. Sources: doc-bella-deterministic-extract-source-20260407 + doc-kb-architecture-full-spec-20260331.
- [Chunk 9 + 10D state (2026-04-08)](project_chunk9_state.md) — Full working tree state: v1.19.1 C9 fixes at T3b, v1.19.2 P0+P1 in flight, Sprint 5 done. Laws, gate routing, ONE CLEAN COMMIT plan.
- [Chunk 12B pre-flight](project_chunk12b_preflight.md) — Run sqlite_master table check against bella-data-v3 BEFORE Chunk 12B-2 starts. Full plan: doc-bella-v3-chunk12b-execution-plan-20260407 in D1.
- [Pre-cutover tag](project_pre_cutover_tag.md) — Tag bella-v3-pre-cutover required before Chunk 11. Trigger: v1.14.4 deployed + T5 health pass. Tag + D1 doc + BRAIN_DOCS mirror all required.

---

## POST-LAUNCH ROADMAP (not active sprints — revisit after launch)

- [Bella accents & personality](project_bella_accents_personality.md) — Post-launch: romantic accents, flirty/playful personality modes, chatty receptionist variants
- [Bella freestyle + knowledge base](project_bella_freestyle_knowledgebase.md) — Bella too scripted, needs Gemini freestyle ability + business knowledge base for Chris
- [Bella hybrid freestyle architecture](project_bella_hybrid_freestyle.md) — Consultant scripts as primary + guidance+context for off-script freestyle
- [AutoResearch Loop Spec](project_autoresearch_loop.md) — Karpathy-style autonomous test→fix→retest loop. Auto-fix mechanical bugs, escalate architectural to Trent.
- [Think post-MVP hardening](project_think_post_mvp_hardening.md) — 4 opportunities: tree sessions (Chunk 7), Dynamic Workers ROI (post C4), self-authored extensions (post-launch), stream resumption (post-launch).

---

## ASAP / FUTURE INFRA (not yet scheduled)

- [Cloudflare Flux STT](project_cloudflare_flux_stt.md) — Edge-native STT via @cf/deepgram/flux. Sub-800ms latency. Hybrid: CF STT + Deepgram TTS. ASAP.
- [nano-claude-code](project_nano_claude_code.md) — Minimal Claude Code for CF Workers + Railway Ollama. Coding engine for all agent teams. ASAP.

---

## STALE SESSION / SPRINT STATE (history, not active)

- [MVPScriptBella sprint state](project_mvpscriptbella_sprint_state.md) — Pipeline clean, 18 prompt conflicts found, 5-sprint fix spec ready. Bella_opener stays, consultant = scripted, freestyle = react only.
- [Bella V8 Hybrid Architecture — APPROVED](project_bella_v8_hybrid_architecture.md) — Keep V2-rescript audio (Deepgram) + V8 brain/workflows. Kill realtime-agent-v8 + CF Workers AI audio.
- [Bella V8 Session 2026-04-06](project_v8_session_20260406.md) — V8 workers deployed, audio pipeline broken, recovery plan: restore Deepgram audio layer. Git: d4ac5f6 baseline, 731a29a latest.
- [v6.16.1 Epic Debug Sprint](project_v6161_session_results.md) — 8 bugs fixed, script quality 5.7→9/10, all canaries passed
- [Natural Bella Plan](project_natural_bella_plan.md) — 3-tier plan to fix mechanical scripting. Plan file: NATURAL_BELLA_PLAN.md
- [Autonomous session 2026-04-04](project_autonomous_session_20260404.md) — Trent on break, mechanical fixes only, full report on return
- [Autonomous progress log](project_autonomous_progress_log.md) — Running log of all work done while Trent away. 23 issues found, Codex review in progress.
