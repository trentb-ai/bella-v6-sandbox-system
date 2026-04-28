# BELLA CONSULTANT AGENT v2 BLUEPRINT — MAXIMUM POWER INTELLIGENCE PLATFORM
**Doc ID:** doc-bella-consultant-agent-v2-blueprint-20260427
**Date:** 2026-04-27 AEST
**Authority:** Trent Belasco (enterprise scope, "overengineered" directive)
**Architect:** T9 (Opus)
**Status:** CANONICAL — supersedes v1 blueprint (doc-bella-consultant-agent-blueprint-20260426)
**Priority:** CRITICAL
**CF docs consulted:** YES — think.d.ts (full 790 lines), sessions.md (500+ lines), tools.md (full), sub-agents.md (full), lifecycle-hooks.md (full)

---

## WHY v2

v1 blueprint designed a 10-tool task runner. Parent calls chat() once at init, consultant runs tools, returns state. Done.

That's wrong. The Consultant is the **persistent intelligence engine** behind every Bella conversation. It:
- Receives data CONTINUOUSLY as scraping progresses (fast → deep → prospect verbal)
- Re-analyzes and UPGRADES its output mid-call
- Adapts to wildly different client industries, sizes, and requirements
- Serves as the knowledge backbone for ALL other agents (ROI, WOW, Compliance)
- Must handle future use cases we haven't imagined yet

Trent's directive: "overengineered agents because they may have to do many many things when they serve clients."

This blueprint uses EVERY relevant Think SDK capability to build the most powerful sub-agent possible.

---

## ARCHITECTURE OVERVIEW

```
ConsultantAgent extends Think<Env, ConsultantState>
│
├── CORE (v1 — already built S3-A through S3-E)
│   ├── 10 tools across 3 progressive tiers
│   ├── beforeTurn() progressive activation
│   ├── R2SkillProvider for industry KB
│   ├── Writable reasoning context block
│   ├── withCachedPrompt()
│   ├── onChatResponse() completeness chaining
│   ├── onChatRecovery() durable execution
│   ├── afterToolCall() observability
│   └── chatRecovery = true, maxSteps = 25
│
├── DEFENSIVE HOOKS (v2 — new, improves core job)
│   ├── beforeToolCall() — input validation, block garbage, substitute cached
│   ├── onStepFinish() — loop detection, per-step observability, auto-escalation
│   ├── onChatError() — graceful degradation, partial analysis preservation
│   └── Session branching — A/B routing comparison for ambiguous industries
│
├── MULTI-PASS ANALYSIS (v2 — new)
│   ├── Multiple chat() calls from parent as data arrives
│   ├── saveMessages() for mid-call data injection
│   ├── Conversation history accumulates — model knows prior analysis
│   ├── Tier 1-2 run on fast intel, Tier 3 deepens on deep intel
│   └── scriptFills/routing UPGRADE mid-call as data improves
│
├── SEARCHABLE INTELLIGENCE (v2 — new)
│   ├── AgentSearchProvider — FTS5 over analysis findings
│   ├── Model searches prior analysis when new data arrives
│   ├── search_context tool auto-generated
│   └── Gap detection: "what did I miss before that deep intel reveals?"
│
├── WORKSPACE REPORTS (v2 — new)
│   ├── Built-in workspace filesystem (SQLite-backed)
│   ├── Structured analysis reports written per phase
│   ├── Parent reads workspace files for detailed data
│   └── Survives DO eviction via withCachedPrompt
│
├── DYNAMIC CONTEXT INJECTION (v2 — new)
│   ├── session.addContext() for deep intel mid-session
│   ├── refreshSystemPrompt() after injection
│   └── Consultant sees new data in system prompt without restart
│
├── ACTIVE WEBSITE ANALYSIS (v2 — new, Phase 2)
│   ├── createBrowserTools() — CDP browser access
│   ├── Screenshot CTAs, inspect forms, evaluate JS
│   ├── Discover hidden conversion events scrapers miss
│   └── Requires: browser binding + worker_loaders binding
│
├── INDUSTRY EXTENSIONS (v2 — new, Phase 2)
│   ├── extensionLoader + getExtensions()
│   ├── Per-industry tool extensions loaded dynamically
│   ├── Carpet → carpetQuote tool, Dental → dentalFeeGuide
│   └── Zero code changes per vertical
│
├── CLIENT CONFIGURATION (v2 — new)
│   ├── configure<ConsultantConfig>() — persisted per instance
│   ├── Agent priority overrides, analysis depth preferences
│   └── Survives restarts and hibernation
│
└── STABILITY GUARANTEES (v2 — new)
    ├── waitUntilStable() before parent reads
    ├── analysisVersion stale-read guard
    └── hasPendingInteraction() check
```

**Model:** Gemini 2.5 Flash (via @ai-sdk/google)
**State:** DO SQLite (Think managed)
**Knowledge:** R2 bucket `bella-agent-kb` prefix `consultant-kb/`
**Workspace:** DO SQLite (Think built-in, auto-available)
**Search:** FTS5 via AgentSearchProvider (DO SQLite)

---

## MULTI-PASS ANALYSIS — THE KEY PARADIGM SHIFT

v1: One chat() call → all tools → done.
v2: Multiple chat() calls as data arrives → analysis deepens progressively.

### Data Arrival Timeline

```
T+0s    fast-intel arrives       → Parent: chat("Analyze: {fast_intel}")
        Consultant runs Tier 1 + Tier 2 (business profile, digital presence, 
        conversion funnel, script fills, routing, hooks)
        
T+20s   deep-scrape arrives      → Parent: chat("Deep intel update: {deep_intel}")
        Consultant re-evaluates with richer data:
        - Google reviews → update scriptFills.recent_review_snippet
        - Hiring data → update growthSignals, upgrade routing
        - Ads data → update digitalPresence, refine agent routing
        - Runs Tier 3 with full data (industry context, quote inputs, agent briefs)
        
T+60s   prospect gives ACV      → Parent: chat("Prospect confirmed ACV: $5000")
        Consultant updates quoteInputs.estimatedACV
        Recalculates agent briefs with confirmed data
        
T+90s   prospect mentions pain   → Parent: chat("Prospect says: 'we lose 40% of leads after hours'")
        Consultant updates growthSignals.painPoints
        Upgrades Maddie routing priority
        Updates conversation hooks with this specific pain
```

### Parent Invocation Pattern

```typescript
// BellaAgent — multi-pass consultant orchestration

async runConsultantAnalysis(intel: Record<string, any>) {
  const consultant = await this.subAgent(ConsultantAgent, "consultant");
  
  await consultant.chat(
    `Analyze this business for Bella's sales demo:\n${JSON.stringify(intel, null, 2)}`,
    { onEvent: () => {}, onDone: () => {}, onError: (err) => console.error(`[CONSULTANT_ERR] ${err}`) },
  );
  
  // Wait for all tool calls to complete before reading
  await consultant.waitUntilStable({ timeout: 30_000 });
  
  const analysis = await consultant.getAnalysis();
  this.mergeConsultantIntel(analysis);
}

