# BELLA ROI AGENT BLUEPRINT — COMPUTATION TEMPLATE
**Doc ID:** doc-bella-roi-agent-blueprint-20260427
**Date:** 2026-04-27 AEST
**Authority:** Trent Belasco + T9 Architect (Opus)
**Status:** CANONICAL — Template 2 of 3 (Think-First Law)
**Supersedes:** doc-bella-roi-quote-agent-blueprint-20260426 (T2 blueprint — formulas still valid)
**Extends:** doc-bella-roi-quote-machine-architecture-t9-20260426 (arch decisions still valid)
**CF docs consulted:** YES — think.d.ts §beforeToolCall (line 127-183), §onStepFinish (line 232-244), §ToolCallDecision (line 162-183); sessions.md §Forking (line 504-513), §Branching (line 127-133)

---

## PURPOSE

This blueprint defines the ROI Agent as a Think sub-agent AND establishes the **COMPUTATION template** — the reference pattern for any agent that mixes deterministic formulas with LLM reasoning.

ConsultantAgent v2 (Template 1: ANALYSIS) is 100% LLM-driven. The model decides what to analyze and writes all output.

ROI Agent (Template 2: COMPUTATION) is different: the MODEL decides WHEN and WHAT to calculate, but the CALCULATION ITSELF is deterministic code. No LLM-generated math. Ever. This is V3 design law: **no ROI hallucination**.

---

## ARCHITECTURE OVERVIEW

```
RoiAgent extends Think<Env, RoiState>
│
├── DETERMINISTIC CORE
│   ├── 5 calculation tools (formulas are hardcoded, not LLM-generated)
│   ├── beforeToolCall() — input validation gate
│   ├── Industry rate tables as TS constants (stats-kb/)
│   └── V3 law: model picks the tool, code does the math
│
├── LLM REASONING LAYER
│   ├── Model interprets prospect context to choose calculations
│   ├── Model decides which inputs to use (prospect-stated vs consultant-inferred)
│   ├── Model generates natural language rationale around deterministic numbers
│   ├── R2SkillProvider — agent stats KBs for rationale grounding
│   └── Writable reasoning context block for calculation planning
│
├── VALIDATION FRAMEWORK
│   ├── beforeToolCall() blocks bad inputs with model-readable reasons
│   ├── afterToolCall() logs every calculation for audit
│   ├── onStepFinish() detects calculation loops
│   └── All outputs include confidence + assumptions array
│
├── QUOTE MACHINE (industry-specific)
│   ├── calculateQuote with z.discriminatedUnion per industry
│   ├── Rate tables from stats-kb/industry-rates.ts
│   ├── Consultant provides industry_quote_type + typical_job_sizes
│   └── Pre-built per prospect — Chris demo sees quotes before asking
│
├── SESSION BRANCHING (Quote A/B)
│   ├── Fork session at quote decision point
│   ├── Run two strategies (conservative vs aggressive)
│   ├── Compare results, present best to prospect
│   └── SessionManager.fork() with message-level branching
│
├── STABILITY + RECOVERY
│   ├── chatRecovery = true
│   ├── waitUntilStable() before parent reads
│   ├── Public getters for SubAgentStub access
│   └── State versioning for stale-read guard
│
└── OBSERVABILITY
    ├── onStepFinish() — per-step calculation audit
    ├── afterToolCall() — per-tool timing + result logging
    ├── Workspace reports — calculation history per lead
    └── upgradeLog for multi-pass recalculation tracking
```

---

## THE KEY DISTINCTION: DETERMINISTIC vs LLM

```
┌──────────────────────────────────────────────────────────┐
│                    LLM DECIDES                            │
│                                                          │
│  "This prospect has 200 inbound leads, responds in       │
│   30+ minutes, and their ACV is around $5000.            │
│   Alex speed-to-lead is the highest-impact agent.        │
│   I should calculate ROI for Alex first."                │
│                                                          │
│  → Model calls calculateROI({ agent: "alex", ... })     │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                  CODE CALCULATES                          │
│                                                          │
│  incrementalRate = alexGapFactor(0.85) ×                │
│    (3.94 - currentRate) × currentRate                    │
│  weeklyValue = 200 × incrementalRate × 5000              │
│                                                          │
│  → Returns { weeklyValue: 3348, confidence: "high",     │
│              assumptions: ["band: next_day+", ...] }     │
└──────────────────────────┬───────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│                LLM PRESENTS NATURALLY                     │
│                                                          │
│  "Based on your current response time, just by getting   │
│   Alex handling those leads instantly, you're looking    │
│   at roughly thirty-three hundred dollars extra per      │
│   week. And that's a conservative estimate."             │
└──────────────────────────────────────────────────────────┘
```

