# M1 Consultant Merge — Think-Native Implementation Spec
## 2026-04-29 AEST | Authority: Trent Belasco | Architect: T9
## D1 ID: spec-m1-consultant-merge-think-native-20260429

---

## DECISION

Port all 4 parallel Gemini micro-calls from `bella-consultant/worker.js` into a **Think tool** (`runFastAnalysis`) on `ConsultantAgent`. Entirely Think-native — no @callable RPC, no standalone worker. BellaAgent triggers via `chat()` message protocol. Standalone worker stays alive as fallback until M2 cut.

**Trent GO:** 2026-04-28. "Think native always — its law."

---

## ARCHITECTURE

```
fast-intel Event POST → BellaAgent.receiveIntel("fast_intel_ready", payload)
  → child = this.subAgent(ConsultantAgent, "consultant")
  → child.chat("[FAST_ANALYSIS] {scrapePayload}", callback)
    → ConsultantAgent.beforeTurn() detects [FAST_ANALYSIS] prefix
      → returns { toolChoice: { type: "tool", toolName: "runFastAnalysis" }, maxSteps: 6 }
    → Model forced to call runFastAnalysis tool
    → execute() runs Promise.all of 4 generateText() calls
    → execute() calls this.setState() populating all tiers
    → afterToolCall fires (observability)
    → onStepFinish fires (loop detection)
    → Model may optionally call Tier 2+ tools in remaining steps
  → child.chat() resolves
  → BellaAgent calls child.getAnalysis() → mergeConsultantResult()
  → refreshSystemPrompt()
```

**Why tool, not @callable:**
- Tools fire `beforeToolCall()` + `afterToolCall()` + `onStepFinish()` — full Think hook pipeline
- @callable bypasses all hooks — invisible to observability
- Tool results feed back to model — model can chain to Tier 2 tools in same turn
- `toolChoice` forcing via `beforeTurn()` is documented pattern (think.d.ts L88-92)
- LAW 10: Think-native means using Think primitives, not raw RPC

**SDK evidence:**
- `beforeTurn()` returns `TurnConfig` including `toolChoice` (think.d.ts L88-92)
- `toolChoice: { type: "tool", toolName: string }` forces specific tool (think.d.ts L96-101)
- `tool()` `execute()` supports `Promise.all` internally — SDK wraps with single `await` (think.d.ts L576-608)
- `hookTimeout` applies to hooks only, not tool execution (think.d.ts L557)
- `chat()` for sub-agent invocation (think.d.ts L647-651, sub-agents.md)
- `getTools()` merges custom tools with workspace tools (tools.md L2-16, L60-112)

---

## FILES CHANGED

| File | Change |
|------|--------|
| `consultant-agent.ts` | Add `runFastAnalysis` tool + 4 private prompt builder methods + `beforeTurn()` fast-analysis detection |
| `bella-agent.ts` | Modify `runConsultantAnalysis()` to send `[FAST_ANALYSIS]` message + read back state |
| `types.ts` | No changes — all types already exist |

---

## M1-A: `runFastAnalysis` TOOL ON CONSULTANT-AGENT.TS

### Location: `getTools()` method (consultant-agent.ts L149-546)

Add `runFastAnalysis` as FIRST tool in the returned object. This is a composite tool — its `execute()` runs 4 parallel `generateText()` calls using AI SDK, then populates all tier state.

### BEFORE (getTools returns):
```typescript
getTools() {
  return {
    analyzeBusinessProfile: tool({ ... }),
    // ... 15 existing tools
  };
}
```

