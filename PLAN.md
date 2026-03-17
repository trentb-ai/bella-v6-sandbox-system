# PLAN.md — Bella V8 Supergod Build
> Source of truth. Only the Orchestrator changes Priority, Status, Owner, ticket order.

## Core Design Principles (FINAL)

### Agent Presentation Rules
- **Present TOP 2 agents**: Full numbers crunch + per-agent ROI reveal
- **Suggest 3rd agent**: Quick power descriptor + "want me to crunch the numbers on that one too?"
  - If YES → run their discovery + ROI → then close
  - If NO → move straight to close
- **All 5 agents are considered suitable** unless prospect is 100% covered (near impossible) — but we only *present* 2 fully
- **Alex + Chris are ALWAYS the priority pair** — default positions 1 and 2
- **Hiring signals can elevate Maddie to #2** (displacing Chris) if receptionist/admin role detected
- ROI is calculated and presented **IMMEDIATELY** after each agent's numbers are crunched
- NOT at the end. Each agent gets their own ROI moment.
- Flow: Numbers Discovery → Crunch → ROI reveal → Next agent → their crunch → their ROI → ...

### Hiring Signal Intelligence (T003 enhancement)
- **Receptionist/admin job listing** → `trigger_maddie = true`, Maddie moves to #1 priority
- **Sales/marketing/BDR job listing** → reinforces `trigger_alex + trigger_chris`
- Bella **MENTIONS the specific role**: "I actually noticed you're hiring for a receptionist on Indeed — that tells us your team is stretched..."
- Apify ad data: Bella quotes **specific campaigns** — "I can see you're running [campaign type] on Facebook right now..."

### Apify Data Usage (The Gold)
- Specific ad campaigns → quoted in opener and ROI context
- Hiring signals → quoted with role name
- Google Maps rating → quoted as "you're sitting at [X] stars with [N] reviews"
- Social media profiles → **Phase 2** (not current build - fast-scrape extracts URLs but no analysis yet)

### Q1 — Hot-Reload (decided)
- On call start: `this.schedule(15, "recheckScriptStages", {})` — Cloudflare native
- If stages arrive late, Bridge re-fetches and continues without resetting current_stage

---

## Definition of Done
- [ ] `shared/kv-schema.ts` contains all V8 canonical keys
- [ ] `bella-tools-worker-v9` uses only canonical keys (zero bare `lead:${lid}` writes)
- [ ] `bella-scrape-workflow-v9` calculates all 5 `trigger_*` flags + hiring role detection
- [ ] `agent_ranking` always leads with Alex/Chris, then reorders by hiring/signal
- [ ] Agent descriptors are in the stage scripts for each agent
- [ ] Per-agent ROI is calculated immediately after each agent's numbers
- [ ] `deepgram-bridge-v9` handles all active stages and "Just Demo" branch
- [ ] ROI calibration: `follow_up_speed` → correct uplift tier (391/200/100/50%)
- [ ] `npx tsc --noEmit` passes on all 5 workers
- [ ] `grep -r "LEADS_KV\.\(get\|put\)(lid" .` returns zero results

---

## Task Backlog

### T001: Update `shared/kv-schema.ts` with V8 Keys
- Priority: P0
- Status: In Progress
- Owner: Agent-T001
- Scope: Add `callBrief`, `fastIntel`, `deepIntel`, `stub` to `kvKey`. Add `callBrief: 14400` to `kvTTL`.
- Acceptance Criteria: File contains all new key functions. `npx tsc --noEmit` passes.
- Validation Steps:
  - `cd shared && npx tsc --noEmit`
  - Verify 4 new key functions exist in `kvKey` object
- Notes:
  Orchestrator notes:
  - Intended approach: Append new key functions to `kvKey` object; add TTL entry
  - Key constraints: Do NOT remove existing keys — backwards compat required
  - Estimated complexity: simple

### T002: Fix `bella-tools-worker-v9` Legacy Keys
- Priority: P0
- Status: Todo
- Owner:
- Dependencies: T001
- Scope: Replace `lead:${lid}` (bare) with `kvKey.callBrief(lid)`. Replace `handoff:${lid}` with `kvKey.handoff(lid)`.
- Acceptance Criteria: `grep "LEADS_KV.put(\`lead:\${lid}\`)" bella-tools*/src/index.ts` → zero results
- Validation Steps:
  - `grep -n "LEADS_KV\.\(get\|put\)(\`lead:\${lid}\`)" bella-tools-worker-v9/src/index.ts`
  - `cd bella-tools-worker-v9 && npx tsc --noEmit`
- Notes:

### T003: Implement `calculateTriggers()` with Hiring Intelligence
- Priority: P0
- Status: Todo
- Owner:
- Dependencies: T001
- Scope:
  - Add all 5 `trigger_*` booleans to `CallBriefFlags`
  - `trigger_alex`: `is_running_ads` OR `speed_to_lead_needed`
  - `trigger_chris`: `is_running_ads && (no_chat || has_legacy_chat || no_booking)`
  - `trigger_maddie`: `(!has_chat && !has_booking)` OR hiring for "receptionist/admin/front desk"
  - `trigger_sarah`: `database_reactivation || business_age_established`
  - `trigger_james`: `review_signals && (rating < 4.5 || review_count < 20)`
  - Extract `hiring_role` from Apify Indeed data for Bella's dialogue
  - Write `apify_highlights` (specific ad campaigns, specific hiring role) to `call_brief`
