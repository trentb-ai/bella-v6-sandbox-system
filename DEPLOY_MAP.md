# BELLA DEPLOY MAP — CANONICAL REFERENCE
# Last updated: 2026-03-27

## ⚠️ CRITICAL: Read before deploying ANYTHING

Some workers require `--name` overrides because their wrangler.toml name
doesn't match the deployed Cloudflare worker name. Running a bare
`npx wrangler deploy` from the wrong directory WILL create ghost workers
or overwrite the wrong thing.

---

## V11 VOICE PIPELINE (primary)

| Source Directory | Deploy Command | Deployed As |
|---|---|---|
| `voice-agent-v11/` | `npx wrangler deploy` | `bella-voice-agent-v11` |
| `deepgram-bridge-v11/` | `npx wrangler deploy` | `deepgram-bridge-v11` |
| `call-brain-do/` | `npx wrangler deploy` | `call-brain-do` |
| `bella-tools-worker-v9/` | `npx wrangler deploy` | `bella-tools-worker-v8` |

## V8 SCRAPE PIPELINE

| Source Directory | Deploy Command | Deployed As |
|---|---|---|
| `fast-intel-sandbox-v9/` | `npx wrangler deploy` | `fast-intel-v8` |
| `consultant-v9/` | `npx wrangler deploy --name consultant-v8` | `consultant-v8` ⚠️ |
| `consultant-v9/` | `npx wrangler deploy` | `consultant-v9` |
| `deep-scrape-workflow-sandbox-v9/` | `npx wrangler deploy` | `deep-scrape-workflow-v9` |
| `bella-scrape-workflow-v9/` | `npx wrangler deploy` | `bella-scrape-workflow-v9-test` |
| `workers-sandbox-v9/` | `npx wrangler deploy` | `personalisedaidemofinal-v9` ❓ |
| `mcp-worker-v9/` | `npx wrangler deploy` | `leads-mcp-worker-v9` |

### ⚠️ CONSULTANT OVERRIDE
`fast-intel-v8` binds CONSULTANT → `consultant-v8`.
The source dir `consultant-v9/` wrangler.toml says `name = "consultant-v9"`.
To update the one fast-intel uses, you MUST: `npx wrangler deploy --name consultant-v8`
A bare deploy updates `consultant-v9` (separate worker, also exists).

### ❓ BIG SCRAPER NOTE
`fast-intel-v8` binds BIG_SCRAPER → `personalisedaidemofinal-sandbox`.
The `workers-sandbox-v9/` wrangler.toml says `name = "personalisedaidemofinal-v9"`.
These are DIFFERENT workers. Do NOT touch unless you know exactly what you're doing.

---

## SERVICE BINDING CHAIN

```
V11 Voice Pipeline:
  bella-voice-agent-v11 → TOOLS → bella-tools-worker-v8
  deepgram-bridge-v11   → TOOLS → bella-tools-worker-v8
  deepgram-bridge-v11   → CALL_BRAIN → call-brain-do

V8 Scrape Pipeline:
  fast-intel-v8 → CONSULTANT → consultant-v8
  fast-intel-v8 → DEEP_SCRAPE → deep-scrape-workflow-v9
  fast-intel-v8 → BIG_SCRAPER → personalisedaidemofinal-sandbox
  fast-intel-v8 → CALL_BRAIN → call-brain-do
```

## ARCHIVED / DO NOT DEPLOY

| Directory | Status | Why |
|---|---|---|
| `_ARCHIVED_voice-agent-source-sandbox-v9/` | DEAD | All 4 bindings point to non-existent workers |
| `BELLA_V9/_ARCHIVED_scrape-workflow/` | DEAD | Completely different codebase from V1.0 |
| `BELLA_V9_BACKUP_2026-03-16_1308_DANGEROUS_DO_NOT_DEPLOY/` | STALE | fast-intel 8 versions behind |
| `BELLA_V9_BACKUP_2026-03-17_1817_DANGEROUS_DO_NOT_DEPLOY/` | STALE | Contains known bugs |
| `BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM_BACKUP/` | STALE | Consultant uses dead Gemini model, deep-scrape has Apify 404 bug |

## DELETED WORKERS

| Worker | Deleted | Why |
|---|---|---|
| `deep-scrape-workflow-v8` | 2026-03-27 | Zombie: zero secrets, zero bindings, replaced by v9 |
