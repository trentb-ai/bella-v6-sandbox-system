# CHUNK 6 SPEC — Compliance Workflow
### bella-compliance-workflow-v3 (3-Ring Compliance Audit)
### Author: T2 Code Lead | Date: 2026-04-07
### Status: DRAFT v3 — awaiting T3 spec gate (P1-A/B/C fixed)

---

## 1. SCOPE

Build `bella-compliance-workflow-v3` exposing a 3-ring compliance audit system:

- **Ring 1 (pre-speak, synchronous, <50ms)** — Pure TS inline check. Brain DO calls before dispatching TurnPlan. Verifies: ROI exact match, cold-call framing detection, website-critique detection.
- **Ring 2 (post-turn, async Cloudflare Workflow)** — Gemini LLM judge. Bella's actual spoken response vs planned directive. Writes to D1 `quality_scores` + R2 audit log.
- **Ring 3 (nightly, async Cloudflare Workflow)** — Drift scoring across all calls. Scans D1, computes drift rate, writes R2 nightly report.

**Storage:**
- D1 `bella-data-v3` (`d39aedef-e3bc-4145-b0be-c18cf17b2ddd`) → `quality_scores` table (existing schema)
- R2 `bella-audit-v3` (NEW — T4 must create before deploy) → immutable per-turn + nightly audit objects

**Contracts:** `CompliancePayloadV1` (in), `ComplianceResultV1` (out) — no new contracts needed.

**Separation of concerns:** Brain DO calls Ring 1 synchronously pre-speak (blocks on result). Brain DO/Realtime fires Ring 2 post-turn (non-blocking, async). Ring 3 is cron/manual.

---

## 2. ROI EXACT MATCH — KEY REQUIREMENT

When `stage === 'roi_delivery'`, Brain DO embeds locked ROI lines in the directive:
```
...lockedLines: ["Alex adds $12,500/yr", "Chris adds $8,200/yr", ...]...
```

Ring 1 extracts dollar figures from `bellaResponse` (planned speak text at Ring 1 time) and verifies each locked figure appears verbatim. Any mismatch → `driftType: 'false_claim'`, `score: 0.0`.

Dollar figure regex: `/\$[\d,]+(?:\.\d+)?/gi`

If no `lockedLines` pattern in directive: ROI check skipped entirely.
If stage !== `roi_delivery`: ROI check skipped entirely.

---

## 3. FILE STRUCTURE

```
workers/compliance-workflow-v3/src/
  index.ts              — Worker handler: /check-inline, /audit-turn, /audit-nightly, /health
  ring1.ts              — inlineCheck() — sync, pure TS, <50ms
  ring2.ts              — ComplianceWorkflow (WorkflowEntrypoint) — LLM judge
  ring3.ts              — NightlyReplayWorkflow (WorkflowEntrypoint) — drift scoring
  roi-match.ts          — extractDollarFigures(), verifyRoiExactMatch()
  types.ts              — Internal types
  __tests__/chunk6.test.ts — C6-01 through C6-14
```

---

## 4. RING 1 — INLINE CHECK (ring1.ts)

```typescript
import type { CompliancePayload, ComplianceResult } from '@bella/contracts';
import { extractDollarFigures, verifyRoiExactMatch } from './roi-match';

const COLD_CALL_PHRASES = [
  /\bhi\s+this\s+is\s+\w+\s+calling\s+from\b/i,
  /\bi('m|\s+am)\s+calling\s+(you\s+)?today\s+(to|about)\b/i,
  /\bsorry\s+to\s+(bother|disturb)\b/i,
];

const WEBSITE_CRITIQUE_PHRASES = [
  /\byour\s+(website|site)\s+(is\s+)?(bad|poor|outdated|terrible|lacks?)\b/i,
  /\bwebsite\s+(needs?\s+(work|improvement|fixing)|is\s+(bad|old|outdated))\b/i,
];

export function inlineCheck(payload: CompliancePayload): ComplianceResult {
  const { callId, turnId, stage, directive, bellaResponse } = payload;

  // ── ROI exact match (roi_delivery only) ──
  if (stage === 'roi_delivery') {
    const roiResult = verifyRoiExactMatch(directive, bellaResponse);
    if (!roiResult.match) {
      return { version: 1, callId, turnId, score: 0.0, driftType: 'false_claim', details: `ROI mismatch: ${roiResult.details}` };
    }
  }

  // ── Cold-call framing ──
  for (const re of COLD_CALL_PHRASES) {
    if (re.test(bellaResponse)) {
      return { version: 1, callId, turnId, score: 0.1, driftType: 'false_claim', details: `Cold-call framing: "${bellaResponse.slice(0, 80)}"` };
    }
  }

  // ── Website critique ──
  for (const re of WEBSITE_CRITIQUE_PHRASES) {
    if (re.test(bellaResponse)) {
      return { version: 1, callId, turnId, score: 0.2, driftType: 'false_claim', details: 'Website critique detected (Law 8)' };
    }
  }

  return { version: 1, callId, turnId, score: 1.0, driftType: 'none' };
}
```

