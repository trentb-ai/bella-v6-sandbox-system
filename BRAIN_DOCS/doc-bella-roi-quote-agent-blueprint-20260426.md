# BELLA ROI + QUOTE AGENT BLUEPRINT
**Doc ID:** doc-bella-roi-quote-agent-blueprint-20260426
**Date:** 2026-04-26 AEST
**Authority:** Trent Belasco
**Status:** CANONICAL — file to D1 on MCP reconnect
**Priority:** CRITICAL — must be linked in every Chris demo build

---

## ⚡ WHY THIS EXISTS

Bella (and Chris, Maddie, Alex, Sarah, James) are not just ROI calculators. They are a **full quoting machine** for any industry. A carpet layer prospect hits Chris's demo — Bella already scraped their site — Chris knows their industry, their offers, their likely jobs. Before the prospect even asks, Chris can calculate and quote carpet installations based on room size, carpet type, and market rates.

This is the key differentiator of the Bella product offering. Every agent demo is pre-loaded with a quoting machine built specifically for that prospect's industry.

---

## THE CORE ARCHITECTURE (Think Agent Tool Pattern)

### Tools as Universal Calculators

```typescript
getTools(): ToolSet {
  return {
    // ROI calculation — financial uplift per agent
    calculateROI: tool({
      description: "Calculate revenue uplift for a specific Bella agent given inputs",
      inputSchema: z.object({
        agent: z.enum(["Alex", "Chris", "Maddie", "Sarah", "James"]),
        acv: z.number().describe("Average customer value in dollars"),
        // ... financial inputs per agent
      }),
      execute: async ({ agent, ...inputs }) => {
        // Uses roi.ts V2 weekly-native formulas (CORRECT version — not /52 legacy)
        const result = computeAgentRoi(agent, inputs)
        if (result && this.cs) {
          this.cs.calculatorResults = { ...(this.cs.calculatorResults ?? {}), [agent]: result }
        }
        return result
      }
    }),

    // Quote generation — industry-specific, pre-built per prospect
    calculateQuote: tool({
      description: "Generate a quote for a specific job type based on inputs",
      inputSchema: z.object({
        jobType: z.string().describe("Type of job — e.g. carpet installation, dental crown, legal consultation"),
        inputs: z.record(z.unknown()).describe("Job-specific inputs — room size, material, etc."),
      }),
      execute: async ({ jobType, inputs }) => {
        // Industry best practice rates + client-specific pricing from intel
        const quote = buildQuote(jobType, inputs, this.cs?.intel)
        if (quote && this.cs) {
          this.cs.quoteResults = { ...(this.cs.quoteResults ?? {}), [jobType]: quote }
        }
        return quote
      }
    }),
  }
}
```

### beforeTurn() Controls What Tools Are Active Per Stage

```typescript
beforeTurn(ctx: TurnContext): TurnConfig {
  const stage = this.cs?.currentStage
  return {
    activeTools: stage === 'roi_delivery'
      ? ['calculateROI']          // Only ROI in ROI stage
      : stage === 'quote_delivery'
      ? ['calculateQuote']        // Only quote tools in quote stage
      : [],                       // No calc tools in early stages
  }
}
```

### Results Surface in Turn Prompt as Structured Sections

```
LIVE ROI CALCULATIONS (say as words, never symbols)
- Alex: approx 4,200 dollars per week (conservative) — speed-to-lead uplift on ads pipeline
- Chris: approx 1,800 dollars per week (directional) — website conversion improvement
Total: approx 6,000 dollars per week

LIVE QUOTE
- Carpet installation (3-bed home, wool blend): approx 4,200 dollars installed
- Carpet installation (living room, commercial grade): approx 1,600 dollars installed
```

Bella voices these numbers conversationally. Never reads symbols. Never improvises figures — only uses what's in these sections.

---

## ROI FORMULAS — CANONICAL (V2, CORRECT)