**VIOLATION:** Any tool whose `execute()` calls an LLM to produce a number. Numbers come from formulas. Period.

---

## ROI STATE TYPE

```typescript
interface RoiState {
  leadId: string;
  calculationVersion: number;
  lastCalculatedAt: string;
  dataSourcesProcessed: string[];  // ["consultant", "prospect_verbal", "deep_intel"]

  // Inputs (collected from multiple sources)
  inputs: {
    acv: number | null;
    acvSource: "prospect" | "consultant" | "industry_benchmark";
    inboundLeads: number | null;
    responseSpeedBand: ResponseSpeedBand | null;
    webLeads: number | null;
    webConversionRate: number | null;
    missedCalls: number | null;
    oldLeads: number | null;
    customersPerWeek: number | null;
    googleRating: number | null;
    reviewCount: number | null;
    industryQuoteType: string | null;
  };

  // Results (deterministic outputs)
  roiResults: Partial<Record<AgentName, AgentRoiResult>>;
  combinedWeeklyValue: number | null;
  quoteResults: Record<string, QuoteResult>;

  // Metadata
  calculationLog: Array<{
    version: number;
    tool: string;
    inputs: Record<string, unknown>;
    output: Record<string, unknown>;
    durationMs: number;
    at: string;
  }>;
  confidence: "low" | "medium" | "high";
  assumptionsSummary: string[];
}

type ResponseSpeedBand = "under_30s" | "under_5min" | "5_30min" | "30min_2h" | "2_24h" | "next_day_plus";

interface AgentRoiResult {
  weeklyValue: number;
  confidence: "low" | "medium" | "high";
  assumptionsUsed: string[];
  rationale: string;
  conservative: boolean;
}

interface QuoteResult {
  jobType: string;
  description: string;
  totalEstimate: number;
  breakdown: QuoteLineItem[];
  confidence: "low" | "medium" | "high";
  source: "industry_benchmark" | "site_pricing" | "blended";
  rateTableVersion: string;
  inputsSummary: Record<string, unknown>;
  createdAt: string;
}

interface QuoteLineItem {
  item: string;
  quantity: number;
  unitLabel: string;
  unitRate: number;
  lineTotal: number;
}
```

---

## 5 TOOLS — ALL DETERMINISTIC

### Tool 1: calculateAgentROI

Core ROI calculation per agent. Formulas from frozen-bella-rescript-v2 roi.ts (V2, AUDIT-1 approved).

```typescript
calculateAgentROI: tool({
  description: "Calculate weekly ROI value for a specific Bella agent. Uses deterministic formulas — never estimate the numbers yourself, always call this tool.",
  inputSchema: z.object({
    agent: z.enum(["alex", "chris", "maddie", "sarah", "james"]),
    acv: z.number().positive(),
    // Agent-specific inputs
    inboundLeads: z.number().optional(),           // Alex, Chris
    responseSpeedBand: z.enum([
      "under_30s", "under_5min", "5_30min",
      "30min_2h", "2_24h", "next_day_plus"
    ]).optional(),                                   // Alex
    webConversionRate: z.number().min(0).max(1).optional(),  // Chris
    missedCalls: z.number().optional(),             // Maddie
    oldLeads: z.number().optional(),                // Sarah
    customersPerWeek: z.number().optional(),         // James
    googleRating: z.number().min(1).max(5).optional(), // James
  }),
  execute: async (input) => {
    // DETERMINISTIC — hardcoded formulas, no LLM
    const result = computeAgentROI(input);
    
    const cs = this.state as RoiState;
    this.setState({
      ...cs,
      roiResults: { ...(cs.roiResults ?? {}), [input.agent]: result },
      calculationVersion: cs.calculationVersion + 1,
      lastCalculatedAt: new Date().toISOString(),
      calculationLog: [...(cs.calculationLog ?? []), {
        version: cs.calculationVersion + 1,
        tool: "calculateAgentROI",
        inputs: input,
        output: result,
        durationMs: 0, // filled by afterToolCall
        at: new Date().toISOString(),
      }],
    });
    
    return result;
  },
}),
```

