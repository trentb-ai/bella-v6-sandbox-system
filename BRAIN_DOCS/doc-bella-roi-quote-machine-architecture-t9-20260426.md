# BELLA ROI + QUOTE AGENT MACHINE — FULL ARCHITECTURE (T9)
**Doc ID:** doc-bella-roi-quote-machine-architecture-t9-20260426
**Date:** 2026-04-26 AEST
**Author:** T9 Architect (Opus)
**Authority:** Trent Belasco
**Status:** CANONICAL — file to D1 on MCP reconnect
**Related:** doc-bella-roi-quote-agent-blueprint-20260426 (T2 blueprint)

---

## EXECUTIVE SUMMARY

This document captures the full architectural design for Bella's ROI + Quote Agent Machine, built on Cloudflare's Think Agent framework (`@cloudflare/think v0.4.0`). It covers Trent's strategic vision, the Think Agent integration model, all 6 architectural decisions with rationale, the extensibility path from MVP to scale, and implementation boundaries.

Bella (and Chris, Maddie, Alex, Sarah, James) are not just conversational agents. They are **full quoting machines** for any industry. Every demo is pre-loaded with a quoting engine built specifically for that prospect's industry, powered by scrape data + consultant enrichment + industry benchmark rate tables.

---

## TRENT'S STRATEGIC VISION (verbatim)

> "Various applications of this tech — key to letting clients run sales calls with Bella on their own website or with Chris/Maddie etc. They will all be able to not just calculate ROI, but give quotes. They need to take in all kinds of data like size of a room and type of carpet to quote a new carpet laid etc. This is a key part of our offering."

> "Make sure it references actual statistics for each agent's calculations."

> "The include links to this very visibly and prominently in Chris agent build — must be carefully linked so we find it and remember to install the full quote machine in Chris demo — pre-built based on the user's website, offers, and industry best practice, so we pre-emptively create a quoting machine for every demo in Chris."

### What this means architecturally:
1. **Every agent demo** (Bella, Chris, Maddie, Alex, Sarah, James) has quoting capability — not just ROI
2. **Pre-emptive** — the quoting machine is built BEFORE the prospect speaks, from scrape + consultant data
3. **Industry-adaptive** — carpet layer gets carpet quoting, dental gets dental quoting, legal gets legal quoting
4. **Statistics-backed** — actual research stats justify every agent's ROI calculation (already in stats-kb/)
5. **Chris is the flagship** for quoting — his demo must prominently feature the quote machine

---

## THINK AGENT ARCHITECTURE — HOW THIS FITS

### Think Agent Framework Overview

`@cloudflare/think v0.4.0` is Cloudflare's opinionated chat agent base class, extending `Agent` from the `agents` package. Key characteristics relevant to this design:

**Class hierarchy:**
```
Agent (agents) → Think<Env, State, Props> (@cloudflare/think)
                    → BellaAgent extends Think<Env>
```

**Runtime:** Cloudflare Durable Object with SQLite-backed state. Each lead gets its own DO instance via `idFromName(leadId)`. State survives hibernation and eviction via `chatRecovery = true` (fiber-wrapped turns).

**Tool system (Think merge order — later overrides earlier):**
1. Workspace tools (built-in: read, write, edit, list, find, grep, delete)
2. `getTools()` — custom server-side tools ← **calculateROI + calculateQuote live here**
3. Session tools (set_context, load_context, search_context)
4. Extension tools (from loaded extensions, namespaced by extension name)
5. MCP tools (from connected MCP servers)
6. Client tools (from browser)
7. Caller tools (from chat() options when used as sub-agent)

**Lifecycle hooks (all optional, all async-capable):**
- `configureSession(session)` — once at startup, configure context blocks + compaction
- `beforeTurn(ctx: TurnContext)` → `TurnConfig | void` — inspect/override model, system prompt, messages, tools, activeTools
- `beforeToolCall(ctx: ToolCallContext)` → `ToolCallDecision | void` — allow/block/substitute tool execution
- `afterToolCall(ctx: ToolCallResultContext)` → void — logging, metrics, result inspection
- `onStepFinish(ctx: StepContext)` → void — step-level analytics
- `onChunk(ctx: ChunkContext)` → void — per-token streaming (high frequency)
- `onChatResponse(result: ChatResponseResult)` → void — post-turn, message persisted, lock released