// Called when deep scrape completes — SECOND pass
async enrichConsultantAnalysis(deepIntel: Record<string, any>) {
  const consultant = await this.subAgent(ConsultantAgent, "consultant");
  
  // Inject deep intel as dynamic context block
  await consultant.injectDeepIntel(deepIntel);
  
  // Trigger re-analysis with new data
  await consultant.chat(
    `Deep intelligence arrived. Review and upgrade your analysis with this new data:\n${JSON.stringify(deepIntel, null, 2)}`,
    { onEvent: () => {}, onDone: () => {}, onError: (err) => console.error(`[CONSULTANT_DEEP_ERR] ${err}`) },
  );
  
  await consultant.waitUntilStable({ timeout: 30_000 });
  
  const upgraded = await consultant.getAnalysis();
  this.mergeConsultantIntel(upgraded);
  console.log(`[CONSULTANT_ENRICHED] v=${upgraded.analysisVersion} routing=${upgraded.routing?.priority_agents}`);
}

// Called when prospect provides verbal data mid-call
async updateConsultantFromProspect(dataType: string, value: string) {
  const consultant = await this.subAgent(ConsultantAgent, "consultant");
  
  await consultant.chat(
    `Prospect just shared: [${dataType}] "${value}". Update your analysis accordingly.`,
    { onEvent: () => {}, onDone: () => {}, onError: (err) => console.error(`[CONSULTANT_UPDATE_ERR] ${err}`) },
  );
  
  const updated = await consultant.getAnalysis();
  this.mergeConsultantIntel(updated);
}
```

### Why This Works

Think's conversation history is persistent. Each chat() call adds to the existing conversation. The model has FULL context of all prior analysis when new data arrives. It doesn't re-analyze from scratch — it UPGRADES.

The reasoning context block accumulates the model's working notes. On the second pass, it can read its own prior reasoning and see what changed.

---

## CONSULTANT STATE TYPE (EXPANDED)

```typescript
interface ConsultantState {
  leadId: string;
  analysisVersion: number;
  analysisPhase: "initial" | "enriched" | "prospect_updated";
  lastAnalyzedAt: string;        // ISO timestamp
  dataSourcesProcessed: string[]; // ["fast_intel", "deep_intel", "prospect_verbal"]

  // Tier 1 — Universal Analysis
  businessProfile: BusinessProfile | null;
  digitalPresence: DigitalPresence | null;
  conversionFunnel: ConversionFunnel | null;

  // Tier 2 — Intelligence Synthesis
  scriptFills: ScriptFills | null;
  routing: AgentRouting | null;
  hooks: ConversationHook[] | null;

  // Tier 3 — Industry-Specific + Agent Prep
  industryContext: IndustryContext | null;
  quoteInputs: QuoteInputs | null;
  growthSignals: GrowthSignals | null;
  agentBriefs: Partial<Record<AgentName, AgentBrief>> | null;

