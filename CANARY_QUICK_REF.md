# BELLA V1 CANARY — QUICK REFERENCE

## START MONITORING
```bash
cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM
bash monitor-canary.sh
```

## HEALTHY CALL PATTERN

### Turn 1 (Greeting)
```
[REQ] lid=anon_xxx msgs=1
[KV_STATUS] lid=anon_xxx fast=true apify=false full=false kv_bytes=4200
[INIT] lid=anon_xxx queue=[ch_ads,ch_website] tease=ch_phone
[PROMPT] stage=wow stall=0 system_chars=2800
[GEMINI_TTFB] 3200ms
[BELLA_SAID] Hi FirstName! We've taken a proper look at BusinessName...
```

### Turn 3-5 (WOW Stage)
```
[REQ] lid=anon_xxx msgs=5
[EXTRACT] lid=anon_xxx stage=wow extractions=0
[PROMPT] stage=wow stall=2 system_chars=2950
[GEMINI_TTFB] 2800ms
[BELLA_SAID] Now, I think you'll be impressed...
```

### Turn 6 (WOW Exit → First Channel)
```
[REQ] lid=anon_xxx msgs=7
[ADVANCE] → ch_ads
[PROMPT] stage=ch_ads stall=0 system_chars=3100
[GEMINI_TTFB] 3500ms
[BELLA_SAID] Let's talk about your Google Ads...
```

### Turn 8 (Channel → Channel)
```
[REQ] lid=anon_xxx msgs=9
[EXTRACT] lid=anon_xxx stage=ch_ads extractions=2 fields=ads_leads,ads_conversions
[CAPTURED] ads_leads=50
[CAPTURED] ads_conversions=10
[ADVANCE] → ch_website
[BELLA_SAID] Got it. And what about website leads...
```

### Turn 10 (Final Channel → Close)
```
[REQ] lid=anon_xxx msgs=11
[EXTRACT] lid=anon_xxx stage=ch_website extractions=1 fields=web_leads
[CAPTURED] web_leads=30
[ADVANCE] → close
[PROMPT] stage=close stall=0 system_chars=3200
[BELLA_SAID] Alright FirstName, let's get you set up. Free trial...
```

**✅ EXPECTED FLOW: wow → ch_ads → ch_website → close (3 transitions)**

---

## RED FLAGS 🚨

### CRITICAL — Frozen Stage Reference
```
[ADVANCE] → anchor_acv
[ADVANCE] → anchor_timeframe
[ADVANCE] → roi_delivery
[CALC] agents=Maddie=$500/wk,Alex=$300/wk
```
**ACTION: IMMEDIATE ROLLBACK — Rescript incomplete**

### Stage Machine Stuck
```
[REQ] lid=anon_xxx msgs=15
[PROMPT] stage=wow stall=8 system_chars=3500
[PROMPT] stage=wow stall=9 system_chars=3600
[PROMPT] stage=wow stall=10 system_chars=3700
```
**ACTION: Call stuck in wow, gateOpen() not passing**

### Data Not Loaded
```
[KV_STATUS] lid=anon_xxx fast=false kv_bytes=0
[STUB_MODE] lid=anon_xxx — website not scrapeable
```
**ACTION: fast-intel failed, check service binding**

### Bella Silent
```
[REQ] lid=anon_xxx msgs=5
[GEMINI_TTFB] 4200ms
(no [BELLA_SAID] tag)
```
**ACTION: Gemini returned empty, check API key**

### Latency Spike
```
[GEMINI_TTFB] 12000ms
[GEMINI_TTFB] 15000ms
```
**ACTION: Gemini overloaded or prompt too large**

### Prompt Bloat
```
[PROMPT] stage=ch_ads stall=2 system_chars=8500
[PROMPT] stage=ch_website stall=1 system_chars=9200
```
**ACTION: Prompt growing unchecked, memory leak**

---

## QUICK HEALTH CHECKS

### Count Successful Closes (target: ≥85%)
```bash
cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM
grep "\[ADVANCE\] → close" logs/canary-*.log | wc -l
```

### Search for Frozen Stages (target: 0)
```bash
grep -E "anchor_acv|anchor_timeframe|roi_delivery" logs/canary-*.log | wc -l
```

### Average Latency
```bash
grep "\[GEMINI_TTFB\]" logs/canary-*.log | tail -20 | awk '{print $NF}' | sed 's/ms//' | awk '{sum+=$1; n++} END {print sum/n "ms"}'
```

### Check Extraction Working
```bash
grep "\[CAPTURED\]" logs/canary-*.log | tail -20
```

---

## CANARY TEST TARGETS

| Metric | Target | Critical Threshold |
|--------|--------|-------------------|
| Success rate | ≥85% (40/47) | <85% = FAIL |
| Frozen stage refs | 0 | >0 = ROLLBACK |
| Stuck calls | 0 | >2 = FAIL |
| Avg GEMINI_TTFB | <6s | >10s = investigate |
| Avg prompt size | <3k chars | >5k = bloat issue |
| Data loaded | >90% | <80% = pipeline broken |

---

## TEST PROCEDURE

1. **Start monitor:** `bash monitor-canary.sh`
2. **Run 5+ test calls** through Netlify funnel
3. **Watch logs in real-time** for red flags
4. **After each call:** Verify it reached `[ADVANCE] → close`
5. **After all calls:** Run health checks above
6. **Decision:** Compare results vs targets table

---

## GO/NO-GO

**✅ PROCEED if:**
- All calls reach close
- Zero frozen stage references
- Success rate ≥85%
- No critical bugs

**❌ ROLLBACK if:**
- Any frozen stage references
- Success rate <85%
- Stage machine stuck
- Data pipeline broken

---

## ROLLBACK COMMAND (if needed)

```bash
# Check frozen workers still exist
ls -la ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/*FROZEN*

# Redeploy from FROZEN copies
cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v11-FROZEN-cleanest-bella
npx wrangler deploy --config wrangler.toml

cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do-FROZEN-cleanest-bella
npx wrangler deploy --config wrangler.toml

cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/fast-intel-sandbox-v9-FROZEN-cleanest-bella
npx wrangler deploy --config wrangler.toml
```