**Key types for this design:**

```typescript
// TurnContext — what beforeTurn sees
interface TurnContext {
  system: string;           // Assembled system prompt
  messages: ModelMessage[];  // Assembled model messages
  tools: ToolSet;           // Merged tool set (all 7 layers)
  model: LanguageModel;     // From getModel()
  continuation: boolean;    // Auto-continue after tool result?
  body?: Record<string, unknown>; // Custom client body fields
}

// TurnConfig — what beforeTurn can override
interface TurnConfig {
  model?: LanguageModel;     // Override model for this turn
  system?: string;           // Override system prompt
  messages?: ModelMessage[];  // Override messages
  tools?: ToolSet;           // Extra tools (additive merge)
  activeTools?: string[];    // Limit which tools model can call
  toolChoice?: ToolChoice;   // Force specific tool call
  maxSteps?: number;         // Override maxSteps
  providerOptions?: Record<string, unknown>;
}

// ToolCallDecision — beforeToolCall control
type ToolCallDecision =
  | { action: "allow"; input?: Record<string, unknown> }   // Run execute (optionally modified input)
  | { action: "block"; reason?: string }                    // Skip execute, model sees reason
  | { action: "substitute"; output: unknown; input?: Record<string, unknown> } // Skip execute, model sees output
```

**Session system:**
- Context blocks: persistent key-value sections in system prompt
- Compaction: LLM-driven message summarization when token count exceeds threshold
- FTS5 search over conversation history
- Supports R2SkillProvider for on-demand document loading

**Extension system:**
- `extensionLoader?: WorkerLoader` — binding for sandboxed extensions
- `getExtensions(): ExtensionConfig[]` — static extensions at startup
- Extensions are sandboxed Worker isolates with RPC overhead
- Tool names namespaced: `{extensionName}_{toolName}`
- Extensions can subscribe to lifecycle hooks (beforeTurn, beforeToolCall, afterToolCall, onStepFinish, onChunk)

---

## CURRENT STATE (What Exists Today)

### ROI System

| Component | Status | Location |
|---|---|---|
| roi.ts V2 formulas (correct, weekly-native, AUDIT-1 approved) | EXISTS in src/ but NOT wired | Think Agent brain `src/roi.ts` |
| roi-agent.ts (legacy /52 bug) | ACTIVE — calculateROI calls this — WRONG | Think Agent brain `src/roi-agent.ts` |
| S3-2 Action 0 (rewire to roi.ts) | In gate at T3a | bella-agent.ts |
| LIVE ROI section in turn prompt | S3-2 Action 0b | buildStageDirectiveContext |
| stats-kb/ agent knowledge bases | COMPLETE | `src/stats-kb/alex-speed-to-lead.ts` etc |

### ROI Formulas (V2, Canonical — from frozen-bella-rescript-v2-brain)

**Alex (Speed-to-Lead):**
- `leads × incrementalRate × acv`
- `incrementalRate = alexGapFactor(band) × (ALEX_MAX_UPLIFT=3.94 - currentRate) × currentRate`
- Gap factors: under_30s=0.0, under_5min=0.05, 5-30min=0.35, 30min-2h=0.6, 2-24h=0.85, next_day+=1.0
- Returns: `{ weeklyValue, confidence, assumptionsUsed, rationale, conservative }`

**Chris (Website Conversion):**
- `leads × incrementalRate × acv`
- `CHRIS_UPLIFT = 0.23` (capped 35%)
- Confidence: medium if currentRate known, else low

**Maddie (Missed Call Recovery):**
- `recoverableCalls × acv × MADDIE_BOOKED_VALUE_RATE(0.5)`
- `recoverableCalls = missedCalls × MADDIE_RECOVERY_RATE(0.35)`

**Sarah (Database Reactivation) — optional, excluded from combined:**
- `oldLeads × SARAH_REACTIVATION_RATE(0.05) × acv`

**James (Review Uplift) — optional, excluded from combined:**
- `newCustomersPerWeek × acv × projectedUplift × 0.07`

**Combined:** Alex + Chris + Maddie only. Sarah + James excluded by design.

### Quote System

**Nothing exists yet.** This is the gap this architecture fills.