### Tool 2: calculateCombinedROI

Combines Alex + Chris + Maddie (Sarah + James excluded by design).

```typescript
calculateCombinedROI: tool({
  description: "Calculate combined weekly ROI across core agents (Alex + Chris + Maddie). Call AFTER individual agent ROIs are computed.",
  inputSchema: z.object({}),
  execute: async () => {
    const cs = this.state as RoiState;
    const alex = cs.roiResults?.alex?.weeklyValue ?? 0;
    const chris = cs.roiResults?.chris?.weeklyValue ?? 0;
    const maddie = cs.roiResults?.maddie?.weeklyValue ?? 0;
    
    const combined = alex + chris + maddie;
    const confidence = this.deriveCombinedConfidence(cs.roiResults);
    
    this.setState({
      ...cs,
      combinedWeeklyValue: combined,
      confidence,
      calculationVersion: cs.calculationVersion + 1,
    });
    
    return {
      weeklyValue: combined,
      monthlyValue: combined * 4.33,
      annualValue: combined * 52,
      breakdown: {
        alex: cs.roiResults?.alex?.weeklyValue ?? 0,
        chris: cs.roiResults?.chris?.weeklyValue ?? 0,
        maddie: cs.roiResults?.maddie?.weeklyValue ?? 0,
      },
      confidence,
      excludedAgents: ["sarah", "james"],
      excludedReason: "Optional agents — excluded from core combined by design",
    };
  },
}),
```

### Tool 3: calculateQuote

Industry-specific quoting with z.discriminatedUnion. Rate tables from stats-kb/industry-rates.ts.

```typescript
calculateQuote: tool({
  description: "Generate a quote for a specific job type. Uses industry benchmark rate tables — deterministic pricing, not estimates.",
  inputSchema: z.discriminatedUnion("jobType", [
    z.object({
      jobType: z.literal("carpet_installation"),
      roomType: z.enum(["bedroom", "living_room", "hallway", "commercial", "full_home"]),
      squareMetres: z.number().optional(),
      carpetGrade: z.enum(["budget", "mid", "premium", "commercial"]),
      includesUnderlay: z.boolean().default(true),
      includesRemoval: z.boolean().default(false),
    }),
    z.object({
      jobType: z.literal("dental"),
      treatmentType: z.enum(["crown", "implant", "whitening", "checkup", "extraction", "braces"]),
      patientType: z.enum(["new", "existing"]),
      complexity: z.enum(["standard", "complex"]).optional(),
    }),
    z.object({
      jobType: z.literal("legal"),
      matterType: z.enum(["conveyancing", "family", "commercial", "will", "dispute"]),
      complexity: z.enum(["standard", "complex"]),
      estimatedHours: z.number().optional(),
    }),
    z.object({
      jobType: z.literal("trade_generic"),
      serviceType: z.string(),
      size: z.union([z.number(), z.string()]).optional(),
      materials: z.array(z.string()).optional(),
      urgency: z.enum(["standard", "urgent"]).optional(),
    }),
  ]),
  execute: async (input) => {
    // DETERMINISTIC — rate tables, not LLM
    const rates = INDUSTRY_RATES[input.jobType];
    if (!rates) return { error: `No rate table for ${input.jobType}` };
    
    const quote = buildQuote(input, rates);
    
    const cs = this.state as RoiState;
    const key = buildQuoteKey(input);
    this.setState({
      ...cs,
      quoteResults: { ...(cs.quoteResults ?? {}), [key]: quote },
      calculationVersion: cs.calculationVersion + 1,
    });
    
    return quote;
  },
}),
```

### Tool 4: updateInputs

Model updates calculation inputs when new data arrives (prospect verbal, deep intel).

