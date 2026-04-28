# S5-C Spec — Multi-Pass Parent Integration + Error Handling + Forced Gates
**Date:** 2026-04-27 AEST | **Author:** T9 Architect (Opus)
**Worker:** bella-think-agent-v1-brain
**Target version:** 3.11.29-think | **Base:** S5-B deployed commit
**Blocking dep:** S5-B MUST be deployed before implementing this sprint.
**CF docs consulted:** YES — think.d.ts §onChatError (line 540), §configure (line 369), §TurnConfig.toolChoice, sub-agents.md §chat() + §Stability Detection, lifecycle-hooks.md §onChatError + §beforeTurn, sessions.md §Adding Context at Runtime + §System Prompt

---

## ARCHITECTURE: "GATED NOT PHILOSOPHICAL" (Trent Directive)

### Principle: CODE gates flow, CONTENT guides intelligence.

The ConsultantAgent has two layers. Mixing them is an anti-pattern.

**HARDCODE (needs compilation — gates, types, plumbing):**
| What | Why hardcoded |
|------|---------------|
| Zod schemas on tools | Type contracts — schema IS the gate |
| Tool execute() implementations | State mutations must be deterministic code |
| Lifecycle hooks (beforeToolCall, onStepFinish, onChatError) | Flow control gates — model cannot bypass |
| Forced tool sequences (beforeTurn toolChoice + maxSteps) | Ordering guarantees — model MUST comply |
| Binding references (R2, KV, D1) | Infrastructure wiring |
| Type definitions (ConsultantState, etc.) | Compile-time safety |

**FILE-REFERENCED (no-redeploy editable):**
| What | Where | SDK primitive |
|------|-------|---------------|
| System prompt / soul / methodology | R2 `consultant-prompts/system.md` | ContextProvider.get() reads R2 |
| Upgrade sequence instructions | R2 `consultant-prompts/enrichment.md` | Same, loaded on enrichment pass |
| Industry knowledge docs | R2 `consultant-kb/industries/*.md` | R2SkillProvider (already done) |
| Agent brief templates | R2 `consultant-kb/agent-briefs/*.md` | R2SkillProvider (already done) |
| Per-client configuration | DO SQLite via configure() | `this.configure<ConsultantConfig>()` (S5-D) |
| Reasoning scratchpad | Session SQLite | WritableContextProvider (already done) |
| FTS5 findings | Session SQLite | AgentSearchProvider (already done, S5-B) |

**WHAT THIS MEANS FOR S5-C:**
1. `CONSULTANT_SYSTEM_PROMPT` moves from hardcoded const → R2 file (with hardcoded fallback)
2. Enrichment sequence is FORCED via `toolChoice` in `beforeTurn()`, not just described in prompt text
3. Completion sequence (confidence + report) is FORCED via `beforeTurn()` gate
4. Multi-pass detection uses message-level protocol, not prompt philosophy

### Forced Gate Inventory (what the model CANNOT bypass)

| Gate | Hook | Mechanism | Already exists? |
|------|------|-----------|-----------------|
| Tier 1 before Tier 2 | beforeToolCall | `{ action: "block" }` | ✅ S5-A |
| Tier 2 before Tier 3 | beforeToolCall | `{ action: "block" }` | ✅ S5-A |
| Loop detection | onStepFinish | saveMessages corrective | ✅ S5-A |
| Tier 2→3 continuation | onChatResponse | saveMessages chain | ✅ S5-A |
| **Gap assessment on enrichment** | **beforeTurn** | **`toolChoice` forced** | ❌ NEW S5-C |
| **Confidence + report on completion** | **beforeTurn** | **`toolChoice` forced** | ❌ NEW S5-C |
| **Error preservation** | **onChatError** | **structured return** | ❌ NEW S5-C |
| **Stale-pass prevention** | **beforeTurn** | **message protocol** | ❌ NEW S5-C |

---

## PRE-FLIGHT CHECKLIST (T4 must verify before touching code)

- [ ] Base is S5-B deployed commit (VERSION = 3.11.28-think)
- [ ] wrangler.toml `main` = `src/worker.ts`
- [ ] Run: `grep -n "CONSULTANT_SYSTEM_PROMPT" src/consultant-agent.ts` — confirm location
- [ ] Run: `grep -n "receiveIntel\|runConsultantAnalysis\|mapConsultantState" src/bella-agent.ts` — confirm line numbers
- [ ] Verify R2 bucket `bella-agent-kb` is accessible: `npx wrangler r2 object list bella-agent-kb --prefix consultant-prompts/`