### ConversationState (relevant fields)

```typescript
// Existing — ROI
calculatorResults: Partial<Record<AnyAgent, AgentRoiResult>>;
acv?: number | null;
// Alex inputs
inboundLeads?: number | null;
responseSpeedBand?: ResponseSpeedBand | null;
// Chris inputs
webLeads?: number | null;
webConversionRate?: number | null;
// Maddie inputs
missedCalls?: number | null;

// TO ADD — Quoting
quoteResults: Record<string, QuoteResult>;
```

### Consultant Output (current, from bella-consultant/worker.js)

Rich structured output including:
- `icpAnalysis` — ICP narrative, problems, solutions, bellaCheckLine
- `businessIdentity` — correctedName, spokenName, businessModel, serviceArea
- `conversionEventAnalysis` — primaryCTA, ctaType, ctaAgentMapping
- `hiringAnalysis` — topHiringWedge, matchedRoles
- `routing` — priority_agents, skip_agents, reasoning per agent
- `copyAnalysis`, `valuePropAnalysis`, `landingPageVerdict`, `redFlags`, `googlePresence`
- `conversationHooks`, `scriptFills` (legacy fallback)

### Stage Machine

Stages: greeting → wow (8 steps) → recommendation → ch_alex/ch_chris/ch_maddie → roi_delivery → close

Each stage controlled by STAGE_POLICIES in gate.ts with: requiredFields, minFieldsForEstimate, maxQuestions, forceAdvanceWhenSatisfied, calculatorKey, fallbackPolicy.

### Turn Prompt Assembly

`buildStageDirective()` → directive with objective, allowedMoves, speak, ask, waitForUser, canSkip.

`buildCriticalFacts()` → 6 items max from consultant intel (marketPosition, strongestBenefit, bizModel, serviceArea, topHiringWedge, verdictLine).

`buildContextNotes()` → 6 items max, stage-specific (routing reasoning, CTA mapping, red flags, strongest line, questions to prioritise).

Results surface as structured sections in turn prompt (LIVE ROI, LIVE QUOTE).

---

## ARCHITECTURAL DECISIONS (T9)

### Decision 1: Single calculateQuote Tool with Discriminated Union

**Decision:** One `calculateQuote` tool using `z.discriminatedUnion` on `jobType`, NOT per-industry separate tools.

**Think Agent context:** `getTools()` returns a flat `ToolSet`. All tools from getTools() are merged at position 2 in the merge order. `beforeTurn()` can use `activeTools: string[]` to limit which tools are visible per turn, but all tool schemas are still registered in the merged set.

**Implementation:**

```typescript
// In BellaAgent.getTools()
calculateQuote: tool({
  description: "Generate a quote for a specific job type based on prospect's industry",
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
    const quote = buildQuote(input, this.cs?.intel);
    if (quote && this.cs) {
      this.cs.quoteResults = {
        ...(this.cs.quoteResults ?? {}),
        [buildQuoteKey(input)]: quote,
      };
    }
    return quote;
  },
}),
```

**Rationale:**
- Gemini gets full type signal per industry variant — knows exactly what fields to collect
- One tool registration, not N — cleaner getTools(), simpler activeTools filtering
- Discriminated union is native Zod, no custom logic needed
- Schema grows with industries but manageable up to ~20 variants before context pressure

**Alternatives rejected:**
- Per-industry tools (carpetQuote, dentalQuote): Tool proliferation, all schemas visible even when irrelevant, harder to manage in beforeTurn activeTools
- Single tool with z.record(z.unknown()): Zero type signal for Gemini, would hallucinate field names
- extensionLoader dynamic tools: Sandbox overhead, RPC per call, premature for known schemas (see Decision 3)

**Invalidation criteria:** Revisit at 20+ industry variants if schema size impacts Gemini context budget.

### Decision 2: Industry Rate Tables as TS Constants in stats-kb/

**Decision:** Rate tables as typed TypeScript constants in `src/stats-kb/industry-rates.ts`. KV runtime lookup deferred to V2.

**Implementation:**

