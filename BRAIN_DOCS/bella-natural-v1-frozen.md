# BELLA NATURAL V1 — FROZEN STACK REGISTRY
**Filed:** 2026-04-10 AEST | **Authority:** Trent Belasco
**Status:** PERMANENTLY FROZEN — DO NOT DEPLOY OVER ANY `frozen-bella-natural-*` WORKER
**D1 doc:** `doc-bella-natural-v1-frozen-20260410`

---

## WHAT THIS IS

The `bella-natural-v1` stack is the proven peak Bella — identical code to `bella-golden-v1` (Apr 3 2026), deployed as a permanent separate stack with new worker names on 2026-04-10 AEST.

**Live test result:** 10/10 stages, compliance 1.00, TTFB 490–702ms (fastest ever measured on live call)
**Source tag:** `bella-golden-v1` (commit `8e23c66` / `663103b68758f55949de596dc1bd968a83fbad8c`)
**Git tag:** `bella-natural-v1` (same commit, tagged 2026-04-10, pushed to remote ✅)

---

## WORKER INVENTORY — ALL FROZEN

| Worker | Version | Role |
|---|---|---|
| `frozen-bella-natural-voice` | v4.2.0-EOT-INJECT | WebSocket voice agent (Deepgram) |
| `frozen-bella-natural-bridge` | v9.40.0 | LLM bridge (Gemini 2.5 Flash) |
| `frozen-bella-natural-brain` | v6.16.1 | Durable Object brain (stage machine) |
| `frozen-bella-natural-fast-intel` | v1.18.0 | Fast intel (Firecrawl + Consultant) |
| `frozen-bella-natural-consultant` | current | Consultant analysis + scriptFills |
| `frozen-bella-natural-tools` | current | Tool handler |
| `frozen-bella-natural-scrape` | current | Deep scrape workflow (Apify) |

**KV Namespace:** `leads-kv` | ID: `0fec6982d8644118aba1830afd4a58cb`
**CF Account:** `9488d0601315a70cac36f9bd87aa4e82`

---

## SOURCE FOLDERS (`~/Desktop/BELLA_GOLDEN_V1 copy/`)

| Folder | Deploys As |
|---|---|
| `bella-consultant/` | `frozen-bella-natural-consultant` |
| `bella-scrape-workflow-v10-rescript/` | `frozen-bella-natural-scrape` |
| `bella-tools-worker/` | `frozen-bella-natural-tools` |
| `bella-voice-agent-v2-rescript/` | `frozen-bella-natural-voice` |
| `brain-v2-rescript/` | `frozen-bella-natural-brain` |
| `bridge-v2-rescript/` | `frozen-bella-natural-bridge` |
| `fast-intel-v9-rescript/` | `frozen-bella-natural-fast-intel` |

**TOOLS WORKER NOTE:** `tools/src/index.ts` line 11 — broken monorepo import replaced with:
```ts
const kvKey = { callBrief: (lid: string) => `lead:${lid}:call_brief` };
const kvTTL = { callBrief: 14400 };
```
All other 6 workers are byte-for-byte golden source.

---

## SERVICE BINDINGS

| Worker | Binding | Target |
|---|---|---|
| `frozen-bella-natural-bridge` | `CALL_BRAIN` | `frozen-bella-natural-brain` |
| `frozen-bella-natural-bridge` | `TOOLS` | `frozen-bella-natural-tools` |
| `frozen-bella-natural-voice` | `TOOLS` | `frozen-bella-natural-tools` |
| `frozen-bella-natural-fast-intel` | `CONSULTANT` | `frozen-bella-natural-consultant` |
| `frozen-bella-natural-fast-intel` | `DEEP_SCRAPE` | `frozen-bella-natural-scrape` |
| `frozen-bella-natural-fast-intel` | `CALL_BRAIN` | `frozen-bella-natural-brain` |
| `frozen-bella-natural-scrape` | `CONSULTANT` | `frozen-bella-natural-consultant` |
| `frozen-bella-natural-tools` | `CONSULTANT` | `frozen-bella-natural-consultant` |

`BIG_SCRAPER` binding removed from fast-intel — `personalisedaidemofinal` is permanently off limits.

---

## SECRETS (names only — values in CF dashboard)

| Worker | Secret Names |
|---|---|
| `frozen-bella-natural-bridge` | `GEMINI_API_KEY`, `TOOLS_BEARER` |
| `frozen-bella-natural-voice` | `DEEPGRAM_API_KEY`, `TOOLS_BEARER_TOKEN` |
| `frozen-bella-natural-fast-intel` | `GEMINI_API_KEY`, `FIRECRAWL_API_KEY`, `SCRAPINGANT_KEY` |
| `frozen-bella-natural-scrape` | `APIFY_API_KEY`, `GEMINI_API_KEY` |
| `frozen-bella-natural-consultant` | `GEMINI_API_KEY` |
| `frozen-bella-natural-tools` | `BEARER_TOKEN` |

`TOOLS_BEARER` = `TOOLS_BEARER_TOKEN` = `BEARER_TOKEN` — same value, three names.

---

## FRONTEND

| Item | Value |
|---|---|
| Netlify URL | https://bellanaturalv1desktop11111111.netlify.app |
| Local source | `~/Desktop/netlify-funnel-bella-natural-v1/` |
| Demo page | `demo_v15_hybrid.html` |
| Loading page | `loading-v15.html` |
| Voice client | `bella-voice-client.js` v2.7.2 |
| AGENT_BASE | `wss://frozen-bella-natural-voice.trentbelasco.workers.dev` |
| FAST_INTEL_URL | `https://frozen-bella-natural-fast-intel.trentbelasco.workers.dev` |

