# BELLA V6 — KV SCHEMA ALIGNMENT MISSION BRIEF
**For Claude Code — Read this entire document before touching a single file.**

---

## YOUR MANDATE

The LEADS_KV namespace is structurally broken. Multiple workers write/read with inconsistent key names, producing phantom reads, dead keys, and dual-write collisions. The system cannot function correctly until this is fixed.

**This is a schema alignment mission — not a feature build.**
No prompt changes. No latency work. No new features.
You align the schema. You verify. You stop.

---

## SKILLS TO READ FIRST (MANDATORY)

Before you do anything, read these skills in this order:

```bash
cat .claude/skills/planning-with-files/SKILL.md
cat .claude/skills/project-planner/SKILL.md
cat .claude/skills/orchestrator/SKILL.md
cat .claude/skills/systematic-debugging/SKILL.md
cat .claude/skills/systematic-debugging/root-cause-tracing.md
cat .claude/skills/systematic-debugging/defense-in-depth.md
cat .claude/skills/cloudflare/SKILL.md
cat .claude/skills/subagent-driven-development/SKILL.md
```

These are not optional. They contain the working patterns built specifically for this codebase and environment.

---

## WORKING DIRECTORY

```
/Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM/
```

All paths below are relative to this root.

---

## WORKER SOURCE FILES

| Worker | Source |
|--------|--------|
| fast-intel | `fast-intel-sandbox/src/index.ts` |
| deep-scrape-workflow | `deep-scrape-workflow-sandbox/src/index.ts` |
| deepgram-bridge | `deepgram-bridge-v9/src/index.ts` |
| voice-agent | `voice-agent-v9/src/index.ts` |
| bella-tools | `bella-tools-worker-v9/src/index.ts` |
| mcp-worker | `mcp-worker-v9/sandbox_mcp-worker.ts` |
| consultant | `consultant-v9/worker.js` |

---

## PLANNING FILES TO CREATE IMMEDIATELY

Following the `planning-with-files` skill, create these before any code changes:

1. `task_plan.md` — Phase tracking (use the template from the skill)
2. `findings.md` — Record every discovery, every KV key variant found
3. `progress.md` — Session log, before/after for every file changed

**Re-read `task_plan.md` before every phase transition.**

---

## THE CANONICAL KV SCHEMA (TARGET STATE)

This is the agreed contract. Every worker must align to this exactly.

```typescript
// shared/kv-schema.ts — CREATE THIS FILE FIRST
// Single source of truth. Import into every TS worker.
// For consultant-v9/worker.js (plain JS): inline as string constants at top of file.

export const kvKey = {
  // ── Primary lead data ──────────────────────────────────────────────────
  intel:          (lid: string) => `lead:${lid}:intel`,         // ONE key for all lead intel

  // ── Bridge session state ───────────────────────────────────────────────
  scriptState:    (lid: string) => `lead:${lid}:script_state`,
  scriptStages:   (lid: string) => `lead:${lid}:script_stages`, // consultant writes → bridge reads
  capturedInputs: (lid: string) => `lead:${lid}:captured_inputs`,
  convMemory:     (lid: string) => `lead:${lid}:conv_memory`,   // canonical memory key

  // ── Outputs ────────────────────────────────────────────────────────────
  roi:            (lid: string) => `lead:${lid}:roi`,           // NEW — bella-tools writes after calc
  outcome:        (lid: string) => `lead:${lid}:outcome`,       // ONE writer: bella-tools only
  handoff:        (lid: string) => `lead:${lid}:handoff`,
  bellaPlan:      (lid: string) => `lead:${lid}:bella:plan`,

  // ── User-collected inputs ──────────────────────────────────────────────
  userInput:      (lid: string, field: string) => `lead:${lid}:user_${field}`,

  // ── GHL / identity ────────────────────────────────────────────────────
  cid:            (contactId: string) => `cid:${contactId}`,
  pending:        (token: string) => `pending:${token}`,        // written by voice-agent on call init

  // ── Static brain content ───────────────────────────────────────────────
  brainPrompt:    () => 'brain:bella:prompt',
  brainScriptKb:  () => 'brain:bella:script_kb',
} as const;

export const kvTTL = {
  intel:    86400,    // 24h  — lead data
  session:  14400,    // 4h   — call session keys
  outcome:  2592000,  // 30d  — outcome/handoff records
} as const;
```

