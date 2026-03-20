# BELLA V2.0 ARCHITECTURE — ATOMIC WORKERS + DO ALARMS + QUEUES
# Source: GPT deep research with official Cloudflare docs
# Date: 20 March 2026
# Authority: GPT + Perplexity + Claude consensus
#
# THIS IS THE NEXT EVOLUTION OF BELLA'S ARCHITECTURE.
# Phase 1 = immediate. Phase 2 = next sprint. Phase 3 = future.

---

## ARCHITECTURE OVERVIEW

```
Call starts → Bridge opens CallBrainDO
  → DO initializes + schedules watchdog alarm
  → Intake publishes scrape jobs to Queue / Workflow fan-out
  → Atomic workers run IN PARALLEL:
      fast-site-worker → homepage/about/services extraction
      maps-worker → Google reviews, rating, NAP
      ads-worker → paid traffic / ad library signals
      hiring-worker → jobs/careers/open roles
      social-proof-worker → testimonials, logos, awards
      consultant-worker → transforms normalized intel → routing/script fills
  → Each worker sends typed event to DO via service binding
  → DO merges, reranks, alarm handles stuck/missing intel
```

### Component responsibilities

| Component | Owns | Does NOT own |
|-----------|------|-------------|
| CallBrainDO | Stage/stall, extraction, queue, ROI lock, spoken flags, intel merge, watchdog alarms, NextTurnPacket | Prompt formatting, Gemini calls, TTS, scraping |
| Bridge | Deepgram transport, transcript, DO RPC, prompt assembly, Gemini streaming | Stage advancement, extraction truth, queue rebuilding |
| Atomic workers | One scrape job each, typed payload return, event delivery to DO | Live call state, queue decisions |
| Queue | Burst absorption, guaranteed async delivery, retry | State, routing decisions |
| Workflow | Multi-step sequences, retries, sleeps, completion logic | Live turn decisions |
| DO Alarms | Per-call watchdog: deep missing, ROI pending, call stale, stage loop | Direct state mutation (sets flags only) |


---

## DO ALARMS — PER-CALL WATCHDOG

Official CF docs: DOs get ONE alarm at a time. Must implement a mini
scheduler that decides which checks to run on each alarm() wake.

### Watchdog checks

| Check | Trigger | Action (sets flag, NEVER mutates state directly) |
|-------|---------|--------------------------------------------------|
| deep_missing | apifyDone=false after 20s | Set deepIntelMissingEscalation=true, rerank to non-dependent moves |
| roi_pending | roiComputed=true, roiDelivered=false | Set mustDeliverRoiNext=true |
| call_stale | No /turn for 120s | Finalize transcript snapshot, close call |
| stage_loop | Same stage repeated 5+ times | Set questionBudgetTight=true, switch to fallback move |
| cleanup | After call_end event | Final KV snapshot, analytics write |

### CRITICAL RULE: Alarms set flags, they do NOT bulldoze

GOOD alarm actions:
- Set mustDeliverRoiNext = true
- Set deepIntelMissingEscalation = true
- Set questionBudgetTight = true
- Rerank FUTURE queue (preserve current stage)
- Finalize/snapshot on stale

BAD alarm actions (NEVER do these):
- Silently jump stage
- Overwrite extracted values
- Reset stall counters
- Inject fake user-turn events

### DO state additions

```typescript
watchdog: {
  mustDeliverRoiNext: boolean;
  deepIntelMissingEscalation: boolean;
  stageLoopCount: number;
  lastTurnAt?: string | null;
  nextChecks: Array<'deep_missing' | 'roi_pending' | 'call_stale' | 'stage_loop'>;
};
```


### Alarm scheduler implementation

```typescript
async function scheduleNextRelevantAlarm(
  brain: CallBrainState,
  state: DurableObjectState
) {
  const now = Date.now();
  const times: number[] = [];

  // ROI computed but not delivered — check in 15s
  if (!brain.flags.roiDelivered && brain.flags.roiComputed) {
    times.push(now + 15000);
  }
  // Deep intel still missing — check in 20s
  if (!brain.flags.apifyDone) {
    times.push(now + 20000);
  }
  // Call stale — check 120s after last turn
  if (brain.watchdog?.lastTurnAt) {
    times.push(
      new Date(brain.watchdog.lastTurnAt).getTime() + 120000
    );
  }

  if (times.length > 0) {
    await state.storage.setAlarm(Math.min(...times));
  }
}
```

### alarm() handler

```typescript
async alarm() {
  const brain = await loadState(this.state.storage);
  if (!brain) return;

  const now = Date.now();
  const lastTurnMs = brain.watchdog?.lastTurnAt
    ? new Date(brain.watchdog.lastTurnAt).getTime()
    : null;

  // ROI pending — flag for next turn
  if (brain.flags.roiComputed && !brain.flags.roiDelivered) {
    brain.watchdog.mustDeliverRoiNext = true;
    console.log(`[ALARM] ROI pending — mustDeliverRoiNext=true`);
  }

  // Deep intel missing — escalate
  if (!brain.flags.apifyDone) {
    brain.watchdog.deepIntelMissingEscalation = true;
    console.log(`[ALARM] Deep intel missing — escalation flagged`);
  }

  // Call stale — no turn for 2 minutes
  if (lastTurnMs && now - lastTurnMs > 120000) {
    console.log(`[ALARM] Call stale — finalizing`);
    // snapshot to KV, mark call ended
  }

  await persistState(this.state.storage, brain);
  await scheduleNextRelevantAlarm(brain, this.state);
}
```