```typescript
updateInputs: tool({
  description: "Update calculation inputs when new data arrives. Call this when the prospect shares numbers or deep intel provides data. Then recalculate affected agents.",
  inputSchema: z.object({
    field: z.enum([
      "acv", "inboundLeads", "responseSpeedBand", "webLeads",
      "webConversionRate", "missedCalls", "oldLeads", "customersPerWeek",
      "googleRating", "reviewCount", "industryQuoteType"
    ]),
    value: z.union([z.number(), z.string()]),
    source: z.enum(["prospect", "consultant", "deep_intel", "industry_benchmark"]),
    reason: z.string(),
  }),
  execute: async (args) => {
    const cs = this.state as RoiState;
    const inputs = { ...(cs.inputs ?? {}) };
    (inputs as any)[args.field] = args.value;
    
    if (args.field === "acv") {
      inputs.acvSource = args.source as "prospect" | "consultant" | "industry_benchmark";
    }
    
    const sources = [...(cs.dataSourcesProcessed ?? [])];
    if (!sources.includes(args.source)) sources.push(args.source);
    
    this.setState({ ...cs, inputs, dataSourcesProcessed: sources });
    
    return {
      status: "updated",
      field: args.field,
      value: args.value,
      source: args.source,
      note: "Recalculate affected agents to see updated ROI.",
    };
  },
}),
```

### Tool 5: writeCalculationReport

Writes structured report to workspace for parent and audit trail.

