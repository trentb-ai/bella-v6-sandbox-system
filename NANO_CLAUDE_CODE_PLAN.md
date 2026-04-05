# NANO-CLAUDE-CODE — Minimal AI Coding Engine
### Date: 2026-04-05 | Baseline: Claude Haiku 4.5 + Cloudflare Workers runtime
### Goal: Build lightweight, edge-deployable Claude Code alternative for CF Workers + Railway Ollama agents
### Principle: Leverage existing Claude API + MCP infrastructure, strip UI, run in background

---

## EXECUTIVE SUMMARY

**Problem:** Full Claude Code (VSCode client + LSP + 200MB+ footprint) is too heavy for:
- CF Workers (CPU/memory constrained, serverless context)
- Autonomous agent teams (need programmatic API, not UI)
- Embedded coding scenarios (nano-scale deployment)

**Solution:** nano-claude-code — API-first coding assistant
- Accepts code change requests (REST or claude-peers protocol)
- Delegates to Claude Haiku (cheap, fast) with structured output
- Returns diffs + test results
- Runs on Railway/Vercel (stateless) or CF Workers (edge)
- Cost: ~$0.50/day for 100 agent requests

**Integration points:**
- T2 Codex sends TASK_REQUEST to nano-claude-code worker
- nano-claude-code queries Claude API + MCP (file reads, LSP, etc.)
- Returns structured diffs ready for git apply
- Codex reviews diffs, approves, delegates to T3/T4 for final deploy

---

## THE PROBLEM

### Current Workflow
```
T2 Codex (plans) → TASK_REQUEST to T3/T4 (humans wait for availability)
                → T3/T4 read files + make edits (20-30min per task)
                → T2b reviews (10min, full Codex gates)
                → Deploy (5min)
Total: 45-50min per fix
```

### Pain Points
1. **T3/T4 availability** — Only 2 minions, competing for time
2. **Latency on small tasks** — "Change this variable name" takes 30min (overhead)
3. **No parallel task execution** — Single-threaded team
4. **Mechanical tasks blocked on human slots** — Type fixes, boilerplate, simple renames take same time as complex refactors

### Opportunity
Automate ~40% of implementation tasks (mechanical fixes, boilerplate, variable renames, simple extractions) with Haiku, freeing T3/T4 for complex logic + testing.

---

## THE SOLUTION: nano-claude-code

### Architecture
```
┌─────────────────────────────────────────────────────┐
│ T2 Codex (planner)                                  │
│ Sends: TASK_REQUEST with before/after spec         │
└──────────────────┬──────────────────────────────────┘
                   │
                   ↓ (claude-peers or REST)
┌─────────────────────────────────────────────────────┐
│ nano-claude-code worker (CF or Railway)             │
│ - Parse task spec                                   │
│ - Fetch files via MCP (Read tool + Glob)            │
│ - Call Claude Haiku with structured prompt          │
│ - Generate diffs                                    │
│ - Run verification (ESLint, TypeScript check)       │
└──────────────────┬──────────────────────────────────┘
                   │
                   ↓ (structured result)
┌─────────────────────────────────────────────────────┐
│ T2 Codex (reviewer)                                 │
│ - Receives diff + test results                      │
│ - Runs 6-gate Codex review                          │
│ - Approves or rejects                               │
└──────────────────┬──────────────────────────────────┘
                   │
                   ↓ REVIEW_VERDICT
┌─────────────────────────────────────────────────────┐
│ T3/T4 (executor — final deploy only)                │
│ - git apply diff                                    │
│ - npx wrangler deploy                               │
└─────────────────────────────────────────────────────┘
```

### What Gets Automated
**YES — candidate for nano-claude-code:**
- Variable/function renames (`ttsAcronym` → `normalizeBizName`)
- Type-safe refactors (add type annotation, fix type error)
- Boilerplate (new function structure, test template)
- Simple extractions (regex, field mapping)
- Conditional logic fixes (add null check, fix comparison)
- Comment/doc updates (matching code changes)
- Config changes (wrangler.toml, env var updates)

**NO — stays with T3/T4:**
- Architecture decisions (new types, restructure data flow)
- Complex logic (new algorithm, state machine changes)
- Performance tuning (optimization, caching strategy)
- Integration work (new service bindings, API contracts)
- Testing (full test suite, coverage analysis)

---

## PHASES (4-WEEK ROLLOUT)