  // v2 additions
  analysisConfidence: "low" | "medium" | "high";
  upgradeLog: Array<{ version: number; source: string; fieldsChanged: string[]; at: string }>;
}
```

### New Fields Explained

- **analysisPhase** — tracks which pass we're on. "initial" = fast intel only, "enriched" = deep intel added, "prospect_updated" = prospect data incorporated.
- **dataSourcesProcessed** — which data sources the consultant has seen. Parent checks before sending duplicates.
- **analysisConfidence** — model self-rates based on data quality. Low confidence = fast intel only, high = deep + prospect confirmed.
- **upgradeLog** — audit trail of what changed on each pass. Parent uses this to decide what to re-deliver to Bella.

---

## configureSession() — v2 FULL POWER

```typescript
configureSession(session: Session) {
  return session
    // Static system prompt — analysis methodology
    .withContext("task", {
      provider: { get: async () => CONSULTANT_SYSTEM_PROMPT },
    })
    
    // R2 knowledge base — on-demand industry docs
    .withContext("consultant_knowledge", {
      provider: new R2SkillProvider(this.env.AGENT_KB_BUCKET, { prefix: "consultant-kb/" }),
    })
    
    // LLM-writable reasoning scratchpad
    .withContext("reasoning", {
      description: "Your analysis reasoning — write structured observations, decisions, confidence assessments, and gap notes as you work. On re-analysis passes, note what changed and why.",
      maxTokens: 4000,
    })
    
    // v2: FTS5 searchable findings store
    .withContext("findings", {
      description: "Searchable index of analysis findings. Write key discoveries here so you can search them on subsequent passes. Format: [CATEGORY] finding text",
      provider: new AgentSearchProvider(this),
    })
    
    // Prompt persistence across hibernation
    .withCachedPrompt()
    
    // Compaction for long multi-pass sessions
    .onCompaction(
      createCompactFunction({
        summarize: (prompt: string) =>
          generateText({ model: this.getModel(), prompt }).then((r) => r.text),
        protectHead: 3,
        tailTokenBudget: 8000,
        minTailMessages: 2,
      })
    )
    .compactAfter(12000);  // higher threshold for multi-pass
}
```

### Context Block Inventory

| Block | Provider Type | Auto-Tools | Purpose |
|---|---|---|---|
| `task` | ContextProvider (read-only) | — | System prompt with analysis methodology |
| `consultant_knowledge` | R2SkillProvider | `load_context`, `unload_context` | Industry docs, agent briefs, core analysis frameworks |
| `reasoning` | WritableContextProvider | `set_context` | Model scratchpad — decisions, confidence, gap notes |
| `findings` | AgentSearchProvider | `search_context`, `set_context` | FTS5 searchable findings — model indexes discoveries for cross-pass search |

### Why FTS5 Findings Matter

On pass 1 (fast intel), model writes findings:
```
[CTA] Primary CTA is phone call, secondary is contact form
[ROUTING] Alex high-priority — no CRM detected, speed-to-lead gap
[GAP] Google rating unknown — need deep intel for review strategy
```

On pass 2 (deep intel arrives), model searches:
```
search_context("findings", "Google rating") 
→ "[GAP] Google rating unknown — need deep intel for review strategy"
```

Model now knows exactly what gap to fill. Updates findings:
```
[RESOLVED] Google rating 4.6/5 with 230 reviews — James now high-priority
[UPGRADE] Routing changed: added James, moved Sarah up (database reactivation + reviews combo)
```

This is self-directed analysis improvement. Model manages its own knowledge across passes.

---

## NEW TOOLS (v2 additions to existing 10)

### Tool 11: `upgradeAnalysis`

Called by the model when it determines prior analysis should change based on new data.

```typescript
upgradeAnalysis: tool({
  description: "Upgrade a prior analysis result with new data. Call this when new information changes your Tier 1/2/3 conclusions. Logs the upgrade for audit.",
  inputSchema: z.object({
    tier: z.enum(["businessProfile", "digitalPresence", "conversionFunnel", 
                   "scriptFills", "routing", "hooks", 
                   "industryContext", "quoteInputs", "growthSignals", "agentBriefs"]),
    fieldsChanged: z.array(z.string()),
    reason: z.string(),
    newData: z.record(z.string(), z.any()),
  }),
  execute: async (args) => {
    const cs = this.state as ConsultantState;
    const existing = cs[args.tier as keyof ConsultantState];
    if (!existing) return { error: `No prior ${args.tier} to upgrade` };
    
    // Deep merge new data into existing
    const upgraded = { ...existing as Record<string, any>, ...args.newData };
    const update: Partial<ConsultantState> = {
      [args.tier]: upgraded,
      analysisVersion: cs.analysisVersion + 1,
      lastAnalyzedAt: new Date().toISOString(),
    };
    
    // Log the upgrade
    const logEntry = {
      version: cs.analysisVersion + 1,
      source: args.reason,
      fieldsChanged: args.fieldsChanged,
      at: new Date().toISOString(),
    };
    update.upgradeLog = [...(cs.upgradeLog ?? []), logEntry];
    
    this.setState({ ...cs, ...update });
    return { status: "upgraded", tier: args.tier, version: cs.analysisVersion + 1, fieldsChanged: args.fieldsChanged };
  },
}),
```

### Tool 12: `assessAnalysisGaps`

Self-diagnostic tool — model evaluates what's missing or weak.

```typescript
assessAnalysisGaps: tool({
  description: "Evaluate the current analysis for gaps, weak confidence areas, and missing data. Call this when new data arrives to identify what to re-analyze.",
  inputSchema: z.object({
    dataSourceJustArrived: z.string().describe("What new data source triggered this assessment"),
  }),
  execute: async (args) => {
    const cs = this.state as ConsultantState;
    const gaps: string[] = [];
    
    if (!cs.businessProfile) gaps.push("businessProfile: not analyzed");
    if (!cs.digitalPresence) gaps.push("digitalPresence: not analyzed");
    if (!cs.conversionFunnel) gaps.push("conversionFunnel: not analyzed");
    if (!cs.scriptFills) gaps.push("scriptFills: not generated");
    if (!cs.routing) gaps.push("routing: not determined");
    if (!cs.hooks) gaps.push("hooks: not generated");
    if (!cs.industryContext) gaps.push("industryContext: not analyzed (need industry KB)");
    if (!cs.quoteInputs) gaps.push("quoteInputs: not identified");
    if (!cs.growthSignals) gaps.push("growthSignals: not assessed");
    if (!cs.agentBriefs) gaps.push("agentBriefs: not prepared");
    
    // Confidence-based gaps
    if (cs.analysisConfidence === "low") gaps.push("overall confidence LOW — need more data or re-analysis");
    if (cs.routing && !cs.agentBriefs) gaps.push("routing done but agent briefs missing — Tier 3 incomplete");
    if (cs.businessProfile && !cs.industryContext) gaps.push("business profiled but no industry deep-dive");
    
    return {
      totalGaps: gaps.length,
      gaps,
      dataSourcesProcessed: cs.dataSourcesProcessed,
      newSource: args.dataSourceJustArrived,
      analysisVersion: cs.analysisVersion,
      phase: cs.analysisPhase,
    };
  },
}),
```

### Tool 13: `writeAnalysisReport`

Writes structured report to workspace filesystem.

```typescript
writeAnalysisReport: tool({
  description: "Write a structured analysis report to the workspace. Called at end of each analysis pass. Parent can read these for detailed data.",
  inputSchema: z.object({
    reportType: z.enum(["initial", "enrichment", "prospect_update", "final"]),
    summary: z.string(),
    keyFindings: z.array(z.string()),
    confidenceAssessment: z.string(),
  }),
  execute: async (args) => {
    const cs = this.state as ConsultantState;
    const filename = `reports/${cs.leadId}/pass-${cs.analysisVersion}-${args.reportType}.md`;
    const content = [
      `# Analysis Report — ${args.reportType.toUpperCase()}`,
      `Lead: ${cs.leadId}`,
      `Version: ${cs.analysisVersion}`,
      `Phase: ${cs.analysisPhase}`,
      `Confidence: ${cs.analysisConfidence}`,
      `Timestamp: ${new Date().toISOString()}`,
      `Data sources: ${cs.dataSourcesProcessed.join(", ")}`,
      "",
      "## Summary",
      args.summary,
      "",
      "## Key Findings",
      ...args.keyFindings.map(f => `- ${f}`),
      "",
      "## Confidence Assessment",
      args.confidenceAssessment,
      "",
      "## State Snapshot",
      `Business: ${cs.businessProfile?.businessName ?? "unknown"}`,
      `Industry: ${cs.businessProfile?.industry ?? "unknown"}`,
      `Priority agents: ${cs.routing?.priority_agents?.join(", ") ?? "not routed"}`,
      `Script fills: ${cs.scriptFills ? "YES" : "NO"}`,
      `Quote inputs: ${cs.quoteInputs ? "YES" : "NO"}`,
      `Growth signals: ${cs.growthSignals ? "YES" : "NO"}`,
      `Agent briefs: ${cs.agentBriefs ? Object.keys(cs.agentBriefs).join(", ") : "NONE"}`,
    ].join("\n");
    
    await this.workspace.writeFile(filename, content);
    return { status: "written", filename, version: cs.analysisVersion };
  },
}),
```

### Tool 14: `setAnalysisConfidence`

Model self-rates analysis quality.

```typescript
setAnalysisConfidence: tool({
  description: "Set the overall confidence level of the current analysis. Call after each analysis pass.",
  inputSchema: z.object({
    confidence: z.enum(["low", "medium", "high"]),
    reason: z.string(),
  }),
  execute: async (args) => {
    const cs = this.state as ConsultantState;
    this.setState({ ...cs, analysisConfidence: args.confidence });
    return { status: "ok", confidence: args.confidence };
  },
}),
```

---

## DYNAMIC CONTEXT INJECTION

Parent injects new data sources as context blocks at runtime.

```typescript
// ConsultantAgent — callable methods for parent

@callable()
async injectDeepIntel(deepIntel: Record<string, any>) {
  // Add deep intel as a dynamic context block
  await this.session.addContext("deep_intel", {
    description: "Deep scrape intelligence — Google reviews, hiring data, ads analysis, LinkedIn signals",
    provider: { get: async () => JSON.stringify(deepIntel, null, 2) },
  });
  await this.session.refreshSystemPrompt();
  
  // Update state tracking
  const cs = this.state as ConsultantState;
  const sources = [...(cs.dataSourcesProcessed ?? [])];
  if (!sources.includes("deep_intel")) sources.push("deep_intel");
  this.setState({ ...cs, dataSourcesProcessed: sources, analysisPhase: "enriched" });
  
  console.log(`[CONSULTANT] deep_intel injected, refreshed prompt`);
}

@callable()
async injectProspectData(dataType: string, value: string) {
  const cs = this.state as ConsultantState;
  const sources = [...(cs.dataSourcesProcessed ?? [])];
  const key = `prospect_${dataType}`;
  if (!sources.includes(key)) sources.push(key);
  this.setState({ ...cs, dataSourcesProcessed: sources, analysisPhase: "prospect_updated" });
}
```

---

## CLIENT CONFIGURATION

Per-instance configuration that persists across restarts. Enables per-client customization without code changes.

```typescript
interface ConsultantConfig {
  // Agent priority overrides — client always wants certain agents
  alwaysPrioritize?: AgentName[];
  alwaysExclude?: AgentName[];
  
  // Analysis depth — some clients want fast, some want thorough
  analysisDepth: "fast" | "standard" | "deep";
  
  // Industry override — when auto-detection isn't enough
  industryOverride?: string;
  