### AFTER (add runFastAnalysis as first tool):
```typescript
getTools() {
  return {
    runFastAnalysis: tool({
      description: "Run parallel fast analysis on raw scrape data. Call this first on initial analysis — it runs 4 Gemini micro-calls in parallel and populates all analysis tiers. Input is the raw scrape payload from fast-intel.",
      inputSchema: z.object({
        payload: z.string().describe("JSON-stringified scrape payload from fast-intel"),
      }),
      execute: async ({ payload }) => {
        const p = JSON.parse(payload);
        const google = createGoogleGenerativeAI({ apiKey: this.env.GEMINI_API_KEY });
        const model = google("gemini-2.5-flash");

        const t0 = Date.now();
        const [rICP, rConversion, rCopy, rResearch] = await Promise.all([
          generateText({ model, prompt: this._buildPromptICP(p), maxTokens: 16000, temperature: 0.7 })
            .then(r => this._parseJSON(r.text, "icp"))
            .catch(e => { console.error(`[FAST_ANALYSIS] icp failed: ${e.message}`); return {}; }),
          generateText({ model, prompt: this._buildPromptConversion(p), maxTokens: 16000, temperature: 0.7 })
            .then(r => this._parseJSON(r.text, "conversion"))
            .catch(e => { console.error(`[FAST_ANALYSIS] conversion failed: ${e.message}`); return {}; }),
          generateText({ model, prompt: this._buildPromptCopy(p), maxTokens: 16000, temperature: 0.7 })
            .then(r => this._parseJSON(r.text, "copy"))
            .catch(e => { console.error(`[FAST_ANALYSIS] copy failed: ${e.message}`); return {}; }),
          generateText({ model, prompt: this._buildPromptResearch(p), maxTokens: 16000, temperature: 0.7 })
            .then(r => this._parseJSON(r.text, "research"))
            .catch(e => { console.error(`[FAST_ANALYSIS] research failed: ${e.message}`); return {}; }),
        ]);
        const elapsed = Date.now() - t0;

        const allFailed = !rICP.icpAnalysis && !rConversion.conversionEventAnalysis
          && !rCopy.businessIdentity && !rResearch.hiringAnalysis;
        if (allFailed) {
          console.error(`[FAST_ANALYSIS] ALL micro-calls failed in ${elapsed}ms`);
          return { status: "all_failed", elapsed };
        }

        // Map micro-call results → ConsultantState tiers
        const cs = (this.state as ConsultantState) ?? { ...this.initialState };

        // Tier 1: BusinessProfile from copy result
        if (rCopy.businessIdentity) {
          cs.businessProfile = {
            businessName: rCopy.businessIdentity.correctedName ?? rCopy.businessIdentity.spokenName ?? null,
            industry: rCopy.businessIdentity.industry ?? null,
            location: rCopy.businessIdentity.serviceArea ?? null,
            businessAge: null,
            sizeSignals: null,
            primaryServices: rCopy.valuePropAnalysis?.statedBenefits ?? [],
            targetMarket: rICP?.icpAnalysis?.whoTheyTarget ?? null,
            marketPosition: rICP?.positioning?.summary ?? null,
            uniqueValueProp: rCopy.valuePropAnalysis?.strongestBenefit ?? null,
          };
        }

        // Tier 1: DigitalPresence from payload flags
        cs.digitalPresence = {
          hasAds: !!(p.flags?.is_running_ads || p.flags?.has_fb_pixel || p.flags?.has_google_ads),
          adPlatforms: [
            ...(p.flags?.has_fb_pixel ? ["facebook"] : []),
            ...(p.flags?.has_google_ads ? ["google"] : []),
          ],
          hasFbPixel: !!p.flags?.has_fb_pixel,
          hasGoogleAds: !!p.flags?.has_google_ads,
          hasCrm: !p.flags?.no_crm,
          hasBooking: rConversion?.conversionEventAnalysis?.ctaType === "booking",
          hasChat: !p.flags?.no_chat,
          socialChannels: [],
          seoStrength: null,
          techStackNotes: null,
        };

        // Tier 1: ConversionFunnel from conversion result
        if (rConversion.conversionEventAnalysis) {
          const ce = rConversion.conversionEventAnalysis;
          cs.conversionFunnel = {
            primaryCTA: ce.primaryCTA ?? null,
            ctaType: ce.ctaType ?? null,
            allConversionEvents: ce.allConversionEvents ?? [],
            ctaBreakdown: (ce.ctaBreakdown ?? []).map((c: any, i: number) => ({
              action: c.cta ?? c.action ?? "",
              location: c.location ?? "unknown",
              agent: c.agent ?? "",
              priority: c.priority ?? i + 1,
            })),
            ctaAgentMapping: typeof ce.ctaAgentMapping === "string"
              ? {}
              : (ce.ctaAgentMapping ?? {}),
            conversionNarrative: ce.conversionNarrative ?? null,
            agentTrainingLine: ce.agentTrainingLine ?? null,
            funnelQuality: ce.conversionStrength ?? null,
          };
        }

        // Tier 2: ScriptFills from copy result
        if (rCopy.scriptFills) {
          cs.scriptFills = {
            hero_header_quote: rCopy.scriptFills.hero_header_quote ?? null,
            website_positive_comment: rCopy.scriptFills.website_positive_comment ?? null,
            icp_guess: rCopy.scriptFills.icp_guess ?? null,
            reference_offer: rCopy.scriptFills.reference_offer ?? null,
            bella_opener: rCopy.scriptFills.bella_opener ?? null,
            recent_review_snippet: rCopy.scriptFills.recent_review_snippet ?? null,
            icpNarrative: rICP?.icpAnalysis?.icpNarrative ?? null,
            bellaCheckLine: rICP?.icpAnalysis?.bellaCheckLine ?? null,
            conversionNarrative: rConversion?.conversionEventAnalysis?.conversionNarrative ?? null,
          };
        }

        // Tier 2: AgentRouting from conversion result
        if (rConversion.routing) {
          cs.routing = {
            priority_agents: (rConversion.routing.priority_agents ?? []) as AgentName[],
            reasoning: rConversion.routing.reasoning ?? {},
            exclusions: {},
            confidence: "medium",
          };
        }

        // Tier 2: ConversationHooks from research result
        if (rResearch.conversationHooks) {
          cs.hooks = (rResearch.conversationHooks ?? []).map((h: any) => ({
            topic: h.topic ?? "",
            how: h.how ?? "",
            agent: null,
            tier: "wow" as const,
          }));
        }

        // Tier 3: GrowthSignals from research result
        if (rResearch.hiringAnalysis) {
          cs.growthSignals = {
            isHiring: (rResearch.hiringAnalysis.matchedRoles?.length ?? 0) > 0,
            hiringRoles: (rResearch.hiringAnalysis.matchedRoles ?? []).map((r: any) => r.jobTitle),
            hiringWedge: rResearch.hiringAnalysis.topHiringWedge ?? null,
            expansionIndicators: [],
            investmentSignals: [],
            growthPhase: "unknown",
          };
        }

        cs.analysisVersion = (cs.analysisVersion ?? 0) + 1;
        cs.analysisPhase = "initial";
        cs.analysisConfidence = "medium";
        cs.dataSourcesProcessed = [...(cs.dataSourcesProcessed ?? []), "fast_analysis"];
        cs.upgradeLog = [
          ...(cs.upgradeLog ?? []),
          {
            version: cs.analysisVersion,
            source: "runFastAnalysis",
            fieldsChanged: [
              rCopy.businessIdentity ? "businessProfile" : null,
              "digitalPresence",
              rConversion.conversionEventAnalysis ? "conversionFunnel" : null,
              rCopy.scriptFills ? "scriptFills" : null,
              rConversion.routing ? "routing" : null,
              rResearch.conversationHooks ? "hooks" : null,
              rResearch.hiringAnalysis ? "growthSignals" : null,
            ].filter(Boolean) as string[],
            at: new Date().toISOString(),
          },
        ];

        this.setState(cs);

        const sliceStatus = [
          `icp=${!!rICP.icpAnalysis}`,
          `conversion=${!!rConversion.conversionEventAnalysis}`,
          `copy=${!!rCopy.businessIdentity}`,
          `research=${!!rResearch.hiringAnalysis}`,
        ].join(" ");

        console.log(`[FAST_ANALYSIS] done elapsed=${elapsed}ms ${sliceStatus} v=${cs.analysisVersion}`);

        return {
          status: "ok",
          elapsed,
          version: cs.analysisVersion,
          slices: { icp: !!rICP.icpAnalysis, conversion: !!rConversion.conversionEventAnalysis, copy: !!rCopy.businessIdentity, research: !!rResearch.hiringAnalysis },
          routing: cs.routing?.priority_agents ?? [],
        };
      },
    }),

    analyzeBusinessProfile: tool({ ... }),
    // ... existing 15 tools unchanged
  };
}
```