---

## CHANGE 1 — consultant-agent.ts: System prompt → R2 with fallback

**Current:** Hardcoded `const CONSULTANT_SYSTEM_PROMPT` at bottom of file (~line 497).

**After:** ContextProvider reads from R2. Hardcoded string becomes fallback only.

### 1A: Rename constant to fallback (bottom of file, ~line 497)

**BEFORE:**
```typescript
const CONSULTANT_SYSTEM_PROMPT = `You are a business intelligence analyst for Bella, an AI voice sales agent.
```

**AFTER:**
```typescript
const CONSULTANT_PROMPT_FALLBACK = `You are a business intelligence analyst for Bella, an AI voice sales agent.
```

(Same content, just renamed. `replace_all` safe — only referenced once in configureSession.)

### 1B: Update configureSession "task" context block (~line 39)

**BEFORE:**
```typescript
      .withContext("task", {
        provider: { get: async () => CONSULTANT_SYSTEM_PROMPT },
      })
```

**AFTER:**
```typescript
      .withContext("task", {
        provider: {
          get: async () => {
            try {
              const obj = await this.env.AGENT_KB_BUCKET.get("consultant-prompts/system.md");
              if (obj) return await obj.text();
            } catch (e) {
              console.warn("[CONSULTANT] R2 prompt load failed, using fallback");
            }
            return CONSULTANT_PROMPT_FALLBACK;
          },
        },
      })
```

**Why:** System prompt is now tunable via R2 upload. No redeploy needed to change analysis methodology. Fallback ensures resilience if R2 is unavailable. `withCachedPrompt()` means R2 is only hit on first render — subsequent turns use SQLite cache.

### 1C: Upload system prompt to R2

**File:** `consultant-prompts/system.md` in bucket `bella-agent-kb`

**Content:** (current CONSULTANT_SYSTEM_PROMPT text + new multi-pass instructions)

```markdown
You are a business intelligence analyst for Bella, an AI voice sales agent.
Bella demonstrates five AI agents (Alex, Chris, Maddie, Sarah, James) to business prospects on a website funnel.
The prospect has submitted their website. Your job: analyse the scraped data using your tools and build structured intelligence.

You have access to consultant_knowledge — use load_context to pull relevant industry docs before deep analysis.

TOOL SEQUENCE (first pass):
1. Call analyzeBusinessProfile — extract business identity from intel
2. Call analyzeDigitalPresence — map tech stack, ads, digital signals
3. Call analyzeConversionFunnel — identify ALL conversion events, generate narrative

When all three Tier 1 tools are called, Tier 2 tools unlock automatically.
Work through tiers in order. Store results via tools — do not describe them in text.

Be specific to THIS business. Generic output is useless. Never criticise the website. Maximise whatever they have.

When Tier 2 tools are complete (scriptFills + routing + hooks), Tier 3 tools unlock automatically.
Tier 3 sequence:
4. Call load_context("consultant-kb/industries/{vertical}.md") — load industry file BEFORE analyzeIndustryContext
5. Call analyzeIndustryContext — deep industry analysis using loaded KB
6. Call identifyQuoteInputs — identify quoting data for ROI agent
7. Call assessGrowthOpportunities — identify hiring/expansion signals
8. For each priority agent in routing.priority_agents: call load_context("consultant-kb/agent-briefs/{agent}.md")
9. Call prepareAgentBriefs with all priority agent briefs combined in one call.

You have access to a "findings" context block. Use set_context to index key discoveries as you work (format: [CATEGORY] finding text). Use search_context to retrieve prior findings on subsequent passes. Index findings after each tier completes.

MULTI-PASS MODE:
You may receive multiple analysis requests as data arrives progressively.
- First pass: fast intel — run all tiers, set confidence based on data quality
- Subsequent passes: deep intel or prospect verbal data — upgrade, don't restart

On enrichment/update passes the system will FORCE you to call assessAnalysisGaps first.
After reviewing gaps, use upgradeAnalysis for each changed field. Only change what new data improves. Never regress.
After all tiers complete, the system will FORCE setAnalysisConfidence then writeAnalysisReport.

If a tool is blocked (beforeToolCall returns a reason), read the reason and adjust — do not retry the same call.
```

