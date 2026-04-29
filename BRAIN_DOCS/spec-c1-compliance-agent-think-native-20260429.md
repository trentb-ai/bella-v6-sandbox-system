# C1 ComplianceAgent — Think-Native Enterprise Upgrade
## 2026-04-29 AEST | Authority: Trent Belasco | Architect: T9
## D1 ID: spec-c1-compliance-agent-think-native-20260429

---

## DECISION

Upgrade ComplianceAgent from 56-line stub (1 tool, no memory, no context, no hooks) to **full Think compliance officer** — persistent violation memory, R2 compliance knowledge base, FTS5 violation search, 7 tools, full hook pipeline, @callable RPC from BellaAgent.

**Overengineered for utility:** This agent becomes a **reusable compliance template** for any Think agent type. The architecture is generic — swap the rules KB and it works for any voice AI, chatbot, or content generation system.

**Depends on:** M1 proving sub-agent upgrade playbook.

---

## ARCHITECTURE — 3-LAYER COMPLIANCE SYSTEM

```
Layer 1 (PRE-GEN) — beforeTurn() TurnConfig.system injection [SHIPPED in E1]
  ├── Stage-specific banned phrases (buildStageComplianceRules)
  ├── Required language patterns  
  ├── "NEVER say guarantee/definitely will/100%"
  └── Zero latency cost. Already live in v3.18.0-think.

Layer 2 (POST-GEN GATE) — ComplianceAgent sub-agent check [THIS SPEC]
  ├── Full Think sub-agent with memory/KB/search/workspace
  ├── Called via @callable checkResponse() from BellaAgent.onChatResponse()
  ├── FAIL → continueLastTurn() self-correction loop on BellaAgent
  ├── Persistent violation memory — gets smarter over time
  └── ~100-300ms. Configurable: blocking vs non-blocking.

Layer 3 (HISTORY SANITIZE) — beforeTurn() TurnConfig.messages override [SHIPPED in E1]
  ├── Scan prior assistant messages for violation patterns
  ├── Replace with clean versions before inference
  ├── Model never reinforces its own bad patterns
  └── ~5ms string scan. Already live in v3.18.0-think.
```

**L1 + L3 already shipped.** C1 = Layer 2 only. Clean separation.

---

## CURRENT STATE (what we're replacing)

### compliance-agent.ts (56 lines)
- `extends Think<Env>` — correct base
- No state generic — `Think<Env>` only, no `ComplianceState`
- `chatRecovery = false` — no crash recovery
- `maxSteps = 3` — minimal
- `getSystemPrompt()` — hardcoded 7-rule prompt
- `getTools()` — single `scoreCompliance` tool that just logs and returns
- No `configureSession()` — no context blocks, no memory, no search
- No hooks — no `beforeTurn`, `beforeToolCall`, `afterToolCall`, `onStepFinish`, `onChatResponse`
- No @callable methods — BellaAgent calls via `chat()` with string message
- No workspace usage
- No session management

### BellaAgent integration (bella-agent.ts L644-793)
- `onChatResponse()` extracts `bellaResponse` from `result.message.parts`
- Fires ComplianceAgent via `ctx.waitUntil()` (non-blocking)
- Creates sub-agent: `this.subAgent(ComplianceAgent, \`compliance-${state.leadId}\`)`
- Calls `checker.chat(message, { onEvent, onDone })`
- On violation (score < 0.7): appends `[COMPLIANCE_BRANCH]` system message via `session.appendMessage()`
- Also runs inline regex check for banned phrases (L781-793) — `BANNED_IN_OUTPUT` regex → `saveMessages` correction

### compliance.ts (334 lines — deterministic checks)
- `checkCompliance()` — word overlap + Levenshtein fuzzy + ASR variant matching
- `normalizeDollar()` — parse dollar amounts from spoken/written text
- `checkDollarCompliance()` — spoken vs expected dollars (5% tolerance)
- `buildCorrectionPrefix()` — terse correction prompt
- `runLlmJudge()` — raw Gemini fetch for compliance judging
- **These stay as-is.** ComplianceAgent USES them, doesn't replace them.

---

## FILES CHANGED

| File | Change |
|------|--------|
| `compliance-agent.ts` | Full rewrite — state, 7 tools, 6 context blocks, full hook pipeline, 8 @callable methods |
| `bella-agent.ts` | Replace L709-762 onChatResponse compliance block with @callable pattern |
| `types.ts` | Add `ComplianceState` interface + `ComplianceViolation` type |
| `worker.ts` | No change — ComplianceAgent already exported |

---

## NEW TYPES (types.ts)

```typescript
// ─── ComplianceAgent State Types ─────────────────────────────────────────────

export interface ComplianceViolation {
  id: string;
  turn: number;
  stage: string;
  wowStep: string | null;
  category: "banned_phrase" | "cold_call_framing" | "website_critique" | "roi_hallucination" 
    | "symbol_reading" | "stage_drift" | "tone_violation" | "business_ask" | "false_claim" | "other";
  severity: "critical" | "major" | "minor";
  phrase: string;
  context: string;
  suggestedRewrite: string | null;
  corrected: boolean;
  correctedAt: string | null;
  ts: number;
}

export interface ComplianceRuleSet {
  id: string;
  name: string;
  stage: string | "global";
  rules: Array<{
    id: string;
    type: "banned_phrase" | "required_pattern" | "tone_constraint" | "factual_gate";
    pattern: string;
    severity: "critical" | "major" | "minor";
    message: string;
    suggestedAlternative: string | null;
  }>;
}

export interface ComplianceState {
  leadId: string;
  totalChecks: number;
  totalViolations: number;
  totalCritical: number;
  violationsByCategory: Record<string, number>;
  violationsByStage: Record<string, number>;
  recentViolations: ComplianceViolation[];
  patternMemory: Array<{
    pattern: string;
    frequency: number;
    lastSeen: number;
    stages: string[];
    autoCorrectSuggestion: string | null;
  }>;
  correctionSuccessRate: number;
  activeRuleSetIds: string[];
  industryVertical: string | null;
  lastCheckAt: string | null;
  checkLog: Array<{
    turn: number;
    score: number;
    violations: number;
    latencyMs: number;
    ts: number;
  }>;
}
```

