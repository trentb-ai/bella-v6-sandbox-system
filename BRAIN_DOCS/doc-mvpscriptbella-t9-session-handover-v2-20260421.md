# MVPScriptBella — T9 ARCHITECT SESSION HANDOVER v2
### Filed: 2026-04-21 AEST | Author: T9 Architect (Opus)
### D1 ID: doc-mvpscriptbella-t9-session-handover-v2-20260421
### Purpose: COMPLETE handover for next architect session. Supersedes handover v1 (doc-mvpscriptbella-t9-session-handover-20260421).
### Status: Rev D spec sent to T2. T2 writing implementation spec. T3 gate pending.

---

## READ THESE FIRST (in order)

1. **This doc** — current state, what changed, what's next
2. **BRAIN_DOCS/doc-mvpscriptbella-t9-session-report-bugs-discoveries-20260421.md** — every bug found, CF docs analysis, Cloudflare reference card
3. **BRAIN_DOCS/doc-mvpscriptbella-t9-session-report-evolution-20260421.md** — narrative of how S1 evolved, wrong turns, corrections
4. **BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-d-20260421.md** — the Rev D spec itself (5 changes)

---

## WHAT WE'RE BUILDING (unchanged from v1)

MVPScriptBella = fix Bella's bridge so she delivers the canonical sales script correctly. Option B architecture: port canonical script fresh into bridge inline. Brain DO untouched (except 2 new state storage endpoints).

---

## TRENT'S LOCKED DECISIONS (11 total — 10 from v1 + 1 new)

1-10: Same as v1 handover (Option B, S1+S3 merged, site content post-launch, WOW 6 deeper path, deep-scrape descoped, objections descoped, WORD FOR WORD fidelity, KV-backed agent KB, --- SCRIPT --- markers, unified TURN BEHAVIOR)

11. **DO state storage for script_state** — KV is wrong per CF official docs. Brain DO gets GET/PUT /s1-state endpoints. Bridge reads/writes state via DO RPC. Trent confirmed 2026-04-21.

---

## CURRENT STATE OF S1

### Spec chain (5 revisions, all additive except where noted):

| Rev | Status | What |
|---|---|---|
| Base S1 | ✅ COMPLETE | DELETE/REPLACE/ADD scope. 12 deletions, 14 replacements, new functions. |
| Rev A | ✅ COMPLETE | Supersedes base sections 2F/2G/2I/2J/2M/3E/5. TURN BEHAVIOR, markers, KB, fidelity. |
| Rev B | ✅ COMPLETE | Supersedes base 4B+4D, Rev A 5B. prevStall, KB timing, skip cleanup, stall 6 hold, label fix. |
| Rev C | ✅ COMPLETE | Supersedes Rev B STEP 1 capture block. Removes turns_in_stall guard from capture. |
| Rev D | ✅ SPEC FILED | ADDITIVE. Flag flip, DO state, extract gates, dead code, shadow mode. Sent to T2. |

### Implementation status:

| Item | Status | Owner |
|---|---|---|
| S1 base implementation (stage machine, prompts) | ✅ Implemented by T4 | T4 |
| Rev A/B/C changes | ✅ Implemented by T4 | T4 |
| Rev D Change 1 (USE_DO_BRAIN=false) | ⏳ Pending T2 spec + T3 gate | T4 |
| Rev D Change 2 (DO state endpoints) | ��� Pending T2 spec + T3 gate | T4 |
| Rev D Change 3 (Extract-verified gates) | ⏳ Pending T2 spec + T3 gate | T4 |
| Rev D Change 4 (Dead roi_delivery) | ⏳ Pending T2 spec + T3 gate | T4 |
| Rev D Change 5 (Shadow mode disable) | ⏳ Pending T2 spec + T3 gate | T4 |

### Pipeline right now:
```
Rev D spec (T9) → T2 implementation spec → T3 gate → T4 implements → T2 6-gate → T3 Codex PATCH_REVIEW → Deploy → Canary
```

---

## WHAT CHANGED SINCE v1 HANDOVER

### Bug #1: S1 was unreachable
USE_DO_BRAIN=true in wrangler.toml routes all turns through brain DO path. S1 inline code never executes. Fix: flag flip.

### Bug #2: KV wrong for script_state
CF official docs: KV is eventually consistent, same-location visibility "not guaranteed and not advised to rely on." Negative lookups cached. Script_state is write-every-turn, read-every-turn, must-be-current. Fix: DO state storage endpoints.

### Bug #3: Turn-count-only gates
gateOpen uses `turns_in_stall >= 1` for all stalls. Bella advances on "hmm." Fix: extract-verified gates on stalls 3/6/7/8.

### Bug #4: Shadow mode competing writes
With USE_DO_BRAIN=false, shadow mode still fires DO /turn. Two stage machines running simultaneously. Fix: disable shadow when flag is false.

### Bug #5: Dead roi_delivery
Stage reference that never matches. Fix: delete.

Full details: doc-mvpscriptbella-t9-session-report-bugs-discoveries-20260421.md

---

## MVP STAGE MACHINE FLOW (unchanged)

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

---

## PERSISTENCE ARCHITECTURE (NEW — from this session)

| Data | Storage | Why |
|---|---|---|
| `lead:{lid}:fast-intel` | KV | Written once, read many. Acceptable if stale. |
| `lead:{lid}:conv_memory` | KV | Written per turn, but loss = miss signals, not catastrophic. |
| `s1_script_state` (per DO instance) | DO Storage | Written per turn, read per turn, must be current. CF says DO. |
| `lead:{lid}:captured_inputs` | DEAD | Zero references in brain DO or bridge. Not a concern. |