### Private helper: `_parseJSON`

Add after `getTools()` method, before `beforeToolCall()`:

```typescript
private _parseJSON(text: string, sliceName: string): Record<string, any> {
  if (!text) {
    console.warn(`[FAST_ANALYSIS] ${sliceName} empty response`);
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0].replace(/,\s*([\]}])/g, "$1"));
      } catch { /* fall through */ }
    }
    console.warn(`[FAST_ANALYSIS] ${sliceName} JSON parse failed`);
    return {};
  }
}
```

This mirrors the JSON repair logic from worker.js `callMicro()` (L234-264).

---

## M1-B: 4 PRIVATE PROMPT BUILDER METHODS ON CONSULTANT-AGENT.TS

### Location: After `_parseJSON`, before `beforeToolCall()`

Port **verbatim** from `bella-consultant/worker.js`. These are private methods — not tools, not callables. The model never sees them. Only `runFastAnalysis.execute()` calls them.

```typescript
private _buildPromptICP(p: Record<string, any>): string {
  // PORT VERBATIM from worker.js L283-348 (buildPromptICP)
  return `You are Bella's ICP and Market Intelligence Analyst...`;
}

private _buildPromptConversion(p: Record<string, any>): string {
  // PORT VERBATIM from worker.js L350-494 (buildPromptConversion)
  return `You are Bella's Conversion Intelligence Analyst...`;
}