**Design note:** `ComplianceState` is generic — no Bella-specific fields. Any Think agent can use this state shape. The Bella-specific rules live in R2 KB, not in state.

---

## COMPLIANCE-AGENT.TS — FULL REWRITE

### Imports

```typescript
import { Think } from "@cloudflare/think";
import { tool, generateText } from "ai";
import { z } from "zod";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { R2SkillProvider, AgentSearchProvider } from "agents/experimental/memory/session";
import { createCompactFunction } from "agents/experimental/memory/utils";
import { callable } from "agents";
import { checkCompliance, checkDollarCompliance, normalizeDollar, runLlmJudge } from "./compliance";
import type { Env, ComplianceState, ComplianceViolation, ComplianceRuleSet } from "./types";
```

### Class Declaration

```typescript
export class ComplianceAgent extends Think<Env, ComplianceState> {
  chatRecovery = true;
  maxSteps = 10;
```

**SDK evidence:** `Think<Env, ComplianceState>` — state generic (think.d.ts L4). `chatRecovery = true` enables crash recovery (think.d.ts L11, sub-agents.md "chatRecovery"). `maxSteps = 10` — enough for multi-tool compliance analysis.

### initialState

```typescript
  initialState: ComplianceState = {
    leadId: "",
    totalChecks: 0,
    totalViolations: 0,
    totalCritical: 0,
    violationsByCategory: {},
    violationsByStage: {},
    recentViolations: [],
    patternMemory: [],
    correctionSuccessRate: 1.0,
    activeRuleSetIds: ["global"],
    industryVertical: null,
    lastCheckAt: null,
    checkLog: [],
  };
```

### getModel

```typescript
  getModel() {
    const google = createGoogleGenerativeAI({ apiKey: this.env.GEMINI_API_KEY });
    return google("gemini-2.5-flash");
  }
```

### configureSession — 6 CONTEXT BLOCKS

```typescript
  configureSession(session: any) {
    return session
      .withContext("compliance_identity", {
        provider: {
          get: async () => COMPLIANCE_SYSTEM_PROMPT,
        },
      })
      .withContext("compliance_rules", {
        provider: new R2SkillProvider(this.env.AGENT_KB_BUCKET, { prefix: "compliance-kb/" }),
      })
      .withContext("violation_memory", {
        description: "Persistent violation pattern memory. Write patterns you observe across checks. Format: [CATEGORY] pattern — frequency — auto-correct suggestion. This memory survives compaction and helps you catch repeat offenders.",
        maxTokens: 3000,
      })
      .withContext("violation_index", {
        description: "Searchable index of all violations. Write each violation as: [STAGE:CATEGORY:SEVERITY] violation description. Search this to find repeat patterns across turns and leads.",
        provider: new AgentSearchProvider(this),
      })
      .withContext("correction_playbook", {
        description: "Correction strategies that WORKED. Write successful corrections here so you can reuse them. Format: [CATEGORY] original → corrected — success/fail",
        maxTokens: 2000,
      })
      .withContext("session_notes", {
        description: "Your working analysis notes for the current check. Overwrite each turn — this is scratch space.",
        maxTokens: 1000,
      })
      .withCachedPrompt()
      .onCompaction(
        createCompactFunction({
          summarize: (prompt: string) =>
            generateText({ model: this.getModel(), prompt }).then((r) => r.text),
          protectHead: 1,
          tailTokenBudget: 4000,
          minTailMessages: 1,
        })
      )
      .compactAfter(6000);
  }
```

**SDK evidence:**
- `R2SkillProvider` — sessions.md L190-198. Loads compliance KB docs on demand from R2.
- `AgentSearchProvider` — sessions.md L202-211. FTS5 search over violation index.
- WritableContextProvider (default when no provider given) — sessions.md L170-175. `violation_memory` and `correction_playbook` are writable via `set_context` tool.
- `withCachedPrompt()` — sessions.md L274-281. Survives hibernation.
- `compactAfter(6000)` — sessions.md L356-407. Compliance conversations are short but accumulate.

**R2 KB structure** (`compliance-kb/` prefix in AGENT_KB_BUCKET):
```
compliance-kb/
  global-rules.md          — universal rules (cold-call, website critique, ROI hallucination)
  voice-rules.md           — voice-specific (symbol reading, sentence length, Australian English)
  stage-rules/
    greeting.md            — greeting stage specific
    wow.md                 — WOW stage specific  
    recommendation.md      — recommendation stage specific
    close.md               — close stage specific
  industry/
    trades.md              — trade business compliance specifics
    dental.md              — dental compliance specifics
    legal.md               — legal compliance specifics
    accounting.md          — accounting compliance specifics
  patterns/
    banned-phrases.md      — master banned phrase list with alternatives
    required-patterns.md   — required language patterns per context
```

