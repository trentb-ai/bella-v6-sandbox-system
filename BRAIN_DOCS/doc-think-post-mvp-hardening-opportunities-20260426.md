# THINK POST-MVP HARDENING — Unexploited Feature Opportunities
**Doc ID:** doc-think-post-mvp-hardening-opportunities-20260426
**Date:** 2026-04-26 AEST
**Author:** T9 Architect (Opus)
**Status:** CAPTURED — not spec'd, not scheduled. Ready for sprint candidacy post-launch.
**Source:** Cloudflare Agents Week 2026 GA feature set mapped against Bella Think Agent V1 build plan.

---

## OPPORTUNITY 1: Dynamic Workers for ROI Calculation Engine

### What Shipped (GA)
Dynamic Workers — sandboxed code execution inside Cloudflare's edge runtime:
- LLM-generated JavaScript executes in isolated V8 isolate
- Millisecond startup, no cold boot
- 100x faster + fraction of cost vs containers
- $0 idle — charges actual execution ms only
- Capability model: no ambient authority, explicit grants per binding
- Agent writes code → executes in sandbox → returns result
- npm support: agent writes `import { z } from "zod"` and it works (esbuild bundles)
- Cloudflare's own MCP server uses this pattern for 99.9% token reduction

### Current Bella ROI Architecture (Chunk 4 plan)
ROIAgent extends Agent<Env> with @callable methods:
- `calculate(agent, inputs)` — hardcoded switch/case over 5 agents (Alex, Chris, Maddie, Sarah, James)
- Each agent has a fixed formula: tiers lookup, percentage multipliers, ACV division
- Industry-agnostic — same formula for dental practice and construction company
- Adding a new agent or industry = code change + deploy cycle
- Trent directive: ROI must be "overengineered, highly sophisticated, flexible, easy to change"

### Opportunity
Replace hardcoded ROI formulas with Dynamic Worker execution:

1. **Formula Library in R2** — store industry-specific ROI formulas as JavaScript modules
   - `roi-formulas/dental.js` — dental-specific conversion rates, ACV norms, seasonal adjustments
   - `roi-formulas/legal.js` — legal intake patterns, retainer vs one-off, referral multipliers
   - `roi-formulas/trades.js` — job value variance, seasonal demand, quote-to-close rates
   - `roi-formulas/carpet-cleaning.js` — repeat customer value, geographic density, upsell rates
   - `roi-formulas/default.js` — current generic formulas as fallback

2. **Dynamic Formula Generation** — when ConsultantAgent identifies an industry with no existing formula:
   - Gemini generates an industry-specific ROI formula based on consultant intel
   - Formula executes in Dynamic Worker sandbox (safe — no network, no ambient authority)
   - If result is sensible (passes sanity checks), formula is persisted to R2 for reuse
   - If result is nonsensical, falls back to default.js

3. **Runtime Formula Patching** — Trent or a future admin agent can:
   - Upload new formula modules to R2 without redeploying any worker
   - A/B test formula variants per industry
   - Override specific agent calculations without touching ROIAgent code

### Why This Matches Trent's Directive
- **Overengineered:** Industry-specific formulas, auto-generated, self-improving
- **Highly sophisticated:** LLM generates calculation logic from real business intelligence
- **Flexible:** New industry = new R2 file, no redeploy
- **Easy to change:** Trent uploads a .js file, done

### What We Know (from current codebase)
- ROIAgent already isolated as Agent<Env> sub-agent with @callable interface
- 5 agent formulas exist in roi-agent.ts (Alex, Chris, Maddie, Sarah, James)
- V2 ROI formulas documented in `BRAIN_DOCS/doc-bella-roi-quote-machine-architecture-t9-20260426.md`
- Industry quoting architecture (carpet/dental/legal/trade) already designed in ROI+Quote blueprint
- R2 bucket `bella-audit-v3` exists — could add `roi-formulas/` prefix or dedicated bucket

### Execution Ladder Mapping
- T0 Workspace: store formula drafts in DO SQLite during generation
- T1 Dynamic Worker: execute the formula in sandboxed V8 — THIS IS THE KEY TIER
- No need for T2-T4 (npm/browser/sandbox) for ROI calculation

### Dependencies
- ROI sub-agent (Chunk 4) must ship first with hardcoded formulas
- Dynamic Workers SDK availability (GA as of Agents Week)
- R2 formula storage setup
- Sanity check framework for generated formulas (bounds checking, not-negative, reasonable magnitude)

