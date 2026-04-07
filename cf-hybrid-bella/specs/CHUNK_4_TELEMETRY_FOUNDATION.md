# CHUNK 4 SPEC — Telemetry Foundation
### packages/telemetry (shared library) + instrument brain-v3 + prompt-worker-v3
### Author: T2 Code Lead | Date: 2026-04-07
### Status: DRAFT v1

---

## 1. SCOPE

Build the `packages/telemetry` shared library and instrument two deployed workers:
- **packages/telemetry** — emitter, SLO checker, BugPacket builder
- **brain-v3** — emit `brain.turnplan` events (timing + stage)
- **prompt-worker-v3** — emit `prompt.execution` events (TTFB + tokens)
- **compliance-workflow-v3** — emit `compliance.gate` events (Ring 1 result)

**NOT a deployed worker.** Telemetry is a shared package only. Workers import and call it.

**Out of scope for Chunk 4:** OTel export, external tracing, Vectorize ML features, replay harness. These are Chunk 10.

---

## 2. EVENT FAMILIES

Eight structured telemetry families. All emitted as structured `console.log` tags (CF Workers
structured logging). OTel export hook is a no-op stub in Chunk 4 — activated in Chunk 10.

| Family | Tag | Emitted by |
|--------|-----|------------|
| `call.lifecycle` | `[TEL:CALL]` | brain-v3 |
| `audio.pipeline` | `[TEL:AUDIO]` | realtime-agent-v3 (stub) |
| `brain.turnplan` | `[TEL:BRAIN]` | brain-v3 |
| `prompt.execution` | `[TEL:PROMPT]` | prompt-worker-v3 |
| `compliance.gate` | `[TEL:COMPLIANCE]` | compliance-workflow-v3 |
| `memory.merge` | `[TEL:MEMORY]` | brain-v3 |
| `intel.hydration` | `[TEL:INTEL]` | brain-v3 |
| `quality.outcome` | `[TEL:QUALITY]` | brain-v3 |

---

## 3. SLO TABLE

From `SLO_LIMITS` in `@bella/contracts` (already defined in Chunk 0):

| Metric | SLO | Measured |
|--------|-----|----------|
| transcript-to-TurnPlan | <150ms | brain-v3: request in → TurnPlan out |
| prompt-to-first-token | <500ms | prompt-worker-v3: fetch start → first SSE byte |
| end-to-end | <1200ms | brain-v3: turn request in → speak text dispatched |
| barge-in clear | <100ms | realtime-agent-v3 (stub in Chunk 4) |

---

## 4. FILE STRUCTURE

```
cf-hybrid-bella/packages/telemetry/
  src/
    emitter.ts       — emit(family, event) — structured log + OTel stub
    slo.ts           — checkSLO(metric, durationMs) — logs SLOViolationV1 if exceeded
    bug-packet.ts    — buildBugPacket(ctx) — assembles BugPacketV1 for R2 write
    index.ts         — exports
  package.json
  tsconfig.json
  src/__tests__/chunk4.test.ts  — C4-01 through C4-10
```

---

## 5. emitter.ts

```typescript
/**
 * packages/telemetry/src/emitter.ts
 * Structured telemetry emitter. CF Workers structured logging via console.log tags.
 * OTel export is a no-op stub in Chunk 4 — activated in Chunk 10.
 */

export type TelemetryFamily =
  | 'call.lifecycle'
  | 'audio.pipeline'
  | 'brain.turnplan'
  | 'prompt.execution'
  | 'compliance.gate'
  | 'memory.merge'
  | 'intel.hydration'
  | 'quality.outcome';

const FAMILY_TAG: Record<TelemetryFamily, string> = {
  'call.lifecycle':   '[TEL:CALL]',
  'audio.pipeline':   '[TEL:AUDIO]',
  'brain.turnplan':   '[TEL:BRAIN]',
  'prompt.execution': '[TEL:PROMPT]',
  'compliance.gate':  '[TEL:COMPLIANCE]',
  'memory.merge':     '[TEL:MEMORY]',
  'intel.hydration':  '[TEL:INTEL]',
  'quality.outcome':  '[TEL:QUALITY]',
};

export interface TelemetryEvent {
  family: TelemetryFamily;
  callId: string;
  ts: number;            // Date.now()
  durationMs?: number;   // elapsed since turn start, if known
  [key: string]: unknown;
}

/**
 * Emit a telemetry event. Structured log + no-op OTel stub.
 * Safe to call from any Worker — no async, no I/O.
 */
export function emit(event: TelemetryEvent): void {
  const tag = FAMILY_TAG[event.family];
  // Structured log — CF Workers picks these up as structured fields
  console.log(`${tag} callId=${event.callId} ts=${event.ts}${event.durationMs != null ? ` durationMs=${event.durationMs}` : ''} ${JSON.stringify(event)}`);
  // OTel stub — no-op in Chunk 4, activated in Chunk 10
  // otelExport(event);
}
```

---

## 6. slo.ts

