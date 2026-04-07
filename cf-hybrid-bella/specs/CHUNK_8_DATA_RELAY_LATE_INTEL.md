# CHUNK 8 SPEC — Data Relay + Late Intel (Brain DO Receiver)
### bella-brain-v3 additions — /event/* endpoints + merge laws
### Author: T2 Code Lead | Date: 2026-04-07
### Status: DRAFT v3 — P1-A/B/C fixes (assertions + §9 note) per T3 SPEC_GATE_VERDICT FAIL v2

---

## 1. SCOPE

Add event-driven intel delivery endpoints to `bella-brain-v3`. The Brain DO becomes the authoritative merge point for all intel. No KV polling anywhere in V3.

**This chunk = RECEIVER only.** fast-intel-v3 (sender) is Chunk 8B, separate gate.

### Three new endpoints on Brain DO:
| Endpoint | Event | Source (Chunk 8B) |
|----------|-------|------------------|
| `POST /event/fast-intel` | Fast scrape + Consultant analysis ready | fast-intel-v3 |
| `POST /event/consultant-ready` | Consultant data ready (separate, if delayed) | fast-intel-v3 / consultant-v3 |
| `POST /event/deep-scrape` | Apify deep scrape results ready | deep-scrape-workflow-v3 |

### Merge laws (non-negotiable):
1. Prospect-stated data (`source=prospect` in D1 `lead_facts`) wins over all. Never overwrite.
2. `consultant: false` placeholder is BLOCKED — typeof gate required.
3. Template contamination (`{{placeholder}}`, `[PLACEHOLDER]` patterns) → reject entire payload.
4. Deep scrape may arrive mid-call — Brain merges to HotMemory immediately (no restart needed).
5. `consultantReady` flag on TurnPlan: false until `/event/consultant-ready` or `/event/fast-intel` (with consultant data) received.

---

## 2. CONTRACTS — PRE-IMPLEMENTATION PREREQUISITE (P1-1/P1-3 fix)

### 2A. IntelReadyEventV1 actual shape (T3 confirmed this exists in contracts)

The actual contract uses `lid` (NOT `leadId`). All routing must use `parsed.data.lid`.

From `@bella/contracts/src/intel-events.ts` (existing — do NOT recreate):
```typescript
// Actual shape (confirmed by T3):
IntelReadyEventV1 {
  lid: string;           // ← routing key — use this, NOT leadId
  core_identity: { business_name, industry, location, ... };
  consultant: ConsultantResponseV1 | false;   // false = placeholder, BLOCK it
  flags: IntelFlagsV1;
  tech_stack: TechStackV1;
  deep: { status: 'processing' | 'done', googleMaps?, ads?, hiring?, linkedin? };
  // ... other fields
}
```

### 2B. consultantReady in TurnPlanV1 (P1-1 fix — same patch as Chunk 7 §0)

`consultantReady` is NOT currently in TurnPlanV1. It must be added in the same contracts patch as Chunk 7's allowFreestyle/improvisationBand/intent additions:
```typescript
consultantReady: z.boolean().default(false),
```

If Chunk 7 contracts patch is already applied, this is already done. If Chunk 8 is implemented before Chunk 7 (not recommended), T4 must apply the contracts patch first.

### 2C. FastIntelV1 type (P1-3 fix — Option A: define it)

Add to `packages/contracts/src/intel-events.ts`:
```typescript
// FastIntelV1 = the top-level IntelReadyEventV1 payload shape
// Already defined as IntelReadyEventV1 — no separate type needed.
// Merge functions use IntelReadyEventV1 directly.
export type FastIntelV1 = z.infer<typeof IntelReadyEventV1>;
```

---

## 3. NEW FILE — intel-merge.ts (P1-2/P1-3 fix: actual contract field names, `lid` routing)

