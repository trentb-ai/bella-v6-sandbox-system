# BELLA NATURAL STACK — FULL HANDOVER DOC
### Created: 2026-04-10 AEST | Status: FROZEN GOLDEN
### For: ChatGPT / Antigravity / new session cold pickup

---

## WHAT THIS IS

Bella is a voice AI sales receptionist. She is an **INBOUND WEBSITE AGENT**.

Flow: Prospect submits details on a website funnel → system scrapes their site (~20s) → Bella greets them ON THE WEBSITE with personalised insights → demos Alex/Chris/Maddie tailored to their specific business.

- The prospect CHOSE to be there. No cold-call framing. Ever.
- Bella has already scraped their business before she speaks. She never asks "what do you do?"
- The WOW is that she knows their business from the scrape data.

---

## LIVE STACK — frozen-bella-natural-* (ALL LIVE ON CLOUDFLARE)

| Worker | Deployed Name | URL | Version |
|--------|--------------|-----|---------|
| Brain (DO) | `frozen-bella-natural-brain` | https://frozen-bella-natural-brain.trentbelasco.workers.dev | v6.16.1 |
| Bridge | `frozen-bella-natural-bridge` | https://frozen-bella-natural-bridge.trentbelasco.workers.dev | v9.40.0 |
| Voice Agent | `frozen-bella-natural-voice` | https://frozen-bella-natural-voice.trentbelasco.workers.dev | v4.2.0-EOT-INJECT |
| Fast Intel | `frozen-bella-natural-fast-intel` | https://frozen-bella-natural-fast-intel.trentbelasco.workers.dev | v1.18.0 |
| Consultant | `frozen-bella-natural-consultant` | https://frozen-bella-natural-consultant.trentbelasco.workers.dev | live |
| Deep Scrape | `frozen-bella-natural-deep-scrape` | https://frozen-bella-natural-deep-scrape.trentbelasco.workers.dev | live |
| Tools | `frozen-bella-natural-tools` | https://frozen-bella-natural-tools.trentbelasco.workers.dev | live |

**All service bindings confirmed clean as of 2026-04-10.**

---

## CLOUDFLARE ACCOUNT

- **Account ID:** `9488d0601315a70cac36f9bd87aa4e82`
- **KV Namespace:** `leads-kv` ID `0fec6982d8644118aba1830afd4a58cb`
- **Shared Brain D1:** `shared-brain` ID `2001aba8-d651-41c0-9bd0-8d98866b057c`
- **R2 Bucket:** `bella-audit-v3`

---

## GITHUB REPO

- **Repo:** https://github.com/trentb-ai/bella-v6-sandbox-system
- **Working dir:** `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM`
- **Current branch:** HEAD detached at `bella-v2-frozen-20260407`
- **Golden tags:**
  - `bella-golden-v1` → commit `8e23c66` (original golden, Apr 3)
  - `bella-natural-v1` → same commit (natural stack freeze tag, Apr 10)
- **Local source:** `/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/frozen-bella-natural-stack/`
- **Also at:** `/Users/trentbelasco/Desktop/bella-natural-stack-FROZEN/`

---

## SERVICE BINDING AUDIT (CONFIRMED CLEAN 2026-04-10)

| Worker | Bindings |
|--------|----------|
| fast-intel | CONSULTANT → natural-consultant, DEEP_SCRAPE → natural-deep-scrape, BIG_SCRAPER → personalisedaidemofinal-sandbox, CALL_BRAIN → natural-brain, LEADS_KV |
| bridge | TOOLS → natural-tools, CALL_BRAIN → natural-brain, LEADS_KV |
| voice | TOOLS → bella-tools-worker-v8, LEADS_KV, BRIDGE_URL var |
| brain | LEADS_KV |
| consultant | LEADS_KV |
| tools | CONSULTANT → natural-consultant, LEADS_KV |
| deep-scrape | CONSULTANT, WORKFLOW, LEADS_KV, AI |

**Root cause of earlier 500s:** Cloudflare secret-change deploys don't re-push service bindings — only secrets. Always use `wrangler deploy` from source (not secret-only updates) to ensure bindings register.

---

## SECRETS REQUIRED

| Worker | Secrets |
|--------|---------|
| fast-intel | FIRECRAWL_API_KEY, GEMINI_API_KEY, SCRAPINGANT_KEY |
| bridge | GEMINI_API_KEY |
| voice | DEEPGRAM_API_KEY, TOOLS_BEARER_TOKEN |
| consultant | GEMINI_API_KEY |
| deep-scrape | APIFY_API_KEY |
| tools | BEARER_TOKEN |

