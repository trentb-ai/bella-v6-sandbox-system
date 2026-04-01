#!/usr/bin/env bash
# smoke-test.sh — HTTP contract tests for deployed call-brain-do worker
#
# Usage: bash scripts/smoke-test.sh [BASE_URL]
#
# Default URL derived from wrangler.toml worker name:
#   https://{name}.trentbelasco.workers.dev
# This is the standard Cloudflare Workers subdomain pattern used by this project.
# Override by passing a URL argument for custom domains or local dev.
#
# All request payloads and response assertions are derived from
# call-brain-do/src/index.ts handler code — not hardcoded assumptions.
set -euo pipefail

# ── Clean up stale temp files from prior runs ──
rm -f /tmp/smoke_health.json /tmp/smoke_init.json /tmp/smoke_state.json \
      /tmp/smoke_turn.json /tmp/smoke_dedup.json

# ── Derive default URL from wrangler.toml ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -n "${1:-}" ]]; then
  BASE_URL="$1"
else
  WORKER_NAME=$(grep '^name' "$PROJECT_DIR/wrangler.toml" | head -1 | sed 's/.*= *"\(.*\)"/\1/')
  BASE_URL="https://${WORKER_NAME}.trentbelasco.workers.dev"
fi

CALL_ID="smoke-$(date +%s)"
TURN_ID="turn-$(date +%s)-001"

passed=0
failed=0

pass() { echo "  PASS: $1"; passed=$((passed + 1)); }
fail() {
  echo "  FAIL: $1"
  if [[ -n "${2:-}" ]]; then
    echo "  Response: $2"
  fi
  failed=$((failed + 1))
}

echo "smoke-test.sh"
echo "  url:     $BASE_URL"
echo "  callId:  $CALL_ID"
echo "  turnId:  $TURN_ID"
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 1: GET /health
# Handler: worker entrypoint line 1025
# Response: { status: "ok", version: VERSION, worker: "call-brain-do" }
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 1: GET /health ──"