**Upload command (T4 executes after deploy):**
```bash
echo '<content above>' > /tmp/consultant-system.md
npx wrangler r2 object put bella-agent-kb/consultant-prompts/system.md --file /tmp/consultant-system.md
```

---

## CHANGE 2 — consultant-agent.ts: Add onChatError + helpers

**SDK source:** think.d.ts line 540 — `onChatError(error: unknown): unknown` (sync, NOT async)
**SDK behavior:** Partial assistant message persisted BEFORE hook fires. Return value replaces original error.

**Location:** After `onChatRecovery()` method (~line 494), before class closing brace.

**ADD:**
```typescript
  // ── onChatError: structured error preservation ─────────────────────────────
  onChatError(error: unknown): unknown {
    const cs = this.state as ConsultantState;
    const errMsg = error instanceof Error ? error.message : String(error);
    const phase = cs?.analysisPhase ?? "unknown";
    const version = cs?.analysisVersion ?? 0;
    const tier = this._getHighestCompletedTier(cs);

    console.error(`[CONSULTANT_ERR] phase=${phase} v=${version} tier=${tier} err=${errMsg}`);

    // Record error in upgrade log — state already saved by prior tool calls
    if (cs) {
      this.setState({
        ...cs,
        upgradeLog: [...(cs.upgradeLog ?? []), {
          version,
          source: `ERROR:${phase}`,
          fieldsChanged: ["_error"],
          at: new Date().toISOString(),
        }],
      });
    }

    // Return structured error — parent parses via JSON.parse(err.message)
    return new Error(JSON.stringify({
      agent: "consultant",
      phase,
      version,
      highestCompletedTier: tier,
      retryable: this._isRetryable(errMsg),
      message: errMsg,
    }));
  }

  private _getHighestCompletedTier(cs: ConsultantState | null): string {
    if (!cs) return "none";
    if (cs.agentBriefs || cs.industryContext || cs.quoteInputs || cs.growthSignals) return "tier3";
    if (cs.scriptFills || cs.routing || cs.hooks) return "tier2";
    if (cs.businessProfile || cs.digitalPresence || cs.conversionFunnel) return "tier1";
    return "none";
  }

  private _isRetryable(msg: string): boolean {
    return /rate.?limit|429|timeout|ECONNRESET|503|overloaded/i.test(msg);
  }
```

**What this preserves:**

| Failure point | Without onChatError | With onChatError |
|---|---|---|
| Gemini rate-limit on pass 2 | Silent fail, stale analysis | Structured error, parent retries, pass-1 preserved |
| Timeout during Tier 3 | Generic error | Tier 1+2 preserved in state, parent uses partial |
| Model error mid-tool | Unknown error propagated | Phase/tier/retryability returned to parent |

---

## CHANGE 3 — consultant-agent.ts: Forced enrichment gate in beforeTurn

**SDK primitives used:**
- `TurnConfig.toolChoice: { type: "tool", toolName: string }` — forces specific tool call
- `TurnConfig.maxSteps: number` — limits steps per turn
- `TurnConfig.activeTools: string[]` — restricts available tools

**Message-level protocol:** Parent sends `[ENRICHMENT_PASS:source]` or `[PROSPECT_UPDATE:type]` prefix. beforeTurn detects this and forces gap assessment before releasing normal tools.

**Why message protocol:** Parent controls the message format. No ambiguity. The consultant doesn't need prompt instructions about "what to do on subsequent passes" — code FORCES the sequence.

**Location:** Replace entire `beforeTurn()` method (~line 66-78).

**BEFORE:**
```typescript
  async beforeTurn(ctx: any) {
    const cs = this.state as ConsultantState | null;
    const tier1 = ["analyzeBusinessProfile", "analyzeDigitalPresence", "analyzeConversionFunnel"];
    const tier2 = (cs?.businessProfile && cs?.digitalPresence && cs?.conversionFunnel)
      ? ["generateScriptFills", "routeAgents", "generateConversationHooks"]
      : [];
    const tier3 = ["analyzeIndustryContext", "identifyQuoteInputs", "assessGrowthOpportunities", "prepareAgentBriefs"];
    const tier2Done = !!(cs?.scriptFills && cs?.routing && cs?.hooks);
    const tier4 = tier2Done
      ? ["upgradeAnalysis", "assessAnalysisGaps", "writeAnalysisReport", "setAnalysisConfidence"]
      : ["assessAnalysisGaps"];
    return { activeTools: [...tier1, ...tier2, ...tier3, ...tier4] };
  }
```