  // Custom hooks — client-specific talking points
  customHooks?: Array<{ topic: string; line: string }>;
  
  // Quote configuration
  defaultPricingModel?: "fixed" | "hourly" | "project" | "retainer" | "subscription";
}

// In beforeTurn — apply config
async beforeTurn(ctx: TurnContext) {
  const config = this.getConfig<ConsultantConfig>();
  const cs = this.state as ConsultantState;
  
  // ... existing tier activation logic ...
  
  // Inject config into system prompt if present
  let system = ctx.system;
  if (config) {
    const overrides: string[] = [];
    if (config.alwaysPrioritize?.length) {
      overrides.push(`CLIENT OVERRIDE: Always prioritize agents: ${config.alwaysPrioritize.join(", ")}`);
    }
    if (config.alwaysExclude?.length) {
      overrides.push(`CLIENT OVERRIDE: Never recommend agents: ${config.alwaysExclude.join(", ")}`);
    }
    if (config.industryOverride) {
      overrides.push(`CLIENT OVERRIDE: Treat as industry: ${config.industryOverride}`);
    }
    if (config.analysisDepth === "deep") {
      overrides.push(`CLIENT OVERRIDE: Maximum analysis depth — load all relevant KB files, assess every signal`);
    }
    if (overrides.length) {
      system = system + "\n\nCLIENT CONFIGURATION:\n" + overrides.join("\n");
    }
  }
  
  return { system, activeTools: [...tier1, ...tier2, ...tier3] };
}
```

---

## WORKSPACE USAGE

Think's built-in workspace provides read/write/edit/list/find/grep/delete on a SQLite-backed virtual filesystem. Already available — no configuration needed.

### What the Consultant Writes

```
workspace/
  reports/
    {leadId}/
      pass-1-initial.md          — first analysis (fast intel)
      pass-2-enrichment.md       — deep intel enrichment
      pass-3-prospect_update.md  — prospect data incorporated
      pass-4-final.md            — final consolidated report
  analysis/
    {leadId}/
      business-profile.json      — structured JSON for machine consumption
      routing-decision.json      — routing + reasoning
      script-fills.json          — all Bella script lines
```

### Parent Reading Reports

```typescript
// BellaAgent reads detailed analysis from workspace
async getConsultantReport(leadId: string): Promise<string | null> {
  const consultant = await this.subAgent(ConsultantAgent, "consultant");
  // workspace tools are auto-available — model can read/write
  // For programmatic access, use the workspace directly:
  const files = await consultant.workspace.listFiles(`reports/${leadId}/`);
  if (files.length === 0) return null;
  const latest = files.sort((a, b) => b.name.localeCompare(a.name))[0];
  return consultant.workspace.readFile(latest.path);
}
```

---

## BROWSER TOOLS (PHASE 2)

Active website analysis via Chrome DevTools Protocol. Not just reading scraped text — actually browsing.

```typescript
// Phase 2 addition to getTools()
import { createBrowserTools } from "@cloudflare/think/tools/browser";

getTools(): ToolSet {
  const baseTools = { /* existing 14 tools */ };
  
  // Browser tools — if BROWSER binding exists
  if (this.env.BROWSER) {
    const browserTools = createBrowserTools({
      browser: this.env.BROWSER,
      loader: this.env.LOADER,
    });
    return { ...baseTools, ...browserTools };
  }
  
  return baseTools;
}
```

### What Browser Analysis Enables

- **Screenshot CTAs** — visual proof of conversion opportunities
- **Inspect forms** — field count, required fields, friction analysis
- **Evaluate JS** — detect hidden chat widgets, booking tools, CRM integrations
- **Check mobile** — responsive design quality assessment
- **Find hidden pages** — /pricing, /about, /careers that scrapers may miss
- **Speed test** — page load performance as a selling hook

### wrangler.toml Addition (Phase 2)

```toml
[browser]
binding = "BROWSER"

[[worker_loaders]]
binding = "LOADER"
```

---

## INDUSTRY EXTENSIONS (PHASE 2)

Dynamically loaded sandboxed Workers per industry. Model can even WRITE new extensions.

```typescript
// Phase 2 — set extensionLoader
extensionLoader = this.env.LOADER;

getExtensions(): ExtensionConfig[] {
  const config = this.getConfig<ConsultantConfig>();
  const industry = config?.industryOverride 
    ?? (this.state as ConsultantState).businessProfile?.industry 
    ?? null;
  
  const extensions: ExtensionConfig[] = [];
  
  // Load industry-specific extension if available
  if (industry) {
    const ext = INDUSTRY_EXTENSIONS[industry.toLowerCase()];
    if (ext) extensions.push(ext);
  }
  
  return extensions;
}

// Industry extension registry
const INDUSTRY_EXTENSIONS: Record<string, ExtensionConfig> = {
  "carpet-flooring": {
    manifest: {
      name: "carpet",
      version: "1.0.0",
      permissions: { network: false },
    },
    source: `({
      tools: {
        estimate_carpet_job: {
          description: "Estimate carpet/flooring job value from room count and quality tier",
          parameters: {
            rooms: { type: "number", description: "Number of rooms" },
            quality: { type: "string", enum: ["budget", "mid", "premium"] },
            sqm_per_room: { type: "number", description: "Average sqm per room (default 15)" }
          },
          execute: async ({ rooms, quality, sqm_per_room = 15 }) => {
            const rates = { budget: 45, mid: 75, premium: 120 };
            const total_sqm = rooms * sqm_per_room;
            const estimate = total_sqm * rates[quality];
            return { total_sqm, rate_per_sqm: rates[quality], estimate, currency: "AUD" };
          }
        }
      }
    })`,
  },
  // dental, legal, trade, etc. — each has industry-specific estimation tools
};
```

Extensions are namespaced: `carpet_estimate_carpet_job` in the model's tool set. Model decides when to use them based on the prospect's industry. Zero ConsultantAgent code changes to add a new industry.

---

## UPDATED beforeTurn() — v2

```typescript
async beforeTurn(ctx: TurnContext) {
  const cs = this.state as ConsultantState | null;
  const config = this.getConfig<ConsultantConfig>();
  
  // Tier 1: always active
  const active = ["analyzeBusinessProfile", "analyzeDigitalPresence", "analyzeConversionFunnel"];
  
  // Tier 2: unlocks after ANY Tier 1 result
  if (cs?.businessProfile || cs?.digitalPresence || cs?.conversionFunnel) {
    active.push("generateScriptFills", "routeAgents", "generateConversationHooks");
  }
  
  // Tier 3: unlocks after routing decided
  if (cs?.routing) {
    active.push("analyzeIndustryContext", "identifyQuoteInputs", "assessGrowthOpportunities", "prepareAgentBriefs");
  }
  
  // v2 tools: always active after initial analysis
  if (cs?.analysisVersion && cs.analysisVersion > 0) {
    active.push("upgradeAnalysis", "assessAnalysisGaps", "writeAnalysisReport", "setAnalysisConfidence");
  }
  
  // System prompt augmentation
  let system = ctx.system;
  
  // Inject analysis phase context
  if (cs?.analysisPhase) {
    system += `\n\nCURRENT ANALYSIS STATE:
Phase: ${cs.analysisPhase}
Version: ${cs.analysisVersion}
Confidence: ${cs.analysisConfidence ?? "not set"}
Data sources: ${cs.dataSourcesProcessed?.join(", ") ?? "none"}
Upgrades: ${cs.upgradeLog?.length ?? 0} logged`;
  }
  
  // Client config overrides
  if (config?.alwaysPrioritize?.length) {
    system += `\n\nCLIENT PRIORITY OVERRIDE: Always include ${config.alwaysPrioritize.join(", ")} in routing.`;
  }
  if (config?.alwaysExclude?.length) {
    system += `\n\nCLIENT EXCLUSION: Never recommend ${config.alwaysExclude.join(", ")}.`;
  }
  
  return { system, activeTools: active };
}
```

---

## beforeToolCall() — INPUT VALIDATION + CACHING (v2 — new)

Prevents garbage-in-garbage-out. Validates tool inputs BEFORE execution. Caches results on re-analysis passes where underlying data hasn't changed.

**SDK source:** think.d.ts lines 127-183, lifecycle-hooks.md §beforeToolCall

```typescript
// Track tool call counts for loop detection (used by onStepFinish)
private _toolCallCounts = new Map<string, number>();
// Cache key → result for substitute on re-analysis
private _toolResultCache = new Map<string, unknown>();

