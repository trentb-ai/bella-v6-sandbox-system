# V3 REFERENCE DOCUMENTS — From shared-brain D1

**Query Date:** 2026-04-07  
**Source:** shared-brain D1 database  
**Status:** Read-only reference docs

---

## DOCUMENT 1: BELLA V3 COMPLETE SPEC — Master Index

**ID:** doc-bella-v3-spec-index-20260405  
**Title:** BELLA V3 COMPLETE SPEC — Master Index (5 Apr 2026)  
**Doc Type:** index  
**Content Length:** 2917 characters

### Content:

BELLA V3 COMPLETE SPECIFICATION — 4 DOCUMENTS

This index ties together the four documents that form the complete Bella V3 specification. All four must be read together for full context.

DOC 1: INFRASTRUCTURE BLUEPRINT
ID: doc-bella-v2-hybrid-blueprint-20260405
Title: BELLA V2 HYBRID ARCHITECTURE — A-Team Execution Blueprint
Content: Workers, TurnPlan contract, bounded prompt template, memory architecture (Hot/Warm/Cold), 8 infra sprints (HYB-0 through HYB-8), cost projection, A-team session protocol, risk register.

DOC 2: CONVERSATIONAL INTELLIGENCE ADDENDUM
ID: doc-bella-v2-hybrid-intelligence-addendum-20260405
Title: BELLA V2 HYBRID — Conversational Intelligence Addendum
Content: 13 intelligence layers (hybrid freestyle, intent detection, engagement scoring, active listening, memory recall, conversational repair, emotional adaptation, Scribe V2, Stats KB, Three-Tier KB, full data activation, compliance loop, data pipeline integrity), 6 intelligence sprints (INT-1 through INT-6), Phase 2 roadmap (ROI calculator, multi-session memory, Chris build, Command Centre, voice cloning).

DOC 3: MASTER CLAUDE CODE BLUEPRINT
ID: doc-bella-v3-master-cc-blueprint-20260405
Title: BELLA V3 MASTER CLAUDE CODE BLUEPRINT — Perplexity Generated
Content: Monorepo strategy, shared contract packages, harness middleware chain, telemetry schemas + SLOs, D1/R2/Vectorize data model, BugPacket model, replay harness, ML feature capture, gold dataset strategy, 9 execution chunks, incident runbooks, rollout strategy.

DOC 4: OBSERVABILITY + HARNESSING RESEARCH
ID: doc-bella-v3-observability-research-20260405
Title: BELLA V3 — Perplexity Observability + Harnessing + ML Data Capture Research
Content: 8 telemetry event families, per-turn bug packet model, 4 deterministic harness loops, 3-ring compliance, ML feature capture per turn, CF superpower exploitation guide, database strategy.

EXECUTION ORDER FOR A-TEAM:
Start with Doc 3 (master CC blueprint) as the primary execution reference.
Reference Doc 1 for infrastructure details and sprint assertions.
Reference Doc 2 for intelligence layer specifications and TypeScript interfaces.
Reference Doc 4 for observability architecture rationale.

CHUNK EXECUTION ORDER (reordered for startup velocity):
Chunk 0: Monorepo + Contracts (Doc 3)
Chunk 1: Brain TurnPlan Engine (Doc 1 HYB-0 + HYB-2, Doc 2 Layer 1)
Chunk 2: Prompt Worker + Validators (Doc 1 HYB-3, Doc 2 Layer 12)
Chunk 3: Realtime Transport (Doc 1 HYB-1)
Chunk 4: Telemetry Foundation (Doc 3 Chunk 1, Doc 4)
Chunk 5: Extraction Workflow + Scribe V2 (Doc 1 HYB-4, Doc 2 Layer 8)
Chunk 6: Compliance Workflow (Doc 1 HYB-5, Doc 2 Layer 12)
Chunk 7: Intelligence Layers (Doc 2 Layers 2-7, 9-11)
Chunk 8: Data Relay + Late Intel (Doc 2 Layer 13)
Chunk 9: Integration Canary + Choreography (Doc 1 HYB-6, HYB-7)
Chunk 10: Replay + Evals + ML Features (Doc 3 Chunk 8, Doc 4)
Chunk 11: Full Cutover (Doc 1 HYB-8)

