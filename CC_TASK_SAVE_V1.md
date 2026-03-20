# CC TASK: Save Current System as V1.0

## What to do

1. First, update `.gitignore` to exclude:
   - `logs/`
   - `node_modules/`
   - `.wrangler/`
   - `.DS_Store`
   - `install-bella-skills.sh`

2. Then `git add` ONLY the actual system files — the workers that are currently deployed and working:
   - `deepgram-bridge-v9/src/` (bridge v9.13.2)
   - `fast-intel-sandbox-v9/src/` (fast-intel v1.8.0)
   - `voice-agent-v9/src/` (voice agent)
   - `bella-scrape-workflow-v9/src/` (workflow with all steps)
   - `consultant-v9/worker.js` (consultant)
   - `bella-tools-worker-v9/src/` (tools worker)
   - `shared/` (shared types)
   - All `wrangler.toml` files for the above workers
   - All `package.json` / `tsconfig.json` for the above workers
   - Key docs: `CLAUDE.md`, `HANDOVER_SESSION_19MAR.md`, `BUG_REPORT_v9.13.2.md`, `PHASE_1_2_EXECUTION_PLAN.md`, `DATA_ENRICHMENT_MASTER_PLAN.md`
   - `.gitignore`

3. Do NOT add:
   - `logs/` directory
   - `node_modules/`
   - `.wrangler/`
   - `.DS_Store`
   - Old/stale docs (PERPLEXITY_*, SCORING_FIX, V1_UPGRADE_BRIEF, etc.)
   - `install-bella-skills.sh`
   - `voice-agent-source-sandbox-v9/` (if it's a duplicate)
   - `workers-sandbox-v9/` (old sandbox files)
   - `netlify-funnel-sandbox-v9/` (frontend, not backend workers)
   - `workflows-dashboard*/` (dashboard, separate concern)
   - `workflows-test/` (test scaffolding)
   - `temp-deploy-bella-v9/` (temp files)

4. Commit message:
```
V1.0 — Bella V9 baseline before DO brain migration

Deployed workers:
- Bridge v9.13.2 (deepgram-bridge-sandbox-v8)
- Fast-intel v1.8.0 (fast-intel-v8)  
- Voice agent v4.0.2-SUPERGOD (bella-voice-agent-sandbox-v8)
- Workflow (bella-scrape-workflow-v9-test)
- Consultant (consultant-v8 + v9)

Working: dedup, fast consultant, parallel scrape, Google Places safety net,
Apify retry, landing page scraping, adsOn fix, spoken number normalization

Known issues saved for DO brain migration:
- Extraction cascading, ROI not delivered, repeated questions
- firstName not reaching voice agent DO (reqUrl=null)
- Full consultant overwriting fast consultant name
```

5. Tag it: `git tag v1.0`

6. Report back what was committed.