private _buildPromptCopy(p: Record<string, any>): string {
  // PORT VERBATIM from worker.js L496-537 (buildPromptCopy)
  return `You are Bella's Copy and Identity Analyst...`;
}

private _buildPromptResearch(p: Record<string, any>): string {
  // PORT VERBATIM from worker.js L539-641 (buildPromptResearch)
  return `You are Bella's Research and Opportunity Analyst...`;
}
```

**CRITICAL: Port verbatim.** LAW: Never replace working code. Every prompt line, every field name, every instruction — exact copy. The only change is wrapping in `private _method(p: Record<string, any>): string` signature and using `${JSON.stringify(p, null, 2)}` for the prospect data injection (identical to worker.js).

**Note on buildPromptCopy:** Worker.js passes `responseFormat: { type: "json_schema", json_schema: { ... } }` to `callMicro()` for this slice (L758-839). Since `generateText()` doesn't use OpenAI-compat response_format, the copy prompt must include explicit JSON structure instructions in the prompt text itself. The existing prompt at L496-537 already ends with "Return ONLY the JSON with all required fields." — the json_schema was an additional enforcement layer. For Think-native, the prompt text instruction is sufficient because:
1. The prompt already specifies exact JSON shape
2. `generateText()` returns raw text which `_parseJSON` handles
3. If structured output is needed later, add Zod schema to generateText `schema` param (AI SDK feature)

---

## M1-C: BEFORETURN FAST-ANALYSIS DETECTION

### Location: `beforeTurn()` (consultant-agent.ts L88-147)

Add detection for `[FAST_ANALYSIS]` message prefix. This is a NEW gate that fires BEFORE existing enrichment/prospect gates.

### BEFORE (L88-99):
```typescript
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
```

### AFTER (add fast-analysis detection):
```typescript
async beforeTurn(ctx: any) {
  const cs = this.state as ConsultantState | null;

  // ── DETECT PASS TYPE via message protocol ──
  const lastUserMsg = (ctx.messages ?? []).filter((m: any) => m.role === "user").pop();
  const msgText = typeof lastUserMsg?.content === "string"
    ? lastUserMsg.content
    : (lastUserMsg?.content?.[0]?.text ?? "");
  const isFastAnalysis = msgText.startsWith("[FAST_ANALYSIS]");
  const isEnrichment = msgText.startsWith("[ENRICHMENT_PASS:");
  const isProspectUpdate = msgText.startsWith("[PROSPECT_UPDATE:");
  const isSubsequentPass = isEnrichment || isProspectUpdate;

  // ── FORCED GATE 0: Fast analysis on initial scrape data ──
  // Model MUST call runFastAnalysis first. maxSteps=6 gives room for
  // optional Tier 2/3 refinement after fast analysis completes.
  if (isFastAnalysis && (!cs || cs.analysisVersion === 0)) {
    return {
      activeTools: ["runFastAnalysis", "set_context"],
      toolChoice: { type: "tool" as const, toolName: "runFastAnalysis" },
      maxSteps: 6,
    };
  }
```

**SDK evidence:** `toolChoice: { type: "tool", toolName: "runFastAnalysis" }` forces the model to call this specific tool on first step (think.d.ts L96-101). `maxSteps: 6` gives 1 forced step + up to 5 optional refinement steps.

**Why maxSteps: 6:** After `runFastAnalysis` populates all tiers in one shot, the model may optionally call `setAnalysisConfidence` or `writeAnalysisReport` — these are lightweight follow-up steps, not full tier runs. 6 steps is generous but bounded.

---

## M1-D: BELLAAGENT WIRING CHANGES

### Location: `runConsultantAnalysis()` (bella-agent.ts L1447-1466)

### BEFORE:
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

### AFTER:
```typescript
async runConsultantAnalysis(intel: Record<string, any>) {
  const child = await this.subAgent(ConsultantAgent, "consultant");
  try {
    const payload = JSON.stringify(intel, null, 2);
    await child.chat(
      `[FAST_ANALYSIS] ${payload}`,
      { onEvent: () => {}, onDone: () => {} },
    );
    const cs = child.getAnalysis();
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

**Changes:**
1. Message prefix changed from `"Analyze this business..."` to `"[FAST_ANALYSIS] {payload}"` — triggers forced gate in ConsultantAgent.beforeTurn()
2. `child.getAnalysis()` removed `await` — it's a synchronous method (L592-594), returns `this.state as ConsultantState` directly

### No change to receiveIntel

`receiveIntel()` (L1269-1330) already calls `this.runConsultantAnalysis()` for `fast_intel_ready` and `consultant_ready` events. The routing is correct — only the message shape changes inside `runConsultantAnalysis()`.

### No change to enrichConsultantAnalysis

`enrichConsultantAnalysis()` (L1468-1480) uses `child.injectDeepIntel()` @callable which sends `[ENRICHMENT_PASS:...]` — this hits the EXISTING enrichment gate in beforeTurn(), not the new fast-analysis gate. No conflict.

### No change to mergeConsultantResult

`mergeConsultantResult()` (L1939-1959) reads from `ConsultantState` fields — same fields populated by `runFastAnalysis` tool. Shape-compatible by design.

---

## M1-E: THINK SDK UPGRADES (WHILE TOUCHING THE FILE)

These are additive upgrades to ConsultantAgent that exploit SDK features already imported but unused. Low risk, high value.

### E1: Dynamic context blocks on intel arrival

Currently `injectDeepIntel()` (L596-614) manually adds context. Formalize with `addContext()` pattern.

No code change needed — existing implementation already uses `session.addContext()` at L599. Already Think-native.

### E2: continueLastTurn for mid-analysis course correction

Already wired in BellaAgent (L1323). No additional wiring needed for ConsultantAgent — its `onChatResponse()` chaining via `saveMessages()` (L690-721) is the correct pattern for multi-tier chaining within the sub-agent.

### E3: workspace audit trail

Already wired — `runFastAnalysis` tool should write results to workspace for audit:

Add at end of `runFastAnalysis.execute()`, before the return:

```typescript
this.ctx.waitUntil(
  this.workspace.writeFile(
    `/analysis/fast-v${cs.analysisVersion}.json`,
    JSON.stringify({ elapsed, slices: { icp: !!rICP.icpAnalysis, conversion: !!rConversion.conversionEventAnalysis, copy: !!rCopy.businessIdentity, research: !!rResearch.hiringAnalysis }, routing: cs.routing?.priority_agents }, null, 2),
  ).catch((e: any) => console.warn(`[FAST_ANALYSIS_WS] ${e.message}`))
);
```

---

## EXISTING HOOKS — NO CHANGES NEEDED

| Hook | Why no change |
|------|---------------|
| `beforeToolCall()` (L549-563) | Tier enforcement. `runFastAnalysis` is not in tier2Tools or tier3Tools arrays — it passes through without block. Correct. |
| `onStepFinish()` (L568-589) | Loop detection. Will fire for `runFastAnalysis` steps. Consecutive count tracking works. Correct. |
| `afterToolCall()` (L723-729) | Logging. Will log `runFastAnalysis` success/fail. Correct. |
| `onChatResponse()` (L690-721) | Chain detection. After fast analysis populates all tiers, Chain 1 (T2→T3) may fire if Tier 3 incomplete. This is correct — model can optionally refine after fast analysis. |
| `configureSession()` (L38-75) | Context blocks. All 4 existing blocks work with fast analysis. Correct. |

---

## LATENCY ANALYSIS

| Component | Latency |
|-----------|---------|
| 4x generateText() via Promise.all | ~3-5s (same as standalone worker) |
| beforeTurn() gate detection | <1ms |
| setState() after tool | <1ms |
| child.chat() RPC overhead | ~10-50ms |
| mergeConsultantResult() | <1ms |
| **Total** | **~3-5.1s** (vs ~3-5s standalone) |

**RPC overhead is negligible.** The 4 parallel Gemini calls dominate. Think-native adds ~50-100ms overhead vs standalone worker — acceptable for full observability + hook pipeline.

---

## ROLLBACK

- **Safety snapshot:** commit `6d3cc10` on `feat/prompt-enhancements-20260425`
- **Standalone worker stays alive:** `bella-consultant/worker.js` is NOT removed in M1
- **Revert:** `git revert` the M1 commit. Standalone worker continues to receive requests via fast-intel service binding.

---

## GATE REQUIREMENTS

### T3A Codex Gate (pre-implementation)
- SDK_EVIDENCE_PACK mandatory (ADR-002):
  - `toolChoice` forcing: think.d.ts L96-101
  - `tool()` execute with Promise.all: think.d.ts L576-608
  - `beforeTurn()` return type: think.d.ts L88-92
  - `chat()` sub-agent RPC: think.d.ts L647-651
  - `getTools()` merge order: tools.md L1-16
- Verify `generateText` import from `ai` package (already imported at consultant-agent.ts L2)
- Verify `createGoogleGenerativeAI` import (already imported at consultant-agent.ts L4)

### T3B Canary (post-implementation)
- Deploy brain with M1 changes
- Fire test call with known prospect URL
- Verify:
  1. `[FAST_ANALYSIS]` log appears in consultant agent
  2. All 4 slices return data (icp=true, conversion=true, copy=true, research=true)
  3. `scriptFills` populated on BellaAgent state
  4. `routing.priority_agents` has 3+ agents
  5. WOW steps use consultant data (not generic)
  6. Latency <6s for fast analysis
  7. No regression in existing 15-tool tier analysis (enrichment still works)
- Compare output quality: Think fast analysis vs standalone worker (same prospect, both running)

### Canary test count
- Fast analysis success: 4 slice assertions
- State merge: scriptFills + routing + hooks populated
- Hook firing: afterToolCall logged for runFastAnalysis
- Enrichment path: deep_ready triggers injectDeepIntel, existing gates fire
- Regression: all 65 existing canary assertions pass

---

## IMPLEMENTATION ORDER FOR T4

1. Add `_parseJSON` private method
2. Add 4 `_buildPrompt*` private methods (PORT VERBATIM from worker.js)
3. Add `runFastAnalysis` tool to `getTools()`
4. Add `[FAST_ANALYSIS]` detection to `beforeTurn()`
5. Update `runConsultantAnalysis()` in bella-agent.ts
6. Add workspace audit trail to execute()
7. `tsc` — zero type errors
8. REVIEW_REQUEST to T2

---

## STATUS: READY FOR T2

Spec complete. All SDK citations verified. All source lines confirmed. Ready for T3A gate → T4 implementation.