**KEYS THAT ARE BEING ELIMINATED:**
- `{lid}` (bare lid) — consolidated into `lead:{lid}:intel`
- `lead:{lid}:name` (standalone) — name lives inside intel envelope only
- `lead:{lid}:deepIntel` — absorbed into intel envelope under `intel.deep`
- `lead:{lid}:conv_summary` — orphan write, removed
- `lead:{lid}:{agent}:roi_confirmed` — replaced by `lead:{lid}:roi`
- `lead:{lid}:{agent}:roi_estimate` — replaced by `lead:{lid}:roi`
- `lead:{lid}:memory` — renamed to `lead:{lid}:conv_memory` (canonical)

---

## THE 10 FIXES — PHASE BY PHASE

Execute one phase at a time. **Do not skip ahead.** After each phase, run the validation steps before moving on.

---

### PHASE 1 — Create shared schema module + PLAN.md

**Files to create:**
- `shared/kv-schema.ts` — full content above
- `task_plan.md`, `findings.md`, `progress.md`

**Validation:**
```bash
cat shared/kv-schema.ts
# Confirm: file exists, exports kvKey and kvTTL, all keys present
```

**Safety check:** No worker files touched yet. This phase is additive only.

---

### PHASE 2 — FIX-1: Eliminate bare `{lid}` key

**Problem:** `fast-intel` and `deep-scrape` write to BOTH `lead:{lid}:intel` AND bare `{lid}`. `voice-agent` tries `:intel` first then falls back to bare `lid`. Fragile sync that diverges under concurrency.

**Systematic debugging step — BEFORE any edit:**
Run this to confirm current state:
```bash
grep -n "LEADS_KV\.put(lid," fast-intel-sandbox/src/index.ts deep-scrape-workflow-sandbox/src/index.ts
grep -n "LEADS_KV\.get(this\.lid)" voice-agent-v9/src/index.ts
```
Record output in `findings.md`.

**Changes:**

**`fast-intel-sandbox/src/index.ts`:**
- REMOVE the `env.LEADS_KV.put(lid, str, ...)` line (bare lid write)
- KEEP only: `env.LEADS_KV.put(\`lead:${lid}:intel\`, str, ...)`
- Update TTL to use `kvTTL.intel` (86400) — import from shared/kv-schema.ts

**`deep-scrape-workflow-sandbox/src/index.ts`:**
- REMOVE `await this.env.LEADS_KV.put(lid, enrichedStr, ...)` (~line 223)
- REMOVE the bare lid sync block (~lines 322-326):
  ```
  const bare = await this.env.LEADS_KV.get(lid);
  ...
  await this.env.LEADS_KV.put(lid, JSON.stringify(bareEnv), ...)
  ```
- KEEP only: `await this.env.LEADS_KV.put(\`lead:${lid}:intel\`, ...)`

**`voice-agent-v9/src/index.ts`:**
- REMOVE the fallback bare lid read (~line 350):
  ```
  const rawStr = await this.env.LEADS_KV.get(this.lid);
  ```
- REMOVE any conditional fallback logic that uses `rawStr`
- Rely solely on `lead:${lid}:intel`

**Cascade check — after edit, grep to confirm bare lid is gone:**
```bash
grep -n "LEADS_KV\.put(lid," fast-intel-sandbox/src/index.ts deep-scrape-workflow-sandbox/src/index.ts
grep -n "LEADS_KV\.get(this\.lid)" voice-agent-v9/src/index.ts
# Expected: zero matches
```

**TypeScript build check:**
```bash
cd fast-intel-sandbox && npx tsc --noEmit 2>&1
cd ../deep-scrape-workflow-sandbox && npx tsc --noEmit 2>&1
cd ../voice-agent-v9 && npx tsc --noEmit 2>&1
```
Fix any type errors before proceeding.

---

### PHASE 3 — FIX-2: Wire `:script_stages` into bridge

**Problem:** `consultant` writes `lead:{lid}:script_stages`. Bridge (`deepgram-bridge-v9`) never reads it. The entire consultant-generated call plan is unused.

