# CC TASK: V1.0 Lock + Perplexity Backport + V1.1 DO Brain Parallel Environment
# Priority: P0
# 
# EXECUTION ORDER:
#   PHASE 1: Lock V1.0 (git tag, confirm USE_DO_BRAIN=false)
#   PHASE 2: Backport Perplexity script into V1.0 bridge
#   PHASE 3: Tag the backported version
#   PHASE 4: Create V1.1 parallel environment (new workers, new Netlify)
#
# RULE: V1.0 must remain LIVE and WORKING at all times.
# The V1.1 environment is entirely separate — new workers, new Netlify.

---

## PHASE 1: Lock V1.0

### Step 1a: Confirm USE_DO_BRAIN=false on live bridge
Check deepgram-bridge-v9/wrangler.toml — USE_DO_BRAIN MUST be "false".
If it's not, fix it and redeploy the bridge immediately.

### Step 1b: Git tag V1.0 BEFORE any changes
```
cd /Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM
git add -A
git commit -m "V1.0 lock — pre-backport baseline"
git tag -a v1.0-pre-backport -m "V1.0 clean baseline before Perplexity script backport"
```
This is your rollback point. If anything breaks, revert to this tag.

---

## PHASE 2: Backport Perplexity Script into V1.0 Bridge

READ THESE FIRST:
1. CC_BACKPORT_SCRIPT.md (the detailed backport spec)
2. call-brain-do/src/moves.ts (SOURCE OF TRUTH for correct script text)
3. CC_PATCH_MOVES_V2.md (the full diff of every change)
4. deepgram-bridge-v9/src/index.ts lines 1625-2024 (what you're changing)

### What to change in deepgram-bridge-v9/src/index.ts:

ONLY change buildStageDirective() and gateOpen()/advance().
DO NOT touch buildTurnPrompt(), persona block, or architecture.

Summary of changes (full details in CC_BACKPORT_SCRIPT.md):
- WOW: 12 stalls → 9 stalls, gate from >=13 to >=10
- Stall text: match moves.ts chosenMove.text exactly
- ACV: "What's a new {ct} worth to {biz}?" not "Annual Client Value"
- Channel stages: add follow-up speed Q3 to ch_website and ch_phone
- ROI delivery: clean format, no annual, no trial re-pitch
- Close: "Would you like to go ahead" not assumptive
- Use consultant pre-built spoken lines as PRIMARY sources

### Deploy and verify:
1. Bump VERSION string (e.g., v9.15.0-perplexity)
2. npx wrangler deploy --dry-run
3. npx wrangler deploy
4. Quick wrangler tail check — confirm version string in logs
5. Browser test with fresh LID — verify new scripting is live

---

## PHASE 3: Tag the Backported Version

After backport is deployed and verified:
```
git add -A
git commit -m "V1.0.1 — Perplexity script backport to bridge buildStageDirective"
git tag -a v1.0.1-perplexity -m "Perplexity script backported to old bridge path"
```

---

## PHASE 4: Create V1.1 DO Brain Parallel Environment

Goal: Entirely separate Netlify + workers for DO brain testing.
V1.0 remains live and untouched from this point forward.

### Step 4a: Create V1.1 bridge worker

Copy deepgram-bridge-v9/ to deepgram-bridge-v11/
In deepgram-bridge-v11/wrangler.toml:
- Change name to "deepgram-bridge-v11"
- Change USE_DO_BRAIN to "true"
- Keep all other bindings identical (LEADS_KV, TOOLS, CALL_BRAIN)

Deploy:
```
cd deepgram-bridge-v11 && npx wrangler deploy
```
Copy secrets from old bridge (same values):
```
wrangler secret put GEMINI_API_KEY
wrangler secret put TOOLS_BEARER
```

### Step 4b: Create V1.1 voice agent worker

Copy voice-agent-v9/ to voice-agent-v11/
In voice-agent-v11/wrangler.toml:
- Change name to "bella-voice-agent-v11"
- Keep all other bindings identical

In voice-agent-v11/src/index.ts:
- Change the bridge endpoint URL from:
  "https://deepgram-bridge-sandbox-v8.trentbelasco.workers.dev/v9/chat/completions"
  to:
  "https://deepgram-bridge-v11.trentbelasco.workers.dev/v9/chat/completions"

Deploy:
```
cd voice-agent-v11 && npx wrangler deploy
```
Copy secrets:
```
wrangler secret put DEEPGRAM_API_KEY
```

### Step 4c: Create V1.1 Netlify folder

Copy netlify-funnel-sandbox-v9/ to netlify-funnel-v11/
(EXCLUDE .netlify/ folder — that's site-specific)

In netlify-funnel-v11/bella-voice-client.js:
- Change AGENT_BASE from:
  'wss://bella-voice-agent-sandbox-v8.trentbelasco.workers.dev'
  to:
  'wss://bella-voice-agent-v11.trentbelasco.workers.dev'

In netlify-funnel-v11/loading-v15.html:
- FAST_INTEL_URL stays the SAME (fast-intel is shared, already sends DO events)
- All other URLs stay the same

### Step 4d: Deploy V1.1 Netlify

Create a NEW Netlify site:
```
cd netlify-funnel-v11
npx netlify-cli sites:create --name bella-v11-do-brain
npx netlify-cli deploy --prod --dir .
```
Record the new URL (e.g. https://bella-v11-do-brain.netlify.app)

### Step 4e: Verify BOTH environments

V1.0 (MUST still work, with Perplexity backport):
```
https://demofunnelbellasandboxv8.netlify.app/loading-v95.html?lid=anon_v10_verify&web=https://www.kpmg.com&name=Trent&email=test@test.com
```
→ Old bridge path, USE_DO_BRAIN=false, Perplexity scripting in buildStageDirective

V1.1 (DO brain testing):
```
https://bella-v11-do-brain.netlify.app/loading-v95.html?lid=anon_v11_verify&web=https://www.kpmg.com&name=Trent&email=test@test.com
```
→ New bridge, USE_DO_BRAIN=true, DO brain active

### Step 4f: Git tag V1.1

```
git add -A
git commit -m "V1.1 — DO brain parallel environment (separate Netlify + workers)"
git tag -a v1.1-do-brain -m "V1.1 DO brain parallel env with separate Netlify"
```

---

## ARCHITECTURE AFTER ALL PHASES

V1.0 (LIVE — Perplexity scripted, old bridge architecture):
  Netlify: demofunnelbellasandboxv8.netlify.app
  Voice Agent: bella-voice-agent-sandbox-v8
  Bridge: deepgram-bridge-sandbox-v8 (USE_DO_BRAIN=false, v9.15.0-perplexity)
  fast-intel: fast-intel-v8 (shared)
  call-brain-do: receives events but bridge ignores them

V1.1 (DO BRAIN TESTING — separate environment):
  Netlify: bella-v11-do-brain.netlify.app
  Voice Agent: bella-voice-agent-v11 (NEW)
  Bridge: deepgram-bridge-v11 (NEW, USE_DO_BRAIN=true)
  fast-intel: fast-intel-v8 (shared)
  call-brain-do: active, drives the call

Shared workers (used by both):
  fast-intel-v8, deep-scrape-workflow-v9, consultant-v9,
  call-brain-do, bella-tools-worker-v8, KV namespace

Git tags:
  v1.0-pre-backport → clean baseline before any changes
  v1.0.1-perplexity → after Perplexity backport to bridge
  v1.1-do-brain → after parallel environment created

---

## CRITICAL RULES

1. PHASE 1 and 2 modify V1.0 bridge ONLY (buildStageDirective text)
2. PHASE 4 creates NEW folders and NEW workers — never modifies V1.0
3. After Phase 4, V1.0 files are FROZEN — no more changes
4. DO NOT modify deepgram-bridge-v9/ after Phase 3 tag
5. DO NOT modify voice-agent-v9/ at any point
6. DO NOT modify netlify-funnel-sandbox-v9/ at any point
7. All future DO brain work happens in the v11 folders
8. Secrets must be copied to new workers (same values)
9. One phase at a time. Verify before advancing.
10. Read CC_BACKPORT_SCRIPT.md for Phase 2 details
11. Read CC_PATCH_MOVES_V2.md for the full script diff

## EXECUTION ORDER

```
Phase 1 → tag v1.0-pre-backport
Phase 2 → backport Perplexity script → deploy bridge → verify
Phase 3 → tag v1.0.1-perplexity
Phase 4 → create v11 bridge, voice agent, Netlify → deploy all → verify both
Phase 4f → tag v1.1-do-brain
```