### Risk
- Generated formulas could produce hallucinated numbers → mitigated by sanity checks + default fallback
- Formula quality depends on Gemini understanding industry economics → mitigated by human-curated formulas for top 10 industries, generation only for long tail
- Adds complexity to ROI pipeline → mitigated by keeping current hardcoded path as fallback, Dynamic Worker is additive

### Estimated Effort
Medium-high. 2-3 sprints:
- Sprint A: R2 formula storage + loader + Dynamic Worker execution harness
- Sprint B: Formula generation pipeline (Gemini → validate → persist)
- Sprint C: Admin interface (formula upload, A/B, override)

---

## OPPORTUNITY 2: Tree-Structured Sessions for Quote Branching

### What Shipped (GA)
Think persistent sessions with tree-structured messages:
- Messages stored with `parent_id` — forms a tree, not a flat list
- Native forking: branch conversation at any point
- Parallel exploration: multiple branches active simultaneously
- Built into Think's Session class — message persistence, compaction, search all tree-aware

### Current Bella Architecture (Chunk 7 plan)
Build plan Chunk 7 = "compaction + recovery + branching":
- Quote A/B branching: prospect explores two quote options
- Currently planned as manual state management — state flags, conditional prompt sections
- Compliance recovery branching: when compliance violation detected, branch to recovery flow then rejoin main
- All hand-rolled on top of flat conversation history

### Opportunity
Use Think's native tree-structured sessions instead of manual branch management:

1. **Quote A/B Branching**
   - When Bella presents two quote options, fork the conversation
   - Branch A: explore Quote A details, objection handling, customization
   - Branch B: explore Quote B details, different pricing structure
   - Prospect's responses naturally flow into the chosen branch
   - Unchosen branch preserved — prospect can say "actually go back to the other option"
   - No manual state flags, no "which_quote_active" tracking — it's structural

2. **Compliance Recovery**
   - Compliance violation detected → fork from current point
   - Recovery branch: compliance remediation conversation
   - On recovery complete: continue from fork point with clean state
   - Main branch preserved — if recovery was false positive, resume exactly where we were
   - Audit trail: the fork itself IS the compliance event record

3. **Agent Demo Branching**
   - Bella demos Alex, then prospect wants to hear about Chris
   - Instead of losing Alex context: fork at the transition point
   - Chris branch gets fresh demo context
   - If prospect says "what was that thing Alex does?" — the Alex branch is intact, referenceable
   - Currently: all agent demos happen in flat sequence, earlier context gets compacted away

### What We Know (from SDK)
- Session imported from `agents/experimental/memory/session`
- Messages have tree structure with parent_id
- Think's `_runInferenceLoop` uses `this.session.getHistory()` — returns lineage from current branch
- `compactAfter()` is tree-aware — compacts within branch, preserves fork points
- Session class has forking primitives (need T5 to verify exact API from source)

### Why This Is Better Than Manual
- **No state pollution** — branches are isolated, no "reset these 15 flags" between transitions
- **Audit trail for free** — compliance forks, quote explorations all preserved structurally
- **Compaction is branch-local** — exploring Quote B doesn't compact away Quote A context
- **Resumption is trivial** — switch branch pointer, Think handles the rest
- **Memory scales** — each branch has its own message chain, no exponential context growth from "remembering all paths"

### Dependencies
- Chunk 7 (compaction + recovery) is the natural landing zone
- Need T5 verification of Session fork/branch API from `node_modules/agents/experimental/memory/session/`
- Must confirm compaction is branch-aware (likely but unverified)
- Must confirm Think's inference loop respects branch selection in getHistory()

### Risk
- `agents/experimental/memory/session` — "experimental" in the path. API may change.
- Branching adds conversation tree complexity — need clear UX for "go back to other option"
- Branch proliferation if not pruned — prospect explores 5 options = 5 branches in DO SQLite
- Voice UX for branching is uncharted — how does Bella verbally signal "let's explore option B"

### Estimated Effort
Medium. 1-2 sprints within Chunk 7:
- Sprint A: Verify fork API, prototype quote A/B branching
- Sprint B: Compliance recovery branching, branch pruning, UX patterns

---

## OPPORTUNITY 3: Self-Authored Extensions (ExtensionManager)

