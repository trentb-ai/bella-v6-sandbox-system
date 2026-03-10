#!/bin/zsh
# tail-bella.sh — focused tail for the 3 workers involved in a live call
# bridge + voice-agent + fast-intel
# Usage: ./tail-bella.sh

BASE="/Users/trentbelasco/Desktop/BELLA_V6_SANDBOX_COMPLETE_SYSTEM"

declare -A WORKER_DIRS=(
  ["fast-intel-sandbox"]="$BASE/fast-intel-sandbox"
  ["deepgram-bridge-sandbox-v6"]="$BASE/deepgram-bridge-v6"
  ["bella-voice-agent-sandbox-v6"]="$BASE/voice-agent-v6"
)

for WORKER in fast-intel-sandbox deepgram-bridge-sandbox-v6 bella-voice-agent-sandbox-v6; do
  WDIR="${WORKER_DIRS[$WORKER]}"
  osascript <<EOF
tell application "Terminal"
  activate
  set newTab to do script "echo '=== ${WORKER} ===' && cd '${WDIR}' && npx wrangler tail ${WORKER} --format pretty 2>&1"
end tell
EOF
  sleep 0.4
done

echo "Tail logs open for: fast-intel | bridge | voice-agent"
