# BELLA CONSULTANT AGENT BLUEPRINT — ENTERPRISE INTELLIGENCE PLATFORM
**Doc ID:** doc-bella-consultant-agent-blueprint-20260426
**Date:** 2026-04-26 AEST
**Authority:** Trent Belasco (enterprise scope confirmed directly)
**Architect:** T9 (Opus)
**Status:** CANONICAL — governs all ConsultantAgent build work
**Priority:** CRITICAL — read on every Consultant build session
**Supersedes:** Chunk 8 spec in doc-think-migration-build-plan-v2-20260426 (lines 1321-1440)

---

## ⚡ WHY THIS EXISTS

The ConsultantAgent is the **brain behind Bella's personalisation**. It takes raw scrape data and turns it into everything Bella says, who she routes to, what hooks she uses, and what the prospect hears first. ROI computes numbers — Consultant determines the **entire personality of every demo**.

Current state is a 119-line minimal agent with raw JSON.parse() on model prose output — same fragile pattern as V2 Bug #2 (empty stages). Trent's directive: "Large flexibility and options and power — clients will have many varying requirements and we need it a broad offering."

This is NOT a fixed analysis pipeline. This is a **configurable intelligence platform** that adapts to wildly different client requirements across any industry vertical.

---

## ARCHITECTURE OVERVIEW

```
Think<Env, ConsultantState> sub-agent
├── 10 tools across 3 progressive tiers
├── beforeTurn() progressive tool activation
├── R2SkillProvider for industry knowledge base
├── Writable reasoning context block (model scratchpad)
├── withCachedPrompt() (prompt survives hibernation)
├── onChatResponse() completeness chaining
├── onChatRecovery() durable execution
├── afterToolCall() observability
├── Parent tool injection (industry-specific tools at call time)
├── compactAfter(8000) + onCompaction()
├── chatRecovery = true
└── maxSteps = 25
```

**Model:** Gemini 2.5 Flash (via @ai-sdk/google, already installed)
**State:** DO SQLite (Think managed)
**Knowledge:** R2 bucket `bella-agent-kb` prefix `consultant-kb/`

---

## CONSULTANT STATE TYPE

```typescript
interface ConsultantState {
  leadId: string;
  analysisVersion: number;          // increment on each full analysis run

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
  agentBriefs: Record<string, AgentBrief> | null;
}
```

### Sub-Types

```typescript
interface BusinessProfile {
  businessName: string;
  industry: string;
  subIndustry: string | null;
  services: string[];
  targetCustomer: string;
  icpProblems: string[];
  icpSolutions: string[];
  icpNarrative: string;           // spoken language, Bella says verbatim
  marketPosition: string;
  businessSize: "micro" | "small" | "medium" | "large" | null;
  ageSignals: "new" | "established" | "mature" | null;
}

interface DigitalPresence {
  techStack: {
    hasCRM: boolean; crmName: string | null;
    hasChat: boolean; chatTool: string | null;
    hasBooking: boolean; bookingTool: string | null;
  };
  adsPresence: {
    isRunningAds: boolean;
    platforms: string[];
    pixelsDetected: string[];
  };
  socialChannels: string[];
  seoSignals: {
    hasStructuredData: boolean;
    hasSitemap: boolean;
    mobileOptimized: boolean;
  };
  websiteQuality: "basic" | "competent" | "strong" | "exceptional";
}

interface ConversionFunnel {
  primaryCTA: string;
  ctaType: "booking" | "phone" | "form" | "quote" | "purchase" | "other";
  allConversionEvents: string[];
  ctaBreakdown: Array<{
    action: string;
    location: string;
    agent: string;
    priority: number;
  }>;
  ctaAgentMapping: Record<string, string>;
  conversionNarrative: string;    // spoken language
  funnelQuality: "weak" | "adequate" | "strong" | "optimized";
}

interface ScriptFills {
  heroHeaderQuote: string;
  websitePositiveComment: string;
  icpGuess: string;
  referenceOffer: string;
  bellaOpener: string;
  recentReviewSnippet: string | null;
  bellaCheckLine: string;
  agentTrainingLine: string;
}

interface AgentRouting {
  priorityAgents: string[];       // ["alex", "chris", "maddie"]
  reasoning: Record<string, string>;
  exclusions: string[];           // agents NOT relevant + why
  demoOrder: string[];            // recommended demo sequence
}

interface ConversationHook {
  topic: string;
  bellaLine: string;              // spoken language
  agent: string | null;           // which agent this hook best serves
  stage: string | null;           // which stage to use it in
}

interface IndustryContext {
  vertical: string;
  subVertical: string | null;
  typicalServices: string[];
  typicalJobTypes: string[];
  pricingModel: "fixed" | "hourly" | "project" | "subscription" | "mixed";
  seasonality: string | null;
  competitiveLandscape: string;
  regulatoryNotes: string | null;
  industrySpecificHooks: string[];
}

interface QuoteInputs {
  industryQuoteType: string;
  typicalJobSizes: Record<string, string>;
  pricingSignals: string[];
  serviceCategories: string[];
  quoteConfidence: "low" | "medium" | "high";
  rateTableReference: string | null;  // R2 key for industry rate table
}

interface GrowthSignals {
  hiringSignals: string[];
  expansionIndicators: string[];
  investmentPatterns: string[];
  painPoints: string[];
  scaleReadiness: "not_ready" | "ready" | "scaling" | "mature";
  topHiringWedge: string | null;  // connects hiring to agent value
}

interface AgentBrief {
  agent: string;
  relevanceScore: number;         // 0-10
  demoAngle: string;              // one sentence: why THIS agent for THIS prospect
  keyTalkingPoints: string[];
  anticipatedObjections: string[];
  closingHook: string;            // strongest close line for this agent
}
```

