#!/bin/bash
FROZEN=("call-brain-do" "deepgram-bridge-v11" "bella-voice-agent-v11" "fast-intel-v8")
TARGET=$(grep "^name" wrangler.toml | head -1 | sed 's/name = "\(.*\)"/\1/' | tr -d ' ')
for f in "${FROZEN[@]}"; do
  if [ "$TARGET" = "$f" ]; then
    echo "⛔ DEPLOY BLOCKED: $TARGET is a frozen Cleanest Bella worker. Use -v1-launch or -roi-wip copy."
    exit 1
  fi
done
echo "✅ $TARGET is not frozen. Deploying..."
npx wrangler deploy "$@"