```typescript
// src/stats-kb/industry-rates.ts
export interface RateTableEntry {
  item: string;
  unitLabel: string;
  ratePerUnit: number;
  currency: "AUD" | "USD";
  source: string;
  lastUpdated: string;
}

export interface IndustryRateTable {
  industry: string;
  region: string;
  entries: Record<string, RateTableEntry[]>;
  defaultMarkup: number;
  notes: string;
}

export const INDUSTRY_RATES: Record<string, IndustryRateTable> = {
  carpet_installation: {
    industry: "Flooring & Carpet Installation",
    region: "AU",
    entries: {
      budget: [
        { item: "Budget carpet supply", unitLabel: "per sqm", ratePerUnit: 25, currency: "AUD", source: "Industry benchmark AU 2025", lastUpdated: "2026-01" },
        { item: "Installation labour", unitLabel: "per sqm", ratePerUnit: 35, currency: "AUD", source: "Industry benchmark AU 2025", lastUpdated: "2026-01" },
        { item: "Underlay", unitLabel: "per sqm", ratePerUnit: 12, currency: "AUD", source: "Industry benchmark AU 2025", lastUpdated: "2026-01" },
      ],
      mid: [ /* ... */ ],
      premium: [ /* ... */ ],
      commercial: [ /* ... */ ],
    },
    defaultMarkup: 1.0,
    notes: "Rates based on Australian metropolitan market averages",
  },
  dental: { /* ... */ },
  legal: { /* ... */ },
  trade_generic: { /* ... */ },
};
```

**Rationale:**
- Pattern consistent with existing `stats-kb/` knowledge bases (alex-speed-to-lead.ts etc)
- Type-safe: TypeScript catches missing fields at compile time
- Zero latency: no KV read on hot path, no network call during turn
- Easy to review in Codex gate: it's just a TS file with constants
- WIRING_RULES.ts already establishes the pattern for sourcing and citing stats

**V2 upgrade path:**
```typescript
// V2: KV override layer
const clientOverrides = await this.env.LEADS_KV.get(`lead:${lid}:quote-config`, "json");
const baseRates = INDUSTRY_RATES[industryType];
const mergedRates = clientOverrides ? deepMerge(baseRates, clientOverrides) : baseRates;
```

### Decision 3: extensionLoader Deferred to V3

**Decision:** Do NOT use Think's `extensionLoader` / `ExtensionManager` for per-industry quote tools. Reserve for genuinely dynamic client-uploaded logic at scale.

**Think Agent extension system details:**
- Requires `WorkerLoader` binding (`worker_loaders` in wrangler.jsonc)
- Each extension spawns a sandboxed Worker isolate
- Extension tools namespaced: `{extensionName}_{toolName}` (e.g. `carpet_getQuote`)
- Extensions can hook into lifecycle: beforeTurn, beforeToolCall, afterToolCall, onStepFinish, onChunk
- Extensions persist across DO restarts via `extensionManager.restore()`
- LLM can dynamically load extensions via `load_extension` tool

**Why not now:**
- Industry quote schemas are **known at build time** — they're data, not dynamic code
- Sandbox startup latency + RPC overhead per tool call = unnecessary cost for deterministic calculations
- Extension manifest ceremony (manifest.name, version, permissions, source as string) adds complexity with no value for static schemas
- Debugging sandboxed extensions is harder than debugging a plain TS function

