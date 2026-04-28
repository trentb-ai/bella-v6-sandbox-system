# BELLA MVP — STATUS REPORT
### Filed: 2026-04-20 ~19:00 AEST | Author: T9 Architect
### Sprint: MVPScriptBella Launch Sprint

---

## WHAT'S WORKING (CONFIRMED BY CANARY 3)

| Component | Status | Evidence |
|-----------|--------|----------|
| Fast-intel pipeline | ✅ | 33KB full envelope in KV, 19.8s duration |
| Consultant worker | ✅ | All scriptFills populated, icpNarrative + convNarrative + routing all present |
| Service bindings | ✅ | All normalized to lowercase, deploying clean |
| KV writes | ✅ | Full envelope at `lead:{lid}:fast-intel` |
| Bridge reads KV | ✅ | prompt_tokens=2423 confirms intel reaching prompt |
| Routing | ✅ | priority_agents: [Alex, Chris, Maddie] |
| ROI descoped | ✅ | Bridge v9.41.0 deployed with ROI unreachable |
| GOOGLE_PLACES_API_KEY | ✅ | Set on fast-intel (KPMG has no listing so returns null — correct) |

---

## WHAT'S BROKEN (TWO ISSUES IDENTIFIED)

### Issue 1: Gemini Not Following DELIVER_THIS Verbatim

**Evidence:**
- Stall 1 DELIVER_THIS says: "Now Trent, I think you'll be impressed. We've done some research on KPMG Australia..."
- Bella SAID: "So Trent, your pre-trained KPMG agents are ready to go. You play the role of a prospective customer..."

**Root cause:** Gemini reads system prompt identity ("running a personalised AI Agent demonstration") and rewrites the DELIVER_THIS content to match that framing. Output Rule 5 says "word-for-word" but Gemini ignores it.

**Impact:** Even though consultant lines are in KV and wired into stage directives, we can't confirm Bella speaks them faithfully at stalls 3+.

**Fix specced:** Strengthen Output Rule 5 enforcement language. If that fails → REACT-BRIDGE-DELIVER architecture.

### Issue 2: Bella Can't Respond Naturally to Prospect Input

**Evidence:** Current architecture is binary — either verbatim script (robot) or Gemini freestyles (loses script). No middle ground.

**What's needed:** Bella should acknowledge what the prospect said naturally (1-2 sentences), bridge back, then deliver script content.

**Fix specced:** REACT-BRIDGE-DELIVER three-part turn structure. Full architecture doc filed: `doc-bella-natural-response-architecture-20260420`

---

## BRIDGE CODE vs CANONICAL SCRIPT — GAP ANALYSIS

The ChatGPT-refined script (filed as `doc-bella-mvp-script-final-20260420`) differs from bridge hardcoded text:

| Stall | Bridge Code Says | Script Says | Gap |
|-------|-----------------|-------------|-----|
| 1 | "Now {fn}, I think you'll be impressed. We've done some research..." | "So {name}, your pre-trained {business} agents are ready to go. You play the role..." | DIFFERENT — bridge has old text |
| 2 | "Oh {fn}, I noticed {biz} has a {rating}-star reputation..." + "during this demo" | "I noticed {business} is sitting on {rating} stars..." + "activate that today" | Similar intent, different wording |
| 3 | Uses icpNarrative from consultant (correct) | Uses {consultantICPLine} (same thing) | ✅ Aligned |
| 4 | "That's exactly the kind of business intelligence we've used to pre-train your AI team..." | Not in script (script has WOW 5 = alignment bridge) | Numbering mismatch |
| 5 | Uses convNarrative from consultant (correct) | Uses {consultantConversionLine} (same thing) | ✅ Aligned |
| 6-8 | Audit transition → lead source → hiring | Script: alignment bridge → explore/recommend → source check | Structural difference |
| 9 | Provisional rec (2 agents) | Full 3-agent recommendation with close | MAJOR gap — script has full close |
| Post-9 | Goes to anchor_acv → channels → ROI (descoped) | Goes to close (booking) | MAJOR gap — entirely different flow |

**Key finding:** Stalls 3 and 5 (consultant-driven) are aligned. Stalls 1, 2, 6-9 and post-WOW flow need updating to match canonical script.

---

## WHAT BELLA_OPENER IS (RESOLVED)

- Consultant generates `bella_opener` in scriptFills
- It's a greeting alternative — NOT used in bridge
- Trent direction: REMOVE IT. It confuses everyone. Stall 1 hardcoded greeting is the intended opening.
- Action: Remove bella_opener from consultant output + fast-intel KV writes

---

## IMMEDIATE NEXT STEPS (Priority Order)

1. **Test verbatim compliance** — Strengthen output rule 5, deploy, run multi-turn canary to stall 3+. Confirm consultant icpNarrative reaches Bella's mouth.
2. **If still paraphrasing** — Implement REACT-BRIDGE-DELIVER architecture
3. **Update stall 1 text** — Match canonical ChatGPT script ("your pre-trained agents are ready to go...")
4. **Update post-WOW flow** — Replace ROI channels with recommendation → close (booking)
5. **Remove bella_opener** — From consultant + fast-intel
6. **Multi-turn voice canary** — Full 7-stall test confirming consultant lines delivered

---

## DOCS FILED THIS SESSION

| Doc ID | Title | Location |
|--------|-------|----------|
| doc-bella-mvp-script-final-20260420 | Canonical MVP Script | D1 + BRAIN_DOCS |
| doc-bella-natural-response-architecture-20260420 | REACT-BRIDGE-DELIVER spec | D1 + BRAIN_DOCS |
| doc-bella-architecture-how-it-works-20260420 | Full pipeline architecture | D1 + BRAIN_DOCS |
| doc-t9-bella-diagnostic-sprint-20260420 | Diagnostic sprint (prior session) | D1 + BRAIN_DOCS |
| This doc | Status report | D1 + BRAIN_DOCS |

---

## TEAM COMMS SENT

- T2 briefed on: consultant data confirmed in KV, Gemini verbatim issue, REACT-BRIDGE-DELIVER direction
- T2 has spec for output rule 5 fix (first test)
- Architecture doc referenced in TEAM_PROTOCOL.md startup sequence
