#!/bin/zsh
# tail-all.sh — tail logs for all Bella V6 sandbox workers simultaneously
# Usage: ./tail-all.sh
# Each worker streams in its own tab via osascript

WORKERS=(
  "fast-intel-sandbox"
  "deepgram-bridge-sandbox-v9"
  "bella-voice-agent-sandbox-v9"
  "personalisedaidemofinal-sandbox"
  "deep-scrape-workflow-sandbox"
  "consultant-sandbox-v9"
)

BASE="/Users/trentbelasco/Desktop/BELLA_v9_SANDBOX_COMPLETE_SYSTEM"

echo "Starting tail logs for ${#WORKERS[@]} workers..."

for WORKER in "${WORKERS[@]}"; do
  # Find the worker directory
  if [[ -d "$BASE/${WORKER}" ]]; then
    WDIR="$BASE/${WORKER}"
  elif [[ -d "$BASE/workers-sandbox" ]]; then
    WDIR="$BASE/workers-sandbox"
  else
    WDIR="$BASE"
  fi

  osascript <<EOF
tell application "Terminal"
  activate
  set newTab to do script "echo '=== TAIL: ${WORKER} ===' && cd '${WDIR}' && npx wrangler tail ${WORKER} --format pretty 2>&1"
end tell
EOF

  sleep 0.5
done

echo "All tail logs launched in Terminal tabs."
