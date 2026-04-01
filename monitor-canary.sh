#!/bin/bash
# BELLA V1 CANARY MONITOR
# Tails deepgram-bridge-v11 with filtered output for key signals

echo "🔬 BELLA V1 CANARY MONITOR"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Watching for:"
echo "  • Stage transitions [ADVANCE]"
echo "  • Data flow [KV_STATUS]"
echo "  • What Bella says [BELLA_SAID]"
echo "  • Extraction [EXTRACT] [CAPTURED]"
echo "  • Latency [GEMINI_TTFB]"
echo "  • Prompt size [PROMPT]"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "🚨 CRITICAL: Watch for forbidden stages:"
echo "   anchor_acv | anchor_timeframe | roi_delivery"
echo ""
echo "⏸️  Press Ctrl+C to stop"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

LOGFILE="logs/canary-$(date +%Y%m%d-%H%M%S).log"

npx wrangler tail deepgram-bridge-v11 --format pretty 2>&1 | tee "$LOGFILE" | grep --line-buffered -E "\[REQ\]|\[KV_STATUS\]|\[INIT\]|\[ADVANCE\]|\[EXTRACT\]|\[CAPTURED\]|\[BELLA_SAID\]|\[GEMINI_TTFB\]|\[PROMPT\]|\[QUEUE_V2\]|anchor_acv|anchor_timeframe|roi_delivery|ERROR|WARN"
