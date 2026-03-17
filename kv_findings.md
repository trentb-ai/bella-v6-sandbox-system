# KV Schema Alignment — Findings

**Purpose:** Record every discovery during the schema alignment mission.

---

## Phase 1: Initial Setup

- Created `shared/kv-schema.ts` with canonical key definitions
- Planning files created: `kv_task_plan.md`, `kv_findings.md`, `kv_progress.md`

---

## Phase 2: Bare `{lid}` Key Investigation

### Expected State
- fast-intel and deep-scrape write to BOTH `lead:{lid}:intel` AND bare `{lid}`
- voice-agent tries `:intel` first then falls back to bare `lid`

### Grep Results (pre-fix)
```
BARE LID WRITES:
deep-scrape-workflow-sandbox/src/index.ts:223  await this.env.LEADS_KV.put(lid, enrichedStr, ...)
deep-scrape-workflow-sandbox/src/index.ts:326  await this.env.LEADS_KV.put(lid, JSON.stringify(bareEnv), ...)
fast-intel-sandbox/src/index.ts:1040           env.LEADS_KV.put(lid, str, ...)

BARE LID READS:
voice-agent-v9/src/index.ts:350     const rawStr = await this.env.LEADS_KV.get(this.lid);
deep-scrape-workflow-sandbox/src/index.ts:322  const bare = await this.env.LEADS_KV.get(lid);
fast-intel-sandbox/src/index.ts:1140           await env.LEADS_KV.get(lid) (fallback)
```

### Actual Code Found
**fast-intel L1037-1041:**
```typescript
// Write to both KV keys (bridge reads lead:{lid}:intel, MCP reads bare lid)
await Promise.all([
  env.LEADS_KV.put(`lead:${lid}:intel`, str, { expirationTtl: KV_TTL }),
  env.LEADS_KV.put(lid, str, { expirationTtl: KV_TTL }),  // <-- REMOVE
]);
```

**deep-scrape L222-223:**
```typescript
await this.env.LEADS_KV.put(`lead:${lid}:intel`, enrichedStr, { expirationTtl: KV_TTL });
await this.env.LEADS_KV.put(lid, enrichedStr, { expirationTtl: KV_TTL });  // <-- REMOVE
```

**deep-scrape L321-327:**
```typescript
// Mirror into bare lid key (for MCP worker compatibility)  <-- ENTIRE BLOCK REMOVE
const bare = await this.env.LEADS_KV.get(lid);
if (bare) {
  const bareEnv = JSON.parse(bare) as Record<string, unknown>;
  ((bareEnv.intel as Record<string, unknown>) ?? (bareEnv.intel = {})).deep = deepSummary;
  await this.env.LEADS_KV.put(lid, JSON.stringify(bareEnv), { expirationTtl: KV_TTL });
}
```

**voice-agent L347-369:**
Layer 3 fallback read from bare lid - REMOVE entire block

---

## Phase 3: script_stages Investigation

### Expected State
- consultant writes `lead:{lid}:script_stages`
- bridge never reads it

### Grep Results (pre-fix)
```
[To be filled after grep]
```

---

## Phase 4: `:name` Phantom Read Investigation

### Expected State
- bella-tools and mcp-worker read `lead:{lid}:name` standalone
- Key is never written standalone (name is inside intel envelope)

### Grep Results (pre-fix)
```
[To be filled after grep]
```

---

## Phase 5: ROI Key Investigation

### Expected State
- bella-tools and mcp-worker read `:roi_confirmed` and `:roi_estimate`
- Neither key is ever written

### Grep Results (pre-fix)
```
[To be filled after grep]
```

---

## Phase 6: `:memory` Investigation

### Expected State
- bella-tools reads `lead:{lid}:memory`
- Bridge writes `lead:{lid}:conv_memory`
- Different key names = phantom read

### Grep Results (pre-fix)
```
[To be filled after grep]
```

---

## Phase 7: `pending:` Investigation

### Expected State
- mcp-worker reads `pending:{pendingKey}`
- No worker writes this key

### Grep Results (pre-fix)
```
[To be filled after grep]
```

---

## Phase 8: `outcome:` Dual Write Investigation

### Expected State
- bella-tools AND mcp-worker both write `outcome:{lid}`
- Different JSON shapes

### Grep Results (pre-fix)
```
[To be filled after grep]
```

---

## Phase 9: Orphan Keys Investigation

### Expected State
- deepgram-bridge writes `conv_summary` (never read)
- deep-scrape writes `deepIntel` (already merged into intel)

### Grep Results (pre-fix)
```
[To be filled after grep]
```

---

## Phase 10: TTL Investigation

### Expected State
- Hardcoded TTLs throughout workers
- Should all use kvTTL constants

### Grep Results (pre-fix)
```
[To be filled after grep]
```

---

## Unexpected Discoveries

| Discovery | Impact | Action Taken |
|-----------|--------|--------------|
| — | — | — |