**When extensionLoader earns its weight (V3):**
- 50+ industries and schema size exceeds reasonable tool schema limits
- Client-uploaded custom quote logic (e.g. client's own pricing formula)
- LLM-generated tools that adapt at runtime to novel industries
- Multi-tenant isolation where different clients need different tool sets

**V3 sketch (for future reference):**
```typescript
// V3: Dynamic industry extension loading
getExtensions(): ExtensionConfig[] {
  const industry = this.cs?.intel?.core_identity?.industry;
  return getExtensionsForIndustry(industry, this.cs?.intel);
}

function getExtensionsForIndustry(industry: string, intel: any): ExtensionConfig[] {
  const schema = INDUSTRY_SCHEMAS[industry];
  if (!schema) return [];
  return [{
    manifest: {
      name: `quote_${industry}`,
      version: "1.0.0",
      permissions: { network: false },
    },
    source: buildQuoteExtensionSource(schema, intel),
  }];
}
```

### Decision 4: Consultant Schema — Additive Optional Fields

**Decision:** Add Chris-specific fields as optional additions to consultant output. No breaking schema change.

**Fields to add (all optional):**

```typescript
// Added to consultant output alongside existing fields
industry_quote_type?: string;           // "carpet_installation" | "dental" | "legal" | "trade_generic"
typical_job_sizes?: string[];           // ["3-bed home", "commercial space", "single room"]
pricing_signals?: string[];             // Any prices found on their website
service_categories?: string[];          // Services they actually offer
quote_confidence?: "high" | "medium" | "low";  // How much pricing data was found on site
```

**Consultant prompt addition:**
```
If the business is service-based (trades, dental, legal, home services, etc.):
- Identify the industry_quote_type from: carpet_installation, dental, legal, trade_generic
- Extract typical_job_sizes from their service pages (e.g. "3-bed home", "commercial fitout")
- Extract any pricing_signals visible on the website (dollar amounts, "from $X", price ranges)
- List service_categories (what they actually offer)
- Set quote_confidence: "high" if pricing visible, "medium" if services listed but no prices, "low" if minimal service info
```

**Why optional not required:**
- Bella doesn't use these fields — Chris does. Making them required breaks nothing for Bella flows.
- Consultant already extracts `businessIdentity.businessModel` and `conversionEventAnalysis` — these new fields are a natural extension.
- If consultant fails to extract (e.g. portfolio site with no services listed), `quote_confidence: "low"` and Chris falls back to industry benchmarks only.

### Decision 5: Two Parallel Live-Data Sections in Turn Prompt

**Decision:** Architecturally sound. Both LIVE ROI and LIVE QUOTE sections render conditionally when state has data.

**Implementation pattern:**

```typescript
// In buildStageDirectiveContext or equivalent
function renderLiveDataSections(state: ConversationState): string {
  const sections: string[] = [];

  // LIVE ROI — from calculatorResults
  const roiEntries = Object.entries(state.calculatorResults ?? {});
  if (roiEntries.length > 0) {
    sections.push("LIVE ROI CALCULATIONS (say as words, never symbols)");
    for (const [agent, result] of roiEntries) {
      if (result?.weeklyValue) {
        sections.push(`- ${agent}: approx ${result.weeklyValue.toLocaleString()} dollars per week (${result.confidence}) — ${result.rationale}`);
      }
    }
    // Combined if multiple
    if (roiEntries.length > 1) {
      const total = roiEntries.reduce((sum, [, r]) => sum + (r?.weeklyValue ?? 0), 0);
      sections.push(`Total: approx ${total.toLocaleString()} dollars per week`);
    }
  }

  // LIVE QUOTE — from quoteResults
  const quoteEntries = Object.entries(state.quoteResults ?? {});
  if (quoteEntries.length > 0) {
    sections.push("LIVE QUOTE (say as words, never symbols)");
    for (const [key, quote] of quoteEntries) {
      sections.push(`- ${quote.description}: approx ${quote.totalEstimate.toLocaleString()} dollars ${quote.source === 'site_pricing' ? '(based on your pricing)' : '(industry benchmark)'}`);
    }
  }

  return sections.join("\n");
}
```

**Context budget analysis:**
- Each ROI result: ~100 tokens (agent name, value, confidence, rationale)
- Each quote result: ~80 tokens (description, estimate, source)
- Worst case (3 ROI agents + 2 quotes): ~460 tokens
- Gemini 2.5 Flash context: 1M tokens — this is negligible
- Current turn prompt (criticalFacts + contextNotes + directive): ~800-3000 tokens
- Adding ~460 tokens = still well under any practical limit

**Guards:**
- Never render empty sections (check Object.keys length > 0)
- Both sections use "say as words, never symbols" directive
- Quote section only renders after calculateQuote tool has been called and stored results

### Decision 6: QuoteResult State Type

**Decision:** `Record<string, QuoteResult>` parallel to `calculatorResults`, keyed by jobType string.

```typescript
// Add to ConversationState interface in types.ts
quoteResults: Record<string, QuoteResult>;

// New type
export interface QuoteResult {
  jobType: string;               // "carpet_installation", "dental", etc
  description: string;           // Human-readable: "3-bed home, wool blend carpet"
  totalEstimate: number;         // Total in dollars
  breakdown: QuoteLineItem[];    // Itemized breakdown
  confidence: "high" | "medium" | "low";
  source: "industry_benchmark" | "site_pricing" | "blended";
  rateTableVersion: string;      // Audit trail: which rate table was used
  inputsSummary: Record<string, unknown>; // What inputs produced this quote
  createdAt: string;             // ISO timestamp
}

export interface QuoteLineItem {
  item: string;                  // "Carpet supply (premium wool)"
  quantity: number;              // 45 (sqm)
  unitLabel: string;             // "per sqm"
  unitRate: number;              // 85
  lineTotal: number;             // 3825
}
```

**Rationale:**
- Parallel pattern to `calculatorResults: Partial<Record<AnyAgent, AgentRoiResult>>` — consistent state shape
- Keyed by string (not agent enum) because job types are open-ended, not a fixed set
- Dedup: if Gemini calls calculateQuote twice for same jobType, second overwrites first
- Multiple quotes for same industry: key as `carpet_installation_bedroom`, `carpet_installation_living` (include qualifier)
- `breakdown` array enables Chris to itemize the quote conversationally: "That's about 3,800 for the carpet itself, plus 1,500 for installation..."

**State initialization:**
```typescript
// In state init (state.ts)
quoteResults: {},
```

---

## STAGE MACHINE INTEGRATION

### New Stage: quote_delivery (Chris-specific)

Chris's stage progression differs from Bella's:
```
greeting → wow → recommendation → ch_chris → quote_delivery → roi_delivery → close
```

Bella's (unchanged):
```
greeting → wow → recommendation → ch_alex/ch_chris/ch_maddie → roi_delivery → close
```

**quote_delivery stage policy:**
```typescript
// Add to STAGE_POLICIES in gate.ts
quote_delivery: {
  stage: 'quote_delivery',
  requiredFields: ['industry_quote_type'],  // Need to know what to quote
  minFieldsForEstimate: ['industry_quote_type'],
  maxQuestions: 2,
  forceAdvanceWhenSatisfied: false,  // Chris may want to quote multiple jobs
  calculatorKey: 'quote',
  fallbackPolicy: [
    'If prospect has not mentioned a specific job, use typical_job_sizes from consultant.',
    'If no industry detected, skip quote_delivery and advance to roi_delivery.',
  ],
}
```

**beforeTurn tool filtering:**
```typescript
// In BellaAgent.beforeTurn()
beforeTurn(ctx: TurnContext): TurnConfig | void {
  const stage = this.cs?.currentStage;
  const activeTools: string[] = [];

  if (stage === 'roi_delivery') {
    activeTools.push('calculateROI');
  } else if (stage === 'quote_delivery') {
    activeTools.push('calculateQuote');
  }
  // Other stages: no calculator tools active

  if (activeTools.length > 0) {
    return { activeTools };
  }
}
```

---

## CHRIS DEMO PRE-BUILT QUOTING FLOW

### End-to-End Pipeline

```
1. Prospect submits website URL on Chris demo page
   ↓
2. Fast-intel scrapes website (10-20s)
   ↓
3. Consultant analyzes (via service binding):
   - Identifies industry → industry_quote_type
   - Extracts services → service_categories
   - Finds pricing signals → pricing_signals
   - Estimates job sizes → typical_job_sizes
   ↓
4. Intel written to KV: lead:{lid}:fast-intel
   ↓
5. Chris DO initializes (session_init event):
   - Loads intel from KV
   - industry_quote_type determines which discriminated union variant is relevant
   - Rate table loaded from stats-kb/industry-rates.ts
   ↓
6. Chris conversation begins:
   - WOW stages: uses business insights (same as Bella)
   - Recommendation: Chris is already the recommended agent (it's his demo)
   - ch_chris stage: website conversion discussion
   ↓
7. quote_delivery stage:
   - Chris already knows their typical jobs from consultant data
   - calculateQuote tool fires with consultant-inferred inputs
   - LIVE QUOTE section appears in turn prompt
   - Chris voices quote naturally: "For a typical 3-bed home with premium wool blend,
     you'd be looking at around 4,200 dollars installed, including underlay..."
   ↓
8. roi_delivery stage:
   - calculateROI fires for Chris (website conversion uplift)
   - LIVE ROI section appears alongside LIVE QUOTE
   - Chris ties it together: "And that website conversion improvement alone
     could mean an extra 1,800 dollars a week..."
   ↓
9. close stage:
   - Both quote and ROI data available for closing arguments
```

### Pre-emptive Quote (The Key Differentiator)

Chris doesn't wait for the prospect to ask for a quote. The consultant has already identified their industry, services, and typical job sizes. On entering quote_delivery, Chris proactively offers:

```
"Now, I know you do a lot of 3-bed homes and commercial spaces.
Let me give you a quick idea of what a typical job looks like with your
quoting machine built in..."
```

The `speak` directive for quote_delivery includes consultant data:
```typescript
function buildQuoteDeliveryDirective(state: ConversationState): StageDirective {
  const consultant = state.intel?.consultant;
  const jobSizes = consultant?.typical_job_sizes ?? [];
  const industry = consultant?.industry_quote_type ?? "your industry";

  return {
    objective: `Demonstrate the pre-built quoting machine for ${industry}`,
    speak: `I've already built a quoting engine specifically for your business. ${
      jobSizes.length > 0
        ? `Based on what I can see, you typically handle jobs like ${jobSizes.slice(0, 2).join(' and ')}. Let me show you what that looks like with instant quoting built in.`
        : `Let me show you how this works for your typical jobs.`
    }`,
    // ...
  };
}
```