```typescript
// workers/brain-v3/src/intel-merge.ts
// Merge laws for late-arriving intel events.
// Uses actual IntelReadyEventV1 shape (lid, core_identity, consultant, flags, tech_stack, deep)
// and actual ConsultantResponseV1 shape (businessIdentity, scriptFills, routing, conversationHooks).

import type { ConversationState } from './state';
import type { IntelReadyEventV1 } from '@bella/contracts';

const TEMPLATE_CONTAMINATION_RE = /\{\{[^}]+\}\}|\[PLACEHOLDER\]|\[INSERT\]/i;

/** Returns true if any string field in obj contains template contamination. All-or-nothing: reject entire payload. */
export function isContaminated(obj: unknown): boolean {
  if (typeof obj === 'string') return TEMPLATE_CONTAMINATION_RE.test(obj);
  if (Array.isArray(obj)) return obj.some(isContaminated);
  if (obj && typeof obj === 'object') return Object.values(obj).some(isContaminated);
  return false;
}

/**
 * Merge a full IntelReadyEventV1 payload into Brain DO state.
 * Handles fast-intel (core_identity + flags + tech_stack) and consultant (routing + scriptFills).
 * Returns number of fields merged.
 */
export function mergeIntelEvent(state: ConversationState, payload: IntelReadyEventV1): number {
  if (isContaminated(payload)) {
    console.log(`[INTEL_MERGE] REJECTED fast-intel — template contamination detected lid=${payload.lid}`);
    return 0;
  }
  let merged = 0;

  // core_identity — business name, industry, location
  if (payload.core_identity) {
    if (payload.core_identity.business_name && !state.businessName) {
      state.businessName = payload.core_identity.business_name; merged++;
    }
    state.fastIntelData = { ...state.fastIntelData, core_identity: payload.core_identity }; merged++;
  }

  // flags + tech_stack
  if (payload.flags) { state.intelFlags = { ...state.intelFlags, ...payload.flags }; merged++; }
  if (payload.tech_stack) { state.fastIntelData = { ...state.fastIntelData, tech_stack: payload.tech_stack }; merged++; }

  // consultant — block consultant:false placeholder, use actual ConsultantResponseV1 shape
  if (payload.consultant !== undefined) {
    merged += mergeConsultant(state, payload.consultant);
  }

  console.log(`[INTEL_MERGE] fast-intel merged=${merged} lid=${payload.lid}`);
  return merged;
}

/**
 * Merge consultant data using actual ConsultantResponseV1 shape.
 * Fields: businessIdentity, scriptFills, routing, conversationHooks.
 * NO icpAnalysis/valuePropAnalysis/hiringAnalysis/copyAnalysis — those don't exist in actual contract.
 */
export function mergeConsultant(state: ConversationState, payload: unknown): number {
  // Block consultant:false placeholder (typeof gate)
  if (payload === false || payload === null || typeof payload !== 'object') {
    console.log(`[INTEL_MERGE] BLOCKED consultant — invalid type (consultant:false placeholder or null)`);
    return 0;
  }
  if (isContaminated(payload)) {
    console.log(`[INTEL_MERGE] REJECTED consultant — template contamination`);
    return 0;
  }

  const c = payload as Record<string, any>;
  let merged = 0;

  // Actual ConsultantResponseV1 fields (confirmed by T3):
  if (c.businessIdentity) { state.consultantData = { ...state.consultantData, businessIdentity: c.businessIdentity }; merged++; }
  if (c.scriptFills) { state.scriptFills = { ...state.scriptFills, ...c.scriptFills }; merged++; }
  if (c.routing) { state.consultantData = { ...state.consultantData, routing: c.routing }; merged++; }
  if (c.conversationHooks) { state.consultantData = { ...state.consultantData, conversationHooks: c.conversationHooks }; merged++; }

  // Mark consultant ready
  state.consultantReady = true;
  console.log(`[INTEL_MERGE] consultant merged=${merged} consultantReady=true`);
  return merged;
}

/**
 * Merge deep scrape payload into state (arrives via /event/deep-scrape).
 * Shape: IntelReadyEventV1.deep { googleMaps, ads, hiring, linkedin }
 */
export function mergeDeepScrape(state: ConversationState, deep: Record<string, any>): number {
  if (isContaminated(deep)) {
    console.log(`[INTEL_MERGE] REJECTED deep-scrape — template contamination`);
    return 0;
  }
  let merged = 0;
  if (deep.googleMaps) { state.deepIntel = { ...state.deepIntel, googlePresence: deep.googleMaps }; merged++; }
  if (deep.ads) { state.deepIntel = { ...state.deepIntel, ads: deep.ads }; merged++; }
  if (deep.hiring) { state.deepIntel = { ...state.deepIntel, hiringMatches: deep.hiring }; merged++; }
  if (deep.googleMaps?.rating != null) {
    state.intelFlags = { ...state.intelFlags, review_signals: true };
  }
  console.log(`[INTEL_MERGE] deep-scrape merged=${merged}`);
  return merged;
}
```