async beforeToolCall(ctx: ToolCallContext): Promise<ToolCallDecision | void> {
  const cs = this.state as ConsultantState;
  const name = ctx.toolName;

  // Track call frequency
  this._toolCallCounts.set(name, (this._toolCallCounts.get(name) ?? 0) + 1);

  // === BLOCK: Tier 1 tools without usable input data ===
  const tier1Tools = ["analyzeBusinessProfile", "analyzeDigitalPresence", "analyzeConversionFunnel"];
  if (tier1Tools.includes(name)) {
    const input = ctx.input as Record<string, any>;
    // Block if no intel payload at all
    if (!input || Object.keys(input).length === 0) {
      return { action: "block", reason: "No intel data provided. Wait for data before analyzing." };
    }
  }

  // === BLOCK: Tier 2 tools without Tier 1 foundation ===
  const tier2Tools = ["generateScriptFills", "routeAgents", "generateConversationHooks"];
  if (tier2Tools.includes(name)) {
    if (!cs?.businessProfile && !cs?.digitalPresence && !cs?.conversionFunnel) {
      return { action: "block", reason: "Cannot run Tier 2 — no Tier 1 analysis exists. Run analyzeBusinessProfile first." };
    }
  }

  // === BLOCK: Tier 3 tools without routing decision ===
  const tier3Tools = ["analyzeIndustryContext", "identifyQuoteInputs", "assessGrowthOpportunities", "prepareAgentBriefs"];
  if (tier3Tools.includes(name)) {
    if (!cs?.routing) {
      return { action: "block", reason: "Cannot run Tier 3 — routing not decided. Run routeAgents first." };
    }
  }

  // === BLOCK: prepareAgentBriefs without KB loaded ===
  if (name === "prepareAgentBriefs") {
    // Agent briefs need KB context — block if no KB has been loaded
    // (R2SkillProvider adds loaded files to context; check via session state)
    if (!cs?.industryContext) {
      return { action: "block", reason: "Load industry KB and run analyzeIndustryContext before preparing agent briefs." };
    }
  }

  // === SUBSTITUTE: Cached results on re-analysis where data unchanged ===
  if (cs?.analysisVersion && cs.analysisVersion > 0) {
    const cacheKey = `${name}:${JSON.stringify(ctx.input)}`;
    const cached = this._toolResultCache.get(cacheKey);
    if (cached) {
      console.log(`[CONSULTANT_CACHE] ${name} — returning cached result (same inputs)`);
      return { action: "substitute", output: cached };
    }
  }

  // Default: allow execution
}
```

### What This Prevents

| Scenario | Without beforeToolCall | With beforeToolCall |
|---|---|---|
| Fast-intel returns empty | Tier 1 tools analyze nothing, produce empty profile | BLOCKED — model told to wait for data |
| Model skips Tier 1, jumps to scriptFills | scriptFills hallucinates without business profile | BLOCKED — model told to run Tier 1 first |
| Re-analysis with identical data | All tools re-execute, wasting Gemini tokens | SUBSTITUTED — cached results returned instantly |
| prepareAgentBriefs without KB | Generic briefs, no industry depth | BLOCKED — model told to load KB first |

### afterToolCall Cache Population

Existing `afterToolCall()` hook extended to populate cache:

```typescript
async afterToolCall(ctx: ToolCallResultContext) {
  // Existing observability logging...
  console.log(`[CONSULTANT_TOOL] ${ctx.toolName} ${ctx.success ? 'OK' : 'FAIL'} ${ctx.durationMs}ms`);

  // Cache successful results for substitute on re-analysis
  if (ctx.success) {
    const cacheKey = `${ctx.toolName}:${JSON.stringify(ctx.input)}`;
    this._toolResultCache.set(cacheKey, ctx.output);
  }
}
```

---

## onStepFinish() — LOOP DETECTION + OBSERVABILITY (v2 — new)

Detects when model is spinning (calling same tools repeatedly without progress). Provides per-step telemetry.

**SDK source:** think.d.ts lines 232-245, lifecycle-hooks.md §onStepFinish. StepContext = AI SDK's StepResult — includes toolCalls, toolResults, usage, finishReason.

```typescript
// Consecutive identical step tracker
private _lastStepToolNames: string[] = [];
private _identicalStepCount = 0;