**Systematic debugging step — BEFORE any edit:**
```bash
grep -n "script_stages" deepgram-bridge-v9/src/index.ts
# Expected: zero matches — confirms the gap
grep -n "script_stages" consultant-v9/worker.js
# Expected: match at ~line 113
```

**Change: `deepgram-bridge-v9/src/index.ts`**

In the `initState` function (where it reads `lead:${lid}:intel` on ~line 160), add a parallel read:

```typescript
// Replace single intel read with parallel read including stages
const [intelRaw, stagesRaw] = await Promise.all([
  env.LEADS_KV.get(`lead:${lid}:intel`),
  env.LEADS_KV.get(`lead:${lid}:script_stages`),
]);

// After parsing intel, merge stages if present:
if (stagesRaw) {
  try {
    s.scriptStages = JSON.parse(stagesRaw);
  } catch (e) {
    console.warn('[bridge] Failed to parse script_stages:', e);
  }
}
```

Add `scriptStages?: Record<string, any>` to the `ScriptState` type/interface.

**Cascade check:**
```bash
grep -n "scriptStages\|script_stages" deepgram-bridge-v9/src/index.ts
# Expected: matches in initState and ScriptState type
cd deepgram-bridge-v9 && npx tsc --noEmit 2>&1
```

---

### PHASE 4 — FIX-3: Fix `:name` phantom read

**Problem:** `bella-tools` (~line 37) and `mcp-worker` (~line 950) read `lead:{lid}:name` as a standalone KV key. It is **never written** standalone. `name` only exists inside the intel envelope.

**Systematic debugging step:**
```bash
grep -n "lead:.*:name\|LEADS_KV\.get.*:name" bella-tools-worker-v9/src/index.ts mcp-worker-v9/sandbox_mcp-worker.ts
```
Record exact line numbers in `findings.md`.

**Changes:**

**`bella-tools-worker-v9/src/index.ts`:**
- Find the parallel `Promise.all` that reads `lead:${lid}:name` (~line 37)
- REMOVE that get call from the array
- Update the destructuring accordingly
- Where `name` is used downstream, read it from the parsed intel envelope: `intel?.contact?.name ?? intel?.name ?? ''`

**`mcp-worker-v9/sandbox_mcp-worker.ts`:**
- Find `env2.LEADS_KV.get("lead:" + lid + ":name")` (~line 950)
- REMOVE it from the Promise.all
- Update destructuring
- Read name from parsed intel envelope

**Cascade check:**
```bash
grep -n ":name\"" bella-tools-worker-v9/src/index.ts mcp-worker-v9/sandbox_mcp-worker.ts
# Expected: zero matches for standalone :name key reads
cd bella-tools-worker-v9 && npx tsc --noEmit 2>&1
```

---

### PHASE 5 — FIX-4: Create ROI write path

**Problem:** `bella-tools` and `mcp-worker` both read `lead:{lid}:{agent}:roi_confirmed` and `lead:{lid}:{agent}:roi_estimate`. **Neither key is ever written by any worker.** ROI output is always null.

**Systematic debugging step:**
```bash
grep -n "roi_confirmed\|roi_estimate\|roi_calc\|calcRoi\|calc-roi" bella-tools-worker-v9/src/index.ts mcp-worker-v9/sandbox_mcp-worker.ts
# Map every occurrence
```

**Changes:**

**`bella-tools-worker-v9/src/index.ts`:**

In the `/calc-roi` or equivalent ROI calculation handler:
- After computing the ROI result, ADD a write:
  ```typescript
  await env.LEADS_KV.put(
    `lead:${lid}:roi`,
    JSON.stringify({ result: roiResult, computedAt: new Date().toISOString() }),
    { expirationTtl: kvTTL.outcome }
  );
  ```
- Replace all reads of `:roi_confirmed` and `:roi_estimate` with a single read of `lead:${lid}:roi`:
  ```typescript
  const roiRaw = await env.LEADS_KV.get(`lead:${lid}:roi`);
  const roi = roiRaw ? JSON.parse(roiRaw) : null;
  ```

**`mcp-worker-v9/sandbox_mcp-worker.ts`:**
- Replace reads of `:roi_confirmed` and `:roi_estimate` with `lead:${lid}:roi`

