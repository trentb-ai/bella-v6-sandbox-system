# CC TASK: Compile Test All 4 Frozen Directories

## Context
We just fixed wrangler.toml stubs in 2 of the 4 FROZEN Cleanest Bella directories.
The bug was: deepgram-bridge and fast-intel had CALL_BRAIN pointing to call-brain-do-v1-launch instead of call-brain-do.
Both have been fixed. Now we need to verify all 4 FROZEN dirs compile clean.

## Task
Run `tsc --noEmit` in each of the 4 FROZEN directories and report results.
Do NOT deploy anything. Read-only compile check only.

## Directories to test (in this order)

```bash
cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/call-brain-do-FROZEN-cleanest-bella
npx tsc --noEmit 2>&1

cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/deepgram-bridge-v11-FROZEN-cleanest-bella
npx tsc --noEmit 2>&1

cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/voice-agent-v11-FROZEN-cleanest-bella
npx tsc --noEmit 2>&1

cd ~/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM/fast-intel-sandbox-v9-FROZEN-cleanest-bella
npx tsc --noEmit 2>&1
```

## Pass criteria
- Zero errors in ALL 4 directories
- Warnings are OK, errors are not
- If any errors found: report them but DO NOT fix them — just document

## Report format
For each directory:
- PASS or FAIL
- Error count (if any)
- First 5 errors (if any)

## After compile tests
If ALL 4 pass: write a single line to Brain D1 confirming compile clean:
Database: 2001aba8-d651-41c0-9bd0-8d98866b057c
Doc ID: doc-cleanest-bella-v2-compile-verified-20260331
Title: CLEANEST BELLA V2 — Compile Verified (31 Mar 2026)
Content: All 4 FROZEN directories compile clean post wrangler.toml fix. call-brain-do: PASS. deepgram-bridge-v11: PASS. bella-voice-agent-v11: PASS. fast-intel-v8: PASS. Date: 31 March 2026.

If any FAIL: do NOT write to Brain. Just report the errors.

## IMPORTANT
- Do NOT run wrangler deploy
- Do NOT modify any source files
- Read only + compile check only