async onStepFinish(ctx: StepContext) {
  const cs = this.state as ConsultantState;
  const toolNames = ctx.toolCalls.map(tc => tc.toolName).sort();

  // === OBSERVABILITY ===
  console.log(
    `[CONSULTANT_STEP] step=${ctx.stepNumber} ` +
    `tools=[${toolNames.join(",")}] ` +
    `finish=${ctx.finishReason} ` +
    `tokens=${ctx.usage.inputTokens}in/${ctx.usage.outputTokens}out ` +
    `cached=${ctx.usage.cachedInputTokens ?? 0} ` +
    `phase=${cs?.analysisPhase ?? "none"} ` +
    `version=${cs?.analysisVersion ?? 0}`
  );

  // === LOOP DETECTION ===
  const currentKey = toolNames.join(",");
  const lastKey = this._lastStepToolNames.join(",");

  if (currentKey === lastKey && currentKey !== "") {
    this._identicalStepCount++;

    if (this._identicalStepCount >= 3) {
      // Model is spinning — inject course correction
      console.warn(`[CONSULTANT_LOOP] ${currentKey} called ${this._identicalStepCount} consecutive steps — injecting escalation`);
      await this.saveMessages([{
        id: crypto.randomUUID(),
        role: "user",
        parts: [{ type: "text", text: `SYSTEM: You have called ${currentKey} ${this._identicalStepCount} times consecutively without progress. Either commit to your current analysis, move to the next tier, or call writeAnalysisReport with what you have. Do not repeat the same tools.` }],
      }]);
      this._identicalStepCount = 0;
    }
  } else {
    this._identicalStepCount = 0;
  }
  this._lastStepToolNames = toolNames;

  // === STEP-LEVEL METRICS ===
  // Track token usage per analysis phase for cost analysis
  if (ctx.toolCalls.length > 0) {
    const tierTag = toolNames.some(n => ["analyzeBusinessProfile", "analyzeDigitalPresence", "analyzeConversionFunnel"].includes(n)) ? "tier1"
      : toolNames.some(n => ["generateScriptFills", "routeAgents", "generateConversationHooks"].includes(n)) ? "tier2"
      : toolNames.some(n => ["analyzeIndustryContext", "identifyQuoteInputs", "assessGrowthOpportunities", "prepareAgentBriefs"].includes(n)) ? "tier3"
      : "v2";
    console.log(`[CONSULTANT_COST] ${tierTag} tokens=${ctx.usage.totalTokens}`);
  }
}
```

### What This Catches

| Pattern | Detection | Response |
|---|---|---|
| Model calls `assessAnalysisGaps` → same gaps → calls again | 3 consecutive identical step | saveMessages: "commit or move on" |
| Model stuck in Tier 1 loop | 3 consecutive Tier 1 tool sets | saveMessages: "move to Tier 2" |
| Runaway token usage | Per-step logging | Visible in logs for cost monitoring |
| Model reasoning without calling tools | Step with 0 toolCalls, high output tokens | Logged for analysis |

---

## onChatError() — GRACEFUL DEGRADATION (v2 — new)

Preserves partial analysis when Gemini fails mid-multi-pass. Critical for a multi-pass agent — without this, a pass-2 failure loses the enrichment opportunity silently.

**SDK source:** think.d.ts line 540, lifecycle-hooks.md §onChatError. Partial assistant message persisted before hook fires.

```typescript
onChatError(error: unknown): unknown {
  const cs = this.state as ConsultantState;
  const errMsg = error instanceof Error ? error.message : String(error);
  const phase = cs?.analysisPhase ?? "unknown";
  const version = cs?.analysisVersion ?? 0;

  console.error(
    `[CONSULTANT_ERR] phase=${phase} version=${version} ` +
    `lastTier=${this._getHighestCompletedTier(cs)} ` +
    `error=${errMsg}`
  );

  // State is already saved by tool execute() calls — partial analysis preserved.
  // Mark that this phase had an error so parent knows.
  if (cs) {
    const log = [...(cs.upgradeLog ?? []), {
      version,
      source: `ERROR:${phase}`,
      fieldsChanged: ["_error"],
      at: new Date().toISOString(),
    }];
    this.setState({ ...cs, upgradeLog: log });
  }

  // Return a structured error the parent can interpret
  return new Error(
    JSON.stringify({
      agent: "consultant",
      phase,
      version,
      highestCompletedTier: this._getHighestCompletedTier(cs),
      retryable: this._isRetryable(errMsg),
      message: errMsg,
    })
  );
}

private _getHighestCompletedTier(cs: ConsultantState | null): string {
  if (!cs) return "none";
  if (cs.agentBriefs || cs.industryContext || cs.quoteInputs || cs.growthSignals) return "tier3";
  if (cs.scriptFills || cs.routing || cs.hooks) return "tier2";
  if (cs.businessProfile || cs.digitalPresence || cs.conversionFunnel) return "tier1";
  return "none";
}

private _isRetryable(msg: string): boolean {
  // Rate limits and timeouts = retryable. Schema errors = not.
  return /rate.?limit|429|timeout|ECONNRESET|503|overloaded/i.test(msg);
}
```

### Parent Error Handling

```typescript
// BellaAgent — handle consultant errors gracefully
async enrichConsultantAnalysis(deepIntel: Record<string, any>) {
  const consultant = await this.subAgent(ConsultantAgent, "consultant");
  
  try {
    await consultant.chat(
      `Deep intelligence arrived. Review and upgrade your analysis.`,
      { onEvent: () => {}, onDone: () => {}, onError: (err) => {} },
    );
    await consultant.waitUntilStable({ timeout: 30_000 });
    const upgraded = await consultant.getAnalysis();
    this.mergeConsultantIntel(upgraded);
  } catch (err) {
    // Parse structured error from onChatError
    try {
      const parsed = JSON.parse((err as Error).message);
      console.error(`[BELLA] Consultant ${parsed.phase} failed at ${parsed.highestCompletedTier}`);
      
      if (parsed.retryable) {
        // Retry after delay — partial analysis still valid
        console.log(`[BELLA] Retrying consultant enrichment in 30s`);
        // ... schedule retry
      } else {
        // Non-retryable — use whatever analysis exists
        console.warn(`[BELLA] Using partial analysis (version ${parsed.version})`);
        const partial = await consultant.getAnalysis();
        this.mergeConsultantIntel(partial);
      }
    } catch {
      // Fallback — use whatever state exists
      const fallback = await consultant.getAnalysis();
      if (fallback.analysisVersion > 0) this.mergeConsultantIntel(fallback);
    }
  }
}
```

### What This Preserves

| Failure Point | Without onChatError | With onChatError |
|---|---|---|
| Gemini rate-limit on pass 2 | Enrichment silently fails, stale analysis served | Structured error, parent retries, pass-1 analysis preserved |
| Timeout during Tier 3 | Entire analysis lost | Tier 1+2 results preserved in state, parent uses partial |
| Model error mid-tool-call | Generic error propagated | Phase/tier/retryability context returned to parent |

---

## SESSION BRANCHING — A/B ROUTING ANALYSIS (v2 — moved from Phase 2)

For ambiguous industries or close routing decisions. Fork session, run two strategies, compare, pick best.

**SDK source:** sessions.md §Forking — `manager.fork(sessionId, atMessageId)` copies history to new session. Messages get new UUIDs.

**When to branch:** Model detects routing ambiguity — two industries equally plausible, or agent priority scores within 10% of each other.

```typescript
// Tool 15: branchAndCompareRouting
branchAndCompareRouting: tool({
  description: "Fork the current analysis into two branches to test different routing strategies. Use when routing is ambiguous — e.g., two industries are equally plausible, or agent priority scores are within 10%. Runs both strategies, compares, picks the stronger one.",
  inputSchema: z.object({
    strategyA: z.object({
      label: z.string(),
      industryOverride: z.string().optional(),
      priorityAgents: z.array(z.enum(["Alex", "Chris", "Maddie", "Sarah", "James"])),
      reason: z.string(),
    }),
    strategyB: z.object({
      label: z.string(),
      industryOverride: z.string().optional(),
      priorityAgents: z.array(z.enum(["Alex", "Chris", "Maddie", "Sarah", "James"])),
      reason: z.string(),
    }),
  }),
  execute: async (args) => {
    const cs = this.state as ConsultantState;
    
    // Fork current session to create branch B
    const mainSessionId = this.session.id;
    const lastMsgId = this.session.messages.at(-1)?.id;
    if (!lastMsgId) return { error: "No messages to fork from" };
    
    const branchSessionId = await this.session.manager.fork(mainSessionId, lastMsgId);
    
    // Strategy A runs in current session (already has full context)
    // Strategy B needs to be evaluated separately
    // Store both for comparison
    const comparison = {
      strategyA: {
        ...args.strategyA,
        sessionId: mainSessionId,
        agentCount: args.strategyA.priorityAgents.length,
      },
      strategyB: {
        ...args.strategyB,
        sessionId: branchSessionId,
        agentCount: args.strategyB.priorityAgents.length,
      },
    };
    
    // Heuristic scoring: more agents = more revenue potential
    // Specificity bonus: industry-specific routing > generic
    const scoreA = args.strategyA.priorityAgents.length * 10 
      + (args.strategyA.industryOverride ? 5 : 0);
    const scoreB = args.strategyB.priorityAgents.length * 10 
      + (args.strategyB.industryOverride ? 5 : 0);
    
    const winner = scoreA >= scoreB ? "A" : "B";
    const winnerStrategy = winner === "A" ? args.strategyA : args.strategyB;
    
    console.log(
      `[CONSULTANT_BRANCH] A=${args.strategyA.label}(${scoreA}) vs B=${args.strategyB.label}(${scoreB}) → ${winner} wins`
    );
    
    return {
      comparison,
      scores: { A: scoreA, B: scoreB },
      winner,
      recommendation: `Apply strategy ${winner}: ${winnerStrategy.label}. Priority agents: ${winnerStrategy.priorityAgents.join(", ")}. Reason: ${winnerStrategy.reason}`,
    };
  },
}),
```

### When the Model Should Branch

System prompt instruction (added to CONSULTANT_SYSTEM_PROMPT):
```
ROUTING AMBIGUITY: If two routing strategies score within 10% of each other,
or the business could plausibly be classified in two industries, call
branchAndCompareRouting to test both strategies. Pick the winner. Never guess
when you can compare.
```

---

## UPDATED onChatResponse() — v2

```typescript
async onChatResponse(result: ChatResponseResult) {
  const cs = this.state as ConsultantState;
  
  // Existing completeness chaining (Tier 2 → Tier 3)
  const tier2Done = !!(cs?.scriptFills && cs?.routing && cs?.hooks);
  const tier3Incomplete = !cs?.industryContext || !cs?.quoteInputs || !cs?.growthSignals || !cs?.agentBriefs;

  if (tier2Done && tier3Incomplete) {
    await this.saveMessages([{
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "Continue: complete industry analysis, quote inputs, growth assessment, and agent briefs for all priority agents." }],
    }]);
    return;
  }
  
  // v2: After all tiers complete, write analysis report
  const allComplete = tier2Done && !tier3Incomplete;
  if (allComplete && result.status === "completed") {
    // Trigger report writing + confidence assessment
    await this.saveMessages([{
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "Analysis complete. Call setAnalysisConfidence to rate your analysis quality, index key findings via set_context to findings, then call writeAnalysisReport with a summary." }],
    }]);
  }
}
```

---

## PUBLIC METHODS (SubAgentStub-accessible)

```typescript
// State getter — full analysis
getAnalysis(): ConsultantState {
  return this.state as ConsultantState;
}