**AFTER:**
```typescript
  // Instance fields for forced-gate tracking (reset on DO eviction — acceptable)
  private _enrichmentGapForced = false;
  private _completionForced = false;

  async beforeTurn(ctx: any) {
    const cs = this.state as ConsultantState | null;

    // ── DETECT PASS TYPE via message protocol ──
    const lastUserMsg = (ctx.messages ?? []).filter((m: any) => m.role === "user").pop();
    const msgText = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : (lastUserMsg?.content?.[0]?.text ?? "");
    const isEnrichment = msgText.startsWith("[ENRICHMENT_PASS:");
    const isProspectUpdate = msgText.startsWith("[PROSPECT_UPDATE:");
    const isSubsequentPass = isEnrichment || isProspectUpdate;

    // Reset gate flags on new external pass
    if (isSubsequentPass) {
      this._enrichmentGapForced = false;
      this._completionForced = false;
    }

    // ── FORCED GATE 1: Gap assessment on enrichment/prospect pass ──
    // Model MUST call assessAnalysisGaps before any other analysis.
    // toolChoice forces it. maxSteps=2 gives one react step after.
    if (isSubsequentPass && !this._enrichmentGapForced && cs && cs.analysisVersion > 0) {
      this._enrichmentGapForced = true;
      return {
        activeTools: ["assessAnalysisGaps", "search_context", "set_context"],
        toolChoice: { type: "tool", toolName: "assessAnalysisGaps" },
        maxSteps: 2,
      };
    }

    // ── FORCED GATE 2: Confidence + report on completion ──
    const tier2Done = !!(cs?.scriptFills && cs?.routing && cs?.hooks);
    const allTiersComplete = tier2Done && !!(cs?.industryContext && cs?.quoteInputs && cs?.growthSignals && cs?.agentBriefs);

    if (allTiersComplete && cs?.analysisConfidence === "low" && !this._completionForced) {
      this._completionForced = true;
      return {
        activeTools: ["setAnalysisConfidence", "writeAnalysisReport", "set_context"],
        toolChoice: { type: "tool", toolName: "setAnalysisConfidence" },
        maxSteps: 3,
      };
    }

    // ── NORMAL TIER ACTIVATION ──
    const tier1 = ["analyzeBusinessProfile", "analyzeDigitalPresence", "analyzeConversionFunnel"];
    const tier2 = (cs?.businessProfile && cs?.digitalPresence && cs?.conversionFunnel)
      ? ["generateScriptFills", "routeAgents", "generateConversationHooks"]
      : [];
    const tier3 = cs?.routing
      ? ["analyzeIndustryContext", "identifyQuoteInputs", "assessGrowthOpportunities", "prepareAgentBriefs"]
      : [];
    const tier4 = tier2Done
      ? ["upgradeAnalysis", "assessAnalysisGaps", "writeAnalysisReport", "setAnalysisConfidence"]
      : ["assessAnalysisGaps"];

    return { activeTools: [...tier1, ...tier2, ...tier3, ...tier4] };
  }
```

**Gate behavior:**

| Pass type | First turn | Subsequent turns |
|---|---|---|
| Initial (first chat) | Normal tier activation | Normal tier activation |
| Enrichment `[ENRICHMENT_PASS:deep_intel]` | FORCED assessAnalysisGaps (maxSteps=2) | Normal activation (gap flag set) |
| Prospect `[PROSPECT_UPDATE:acv]` | FORCED assessAnalysisGaps (maxSteps=2) | Normal activation |
| All tiers complete, confidence=low | FORCED setAnalysisConfidence (maxSteps=3) | Normal (completion flag set) |

---

## CHANGE 4 — consultant-agent.ts: Update onChatResponse for post-gate chaining

After forced gap assessment completes (maxSteps=2 turn ends), onChatResponse chains a full-power continuation.

**Location:** Replace `onChatResponse()` method (~line 458-478).

