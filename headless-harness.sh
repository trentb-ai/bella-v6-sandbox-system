#!/bin/bash
# BELLA Headless Harness — fires fast-intel, then simulates multi-turn conversation
# Captures BELLA_SAID from bridge SSE responses
# Usage: bash headless-harness.sh [website_url] [first_name]

set -euo pipefail

WEBSITE="${1:-https://www.pitcherpartners.com.au}"
FIRST_NAME="${2:-Trent}"
LID="anon_harness_$(date +%s)"

FAST_INTEL_URL="https://fast-intel-v9-rescript.trentbelasco.workers.dev"
BRIDGE_URL="https://deepgram-bridge-v2-rescript.trentbelasco.workers.dev"

echo "============================================"
echo "BELLA HEADLESS HARNESS"
echo "============================================"
echo "LID:      $LID"
echo "Website:  $WEBSITE"
echo "Name:     $FIRST_NAME"
echo "============================================"
echo ""

# ── STEP 1: Fire fast-intel ──
echo "[STEP 1] Firing fast-intel..."
FAST_RESULT=$(curl -s -X POST "$FAST_INTEL_URL/fast-intel" \
  -H "Content-Type: application/json" \
  -d "{\"lid\":\"$LID\",\"websiteUrl\":\"$WEBSITE\",\"firstName\":\"$FIRST_NAME\"}")

BIZ_NAME=$(echo "$FAST_RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('business_name','UNKNOWN'))" 2>/dev/null || echo "UNKNOWN")
echo "[STEP 1] Fast-intel done. Business: $BIZ_NAME"
echo ""

# ── STEP 2: Verify KV ──
echo "[STEP 2] Checking KV keys..."
sleep 2

# Check stage_plan exists
STAGE_PLAN=$(npx wrangler kv key get "lead:${LID}:stage_plan" \
  --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote 2>/dev/null || echo "NOT_FOUND")

if [ "$STAGE_PLAN" = "NOT_FOUND" ]; then
  echo "[STEP 2] WARNING: stage_plan NOT in KV"
else
  echo "[STEP 2] stage_plan OK: $STAGE_PLAN"
fi
echo ""

# ── STEP 3: Simulate conversation turns ──
echo "[STEP 3] Starting conversation simulation..."
echo "============================================"

SYSTEM_MSG="You are Bella, an AI sales development representative. lead_id: $LID. prospect_first_name: $FIRST_NAME. prospect_business: $BIZ_NAME."

# Prospect utterances — simulate a real call flow
TURNS=(
  "Hello?"
  "Yeah hi, who's this?"
  "Oh okay, what's this about?"
  "Yeah we've been looking at a few things actually"
  "We get about fifty leads a month, maybe sixty"
  "Probably about two hundred thousand a year per client"
  "We have someone on the phones but they're not great honestly"
  "Yeah that sounds interesting, what would that look like?"
)

MESSAGES="[]"
BELLA_TRANSCRIPT=""
TURN_NUM=0

for UTT in "${TURNS[@]}"; do
  TURN_NUM=$((TURN_NUM + 1))
  echo ""
  echo "--- Turn $TURN_NUM ---"
  echo "PROSPECT: $UTT"

  # Add user message to history
  MESSAGES=$(echo "$MESSAGES" | python3 -c "
import sys, json
msgs = json.load(sys.stdin)
msgs.append({'role': 'user', 'content': '$UTT'})
print(json.dumps(msgs))
")

  # Build request body with system message + conversation history
  BODY=$(python3 -c "
import json
system_msg = '''$SYSTEM_MSG'''
msgs = json.loads('''$MESSAGES''')
body = {
    'messages': [{'role': 'system', 'content': system_msg}] + msgs,
    'model': 'bella',
    'stream': True
}
print(json.dumps(body))
")

  # Call bridge and capture SSE response
  RESPONSE=$(curl -s -X POST "$BRIDGE_URL/v9/chat/completions" \
    -H "Content-Type: application/json" \
    -d "$BODY" \
    --max-time 30 2>/dev/null || echo "BRIDGE_ERROR")

  # Parse SSE: extract content from data chunks
  BELLA_SAID=$(echo "$RESPONSE" | python3 -c "
import sys, json
full_text = ''
for line in sys.stdin:
    line = line.strip()
    if not line.startswith('data: ') or line == 'data: [DONE]':
        continue
    try:
        chunk = json.loads(line[6:])
        delta = chunk.get('choices', [{}])[0].get('delta', {})
        content = delta.get('content', '')
        if content:
            full_text += content
    except:
        pass
print(full_text.strip())
" 2>/dev/null || echo "[PARSE_ERROR]")

  if [ -z "$BELLA_SAID" ]; then
    echo "BELLA: [EMPTY RESPONSE]"
    BELLA_SAID="[EMPTY RESPONSE]"
  else
    echo "BELLA: $BELLA_SAID"
  fi

  # Add assistant response to history
  MESSAGES=$(echo "$MESSAGES" | python3 -c "
import sys, json
msgs = json.load(sys.stdin)
msgs.append({'role': 'assistant', 'content': '''$BELLA_SAID'''})
print(json.dumps(msgs))
")

  BELLA_TRANSCRIPT="$BELLA_TRANSCRIPT
--- Turn $TURN_NUM ---
PROSPECT: $UTT
BELLA: $BELLA_SAID
"
done

echo ""
echo "============================================"
echo "HARNESS COMPLETE"
echo "============================================"
echo "LID: $LID"
echo ""
echo "=== FULL BELLA_SAID TRANSCRIPT ==="
echo "$BELLA_TRANSCRIPT"
echo ""

# ── STEP 4: Post-call debug ──
echo "=== POST-CALL KV STATE ==="
echo ""

# Check script_state
SCRIPT_STATE=$(npx wrangler kv key get "lead:${LID}:script_state" \
  --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote 2>/dev/null || echo "NOT_FOUND")
if [ "$SCRIPT_STATE" != "NOT_FOUND" ]; then
  echo "script_state:"
  echo "$SCRIPT_STATE" | python3 -m json.tool 2>/dev/null || echo "$SCRIPT_STATE"
else
  echo "script_state: NOT_FOUND"
fi
echo ""

# Check captured_inputs
CAPTURED=$(npx wrangler kv key get "lead:${LID}:captured_inputs" \
  --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote 2>/dev/null || echo "NOT_FOUND")
if [ "$CAPTURED" != "NOT_FOUND" ]; then
  echo "captured_inputs:"
  echo "$CAPTURED" | python3 -m json.tool 2>/dev/null || echo "$CAPTURED"
else
  echo "captured_inputs: NOT_FOUND"
fi
echo ""

echo "=== BRAIN DEBUG ==="
echo "Query: curl https://bella-brain-v8.trentbelasco.workers.dev/debug?callId=$LID"
echo ""
echo "Done."