---

## 10 TOOLS — 3 PROGRESSIVE TIERS

### Tier 1 — Universal Analysis (always active)

**Tool 1: `analyzeBusinessProfile`**
- Input: siteContent (string), fastIntel (object)
- Output: BusinessProfile
- Stores: `state.businessProfile`
- Purpose: ICP, market position, services, business size/age signals
- This is the foundation — every other tool depends on it

**Tool 2: `analyzeDigitalPresence`**
- Input: siteContent (string), fastIntel (object)
- Output: DigitalPresence
- Stores: `state.digitalPresence`
- Purpose: Tech stack, ads, social, SEO signals, website quality
- Feeds: routing decisions (no CRM → Alex, running ads → Chris)

**Tool 3: `analyzeConversionFunnel`**
- Input: siteContent (string)
- Output: ConversionFunnel
- Stores: `state.conversionFunnel`
- Purpose: All CTAs, conversion paths, funnel quality, user journey
- Feeds: agent mapping (booking CTA → Chris, phone CTA → Maddie)

### Tier 2 — Intelligence Synthesis (unlocks after Tier 1)

**Tool 4: `generateScriptFills`**
- Input: reads state.businessProfile + state.conversionFunnel
- Output: ScriptFills
- Stores: `state.scriptFills`
- Purpose: bella_opener, hero quote, praise, ICP narrative, reference offer
- These are what Bella actually SAYS — most important output

**Tool 5: `routeAgents`**
- Input: reads state.businessProfile + state.digitalPresence + state.conversionFunnel
- Output: AgentRouting
- Stores: `state.routing`
- Purpose: Priority agents + reasoning per agent + recommended demo order
- Determines entire demo flow

**Tool 6: `generateConversationHooks`**
- Input: reads all Tier 1 + state.routing
- Output: ConversationHook[]
- Stores: `state.hooks`
- Purpose: Per-agent talking points, wow moments, natural transitions
- Hooks are tagged with target agent + stage for precise delivery

### Tier 3 — Industry-Specific + Agent Prep (unlocks after routing)

**Tool 7: `analyzeIndustryContext`**
- Input: state.businessProfile.industry + loads R2 industry file via load_context
- Output: IndustryContext
- Stores: `state.industryContext`
- Purpose: Vertical-specific deep analysis using R2 knowledge
- Model loads relevant industry file from consultant-kb/industries/

**Tool 8: `identifyQuoteInputs`**
- Input: state.businessProfile + state.industryContext
- Output: QuoteInputs
- Stores: `state.quoteInputs`
- Purpose: Industry-specific quoting data for ROI agent downstream
- This feeds the Chris demo quote machine

**Tool 9: `assessGrowthOpportunities`**
- Input: siteContent + state.businessProfile + state.digitalPresence
- Output: GrowthSignals
- Stores: `state.growthSignals`
- Purpose: Hiring signals, expansion, investment, pain points
- Feeds: close-stage selling hooks, urgency creation