---

## 5. ROI MATCH HELPER (roi-match.ts)

```typescript
export function extractDollarFigures(text: string): string[] {
  return text.match(/\$[\d,]+(?:\.\d+)?/gi) ?? [];
}

export function verifyRoiExactMatch(
  directive: string,
  bellaResponse: string,
): { match: boolean; details?: string } {
  const lockedMatch = directive.match(/lockedLines:\s*\[(.*?)\]/s);
  if (!lockedMatch) return { match: true };

  const expectedFigures = extractDollarFigures(lockedMatch[1]);
  if (expectedFigures.length === 0) return { match: true };

  const missing = expectedFigures.filter(fig => !bellaResponse.includes(fig));
  if (missing.length === 0) return { match: true };

  return { match: false, details: `Missing: ${missing.join(', ')}` };
}
```

---

## 6. RING 2 — LLM JUDGE WORKFLOW (ring2.ts)

```typescript
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import type { CompliancePayload, ComplianceResult } from '@bella/contracts';
import { ComplianceResultV1 } from '@bella/contracts';

interface Env { DB: D1Database; AUDIT_BUCKET: R2Bucket; GEMINI_API_KEY: string; VERSION?: string; }

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export class ComplianceWorkflow extends WorkflowEntrypoint<Env, CompliancePayload> {
  async run(event: WorkflowEvent<CompliancePayload>, step: WorkflowStep) {
    const payload = event.payload;

    const result = await step.do('llm-judge', { retries: { limit: 3, delay: '2 seconds', backoff: 'exponential' } }, async () => {
      if (!this.env.GEMINI_API_KEY) {
        return { version: 1 as const, callId: payload.callId, turnId: payload.turnId, score: 0.5, driftType: 'omission' as const, details: 'GEMINI_API_KEY not configured' };
      }
      const raw = await this.runGeminiJudge(payload);
      const parsed = ComplianceResultV1.safeParse({ ...raw, version: 1, callId: payload.callId, turnId: payload.turnId });
      if (!parsed.success) {
        return { version: 1 as const, callId: payload.callId, turnId: payload.turnId, score: 0.5, driftType: 'omission' as const, details: 'Parse failed' };
      }
      return parsed.data;
    });

    await step.do('write-d1', { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } }, async () => {
      await this.env.DB.prepare(
        `INSERT OR IGNORE INTO quality_scores (call_id, turn_id, compliance_score, drift_type, details) VALUES (?, ?, ?, ?, ?)`
      ).bind(result.callId, result.turnId, result.score, result.driftType, result.details ?? null).run();
      console.log(`[COMPLIANCE] D1 written callId=${result.callId} score=${result.score} drift=${result.driftType}`);
    });

    await step.do('write-r2', { retries: { limit: 3, delay: '1 second', backoff: 'exponential' } }, async () => {
      const key = `audit/${result.callId}/${result.turnId}.json`;
      await this.env.AUDIT_BUCKET.put(key, JSON.stringify({ ...result, payload, ts: new Date().toISOString() }), { httpMetadata: { contentType: 'application/json' } });
      console.log(`[COMPLIANCE] R2 written key=${key}`);
    });
  }

  private async runGeminiJudge(payload: CompliancePayload): Promise<Partial<ComplianceResult>> {
    const response = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.env.GEMINI_API_KEY}` },
      body: JSON.stringify({
        model: 'gemini-2.5-flash',
        messages: [
          { role: 'system', content: `You are a compliance judge for Bella, an INBOUND voice AI agent. The prospect CHOSE to be there. Score: 0.0=severe 0.5=minor 1.0=clean. driftType: none|omission|substitution|hallucination|false_claim. Return JSON only: { score, driftType, details? }` },
          { role: 'user', content: `Stage: ${payload.stage}\nDirective: ${payload.directive}\nBella said: "${payload.bellaResponse}"\nProspect said: "${payload.prospectUtterance}"\nEvaluate compliance.` },
        ],
        temperature: 0, max_tokens: 150, reasoning_effort: 'none', response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { score: 0.5, driftType: 'omission' };
    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return { score: 0.5, driftType: 'omission' };
    try { return JSON.parse(content); } catch { return { score: 0.5, driftType: 'omission' }; }
  }
}
```

---

## 7. RING 3 — NIGHTLY REPLAY WORKFLOW (ring3.ts)

```typescript
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