**Test URL:**
```
https://bellanaturalv1desktop11111111.netlify.app/demo_v15_hybrid.html?fn=Trent&lid=LID&web=https%3A%2F%2Fwww.pitcher.com.au&biz=Pitcher
```

---

## GIT

| Item | Value |
|---|---|
| Tag | `bella-natural-v1` |
| Source tag | `bella-golden-v1` |
| Commit | `8e23c66` |
| Remote | `https://github.com/trentb-ai/bella-v6-sandbox-system.git` |
| Pushed | 2026-04-10 ✅ |

---

## CANARY RESULTS — 2026-04-10 AEST

**LID:** `anon_lkn5tnvq` | **URL:** pitcher.com.au | **Live voice call with Trent**

| Section | Score |
|---|---|
| Pipeline P1-P11 | 11/11 PASS ✅ |
| DO State D1-D10 | 9/9 testable PASS ✅ |
| Bridge B1-B8 | 6/7 PASS (B3: no numeric data given) |
| Spoken SQ1-SQ10 | 8/10 (SQ5 borderline, SQ9 generic opener) |
| Compliance | 1.00 PERFECT ✅ |
| Stages | ALL 10 completed ✅ |
| TTFB | **490–702ms — fastest ever on live call** |

**Known bugs in golden source (not regressions):**
- WOW2: "Google data isn't loaded yet" spoken
- WOW2: "James" wrong agent name

---

## KNOWN ISSUE

`frozen-bella-natural-fast-intel` hits CF CPU limit (error 1101) on large sites. Data writes to KV successfully despite the error. Not a code bug — Firecrawl on large sites exceeds CF CPU budget. Workaround: use a pre-populated LID if fast-intel fails.

---

## RESTORE RUNBOOK (zero-context, push-of-a-button)

**Prerequisites:** wrangler authenticated to CF account `9488d0601315a70cac36f9bd87aa4e82`

```bash
# 1. Get source
cd ~/Desktop/BELLA_GOLDEN_V1\ copy/

# 2. Deploy in order
# a. Consultant (no deps)
cd bella-consultant
# edit wrangler.toml: name = "frozen-bella-natural-consultant"
npm install && npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY --name frozen-bella-natural-consultant

# b. Brain (no deps)
cd ../brain-v2-rescript
# edit wrangler.toml: name = "frozen-bella-natural-brain"
npm install && npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY --name frozen-bella-natural-brain

# c. Tools (deps: consultant) — FIX LINE 11 FIRST
cd ../bella-tools-worker
# edit wrangler.toml: name = "frozen-bella-natural-tools", consultant binding → frozen-bella-natural-consultant
# edit src/index.ts line 11: replace import with inline consts (see TOOLS WORKER NOTE)
npm install && npx wrangler deploy
npx wrangler secret put BEARER_TOKEN --name frozen-bella-natural-tools

# d. Scrape (deps: consultant)
cd ../bella-scrape-workflow-v10-rescript
# edit wrangler.toml: name = "frozen-bella-natural-scrape", consultant binding → frozen-bella-natural-consultant
npm install && npx wrangler deploy
npx wrangler secret put APIFY_API_KEY --name frozen-bella-natural-scrape
npx wrangler secret put GEMINI_API_KEY --name frozen-bella-natural-scrape

# e. Fast-intel (deps: consultant, scrape, brain — REMOVE BIG_SCRAPER BINDING)
cd ../fast-intel-v9-rescript
# edit wrangler.toml: name = "frozen-bella-natural-fast-intel"
# update all bindings, DELETE the BIG_SCRAPER line entirely
npm install && npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY --name frozen-bella-natural-fast-intel
npx wrangler secret put FIRECRAWL_API_KEY --name frozen-bella-natural-fast-intel
npx wrangler secret put SCRAPINGANT_KEY --name frozen-bella-natural-fast-intel

# f. Bridge (deps: brain, tools)
cd ../bridge-v2-rescript
# edit wrangler.toml: name = "frozen-bella-natural-bridge"
# CALL_BRAIN → frozen-bella-natural-brain, TOOLS → frozen-bella-natural-tools
npm install && npx wrangler deploy
npx wrangler secret put GEMINI_API_KEY --name frozen-bella-natural-bridge
npx wrangler secret put TOOLS_BEARER --name frozen-bella-natural-bridge

# g. Voice (deps: tools)
cd ../bella-voice-agent-v2-rescript
# edit wrangler.toml: name = "frozen-bella-natural-voice", TOOLS → frozen-bella-natural-tools
npm install && npx wrangler deploy  # use global wrangler if npm fails
npx wrangler secret put DEEPGRAM_API_KEY --name frozen-bella-natural-voice
npx wrangler secret put TOOLS_BEARER_TOKEN --name frozen-bella-natural-voice

# 3. Verify
curl https://frozen-bella-natural-bridge.trentbelasco.workers.dev/health

# 4. Canary smoke test
LID="restore-$(date +%s)"
curl -X POST https://frozen-bella-natural-fast-intel.trentbelasco.workers.dev/fast-intel \
  -H "Content-Type: application/json" \
  -d "{\"lid\":\"${LID}\",\"websiteUrl\":\"https://pitcher.com.au\",\"firstName\":\"Trent\",\"email\":\"test@test.com\"}"
sleep 30
npx wrangler kv key get "lead:${LID}:fast-intel" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote | python3 -m json.tool | grep business_name
# Expected: "Pitcher Partners"

# 5. Frontend
# Deploy ~/Desktop/netlify-funnel-bella-natural-v1/ to Netlify
# OR use existing: https://bellanaturalv1desktop11111111.netlify.app
```