**Tool 10: `prepareAgentBriefs`**
- Input: state.routing.priorityAgents + all prior state + loads R2 agent-brief files
- Output: Record<string, AgentBrief>
- Stores: `state.agentBriefs`
- Purpose: Per-agent demo preparation customized to THIS prospect
- Model loads relevant agent-briefs/ files from R2 for each routed agent

---

## PROGRESSIVE ACTIVATION (beforeTurn)

```typescript
beforeTurn(ctx: TurnContext): TurnConfig {
  const s = this.state;

  // Always start with Tier 1
  const active: string[] = [
    'analyzeBusinessProfile',
    'analyzeDigitalPresence',
    'analyzeConversionFunnel'
  ];

  // Unlock Tier 2 once any Tier 1 result exists
  if (s.businessProfile || s.digitalPresence || s.conversionFunnel) {
    active.push('generateScriptFills', 'routeAgents', 'generateConversationHooks');
  }

  // Unlock Tier 3 once routing is decided
  if (s.routing) {
    active.push(
      'analyzeIndustryContext',
      'identifyQuoteInputs',
      'assessGrowthOpportunities',
      'prepareAgentBriefs'
    );
  }

  return { activeTools: active };
}
```

Model decides which tools to call per turn and in what order. Some prospects need deep industry analysis, others need more conversion funnel work. **Model adapts per prospect.**

---

## FULL configureSession()

```typescript
configureSession(session: Session) {
  return session
    .withContext("soul", {
      provider: { get: async () => CONSULTANT_SYSTEM_PROMPT }
    })
    .withContext("reasoning", {
      description: "Your analysis reasoning — write observations, decisions, and industry insights here as you work through the analysis. Note key signals, routing logic, and confidence levels.",
      maxTokens: 3000
    })
    .withContext("consultant_kb", {
      provider: new R2SkillProvider(this.env.AGENT_KB_BUCKET, { prefix: "consultant-kb/" })
    })
    .withCachedPrompt()
    .onCompaction(
      createCompactFunction({
        summarize: (prompt) =>
          generateText({ model: this.getModel(), prompt }).then((r) => r.text),
        protectHead: 3,
        tailTokenBudget: 20000,
        minTailMessages: 2,
      })
    )
    .compactAfter(8000);
}
```

### Context Blocks Explained

| Block | Type | Purpose |
|---|---|---|
| `soul` | ContextProvider (read-only) | System prompt — analysis methodology, output rules |
| `reasoning` | WritableContextProvider | Model scratchpad — transparency into analysis decisions. Model writes via auto-provided `set_context` tool |
| `consultant_kb` | R2SkillProvider | Industry knowledge base — model loads files on-demand via `load_context` tool |

---

## LIFECYCLE HOOKS — FULL LIST

```typescript
getModel()            — Gemini 2.5 Flash via @ai-sdk/google
getSystemPrompt()     — Fallback only (soul context block is primary)
getTools()            — 10 tools in 3 tiers
configureSession()    — soul + reasoning + R2 KB + cachedPrompt + compaction
beforeTurn()          — Progressive activeTools by tier (see above)
afterToolCall()       — Observability logging
onChatResponse()      — Completeness chaining
onChatRecovery()      — Persist + continue with staleness guard
```

### afterToolCall() — Observability

```typescript
async afterToolCall(ctx: ToolCallResultContext) {
  console.log(`[CONSULTANT] ${ctx.toolName} complete | lead: ${this.state.leadId} | v: ${this.state.analysisVersion}`);
}
```

### onChatResponse() — Completeness Chaining

If model stops after Tier 2 without completing Tier 3, auto-trigger continuation:

```typescript
async onChatResponse(result: ChatResponseResult) {
  const s = this.state;
  const tier2Done = s.scriptFills && s.routing;
  const tier3Incomplete = !s.industryContext || !s.quoteInputs || !s.agentBriefs;

  if (tier2Done && tier3Incomplete) {
    await this.saveMessages([{
      id: crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: "Continue: complete industry-specific analysis, quote input identification, growth opportunity assessment, and agent brief preparation." }]
    }]);
  }
}
```

Guard: Only triggers if Tier 2 IS done but Tier 3 is NOT. Prevents infinite loop.

### onChatRecovery() — Durable Execution

```typescript
onChatRecovery(ctx: ChatRecoveryContext): ChatRecoveryOptions {
  if (Date.now() - ctx.createdAt > 2 * 60 * 1000) {
    return { persist: true, continue: false };
  }
  return { persist: true, continue: true };
}
```

