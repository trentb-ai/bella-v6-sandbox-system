#!/bin/bash
set -e

BASE="$(cd "$(dirname "$0")" && pwd)"

echo "================================================"
echo " BELLA GOLDEN V2 — FROZEN DEPLOY"
echo " Deploying 7 workers to Cloudflare"
echo " These workers are FROZEN after deploy."
echo " NEVER redeploy over these names."
echo "================================================"
echo ""

# Deploy order: dependencies first
WORKERS=("brain" "consultant" "tools" "deep-scrape" "fast-intel" "bridge" "voice-agent")

for worker in "${WORKERS[@]}"; do
  echo ">>> Deploying $worker..."
  cd "$BASE/$worker"
  npx wrangler deploy
  echo ">>> $worker DONE"
  echo ""
done

echo "================================================"
echo " ALL 7 WORKERS DEPLOYED"
echo ""
echo " Now re-add secrets for each worker:"
echo ""
echo " cd brain        && npx wrangler secret put DEEPGRAM_API_KEY"
echo " cd bridge       && npx wrangler secret put GEMINI_API_KEY"
echo " cd bridge       && npx wrangler secret put TOOLS_BEARER"
echo " cd fast-intel   && npx wrangler secret put GEMINI_API_KEY"
echo " cd fast-intel   && npx wrangler secret put FIRECRAWL_API_KEY"
echo " cd deep-scrape  && npx wrangler secret put APIFY_TOKEN"
echo " cd deep-scrape  && npx wrangler secret put FIRECRAWL_KEY"
echo " cd deep-scrape  && npx wrangler secret put GEMINI_API_KEY"
echo " cd consultant   && npx wrangler secret put GEMINI_API_KEY"
echo " cd tools        && npx wrangler secret put BEARER_TOKEN"
echo " cd voice-agent  && npx wrangler secret put TOOLS_BEARER_TOKEN"
echo "================================================"