### DO State Endpoints (new)
- Brain DO: GET /s1-state → `this.state.storage.get('s1_script_state')`
- Brain DO: PUT /s1-state → `this.state.storage.put('s1_script_state', state)`
- Bridge: reads/writes via CALL_BRAIN service binding (already exists)
- State write AWAITED, not fire-and-forget
- No KV fallback (avoid split-brain)

---

## SPRINT PLAN (revised)

| Sprint | What | Size | Status |
|---|---|---|---|
| **S1** | Stage machine + prompts + flag flip + DO state + gates + cleanup | LARGE | Rev D at T2 for implementation spec |
| **S2** | REACT-BRIDGE-DELIVER polish (if S1 canary shows robot delivery) | MEDIUM | Conditional — may not be needed |
| **S3** | Site content injection (page_content.markdown into prompt) | SMALL | Post-launch |
| **S4** | Objection handling (10 handlers from canonical) | MEDIUM | Post-launch |

---

## S1 CANARY CRITERIA (unchanged + additions)

### From v1:
- BELLA_SAID every turn
- WOW 3/4: consultant narratives WORD FOR WORD
- WOW 2: clean skip when no Google rating
- WOW 6: branching works (recommend/deeper)
- Recommendation: correct variant from routing.priority_agents
- Close: day/time not email
- Zero ROI, zero dollar figures, zero "what does your business do?"
- prompt_tokens 2000-3500 range
- Gemini TTFB 3-5s

### Added by this session:
- No [DO_TURN] log tags (DO path not executing)
- [ADVANCE], [STAGE], [BELLA_SAID] tags present (S1 inline path executing)
- No state resets mid-call (DO storage working — no BLANK_STATE fallback after turn 1)
- Stall 3: doesn't advance until ICP confirmed or 3 turns
- Stall 6: doesn't advance until explicit recommend/deeper signal
- Stall 7/8: doesn't advance on "hmm" — needs substantive answer (>10 chars) or 3 turns

---

## ALL SPEC DOCUMENTS (complete index)

### S1 Implementation Spec (5 revisions):
| # | Doc ID | Local Path |
|---|--------|-----------|
| 1 | doc-mvpscriptbella-s1-implementation-spec-20260421 | BRAIN_DOCS/doc-mvpscriptbella-s1-implementation-spec-20260421.md |
| 2 | doc-mvpscriptbella-s1-spec-revision-a-20260421 | BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-a-20260421.md |
| 3 | doc-mvpscriptbella-s1-spec-revision-b-20260421 | BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-b-20260421.md |
| 4 | doc-mvpscriptbella-s1-spec-revision-c-20260421 | BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-c-20260421.md |
| 5 | doc-mvpscriptbella-s1-spec-revision-d-20260421 | BRAIN_DOCS/doc-mvpscriptbella-s1-spec-revision-d-20260421.md |

### Architecture & Context:
| Doc ID | Local Path |
|--------|-----------|
| doc-mvpscriptbella-t9-architectural-plan-final-20260421 | BRAIN_DOCS/doc-mvpscriptbella-t9-architectural-plan-final-20260421.md |
| doc-bella-mvp-script-final-20260420 | BRAIN_DOCS/doc-bella-mvp-script-final-20260420.md |
| doc-bella-architecture-how-it-works-20260420 | BRAIN_DOCS/doc-bella-architecture-how-it-works-20260420.md |
| doc-mvpscriptbella-dual-stage-machine-analysis-20260421 | BRAIN_DOCS/doc-mvpscriptbella-dual-stage-machine-analysis-20260421.md |

### Session Reports (NEW — from this session):
| Doc ID | Local Path | What |
|--------|-----------|------|
| doc-mvpscriptbella-t9-session-report-bugs-discoveries-20260421 | BRAIN_DOCS/doc-mvpscriptbella-t9-session-report-bugs-and-discoveries-20260421.md | Every bug, CF docs analysis, reference card |
| doc-mvpscriptbella-t9-session-report-evolution-20260421 | BRAIN_DOCS/doc-mvpscriptbella-t9-session-report-evolution-20260421.md | Narrative: how S1 evolved, wrong turns, corrections |
| doc-mvpscriptbella-t9-session-handover-v2-20260421 | BRAIN_DOCS/doc-mvpscriptbella-t9-session-handover-v2-20260421.md | THIS DOC — complete handover |

---

## KEY LAWS FOR NEXT ARCHITECT

Everything from v1 handover PLUS:

- **Always verify the execution path.** wrangler.toml flags control which code runs. Check the flag, not just the code.
- **Read CF official docs for persistence decisions.** KV vs DO Storage is not a judgment call — CF tells you which to use for which access pattern.
- **"Usually works" is not an architecture.** For voice calls, you need guarantees. If CF says "not advised to rely on," don't rely on it.
- **Trent's gut is data.** When the founder pushes back on a technical recommendation, verify against primary sources before defending your position.
- **Rev D touches brain DO.** Two storage endpoints only (GET/PUT /s1-state). Does NOT touch moves.ts, ConversationState, or any existing logic. Trent approved this narrow exception to "brain DO untouched."

---

## SHARED BRAIN QUERIES

All docs queryable:
```sql
-- All MVPScriptBella docs
SELECT id, title, updated_at FROM documents WHERE id LIKE 'doc-mvpscriptbella%' ORDER BY updated_at DESC;

-- Session reports from this session
SELECT id, title FROM documents WHERE id LIKE 'doc-mvpscriptbella-t9-session%' ORDER BY id;

-- All S1 spec revisions
SELECT id, title FROM documents WHERE id LIKE 'doc-mvpscriptbella-s1-spec%' ORDER BY id;
```

D1 database: `2001aba8-d651-41c0-9bd0-8d98866b057c`
KV namespace: `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`