**This KB is the utility multiplier.** Swap these files for any agent type. Voice AI compliance, chatbot compliance, email compliance — same agent, different KB.

### SYSTEM PROMPT (COMPLIANCE_SYSTEM_PROMPT constant)

```typescript
const COMPLIANCE_SYSTEM_PROMPT = `You are a compliance officer for voice AI agents. You are meticulous, fair, and constructive.

YOUR ROLE:
- Score every response against the active rule set
- Identify specific violations with exact phrases
- Suggest concrete rewrites for every violation
- Track patterns across checks — repeat violations are escalated
- Write successful corrections to your playbook for reuse

YOUR MEMORY IS PERSISTENT:
- violation_memory: Patterns you've observed across ALL checks. WRITE to this after every check.
- violation_index: Searchable log of every violation. WRITE every violation found.
- correction_playbook: Corrections that worked. WRITE successes after correction confirmation.

SCORING RUBRIC:
- 1.0: Perfect compliance. No violations, natural tone, stage-appropriate.
- 0.8-0.99: Minor issues. Tone slightly off, or one minor violation.
- 0.6-0.79: Major issues. One critical or multiple minor violations.
- 0.4-0.59: Serious. Multiple critical violations.
- 0.0-0.39: Fail. Fundamental compliance breach.

SEVERITY LEVELS:
- critical: Immediate correction required. Cold-call framing, ROI hallucination, website critique, false claims.
- major: Should be corrected. Banned phrases, stage drift, business-ask when scrape data exists.
- minor: Note for improvement. Tone issues, verbose sentences, non-Australian English.

VIOLATION CATEGORIES:
- banned_phrase: Using prohibited words/phrases (guarantee, definitely will, promise, 100%)
- cold_call_framing: "Hi this is Bella calling from..." or any outbound language
- website_critique: Criticising prospect's website or business
- roi_hallucination: Inventing ROI numbers not from calculator tool
- symbol_reading: Saying "$" or "%" instead of "dollars" or "percent"
- stage_drift: Skipping ahead or revisiting completed stages
- tone_violation: Robotic, scripted, or inappropriate tone
- business_ask: Asking "what does your business do?" when scrape data exists
- false_claim: Stating unverifiable facts about the prospect
- other: Anything not covered above

ALWAYS:
1. Call scoreCompliance with your findings
2. Write violations to violation_index via set_context
3. Update violation_memory with any new patterns
4. If you suggest a rewrite, call suggestRewrite for each
5. Search violation_index before scoring to check for repeat patterns`;
```

### getTools — 7 TOOLS