---

## 4. EVENT ENDPOINTS — index.ts additions (brain-v3)

Add to the Brain DO worker's `fetch()` handler in `workers/brain-v3/src/index.ts`.

```typescript
// In the DO worker fetch handler, add before the 404 fallback:

// Validate with actual IntelReadyEventV1 Zod schema — use parsed.data.lid for DO routing (P1-2 fix)
if (url.pathname === '/event/fast-intel' && request.method === 'POST') {
  const raw = await request.json().catch(() => null);
  if (!raw) return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  const parsed = IntelReadyEventV1.safeParse(raw);
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  const doId = env.BRAIN_DO.idFromName(parsed.data.lid);  // ← lid, NOT leadId
  const stub = env.BRAIN_DO.get(doId);
  return stub.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(parsed.data), headers: { 'Content-Type': 'application/json' } }));
}

if (url.pathname === '/event/consultant-ready' && request.method === 'POST') {
  const raw = await request.json().catch(() => null);
  if (!raw) return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  const parsed = IntelReadyEventV1.safeParse(raw);
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  const doId = env.BRAIN_DO.idFromName(parsed.data.lid);
  const stub = env.BRAIN_DO.get(doId);
  return stub.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(parsed.data), headers: { 'Content-Type': 'application/json' } }));
}

if (url.pathname === '/event/deep-scrape' && request.method === 'POST') {
  const raw = await request.json().catch(() => null);
  if (!raw) return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  const parsed = IntelReadyEventV1.safeParse(raw);
  if (!parsed.success) return Response.json({ error: 'Invalid payload', issues: parsed.error.issues }, { status: 400 });
  const doId = env.BRAIN_DO.idFromName(parsed.data.lid);
  const stub = env.BRAIN_DO.get(doId);
  return stub.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(parsed.data), headers: { 'Content-Type': 'application/json' } }));
}
```

### 4A. Brain DO handler additions (brain-do.ts)

Add routing inside `BrainDO.fetch()`:

```typescript
// In BrainDO.fetch() routing:
if (url.pathname === '/event/fast-intel' && request.method === 'POST') {
  const payload = await request.json() as IntelReadyEventV1;
  const state = await this.loadState();
  const merged = mergeIntelEvent(state, payload);  // uses mergeIntelEvent (not mergeFastIntel)
  await this.saveState(state);
  return Response.json({ ok: true, merged });
}

if (url.pathname === '/event/consultant-ready' && request.method === 'POST') {
  const payload = await request.json() as IntelReadyEventV1;
  const state = await this.loadState();
  // consultant-ready: merge only the consultant field
  const merged = mergeConsultant(state, payload.consultant);
  await this.saveState(state);
  return Response.json({ ok: true, merged, consultantReady: state.consultantReady });
}

if (url.pathname === '/event/deep-scrape' && request.method === 'POST') {
  const payload = await request.json() as IntelReadyEventV1;
  const state = await this.loadState();
  const merged = mergeDeepScrape(state, payload.deep ?? {});
  await this.saveState(state);
  return Response.json({ ok: true, merged });
}
```

---

## 5. STATE ADDITIONS (state.ts)

Add to `ConversationState`:

```typescript
consultantReady: boolean;           // false until /event/consultant-ready received
fastIntelData: Record<string, any> | null;
intelFlags: Record<string, boolean> | null;
websiteHealth: Record<string, any> | null;
scriptFills: Record<string, string | null> | null;
consultantData: Record<string, any> | null;
deepIntel: {
  googlePresence?: any[];
  ads?: any;
  hiringMatches?: string[];
} | null;
```

Add to `initialState()`:
```typescript
consultantReady: false,
fastIntelData: null,
intelFlags: null,
websiteHealth: null,
scriptFills: null,
consultantData: null,
deepIntel: null,
```

---

## 6. TurnPlan consultantReady gate (turn-plan.ts)

```typescript
// In buildTurnPlan():
turnPlan.consultantReady = state.consultantReady;
// Prompt Worker uses this to gate consultant context injection
// When false: Prompt Worker omits consultant fields from Gemini prompt
```

**NOTE (P1-1 fix):** `consultantReady` is NOT currently in TurnPlanV1 — it must be added via the contracts patch in Chunk 7 spec §0 (`consultantReady: z.boolean().default(false)`). If Chunk 7 contracts patch is already applied, this is done. If Chunk 8 deploys before Chunk 7, T4 applies the contracts patch as a prerequisite.

---

## 7. ASSERTIONS C8-01 through C8-15

```
C8-01: mergeIntelEvent merges core_identity.business_name into state.businessName
C8-02: mergeIntelEvent rejects payload with {{placeholder}} contamination, returns 0
C8-03: mergeConsultant blocks consultant:false payload, returns 0
C8-04: mergeConsultant blocks non-object payload, returns 0
C8-05: mergeConsultant sets state.consultantReady = true on valid payload
C8-06: mergeConsultant rejects contaminated payload
C8-07: mergeDeepScrape merges googlePresence into state.deepIntel
C8-08: mergeDeepScrape sets review_signals flag when rating present
C8-09: mergeDeepScrape rejects contaminated payload
C8-10: isContaminated detects {{placeholder}} in string
C8-11: isContaminated detects {{placeholder}} nested in object
C8-12: isContaminated returns false for clean data
C8-13: POST /event/fast-intel with valid payload returns { ok: true, merged: N }
C8-14: POST /event/consultant-ready with consultant:false (invalid Zod type) returns 400
C8-15: TurnPlan.consultantReady = false before consultant event, true after
```

---

## 8. VERSION BUMP

brain-v3: bump to next minor version after Chunk 7 (e.g. v1.2.0 if 7 = v1.1.0).

---

## 9. IMPLEMENTATION NOTES

- **Merge is additive only.** Never null-out existing state fields. Only set fields that are present and non-null in the payload.
- **DO isolation.** Each `lid` gets its own DO instance. `/event/*` endpoints route by `parsed.data.lid` (Zod-validated IntelReadyEventV1 field) to the correct instance. No cross-lead contamination possible.
- **Mid-call safe.** Deep scrape can arrive at turn 5. `mergeDeepScrape()` is called from the event handler — no restart needed. Next TurnPlan build picks up the new state automatically.
- **No KV reads.** Brain DO never polls KV. All intel arrives via event POST. KV is dead for V3 Brain.
- **Health endpoint.** `/health` should report `consultantReady` status so T5 can verify intel hydration after test call setup.

---

## 10. INTEGRATION TEST SEQUENCE (for T5 post-deploy canary)

1. POST synthetic fast-intel payload to `bella-brain-v3/event/fast-intel?leadId=test-c8`
2. GET `bella-brain-v3/state?leadId=test-c8` → verify `fastIntelData` populated, `consultantReady=false`
3. POST synthetic consultant payload to `/event/consultant-ready?leadId=test-c8`
4. GET state → verify `consultantReady=true`, consultant fields present
5. POST synthetic deep-scrape to `/event/deep-scrape?leadId=test-c8`
6. GET state → verify `deepIntel.googlePresence` populated
7. POST contaminated payload → verify state unchanged (merge returns 0)
8. POST `consultant:false` → verify state.consultantReady still false, state unchanged
