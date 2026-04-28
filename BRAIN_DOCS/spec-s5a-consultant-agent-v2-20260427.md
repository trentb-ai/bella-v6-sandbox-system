# S5-A Spec — ConsultantAgent v2 State + Tools 11-14 + Defensive Hooks
**Date:** 2026-04-27 AEST | **Author:** T2 | **Worker:** bella-think-agent-v1-brain
**Target version:** 3.11.27-think | **Base commit:** c9dcbc0 (S3-G)
**T9 pre-approval:** CONDITIONAL GO (all 3 conditions resolved)

---

## PRE-FLIGHT CHECKLIST (T4 must verify before touching code)

- [ ] wrangler.toml `main` = `src/worker.ts` (or wherever — confirm with T5)
- [ ] Delete any stale `dist/` or `.js` shadow files if present
- [ ] Confirm on commit c9dcbc0 or clean working tree from it

---

## CHANGE 1 — `src/types.ts`: Add 4 fields to ConsultantState

**Location:** After `agentBriefs` field (currently line ~251), before closing `}`

**BEFORE** (end of ConsultantState):
```typescript
  agentBriefs: Partial<Record<AgentName, AgentBrief>> | null;
}
```

**AFTER:**
```typescript
  agentBriefs: Partial<Record<AgentName, AgentBrief>> | null;
  // v2 fields
  analysisPhase: "initial" | "enriched" | "prospect_updated";
  dataSourcesProcessed: string[];
  analysisConfidence: "low" | "medium" | "high";
  upgradeLog: Array<{ version: number; source: string; fieldsChanged: string[]; at: string }>;
}
```

---

## CHANGE 2 — `src/consultant-agent.ts`: Update initialState

**Location:** Inside `initialState` object (lines 13-26)

**BEFORE** (end of initialState):
```typescript
    growthSignals: null,
    agentBriefs: null,
  };
```

**AFTER:**
```typescript
    growthSignals: null,
    agentBriefs: null,
    analysisPhase: "initial",
    dataSourcesProcessed: [],
    analysisConfidence: "low",
    upgradeLog: [],
  };
```

---

## CHANGE 3 — `src/consultant-agent.ts`: Add .strict() to 3 existing schemas

**T5 pre-read required** — exact line numbers below are approximate from S3-G. T4 must verify exact lines.

### 3a. ctaAgentMapping (~line 127)
Find the line containing `.partial()` inside the `analyzeConversionFunnel` tool schema for `ctaAgentMapping`.

**BEFORE:**
```typescript
            ctaAgentMapping: z.object({ alex: z.string(), chris: z.string(), maddie: z.string(), sarah: z.string(), james: z.string() }).partial(),
```
**AFTER:**
```typescript
            ctaAgentMapping: z.object({ alex: z.string(), chris: z.string(), maddie: z.string(), sarah: z.string(), james: z.string() }).partial().strict(),
```

### 3b. agentFit (~line 224)
Find `.partial()` inside `analyzeIndustryContext` tool schema for `agentFit`.

**BEFORE:**
```typescript
            agentFit: z.object({ alex: z.string(), chris: z.string(), maddie: z.string(), sarah: z.string(), james: z.string() }).partial(),
```
**AFTER:**
```typescript
            agentFit: z.object({ alex: z.string(), chris: z.string(), maddie: z.string(), sarah: z.string(), james: z.string() }).partial().strict(),
```

### 3c. briefs (~lines 279-284)
Find the `.partial()` at the END of the `prepareAgentBriefs` tool schema for `briefs`.

**BEFORE:**
```typescript
          }).partial(),
```
(the `.partial()` closing the outer `z.object({alex:..., chris:..., maddie:..., sarah:..., james:...})`)

**AFTER:**
```typescript
          }).partial().strict(),
```

---

## CHANGE 4 — `src/consultant-agent.ts`: Add tools 11-14

