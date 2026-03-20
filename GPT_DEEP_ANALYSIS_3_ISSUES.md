# GPT DEEP ANALYSIS — 3 Critical Issues Post-Hardening
# Source: GPT research with official CF/Gemini docs
# Date: 20 March 2026
# Authority: GPT analysis of Ikigai Wealth test (anon_yqyavagn)
#
# CC: Read this file thoroughly. Implement ALL fixes in order.
# These are NOT optional. Each fix addresses a live failure.

---

## ISSUE 1: deep_ready EVENT NEVER ARRIVES AT DO

### Problem
Deep-scrape workflow fires 5 Apify actors (Google Maps, FB ads,
Google ads, Indeed, LinkedIn). Results NEVER reached the DO for
Ikigai Wealth. No reviews, no hiring, no ads data. Silent failure.

### Root Cause (unknown — that's the problem)
Could be: workflow never finished, event never sent, event sent
to wrong callId, DO rejected event due to version/session, or
event merged but didn't trigger queue rebuild. We have NO LOGGING
to distinguish these.

### Fix: Event observability

Add to EVERY async event (deep_ready, fast_intel_ready, consultant_ready):
- eventId: crypto.randomUUID()
- leadId: the LID
- version: monotonic integer
- sentAt: ISO timestamp
- source: worker name that sent it

Log at SENDER (deep-scrape-workflow):
```
log('DEEP_SEND', `eventId=${eventId} lid=${lid} version=${v} sentAt=${ts}`);
```

Log at RECEIVER (call-brain-do handleIntelEvent):
```
log('DEEP_RECV', `eventId=${eventId} lid=${lid} version=${v} receivedAt=${now}`);
```

If DO rejects (version guard, missing session, error):
```
log('DEEP_REJECT', `eventId=${eventId} reason=${reason}`);
```

### Files to modify:
- deep-scrape-workflow-sandbox-v9/src/index.ts — add eventId + sentAt to deep_ready payload
- fast-intel-sandbox-v9/src/index.ts — add eventId + sentAt to fast_intel_ready and consultant_ready
- call-brain-do/src/index.ts handleIntelEvent — log eventId on receive, reject, skip

### Also check:
- Does deep-scrape workflow actually call the DO for this LID?
- Is the callId/leadId correct in the service binding URL?
- Does the workflow complete at all? (check wrangler tail on deep-scrape)
- Add a timeout metric: if deep_ready not received within 120s, log WARNING


---

## ISSUE 2: INDUSTRY LANGUAGE PACK WRONG ("trades" for wealth management)

### Problem
Ikigai Wealth is a financial planning firm. Consultant correctly
identified "financial planning and wealth management". But the
IndustryLanguagePack resolved to "trades" — so Bella says "job"
instead of "client", uses tradesperson language for a wealth manager.

### Root Cause
buildIndustryLanguagePack() in call-brain-do/src/intel.ts uses a
keyword map that checks consultant industry string against keywords.
The map has entries like "build": "trades". Either:
a) The consultant industry string wasn't available when the pack was
   first built (fast-intel arrived first with weaker classification)
b) The keyword matching hit a false positive
c) The pack was never rebuilt when consultant data arrived later

### Fix: Canonical industry resolution with strict precedence

Create a single resolver function. Precedence:
1. consultant.businessIdentity.industry (HIGHEST — Gemini analysed the site)
2. consultant.businessIdentity.industryVertical (secondary)
3. fast-intel core_identity.industry (weaker, website-only)
4. Keyword heuristic (LOWEST — only if all above are null)

NEVER let the keyword heuristic overwrite a consultant answer.

### Implementation

In call-brain-do/src/intel.ts, replace buildIndustryLanguagePack():

```typescript
export function buildIndustryLanguagePack(intel: Record<string, unknown>): IndustryLanguagePack {
  const consultant = intel.consultant as any;
  const bi = consultant?.businessIdentity ?? {};
  const fastCore = (intel as any).core_identity ?? {};

  // PRIORITY 1: Consultant explicit industry (highest confidence)
  const consultantIndustry = (bi.industry ?? bi.industryVertical ?? '').toLowerCase().trim();

  // PRIORITY 2: Fast-intel core identity
  const coreIndustry = (fastCore.industry ?? '').toLowerCase();

  // Try exact match first, then keyword match, in priority order
  const candidates = [consultantIndustry, coreIndustry].filter(Boolean);

  for (const candidate of candidates) {
    // Exact match
    if (INDUSTRY_PACKS[candidate]) {
      return INDUSTRY_PACKS[candidate];
    }
    // Keyword match
    for (const [keyword, industry] of Object.entries(KEYWORD_MAP)) {
      if (candidate.includes(keyword)) {
        const pack = INDUSTRY_PACKS[industry];
        if (pack) return { ...pack, industryLabel: candidate };
      }
    }
  }

  // FALLBACK: generic
  return { ...GENERIC_PACK, industryLabel: consultantIndustry || coreIndustry || 'business' };
}
```

### ALSO: Add financial planning to INDUSTRY_PACKS and KEYWORD_MAP

In call-brain-do/src/intel.ts, add these:

To INDUSTRY_PACKS:
```typescript
'financial planning': {
  industryLabel: 'financial planning',
  singularOutcome: 'client',
  pluralOutcome: 'clients',
  leadNoun: 'enquiry',
  conversionVerb: 'engage',
  revenueEvent: 'new engagement',
  kpiLabel: 'client value',
  missedOpportunity: 'missed consultation',
  tone: 'strategic',
  examples: ['financial plan', 'retirement strategy', 'wealth review'],
},
```