**BEFORE:**
```typescript
  async onChatResponse(result: any) {
    const cs = this.state as ConsultantState;
    const tier2Done = !!(cs?.scriptFills && cs?.routing && cs?.hooks);
    const tier3Incomplete = !cs?.industryContext || !cs?.quoteInputs || !cs?.growthSignals || !cs?.agentBriefs;
    const allTiersComplete = tier2Done && !tier3Incomplete;

    if (tier2Done && tier3Incomplete) {
      await this.saveMessages([{
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: "Continue: complete industry analysis, quote inputs, growth assessment, and agent briefs for all priority agents." }],
      }]);
    } else if (allTiersComplete && cs.analysisConfidence === "low") {
      // All tiers done — write report and self-rate confidence
      await this.saveMessages([{
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: "All tiers complete. Index key findings via set_context to findings, call writeAnalysisReport(format='full'), then call setAnalysisConfidence with your honest assessment." }],
      }]);
    }
  }
```

**AFTER:**
```typescript
  async onChatResponse(result: any) {
    const cs = this.state as ConsultantState;
    if (!cs) return;

    const tier2Done = !!(cs.scriptFills && cs.routing && cs.hooks);
    const tier3Incomplete = !cs.industryContext || !cs.quoteInputs || !cs.growthSignals || !cs.agentBriefs;
    const allTiersComplete = tier2Done && !tier3Incomplete;

    // Chain 1: Tier 2 done → continue to Tier 3
    if (tier2Done && tier3Incomplete) {
      await this.saveMessages([{
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: "Continue: complete industry analysis, quote inputs, growth assessment, and agent briefs for all priority agents." }],
      }]);
      return;
    }

    // Chain 2: Post-gap-assessment → continue with full analysis
    // (fires after forced gap assessment turn with maxSteps=2)
    if (this._enrichmentGapForced && !allTiersComplete) {
      await this.saveMessages([{
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: "Gaps assessed. Now upgrade analysis with the new data using upgradeAnalysis for each changed field." }],
      }]);
      return;
    }

    // Chain 3: All tiers complete → forced gate handles confidence+report via beforeTurn
    // (no saveMessages needed — beforeTurn toolChoice forces the sequence)
  }
```

**Key change:** Removed the "All tiers complete" saveMessages chain. That's now handled by FORCED GATE 2 in beforeTurn via `toolChoice`. Model MUST call setAnalysisConfidence — no philosophical suggestion.

---

## CHANGE 5 — bella-agent.ts: Extract mergeConsultantResult helper

Eliminates duplicate merge logic across runConsultantAnalysis/enrichConsultantAnalysis/updateConsultantFromProspect.

**Location:** After `runPendingCalculators()` method (~line 1141), before class closing brace.

**ADD:**
```typescript
  // ── Shared: merge consultant analysis into BellaAgent state ──────────────
  private mergeConsultantResult(cs: ConsultantState): void {
    const state = this.cs;
    if (!state) return;
    if (!state.intel.consultant) state.intel.consultant = {};
    const newIntel = mapConsultantStateToIntel(cs);
    state.intel.consultant = {
      ...state.intel.consultant,
      ...newIntel,
      icpAnalysis: {
        ...state.intel.consultant?.icpAnalysis,
        ...newIntel.icpAnalysis,
      },
    };
    state.intel.mergedVersion++;
    this.setState(state);
  }

  // ── Shared: handle structured consultant errors ──────────────────────────
  private _handleConsultantError(err: unknown, context: string): void {
    const errMsg = err instanceof Error ? err.message : String(err);
    let parsed: { retryable?: boolean; highestCompletedTier?: string; message?: string } | null = null;
    try { parsed = JSON.parse(errMsg); } catch {}

    if (parsed?.retryable) {
      console.warn(`[CONSULTANT_${context.toUpperCase()}] retryable error at ${parsed.highestCompletedTier}: ${parsed.message}`);
    } else {
      console.error(`[CONSULTANT_${context.toUpperCase()}] non-retryable: ${errMsg}`);
    }

    // Salvage: always try to read partial analysis
    this.ctx.waitUntil(
      (async () => {
        try {
          const child = await this.subAgent(ConsultantAgent, "consultant");
          const partial = await child.getAnalysis();
          if (partial && partial.analysisVersion > 0) {
            this.mergeConsultantResult(partial);
            await this._sessionRef?.refreshSystemPrompt?.();
            console.log(`[CONSULTANT_SALVAGE] merged partial v=${partial.analysisVersion} tier=${parsed?.highestCompletedTier ?? "unknown"}`);
          }
        } catch (e) {
          console.error(`[CONSULTANT_SALVAGE_FAIL]`, e);
        }
      })()
    );
  }
```

---

