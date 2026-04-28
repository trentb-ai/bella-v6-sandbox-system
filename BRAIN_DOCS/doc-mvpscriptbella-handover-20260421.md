# MVPScriptBella — SESSION HANDOVER
### Date: 2026-04-21 | Outgoing: T9 Architect (Opus) | Authority: Trent Belasco
### Session: Full diagnostic sprint + fix spec

---

## WHAT WE'RE BUILDING

**Bella** is an **inbound website voice AI sales receptionist**. NOT a cold caller.

Flow: Prospect submits details on website funnel → system scrapes their site (~20s) → Bella greets them ON THE WEBSITE with personalised insights → demos Alex/Chris/Maddie tailored to their specific business.

**Active stack:** MVPScriptBella (`~/Desktop/MVPScriptBella/workers/`)
**Reference stack:** NaturalBellaFROZEN (`bella-natural-v1` tag — DO NOT TOUCH)
**KV namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`
**Shared brain D1:** `2001aba8-d651-41c0-9bd0-8d98866b057c`
**Account ID:** `9488d0601315a70cac36f9bd87aa4e82`

**MVP scope:** No ROI delivery. No deep-scrape dependency. Website data + consultant + Google Places only. Value-language recommendations, no dollar figures.

---

## MANDATORY READING — Architecture Reference

**Read these BEFORE doing any work:**

1. `BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md` (D1: `doc-bella-architecture-how-it-works-20260420`) — Full pipeline explanation, what consultant returns, what every WOW stall needs, what "Job Done" looks like, what's descoped for MVP.

2. `BRAIN_DOCS/doc-bella-mvp-script-final-20260420.md` (D1: `doc-bella-mvp-script-final-20260420`) — THE CANONICAL SCRIPT. WOW 1-7 + 4 recommendation variants + close (booking) + 10 objection handlers. This is what Bella MUST say.

3. `BRAIN_DOCS/doc-mvpscriptbella-make-her-sing-diagnostic-20260420.md` (D1: `doc-mvpscriptbella-make-her-sing-diagnostic-20260420`) — Full diagnostic: 18 prompt conflicts, missing site content, REACT-BRIDGE-DELIVER architecture. 7 sections.

4. `BRAIN_DOCS/doc-mvpscriptbella-fix-spec-20260420.md` (D1: `doc-mvpscriptbella-fix-spec-20260420`) — THE FIX SPEC. 5 sprints, concrete before/after code for every change. Ready for implementation.

5. `BRAIN_DOCS/doc-mvpscriptbella-natural-response-architecture-20260420.md` (D1: `doc-mvpscriptbella-natural-response-architecture-20260420`) — REACT-BRIDGE-DELIVER detailed architecture.

6. `BRAIN_DOCS/doc-mvpscriptbella-status-report-20260420.md` (D1: `doc-mvpscriptbella-status-report-20260420`) — Status report from mid-session (before full diagnostic completed).

---

## CURRENT STATE — What's Working, What's Not

### Pipeline: ALL CLEAN ✅
- KV wiring: all 5 workers sharing same namespace ✅
- Service bindings: all normalized to lowercase, deploying clean ✅
- Secrets: GEMINI_API_KEY, FIRECRAWL_API_KEY, GOOGLE_PLACES_API_KEY all set ✅
- Schema: fast-intel writes `lead:{lid}:fast-intel`, bridge reads it — exact match ✅
- Consultant: generates all scriptFills + icpNarrative + convNarrative + routing ✅
- ROI: descoped and unreachable in bridge v9.41.0 → v9.42.0 ✅

### Canary Results (Canary 3 — KPMG, LID: canary3_1776680223)
- 33KB full envelope in KV ✅
- Consultant data fully populated (icpNarrative, convNarrative, routing [Alex, Chris, Maddie]) ✅
- prompt_tokens=2423 (intel reaching bridge prompt) ✅
- google_rating: null (KPMG has no Google Maps local listing — correct behavior)
- BELLA_SAID turn 1: Gemini paraphrased the script instead of delivering verbatim ❌

### Two Core Problems Identified

**PROBLEM 1: Gemini Ignores Scripted Content**
18 instruction conflicts in bridge prompt cause Gemini to paraphrase/rewrite instead of delivering verbatim. Key conflicts:
- XML tag paradox (Rule 1 "no XML" vs Rule 5 "follow DELIVER_THIS XML tags")
- Sanitizer (lines 727-733) strips XML tags + "DELIVER_THIS" from output
- Competing Opener in reference data
- Identity framing ("demonstration") triggers Gemini improv
- 4-sentence max rule truncates scripts > 4 sentences
- Inconsistent markers (DELIVER_THIS vs SAY: vs SAY THIS:)
- Recency bias — script at position 2, competing content at positions 7-8

**PROBLEM 2: Bella Can't Respond Naturally Between Scripted Beats**
No REACT-BRIDGE-DELIVER architecture. Binary: robot (follows script, ignores prospect) or drift (responds naturally, loses script). Also: raw site content never reaches prompt — Bella can't answer questions about prospect's own website.

### ~~Known Issue: Voice-Agent Public URL~~ — RESOLVED (Not a Bug)
`voice-agent/wrangler.toml` line 24 passes `BRIDGE_URL` to Deepgram's external agent API as LLM endpoint. Deepgram calls this from outside CF — NOT same-zone. Public URL is architecturally correct. Sprint 4 DESCOPED after CF docs audit (2026-04-21).

---

## THE FIX SPEC — 5 Sprints

Full before/after code at: `BRAIN_DOCS/doc-mvpscriptbella-fix-spec-20260420.md`

| Sprint | What | Version | Risk |
|--------|------|---------|------|
| **1** | Fix 18 prompt conflicts: replace `<DELIVER_THIS>` with `===SPEAK EXACTLY===` markers, reframe identity from "demonstration" to "consultation", remove 4-sentence rule, rewrite Rule 5, separate FREESTYLE CONTEXT from reference data, remove dead ROI rules, fix audit language, clean Rule 1 | v9.43.0 | Medium |
| **2** | REACT-BRIDGE-DELIVER: add REACT instruction to all stalls, add REDIRECT rule for off-topic handling, add stall_turns safety net (force delivery after 2 turns) | v9.44.0 | Medium |
| **3** | Site content injection: generate condensed `site_knowledge` summary in fast-intel via Gemini Flash, inject into bridge prompt freestyle section | v9.45.0 | Low |
| **4** | ~~Voice-agent service binding~~ — DESCOPED (Deepgram needs public URL) | N/A | N/A |
| **5** | Update stall 1+2 text to match canonical ChatGPT script (can bundle with Sprint 1 or 2) | Bundle | Low |

**Canary after each sprint.** Multi-turn test confirming consultant lines reach Bella's mouth.

---

## KEY TRENT CLARIFICATIONS (from this session — BINDING)

1. **"You play the role of a prospective customer" = INTENDED.** This is the canonical script WOW 1. Bella explains the demo mechanic. NOT a bug, NOT hallucination.

2. **bella_opener STAYS.** Both hardcoded script AND freestyle/improv coexist. Do NOT remove consultant reference data.

3. **Consultant narratives ARE scripted.** icpNarrative, convNarrative, ctaAgentMapping — must be delivered word-for-word. They are NOT freestyle material.

4. **Freestyle = ONLY for reacting to unexpected prospect input** between scripted beats. Also for answering questions from KB or about prospect's website.

5. **The canonical script has HIGH-DATA and LOW-DATA variants.** When consultant data is strong, use it as primary. When weak, fall back to hardcoded variants. Script filed at `doc-bella-mvp-script-final-20260420`.

6. **T9 (Architect) = analysis and design counsel ONLY.** No code edits, no task routing, no orchestration. Architecture, debugging, specs.

---

## WORKER INVENTORY (MVPScriptBella)

| Folder | Deployed Name | Role |
|--------|--------------|------|
| `workers/bridge/` | `mvpscriptbellabridge` | Brain — builds prompt, calls Gemini, stage machine |
| `workers/voice-agent/` | `mvpscriptbellavoice` | WebSocket DO — Deepgram STT/TTS |
| `workers/fast-intel/` | `mvpscriptbellafast-intel` | Pipeline — scrape + consultant + Google Places + KV write |
| `workers/consultant/` | `mvpscriptbellaconsultant` | Gemini Flash analysis of website content |
| `workers/deep-scrape/` | `mvpscriptbellascrape` | Apify workflow (descoped for MVP, stays wired) |
| `workers/brain/` | `mvpscriptbellabrain` | DO brain (wired, not primary for MVP) |
| `workers/tools/` | `mvpscriptbellatools` | Tool handler |

---

## KEY FILE LOCATIONS

| File | What | Key Lines |
|------|------|-----------|
| `bridge/src/index.ts` | THE BRAIN — all prompt logic | 1474 (identity), 1708-1717 (output rules), 1746-1990 (stall directives), 727-733 (sanitizer), 3290-3292 (final prompt assembly) |
| `fast-intel/src/index.ts` | Pipeline + KV writes | 705 (starter fills), 1460 (full envelope), 864 (page_content.markdown) |
| `consultant/worker.js` | 956-line plain JS | 726 (gemini-2.5-flash — actual model), 180 (gemini-2.5-pro — DEAD CODE) |
| `voice-agent/wrangler.toml` | Line 24: public URL (needs service binding fix) | |
| `bridge/wrangler.toml` | Line 20: `ENABLE_EMBEDDING = "true"` (vectors enabled but no data) | |

---

## BRIDGE PROMPT STRUCTURE (What Gemini Receives)

```
SYSTEM MESSAGE:
├── AGENT KNOWLEDGE (Alex, Chris, Maddie, Sarah, James — ~500 chars)
├── ==== MANDATORY SCRIPT — FOLLOW EXACTLY ====
│   └── [stageDirective from buildStageDirective() — with DELIVER_THIS/SAY: tags]
├── ==== END ====
├── BUSINESS: {name} | STAGE: {stage}
├── CONFIRMED INPUTS (grows as prospect answers questions)
├── OUTPUT RULES (V2) — rules 1-9 (CONTAINS THE 18 CONFLICTS)
├── --- REFERENCE DATA (use to inform, do not read aloud) ---
├── EXECUTION RULES (identity, tone, behavior, do-nots)
└── BUSINESS INTEL (hero, website strength, ICP, opener, hooks)