**Cascade check:**
```bash
grep -n "roi_confirmed\|roi_estimate" bella-tools-worker-v9/src/index.ts mcp-worker-v9/sandbox_mcp-worker.ts
# Expected: zero matches
grep -n "lead:.*:roi" bella-tools-worker-v9/src/index.ts
# Expected: at least one put and one get
```

---

### PHASE 6 — FIX-5: Fix `:memory` phantom read

**Problem:** `bella-tools` reads `lead:{lid}:memory` in two places. Nothing in the system writes this key. The bridge writes `lead:{lid}:conv_memory`. These are two different key names.

**Systematic debugging step:**
```bash
grep -n ":memory\b\|conv_memory" bella-tools-worker-v9/src/index.ts deepgram-bridge-v9/src/index.ts
# Map every occurrence of both variants
```

**Decision — pick ONE canonical name: `lead:{lid}:conv_memory`** (already used by bridge)

**Changes:**

**`bella-tools-worker-v9/src/index.ts`:**
- Find all reads of `lead:${lid}:memory` (~lines 378, 511)
- Change to `lead:${lid}:conv_memory`
- Import from kvKey.convMemory(lid)

**No change needed to bridge** — it already uses `conv_memory`.

**Cascade check:**
```bash
grep -n ":memory\"" bella-tools-worker-v9/src/index.ts
# Expected: zero matches (all replaced with conv_memory)
```

---

### PHASE 7 — FIX-6: Identify and add `pending:{key}` writer

**Problem:** `mcp-worker` reads `pending:{pendingKey}` in two places. No worker writes this key. The lookup always returns null.

**Systematic debugging step:**
```bash
grep -n "pending:" mcp-worker-v9/sandbox_mcp-worker.ts
grep -rn "pending:" voice-agent-v9/src/index.ts fast-intel-sandbox/src/index.ts bella-tools-worker-v9/src/index.ts
# Find where it should be written
```

Examine the context around the mcp-worker reads to understand WHAT `pendingKey` represents. It is likely a GHL webhook correlation token set when a call is initiated.

**Change: `voice-agent-v9/src/index.ts` (most likely writer)**

In the call initialisation logic (when a new `lid` session begins):
```typescript
// Write pending lookup so mcp-worker can resolve GHL webhooks
const pendingKey = `pending:${lid}`;
await this.env.LEADS_KV.put(pendingKey, lid, { expirationTtl: 3600 });
```

If the pending key is a GHL contact ID token (not lid), trace the mcp-worker code further and document the correct pattern in `findings.md` before writing.

**Cascade check:**
```bash
grep -n "pending:" voice-agent-v9/src/index.ts
# Expected: at least one put
```

---

### PHASE 8 — FIX-7: Fix `outcome:{lid}` dual write

**Problem:** `bella-tools` (`/outcome` handler) AND `mcp-worker` both write `outcome:{lid}` in different JSON shapes. Last writer wins with no contract.

**Systematic debugging step:**
```bash
grep -n "outcome:" bella-tools-worker-v9/src/index.ts mcp-worker-v9/sandbox_mcp-worker.ts
# Map both writes and compare the JSON shapes
```

**Decision — single writer: `bella-tools` only.**

**Changes:**

**`mcp-worker-v9/sandbox_mcp-worker.ts`:**
- Find the `LEADS_KV.put("outcome:" + lid, ...)` write (~line 1195)
- REMOVE it entirely
- If mcp-worker needs to log an outcome, it should call bella-tools `/outcome` endpoint instead (or just remove the write and rely on bella-tools)

**Verify bella-tools outcome shape is complete** — ensure it captures everything mcp-worker was trying to record.

**Cascade check:**
```bash
grep -n "\"outcome:" mcp-worker-v9/sandbox_mcp-worker.ts
# Expected: zero put calls (gets are OK for reads)
```

---

### PHASE 9 — FIX-8: Remove orphan keys

**Stop writing keys that nothing reads.**

**`deepgram-bridge-v9/src/index.ts`:**
- Find and REMOVE `env.LEADS_KV.put(\`lead:${lid}:conv_summary\`, ...)` (~line 611)
- This key is never read. Remove the write entirely.