interface Env { DB: D1Database; AUDIT_BUCKET: R2Bucket; VERSION?: string; }
interface NightlyPayload { date?: string; }

export class NightlyReplayWorkflow extends WorkflowEntrypoint<Env, NightlyPayload> {
  async run(event: WorkflowEvent<NightlyPayload>, step: WorkflowStep) {
    const targetDate = event.payload.date ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const stats = await step.do('aggregate', async () => {
      const rows = await this.env.DB.prepare(
        `SELECT drift_type, AVG(compliance_score) as avg_score, COUNT(*) as count FROM quality_scores WHERE DATE(created_at) = ? GROUP BY drift_type`
      ).bind(targetDate).all();
      const total = rows.results.reduce((s: number, r: any) => s + (r.count as number), 0);
      const flagged = rows.results.reduce((s: number, r: any) => r.drift_type !== 'none' ? s + (r.count as number) : s, 0);
      return { date: targetDate, total, flagged, driftRate: total > 0 ? flagged / total : 0, breakdown: rows.results };
    });

    await step.do('write-report', async () => {
      const key = `nightly/${targetDate}.json`;
      await this.env.AUDIT_BUCKET.put(key, JSON.stringify({ ...stats, generatedAt: new Date().toISOString() }), { httpMetadata: { contentType: 'application/json' } });
      console.log(`[COMPLIANCE] Nightly report key=${key} driftRate=${(stats.driftRate * 100).toFixed(1)}% total=${stats.total}`);
    });
  }
}
```

---

## 8. WORKER HANDLER (index.ts)

```typescript
import { CompliancePayloadV1 } from '@bella/contracts';
import { inlineCheck } from './ring1';
export { ComplianceWorkflow } from './ring2';
export { NightlyReplayWorkflow } from './ring3';

interface Env {
  DB: D1Database;
  AUDIT_BUCKET: R2Bucket;
  COMPLIANCE_WORKFLOW: Workflow;
  NIGHTLY_WORKFLOW: Workflow;
  GEMINI_API_KEY: string;
  VERSION?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return Response.json({ version: env.VERSION ?? '1.0.0', worker: 'compliance-workflow-v3' });
    }

    if (url.pathname === '/check-inline' && request.method === 'POST') {
      const body = await request.json();
      const parsed = CompliancePayloadV1.safeParse(body);
      if (!parsed.success) return Response.json({ error: 'Invalid payload', details: parsed.error.issues }, { status: 400 });
      return Response.json(inlineCheck(parsed.data));
    }

    if (url.pathname === '/audit-turn' && request.method === 'POST') {
      const body = await request.json();
      const parsed = CompliancePayloadV1.safeParse(body);
      if (!parsed.success) return Response.json({ error: 'Invalid payload', details: parsed.error.issues }, { status: 400 });
      const instance = await env.COMPLIANCE_WORKFLOW.create({ params: parsed.data });
      return Response.json({ ok: true, instanceId: instance.id });
    }

    if (url.pathname === '/audit-nightly' && request.method === 'POST') {
      const body = await request.json().catch(() => ({}));
      const instance = await env.NIGHTLY_WORKFLOW.create({ params: body });
      return Response.json({ ok: true, instanceId: instance.id });
    }

    return new Response('Not found', { status: 404 });
  },
};
```

---

## 9. WRANGLER CONFIG (FULL REPLACEMENT)

```toml
name = "bella-compliance-workflow-v3"
main = "src/index.ts"
compatibility_date = "2025-04-01"

[vars]
VERSION = "1.0.0"

[[d1_databases]]
binding = "DB"
database_name = "bella-data-v3"
database_id = "d39aedef-e3bc-4145-b0be-c18cf17b2ddd"

[[r2_buckets]]
binding = "AUDIT_BUCKET"
bucket_name = "bella-audit-v3"