---

## EXTENSIBILITY ROADMAP

### MVP (Current Sprint — S3-2+)
- calculateROI wired to correct roi.ts (S3-2 Action 0)
- LIVE ROI section in turn prompt (S3-2 Action 0b)

### V1 (Chris Build)
- calculateQuote tool with discriminated union (4 industries: carpet, dental, legal, trade_generic)
- QuoteResult type added to ConversationState
- stats-kb/industry-rates.ts rate tables
- Consultant prompt addition for industry_quote_type extraction
- quote_delivery stage in stage machine
- LIVE QUOTE section in turn prompt
- beforeTurn activeTools filtering for quote_delivery stage

### V2 (Post-Launch)
- KV-based client rate overrides: `lead:{lid}:quote-config`
- More industry variants (10-20)
- Quote history/comparison in memory notes
- Prospect-provided inputs override consultant guesses

### V3 (Scale)
- extensionLoader for dynamic industry tools
- Client-uploaded pricing formulas
- LLM-generated quote schemas for novel industries
- Multi-tenant tool isolation

---

## THINK AGENT SESSION INTEGRATION

### Context Blocks for Quote Machine

The Think Session API (`configureSession`) can host quote-related context:

```typescript
configureSession(session: Session) {
  return session
    .withContext("soul", {
      provider: { get: async () => this.getSystemPrompt() }
    })
    .withContext("memory", {
      description: "Learned facts about the prospect",
      maxTokens: 2000,
    })
    .withContext("quote_rates", {
      description: "Industry rate tables for quoting",
      provider: {
        get: async () => {
          const industry = this.cs?.intel?.consultant?.industry_quote_type;
          if (!industry || !INDUSTRY_RATES[industry]) return "No industry rates loaded.";
          return JSON.stringify(INDUSTRY_RATES[industry].entries);
        }
      }
    })
    .withCachedPrompt()
    .onCompaction(createCompactFunction({
      summarize: (prompt) => generateText({ model: this.getModel(), prompt }).then(r => r.text),
    }))
    .compactAfter(100_000);
}
```

