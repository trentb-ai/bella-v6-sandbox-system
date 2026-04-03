# BELLA LIVE TEST — Full E2E Verification of v5.3.0
# Run this prompt in Claude Code

## CONTEXT

Bella Flow Harness v5.0 is deployed across call-brain-do-v2-rescript and deepgram-bridge-v2-rescript.
Five fixes were applied this session. We need a FRESH live test to verify everything works end-to-end.

## YOUR TASK — 3 PHASES

### PHASE 1: SET UP MONITORING (before the call)

Open 4 terminal tails in parallel. Keep them ALL running throughout the test.

```bash
# Terminal 1: Call Brain DO
npx wrangler tail call-brain-do-v2-rescript --format json > /tmp/bella-test-do.log 2>&1 &
DO_PID=$!

# Terminal 2: Bridge
npx wrangler tail deepgram-bridge-v2-rescript --format json > /tmp/bella-test-bridge.log 2>&1 &
BRIDGE_PID=$!

# Terminal 3: Fast Intel
npx wrangler tail fast-intel-v9-rescript --format json > /tmp/bella-test-intel.log 2>&1 &
INTEL_PID=$!

# Terminal 4: Voice Agent
npx wrangler tail bella-voice-agent-v2-rescript --format json > /tmp/bella-test-voice.log 2>&1 &
VOICE_PID=$!

echo "All 4 tails running. PIDs: DO=$DO_PID BRIDGE=$BRIDGE_PID INTEL=$INTEL_PID VOICE=$VOICE_PID"
```

Generate a unique test LID:
```bash
TEST_LID="livetest_$(date +%m%d_%H%M%S)"
echo "Test LID: $TEST_LID"
```

Print the test URLs for Trent to open manually:
```bash
echo ""
echo "=========================================="
echo "STEP 1: Open this URL to submit the lead:"
echo "=========================================="
echo "https://demofunnelbellasandboxv8.netlify.app/loading-v95.html?lid=${TEST_LID}&web=https%3A%2F%2Fwww.pitcherpartners.com.au&name=Trent&email=test%40test.com"
echo ""
echo "=========================================="
echo "STEP 2: When redirected, talk to Bella at:"
echo "=========================================="
echo "https://demofunnelbellasandboxv8.netlify.app/demo_v95_hybrid.html?fn=Trent&lid=${TEST_LID}&web=https%3A%2F%2Fwww.pitcherpartners.com.au"
echo ""
echo "=========================================="
echo "Tell me when the call is DONE."
echo "=========================================="
```

Wait for Trent to say the call is done before proceeding to Phase 2.

### PHASE 2: CAPTURE AND ANALYSE (after the call)

```bash
# Stop tails
kill $DO_PID $BRIDGE_PID $INTEL_PID $VOICE_PID 2>/dev/null
echo "Tails stopped."
```

#### 2a. Pull DO debug state
```bash
echo "=== DO DEBUG STATE ==="
curl -s "https://call-brain-do-v2-rescript.trentbelasco.workers.dev/debug?callId=${TEST_LID}" | python3 -m json.tool > /tmp/bella-test-debug.json
cat /tmp/bella-test-debug.json
```