[[workflows]]
name = "compliance-workflow"
binding = "COMPLIANCE_WORKFLOW"
class_name = "ComplianceWorkflow"

[[workflows]]
name = "nightly-replay-workflow"
binding = "NIGHTLY_WORKFLOW"
class_name = "NightlyReplayWorkflow"
```

Secrets: `GEMINI_API_KEY`

---

## 10. ASSERTIONS

Test file: `workers/compliance-workflow-v3/src/__tests__/chunk6.test.ts`

C6-01: inlineCheck returns score=1.0, driftType='none' for clean response
C6-02: inlineCheck returns score=0.0, driftType='false_claim' when ROI figures missing (roi_delivery stage, locked $12,500 absent from response)
C6-03: inlineCheck returns score=1.0 when ROI figures exactly match lockedLines
C6-04: inlineCheck returns score=0.1, driftType='false_claim' for cold-call framing "Hi this is Bella calling from"
C6-05: inlineCheck returns score=0.2, driftType='false_claim' for website critique "your website needs work"
C6-06: inlineCheck ROI check skipped when stage !== 'roi_delivery'
C6-07: extractDollarFigures("Alex adds $12,500/yr") returns ["$12,500"]
C6-08: extractDollarFigures("combined $45,000 per year") returns ["$45,000"]
C6-09: verifyRoiExactMatch — directive with no lockedLines pattern returns { match: true }
C6-10: verifyRoiExactMatch — locked $12,500 present in response returns { match: true }
C6-11: verifyRoiExactMatch — locked $12,500 absent from response returns { match: false, details: "Missing: $12,500" }
C6-12: POST /check-inline returns valid ComplianceResultV1 (Zod parse succeeds, score in [0,1])
C6-13: POST /audit-turn returns { ok: true, instanceId } (Ring 2 Workflow queued)
C6-14: POST /audit-nightly returns { ok: true, instanceId } (Ring 3 Workflow queued)

---

## 11. SLO TARGETS

| Metric | Target |
|---|---|
| Ring 1 /check-inline | < 50ms |
| Ring 2 LLM judge + writes | < 20s total |
| Ring 3 nightly report | < 60s |

---

## 12. IMPLEMENTATION NOTES FOR T4

1. **Create R2 bucket FIRST:** `npx wrangler r2 bucket create bella-audit-v3`
2. **Replace wrangler.toml stub entirely** — existing stub has wrong [[d1_databases]] database_id (placeholder). Use §9 config verbatim.
3. **quality_scores INSERT** — use `INSERT OR IGNORE` (not plain INSERT, not INSERT OR REPLACE). No `id` or `created_at` in columns (autoincrement + default). Requires UNIQUE INDEX on (call_id, turn_id) — run migration in §12 Note 9 before deploy.
4. **Ring 1 is pure TS** — NOT a Workflow, NOT step.do. Inline function in fetch handler. Zero network calls.
5. **Ring 2 Gemini guard** — check `this.env.GEMINI_API_KEY` exists before fetch. Return { score: 0.5, driftType: 'omission' } if missing.
6. **Two Workflow exports** from index.ts — both ComplianceWorkflow and NightlyReplayWorkflow.
7. **ROI check fires only at roi_delivery stage** — guard with `if (stage === 'roi_delivery')` before any regex.
8. **lockedLines format in directive** — Brain DO writes: `lockedLines: ["Alex adds $X,XXX/yr", ...]`. Ring 1 parses this via regex `lockedLines:\s*\[(.*?)\]`.

9. **Schema migration required before deploy:** Run this against bella-data-v3 D1 to enable INSERT OR IGNORE deduplication:
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_scores_call_turn ON quality_scores(call_id, turn_id);
   ```
   Command: `npx wrangler d1 execute bella-data-v3 --remote --command "CREATE UNIQUE INDEX IF NOT EXISTS idx_quality_scores_call_turn ON quality_scores(call_id, turn_id);"`

---

## 13. DEPENDENCY GRAPH

```
Chunk 0 (contracts) ← DONE
Chunk 1 (Brain DO) ← DONE — calls /check-inline pre-speak, /audit-turn post-turn
  ↓
Chunk 6 (Compliance Workflow) ← THIS SPEC
  ↓
Chunk 12 (Admin Dashboard) — reads D1 quality_scores + R2 audit trail
```

---

END OF SPEC v1 — AWAITING T3 SPEC GATE
