#!/bin/bash
# ═══════════════════════════════════════════════════════
#  BELLA V8 — LIVE MONITOR
#  Run this in CC during a test call.
#  Surfaces: KV status, prompt size, what Bella said,
#            stage advances, extractions, errors.
# ═══════════════════════════════════════════════════════

WORKER="${1:-deepgram-bridge-sandbox-v9}"
echo ""
echo "🔍 Monitoring: $WORKER"
echo "   Filtering: KV_STATUS | PROMPT | BELLA_SAID | ADVANCE | CAPTURED | EXTRACT | WARN | ERR"
echo "   Ctrl+C to stop"
echo "═══════════════════════════════════════════════════"
echo ""

npx wrangler tail "$WORKER" --format pretty 2>&1 | grep --line-buffered -E \
  "\[KV_STATUS\]|\[PROMPT\]|\[BELLA_SAID\]|\[ADVANCE\]|\[CAPTURED\]|\[EXTRACT\]|\[WARN\]|\[ERR\]|\[INIT\]|\[REQ\]|\[GEMINI_TTFB\]|ERROR|error"