```typescript
writeCalculationReport: tool({
  description: "Write a calculation report to workspace. Call after all calculations complete.",
  inputSchema: z.object({
    reportType: z.enum(["initial", "recalculation", "final"]),
    summary: z.string(),
  }),
  execute: async (args) => {
    const cs = this.state as RoiState;
    const filename = `calculations/${cs.leadId}/v${cs.calculationVersion}-${args.reportType}.md`;
    
    const lines = [
      `# ROI Calculation Report — ${args.reportType.toUpperCase()}`,
      `Lead: ${cs.leadId}`,
      `Version: ${cs.calculationVersion}`,
      `Confidence: ${cs.confidence}`,
      `Timestamp: ${new Date().toISOString()}`,
      "",
      "## Inputs",
      ...Object.entries(cs.inputs ?? {}).map(([k, v]) => `- ${k}: ${v}`),
      "",
      "## Agent ROI Results",
      ...Object.entries(cs.roiResults ?? {}).map(
        ([agent, r]) => `- ${agent}: $${r?.weeklyValue}/wk (${r?.confidence}) — ${r?.rationale}`
      ),
    ];
    
    if (cs.combinedWeeklyValue != null) {
      lines.push("", `## Combined: $${cs.combinedWeeklyValue}/wk`);
    }
    
    if (Object.keys(cs.quoteResults ?? {}).length > 0) {
      lines.push("", "## Quotes");
      for (const [key, q] of Object.entries(cs.quoteResults ?? {})) {
        lines.push(`- ${key}: $${q.totalEstimate} (${q.confidence}) — ${q.source}`);
      }
    }
    
    lines.push("", "## Summary", args.summary);
    lines.push("", "## Assumptions", ...(cs.assumptionsSummary ?? []).map(a => `- ${a}`));
    
    await this.workspace.writeFile(filename, lines.join("\n"));
    return { status: "written", filename, version: cs.calculationVersion };
  },
}),
```

---

## beforeToolCall() — INPUT VALIDATION GATE

This is the key pattern ConsultantAgent doesn't have. ROI calculations produce garbage from garbage inputs. Validate BEFORE compute.

```typescript
async beforeToolCall(ctx: ToolCallContext): Promise<ToolCallDecision | void> {
  if (ctx.toolName === "calculateAgentROI") {
    const input = ctx.input as { agent: string; acv?: number; inboundLeads?: number; responseSpeedBand?: string; missedCalls?: number };
    
    // Block: ACV is required for all calculations
    if (!input.acv || input.acv <= 0) {
      return {
        action: "block",
        reason: "ACV (average customer value) is required and must be positive. Ask the prospect or use consultant estimate.",
      };
    }
    
    // Block: Agent-specific required inputs
    if (input.agent === "alex" && !input.responseSpeedBand) {
      return {
        action: "block",
        reason: "Alex ROI requires responseSpeedBand. Ask how quickly they respond to leads, or use consultant's assessment.",
      };
    }
    if (input.agent === "maddie" && (!input.missedCalls || input.missedCalls <= 0)) {
      return {
        action: "block",
        reason: "Maddie ROI requires missedCalls count > 0. Ask how many calls they miss per week.",
      };
    }
    
    // Substitute: Use cached result if inputs unchanged
    const cs = this.state as RoiState;
    const existing = cs.roiResults?.[input.agent as AgentName];
    if (existing && this.inputsUnchanged(input.agent, input)) {
      return {
        action: "substitute",
        output: { ...existing, note: "Cached — inputs unchanged since last calculation" },
      };
    }
  }
  
  if (ctx.toolName === "calculateCombinedROI") {
    const cs = this.state as RoiState;
    const hasAny = cs.roiResults && Object.keys(cs.roiResults).length > 0;
    if (!hasAny) {
      return {
        action: "block",
        reason: "No individual agent ROI results yet. Calculate at least one agent first.",
      };
    }
  }
}
```

**Why this matters:**
- `block` returns a model-readable reason. Model adjusts — asks prospect for the missing input, or uses consultant data.
- `substitute` returns cached result. No redundant recalculation. afterToolCall still fires for logging.
- ConsultantAgent doesn't need this because analysis outputs are always LLM-generated text. ROI outputs are numbers — wrong inputs = wrong numbers = trust destroyed.

---

## onStepFinish() — CALCULATION LOOP DETECTION

```typescript
async onStepFinish(ctx: StepContext) {
  // Detect calculation loops — model repeatedly calling same tool
  const cs = this.state as RoiState;
  const recentCalcs = (cs.calculationLog ?? []).slice(-5);
  const sameToolCount = recentCalcs.filter(
    c => c.tool === "calculateAgentROI" && c.inputs?.agent === recentCalcs[recentCalcs.length - 1]?.inputs?.agent
  ).length;
  
  if (sameToolCount >= 3) {
    console.log(`[ROI_LOOP] Agent ${recentCalcs[recentCalcs.length - 1]?.inputs?.agent} calculated 3+ times in last 5 steps`);
  }
}
```

---

## afterToolCall() — AUDIT LOGGING

```typescript
async afterToolCall(ctx: ToolCallResultContext) {
  const cs = this.state as RoiState;
  
  if (ctx.toolName === "calculateAgentROI" && ctx.success) {
    console.log(`[ROI] ${ctx.input.agent}: $${ctx.output.weeklyValue}/wk (${ctx.output.confidence}) [${ctx.durationMs}ms]`);
  }
  if (ctx.toolName === "calculateQuote" && ctx.success) {
    console.log(`[QUOTE] ${ctx.input.jobType}: $${ctx.output.totalEstimate} (${ctx.output.confidence}) [${ctx.durationMs}ms]`);
  }
  if (ctx.toolName === "calculateCombinedROI" && ctx.success) {
    console.log(`[ROI_COMBINED] $${ctx.output.weeklyValue}/wk — alex:$${ctx.output.breakdown.alex} chris:$${ctx.output.breakdown.chris} maddie:$${ctx.output.breakdown.maddie}`);
  }
}
```

---

## SESSION BRANCHING — Quote A/B Comparison

For complex quoting scenarios, fork the session to compare strategies.

```typescript
// In RoiAgent — branching for quote comparison
async compareQuoteStrategies(jobType: string, inputs: Record<string, unknown>) {
  const session = this.getSession();
  const currentMessageId = session.getHistory().at(-1)?.id;
  if (!currentMessageId) return null;
  
  // Fork at current point
  const manager = this.getSessionManager();
  const forked = await manager.fork(session.id, currentMessageId, `quote-compare-${jobType}`);
  
  // Strategy A: conservative (industry benchmark only)
  const conservativeQuote = buildQuote(
    { ...inputs, strategy: "conservative" },
    INDUSTRY_RATES[jobType]
  );
  
  // Strategy B: aggressive (site pricing signals if available)
  const cs = this.state as RoiState;
  const pricingSignals = cs.inputs?.pricingSignals;
  const aggressiveQuote = pricingSignals
    ? buildQuote({ ...inputs, strategy: "aggressive", siteRates: pricingSignals }, INDUSTRY_RATES[jobType])
    : conservativeQuote;
  
  return {
    conservative: conservativeQuote,
    aggressive: aggressiveQuote,
    recommendation: aggressiveQuote.totalEstimate > conservativeQuote.totalEstimate * 1.3
      ? "conservative"  // If aggressive is >30% higher, safer to go conservative
      : "aggressive",   // Otherwise, site-informed pricing is more credible
    forkSessionId: forked.id,
  };
}
```

**When to branch:**
- Prospect's site has pricing signals AND industry benchmarks differ significantly
- Multiple job types could apply (e.g. carpet installer who also does vinyl)
- Client config requests both conservative and aggressive quotes

**When NOT to branch:**
- Single industry, no pricing signals — one path only
- MVP — branching is Phase 2 capability

---

## configureSession() — COMPUTATION AGENT PATTERN

```typescript
configureSession(session: Session) {
  return session
    .withContext("task", {
      provider: { get: async () => ROI_SYSTEM_PROMPT },
    })
    
    // Agent stats KBs — ROI rationale grounding
    .withContext("agent_stats", {
      provider: new R2SkillProvider(this.env.AGENT_KB_BUCKET, { prefix: "stats-kb/" }),
    })
    
    // Writable calculation planning scratchpad
    .withContext("reasoning", {
      description: "Your calculation planning — note which agents to calculate, what inputs you have vs need, confidence assessment. On recalculation, note what changed.",
      maxTokens: 3000,
    })
    
    // Rate tables as context (industry-specific, loaded dynamically)
    .withContext("rate_tables", {
      provider: {
        get: async () => {
          const cs = this.state as RoiState | null;
          const industry = cs?.inputs?.industryQuoteType;
          if (!industry || !INDUSTRY_RATES[industry]) return "No industry rates loaded yet.";
          return `Industry: ${industry}\nRates:\n${JSON.stringify(INDUSTRY_RATES[industry].entries, null, 2)}`;
        },
      },
    })
    
    .withCachedPrompt()
    .onCompaction(createCompactFunction({
      summarize: (prompt: string) =>
        generateText({ model: this.getModel(), prompt }).then((r) => r.text),
      protectHead: 3,
      tailTokenBudget: 6000,
      minTailMessages: 2,
    }))
    .compactAfter(10000);  // Lower threshold — calculation sessions are shorter
}
```

---

## SYSTEM PROMPT — COMPUTATION AGENT

```typescript
const ROI_SYSTEM_PROMPT = `You are an ROI calculation engine for Bella's sales demo.
Your job: take prospect data and compute deterministic ROI and quotes.

CRITICAL LAW: NEVER estimate numbers yourself. ALWAYS use the calculation tools.
Your role is to decide WHAT to calculate and with WHAT inputs. The tools do the math.

INPUTS come from:
- Consultant analysis (business profile, digital presence, routing)
- Prospect verbal data (ACV, lead volume, response time, missed calls)
- Deep intel (Google rating, hiring signals, ad spend)
- Industry benchmarks (when prospect data unavailable)

PRIORITY ORDER for inputs: prospect-stated > deep intel > consultant estimate > industry benchmark.

CALCULATION SEQUENCE:
1. Review available inputs via updateInputs for any new data
2. Calculate individual agent ROIs in priority order (from routing)
3. Calculate combined ROI (Alex + Chris + Maddie)
4. If industry quoting applicable, calculate quote
5. Write calculation report

AGENT FORMULAS (reference only — tools implement these):
- Alex (Speed-to-Lead): leads × incrementalRate × acv. Gap factor by response band.
- Chris (Website Conversion): leads × uplift(0.23, capped 35%) × acv.
- Maddie (Missed Call Recovery): missedCalls × recoveryRate(0.35) × bookedValue(0.5) × acv.
- Sarah (Database Reactivation): oldLeads × reactivation(0.05) × acv. OPTIONAL — excluded from combined.
- James (Review Uplift): customers × acv × uplift × 0.07. OPTIONAL — excluded from combined.

WHEN TO RECALCULATE:
- Prospect provides new data (ACV, lead count, response time)
- Deep intel arrives with better data
- Parent explicitly requests recalculation

RULES:
- Never say dollar amounts with symbols — say "three thousand dollars per week"
- Always mention confidence level and key assumptions
- If inputs are missing, say what you need — don't guess numbers
- Combined ROI = Alex + Chris + Maddie only. Sarah/James are bonus.`;
```

---

## PARENT INTEGRATION — BellaAgent

```typescript
// BellaAgent — ROI sub-agent orchestration