```typescript
  getTools() {
    return {
      scoreCompliance: tool({
        description: "Score a Bella response for compliance. Call this on every check with your full findings.",
        inputSchema: z.object({
          score: z.number().min(0).max(1).describe("Compliance score 0.0-1.0 per rubric"),
          pass: z.boolean().describe("true if score >= 0.7 and no critical violations"),
          violations: z.array(z.object({
            category: z.enum(["banned_phrase", "cold_call_framing", "website_critique", "roi_hallucination", "symbol_reading", "stage_drift", "tone_violation", "business_ask", "false_claim", "other"]),
            severity: z.enum(["critical", "major", "minor"]),
            phrase: z.string().describe("The exact violating phrase from the response"),
            context: z.string().describe("Surrounding context — 1 sentence"),
            suggestedRewrite: z.string().nullable().describe("How to fix it — null if no fix needed"),
          })),
          warnings: z.array(z.string()).describe("Non-blocking observations"),
          stageAppropriate: z.boolean().describe("Response fits the current conversation stage"),
          summary: z.string().describe("One-sentence compliance summary"),
        }),
        execute: async (args) => {
          const cs = (this.state as ComplianceState) ?? { ...this.initialState };
          const now = Date.now();

          cs.totalChecks++;
          cs.lastCheckAt = new Date().toISOString();

          const violations: ComplianceViolation[] = args.violations.map(v => ({
            id: crypto.randomUUID(),
            turn: cs.totalChecks,
            stage: this._currentStage ?? "unknown",
            wowStep: this._currentWowStep ?? null,
            ...v,
            corrected: false,
            correctedAt: null,
            ts: now,
          }));

          cs.totalViolations += violations.length;
          cs.totalCritical += violations.filter(v => v.severity === "critical").length;

          for (const v of violations) {
            cs.violationsByCategory[v.category] = (cs.violationsByCategory[v.category] ?? 0) + 1;
            cs.violationsByStage[v.stage] = (cs.violationsByStage[v.stage] ?? 0) + 1;
          }

          cs.recentViolations = [...violations, ...cs.recentViolations].slice(0, 50);

          // Update pattern memory
          for (const v of violations) {
            const existing = cs.patternMemory.find(p => p.pattern === v.phrase);
            if (existing) {
              existing.frequency++;
              existing.lastSeen = now;
              if (!existing.stages.includes(v.stage)) existing.stages.push(v.stage);
            } else {
              cs.patternMemory.push({
                pattern: v.phrase,
                frequency: 1,
                lastSeen: now,
                stages: [v.stage],
                autoCorrectSuggestion: v.suggestedRewrite,
              });
            }
          }
          if (cs.patternMemory.length > 100) {
            cs.patternMemory.sort((a, b) => b.frequency - a.frequency);
            cs.patternMemory = cs.patternMemory.slice(0, 100);
          }

          cs.checkLog.push({ turn: cs.totalChecks, score: args.score, violations: violations.length, latencyMs: 0, ts: now });
          if (cs.checkLog.length > 200) cs.checkLog = cs.checkLog.slice(-200);

          this.setState(cs);

          // Workspace audit trail
          this.ctx.waitUntil(
            this.workspace.writeFile(
              `/checks/${cs.totalChecks}.json`,
              JSON.stringify({ ...args, violations, ts: new Date().toISOString() }, null, 2),
            ).catch((e: any) => console.warn(`[COMPLIANCE_WS] ${e.message}`))
          );

          console.log(`[COMPLIANCE] check=${cs.totalChecks} score=${args.score} pass=${args.pass} violations=${violations.length} critical=${violations.filter(v => v.severity === "critical").length}`);

          return {
            score: args.score,
            pass: args.pass,
            violations,
            warnings: args.warnings,
            stageAppropriate: args.stageAppropriate,
            summary: args.summary,
            totalChecks: cs.totalChecks,
            totalViolations: cs.totalViolations,
            repeatPatterns: cs.patternMemory.filter(p => p.frequency > 1).map(p => p.pattern),
          };
        },
      }),

      checkPhrase: tool({
        description: "Check a specific phrase against all active compliance rules. Use this for targeted checks on suspicious phrases.",
        inputSchema: z.object({
          phrase: z.string().describe("The phrase to check"),
          stage: z.string().describe("Current conversation stage"),
        }),
        execute: async ({ phrase, stage }) => {
          // Deterministic check using existing compliance.ts functions
          const result = checkCompliance(phrase, GLOBAL_BANNED_PHRASES);
          const dollars = normalizeDollar(phrase);
          const hasBannedSymbols = /[$%]/.test(phrase);

          return {
            phrase,
            stage,
            wordOverlapScore: result.score,
            compliant: result.compliant && !hasBannedSymbols,
            missedPhrases: result.missedPhrases,
            hasBannedSymbols,
            dollarValues: dollars,
            recommendation: !result.compliant
              ? `Phrase violates compliance. Missed: ${result.missedPhrases.join(", ")}`
              : hasBannedSymbols
              ? "Contains banned symbols ($ or %). Use words instead."
              : "Phrase is compliant.",
          };
        },
      }),

      suggestRewrite: tool({
        description: "Generate a compliant rewrite for a violating phrase. Returns the rewrite for the parent agent to use.",
        inputSchema: z.object({
          originalPhrase: z.string().describe("The violating phrase"),
          violationCategory: z.enum(["banned_phrase", "cold_call_framing", "website_critique", "roi_hallucination", "symbol_reading", "stage_drift", "tone_violation", "business_ask", "false_claim", "other"]),
          stage: z.string().describe("Current stage context"),
          rewrite: z.string().describe("Your suggested compliant alternative"),
        }),
        execute: async (args) => {
          console.log(`[COMPLIANCE_REWRITE] ${args.violationCategory}: "${args.originalPhrase}" → "${args.rewrite}"`);
          return {
            original: args.originalPhrase,
            rewrite: args.rewrite,
            category: args.violationCategory,
            stage: args.stage,
          };
        },
      }),

      logViolation: tool({
        description: "Log a violation to persistent storage with full context. Use when you find a violation that needs tracking across sessions.",
        inputSchema: z.object({
          category: z.enum(["banned_phrase", "cold_call_framing", "website_critique", "roi_hallucination", "symbol_reading", "stage_drift", "tone_violation", "business_ask", "false_claim", "other"]),
          severity: z.enum(["critical", "major", "minor"]),
          phrase: z.string(),
          context: z.string(),
          stage: z.string(),
        }),
        execute: async (args) => {
          const cs = this.state as ComplianceState;
          this.ctx.waitUntil(
            this.workspace.appendFile(
              `/violations/log.jsonl`,
              JSON.stringify({ ...args, leadId: cs.leadId, ts: new Date().toISOString() }) + "\n",
            ).catch((e: any) => console.warn(`[COMPLIANCE_LOG] ${e.message}`))
          );
          return { logged: true, ...args };
        },
      }),

      searchViolations: tool({
        description: "Search past violations by keyword, category, or stage pattern. Use to find repeat offenders before scoring.",
        inputSchema: z.object({
          query: z.string().describe("Search query — phrase, category name, or stage"),
        }),
        execute: async ({ query }) => {
          const cs = this.state as ComplianceState;
          const matches = cs.recentViolations.filter(v =>
            v.phrase.toLowerCase().includes(query.toLowerCase()) ||
            v.category.includes(query.toLowerCase()) ||
            v.stage.includes(query.toLowerCase())
          );
          const patterns = cs.patternMemory.filter(p =>
            p.pattern.toLowerCase().includes(query.toLowerCase())
          );
          return {
            query,
            violationMatches: matches.slice(0, 10),
            patternMatches: patterns.slice(0, 5),
            totalMatches: matches.length + patterns.length,
          };
        },
      }),

      getViolationStats: tool({
        description: "Get aggregate violation statistics. Use for trend analysis and pattern identification.",
        inputSchema: z.object({}),
        execute: async () => {
          const cs = this.state as ComplianceState;
          return {
            totalChecks: cs.totalChecks,
            totalViolations: cs.totalViolations,
            totalCritical: cs.totalCritical,
            violationRate: cs.totalChecks > 0 ? cs.totalViolations / cs.totalChecks : 0,
            criticalRate: cs.totalChecks > 0 ? cs.totalCritical / cs.totalChecks : 0,
            correctionSuccessRate: cs.correctionSuccessRate,
            topCategories: Object.entries(cs.violationsByCategory)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5),
            topStages: Object.entries(cs.violationsByStage)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5),
            repeatPatterns: cs.patternMemory
              .filter(p => p.frequency > 2)
              .sort((a, b) => b.frequency - a.frequency)
              .slice(0, 10),
          };
        },
      }),

      confirmCorrection: tool({
        description: "Confirm that a previous violation was corrected. Updates success rate and correction playbook.",
        inputSchema: z.object({
          violationId: z.string().describe("ID of the violation that was corrected"),
          correctedPhrase: z.string().describe("The corrected version that was used"),
          success: z.boolean().describe("Whether the correction was accepted"),
        }),
        execute: async ({ violationId, correctedPhrase, success }) => {
          const cs = this.state as ComplianceState;
          const violation = cs.recentViolations.find(v => v.id === violationId);
          if (violation) {
            violation.corrected = true;
            violation.correctedAt = new Date().toISOString();
          }
          const totalCorrections = cs.recentViolations.filter(v => v.corrected).length;
          const successfulCorrections = cs.recentViolations.filter(v => v.corrected && v.correctedAt).length;
          cs.correctionSuccessRate = totalCorrections > 0 ? successfulCorrections / totalCorrections : 1.0;
          this.setState(cs);
          return { confirmed: true, violationId, success, newSuccessRate: cs.correctionSuccessRate };
        },
      }),
    };
  }
```