- Partial analysis preserved on DO eviction
- Auto-continues if interrupted within 2 minutes
- Beyond 2 minutes: save partial, parent re-triggers fresh analysis

---

## PARENT INVOCATION (BellaAgent)

```typescript
async runConsultantAnalysis(siteContent: string, fastIntel: any) {
  const consultant = await this.subAgent(ConsultantAgent, `consultant-${this.cs.leadId}`);
  const industry = fastIntel?.core_identity?.industry;

  // Dynamic industry tools — highest merge priority
  const industryTools = getIndustryTools(industry, this.env);

  const prevVersion = consultant.getAnalysisVersion();

  await consultant.chat(
    JSON.stringify({ siteContent, fastIntel }),
    {
      onEvent: (json) => { /* stream handling */ },
      onDone: () => { console.log('[CONSULTANT] Analysis complete'); },
      onError: (err) => { console.error('[CONSULTANT_ERR]', err); }
    },
    {
      tools: industryTools   // Caller tools = highest merge priority
    }
  );

  // Stale-read guard
  const result = consultant.getFullAnalysis();
  if (result.analysisVersion <= prevVersion) {
    console.warn('[CONSULTANT] Stale analysis — no version advance');
    return null;
  }

  this.cs.consultant = result;
  this.setState(this.cs);
}
```

### Industry Tool Injection

`getIndustryTools(industry)` returns tools dynamically based on detected industry:
- Carpet → `{ carpetRateTable, flooringCalculator }`
- Dental → `{ dentalFeeGuide, treatmentEstimator }`
- Legal → `{ legalFeeCalculator, matterEstimator }`
- Trade → `{ tradeJobEstimator }`
- Generic/unknown → `{}` (model uses R2 KB instead)

New industry = new tool function + R2 knowledge file. **Zero ConsultantAgent code changes.**

---

## PUBLIC GETTERS

```typescript
getScriptFills(): ScriptFills | null
getRouting(): AgentRouting | null
getHooks(): ConversationHook[] | null
getQuoteInputs(): QuoteInputs | null
getGrowthSignals(): GrowthSignals | null
getAgentBriefs(): Record<string, AgentBrief> | null
getIndustryContext(): IndustryContext | null
getAnalysisVersion(): number
getFullAnalysis(): ConsultantState
```

SubAgentStub exposes methods only, not .state — getters are required.

---

## R2 KNOWLEDGE BASE

### Bucket
- Name: `bella-agent-kb` (shared with ROI agent)
- Binding: `AGENT_KB_BUCKET` in wrangler.toml + types.ts Env
- ROI prefix: `roi-kb/`
- Consultant prefix: `consultant-kb/`
- Future: `compliance-kb/`

### Structure

```
consultant-kb/
  core/
    analysis-framework.md         — universal analysis methodology
    cta-taxonomy.md               — CTA patterns → agent mapping rules
    web-pattern-library.md        — website structure interpretation signals
    hook-templates.md             — proven conversation starters per scenario
  industries/
    carpet-flooring.md            — industry signals, services, pricing, job types
    dental.md                     — dental-specific analysis patterns
    legal.md                      — legal-specific analysis patterns
    trade-services.md             — generic trade pattern
    saas-tech.md                  — SaaS/tech company analysis
    real-estate.md                — real estate agent/agency analysis
    hospitality.md                — restaurants, hotels, cafes, events
    professional-services.md      — accounting, consulting, financial planning
    health-wellness.md            — physio, chiro, PT, wellness, allied health
    automotive.md                 — mechanics, dealers, auto services
    education.md                  — tutoring, courses, schools, training
    construction.md               — builders, reno, project management
    beauty-aesthetics.md          — salons, aesthetics, beauty, skin
  agent-briefs/
    alex-preparation.md           — what Alex (speed-to-lead) demo needs
    chris-preparation.md          — what Chris (website conversion) demo needs
    maddie-preparation.md         — what Maddie (missed call recovery) demo needs
    sarah-preparation.md          — what Sarah (database reactivation) demo needs
    james-preparation.md          — what James (review uplift) demo needs
```

### Adding New Verticals

1. Write `consultant-kb/industries/{vertical}.md` with signals, services, pricing patterns, typical job types
2. Upload to R2: `bella-agent-kb/consultant-kb/industries/{vertical}.md`
3. Set R2 custom metadata: `description: "{Vertical} industry analysis patterns"`
4. Model discovers it automatically via R2SkillProvider `load_context`

