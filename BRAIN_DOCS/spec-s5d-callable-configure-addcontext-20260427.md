# Spec: S5-D — @callable injection + configure() + session.addContext()
**Sprint:** S5-D | **Author:** T2 | **Date:** 2026-04-27 AEST
**Worker:** bella-think-agent-v1-brain
**Folder:** /Users/trentbelasco/Desktop/BELLA THINK AGENT V1/bella-think-agent-v1-brain
**Base version:** 3.11.29-think → **Target:** 3.11.30-think

---

## IR-1 SDK Evidence (ADR-002 Gate)

| Primitive | Source | Confirmed |
|-----------|--------|-----------|
| `@callable()` | `import { callable } from "agents"` — tools.md:171 | YES — decorator factory, no args |
| `configure<T>()` | think.d.ts:369 — `configure<T = Record<string,unknown>>(config: T): void` | YES |
| `getConfig<T>()` | think.d.ts:378 | YES |
| `this.session` | think.d.ts:308 — `session: Session$1` public property on Think | YES |
| `session.addContext()` | sessions.md:219 — `await session.addContext(label, { description, maxTokens })` | YES |
| `session.refreshSystemPrompt()` | sessions.md:223 — `await session.refreshSystemPrompt()` REQUIRED after addContext | YES |
| `StreamCallback.onError?` | sub-agents.md — optional third callback field | YES |

---

## Changes

### FILE 1: src/consultant-agent.ts

**CHANGE 1 — Add @callable import (after line 6)**

```typescript
// BEFORE (line 6):
import { createCompactFunction } from "agents/experimental/memory/utils";

// AFTER:
import { createCompactFunction } from "agents/experimental/memory/utils";
import { callable } from "agents";
```

**CHANGE 2 — Add 4 @callable methods (after getAnalysis() at line 512, before onChatResponse)**

```typescript
// BEFORE (lines 512-516):
  getAnalysis(): ConsultantState {
    return this.state as ConsultantState;
  }

  async onChatResponse(

// AFTER:
  getAnalysis(): ConsultantState {
    return this.state as ConsultantState;
  }

  @callable()
  async injectDeepIntel(payload: { source: string; data: string }): Promise<ConsultantState | null> {
    this.session.removeContext(`intel_${payload.source}`);
    await this.session.addContext(`intel_${payload.source}`, {
      description: `Deep intel from ${payload.source}`,
      maxTokens: 2000,
    });
    await this.session.refreshSystemPrompt();
    return new Promise((resolve, reject) => {
      this.chat(
        `[ENRICHMENT_PASS:${payload.source}] Deep intelligence arrived. Review and upgrade your analysis with this new data:\n${payload.data}`,
        {
          onEvent: () => {},
          onDone: () => resolve(this.state as ConsultantState),
          onError: (e: unknown) => reject(e),
        },
      );
    });
  }

  @callable()
  async injectProspectData(payload: { type: string; data: string }): Promise<ConsultantState | null> {
    return new Promise((resolve, reject) => {
      this.chat(
        `[PROSPECT_UPDATE:${payload.type}] Prospect shared: "${payload.data}". Update your analysis.`,
        {
          onEvent: () => {},
          onDone: () => resolve(this.state as ConsultantState),
          onError: (e: unknown) => reject(e),
        },
      );
    });
  }

  @callable()
  async setClientConfig(config: Record<string, unknown>): Promise<void> {
    this.configure(config);
  }

  @callable()
  async getClientConfig(): Promise<Record<string, unknown> | null> {
    return this.getConfig<Record<string, unknown>>();
  }

  async onChatResponse(
```

---

### FILE 2: src/bella-agent.ts

**CHANGE 3 — enrichConsultantAnalysis (replace lines 832-848)**

```typescript
// BEFORE (lines 832-848):
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

// AFTER:
  async enrichConsultantAnalysis(deepIntel: Record<string, any>) {
    const child = await this.subAgent(ConsultantAgent, "consultant");
    try {
      const cs = await child.injectDeepIntel({ source: "deep_intel", data: JSON.stringify(deepIntel, null, 2) });
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

**CHANGE 4 — updateConsultantFromProspect (replace lines 850-867)**

```typescript
// BEFORE (lines 850-867):
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

// AFTER:
  async updateConsultantFromProspect(dataType: string, value: string) {
    const child = await this.subAgent(ConsultantAgent, "consultant");
    try {
      const cs = await child.injectProspectData({ type: dataType, data: value });
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

---

### FILE 3: src/worker.ts

**CHANGE 5 — VERSION bump (line 16)**

```typescript
// BEFORE:
version: "3.11.29-think",

// AFTER:
version: "3.11.30-think",
```

---

## Acceptance Criteria

1. `tsc --noEmit` exits 0 — no type errors (includes @callable decorator compat)
2. `@callable` decorator applied to all 4 new methods
3. `injectDeepIntel` adds context block + calls refreshSystemPrompt before triggering enrichment pass
4. `injectProspectData` returns ConsultantState via Promise wrapping chat()
5. `setClientConfig` / `getClientConfig` wrap configure/getConfig correctly
6. `enrichConsultantAnalysis` in bella-agent.ts uses `child.injectDeepIntel()` — no direct chat() call
7. `updateConsultantFromProspect` uses `child.injectProspectData()` — no direct chat() call
8. VERSION = 3.11.30-think in health response post-deploy
9. beforeTurn prefix detection unchanged — [ENRICHMENT_PASS:] and [PROSPECT_UPDATE:] still work

## Scope Fence

- types.ts — NO changes
- beforeTurn prefix logic — NO changes (still works via injectDeepIntel triggering chat with same prefix)
- session.configureSession — NO changes
- Tool schemas — NO changes
- No new files

## SDK Scope Boundary (ADR-002 IR-2)

**JUDGE (SDK-agnostic):** TypeScript correctness, coupling, state machine logic, diff scope, regression risk
**DO NOT JUDGE (SDK-specific):** @callable HTTP exposure semantics, session.addContext persistence, configure() DO storage behavior
**SDK correctness settled by:** tsc --noEmit + runtime health check