## CHANGE 6 — bella-agent.ts: Refactor runConsultantAnalysis

Add try/catch with structured error handling. Remove onError callback (let errors throw for catch). Use mergeConsultantResult helper.

**Location:** Replace `runConsultantAnalysis()` method (~line 797-830).

**BEFORE:**
```typescript
  // Patch 6: simple await child.chat() — no callback pattern
  async runConsultantAnalysis(intel: Record<string, any>) {
    const child = await this.subAgent(ConsultantAgent, "consultant");
    await child.chat(
      `Analyze this business for Bella's sales demo:\n${JSON.stringify(intel, null, 2)}`,
      {
        onEvent: () => {},
        onDone: () => {},
        onError: (error: string) => { console.error(`[CONSULTANT_ERR] ${error}`); },
      },
    );

    const cs = await child.getAnalysis();
    if (!cs) {
      console.warn('[CONSULTANT_DONE] child returned null state — skipping merge');
      return;
    }
    const state = this.cs;
    if (!state) return;
    if (!state.intel.consultant) state.intel.consultant = {};
    const newIntel = mapConsultantStateToIntel(cs);
    state.intel.consultant = {
      ...state.intel.consultant,
      ...newIntel,
      icpAnalysis: {
        ...state.intel.consultant?.icpAnalysis,
        ...newIntel.icpAnalysis,
      },
    };
    state.intel.mergedVersion++;
    this.setState(state);
    await this._sessionRef?.refreshSystemPrompt?.();
    console.log(`[CONSULTANT_DONE] mergedVersion=${state.intel.mergedVersion} scriptFills=${!!cs.scriptFills} routing=${!!cs.routing}`);
    this.ctx.waitUntil(this.runWowPrep().catch((e: any) => console.error(`[WOW_PREP_ERR] ${e.message}`)));
  }
```

**AFTER:**
```typescript
  async runConsultantAnalysis(intel: Record<string, any>) {
    const child = await this.subAgent(ConsultantAgent, "consultant");
    try {
      await child.chat(
        `Analyze this business for Bella's sales demo:\n${JSON.stringify(intel, null, 2)}`,
        { onEvent: () => {}, onDone: () => {} },
      );
      const cs = await child.getAnalysis();
      if (!cs) {
        console.warn("[CONSULTANT_DONE] null state — skipping merge");
        return;
      }
      this.mergeConsultantResult(cs);
      await this._sessionRef?.refreshSystemPrompt?.();
      console.log(`[CONSULTANT_DONE] v=${cs.analysisVersion} scriptFills=${!!cs.scriptFills} routing=${!!cs.routing}`);
      this.ctx.waitUntil(this.runWowPrep().catch((e: any) => console.error(`[WOW_PREP_ERR] ${e.message}`)));
    } catch (err) {
      this._handleConsultantError(err, "initial");
    }
  }
```

**Key changes:**
- Removed `onError` callback → errors now throw → try/catch handles them
- Inline merge replaced with `mergeConsultantResult()`
- Error handling via `_handleConsultantError()` with salvage logic

---

## CHANGE 7 — bella-agent.ts: Add enrichConsultantAnalysis

**Multi-pass paradigm:** Same DO instance, accumulated conversation history. Second chat() call adds to existing conversation. Model sees all prior analysis and can upgrade.

**Message protocol:** `[ENRICHMENT_PASS:deep_intel]` prefix triggers forced gap assessment in consultant's beforeTurn.

**Location:** After refactored `runConsultantAnalysis()`.

**ADD:**
```typescript
  async enrichConsultantAnalysis(deepIntel: Record<string, any>) {
    const child = await this.subAgent(ConsultantAgent, "consultant");
    try {
      await child.chat(
        `[ENRICHMENT_PASS:deep_intel] Deep intelligence arrived. Review and upgrade your analysis with this new data:\n${JSON.stringify(deepIntel, null, 2)}`,
        { onEvent: () => {}, onDone: () => {} },
      );
      const cs = await child.getAnalysis();
      if (!cs) return;
      this.mergeConsultantResult(cs);
      await this._sessionRef?.refreshSystemPrompt?.();
      console.log(`[CONSULTANT_ENRICHED] v=${cs.analysisVersion} confidence=${cs.analysisConfidence} routing=${cs.routing?.priority_agents}`);
      this.ctx.waitUntil(this.runWowPrep().catch((e: any) => console.error(`[WOW_PREP_ERR] ${e.message}`)));
    } catch (err) {
      this._handleConsultantError(err, "enrichment");
    }
  }