**All secrets confirmed set and working as of 2026-04-10.**

---

## KV SCHEMA

| Key | Writer | Reader |
|-----|--------|--------|
| `lead:{lid}:fast-intel` | fast-intel, deep-scrape | bridge, brain |
| `lead:{lid}:script_state` | bridge | bridge |
| `lead:{lid}:conv_memory` | bridge | bridge |
| `lead:{lid}:captured_inputs` | bridge | demo agents |
| `lead:{lid}:pending` | voice | voice |

---

## FRONTEND

- **Local demo server:** `python3 -m http.server 8080` from `/tmp/bella-natural-test/`
- **Demo URL format:** `http://localhost:8080/demo_v15_hybrid.html?lid={LID}&fn={FirstName}`
- **Natural Netlify folder:** `~/Desktop/netlify-funnel-bella-natural-v1/` (AGENT_BASE already points to frozen-bella-natural-voice)
- **bella-voice-client.js line 19:** `const AGENT_BASE = 'wss://frozen-bella-natural-voice.trentbelasco.workers.dev'`
- **Voice WS format:** `wss://frozen-bella-natural-voice.trentbelasco.workers.dev/agents/bella-agent/{LID}?fn={FirstName}`

---

## HOW TO FIRE A FRESH CALL (PRESS-OF-A-BUTTON)

```bash
# Step 1: Generate new LID with intel
LID="natural-$(date +%s)"
curl -s -X POST https://frozen-bella-natural-fast-intel.trentbelasco.workers.dev/fast-intel \
  -H "Content-Type: application/json" \
  -d "{\"lid\":\"${LID}\",\"websiteUrl\":\"https://pitcher.com.au\",\"firstName\":\"Trent\",\"email\":\"test@test.com\"}"

# Step 2: Wait 25s for intel to populate KV

# Step 3: Start tails
ITER=$(date +%s)
npx wrangler tail frozen-bella-natural-bridge --format=json 2>&1 | tee /tmp/canary-${ITER}-bridge.log &
npx wrangler tail frozen-bella-natural-brain --format=json 2>&1 | tee /tmp/canary-${ITER}-brain.log &
npx wrangler tail frozen-bella-natural-voice --format=json 2>&1 | tee /tmp/canary-${ITER}-voice.log &
npx wrangler tail frozen-bella-natural-fast-intel --format=json 2>&1 | tee /tmp/canary-${ITER}-fastintel.log &

# Step 4: Open browser
open "http://localhost:8080/demo_v15_hybrid.html?lid=${LID}&fn=Trent"

# Step 5: After call — extract all BELLA_SAID
grep -a "BELLA_SAID" /tmp/canary-${ITER}-bridge.log
grep -a "GEMINI_TTFB" /tmp/canary-${ITER}-bridge.log
grep -a "ADVANCE\|INIT" /tmp/canary-${ITER}-bridge.log
grep -a -E "\[ERR\]|\[WARN\]" /tmp/canary-${ITER}-bridge.log

# Step 6: DO debug state
curl -s "https://frozen-bella-natural-brain.trentbelasco.workers.dev/debug?callId=${LID}" | python3 -m json.tool
```

---

## LIVE TEST RESULTS (2026-04-10)

**LID:** `anon_lkn5tnvq` (Pitcher Partners)

| Metric | Result |
|--------|--------|
| BELLA_SAID turns | 9 (full conversation) |
| WOW steps completed | 8/8 |
| Stages completed | greeting → wow → recommendation → close |
| GEMINI_TTFB | 490–702ms (all <800ms, all 200) |
| Compliance score | 1.0/1.0 |
| Zero extraction | extractedInputs all null — **OPEN BUG** |
| ERR/WARN | Zero |
| Close | 3 timeouts → call_degraded (Trent hung up) |

---

## OPEN BUGS / NEXT STEPS

### BUG 1: Zero extraction (P1)
- **Symptom:** All extractedInputs null. No EXTRACT or CAPTURED log entries. No KV `captured_inputs` key written.
- **Impact:** ROI calculation never fires. Close stage has no numbers.
- **Where to look:** Bridge extraction logic. Regex patterns not matching prospect utterances. Check `[EXTRACT]` path in bridge source.
- **Test:** Fire call, say "we get about 50 calls a week", check for `[CAPTURED]` in bridge tail.

### BUG 2: No KV_STATUS logs
- **Symptom:** Zero `[KV_STATUS]` entries in bridge log. Normally logs `fast=true/false kv_bytes=N` every turn.
- **Impact:** Can't verify intel is loading per-turn from logs. May indicate logging was removed or tag changed.
- **Where to look:** Bridge source — find the KV_STATUS log call and verify it's present.

