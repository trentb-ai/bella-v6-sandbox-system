#!/bin/zsh
# ═══════════════════════════════════════════════════════════
#  BELLA V6 SMOKE TEST — UNIFIED LOG MONITOR
#  Streams all 4 workers to one terminal with colour labels
# ═══════════════════════════════════════════════════════════

BOLD='\033[1m'
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
BLUE='\033[0;34m'
RESET='\033[0m'

BASE="/Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM"

echo ""
echo "${BOLD}${GREEN}╔══════════════════════════════════════════════════════╗${RESET}"
echo "${BOLD}${GREEN}║      BELLA V6 SMOKE TEST - LIVE LOG MONITOR          ║${RESET}"
echo "${BOLD}${GREEN}║  fast-intel | bridge | voice-agent | consultant       ║${RESET}"
echo "${BOLD}${GREEN}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""

# Named pipe approach — fan-in all 4 tails into one stream with labels
(
  cd "$BASE/fast-intel-sandbox"
  npx wrangler tail --format pretty 2>&1 | while IFS= read -r line; do
    echo "${CYAN}[FAST-INTEL]${RESET} $line"
  done
) &
PID1=$!

(
  cd "$BASE/deepgram-bridge-v9"
  npx wrangler tail --format pretty 2>&1 | while IFS= read -r line; do
    echo "${MAGENTA}[BRIDGE]${RESET}     $line"
  done
) &
PID2=$!

(
  cd "$BASE/voice-agent-v9"
  npx wrangler tail --format pretty 2>&1 | while IFS= read -r line; do
    echo "${YELLOW}[VOICE-AGENT]${RESET} $line"
  done
) &
PID3=$!

(
  cd "$BASE/consultant-v9"
  npx wrangler tail --format pretty 2>&1 | while IFS= read -r line; do
    echo "${GREEN}[CONSULTANT]${RESET} $line"
  done
) &
PID4=$!

echo "${BOLD}Tailing workers (PIDs: $PID1 $PID2 $PID3 $PID4)${RESET}"
echo "${BOLD}Press Ctrl+C to stop all tails${RESET}"
echo "─────────────────────────────────────────────────────"

# Trap Ctrl+C → kill all child tails cleanly
trap "kill $PID1 $PID2 $PID3 $PID4 2>/dev/null; echo '\n${RED}Tails stopped.${RESET}'; exit 0" INT

wait
