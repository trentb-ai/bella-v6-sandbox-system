# BELLA GOLDEN OPEN SOURCE V1 — Restore Point

## Tag
bella-golden-open-source-v1

## Commit
640c9f2 (pre-rollback HEAD — contains all work up to 2026-04-09 before reset to Golden)

## Git Remote
github.com/trentb-ai/bella-v6-sandbox-system (PRIVATE)

## What Is This
The canonical save point for Bella Golden Open Source V1. Tagged before rolling main back to bella-golden-v1 (8e23c66). Contains all Golden worker source code + v6.32.13-v6.32.15 bridge work + updated team prompts.

## Golden Stack (what runs when deployed from this tag)
| Worker | Version | Folder | Deploys As |
|--------|---------|--------|------------|
| Brain | v6.16.1 | brain-v2-rescript/ | call-brain-do-v2-rescript |
| Bridge | v9.40.0 | bridge-v2-rescript/ | deepgram-bridge-v2-rescript |
| Fast-intel | v1.18.0 | fast-intel-v9-rescript/ | fast-intel-v9-rescript |
| Scrape | v1.7.0 | bella-scrape-workflow-v10-rescript/ | bella-scrape-workflow-v10-rescript |

## Restore From This Tag
```bash
git checkout bella-golden-open-source-v1
cd brain-v2-rescript && npx wrangler deploy
cd ../bridge-v2-rescript && npx wrangler deploy
cd ../fast-intel-v9-rescript && npx wrangler deploy
cd ../bella-scrape-workflow-v10-rescript && npx wrangler deploy
```

## Secrets Required (not in repo)
- GEMINI_API_KEY → brain, bridge, fast-intel
- DEEPGRAM_API_KEY → voice-agent
- FIRECRAWL_API_KEY → fast-intel
- APIFY_API_KEY → deep-scrape, personalisedaidemofinal
- SCRAPINGBEE_KEY → personalisedaidemofinal
- BUILTWITH_API_KEY → personalisedaidemofinal
- GOOGLE_PLACES_API_KEY → personalisedaidemofinal
- SCRAPINGANT_KEY → fast-intel

## KV Namespace
leads-kv ID 0fec6982d8644118aba1830afd4a58cb (Trent CF account — new deployments need own namespace)

## Canary Result (2026-04-09)
25/25 automated assertions PASS. GEMINI_TTFB 1.2-1.8s. All 5 workers healthy.
14 assertions pending real voice call.
FLAG: WOW2 "3.5 stars from 17 reviews" — google_rating null in KV, investigating.

## Created
2026-04-09 by T1 post-rollback