CONVERSATION HISTORY:
└── [user/assistant turns]
```

---

## DOCS CREATED THIS SESSION

| Doc ID | Title | Type |
|--------|-------|------|
| `doc-bella-architecture-how-it-works-20260420` | Full Pipeline Architecture | architecture |
| `doc-bella-mvp-script-final-20260420` | Canonical MVP Script | script |
| `doc-mvpscriptbella-natural-response-architecture-20260420` | REACT-BRIDGE-DELIVER Spec | architecture |
| `doc-mvpscriptbella-status-report-20260420` | Mid-Session Status Report | report |
| `doc-mvpscriptbella-make-her-sing-diagnostic-20260420` | Full Diagnostic (18 conflicts + site content) | diagnostic |
| `doc-mvpscriptbella-fix-spec-20260420` | Fix Spec (5 sprints, before/after code) | spec |
| `doc-mvpscriptbella-handover-20260421` | This handover doc | handover |

All filed to D1 shared brain AND mirrored locally in `BRAIN_DOCS/`.

---

## NEXT STEPS (Priority Order)

1. **Sprint 1** — Fix prompt conflicts. Spec is ready with before/after code. T2 assigns to T4.
2. **Canary** — Multi-turn voice test confirming consultant lines delivered verbatim at stalls 3+5.
3. **Sprint 2** — REACT-BRIDGE-DELIVER if Sprint 1 alone doesn't give enough natural flow.
4. **Sprint 3** — Site content injection for deep knowledge capability.
5. **Sprint 4** — Voice-agent service binding.

---

## TEAM STATUS (as of session end)

| Terminal | Status |
|----------|--------|
| T1 | Stood down by Trent |
| T2 (p1n4ffpi) | Online, has full diagnostic + fix spec, Codex analysis complete |
| T3b (tofyd8sw) | Online, has canonical script, Codex rescue findings delivered |
| T4 (8xauqcg1) | Idle, bridge v9.42.0 deployed, awaiting next TASK_REQUEST |
| T5 (nu9na9qs) | Online, execution standby |
| T9 | This session — architecture + diagnostic + spec |
