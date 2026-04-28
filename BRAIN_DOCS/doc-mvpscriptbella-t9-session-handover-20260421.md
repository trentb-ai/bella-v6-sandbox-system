# MVPScriptBella — T9 ARCHITECT SESSION HANDOVER
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### Purpose: Complete handover for next architect session. Everything needed to continue MVPScriptBella.
### Status: S1 spec complete (3 docs), at T3 for re-gate after fixing P0/P1 findings.

---

## WHAT WE'RE BUILDING

MVPScriptBella = fix Bella's bridge so she delivers the canonical sales script correctly. The problem isn't the pipeline (verified clean) or Gemini (capable) — it's the bridge's `buildStageDirective()` function feeding Gemini wrong content from an old stage machine (10 stalls, channels, ROI) instead of the canonical script (7 WOW stalls, recommend, close).

**Option B architecture:** Port canonical script fresh into bridge inline. Brain DO untouched. Bridge stays self-contained conversation engine. Brain's moves.ts is REFERENCE only — not imported.

---

## THE CORE PROBLEM (TWO STAGE MACHINES)

Brain DO (`workers/brain/moves.ts`): wow_1→wow_7, structured StageDirective objects, 361 tests. NOT what drives Gemini.

Bridge (`workers/bridge/src/index.ts` inline): 10 stalls with channels/ROI/deep-scrape stages. IS what drives Gemini. IS what the prospect hears. WRONG.

Fix: Replace bridge's stage machine with canonical script flow. Delete ~450 lines of old code. Add ~300 lines of canonical flow. Net reduction in complexity.

Full analysis: `doc-mvpscriptbella-dual-stage-machine-analysis-20260421`

---

## TRENT'S LOCKED DECISIONS (10 total)

1. **Option B** — port canonical script into bridge, brain DO untouched
2. **S1 + S3 merged** — stage machine + prompt fixes in one sprint
3. **Site content blob = post-launch** (S4)
4. **WOW 6 deeper path** = source check + funnel Qs before recommend
5. **Deep-scrape descoped** — personalisedaidemofinal-sandbox stays (DO NOT TOUCH)
6. **Objections descoped** for MVP
7. **Script fidelity = WORD FOR WORD** for BOTH hardcoded AND consultant lines. Improvisation ONLY outside SCRIPT markers.
8. **Agent KB = KV-backed** at `bella:agent_kb`, hardcoded fallback
9. **Markers: `--- SCRIPT ---` / `--- END SCRIPT ---`** (not ===SPEAK EXACTLY=== which triggers robot mode)
10. **Unified TURN BEHAVIOR rule** — one instruction block, no competing systems

---

## MVP STAGE MACHINE FLOW

```
wow_1 (Research Intro)
  → wow_2 (Reputation Trial — SKIP if no Google rating)
  → wow_3 (ICP — consultant icpNarrative WORD FOR WORD)
  → wow_4 (Conversion/CTA — consultant conversionNarrative WORD FOR WORD)
  → wow_5 (Alignment Bridge)
  → wow_6 (Explore or Recommend — prospect chooses)
      ├── "recommend" → recommend stage → close → done
      └── "deeper"   → wow_7 (Source Check) → stall 8 (Funnel Qs) → recommend → close → done
```

4 recommendation variants selected by `routing.priority_agents`: all3, alex_chris, alex_maddie, alex_only.

Close = book 20-minute onboarding call. NOT email.

---

## PROMPT ARCHITECTURE (how Gemini gets instructions)

ONE unified system, not competing rules:

1. **TURN BEHAVIOR block** (global, in system prompt):
   - REACT naturally to prospect (1-2 sentences)
   - DELIVER script content WORD FOR WORD
   - If off-script → answer from KB/freestyle → bridge back to script
   - Improvisation ONLY outside `--- SCRIPT ---` markers

2. **`--- SCRIPT ---` / `--- END SCRIPT ---` markers** (per-stall):
   - Every stall returns script inside these markers
   - Gemini delivers content faithfully without robotic repetition

3. **AGENT KNOWLEDGE** (KV-backed):
   - Alex/Chris/Maddie capabilities, trial pricing, onboarding
   - Read from `bella:agent_kb` on first turn, cached on state
   - Hardcoded fallback if KV empty

4. **FREESTYLE CONTEXT** (consultant data):
   - bella_opener, conversationHooks, website_positive_comment
   - For REACT portions only — never instead of script

