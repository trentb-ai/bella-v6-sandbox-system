# SESSION 2026-04-08 COMPLETE: Voice Agent V11 → Brain-V3 Integration Root Cause & Fix

**Session:** 2026-04-08 ~10:18-10:45 AEST  
**Agent:** T5 (Haiku) + Codex (medium reasoning)  
**Status:** ROOT CAUSE IDENTIFIED. 2-FILE FIX READY FOR DEPLOYMENT.

---

## THE PROBLEM

Bella greeting WAS WORKING but used fallback business name ("your business" instead of "Pitcher").

**User report:** "she didn't speak after first one"  
**Actually:** She DID speak the greeting (confirmed via curl test). Business name enrichment failed because intel wasn't reaching brain-v3.

---

## ROOT CAUSE (CONFIRMED)

**The LIVE funnel (netlify-funnel-v2-rescript) is wired to OLD brain, not brain-v3.**

### Current Wiring Chain:
1. capture.html → POST /fast-intel to fast-intel-v9-rescript
2. fast-intel-v9-rescript.wrangler.toml:
   ```toml
   [[services]]
   binding = "CALL_BRAIN"
   service = "call-brain-do-v2-rescript"  ← WRONG (should be bella-brain-v3)
   ```
3. fast-intel POSTs /event/fast-intel to call-brain-do-v2-rescript (OLD BRAIN)
4. deepgram-bridge-v2-rescript.wrangler.toml:
   ```toml
   [[services]]
   binding = "CALL_BRAIN"
   service = "call-brain-do-v2-rescript"  ← WRONG (should be bella-brain-v3)
   ```
5. bridge also queries OLD brain

**Result:** brain-v3 never receives intel, never hydrates businessName.

---

## THE FIX (2 Files, 2 Lines Each)

### FILE 1: fast-intel-v9-rescript/wrangler.toml

**Change this:**
```toml
[[services]]
binding = "CALL_BRAIN"
service = "call-brain-do-v2-rescript"
```

**To this:**
```toml
[[services]]
binding = "CALL_BRAIN"
service = "bella-brain-v3"
```

### FILE 2: deepgram-bridge-v2-rescript/wrangler.toml

**Change this:**
```toml
[[services]]
binding = "CALL_BRAIN"
service = "call-brain-do-v2-rescript"
```

**To this:**
```toml
[[services]]
binding = "CALL_BRAIN"
service = "bella-brain-v3"
```

**Code changes:** NONE REQUIRED (both workers use same binding pattern)

---

## VERIFICATION (Test After Deploy)

```bash
Test URL: https://cleanestbellav2rescripted.netlify.app/demo_v95_hybrid.html?fn=TRENT&lid=anon_test_$(date +%s)&web=https://www.pitcher.com.au&biz=Pitcher
```

1. Say "hello"
2. Expected: "Hi! Thanks for submitting your details. I've had a look at **Pitcher** and..."
3. Check state: `curl https://bella-brain-v3.trentbelasco.workers.dev/debug?callId=anon_test_XYZ`
4. Should show:
   - `intelReceived: true`
   - `businessName: "Pitcher"` (NOT "your business")

---

## WHAT WE VERIFIED WORKS

✓ Voice agent v11 passes lid via query param  
✓ Bridge extracts lid from query params (fallback working)  
✓ Brain-v3 builds greeting directive correctly  
✓ Brain-v3 returns speakText in TurnPlan  
✓ Adapter maps speakText → V2 response format  
✓ Greeting text IS delivered (curl test verified)  
✓ Deterministic delivery logic exists (checks mandatory flag)  
✓ Bridge-v2-rescript wired correctly to brain-v3 adapter endpoint  
✓ LID flows through entire chain  
✓ System returns greeting on first turn  

---

## WHAT FAILS NOW (Fixed by 2-File Change)

✗ businessName enrichment: brain-v3 never receives /event/fast-intel  
✗ intelReceived stays false  
✗ Greeting uses fallback name instead of actual prospect name  

---

## DEPLOYMENT SEQUENCE

**T4 (Minion A):**
1. Edit fast-intel-v9-rescript/wrangler.toml (1 line change)
2. Edit deepgram-bridge-v2-rescript/wrangler.toml (1 line change)
3. Deploy fast-intel-v9-rescript: `cd fast-intel-v9-rescript && npx wrangler deploy`
4. Deploy deepgram-bridge-v2-rescript: `cd bridge-v2-rescript && npx wrangler deploy`
5. Test with fresh LID

**T2 (Code Lead):**
- Full harness canary after deploy
- Verify businessName enrichment, all stages, extraction

**Risk:** LOW (only bindings changed, no logic)  
**Rollback:** 2 reverts + 2 deploys  

---

## KEY DISCOVERY: Greeting Text WAS CORRECT

User said "she didn't speak" but actual curl test showed the greeting IS spoken:
```
"Hi! Thanks for submitting your details. I've had a look at your business and I'm really excited to show you what we can do. How are you going?"
```

The greeting IS spoken. The problem is businessName ("your business" vs actual name).

---

## NEXT SESSION CONTEXT

After deployment:
1. Run full test canary with new LID
2. Check brain state for intelReceived=true, businessName correct
3. Run all stage transitions
4. Verify extraction, compliance, ROI delivery
5. Update deployment status

---

## FILES TO CHANGE

- fast-intel-v9-rescript/wrangler.toml (wrangler.toml only, no src/ changes)
- deepgram-bridge-v2-rescript/wrangler.toml (wrangler.toml only, no src/ changes)

**Git diff after changes:**
```
M fast-intel-v9-rescript/wrangler.toml
M deepgram-bridge-v2-rescript/wrangler.toml
```

**Deployment versions:**
- fast-intel-v9-rescript: current → v?.?.? (bump minor)
- deepgram-bridge-v2-rescript: v6.31.0-workers-ai → v6.31.1-workers-ai (bump patch)

---

**Session end:** 2026-04-08 ~10:45 AEST  
**Status:** Ready for T4 deployment  
**Blocker:** None (2-file change is low-risk)