### BUG 3: wow_2 reputation trial fires before Google data
- **Symptom:** BELLA_SAID turn 2: "Google data isn't loaded yet, so I wanted to ask, how do you manage your online reputation?"
- **Impact:** Bella explicitly mentions missing data — breaks immersion.
- **Fix:** Either wait for deep scrape (review data) before wow_2, or rewrite wow_2 to not reference missing data.

### BUG 4: Close stage delivery timeout
- **Symptom:** v2_close fires but times out 3x → call_degraded. Delivery never confirmed spoken.
- **Impact:** Call ends without clean close. May be Deepgram disconnecting before TTS finishes.
- **Note:** May be expected if prospect hangs up — need to verify with a call where Trent stays on.

---

## DEBUG COMMANDS REFERENCE

```bash
# Health checks
curl -s https://frozen-bella-natural-brain.trentbelasco.workers.dev/health
curl -s https://frozen-bella-natural-bridge.trentbelasco.workers.dev/health
curl -s https://frozen-bella-natural-fast-intel.trentbelasco.workers.dev/health

# DO debug state
curl -s "https://frozen-bella-natural-brain.trentbelasco.workers.dev/debug?callId={LID}" | python3 -m json.tool

# KV inspection
npx wrangler kv key get "lead:{LID}:fast-intel" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote | python3 -m json.tool
npx wrangler kv key get "lead:{LID}:captured_inputs" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote
npx wrangler kv key get "lead:{LID}:script_state" --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote | python3 -m json.tool

# Query shared brain D1
npx wrangler d1 execute shared-brain --remote --command "SELECT id, title FROM documents ORDER BY created_at DESC LIMIT 20"
```

---

## RESTORE FROM SCRATCH

```bash
# 1. Clone repo
git clone https://github.com/trentb-ai/bella-v6-sandbox-system
cd bella-v6-sandbox-system

# 2. Source is in frozen-bella-natural-stack/
# Each subfolder = one worker. Run npm install + wrangler deploy in each.

# 3. Set secrets (wrangler secret put SECRET_NAME --name worker-name)
# See SECRETS REQUIRED table above

# 4. Verify bindings deployed correctly
curl -s https://frozen-bella-natural-fast-intel.trentbelasco.workers.dev/fast-intel \
  -X POST -H "Content-Type: application/json" \
  -d '{"lid":"test-001","websiteUrl":"https://pitcher.com.au","firstName":"Test","email":"t@t.com"}'
# Expect: {"ok":true,...} — NOT "error code: 1101"

# 5. Start local frontend
cd /tmp && cp -r /path/to/netlify-funnel-bella-natural-v1 bella-test
cd bella-test && python3 -m http.server 8080
```

---

## LAWS — NEVER BREAK

1. Bella = inbound website agent. Never cold-call framing.
2. Bella never asks "what does your business do?" — she scraped it already.
3. Never touch `personalisedaidemofinal` any version. Completely off limits.
4. Never touch frozen V6/V7 workers.
5. Service binding fix: ALWAYS `wrangler deploy` from source — never secret-only update.
6. All bindings must be verified after every deploy with a live fast-intel POST test.

---

## SHARED BRAIN D1 — KEY DOCS

Query with: `npx wrangler d1 execute shared-brain --remote --command "SELECT id, title FROM documents WHERE id LIKE 'doc-bella%' ORDER BY created_at DESC LIMIT 30"`

Key doc IDs:
- `doc-charlie-team-framework-20260406` — team structure
- `doc-bella-v3-chunk12b-execution-plan-20260407` — V3 build plan (on hold)
- `doc-skill-eval-bella-v2-rescript-20260401` — 58-assertion eval harness
- `doc-kb-architecture-full-spec-20260331` — full architecture spec

---

## TEAM STRUCTURE (Charlie Team)

| Terminal | Model | Role |
|----------|-------|------|
| T1 | Opus | Orchestrator — no code, no data |
| T2 | Sonnet | Code/Architecture Lead — specs, 6-gate reviews |
| T3 | Codex | Judge — only agent who can PASS/FAIL |
| T4 | Sonnet | Minion A — heavy execution, deploys |
| T5 | Haiku | Minion B — raw command execution only, no diagnosis |
| T6 | Librarian | Data lookups — all D1/KV queries |

Launch: `CharlieTeam` alias in ~/.zshrc
Peers broker: localhost:7899 | CLI: `bun ~/claude-peers-mcp/cli.ts`