**Source of truth:** `frozen-bella-rescript-v2-brain/src/roi.ts` (identical to `bella-golden-v1` tag)
**AUDIT-1 (27 March 2026):** DO formulas produce ~10x larger figures than legacy bridge. CORRECT — bridge had /52 bug. Approved by founder for launch.

### Alex (Speed-to-Lead)
- Formula: `leads × incrementalRate × acv`
- `incrementalRate` = `alexGapFactor(band) × (ALEX_MAX_UPLIFT=3.94 - currentRate) × currentRate`
- Gap factor per response speed band: under_30s=0.0, under_5min=0.05, 5-30min=0.35, 30min-2h=0.6, 2-24h=0.85, next_day+=1.0
- Returns: `{ weeklyValue, confidence, assumptionsUsed, rationale, conservative }`

### Chris (Website Conversion)
- Formula: `leads × incrementalRate × acv`
- `CHRIS_UPLIFT = 0.23` (capped 35%)
- Confidence: medium if currentRate known, else low

### Maddie (Missed Call Recovery)
- Formula: `recoverableCalls × acv × MADDIE_BOOKED_VALUE_RATE(0.5)`
- `recoverableCalls = missedCalls × MADDIE_RECOVERY_RATE(0.35)`
- Confidence: medium if missedCalls is exact number, else low

### Sarah (Database Reactivation)
- Formula: `oldLeads × SARAH_REACTIVATION_RATE(0.05) × acv`
- Optional agent — excluded from combined ROI by design

### James (Review Uplift)
- Formula: `newCustomersPerWeek × acv × projectedUplift × 0.07 (7%/star)`
- Optional agent — excluded from combined ROI by design

### Combined (Alex + Chris + Maddie only)
- `computeCombinedRoi()` — Sarah + James excluded by design
- Returns `CombinedRoiResult`

---

## QUOTE AGENT ARCHITECTURE

### Pre-Built Per Prospect (The Chris Demo Play)

When a prospect submits their website for the Chris demo:
1. Scraper identifies industry (e.g. "carpet installation", "dental practice", "legal firm", "trade services")
2. Consultant identifies their key services, pricing signals, job types from site
3. Quote machine is PRE-BUILT for that prospect's industry with best-practice rates
4. Chris walks in already knowing how to quote their jobs — before the prospect asks

### Quote Input Schema (Industry-Configurable)

**Flooring/Carpet:**
```typescript
z.object({
  roomType: z.enum(["bedroom", "living_room", "hallway", "commercial", "full_home"]),
  squareMetres: z.number().optional(),
  carpetGrade: z.enum(["budget", "mid", "premium", "commercial"]),
  includesUnderlay: z.boolean().default(true),
  includesRemoval: z.boolean().default(false),
})
```

**Dental:**
```typescript
z.object({
  treatmentType: z.enum(["crown", "implant", "whitening", "checkup", "extraction", "braces"]),
  patientType: z.enum(["new", "existing"]),
  complexity: z.enum(["standard", "complex"]).optional(),
})
```

**Legal:**
```typescript
z.object({
  matterType: z.enum(["conveyancing", "family", "commercial", "will", "dispute"]),
  complexity: z.enum(["standard", "complex"]),
  estimatedHours: z.number().optional(),
})
```

**Trade Services (generic pattern):**
```typescript
z.object({
  jobType: z.string(),
  size: z.union([z.number(), z.string()]).optional(),
  materials: z.array(z.string()).optional(),
  urgency: z.enum(["standard", "urgent"]).optional(),
})
```

### Industry Rate Tables (Best Practice)

Industry rates derived from:
1. **Scrape data** — client's own pricing signals (if visible on site)
2. **Industry benchmarks** — hard-coded best-practice rate tables per vertical
3. **Consultant enrichment** — consultant agent identifies pricing context from site analysis

Rate tables should live in `stats-kb/` folder (already exists in Think Agent src).

---

## EXTENSIONLOADER — DYNAMIC CLIENT TOOLS (FUTURE)

The Think Agent `extensionLoader` allows loading client-specific tool Workers at DO instantiation time. This means:

- Each Chris demo DO loads the **quote tools for that client's industry** from their config
- Carpet layer client → `carpetQuote` tool auto-loaded
- Dental client → `dentalQuote` tool auto-loaded
- Zero code changes per client — config-driven

```typescript
getExtensions() {
  const industry = this.cs?.intel?.core_identity?.industry
  return getExtensionsForIndustry(industry, this.cs?.intel)
}
```

This is the V2 quoting architecture. Not S3-2 scope — document here for Chris build planning.

---

## IMPLEMENTATION STATUS

| Component | Status | Location |
|---|---|---|
| roi.ts V2 formulas | ✅ CORRECT (frozen brain port) | Think Agent src/roi.ts |
| roi-agent.ts legacy | ❌ /52 bug — DELETE after S3-2 | Think Agent src/roi-agent.ts |
| calculateROI tool wired to roi.ts | 🔄 S3-2 Action 0 | bella-agent.ts |
| LIVE ROI section in turn prompt | 🔄 S3-2 Action 0b | buildStageDirectiveContext |
| calculateQuote tool | 📋 PLANNED — Chris build | bella-agent.ts |
| Quote input schemas per industry | 📋 PLANNED — Chris build | src/quote-schemas/ |
| Industry rate tables | 📋 PLANNED — Chris build | src/stats-kb/ |
| extensionLoader dynamic tools | 📋 FUTURE V2 | architect spec needed |

---

## ⚡ CHRIS DEMO BUILD — CRITICAL INTEGRATION POINTS

**THIS SECTION MUST BE READ AT START OF EVERY CHRIS BUILD SESSION.**

Chris demo is NOT just a personality swap from Bella. Chris requires:

1. **Pre-built quoting machine** — calculateQuote tool, industry-detected from scrape, rates from stats-kb
2. **ROI machine** — same as Bella (calculateROI wired to roi.ts, LIVE ROI section in prompt)
3. **Intel-driven quote** — consultant must extract: service types, pricing signals, job categories, typical job sizes
4. **Stage routing** — Chris has a quote_delivery stage (distinct from roi_delivery)
5. **Prompt diff from Bella** — Chris is more technical/hands-on persona, quote language differs

### Pre-emptive Demo Quote Flow (Chris)

```
Prospect submits website URL
→ Scraper: identifies industry, services, pricing signals
→ Consultant: builds consultantScriptFills including quoteInputs (room types, service categories)
→ Chris DO init: loads industry quote schema + rate tables
→ Chris turn 1: already knows prospect's likely jobs before prospect asks
→ calculateQuote fires on stage entry: builds LIVE QUOTE section
→ Chris voices quote naturally in conversation
```

### Data Contract (consultant must output for Chris)

```typescript
consultantScriptFills: {
  // Standard fields (same as Bella)
  bella_opener, tagline, business_name, ...
  
  // Chris-specific additions:
  industry_quote_type: string,        // "carpet_installation" | "dental" | "legal" | ...
  typical_job_sizes: string[],        // ["3-bed home", "commercial space", ...]
  pricing_signals: string[],          // Any prices visible on site
  service_categories: string[],       // Services they offer
  quote_confidence: "high"|"medium"|"low",  // How much pricing data was found
}
```

---

## LINKS + REFERENCES

- Frozen brain roi.ts (canonical): `frozen-bella-rescript-v2-brain/src/roi.ts`
- Think Agent src (active): `~/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/src/`
- S3-2 spec in gate: T3a (mfq3sdul) — Actions 0-4 ROI rewire + prompt porting
- Bridge source of truth (bella-golden-v1 tag): `brain-v2-rescript/src/index.ts`
- Think Agent docs: `~/.claude/skills/think-agent-docs/think-docs/`

---

## D1 FILING NOTE

**D1 MCP disconnected at time of writing.** File to D1 (database 2001aba8-d651-41c0-9bd0-8d98866b057c) with key `doc-bella-roi-quote-agent-blueprint-20260426` on reconnect. This BRAIN_DOCS mirror is authoritative until then.