To KEYWORD_MAP add:
```typescript
'financial': 'financial planning',
'wealth': 'financial planning',
'superannuation': 'financial planning',
'retirement': 'financial planning',
'investment': 'financial planning',
'adviser': 'financial planning',
'advisor': 'financial planning',
```

### ALSO: Rebuild pack when consultant arrives

In mergeIntel() in intel.ts, after merging consultant data, ALWAYS
rebuild the IndustryLanguagePack because the consultant has higher
confidence than fast-intel's initial classification.

### Validation logging
When the pack is built, log the resolution path:
```
log('INDUSTRY', `resolved="${pack.industryLabel}" from source="${source}" raw="${rawIndustry}"`);
```

---

## ISSUE 3: web_conversions EXTRACTION MISS ("twenty" not captured)

### Problem
Bella asks "How many of those convert into paying clients?"
Prospect says "twenty." DO captures web_leads: 20 but
web_conversions: null. ch_website loops 5 times until escape hatch.

### Root Cause
The extractor in extract.ts sees one turn in isolation. It doesn't
know WHAT QUESTION was just asked. When the prospect says "twenty"
as a standalone answer:
1. normalizeSpokenNumbers converts "twenty" → "20"
2. The standalone number fallback fires
3. It checks: is web_leads already set? If yes → map to web_conversions
4. BUT this logic may not fire correctly because the regex pattern
   for standalone numbers requires specific context words

### The actual code path (extract.ts, cross-stage standalone number):
```typescript
// This is the fallback that should catch "twenty" but may be failing:
const standaloneNum = s.match(
  /^(?:uh\s*)?(?:about|around|roughly|maybe|probably|say|like|i'?d say|hmm)?\s*(\d+(?:\.\d+)?)\s*(?:ish|or so|maybe|i think|i guess|i reckon)?\.?$/i
);
```

The problem: after normalizeSpokenNumbers("twenty") → "20", the
FULL transcript might be "20" or "about 20" — but if the transcript
has ANY other words around it (like "yeah 20" or "um twenty"),
the anchor regex (^ ... $) won't match.

### Fix: Three changes needed

#### A. Loosen the standalone number regex
The ^ and $ anchors are too strict. The prospect might say
"yeah about twenty" or "um twenty I think" — these fail the regex.

```typescript
// BEFORE (too strict — requires near-empty transcript):
const standaloneNum = s.match(
  /^(?:uh\s*)?(?:about|around|roughly|maybe|probably|say|like)?\s*(\d+)...$/i
);

// AFTER (looser — allows surrounding filler):
const standaloneNum = s.match(
  /(?:^|(?:yeah|yep|yes|um|uh|so|oh|like|well|hmm|about|around|roughly|maybe|probably|say)\s+)(\d+(?:\.\d+)?)\s*(?:ish|or so|maybe|i think|i guess|i reckon)?/i
);
```

#### B. Fix the web_conversions fallback mapping

In the standalone number section for ch_website, the logic should be:
```typescript
else if (stage === 'ch_website') {
  if (targets.includes('web_conversions')
      && currentExtracted?.web_leads != null
      && currentExtracted?.web_conversions == null) {
    fields.web_conversions = val;
  } else if (targets.includes('web_leads') && currentExtracted?.web_leads == null) {
    fields.web_leads = val;
  }
}
```

Make sure currentExtracted is being passed correctly from index.ts
to extractFromTranscript(). Check that brain.extracted is passed
as the 5th argument.

#### C. Add historyWindow context (future improvement)

Pass the last agent question into the extractor so it knows context:
```typescript
const result = extractFromTranscript(
  transcript,
  targets,
  brain.stage,
  brain.intel.industryLanguage?.industryLabel,
  brain.extracted,
  lastAgentQuestion  // NEW: helps extractor know which field to expect
);
```

This is a bigger change — do it as a follow-up, not in this patch.
The regex loosening + fallback fix should handle most cases.

#### D. Add extraction logging

In extractFromTranscript, log when standalone number fires:
```
console.log(`[EXTRACT_STANDALONE] stage=${stage} val=${val} targets=${targets} mapped_to=${fieldName}`);
```

And when it FAILS to extract anything:
```
console.log(`[EXTRACT_MISS] stage=${stage} targets=${targets} transcript="${transcript.slice(0,80)}"`);
```

---

## EXECUTION ORDER FOR CC

1. Add event observability to deep-scrape + fast-intel + DO (Issue 1)
2. Add 'financial planning' to INDUSTRY_PACKS + KEYWORD_MAP (Issue 2)
3. Fix buildIndustryLanguagePack precedence (Issue 2)
4. Ensure mergeIntel rebuilds pack after consultant arrives (Issue 2)
5. Loosen standalone number regex in extract.ts (Issue 3)
6. Fix web_conversions fallback mapping in extract.ts (Issue 3)
7. Add extraction logging (Issue 3)
8. tsc --noEmit all modified workers
9. Deploy in order: call-brain-do → fast-intel → deep-scrape
10. Test with a financial planning business (Ikigai or similar)

## FILES TO MODIFY

| File | Changes |
|------|---------|
| call-brain-do/src/intel.ts | Add financial planning pack, fix keyword map, fix precedence, add logging |
| call-brain-do/src/extract.ts | Loosen standalone regex, fix web_conversions fallback, add logging |
| call-brain-do/src/index.ts | Log eventId on intel receive/reject |
| fast-intel-sandbox-v9/src/index.ts | Add eventId + sentAt to event payloads |
| deep-scrape-workflow-sandbox-v9/src/index.ts | Add eventId + sentAt to deep_ready payload |

## DO NOT TOUCH
- moves.ts (script is correct)
- roi.ts (calcs are correct)
- gate.ts (logic is correct)
- deepgram-bridge-v9/ (V1.0 frozen)
- deepgram-bridge-v11/ (just patched, let it settle)