**Note:** Context blocks are rebuilt via `refreshSystemPrompt()` — the rate table context block updates if intel arrives mid-conversation. This is the Think-native way to surface data in system prompt without manually assembling strings.

### afterToolCall for Quote Storage

```typescript
afterToolCall(ctx: ToolCallResultContext) {
  if (ctx.toolName === 'calculateQuote' && ctx.success) {
    // Quote already stored in state by execute()
    // Use afterToolCall for analytics/logging
    console.log(`[QUOTE] ${ctx.input.jobType}: $${ctx.output.totalEstimate} (${ctx.durationMs}ms)`);
  }
  if (ctx.toolName === 'calculateROI' && ctx.success) {
    console.log(`[ROI] ${ctx.input.agent}: $${ctx.output.weeklyValue}/wk (${ctx.durationMs}ms)`);
  }
}
```

---

## DATA FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────┐
│ SCRAPE PIPELINE                                                     │
│                                                                     │
│ Website URL → fast-intel → consultant                               │
│                               ↓                                     │
│                    industry_quote_type: "carpet_installation"       │
│                    typical_job_sizes: ["3-bed home", "commercial"]  │
│                    pricing_signals: ["From $45/sqm"]                │
│                    service_categories: ["residential", "commercial"]│
│                    quote_confidence: "medium"                       │
│                               ↓                                     │
│                    KV: lead:{lid}:fast-intel                        │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ THINK AGENT DO (BellaAgent extends Think<Env>)                      │
│                                                                     │
│ session_init event → loads intel from KV                            │
│                    → identifies industry_quote_type                  │
│                    → rate table from stats-kb/industry-rates.ts     │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────┐     │
│ │ getTools()                                                   │     │
│ │  ├── calculateROI    (roi.ts V2 formulas)                   │     │
│ │  └── calculateQuote  (discriminated union + rate tables)    │     │
│ └─────────────────────────────────────────────────────────────┘     │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────┐     │
│ │ beforeTurn(ctx: TurnContext)                                 │     │
│ │  if stage === 'roi_delivery'   → activeTools: ['calculateROI']    │
│ │  if stage === 'quote_delivery' → activeTools: ['calculateQuote']  │
│ └─────────────────────────────────────────────────────────────┘     │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────┐     │
│ │ State                                                        │     │
│ │  calculatorResults: { alex: AgentRoiResult, chris: ... }    │     │
│ │  quoteResults: { carpet_installation_3bed: QuoteResult }    │     │
│ └─────────────────────────────────────────────────────────────┘     │
│                                                                     │
│ ┌─────────────────────────────────────────────────────────────┐     │
│ │ Turn Prompt (assembled by processFlow)                       │     │
│ │  CRITICAL FACTS (6 max)                                     │     │
│ │  CONTEXT NOTES (6 max, stage-specific)                      │     │
│ │  STAGE DIRECTIVE (speak, ask, extract, advanceOn)           │     │
│ │  LIVE ROI CALCULATIONS (if calculatorResults populated)     │     │
│ │  LIVE QUOTE (if quoteResults populated)                     │     │
│ └─────────────────────────────────────────────────────────────┘     │
│                                                                     │
│ → Gemini 2.5 Flash → TTS → Prospect hears quote naturally          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## CODEX GATE REQUIREMENTS

