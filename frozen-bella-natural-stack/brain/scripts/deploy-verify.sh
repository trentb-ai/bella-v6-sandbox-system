#!/usr/bin/env bash
# deploy-verify.sh — compile, test, deploy, and verify call-brain-do
# Usage: bash scripts/deploy-verify.sh [--dry-run]
set -euo pipefail

# ── Derive paths ──
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── Config from wrangler.toml ──
WORKER_NAME=$(grep '^name' wrangler.toml | head -1 | sed 's/.*= *"\(.*\)"/\1/')
BASE_URL="https://${WORKER_NAME}.trentbelasco.workers.dev"
EXPECTED_VERSION="v3.0.0-bella-v2"

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

passed=0
failed=0

pass() { echo "  PASS: $1"; passed=$((passed + 1)); }
fail() { echo "  FAIL: $1"; failed=$((failed + 1)); }

echo "========================================"
echo " call-brain-do deploy-verify"
echo " worker:  $WORKER_NAME"
echo " url:     $BASE_URL"
echo " version: $EXPECTED_VERSION"
echo " dry-run: $DRY_RUN"
echo "========================================"
echo ""

# ── Step 1: TypeScript compile check ──
echo "── Step 1: TypeScript compile check ──"
if npx tsc --noEmit; then
  pass "tsc --noEmit"
else
  fail "tsc --noEmit"
  echo "Compile errors detected — aborting."
  exit 1
fi
echo ""

# ── Step 2: Unit tests ──
echo "── Step 2: Unit tests ──"
if CI=true npx vitest run; then
  pass "vitest run"
else
  fail "vitest run"
  echo "Test failures detected — aborting."
  exit 1
fi
echo ""

# ── Step 3: Wrangler dry run ──
echo "── Step 3: Wrangler dry run ──"
if npx wrangler deploy --dry-run --config wrangler.toml 2>&1; then
  pass "wrangler deploy --dry-run"
else
  fail "wrangler deploy --dry-run"
  echo "Dry run failed — aborting."
  exit 1
fi
echo ""

if $DRY_RUN; then
  echo "── Dry run mode — stopping before actual deploy ──"
  echo ""
  echo "Results: $passed passed, $failed failed"
  exit $failed
fi

# ── Step 3.5: Auth preflight ──
echo "── Step 3.5: Auth preflight ──"
if npx wrangler whoami 2>&1 | grep -q "Account"; then
  pass "wrangler auth"
else
  fail "wrangler auth"
  echo "  Not authenticated. Run 'npx wrangler login' first."
  exit 1
fi
echo ""

# ── Step 4: Deploy ──
echo "── Step 4: Deploy ──"
if npx wrangler deploy --config wrangler.toml; then
  pass "wrangler deploy"
else
  fail "wrangler deploy"
  echo "Deploy failed — aborting."
  exit 1
fi
echo "  Waiting 2s for edge propagation..."
sleep 2
echo ""

# ── Step 5: Binding verification (informational) ──
echo "── Step 5: Binding verification (informational) ──"
echo "  Expected bindings from wrangler.toml:"
DO_BINDING=$(grep 'name = "CALL_BRAIN"' wrangler.toml && echo "  DO: CALL_BRAIN -> CallBrainDO" || echo "  DO: not found")
echo "$DO_BINDING"
KV_BINDING=$(grep 'binding = "LEADS_KV"' wrangler.toml && echo "  KV: LEADS_KV -> $(grep '^id' wrangler.toml | tail -1 | sed 's/.*= *"\(.*\)"/\1/')" || echo "  KV: not found")
echo "$KV_BINDING"
echo ""

# ── Step 6: Health check (retry with backoff) ──
echo "── Step 6: Health check ──"
HEALTH_OK=false
HEALTH_RESPONSE=""
for attempt in 1 2 3 4 5; do
  HEALTH_RESPONSE=$(curl -sf "$BASE_URL/health" 2>&1) || HEALTH_RESPONSE=""
  if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"' && \
     echo "$HEALTH_RESPONSE" | grep -q "$EXPECTED_VERSION"; then
    HEALTH_OK=true
    break
  fi
  echo "  Attempt $attempt/5 — not ready yet, retrying in 3s..."
  sleep 3
done

if $HEALTH_OK; then
  pass "health status=ok"
  pass "health version=$EXPECTED_VERSION"
else
  fail "health check — did not get expected version after 5 attempts"
  echo "  Expected version: $EXPECTED_VERSION"
  echo "  Last response: ${HEALTH_RESPONSE:-<empty>}"
  echo ""
  echo "Results: $passed passed, $failed failed"
  exit 1
fi
echo ""

# ── Step 7: Smoke test ──
echo "── Step 7: Smoke test ──"
if bash "$SCRIPT_DIR/smoke-test.sh" "$BASE_URL"; then
  pass "smoke-test.sh"
else
  fail "smoke-test.sh"
fi
echo ""

# ── Summary ──
echo "========================================"
echo " Results: $passed passed, $failed failed"
echo "========================================"
exit $failed