**`deep-scrape-workflow-sandbox/src/index.ts`:**
- Find `await this.env.LEADS_KV.put(\`lead:${lid}:deepIntel\`, ...)` (~line 311)
- REMOVE the separate deepIntel write — the data is already merged into `:intel` envelope
- Confirm intel.deep is properly populated in the merge before removing

**Optional (low priority):** Remove `event:{lid}:{timestamp}` writes from bella-tools if they're accumulating without any consumer. Check first whether any monitoring depends on them.

**Cascade check:**
```bash
grep -n "conv_summary\|deepIntel" deepgram-bridge-v9/src/index.ts deep-scrape-workflow-sandbox/src/index.ts
# Expected: zero matches
```

---

### PHASE 10 — FIX-9: Standardise TTLs

**`deepgram-bridge-v9/src/index.ts`:**
- Find all hardcoded `7200` TTL values
- Replace with `kvTTL.session` (14400) — import from shared/kv-schema.ts

**`fast-intel-sandbox/src/index.ts` and `deep-scrape-workflow-sandbox/src/index.ts`:**
- Verify KV_TTL constant matches `kvTTL.intel` (86400)
- If different, align to 86400

**`bella-tools-worker-v9/src/index.ts`:**
- `outcome:` and `handoff:` keys should use `kvTTL.outcome` (2592000)
- Session-duration keys (captured_inputs etc.) should use `kvTTL.session` (14400)

**Cascade check:**
```bash
grep -n "expirationTtl: 7200\|expirationTtl: 3600" deepgram-bridge-v9/src/index.ts bella-tools-worker-v9/src/index.ts
# Expected: replaced with kvTTL.* constants
```

---

### PHASE 11 — FIX-10: Replace all inline KV key strings with kvKey.*

**This is the structural lock-in phase.** Once done, any future key mismatch is a compile-time error.

For each worker that's TypeScript:
- Add import: `import { kvKey, kvTTL } from '../shared/kv-schema';`
  (adjust path depth per worker)
- Replace every `LEADS_KV.get(\`lead:${lid}:intel\`)` with `LEADS_KV.get(kvKey.intel(lid))`
- Replace every `LEADS_KV.put(\`lead:${lid}:script_state\`, ...)` with `LEADS_KV.put(kvKey.scriptState(lid), ...)`
- And so on for every key in the schema

For `consultant-v9/worker.js` (plain JS):
- Add at top of file:
  ```javascript
  // KV key constants — must match shared/kv-schema.ts
  const kvKey = {
    intel:        (lid) => `lead:${lid}:intel`,
    scriptStages: (lid) => `lead:${lid}:script_stages`,
    bellaPlan:    (lid) => `lead:${lid}:bella:plan`,
  };
  const KV_TTL_INTEL = 86400;
  ```
- Replace all inline key strings

**Final build check for all TS workers:**
```bash
for dir in fast-intel-sandbox deep-scrape-workflow-sandbox deepgram-bridge-v9 voice-agent-v9 bella-tools-worker-v9; do
  echo "=== $dir ===" && cd $dir && npx tsc --noEmit 2>&1 && cd ..
done
```
**All must pass with zero errors.**

---

## SAFETY RULES — NON-NEGOTIABLE

### Before any edit to a file:
1. Read the relevant section of the file first
2. Record in `findings.md` what you found vs. what was expected
3. Make the MINIMUM change needed — do not refactor surrounding code
4. Run the TypeScript build check for that worker immediately after

### After each phase:
1. Run all cascade checks listed in that phase
2. Update `task_plan.md` with phase status
3. Log any unexpected discoveries in `findings.md`
4. If a TypeScript error appears that wasn't there before, fix it in the SAME phase before continuing

### Cascading issue protocol (from systematic-debugging skill):
If a change in Phase N causes a new error that wasn't present before:
1. STOP. Do not move to Phase N+1.
2. Read the error completely.
3. Trace it back to root cause (use root-cause-tracing.md technique).
4. Fix at the source, not at the symptom.
5. If 3 fix attempts fail: document in `findings.md` and surface to the user.

### Do NOT:
- Deploy any worker until ALL 11 phases are complete and all TS builds pass
- Change any logic unrelated to the KV key alignment
- Rename functions, restructure code, or "improve" anything not in scope
- Delete any code unless explicitly instructed above