async runROICalculation(inputs: Record<string, any>) {
  const roi = await this.subAgent(RoiAgent, "roi");
  
  await roi.chat(
    `Calculate ROI for this prospect:\n${JSON.stringify(inputs, null, 2)}`,
    { onEvent: () => {}, onDone: () => {}, onError: (err) => console.error(`[ROI_ERR] ${err}`) },
  );
  
  await roi.waitUntilStable({ timeout: 15_000 });
  
  const results = await roi.getResults();
  this.mergeROIResults(results);
  console.log(`[ROI_COMPLETE] combined=$${results.combinedWeeklyValue}/wk confidence=${results.confidence}`);
}

// Called when prospect provides new data mid-call
async updateROIInput(field: string, value: number | string, source: string) {
  const roi = await this.subAgent(RoiAgent, "roi");
  
  await roi.chat(
    `Prospect update: ${field} = ${value} (source: ${source}). Update inputs and recalculate affected agents.`,
    { onEvent: () => {}, onDone: () => {}, onError: (err) => console.error(`[ROI_UPDATE_ERR] ${err}`) },
  );
  
  await roi.waitUntilStable({ timeout: 15_000 });
  
  const results = await roi.getResults();
  this.mergeROIResults(results);
}

// Called for Chris demo quoting
async runQuote(jobType: string, jobInputs: Record<string, unknown>) {
  const roi = await this.subAgent(RoiAgent, "roi");
  
  await roi.chat(
    `Generate a quote for: ${jobType}\nInputs: ${JSON.stringify(jobInputs, null, 2)}`,
    { onEvent: () => {}, onDone: () => {}, onError: (err) => console.error(`[QUOTE_ERR] ${err}`) },
  );
  
  await roi.waitUntilStable({ timeout: 10_000 });
  return roi.getQuoteResults();
}
```

---

## PUBLIC GETTERS (SubAgentStub-accessible)

```typescript
getResults(): RoiState {
  return this.state as RoiState;
}