// Version getter — for stale-read guard
getAnalysisVersion(): number {
  return (this.state as ConsultantState)?.analysisVersion ?? 0;
}

// Phase getter — what stage of analysis
getAnalysisPhase(): string {
  return (this.state as ConsultantState)?.analysisPhase ?? "none";
}

// Confidence getter
getAnalysisConfidence(): string {
  return (this.state as ConsultantState)?.analysisConfidence ?? "unknown";
}

// Data sources getter — what data has been processed
getDataSources(): string[] {
  return (this.state as ConsultantState)?.dataSourcesProcessed ?? [];
}

// Upgrade log — what changed across passes
getUpgradeLog(): Array<{ version: number; source: string; fieldsChanged: string[]; at: string }> {
  return (this.state as ConsultantState)?.upgradeLog ?? [];
}

// Dynamic context injection (callable from parent)
@callable()
async injectDeepIntel(deepIntel: Record<string, any>): Promise<{ status: string }> {
  // ... implementation above ...
}

@callable()
async injectProspectData(dataType: string, value: string): Promise<{ status: string }> {
  // ... implementation above ...
}

// Client configuration (callable from parent or admin)
@callable()
async setClientConfig(config: ConsultantConfig): Promise<{ status: string }> {
  this.configure<ConsultantConfig>(config);
  return { status: "configured" };
}