```

**Flow:**
1. Parent calls enrichConsultantAnalysis(deepIntel) when deep_ready fires
2. `this.subAgent(ConsultantAgent, "consultant")` → SAME DO as initial analysis (same name)
3. chat() with `[ENRICHMENT_PASS:deep_intel]` prefix → consultant's beforeTurn detects, FORCES assessAnalysisGaps
4. Consultant completes gap assessment → onChatResponse chains full analysis
5. Parent reads upgraded state, merges, refreshes prompt
6. Fires runWowPrep() to update WOW lines with richer data

---

## CHANGE 8 — bella-agent.ts: Add updateConsultantFromProspect

**Location:** After `enrichConsultantAnalysis()`.

**ADD:**
```typescript
  async updateConsultantFromProspect(dataType: string, value: string) {
    const child = await this.subAgent(ConsultantAgent, "consultant");
    try {
      await child.chat(
        `[PROSPECT_UPDATE:${dataType}] Prospect shared: "${value}". Update your analysis.`,
        { onEvent: () => {}, onDone: () => {} },
      );
      const cs = await child.getAnalysis();
      if (cs) {
        this.mergeConsultantResult(cs);
        await this._sessionRef?.refreshSystemPrompt?.();
        console.log(`[CONSULTANT_PROSPECT] v=${cs.analysisVersion} updated for ${dataType}`);
      }
    } catch (err) {
      // Non-critical — existing analysis still valid, just log
      console.warn(`[CONSULTANT_PROSPECT_FAIL] ${dataType}`, err instanceof Error ? err.message : err);
    }
  }
```

**Why lighter error handling:** Prospect updates are enhancements, not critical. If Gemini fails, existing analysis is still valid. No salvage needed.

---

## CHANGE 9 — bella-agent.ts: Wire receiveIntel("deep_ready") → enrichment

**Location:** Inside `receiveIntel()` method, after the existing runWowPrep call (~line 680-682).

**BEFORE:**
```typescript
    if (type === "deep_ready") {
      this.ctx.waitUntil(this.runWowPrep().catch((e: any) => console.error(`[WOW_PREP_ERR] ${e.message}`)));
    }
```

**AFTER:**
```typescript
    if (type === "deep_ready") {
      this.ctx.waitUntil(this.runWowPrep().catch((e: any) => console.error(`[WOW_PREP_ERR] ${e.message}`)));
      this.ctx.waitUntil(this.enrichConsultantAnalysis(payload).catch((e: any) => console.error(`[CONSULTANT_ENRICH_ERR] ${e.message}`)));
    }
```

**Both fire in parallel via ctx.waitUntil.** WOW prep uses existing intel. Consultant enrichment upgrades analysis with deep intel. When enrichment completes, it fires runWowPrep again (CHANGE 7) to update WOW lines with improved data.

---

## CHANGE 10 — bella-agent.ts: Wire extraction → updateConsultantFromProspect

**Location:** Inside `beforeTurn()`, after deterministicExtract and applyExtraction (~line 239-243).

**BEFORE:**
```typescript
      const deterministicResult = deterministicExtract(transcript, state.currentStage);
      if (Object.keys(deterministicResult).length > 0) {
        this.applyExtraction(state, deterministicResult);
        console.log(`[EXTRACT] keys=${Object.keys(deterministicResult).join(",")}`);
      }
```

**AFTER:**
```typescript
      const deterministicResult = deterministicExtract(transcript, state.currentStage);
      if (Object.keys(deterministicResult).length > 0) {
        this.applyExtraction(state, deterministicResult);
        console.log(`[EXTRACT] keys=${Object.keys(deterministicResult).join(",")}`);
        // Notify consultant of high-value prospect data (if consultant has already run)
        const highValueKeys = ["acv", "missed_calls", "after_hours", "old_leads", "oldLeads", "phone_volume", "phoneVolume"];
        const extracted = Object.keys(deterministicResult);
        const hasHighValue = extracted.some(k => highValueKeys.includes(k));
        if (hasHighValue && state.intel.consultant) {
          const dataDesc = extracted
            .filter(k => highValueKeys.includes(k))
            .map(k => `${k}=${JSON.stringify((deterministicResult as any)[k])}`)
            .join(", ");
          this.ctx.waitUntil(
            this.updateConsultantFromProspect("extraction", dataDesc)
              .catch((e: any) => console.error(`[CONSULTANT_UPDATE_ERR] ${e.message}`))
          );
        }
      }