**Location:** After `prepareAgentBriefs` tool (after the closing `},` at ~line 295), still inside the `return { ... }` of `getTools()`.

Add the following 4 tools:

```typescript
      upgradeAnalysis: tool({
        description: "Upgrade analysis with new data. Deep-merge new fields into existing tiers. Use when enriched intel or prospect data arrives post-initial-analysis.",
        inputSchema: z.object({
          source: z.string().describe("Data source identifier: 'deep_intel' | 'prospect_verbal' | 'manual'"),
          tier: z.enum(["businessProfile", "digitalPresence", "conversionFunnel", "scriptFills", "routing", "industryContext", "quoteInputs", "growthSignals", "agentBriefs"]),
          newData: z.record(z.string(), z.unknown()).describe("Fields to merge into the tier. Send complete replacement objects — shallow merge applied."),
          fieldsChanged: z.array(z.string()).describe("List of field names being updated"),
        }),
        execute: async (args) => {
          const cs = this.state as ConsultantState;
          const existing = (cs as any)[args.tier] ?? {};
          // Shallow merge — model must send complete replacement objects for nested fields
          const merged = { ...existing, ...args.newData };
          const entry = { version: cs.analysisVersion + 1, source: args.source, fieldsChanged: args.fieldsChanged, at: new Date().toISOString() };
          this.setState({
            ...cs,
            [args.tier]: merged,
            analysisVersion: cs.analysisVersion + 1,
            analysisPhase: args.source === "prospect_verbal" ? "prospect_updated" : "enriched",
            dataSourcesProcessed: [...(cs.dataSourcesProcessed ?? []), args.source],
            upgradeLog: [...(cs.upgradeLog ?? []), entry],
          });
          return { status: "ok", tier: args.tier, version: cs.analysisVersion + 1 };
        },
      }),

      assessAnalysisGaps: tool({
        description: "Self-diagnostic: identify which tiers are incomplete, null, or low-confidence. Call before writing report or when unsure what to analyse next.",
        inputSchema: z.object({}),
        execute: async () => {
          const cs = this.state as ConsultantState;
          const gaps: string[] = [];
          if (!cs.businessProfile) gaps.push("businessProfile: null");
          if (!cs.digitalPresence) gaps.push("digitalPresence: null");
          if (!cs.conversionFunnel) gaps.push("conversionFunnel: null");
          if (!cs.scriptFills) gaps.push("scriptFills: null");
          if (!cs.routing) gaps.push("routing: null");
          if (!cs.hooks) gaps.push("hooks: null");
          if (!cs.industryContext) gaps.push("industryContext: null");
          if (!cs.quoteInputs) gaps.push("quoteInputs: null");
          if (!cs.growthSignals) gaps.push("growthSignals: null");
          if (!cs.agentBriefs) gaps.push("agentBriefs: null");
          return {
            gaps,
            complete: gaps.length === 0,
            analysisVersion: cs.analysisVersion,
            analysisPhase: cs.analysisPhase,
            confidence: cs.analysisConfidence,
          };
        },
      }),

      writeAnalysisReport: tool({
        description: "Write a structured analysis report to workspace. Call after all tiers complete. Report is readable by parent agent via workspace.readFile().",
        inputSchema: z.object({
          format: z.enum(["full", "brief"]).default("full").describe("full = all tiers + upgrade log. brief = routing + script fills + hooks only."),
        }),
        execute: async (args) => {
          const cs = this.state as ConsultantState;
          const report = JSON.stringify({
            leadId: cs.leadId,
            analysisVersion: cs.analysisVersion,
            analysisPhase: cs.analysisPhase,
            analysisConfidence: cs.analysisConfidence,
            dataSourcesProcessed: cs.dataSourcesProcessed,
            ...(args.format === "full" ? {
              businessProfile: cs.businessProfile,
              digitalPresence: cs.digitalPresence,
              conversionFunnel: cs.conversionFunnel,
              scriptFills: cs.scriptFills,
              routing: cs.routing,
              hooks: cs.hooks,
              industryContext: cs.industryContext,
              quoteInputs: cs.quoteInputs,
              growthSignals: cs.growthSignals,
              agentBriefs: cs.agentBriefs,
              upgradeLog: cs.upgradeLog,
            } : {
              routing: cs.routing,
              scriptFills: cs.scriptFills,
              hooks: cs.hooks,
            }),
          }, null, 2);
          const path = `analysis-${cs.leadId}-v${cs.analysisVersion}.json`;
          await this.workspace.writeFile(path, report);
          return { status: "ok", path, bytes: report.length };
        },
      }),

      setAnalysisConfidence: tool({
        description: "Set your confidence in the current analysis. Call after completing each tier group or after upgrade. Used by parent to decide whether to request enrichment.",
        inputSchema: z.object({
          confidence: z.enum(["low", "medium", "high"]),
          reason: z.string().describe("One sentence: why this confidence level."),
        }),
        execute: async (args) => {
          const cs = this.state as ConsultantState;
          this.setState({ ...cs, analysisConfidence: args.confidence });
          return { status: "ok", confidence: args.confidence };
        },
      }),
```