This architecture touches: state machine (new stage), tools (new tool), prompt assembly (new section), types (new interface), consultant schema (new fields). Per codex-doctrine.md:

- **SPEC_STRESS_TEST mandatory** — touches state machine + orchestration path + shared interface
- **PATCH_REVIEW** on first meaningful diff
- **VERIFICATION** post-deploy
- **REGRESSION_SCAN** — touches stage machine, prompt assembly, tool registration

T3A owns pre-deploy gates. T3B owns post-deploy verification.

---

## REFERENCES

| Doc | Location |
|---|---|
| Blueprint (T2) | BRAIN_DOCS/doc-bella-roi-quote-agent-blueprint-20260426.md |
| This doc (T9) | BRAIN_DOCS/doc-bella-roi-quote-machine-architecture-t9-20260426.md |
| Think Agent types | ~/.claude/skills/think-agent-docs/think-types/think.d.ts |
| Think tools docs | ~/.claude/skills/think-agent-docs/think-docs/tools.md |
| Think lifecycle hooks | ~/.claude/skills/think-agent-docs/think-docs/lifecycle-hooks.md |
| Think sessions | ~/.claude/skills/think-agent-docs/think-docs/sessions.md |
| Frozen brain roi.ts | frozen-bella-rescript-v2-brain/src/roi.ts |
| Brain V1 source | brain-v1-rescript/src/ |
| Consultant worker | bella-consultant/worker.js |
| Codex doctrine | canonical/codex-doctrine.md |

---

## D1 FILING NOTE

**D1 MCP disconnected at time of writing.** File to D1 (database 2001aba8-d651-41c0-9bd0-8d98866b057c) with key `doc-bella-roi-quote-machine-architecture-t9-20260426` on reconnect. This BRAIN_DOCS mirror is authoritative until then.