**No code change. No redeploy. No wrangler.toml edit.**

---

## SDK CONDITIONS (mandatory — carry forward on every sprint)

- TurnConfig field is `system` NOT `systemPrompt`
- ToolCallDecision field is `action` NOT `decision`
- TurnContext has NO `lastUserMessage` — extract from ctx.messages
- provider.get() is ONE-SHOT — dynamic content goes in beforeTurn()
- Direct this.cs mutations need this.setState() to persist
- session.withContext(name, { provider }) — NOT addSkillProvider()
- R2SkillProvider(bucket, { prefix }) — NOT R2SkillProvider({ bucket, prefix, skills })
- SubAgentStub exposes methods only, not .state — use getter methods
- compactAfter() requires onCompaction() registered FIRST
- createCompactFunction from "agents/experimental/memory/utils" (NOT /compaction-helpers)
- R2SkillProvider from "agents/experimental/memory/session"

---

## WRANGLER.TOML CHANGES

```jsonc
// Add to r2_buckets (if not already present from ROI sprint)
[[r2_buckets]]
binding = "AGENT_KB_BUCKET"
bucket_name = "bella-agent-kb"

// Add ConsultantAgent to SQLite migrations
[[migrations]]
new_sqlite_classes = ["BellaAgent", "RoiAgent", "ConsultantAgent"]
tag = "v4"
```

### types.ts Env Addition
```typescript
AGENT_KB_BUCKET: R2Bucket;
```

---

## WHAT THIS UNBLOCKS

| Chunk | How Consultant Enables It |
|---|---|
| 5 (Intel Delivery) | Consultant sub-agent spawned on intel-event, structured results in state |
| 3 (Conv Intelligence) | Mode engine reads consultant routing to decide SCRIPTED vs GUIDED |
| 4 (ROI) | ROI agent receives quoteInputs from consultant instead of raw scrape |
| 6 (Extraction Tools) | Extraction tools can validate against consultant analysis |
| 9 (Compliance) | Compliance agent reads consultant routing + hooks for audit |

---

## BUILD CHUNKS

### Chunk 8-1: ConsultantState types + ConsultantAgent class skeleton
**Effort:** Medium | **Risk:** Low
- Define all types (ConsultantState + 10 sub-types) in types.ts
- Create consultant-agent.ts: Think<Env, ConsultantState> class
- getModel(), chatRecovery, maxSteps
- configureSession() with all 3 context blocks + cachedPrompt + compaction
- Empty getTools() returning {} (tools added in 8-2)
- beforeTurn() progressive activation logic (will activate tools once 8-2 adds them)
- onChatRecovery() handler
- afterToolCall() observability
- Verification: tsc --noEmit passes

### Chunk 8-2: Tier 1 tools (Universal Analysis)
**Effort:** Medium | **Risk:** Low
- Implement analyzeBusinessProfile tool + Zod schema
- Implement analyzeDigitalPresence tool + Zod schema
- Implement analyzeConversionFunnel tool + Zod schema
- Each tool: validate input, run analysis, store to state via setState()
- System prompt section: Tier 1 methodology instructions
- Verification: tsc passes, tools appear in getTools()

### Chunk 8-3: Tier 2 tools (Intelligence Synthesis)
**Effort:** Medium | **Risk:** Medium
- Implement generateScriptFills tool — reads Tier 1 state, produces spoken-language outputs
- Implement routeAgents tool — reads all Tier 1, produces routing + reasoning
- Implement generateConversationHooks tool — reads Tier 1 + routing, produces tagged hooks
- System prompt section: Tier 2 synthesis instructions
- Verification: tsc passes, progressive activation unlocks Tier 2 after Tier 1

### Chunk 8-4: Tier 3 tools (Industry + Agent Prep)
**Effort:** High | **Risk:** Medium
- Implement analyzeIndustryContext tool — loads R2 industry file via state context
- Implement identifyQuoteInputs tool — industry-specific quoting data
- Implement assessGrowthOpportunities tool — hiring, expansion, pain points
- Implement prepareAgentBriefs tool — loads R2 agent-brief files, produces per-agent prep
- System prompt section: Tier 3 deep analysis instructions
- onChatResponse() completeness chaining
- Verification: tsc passes, Tier 3 unlocks after routing, completeness loop fires