- Acceptance Criteria: `trigger_*` booleans + `hiring_role` + `apify_highlights` are all present in `call_brief` output
- Validation Steps:
  - Mock test: `{ hiring: { roles: ["receptionist"] }}` → `trigger_maddie === true`
  - `cd bella-scrape-workflow-v9 && npx tsc --noEmit`
- Notes:

### T004: Dynamic `agent_ranking` (Always Alex+Chris First)
- Priority: P0
- Status: Todo
- Owner:
- Dependencies: T003
- Scope:
  - Alex and Chris are ALWAYS positions 0 and 1 (invariant)
  - Maddie at #3 if `trigger_maddie` (especially if hiring for receptionist)
  - Sarah at #4 if `trigger_sarah`; James at #5 if `trigger_james`
  - Add agent descriptor strings to each agent slot for Bella's pitch
- Acceptance Criteria: Any lead produces `agent_ranking[0] === "Alex"`, `agent_ranking[1] === "Chris"`. Descriptors present.
- Validation Steps:
  - `npx tsc --noEmit` in workflow-v9
- Notes:

### T005: 22-Stage Script with Per-Agent ROI
- Priority: P1
- Status: Todo
- Owner:
- Dependencies: T004
- Scope:
  - Stage structure: WOW → Demo Value → ACV → Numbers Invite → [per-agent discovery+ROI loops] → Close
  - Each agent block: [Data Capture Stages] → immediate ROI crunch → reveal → next agent
  - "Just Demo" branch: skip all number stages → go direct to agent demos → close
  - Active/inactive flags: e.g., stages 10-13 (ads discovery) only `active: true` if `trigger_alex`
  - Inject `apify_highlights` into WOW stage scripts (specific campaign names, hiring role)
- Acceptance Criteria: 22 stage keys. Ads stages inactive when `trigger_alex === false`. Per-agent ROI stage present for each agent.
- Validation Steps:
  - Mock test with `trigger_alex: true` → stages 10-13 `active: true`
  - Mock test with `trigger_alex: false` → stages 10-13 `active: false`
  - `npx tsc --noEmit`
- Notes:

### T006: ROI Calibration Engine (Bridge)
- Priority: P1
- Status: Todo
- Owner:
- Dependencies: T005
- Scope:
  - Regex capture `follow_up_speed` at Stage 12
  - Tier mapping: >24h → 391%, 2-24h → 200%, <2h → 100%, <30min → 50% (pivot to Chris)
  - Per-agent ROI calc fires IMMEDIATELY after each agent's number stages complete
  - Write captured inputs to `kvKey.capturedInputs(lid)`
  - Schedule mid-call re-fetch: `this.schedule(15, "recheckScriptStages", {})` at call start
- Acceptance Criteria: `follow_up_speed` captured and correct tier selected. Per-agent ROI fires in correct sequence.
- Notes:

### T007: "Just Demo" Branch Logic (Bridge)
- Priority: P1
- Status: Todo
- Owner:
- Dependencies: T005
- Scope:
  - Detect intent at Numbers Invite stage: "just show me", "skip", "just demo"
  - If detected: `just_demo: true` in DO state, skip all number stages, go to demo sequence
  - Bella's pivot line: "Sure! Let me just show you what this looks like for a business like yours..."
- Acceptance Criteria: "just show me the demo" at Numbers Invite → skips to demo/close sequence
- Notes:

### T008: TypeScript Build Verification (All Workers)
- Priority: P2
- Status: Todo
- Owner:
- Dependencies: T001-T007
- Scope: Zero type errors across all 5 workers. Zero bare lid writes.
- Validation Steps:
  - `for d in bella-scrape-workflow-v9 deepgram-bridge-v9 bella-tools-worker-v9 voice-agent-v9 fast-intel-sandbox; do echo "=== $d ==="; (cd $d && npx tsc --noEmit 2>&1); done`
  - `grep -rn "LEADS_KV\.\(get\|put\)(\`lead:\${lid}\`)" . --include="*.ts" | grep -v ".backup"` → zero
- Notes:

---

## Phase 2 Backlog (Future)
- Social media profile analysis from fast-scrape extracted URLs (Instagram, LinkedIn, Facebook)
- Bella quotes specific social metrics in WOW ("I saw your Instagram — 2.1k followers but no automation on DMs...")

## Discovered Issues Log
| Issue | Ticket | Status |
|-------|--------|--------|
| `fast-intel` writes to `:fast-intel` but schema defines `:intel` | T001 | In Progress |
| Bridge reads 4 fallback keys — fragile | T001 | In Progress |
| `bella-tools` uses bare `lead:${lid}` in handleSaveLeadPatch | T002 | Open |
| `agent_ranking` hardcoded in stub AND main flow | T004 | Open |
| Per-agent ROI not wired — single end-of-call calc only | T005/T006 | Open |