```

**Gate:** `state.intel.consultant` check — only fires if consultant has already produced initial analysis. Prevents notification before consultant has run.

**High-value fields:** ACV, missed calls, after-hours, old leads, phone volume. These directly affect agent routing and ROI calculations. Low-value fields (timeframe, review system, etc.) do NOT trigger consultant updates.

---

## CHANGE 11 — worker.ts + package.json: Version bump

**BEFORE:**
```typescript
const VERSION = "3.11.28-think";
```
**AFTER:**
```typescript
const VERSION = "3.11.29-think";
```

Also bump `package.json` `"version"` to `"3.11.29-think"`.

---

## ACCEPTANCE CRITERIA

### Must pass:
- [ ] `tsc --noEmit` exits 0
- [ ] ConsultantAgent has `onChatError()` method returning structured Error with JSON message
- [ ] ConsultantAgent has `_getHighestCompletedTier()` + `_isRetryable()` private methods
- [ ] ConsultantAgent beforeTurn detects `[ENRICHMENT_PASS:` and `[PROSPECT_UPDATE:` message prefixes
- [ ] ConsultantAgent beforeTurn FORCES assessAnalysisGaps via `toolChoice` on enrichment pass
- [ ] ConsultantAgent beforeTurn FORCES setAnalysisConfidence via `toolChoice` when all tiers complete + confidence=low
- [ ] "task" context block reads R2 `consultant-prompts/system.md` with CONSULTANT_PROMPT_FALLBACK fallback
- [ ] BellaAgent has `mergeConsultantResult()` private helper
- [ ] BellaAgent has `_handleConsultantError()` private helper with salvage logic
- [ ] BellaAgent `runConsultantAnalysis()` uses try/catch (no onError callback)
- [ ] BellaAgent has `enrichConsultantAnalysis(deepIntel)` method with `[ENRICHMENT_PASS:deep_intel]` prefix
- [ ] BellaAgent has `updateConsultantFromProspect(dataType, value)` method with `[PROSPECT_UPDATE:]` prefix
- [ ] `receiveIntel("deep_ready")` fires enrichConsultantAnalysis(payload) via ctx.waitUntil
- [ ] Extraction of high-value fields fires updateConsultantFromProspect when `state.intel.consultant` exists
- [ ] VERSION = "3.11.29-think" in worker.ts AND package.json
- [ ] R2 file `consultant-prompts/system.md` uploaded to `bella-agent-kb` bucket

### Must NOT:
- [ ] No changes to tool Zod schemas (those are S5-F scope for tool 15)
- [ ] No @callable decorators (S5-D scope)
- [ ] No session.addContext() calls (S5-D scope)
- [ ] No configure()/getConfig() calls (S5-D scope)
- [ ] No changes to types.ts (existing ConsultantState sufficient)

---

## WHAT'S NOW GATED vs PHILOSOPHICAL

| Behavior | Before S5-C | After S5-C |
|---|---|---|
| "Assess gaps on enrichment" | Prompt instruction | **FORCED** via toolChoice |
| "Set confidence after completion" | saveMessages suggestion | **FORCED** via toolChoice |
| "Write report at end" | saveMessages suggestion | **FORCED** (follows confidence via maxSteps=3) |
| Tier ordering | **FORCED** via beforeToolCall ✅ | No change |
| Loop detection | **FORCED** via onStepFinish ✅ | No change |
| Error preservation | None — silent fail | **FORCED** via onChatError structured return |
| Prompt content | Hardcoded const | **R2 file** — editable without redeploy |

---

## SPRINT DEPENDENCY CHAIN (updated)

```
S5-A ✅ State + Tools 11-14 + Defensive Hooks
S5-B ✅ AgentSearchProvider + Findings Context
S5-C ← THIS: Multi-pass + Error + Forced Gates + R2 Prompt
S5-D: @callable injection + configure() + session.addContext()
S5-E: Public getters + waitUntilStable exposure
S5-F: Session branching + branchAndCompareRouting (tool 15)
```

S5-D through S5-F remain unchanged by this spec. S5-C provides the integration surface (enrichConsultantAnalysis, updateConsultantFromProspect) that S5-D's @callable methods will enhance with direct state injection.