#### 2b. Pull KV intel
```bash
echo "=== KV INTEL ==="
npx wrangler kv key get "lead:${TEST_LID}:intel" \
  --namespace-id=0fec6982d8644118aba1830afd4a58cb --remote 2>/dev/null | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    print(f'business_name: {d.get(\"business_name\", d.get(\"core_identity\", {}).get(\"business_name\", \"MISSING\"))}')
    print(f'first_name: {d.get(\"first_name\", d.get(\"firstName\", \"MISSING\"))}')
    c = d.get('consultant', {})
    sf = c.get('scriptFills', {})
    print(f'consultant keys: {list(c.keys())[:10]}')
    print(f'scriptFills keys: {list(sf.keys())}')
    print(f'icpAnalysis present: {bool(c.get(\"icpAnalysis\"))}')
    print(f'conversionEventAnalysis present: {bool(c.get(\"conversionEventAnalysis\"))}')
    print(f'bella_opener: {d.get(\"bella_opener\", \"MISSING\")[:200]}')
    deep = d.get('intel', {}).get('deep', d.get('deep', {}))
    print(f'deep status: {deep.get(\"status\", \"MISSING\")}')
    gm = deep.get('googleMaps', {})
    print(f'google rating: {gm.get(\"rating\", \"MISSING\")}')
    print(f'review count: {gm.get(\"review_count\", \"MISSING\")}')
except Exception as e:
    print(f'Parse error: {e}')
    print(sys.stdin.read()[:500])
"
```
#### 2c. Analyse DO flow log
```bash
echo "=== FLOW LOG ANALYSIS ==="
python3 << 'PYEOF'
import json

with open('/tmp/bella-test-debug.json') as f:
    data = json.load(f)

print(f"Current stage: {data.get('currentStage', 'MISSING')}")
print(f"Current wow step: {data.get('currentWowStep', 'MISSING')}")
print(f"Pending delivery: {json.dumps(data.get('pendingDelivery'), indent=2) if data.get('pendingDelivery') else 'None'}")
print(f"Completed stages: {data.get('completedStages', [])}")
print(f"Completed wow steps: {data.get('completedWowSteps', [])}")
print(f"Consecutive timeouts: {data.get('consecutiveTimeouts', 0)}")
print(f"Question counts: {json.dumps(data.get('questionCounts', {}))}")
print(f"Calculator results: {list(data.get('calculatorResults', {}).keys())}")
print()

log = data.get('flowLog', [])
print(f"Flow log entries: {len(log)}")
print()

# Timeline
print("=== FLOW TIMELINE ===")
for entry in log:
    action = entry.get('action', '?')
    stage = entry.get('stage', '?')
    wow = entry.get('wowStep', '')
    reason = entry.get('reason', '')
    detail = entry.get('detail', '')
    fr = entry.get('from', '')
    to = entry.get('to', '')
    mode = entry.get('completionMode', '')
    
    line = f"  [{entry.get('seq', '?'):>3}] {action:<25}"
    if fr and to:
        line += f" {fr} → {to}"
    elif stage:
        line += f" {stage}"
    if wow:
        line += f" ({wow})"
    if reason:
        line += f" reason={reason}"
    if mode:
        line += f" mode={mode}"
    if detail:
        line += f" | {detail}"
    print(line)

# Check for issues
print()
print("=== ISSUE CHECK ===")

# P0: wowStep leak
if data.get('currentStage') != 'wow' and data.get('currentWowStep'):
    print(f"❌ P0 BUG: currentWowStep={data['currentWowStep']} but stage={data['currentStage']} — wowStep not cleared!")
else:
    print("✅ P0: currentWowStep correctly cleared outside wow phase")

# Check for delivery_completed events
completed = [e for e in log if e.get('action') == 'delivery_completed']
print(f"{'✅' if completed else '⚠️'} Delivery completions: {len(completed)}")

# Check for stage_advanced events
advanced = [e for e in log if e.get('action') == 'stage_advanced']
print(f"{'✅' if advanced else '⚠️'} Stage advancements: {len(advanced)}")
for a in advanced:
    mode = a.get('completionMode', '')
    print(f"   {a.get('from', '?')} → {a.get('to', '?')} ({a.get('reason', '?')}{f', {mode}' if mode else ''})")

# Check for skipped steps
skipped = [e for e in log if e.get('action') == 'step_skipped']
print(f"{'ℹ️' if skipped else '✅'} Wow steps skipped: {len(skipped)}")
for s in skipped:
    print(f"   {s.get('wowStep', '?')} — {s.get('reason', '?')}")

# Check for failures/timeouts
failures = [e for e in log if 'fail' in e.get('action', '') or 'timeout' in e.get('action', '')]
print(f"{'❌' if failures else '✅'} Failures/timeouts: {len(failures)}")
for f in failures:
    print(f"   {f.get('action')} — {f.get('reason', '')}")

# Check for stale events
stale = [e for e in log if e.get('action') == 'stale_event_ignored']
print(f"{'⚠️' if stale else '✅'} Stale events: {len(stale)}")

# Check extraction
extracted = data.get('extractedState', data)
acv = extracted.get('acv')
leads = extracted.get('inboundLeads')
print(f"\n=== EXTRACTION CHECK ===")
print(f"{'✅' if acv else '❌'} ACV: {acv}")
print(f"{'✅' if leads else '⚠️'} Inbound leads: {leads}")
print(f"Web leads: {extracted.get('webLeads')}")
print(f"Missed calls: {extracted.get('missedCalls')}")
print(f"Response speed: {extracted.get('responseSpeedBand')}")

PYEOF
```
#### 2d. Analyse bridge logs
```bash
echo "=== BRIDGE LOG ANALYSIS ==="
python3 << 'PYEOF'
import json

entries = []
with open('/tmp/bella-test-bridge.log') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except:
            pass

print(f"Bridge log entries: {len(entries)}")
for e in entries:
    logs = e.get('logs', [])
    for log in logs:
        msg = log.get('message', [''])[0] if isinstance(log.get('message'), list) else str(log.get('message', ''))
        if any(tag in msg for tag in ['DO_PATH', 'DO_DELIVERY', 'DO_REPLY', 'DO_FAIL', 'GEMINI_', 'BELLA_SAID', 'PROMPT', 'SUPERGOD', 'SUPPLEMENT', 'RE_EXTRACT', 'EARLY_CAPTURE']):
            ts = e.get('eventTimestamp', '')
            print(f"  {ts[:19]} {msg[:200]}")

PYEOF
```

