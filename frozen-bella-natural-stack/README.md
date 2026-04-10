# BELLA GOLDEN V1 — KNOWN-GOOD RESTORE POINT

**Backup Date:** 2026-04-03  
**Git Tag:** `bella-golden-v1` | **Commit:** `8e23c66`

## What This Is

A complete local backup of all Bella v2-rescript worker code at a known-good point. All workers tested and operational.

## Worker Versions

| Worker | Version | Folder | Deployed As |
|--------|---------|--------|------------|
| Brain | v6.16.1 | `brain-v2-rescript/` | `call-brain-do-v2-rescript` |
| Bridge | v9.40.0 | `bridge-v2-rescript/` | `deepgram-bridge-v2-rescript` |
| Fast-intel | v1.18.0 | `fast-intel-v9-rescript/` | `fast-intel-v9-rescript` |
| Scrape | v1.7.0 | `bella-scrape-workflow-v10-rescript/` | `bella-scrape-workflow-v10-rescript` |
| Voice-agent | v4.2.0-EOT-INJECT | `bella-voice-agent-v2-rescript/` | `bella-voice-agent-v2-rescript` |
| Consultant | synced (v8=v9) | `bella-consultant/` | `consultant-v10` |
| Tools | — | `bella-tools-worker/` | `bella-tools-worker-v8` |

## How to Restore

From the root of this directory:

```bash
cd brain-v2-rescript && npx wrangler deploy
cd ../bridge-v2-rescript && npx wrangler deploy
cd ../fast-intel-v9-rescript && npx wrangler deploy
cd ../bella-scrape-workflow-v10-rescript && npx wrangler deploy
cd ../bella-voice-agent-v2-rescript && npx wrangler deploy
cd ../bella-consultant && npx wrangler deploy
cd ../bella-tools-worker && npx wrangler deploy
```

## Live Test Result

- **Test Date:** 2026-04-03
- **Stages Completed:** 10/10 (WOW1, WOW2, WOW3, WOW4, WOW5, WOW6, WOW7, WOW8, Recommendation, Close)
- **Compliance Score:** 1.00 (all stages)
- **Errors:** Zero
- **Status:** ✅ PRODUCTION READY

## Contents

```
BELLA_GOLDEN_V1/
├── brain-v2-rescript/           (Brain DO state machine)
├── bridge-v2-rescript/          (Deepgram bridge + Gemini)
├── fast-intel-v9-rescript/      (Phase A scraper + Consultant)
├── bella-scrape-workflow-v10-rescript/  (Deep scrape workflow)
├── bella-voice-agent-v2-rescript/      (WebSocket agent)
├── bella-consultant/             (ROI analysis + script fills)
├── bella-tools-worker/           (Tool handler)
└── README.md                      (this file)
```

## Notes

- All workers deploy to their respective Cloudflare Worker names as listed above
- KV namespace is shared: `0fec6982d8644118aba1830afd4a58cb`
- Service bindings configured in each worker's wrangler.toml
- Durable Object bindings active for Brain and Voice-agent
- All secrets must be re-added after deploy: GEMINI_API_KEY, DEEPGRAM_API_KEY, APIFY_API_KEY, etc.

---

**Created:** 2026-04-03 by Terminal 3 (Claude Code)