### What Shipped (GA)
Think ExtensionManager:
- Extensions = tool definitions written at runtime, persisted in DO storage
- Agent can author new tools during conversation based on what it learns
- Extensions survive DO eviction — reloaded from storage on recovery
- Sandboxed execution via Dynamic Workers
- Load order determines hook execution priority

### Current Bella Status
Deferred P3 in build plan. No current usage.

### Opportunity
Prospect-specific tool generation during the call:

1. **Industry Tools** — when Bella identifies the prospect's industry, generate tools specific to that vertical
   - Dental: `calculateChairUtilization(chairs, hoursPerDay, avgAppointmentLength)`
   - Legal: `estimateIntakeCapacity(currentParalegals, avgCaseLoad)`
   - Trades: `calculateJobSchedulingGap(currentJobs, avgDuration, drivingTime)`

2. **Prospect-Specific Calculators** — based on data the prospect shares
   - "I have 3 locations" → generate multi-location ROI aggregation tool
   - "We do $50K wedding packages" → generate high-ACV conversion value tool
   - "Our busy season is December-February" → generate seasonal adjustment tool

3. **Demo Customization** — tools that make the demo feel bespoke
   - Tool that pulls the prospect's actual Google reviews and formats them
   - Tool that generates a mock "what your AI agent would say" based on their real website copy
   - Tool that calculates their specific cost-per-lead from their stated ad spend

### Why This Is Powerful
- Every prospect gets a demo that feels built FOR them, not shown TO them
- Tools persist — if prospect calls back, their custom tools are still there
- Compounds with Dynamic Workers — generated tools execute safely in sandbox
- Differentiator: no competitor's demo agent generates custom calculators mid-call

### Dependencies
- ExtensionManager (available in @cloudflare/think@0.4.0)
- Dynamic Workers for safe execution
- Gemini prompt engineering for tool generation
- Validation framework: generated tool must type-check, produce bounded output, not error

### Risk
- Tool generation latency during a live voice call — may need to be async (generate between turns)
- Generated tool quality varies — need fallback to manual calculation
- Debugging generated tools is harder than static ones
- Security: even sandboxed, generated code needs output validation

### Estimated Effort
High. 3-4 sprints:
- Sprint A: ExtensionManager wiring, basic tool authoring from template
- Sprint B: Dynamic Worker execution for authored tools
- Sprint C: Industry tool templates, generation pipeline
- Sprint D: Prospect-specific calculator generation, persistence, reuse

---

## OPPORTUNITY 4: Stream Resumption for Native WebSocket

### What Shipped (GA)
Think stream resumption:
- Client disconnects mid-stream → reconnects → resumes from where it left off
- No lost tokens, no repeated content
- Built into Think's WebSocket handler
- Resumable stream state persisted in DO

### Current Bella Status
Not used. Bella uses HTTP/SSE via compat-turn endpoint (V2 bridge adapter). No native WebSocket client.

### Opportunity
When Bella moves to native WebSocket (post-launch, when @cloudflare/voice ships or when we build native frontend):
- Mobile users on flaky connections get seamless experience
- No "sorry can you repeat that" after a network blip
- Bella continues mid-sentence after reconnect
- Critical for real-world deployment where prospects are on mobile/wifi

### Dependencies
- Native WebSocket frontend (replaces compat-turn bridge adapter)
- @cloudflare/voice or equivalent real-time audio over WebSocket
- Frontend stream resumption client code

### Risk
- Low risk — it's built in, just not wired up
- Audio stream resumption is harder than text — may need audio-specific handling

### Estimated Effort
Low. Falls out naturally when frontend moves to native WebSocket. ~1 sprint to verify + test.

---

## PRIORITY RANKING

| # | Opportunity | Impact | Effort | When |
|---|---|---|---|---|
| 1 | Tree-structured sessions (Quote branching) | HIGH — eliminates manual state management for branching | Medium | Chunk 7 (already planned) |
| 2 | Dynamic Workers for ROI | HIGH — "overengineered" per Trent, industry-specific | Medium-High | Post Chunk 4 |
| 3 | Self-authored extensions | VERY HIGH — competitive differentiator | High | Post-launch |
| 4 | Stream resumption | MEDIUM — UX quality for mobile | Low | Post-launch with native WebSocket |

---

## FILING STATUS

- [x] Local mirror: BRAIN_DOCS/doc-think-post-mvp-hardening-opportunities-20260426.md
- [ ] D1 filing: PENDING — Cloudflare MCP disconnected. File on reconnect as doc-think-post-mvp-hardening-opportunities-20260426