getCombinedROI(): number | null {
  return (this.state as RoiState)?.combinedWeeklyValue ?? null;
}

getAgentROI(agent: AgentName): AgentRoiResult | null {
  return (this.state as RoiState)?.roiResults?.[agent] ?? null;
}

getQuoteResults(): Record<string, QuoteResult> {
  return (this.state as RoiState)?.quoteResults ?? {};
}

getCalculationVersion(): number {
  return (this.state as RoiState)?.calculationVersion ?? 0;
}

getConfidence(): string {
  return (this.state as RoiState)?.confidence ?? "unknown";
}

getCalculationLog(): RoiState["calculationLog"] {
  return (this.state as RoiState)?.calculationLog ?? [];
}
```

---

## ROI FORMULAS — CANONICAL (from frozen-bella-rescript-v2 roi.ts, AUDIT-1 approved)

### Alex (Speed-to-Lead)
```
incrementalRate = alexGapFactor(band) × (ALEX_MAX_UPLIFT=3.94 - currentRate) × currentRate
weeklyValue = leads × incrementalRate × acv
Gap factors: under_30s=0.0, under_5min=0.05, 5_30min=0.35, 30min_2h=0.6, 2_24h=0.85, next_day+=1.0
```

### Chris (Website Conversion)
```
incrementalRate = CHRIS_UPLIFT(0.23), capped at 35%
weeklyValue = leads × incrementalRate × acv
Confidence: medium if currentRate known, else low
```

### Maddie (Missed Call Recovery)
```
recoverableCalls = missedCalls × MADDIE_RECOVERY_RATE(0.35)
weeklyValue = recoverableCalls × acv × MADDIE_BOOKED_VALUE_RATE(0.5)
```

### Sarah (Database Reactivation) — OPTIONAL
```
weeklyValue = oldLeads × SARAH_REACTIVATION_RATE(0.05) × acv
```

### James (Review Uplift) — OPTIONAL
```
weeklyValue = newCustomersPerWeek × acv × projectedUplift × 0.07
```

### Combined = Alex + Chris + Maddie ONLY

---

## WHAT MAKES THIS A COMPUTATION TEMPLATE

Patterns unique to computation agents (not in ConsultantAgent v2):

| Pattern | Why computation agents need it |
|---------|-------------------------------|
| **beforeToolCall() validation** | Bad inputs = bad numbers = trust destroyed. Block and tell model what's missing. |
| **Deterministic execute()** | Tool bodies are formulas, not LLM calls. V3 law. |
| **Cache via substitute** | Same inputs = same output. Don't recalculate. |
| **onStepFinish() loop detection** | Model calculating same agent 3+ times = stuck. |
| **afterToolCall() audit** | Every calculation logged with inputs, output, timing. |
| **Session branching** | Compare strategies (conservative vs aggressive quotes). |
| **Rate tables as context blocks** | Industry-specific, loaded dynamically per prospect. |
| **Input source tracking** | prospect > deep_intel > consultant > benchmark. Priority waterfall. |
| **z.discriminatedUnion** | One tool, many industry schemas. Type-safe per variant. |
| **Calculation report** | Workspace file per version. Full audit trail for parent. |

---

## BUILD PHASES

### Phase 1 — Core ROI Sub-Agent (S7 sprint series)
- S7-A: RoiState type + 5 tools + beforeToolCall validation
- S7-B: configureSession + system prompt + R2SkillProvider
- S7-C: Parent integration (runROICalculation, updateROIInput)
- S7-D: afterToolCall + onStepFinish + workspace reports
- S7-E: Public getters + waitUntilStable + recovery

### Phase 2 — Quote Machine (S8 sprint series, Chris build)
- S8-A: calculateQuote discriminated union + rate tables
- S8-B: Consultant industry_quote_type extraction
- S8-C: Chris stage machine (quote_delivery stage)
- S8-D: LIVE QUOTE section in turn prompt
- S8-E: Session branching for Quote A/B

### Phase 3 — Scale (post-launch)
- KV-based client rate overrides
- extensionLoader for dynamic industry tools
- 20+ industry variants
- Client-uploaded pricing formulas

---

## SDK VERIFICATION LOG

| Feature | Doc Source | Verified |
|---|---|---|
| beforeToolCall() | think.d.ts line 443-489 | ✓ |
| ToolCallDecision (allow/block/substitute) | think.d.ts line 162-183 | ✓ |
| afterToolCall() | think.d.ts line 490+ | ✓ |
| onStepFinish() | think.d.ts line 232-244, 518 | ✓ |
| SessionManager.fork() | sessions.md line 504-513 | ✓ |
| Session branching (getBranches) | sessions.md line 127-133 | ✓ |
| workspace.writeFile | tools/workspace.d.ts (T5 to verify exact sig) | PENDING |
| R2SkillProvider | sessions.md §Built-in Providers | ✓ |
| waitUntilStable() | sub-agents.md §Stability Detection | ✓ |
| chatRecovery = true | think.d.ts line 305 | ✓ |
| maxSteps property | think.d.ts line 397 | ✓ |
| configureSession | think.d.ts, sessions.md | ✓ |
| z.discriminatedUnion | Zod v4.3.6 native | ✓ |

---

## RELATIONSHIP TO OTHER DOCS

| Doc | Relationship |
|-----|-------------|
| `canonical/think-first-law.md` | This blueprint = Template 2 (Computation) |
| `doc-bella-consultant-agent-v2-blueprint-20260427.md` | Template 1 (Analysis) — ConsultantAgent feeds inputs to ROI |
| `doc-bella-roi-quote-machine-architecture-t9-20260426.md` | Prior arch doc — 6 decisions still valid, this blueprint implements them as Think sub-agent |
| `doc-bella-roi-quote-agent-blueprint-20260426.md` | Prior T2 blueprint — formulas still valid, superseded by this for implementation |
| `canonical/think-migration-mandate.md` | Migration plan says "ROI = SOPHISTICATED sub-agent with 5 tools" — this delivers that |