```typescript
/**
 * packages/telemetry/src/slo.ts
 * SLO checker. Reads SLO_LIMITS from contracts, emits violation log if exceeded.
 */

import { SLO_LIMITS, type SLOViolationV1 } from '@bella/contracts';

export type SLOMetric = keyof typeof SLO_LIMITS;

/**
 * Check a timing against its SLO limit.
 * Logs [SLO_VIOLATION] if exceeded. Safe — no throws.
 */
export function checkSLO(
  metric: SLOMetric,
  durationMs: number,
  context: { callId: string; turnId?: string },
): SLOViolationV1 | null {
  const limitMs = SLO_LIMITS[metric];
  if (durationMs <= limitMs) return null;

  const violation: SLOViolationV1 = {
    version: 1,
    metric,
    limitMs,
    actualMs: durationMs,
    callId: context.callId,
    turnId: context.turnId,
    ts: new Date().toISOString(),
  };
  console.log(`[SLO_VIOLATION] metric=${metric} actual=${durationMs}ms limit=${limitMs}ms callId=${context.callId}`);
  return violation;
}
```

---

## 7. bug-packet.ts

```typescript
/**
 * packages/telemetry/src/bug-packet.ts
 * BugPacket builder. Assembles BugPacketV1 for R2 anomaly artifacts.
 * Callers write the packet to R2 — this module only builds it.
 */

import type { BugPacketV1, TurnPlanV1 } from '@bella/contracts';

export interface BugPacketContext {
  callId: string;
  turnId: string;
  stage: string;
  transcriptEntry: { speaker: 'prospect' | 'bella'; text: string; ts: string };
  turnPlan?: TurnPlanV1;
  promptSnapshot?: string;
  modelResponseRaw?: string;
  errorMessage?: string;
  timings: Record<string, number>;
}

/**
 * Build a BugPacketV1 for R2 write.
 * R2 key convention: bug-packets/{callId}/{turnId}.json
 */
export function buildBugPacket(ctx: BugPacketContext): BugPacketV1 {
  return {
    version: 1,
    callId: ctx.callId,
    turnId: ctx.turnId,
    stage: ctx.stage,
    ts: new Date().toISOString(),
    transcriptEntry: ctx.transcriptEntry,
    turnPlan: ctx.turnPlan,
    promptSnapshot: ctx.promptSnapshot,
    modelResponseRaw: ctx.modelResponseRaw,
    errorMessage: ctx.errorMessage,
    timings: ctx.timings,
  };
}

/** R2 key for a bug packet */
export function bugPacketR2Key(callId: string, turnId: string): string {
  return `bug-packets/${callId}/${turnId}.json`;
}
```

---

## 8. index.ts

```typescript
export { emit, type TelemetryEvent, type TelemetryFamily } from './emitter';
export { checkSLO, type SLOMetric } from './slo';
export { buildBugPacket, bugPacketR2Key, type BugPacketContext } from './bug-packet';
```

---

## 9. package.json

```json
{
  "name": "@bella/telemetry",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "@bella/contracts": "*"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250101.0",
    "typescript": "^5.3.0",
    "vitest": "^1.0.0"
  }
}
```

---

## 10. INSTRUMENTATION — brain-v3

Add to `workers/brain-v3/src/brain-do.ts`. Import `emit` and `checkSLO` from `@bella/telemetry`.

### 10A. brain.turnplan emit

In `handleTurn()` (the main turn handler), wrap the TurnPlan generation with timing:

```typescript
// BEFORE (existing):
const turnPlan = buildTurnPlan(state, facts, stage);
return Response.json(turnPlan);

// AFTER:
const t0 = Date.now();
const turnPlan = buildTurnPlan(state, facts, stage);
const durationMs = Date.now() - t0;

emit({
  family: 'brain.turnplan',
  callId: state.callId,
  ts: Date.now(),
  durationMs,
  stage: state.currentStage,
  turnId: turnPlan.turnId,
  stageAdvanced: turnPlan.stageAdvanced ?? false,
});

checkSLO('transcriptToTurnPlan', durationMs, { callId: state.callId, turnId: turnPlan.turnId });

return Response.json(turnPlan);
```

### 10B. call.lifecycle emit

In the DO's `fetch()` handler, on first turn (new call):

```typescript
// On call init (when state.turnCount === 0 before increment):
if (state.turnCount === 0) {
  emit({ family: 'call.lifecycle', callId, ts: Date.now(), event: 'call.started', stage: 'greeting' });
}
```

### 10C. intel.hydration emit

In each `/event/*` handler (Chunk 8 — stub the emit here, wire in Chunk 8):

```typescript
emit({ family: 'intel.hydration', callId, ts: Date.now(), source: 'fast-intel' | 'consultant' | 'deep-scrape', fieldsReceived: Object.keys(intelPayload).length });
```

---

## 11. INSTRUMENTATION — prompt-worker-v3

Add to `workers/prompt-worker-v3/src/index.ts`. Import `emit` and `checkSLO`.