### Phase 0: API Design + Infrastructure (DAYS 1-3)
**Effort:** 8 hours | **Impact:** Unblocks all implementation work
**Files:** `nano-claude-code/` (new repo)

**Deliverables:**
1. REST API spec (OpenAPI 3.0)
2. Claude-peers protocol spec
3. Railway deployment config
4. MCP integration setup

**REST API:**
```
POST /tasks
{
  "task_id": "task_uuid",
  "repo_path": "/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM",
  "spec": {
    "summary": "Rename ttsAcronym to normalizeBizName",
    "files": ["bridge-v2-rescript/src/index.ts"],
    "changes": [
      {
        "file": "bridge-v2-rescript/src/index.ts",
        "line_range": [234, 245],
        "old_string": "const ttsAcronym = (name: string) => { ... }",
        "new_string": "const normalizeBizName = (name: string) => { ... }"
      }
    ],
    "verification": "ESLint clean, no type errors, grep finds 0 references to ttsAcronym"
  }
}

RESPONSE:
{
  "task_id": "task_uuid",
  "status": "success|failed",
  "diff": "--- a/bridge-v2-rescript/src/index.ts\n+++ b/...\n@@...",
  "verification_results": {
    "eslint": "PASS",
    "tsc": "PASS",
    "grep_verification": "PASS — 0 remaining references"
  },
  "metadata": {
    "haiku_tokens_used": 1240,
    "execution_time_ms": 3420
  }
}
```

**Success gate:**
- [ ] API documentation complete (OpenAPI spec)
- [ ] Railway deployment tested locally
- [ ] MCP integration works (can read files via Claude API)
- [ ] Sample task (rename variable) executes end-to-end

---

### Phase 1: Haiku Executor + Verification (WEEKS 1-2)
**Effort:** 20 hours | **Impact:** Automated code generation for 40% of tasks
**Files:** `nano-claude-code/executor.ts`, `nano-claude-code/verifier.ts`

**Deliverables:**
1. Haiku prompt for code generation
2. Diff builder (unified format)
3. Verification suite (ESLint, TypeScript, grep, regex)

**Haiku Prompt Template:**
```
You are nano-claude-code, an expert refactoring engine.

## Task
{{ TASK_SUMMARY }}

## Current Code
{{ OLD_CODE_SNIPPET }}

## Specification
- Change: {{ CHANGE_DESCRIPTION }}
- Verification: {{ VERIFICATION_STEPS }}

## Requirements
1. Output ONLY the new code block (no explanation)
2. Preserve indentation and formatting
3. Keep surrounding code identical
4. No behavioral changes beyond the spec

## New Code
```

**Verification Suite:**
```typescript
interface VerificationRule {
  type: 'eslint' | 'typescript' | 'grep' | 'regex' | 'custom';
  command?: string;      // eslint path, tsc flags, etc.
  pattern?: string;      // regex to find/verify
  expectation: string;   // what success looks like
}

// Example: Verify ttsAcronym rename is complete
[
  {
    type: 'grep',
    pattern: 'ttsAcronym',
    expectation: 'ZERO matches (fully renamed)'
  },
  {
    type: 'typescript',
    command: 'tsc --noEmit',
    expectation: 'PASS (no type errors)'
  },
  {
    type: 'eslint',
    command: 'eslint bridge-v2-rescript/src/index.ts',
    expectation: 'PASS (no violations)'
  }
]
```

**Success gates:**
- [ ] Haiku generates syntactically valid code
- [ ] Verification rules capture common failure modes
- [ ] False positive rate <5% (diffs that compile but are wrong)
- [ ] Sample 5-task run: all diffs verified correctly

---

### Phase 2: T2 Integration + Gate 4 Bridge (WEEKS 2-3)
**Effort:** 12 hours | **Impact:** nano-claude-code works with Codex review pipeline
**Files:** `nano-claude-code/t2-integration.ts`, claude-peers protocol

**Deliverables:**
1. TASK_RESPONSE message format (nano-claude-code → T2)
2. Codex integration (diff → /codex review)
3. claude-peers dispatcher

**TASK_RESPONSE Format:**
```
TASK_RESPONSE: [task_id]
---
Status: success|failed
Execution time: Xms
Haiku tokens: N
Diff: [unified diff]
Verification:
  - ESLint: PASS|FAIL
  - TypeScript: PASS|FAIL
  - Custom: PASS|FAIL
Confidence: high|medium|low  (for T2 to decide if review is needed)
Evidence: [what verification proves]
Recommendation: [proceed to Codex review | needs human revision]
```