#### 2e. Analyse DO logs for fix verification
```bash
echo "=== FIX VERIFICATION ==="
python3 << 'PYEOF'
import json

entries = []
with open('/tmp/bella-test-do.log') as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entries.append(json.loads(line))
        except:
            pass

print(f"DO log entries: {len(entries)}")

fix_tags = [
    'SUPPLEMENT_SEED',     # Fix 3: full consultant merge
    'WOW4_RESOLVE',        # Fix 3: wow_4 consultant data
    'RE_EXTRACT',          # Fix 1: post-advance re-extraction
    'EARLY_CAPTURE',       # Fix 2: broadened prescan
    'ADVANCE',             # Flow harness advancement
    'DELIVERY',            # Delivery gate
    'WOW_SKIP',            # Wow skip decisions
    'DIRECTIVE',           # Every directive issued
    'EXTRACTION',          # What was extracted
    'QCOUNT',              # Question budget
]

for e in entries:
    logs = e.get('logs', [])
    for log in logs:
        msg = log.get('message', [''])[0] if isinstance(log.get('message'), list) else str(log.get('message', ''))
        if any(tag in msg for tag in fix_tags):
            ts = e.get('eventTimestamp', '')
            print(f"  {ts[:19]} {msg[:250]}")

PYEOF
```

### PHASE 3: GENERATE REPORT

```bash
echo ""
echo "=========================================="
echo "BELLA v5.3.0 LIVE TEST REPORT"
echo "=========================================="
echo "Test LID: ${TEST_LID}"
echo "Date: $(date)"
echo ""
echo "=== DEPLOYED VERSIONS ==="
curl -s "https://call-brain-do-v2-rescript.trentbelasco.workers.dev/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'DO: {d.get(\"version\",\"?\")}')" 2>/dev/null || echo "DO: unreachable"
curl -s "https://deepgram-bridge-v2-rescript.trentbelasco.workers.dev/health" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(f'Bridge: {d.get(\"version\",\"?\")}')" 2>/dev/null || echo "Bridge: unreachable"
echo ""
echo "=== KEY METRICS ==="
python3 -c "
import json
with open('/tmp/bella-test-debug.json') as f:
    d = json.load(f)
log = d.get('flowLog', [])
print(f'Final stage: {d.get(\"currentStage\")}')
print(f'Stages completed: {len(d.get(\"completedStages\", []))}')
print(f'Flow log entries: {len(log)}')
print(f'Delivery completions: {len([e for e in log if e.get(\"action\")==\"delivery_completed\"])}')
print(f'Stage advancements: {len([e for e in log if e.get(\"action\")==\"stage_advanced\"])}')
print(f'Steps skipped: {len([e for e in log if e.get(\"action\")==\"step_skipped\"])}')
print(f'Failures: {len([e for e in log if \"fail\" in e.get(\"action\",\"\")])}')
print(f'ACV captured: {d.get(\"acv\") or d.get(\"extractedState\",{}).get(\"acv\")}')
print(f'Calculator results: {list(d.get(\"calculatorResults\",{}).keys())}')
print(f'WowStep leak: {\"BUG\" if d.get(\"currentStage\") != \"wow\" and d.get(\"currentWowStep\") else \"CLEAN\"}')" 2>/dev/null
echo ""
echo "Full debug state saved to: /tmp/bella-test-debug.json"
echo "DO logs saved to: /tmp/bella-test-do.log"
echo "Bridge logs saved to: /tmp/bella-test-bridge.log"
echo "=========================================="
```

Save the full report:
```bash
cp /tmp/bella-test-debug.json "/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/logs/livetest-${TEST_LID}-debug.json"
cp /tmp/bella-test-do.log "/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/logs/livetest-${TEST_LID}-do.log"
cp /tmp/bella-test-bridge.log "/Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/logs/livetest-${TEST_LID}-bridge.log"
echo "Logs saved to /logs/"
```

## IMPORTANT

- Phase 1: Set up tails and print URLs. WAIT for Trent to run the call.
- Phase 2: Only run AFTER Trent says the call is done.
- Phase 3: Generate the report and save logs.
- Do NOT close or compact the tails early.
- If any analysis script errors, show the raw log instead.
