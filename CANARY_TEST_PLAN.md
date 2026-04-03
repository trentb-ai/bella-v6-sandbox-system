# BELLA V1 CANARY TEST PLAN
**Target:** Beat 40/47 baseline with V1 rescript (no ROI calculator)
**Date:** 2026-03-30
**Version:** deepgram-bridge-v2-rescript

---

## PRE-FLIGHT CHECKLIST

**Deployed Workers:**
- [ ] deepgram-bridge-v2-rescript (https://deepgram-bridge-v2-rescript.trentbelasco.workers.dev)
- [ ] call-brain-do-v2-rescript (https://call-brain-do-v2-rescript.trentbelasco.workers.dev)
- [ ] fast-intel-v9-rescript (https://fast-intel-v9-rescript.trentbelasco.workers.dev)

**Health Checks:**
- [ ] deepgram-bridge-v2-rescript/health returns version
- [ ] Secrets verified (GEMINI_API_KEY, TOOLS_BEARER, etc.)
- [ ] Stage machine test passed (wow → channels → close)

**Frozen Worker Protection:**
- [ ] All FROZEN directories renamed with suffix
- [ ] FROZEN headers added to wrangler.toml
- [ ] deploy.sh guard script created and tested

---

## MONITORING SETUP

### Real-Time Tail Command
```bash
cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM
npx wrangler tail deepgram-bridge-v2-rescript --format pretty 2>&1 | tee logs/canary-$(date +%Y%m%d-%H%M%S).log
```

### Key Log Tags to Watch

| Tag | What It Shows | Critical For |
|-----|---------------|--------------|
| `[REQ]` | Turn received, message count | Call flow, stuck detection |
| `[KV_STATUS]` | fast/apify/full loaded, kv_bytes | Data pipeline health |
| `[INIT]` | First turn, queue built | Stage machine initialization |
| `[ADVANCE]` | Stage transitions (wow→ch→close) | Flow progression, no stuck states |
| `[EXTRACT]` | Fields captured per turn | Data extraction working |
| `[CAPTURED]` | Field-by-field values | Verify inputs being saved |
| `[BELLA_SAID]` | **Actual spoken output** | What prospect hears |
| `[GEMINI_TTFB]` | Time to first token | Latency check |
| `[PROMPT]` | system_chars | Prompt size (target <3k) |
| `[QUEUE_V2]` | Branching logic, channel selection | buildQueue correctness |

---

## TEST EXECUTION

### Test Cases (Minimum 5 Calls)

**Call 1: Happy Path (ads + website)**
- Business: Local service (plumber, dentist, physio)
- Has ads running: YES
- Has website leads: YES
- Expected flow: wow → ch_ads → ch_website → close
- **Watch for:** Smooth transitions, no anchor_acv/anchor_timeframe references

**Call 2: Single Channel (ads only)**
- Business: Professional services
- Has ads running: YES
- Has website leads: NO
- Expected flow: wow → ch_ads → close
- **Watch for:** Direct to close after 1 channel (no roi_delivery stage)

**Call 3: just_demo Shortcut**
- Prospect says: "just show me the demo" during wow
- Expected flow: wow → close (skip channels)
- **Watch for:** just_demo flag set, channels skipped

**Call 4: Phone Channel**
- Business: High call volume (medical, trades)
- Expected flow: wow → ch_phone → close
- **Watch for:** After hours handling, missed call detection

**Call 5: Empty Queue (stub data)**
- Business: Minimal intel, no deep scrape
- Expected flow: wow → close (empty queue)
- **Watch for:** Stub mode handling, no crash

---

## SUCCESS CRITERIA

### Must Pass (Blockers)
- [ ] **No frozen stages:** Zero references to anchor_acv, anchor_timeframe, roi_delivery in logs
- [ ] **Stage machine works:** All calls reach "close" stage (no stuck states)
- [ ] **BELLA_SAID present:** Every turn has spoken output logged
- [ ] **No TypeScript errors:** Clean compilation, no runtime crashes
- [ ] **Extraction works:** CAPTURED logs show fields being saved
- [ ] **Service bindings work:** call-brain-do and TOOLS responding

### Quality Gates
- [ ] **Latency:** GEMINI_TTFB under 6s per turn
- [ ] **Prompt size:** PROMPT system_chars under 4k (target <3k)
- [ ] **Data flow:** KV_STATUS shows fast=true within 10s of lead submit
- [ ] **Queue logic:** QUEUE_V2 shows correct branching (max 2 channels)

### Baseline Target
- [ ] **40/47 or better:** At least 40 out of 47 calls must complete successfully
  - "Success" = Reach close stage without crash/timeout
  - "Failure" = Stuck in wow/channel, Gemini error, silence >30s

---

## FAILURE MODES TO WATCH

### Stage Machine Issues
- **Symptom:** Call stuck in wow (stall counter keeps incrementing)
- **Log pattern:** `[ADVANCE]` missing, same stage repeated
- **Action:** Check gateOpen() logic, verify wants_numbers not blocking

### Data Not Flowing
- **Symptom:** `[KV_STATUS] fast=false kv_bytes=0`
- **Log pattern:** fast-intel didn't write, or LID mismatch
- **Action:** Check fast-intel logs, verify service binding

### Bella Silent
- **Symptom:** No `[BELLA_SAID]` tags, prospect hears nothing
- **Log pattern:** Gemini response empty, or SSE stream broken
- **Action:** Check GEMINI_TTFB, look for GEMINI_ERR

### Wrong Stage Flow
- **Symptom:** `[ADVANCE] → anchor_acv` (removed stage!)
- **Log pattern:** Old stage names in transition logs
- **Action:** CRITICAL BUG - rescript incomplete, rollback

### ROI Calculator Leak
- **Symptom:** `[CALC]` tags appear (should be V1_REMOVED)
- **Log pattern:** runCalcs() being called
- **Action:** CRITICAL BUG - calculator not removed, rollback

---

## POST-TEST ANALYSIS

### Extract Key Metrics
```bash
# Count successful closes
grep "\[ADVANCE\] → close" logs/canary-*.log | wc -l

# Check for frozen stages (should be ZERO)
grep -E "anchor_acv|anchor_timeframe|roi_delivery" logs/canary-*.log

# Average TTFB
grep "\[GEMINI_TTFB\]" logs/canary-*.log | awk '{print $NF}' | sed 's/ms.*//' | awk '{sum+=$1; n++} END {print sum/n "ms avg"}'

# Prompt sizes
grep "\[PROMPT\]" logs/canary-*.log | grep -o "system_chars=[0-9]*" | sed 's/system_chars=//' | sort -n

# Extraction success rate
grep "\[EXTRACT\]" logs/canary-*.log | grep -o "extractions=[0-9]*" | sed 's/extractions=//' | awk '$1>0' | wc -l
```

### Report Template
```
CANARY TEST RESULTS — BELLA V1
Date: [DATE]
Calls: [N] total
Success: [X]/[N] reached close
Baseline: 40/47 (85.1%)
Result: [X]/[N] ([PERCENT]%) — [PASS/FAIL]

Stage Machine:
  - Frozen stage refs: [N] (MUST BE ZERO)
  - Stuck calls: [N]
  - Avg turns to close: [N]

Performance:
  - Avg GEMINI_TTFB: [N]ms
  - Avg prompt size: [N] chars
  - Data loaded (fast=true): [N]%

Issues Found:
  - [List any bugs, errors, unexpected behavior]

Decision:
  [ ] PASS - Proceed to production
  [ ] FAIL - Rollback, fix issues
```

---

## ROLLBACK PLAN (if canary fails)

If canary test fails baseline (< 40/47):

1. **Immediate:** Stop sending traffic to v11 workers
2. **Verify frozen workers still intact:**
   ```bash
   ls -la ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/*FROZEN*
   ```
3. **Check if frozen workers are still live:**
   ```bash
   npx wrangler deployments list --name deepgram-bridge-v11
   npx wrangler deployments list --name call-brain-do
   npx wrangler deployments list --name fast-intel-v8
   ```
4. **If we accidentally deployed over frozen workers:**
   - Tag current broken version in git
   - Checkout cleanest-bella tag
   - Redeploy from cleanest-bella
5. **Investigate failure:**
   - Read full canary logs
   - Identify root cause
   - Document in MEMORY.md Bug Fix Log

---

## GO/NO-GO DECISION

**PROCEED TO PRODUCTION if:**
- ✅ Success rate ≥ 85% (40/47 or better)
- ✅ Zero frozen stage references
- ✅ All calls reach close stage
- ✅ No critical bugs found

**ROLLBACK if:**
- ❌ Success rate < 85%
- ❌ Any frozen stage references in logs
- ❌ Stage machine stuck/looping
- ❌ ROI calculator still present
- ❌ Data pipeline broken (KV_STATUS failures)

---

## NEXT STEPS AFTER CANARY PASS

1. Update Netlify funnel to point at v11 workers
2. Monitor production for 24h
3. Tag release in git: `v1.0.0-production`
4. Update MEMORY.md with V1 launch date
5. Archive cleanest-bella as historical reference