HTTP_CODE=$(curl -s -o /tmp/smoke_health.json -w "%{http_code}" "$BASE_URL/health")
BODY=$(cat /tmp/smoke_health.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (expected 200)" "$BODY"
fi

if echo "$BODY" | grep -q '"status":"ok"'; then
  pass "status=ok"
else
  fail "status=ok missing" "$BODY"
fi

if echo "$BODY" | grep -q '"worker":"call-brain-do"'; then
  pass "worker=call-brain-do"
else
  fail "worker field missing" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 2: POST /event (session_init)
# Handler: handleEvent line 714, case 'session_init' line 715
# Request: BrainEvent { type, leadId, starterIntel? }
# callId routing: x-call-id header (line 1029)
# starterIntel.core_identity populates identity fields (ensureSession line 409-412)
# Response: { status, callId, leadId, packet, stage, wowStall }
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 2: POST /event (session_init) ──"

HTTP_CODE=$(curl -s -o /tmp/smoke_init.json -w "%{http_code}" \
  -X POST "$BASE_URL/event" \
  -H "Content-Type: application/json" \
  -H "x-call-id: $CALL_ID" \
  -d '{
    "type": "session_init",
    "leadId": "smoke-test-lead",
    "starterIntel": {
      "core_identity": {
        "first_name": "SmokeTest",
        "business_name": "Smoke Corp",
        "industry": "testing"
      }
    }
  }')
BODY=$(cat /tmp/smoke_init.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (expected 200)" "$BODY"
fi

# Response field: status (line 725 — "initialized" or "existing")
if echo "$BODY" | grep -q '"status"'; then
  pass "status field present"
else
  fail "status field missing" "$BODY"
fi

# Response field: packet (line 728)
if echo "$BODY" | grep -q '"packet"'; then
  pass "packet field present"
else
  fail "packet field missing" "$BODY"
fi

# Response field: stage (line 729)
if echo "$BODY" | grep -q '"stage"'; then
  pass "stage field present"
else
  fail "stage field missing" "$BODY"
fi

# Packet sub-field: chosenMove (directiveToPacket line 334)
if echo "$BODY" | grep -q '"chosenMove"'; then
  pass "packet.chosenMove present"
else
  fail "packet.chosenMove missing" "$BODY"
fi

# Packet sub-field: chosenMove.text (directiveToPacket line 337)
if echo "$BODY" | grep -q '"text"'; then
  pass "packet.chosenMove.text present"
else
  fail "packet.chosenMove.text missing" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 3: GET /state
# Handler: handleGetState line 940
# Response: full ConversationState or { error: "no_session" } 404
# V2 state markers: currentStage, memoryNotes, transcriptLog (from types.ts)
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 3: GET /state ──"

HTTP_CODE=$(curl -s -o /tmp/smoke_state.json -w "%{http_code}" \
  "$BASE_URL/state?callId=$CALL_ID")
BODY=$(cat /tmp/smoke_state.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (expected 200)" "$BODY"
fi

# V2 state marker: currentStage
if echo "$BODY" | grep -q '"currentStage"'; then
  pass "currentStage present"
else
  fail "currentStage missing" "$BODY"
fi

# V2 state marker: memoryNotes
if echo "$BODY" | grep -q '"memoryNotes"'; then
  pass "memoryNotes present"
else
  fail "memoryNotes missing" "$BODY"
fi

# V2 state marker: transcriptLog
if echo "$BODY" | grep -q '"transcriptLog"'; then
  pass "transcriptLog present"
else
  fail "transcriptLog missing" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 4: POST /turn (first turn)
# Handler: handleTurn line 447
# Request: { leadId?, transcript, turnId, ts? } (line 448-453)
# callId routing: x-call-id header (line 1029)
# Response: { packet, extraction, extractedState, advanced, stage, wowStall, dedup: false } (lines 689-706)
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 4: POST /turn (first turn) ──"

HTTP_CODE=$(curl -s -o /tmp/smoke_turn.json -w "%{http_code}" \
  -X POST "$BASE_URL/turn" \
  -H "Content-Type: application/json" \
  -H "x-call-id: $CALL_ID" \
  -d "{
    \"transcript\": \"Hello, yes I am here\",
    \"turnId\": \"$TURN_ID\",
    \"leadId\": \"smoke-test-lead\"
  }")
BODY=$(cat /tmp/smoke_turn.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (expected 200)" "$BODY"
fi

# Response field: packet (line 690)
if echo "$BODY" | grep -q '"packet"'; then
  pass "packet field present"
else
  fail "packet field missing" "$BODY"
fi

# Response field: stage (line 698)
if echo "$BODY" | grep -q '"stage"'; then
  pass "stage field present"
else
  fail "stage field missing" "$BODY"
fi

# Packet sub-field: chosenMove (directiveToPacket line 334)
if echo "$BODY" | grep -q '"chosenMove"'; then
  pass "packet.chosenMove present"
else
  fail "packet.chosenMove missing" "$BODY"
fi

# Packet sub-field: chosenMove.text (directiveToPacket line 337)
if echo "$BODY" | grep -q '"text"'; then
  pass "packet.chosenMove.text present"
else
  fail "packet.chosenMove.text missing" "$BODY"
fi

# Packet sub-field: objective (directiveToPacket line 333)
if echo "$BODY" | grep -q '"objective"'; then
  pass "packet.objective present"
else
  fail "packet.objective missing" "$BODY"
fi

# Response field: dedup (line 706 — false on first call)
if echo "$BODY" | grep -q '"dedup":false'; then
  pass "dedup=false (first call)"
else
  fail "dedup=false missing" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 5: POST /turn (dedup — same turnId + transcript)
# Handler: handleTurn lines 463-467
# Dedup: cacheKey = turn:{turnId}:{sha256(transcript)} — returns cached + dedup:true
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 5: POST /turn (dedup) ──"

HTTP_CODE=$(curl -s -o /tmp/smoke_dedup.json -w "%{http_code}" \
  -X POST "$BASE_URL/turn" \
  -H "Content-Type: application/json" \
  -H "x-call-id: $CALL_ID" \
  -d "{
    \"transcript\": \"Hello, yes I am here\",
    \"turnId\": \"$TURN_ID\",
    \"leadId\": \"smoke-test-lead\"
  }")
BODY=$(cat /tmp/smoke_dedup.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (expected 200)" "$BODY"
fi

# Dedup indicator: dedup:true (line 466)
if echo "$BODY" | grep -q '"dedup":true'; then
  pass "dedup=true (cached response)"
else
  fail "dedup=true missing — dedup not working" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 6: GET /debug — flow harness inspection
# Handler: handleDebug line 1210
# Requires active session (from Test 2 session_init)
# Response: { version, callId, currentStage, pendingDelivery, flowLogCount, flowLog, ... }
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 6: GET /debug (flow harness state) ──"

HTTP_CODE=$(curl -s -o /tmp/smoke_debug.json -w "%{http_code}" \
  "$BASE_URL/debug?callId=$CALL_ID" \
  -H "x-call-id: $CALL_ID")
BODY=$(cat /tmp/smoke_debug.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (expected 200)" "$BODY"
fi

# Flow harness fields
if echo "$BODY" | grep -q '"pendingDelivery"'; then
  pass "pendingDelivery field present"
else
  fail "pendingDelivery field missing" "$BODY"
fi

if echo "$BODY" | grep -q '"flowLogCount"'; then
  pass "flowLogCount field present"
else
  fail "flowLogCount field missing" "$BODY"
fi

if echo "$BODY" | grep -q '"flowLog"'; then
  pass "flowLog field present"
else
  fail "flowLog field missing" "$BODY"
fi

if echo "$BODY" | grep -q '"completedStages"'; then
  pass "completedStages field present"
else
  fail "completedStages field missing" "$BODY"
fi

if echo "$BODY" | grep -q '"version"'; then
  pass "version field present"
else
  fail "version field missing" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 7: GET /debug — no session returns 404
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 7: GET /debug (no session) ──"

NOSESS_ID="no-session-$(date +%s)"
HTTP_CODE=$(curl -s -o /tmp/smoke_debug_nosess.json -w "%{http_code}" \
  "$BASE_URL/debug?callId=$NOSESS_ID" \
  -H "x-call-id: $NOSESS_ID")
BODY=$(cat /tmp/smoke_debug_nosess.json)

if [[ "$HTTP_CODE" == "404" ]]; then
  pass "HTTP 404 (no session)"
else
  fail "HTTP $HTTP_CODE (expected 404)" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 8: POST /event (delivery_barged_in — stale event, no matching delivery)
# Handler: handleEvent case 'delivery_barged_in' line 836
# Response: { status: 'stale', resolution: 'barged_in' }
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 8: POST /event (delivery_barged_in — stale) ──"

HTTP_CODE=$(curl -s -o /tmp/smoke_barged.json -w "%{http_code}" \
  -X POST "$BASE_URL/event" \
  -H "Content-Type: application/json" \
  -H "x-call-id: $CALL_ID" \
  -d '{
    "type": "delivery_barged_in",
    "deliveryId": "nonexistent_delivery",
    "moveId": "nonexistent_move",
    "ts": "2026-03-25T00:00:00Z"
  }')
BODY=$(cat /tmp/smoke_barged.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (expected 200)" "$BODY"
fi

if echo "$BODY" | grep -q '"status"'; then
  pass "status field present"
else
  fail "status field missing" "$BODY"
fi

# Should be stale since deliveryId won't match any pending
if echo "$BODY" | grep -q '"stale"'; then
  pass "status=stale (no matching delivery)"
else
  fail "expected status=stale" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 9: POST /event (delivery_failed — stale event, no matching delivery)
# Handler: handleEvent case 'delivery_failed' line 851
# Response: { status: 'stale', resolution: 'failed' }
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 9: POST /event (delivery_failed — stale) ──"

HTTP_CODE=$(curl -s -o /tmp/smoke_failed.json -w "%{http_code}" \
  -X POST "$BASE_URL/event" \
  -H "Content-Type: application/json" \
  -H "x-call-id: $CALL_ID" \
  -d '{
    "type": "delivery_failed",
    "deliveryId": "nonexistent_delivery",
    "moveId": "nonexistent_move",
    "errorCode": "SMOKE_TEST",
    "ts": "2026-03-25T00:00:00Z"
  }')
BODY=$(cat /tmp/smoke_failed.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (expected 200)" "$BODY"
fi

if echo "$BODY" | grep -q '"status"'; then
  pass "status field present"
else
  fail "status field missing" "$BODY"
fi

if echo "$BODY" | grep -q '"stale"'; then
  pass "status=stale (no matching delivery)"
else
  fail "expected status=stale" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Test 10: GET /health — verify current version
# ──────────────────────────────────────────────────────────────────────────────
echo "── Test 10: GET /health (version check) ──"

HTTP_CODE=$(curl -s -o /tmp/smoke_version.json -w "%{http_code}" "$BASE_URL/health?_=$(date +%s)")
BODY=$(cat /tmp/smoke_version.json)

if [[ "$HTTP_CODE" == "200" ]]; then
  pass "HTTP 200"
else
  fail "HTTP $HTTP_CODE (expected 200)" "$BODY"
fi

if echo "$BODY" | grep -q '"version"'; then
  pass "version field present"
  VERSION=$(echo "$BODY" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
  echo "  INFO: deployed version=$VERSION"
else
  fail "version field missing" "$BODY"
fi
echo ""

# ──────────────────────────────────────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────────────────────────────────────
echo "──────────────────────────────"
echo " Smoke test: $passed passed, $failed failed"
echo "──────────────────────────────"
exit $failed