---

## DOCUMENT 2: BELLA V2 HYBRID ARCHITECTURE — A-Team Execution Blueprint

**ID:** doc-bella-v2-hybrid-blueprint-20260405  
**Title:** BELLA V2 HYBRID ARCHITECTURE — A-Team Execution Blueprint (5 Apr 2026)  
**Doc Type:** architecture  
**Content Length:** 754 characters

### Content:

Filed as /mnt/user-data/outputs/BELLA_V2_HYBRID_BLUEPRINT.md — full content too large for single D1 INSERT. Reference the markdown file for complete blueprint. Key details: 8 sprints (HYB-0 through HYB-8), 14 day timeline Apr 7-21, 6 new workers (bella-realtime-agent-v3, bella-brain-v3, bella-prompt-v3, bella-extraction-workflow-v3, bella-compliance-workflow-v3, fast-intel-v3-hybrid), TurnPlan contract interface defined, bounded prompt template defined, Hot/Warm/Cold memory architecture, 86 total assertions across sprints, cost delta +$11.36/mo at 500 calls. Depends on: Cloudflare Agents SDK, Workers AI @cf/deepgram/flux STT, @cf/pipecat-ai/smart-turn-v2 turn detection, @cf/deepgram/aura-2-en TTS, Cloudflare Workflows for extraction+compliance.

---

## DOCUMENT 3: BELLA V3 MASTER CLAUDE CODE BLUEPRINT — Perplexity Generated

**ID:** doc-bella-v3-master-cc-blueprint-20260405  
**Title:** BELLA V3 MASTER CLAUDE CODE BLUEPRINT — Perplexity Generated (5 Apr 2026)  
**Doc Type:** architecture  
**Content Length:** 1284 characters

### Content:

Filed as uploaded file bella_v3_master_claude_code_blueprint.md. 1100-line operational execution pack. Key additions beyond our blueprint+addendum: (1) Monorepo strategy with packages/contracts, packages/harness, packages/telemetry, packages/evals, packages/kb, packages/model-adapters, packages/db as shared libraries. (2) Telemetry-first build order — observability before main workers. (3) SLO table: transcript-to-TurnPlan <150ms, prompt-to-first-token <500ms, end-to-end <1200ms, barge-in <100ms. (4) BugPacketV1 interface for per-turn anomaly packets in R2. (5) Replay harness — rerun stored transcripts through brain+prompt+compliance without live audio. (6) Gold dataset strategy (gold-positive, gold-negative, gold-edge) for ML training. (7) 9 execution chunks for CC. (8) D1 schema with calls, call_turns, lead_facts, lead_objections, lead_promises, unanswered_questions, turn_features, quality_scores, model_metrics tables. (9) R2 path conventions. (10) IntelReadyEventV1 for versioned data relay. (11) Incident runbooks. (12) Rollout strategy stages 0-5. (13) Harness middleware chain executeTurnHarness(). (14) Vectorize 5-tier strategy. (15) Model strategy table. References CF Agents SDK, Workflows, Workers observability, OTel export, D1, R2, Vectorize, Deepgram Flux.

---

## SUMMARY

| Document | ID | Length | Status |
|----------|----|---------|---------| 
| V3 Spec Index | doc-bella-v3-spec-index-20260405 | 2917 chars | ✓ Complete |
| V2 Hybrid Blueprint | doc-bella-v2-hybrid-blueprint-20260405 | 754 chars | Reference: external file |
| V3 Master CC Blueprint | doc-bella-v3-master-cc-blueprint-20260405 | 1284 chars | Reference: external file |

**Total content captured:** 4955 characters across 3 documents

**Note:** Documents 2 and 3 reference external markdown files stored in /mnt/user-data/outputs/ and uploaded as bella_v3_master_claude_code_blueprint.md. Full blueprints are available through those references.

**Document 1 (Index)** contains the complete master index and execution order for all V3 specification documents.