---

## SPRINT PLAN

| Sprint | What | Size | Status |
|--------|------|------|--------|
| **S1** | Stage machine restructure + prompt fixes + KB | LARGE | **SPEC COMPLETE — at T3 re-gate** |
| **S2** | REACT-BRIDGE-DELIVER polish (if S1 canary shows robot delivery) | MEDIUM | May not be needed |
| **S3** | Site content injection (page_content.markdown into prompt) | SMALL | Post-launch |
| **S4** | Objection handling (10 handlers from canonical) | MEDIUM | Post-launch |

**S1 is the big one.** Gets correct content flowing to Gemini. After S1 canary, Bella should speak canonical script with consultant data landing word for word.

### S1 Scope Summary:
- DELETE: old buildStageDirective (10 stalls), gateOpen, advance, buildQueue, rebuildFutureQueueOnLateLoad, calcAgentROI, runCalcs, Inputs interface, channel stages, ROI stages, dead stalls 4/8/9
- ADD: new buildStageDirective (7 WOW + recommend + close), new gateOpen, new advance, resolveRoutingVariant, TURN BEHAVIOR block, AGENT KNOWLEDGE block, simplified State
- FIX: identity line, output rules, sanitizer, artifact detector, freestyle context separation

### S1 Canary Criteria:
- BELLA_SAID every turn
- WOW 3/4: consultant narratives WORD FOR WORD
- WOW 2: clean skip when no Google rating
- WOW 6: branching works (recommend/deeper)
- Recommendation: correct variant from routing.priority_agents
- Close: day/time not email
- Zero ROI, zero dollar figures, zero "what does your business do?"
- prompt_tokens 2000-3500 range
- Gemini TTFB 3-5s

---

## ALL SPEC DOCUMENTS (read as a set)

### S1 Implementation Spec (3 documents — read in order):

| # | Doc ID | Local Path | What |
|---|--------|-----------|------|
| 1 | `doc-mvpscriptbella-s1-implementation-spec-20260421` | `BRAIN_DOCS/doc-mvpscriptbella-s1-implementation-spec-20260421.md` | Base S1 spec. DELETE scope (12 items), REPLACE scope (14 items), ADD scope (new functions), WIRING, VERIFY, CANARY. |
| 2 | `doc-mvpscriptbella-s1-spec-revision-a-20260421` | `BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-a-20260421.md` | Supersedes S1 sections 2F, 2G, 2I, 2J, 2M, 3E markers, Section 5. Unified TURN BEHAVIOR, --- SCRIPT --- markers, KV-backed KB, WORD FOR WORD fidelity for all script. |
| 3 | `doc-mvpscriptbella-s1-spec-revision-b-20260421` | `BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-b-20260421.md` | Supersedes S1 sections 4B+4D, Revision A section 5B. Fixes T3 findings: prevStall capture ordering, KB read before increment, [SKIP] dead code removal, stall 6 hold policy, stall label fix. |

**Supersession chain:** Start with base S1. Revision A overrides specific sections. Revision B overrides specific sections of both. Everything not explicitly superseded in A/B stands as written in the base.

### Architecture & Context Docs:

| Doc ID | Local Path | What |
|--------|-----------|------|
| `doc-mvpscriptbella-t9-architectural-plan-final-20260421` | `BRAIN_DOCS/doc-mvpscriptbella-t9-architectural-plan-final-20260421.md` | **MASTER PLAN.** All 10 Trent decisions, MVP stage machine, WOW stall specs, recommendation routing, prompt architecture, sprint plan, risk register, invalidation criteria. Updated with Revision A decisions. |
| `doc-bella-mvp-script-final-20260420` | `BRAIN_DOCS/doc-bella-mvp-script-final-20260420.md` | **CANONICAL SCRIPT.** THE authority. 264 lines. WOW 1-7, 4 recommendation variants, close, objection handlers (descoped for MVP), design principles. Every word Bella speaks comes from this doc. |
| `doc-bella-architecture-how-it-works-20260420` | `BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md` | Full pipeline architecture. How fast-intel, consultant, bridge, voice-agent connect. Service bindings map. |
| `doc-mvpscriptbella-dual-stage-machine-analysis-20260421` | `BRAIN_DOCS/doc-mvpscriptbella-dual-stage-machine-analysis-20260421.md` | T2 deep analysis of brain vs bridge stage machines. Why they diverge. Option A/B/C comparison. |
| `doc-mvpscriptbella-t2-architect-briefing-20260421` | `BRAIN_DOCS/doc-mvpscriptbella-t2-architect-briefing-20260421.md` | T2's briefing: what canonical script says, what bridge implements, structural mismatch table, what's missing from old fix spec. |
| `doc-mvpscriptbella-make-her-sing-diagnostic-20260420` | `BRAIN_DOCS/doc-mvpscriptbella-make-her-sing-diagnostic-20260420.md` | 18 prompt conflicts + pipeline status. Section 2 (the 18 conflicts) is most useful — all addressed in S1. |
| `doc-mvpscriptbella-natural-response-architecture-20260420` | `BRAIN_DOCS/doc-mvpscriptbella-natural-response-architecture-20260420.md` | REACT-BRIDGE-DELIVER concept. Valid concepts, rigid 3-step structure killed. Replaced by unified TURN BEHAVIOR. |
| `doc-mvpscriptbella-t9-revised-plan-with-t2-review-20260421` | `BRAIN_DOCS/doc-mvpscriptbella-t9-revised-plan-with-t2-review-20260421.md` | Earlier plan draft with T2 review comments. SUPERSEDED by final plan but useful for T2's inline notes. |

### All docs exist in BOTH D1 shared brain AND local BRAIN_DOCS/.

---

## TARGET FILE

`workers/bridge/src/index.ts` (~3340 lines)

Key locations (verify before acting — lines may shift):
- buildStageDirective: ~1746-2209 (DELETE + REPLACE)
- gateOpen: ~557-574 (DELETE + REPLACE)
- advance: ~578-598 (DELETE + REPLACE)
- buildQueue: ~447-498 (DELETE)
- rebuildFutureQueueOnLateLoad: ~501-515 (DELETE)
- calcAgentROI: ~673-718 (DELETE)
- runCalcs: ~605-665 (DELETE)
- Stage type: ~368-371 (REPLACE)
- State interface: ~398-423 (REPLACE)
- Inputs interface: ~376-396 (DELETE)
- buildFullSystemContext: ~1423-1610 (MODIFY — add TURN BEHAVIOR, KB, freestyle separation)
- buildTurnPrompt: ~1612-1738 (MODIFY — remove ROI, add confirmed section, stage label)
- Identity line: ~1474 (REPLACE)
- Output rules: ~1707-1717 (REPLACE/DELETE)
- Sanitizer: ~725-771 (MODIFY — add new markers)
- Artifact detector: ~773-776 (MODIFY — add new markers)

---

## WHAT'S NEXT

### Immediate:
1. T3 re-gates S1 spec (base + Revision A + Revision B)
2. T3 PASS → T4 implements from spec
3. T2 6-gate review
4. T3 Codex review (PATCH_REVIEW)
5. Deploy v9.43.0
6. Full canary against criteria

### After S1 ships:
- If Bella sounds robotic → S2 (REACT-BRIDGE-DELIVER polish)
- If Bella works well → skip to S3 (site content) or S4 (objections) based on Trent priority

### Post-MVP:
- Option C (shared module) — extract stage machine into shared package, both brain and bridge import
- Site content blob injection
- Objection handling (10 handlers + universal recovery)
- Website blob for off-script answers

---

## KEY LAWS FOR NEXT ARCHITECT

- Bella is INBOUND website agent, NOT cold caller
- Consultant narratives = SCRIPT, not context. WORD FOR WORD.
- bella_opener STAYS — freestyle fuel for REACT, not script
- "Up to 4x more conversions" is the ONLY benchmark stat
- NO dollar figures, NO calculated ROI, NO "conservative estimate"
- personalisedaidemofinal-sandbox: DO NOT TOUCH. Ever. Any version, any file.
- Brain DO: untouched for MVP. Reference only.
- NaturalBella FROZEN: reference for data wiring patterns ONLY, not prompt strategy
- T9 direction needs Trent confirm before execution

---

## SHARED BRAIN QUERIES

All docs queryable via D1:
```sql
SELECT id, title, updated_at FROM documents WHERE id LIKE 'doc-mvpscriptbella%' ORDER BY updated_at DESC;
```

D1 database ID: `2001aba8-d651-41c0-9bd0-8d98866b057c`
KV namespace: `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`
KB key: `bella:agent_kb`