---

## CHANGE 5 — `src/consultant-agent.ts`: Add beforeToolCall()

**Location:** After the closing `}` of `getTools()`, before `getAnalysis()`.

```typescript
  async beforeToolCall(ctx: any): Promise<any> {
    const cs = this.state as ConsultantState;
    // Tier gating: block Tier 2 tools until Tier 1 complete
    const tier2Tools = ["generateScriptFills", "routeAgents", "generateConversationHooks"];
    const tier3Tools = ["analyzeIndustryContext", "identifyQuoteInputs", "assessGrowthOpportunities", "prepareAgentBriefs"];
    const tier1Done = !!(cs?.businessProfile && cs?.digitalPresence && cs?.conversionFunnel);
    const tier2Done = !!(cs?.scriptFills && cs?.routing && cs?.hooks);

    if (tier2Tools.includes(ctx.toolName) && !tier1Done) {
      return { action: "block", reason: "Tier 1 incomplete — run analyzeBusinessProfile, analyzeDigitalPresence, analyzeConversionFunnel first." };
    }
    if (tier3Tools.includes(ctx.toolName) && !tier2Done) {
      return { action: "block", reason: "Tier 2 incomplete — run generateScriptFills, routeAgents, generateConversationHooks first." };
    }
    // allow = return void
  }
```

---

## CHANGE 6 — `src/consultant-agent.ts`: Add onStepFinish()

**Location:** After `beforeToolCall()`.

```typescript
  // Instance field — resets on DO eviction (acceptable: loop detection is optimization, not correctness)
  private _consecutiveToolCounts: Map<string, number> = new Map();

  async onStepFinish(ctx: any): Promise<void> {
    const cs = this.state as ConsultantState;
    // Loop detection: 3 consecutive identical tool calls → inject course correction
    if (ctx.toolCalls && ctx.toolCalls.length > 0) {
      for (const call of ctx.toolCalls) {
        const count = (this._consecutiveToolCounts.get(call.toolName) ?? 0) + 1;
        this._consecutiveToolCounts.set(call.toolName, count);
        if (count >= 3) {
          console.warn(`[CONSULTANT] loop detected: ${call.toolName} called ${count}x consecutively | lead=${cs?.leadId}`);
          this._consecutiveToolCounts.clear();
          await this.saveMessages([{
            id: crypto.randomUUID(),
            role: "user",
            parts: [{ type: "text", text: `You have called ${call.toolName} ${count} times in a row. Stop repeating. Review assessAnalysisGaps to find what is genuinely missing, then proceed.` }],
          }]);
          return;
        }
      }
    } else {
      // Non-tool step: reset consecutive counts
      this._consecutiveToolCounts.clear();
    }
    console.log(`[CONSULTANT] step | tools=${ctx.toolCalls?.length ?? 0} lead=${cs?.leadId} v=${cs?.analysisVersion}`);
  }
```