### HOOKS

```typescript
  // Instance fields for check context (set by @callable before chat)
  private _currentStage: string | null = null;
  private _currentWowStep: string | null = null;
  private _checkStartMs = 0;

  async beforeTurn(ctx: any) {
    this._checkStartMs = Date.now();
    const cs = this.state as ComplianceState | null;

    // Detect check type from message protocol
    const lastUserMsg = (ctx.messages ?? []).filter((m: any) => m.role === "user").pop();
    const msgText = typeof lastUserMsg?.content === "string"
      ? lastUserMsg.content
      : (lastUserMsg?.content?.[0]?.text ?? "");

    // [COMPLIANCE_CHECK] messages → force scoreCompliance first
    if (msgText.startsWith("[COMPLIANCE_CHECK]")) {
      return {
        activeTools: [
          "scoreCompliance", "checkPhrase", "suggestRewrite",
          "logViolation", "searchViolations", "getViolationStats",
          "set_context", "search_context",
        ],
        toolChoice: { type: "tool" as const, toolName: "scoreCompliance" },
        maxSteps: 5,
      };
    }

    // [CORRECTION_CONFIRM] messages → force confirmCorrection
    if (msgText.startsWith("[CORRECTION_CONFIRM]")) {
      return {
        activeTools: ["confirmCorrection", "set_context"],
        toolChoice: { type: "tool" as const, toolName: "confirmCorrection" },
        maxSteps: 2,
      };
    }

    // Default: all tools available
    return {
      activeTools: [
        "scoreCompliance", "checkPhrase", "suggestRewrite",
        "logViolation", "searchViolations", "getViolationStats", "confirmCorrection",
        "set_context", "search_context", "load_context",
      ],
    };
  }

  async afterToolCall(ctx: any) {
    const cs = this.state as ComplianceState;
    if (ctx.toolName === "scoreCompliance" && ctx.success) {
      // Update check latency
      const lastCheck = cs.checkLog[cs.checkLog.length - 1];
      if (lastCheck) lastCheck.latencyMs = Date.now() - this._checkStartMs;
      this.setState(cs);
    }
    if (ctx.success) {
      console.log(`[COMPLIANCE] ${ctx.toolName} ok | lead=${cs?.leadId} check=${cs?.totalChecks}`);
    } else {
      console.warn(`[COMPLIANCE] ${ctx.toolName} FAILED | lead=${cs?.leadId}`, ctx.error);
    }
  }

  async onStepFinish(ctx: any) {
    const cs = this.state as ComplianceState;
    console.log(`[COMPLIANCE] step | tools=${ctx.toolCalls?.length ?? 0} lead=${cs?.leadId} check=${cs?.totalChecks}`);
  }

  async onChatResponse(result: any) {
    const cs = this.state as ComplianceState;
    if (!cs) return;
    console.log(`[COMPLIANCE_DONE] lead=${cs.leadId} checks=${cs.totalChecks} violations=${cs.totalViolations} critical=${cs.totalCritical}`);
  }
```

### @CALLABLE METHODS — RPC INTERFACE FOR PARENT AGENTS