**Confidence scoring:**
- **high:** All verifications PASS, diff is syntactically perfect
- **medium:** Verifications PASS but semantic risk (e.g., complex logic change)
- **low:** Any verification FAIL, or task outside nano-claude-code scope

**T2 workflow:**
1. Receive TASK_RESPONSE from nano-claude-code
2. If confidence=high AND verification=all-pass → Skip manual diff read, go to Codex
3. If confidence=medium → Manual review of diff before Codex
4. If confidence=low → RETURN_TO_IMPLEMENTER (task reassigned to T3/T4)

**Success gates:**
- [ ] TASK_RESPONSE message format works with T2's review pipeline
- [ ] Codex review accepts nano-claude-code diffs without modification
- [ ] claude-peers dispatcher routes messages correctly
- [ ] Sample 3-task flow: nano → T2 → Codex → approved

---

### Phase 3: Scalability + Cost Optimization (WEEKS 3-4)
**Effort:** 8 hours | **Impact:** Production-ready, sub-$1/task cost
**Files:** `nano-claude-code/scaling.ts`, Railway config

**Deliverables:**
1. Rate limiting (queue 50 tasks, process in parallel)
2. Token budgeting (Haiku tokens capped per task)
3. Cache layer (MCP file reads cached for 5min)
4. Cost reporting

**Rate Limiting:**
- Queue: Redis or Railway KV (10s max latency)
- Workers: 2 concurrent Haiku calls (per $1/mo Haiku quota)
- Fallback: Queue waits up to 60s, then TIMEOUT response to T2

**Token Budgeting:**
- Small task (rename): max 500 input tokens
- Medium task (type fix): max 1000 input tokens
- Large task (logic fix): max 2000 input tokens (escalate to T3/T4 if more needed)

**Cache Layer:**
```typescript
const fileCache = new Map<string, CachedFile>();
const CACHE_TTL_MS = 5 * 60 * 1000;  // 5 min

async function readFile(path: string) {
  const cached = fileCache.get(path);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.content;
  }
  const content = await mcp.read(path);
  fileCache.set(path, { content, timestamp: Date.now() });
  return content;
}
```

**Cost Analysis:**
| Component | Cost per 100 tasks |
|-----------|-------------------|
| Haiku tokens (avg 800/task) | ~$0.32 |
| Railway compute (10 min) | $0.10 |
| MCP reads (cached) | negligible |
| **Total** | **~$0.42** |

**Success gates:**
- [ ] Queue handles 50-task burst (no drops)
- [ ] 2 parallel workers both active, scaling smooth
- [ ] Cache hit rate >70% on repeated files
- [ ] Cost <$1/task at scale (50 tasks/hour)

---

### Phase 4: Autonomy + Feedback Loop (WEEK 4)
**Effort:** 8 hours | **Impact:** nano-claude-code learns from Codex verdicts
**Files:** `nano-claude-code/feedback-loop.ts`

**Deliverable:** Feedback mechanism for improving Haiku quality

**Workflow:**
1. T2 receives TASK_RESPONSE, runs Codex review
2. If Codex returns P1/P2 findings: T2 sends `NANO_FEEDBACK` to nano-claude-code
3. nano-claude-code logs finding (type, file, code snippet)
4. Haiku prompt is iteratively refined based on most common failures

**NANO_FEEDBACK Format:**
```
NANO_FEEDBACK: [task_id]
---
Verdict: FAIL
Gate: 2 (Safety)
Finding: Race condition on state.stage mutation
Original diff: [failed code block]
Root cause: Direct mutation instead of processFlow()
Recommended fix: Use processFlow() setter method
Severity: P1
```

**Feedback log analysis (weekly):**
- Count failure types (top 5)
- Update Haiku system prompt with guardrails
- Example: If 10+ "direct state mutation" errors → add explicit note to prompt

**Success gates:**
- [ ] Feedback loop captures Codex verdicts
- [ ] Weekly analysis identifies top 3 failure patterns
- [ ] Haiku prompt updated with new guardrails
- [ ] Failure rate on repeated failure types drops >50%

---

## SUCCESS CRITERIA

### Per Phase
| Phase | Gate | Measurement |
|-------|------|-------------|
| **0** | API ready | OpenAPI spec complete, REST endpoint responds |
| **1** | Executor working | Haiku generates valid code on 5-task sample |
| **2** | T2 integration | nano → T2 → Codex → approve flow works |
| **3** | Production scale | Queue handles 50 tasks, cost <$1/task |
| **4** | Feedback loop | Failure rate on repeated patterns ↓50% |

