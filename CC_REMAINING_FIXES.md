# REMAINING FIXES — BELLA V1.1 FINAL BUILDOUT
# CC: Read this and implement ALL remaining items.
# Everything else from GPT's analysis is DONE. These are the gaps.

---

## 1. cleanCriticalFacts sanitizer — NOT DONE

File: call-brain-do/src/moves.ts

icpProblems[] and icpSolutions[] go into criticalFacts raw. Gemini can
still read them verbatim even with "CONTEXT ONLY" labeling if the strings
look like natural speech (e.g. "'No idea which direction to take'").

Add these helpers near the top of moves.ts:

```typescript
function cleanFact(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s) return null;
  // Strip surrounding quotes
  s = s.replace(/^["'`]+|["'`]+$/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  // Drop JSON-like or too-short strings
  if (s.includes('{') || s.includes('}') || s.includes('":') || s.includes('[]') || s.length < 6) return null;
  return s;
}

function cleanFacts(inputs: unknown[]): string[] {
  return inputs.map(cleanFact).filter((x): x is string => Boolean(x)).slice(0, 5);
}
```

Then find everywhere icpProblems/icpSolutions are pushed into criticalFacts
or used in chosenMove.text. Wrap through cleanFacts() where they enter
criticalFacts. For chosenMove.text (stall 3 ICP), strip surrounding quotes
from the interpolated values so Gemini doesn't read quote marks aloud.

## 2. Verify deep-scrape eventId observability — PARTIALLY DONE

File: deep-scrape-workflow-sandbox-v9/src/index.ts

I can see eventId/sentAt ARE in the deep-scrape code. But verify:
- Is CALL_BRAIN service binding actually configured in deep-scrape wrangler.toml?
- Is the deep_ready event being sent with the correct callId/leadId?
- Is there logging at both sender AND receiver for eventId?
- Is there a timeout/failure log if deep_ready never arrives?

Check wrangler.toml for deep-scrape-workflow-sandbox-v9:
```
cat deep-scrape-workflow-sandbox-v9/wrangler.toml | grep -A2 CALL_BRAIN
```

If CALL_BRAIN binding is missing, add it:
```toml
[[services]]
binding = "CALL_BRAIN"
service = "call-brain-do"
```

## 3. Verify industry language precedence — DONE BUT VERIFY

File: call-brain-do/src/intel.ts

Financial planning pack is added. But verify:
- When consultant_ready arrives with industry="financial planning",
  does it OVERRIDE a stale "trades" classification from fast-intel?
- Is the pack rebuilt in mergeIntel() after consultant data arrives?
- Log: `[INDUSTRY] resolved="${label}" from="${source}"` — is this present?

Check by reading the mergeIntel function:
```
grep -n "industryLanguage\|buildIndustryLanguagePack" call-brain-do/src/intel.ts
```

## 4. Verify stall 3 ICP text isn't reading raw quotes — VERIFY

File: call-brain-do/src/moves.ts (stall 3 block)

The chosenMove.text for stall 3 interpolates icpProblems[0], icpProblems[1],
icpSolutions[0], icpSolutions[1] directly into the spoken text:

"The typical challenges your {pluralOutcome} face are {icpProblems[0]}
and {icpProblems[1]}, and you solve those through {icpSolutions[0]}
and {icpSolutions[1]}."

If these contain quotes like "'No idea which direction to take'",
Gemini reads the quotes aloud. Fix: strip quotes before interpolation.

```typescript
// In stall 3 block, before building insightText:
const cleanProblems = icpProblems.map((p: string) =>
  p.replace(/^["'`]+|["'`]+$/g, '').trim()
);
const cleanSolutions = icpSolutions.map((s: string) =>
  s.replace(/^["'`]+|["'`]+$/g, '').trim()
);
```

Then use cleanProblems[0], cleanProblems[1], etc in the template string.

## 5. Verify watchdog flags are CONSUMED by /turn

File: call-brain-do/src/index.ts handleTurn() and moves.ts

The alarm sets flags like mustDeliverRoiNext and deepIntelMissingEscalation.
Verify these flags are actually READ and ACTED ON:

- Does handleTurn check brain.watchdog.mustDeliverRoiNext?
  If true and stage allows, should the DO force roi_delivery as next stage.
- Does moves.ts check brain.watchdog.deepIntelMissingEscalation?
  If true, should use fallback data instead of waiting for deep intel.
- Are flags reset after being consumed?

If not implemented, add:
```typescript
// In handleTurn, after building packet:
if (brain.watchdog?.mustDeliverRoiNext && brain.stage !== 'roi_delivery' && brain.stage !== 'close') {
  // Force ROI delivery on next advance
  console.log(`[WATCHDOG] forcing ROI delivery next`);
}

// In moves.ts buildWowPacket, for stalls that need deep data:
if (brain.watchdog?.deepIntelMissingEscalation) {
  // Use fast-intel-only fallback, don't wait for deep
  console.log(`[WATCHDOG] deep intel missing — using fallback`);
}
```

## 6. Git commit + push everything

After all fixes:
```
cd /Users/trentbelasco/Desktop/BELLA_V1.0_SANDBOX_COMPLETE_SYSTEM
git add -A
git commit -m "V1.1 DO brain full buildout - watchdog alarms, cleanFacts, industry fix, extraction fix, event observability"
git push origin main
```

## EXECUTION ORDER

1. Add cleanFact/cleanFacts helpers to moves.ts
2. Strip quotes from icpProblems/icpSolutions in stall 3 chosenMove.text
3. Verify deep-scrape CALL_BRAIN binding exists
4. Verify industry language rebuild on consultant arrival
5. Verify watchdog flags consumed in /turn and moves.ts
6. tsc --noEmit in call-brain-do/
7. Deploy call-brain-do
8. Deploy deep-scrape (if binding changed)
9. Git commit + push
10. Report all changes

## DO NOT TOUCH
- deepgram-bridge-v9/ (V1.0 frozen)
- deepgram-bridge-v11/ (v9.18.0 just deployed, let it settle)
- voice-agent-v9/ or voice-agent-v11/
- netlify sites