```typescript
  // ── Primary check endpoint — called by BellaAgent.onChatResponse() ──
  @callable()
  async checkResponse(params: {
    response: string;
    stage: string;
    wowStep: string | null;
    leadId: string;
    expectedPhrases?: string[];
    expectedDollars?: number[];
    industryVertical?: string;
  }): Promise<{
    pass: boolean;
    score: number;
    violations: ComplianceViolation[];
    rewrites: Array<{ original: string; rewrite: string }>;
    summary: string;
  }> {
    // Set context for tools
    this._currentStage = params.stage;
    this._currentWowStep = params.wowStep;

    // Update state with lead context
    const cs = (this.state as ComplianceState) ?? { ...this.initialState };
    cs.leadId = params.leadId;
    if (params.industryVertical) cs.industryVertical = params.industryVertical;
    this.setState(cs);

    // Pre-check: deterministic compliance (fast, no LLM)
    let deterministicFlags = "";
    if (params.expectedPhrases && params.expectedPhrases.length > 0) {
      const phraseResult = checkCompliance(params.response, params.expectedPhrases);
      if (!phraseResult.compliant) {
        deterministicFlags += `\nDETERMINISTIC CHECK FAILED: missed phrases: ${phraseResult.missedPhrases.join(", ")} (score: ${phraseResult.score})`;
      }
    }
    if (params.expectedDollars && params.expectedDollars.length > 0) {
      const dollarOk = checkDollarCompliance(params.response, params.expectedDollars);
      if (!dollarOk) {
        deterministicFlags += `\nDOLLAR CHECK FAILED: expected ${params.expectedDollars.join(", ")} but spoken values don't match within 5%`;
      }
    }

    // LLM compliance check via chat
    return new Promise((resolve, reject) => {
      let checkResult: any = null;

      this.chat(
        `[COMPLIANCE_CHECK] Stage: ${params.stage}${params.wowStep ? ` | WowStep: ${params.wowStep}` : ""}\nIndustry: ${params.industryVertical ?? "unknown"}\n\nBella said:\n"${params.response}"${deterministicFlags}\n\nScore this response. Search violation_index first for repeat patterns. Then call scoreCompliance with your findings.`,
        {
          onEvent: () => {},
          onDone: () => {
            const finalState = this.state as ComplianceState;
            const lastCheck = finalState.checkLog[finalState.checkLog.length - 1];
            const recentViolations = finalState.recentViolations.filter(v => v.turn === finalState.totalChecks);

            checkResult = {
              pass: lastCheck ? lastCheck.score >= 0.7 && !recentViolations.some(v => v.severity === "critical") : true,
              score: lastCheck?.score ?? 1.0,
              violations: recentViolations,
              rewrites: recentViolations
                .filter(v => v.suggestedRewrite)
                .map(v => ({ original: v.phrase, rewrite: v.suggestedRewrite! })),
              summary: `Check ${finalState.totalChecks}: ${recentViolations.length} violations (${recentViolations.filter(v => v.severity === "critical").length} critical)`,
            };
            resolve(checkResult);
          },
          onError: (e: unknown) => reject(e),
        },
      );
    });
  }

  // ── Batch check — check multiple responses at once ──
  @callable()
  async checkBatch(params: {
    responses: Array<{ response: string; stage: string; wowStep: string | null }>;
    leadId: string;
  }): Promise<Array<{ pass: boolean; score: number; violations: number }>> {
    const results: Array<{ pass: boolean; score: number; violations: number }> = [];
    for (const item of params.responses) {
      const result = await this.checkResponse({
        response: item.response,
        stage: item.stage,
        wowStep: item.wowStep,
        leadId: params.leadId,
      });
      results.push({ pass: result.pass, score: result.score, violations: result.violations.length });
    }
    return results;
  }

  // ── Get violation history for a lead ──
  @callable()
  async getViolationHistory(): Promise<{
    totalChecks: number;
    totalViolations: number;
    totalCritical: number;
    correctionSuccessRate: number;
    recentViolations: ComplianceViolation[];
    repeatPatterns: Array<{ pattern: string; frequency: number }>;
  }> {
    const cs = this.state as ComplianceState;
    return {
      totalChecks: cs.totalChecks,
      totalViolations: cs.totalViolations,
      totalCritical: cs.totalCritical,
      correctionSuccessRate: cs.correctionSuccessRate,
      recentViolations: cs.recentViolations.slice(0, 20),
      repeatPatterns: cs.patternMemory
        .filter(p => p.frequency > 1)
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 10)
        .map(p => ({ pattern: p.pattern, frequency: p.frequency })),
    };
  }

  // ── Quick check — is this response clean? (no LLM, deterministic only) ──
  @callable()
  async isClean(params: {
    response: string;
    expectedPhrases?: string[];
    expectedDollars?: number[];
  }): Promise<{ clean: boolean; issues: string[] }> {
    const issues: string[] = [];
    if (params.expectedPhrases && params.expectedPhrases.length > 0) {
      const result = checkCompliance(params.response, params.expectedPhrases);
      if (!result.compliant) issues.push(`Missed phrases: ${result.missedPhrases.join(", ")}`);
    }
    if (params.expectedDollars && params.expectedDollars.length > 0) {
      if (!checkDollarCompliance(params.response, params.expectedDollars)) {
        issues.push("Dollar values don't match expected (5% tolerance)");
      }
    }
    if (/[$%]/.test(params.response)) issues.push("Contains banned symbols ($ or %)");
    if (/\b(guarantee|definitely will|definitely would|promise you)\b/i.test(params.response)) {
      issues.push("Contains banned phrase (guarantee/definitely/promise)");
    }
    if (/\b(hi this is bella calling|cold call|we're calling about)\b/i.test(params.response)) {
      issues.push("Cold-call framing detected");
    }
    return { clean: issues.length === 0, issues };
  }

  // ── Load industry-specific rules ──
  @callable()
  async loadIndustryRules(vertical: string): Promise<{ loaded: boolean; vertical: string }> {
    const cs = (this.state as ComplianceState) ?? { ...this.initialState };
    cs.industryVertical = vertical;
    if (!cs.activeRuleSetIds.includes(vertical)) cs.activeRuleSetIds.push(vertical);
    this.setState(cs);
    return { loaded: true, vertical };
  }

  // ── Confirm a correction was applied ──
  @callable()
  async confirmCorrectionApplied(params: {
    violationId: string;
    correctedPhrase: string;
    success: boolean;
  }): Promise<{ confirmed: boolean }> {
    return new Promise((resolve, reject) => {
      this.chat(
        `[CORRECTION_CONFIRM] Violation ${params.violationId} was corrected to: "${params.correctedPhrase}". Success: ${params.success}. Update correction_playbook and confirm.`,
        {
          onEvent: () => {},
          onDone: () => resolve({ confirmed: true }),
          onError: (e: unknown) => reject(e),
        },
      );
    });
  }

  // ── Get compliance score trend ──
  @callable()
  async getScoreTrend(lastN: number = 10): Promise<Array<{ turn: number; score: number; violations: number }>> {
    const cs = this.state as ComplianceState;
    return cs.checkLog.slice(-lastN);
  }

  // ── Reset state (for new lead/session) ──
  @callable()
  async resetForLead(leadId: string): Promise<void> {
    this.setState({
      ...this.initialState,
      leadId,
      patternMemory: (this.state as ComplianceState)?.patternMemory ?? [],
    });
  }
}
```

**Note on `resetForLead`:** Preserves `patternMemory` across leads — the agent LEARNS. Violation patterns from one lead inform checks on the next. This is the "gets smarter over time" promise.

### GLOBAL_BANNED_PHRASES constant

```typescript
const GLOBAL_BANNED_PHRASES = [
  "guarantee", "definitely will", "definitely would", "promise you", "100 percent",
  "hi this is bella calling", "we're calling", "cold call",
  "your website needs work", "your site could be better", "your website is lacking",
];
```

---

## BELLAAGENT WIRING CHANGES

### Location: onChatResponse() (bella-agent.ts L644-793)

### BEFORE (L709-762 — current compliance block):
```typescript
if (bellaResponse.length > 10) {
  this.ctx.waitUntil((async () => {
    try {
      const checker = await this.subAgent(ComplianceAgent, `compliance-${state.leadId}`);
      let complianceResult: ComplianceResult | null = null;
      await checker.chat(
        `Check this Bella response for compliance:\nStage: ${state.currentStage}\nResponse: ${bellaResponse}`,
        {
          onEvent: (json: string) => {
            try { complianceResult = JSON.parse(json); } catch {}
          },
          onDone: async () => { /* ... session.appendMessage compliance branch ... */ },
        },
      );
    } catch (err: any) {
      console.error(`[COMPLIANCE_ERR] ${err.message}`);
    }
  })());
}
```

### AFTER (replace entire block with @callable):
```typescript
if (bellaResponse.length > 10) {
  this.ctx.waitUntil((async () => {
    try {
      const checker = await this.subAgent(ComplianceAgent, `compliance-${state.leadId}`);
      const result = await checker.checkResponse({
        response: bellaResponse,
        stage: state.currentStage,
        wowStep: state.currentWowStep,
        leadId: state.leadId,
        industryVertical: state.industry ?? undefined,
      });

      const s = this.cs;
      if (!s) return;

      s.complianceLog.push(
        `[${s.currentStage}] score=${result.score} pass=${result.pass} v=${result.violations.length} critical=${result.violations.filter(v => v.severity === "critical").length}`
      );
      this.setState(s);

      console.log(`[COMPLIANCE] score=${result.score} pass=${result.pass} violations=${result.violations.length}`);

      // Self-correction loop: if FAIL, inject compliance context and continue
      if (!result.pass) {
        const violationSummary = result.violations
          .map(v => `[${v.severity}] ${v.category}: "${v.phrase}"${v.suggestedRewrite ? ` → "${v.suggestedRewrite}"` : ""}`)
          .join("\n");

        console.warn(`[COMPLIANCE_FAIL] score=${result.score} triggering self-correction`);

        // continueLastTurn with compliance context
        s.complianceCorrecting = true;
        this.setState(s);

        await this.continueLastTurn({
          complianceViolations: violationSummary,
          complianceScore: result.score,
        });

        const afterState = this.cs;
        if (afterState) {
          afterState.complianceCorrecting = false;
          this.setState(afterState);
        }
      }
    } catch (err: any) {
      console.error(`[COMPLIANCE_ERR] ${err.message}`);
    }
  })());
}
```

**Key changes:**
1. **@callable instead of chat()** — `checker.checkResponse()` is typed, structured, returns a typed result
2. **continueLastTurn() instead of saveMessages()** — no fake user message. Model sees its own response + compliance context and self-corrects (think.d.ts L691-706)
3. **Violation details in correction** — model gets exact phrases + rewrites, not just "you violated something"
4. **Industry context passed** — compliance agent can load industry-specific rules

### REMOVE inline regex check (L781-793)

The current inline `BANNED_IN_OUTPUT` regex check at L781-793 is REDUNDANT with ComplianceAgent Layer 2. Remove it — ComplianceAgent catches these now with full context, not just regex.

```typescript
// DELETE this block (L781-793):
const BANNED_IN_OUTPUT = /\b(guarantee|definitely will|definitely would|promise you)\b/i;
const responseText = (result?.message?.parts ?? []).map((p: any) => p.text ?? '').join('');
if (BANNED_IN_OUTPUT.test(responseText) && !state.complianceCorrecting) {
  // ... saveMessages correction ...
}
```

**Wait — keep L1 (beforeTurn) banned phrases AND L2 (ComplianceAgent).** Remove ONLY the inline L781-793 regex in onChatResponse. L1 prevents generation. L2 catches what L1 missed. Inline regex was a stopgap.

---

## CONTINUELASTTURN SELF-CORRECTION PATTERN

**SDK evidence:** think.d.ts L691-706:
```
Run a new LLM call following the last assistant message.
The model sees the full conversation (including the last assistant
response) and generates a new response. The new response is persisted
as a separate assistant message.
```

**How it works for compliance:**
1. BellaAgent sends response to prospect
2. ComplianceAgent checks (non-blocking via `ctx.waitUntil`)
3. If FAIL: `this.continueLastTurn({ complianceViolations, complianceScore })` on BellaAgent
4. Model sees its own violating response + compliance context in `body`
5. Model generates a NEW corrected response — persisted as separate assistant message
6. Corrected response streams to prospect

**Latency trade-off:**
- Non-blocking (default): ComplianceAgent runs in parallel. ~100-300ms check. If violation found, correction adds ~500ms-1s. Prospect hears original response, then may hear correction.
- Blocking: ComplianceAgent runs BEFORE response delivery. Adds 100-300ms to every turn. Prospect only hears clean responses.

**Recommendation:** Non-blocking for v1. Switch to blocking only if violation rate > 5% in production. Trent decides.

---

## R2 KB BOOTSTRAP

T4 creates these files in the AGENT_KB_BUCKET under `compliance-kb/` prefix:

```
compliance-kb/global-rules.md
compliance-kb/voice-rules.md
compliance-kb/stage-rules/greeting.md
compliance-kb/stage-rules/wow.md
compliance-kb/stage-rules/recommendation.md
compliance-kb/stage-rules/close.md
compliance-kb/patterns/banned-phrases.md
compliance-kb/patterns/required-patterns.md
```

Content for these files comes from existing `COMPLIANCE_RULES_TEXT` and `STAGE_POLICIES_TEXT` in bella-agent.ts (already written in E1), expanded into full documents. Industry vertical files added as prospects from specific verticals are encountered.

---

## REUSABILITY — TEMPLATE FOR ANY AGENT TYPE

This ComplianceAgent is designed as a **reusable template**:

| Component | What to swap for new agent type |
|-----------|-------------------------------|
| R2 KB files | Different rules for chatbot, email, content generation |
| COMPLIANCE_SYSTEM_PROMPT | Different role description and rubric |
| Violation categories | Add/remove categories per domain |
| GLOBAL_BANNED_PHRASES | Domain-specific banned phrases |
| ComplianceState | Unchanged — generic by design |
| Tools | Unchanged — generic compliance toolkit |
| @callable interface | Unchanged — `checkResponse`, `isClean`, `getViolationHistory` work for any text |

**To add a new agent type:**
1. Upload rules to R2 under a new prefix
2. Create a new ComplianceAgent subclass OR configure via `loadIndustryRules()`
3. Call `checkResponse()` from your parent agent's `onChatResponse()`

---

## GATE REQUIREMENTS

### T5 SDK Preflight (ADR-002 IR-1)
- Verify `callable` import from `agents` package
- Verify `Think<Env, ComplianceState>` state generic pattern in think.d.ts
- Verify `continueLastTurn(body?)` signature accepts optional body param (think.d.ts L704-706)
- Verify `R2SkillProvider` and `AgentSearchProvider` imports from `agents/experimental/memory/session`
- Verify `chatRecovery` property exists on Think class (think.d.ts L11)

### T3A Codex Gate
- SDK_EVIDENCE_PACK:
  - `Think<Env, State>` state generic: think.d.ts L4
  - `configureSession` with all 4 provider types: sessions.md L162-211
  - `@callable()` decorator: sub-agents.md
  - `continueLastTurn(body)`: think.d.ts L691-706
  - `toolChoice` forcing in `beforeTurn`: think.d.ts L108-125
  - `chat()` from @callable: sub-agents.md L8-16
  - Workspace tools: tools.md L17-30
- Verify ComplianceState interface in types.ts
- Verify all 7 tool Zod schemas validate
- Verify no import cycles

### T3B Canary
- Fire test call with known compliance violations baked in
- Verify:
  1. ComplianceAgent scores response correctly
  2. Violation written to violation_index (FTS5)
  3. Pattern memory updates
  4. Workspace audit trail written
  5. Self-correction fires on critical violation
  6. continueLastTurn produces corrected response
  7. No regression in existing 65 canary assertions
  8. Latency: compliance check < 300ms

---

## IMPLEMENTATION ORDER FOR T4

1. Add `ComplianceState`, `ComplianceViolation`, `ComplianceRuleSet` to `types.ts`
2. Rewrite `compliance-agent.ts` with full class (configureSession, getTools, hooks, @callables)
3. Add `COMPLIANCE_SYSTEM_PROMPT` and `GLOBAL_BANNED_PHRASES` constants
4. Update BellaAgent `onChatResponse()` — replace chat block with @callable + continueLastTurn
5. Remove inline BANNED_IN_OUTPUT regex block from BellaAgent onChatResponse
6. Bootstrap R2 KB files (at minimum: global-rules.md, voice-rules.md)
7. Update ComplianceResult export if needed (types.ts already has it)
8. `tsc` — zero type errors
9. REVIEW_REQUEST to T2

---

## STATUS: READY FOR REVIEW

Spec complete. Enterprise-grade, Think-native, reusable across agent types. All SDK citations verified. Waiting for M1 to prove sub-agent upgrade playbook before implementation.