---

## CHANGE 7 — `src/consultant-agent.ts`: Update onChatResponse()

**BEFORE** (current lines 303-315):
```typescript
  async onChatResponse(result: any) {
    const cs = this.state as ConsultantState;
    const tier2Done = !!(cs?.scriptFills && cs?.routing && cs?.hooks);
    const tier3Incomplete = !cs?.industryContext || !cs?.quoteInputs || !cs?.growthSignals || !cs?.agentBriefs;

    if (tier2Done && tier3Incomplete) {
      await this.saveMessages([{
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: "Continue: complete industry analysis, quote inputs, growth assessment, and agent briefs for all priority agents." }],
      }]);
    }
  }
```

**AFTER:**
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
        parts: [{ type: "text", text: "All tiers complete. Call writeAnalysisReport(format='full'), then call setAnalysisConfidence with your honest assessment." }],
      }]);
    }
  }
```

---

## CHANGE 9 — `src/consultant-agent.ts`: Update beforeTurn() to expose tools 11-14

**Location:** `beforeTurn()` return statement (~line 67). Add tools 11-14 to `activeTools`.

**BEFORE:**
```typescript
    return { activeTools: [...tier1, ...tier2, ...tier3] };
```

**AFTER:**
```typescript
    const tier2Done = !!(cs?.scriptFills && cs?.routing && cs?.hooks);
    const tier4 = tier2Done
      ? ["upgradeAnalysis", "assessAnalysisGaps", "writeAnalysisReport", "setAnalysisConfidence"]
      : ["assessAnalysisGaps"];
    return { activeTools: [...tier1, ...tier2, ...tier3, ...tier4] };
```

---

## CHANGE 8 — `src/worker.ts`: Version bump

**BEFORE:**
```typescript
const VERSION = "3.11.26-think";
```
**AFTER:**
```typescript
const VERSION = "3.11.27-think";
```

Also bump `package.json` `"version"` field to `"3.11.27-think"`.

---

## ACCEPTANCE CRITERIA

- [ ] `tsc --noEmit` exits 0
- [ ] All 4 new tools present in `getTools()` return object
- [ ] `beforeTurn()` tier4 gated behind tier2Done — upgradeAnalysis/writeReport/setConfidence locked until tier2 complete; assessAnalysisGaps always exposed
- [ ] `onChatResponse()` confidence condition is `=== "low"` (not `!== "high"`)
- [ ] `beforeToolCall()` blocks tier2 tools when tier1 incomplete
- [ ] `beforeToolCall()` tier3 block reason says "generateScriptFills" (not "fillScriptFields")
- [ ] `upgradeAnalysis` tier enum excludes "hooks" (array type — spread unsafe)
- [ ] `onStepFinish()` uses `ctx.toolCalls` (not `ctx.tools`)
- [ ] `onChatResponse()` triggers writeAnalysisReport when all tiers done
- [ ] `.strict()` on all 3 existing .partial() schemas
- [ ] `initialState` has all 4 new fields
- [ ] `ConsultantState` in types.ts has all 4 new fields
- [ ] VERSION = "3.11.27-think" in worker.ts AND package.json

---

## NOTES

- `upgradeAnalysis` uses **shallow merge** intentionally. Model must send complete replacement objects for nested fields. Code comment included.
- `_consecutiveToolCounts` is a private instance field (not state). Resets on DO eviction — acceptable because loop detection is optimization, not correctness.
- `beforeToolCall` returns `void` to allow (not explicit `{ action: "allow" }`). Returns block object to block.
- `writeFile(path, content)` — canonical sig from skills .d.ts. No mimeType param.
- `ctx.toolCalls` — confirmed from think.d.ts StepContext (T5 verified).
