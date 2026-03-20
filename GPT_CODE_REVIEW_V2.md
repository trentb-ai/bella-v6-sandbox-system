# GPT CODE REVIEW — Bella V1.1 DO Brain (Live Failures)
# Repo: https://github.com/trentb-ai/bella-v6-sandbox-system
# Branch: main (latest push)
# Date: 20 March 2026

## WHAT TO REVIEW

The DO brain (call-brain-do/) is failing in live testing. The V1.0 old
bridge path works fine. We need you to review the ACTUAL DEPLOYED CODE
in the repo, not summaries, and provide exact fixes.

## KEY FILES IN THE REPO

### The DO brain (the broken part):
- call-brain-do/src/index.ts — DO class, /turn handler, /event handler, ensureSession
- call-brain-do/src/moves.ts — Script engine (9 WOW stalls, channels, ROI, close)
- call-brain-do/src/extract.ts — Regex extraction from transcripts
- call-brain-do/src/types.ts — All TypeScript contracts
- call-brain-do/src/gate.ts — Stage gating, advancement, queue building
- call-brain-do/src/state.ts — DO storage operations
- call-brain-do/src/roi.ts — ROI calculation engine
- call-brain-do/src/intel.ts — Intel merging, IndustryLanguagePack

### The bridge V1.1 (calls the DO):
- deepgram-bridge-v11/src/index.ts — Bridge worker, DO path, buildTinyVoicePrompt

### Fast-intel (sends events to DO):
- fast-intel-sandbox-v9/src/index.ts — deliverDOEvents function

## LATEST TEST FAILURE (Walker Lane, walkerlane.com.au)

### What's fixed:
- Intel events now accepted (ensureSession creates session if needed) ✅
- Session NOT reset on subsequent turns ✅
- Prompt under 1,500 chars ✅
- Gemini TTFB fast (1.1-2.2s) ✅

### What's STILL broken:

FAILURE 1: Stall 1 greeting NEVER delivered