### Where to schedule alarms

- After session_init / ensureSession (first alarm)
- After every /turn (update lastTurnAt, reschedule)
- After every intel event (check if deep is done)
- After llm_reply_done (check ROI status)

---

## ATOMIC WORKERS — PARALLEL ENRICHMENT

### Worker set

| Worker | Job | Input | Output event | Latency target |
|--------|-----|-------|-------------|----------------|
| fast-site-worker | Homepage + about + services + contact extraction | URL | site_intel_ready | <5s |
| maps-worker | Google Places: reviews, rating, NAP, location | Business name + location | maps_ready | <8s |
| ads-worker | Meta Ad Library + Google Ads Transparency | Business name + domain | ads_ready | <15s |
| hiring-worker | Indeed/Seek/careers page scanning | Business name + domain | hiring_ready | <20s |
| social-proof-worker | Testimonials, logos, awards, trust badges | URL | social_ready | <8s |
| consultant-worker | Transform normalized intel → routing, script fills, ICP, conversion analysis | All above intel | consultant_ready | <5s |

Each worker:
1. Does ONE thing
2. Returns ONE typed payload
3. Publishes ONE event to DO via service binding
4. Spins up, scrapes, delivers, spins down

### Event schema (every event)

```typescript
type EnrichmentEvent = {
  eventId: string;        // crypto.randomUUID()
  leadId: string;         // the LID
  type: string;           // 'site_intel_ready' | 'maps_ready' | etc
  version: number;        // monotonic
  sentAt: string;         // ISO timestamp
  source: string;         // worker name
  payload: Record<string, unknown>;
};
```


---

## QUEUE TOPOLOGY

```
Request path → publishes jobs to Queue
Queue consumer → dispatches to atomic workers
Atomic workers → deliver typed events to DO via service binding
```

Why Queue:
- Burst absorption (multiple leads arriving fast)
- Guaranteed delivery (no silent drops like current deep_ready issue)
- Retry built-in
- Decouples request path from enrichment latency

### Queue name: bella-enrichment-queue

Message shape:
```typescript
type EnrichmentJob = {
  jobId: string;
  leadId: string;
  jobType: 'site' | 'maps' | 'ads' | 'hiring' | 'social' | 'consultant';
  input: Record<string, unknown>;  // URL, business name, etc
  createdAt: string;
  priority: number;  // 1=fast (site, maps), 2=medium (ads, social), 3=slow (hiring)
};
```

---

## PHASED ROLLOUT

### PHASE 1 — Immediate (this sprint)
- Add DO watchdog state + alarm() handler
- Wire alarms for: roi_pending, deep_missing, call_stale
- Add event observability (eventId logging at sender + receiver)
- Fix industry language precedence (consultant > heuristic)
- Fix extraction (loosen standalone regex, add logging)
- Split fast-intel into: fast-site-worker + consultant-worker
- Add maps-worker (extract from current deep-scrape)

### PHASE 2 — Next sprint
- Put enrichment jobs on Queue
- Add ads-worker (replace Apify FB/Google with direct APIs)
- Add hiring-worker (replace flaky Indeed Apify)
- Add social-proof-worker
- Add deepIntelMissingEscalation alarm logic
- Wire all atomic workers to DO via service bindings

### PHASE 3 — Future
- Upgrade worker-to-DO calls to typed RPC (WorkerEntrypoint)
- Add D1 mirror for structured analytics
- Add R2 payload archive for call replay
- Add Vectorize similarity memory for vertical patterns
- TurnAssets model (consultant generates candidate moves per stage)
- Config packs for multi-agent reusability


---

## OFFICIAL SOURCES (GPT cited these)

- CF Durable Objects rules: https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/
- CF DO Alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
- CF Queues + DOs: https://developers.cloudflare.com/queues/examples/use-queues-with-durable-objects/
- CF Queues overview: https://developers.cloudflare.com/queues/
- CF Workers best practices: https://developers.cloudflare.com/workers/best-practices/workers-best-practices/
- CF Service bindings: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/
- CF Service bindings RPC: https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/
- CF Vectorize: https://developers.cloudflare.com/vectorize/
- Gemini structured output: https://ai.google.dev/gemini-api/docs/structured-output

---

## CC EXECUTION

For Phase 1, tell CC:

```
cat BELLA_V2_ARCHITECTURE.md
cat GPT_DEEP_ANALYSIS_3_ISSUES.md
```

Phase 1 execution order:
1. Add watchdog state to call-brain-do/src/types.ts
2. Add alarm() handler to call-brain-do/src/index.ts
3. Wire scheduleNextRelevantAlarm after ensureSession, /turn, intel events
4. Add event observability (eventId) to fast-intel + deep-scrape + DO
5. Fix industry language precedence in intel.ts
6. Add 'financial planning' to INDUSTRY_PACKS + KEYWORD_MAP
7. Fix extraction regex + fallback in extract.ts
8. tsc --noEmit + deploy

DO NOT attempt Phase 2 or 3 until Phase 1 is stable and tested.