### Chunk 8-5: R2 Knowledge Base + wrangler.toml + parent invocation
**Effort:** High | **Risk:** Medium
- Create R2 bucket bella-agent-kb (if not already from ROI sprint)
- Upload core/ files: analysis-framework.md, cta-taxonomy.md, web-pattern-library.md, hook-templates.md
- Upload industries/ files: start with 5 priority verticals (trade, dental, legal, professional-services, hospitality)
- Upload agent-briefs/ files: alex, chris, maddie, sarah, james preparation docs
- Add AGENT_KB_BUCKET binding to wrangler.toml
- Add AGENT_KB_BUCKET to Env type
- Add ConsultantAgent to SQLite migrations
- Update BellaAgent.runConsultantAnalysis(): sub-agent pattern + getters + stale-read guard
- Implement getIndustryTools() for parent tool injection
- Verification: full analysis run against test prospect, all 10 state sections populated

### Chunk 8-6: Remaining industry files + integration testing
**Effort:** Medium | **Risk:** Low
- Upload remaining industry files: carpet-flooring, saas-tech, real-estate, health-wellness, automotive, education, construction, beauty-aesthetics
- Integration test: run consultant against 5+ different industry prospects
- Verify: scriptFills quality, routing accuracy, quoteInputs feed to ROI
- Verify: onChatResponse() chaining fires when needed
- Verify: recovery works (kill DO mid-analysis, check persist + continue)

---

## POST-MVP CAPABILITIES (documented, not built yet)

1. **AgentSearchProvider (FTS5)** — searchable analysis for multi-pass flow. Fast analysis → deep scrape arrives → model searches prior analysis for gaps.

2. **session.addContext() at runtime** — inject deep-scrape data as new context block mid-session without restarting analysis.

3. **Tree-structured sessions (branching)** — A/B analysis paths. Run two strategies, compare, pick best.

4. **beforeToolCall() input validation** — finer-grained tool gating beyond activeTools.

5. **saveMessages() for deep intel injection** — parent triggers re-analysis on deep scrape arrival. Multi-pass: fast analysis → deep enrichment pass.

6. **Industry-specific tool extensions via extensionLoader** — client-configurable tool Workers loaded per prospect industry at DO instantiation time. Carpet client → carpetQuote tool auto-loaded. Zero code changes per client.

7. **Cross-agent intelligence sharing** — Consultant results feed ROI, Compliance, and main Bella agent simultaneously via state getters.

---

## RELATIONSHIP TO OTHER BLUEPRINTS

| Blueprint | Relationship |
|---|---|
| ROI+Quote Blueprint (doc-bella-roi-quote-agent-blueprint-20260426) | Consultant feeds quoteInputs to ROI agent. Shared R2 bucket. Same Think patterns. |
| Think Migration Build Plan v2 (doc-think-migration-build-plan-v2-20260426) | This doc SUPERSEDES Chunk 8 section (lines 1321-1440). All other chunks unchanged. |
| ROI+Quote Architecture (doc-bella-roi-quote-machine-architecture-t9-20260426) | Consultant's identifyQuoteInputs feeds ROI's calculateQuote. |
| Think Reference Pack (canonical/think-reference-pack.md) | SDK patterns apply to ConsultantAgent identically. |

---

## SPRINT EXECUTION ORDER

```
S4.5-1: Chunk 8-1 (types + skeleton)     — unblocked NOW
S4.5-2: Chunk 8-2 (Tier 1 tools)         — depends on 8-1
S4.5-3: Chunk 8-3 (Tier 2 tools)         — depends on 8-2
S4.5-4: Chunk 8-4 (Tier 3 tools)         — depends on 8-3
S4.5-5: Chunk 8-5 (R2 KB + wiring)       — depends on 8-4 + R2 bucket
S4.5-6: Chunk 8-6 (remaining KB + test)  — depends on 8-5
```

Each chunk: T2 spec → T4 implement → T2 6-gate → T3A slim gate (logic only, skip SDK lanes, SDK → T9).

---

## T3A GATE PROTOCOL

Slim gate per Think sprint protocol (feedback_t9_preapproval_think_sprints.md):
- T3A runs Codex from CWD: `/Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain/`
- Logic + code quality ONLY
- Skip SDK behavioral lanes (Codex has no Think training data)
- SDK questions → route to T9 per auto-route law

---

## CRITICAL LAWS

- Bella NEVER criticises a prospect's website (LAW 8)
- All narrative fields must be spoken language, not written
- All times AEST
- Every deploy bumps VERSION
- T3 PASS = deploy authority
- 4-gate spec pre-flight mandatory before each chunk spec