```typescript
// BEFORE fetch to Gemini:
const promptStart = Date.now();

// On first SSE chunk received from Gemini (TTFB):
const ttfb = Date.now() - promptStart;
emit({
  family: 'prompt.execution',
  callId: turnPlan.callId,
  ts: Date.now(),
  durationMs: ttfb,
  event: 'prompt.ttfb',
  stage: turnPlan.stage,
  model: 'gemini-2.5-flash',
});
checkSLO('promptToFirstToken', ttfb, { callId: turnPlan.callId, turnId: turnPlan.turnId });

// On stream complete:
const totalMs = Date.now() - promptStart;
emit({
  family: 'prompt.execution',
  callId: turnPlan.callId,
  ts: Date.now(),
  durationMs: totalMs,
  event: 'prompt.complete',
  inputTokens: usage?.prompt_tokens,
  outputTokens: usage?.completion_tokens,
});
```

---

## 12. INSTRUMENTATION — compliance-workflow-v3

Add to `workers/compliance-workflow-v3/src/ring1.ts`. Import `emit`.

```typescript
// After inlineCheck() returns result, in index.ts /check-inline handler:
emit({
  family: 'compliance.gate',
  callId: result.callId,
  ts: Date.now(),
  ring: 1,
  score: result.score,
  driftType: result.driftType,
  stage: parsed.data.stage,
});
```

---

## 13. ASSERTIONS (C4-01 through C4-10)

```typescript
// C4-01: emit() logs correct family tag
// C4-02: emit() includes callId and ts in log output
// C4-03: checkSLO() returns null when duration <= limit
// C4-04: checkSLO() returns SLOViolationV1 when duration > limit
// C4-05: checkSLO() logs [SLO_VIOLATION] when exceeded
// C4-06: buildBugPacket() includes all required fields
// C4-07: bugPacketR2Key() returns correct path format
// C4-08: emit() does not throw on unknown callId
// C4-09: checkSLO() does not throw on unknown metric key
// C4-10: SLO_LIMITS imported from contracts are the source of truth (no hardcoded values)
```

---

## 14. CONTRACTS — PRE-IMPLEMENTATION PREREQUISITE (T3 confirmed ALL three missing)

T4 must add ALL of the following to contracts BEFORE building packages/telemetry.
Run `npx vitest run` in packages/contracts after adding to confirm zero TS errors.

### 14A. Add to `packages/contracts/src/telemetry.ts`

```typescript
export const SLO_LIMITS = {
  transcriptToTurnPlan: 150,   // ms
  promptToFirstToken: 500,     // ms
  endToEnd: 1200,              // ms
  bargeInClear: 100,           // ms
} as const;

export type SLOMetric = keyof typeof SLO_LIMITS;

export interface SLOViolationV1 {
  version: 1;
  metric: SLOMetric;
  limitMs: number;
  actualMs: number;
  callId: string;
  turnId?: string;
  ts: string;
}
```

### 14B. Add to `packages/contracts/src/workflow-payloads.ts`

```typescript
export interface BugPacketV1 {
  version: 1;
  callId: string;
  turnId: string;
  stage: string;
  ts: string;
  transcriptEntry: { speaker: 'prospect' | 'bella'; text: string; ts: string };
  turnPlan?: unknown;         // TurnPlanV1 — kept unknown to avoid circular dep
  promptSnapshot?: string;
  modelResponseRaw?: string;
  errorMessage?: string;
  timings: Record<string, number>;
}
```

Also add `BugPacketV1` to the `packages/contracts/src/index.ts` re-export.

### 14C. Verify existing contracts

These should already exist — confirm before proceeding:
- `TurnTelemetryV1` — `telemetry.ts`
- `SLO_LIMITS` (added above) — `telemetry.ts`
- `SLOViolationV1` (added above) — `telemetry.ts`
- `BugPacketV1` (added above) — `workflow-payloads.ts`

---

## 15. VERSION BUMPS

| Worker | Current version | New version |
|--------|----------------|-------------|
| brain-v3 | (check deployed) | +0.0.1 patch |
| prompt-worker-v3 | (check deployed) | +0.0.1 patch |
| compliance-workflow-v3 | 1.0.0 | 1.0.1 |

---

## 16. DEPLOY ORDER

1. Deploy `packages/telemetry` (package build only, no wrangler deploy)
2. Deploy compliance-workflow-v3 (simplest, Ring 1 only)
3. Deploy prompt-worker-v3
4. Deploy brain-v3 (last — most impact, most test coverage)

---

## 17. IMPLEMENTATION NOTES

- `emit()` must NEVER throw. Wrap in try/catch if needed. Telemetry must not break production.
- `checkSLO()` must NEVER throw. Same rule.
- All telemetry imports should be tree-shakeable (no side effects on import).
- `@bella/telemetry` depends only on `@bella/contracts` — no CF Workers types needed for the pure functions.
- The OTel stub comment `// otelExport(event);` must remain in emitter.ts — Chunk 10 removes the comment and activates it.