---

## DEFINITION OF DONE

The mission is complete when ALL of the following pass:

**Schema:**
- [ ] `shared/kv-schema.ts` exists with all kvKey functions and kvTTL constants
- [ ] Zero inline KV key strings in any worker (all use kvKey.*)
- [ ] Zero bare `{lid}` key reads or writes
- [ ] Zero reads of `lead:{lid}:name` as standalone key
- [ ] Zero reads of `lead:{lid}:{agent}:roi_confirmed` or `:roi_estimate`
- [ ] Zero reads of `lead:{lid}:memory` (replaced with `conv_memory`)
- [ ] Zero writes of `lead:{lid}:conv_summary` (orphan removed)
- [ ] Zero writes of `lead:{lid}:deepIntel` (orphan removed)
- [ ] Single writer for `outcome:{lid}` (bella-tools only)
- [ ] `pending:{token}` has an identified writer

**Build:**
- [ ] `npx tsc --noEmit` passes with zero errors in all 5 TypeScript workers
- [ ] `consultant-v9/worker.js` has inline key constants at top matching schema

**Verification grep:**
```bash
# Run this final check — every line should return zero matches
grep -rn "LEADS_KV\.put(lid," fast-intel-sandbox/src deep-scrape-workflow-sandbox/src
grep -rn "LEADS_KV\.get(this\.lid\b\|LEADS_KV\.get(lid\b" voice-agent-v9/src mcp-worker-v9
grep -rn ":name\")" bella-tools-worker-v9/src mcp-worker-v9
grep -rn "roi_confirmed\|roi_estimate" bella-tools-worker-v9/src mcp-worker-v9
grep -rn "conv_summary" deepgram-bridge-v9/src
grep -rn "deepIntel" deep-scrape-workflow-sandbox/src
grep -rn "lead:\${lid}:memory\b\|lead:.*:memory\"" bella-tools-worker-v9/src
```

---

## WHAT COMES AFTER (NOT YOUR SCOPE)

Once this mission is complete, the following will be tackled separately:
- Deploy lean bridge (latency fix)
- Deep scrape write-back verification
- WOW gate tightening
- Voice agent prompt refinement

Do not touch any of those now.

---

## QUICK REFERENCE — KEY AUDIT TABLE

| Old Key | Status | New Key |
|---------|--------|---------|
| `{lid}` (bare) | 🔴 REMOVE | `lead:{lid}:intel` |
| `lead:{lid}:intel` | ✅ KEEP | `lead:{lid}:intel` |
| `lead:{lid}:name` (standalone) | 🔴 REMOVE | read from intel envelope |
| `lead:{lid}:script_state` | ✅ KEEP | `lead:{lid}:script_state` |
| `lead:{lid}:script_stages` | 🟡 ADD READER | `lead:{lid}:script_stages` |
| `lead:{lid}:captured_inputs` | ✅ KEEP | `lead:{lid}:captured_inputs` |
| `lead:{lid}:conv_memory` | ✅ KEEP | `lead:{lid}:conv_memory` |
| `lead:{lid}:memory` | 🔴 RENAME | `lead:{lid}:conv_memory` |
| `lead:{lid}:conv_summary` | 🔴 REMOVE WRITE | (deleted) |
| `lead:{lid}:deepIntel` | 🔴 REMOVE WRITE | (absorbed into :intel) |
| `lead:{lid}:{agent}:roi_confirmed` | 🔴 REPLACE | `lead:{lid}:roi` |
| `lead:{lid}:{agent}:roi_estimate` | 🔴 REPLACE | `lead:{lid}:roi` |
| `lead:{lid}:roi` | 🟡 CREATE | `lead:{lid}:roi` |
| `outcome:{lid}` (mcp write) | 🔴 REMOVE | bella-tools writes only |
| `pending:{token}` | 🔴 ADD WRITER | voice-agent writes on init |
| `cid:{contactId}` | ✅ KEEP | `cid:{contactId}` |
| `brain:bella:prompt` | ✅ KEEP | `brain:bella:prompt` |
| `brain:bella:script_kb` | ✅ KEEP | `brain:bella:script_kb` |

---

Begin with skill reads. Then create planning files. Then Phase 1.