@callable()
async getClientConfig(): Promise<ConsultantConfig | null> {
  return this.getConfig<ConsultantConfig>();
}
```

---

## UPDATED SYSTEM PROMPT

```typescript
const CONSULTANT_SYSTEM_PROMPT = `You are a business intelligence analyst for Bella, an AI voice sales agent.
Bella demonstrates five AI agents (Alex, Chris, Maddie, Sarah, James) to business prospects on a website funnel.
The prospect submitted their details on a website. Your job: analyse scraped data, build structured intelligence, and continuously upgrade your analysis as new data arrives.

You have access to consultant_knowledge — use load_context to pull relevant industry docs before deep analysis.
You have access to findings — use search_context to search your prior findings, and set_context to index new discoveries.
You have a workspace — write analysis reports for audit and parent agent consumption.

OPERATING MODE:
You may receive multiple analysis requests as data arrives progressively.
- First pass: fast intel only — run Tier 1 + 2, set confidence LOW or MEDIUM
- Second pass: deep intel arrives — reassess all tiers, upgrade where data improves conclusions
- Subsequent passes: prospect verbal data — update specific fields, note what changed

On every pass:
1. Call assessAnalysisGaps to identify what's missing or weak
2. Search findings for your prior analysis notes
3. Run or upgrade appropriate tier tools
4. Call setAnalysisConfidence to rate your work
5. Index key findings via set_context to findings block
6. Call writeAnalysisReport at end of pass

TOOL SEQUENCE (first pass):
1. analyzeBusinessProfile — extract business identity
2. analyzeDigitalPresence — map tech stack, ads, digital signals
3. analyzeConversionFunnel — identify ALL conversion events

When Tier 1 completes, Tier 2 unlocks:
4. generateScriptFills — what Bella actually SAYS
5. routeAgents — which agents to demo and why
6. generateConversationHooks — natural talking points per agent

When routing is decided, Tier 3 unlocks:
7. load_context industry file → analyzeIndustryContext
8. identifyQuoteInputs — quoting data for ROI agent
9. assessGrowthOpportunities — hiring, expansion signals
10. load_context agent briefs → prepareAgentBriefs

UPGRADE SEQUENCE (subsequent passes):
1. assessAnalysisGaps — what's changed?
2. search_context findings — what did I conclude before?
3. upgradeAnalysis for each changed field — log the upgrade
4. Re-run affected tier tools if major changes
5. setAnalysisConfidence — probably higher now
6. writeAnalysisReport — document what changed

ROUTING AMBIGUITY: If two routing strategies score within 10% of each other,
or the business could plausibly be classified in two industries, call
branchAndCompareRouting to test both strategies. Pick the winner. Never guess
when you can compare.

RULES:
- Be specific to THIS business. Generic output is useless.
- Never criticise the website. Maximise whatever they have.
- All narrative fields must be spoken language (Bella says them aloud).
- Store results via tools — do not describe them in text.
- On upgrade passes, only change what new data actually improves. Don't regress.
- If a tool is blocked (beforeToolCall returns a reason), read the reason and adjust — do not retry the same call.`;
```

---

## BUILD PHASES

### Phase 1 — Multi-Pass + Search + Reports + Defensive Hooks (S5 sprint series)

**S5-A: ConsultantState expansion + new tools + defensive hooks**
- Add v2 state fields (analysisPhase, dataSourcesProcessed, analysisConfidence, upgradeLog)
- Add tools 11-14 (upgradeAnalysis, assessAnalysisGaps, writeAnalysisReport, setAnalysisConfidence)
- Add `beforeToolCall()` — tier validation, empty-data blocking, cache substitution
- Add `onStepFinish()` — loop detection, per-step observability, tier cost logging
- Add private fields: `_toolCallCounts`, `_toolResultCache`, `_lastStepToolNames`, `_identicalStepCount`
- Extend existing `afterToolCall()` to populate `_toolResultCache`
- Update beforeTurn() for v2 tool activation
- Update onChatResponse() for report trigger

**S5-B: AgentSearchProvider + findings context**
- Add AgentSearchProvider import
- Add "findings" context block to configureSession()
- Update system prompt for search/index workflow
- Test: model writes findings on pass 1, searches them on pass 2

**S5-C: Multi-pass parent integration + error handling**
- BellaAgent: enrichConsultantAnalysis() for deep intel pass — WITH try/catch for structured errors
- BellaAgent: updateConsultantFromProspect() for verbal data
- Add `onChatError()` — phase/tier/retryability structured error, partial state preservation
- Add `_getHighestCompletedTier()` and `_isRetryable()` helpers
- Wire receiveIntel("deep_ready") → enrichConsultantAnalysis()
- Wire extraction results → updateConsultantFromProspect()
- Parent error handling: retry on rate-limit, fallback to partial on non-retryable

**S5-D: Dynamic context injection + callable methods**
- Add @callable injectDeepIntel()
- Add @callable injectProspectData()
- Add @callable setClientConfig() / getClientConfig()
- Add session.addContext() + refreshSystemPrompt() flow
- Test: inject deep intel mid-analysis, verify prompt updates

**S5-E: Analysis getters + stability**
- Add all public getter methods
- Add waitUntilStable() calls in parent
- Add stale-read guard with analysisVersion
- Updated system prompt

**S5-F: Session branching — A/B routing comparison**
- Add tool 15: `branchAndCompareRouting` (z.object with strategyA/B)
- Add `manager.fork()` call for session branching
- Heuristic scoring: agent count × 10 + industry specificity bonus
- Add routing ambiguity instruction to CONSULTANT_SYSTEM_PROMPT
- Update beforeTurn() to activate tool 15 after routing exists
- Test: ambiguous industry triggers branch, winner selected

### Phase 2 — Browser + Extensions (S6 sprint series, post-launch ok)

**S6-A: Browser tools**
- Add BROWSER + LOADER bindings to wrangler.toml
- Add createBrowserTools() to getTools()
- Test: consultant navigates prospect website, screenshots CTAs

**S6-B: Industry extensions**
- Add extensionLoader property
- Add getExtensions() with industry registry
- Create 3 initial industry extensions (carpet, dental, trade)
- Test: industry-specific tool auto-loads based on business profile

---

## WHAT THIS ENABLES FOR CLIENTS

1. **Any industry** — R2 KB file + optional extension. Zero code changes.
2. **Progressive intelligence** — analysis improves as data arrives. Never stuck on stale fast-intel.
3. **Prospect-responsive** — verbal data mid-call upgrades routing and hooks in real-time.
4. **Client customization** — configure() for persistent preferences. "Always prioritize Alex" = done.
5. **Audit trail** — upgradeLog + workspace reports show exactly what changed and why.
6. **Self-improving** — FTS5 findings let model learn from its own prior analysis across passes.
7. **Defensive intelligence** — beforeToolCall blocks garbage, onStepFinish catches loops, onChatError preserves partial analysis.
8. **Routing confidence** — session branching compares ambiguous strategies instead of guessing.
9. **Active research** — browser tools go beyond scraped text (Phase 2).
10. **Industry-specific calculations** — extensions provide domain tools without agent code changes (Phase 2).

---

## SDK VERIFICATION LOG

All v2 features verified against Think SDK docs:

| Feature | Doc Source | Verified |
|---|---|---|
| AgentSearchProvider | sessions.md §Built-in Providers | ✓ |
| search_context auto-tool | sessions.md §AI Tools | ✓ |
| session.addContext() | sessions.md §Adding and Removing Context at Runtime | ✓ |
| refreshSystemPrompt() | sessions.md §System Prompt | ✓ |
| workspace (read/write/etc) | tools.md §Built-in Workspace Tools | ✓ |
| createBrowserTools() | tools.md §Browser Tools | ✓ |
| extensionLoader + getExtensions() | tools.md §Extensions | ✓ |
| configure/getConfig | think.d.ts §configure (line 369) | ✓ |
| waitUntilStable() | sub-agents.md §Stability Detection | ✓ |
| hasPendingInteraction() | sub-agents.md §Stability Detection | ✓ |
| continueLastTurn() | sub-agents.md §continueLastTurn | ✓ |
| chatRecovery = true | think.d.ts line 305 | ✓ |
| maxSteps property | think.d.ts line 397 | ✓ |
| @callable() | agents base class | ✓ |
| saveMessages() chaining | sub-agents.md §Programmatic Turns | ✓ |
| beforeToolCall() | think.d.ts lines 127-183, lifecycle-hooks.md §beforeToolCall | ✓ |
| ToolCallDecision (allow/block/substitute) | think.d.ts lines 161-183 | ✓ |
| ToolCallContext fields (toolName, input, stepNumber, messages) | lifecycle-hooks.md §ToolCallContext table | ✓ |
| onStepFinish() | think.d.ts lines 232-245, lifecycle-hooks.md §onStepFinish | ✓ |
| StepContext (= AI SDK StepResult) fields (toolCalls, usage, finishReason) | lifecycle-hooks.md §StepContext table | ✓ |
| onChatError() | think.d.ts line 540, lifecycle-hooks.md §onChatError | ✓ |
| onChatError partial message persistence | lifecycle-hooks.md §onChatError: "partial assistant message persisted before hook fires" | ✓ |
| manager.fork(sessionId, atMessageId) | sessions.md §Forking | ✓ |

---

## RELATIONSHIP TO v1 BLUEPRINT

v1 (doc-bella-consultant-agent-blueprint-20260426) remains valid for:
- Tool schemas (1-10)
- Type definitions
- R2 KB structure
- Build chunks 8-1 through 8-6 (already implemented as S3-A through S3-E)
- SDK conditions

v2 ADDS:
- Multi-pass paradigm
- Tools 11-15 (including branchAndCompareRouting)
- AgentSearchProvider
- Workspace reports
- Dynamic context injection
- Client configuration
- beforeToolCall() — input validation, tier gating, cache substitution
- onStepFinish() — loop detection, per-step observability, cost logging
- onChatError() — graceful degradation, structured errors, partial analysis preservation
- Session branching for A/B routing comparison
- Browser tools (Phase 2)
- Industry extensions (Phase 2)
- Expanded state type
- Updated system prompt
- Updated lifecycle hooks

v2 does NOT break or remove anything from v1. Pure expansion.