### Overall
- **Task automation rate:** 40% of implementation tasks automated (mechanical fixes)
- **Time saved:** 20-30min per automated task (5→1 min execution)
- **Team throughput:** T3/T4 freed to focus on complex logic + testing
- **Quality:** Codex review rate on nano diffs >80% (high confidence)
- **Cost:** <$50/month for 1000 tasks

---

## DEPLOYMENT STRATEGY

### Pre-Phase 0
- [ ] Trent approves nano-claude-code roadmap (this document)
- [ ] Pick deployment target: Railway (preferred, simple) or CF Workers (edge)
- [ ] Set up API key management (Anthropic API, MCP credentials)

### Canary Approach
1. **Phase 0-1 canary:** Route 1 test task to nano-claude-code, T2 reviews manually
2. **Phase 2 canary:** Route 3 test tasks, measure time saved + Codex verdict distribution
3. **Phase 3 canary:** Scale to 10 concurrent tasks (stress test queue + caching)
4. **Phase 4 canary:** Route 5% of T3/T4 tasks to nano-claude-code for 1 week
5. **Ramp:** 5% → 25% → 100% if feedback loop working + failure rate <5%

### Rollback Plan
- If Codex failure rate >10%: disable nano-claude-code, revert to T3/T4-only
- If queue latency >60s: reduce concurrency to 1 worker
- If token cost exceeds budget: increase cache TTL, reduce Haiku token budget

---

## KNOWN UNKNOWNS

1. **Haiku quality on edge cases** — How well does Haiku handle complex type refactors or nested logic changes?
2. **False positive rate** — What % of "passing" diffs are actually wrong (semantic errors not caught by verification)?
3. **Feedback loop effectiveness** — How much do Codex verdicts actually improve Haiku prompts?
4. **Scaling limits** — What's the actual max throughput? (Queue saturation point?)
5. **Integration overhead** — Is T2's review time on nano diffs actually faster than just delegating to T3/T4?

---

## APPENDIX: Example Task (Rename Variable)

### Input: TASK_REQUEST
```
TASK_REQUEST: Rename ttsAcronym to normalizeBizName
---
Files: bridge-v2-rescript/src/index.ts
Changes: 
  - Rename function ttsAcronym → normalizeBizName (line 234)
  - Update all call sites (grep shows 3 locations)
Expected output: Diff with renamed function + updated calls
Verification: 
  - ESLint clean
  - TypeScript compiles
  - grep finds 0 remaining references to ttsAcronym
Priority: low
```

### Haiku Processing
```
1. Fetch file @ line 234
2. Identify function: ttsAcronym(name: string) => string
3. Generate replacement: normalizeBizName(name: string) => string
4. Find all call sites: 3 locations
5. Generate unified diff
6. Run verification:
   - ESLint bridge-v2-rescript/src/index.ts → PASS
   - tsc --noEmit → PASS
   - grep ttsAcronym → 0 matches → PASS
```

### Output: TASK_RESPONSE
```
TASK_RESPONSE: task_uuid
---
Status: success
Execution time: 2314ms
Haiku tokens: 1240
Diff:
--- a/bridge-v2-rescript/src/index.ts
+++ b/bridge-v2-rescript/src/index.ts
@@ -234,7 +234,7 @@
-const ttsAcronym = (name: string): string => {
+const normalizeBizName = (name: string): string => {
   // ...
 };
 
 // Line 567
-  speak: ttsAcronym(intel.business_name),
+  speak: normalizeBizName(intel.business_name),

Verification:
  - ESLint: PASS
  - TypeScript: PASS
  - grep ttsAcronym: PASS (0 matches)
Confidence: high
Recommendation: Proceed to Codex review (high-confidence diff)
```

### T2 Review
```
STATUS: nano-claude-code TASK_RESPONSE received
Diff confidence: high, all verifications PASS
→ Sending to Codex review (skip manual diff read)

[Codex returns: PASS — minor refactor, straightforward rename]

REVIEW_VERDICT: PASS — Variable rename verified clean
→ CC T1: STATUS: REVIEW_VERDICT PASS for nano-code task — ttsAcronym → normalizeBizName

→ Minion deploys (T3: git apply + npx wrangler deploy)
```

Total time: **4 minutes** (vs 30min if T3/T4 had done it)

